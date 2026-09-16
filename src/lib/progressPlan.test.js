import { describe, expect, it } from 'vitest'
import { plannedPctNow, progressMonthIndex } from './progressPlan.js'

// D-024：每列是該月「月底」累計 %。列 0=2026-01（月底 0%）、列 1=2026-02（月底 20%）…
const plan = { start: '2026-01-20', months: [0, 20, 70, 100].map((plannedPct) => ({ plannedPct })) }
const day = (year, month, date) => new Date(year, month - 1, date)

describe('預定進度內插（月底累計）', () => {
  it('未設定或沒有月份時不偽裝成 0%', () => {
    expect(plannedPctNow(null, day(2026, 2, 1))).toBeNull()
    expect(plannedPctNow({ ...plan, months: [] }, day(2026, 2, 1))).toBeNull()
  })

  it.each([
    [2025, 12, 31, 0],
    [2026, 1, 1, 0],
    [2026, 1, 16, 0],      // 開工月列為 0%，月內仍是 0
    [2026, 1, 31, 0],      // 列 0 = 1 月底
    [2026, 2, 14, 10],     // 1 月底 0 → 2 月底 20，14/28
    [2026, 2, 28, 20],     // 列 1 = 2 月底
    [2026, 3, 1, 70 * 0 + 20 + 50 * (1 / 31)],
    [2026, 3, 31, 70],
    [2026, 4, 30, 100],
    [2027, 1, 1, 100],
  ])('%i-%i-%i 的累計預定進度為 %s%%', (year, month, date, expected) => {
    expect(plannedPctNow(plan, day(year, month, date))).toBeCloseTo(expected)
  })

  it('月份列不再被當成該月 1 日：同月月初低於月底、月底等於該列值', () => {
    expect(plannedPctNow(plan, day(2026, 3, 1))).toBeLessThan(plannedPctNow(plan, day(2026, 3, 31)))
    expect(plannedPctNow(plan, day(2026, 3, 31))).toBe(70)
  })

  it('跨年與閏日沿用月份座標和當月日數換算，不重設曲線', () => {
    const crossYear = { ...plan, start: '2023-12-20' }
    expect(progressMonthIndex(crossYear.start, day(2024, 1, 16))).toBeCloseTo(16 / 31)
    expect(progressMonthIndex(crossYear.start, day(2024, 2, 29))).toBeCloseTo(2)
    expect(plannedPctNow(crossYear, day(2024, 2, 29))).toBeCloseTo(70)
  })

  it('單月份計畫在開工月內從 0 推進到月底列值，之後保持最後累計值', () => {
    const single = { ...plan, months: [{ plannedPct: 80 }] }
    expect(plannedPctNow(single, day(2026, 1, 1))).toBeCloseTo(80 / 31)
    expect(plannedPctNow(single, day(2026, 1, 31))).toBe(80)
    expect(plannedPctNow(single, day(2026, 2, 1))).toBe(80)
  })

  it('同一份計畫可重算不同日期，且不改寫原資料', () => {
    const snapshot = structuredClone(plan)
    expect(plannedPctNow(plan, day(2026, 2, 28))).toBe(20)
    expect(plannedPctNow(plan, day(2026, 2, 14))).toBeCloseTo(10)
    expect(plan).toEqual(snapshot)
  })

  it('日期字串解析成當地月份，UTC 以西也不掉回上個月', () => {
    const monthStart = { ...plan, start: '2026-01-01' }
    expect(progressMonthIndex(monthStart.start, day(2026, 1, 31))).toBe(0)
    expect(plannedPctNow(monthStart, day(2026, 2, 14))).toBeCloseTo(10)
  })
})
