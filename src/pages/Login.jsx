import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { users } from '../data/seed.js'

export default function Login() {
  const { isSupabaseConfigured, setCurrentUser, currentUser, signIn, signUp } = useStore()
  const navigate = useNavigate()

  // 已登入（含 Supabase session 還原）→ 直接進 Dashboard
  useEffect(() => { if (currentUser) navigate('/dashboard') }, [currentUser, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1c2b39] to-[#0f1924] p-6">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="text-3xl font-bold tracking-tight text-slate-800">PMIS <span className="text-[#f26722]">AI</span></div>
          <div className="text-slate-500 text-sm mt-1">AI 工程現場管理平台</div>
        </div>
        {isSupabaseConfigured
          ? <AuthForm signIn={signIn} signUp={signUp} />
          : <RolePicker setCurrentUser={setCurrentUser} navigate={navigate} />}
      </div>
    </div>
  )
}

// ── 真實 Email 註冊 / 登入 ──────────────────────────────────────────
function AuthForm({ signIn, signUp }) {
  const [mode, setMode] = useState('signin') // signin | signup
  const [form, setForm] = useState({ email: '', password: '', full_name: '', company: '', org_type: 'contractor', role: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false) // 註冊後等收驗證信
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setLoading(true)
    if (mode === 'signin') {
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

  if (sent) {
    return (
      <div className="text-center space-y-3 py-2">
        <div className="text-4xl">📧</div>
        <div className="font-semibold text-slate-800">驗證信已寄出</div>
        <p className="text-sm text-slate-500">
          已寄到 <b>{form.email}</b>。請到信箱點擊連結完成驗證，<br />再回來登入。
        </p>
        <button onClick={() => { setSent(false); setMode('signin') }} className="text-sm text-[#f26722] hover:underline">← 回登入</button>
      </div>
    )
  }

  const input = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#f26722] focus:outline-none'

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex rounded-lg bg-slate-100 p-1 text-sm mb-1">
        {[['signin', '登入'], ['signup', '註冊']].map(([m, label]) => (
          <button key={m} type="button" onClick={() => { setMode(m); setErr('') }}
            className={`flex-1 py-1.5 rounded-md transition ${mode === m ? 'bg-white shadow-sm font-medium text-slate-800' : 'text-slate-500'}`}>
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

      <input className={input} type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
      <input className={input} type="password" placeholder="密碼（至少 6 碼）" value={form.password} onChange={set('password')} required minLength={6} />

      {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}

      <button type="submit" disabled={loading}
        className="w-full bg-[#f26722] text-white rounded-lg py-2.5 font-medium hover:bg-[#dd5c14] transition disabled:opacity-50">
        {loading ? '處理中…' : mode === 'signin' ? '登入' : '建立帳號並登入'}
      </button>
      <div className="text-center text-xs text-slate-400 pt-1">真實帳號 · 資料存於 Supabase（RLS 權限控管）</div>
    </form>
  )
}

// ── Prototype 假登入（未設定 Supabase 時的 fallback）───────────────────
function RolePicker({ setCurrentUser, navigate }) {
  const pick = (u) => {
    setCurrentUser(u)
    navigate('/dashboard')
  }
  return (
    <>
      <div className="text-sm text-slate-600 mb-3 font-medium">選擇 demo 角色登入：</div>
      <div className="space-y-2">
        {users.map((u) => (
          <button key={u.user_id} onClick={() => pick(u)}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-[#f26722] hover:bg-[#fdf0e9] transition text-left">
            <div className="w-10 h-10 rounded-full bg-[#fdece3] text-[#c2410c] flex items-center justify-center font-bold">{u.name[0]}</div>
            <div>
              <div className="font-medium text-slate-800">{u.name}</div>
              <div className="text-xs text-slate-500">{u.label} · {u.company}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="text-center text-xs text-slate-400 mt-6">點任一角色即可進入 prototype</div>
    </>
  )
}
