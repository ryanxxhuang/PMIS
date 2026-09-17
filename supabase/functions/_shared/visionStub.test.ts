// 本機視覺 stub 的啟用條件(P2c):正式環境預設關閉且無法啟用——沒有旗標、或 SUPABASE_URL 是
// https／非本機主機,一律 false;只有旗標=1 且本機 http 位址才 true。
import { describe, it, expect } from 'vitest'
import { stubAllowed, stubClassify, stubWhiteboard, STUB_NOTE } from './visionStub.ts'

describe('visionStub.stubAllowed', () => {
  it('沒有旗標(正式預設)→ 關閉,不論 URL', () => {
    expect(stubAllowed({ flag: undefined, supabaseUrl: 'http://kong:8000' })).toBe(false)
    expect(stubAllowed({ flag: '', supabaseUrl: 'http://127.0.0.1:54321' })).toBe(false)
    expect(stubAllowed({ flag: '0', supabaseUrl: 'http://127.0.0.1:54321' })).toBe(false)
    expect(stubAllowed({ flag: 'true', supabaseUrl: 'http://127.0.0.1:54321' })).toBe(false)
  })
  it('旗標=1 但 SUPABASE_URL 是正式 https 或非本機主機 → 仍關閉', () => {
    expect(stubAllowed({ flag: '1', supabaseUrl: 'https://buylyonwoyvqdbvkkkbx.supabase.co' })).toBe(false)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'https://kong:8000' })).toBe(false)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://evil.example.com' })).toBe(false)
    expect(stubAllowed({ flag: '1', supabaseUrl: '' })).toBe(false)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'not a url' })).toBe(false)
  })
  it('旗標=1 且本機 http 位址 → 啟用(kong／localhost／127.0.0.1／host.docker.internal／supabase_kong_*)', () => {
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://kong:8000' })).toBe(true)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://127.0.0.1:54321' })).toBe(true)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://localhost:54321' })).toBe(true)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://host.docker.internal:54321' })).toBe(true)
    expect(stubAllowed({ flag: '1', supabaseUrl: 'http://supabase_kong_PMIS:8000' })).toBe(true)
  })
})

describe('visionStub 輸出', () => {
  it('分類結果固定為可辨的工地照、無告示板;hint 由環境指定;板讀回空(不轉錄任何數量)', () => {
    expect(stubClassify(' 結構工程 ')).toMatchObject({ is_construction: true, legible: true, has_board: false, work_item_hint: '結構工程', location: null })
    expect(stubClassify(undefined).work_item_hint).toBe('')
    expect(stubWhiteboard()).toEqual({ log_date: '', weather: '', location: '', work_summary: '', items: [] })
    expect(STUB_NOTE).toContain('stub')
  })
})
