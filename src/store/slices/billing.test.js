// @vitest-environment jsdom
// Billing slice(P4c):估驗寫入全部走 P4b 的 RPC,前端不再組 valuation_items 列、不算金額與上限。
// 這裡釘住:
//   0. 沒有任何客戶端數字寫入路徑(fillValuationFromSiteLogs／valuationItemRow 已移除;不對 valuation_items 寫入);
//   1. 建期:必填計價截止日 → insert valuations(含 period_end)→ sync RPC → 重載;sync 失敗把期刪掉不留半套;
//   2. 改數量:set_valuation_item_cum(目標累計量);VQ006 的 detail(prev_cum／floor／limit／cap／wanted)原樣交出;
//   3. 狀態轉移:transition_valuation 帶目前狀態 p_from;applied:false 視為未變更並重載;VQ004 的違反清單原樣交出;
//   4. mutationOutcome:RLS 靜默擋下(0 rows)也必須視為失敗;
//   5. demo:本機更新,金額用 fn_valuation_amount 鏡像(逐工項到元)。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { renderHook } from '../../testUtils/renderHook.js'
import { configured } from '../../testUtils/supabaseMock.js'

const { pg, loadValuationsFromDB } = await vi.hoisted(async () => {
  const { createScriptedSupabase } = await import('../../testUtils/scriptedSupabase.js')
  const { vi: v } = await import('vitest')
  return { pg: createScriptedSupabase(), loadValuationsFromDB: v.fn(async () => []) }
})
vi.mock('../../lib/supabase.js', () => configured(pg.client))
vi.mock('../db.js', () => ({ loadValuationsFromDB }))

import { useBillingSlice, mutationOutcome, parseValuationError } from './billing.js'

const WI = { id: 'wi-1', item_key: 'A1', item_no: '1', description: '混凝土', unit: 'm3', quantity: 100, unit_price: 1000, amount: 100000 }
const ctx = (over = {}) => ({
  dbMode: true, currentProject: { project_id: 'p1' }, currentUser: { user_id: 'u1' },
  wiMaps: { byKey: new Map([['A1', WI]]), idToKey: new Map([['wi-1', 'A1']]), byId: new Map([['wi-1', WI]]) },
  ...over,
})
const mount = (c = ctx()) => renderHook(() => useBillingSlice(c))
const draft = { id: 'v1', period_no: 1, status: '草稿', period_end: '2026-09-19', items: {}, amounts: {}, own: {} }

beforeEach(() => { pg.reset(); loadValuationsFromDB.mockReset(); loadValuationsFromDB.mockResolvedValue([]) })

describe('0. 沒有客戶端數字寫入路徑', () => {
  it('slice 不暴露 fillValuationFromSiteLogs;改數量／建期都不對 valuation_items 寫入', async () => {
    const r = mount()
    expect(r.current).not.toHaveProperty('fillValuationFromSiteLogs')
    await act(async () => { r.current.setValuations([draft]) })
    await act(async () => { await r.current.updateValuationItem('v1', 'A1', 10) })
    await act(async () => { await r.current.createValuation({ periodEnd: '2026-09-30' }) })
    expect(pg.calls.filter((c) => c.table === 'valuation_items')).toHaveLength(0)
  })
})

describe('1. 建期', () => {
  it('缺計價截止日直接拒絕,不打 DB', async () => {
    const r = mount()
    let res
    await act(async () => { res = await r.current.createValuation({}) })
    expect(res.error.message).toContain('截止日')
    expect(pg.calls).toHaveLength(0)
  })

  it('insert 帶 period_end 與草稿狀態 → sync RPC → 重載(畫面上的期別是 DB 的)', async () => {
    loadValuationsFromDB.mockResolvedValue([{ ...draft, id: 'new', period_no: 1, period_end: '2026-09-30' }])
    const r = mount()
    let res
    await act(async () => { res = await r.current.createValuation({ periodEnd: '2026-09-30' }) })
    expect(res.error).toBeNull()
    const inserted = pg.argsOf('valuations', 'insert')[0][0]
    expect(inserted).toMatchObject({ project_id: 'p1', period_no: 1, period_end: '2026-09-30', status: '草稿', created_by: 'u1' })
    expect(pg.argsOf('rpc:sync_valuation_from_confirmations', 'rpc')[0][0]).toEqual({ p_valuation_id: inserted.id })
    expect(loadValuationsFromDB).toHaveBeenCalledWith('p1', expect.any(Map))
    expect(r.current.valuations.map((v) => v.id)).toEqual(['new'])
  })

  it('sync 失敗 → 刪掉剛建的期、回傳錯誤、不留半套', async () => {
    pg.script('rpc:sync_valuation_from_confirmations', 'rpc', { data: null, error: { code: 'VQ001', message: '只有施工廠商可編輯估驗草稿' } })
    const r = mount()
    let res
    await act(async () => { res = await r.current.createValuation({ periodEnd: '2026-09-30' }) })
    expect(res.error.code).toBe('VQ001')
    expect(pg.hit('valuations', 'delete')).toBe(true)
    expect(loadValuationsFromDB).not.toHaveBeenCalled()
    expect(r.current.valuations).toEqual([])
  })

  it('demo:本機建期,累計量與金額往前帶,不打 DB', async () => {
    const r = mount(ctx({ dbMode: false }))
    await act(async () => { r.current.setValuations([{ ...draft, status: '已核定', items: { A1: 10 }, amounts: { A1: 10000 } }]) })
    let res
    await act(async () => { res = await r.current.createValuation({ periodEnd: '2026-09-30' }) })
    expect(res.error).toBeNull()
    expect(r.current.valuations[1]).toMatchObject({ period_no: 2, status: '草稿', period_end: '2026-09-30', items: { A1: 10 }, amounts: { A1: 10000 } })
    expect(pg.calls).toHaveLength(0)
  })
})

