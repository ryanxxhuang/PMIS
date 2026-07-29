// Admin slice(批 C:平台管理後台)——平台管理員身分判定 + AI 用量/開關/方案的
// 後台載入與動作。資料層全部在批 A 的 migrations(20260728000000/20260728000100):
// 每支 admin RPC 第一行就檢查 is_platform_admin() 並 raise——前端的 isPlatformAdmin
// 只拿來決定「顯不顯示入口/頁面」(UX),不是權限的真相來源;就算前端被繞過,
// 非平台管理員呼叫這些 RPC 也只會拿到「需要平台管理員權限」錯誤。
import { useState, useCallback, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'
import { parseLocalDate } from '../../lib/dates.js'

// ── 純邏輯(admin.test.js 直接測這幾個)─────────────────────────────────────

// 台幣參考換算的固定匯率(顯示用參考值,非交易匯率;頁面上須註明「參考匯率」)
export const TWD_PER_USD = 32
export const toTwd = (usd) => (Number(usd) || 0) * TWD_PER_USD

// 期間預設 → 半開區間 [from, to)。to=null 表示「到現在為止不設上界」(RPC 端
// coalesce 成 infinity)。近 7 日/近 30 日「含今日」,從整日邊界起算——與
// admin_ai_usage_daily 以日為桶的語意對齊,趨勢圖第一根不會是半天。
export function presetRange(preset, now = new Date()) {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset === 'today') return { from: startOfDay, to: null }
  if (preset === '7d' || preset === '30d') {
    const d = new Date(startOfDay)
    d.setDate(d.getDate() - (preset === '7d' ? 6 : 29))
    return { from: d, to: null }
  }
  return { from: null, to: null } // 未知 preset:不設界(全部歷史)
}

// 自訂起訖('YYYY-MM-DD' 字串,來自 <input type="date">):迄日「含當天」→
// to = 迄日 + 1 天的本地午夜(半開區間的上界)。任一端留空=該端不設界。
export function customRange(fromStr, toStr) {
  const from = fromStr ? parseLocalDate(fromStr) : null
  let to = null
  if (toStr) {
    to = parseLocalDate(toStr)
    if (to) { to = new Date(to); to.setDate(to.getDate() + 1) }
  }
  return { from, to }
}

// 佔比(%):總額為 0 或無效時回 0——空期間的「佔總成本百分比」不可出現 NaN/Infinity
export function pctOfTotal(part, total) {
  const t = Number(total)
  if (!t || t <= 0) return 0
  return ((Number(part) || 0) / t) * 100
}

// 專案級覆寫三態 ⇄ admin_set_project_override 的 p_enabled 值:
//   跟隨方案 follow → null(刪除覆寫,回歸方案預設)
//   強制開啟 on     → true
//   強制關閉 off    → false
export function overrideToRpcValue(state) {
  if (state === 'on') return true
  if (state === 'off') return false
  return null
}
export function overrideFromDb(enabled) {
  if (enabled === true) return 'on'
  if (enabled === false) return 'off'
  return 'follow' // null/undefined=無覆寫
}

// ── slice hook ──────────────────────────────────────────────────────────────
const toIso = (v) => (v ? (v instanceof Date ? v.toISOString() : new Date(v).toISOString()) : null)
const rangeParams = (from, to) => ({ p_from: toIso(from), p_to: toIso(to) })

