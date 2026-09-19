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

// functions.invoke 對非 2xx 只回通用訊息(FunctionsHttpError),伺服器的中文錯誤
// (403 功能停用/503 閘門 fail-closed)在 error.context(Response)body 裡——
// 撈出來,「清楚錯誤訊息」才到得了使用者眼前(PR #4 review;純函式,有測試)。
export async function extractInvokeError(error, data, fallbackMsg = 'AI agent 暫時無法使用') {
  if (error) {
    try {
      const body = await error.context?.json?.()
      if (body?.error) return String(body.error)
    } catch { /* body 不是 JSON 或已被消費 → 退回通用訊息 */ }
    return error.message || fallbackMsg
  }
  return data?.error ? String(data.error) : fallbackMsg
}

// Agent 對話起稿(P6b-2):draft_daily_log／draft_inspection 由 Edge 直接寫成現場文書草稿(該日施工日誌／一份自主檢查表的
// AI 版本,與照片起稿同一支 builder),agent_actions 的 target_table='field_documents'、target_id=文件。收件匣只顯示
// evidence 裡的摘要(工項、範本項目與 AI 建議),接受時才在那份文件上動作——不再由前端另湊一份內容或直接寫事實表。
export const isDocumentDraft = (a) => a?.target_table === 'field_documents' && !!a?.target_id

// 日誌草稿卡片:照片看不出、還沒人填數量的工項數(evidence.items:{ [work_item_id]: { qty_today… } };
// quantities 是卡片上人填的輸入)
export function draftNeedsInputCount(items, quantities = {}) {
  return Object.entries(items || {})
    .filter(([wid, v]) => !(Number(quantities?.[wid] ?? v?.qty_today) > 0)).length
}

// 自主檢查表草稿卡片:實測值項數(一律待人量測)／AI 建議勾選項數(待逐項確認);evidence.items 形如 [{ no, kind, suggested? }]
export function checklistDraftCounts(items) {
  const list = Array.isArray(items) ? items : []
  return {
    needsInput: list.filter((it) => it?.kind === 'num').length,
    aiSuggested: list.filter((it) => typeof it?.suggested === 'boolean').length,
  }
}

// 收件匣一次載入的草稿筆數上限。這是靜默截斷(超過的舊草稿不會有任何提示),
// 之所以可接受:收件匣的用途是「還沒覆核的近期草稿」,UI 只顯示 pending,
// 而一個人在一個專案裡積到 50 筆未覆核草稿之前早就該處理了。
// 完整歷史屬於稽核軌跡(agent_actions 全表 + /activity),不是這個清單的職責——
// 要做「歷史」時正確做法是分頁,不是把這個數字調大。
const AGENT_INBOX_LIMIT = 50

