import { describe, it, expect } from 'vitest'
import { fmtAmount, fmtYi, fmtDateTime } from './format.js'

// 金額呈現是機關對帳時逐格比對的東西,進位規則與缺值畫法都要釘死:
// 一旦有人「順手」把 null 改回 0,估驗表上的缺漏就會變成一筆零元。
describe('fmtAmount', () => {
  it('缺值預設畫 — ,不是 0(沒有值 ≠ 零元)', () => {
    expect(fmtAmount(null)).toBe('—')
    expect(fmtAmount(undefined)).toBe('—')
    expect(fmtAmount(NaN)).toBe('—')
    expect(fmtAmount('abc')).toBe('—')
  })

  it('真正的 0 就畫 0', () => {
    expect(fmtAmount(0)).toBe('0')
  })

  it('需要留白的欄位用 { empty } 明示', () => {
    expect(fmtAmount(null, { empty: '' })).toBe('')
    expect(fmtAmount(null, { empty: '0' })).toBe('0')
    expect(fmtAmount(0, { empty: '' })).toBe('0')  // 有值就不吃 empty
  })

  it('千分位', () => {
    expect(fmtAmount(1234567)).toBe('1,234,567')
    expect(fmtAmount(-1234567)).toBe('-1,234,567')
  })

  it('小數四捨五入(JS 的 .5 一律往 +∞)', () => {
    expect(fmtAmount(1234.4)).toBe('1,234')
    expect(fmtAmount(1234.5)).toBe('1,235')
    expect(fmtAmount(-1234.5)).toBe('-1,234')
    expect(fmtAmount(-1234.6)).toBe('-1,235')
  })

  it('進位到零的負數不得印出 -0', () => {
    expect(fmtAmount(-0.4)).toBe('0')
    expect(fmtAmount(-0)).toBe('0')
  })

  it('數字字串也吃(表單值常是字串)', () => {
    expect(fmtAmount('1234.6')).toBe('1,235')
  })
})

describe('fmtYi', () => {
  it('億元換算固定兩位小數', () => {
    expect(fmtYi(123456789)).toBe('1.23 億')
    expect(fmtYi(1e8)).toBe('1.00 億')
    expect(fmtYi(0)).toBe('0.00 億')
    expect(fmtYi(-1.5e8)).toBe('-1.50 億')
  })

  it('缺值與金額同一套語意', () => {
    expect(fmtYi(null)).toBe('—')
    expect(fmtYi(undefined)).toBe('—')
    expect(fmtYi(NaN)).toBe('—')
    expect(fmtYi(null, { empty: '' })).toBe('')
  })
})

describe('fmtDateTime', () => {
  it('缺值與不合法時戳都走 empty,不得印出 Invalid Date', () => {
    expect(fmtDateTime(null)).toBe('—')
    expect(fmtDateTime('')).toBe('—')
    expect(fmtDateTime('not-a-date')).toBe('—')
    expect(fmtDateTime(null, { empty: '' })).toBe('')
  })

  it('Date 與 ISO 字串走同一條路', () => {
    const d = new Date(2026, 0, 15, 9, 30, 0)
    const out = fmtDateTime(d)
    expect(out).toBe(fmtDateTime(d.toISOString()))
    expect(out).toContain('2026')
    expect(out).not.toContain('上午')  // hour12: false
  })
})
