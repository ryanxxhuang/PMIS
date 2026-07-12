// resolveWorkItems:真實專案絕不以範例資料充當標單。
// 分流:demo/無專案→sample;真專案 0 筆→empty;查詢失敗→error(不得偽裝成無資料);有資料→db。
import { describe, it, expect, vi } from 'vitest'

// resolveWorkItems 是純函式,但模組 import 鏈會建立真的 supabase client(node 環境無 WebSocket)
vi.mock('../../lib/supabase.js', () => ({ supabase: null, isSupabaseConfigured: false }))

import { resolveWorkItems } from './projects.js'

const project = { project_id: 'p1', project_name: '測試工程', owner_name: '某機關', project_code: 'C-001' }
const sampleJson = { items: [{ item_key: 'S1', description: '範例項' }], meta: { project_name: '範例案' } }
const dbResult = { items: [{ item_key: 'D1', id: 'u1' }], meta: { project_name: '測試工程' } }

const deps = (over = {}) => ({
  configured: true,
  project,
  fetchCount: vi.fn(async () => 0),
  fetchDbItems: vi.fn(async () => dbResult),
  fetchSample: vi.fn(async () => sampleJson),
  ...over,
})

describe('resolveWorkItems', () => {
  it('demo 模式(未設 Supabase)→ 範例資料,完全不打 DB', async () => {
    const d = deps({ configured: false })
    const res = await resolveWorkItems(d)
    expect(res.source).toBe('sample')
    expect(res.workItems.items).toEqual(sampleJson.items)
    expect(res.error).toBeNull()
    expect(d.fetchCount).not.toHaveBeenCalled()
    expect(d.fetchDbItems).not.toHaveBeenCalled()
  })

  it('已設 Supabase 但尚未選專案 → 範例資料(登入前/onboarding 頁沿用既有行為)', async () => {
    const d = deps({ project: null })
    const res = await resolveWorkItems(d)
    expect(res.source).toBe('sample')
    expect(d.fetchCount).not.toHaveBeenCalled()
  })

  it('真專案 BOQ=0 → empty 空狀態,不得載入範例', async () => {
    const d = deps({ fetchCount: vi.fn(async () => 0) })
    const res = await resolveWorkItems(d)
    expect(res.source).toBe('empty')
    expect(res.error).toBeNull()
    expect(res.workItems.items).toEqual([])
    expect(res.workItems.meta.project_name).toBe('測試工程') // meta 來自真專案,非範例
    expect(res.workItems.meta.item_count).toBe(0)
    expect(d.fetchSample).not.toHaveBeenCalled()
    expect(d.fetchDbItems).not.toHaveBeenCalled()
  })

  it('筆數查詢失敗 → error 帶訊息,不得偽裝成無資料或範例', async () => {
    const d = deps({ fetchCount: vi.fn(async () => { throw new Error('permission denied') }) })
    const res = await resolveWorkItems(d)
    expect(res.source).toBe('error')
    expect(res.error).toBe('permission denied')
    expect(res.workItems).toBeNull()
    expect(d.fetchSample).not.toHaveBeenCalled()
  })

  it('明細載入失敗(count>0 但下載壞掉)→ 一樣是 error,不 fallback 範例', async () => {
    const d = deps({
      fetchCount: vi.fn(async () => 42),
      fetchDbItems: vi.fn(async () => { throw new Error('network down') }),
    })
    const res = await resolveWorkItems(d)
    expect(res.source).toBe('error')
    expect(res.error).toBe('network down')
    expect(res.workItems).toBeNull()
    expect(d.fetchSample).not.toHaveBeenCalled()
  })

  it('真專案有 BOQ → db 路徑不變(既有 DB 專案不受影響)', async () => {
    const d = deps({ fetchCount: vi.fn(async () => 1) })
    const res = await resolveWorkItems(d)
    expect(res.source).toBe('db')
    expect(res.error).toBeNull()
    expect(res.workItems).toBe(dbResult)
    expect(d.fetchDbItems).toHaveBeenCalledWith(1)
    expect(d.fetchSample).not.toHaveBeenCalled()
  })
})
