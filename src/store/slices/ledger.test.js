// @vitest-environment jsdom
// Ledger slice(成本、變更設計、逐工項排程、契約義務、驗收)整支在做同一件會咬人的事:
// 「DB 說了才算」。零測試的情況下,只要有人把 mutationOutcome 拿掉或把 setState 提前
// 一行,畫面就會回到「假成功」——重新整理才發現沒寫進去。這裡釘住四類迴歸:
//   1. B-07 假成功:RLS 靜默擋下(無 error 但 0 列)時快取不得被改;
//   2. P0-02 樂觀更新:變更明細被 guard 拒絕後,不得先算出假的變更後契約金額;
//   3. R4 P1-01 排程 race:起訖兩個 input 同 tick 連發,只能落一次完整的 {起,訖};
//   4. 驗收撤銷多列中途失敗:已刪的要反映到 UI,再如實回報失敗。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { renderHook } from '../../testUtils/renderHook.js'
import { SILENT_ZERO_ROWS } from '../../testUtils/scriptedSupabase.js'
import { configured } from '../../testUtils/supabaseMock.js'

// vi.mock 的 factory 會在目標模組首次載入時才執行,那時 import 已初始化;但這裡需要
// 的假 client 本身要在 vi.mock 之前就存在 → 用 async vi.hoisted 建立。
const { pg } = await vi.hoisted(async () => {
  const { createScriptedSupabase } = await import('../../testUtils/scriptedSupabase.js')
  return { pg: createScriptedSupabase() }
})
vi.mock('../../lib/supabase.js', () => configured(pg.client))
vi.mock('../db.js', () => ({ loadObligationsFromDB: vi.fn(async () => []) }))
vi.mock('../../lib/documentIngestion.js', () => ({ ingestRequirementDocument: vi.fn(async () => ({ error: null, run: { id: 'r1' } })) }))

import { useLedgerSlice } from './ledger.js'
import { ingestRequirementDocument as runIngestion } from '../../lib/documentIngestion.js'

const WI = { id: 'wi-1', item_key: 'A1', item_no: '1', description: '假設工程', unit: '式' }
const ctx = (over = {}) => ({
  dbMode: true, isPersistedProject: true,
  currentProject: { project_id: 'p1' },
  currentUser: { user_id: 'u1', name: '測試員' },
  wiMaps: { byKey: new Map([['A1', WI]]), idToKey: new Map(), byId: new Map() },
  log: vi.fn(),
  ...over,
})
const demoCtx = (over = {}) => ctx({ dbMode: false, isPersistedProject: false, currentProject: null, ...over })
const mount = (c = ctx()) => renderHook(() => useLedgerSlice(c))

beforeEach(() => { pg.reset(); runIngestion.mockClear() })

describe('成本項目:寫入失敗不得動快取', () => {
  it('demo:只進記憶體、不打 DB,欄位帶預設值與 sort_order', async () => {
    const r = mount(demoCtx())
    await act(async () => { await r.current.createCostItem({ title: '假設工程', budget_amount: '1000' }) })
    expect(pg.calls).toHaveLength(0)
    expect(r.current.costItems[0]).toMatchObject({ title: '假設工程', category: '其他', budget_amount: 1000, actual_amount: 0, sort_order: 0 })
  })

  it('DB insert 失敗 → 回 error、快取空的、不留痕', async () => {
    const c = ctx()
    const r = mount(c)
    pg.script('cost_items', 'insert', { data: null, error: { message: 'new row violates row-level security policy' } })
    let res
    await act(async () => { res = await r.current.createCostItem({ title: '假設工程' }) })
    expect(res.error.message).toContain('row-level security')
    expect(r.current.costItems).toHaveLength(0)
    expect(c.log).not.toHaveBeenCalled()
  })

  it('update 被 RLS 靜默擋下(0 列)→ 回失敗訊息,快取值不變(B-07)', async () => {
    const r = mount()
    await act(async () => { r.current.setCostItems([{ id: 'c1', title: '假設工程', actual_amount: 0 }]) })
    pg.script('cost_items', 'update', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.updateCostItem('c1', { actual_amount: 999 }) })
    expect(res.error.message).toContain('未寫入')
    expect(r.current.costItems[0].actual_amount).toBe(0)
  })

  it('delete 被擋 → 項目仍在清單上(不可假消失)', async () => {
    const r = mount()
    await act(async () => { r.current.setCostItems([{ id: 'c1', title: '假設工程' }]) })
    pg.script('cost_items', 'delete', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.deleteCostItem('c1') })
    expect(res.error.message).toContain('刪除被拒絕')
    expect(r.current.costItems).toHaveLength(1)
  })
})

