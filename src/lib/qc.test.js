import { describe, it, expect } from 'vitest'
import { judgeItem, judgeChecklist, judgeConcrete, deriveTestSampleUpdate, shouldCreateTestSampleDefect, diffChecklistResults, sampleDues, pendingSamplesFromLogs, sampleAlerts, judgeInput, hasReadings, formatReadings, formatResult } from './qc.js'

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

describe('shouldCreateTestSampleDefect(DB trigger 的試體缺失冪等規則)', () => {
  it('首次不合格可開立；同試體已有缺失（即使已結案）也不重複開', () => {
    expect(shouldCreateTestSampleDefect([], 'TS-1')).toBe(true)
    expect(shouldCreateTestSampleDefect([
      { id: 'DEF-1', test_sample_id: 'TS-1', status: '已結案' },
    ], 'TS-1')).toBe(false)
    expect(shouldCreateTestSampleDefect([], null)).toBe(false)
  })
})

describe('deriveTestSampleUpdate(DB trigger 的同步判定規則)', () => {
  it('合併 28 天值後同步回傳不合格判定，非判定欄位更新不重算', () => {
    const failed = deriveTestSampleUpdate(
      { id: 'TS-1', fc: 280, d28_values: null, status: '待試驗' },
      { d28_values: [200, 200, 200] },
    )
    expect(failed.sample.status).toBe('不合格')
    expect(failed.judgement).toMatchObject({ status: '不合格', avg: 200, min: 200 })

    const noteOnly = deriveTestSampleUpdate(failed.sample, { note: '複核' })
    expect(noteOnly.sample.status).toBe('不合格')
    expect(noteOnly.judgement).toBeNull()
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

// G 包:分列讀數(兩向尺寸／多編號)。案例與 supabase/tests/checklist_result_readings.sql §2 同一組(前後端同一條規則)
describe('分列讀數:判定與呈現', () => {
  const W1 = { no: 'W1', item: '鋼線網線徑', kind: 'num', min: 10, max: 14, unit: 'mm' }
  const W2 = { no: 'W2', item: '鋼線網網目', kind: 'num', min: 14, max: 16, unit: 'cm' }
  const B1 = { no: 'B1', item: '搭接位置錯開', kind: 'bool' }
  const tpl = { items: [W1, W2, B1] }
  const rd = [{ entry_no: '1', value: 13, value2: 11, raw_text: '13 * 11 MM' }, { entry_no: '4', value: 11, value2: 11, raw_text: '11 * 11 MM' }]
  const judge = (results) => judgeChecklist(tpl, Object.fromEntries(Object.entries(results).map(([k, r]) => [k, judgeInput(r)])))

  it('兩個編號、兩向都在範圍內 → 合格,結果帶回完整讀數', () => {
    expect(judge({ W1: { value: null, readings: rd } }).results.W1).toEqual({ value: null, pass: true, readings: rd })
  })
  it('任一向、任一編號超規 → 不合格', () => {
    const a = judge({ W1: { value: null, readings: [{ entry_no: '1', value: 15, value2: 11 }] } })
    expect(a.overall).toBe('不合格')
    expect(a.failed.map((f) => f.no)).toEqual(['W1'])
    expect(judge({ W1: { value: null, readings: [{ entry_no: '1', value: 13, value2: 9 }] } }).results.W1.pass).toBe(false)
    expect(judge({ W1: { value: null, readings: [{ entry_no: '1', value: 13, value2: 11 }, { entry_no: '4', value: 9.5, value2: null }] } }).results.W1.pass).toBe(false)
  })
  it('無上下限有數值即合格;空讀數照單一值;非數字讀數不列入;字串數字照數值判', () => {
    expect(judgeItem({ no: 'X1', kind: 'num', unit: 'cm' }, judgeInput({ value: null, readings: [{ entry_no: '1', value: 15, value2: 15 }] }))).toBe(true)
    expect(judge({ W1: { value: 12, readings: [] } }).results.W1).toEqual({ value: 12, pass: true })
    expect(judge({ W1: { value: null, readings: [{ value: 'x' }, { value: null }] } }).results.W1.pass).toBe(null)
    expect(judge({ W1: { value: null, readings: [{ entry_no: '1', value: '13', value2: '11' }] } }).results.W1.pass).toBe(true)
  })
  it('勾選項不吃讀數;只有單一值時輸出形狀不變;混用照常判定', () => {
    expect(judge({ B1: { value: true, readings: [{ value: 999 }] } }).results.B1).toEqual({ value: true, pass: true })
    expect(judge({ W1: { value: 12 } }).results.W1).toEqual({ value: 12, pass: true })
    expect(judge({ W1: { value: null, readings: [{ entry_no: '1', value: 13, value2: 11 }] }, W2: { value: 15 }, B1: { value: true } }).overall).toBe('合格')
  })
  it('人讀文字:編號＋兩向＋單位;修訂差異以讀數文字比對', () => {
    expect(formatReadings(rd, 'mm')).toBe('編號 1 13×11 mm、編號 4 11×11 mm')
    expect(formatResult(W1, { value: null, readings: [{ entry_no: null, value: 12, value2: null }] })).toBe('12 mm')
    expect(formatResult(W1, { value: 12.5 })).toBe('12.5 mm')
    expect(formatResult(B1, { value: false })).toBe('不合格')
    expect(hasReadings({ value: 1, readings: [] })).toBe(false)
    const d = diffChecklistResults(tpl, { W1: { value: null, readings: rd, pass: true } }, { W1: { value: null, readings: [rd[0]], pass: true } })
    expect(d).toEqual([{ no: 'W1', item: '鋼線網線徑', from: '編號 1 13×11 mm、編號 4 11×11 mm', to: '編號 1 13×11 mm', passFrom: true, passTo: true }])
  })
})
