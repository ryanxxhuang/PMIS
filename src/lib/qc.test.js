import { describe, it, expect } from 'vitest'
import { judgeItem, judgeChecklist, judgeConcrete, diffChecklistResults, sampleDues, pendingSamplesFromLogs, sampleAlerts } from './qc.js'

const numItem = { no: 'C1', item: '澆置溫度', kind: 'num', min: 13, max: 32 }
const minOnly = { no: 'C5', item: '振動頻率', kind: 'num', min: 7000 }
const maxOnly = { no: 'C4', item: '分層間隔', kind: 'num', max: 45 }
const boolItem = { no: 'B1', item: '已通知監造', kind: 'bool' }

describe('judgeItem', () => {
  it('數值在範圍內合格、超界不合格', () => {
    expect(judgeItem(numItem, 25)).toBe(true)
    expect(judgeItem(numItem, 12.9)).toBe(false)
    expect(judgeItem(numItem, 33)).toBe(false)
    expect(judgeItem(minOnly, 7000)).toBe(true)
    expect(judgeItem(minOnly, 6999)).toBe(false)
    expect(judgeItem(maxOnly, 45)).toBe(true)
    expect(judgeItem(maxOnly, 46)).toBe(false)
  })
  it('未填 → null(未檢)', () => {
    expect(judgeItem(numItem, '')).toBe(null)
    expect(judgeItem(numItem, null)).toBe(null)
    expect(judgeItem(boolItem, undefined)).toBe(null)
  })
  it('bool:勾=合格、明確否=不合格', () => {
    expect(judgeItem(boolItem, true)).toBe(true)
    expect(judgeItem(boolItem, false)).toBe(false)
  })
})

describe('judgeChecklist', () => {
  const tpl = { items: [numItem, minOnly, boolItem] }
  it('全部合格 → 合格,failed 空', () => {
    const r = judgeChecklist(tpl, { C1: 20, C5: 7500, B1: true })
    expect(r.overall).toBe('合格')
    expect(r.failed).toHaveLength(0)
  })
  it('任一不合格 → 不合格,failed 列出該項', () => {
    const r = judgeChecklist(tpl, { C1: 35, C5: 7500, B1: true })
    expect(r.overall).toBe('不合格')
    expect(r.failed.map((f) => f.no)).toEqual(['C1'])
  })
  it('部分未檢不影響判定;全未檢 overall=null', () => {
    expect(judgeChecklist(tpl, { C1: 20 }).overall).toBe('合格')
    expect(judgeChecklist(tpl, {}).overall).toBe(null)
  })
})

describe('diffChecklistResults(修訂版次差異)', () => {
  const tpl = { items: [numItem, boolItem] }
  it('值或判定有變的項目列入,未變不列', () => {
    const prev = { C1: { value: 20, pass: true }, B1: { value: true, pass: true } }
    const next = { C1: { value: 35, pass: false }, B1: { value: true, pass: true } }
    const d = diffChecklistResults(tpl, prev, next)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ no: 'C1', from: 20, to: 35, passFrom: true, passTo: false })
  })
  it('未檢→已檢視為異動;完全相同回空陣列', () => {
    const prev = { C1: { value: null, pass: null } }
    const next = { C1: { value: 25, pass: true } }
    expect(diffChecklistResults(tpl, prev, next).map((d) => d.no)).toEqual(['C1'])
    expect(diffChecklistResults(tpl, next, next)).toEqual([])
  })
})

describe('judgeConcrete(03310:任一 ≥0.85fc′ 且平均 ≥fc′)', () => {
  it('平均與下限都過 → 合格', () => {
    expect(judgeConcrete(420, [430, 425, 410]).status).toBe('合格') // avg 421.7, min 410 > 357
  })
  it('平均不足 → 不合格', () => {
    expect(judgeConcrete(420, [419, 418, 417]).status).toBe('不合格')
  })
  it('任一 <0.85fc′ → 不合格(即使平均過)', () => {
    expect(judgeConcrete(420, [500, 500, 350]).status).toBe('不合格') // 350 < 357
  })
  it('無值/無 fc → null', () => {
    expect(judgeConcrete(420, []).status).toBe(null)
    expect(judgeConcrete(null, [400]).status).toBe(null)
  })
})

describe('sampleDues / pendingSamplesFromLogs', () => {
  it('取樣日 +7/+28(跨月正確)', () => {
    expect(sampleDues('2026-06-27')).toEqual({ d7_due: '2026-07-04', d28_due: '2026-07-25' })
  })
  it('掃日誌:含混凝土材料的日期建取樣,已存在日期跳過,抓得到 fc', () => {
    const logs = [
      { log_date: '2026-07-02', work_summary: '4F 澆置', materials: [{ name: '預拌混凝土 420kgf/cm²' }] },
      { log_date: '2026-07-01', materials: [{ name: '鋼筋 SD420W' }] },
      { log_date: '2026-06-25', materials: [{ name: '預拌混凝土 420kgf/cm²' }] },
    ]
    const out = pendingSamplesFromLogs(logs, [{ sampled_date: '2026-06-25' }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ sampled_date: '2026-07-02', fc: 420, d28_due: '2026-07-30' })
  })
})

describe('sampleAlerts', () => {
  const s = { sample_no: 'S-1', status: '待試驗', d7_due: '2026-07-04', d28_due: '2026-07-25', d7_value: null, d28_values: [] }
  it('7天到期進 soon、逾期進 overdue;已填值不再提醒', () => {
    const a = sampleAlerts([s], '2026-07-03')
    expect(a.some((x) => x.label === '7天試驗' && x.level === 'soon')).toBe(true)
    const b = sampleAlerts([{ ...s, d7_value: 300 }], '2026-07-10')
    expect(b.every((x) => x.label !== '7天試驗')).toBe(true)
    expect(sampleAlerts([s], '2026-07-06')[0].level).toBe('overdue')
  })
  it('已判定的試體不提醒', () => {
    expect(sampleAlerts([{ ...s, status: '合格' }], '2026-07-03')).toHaveLength(0)
  })
})
