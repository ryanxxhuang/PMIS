import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { EyeOff } from 'lucide-react'
import { MSym } from '../components/icons.jsx'
import { useStore } from '../store.jsx'
import { users } from '../data/seed.js'
import { ErrorBanner, Button } from '../components/ui.jsx'
import { friendlyError } from '../lib/errorMessage.js'
import { defaultLandingPath } from '../lib/navConfig.js'

// ── 登入頁 Apple style(D-021;版面依 UIUX/design_apple_style/Login.dc.html)────
// 一張置中的窄卡(408px):品牌在卡外上方、標題置中、浮動標籤欄位、
// 「保持登入」開關、一顆實心主鈕、分隔線後一顆次要鈕(建立帳戶)、
// 卡外底部是合規三點。建立帳戶用同一張卡放寬到 640px(三張身分卡＋兩欄欄位)。
// 與設計稿的刻意差異:
// * 卡面實心,不做毛玻璃——規範 §4「毛玻璃只給 chrome,內容卡一律實心」;
// * 合規三點沿用產品真的有做的事(工程會一覽表普級、三方隔離、稽核 6 個月),
//   不抄設計稿的「個資境內存放」——沒有查證過的承諾不能上登入頁;
// * 品牌字樣維持 PMIS(public/brand 的 lockup),.ai 走 --blue-text 而非 --blue
//   (規範 §2:--blue 是填色不是文字色)。
// 流程、org_type 值域、Supabase 呼叫、錯誤訊息語意、demo 入口全部不動。
//
// 測試合約(e2e-real/helpers.js、auth-smoke、routes.spec):placeholder「Email」
// 「密碼(至少 8 碼,含大小寫英文與數字)」「姓名」「公司 / 單位」原字保留、
// 送出鈕文字「下一步」「下一步:驗證信箱」、按鈕名「建立帳戶」、radio 名三方、
// 副標含「使用機關公務信箱或專案邀請信箱」、demo 文字「選擇 demo 角色登入:」。

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

// 登入卡是全站唯一 18px 圓角的卡(規範 §4「18 登入卡」),浮在視窗底上走 --shadow-overlay;
// 刻意不吃 ui.jsx 的 Surface(那是 12px 內容卡)。
const CARD = 'w-full bg-[var(--surface)] rounded-[18px] [box-shadow:var(--shadow-overlay)]'
// 卡內文字鈕(忘記密碼、回登入、已有帳戶):44px 命中區、--blue-text、不做藥丸。
const TEXT_BTN = 'inline-flex items-center gap-1 min-h-11 px-2 rounded-lg text-body font-medium text-[var(--blue-text)] hover:underline pressable'

export default function Login() {
  const { isSupabaseConfigured, setCurrentUser, currentUser, signIn, signUp, resendSignup,
    passwordRecovery, requestPasswordReset, updatePassword, mfaRequired, verifyMfa, logout } = useStore()
  const navigate = useNavigate()
  const [mode, setMode] = useState('signin') // signin | signup | forgot

  // 已登入（含 Supabase session 還原）→ 進首頁。落地頁依角色,見 navConfig。
  // 密碼重設流程中例外:recovery session 已生效,但要先設好新密碼才放行。
  useEffect(() => {
    if (currentUser && !passwordRecovery) navigate(defaultLandingPath(currentUser.org_type))
  }, [currentUser, passwordRecovery, navigate])

  const wide = isSupabaseConfigured && !passwordRecovery && mode === 'signup'
  const title = passwordRecovery ? '設定新密碼' : mfaRequired ? '輸入驗證碼' : mode === 'forgot' ? '重設密碼' : '登入'
  const subtitle = passwordRecovery
    ? '你剛透過重設連結回來，請設定新密碼後繼續。'
    : mfaRequired
      ? '這個帳號已啟用兩步驟驗證，請輸入驗證器 App 顯示的 6 位數。'
    : !isSupabaseConfigured
      ? '示範環境：選擇角色即可進入 prototype'
      : mode === 'forgot'
        ? '我們會寄一封重設連結到你註冊的信箱'
        : '使用機關公務信箱或專案邀請信箱登入；專案內的身分依契約方授權而定。'

  return (
    // 視窗底:亮色由上而下 surface → bg → surface-2 的柔光(設計稿);深色三階的
    // 明度順序倒過來(surface 比 bg 亮),漸層會變成「中間暗、四周亮」,深色只鋪 --bg。
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] px-4 py-8 sm:py-10 [background-image:radial-gradient(120%_80%_at_50%_-10%,var(--surface)_0%,var(--bg)_46%,var(--surface-2)_100%)] dark:[background-image:none]">
      <Brand />
      <div className={`${CARD} ${wide ? 'max-w-[640px]' : 'max-w-[408px]'} p-6 sm:px-8 sm:pt-8 sm:pb-7`}>
        {wide
          ? <SignUpCard setMode={setMode} signUp={signUp} resendSignup={resendSignup} />
          : (
            <>
              <h1 className="text-title2 font-semibold text-[var(--text)] text-center">{title}</h1>
              <p className="text-body text-[var(--text-2)] text-center mt-1.5">{subtitle}</p>
              <div className="mt-6">
                {passwordRecovery
                  ? <ResetPasswordForm updatePassword={updatePassword} />
                  : mfaRequired
                    ? <MfaForm verifyMfa={verifyMfa} logout={logout} />
                  : isSupabaseConfigured
                    ? <SignInForm mode={mode} setMode={setMode} signIn={signIn} requestPasswordReset={requestPasswordReset} />
                    : <RolePicker setCurrentUser={setCurrentUser} navigate={navigate} />}
              </div>
            </>
          )}
      </div>
      {/* 卡外合規列:三點+唯一有目的地的連結(/security)。語言標示拿掉——沒有可切換的東西就不佔版面 */}
      <ul role="list" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 mt-6 px-2 text-caption text-[var(--text-3)]">
        {TRUST_POINTS.map(([icon, text]) => (
          <li key={icon} className="inline-flex items-center gap-1.5">
            <MSym name={icon} size={14} />
            {text}
          </li>
        ))}
      </ul>
      <Link to="/security" className="inline-flex items-center min-h-11 px-2 mt-1 text-caption text-[var(--text-3)] hover:text-[var(--blue-text)] hover:underline">
        資安漏洞回報
      </Link>
    </div>
  )
}