export function useAgentSlice({ demoMode, isPersistedProject, currentProject, currentUser }, { fillAgentDraftQuantities, decideSubmittal } = {}) {
  // AI 草稿收件匣(pending 由 UI 篩;保留近 AGENT_INBOX_LIMIT 筆含已處理)
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
        .order('created_at', { ascending: false }).limit(AGENT_INBOX_LIMIT)
      if (!active) return
      if (error) console.warn('AI 草稿收件匣載入失敗:', error.message)
      else setAgentActions(data || [])
      setAgentActionsLoading(false)
    })()
    return () => { active = false }
  }, [demoMode, isPersistedProject, currentProject?.project_id, currentUser?.user_id, reloadKey])

  // 對話:送本案 facts 快照 + 對話 history 給 agent-run,agent 自行呼叫唯讀工具再回答。
  // demo/未設 Supabase → fallback(UI 走確定性回退)。
  // 回傳的 role 由伺服器決定;前端算的角色只用於顯示,以回傳值為準。
  const runAgent = useCallback(async (message, { facts, history } = {}) => {
    if (demoMode || !isSupabaseConfigured || !isPersistedProject) return { fallback: true }
    const { data, error } = await supabase.functions.invoke('agent-run', {
      body: { project_id: currentProject.project_id, message, facts, history },
    })
    if (error || !data || data.error) return { error: await extractInvokeError(error, data) }
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

  // 接受草稿。⚠️ 順序紅線:先把人的輸入寫進目標成功、才 resolveAgentAction(id,'accepted')——顛倒的話寫入失敗會變成
  // 「草稿消失了、資料卻沒存」;反向失敗(已存、標記失敗)是安全的:草稿留在收件匣,重按只是再存一版相同內容。
  // 日誌／自主檢查表草稿(P6b-2):文件已由 Edge 建好(target_id)。日誌=把卡片上人填的數量疊到文件目前版本存成人工版本
  // (沒填就不加版本);自主檢查表=不在這裡動內容——AI 建議的勾選要人在文件頁逐項確認、實測值要人量測(confirm_required),
  // 收件匣一鍵「接受」不能代替逐項確認,所以只標已接受並帶去文件頁。事實表(daily_logs／checklist_records)一律只由簽署寫。
  // 舊格式(target 不是文件)的草稿沒有文件可接:回明確錯誤,請使用者拒絕後重擬(正式庫 2026-09-20 無此類草稿)。
  const acceptDraft = useCallback(async (action, quantities) => {
    const kind = action?.kind
    if (kind === 'draft_daily_log' || kind === 'draft_inspection') {
      if (!isDocumentDraft(action)) return { error: '這是舊格式的草稿(未建立文件),無法接受;請拒絕後請 Agent 重新起稿' }
      if (kind === 'draft_daily_log') {
        if (typeof fillAgentDraftQuantities !== 'function') return { error: '施工日誌寫入尚未就緒,請稍後再試' }
        const r = await fillAgentDraftQuantities({ documentId: action.target_id, quantities })
        if (r?.error) return { error: r.error?.message || r.error } // 數量沒存成 → 草稿維持 pending,可重試或到文件頁填
        const res = await resolveAgentAction(action.id, 'accepted')
        if (res?.error) return res
        return { error: null, applied: 'daily_log', documentId: action.target_id, result: r.result }
      }
      const res = await resolveAgentAction(action.id, 'accepted')
      if (res?.error) return res
      return { error: null, applied: 'self_check', documentId: action.target_id }
    }
    // 審查意見草稿(批6):採用=把 AI 擬的意見存進 review_note、把件推進到「審核中」。
    // ⚠️ 審定紅線:decideSubmittal 的狀態一律傳 '審核中'——傳其他值會寫 decided_date
    // 形同替監造審定(見 collab.js decideSubmittal:status !== '審核中' 才寫 decided_date)。
    // AI 只擬意見,核准/核備/退回補正必須由監造本人在 /submittals 操作。
    // 反向失敗(意見已存、草稿標記失敗)時重按採用只是對同一件重寫相同 review_note(冪等),無害。
    const payload = action?.evidence?.payload
    if (kind === 'draft_submittal_review' && payload?.submittal_id) {
      if (typeof decideSubmittal !== 'function') return { error: '送審審查寫入尚未就緒,請稍後再試' }
      const res = await decideSubmittal(payload.submittal_id, '審核中', payload.opinion || null)
      if (res?.error) return { error: res.error?.message || res.error } // 意見沒存入 → 草稿維持 pending
      const r2 = await resolveAgentAction(action.id, 'accepted')
      if (r2?.error) return r2
      return { error: null, applied: 'submittal_review' }
    }
    // audit_note / handoff(批4):接受=「知道了/收下」,不產生任何業務資料,只標 accepted。
    return resolveAgentAction(action?.id, 'accepted')
  }, [resolveAgentAction, fillAgentDraftQuantities, decideSubmittal])

  return { agentActions, agentActionsLoading, runAgent, resolveAgentAction, acceptDraft, reloadAgentActions, setAgentActions }
}
