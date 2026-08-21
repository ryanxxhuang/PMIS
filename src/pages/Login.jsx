import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { MSym } from '../components/icons.jsx'
import { useStore } from '../store.jsx'
import { users } from '../data/seed.js'
import { ErrorBanner, FIELD_BASE, Button, Badge } from '../components/ui.jsx'
import { friendlyError } from '../lib/errorMessage.js'

// ── W12 登入/註冊改版(依 PMIS Mockups v2 登入與建立帳戶兩畫面)──────────────
// 登入=左右兩欄卡(左品牌+信任說明、右表單);建立帳戶=整張寬卡
// (步驟 1/2 選擇身分 → 角色卡只留圖示+名稱 → 步驟 2/2 驗證信箱)。
// 與 mockup 的刻意差異(不做假 UI):
// * 「專案邀請碼」欄位不做——現行邀請機制是邀請方輸入 email(D-009),沒有邀請碼後端;
// * GSN SSO 不做(使用者裁示拿掉);
// * 密碼欄保留在註冊表單(Supabase 註冊需要密碼,mockup 漏了);
// * 「保持登入」不寫 30 天(token 效期由後台設定,不在前端控制)——
//   checkbox 是真機制:取消勾選 → session 進 sessionStorage,關瀏覽器即登出。

// 信任說明:三條都是產品真的有做的事——工程會共通規範一覽表(SaaS 套裝型·普級)
// 文件在 docs/資安;audit_events 帶 actor IP 留存(對應稽核軌跡 6 個月政策)。
const TRUST_POINTS = [
  ['shield', '資通系統防護基準 · 普通級'],
  ['location_on', '專案資料依三方權限隔離存放'],
  ['history', '登入與操作留存稽核軌跡 6 個月'],
]

// 註冊角色卡:只留圖示+名稱(使用者裁示拿掉說明小字);權限邊界由下方說明列講。
const ORG_CARDS = [
  { value: 'contractor', icon: 'engineering', title: '施工廠商' },
  { value: 'supervisor', icon: 'fact_check', title: '監造單位' },
  { value: 'owner', icon: 'account_balance', title: '機關／業主' },
]
const ORG_NAME_LABEL = { contractor: '公司名稱', supervisor: '公司／單位名稱', owner: '機關名稱' }

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

  const wide = isSupabaseConfigured && !passwordRecovery && mode === 'signup'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] p-4 sm:p-6">
      {/* 登入卡是全站唯一 28px 圓角的卡(README),刻意不吃 Surface */}
      <div className={`w-full bg-[var(--surface)] rounded-[28px] border border-[var(--border-card)] [box-shadow:var(--shadow-card)] ${wide ? 'max-w-[1080px]' : 'max-w-[980px]'}`}>
        {wide
          ? <SignUpCard setMode={setMode} signUp={signUp} resendSignup={resendSignup} />
          : (
            <div className="grid lg:grid-cols-2">
              {/* 左欄:品牌+標題+信任說明(lg 兩欄、手機直排) */}
              <div className="p-6 sm:p-10 lg:pr-6 flex flex-col">
                <Brand />
                <h1 className="text-[32px] leading-10 font-normal text-[var(--text)] mt-6">
                  {passwordRecovery ? '設定新密碼' : !isSupabaseConfigured ? '登入' : mode === 'forgot' ? '重設密碼' : '登入'}
                </h1>
                <p className="text-sm text-[var(--text-2)] mt-2">
                  {passwordRecovery
                    ? '你剛透過重設連結回來,請設定新密碼後繼續。'
                    : !isSupabaseConfigured
                      ? '示範環境:選擇角色即可進入 prototype'
                      : mode === 'forgot'
                        ? '我們會寄一封重設連結到你註冊的信箱'
                        : '使用機關公務信箱或專案邀請信箱,繼續前往 PMIS.ai'}
                </p>
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
                    ? <SignInForm mode={mode} setMode={setMode} signIn={signIn} requestPasswordReset={requestPasswordReset} />
                    : <RolePicker setCurrentUser={setCurrentUser} navigate={navigate} />}
              </div>
            </div>
          )}
      </div>
      {/* 卡外底部列:左語言、右連結。只放真有目的地的連結(目前僅 /security) */}
      <div className={`w-full flex items-center justify-between flex-wrap gap-x-4 px-4 sm:px-6 mt-2 text-xs text-[var(--text-3)] ${wide ? 'max-w-[1080px]' : 'max-w-[980px]'}`}>
        <span className="inline-flex items-center min-h-11">繁體中文 · Traditional Chinese</span>
        <Link to="/security" className="inline-flex items-center min-h-11 px-2 hover:text-[var(--blue-text)] hover:underline">資安漏洞回報</Link>
      </div>
    </div>
  )
}