describe('變更設計:已核准的變更被 guard 擋下時不可假成功', () => {
  const co = { id: 'co1', title: '追加擋土支撐', status: '提出', items: [{ id: 'i1', qty_delta: 10, unit_price: 100, amount_delta: 1000 }] }

  it('刪除被 guard 拒絕 → 變更仍在清單上', async () => {
    const r = mount()
    await act(async () => { r.current.setChangeOrders([co]) })
    pg.script('change_orders', 'delete', { data: null, error: { message: '已核准的變更不可刪除' } })
    let res
    await act(async () => { res = await r.current.deleteChangeOrder('co1') })
    expect(res.error.message).toContain('已核准')
    expect(r.current.changeOrders).toHaveLength(1)
  })

  it('改明細數量 → amount_delta 前後端一致重算(金額不得只在畫面上算)', async () => {
    const r = mount()
    await act(async () => { r.current.setChangeOrders([co]) })
    await act(async () => { await r.current.updateChangeOrderItem('co1', 'i1', { qty_delta: 25 }) })
    expect(pg.argsOf('change_order_items', 'update')[0][0]).toEqual({ qty_delta: 25, amount_delta: 2500 })
    expect(r.current.changeOrders[0].items[0]).toMatchObject({ qty_delta: 25, amount_delta: 2500 })
  })

  it('明細寫入被拒 → 快取一個欄位都不能動(P0-02:畫面不得出現假的變更後契約金額)', async () => {
    const r = mount()
    await act(async () => { r.current.setChangeOrders([co]) })
    pg.script('change_order_items', 'update', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.updateChangeOrderItem('co1', 'i1', { qty_delta: 25 }) })
    expect(res.error.message).toContain('已核准的變更不可修改')
    expect(r.current.changeOrders[0].items[0]).toEqual(co.items[0])
  })

  it('找不到明細 → 直接回錯誤,不送出任何 DB 呼叫', async () => {
    const r = mount()
    await act(async () => { r.current.setChangeOrders([co]) })
    let res
    await act(async () => { res = await r.current.updateChangeOrderItem('co1', '不存在', { qty_delta: 1 }) })
    expect(res.error.message).toBe('找不到這筆明細')
    expect(pg.calls).toHaveLength(0)
  })

  it('批次帶入明細:單次 insert、逐列算金額、work_item_key 換成 uuid,內部欄位不外洩', async () => {
    const r = mount()
    await act(async () => { r.current.setChangeOrders([{ ...co, items: [] }]) })
    pg.script('change_order_items', 'insert', { data: [{ id: 'n1' }, { id: 'n2' }], error: null })
    await act(async () => {
      await r.current.addChangeOrderItems('co1', [
        { work_item_key: 'A1', qty_delta: '3', unit_price: '500' },
        { description: '新增項目', qty_delta: 2, unit_price: 250 },
      ])
    })
    expect(pg.countOf('change_order_items', 'insert')).toBe(1)
    const rows = pg.argsOf('change_order_items', 'insert')[0][0]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ work_item_id: 'wi-1', description: '假設工程', amount_delta: 1500, project_id: 'p1' })
    expect(rows[1]).toMatchObject({ work_item_id: null, description: '新增項目', amount_delta: 500 })
    expect(rows[0]._work_item_id).toBeUndefined()
    expect(r.current.changeOrders[0].items).toHaveLength(2)
  })

  it('demo 批次:本地列不得殘留 _work_item_id 這種內部欄位', async () => {
    const r = mount(demoCtx())
    await act(async () => { r.current.setChangeOrders([{ ...co, items: [] }]) })
    await act(async () => { await r.current.addChangeOrderItems('co1', [{ work_item_key: 'A1', qty_delta: 2, unit_price: 100 }]) })
    expect(pg.calls).toHaveLength(0)
    expect(r.current.changeOrders[0].items[0]).not.toHaveProperty('_work_item_id')
    expect(r.current.changeOrders[0].items[0].amount_delta).toBe(200)
  })
})

