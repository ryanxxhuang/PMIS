import { describe, it, expect } from 'vitest'
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

// P5c:已提送／已完成的單次義務優先讀 DB trigger 留的完成當下快照——基準日事後更正不改歷史。
// 與 supabase/functions/_shared/contractDue.test.ts 同一組案例。
describe('computeObligationDue — 完成當下的到期日快照(P5c)', () => {
  it('已完成且有快照 → 讀快照,即使現行基準日算出來不同', () => {
    expect(ymd(computeObligationDue({ trigger_event: 'award', offset_days: 14, status: '已完成', due_date_snapshot: '2026-01-19' }, anchors))).toBe('2026-01-19')
    expect(ymd(computeObligationDue({ trigger_event: 'fixed', fixed_date: '2026-06-15', status: '已提送', due_date_snapshot: '2026-06-10' }, anchors))).toBe('2026-06-10')
  })
  it('未完成的義務即使帶快照(舊值殘留)也照現行基準日算;已完成但沒快照(舊資料)照現行基準日算', () => {
    expect(ymd(computeObligationDue({ trigger_event: 'award', offset_days: 14, status: '待辦', due_date_snapshot: '2026-01-19' }, anchors))).toBe('2026-01-24')
    expect(ymd(computeObligationDue({ trigger_event: 'award', offset_days: 14, status: '已完成' }, anchors))).toBe('2026-01-24')
    expect(computeObligationDue({ trigger_event: 'award', offset_days: 14, status: '不適用', due_date_snapshot: '2026-01-19' }, anchors) && ymd(computeObligationDue({ trigger_event: 'award', offset_days: 14, status: '不適用', due_date_snapshot: '2026-01-19' }, anchors))).toBe('2026-01-24')
  })
  it('循環義務不看義務層快照(期次各自有依據)', () => {
    expect(computeObligationDue({ recurring: 'monthly', recurring_day: 5, status: '已完成', due_date_snapshot: '2026-01-19', periods: [] }, anchors)).toBeNull()
  })
})

// 循環義務(P5b):到期日不再由前端從「今天」推算——期次由 DB materialize 依規則＋基準日確定性產生
// (pgTAP obligation_periods.sql 釘月末／閏年／跨年),前端只取「最早未結的一期」。
// 與 supabase/functions/_shared/contractDue.test.ts 同一組案例。
describe('computeObligationDue — 循環義務讀期次(obligation_periods)', () => {
  const period = (key, due, status = '待辦', extra = {}) => ({ period_key: key, due_date: due, status, ...extra })

  it('取最早未結的一期:舊逾期不被下一期蓋掉,完成本期後下期自然接上', () => {
    const periods = [period('2026-06', '2026-06-05', '已完成'), period('2026-08', '2026-08-05'), period('2026-07', '2026-07-05')]
    expect(ymd(computeObligationDue({ recurring: 'monthly', recurring_day: 5, periods }, anchors))).toBe('2026-07-05')
    const julyDone = periods.map((p) => (p.period_key === '2026-07' ? { ...p, status: '已提送' } : p))
    expect(ymd(computeObligationDue({ recurring: 'monthly', recurring_day: 5, periods: julyDone }, anchors))).toBe('2026-08-05')
  })

  it('期次全部已結或不適用 → null;沒有期次(基準日／循環規則待補)→ null,不從今天臆測', () => {
    expect(computeObligationDue({ recurring: 'monthly', recurring_day: 5, periods: [period('2026-07', '2026-07-05', '已完成'), period('2026-08', '2026-08-05', '不適用')] }, anchors)).toBeNull()
    expect(computeObligationDue({ recurring: 'monthly', recurring_day: 5, periods: [] }, anchors)).toBeNull()
    expect(computeObligationDue({ recurring: 'monthly', recurring_day: 5 }, anchors)).toBeNull()
    expect(computeObligationDue({ recurring: 'weekly' }, anchors)).toBeNull()
  })

  it('五種循環都只看期次,不看觸發點／基準日(月末夾住等規則在 DB)', () => {
    for (const recurring of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
      expect(ymd(computeObligationDue({ recurring, trigger_event: 'commencement', offset_days: 30, periods: [period('k', '2026-04-30')] }, anchors))).toBe('2026-04-30')
    }
  })
})


describe('formatObligationRule', () => {
  it('期限追蹤頁與列印共用頻率文案', () => {
    expect(formatObligationRule({ recurring: 'monthly', recurring_day: 5 })).toBe('每月 5 日')
    expect(formatObligationRule({ trigger_event: 'fixed', fixed_date: '2026-10-31' })).toBe('指定 2026-10-31')
    expect(formatObligationRule({ recurring: 'daily' })).toBe('每日')
  })
})