// 品牌:三方三點標記(public/brand)+ PMIS 字樣。.ai 用 --blue-text,不用 lockup 的 --blue
// (規範 §2:--blue 是填色,小字對 surface-2 不過 AA;22px 半粗雖算大字,仍統一走文字色)。
function Brand() {
  const base = import.meta.env.BASE_URL
  return (
    <div className="flex items-center gap-2 mb-6">
      <img src={`${base}brand/pmis-mark.svg`} alt="" className="w-8 h-8 dark:hidden" />
      <img src={`${base}brand/pmis-mark-dark.svg`} alt="" className="w-8 h-8 hidden dark:block" />
      <span className="text-title2 font-semibold tracking-tight text-[var(--text)]">PMIS<span className="text-[var(--blue-text)]">.ai</span></span>
    </div>
  )
}

// ── 浮動標籤輸入框(52px、10px 圓角;label 坐在框內上緣,值在其下)────────────
// placeholder「屬性」是 e2e-real getByPlaceholder 的填表合約,必須原字保留;
// 視覺說明改由浮動 label 承擔,placeholder 用 text-transparent 隱藏。
// 沒有沿用 ui.jsx 的 FIELD_BASE:它的 rounded-lg/px-3/py-2 與這裡的 10px/52px 幾何
// 會在同一屬性上互撞,改由這裡持有完整字串;焦點寫法(outline 光暈+邊框轉色)與它一致。
// 建議日後抽到 ui.jsx 成 FloatInput——目前只有登入頁用,先留在這裡。
const FLOAT_INPUT = 'peer w-full h-[52px] rounded-[10px] bg-[var(--surface)] text-callout text-[var(--text)] border border-[var(--border)] px-3.5 pt-4 pb-0.5 transition-[border-color,background-color] placeholder:text-transparent! focus:outline-[3px] focus:outline-offset-0 focus:outline-[var(--focus-glow)] focus:border-[var(--focus)] disabled:opacity-50'

function FloatField({ label, className = '', trailing, ...props }) {
  return (
    <label className="relative block">
      <input className={`${FLOAT_INPUT} ${trailing ? 'pr-12' : ''} ${className}`} {...props} />
      <span className="absolute top-1.5 left-3.5 text-caption text-[var(--text-3)] pointer-events-none transition-colors peer-focus:text-[var(--blue-text)]">
        {label}
      </span>
      {trailing}
    </label>
  )
}

