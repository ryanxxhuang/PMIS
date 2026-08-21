import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MSym } from '../components/icons.jsx'
import { useStore } from '../store.jsx'
import { users } from '../data/seed.js'
import { ErrorBanner, FIELD_BASE, Button, Badge } from '../components/ui.jsx'
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../components/PageTabs.jsx'
import { friendlyError } from '../lib/errorMessage.js'

// ── Workspace 登入卡(design_handoff README §Screens 8)──────────────────────
// 左欄 h1 要隨表單模式換字(登入/建立帳戶),但模式原本是 AuthForm 內部 state——
// 所以把 mode 提升到本層傳下去;只搬 state 位置,登入/註冊流程與 store 呼叫不動。
const MODE_HEAD = {
  signin: { h1: '登入', desc: '使用你的 PMIS.ai 帳戶進入工程專案工作區' },
  signup: { h1: '建立帳戶', desc: '註冊時選定角色,權限與可見範圍隨角色自動配置' },
  forgot: { h1: '重設密碼', desc: '我們會寄一封重設連結到你註冊的信箱' },
}

// 信任說明(README:三條綠色資安說明):文案務實不誇大——對應傳輸加密、
// 三方 RLS 隔離、agent_actions/稽核留痕這三件產品真的有做的事。
const TRUST_POINTS = [
  ['shield', '傳輸全程加密'],
  ['location_on', '廠商/監造/機關三方權限隔離'],
  ['history', '操作留痕可稽核'],
]

