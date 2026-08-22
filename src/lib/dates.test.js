import { describe, it, expect } from 'vitest'
import { parseLocalDate, taipeiISODate, taipeiToday, localISODate } from './dates.js'

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

describe('taipeiISODate — 業務日期一律取台北日曆日', () => {
  it('台北 00:00–08:00(UTC 還在前一天)不退到前一天', () => {
    // UTC 8/21 16:00 = 台北 8/22 00:00;UTC 8/21 23:59 = 台北 8/22 07:59
    expect(taipeiISODate('2026-08-21T16:00:00Z')).toBe('2026-08-22')
    expect(taipeiISODate('2026-08-21T23:59:59Z')).toBe('2026-08-22')
    expect(taipeiISODate(new Date('2026-08-21T16:30:00Z'))).toBe('2026-08-22')
  })

  it('台北白天(UTC 同一天)維持同一天', () => {
    expect(taipeiISODate('2026-08-22T04:00:00Z')).toBe('2026-08-22')
  })

  it('空值 / 無效輸入 → null', () => {
    expect(taipeiISODate(null)).toBeNull()
    expect(taipeiISODate('not-a-date')).toBeNull()
  })
})

describe('taipeiToday — 等於現在的台北日曆日', () => {
  it('與 taipeiISODate(new Date()) 一致(跨午夜瞬間取前後任一皆可)', () => {
    const before = taipeiISODate(new Date())
    const today = taipeiToday()
    const after = taipeiISODate(new Date())
    expect([before, after]).toContain(today)
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('localISODate — 本地 Date 格式化,不經 UTC 往前掉一天', () => {
  it('本地午夜 Date → 同一個年月日', () => {
    expect(localISODate(new Date(2026, 7, 22))).toBe('2026-08-22')
    expect(localISODate(parseLocalDate('2026-01-05'))).toBe('2026-01-05')
  })

  it('非 Date / 無效 Date → null', () => {
    expect(localISODate(null)).toBeNull()
    expect(localISODate('2026-01-05')).toBeNull()
    expect(localISODate(new Date('not-a-date'))).toBeNull()
  })
})
