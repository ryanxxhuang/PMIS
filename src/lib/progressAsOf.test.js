import { describe, expect, it } from 'vitest'
import { reportCutoff, isPartialMonth, latestValuationAt, valuationLabel, monthEnd } from './progressAsOf.js'

const day = (y, m, d) => new Date(y, m - 1, d)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('報表統計截止日', () => {
  it('過去月份取月底；本月與未來月份取今天，截止日不落在未來', () => {
    const today = day(2026, 9, 16)
    expect(iso(reportCutoff('2026-08', today))).toBe('2026-08-31')
    expect(iso(reportCutoff('2026-09', today))).toBe('2026-09-16')
    expect(iso(reportCutoff('2026-10', today))).toBe('2026-09-16')
    expect(isPartialMonth('2026-08', today)).toBe(false)
    expect(isPartialMonth('2026-09', today)).toBe(true)
  })
  it('今天正好是月底時視為整月', () => {
    const today = day(2026, 9, 30)
    expect(iso(reportCutoff('2026-09', today))).toBe('2026-09-30')
    expect(isPartialMonth('2026-09', today)).toBe(false)
    expect(iso(monthEnd('2026-02'))).toBe('2026-02-28')
  })
})

describe('截至某日的估驗期', () => {
  const vals = [
    { period_no: 1, valuation_date: '2026-06-25', status: '已核定' },
    { period_no: 2, valuation_date: '2026-07-25', status: '已核定' },
    { period_no: 3, valuation_date: '2026-08-25', status: '監造審核' },
    { period_no: 4, valuation_date: '2026-09-25', status: '草稿' },
  ]
  it('只取估驗日期在截止日（含）以前的期別，狀態不論；未來日期的期別不算', () => {
    expect(latestValuationAt(vals, day(2026, 9, 16)).period_no).toBe(3)
    expect(latestValuationAt(vals, day(2026, 8, 25)).period_no).toBe(3)
    expect(latestValuationAt(vals, day(2026, 8, 24)).period_no).toBe(2)
    expect(latestValuationAt(vals, day(2026, 6, 1))).toBeNull()
  })
  it('沒填日期的期別一律納入；不傳截止日＝最新一期；陣列順序不影響', () => {
    const noDate = [{ period_no: 5, status: '草稿' }, ...vals]
    expect(latestValuationAt(noDate, day(2026, 7, 1)).period_no).toBe(5)
    expect(latestValuationAt([...vals].reverse()).period_no).toBe(4)
    expect(latestValuationAt([], day(2026, 9, 1))).toBeNull()
  })
  it('期別說明帶期數與狀態', () => {
    expect(valuationLabel(vals[2])).toBe('第 3 期（監造審核）')
    expect(valuationLabel(null)).toBe('尚無估驗')
  })
})
