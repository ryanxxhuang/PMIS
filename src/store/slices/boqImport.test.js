// @vitest-environment jsdom
// W1 P0-01/P0-02 迴歸:標單匯入/重設改走單一交易 RPC(全成或全敗)。
// 保護重點:
//   1. 匯入不再分批 insert work_items——半份資料不可能從前端產生。
//   2. RPC 失敗時前端不寫快取、不改狀態(不能出現「DB 沒進、畫面卻顯示已匯入」)。
//   3. payload 不帶 id/project_id/parent_id——id 與父子關係由伺服器建立。
//   4. 重設失敗(被證據 guard 擋下)時不清快取、不觸發重載——DB 已 rollback,
//      前端不能假裝成功(P0-01 驗收的「UI 顯示錯誤且不清快取」)。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// 可斷言的 supabase 空殼(同 persistedWrites.test.js 模式):
// from(table) 記錄鏈式呼叫;rpc 的回傳值可由測試逐案指定(失敗注入點)。
const h = vi.hoisted(() => {
  const calls = []
  const rpcResults = new Map() // fn name → 下一次回傳值
  const state = { workItemsCount: undefined } // head count 查詢的回傳(undefined→0→'empty';>0→'db')
  const builder = (table) => {
    const api = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          const p = Promise.resolve({ data: [{ id: 'p1', name: '測試案' }], error: null, count: state.workItemsCount })
          return p.then.bind(p)
        }
        return (...args) => { calls.push({ table, op: prop, args }); return api }
      },
    })
    return api
  }
  return {
    calls, rpcResults, state,
    client: {
      from: (table) => { calls.push({ table, op: 'from' }); return builder(table) },
      rpc: (fn, args) => {
        calls.push({ table: `rpc:${fn}`, op: 'rpc', args })
        return Promise.resolve(rpcResults.get(fn) || { data: null, error: null })
      },
    },
  }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: h.client, isSupabaseConfigured: true }))

// db.js 部分替換:快取寫入用 spy(斷言「失敗不寫快取」),其餘維持真實作
const dbSpies = vi.hoisted(() => ({
  wiCachePut: vi.fn(), wiCacheDel: vi.fn(),
  fetchAllWorkItems: vi.fn(async () => [
    { id: 'w1', item_key: '1', parent_id: null, description: '第一章', quantity: null },
    { id: 'w2', item_key: '1.1', parent_id: 'w1', description: '假設工程', quantity: 1 },
  ]),
}))
vi.mock('../db.js', async (importOriginal) => ({ ...(await importOriginal()), ...dbSpies }))

import { useProjectsSlice } from './projects.js'

function renderHook(useHook) {
  const result = { current: null }
  const Harness = () => { result.current = useHook(); return null }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Harness)))
  return result
}

// useProjectsSlice 的載入 effect 依賴 [currentUser]:物件必須是穩定參考,
// 否則每次 render 都重跑載入 → 無限循環(這也是真實呼叫端的使用契約)
const realUser = { real: true, user_id: 'u1', name: '測試員' }
const guestUser = { real: false }
const noop = () => {}

