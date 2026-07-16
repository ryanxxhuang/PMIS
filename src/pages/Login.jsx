import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { useStore } from '../store.jsx'
import { users } from '../data/seed.js'

export default function Login() {
  const { isSupabaseConfigured, setCurrentUser, currentUser, signIn, signUp, resendSignup,
    passwordRecovery, requestPasswordReset, updatePassword } = useStore()
  const navigate = useNavigate()

  // 已登入（含 Supabase session 還原）→ 進首頁。機關承辦管多案 → 預設落在跨案總覽。
  // 密碼重設流程中例外:recovery session 已生效,但要先設好新密碼才放行。
  useEffect(() => {
    if (currentUser && !passwordRecovery) navigate(currentUser.org_type === 'owner' ? '/portfolio' : '/dashboard')
  }, [currentUser, passwordRecovery, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="bg-[var(--surface)] rounded-2xl g-elevation-2 w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="text-3xl font-medium tracking-tight text-[var(--text)]">PMIS <span className="text-[var(--accent-text)] font-bold">AI</span></div>
          <div className="text-[var(--text-2)] text-sm mt-1">AI 工程現場管理平台</div>
        </div>
        {passwordRecovery
          ? <ResetPasswordForm updatePassword={updatePassword} />
          : isSupabaseConfigured
            ? <AuthForm signIn={signIn} signUp={signUp} resendSignup={resendSignup} requestPasswordReset={requestPasswordReset} />
            : <RolePicker setCurrentUser={setCurrentUser} navigate={navigate} />}
      </div>
    </div>
  )
}

// ── 設定新密碼(點重設信連結回來,recovery session 已生效)─────────────────
function ResetPasswordForm({ updatePassword }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const input = 'w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:border-[var(--blue)] focus:outline-none'

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (pw !== pw2) { setErr('兩次輸入的密碼不一致'); return }
    setBusy(true)
    const { error } = await updatePassword(pw)
    setBusy(false)
    if (error) setErr(error.message || '密碼更新失敗,請重試(重設連結可能已過期,可重寄一封)')
    // 成功:passwordRecovery 清除 → Login 的導向 effect 自動帶進工作區
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-sm font-medium text-[var(--text)]">設定新密碼</div>
      <p className="text-xs text-[var(--text-2)]">你剛透過重設連結回來,請設定新密碼後繼續。</p>
      <input className={input} type="password" placeholder="新密碼（至少 6 碼）" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} autoFocus />
      <input className={input} type="password" placeholder="再輸入一次新密碼" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={6} />
      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
      <button type="submit" disabled={busy}
        className="w-full bg-[var(--primary)] text-white rounded-lg py-2.5 font-medium hover:bg-[var(--primary-hover)] transition disabled:opacity-50">
        {busy ? '更新中…' : '設定新密碼並登入'}
      </button>
    </form>
  )
}