describe('2. 改累計量', () => {
  it('走 set_valuation_item_cum(目標累計量,work_item uuid)後重載', async () => {
    loadValuationsFromDB.mockResolvedValue([{ ...draft, items: { A1: 60 }, amounts: { A1: 60000 } }])
    const r = mount()
    await act(async () => { r.current.setValuations([draft]) })
    let res
    await act(async () => { res = await r.current.updateValuationItem('v1', 'A1', 60) })
    expect(res.error).toBeNull()
    expect(pg.argsOf('rpc:set_valuation_item_cum', 'rpc')[0][0]).toEqual({ p_valuation_id: 'v1', p_work_item_id: 'wi-1', p_cum_qty: 60 })
    expect(r.current.valuations[0].items.A1).toBe(60)
    expect(r.current.valuations[0].amounts.A1).toBe(60000) // 金額是 DB 的,前端沒算
  })

  it('VQ006:錯誤帶代碼與 detail(prev_cum／floor／limit／cap／wanted),快取不動', async () => {
    pg.script('rpc:set_valuation_item_cum', 'rpc', {
      data: null,
      error: { code: 'VQ006', message: '本期最多可新增 60(有效確認量 60 − 已計價 0 − 其他期占用 0),要求新增 61',
        details: JSON.stringify({ prev_cum: 0, floor: 0, limit: 60, cap: 60, wanted: 61, effective: 60, billed: 0, reserved: 0, basis: 'inspection' }) },
    })
    const r = mount()
    await act(async () => { r.current.setValuations([draft]) })
    let res
    await act(async () => { res = await r.current.updateValuationItem('v1', 'A1', 61) })
    expect(res.error.code).toBe('VQ006')
    expect(res.error.detail).toMatchObject({ prev_cum: 0, limit: 60, cap: 60, wanted: 61 })
    expect(loadValuationsFromDB).not.toHaveBeenCalled()
    expect(r.current.valuations[0].items).toEqual({})
  })

  it('demo:本機更新,金額 = round(累計量 × 單價)(fn_valuation_amount 鏡像)', async () => {
    const r = mount(ctx({ dbMode: false }))
    await act(async () => { r.current.setValuations([draft]) })
    await act(async () => { await r.current.updateValuationItem('v1', 'A1', 12.3456) })
    expect(r.current.valuations[0].items.A1).toBe(12.3456)
    expect(r.current.valuations[0].amounts.A1).toBe(12346)
    expect(pg.calls).toHaveLength(0)
  })
})

describe('3. 狀態轉移', () => {
  it('transition_valuation 帶目前狀態 p_from 與退回原因;成功後重載', async () => {
    pg.script('rpc:transition_valuation', 'rpc', { data: { applied: true, status: '草稿' }, error: null })
    loadValuationsFromDB.mockResolvedValue([{ ...draft, status: '草稿', note: '退回(2026-09-19)：數量待補' }])
    const r = mount()
    await act(async () => { r.current.setValuations([{ ...draft, status: '監造審核' }]) })
    let res
    await act(async () => { res = await r.current.setValuationStatus('v1', '草稿', { note: '退回(2026-09-19)：數量待補' }) })
    expect(res.error).toBeNull()
    expect(pg.argsOf('rpc:transition_valuation', 'rpc')[0][0]).toEqual({ p_valuation_id: 'v1', p_from: '監造審核', p_to: '草稿', p_note: '退回(2026-09-19)：數量待補' })
    expect(r.current.valuations[0].note).toContain('數量待補')
  })

  it('applied:false(別人先動過)→ 視為未變更並重載,不假裝成功', async () => {
    pg.script('rpc:transition_valuation', 'rpc', { data: { applied: false, status: '已核定', message: '估驗第 1 期目前狀態是「已核定」,不是「監造審核」' }, error: null })
    loadValuationsFromDB.mockResolvedValue([{ ...draft, status: '已核定' }])
    const r = mount()
    await act(async () => { r.current.setValuations([{ ...draft, status: '監造審核' }]) })
    let res
    await act(async () => { res = await r.current.setValuationStatus('v1', '已核定') })
    expect(res.error.message).toContain('已核定')
    expect(r.current.valuations[0].status).toBe('已核定')
  })

  it('VQ004:違反清單(detail 陣列)原樣交出,狀態不變', async () => {
    pg.script('rpc:transition_valuation', 'rpc', {
      data: null,
      error: { code: 'VQ004', message: '估驗第 1 期不符送審條件', details: JSON.stringify([{ work_item_id: 'wi-1', code: 'source_mismatch', message: '本期增量 100 與來源分配 0 不符(缺監造確認來源)' }]) },
    })
    const r = mount()
    await act(async () => { r.current.setValuations([draft]) })
    let res
    await act(async () => { res = await r.current.setValuationStatus('v1', '監造審核') })
    expect(res.error.code).toBe('VQ004')
    expect(res.error.detail).toEqual([expect.objectContaining({ code: 'source_mismatch', work_item_id: 'wi-1' })])
    expect(r.current.valuations[0].status).toBe('草稿')
  })
})

