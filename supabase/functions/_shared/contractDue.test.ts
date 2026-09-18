// 驗證伺服器端移植與 src/lib/contractDue.js 的判斷一致(同一組案例)。
import { describe, it, expect } from 'vitest'
import { computeObligationDueUTC, parseDateUTC, taipeiTodayUTC, diffDays, formatDate } from './contractDue.ts'

const anchors = {
  award_date: '2026-01-10',
  notice_date: '2026-01-20',
  commencement_date: '2026-02-01',
  end_date: '2026-12-31',
}
const T = parseDateUTC('2026-07-10')! // 假設今天(台北)是 2026-07-10(日期工具用)

const f = (ms: number | null) => (ms == null ? null : formatDate(ms))

describe('computeObligationDueUTC — 與前端 contractDue.js 同判斷', () => {
  it('基準日 + 偏移(before/after)', () => {
    expect(f(computeObligationDueUTC({ trigger_event: 'award', offset_days: 14 }, anchors))).toBe('2026-01-24')
    expect(f(computeObligationDueUTC({ trigger_event: 'notice', offset_days: 0 }, anchors))).toBe('2026-01-20')
    expect(f(computeObligationDueUTC({ trigger_event: 'commencement', offset_days: 30 }, anchors))).toBe('2026-03-03')
    expect(f(computeObligationDueUTC({ trigger_event: 'completion', offset_days: 7, offset_dir: 'before' }, anchors))).toBe('2026-12-24')
  })

  it('基準日未填 / other → null;fixed 直接回傳', () => {
    expect(computeObligationDueUTC({ trigger_event: 'commencement', offset_days: 10 }, { ...anchors, commencement_date: null })).toBeNull()
    expect(computeObligationDueUTC({ trigger_event: 'other' }, anchors)).toBeNull()
    expect(f(computeObligationDueUTC({ trigger_event: 'fixed', fixed_date: '2026-06-15' }, anchors))).toBe('2026-06-15')
    expect(computeObligationDueUTC({ trigger_event: 'fixed' }, anchors)).toBeNull()
  })

  // 循環義務(P5b):到期日取期次(obligation_periods embed)最早未結的一期;期次由 DB 依規則＋基準日
  // 確定性物化(pgTAP 釘月末／閏年／跨年),伺服器端不再從「今天」推算下一期。同前端案例。
  const period = (key: string, due: string, status = '待辦') => ({ period_key: key, due_date: due, status })
  it('循環義務:取最早未結的一期,舊逾期不被下一期蓋掉;完成本期後下期接上', () => {
    const periods = [period('2026-06', '2026-06-05', '已完成'), period('2026-08', '2026-08-05'), period('2026-07', '2026-07-05')]
    expect(f(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 5, periods }, anchors))).toBe('2026-07-05')
    const julyDone = periods.map((p) => (p.period_key === '2026-07' ? { ...p, status: '已提送' } : p))
    expect(f(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 5, periods: julyDone }, anchors))).toBe('2026-08-05')
  })
  it('循環義務:期次全部已結／不適用或沒有期次 → null,不從今天臆測', () => {
    expect(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 5, periods: [period('2026-07', '2026-07-05', '已完成'), period('2026-08', '2026-08-05', '不適用')] }, anchors)).toBeNull()
    expect(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 5, periods: [] }, anchors)).toBeNull()
    expect(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 5 }, anchors)).toBeNull()
    expect(computeObligationDueUTC({ recurring: 'weekly' }, anchors)).toBeNull()
  })
  it('五種循環都只看期次,不看觸發點／基準日', () => {
    for (const recurring of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
      expect(f(computeObligationDueUTC({ recurring, trigger_event: 'commencement', offset_days: 30, periods: [period('k', '2026-04-30')] }, anchors))).toBe('2026-04-30')
    }
  })
  // P5c:已提送／已完成的單次義務優先讀完成當下的快照(基準日事後更正不改歷史);同前端案例
  it('完成當下的到期日快照:已完成有快照讀快照;未完成或沒快照照現行基準日;循環不看義務層快照', () => {
    expect(f(computeObligationDueUTC({ trigger_event: 'award', offset_days: 14, status: '已完成', due_date_snapshot: '2026-01-19' }, anchors))).toBe('2026-01-19')
    expect(f(computeObligationDueUTC({ trigger_event: 'fixed', fixed_date: '2026-06-15', status: '已提送', due_date_snapshot: '2026-06-10' }, anchors))).toBe('2026-06-10')
    expect(f(computeObligationDueUTC({ trigger_event: 'award', offset_days: 14, status: '待辦', due_date_snapshot: '2026-01-19' }, anchors))).toBe('2026-01-24')
    expect(f(computeObligationDueUTC({ trigger_event: 'award', offset_days: 14, status: '已完成' }, anchors))).toBe('2026-01-24')
    expect(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 5, status: '已完成', due_date_snapshot: '2026-01-19', periods: [] }, anchors)).toBeNull()
  })
})

describe('日期工具', () => {
  it('parseDateUTC 是 UTC 純日期;無效輸入 → null', () => {
    expect(parseDateUTC('2026-07-01')).toBe(Date.UTC(2026, 6, 1))
    expect(parseDateUTC(null)).toBeNull()
    expect(parseDateUTC('not a date')).toBeNull()
  })
  it('taipeiTodayUTC:UTC 23:00 已是台北隔天', () => {
    const utc2300 = Date.UTC(2026, 6, 10, 23, 0) // 台北 07-11 07:00
    expect(formatDate(taipeiTodayUTC(utc2300))).toBe('2026-07-11')
    const utc1500 = Date.UTC(2026, 6, 10, 15, 59) // 台北 07-10 23:59
    expect(formatDate(taipeiTodayUTC(utc1500))).toBe('2026-07-10')
  })
  it('diffDays', () => {
    expect(diffDays(parseDateUTC('2026-07-13')!, T)).toBe(3)
    expect(diffDays(parseDateUTC('2026-07-08')!, T)).toBe(-2)
  })
})