export default function Login() {
  const { isSupabaseConfigured, setCurrentUser, currentUser, signIn, signUp, resendSignup,
    passwordRecovery, requestPasswordReset, updatePassword } = useStore()
  const navigate = useNavigate()
  const [mode, setMode] = useState('signin') // signin | signup | forgot

  // 已登入（含 Supabase session 還原）→ 進首頁。機關承辦管多案 → 預設落在跨案總覽。
  // 密碼重設流程中例外:recovery session 已生效,但要先設好新密碼才放行。
  useEffect(() => {
    if (currentUser && !passwordRecovery) navigate(currentUser.org_type === 'owner' ? '/portfolio' : '/dashboard')
  }, [currentUser, passwordRecovery, navigate])

  const head = passwordRecovery
    ? { h1: '設定新密碼', desc: '你剛透過重設連結回來,請設定新密碼後繼續。' }
    : isSupabaseConfigured
      ? MODE_HEAD[mode]
      : { h1: '登入', desc: '示範環境:選擇角色即可進入 prototype' }
  const base = import.meta.env.BASE_URL

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] p-4 sm:p-6">
      {/* 登入卡是全站唯一 28px 圓角的卡(README),刻意不吃 Surface——
          Surface 的 rounded-2xl 與 rounded-[28px] 同權重會打架 */}
      <div className="w-full max-w-[920px] bg-[var(--surface)] rounded-[28px] border border-[var(--border-card)] [box-shadow:var(--shadow-card)] grid lg:grid-cols-2">
        {/* 左欄:品牌+標題+信任說明(lg 兩欄、手機直排) */}
        <div className="p-6 sm:p-10 lg:pr-6 flex flex-col">
          <div className="flex items-center gap-1.5">
            <img src={`${base}brand/pmis-mark.svg`} alt="" className="w-7 h-7 dark:hidden" />
            <img src={`${base}brand/pmis-mark-dark.svg`} alt="" className="w-7 h-7 hidden dark:block" />
            <span className="text-xl font-medium tracking-tight text-[var(--text)]">PMIS<span className="text-[var(--blue)]">.ai</span></span>
          </div>
          <h1 className="text-[32px] leading-10 font-normal text-[var(--text)] mt-6">{head.h1}</h1>
          <p className="text-sm text-[var(--text-2)] mt-2">{head.desc}</p>
          <ul className="mt-8 lg:mt-auto lg:pt-8 space-y-2.5 text-[13px] text-[var(--text-2)]">
            {TRUST_POINTS.map(([icon, text]) => (
              <li key={icon} className="flex items-center gap-2">
                <MSym name={icon} size={16} className="text-[var(--green-text)]" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        {/* 右欄:表單 */}
        <div className="p-6 sm:p-10 lg:pl-6 flex flex-col justify-center">
          {passwordRecovery
            ? <ResetPasswordForm updatePassword={updatePassword} />
            : isSupabaseConfigured
              ? <AuthForm mode={mode} setMode={setMode} signIn={signIn} signUp={signUp} resendSignup={resendSignup} requestPasswordReset={requestPasswordReset} />
              : <RolePicker setCurrentUser={setCurrentUser} navigate={navigate} />}
        </div>
      </div>
      {/* 卡外底部列(README):左語言、右連結。只放真有目的地的連結——
          目前僅 /security;漏洞回報頁要有公開入口才算「公開」,文案沿用 */}
      <div className="w-full max-w-[920px] flex items-center justify-between flex-wrap gap-x-4 px-4 sm:px-6 mt-2 text-xs text-[var(--text-3)]">
        <span className="inline-flex items-center min-h-11">繁體中文（台灣）</span>
        <Link to="/security" className="inline-flex items-center min-h-11 px-2 hover:text-[var(--blue-text)] hover:underline">資安漏洞回報</Link>
      </div>
    </div>
  )
}

// ── 浮動標籤輸入框(README §8:52px 高、label 騎在上緣邊框)────────────────────
// placeholder「屬性」是 e2e-real getByPlaceholder 的填表合約,必須原字保留;
// 視覺說明改由浮動 label 承擔,placeholder 用 text-transparent 隱藏——
// FIELD_BASE 內建 placeholder 顏色同權重,靠尾碼 ! 確保蓋過。
function FloatField({ label, className = '', ...props }) {
  return (
    <label className="relative block">
      <input className={`${FIELD_BASE} peer h-[52px] placeholder:text-transparent! ${className}`} {...props} />
      {/* -top-2(-8px)+surface 底=蓋住邊框;focus 時與邊框一起轉主色(peer) */}
      <span className="absolute -top-2 left-2.5 px-1 rounded bg-[var(--surface)] text-[11.5px] leading-4 text-[var(--text-2)] pointer-events-none transition-colors peer-focus:text-[var(--blue)]">
        {label}
      </span>
    </label>
  )
}

// ── 註冊角色卡(README「第三版修訂·註冊時就選角色」)───────────────────────────
// 每張說明「做什麼」與「看不到什麼」——權限邊界在選角色當下就講清楚。
const ORG_CARDS = [
  { value: 'contractor', icon: 'engineering', title: '施工廠商', does: '填日誌、送審、提估驗請款', boundary: '可見成本與內部排程' },
  { value: 'supervisor', icon: 'fact_check', title: '監造單位', does: '審查與查驗、開缺失、出報表', boundary: '不經手請款與廠商成本' },
  { value: 'owner', icon: 'account_balance', title: '機關業主', does: '核定與付款、跨案總覽', boundary: '不可見廠商毛利' },
]

// ── 真實 Email 註冊 / 登入 ──────────────────────────────────────────
function AuthForm({ mode, setMode, signIn, signUp, resendSignup, requestPasswordReset }) {
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
      if (error) setErr(friendlyError(error, '寄送失敗，請稍後再試'))
      else setResetSent(true)
    } else if (mode === 'signin') {
      const { error } = await signIn({ email: form.email, password: form.password })
      setLoading(false)
      if (error) setErr(friendlyError(error, '登入失敗，請確認帳密'))
      // 成功後由 store 的 auth listener 設定 currentUser → Login useEffect 自動導向
    } else {
      const { error, needsConfirmation } = await signUp(form)
      setLoading(false)
      if (error) setErr(friendlyError(error, '註冊失敗，請再試一次'))
      else if (needsConfirmation) setSent(true)
      // 若未開驗證信（needsConfirmation=false）→ 直接登入並自動導向
    }
  }

  // 忘記密碼:重設信已寄出
  if (resetSent) {
    return (
      <div className="text-center space-y-3 py-2">
        <div className="flex justify-center">
          <span className="w-14 h-14 rounded-full bg-[var(--blue-tint)] flex items-center justify-center">
            <MSym name="mark_email_read" size={28} className="text-[var(--blue-text)]" />
          </span>
        </div>
        <div className="font-medium text-[var(--text)]">重設連結已寄出</div>
        <p className="text-sm text-[var(--text-2)]">
          若 <b>{form.email}</b> 是已註冊的帳號，重設密碼連結已寄達。<br />請點信中連結回來設定新密碼。
        </p>
        <p className="text-xs text-[var(--text-3)]">沒收到？也看一下垃圾郵件匣。</p>
        {/* 第三級文字鈕統一 --blue-text:--blue 是實心鈕底色,當文字色在亮色模式對比不足 */}
        <button onClick={() => { setResetSent(false); setMode('signin'); setErr('') }} className="inline-flex items-center gap-1 min-h-11 px-2 text-sm text-[var(--blue-text)] hover:underline pressable"><MSym name="arrow_back" size={16} />回登入</button>
      </div>
    )
  }

  const onResend = async () => {
    setResendMsg('寄送中…')
    const { error } = await resendSignup(form.email)
    setResendMsg(error ? friendlyError(error, '重寄失敗，請稍後再試') : '已重寄，請查看信箱（含垃圾郵件匣）。')
  }

  if (sent) {
    return (
      <div className="text-center space-y-3 py-2">
        {/* 註冊選角色是步驟 1,收驗證信是步驟 2——讓等待有進度感 */}
        <Badge color="blue">步驟 2/2·驗證信箱</Badge>
        <div className="flex justify-center">
          <span className="w-14 h-14 rounded-full bg-[var(--blue-tint)] flex items-center justify-center">
            <MSym name="mark_email_read" size={28} className="text-[var(--blue-text)]" />
          </span>
        </div>
        <div className="font-medium text-[var(--text)]">驗證信已寄出</div>
        <p className="text-sm text-[var(--text-2)]">
          已寄到 <b>{form.email}</b>。請到信箱點擊連結完成驗證，<br />再回來登入。
        </p>
        <p className="text-xs text-[var(--text-3)]">沒收到？也看一下垃圾郵件匣。</p>
        <div className="flex items-center justify-center gap-3 pt-1">
          <button onClick={onResend} className="inline-flex items-center min-h-11 px-2 text-sm text-[var(--blue-text)] hover:underline pressable">重寄驗證信</button>
          <span className="text-[var(--border)]">·</span>
          <button onClick={() => { setSent(false); setResendMsg(''); setMode('signin') }} className="inline-flex items-center gap-1 min-h-11 px-2 text-sm text-[var(--blue-text)] hover:underline pressable"><MSym name="arrow_back" size={16} />回登入</button>
        </div>
        {resendMsg && <p className="text-xs text-[var(--text-2)]">{resendMsg}</p>}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* 登入/註冊切換吃全站 chips 皮(CHIP_BASE/ON/OFF),不再自寫滑塊式 segmented;
          min-h-11 保留(原本就是全尺寸 44px,不因換皮縮成桌機 32px),grid 讓兩顆等寬 */}
      <div className="grid grid-cols-2 gap-2 mb-1">
        {[['signin', '登入'], ['signup', '註冊']].map(([m, label]) => (
          <button key={m} type="button" onClick={() => { setMode(m); setErr('') }}
            className={`${CHIP_BASE} min-h-11 w-full justify-center ${mode === m ? CHIP_ON : CHIP_OFF}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'signup' && (
        <>
          <FloatField label="姓名" placeholder="姓名" value={form.full_name} onChange={set('full_name')} required />
          <FloatField label="公司 / 單位" placeholder="公司 / 單位" value={form.company} onChange={set('company')} />
          <div className="relative">
            {/* e2e-real 合約:registerViaUI 用 page.locator('select').first().selectOption(orgType)
                選角色,所以角色卡之外保留一顆原生 select 與 form.org_type 雙向同步。
                Playwright 的 actionable 檢查不接受 display:none → 用 1×1px 透明;
                鍵盤與報讀器改走下方角色卡 → tabIndex=-1 + aria-hidden。 */}
            <select value={form.org_type} onChange={set('org_type')} tabIndex={-1} aria-hidden="true"
              className="absolute top-0 left-0 w-px h-px opacity-0">
              <option value="contractor">施工廠商</option>
              <option value="supervisor">監造</option>
              <option value="owner">機關</option>
            </select>
            <div className="grid sm:grid-cols-3 gap-3">
              {ORG_CARDS.map((c) => {
                const selected = form.org_type === c.value
                return (
                  // 選取態用 inset shadow 畫 2px 框而非加粗 border——border 換粗細會位移
                  <button key={c.value} type="button" aria-pressed={selected}
                    onClick={() => setForm((f) => ({ ...f, org_type: c.value }))}
                    className={`relative rounded-xl border border-[var(--border-card)] p-3 pr-7 text-left min-h-11 pressable transition-colors
                      ${selected ? 'bg-[var(--blue-tint)] shadow-[inset_0_0_0_2px_var(--blue)]' : 'hover:bg-[var(--surface-2)]'}`}>
                    {selected && <MSym name="check_circle" fill size={18} className="absolute top-2 right-2 text-[var(--blue)]" />}
                    <MSym name={c.icon} size={24} fill={selected} className={selected ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'} />
                    <div className="text-sm font-medium text-[var(--text)] mt-1.5">{c.title}</div>
                    <div className="text-[11px] text-[var(--text-2)] mt-0.5 leading-snug">{c.does}</div>
                    <div className="text-[11px] text-[var(--text-3)] mt-0.5 leading-snug">{c.boundary}</div>
                  </button>
                )
              })}
            </div>
          </div>
          <FloatField label="職稱（選填，不影響權限）" title="職稱只供顯示，不影響系統權限" placeholder="職稱（選填，不影響權限）" value={form.role} onChange={set('role')} />
        </>
      )}

      {mode === 'forgot' && (
        <p className="text-xs text-[var(--text-2)]">輸入註冊時的 Email，我們會寄一封「重設密碼」連結給你。</p>
      )}
      <FloatField label="Email" type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
      {mode !== 'forgot' && (
        <>
          <FloatField label="密碼" type="password" placeholder="密碼（至少 8 碼，含大小寫英文與數字）" value={form.password} onChange={set('password')} required minLength={8} />
          {/* placeholder 已隱藏,密碼規則改在註冊時用 hint 講(登入不需要) */}
          {mode === 'signup' && <p className="text-xs text-[var(--text-3)] -mt-1.5 pl-2.5">至少 8 碼，含大小寫英文與數字</p>}
        </>
      )}

      <ErrorBanner msg={err} />

      <Button type="submit" size="lg" busy={loading} className="w-full">
        {loading ? '處理中…' : mode === 'signin' ? '登入' : mode === 'signup' ? '建立帳號並登入' : '寄送重設連結'}
      </Button>
      {/* 同一頁三種文字鈕寫法收斂成一種第三級樣式:13px + --blue-text + hover:underline */}
      <div className="text-center pt-0.5">
        {mode === 'signin' && (
          <button type="button" onClick={() => { setMode('forgot'); setErr('') }} className="inline-flex items-center min-h-11 px-2 text-[13px] text-[var(--blue-text)] hover:underline">
            忘記密碼？
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => { setMode('signin'); setErr('') }} className="inline-flex items-center gap-1 min-h-11 px-2 text-[13px] text-[var(--blue-text)] hover:underline">
            <MSym name="arrow_back" size={16} />回登入
          </button>
        )}
      </div>
      <div className="text-center text-xs text-[var(--text-3)] pt-1">帳號與專案資料依角色權限保護</div>
    </form>
  )
}

// ── 設定新密碼(點重設信連結回來,recovery session 已生效)─────────────────
// 標題與說明已上移到左欄 h1/desc,表單只留欄位本身。
function ResetPasswordForm({ updatePassword }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (pw !== pw2) { setErr('兩次輸入的密碼不一致'); return }
    setBusy(true)
    const { error } = await updatePassword(pw)
    setBusy(false)
    if (error) setErr(friendlyError(error, '密碼更新失敗，請重試（重設連結可能已過期，可重寄一封）'))
    // 成功:passwordRecovery 清除 → Login 的導向 effect 自動帶進工作區
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <FloatField label="新密碼" type="password" placeholder="新密碼（至少 8 碼，含大小寫英文與數字）" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} autoFocus />
      <p className="text-xs text-[var(--text-3)] -mt-1.5 pl-2.5">至少 8 碼，含大小寫英文與數字</p>
      <FloatField label="再輸入一次新密碼" type="password" placeholder="再輸入一次新密碼" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={8} />
      <ErrorBanner msg={err} />
      <Button type="submit" size="lg" busy={busy} className="w-full">
        {busy ? '更新中…' : '設定新密碼並登入'}
      </Button>
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
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-[var(--border-card)] bg-[var(--surface)] hover:bg-[var(--surface-2)] pressable text-left min-h-11">
            <div className="w-10 h-10 rounded-full bg-[var(--blue-tint)] text-[var(--blue-text)] flex items-center justify-center font-bold shrink-0">{u.name[0]}</div>
            <div className="min-w-0">
              <div className="font-medium text-[var(--text)]">{u.name}</div>
              <div className="text-xs text-[var(--text-2)] truncate">{u.label} · {u.company}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="text-center text-xs text-[var(--text-3)] mt-6">點任一角色即可進入 prototype</div>
    </>
  )
}