describe('4. mutationOutcome 與 parseValuationError', () => {
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
  it('parseValuationError:VQ 代碼保留、details JSON 解成 detail;非 JSON 或非 VQ 不炸', () => {
    expect(parseValuationError({ code: 'VQ006', message: 'm', details: '{"cap":1}' })).toMatchObject({ code: 'VQ006', detail: { cap: 1 } })
    expect(parseValuationError({ code: 'P0001', message: '估驗已核定', details: 'not json' })).toMatchObject({ code: 'P0001', detail: null })
    expect(parseValuationError(null)).toBeNull()
  })
})

describe('5. 其他寫入與唯讀', () => {
  it('計價截止日:草稿期 update 後重載;RLS 靜默 0 列視為失敗', async () => {
    const r = mount()
    await act(async () => { r.current.setValuations([draft]) })
    let res
    await act(async () => { res = await r.current.setValuationPeriodEnd('v1', '2026-10-31') })
    expect(res.error).toBeNull()
    expect(pg.argsOf('valuations', 'update')[0][0]).toEqual({ period_end: '2026-10-31' })
    pg.script('valuations', 'update', { data: [], error: null })
    await act(async () => { res = await r.current.setValuationPeriodEnd('v1', '2026-11-30') })
    expect(res.error.message).toContain('未更新')
  })

  it('同步確認量:RPC 結果原樣回傳並重載;demo 明說沒有確認資料', async () => {
    pg.script('rpc:sync_valuation_from_confirmations', 'rpc', { data: { items: [{ added: 60 }], adjustments_applied: 0 }, error: null })
    const r = mount()
    let res
    await act(async () => { res = await r.current.syncValuation('v1') })
    expect(res.error).toBeNull()
    expect(res.result.items[0].added).toBe(60)
    expect(loadValuationsFromDB).toHaveBeenCalled()
    const d = mount(ctx({ dbMode: false }))
    await act(async () => { res = await d.current.syncValuation('v1') })
    expect(res.error.message).toContain('示範模式')
  })

  it('計價依據:走 set_work_item_pricing_basis(work_item uuid)後重載', async () => {
    const r = mount()
    let res
    await act(async () => { res = await r.current.setPricingBasis('A1', 'supervisor_certificate') })
    expect(res.error).toBeNull()
    expect(pg.argsOf('rpc:set_work_item_pricing_basis', 'rpc')[0][0]).toEqual({ p_work_item_id: 'wi-1', p_basis: 'supervisor_certificate', p_rule: null })
  })

  it('唯讀:期別狀態與可估驗清單走 RPC;demo 回 null／空', async () => {
    pg.script('rpc:get_valuation_state', 'rpc', { data: { valuation: { id: 'v1' }, violations: [], items: [] }, error: null })
    pg.script('rpc:list_billable_backlog', 'rpc', { data: [{ work_item_id: 'wi-1', available: 60 }], error: null })
    const r = mount()
    let st, bl
    await act(async () => { st = await r.current.fetchValuationState('v1'); bl = await r.current.fetchBillableBacklog() })
    expect(st.state.valuation.id).toBe('v1')
    expect(bl.rows[0].available).toBe(60)
    expect(pg.argsOf('rpc:list_billable_backlog', 'rpc')[0][0]).toEqual({ p_project_id: 'p1' })
    const d = mount(ctx({ dbMode: false }))
    await act(async () => { st = await d.current.fetchValuationState('v1'); bl = await d.current.fetchBillableBacklog() })
    expect(st.state).toBeNull()
    expect(bl.rows).toEqual([])
  })
})