// ── 真實 Email 註冊 / 登入 ──────────────────────────────────────────
function AuthForm({ signIn, signUp, resendSignup, requestPasswordReset }) {
  const [mode, setMode] = useState('signin') // signin | signup | forgot
  const [form, setForm] = useState({ email: '', password: '', full_name: '', company: '', org_type: 'contractor', role: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false) // 註冊後等收驗證信
  const [resetSent, setResetSent] = useState(false) // 忘記密碼:重設信已寄出
  const [resendMsg, setResendMsg] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setLoading(true)
    if (mode === 'forgot') {
      const { error } = await requestPasswordReset(form.email)
      setLoading(false)
      if (error) setErr(error.message || '寄送失敗,請稍後再試')
      else setResetSent(true)
    } else if (mode === 'signin') {
      const { error } = await signIn({ email: form.email, password: form.password })
      setLoading(false)
      if (error) setErr(error.message || '登入失敗，請確認帳密')
      // 成功後由 store 的 auth listener 設定 currentUser → Login useEffect 自動導向
    } else {
      const { error, needsConfirmation } = await signUp(form)
      setLoading(false)
      if (error) setErr(error.message || '註冊失敗，請再試一次')
      else if (needsConfirmation) setSent(true)
      // 若未開驗證信（needsConfirmation=false）→ 直接登入並自動導向
    }
  }

  // 忘記密碼:重設信已寄出
  if (resetSent) {
    return (
      <div className="text-center space-y-3 py-2">
        <div className="flex justify-center"><MailCheck size={36} className="text-[var(--blue-text)]" aria-hidden /></div>
        <div className="font-semibold text-[var(--text)]">重設連結已寄出</div>
        <p className="text-sm text-[var(--text-2)]">
          若 <b>{form.email}</b> 是已註冊的帳號，重設密碼連結已寄達。<br />請點信中連結回來設定新密碼。
        </p>
        <p className="text-xs text-[var(--text-3)]">沒收到？也看一下垃圾郵件匣。</p>
        <button onClick={() => { setResetSent(false); setMode('signin'); setErr('') }} className="text-sm text-[var(--blue)] hover:underline">← 回登入</button>
      </div>
    )
  }

  const onResend = async () => {
    setResendMsg('寄送中…')
    const { error } = await resendSignup(form.email)
    setResendMsg(error ? (error.message || '重寄失敗，請稍後再試') : '已重寄，請查看信箱（含垃圾郵件匣）。')
  }

  if (sent) {
    return (
      <div className="text-center space-y-3 py-2">
        <div className="flex justify-center"><MailCheck size={36} className="text-[var(--blue-text)]" aria-hidden /></div>
        <div className="font-semibold text-[var(--text)]">驗證信已寄出</div>
        <p className="text-sm text-[var(--text-2)]">
          已寄到 <b>{form.email}</b>。請到信箱點擊連結完成驗證，<br />再回來登入。
        </p>
        <p className="text-xs text-[var(--text-3)]">沒收到？也看一下垃圾郵件匣。</p>
        <div className="flex items-center justify-center gap-3 pt-1">
          <button onClick={onResend} className="text-sm text-[var(--blue)] hover:underline">重寄驗證信</button>
          <span className="text-[var(--border)]">·</span>
          <button onClick={() => { setSent(false); setResendMsg(''); setMode('signin') }} className="text-sm text-[var(--blue)] hover:underline">← 回登入</button>
        </div>
        {resendMsg && <p className="text-xs text-[var(--text-2)]">{resendMsg}</p>}
      </div>
    )
  }

  const input = 'w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:border-[var(--blue)] focus:outline-none'

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex rounded-lg bg-[var(--surface-2)] p-1 text-sm mb-1">
        {[['signin', '登入'], ['signup', '註冊']].map(([m, label]) => (
          <button key={m} type="button" onClick={() => { setMode(m); setErr('') }}
            className={`flex-1 py-1.5 rounded-md transition ${mode === m ? 'bg-[var(--surface)] shadow-sm font-medium text-[var(--text)]' : 'text-[var(--text-2)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'signup' && (
        <>
          <input className={input} placeholder="姓名" value={form.full_name} onChange={set('full_name')} required />
          <input className={input} placeholder="公司 / 單位" value={form.company} onChange={set('company')} />
          <div className="flex gap-2">
            <select className={input} value={form.org_type} onChange={set('org_type')}>
              <option value="contractor">施工廠商</option>
              <option value="supervisor">監造</option>
              <option value="owner">機關</option>
            </select>
            <input className={input} placeholder="職稱（如 品管工程師）" value={form.role} onChange={set('role')} />
          </div>
        </>
      )}

      {mode === 'forgot' && (
        <p className="text-xs text-[var(--text-2)]">輸入註冊時的 Email，我們會寄一封「重設密碼」連結給你。</p>
      )}
      <input className={input} type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
      {mode !== 'forgot' && (
        <input className={input} type="password" placeholder="密碼（至少 6 碼）" value={form.password} onChange={set('password')} required minLength={6} />
      )}

      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}

      <button type="submit" disabled={loading}
        className="w-full bg-[var(--primary)] text-white rounded-lg py-2.5 font-medium hover:bg-[var(--primary-hover)] transition disabled:opacity-50">
        {loading ? '處理中…' : mode === 'signin' ? '登入' : mode === 'signup' ? '建立帳號並登入' : '寄送重設連結'}
      </button>
      <div className="text-center pt-0.5">
        {mode === 'signin' && (
          <button type="button" onClick={() => { setMode('forgot'); setErr('') }} className="text-xs text-[var(--text-3)] hover:text-[var(--blue-text)] hover:underline">
            忘記密碼？
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => { setMode('signin'); setErr('') }} className="text-xs text-[var(--text-3)] hover:text-[var(--blue-text)] hover:underline">
            ← 回登入
          </button>
        )}
      </div>
      <div className="text-center text-xs text-[var(--text-3)] pt-1">真實帳號 · 資料存於 Supabase（RLS 權限控管）</div>
    </form>
  )
}

// ── Prototype 假登入（未設定 Supabase 時的 fallback）───────────────────
function RolePicker({ setCurrentUser, navigate }) {
  const pick = (u) => {
    setCurrentUser(u)
    navigate(u.org_type === 'owner' ? '/portfolio' : '/dashboard') // 機關落在跨案總覽
  }
  return (
    <>
      <div className="text-sm text-[var(--text-2)] mb-3 font-medium">選擇 demo 角色登入：</div>
      <div className="space-y-2">
        {users.map((u) => (
          <button key={u.user_id} onClick={() => pick(u)}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] hover:border-[var(--blue)] hover:bg-[var(--blue-tint)] transition text-left">
            <div className="w-10 h-10 rounded-full bg-[var(--blue-tint)] text-[var(--blue-text)] flex items-center justify-center font-bold">{u.name[0]}</div>
            <div>
              <div className="font-medium text-[var(--text)]">{u.name}</div>
              <div className="text-xs text-[var(--text-2)]">{u.label} · {u.company}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="text-center text-xs text-[var(--text-3)] mt-6">點任一角色即可進入 prototype</div>
    </>
  )
}
