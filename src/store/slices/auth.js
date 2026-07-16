// Auth slice:登入身分(真實 Supabase session / demo 角色)與註冊登入動作。
// 跨領域的登出清理(清專案/日誌/品質資料)由 store.jsx 的 logout 組合。
import { useState, useCallback, useEffect } from 'react'
import { users } from '../../data/seed.js'
import { supabase, isSupabaseConfigured } from '../../lib/supabase.js'

// 由 org_type + role 組出顯示用的角色標籤（對應三級品管）
const ORG_LABEL = { contractor: '施工廠商', supervisor: '監造', owner: '機關' }
function orgLabel(org_type, role) {
  return [ORG_LABEL[org_type] || '施工廠商', role].filter(Boolean).join(' / ')
}

// demo 模式:記住上次選的角色,重整/簡報中 F5 不會被踢回登入頁
const DEMO_USER_KEY = 'pmis-demo-user'
function restoreDemoUser() {
  if (isSupabaseConfigured) return null
  try {
    const id = localStorage.getItem(DEMO_USER_KEY)
    return users.find((u) => u.user_id === id) || null
  } catch { return null }
}

export function useAuthSlice() {
  const [currentUser, setCurrentUserState] = useState(restoreDemoUser)
  // session 恢復完成前不可判定「未登入」——否則 F5 深連結會先被導去 /login,
  // hash 路徑丟失,登入恢復後一律落在 Dashboard(第二輪 P1-04)。demo 模式同步恢復,直接 ready。
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  // 密碼重設流程中:使用者點了重設信連結回來(PASSWORD_RECOVERY)。此時 session 已生效,
  // 但必須先讓他設新密碼——App 守衛與 Login 依此旗標擋住一般導向、改顯示設定新密碼畫面。
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  // demo 選角色時持久化;真實模式由 Supabase session 管,不動 localStorage
  const setCurrentUser = useCallback((u) => {
    if (!isSupabaseConfigured) {
      try { u ? localStorage.setItem(DEMO_USER_KEY, u.user_id) : localStorage.removeItem(DEMO_USER_KEY) } catch { /* noop */ }
    }
    setCurrentUserState(u)
  }, [])

  // ── 真實 Auth（Supabase）────────────────────────────────────────────
  // 設定了 Supabase 才啟用；否則維持 prototype 假登入（不會壞）。
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    let lastUserId = null // 同一使用者的重複 auth 事件（TOKEN_REFRESHED、切回分頁）直接略過，
                          // 否則 setCurrentUser(新物件) 會連鎖觸發專案+整份標單重新下載（egress 元凶）
    const loadProfile = async (session) => {
      if (!session?.user) { lastUserId = null; if (active) setCurrentUser(null); return }
      if (session.user.id === lastUserId) return
      lastUserId = session.user.id
      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', session.user.id).single()
      if (!active) return
      setCurrentUser({
        user_id: session.user.id,
        email: session.user.email,
        name: profile?.full_name || session.user.email,
        company: profile?.company || '',
        role: profile?.role || '',
        org_type: profile?.org_type || 'contractor',
        label: orgLabel(profile?.org_type, profile?.role),
        real: true,
      })
    }
    // getSession 失敗/卡住不可讓全站永久「載入中…」(B-13):
    // 10 秒 timeout 或例外都視為未登入放行(落到 /login,可重試),不再無限轉圈。
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ data: { session: null }, timedOut: true }), 10000))
    Promise.race([supabase.auth.getSession(), timeout])
      .then(async ({ data }) => { await loadProfile(data?.session || null) })
      .catch(() => {})
      .finally(() => { if (active) setAuthReady(true) })
    // 注意：不可在 onAuthStateChange callback 內直接 await Supabase 查詢，
    // 否則會與 auth lock 互鎖卡死所有後續查詢 → 用 setTimeout 推出 callback 再查。
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true) // 重設信連結回來,先讓他設新密碼
      setTimeout(() => loadProfile(session), 0)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [setCurrentUser])

  // 若後台開著「Confirm email」,驗證信裡的連結預設會導向 Supabase Site URL——
  // 若沒設好就會落在錯的地方。帶 emailRedirectTo 明確導回本 App(去掉 HashRouter 的
  // #fragment,只留文件 URL,Supabase 會把 token 接在後面,supabase-js 自動解析)。
  // 這組 URL 也必須加進後台 Auth → URL Configuration 的 Redirect URLs 白名單。
  const authRedirectTo = () =>
    (typeof window !== 'undefined' ? window.location.href.split('#')[0] : undefined)

  const signUp = useCallback(async ({ email, password, full_name, company, org_type, role }) => {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name, company, org_type, role }, emailRedirectTo: authRedirectTo() },
    })
    // Confirm email 開啟時：建立成功但不給 session（需先點信中連結）→ needsConfirmation
    const needsConfirmation = !error && !data?.session
    return { error, needsConfirmation }
  }, [])

  // 沒收到驗證信時重寄（Confirm email 開啟時才有意義）。
  const resendSignup = useCallback(async (email) => {
    const { error } = await supabase.auth.resend({
      type: 'signup', email, options: { emailRedirectTo: authRedirectTo() },
    })
    return { error }
  }, [])

  const signIn = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }, [])

  // 忘記密碼:寄重設連結(redirectTo 同註冊驗證信,需在後台 Redirect URLs 白名單)。
  // 注意:為了不洩漏「哪些 email 已註冊」,Supabase 對不存在的帳號同樣回成功。
  const requestPasswordReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectTo() })
    return { error }
  }, [])

  // 重設信連結回來後設定新密碼(recovery session 已生效)。成功即結束 recovery 流程。
  const updatePassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) setPasswordRecovery(false)
    return { error }
  }, [])

  // 登出的 auth 部分：真實模式呼叫 Supabase signOut；跨 slice 清理在 store.jsx
  const signOutBase = useCallback(async () => {
    if (isSupabaseConfigured) { try { await supabase.auth.signOut() } catch { /* noop */ } }
    setCurrentUser(null)
  }, [setCurrentUser])

  return {
    currentUser, authReady, setCurrentUser, signUp, resendSignup, signIn, signOutBase,
    passwordRecovery, requestPasswordReset, updatePassword,
  }
}