function Brand() {
  const base = import.meta.env.BASE_URL
  return (
    <div className="flex items-center gap-1.5">
      <img src={`${base}brand/pmis-mark.svg`} alt="" className="w-7 h-7 dark:hidden" />
      <img src={`${base}brand/pmis-mark-dark.svg`} alt="" className="w-7 h-7 hidden dark:block" />
      <span className="text-xl font-medium tracking-tight text-[var(--text)]">PMIS<span className="text-[var(--blue)]">.ai</span></span>
    </div>
  )
}

// ── 浮動標籤輸入框(52px 高、label 騎在上緣邊框)────────────────────────────
// placeholder「屬性」是 e2e-real getByPlaceholder 的填表合約,必須原字保留;
// 視覺說明改由浮動 label 承擔,placeholder 用 text-transparent 隱藏。
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

// ── 登入(mockup:Email/密碼、保持登入、忘記密碼、建立帳戶+下一步)──────────
function SignInForm({ mode, setMode, signIn, requestPasswordReset }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(true)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setLoading(true)
    if (mode === 'forgot') {
      const { error } = await requestPasswordReset(email)
      setLoading(false)
      if (error) setErr(friendlyError(error, '寄送失敗，請稍後再試'))
      else setResetSent(true)
      return
    }
    const { error } = await signIn({ email, password, keep })
    setLoading(false)
    if (error) setErr(friendlyError(error, '登入失敗，請確認帳密'))
    // 成功後由 store 的 auth listener 設定 currentUser → Login useEffect 自動導向
  }

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
          若 <b>{email}</b> 是已註冊的帳號，重設密碼連結已寄達。<br />請點信中連結回來設定新密碼。
        </p>
        <p className="text-xs text-[var(--text-3)]">沒收到？也看一下垃圾郵件匣。</p>
        <button onClick={() => { setResetSent(false); setMode('signin'); setErr('') }} className="inline-flex items-center gap-1 min-h-11 px-2 text-sm text-[var(--blue-text)] hover:underline pressable"><MSym name="arrow_back" size={16} />回登入</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <FloatField label="電子信箱 · Email" type="email" placeholder="Email"
        value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      {mode !== 'forgot' && (
        <FloatField label="密碼 · Password" type="password" placeholder="密碼（至少 8 碼，含大小寫英文與數字）"
          value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      )}
      {mode === 'forgot'
        ? (
          <p className="text-xs text-[var(--text-2)]">輸入註冊時的 Email，我們會寄一封「重設密碼」連結給你。</p>
        )
        : (
          <div className="flex items-center justify-between gap-2">
            {/* 真機制:取消勾選 → session 進 sessionStorage,關閉瀏覽器即登出 */}
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-2)] min-h-11 cursor-pointer select-none">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)}
                className="w-4 h-4 accent-[var(--primary)]" />
              保持登入
            </label>
            <button type="button" onClick={() => { setMode('forgot'); setErr('') }}
              className="inline-flex items-center min-h-11 px-2 text-[13px] text-[var(--blue-text)] hover:underline">
              忘記密碼？
            </button>
          </div>
        )}
      <ErrorBanner msg={err} />
      <div className="flex items-center justify-between gap-2 pt-1">
        {mode === 'forgot'
          ? (
            <button type="button" onClick={() => { setMode('signin'); setErr('') }}
              className="inline-flex items-center gap-1 min-h-11 px-2 text-sm text-[var(--blue-text)] hover:underline">
              <MSym name="arrow_back" size={16} />回登入
            </button>
          )
          : (
            <button type="button" onClick={() => { setMode('signup'); setErr('') }}
              className="inline-flex items-center min-h-11 px-2 text-sm font-medium text-[var(--blue-text)] hover:underline">
              建立帳戶
            </button>
          )}
        <Button type="submit" size="lg" busy={loading} className="px-8">
          {loading ? '處理中…' : mode === 'forgot' ? '寄送重設連結' : '下一步'}
        </Button>
      </div>
    </form>
  )
}

