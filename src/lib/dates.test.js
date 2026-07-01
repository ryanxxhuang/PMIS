import { describe, it, expect } from 'vitest'
import { parseLocalDate } from './dates.js'

describe('parseLocalDate — 一律解析成本地午夜', () => {
  it("'YYYY-MM-DD' → 本地午夜（任何時區下年月日都不變）", () => {
    const d = parseLocalDate('2026-03-01')
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 3, 1])
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0])
  })

  it('帶時間的 ISO 字串取日期部分', () => {
    const d = parseLocalDate('2026-03-01T15:30:00')
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 3, 1])
  })

  it('空值 / 無效字串 → null', () => {
    expect(parseLocalDate(null)).toBeNull()
    expect(parseLocalDate('')).toBeNull()
    expect(parseLocalDate('not-a-date')).toBeNull()
  })
})
