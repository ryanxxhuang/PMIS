// @vitest-environment jsdom
// 迴歸:不依賴標單的領域(送審/RFI/觀察/工安/契約義務)寫入分流必須用 isPersistedProject,
// 不是 dbMode——真專案在「標單匯入前」dbMode=false,若走 dbMode 分支,寫入只進記憶體、
// 重新整理就消失(假成功)。此檔用「已選真專案、尚未匯標單」(isPersistedProject=true、
// dbMode=false)的 ctx 驗證每條寫入路徑都有打到 supabase。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// 可斷言的 supabase 空殼:記錄 from(table) 與後續鏈式呼叫,await 時回成功結果
// (.single() → 物件、其餘 → 一列的陣列,滿足 mutationOutcome 的「有寫到列」判定)。
const h = vi.hoisted(() => {
  const calls = []
  const builder = (table) => {
    const ops = []
    const api = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          const single = ops.includes('single')
          const p = Promise.resolve({ data: single ? { id: 'row-1' } : [{ id: 'row-1' }], error: null })
          return p.then.bind(p)
        }
        return (...args) => { ops.push(prop); calls.push({ table, op: prop, args }); return api }
      },
    })
    return api
  }
  return {
    calls,
    client: {
      from: (table) => { calls.push({ table, op: 'from' }); return builder(table) },
      rpc: (fn, args) => { calls.push({ table: `rpc:${fn}`, op: 'rpc', args }); return Promise.resolve({ data: [], error: null }) },
      storage: { from: (bucket) => builder(`storage:${bucket}`) },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: h.client, isSupabaseConfigured: true }))

import { useCollabSlice } from './collab.js'
import { useSiteSlice } from './site.js'
import { useLedgerSlice } from './ledger.js'
import { useQualitySlice } from './quality.js'

const wrote = (table, op) => h.calls.some((c) => c.table === table && c.op === op)

// 最小 hook harness(專案未裝 @testing-library,用 react-dom/client 直接掛)
function renderHook(useHook) {
  const result = { current: null }
  const Harness = () => { result.current = useHook(); return null }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Harness)))
  return result
}

// 真專案已選定、標單尚未匯入:dbMode=false、isPersistedProject=true
const preBoqCtx = {
  dbMode: false, demoMode: false, isPersistedProject: true,
  currentProject: { project_id: 'p1' }, currentUser: { user_id: 'u1', name: '測試員', org_type: 'contractor' },
  wiMaps: { byKey: new Map(), idToKey: new Map(), byId: new Map() },
  log: () => {}, saveMarkup: async (d) => d || null,
}
// demo 模式:兩者皆 false → 只進記憶體,完全不打 DB
const demoCtx = { ...preBoqCtx, demoMode: true, isPersistedProject: false, currentProject: null }

beforeEach(() => { h.calls.length = 0 })

describe('標單匯入前的真專案:collab 寫入必須進 DB', () => {
  it('送審 create/decide/resubmit/delete 都打 supabase', async () => {
    const r = renderHook(() => useCollabSlice(preBoqCtx, vi.fn()))
    await act(async () => { expect((await r.current.createSubmittal({ title: '施工計畫' })).error).toBeNull() })
    await act(async () => { await r.current.decideSubmittal('row-1', '核准', null) })
    await act(async () => { await r.current.resubmitSubmittal('row-1') })
    await act(async () => { await r.current.deleteSubmittal('row-1') })
    expect(wrote('submittals', 'insert')).toBe(true)
    expect(wrote('submittals', 'update')).toBe(true)
    expect(wrote('submittals', 'delete')).toBe(true)
  })

  it('RFI create/answer/close/delete 都打 supabase', async () => {
    const r = renderHook(() => useCollabSlice(preBoqCtx, vi.fn()))
    await act(async () => { expect((await r.current.createRfi({ title: '斷面疑義' })).error).toBeNull() })
    await act(async () => { await r.current.answerRfi('row-1', '依圖說 A-3 施作') })
    await act(async () => { await r.current.closeRfi('row-1') })
    await act(async () => { await r.current.deleteRfi('row-1') })
    expect(wrote('rfis', 'insert')).toBe(true)
    expect(wrote('rfis', 'update')).toBe(true)
    expect(wrote('rfis', 'delete')).toBe(true)
  })

  it('觀察事項 create/update/delete 都打 supabase(無標單 → work_item_id null)', async () => {
    const r = renderHook(() => useCollabSlice(preBoqCtx, vi.fn()))
    await act(async () => { expect((await r.current.createObservation({ title: '模板汙染' })).error).toBeNull() })
    await act(async () => { await r.current.updateObservation('row-1', { status: '已處理' }) })
    await act(async () => { await r.current.deleteObservation('row-1') })
    const ins = h.calls.find((c) => c.table === 'observations' && c.op === 'insert')
    expect(ins.args[0].work_item_id).toBeNull()
    expect(wrote('observations', 'update')).toBe(true)
    expect(wrote('observations', 'delete')).toBe(true)
  })
})