const parsedFixture = {
  items: [
    { item_key: '1', parent_key: '', item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
    { item_key: '1.1', parent_key: '1', item_no: '一', description: '假設工程', unit: '式', quantity: 1, unit_price: 100, amount: 100, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
    { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: '式', quantity: 2, unit_price: 50, amount: 100, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
  ],
}

async function mountSlice(expectSource = 'empty') {
  const r = renderHook(() => useProjectsSlice({ currentUser: realUser, log: noop }))
  await act(async () => { // 等專案清單與標單載入 effect 完成
    for (let i = 0; i < 100 && r.current.workItemsSource !== expectSource; i++) await new Promise((res) => setTimeout(res, 10))
  })
  expect(r.current.workItemsSource).toBe(expectSource)
  expect(r.current.currentProject?.project_id).toBe('p1')
  return r
}

beforeEach(() => { h.calls.length = 0; h.rpcResults.clear(); h.state.workItemsCount = undefined; vi.clearAllMocks() })

describe('W1:標單匯入原子化(import_work_items RPC)', () => {
  it('成功:單一 RPC 進場,payload 由伺服器接管 id/父子關係,前端更新快取與狀態', async () => {
    const r = await mountSlice()
    h.rpcResults.set('import_work_items', { data: 3, error: null })
    let res
    await act(async () => { res = await r.current.importWorkItems(parsedFixture) })
    expect(res).toEqual({ error: null, count: 3 })

    const rpcCall = h.calls.find((c) => c.table === 'rpc:import_work_items')
    expect(rpcCall.args.p_project_id).toBe('p1')
    expect(rpcCall.args.p_items).toHaveLength(3)
    // id/project_id/parent_id 逐鍵不得出現在 payload——伺服器產 id、依 parent_key 回填
    expect(rpcCall.args.p_items[0]).not.toHaveProperty('id')
    expect(rpcCall.args.p_items[0]).not.toHaveProperty('project_id')
    expect(rpcCall.args.p_items[0]).not.toHaveProperty('parent_id')
    expect(rpcCall.args.p_items[0].parent_key).toBeNull() // '' 正規化為 null
    expect(rpcCall.args.p_items[1].parent_key).toBe('1')

    // 不再有任何直接 insert work_items 的分批路徑
    expect(h.calls.some((c) => c.table === 'work_items' && c.op === 'insert')).toBe(false)
    expect(dbSpies.wiCachePut).toHaveBeenCalledWith('p1', expect.any(Array))
    expect(r.current.workItemsSource).toBe('db')
  })

  it('失敗注入:RPC 回錯誤 → 回傳 error,不寫快取、不改狀態(全敗如未匯)', async () => {
    const r = await mountSlice()
    const before = r.current.workItemsSource
    h.rpcResults.set('import_work_items', { data: null, error: { message: '此專案已有標單工項,請先清空重匯' } })
    let res
    await act(async () => { res = await r.current.importWorkItems(parsedFixture) })
    expect(res.error.message).toBe('此專案已有標單工項,請先清空重匯')
    expect(dbSpies.wiCachePut).not.toHaveBeenCalled()
    expect(dbSpies.fetchAllWorkItems).not.toHaveBeenCalled()
    expect(r.current.workItemsSource).toBe(before)
    expect(h.calls.some((c) => c.table === 'work_items' && c.op === 'insert')).toBe(false)
  })

  it('失敗注入:重設 RPC 被證據 guard 擋下 → 回傳 error,不清快取、不觸發重載', async () => {
    h.state.workItemsCount = 2 // 已匯入的真專案(source='db',dbMode=true)
    const r = await mountSlice('db')
    vi.clearAllMocks() // 掛載期的 wiCachePut 不算入斷言
    h.rpcResults.set('reset_project_boq', { data: null, error: { message: '檢查紀錄為品質證據,不可就地修改' } })
    let res
    await act(async () => { res = await r.current.resetProjectBoqDb() })
    expect(res.error.message).toBe('檢查紀錄為品質證據,不可就地修改')
    expect(dbSpies.wiCacheDel).not.toHaveBeenCalled()
    expect(r.current.workItemsSource).toBe('db') // 沒觸發重載,畫面不會假裝已清空
  })

  it('成功:重設清快取並觸發重載回到 empty', async () => {
    h.state.workItemsCount = 2
    const r = await mountSlice('db')
    h.rpcResults.set('reset_project_boq', { data: null, error: null })
    h.state.workItemsCount = undefined // 重載時 DB 已清空 → count 0 → 'empty'
    await act(async () => { expect((await r.current.resetProjectBoqDb()).error).toBeNull() })
    expect(dbSpies.wiCacheDel).toHaveBeenCalledWith('p1')
    await act(async () => {
      for (let i = 0; i < 100 && r.current.workItemsSource !== 'empty'; i++) await new Promise((res) => setTimeout(res, 10))
    })
    expect(r.current.workItemsSource).toBe('empty') // 重載進 onboarding 空狀態,不載範例
  })

  it('未選專案:不打任何網路', async () => {
    const r = renderHook(() => useProjectsSlice({ currentUser: guestUser, log: noop }))
    // 無專案 → 載入 effect 走「範例標單」動態 import;等它 resolve,
    // 否則 promise 會在環境 teardown 後才完成而報 unhandled error
    await act(async () => {
      for (let i = 0; i < 100 && !r.current.workItems; i++) await new Promise((res) => setTimeout(res, 10))
    })
    h.calls.length = 0
    let res
    await act(async () => { res = await r.current.importWorkItems(parsedFixture) })
    expect(res.error.message).toBe('尚無專案')
    expect(h.calls.filter((c) => c.op === 'rpc')).toEqual([])
  })
})
