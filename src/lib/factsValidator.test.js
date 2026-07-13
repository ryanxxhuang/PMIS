import { describe, it, expect } from 'vitest'
import { validateDraft, allowedNumbers } from './factsValidator.js'

const payload = {
  month: '2026-07',
  project_name: 'QA 驗收案',
  stats: {
    thisMonthVal: 29540, actualPct: 0.0041, plannedPct: 36.6, diff: -36.6,
    workDays: 1, rainDays: 0, inspections: 2, failed: 1,
    logSummaries: ['澆置結構用混凝土 10 M3,坍度 15cm'],
  },
}

describe('validateDraft(AI 草稿數字必須出自 facts)', () => {
  it('P1-1 實案:AI 把 0.0041% 寫成 0.41% → 擋下', () => {
    const { ok, violations } = validateDraft('本月實際進度率 0.41%,持續趕工。', payload)
    expect(ok).toBe(false)
    expect(violations).toContain('0.41')
  })
  it('P1-1 實案:憑空的「合格率 100%」→ 擋下', () => {
    const { ok, violations } = validateDraft('辦理 2 場監督檢驗,合格率 100%。', payload)
    expect(ok).toBe(false)
    expect(violations).toContain('100')
  })
  it('正當引用 facts(含千分位、一位小數、落後取絕對值)→ 通過', () => {
    const { ok } = validateDraft(
      '本月完成估驗金額 NT$ 29,540,實際進度 0.0041%,較預定進度 36.6% 落後 36.6%;' +
      '施工 1 天(雨天 0 天),查驗 2 次,不合格 1 件已開缺失。', payload)
    expect(ok).toBe(true)
  })
  it('引用日誌原文中的數字(10 M3、坍度 15cm)→ 通過', () => {
    const { ok } = validateDraft('本月澆置混凝土 10 M3,坍度 15cm 抽驗合格。', payload)
    expect(ok).toBe(true)
  })
  it('P1-06 實案:工項級 facts(累計完成率 0.1%)→ 通過', () => {
    const withItems = { ...payload, stats: { ...payload.stats,
      items: [{ item_no: '壹.一.2.11', description: '結構用混凝土', qty: 2.5, cum: 2.5, contractQty: 3544, value: 7385, cumPct: 0.1 }] } }
    const { ok } = validateDraft('主要工項結構用混凝土累計完成率 0.1%,本月完成 2.5 M3。', withItems)
    expect(ok).toBe(true)
  })
  it('月份年份(2026、7)屬 facts 字串 → 通過', () => {
    const { ok } = validateDraft('2026 年 7 月工進正常。', payload)
    expect(ok).toBe(true)
  })
  it('allowedNumbers 含格式化變體', () => {
    const set = allowedNumbers({ stats: { pct: 19.94 } })
    expect(set.has('19.94')).toBe(true) // 原值
    expect(set.has('19.9')).toBe(true)  // 一位小數
    expect(set.has('20')).toBe(true)    // 四捨五入
  })
})
