// 驗證伺服器端移植與 src/lib/contractDue.js 的判斷一致(同一組案例)。
import { describe, it, expect } from 'vitest'
import { computeObligationDueUTC, parseDateUTC, taipeiTodayUTC, diffDays, formatDate } from './contractDue.ts'

const anchors = {
  award_date: '2026-01-10',
  notice_date: '2026-01-20',
  commencement_date: '2026-02-01',
  end_date: '2026-12-31',
}
const T = parseDateUTC('2026-07-10')! // 假設今天(台北)是 2026-07-10

const f = (ms: number | null) => (ms == null ? null : formatDate(ms))

describe('computeObligationDueUTC — 與前端 contractDue.js 同判斷', () => {
  it('基準日 + 偏移(before/after)', () => {
    expect(f(computeObligationDueUTC({ trigger_event: 'award', offset_days: 14 }, anchors, T))).toBe('2026-01-24')
    expect(f(computeObligationDueUTC({ trigger_event: 'notice', offset_days: 0 }, anchors, T))).toBe('2026-01-20')
    expect(f(computeObligationDueUTC({ trigger_event: 'commencement', offset_days: 30 }, anchors, T))).toBe('2026-03-03')
    expect(f(computeObligationDueUTC({ trigger_event: 'completion', offset_days: 7, offset_dir: 'before' }, anchors, T))).toBe('2026-12-24')
  })

  it('基準日未填 / other → null;fixed 直接回傳', () => {
    expect(computeObligationDueUTC({ trigger_event: 'commencement', offset_days: 10 }, { ...anchors, commencement_date: null }, T)).toBeNull()
    expect(computeObligationDueUTC({ trigger_event: 'other' }, anchors, T)).toBeNull()
    expect(f(computeObligationDueUTC({ trigger_event: 'fixed', fixed_date: '2026-06-15' }, anchors, T))).toBe('2026-06-15')
    expect(computeObligationDueUTC({ trigger_event: 'fixed' }, anchors, T)).toBeNull()
  })

  it('每月重複:未過→本月、已過→下月、今天→今天、12月→跨年', () => {
    expect(f(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 25 }, anchors, T))).toBe('2026-07-25')
    expect(f(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 5 }, anchors, T))).toBe('2026-08-05')
    expect(f(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 10 }, anchors, T))).toBe('2026-07-10')
    const dec = parseDateUTC('2026-12-20')!
    expect(f(computeObligationDueUTC({ recurring: 'monthly', recurring_day: 5 }, anchors, dec))).toBe('2027-01-05')
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