export function useAdminSlice({ currentUser }) {
  // 平台管理員身分:登入後問一次 is_platform_admin() RPC(一般使用者回 false)。
  // checked 旗標讓 /admin 路由守衛在判定完成前顯示載入,而不是先閃「無權限」。
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [platformAdminChecked, setPlatformAdminChecked] = useState(!isSupabaseConfigured)

  useEffect(() => {
    // 未設 Supabase(demo 站)/demo 角色/未登入:一律 false——平台管理員只存在於真實帳號
    if (!isSupabaseConfigured || !currentUser?.real) {
      setIsPlatformAdmin(false)
      setPlatformAdminChecked(true)
      return
    }
    let active = true
    setPlatformAdminChecked(false)
    supabase.rpc('is_platform_admin').then(({ data, error }) => {
      if (!active) return
      setIsPlatformAdmin(!error && data === true) // 查詢失敗視同 false(fail-closed)
      setPlatformAdminChecked(true)
    })
    return () => { active = false }
  }, [currentUser])

  // ── 用量載入(全部走批 A 的 admin RPC;錯誤一律回 { error } 不 throw)──────
  const loadAdminOverview = useCallback(async (from, to) => {
    const { data, error } = await supabase.rpc('admin_ai_usage_overview', rangeParams(from, to))
    return { row: data?.[0] || null, error }
  }, [])

  const loadAdminByFeature = useCallback(async (from, to) => {
    const { data, error } = await supabase.rpc('admin_ai_usage_by_feature', rangeParams(from, to))
    return { rows: data || [], error }
  }, [])

  const loadAdminByProject = useCallback(async (from, to) => {
    const { data, error } = await supabase.rpc('admin_ai_usage_by_project', rangeParams(from, to))
    return { rows: data || [], error }
  }, [])

  const loadAdminByUser = useCallback(async (from, to) => {
    const { data, error } = await supabase.rpc('admin_ai_usage_by_user', rangeParams(from, to))
    return { rows: data || [], error }
  }, [])

  const loadAdminDaily = useCallback(async (from, to) => {
    const { data, error } = await supabase.rpc('admin_ai_usage_daily', rangeParams(from, to))
    return { rows: data || [], error }
  }, [])

  // 功能註冊表(DB 為執行期真相;authenticated 可 select,但本頁只有平台管理員進得來)
  const loadAdminFeatures = useCallback(async () => {
    const { data, error } = await supabase
      .from('ai_features').select('*').order('sort_order', { ascending: true })
    return { rows: data || [], error }
  }, [])

  // 後台專案清單(含方案/覆寫數/近 30 日用量;security definer 不受成員 RLS 限制)
  const loadAdminProjects = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_list_projects_for_ai')
    return { rows: data || [], error }
  }, [])

  // 單一專案的覆寫明細(展開列用;RLS:平台管理員可讀全部)
  const loadProjectOverrides = useCallback(async (projectId) => {
    const { data, error } = await supabase
      .from('project_ai_overrides').select('feature_key, enabled').eq('project_id', projectId)
    return { rows: data || [], error }
  }, [])

  // ── 動作(全部 security definer RPC,函式內第一行 raise 把關)────────────────
  const setFeatureEnabled = useCallback(async (key, enabled) => {
    const { data, error } = await supabase.rpc('admin_set_feature_enabled', { p_key: key, p_enabled: enabled })
    return { row: data || null, error }
  }, [])

  const setFeatureMinPlan = useCallback(async (key, plan) => {
    const { data, error } = await supabase.rpc('admin_set_feature_min_plan', { p_key: key, p_min_plan: plan })
    return { row: data || null, error }
  }, [])

  const setProjectPlan = useCallback(async (projectId, plan) => {
    const { data, error } = await supabase.rpc('admin_set_project_plan', { p_project: projectId, p_plan: plan })
    return { row: data || null, error }
  }, [])

  // enabledOrNull:null=刪除覆寫(跟隨方案)、true=強制開啟、false=強制關閉
  const setProjectOverride = useCallback(async (projectId, key, enabledOrNull) => {
    const { error } = await supabase.rpc('admin_set_project_override', {
      p_project: projectId, p_key: key, p_enabled: enabledOrNull,
    })
    return { error }
  }, [])

  return {
    isPlatformAdmin, platformAdminChecked,
    loadAdminOverview, loadAdminByFeature, loadAdminByProject, loadAdminByUser, loadAdminDaily,
    loadAdminFeatures, loadAdminProjects, loadProjectOverrides,
    setFeatureEnabled, setFeatureMinPlan, setProjectPlan, setProjectOverride,
  }
}
