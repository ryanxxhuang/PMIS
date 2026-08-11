import { describe, it, expect } from 'vitest'
import { friendlyError } from './errorMessage.js'

describe('friendlyError', () => {
  it('把 GoTrue 的英文密碼複雜度訊息轉成中文', () => {
    const e = { message: 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.' }
    expect(friendlyError(e)).toBe('密碼需同時包含小寫英文、大寫英文與數字，且至少 8 碼。')
  })

  it('帳密錯誤不洩漏「是帳號錯還是密碼錯」', () => {
    const msg = friendlyError({ message: 'Invalid login credentials' })
    expect(msg).toBe('Email 或密碼錯誤，請確認後再試一次。')
    expect(msg).not.toMatch(/password|email not found/i)
  })

  it('寄信頻率限制講成使用者聽得懂的話', () => {
    expect(friendlyError({ message: 'For security purposes, you can only request this after 51 seconds.' }))
      .toMatch(/操作太頻繁/)
  })

  // 這條是重點:我們自己的業務規則不能被蓋掉,否則使用者不知道為什麼被擋
  it('資料庫觸發器丟出的業務規則訊息(P0001)原樣顯示', () => {
    const e = { code: 'P0001', message: '只有監造單位可以核定估驗' }
    expect(friendlyError(e)).toBe('只有監造單位可以核定估驗')
  })

  it('未知錯誤只顯示情境訊息與代碼,不外洩內部細節', () => {
    const e = {
      code: '42501',
      message: 'new row violates row-level security policy for table "valuations"',
    }
    const msg = friendlyError(e, '估驗未儲存')
    expect(msg).toBe('估驗未儲存（代碼 42501）')
    expect(msg).not.toMatch(/row-level security|valuations|policy/i)
  })

  it('edge function 的原始回應不外洩', () => {
    const msg = friendlyError({ message: 'Edge Function returned a non-2xx status code' }, '天氣帶入失敗')
    expect(msg).toBe('天氣帶入失敗')
    expect(msg).not.toMatch(/Edge Function|2xx/i)
  })

  it('網路錯誤給可行動的說明', () => {
    expect(friendlyError({ message: 'Failed to fetch' })).toMatch(/網路連線不穩/)
  })

  it('沒有錯誤時回傳 fallback', () => {
    expect(friendlyError(null, '沒事')).toBe('沒事')
  })

  it('字串型錯誤也能處理', () => {
    expect(friendlyError('Invalid login credentials')).toBe('Email 或密碼錯誤，請確認後再試一次。')
  })
})
