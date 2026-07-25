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

export function useAgentSlice({ demoMode, isPersistedProject, currentProject, currentUser }) {
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

  return { agentActions, agentActionsLoading, runAgent, resolveAgentAction, reloadAgentActions, setAgentActions }
}