// 密碼欄:右側顯示/隱藏切換(aria-pressed),只改 input type,不動送出的值。
// EyeOff 直接從 lucide-react 拿——ICONS 表沒有 visibility_off,登入頁不動共用檔;
// 建議日後在 icons.jsx 補一行 `visibility_off: EyeOff` 後改回 MSym。
function PasswordField({ label, ...props }) {
  const [show, setShow] = useState(false)
  return (
    <FloatField label={label} {...props} type={show ? 'text' : 'password'}
      trailing={(
        <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show}
          aria-label={show ? '隱藏密碼' : '顯示密碼'}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center rounded-lg text-[var(--text-3)] hover:text-[var(--text)] pressable">
          {show ? <EyeOff aria-hidden size={18} strokeWidth={1.5} absoluteStrokeWidth /> : <MSym name="visibility" size={18} />}
        </button>
      )} />
  )
}

// 「保持登入」:iOS 開關(role=switch)。真機制:關閉 → session 進 sessionStorage,
// 關瀏覽器即登出。整列是一顆 44px 高的鈕,文字就是它的無障礙名稱。
function KeepSwitch({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 min-h-11 pr-2 rounded-lg text-body text-[var(--text)] pressable">
      <span aria-hidden className={`relative inline-block w-[30px] h-[18px] rounded-full transition-colors ${checked ? 'bg-[var(--success)]' : 'bg-[var(--border)]'}`}>
        {/* 旋鈕兩種模式都是近白(HIG):亮色 --surface=白、深色 --text=#f5f5f7 */}
        <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-[var(--surface)] dark:bg-[var(--text)] [box-shadow:0_1px_2px_rgba(0,0,0,.2)] transition-transform ${checked ? 'translate-x-3' : ''}`} />
      </span>
      保持登入
    </button>
  )
}

// 寄出後的確認畫面(重設連結/驗證信共用):圖示圓、標題、說明、動作列
function SentNotice({ title, children, actions, note }) {
  return (
    <div className="text-center space-y-3 py-2">
      <div className="flex justify-center">
        <span className="w-14 h-14 rounded-full bg-[var(--blue-tint)] flex items-center justify-center">
          <MSym name="mark_email_read" size={28} className="text-[var(--blue-text)]" />
        </span>
      </div>
      <div className="text-callout font-medium text-[var(--text)]">{title}</div>
      <p className="text-body text-[var(--text-2)]">{children}</p>
      <p className="text-footnote text-[var(--text-3)]">沒收到？也看一下垃圾郵件匣。</p>
      <div className="flex items-center justify-center gap-3 pt-1">{actions}</div>
      {note && <p className="text-footnote text-[var(--text-2)]">{note}</p>}
    </div>
  )
}

// ── 登入(Email/密碼、保持登入、忘記密碼、主鈕「下一步」、次鈕「建立帳戶」)──────
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
      <SentNotice title="重設連結已寄出"
        actions={(
          <button onClick={() => { setResetSent(false); setMode('signin'); setErr('') }} className={TEXT_BTN}>
            <MSym name="arrow_back" size={16} />回登入
          </button>
        )}>
        若 <b>{email}</b> 是已註冊的帳號，重設密碼連結已寄達。<br />請點信中連結回來設定新密碼。
      </SentNotice>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <FloatField label="電子信箱 · Email" type="email" placeholder="Email" autoComplete="email"
        value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      {mode !== 'forgot' && (
        <PasswordField label="密碼 · Password" placeholder="密碼（至少 8 碼，含大小寫英文與數字）" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      )}
      {mode === 'forgot'
        ? <p className="text-footnote text-[var(--text-2)]">輸入註冊時的 Email，我們會寄一封「重設密碼」連結給你。</p>
        : (
          <div className="flex items-center justify-between gap-2">
            <KeepSwitch checked={keep} onChange={setKeep} />
            <button type="button" onClick={() => { setMode('forgot'); setErr('') }} className={`${TEXT_BTN} font-normal`}>
              忘記密碼？
            </button>
          </div>
        )}
      <ErrorBanner msg={err} />
      {/* 一個情境只有一顆實心主鈕;建立帳戶是次要鈕(規範 §6) */}
      <Button type="submit" size="lg" busy={loading} className="w-full mt-1">
        {loading ? '處理中…' : mode === 'forgot' ? '寄送重設連結' : '下一步'}
      </Button>
      {mode === 'forgot'
        ? (
          <div className="flex justify-center">
            <button type="button" onClick={() => { setMode('signin'); setErr('') }} className={TEXT_BTN}>
              <MSym name="arrow_back" size={16} />回登入
            </button>
          </div>
        )
        : (
          <>
            <div className="flex items-center gap-3 pt-2 text-caption text-[var(--text-3)]" aria-hidden>
              <span className="flex-1 h-px bg-[var(--border-2)]" />還沒有帳號<span className="flex-1 h-px bg-[var(--border-2)]" />
            </div>
            <Button type="button" variant="secondary" size="lg" className="w-full" onClick={() => { setMode('signup'); setErr('') }}>
              建立帳戶
            </Button>
          </>
        )}
    </form>
  )
}

// ── 建立帳戶(同一張卡放寬:步驟 1/2 選擇身分 → 步驟 2/2 驗證信箱)────────────
function SignUpCard({ setMode, signUp, resendSignup }) {
  const [form, setForm] = useState({ email: '', password: '', full_name: '', company: '', org_type: 'contractor', role: '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false) // 註冊後等收驗證信
  const [resendMsg, setResendMsg] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const pickOrg = (value) => setForm((f) => ({ ...f, org_type: value }))

  // radiogroup 的鍵盤合約:方向鍵在組內移動並直接選取(WAI-ARIA radio group),
  // 配合卡片的 roving tabindex——只有選中的卡進 Tab 序,不會讓三張卡各吃一次 Tab。
  const onOrgKeyDown = (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!dir) return
    e.preventDefault()
    const i = ORG_CARDS.findIndex((c) => c.value === form.org_type)
    const next = ORG_CARDS[(i + dir + ORG_CARDS.length) % ORG_CARDS.length]
    pickOrg(next.value)
    e.currentTarget.querySelector(`[data-org="${next.value}"]`)?.focus()
  }

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
    <>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-title2 font-semibold text-[var(--text)]">{sent ? '驗證信箱' : '建立帳戶'}</h1>
        <span className="text-footnote text-[var(--text-3)]">{sent ? '步驟 2 / 2' : '步驟 1 / 2'}</span>
      </div>

      {sent
        ? (
          <div className="max-w-md mx-auto mt-4">
            <SentNotice title="驗證信已寄出" note={resendMsg}
              actions={(
                <>
                  <button onClick={onResend} className={TEXT_BTN}>重寄驗證信</button>
                  <span className="text-[var(--border)]" aria-hidden>·</span>
                  <button onClick={() => { setSent(false); setResendMsg(''); setMode('signin') }} className={TEXT_BTN}>
                    <MSym name="arrow_back" size={16} />回登入
                  </button>
                </>
              )}>
              已寄到 <b>{form.email}</b>。請到信箱點擊連結完成驗證，<br />再回來登入。
            </SentNotice>
          </div>
        )
        : (
          <form onSubmit={submit}>
            <p className="text-body text-[var(--text-2)] mt-1.5">
              你在專案裡是哪一方？身分決定你看得到什麼、能簽什麼，註冊後無法自行變更。
            </p>

            {/* 角色卡:只留圖示+名稱;選取態=淺色底+主色圖示+inset 2px 框
                (border 換粗細會位移,用 inset shadow)。三選一 → radiogroup/radio。
                曾經另掛一顆 1×1px 透明 select 承接 e2e 的 selectOption,結果整個註冊
                流程唯一被測到的控制項是那顆看不見的 select、真正的卡片點擊路徑零覆蓋;
                測試改點卡片(getByRole('radio')),假控制項退場。 */}
            <div role="radiogroup" aria-label="你在專案裡是哪一方" onKeyDown={onOrgKeyDown}
              className="grid sm:grid-cols-3 gap-3 mt-5">
              {ORG_CARDS.map((c) => {
                const selected = form.org_type === c.value
                return (
                  <button key={c.value} type="button" role="radio" aria-checked={selected}
                    data-org={c.value} tabIndex={selected ? 0 : -1}
                    onClick={() => pickOrg(c.value)}
                    className={`relative rounded-[10px] border border-[var(--border)] px-4 py-4 text-left min-h-11 pressable
                      ${selected ? 'bg-[var(--blue-tint)] shadow-[inset_0_0_0_2px_var(--blue)]' : 'hover:bg-[var(--surface-2)]'}`}>
                    {selected && <MSym name="check_circle" fill size={18} className="absolute top-2.5 right-2.5 text-[var(--blue-text)]" />}
                    <MSym name={c.icon} size={24} fill={selected} className={selected ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'} />
                    <div className="text-callout font-medium text-[var(--text)] mt-2">{c.title}</div>
                  </button>
                )
              })}
            </div>

            {/* 欄位:桌機兩欄。「專案邀請碼」不做(現行邀請=對方輸入你的 email,
                沒有邀請碼機制);密碼欄註冊需要,補在信箱旁 */}
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3 mt-5">
              <FloatField label="姓名" placeholder="姓名" autoComplete="name" value={form.full_name} onChange={set('full_name')} required />
              <FloatField label={ORG_NAME_LABEL[form.org_type]} placeholder="公司 / 單位" autoComplete="organization" value={form.company} onChange={set('company')} />
              <FloatField label="公務／公司信箱" type="email" placeholder="Email" autoComplete="email" value={form.email} onChange={set('email')} required />
              <div>
                <PasswordField label="密碼" placeholder="密碼（至少 8 碼，含大小寫英文與數字）" autoComplete="new-password"
                  value={form.password} onChange={set('password')} required minLength={8} />
                <p className="text-footnote text-[var(--text-3)] mt-1 pl-3.5">至少 8 碼，含大小寫英文與數字</p>
              </div>
            </div>

            {/* 資訊列:講清楚機關帳戶與平台後台的邊界 */}
            <div className="mt-4 rounded-[10px] bg-[var(--blue-tint)] px-4 py-3 flex items-start gap-2.5 text-body text-[var(--text)]">
              <MSym name="info" size={16} className="shrink-0 mt-0.5 text-[var(--blue-text)]" />
              機關帳戶可建立專案並開啟正式模式；平台管理後台不屬於專案角色，僅平台營運者可見。
            </div>

            <ErrorBanner msg={err} className="mt-3" />

            <Button type="submit" size="lg" busy={loading} className="w-full mt-5">
              {loading ? '處理中…' : '下一步：驗證信箱'}
            </Button>
            <div className="flex justify-center mt-2">
              <button type="button" onClick={() => setMode('signin')} className={TEXT_BTN}>
                已有帳戶？登入
              </button>
            </div>
          </form>
        )}
    </>
  )
}

// ── 設定新密碼(點重設信連結回來,recovery session 已生效)─────────────────
// ── 兩步驟驗證(帳密已對、session 仍 aal1;輸入 TOTP 6 位數升到 aal2)──────
// 成功後 store 的 auth listener 收到 MFA_CHALLENGE_VERIFIED 載入 profile → 自動導向。
// 「改用其他帳號」= 登出:aal1 的 session 留著沒有用,只會讓下次開頁又停在這裡。
function MfaForm({ verifyMfa, logout }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await verifyMfa(code)
    setBusy(false)
    if (error) { setErr(friendlyError(error, '驗證碼不正確或已過期，請看驗證器 App 重新輸入')); setCode('') }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <FloatField label="驗證碼" placeholder="6 位數驗證碼" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
        autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
      <ErrorBanner msg={err} />
      <Button type="submit" size="lg" busy={busy} disabled={code.length !== 6} className="w-full mt-1">
        {busy ? '驗證中…' : '驗證並登入'}
      </Button>
      <div className="text-center">
        <button type="button" onClick={() => logout()} className={TEXT_BTN}>改用其他帳號</button>
      </div>
    </form>
  )
}

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
      <div>
        <PasswordField label="新密碼" placeholder="新密碼（至少 8 碼，含大小寫英文與數字）" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} autoFocus />
        <p className="text-footnote text-[var(--text-3)] mt-1 pl-3.5">至少 8 碼，含大小寫英文與數字</p>
      </div>
      <PasswordField label="再輸入一次新密碼" placeholder="再輸入一次新密碼" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={8} />
      <ErrorBanner msg={err} />
      <Button type="submit" size="lg" busy={busy} className="w-full mt-1">
        {busy ? '更新中…' : '設定新密碼並登入'}
      </Button>
    </form>
  )
}

// ── Prototype 假登入（未設定 Supabase 時的 fallback）───────────────────
// 「選擇 demo 角色登入:」是 routes.spec 的定位文字;角色鈕以人名為無障礙名稱(helpers.loginAs)。
function RolePicker({ setCurrentUser, navigate }) {
  const pick = (u) => {
    setCurrentUser(u)
    navigate(defaultLandingPath(u.org_type)) // 機關/監造落在跨案總覽
  }
  return (
    <>
      <div className="text-footnote font-medium text-[var(--text-2)] mb-2">選擇 demo 角色登入：</div>
      <ul role="list" className="space-y-2">
        {users.map((u) => (
          <li key={u.user_id}>
            <button onClick={() => pick(u)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] pressable text-left min-h-11">
              <span className="w-9 h-9 rounded-full bg-[var(--blue-tint)] text-[var(--blue-text)] flex items-center justify-center text-callout font-semibold shrink-0" aria-hidden>{u.name[0]}</span>
              <span className="min-w-0">
                <span className="block text-callout font-medium text-[var(--text)]">{u.name}</span>
                <span className="block text-footnote text-[var(--text-2)] truncate">{u.label} · {u.company}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-center text-footnote text-[var(--text-3)] mt-5">點任一角色即可進入 prototype</p>
    </>
  )
}