describe('標單匯入前的真專案:工安/契約義務寫入必須進 DB', () => {
  it('工安紀錄 create/update/delete 都打 supabase', async () => {
    const r = renderHook(() => useSiteSlice(preBoqCtx))
    await act(async () => { expect((await r.current.createSafetyRecord({ title: '未戴安全帽' })).error).toBeNull() })
    await act(async () => { await r.current.updateSafetyRecord('row-1', { status: '改善中' }) })
    await act(async () => { await r.current.deleteSafetyRecord('row-1') })
    expect(wrote('safety_records', 'insert')).toBe(true)
    expect(wrote('safety_records', 'update')).toBe(true)
    expect(wrote('safety_records', 'delete')).toBe(true)
  })

  it('契約義務改狀態打 supabase', async () => {
    const r = renderHook(() => useLedgerSlice(preBoqCtx))
    await act(async () => { await r.current.updateObligationStatus('ob-1', '已提送') })
    expect(wrote('contract_obligations', 'update')).toBe(true)
  })

  // 統一缺失引擎:工安缺失(domain=safety)在匯標單前就要能寫 DB
  it('缺失 create/updateStatus/delete 都打 supabase(domain=safety)', async () => {
    const r = renderHook(() => useQualitySlice(preBoqCtx, []))
    await act(async () => {
      expect((await r.current.createDefect({ title: '臨邊未設護欄', domain: 'safety' })).error).toBeNull()
    })
    await act(async () => { await r.current.updateDefectStatus('row-1', '改善中') })
    await act(async () => { await r.current.deleteDefect('row-1') })
    const ins = h.calls.find((c) => c.table === 'defects' && c.op === 'insert')
    expect(ins.args[0].domain).toBe('safety')
    expect(ins.args[0].work_item_id).toBeNull()
    expect(wrote('defects', 'update')).toBe(true)
    expect(wrote('defects', 'delete')).toBe(true)
  })
})

describe('demo 模式(未設 Supabase):只進記憶體,不打 DB', () => {
  it('送審/RFI/觀察/工安建立都不觸碰 supabase,且畫面上看得到', async () => {
    const collab = renderHook(() => useCollabSlice(demoCtx, vi.fn()))
    const site = renderHook(() => useSiteSlice(demoCtx))
    await act(async () => { await collab.current.createSubmittal({ title: 'demo 送審' }) })
    await act(async () => { await collab.current.createRfi({ title: 'demo 疑義' }) })
    await act(async () => { await collab.current.createObservation({ title: 'demo 觀察' }) })
    await act(async () => { await site.current.createSafetyRecord({ title: 'demo 工安' }) })
    expect(h.calls.filter((c) => c.op === 'insert')).toEqual([])
    expect(collab.current.submittals).toHaveLength(1)
    expect(collab.current.rfis).toHaveLength(1)
    expect(collab.current.observations).toHaveLength(1)
    expect(site.current.safetyRecords).toHaveLength(1)
  })
})
