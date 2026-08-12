// Ledger slice:廠商帳務與契約——成本管理(預算vs實際/分包)、變更設計(表頭+追加減明細)、
// 逐工項排程、核准期限的義務 runtime。
import { useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase.js'
import { loadObligationsFromDB } from '../db.js'
import { ingestRequirementDocument as runRequirementIngestion } from '../../lib/documentIngestion.js'
import { mutationOutcome } from './billing.js'

export function useLedgerSlice({ dbMode, isPersistedProject, currentProject, currentUser, wiMaps, log }) {
  // 成本項目（真 DB；預算 vs 實際、分包）
  const [costItems, setCostItems] = useState([])
  // 變更設計 / 追加減帳（真 DB；每筆含 items 明細）
  const [changeOrders, setChangeOrders] = useState([])
  // 逐工項排程（真 DB；{ item_key: { planned_start, planned_finish } }）
  const [itemSchedules, setItemSchedules] = useState({})
  // 契約義務清單（真 DB；核准 deadline Requirement 後由 DB 建立）
  const [obligations, setObligations] = useState([])
  // 驗收/結算事件（真 DB；一階段一筆,法定期限由 lib/acceptance.js 推算）
  const [acceptanceEvents, setAcceptanceEvents] = useState([])

  // 成本管理：新增 / 更新 / 刪除成本項目（預算 vs 實際、分包；demo 只進記憶體）
  const createCostItem = useCallback(async (input) => {
    const row = {
      category: input.category || '其他', title: input.title,
      vendor: input.vendor || null,
      budget_amount: Number(input.budget_amount) || 0,
      actual_amount: Number(input.actual_amount) || 0,
      status: input.status || '進行中', note: input.note || null,
      sort_order: costItems.length,
    }
    if (!dbMode) {
      setCostItems((cs) => [...cs, { ...row, id: `COST-${Date.now()}` }])
      return { error: null }
    }
    const { data, error } = await supabase.from('cost_items')
      .insert({ ...row, project_id: currentProject.project_id }).select().single()
    if (error) return { error }
    setCostItems((cs) => [...cs, data])
    log('新增成本項目', `${row.category}·${row.title}`, { user: currentUser?.name || '系統', role: '工程' })
    return { error: null }
  }, [dbMode, currentProject, costItems, currentUser, log])

  // DB 成功才更新 UI(B-07:RLS 靜默 0 列時原本假成功,重整即還原)
  const updateCostItem = useCallback(async (id, patch) => {
    if (dbMode) {
      const res = await supabase.from('cost_items').update(patch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '未寫入:可能無權限或成本項目已被移除')
      if (error) return { error }
    }
    setCostItems((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    return { error: null }
  }, [dbMode])

  const deleteCostItem = useCallback(async (id) => {
    if (dbMode) {
      const res = await supabase.from('cost_items').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:可能無權限或成本項目已被移除')
      if (error) return { error }
    }
    setCostItems((cs) => cs.filter((c) => c.id !== id))
    return { error: null }
  }, [dbMode])

  // 逐工項排程:設定某工項的計畫起迄。
  // R4 P1-01(前兩次都沒真正修好):起訖是兩個獨立 date input,同一 tick 連發時
  // onChange 閉包都抓到同一次 render 的舊值 → 各送過期欄位、兩個 upsert 互相 race
  // 蓋成 null。真解:ref 同步累積最新起訖(不靠 render 閉包、不靠 DB 讀),每工項
  // debounce 合併成「單次」寫入完整整列——同 tick 連發也只落一次正確的 {起,訖}。
  const schedRef = useRef({})        // { itemKey: { planned_start, planned_finish } } 永遠最新
  const schedTimers = useRef({})     // 每工項的 debounce timer
  const setItemSchedule = useCallback((itemKey, patch) => {
    // 合併基底:schedRef 優先(含同 tick 前一次編輯),否則用載入的 itemSchedules
    // (編輯既有排程時 ref 尚無此 key,不可讓另一欄被丟成 null)
    const base = schedRef.current[itemKey] || itemSchedules[itemKey] || {}
    const merged = { ...base, ...patch }
    schedRef.current = { ...schedRef.current, [itemKey]: merged } // 同步更新,後續同 tick 呼叫看得到
    setItemSchedules((m) => ({ ...m, [itemKey]: { ...(m[itemKey] || {}), ...merged } })) // 立即回饋 UI
    if (!dbMode) return Promise.resolve({ error: null })
    const wi = wiMaps.byKey.get(itemKey)
    if (!wi?.id) return Promise.resolve({ error: { message: '找不到工項' } })
    return new Promise((resolve) => {
      clearTimeout(schedTimers.current[itemKey])
      schedTimers.current[itemKey] = setTimeout(async () => {
        const cur = schedRef.current[itemKey] || {}
        const row = { project_id: currentProject.project_id, work_item_id: wi.id,
          planned_start: cur.planned_start || null, planned_finish: cur.planned_finish || null }
        const res = await supabase.from('item_schedules').upsert(row, { onConflict: 'work_item_id' }).select('planned_start, planned_finish')
        resolve(mutationOutcome(res, '排程未寫入:可能無權限'))
      }, 350)
    })
  }, [dbMode, currentProject, wiMaps, itemSchedules])

  const removeItemSchedule = useCallback(async (itemKey) => {
    clearTimeout(schedTimers.current[itemKey])
    { const n = { ...schedRef.current }; delete n[itemKey]; schedRef.current = n } // 清 ref,重加不繼承舊值
    setItemSchedules((m) => { const n = { ...m }; delete n[itemKey]; return n })
    if (!dbMode) return { error: null }
    const wi = wiMaps.byKey.get(itemKey)
    if (wi?.id) await supabase.from('item_schedules').delete().eq('work_item_id', wi.id)
    return { error: null }
  }, [dbMode, wiMaps])

  // 變更設計：表頭 CRUD（demo 只進記憶體）------------------------------------
  const createChangeOrder = useCallback(async (input) => {
    const row = {
      co_no: input.co_no || null, title: input.title,
      co_date: input.co_date || null, status: input.status || '提出',
      reason: input.reason || null, sort_order: changeOrders.length,
    }
    if (!dbMode) {
      setChangeOrders((cs) => [...cs, { ...row, id: `CO-${Date.now()}`, items: [] }])
      return { error: null }
    }
    const { data, error } = await supabase.from('change_orders')
      .insert({ ...row, project_id: currentProject.project_id, created_by: currentUser?.user_id }).select().single()
    if (error) return { error }
    setChangeOrders((cs) => [...cs, { ...data, items: [] }])
    log('新增變更設計', `${row.co_no || ''} ${row.title}`, { user: currentUser?.name || '系統', role: '工程' })
    return { error: null }
  }, [dbMode, currentProject, changeOrders, currentUser, log])

  // 表頭/狀態:DB 成功才更新 UI(核准=契約級動作,不可假成功)
  const updateChangeOrder = useCallback(async (id, patch) => {
    if (dbMode) {
      const res = await supabase.from('change_orders').update(patch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '未寫入:可能無權限或這筆變更已被移除')
      if (error) return { error }
    }
    setChangeOrders((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    return { error: null }
  }, [dbMode])

  // DB 刪成功才從 UI 移除(B-07:已核准變更被 guard 擋下時不可假消失)
  const deleteChangeOrder = useCallback(async (id) => {
    if (dbMode) {
      const res = await supabase.from('change_orders').delete().eq('id', id).select('id') // 明細 cascade
      const { error } = mutationOutcome(res, '刪除被拒絕:已核准的變更不可刪除,或無權限')
      if (error) return { error }
    }
    setChangeOrders((cs) => cs.filter((c) => c.id !== id))
    return { error: null }
  }, [dbMode])

  // 變更設計：追加減工項明細 CRUD --------------------------------------------
  const addChangeOrderItem = useCallback(async (coId, input) => {
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const qty = Number(input.qty_delta) || 0
    const price = Number(input.unit_price) || 0
    const row = {
      item_no: input.item_no || wi?.item_no || null,
      description: input.description || wi?.description || '',
      unit: input.unit || wi?.unit || null,
      qty_delta: qty, unit_price: price, amount_delta: qty * price,
      note: input.note || null,
    }
    if (!dbMode) {
      setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: [...c.items, { ...row, id: `COI-${Date.now()}` }] } : c)))
      return { error: null }
    }
    const { data, error } = await supabase.from('change_order_items')
      .insert({ ...row, change_order_id: coId, project_id: currentProject.project_id, work_item_id: wi?.id || null }).select().single()
    if (error) return { error }
    setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: [...c.items, data] } : c)))
    return { error: null }
  }, [dbMode, currentProject, wiMaps])

  // 批次新增明細（變更預算書 diff 套用用）：demo 一次進記憶體、DB 單次 insert 多列
  const addChangeOrderItems = useCallback(async (coId, inputs) => {
    const rows = inputs.map((input) => {
      const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
      const qty = Number(input.qty_delta) || 0
      const price = Number(input.unit_price) || 0
      return {
        item_no: input.item_no || wi?.item_no || null,
        description: input.description || wi?.description || '',
        unit: input.unit || wi?.unit || null,
        qty_delta: qty, unit_price: price, amount_delta: qty * price,
        note: input.note || null,
        _work_item_id: wi?.id || null,
      }
    })
    if (!dbMode) {
      const stamp = Date.now()
      const local = rows.map(({ _work_item_id, ...r }, i) => ({ ...r, id: `COI-${stamp}-${i}` }))
      setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: [...c.items, ...local] } : c)))
      return { error: null }
    }
    const { data, error } = await supabase.from('change_order_items')
      .insert(rows.map(({ _work_item_id, ...r }) => ({
        ...r, change_order_id: coId, project_id: currentProject.project_id, work_item_id: _work_item_id,
      }))).select()
    if (error) return { error }
    setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: [...c.items, ...data] } : c)))
    return { error: null }
  }, [dbMode, currentProject, wiMaps])

  // 明細:DB 成功才更新 UI(第二輪 P0-02:樂觀更新被 guard 拒絕後不回滾,
  // 畫面即時算出假的變更後契約金額,重整才復原)。
  const updateChangeOrderItem = useCallback(async (coId, id, patch) => {
    const cur = changeOrders.find((c) => c.id === coId)?.items.find((it) => it.id === id)
    if (!cur) return { error: { message: '找不到這筆明細' } }
    // qty_delta / unit_price 變動時同步重算 amount_delta
    const merged = { ...cur, ...patch }
    if ('qty_delta' in patch || 'unit_price' in patch) {
      merged.amount_delta = (Number(merged.qty_delta) || 0) * (Number(merged.unit_price) || 0)
    }
    if (dbMode) {
      const dbPatch = { ...patch }
      if ('qty_delta' in patch || 'unit_price' in patch) dbPatch.amount_delta = merged.amount_delta
      const res = await supabase.from('change_order_items').update(dbPatch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '明細未寫入:已核准的變更不可修改,或無權限')
      if (error) return { error }
    }
    setChangeOrders((cs) => cs.map((c) => (c.id === coId
      ? { ...c, items: c.items.map((it) => (it.id === id ? merged : it)) }
      : c)))
    return { error: null }
  }, [dbMode, changeOrders])

  const deleteChangeOrderItem = useCallback(async (coId, id) => {
    if (dbMode) {
      const res = await supabase.from('change_order_items').delete().eq('id', id).select('id')
      const { error } = mutationOutcome(res, '明細未刪除:已核准的變更不可修改,或無權限')
      if (error) return { error }
    }
    setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: c.items.filter((it) => it.id !== id) } : c)))
    return { error: null }
  }, [dbMode])

  // 契約義務:重載 / 改狀態(契約領域不依賴標單 → isPersistedProject)──────────
  const reloadObligations = useCallback(async () => {
    if (!isPersistedProject) return
    // 寫入後重載:失敗保留現況,不把成功的解析偽裝成錯誤(B-09 載入層會 throw)
    try { setObligations(await loadObligationsFromDB(currentProject.project_id)) } catch { /* 保留現況 */ }
  }, [isPersistedProject, currentProject])

  // P0-06:上傳契約/規範 → 正式文件版本+逐頁保存 → extract-requirements Edge Function
  // 產生「AI 履約需求建議」(draft_ai/needs_review,待人工審查)。核准的 deadline
  // 由 DB 審查交易建立義務 runtime。契約文件不依賴標單 → 用 isPersistedProject。
  const ingestRequirementDocument = useCallback(async (file, documentType = 'contract') => {
    if (!isPersistedProject) return { error: { message: '需真實專案(demo 模式不支援 AI 需求擷取)' } }
    return runRequirementIngestion({
      projectId: currentProject.project_id,
      userId: currentUser?.user_id || null,
      file,
      documentType,
    })
  }, [isPersistedProject, currentProject, currentUser])

  // DB 成功才更新 UI(B-07)。extra 可帶附加欄位:
  // W-01 佐證鏈——標為已提送時掛 evidence_submittal_id(送審文件);退回待辦時清空。
  const updateObligationStatus = useCallback(async (id, status, extra = {}) => {
    const patch = { status, ...extra }
    if (isPersistedProject) {
      const res = await supabase.from('contract_obligations').update(patch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '未寫入:可能無權限或義務已被移除')
      if (error) return { error }
    }
    setObligations((os) => os.map((o) => (o.id === id ? { ...o, ...patch } : o)))
    return { error: null }
  }, [isPersistedProject])

  // 驗收:登錄/更新某階段(同階段一筆,重複登錄=修正)。
  // 用 isPersistedProject 而非 dbMode:驗收不依賴標單,沒 BOQ 的真專案也必須寫 DB
  // (否則假成功,重新整理就消失)。
  const recordAcceptanceEvent = useCallback(async (stage_key, { event_date, result, note }) => {
    const existing = acceptanceEvents.filter((e) => e.stage_key === stage_key).pop()
    const patch = { event_date: event_date || null, result: result || null, note: note || null }
    if (!isPersistedProject) {
      if (existing) setAcceptanceEvents((es) => es.map((e) => (e.id === existing.id ? { ...e, ...patch } : e)))
      else setAcceptanceEvents((es) => [...es, { id: `ACC-${Date.now()}`, stage_key, ...patch }])
      return { error: null }
    }
    if (existing) {
      const { error } = await supabase.from('acceptance_events').update(patch).eq('id', existing.id)
      if (!error) setAcceptanceEvents((es) => es.map((e) => (e.id === existing.id ? { ...e, ...patch } : e)))
      return { error }
    }
    const { data, error } = await supabase.from('acceptance_events')
      .insert({ ...patch, stage_key, project_id: currentProject.project_id, created_by: currentUser?.user_id })
      .select().single()
    if (error) return { error }
    setAcceptanceEvents((es) => [...es, data])
    log('驗收階段登錄', `${stage_key} ${event_date || ''}`, { user: currentUser?.name || '系統', role: '機關' })
    return { error: null }
  }, [isPersistedProject, acceptanceEvents, currentProject, currentUser, log])

  // 驗收:撤銷某階段的登錄(登錯日期重來)。
  // DB 刪成功才從 UI 移除;guard 拒絕(他方事件/角色不符)或 RLS 靜默 0-row 都如實回報。
  const clearAcceptanceEvent = useCallback(async (stage_key) => {
    const targets = acceptanceEvents.filter((e) => e.stage_key === stage_key)
    if (isPersistedProject) {
      const deleted = []
      for (const t of targets) {
        const { data, error } = await supabase.from('acceptance_events')
          .delete().eq('id', t.id).select('id')
        if (error || !data?.length) {
          // 已刪成功的先反映到 UI,再回報失敗原因
          if (deleted.length) setAcceptanceEvents((es) => es.filter((e) => !deleted.includes(e.id)))
          return { error: error || { message: '撤銷被拒絕:可能無權限或非本方登錄' } }
        }
        deleted.push(t.id)
      }
    }
    setAcceptanceEvents((es) => es.filter((e) => e.stage_key !== stage_key))
    return { error: null }
  }, [isPersistedProject, acceptanceEvents])

  return {
    costItems, setCostItems, changeOrders, setChangeOrders,
    itemSchedules, setItemSchedules, obligations, setObligations,
    acceptanceEvents, setAcceptanceEvents, recordAcceptanceEvent, clearAcceptanceEvent,
    createCostItem, updateCostItem, deleteCostItem,
    setItemSchedule, removeItemSchedule,
    createChangeOrder, updateChangeOrder, deleteChangeOrder,
    addChangeOrderItem, addChangeOrderItems, updateChangeOrderItem, deleteChangeOrderItem,
    reloadObligations, updateObligationStatus, ingestRequirementDocument,
  }
}