describe('逐工項排程:同 tick 連發只能落一次完整起訖(R4 P1-01 修過三次)', () => {
  // 不用假時鐘:vi.useFakeTimers 會一併換掉 React act() 依賴的排程,hook 會卡在
  // 未 render。debounce 只有 350ms,直接等真實時間更穩,也順便測到真的 clearTimeout。
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  it('起、訖在同一 render 閉包內各發一次 → 單次 upsert,兩欄都在(不得互相蓋成 null)', async () => {
    const r = mount()
    let p2
    act(() => {
      r.current.setItemSchedule('A1', { planned_start: '2026-09-01' }) // 先發的被 debounce 併掉
      p2 = r.current.setItemSchedule('A1', { planned_finish: '2026-09-30' })
    })
    await act(async () => { await p2 })
    expect(pg.countOf('item_schedules', 'upsert')).toBe(1)
    expect(pg.argsOf('item_schedules', 'upsert')[0][0]).toEqual({
      project_id: 'p1', work_item_id: 'wi-1', planned_start: '2026-09-01', planned_finish: '2026-09-30',
    })
  })

  it('兩欄立即回饋到畫面(寫入還沒落地前使用者就要看得到)', async () => {
    const r = mount()
    let p
    act(() => {
      r.current.setItemSchedule('A1', { planned_start: '2026-09-01' })
      p = r.current.setItemSchedule('A1', { planned_finish: '2026-09-30' })
    })
    expect(r.current.itemSchedules.A1).toEqual({ planned_start: '2026-09-01', planned_finish: '2026-09-30' })
    await act(async () => { await p })
  })

  it('編輯既有排程時只改一欄 → 另一欄沿用已載入的值,不得被清成 null', async () => {
    const r = mount()
    await act(async () => { r.current.setItemSchedules({ A1: { planned_start: '2026-08-01', planned_finish: '2026-08-31' } }) })
    let p
    act(() => { p = r.current.setItemSchedule('A1', { planned_finish: '2026-09-15' }) })
    await act(async () => { await p })
    expect(pg.argsOf('item_schedules', 'upsert')[0][0]).toMatchObject({ planned_start: '2026-08-01', planned_finish: '2026-09-15' })
  })

  it('工項不在標單裡 → 立刻回錯誤,不排任何寫入', async () => {
    const r = mount()
    let res
    await act(async () => { res = await r.current.setItemSchedule('不存在', { planned_start: '2026-09-01' }) })
    expect(res.error.message).toBe('找不到工項')
    expect(pg.hit('item_schedules', 'upsert')).toBe(false)
  })

  it('在 debounce 期間移除排程 → 取消在途寫入,只留 delete', async () => {
    const r = mount()
    act(() => { r.current.setItemSchedule('A1', { planned_start: '2026-09-01' }) })
    await act(async () => { await r.current.removeItemSchedule('A1') })
    await act(async () => { await sleep(450) })
    expect(pg.hit('item_schedules', 'upsert')).toBe(false)
    expect(pg.hit('item_schedules', 'delete')).toBe(true)
    expect(r.current.itemSchedules.A1).toBeUndefined()
  })

  it('移除後重加 → ref 已清空,不得繼承舊的起訖', async () => {
    const r = mount()
    act(() => { r.current.setItemSchedule('A1', { planned_start: '2026-09-01', planned_finish: '2026-09-30' }) })
    await act(async () => { await r.current.removeItemSchedule('A1') })
    let p
    act(() => { p = r.current.setItemSchedule('A1', { planned_start: '2026-10-01' }) })
    await act(async () => { await p })
    expect(pg.argsOf('item_schedules', 'upsert')[0][0]).toMatchObject({ planned_start: '2026-10-01', planned_finish: null })
  })

  it('demo 模式:只進記憶體,不排任何寫入', async () => {
    const r = mount(demoCtx())
    await act(async () => { await r.current.setItemSchedule('A1', { planned_start: '2026-09-01' }) })
    expect(pg.calls).toHaveLength(0)
    expect(r.current.itemSchedules.A1).toEqual({ planned_start: '2026-09-01' })
  })
})

