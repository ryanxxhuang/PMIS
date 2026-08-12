// @vitest-environment jsdom
// W4-1/P1-05:listMembers 必須回 { rows, error }——RPC 失敗不得吞錯回空陣列,
// 否則成員頁分不出「載入失敗」與「真的沒成員」,會永遠顯示「載入中…」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => {
  const rpcResults = new Map()
  const builder = () => new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') { const p = Promise.resolve({ data: [], error: null }); return p.then.bind(p) }
      return () => builder()
    },
  })
  return {
    rpcResults,
    client: {
      from: () => builder(),
      rpc: (fn) => Promise.resolve(h.rpcResults.get(fn) || { data: [], error: null }),
    },
  }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: h.client, isSupabaseConfigured: true }))

import { useCollabSlice } from './collab.js'

function renderHook(useHook) {
  const result = { current: null }
  const Harness = () => { result.current = useHook(); return null }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Harness)))
  return result
}

const realCtx = {
  dbMode: true, demoMode: false, isPersistedProject: true,
  currentProject: { project_id: 'p1' }, currentUser: { user_id: 'u1', name: '測試員', org_type: 'contractor' },
  wiMaps: { byKey: new Map(), idToKey: new Map(), byId: new Map() },
  log: () => {}, saveMarkup: async (d) => d || null,
}
const demoCtx = { ...realCtx, dbMode: false, demoMode: true, isPersistedProject: false, currentProject: null }

beforeEach(() => { h.rpcResults.clear() })

describe('listMembers 三態的資料層(rows/error 分離)', () => {
  it('RPC 失敗 → { rows: [], error: 訊息 }(不吞錯)', async () => {
    const r = renderHook(() => useCollabSlice(realCtx, vi.fn()))
    h.rpcResults.set('list_project_members', { data: null, error: { message: 'permission denied for function list_project_members' } })
    let res
    await act(async () => { res = await r.current.listMembers() })
    expect(res.rows).toEqual([])
    expect(res.error).toBe('permission denied for function list_project_members')
  })

  it('RPC 成功 → { rows, error: null }', async () => {
    const r = renderHook(() => useCollabSlice(realCtx, vi.fn()))
    h.rpcResults.set('list_project_members', { data: [{ user_id: 'u1', full_name: '王小明', org_type: 'contractor', member_role: 'admin' }], error: null })
    let res
    await act(async () => { res = await r.current.listMembers() })
    expect(res.error).toBeNull()
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].full_name).toBe('王小明')
  })

  it('demo 模式 → 種子成員,error null,不打 RPC', async () => {
    const r = renderHook(() => useCollabSlice(demoCtx, vi.fn()))
    let res
    await act(async () => { res = await r.current.listMembers() })
    expect(res.error).toBeNull()
    expect(res.rows.length).toBeGreaterThan(0)
    expect(res.rows[0]).toHaveProperty('org_type')
  })
})