// ── 建立帳戶(mockup:整張寬卡、步驟 1/2 選擇身分 → 步驟 2/2 驗證信箱)────────
function SignUpCard({ setMode, signUp, resendSignup }) {
  const [form, setForm] = useState({ email: '', password: '', full_name: '', company: '', org_type: 'contractor', role: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false) // 註冊後等收驗證信
  const [resendMsg, setResendMsg] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setLoading(true)
    const { error, needsConfirmation } = await signUp(form)
    setLoading(false)
    if (error) setErr(friendlyError(error, '註冊失敗，請再試一次'))
    else if (needsConfirmation) setSent(true)
    // 若未開驗證信（needsConfirmation=false）→ 直接登入並自動導向
  }

  const onResend = async () => {
    setResendMsg('寄送中…')
    const { error } = await resendSignup(form.email)
    setResendMsg(error ? friendlyError(error, '重寄失敗，請稍後再試') : '已重寄，請查看信箱（含垃圾郵件匣）。')
  }

  return (
    <div className="p-6 sm:p-10 lg:p-12">
      {/* 頂列:品牌+步驟指示 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Brand />
        <span className="text-[13px] text-[var(--text-2)]">{sent ? '步驟 2 / 2 · 驗證信箱' : '步驟 1 / 2 · 選擇身分'}</span>
      </div>

      {sent
        ? (
          <div className="text-center space-y-3 py-10 max-w-md mx-auto">
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
        : (
          <form onSubmit={submit}>
            <h1 className="text-[26px] leading-9 font-normal text-[var(--text)] mt-6">建立帳戶</h1>
            <p className="text-[13px] text-[var(--text-2)] mt-1.5">
              你在專案裡是哪一方？身分決定你看得到什麼、能簽什麼，註冊後無法自行變更。
            </p>

            {/* e2e-real 合約:registerViaUI 用 page.locator('select').first().selectOption(orgType)
                選角色,所以角色卡之外保留一顆原生 select 與 form.org_type 雙向同步。
                Playwright 的 actionable 檢查不接受 display:none → 用 1×1px 透明;
                鍵盤與報讀器改走下方角色卡 → tabIndex=-1 + aria-hidden。 */}
            <div className="relative mt-5">
              <select value={form.org_type} onChange={set('org_type')} tabIndex={-1} aria-hidden="true"
                className="absolute top-0 left-0 w-px h-px opacity-0">
                <option value="contractor">施工廠商</option>
                <option value="supervisor">監造</option>
                <option value="owner">機關</option>
              </select>
              {/* 角色卡:只留圖示+名稱(使用者裁示拿掉說明小字);
                  選取態用 inset shadow 畫 2px 框而非加粗 border——border 換粗細會位移 */}
              <div className="grid sm:grid-cols-3 gap-3">
                {ORG_CARDS.map((c) => {
                  const selected = form.org_type === c.value
                  return (
                    <button key={c.value} type="button" aria-pressed={selected}
                      onClick={() => setForm((f) => ({ ...f, org_type: c.value }))}
                      className={`relative rounded-xl border border-[var(--border-card)] px-4 py-5 text-left min-h-11 pressable transition-colors
                        ${selected ? 'bg-[var(--blue-tint)] shadow-[inset_0_0_0_2px_var(--blue)]' : 'hover:bg-[var(--surface-2)]'}`}>
                      {selected && <MSym name="check_circle" fill size={20} className="absolute top-2.5 right-2.5 text-[var(--blue)]" />}
                      <MSym name={c.icon} size={26} fill={selected} className={selected ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'} />
                      <div className="text-[17px] font-medium text-[var(--text)] mt-2">{c.title}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 欄位:桌機兩欄。mockup 的「專案邀請碼」不做(現行邀請=對方輸入你的
                email,沒有邀請碼機制);密碼欄 mockup 沒畫但註冊需要,補在信箱旁 */}
            <div className="grid sm:grid-cols-2 gap-x-5 gap-y-4 mt-6">
              <FloatField label="姓名" placeholder="姓名" value={form.full_name} onChange={set('full_name')} required />
              <FloatField label={ORG_NAME_LABEL[form.org_type]} placeholder="公司 / 單位" value={form.company} onChange={set('company')} />
              <FloatField label="公務／公司信箱" type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
              <div>
                <FloatField label="密碼" type="password" placeholder="密碼（至少 8 碼，含大小寫英文與數字）"
                  value={form.password} onChange={set('password')} required minLength={8} />
                <p className="text-xs text-[var(--text-3)] mt-1 pl-2.5">至少 8 碼，含大小寫英文與數字</p>
              </div>
            </div>

            {/* 資訊列(mockup):藍底說明,講清楚機關帳戶與平台後台的邊界 */}
            <div className="mt-5 rounded-xl bg-[var(--blue-tint)] px-4 py-3 flex items-start gap-2.5 text-[13px] text-[var(--text)]">
              <MSym name="info" size={17} className="shrink-0 mt-0.5 text-[var(--blue-text)]" />
              機關帳戶可建立專案並開啟正式模式；平台管理後台不屬於專案角色，僅平台營運者可見。
            </div>

            <ErrorBanner msg={err} className="mt-3" />

            <div className="flex items-center justify-between gap-3 mt-6 flex-wrap">
              <button type="button" onClick={() => setMode('signin')}
                className="inline-flex items-center min-h-11 px-2 text-sm font-medium text-[var(--blue-text)] hover:underline">
                已有帳戶？登入
              </button>
              <Button type="submit" size="lg" busy={loading} className="px-6">
                {loading ? '處理中…' : '下一步：驗證信箱'}
              </Button>
            </div>
          </form>
        )}
    </div>
  )
}

// ── 設定新密碼(點重設信連結回來,recovery session 已生效)─────────────────
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