describe('契約義務:狀態以伺服器為準,demo 鏡像同一條 trigger 語意', () => {
  const ob = { id: 'ob1', title: '開工後 7 日內提送施工計畫', status: '待辦', completed_at: null }

  it('真專案:用伺服器回傳的整列刷新(completed_at 由 DB trigger 蓋,不能自己編)', async () => {
    const r = mount()
    await act(async () => { r.current.setObligations([ob]) })
    pg.script('contract_obligations', 'update', { data: [{ ...ob, status: '已提送', completed_at: '2026-09-11T00:00:00Z' }], error: null })
    await act(async () => { await r.current.updateObligationStatus('ob1', '已提送', { evidence_submittal_id: 's1' }) })
    expect(pg.argsOf('contract_obligations', 'update')[0][0]).toEqual({ status: '已提送', evidence_submittal_id: 's1' })
    expect(r.current.obligations[0].completed_at).toBe('2026-09-11T00:00:00Z')
  })

  it('靜默 0 列 → 回失敗,狀態不得先變成已提送', async () => {
    const r = mount()
    await act(async () => { r.current.setObligations([ob]) })
    pg.script('contract_obligations', 'update', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.updateObligationStatus('ob1', '已提送') })
    expect(res.error.message).toContain('未寫入')
    expect(r.current.obligations[0].status).toBe('待辦')
  })

  it('demo:標為已提送蓋 completed_at、退回待辦清空(與 DB trigger 同語意)', async () => {
    const r = mount(demoCtx())
    await act(async () => { r.current.setObligations([ob]) })
    await act(async () => { await r.current.updateObligationStatus('ob1', '已提送') })
    expect(r.current.obligations[0].completed_at).toBeTruthy()
    await act(async () => { await r.current.updateObligationStatus('ob1', '待辦') })
    expect(r.current.obligations[0].completed_at).toBeNull()
    expect(pg.calls).toHaveLength(0)
  })

  it('AI 需求擷取在 demo 模式被擋下,不呼叫上傳編排', async () => {
    const r = mount(demoCtx())
    let res
    await act(async () => { res = await r.current.ingestRequirementDocument({ name: 'x.pdf' }) })
    expect(res.error.message).toContain('demo')
    expect(runIngestion).not.toHaveBeenCalled()
  })
})

describe('驗收登錄:同階段一筆;撤銷多列時中途失敗要如實回報', () => {
  it('同階段已登錄 → 走 update 修正,不得再 insert 一筆', async () => {
    const r = mount()
    await act(async () => { r.current.setAcceptanceEvents([{ id: 'a1', stage_key: 'initial', event_date: '2026-09-01' }]) })
    await act(async () => { await r.current.recordAcceptanceEvent('initial', { event_date: '2026-09-05', result: '合格' }) })
    expect(pg.hit('acceptance_events', 'insert')).toBe(false)
    expect(pg.hit('acceptance_events', 'update')).toBe(true)
    expect(r.current.acceptanceEvents).toHaveLength(1)
    expect(r.current.acceptanceEvents[0].event_date).toBe('2026-09-05')
  })

  it('撤銷第二列被拒 → 已刪的第一列從 UI 移除,回報錯誤,未刪的保留', async () => {
    const r = mount()
    await act(async () => {
      r.current.setAcceptanceEvents([
        { id: 'a1', stage_key: 'initial' }, { id: 'a2', stage_key: 'initial' }, { id: 'b1', stage_key: 'final' },
      ])
    })
    let n = 0
    pg.script('acceptance_events', 'delete', () => (++n === 1 ? { data: [{ id: 'a1' }], error: null } : SILENT_ZERO_ROWS))
    let res
    await act(async () => { res = await r.current.clearAcceptanceEvent('initial') })
    expect(res.error.message).toContain('撤銷被拒絕')
    expect(r.current.acceptanceEvents.map((e) => e.id)).toEqual(['a2', 'b1'])
  })

  it('全部刪成功 → 該階段清空,其他階段不受影響', async () => {
    const r = mount()
    await act(async () => {
      r.current.setAcceptanceEvents([{ id: 'a1', stage_key: 'initial' }, { id: 'b1', stage_key: 'final' }])
    })
    let res
    await act(async () => { res = await r.current.clearAcceptanceEvent('initial') })
    expect(res.error).toBeNull()
    expect(r.current.acceptanceEvents.map((e) => e.id)).toEqual(['b1'])
  })
})
