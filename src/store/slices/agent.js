// Agent slice:AI agent 對話(agent-run 多輪工具迴圈)與草稿收件匣(agent_actions)。
// 產品前提:agent 一律「只產生草稿」,不直接寫任何業務資料——草稿落在 agent_actions,
// 由本人 accept / reject 後才(於後續批次)轉成真正的業務寫入。
// demo 模式一律不打 Supabase:對話回 { fallback: true } 由 UI 走確定性回退,
// 草稿收件匣吃 buildDemoData 種子(store.jsx 接線)、處理只改記憶體。
// 注意:demo 種子的 4 筆草稿 actor_user 為 null 且涵蓋四種 agent 角色——這與
// 真實模式「只看得到自己的草稿」刻意不一致,是銷售展示用(一次看到四種 agent
// 會擬什麼),不是 bug;真實資料的可見性由 RLS(本人限定)決定。
import { useState, useCallback, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'

// 日誌草稿 payload → saveSiteLog 入參的形狀轉換(純函式,agent.test.js 有測)。
// payload.items 形如 { [work_item_id(uuid)]: { qty_today, needs_input, source } }(後端 draft_daily_log 產),
// saveSiteLog 的 items 則是 { [item_key]: 數量 } ——它內部用 wiMaps.byKey 以 item_key 查回 uuid
// 再寫 daily_log_items,所以這裡要用 idToKey(uuid → item_key)先把鍵翻過來。
// 數量誠實原則:qty_today 為 null(needs_input,人還沒填)的工項「直接略過不送」——
// saveSiteLog 對 falsy 數量本就不寫 daily_log_items(`wi && q` 過濾),送 0 與略過的落庫結果
// 相同,但略過在語意上誠實:「還沒填」不是「做了 0」。工項不會因此丟失——
// 使用者接受後到 /site-log 補數量,同日 upsert 覆蓋即可。
export function draftPayloadToSiteLog(payload, idToKey) {
  const items = {}
  for (const [wiId, v] of Object.entries(payload?.items || {})) {
    // idToKey 查不到時退回 payload 自帶的 item_key(後端 buildDailyLogDraft 逐項附上正是為此)。
    // demo 模式的 workItems.json 沒有 uuid → idToKey 恆為空,全靠這個備援;
    // 真模式若工項已被移除,備援出來的舊 key 也會被 saveSiteLog 的 byKey 查表濾掉,不會誤寫。
    const key = idToKey?.get?.(wiId) ?? v?.item_key
    const qty = Number(v?.qty_today)
    if (key && qty > 0) items[key] = qty // 兩邊都查不回 key(工項已被移除且草稿未附)→ 略過,與 saveSiteLog 的行為一致
  }
  return {
    log_date: payload?.log_date,
    weather: null, // 公定格式用 weather_am/pm;舊單一欄位不由草稿填
    weather_am: payload?.weather_am || null,
    weather_pm: payload?.weather_pm || null,
    labor: payload?.labor || [],
    equipment: payload?.equipment || [],
    materials: payload?.materials || [],
    extras: payload?.extras || null,
    work_summary: payload?.work_summary || null,
    items,
  }
}

// 草稿裡「數量待人填」的工項數(收件匣 Badge 與按鈕文案用)
export function draftNeedsInputCount(payload) {
  return Object.values(payload?.items || {})
    .filter((v) => v?.needs_input && (v?.qty_today == null || v.qty_today === '')).length
}

// 查驗草稿 payload → createChecklistRecord 入參的形狀轉換(批4,純函式)。
// payload.results 形如 { [項次no]: { value, needs_input?, ai_suggested? } }(後端 draft_inspection 產);
// createChecklistRecord 要的是「完整 template 物件 + values({no: value})」,判定它自己跑
// judgeChecklist(確定性)——所以這裡要用 template_id 從既有範本清單查回整個 template。
// 實測值紅線:num 項後端一律 value:null(AI 不准猜),value 為 null 的項不進 values,
// judgeChecklist 對未檢項回 pass:null 不列入判定,語意正確。
// 範本查不到(已被刪除)回 null,由呼叫端給誠實錯誤——絕不能拿錯的範本硬存。
export function draftPayloadToChecklist(payload, templates) {
  const tpl = (templates || []).find((t) => t.id === payload?.template_id)
    || (payload?.template_title ? (templates || []).find((t) => t.title === payload.template_title) : null)
  if (!tpl) return null
  const values = {}
  for (const [no, v] of Object.entries(payload?.results || {})) {
    if (v && v.value != null && v.value !== '') values[no] = v.value
  }
  return {
    template: tpl, check_date: payload.check_date, location: payload.location || null, values, note: payload.note || null,
    // 批4 payload 已帶 work_item_id(uuid),當時存檔路徑不收所以丟掉;
    // 批5 createChecklistRecord 已補此入參 → 一併傳下去,佐證鏈才接得起來。
    work_item_id: payload.work_item_id || null,
  }
}

// 查驗草稿統計(收件匣卡片顯示):實測值等待人填的項數 / AI 建議勾選的項數
export function checklistDraftCounts(payload) {
  const rs = Object.values(payload?.results || {})
  return {
    needsInput: rs.filter((v) => v?.needs_input && (v?.value == null || v.value === '')).length,
    aiSuggested: rs.filter((v) => v?.ai_suggested && v?.value != null).length,
  }
}

// 把收件匣卡片上人填的數量合併回草稿 payload(純函式,回傳全新物件)。
// quantities 形如 { [work_item_id]: '12.5' },值來自 <input> 一律可能是字串;
// 只有解析後 > 0 的才視為「已填」(0/空字串/非數字都維持原樣=未填,對齊
// draftPayloadToSiteLog 的 qty > 0 過濾)。⚠️ 絕不可就地改傳入的 payload ——
// 它是 store 裡 agent_actions 的 evidence,就地改會讓畫面與資料不一致。
export function applyDraftQuantities(payload, quantities) {
  if (!quantities) return payload
  const items = {}
  for (const [wiId, v] of Object.entries(payload?.items || {})) {
    const q = Number(quantities[wiId])
    items[wiId] = Number.isFinite(q) && q > 0 ? { ...v, qty_today: q, needs_input: false } : v
  }
  return { ...payload, items }
}

export function useAgentSlice({ demoMode, isPersistedProject, currentProject, currentUser, wiMaps }, { saveSiteLog, createChecklistRecord, allChecklistTemplates, decideSubmittal } = {}) {
  // AI 草稿收件匣(pending 由 UI 篩;保留近 50 筆含已處理,之後可做歷史)
  const [agentActions, setAgentActions] = useState([])
  const [agentActionsLoading, setAgentActionsLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reloadAgentActions = useCallback(() => setReloadKey((k) => k + 1), [])

  // 真專案選定即載入(demo 由 store.jsx 種入,不打網路)。
  // RLS 已擋跨案+非本人,仍帶 .eq('project_id')/.eq('actor_user') 縱深防禦與省流量;
  // 載入失敗不可讓頁面炸掉——記錄後保持空清單,收件匣顯示空狀態即可。
  useEffect(() => {
    if (demoMode) return
    if (!isPersistedProject) { setAgentActions([]); return }
    if (!currentUser?.user_id) { setAgentActions([]); return } // 未登入/尚未載入使用者:無草稿可看
    let active = true
    setAgentActions([]) // 切案先清,避免短暫殘留前案草稿(P0-07 同型風險)
    setAgentActionsLoading(true)
    ;(async () => {
      // RLS 已限定本人+本案,這裡的 .eq 是縱深防禦(意圖明確)與減少傳輸量
      const { data, error } = await supabase.from('agent_actions').select('*')
        .eq('project_id', currentProject.project_id)
        .eq('actor_user', currentUser.user_id)
        .order('created_at', { ascending: false }).limit(50)
      if (!active) return
      if (error) console.warn('AI 草稿收件匣載入失敗:', error.message)
      else setAgentActions(data || [])
      setAgentActionsLoading(false)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, isPersistedProject, currentProject?.project_id, currentUser?.user_id, reloadKey])

  // 對話:送本案 facts 快照 + 對話 history 給 agent-run,agent 自行呼叫唯讀工具再回答。
  // demo/未設 Supabase → fallback(UI 走確定性回退,同 askAssistant 既有模式)。
  // 回傳的 role 由伺服器決定;前端算的角色只用於顯示,以回傳值為準。
  const runAgent = useCallback(async (message, { facts, history } = {}) => {
    if (demoMode || !isSupabaseConfigured || !isPersistedProject) return { fallback: true }
    const { data, error } = await supabase.functions.invoke('agent-run', {
      body: { project_id: currentProject.project_id, message, facts, history },
    })
    if (error || !data || data.error) return { error: error?.message || data?.error || 'AI agent 暫時無法使用' }
    return { text: data.text, role: data.role, steps: data.steps || [], usage: data.usage, stop_reason: data.stop_reason }
  }, [demoMode, isPersistedProject, currentProject])

  // 處理草稿:批 2 只開放 accepted / rejected('edited' 留給批 3 的草稿編輯 UI)。
  // 真實模式走 resolve_agent_action RPC(本人限定、pending 唯一可轉移態,詳 migration),
  // 成功後用回傳整列就地更新,不整包重抓;RPC raise 的中文訊息直接回給 UI 顯示。
  const resolveAgentAction = useCallback(async (id, status) => {
    if (status !== 'accepted' && status !== 'rejected') return { error: '不支援的處理狀態' }
    if (!isPersistedProject) {
      setAgentActions((as) => as.map((a) => (a.id === id
        ? { ...a, status, resolved_by: currentUser?.user_id || null, resolved_at: new Date().toISOString() }
        : a)))
      return { error: null }
    }
    const { data, error } = await supabase.rpc('resolve_agent_action', { p_id: id, p_status: status })
    if (error) return { error: error.message }
    if (data) setAgentActions((as) => as.map((a) => (a.id === data.id ? data : a)))
    return { error: null }
  }, [isPersistedProject, currentUser])

  // 接受草稿 → 真的產生業務資料(批3 先支援日誌;其他 kind 只改狀態,批4 再擴)。
  // ⚠️ 順序紅線:先 saveSiteLog 成功、才 resolveAgentAction(id,'accepted')。
  // 顛倒的話,日誌寫入失敗會變成「草稿消失了、日誌卻沒建立」,使用者的資料憑空蒸發;
  // 反向的失敗(日誌已建立、草稿標記失敗)是安全的:草稿留在收件匣,重按一次接受
  // 只是對同日日誌 upsert(冪等),不會重複建立。
  // demo 模式一樣走 saveSiteLog(它自己有 demo 分支,只進記憶體)。
  // quantities:收件匣卡片上人填的各工項數量({ work_item_id: 值 },可不帶=維持原行為)——
  // 草稿數量一律 needs_input(見 draftPayloadToSiteLog 註解),沒有這個入口的話
  // 接受後的日誌會一個工項都沒有,agent 從照片認出工項的價值就蒸發了。
  const acceptDraft = useCallback(async (action, quantities) => {
    const payload = action?.evidence?.payload
    // 查驗草稿(批4):先真的建立自主檢查表紀錄、才標 accepted(順序紅線同日誌)。
    // 與日誌不同,checklist insert 不是冪等 upsert——反向失敗(紀錄已建立、草稿標記失敗)
    // 時草稿留在收件匣,重按接受會多建一筆 Rev.0 紀錄;無資料遺失、可於品質管理刪除,
    // 仍優於顛倒順序的「草稿消失、紀錄沒建立」。
    // 判定不在這裡跑:createChecklistRecord 內部走 judgeChecklist(確定性),
    // AI 建議的 bool 已由使用者按「接受」背書,num 實測值未填=未檢不列入判定。
    if (action?.kind === 'draft_inspection' && payload?.template_id) {
      if (typeof createChecklistRecord !== 'function') return { error: '自主檢查表寫入尚未就緒,請稍後再試' }
      const input = draftPayloadToChecklist(payload, allChecklistTemplates)
      if (!input) return { error: '找不到草稿對應的檢查表範本(可能已被刪除),請拒絕此草稿後至品質管理手動建立' }
      const res = await createChecklistRecord(input)
      if (res?.error) return { error: res.error?.message || res.error } // 紀錄沒建立 → 草稿維持 pending
      const r2 = await resolveAgentAction(action.id, 'accepted')
      if (r2?.error) return r2
      return { error: null, applied: 'checklist' }
    }
    // 審查意見草稿(批6):採用=把 AI 擬的意見存進 review_note、把件推進到「審核中」。
    // ⚠️ 審定紅線:decideSubmittal 的狀態一律傳 '審核中'——傳其他值會寫 decided_date
    // 形同替監造審定(見 collab.js decideSubmittal:status !== '審核中' 才寫 decided_date)。
    // AI 只擬意見,核准/核備/退回補正必須由監造本人在 /submittals 操作。
    // 順序紅線同上:先 decideSubmittal 成功、才標 accepted;反向失敗(意見已存、
    // 草稿標記失敗)時重按採用只是對同一件重寫相同 review_note(冪等),無害。
    if (action?.kind === 'draft_submittal_review' && payload?.submittal_id) {
      if (typeof decideSubmittal !== 'function') return { error: '送審審查寫入尚未就緒,請稍後再試' }
      const res = await decideSubmittal(payload.submittal_id, '審核中', payload.opinion || null)
      if (res?.error) return { error: res.error?.message || res.error } // 意見沒存入 → 草稿維持 pending
      const r2 = await resolveAgentAction(action.id, 'accepted')
      if (r2?.error) return r2
      return { error: null, applied: 'submittal_review' }
    }
    // audit_note / handoff(批4):接受=「知道了/收下」,不產生任何業務資料,只標 accepted。
    // 其他非日誌 kind、沒帶 payload 的舊草稿/demo 種子亦同(批 2 行為)——
    // 不能因為草稿缺料就讓收件匣卡死,至少要能把它處理掉。
    if (action?.kind !== 'draft_daily_log' || !payload?.log_date) {
      return resolveAgentAction(action?.id, 'accepted')
    }
    if (typeof saveSiteLog !== 'function') return { error: '施工日誌寫入尚未就緒,請稍後再試' }
    const merged = applyDraftQuantities(payload, quantities) // 全新物件,store 裡的 evidence 不被動到
    const { error } = await saveSiteLog(draftPayloadToSiteLog(merged, wiMaps?.idToKey))
    if (error) return { error } // 日誌沒建立 → 草稿維持 pending,可重試或改手動填寫
    const res = await resolveAgentAction(action.id, 'accepted')
    if (res?.error) return res // 日誌已建立、只是草稿標記失敗;重按接受為冪等 upsert,無害
    return { error: null, applied: 'daily_log' }
  }, [resolveAgentAction, saveSiteLog, wiMaps, createChecklistRecord, allChecklistTemplates, decideSubmittal])

  return { agentActions, agentActionsLoading, runAgent, resolveAgentAction, acceptDraft, reloadAgentActions, setAgentActions }
}
