import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeObligationDue, formatObligationRule } from './contractDue.js'

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

  // 呼叫端（今日待辦聚合）以固定日期推導時，不可回頭讀系統時鐘 —— 否則同一份
  // 輸入在不同時刻算出不同待辦，測試與日期模擬都失去意義。
  it('傳入 today 時以它為準，完全不看系統時鐘', () => {
    vi.setSystemTime(new Date(2026, 6, 10)) // 系統是 2026-07-10，故意與傳入值不同
    const injected = new Date(2026, 8, 20)  // 2026-09-20
    expect(ymd(computeObligationDue({ recurring: 'monthly', recurring_day: 25 }, anchors, injected))).toBe('2026-09-25')
    expect(ymd(computeObligationDue({ recurring: 'monthly', recurring_day: 5 }, anchors, injected))).toBe('2026-10-05')
    // 含時間的 Date 一樣正規化到當天午夜：當天到期仍算「尚未逾期」
    expect(ymd(computeObligationDue({ recurring: 'monthly', recurring_day: 20 }, anchors, new Date(2026, 8, 20, 23, 30)))).toBe('2026-09-20')
  })
})

describe('computeObligationDue — 每日/每週/每季/每年循環', () => {
  const today = new Date(2026, 7, 24) // 2026-08-24(週一)

  it('daily:下次到期永遠是今天', () => {
    expect(ymd(computeObligationDue({ recurring: 'daily' }, anchors, today))).toBe('2026-08-24')
  })

  it('weekly:本週未到→本週、剛好今天→今天、已過→下週(ISO 1=週一…7=週日)', () => {
    expect(ymd(computeObligationDue({ recurring: 'weekly', recurring_weekday: 3 }, anchors, today))).toBe('2026-08-26')
    expect(ymd(computeObligationDue({ recurring: 'weekly', recurring_weekday: 1 }, anchors, today))).toBe('2026-08-24')
    expect(ymd(computeObligationDue({ recurring: 'weekly', recurring_weekday: 7 }, anchors, today))).toBe('2026-08-30')
    const wed = new Date(2026, 7, 26) // 週三,週一已過
    expect(ymd(computeObligationDue({ recurring: 'weekly', recurring_weekday: 1 }, anchors, wed))).toBe('2026-08-31')
  })

  it('quarterly:recurring_month=季內第幾個月;本季已過→下季(含跨年)', () => {
    // 今天 2026-08-24 在 Q3(7~9 月)
    expect(ymd(computeObligationDue({ recurring: 'quarterly', recurring_month: 3, recurring_day: 10 }, anchors, today))).toBe('2026-09-10')
    expect(ymd(computeObligationDue({ recurring: 'quarterly', recurring_month: 2, recurring_day: 10 }, anchors, today))).toBe('2026-11-10')
    const dec = new Date(2026, 11, 20) // Q4 的第一個月 5 日已過 → 翌年 Q1
    expect(ymd(computeObligationDue({ recurring: 'quarterly', recurring_month: 1, recurring_day: 5 }, anchors, dec))).toBe('2027-01-05')
  })

  it('yearly:今年未到→今年、已過→明年', () => {
    expect(ymd(computeObligationDue({ recurring: 'yearly', recurring_month: 10, recurring_day: 10 }, anchors, today))).toBe('2026-10-10')
    expect(ymd(computeObligationDue({ recurring: 'yearly', recurring_month: 3, recurring_day: 31 }, anchors, today))).toBe('2027-03-31')
  })

  it('缺必要欄位推不出下次到期日 → null(不臆測日期)', () => {
    expect(computeObligationDue({ recurring: 'weekly' }, anchors, today)).toBeNull()
    expect(computeObligationDue({ recurring: 'quarterly', recurring_day: 10 }, anchors, today)).toBeNull()
    expect(computeObligationDue({ recurring: 'yearly', recurring_month: 3 }, anchors, today)).toBeNull()
  })
})


describe('formatObligationRule', () => {
  it('期限追蹤頁與列印共用頻率文案', () => {
    expect(formatObligationRule({ recurring: 'monthly', recurring_day: 5 })).toBe('每月 5 日')
    expect(formatObligationRule({ trigger_event: 'fixed', fixed_date: '2026-10-31' })).toBe('指定 2026-10-31')
    expect(formatObligationRule({ recurring: 'daily' })).toBe('每日')
  })
})
