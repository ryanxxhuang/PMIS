// Billing slice:估驗計價(掛在 work_items 標單脊椎上)、請款收款、預定進度 S 曲線。
//
// P4c 起估驗的寫入全部走 P4b 的 RPC(設計 docs/architecture/confirmed-quantity-valuation.md §16.3):
//   建期 → insert valuations(必填計價截止日)＋ sync_valuation_from_confirmations
//   改累計量 → set_valuation_item_cum(上限、來源分配、金額全由 DB 算;VQ006 帶 prev_cum／floor／limit／cap)
//   送審／退回／核定 → transition_valuation(p_from 冪等;檢查點在 trigger,VQ004 帶違反清單)
//   同步確認量 → sync_valuation_from_confirmations
// P4d(撤銷／減量／補證／調整,同一份 §16.3):
//   監造撤銷確認 → revoke_inspection_confirmation(原因必填;收斂由 trigger:草稿縮減、審核中標需重算、已核定建 pending 扣回)
//   監造簽發／減量／補證 → issue_supervisor_certificate(累計語意;同批次較小累計＝減量;p_covers_valuation_id＝補證歷史已核定期)
//   機關作廢扣回 → void_valuation_adjustment(語意=接受該量已計價,永不產生新可用量)
// 前端不再組任何 valuation_items 列(舊 valuationItemRow／fillValuationFromSiteLogs 是客戶端數字
// 直接寫進請款底稿的路徑,已移除);每次寫入成功後從 DB 重載期別(投影規則見 lib/valuationPeriods.js),
// 畫面上的數量與金額永遠是 DB 的值。
import { useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase.js'
import { parseLocalDate, taipeiToday, localISOMonth } from '../../lib/dates.js'
import { loadValuationsFromDB, loadValuationAdjustmentsFromDB } from '../db.js'
import { valuationItemAmount } from '../../lib/boqCalc.js'

// 把 supabase update/delete 的回傳統一成 {error}:PostgREST 被 RLS 擋下時
// 「不回錯誤、只回空 rows」——那也是失敗,必須回報給使用者,不得偽裝成功。
// (trigger 拒絕會走 error;此函式補上 RLS 靜默過濾的那一種。)
export function mutationOutcome({ data, error }, deniedMessage) {
  if (error) return { error }
  if (!data || data.length === 0) return { error: { message: deniedMessage } }
  return { error: null }
}

// P4b 的 RPC／guard 以自訂 errcode(VQ001–VQ010)raise,detail 是 JSON 字串(PostgREST 放在 details)。
// 統一解成 { code, message, detail } 讓頁面能依代碼分流、把 VQ004 的違反清單與 VQ006 的上限數字轉成人話;
// 非 VQ 錯誤原樣回傳(message 仍交給 friendlyError)。
export function parseValuationError(error) {
  if (!error) return null
  const code = typeof error.code === 'string' && /^VQ\d{3}$/.test(error.code) ? error.code : null
  let detail = error.detail ?? null
  if (detail == null && typeof error.details === 'string' && error.details.trim()) {
    try { detail = JSON.parse(error.details) } catch { detail = null }
  }
  return { ...error, code: code || error.code, message: error.message || '', detail }
}

export function useBillingSlice({ dbMode, currentProject, currentUser, wiMaps }) {
  // 估驗計價:每期一個物件 { id, period_no, status, period_end, items: {item_key: 累計量},
  // amounts: {item_key: 累計金額(DB 算)}, own: {item_key: {cum_qty, amount_cum, backing}} }
  const [valuations, setValuations] = useState([])
  // 估驗調整(P4d):valuation_adjustments 全部列(pending／applied／void);今日工作只取 pending
  const [valuationAdjustments, setValuationAdjustments] = useState([])
  // 預定進度 S 曲線：{ start, end, months: [{ label, plannedPct }] }
  const [progressPlan, setProgressPlan] = useState(null)

  // DB 模式的唯一更新來源:任何估驗寫入成功後整批重載(期別數十、明細數千,一次分頁查詢;
  // 往前帶的投影跨期別,局部更新反而容易與 DB 不一致)。載入失敗回傳 error,不留舊畫面假裝成功。
  // 估驗調整與期別一起重載:撤銷／作廢／同步都會同時改兩邊,分開載會有一瞬對不上。
  const reloadValuations = useCallback(async () => {
    if (!dbMode) return { error: null }
    try {
      const [vals, adjustments] = await Promise.all([
        loadValuationsFromDB(currentProject.project_id, wiMaps.idToKey),
        loadValuationAdjustmentsFromDB(currentProject.project_id),
      ])
      setValuations(vals); setValuationAdjustments(adjustments)
      return { error: null }
    } catch (error) {
      return { error }
    }
  }, [dbMode, currentProject, wiMaps])

  // 新增一期:期數 +1;計價截止日必填(續接清單 §6 Q7:送審／核定前 DB 必填,建期就收)。
  // DB:建期後立即以 sync_valuation_from_confirmations 帶入可估驗的監造確認量——前期累計由
  // DB 定義(fn_cq_prev_cum_internal),不再由前端複製前期明細寫回 DB。同步失敗就把剛建的期刪掉,不留半套。
  // demo:本機物件,累計量與金額往前帶(demo 沒有確認量,示範資料不假裝經過後端核對)。
  const createValuation = useCallback(async ({ periodEnd, retentionPct = 5 } = {}) => {
    if (!periodEnd) return { v: null, error: { message: '請填計價截止日(本期計價截至哪一天)' } }
    const periodNo = valuations.length ? Math.max(...valuations.map((v) => v.period_no)) + 1 : 1
    const prev = valuations.find((v) => v.period_no === periodNo - 1)
    // 估驗日是業務日期:取台北日曆日(UTC 在台灣 00:00–08:00 會落成前一天,
    // 施工月報以 valuation_date 歸期就會錯月)。UI 副本與 DB 同一格式。
    const vDate = taipeiToday()
    if (!dbMode) {
      const v = {
        id: `VAL-${Date.now()}`, period_no: periodNo, valuation_date: vDate, period_end: periodEnd,
        retention_pct: retentionPct, status: '草稿', note: null,
        items: prev ? { ...prev.items } : {}, amounts: prev ? { ...prev.amounts } : {}, own: {},
      }
      setValuations((vs) => [...vs, v])
      return { v, error: null }
    }
    const id = crypto.randomUUID()
    const { error } = await supabase.from('valuations').insert({
      id, project_id: currentProject.project_id, period_no: periodNo,
      valuation_date: vDate, period_end: periodEnd,
      retention_pct: retentionPct, status: '草稿', created_by: currentUser?.user_id,
    })
    if (error) return { v: null, error: parseValuationError(error) }
    const { error: syncError } = await supabase.rpc('sync_valuation_from_confirmations', { p_valuation_id: id })
    if (syncError) {
      await supabase.from('valuations').delete().eq('id', id)
      return { v: null, error: parseValuationError(syncError) }
    }
    const { error: loadError } = await reloadValuations()
    if (loadError) return { v: null, error: loadError }
    return { v: { id, period_no: periodNo }, error: null }
  }, [valuations, dbMode, currentProject, currentUser, reloadValuations])

  // 設定草稿期某工項的「累計完成數量」:DB 走 set_valuation_item_cum(目標累計量;在
  // [前期累計＋本期扣回, 上限] 內由 DB 重算來源分配與金額,超出回 VQ006 帶數字),成功後重載。
  // demo:本機更新,金額用 fn_valuation_amount 鏡像。
  const updateValuationItem = useCallback(async (periodId, itemKey, cumQty) => {
    const wi = wiMaps.byKey.get(itemKey)
    if (!wi) return { error: { message: '找不到這個工項,請重新整理後再試' } }
    if (!dbMode) {
      setValuations((vs) => vs.map((v) => (v.id === periodId
        ? { ...v, items: { ...v.items, [itemKey]: cumQty }, amounts: { ...v.amounts, [itemKey]: valuationItemAmount(cumQty, wi.unit_price) } }
        : v)))
      return { error: null }
    }
    const { error } = await supabase.rpc('set_valuation_item_cum', {
      p_valuation_id: periodId, p_work_item_id: wi.id, p_cum_qty: cumQty,
    })
    if (error) return { error: parseValuationError(error) }
    return reloadValuations()
  }, [dbMode, wiMaps, reloadValuations])

  // 狀態轉移(送審/退回/核定):DB 走 transition_valuation(帶目前狀態 p_from,別人先動過就回
  // applied:false 不重複套用;角色與三個檢查點由 valuations_guard／valuations_checkpoint_guard 強制,
  // VQ004 的 detail 是逐工項違反清單,交給頁面翻成人話)。extra.note 是退回原因(記入本期備註)。
  const setValuationStatus = useCallback(async (periodId, status, extra = {}) => {
    const current = valuations.find((v) => v.id === periodId)
    if (!current) return { error: { message: '找不到這一期,可能已被移除' } }
    if (!dbMode) {
      setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, status, ...extra } : v)))
      return { error: null }
    }
    const { data, error } = await supabase.rpc('transition_valuation', {
      p_valuation_id: periodId, p_from: current.status, p_to: status, p_note: extra.note ?? null,
    })
    if (error) return { error: parseValuationError(error) }
    const { error: loadError } = await reloadValuations()
    if (loadError) return { error: loadError }
    if (data && data.applied === false) return { error: { message: data.message || '狀態未變更,已重新載入' } }
    return { error: null }
  }, [dbMode, valuations, reloadValuations])

  // 計價截止日(Q7):只有草稿期可改(登入者在非草稿期不可改期別欄位,由 valuations_guard 強制)。
  const setValuationPeriodEnd = useCallback(async (periodId, periodEnd) => {
    if (!periodEnd) return { error: { message: '計價截止日不可空白' } }
    if (dbMode) {
      const res = await supabase.from('valuations').update({ period_end: periodEnd }).eq('id', periodId).select('id')
      const { error } = mutationOutcome(res, '截止日未更新:可能無權限或這一期已被移除')
      if (error) return { error: parseValuationError(error) }
      return reloadValuations()
    }
    setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, period_end: periodEnd } : v)))
    return { error: null }
  }, [dbMode, reloadValuations])

  // 同步可估驗的監造確認量到草稿期(冪等):逐工項 FIFO 分配到上限、併入待處理扣回、重算累計與金額。
  const syncValuation = useCallback(async (periodId) => {
    if (!dbMode) return { result: null, error: { message: '示範模式沒有監造確認資料可同步' } }
    const { data, error } = await supabase.rpc('sync_valuation_from_confirmations', { p_valuation_id: periodId })
    if (error) return { result: null, error: parseValuationError(error) }
    const { error: loadError } = await reloadValuations()
    return { result: data, error: loadError }
  }, [dbMode, reloadValuations])

  // 期別狀態(唯讀):每工項的上限／前期累計／增量／來源分配／違反代碼,以及整期檢查點的違反清單。
  // demo 沒有後端核對,回 null 讓頁面明示「示範資料未經後端核對」。
  const fetchValuationState = useCallback(async (periodId) => {
    if (!dbMode) return { state: null, error: null }
    const { data, error } = await supabase.rpc('get_valuation_state', { p_valuation_id: periodId })
    if (error) return { state: null, error: parseValuationError(error) }
    return { state: data, error: null }
  }, [dbMode])

  // 可估驗清單(唯讀):有 active 確認的工項的有效量／已計價／占用／可用與批次;未開期先累積。
  const fetchBillableBacklog = useCallback(async () => {
    if (!dbMode) return { rows: [], error: null }
    const { data, error } = await supabase.rpc('list_billable_backlog', { p_project_id: currentProject.project_id })
    if (error) return { rows: [], error: parseValuationError(error) }
    return { rows: Array.isArray(data) ? data : [], error: null }
  }, [dbMode, currentProject])

  // 監造確認紀錄(唯讀,RLS 限成員):來源展開要顯示批次、位置、確認量、查驗與文件版本、確認人與時間。
  const fetchConfirmations = useCallback(async () => {
    if (!dbMode) return { rows: [], error: null }
    const { data, error } = await supabase.from('inspection_confirmations')
      .select('id, work_item_id, batch_key, location_label, stage_key, unit, qty_cum, qty_delta, basis, inspection_id, document_id, document_version_no, confirmed_by, confirmed_at, status, revoked_at, reason, supersedes_id')
      .eq('project_id', currentProject.project_id).order('confirmed_at')
    if (error) return { rows: [], error }
    return { rows: data || [], error: null }
  }, [dbMode, currentProject])

  // 總價／間接費的計價依據(Q3 暫時隔離:缺依據不計價):只有監造(或非正式模式管理者)可設,DB 強制。
  const setPricingBasis = useCallback(async (itemKey, basis) => {
    const wi = wiMaps.byKey.get(itemKey)
    if (!wi?.id) return { error: { message: '找不到這個工項' } }
    if (!dbMode) return { error: { message: '示範模式不支援設定計價依據' } }
    const { error } = await supabase.rpc('set_work_item_pricing_basis', { p_work_item_id: wi.id, p_basis: basis, p_rule: null })
    if (error) return { error: parseValuationError(error) }
    return reloadValuations()
  }, [dbMode, wiMaps, reloadValuations])

  // ── P4d:撤銷／減量／補證／調整。全部是 DB 決定結果,前端只傳意圖;成功後整批重載 ──

  // 監造撤銷一筆確認(原因必填,DB 亦強制)。回傳 DB 的 effects(草稿縮減／審核中標需重算／已核定建扣回)
  // 給頁面說明後果;applied:false(已撤銷)視為未變更並重載。
  const revokeConfirmation = useCallback(async (confirmationId, reason) => {
    if (!dbMode) return { result: null, error: { message: '示範模式沒有監造確認紀錄可撤銷' } }
    if (!reason || !reason.trim()) return { result: null, error: { message: '撤銷確認必須填寫原因' } }
    const { data, error } = await supabase.rpc('revoke_inspection_confirmation', { p_id: confirmationId, p_reason: reason.trim() })
    if (error) return { result: null, error: parseValuationError(error) }
    const { error: loadError } = await reloadValuations()
    if (loadError) return { result: null, error: loadError }
    if (data && data.applied === false) return { result: data, error: { message: data.message || '此確認已撤銷,未再變更' } }
    return { result: data, error: null }
  }, [dbMode, reloadValuations])

  // 監造簽發監造確認單(累計語意):同工項同批次再簽較小累計＝減量(guard 要求原因);
  // coversValuationId＝補證歷史已核定期(該期該工項的 legacy 來源改掛到這張確認單,數量不變、留痕)。
  // clientRequestId 由呼叫端每次開表單產生一次:重送同一張回原筆(applied:false),不重複入帳。
  const issueCertificate = useCallback(async ({ itemKey, batchKey, locationLabel, stageKey = null, qtyCum, reason, clientRequestId, coversValuationId = null }) => {
    if (!dbMode) return { result: null, error: { message: '示範模式不支援簽發監造確認單' } }
    const wi = wiMaps.byKey.get(itemKey)
    if (!wi?.id) return { result: null, error: { message: '找不到這個工項,請重新整理後再試' } }
    if (!batchKey || !batchKey.trim()) return { result: null, error: { message: '批次／位置必填(同一批次的確認是累計語意)' } }
    if (!reason || !reason.trim()) return { result: null, error: { message: '確認單必須填寫依據／說明' } }
    const qty = Number(qtyCum)
    if (!Number.isFinite(qty) || qty < 0) return { result: null, error: { message: '累計確認量必須是 0 以上的數字' } }
    const { data, error } = await supabase.rpc('issue_supervisor_certificate', {
      p_project_id: currentProject.project_id, p_work_item_id: wi.id, p_batch_key: batchKey.trim(),
      p_location_label: (locationLabel || batchKey).trim(), p_stage_key: stageKey || null, p_unit: wi.unit ?? null,
      p_qty_cum: qty, p_reason: reason.trim(), p_client_request_id: clientRequestId || null, p_covers_valuation_id: coversValuationId,
    })
    if (error) return { result: null, error: parseValuationError(error) }
    const { error: loadError } = await reloadValuations()
    if (loadError) return { result: null, error: loadError }
    return { result: data, error: null }
  }, [dbMode, wiMaps, currentProject, reloadValuations])

  // 機關作廢一筆待處理扣回(原因必填):語意是「接受該量已計價」,DB 之後不再把它當超額,但不產生新可用量。
  const voidAdjustment = useCallback(async (adjustmentId, reason) => {
    if (!dbMode) return { result: null, error: { message: '示範模式沒有估驗調整可作廢' } }
    if (!reason || !reason.trim()) return { result: null, error: { message: '作廢必須填寫原因' } }
    const { data, error } = await supabase.rpc('void_valuation_adjustment', { p_id: adjustmentId, p_reason: reason.trim() })
    if (error) return { result: null, error: parseValuationError(error) }
    const { error: loadError } = await reloadValuations()
    if (loadError) return { result: null, error: loadError }
    if (data && data.applied === false) return { result: data, error: { message: data.message || '調整狀態已變更,未作廢' } }
    return { result: data, error: null }
  }, [dbMode, reloadValuations])

  // 請款/收款:更新某期的請款日 / 收款日 / 實收金額（demo 模式只更新本機）。
  // DB 成功才更新 UI,避免撥款欄位顯示假成功。登錄請款日是 P4b 的第三個檢查點(invoice),
  // 有歷史遷移來源未補證等情形會被 DB 擋下(VQ004),錯誤含代碼與清單交給頁面顯示。
  const updateValuationPayment = useCallback(async (id, patch) => {
    // 金流完整性(P1-07):實收不得為負(序列/核定規則由 DB payment_flow trigger 強制)
    if (patch.paid_amount != null && Number(patch.paid_amount) < 0) {
      return { error: { message: '實收金額不得為負' } }
    }
    if (dbMode) {
      const res = await supabase.from('valuations').update(patch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '未寫入:可能無權限或這一期已被移除')
      if (error) return { error: parseValuationError(error) }
    }
    setValuations((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)))
    return { error: null }
  }, [dbMode])

  // 預定進度 S 曲線。依開工/竣工切出月份桶，預設用 smoothstep 產生標準 S 曲線。
  // DB 寫入改為 upsert+await(B-08):原本 fire-and-forget 先刪後插,失敗時 UI 上
  // S 曲線好好的、DB 是空的或半套——S 曲線是機關進度考核基準,不可假成功。
  const generateSchedule = useCallback(async (start, end) => {
    const s = parseLocalDate(start), e = parseLocalDate(end)
    const buckets = []
    let cur = new Date(s.getFullYear(), s.getMonth(), 1)
    const last = new Date(e.getFullYear(), e.getMonth(), 1)
    while (cur <= last) { buckets.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }
    const N = buckets.length || 1
    const smoothstep = (t) => t * t * (3 - 2 * t) // 0→1 的 S 形累計
    const months = buckets.map((d, i) => ({
      label: localISOMonth(d),
      plannedPct: +(smoothstep((i + 1) / N) * 100).toFixed(1),
    }))
    const plan = { start, end, months }
    if (dbMode) {
      const pid = currentProject.project_id
      const rows = months.map((m) => ({ project_id: pid, period_label: m.label, planned_pct: m.plannedPct }))
      // upsert 新月份成功後,才刪不在新區間內的舊月份(先插後刪,同 B-03 原則)
      const { error: upErr } = await supabase.from('schedule_periods')
        .upsert(rows, { onConflict: 'project_id,period_label' })
      if (upErr) return { plan: null, error: upErr }
      const { error: delErr } = await supabase.from('schedule_periods')
        .delete().eq('project_id', pid).not('period_label', 'in', `(${months.map((m) => `"${m.label}"`).join(',')})`)
      if (delErr) return { plan: null, error: delErr }
    }
    setProgressPlan(plan)
    return { plan, error: null }
  }, [dbMode, currentProject])

  // DB 成功才更新 UI(B-08:原本 .then(()=>{}) 吞掉結果,靜默失敗)
  const updatePlannedPct = useCallback(async (i, pct) => {
    const month = progressPlan?.months[i]
    if (dbMode && month) {
      const { error } = await supabase.from('schedule_periods').upsert(
        { project_id: currentProject.project_id, period_label: month.label, planned_pct: pct },
        { onConflict: 'project_id,period_label' },
      )
      if (error) return { error }
    }
    setProgressPlan((p) => (p ? { ...p, months: p.months.map((m, idx) => (idx === i ? { ...m, plannedPct: pct } : m)) } : p))
    return { error: null }
  }, [dbMode, currentProject, progressPlan])

  // 刪除估驗期:DB 刪成功才重載(後面草稿期往前帶的累計可能因此改變)。已核定的期會被
  // valuation_items_guard(cascade 刪明細時觸發)或 RLS 擋下——擋下時如實回報,不得從畫面上消失。
  const deleteValuation = useCallback(async (periodId) => {
    if (dbMode) {
      const res = await supabase.from('valuations').delete().eq('id', periodId).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:可能已核定或無權限')
      if (error) return { error: parseValuationError(error) }
      return reloadValuations()
    }
    setValuations((vs) => vs.filter((v) => v.id !== periodId))
    return { error: null }
  }, [dbMode, reloadValuations])

  return {
    valuations, setValuations, valuationAdjustments, setValuationAdjustments, progressPlan, setProgressPlan, reloadValuations,
    createValuation, updateValuationItem, setValuationStatus, setValuationPeriodEnd, updateValuationPayment,
    syncValuation, fetchValuationState, fetchBillableBacklog, fetchConfirmations, setPricingBasis,
    revokeConfirmation, issueCertificate, voidAdjustment,
    generateSchedule, updatePlannedPct, deleteValuation,
  }
}
