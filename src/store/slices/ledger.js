// Ledger slice:廠商帳務與契約——成本管理(預算vs實際/分包)、變更設計(表頭+追加減明細)、
// 逐工項排程、契約義務(AI 解析)。
import { useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase.js'
import { loadObligationsFromDB, extractContractText, fileToBase64 } from '../db.js'
import { ingestRequirementDocument as runRequirementIngestion } from '../../lib/documentIngestion.js'

export function useLedgerSlice({ dbMode, isPersistedProject, currentProject, currentUser, wiMaps, log }) {
  // 成本項目（真 DB；預算 vs 實際、分包）
  const [costItems, setCostItems] = useState([])
  // 變更設計 / 追加減帳（真 DB；每筆含 items 明細）
  const [changeOrders, setChangeOrders] = useState([])
  // 逐工項排程（真 DB；{ item_key: { planned_start, planned_finish } }）
  const [itemSchedules, setItemSchedules] = useState({})
  // 契約義務清單（真 DB；AI 解析契約後填入）
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

  const updateCostItem = useCallback(async (id, patch) => {
    setCostItems((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    if (!dbMode) return { error: null }
    const { error } = await supabase.from('cost_items').update(patch).eq('id', id)
    return { error }
  }, [dbMode])

  const deleteCostItem = useCallback(async (id) => {
    setCostItems((cs) => cs.filter((c) => c.id !== id))
    if (dbMode) await supabase.from('cost_items').delete().eq('id', id)
    return { error: null }
  }, [dbMode])

  // 逐工項排程：設定某工項的計畫起迄（upsert by work_item_id；demo 只進記憶體）
  const setItemSchedule = useCallback(async (itemKey, patch) => {
    if (!dbMode) {
      setItemSchedules((m) => ({ ...m, [itemKey]: { ...(m[itemKey] || {}), ...patch } }))
      return { error: null }
    }
    const wi = wiMaps.byKey.get(itemKey)
    if (!wi?.id) return { error: { message: '找不到工項' } }
    setItemSchedules((m) => ({ ...m, [itemKey]: { ...(m[itemKey] || {}), ...patch } }))
    const cur = itemSchedules[itemKey] || {}
    const { error } = await supabase.from('item_schedules').upsert({
      project_id: currentProject.project_id, work_item_id: wi.id,
      planned_start: patch.planned_start !== undefined ? (patch.planned_start || null) : (cur.planned_start || null),
      planned_finish: patch.planned_finish !== undefined ? (patch.planned_finish || null) : (cur.planned_finish || null),
    }, { onConflict: 'work_item_id' })
    return { error }
  }, [dbMode, currentProject, wiMaps, itemSchedules])

  const removeItemSchedule = useCallback(async (itemKey) => {
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

  const updateChangeOrder = useCallback(async (id, patch) => {
    setChangeOrders((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    if (!dbMode) return { error: null }
    const { error } = await supabase.from('change_orders').update(patch).eq('id', id)
    return { error }
  }, [dbMode])

  const deleteChangeOrder = useCallback(async (id) => {
    setChangeOrders((cs) => cs.filter((c) => c.id !== id))
    if (dbMode) await supabase.from('change_orders').delete().eq('id', id) // 明細 cascade
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

  const updateChangeOrderItem = useCallback(async (coId, id, patch) => {
    // qty_delta / unit_price 變動時同步重算 amount_delta
    const recompute = (it) => {
      const merged = { ...it, ...patch }
      if ('qty_delta' in patch || 'unit_price' in patch) {
        merged.amount_delta = (Number(merged.qty_delta) || 0) * (Number(merged.unit_price) || 0)
      }
      return merged
    }
    let saved = null
    setChangeOrders((cs) => cs.map((c) => (c.id === coId
      ? { ...c, items: c.items.map((it) => (it.id === id ? (saved = recompute(it)) : it)) }
      : c)))
    if (!dbMode) return { error: null }
    const dbPatch = { ...patch }
    if (saved && ('qty_delta' in patch || 'unit_price' in patch)) dbPatch.amount_delta = saved.amount_delta
    const { error } = await supabase.from('change_order_items').update(dbPatch).eq('id', id)
    return { error }
  }, [dbMode])

  const deleteChangeOrderItem = useCallback(async (coId, id) => {
    setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: c.items.filter((it) => it.id !== id) } : c)))
    if (dbMode) await supabase.from('change_order_items').delete().eq('id', id)
    return { error: null }
  }, [dbMode])

  // 契約義務:重載 / 解析契約 / 改狀態(契約領域不依賴標單 → isPersistedProject)──
  const reloadObligations = useCallback(async () => {
    if (!isPersistedProject) return
    setObligations(await loadObligationsFromDB(currentProject.project_id))
  }, [isPersistedProject, currentProject])

  // 共用解析核心:把契約內容(純文字或視覺)送 parse-contract → 取代義務清單
  const parseContractBody = useCallback(async (body) => {
    if (!isPersistedProject) return { error: { message: '需真專案' } }
    const { data, error } = await supabase.functions.invoke('parse-contract', { body })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    const obs = data.obligations || []
    const pid = currentProject.project_id
    await supabase.from('contract_obligations').delete().eq('project_id', pid) // 重新解析=取代
    if (obs.length) {
      const rows = obs.map((o, i) => ({
        project_id: pid, title: o.title, category: o.category || null,
        trigger_event: o.trigger_event || null,
        offset_days: Number.isFinite(o.offset_days) ? o.offset_days : null,
        offset_dir: o.offset_dir || 'after', fixed_date: o.fixed_date || null,
        recurring: o.recurring || null, recurring_day: o.recurring_day || null,
        responsible: o.responsible || null, penalty: o.penalty || null,
        source_clause: o.source_clause || null, source_page: o.source_page || null,
        status: '待辦', sort_order: i,
      }))
      const { error: insErr } = await supabase.from('contract_obligations').insert(rows)
      if (insErr) return { error: insErr }
    }
    await reloadObligations()
    log('AI 解析契約義務', `${obs.length} 項`, { user: currentUser?.name || '系統', role: '施工品管' })
    return { error: null, count: obs.length }
  }, [isPersistedProject, currentProject, currentUser, reloadObligations, log])

  // P0-07.5:統一上傳流程已抽好逐頁文字 → 同一份契約直接重建義務,不需二次上傳
  const parseContractFromText = useCallback(async (text) => {
    if (!text || text.trim().length < 200) return { error: { message: '契約文字不足,無法解析義務時程' } }
    return parseContractBody({ text })
  }, [parseContractBody])

  // 相容:單檔上傳路徑;瀏覽器抽文字,抽不到退回視覺
  const parseContract = useCallback(async (file) => {
    if (!isPersistedProject) return { error: { message: '需真專案' } }
    let body
    try {
      const text = await extractContractText(file)
      body = (text && text.trim().length > 200)
        ? { text, filename: file.name }
        : { file_base64: await fileToBase64(file), mime_type: file.type, filename: file.name }
    } catch { return { error: { message: '讀取檔案失敗' } } }
    return parseContractBody(body)
  }, [isPersistedProject, parseContractBody])

  // P0-06:上傳契約/規範 → 正式文件版本+逐頁保存 → extract-requirements Edge Function
  // 產生「AI 履約需求建議」(draft_ai/needs_review,待人工審查)。與 parseContract(legacy
  // 時程義務)平行存在。契約文件不依賴標單 → 用 isPersistedProject 而非 dbMode。
  const ingestRequirementDocument = useCallback(async (file, documentType = 'contract') => {
    if (!isPersistedProject) return { error: { message: '需真實專案(demo 模式不支援 AI 需求擷取)' } }
    return runRequirementIngestion({
      projectId: currentProject.project_id,
      userId: currentUser?.user_id || null,
      file,
      documentType,
    })
  }, [isPersistedProject, currentProject, currentUser])

  const updateObligationStatus = useCallback(async (id, status) => {
    setObligations((os) => os.map((o) => (o.id === id ? { ...o, status } : o)))
    if (isPersistedProject) await supabase.from('contract_obligations').update({ status }).eq('id', id)
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
    reloadObligations, parseContract, parseContractFromText, updateObligationStatus, ingestRequirementDocument,
  }
}
