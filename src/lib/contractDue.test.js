import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeObligationDue } from './contractDue.js'

const anchors = {
  award_date: '2026-01-10',
  notice_date: '2026-01-20',
  commencement_date: '2026-02-01',
  end_date: '2026-12-31',
}

const ymd = (d) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('computeObligationDue — 基準日 + 偏移', () => {
  it('trigger 對應各基準日，offset_days 往後加', () => {
    expect(ymd(computeObligationDue({ trigger_event: 'award', offset_days: 14 }, anchors))).toBe('2026-01-24')
    expect(ymd(computeObligationDue({ trigger_event: 'notice', offset_days: 0 }, anchors))).toBe('2026-01-20')
    expect(ymd(computeObligationDue({ trigger_event: 'commencement', offset_days: 30 }, anchors))).toBe('2026-03-03')
  })

  it("offset_dir='before' 往前減（如竣工前 X 日）", () => {
    expect(ymd(computeObligationDue({ trigger_event: 'completion', offset_days: 7, offset_dir: 'before' }, anchors))).toBe('2026-12-24')
  })

  it('基準日未填 → null（基準日尚未確定，無法起算）', () => {
    expect(computeObligationDue({ trigger_event: 'commencement', offset_days: 10 }, { ...anchors, commencement_date: null })).toBeNull()
    expect(computeObligationDue({ trigger_event: 'other' }, anchors)).toBeNull()
  })
})

describe('computeObligationDue — 固定日期', () => {
  it('fixed 直接回傳 fixed_date；未填 → null', () => {
    expect(ymd(computeObligationDue({ trigger_event: 'fixed', fixed_date: '2026-06-15' }, anchors))).toBe('2026-06-15')
    expect(computeObligationDue({ trigger_event: 'fixed' }, anchors)).toBeNull()
  })
})

describe('computeObligationDue — 每月重複義務', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('本月截止日未過 → 本月；已過 → 下月', () => {
    vi.setSystemTime(new Date(2026, 6, 10)) // 2026-07-10
    expect(ymd(computeObligationDue({ recurring: 'monthly', recurring_day: 25 }, anchors))).toBe('2026-07-25')
    expect(ymd(computeObligationDue({ recurring: 'monthly', recurring_day: 5 }, anchors))).toBe('2026-08-05')
  })

  it('剛好是今天 → 今天（尚未逾期）', () => {
    vi.setSystemTime(new Date(2026, 6, 10))
    expect(ymd(computeObligationDue({ recurring: 'monthly', recurring_day: 10 }, anchors))).toBe('2026-07-10')
  })

  it('12 月已過截止日 → 翌年 1 月（跨年進位）', () => {
    vi.setSystemTime(new Date(2026, 11, 20)) // 2026-12-20
    expect(ymd(computeObligationDue({ recurring: 'monthly', recurring_day: 5 }, anchors))).toBe('2027-01-05')
  })
})
