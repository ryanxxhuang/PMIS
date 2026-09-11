import { describe, expect, it } from 'vitest'
import { plannedPctNow, progressMonthIndex } from './progressPlan.js'

const plan = { start: '2026-01-20', months: [0, 20, 70, 100].map((plannedPct) => ({ plannedPct })) }
const day = (year, month, date) => new Date(year, month - 1, date)

describe('預定進度內插', () => {
  it('未設定或沒有月份時不偽裝成 0%', () => {
    expect(plannedPctNow(null, day(2026, 2, 1))).toBeNull()
    expect(plannedPctNow({ ...plan, months: [] }, day(2026, 2, 1))).toBeNull()
  })

  it.each([
    [2025, 12, 31, 0],
    [2026, 1, 1, 0],
    [2026, 1, 16, 10],
    [2026, 1, 31, 20],
    [2026, 2, 1, 20],
    [2026, 2, 16, 45],
    [2026, 3, 1, 70],
    [2026, 4, 1, 100],
    [2027, 1, 1, 100],
  ])('%i-%i-%i 的累計預定進度為 %i%%', (year, month, date, expected) => {
    expect(plannedPctNow(plan, day(year, month, date))).toBeCloseTo(expected)
  })

  it('跨年與閏日沿用月份座標和 30 天換算，不重設曲線', () => {
    const crossYear = { ...plan, start: '2023-12-20' }
    expect(progressMonthIndex(crossYear.start, day(2024, 1, 16))).toBe(1.5)
    expect(progressMonthIndex(crossYear.start, day(2024, 2, 29))).toBeCloseTo(2 + 28 / 30)
    expect(plannedPctNow(crossYear, day(2024, 2, 29))).toBeCloseTo(98)
  })

  it('單月份計畫在月份起點為 0，之後保持最後累計值', () => {
    const single = { ...plan, months: [{ plannedPct: 80 }] }
    expect(plannedPctNow(single, day(2026, 1, 1))).toBe(0)
    expect(plannedPctNow(single, day(2026, 1, 2))).toBe(80)
  })

  it('同一份計畫可重算不同日期，且不改寫原資料', () => {
    const snapshot = structuredClone(plan)
    expect(plannedPctNow(plan, day(2026, 2, 1))).toBe(20)
    expect(plannedPctNow(plan, day(2026, 2, 16))).toBe(45)
    expect(plan).toEqual(snapshot)
  })

  it('日期字串解析成當地月份，UTC 以西也不掉回上個月', () => {
    const monthStart = { ...plan, start: '2026-01-01' }
    expect(progressMonthIndex(monthStart.start, day(2026, 1, 16))).toBe(0.5)
    expect(plannedPctNow(monthStart, day(2026, 1, 16))).toBe(10)
  })
})
