// 估驗計價 mutation 的錯誤處理基礎:
// - valuationItemRow:數量→百分比/金額換算(建立期/改數量/帶入日誌三處共用)
// - mutationOutcome:RLS 靜默擋下(0 rows)也必須視為失敗,不得偽裝成功
import { describe, it, expect, vi } from 'vitest'

// 模組 import 鏈會建立真的 supabase client(node 環境無 WebSocket),測試裡換成空殼
vi.mock('../../lib/supabase.js', () => ({ supabase: null, isSupabaseConfigured: false }))

import { valuationItemRow, mutationOutcome } from './billing.js'

describe('valuationItemRow', () => {
  const wi = { id: 'wi-1', quantity: 200, amount: 1000000 }

  it('數量比換算 cum_pct 與 amount_cum', () => {
    const row = valuationItemRow(wi, 'val-1', 50, 'manual')
    expect(row).toEqual({
      valuation_id: 'val-1', work_item_id: 'wi-1', cum_qty: 50,
      cum_pct: 25, amount_cum: 250000, source: 'manual',
    })
  })

  it('契約數量 0/null → cum_pct 為 null、金額 0(不得除以零)', () => {
    for (const q of [0, null, undefined]) {
      const row = valuationItemRow({ id: 'wi-2', quantity: q, amount: 5000 }, 'val-1', 3, 'daily_log')
      expect(row.cum_pct).toBeNull()
      expect(row.amount_cum).toBe(0)
    }
  })

  it('金額 null → amount_cum 0,source 原樣帶出', () => {
    const row = valuationItemRow({ id: 'wi-3', quantity: 10, amount: null }, 'val-1', 5, 'daily_log')
    expect(row.amount_cum).toBe(0)
    expect(row.cum_pct).toBe(50)
    expect(row.source).toBe('daily_log')
  })
})

describe('mutationOutcome', () => {
  it('DB 回傳 error → 原樣傳回(trigger 的中文訊息直接給使用者看)', () => {
    const error = { message: '估驗核定/退回核定僅監造或專案管理者可執行' }
    expect(mutationOutcome({ data: null, error }, '備用訊息')).toEqual({ error })
  })

  it('RLS 靜默擋下(無 error 但 0 rows)→ 視為失敗,回傳 denied 訊息', () => {
    for (const data of [[], null, undefined]) {
      const { error } = mutationOutcome({ data, error: null }, '刪除被拒絕:可能已核定或無權限')
      expect(error).toEqual({ message: '刪除被拒絕:可能已核定或無權限' })
    }
  })

  it('有寫到列 → 成功({error: null})', () => {
    expect(mutationOutcome({ data: [{ id: 'v1' }], error: null }, 'x')).toEqual({ error: null })
  })
})
