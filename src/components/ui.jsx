// Shared UI — brand styling (elevation surfaces, steel-blue primary, tonal chips)
import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'

export function Card({ title, action, children, className = '', bodyClass = 'p-5' }) {
  return (
    <div className={`bg-[var(--surface)] rounded-2xl border border-[var(--border-card)] [box-shadow:var(--shadow-card)] ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--border-2)]">
          <h3 className="font-semibold text-[var(--text)] text-sm tracking-tight">{title}</h3>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  )
}

// 圖框頁首(title block):左=頁名+說明,右=等寬字資訊格(工程代碼/日期…),底=粗+細雙墨線
export function PageHeader({ title, tagline, subtitle, meta = [], action }) {
  return (
    <div className="title-block">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold text-[var(--text)] tracking-[-0.02em] leading-tight">
            {title}
            {tagline && <span className="ml-2 text-sm font-normal text-[var(--text-3)]">{tagline}</span>}
          </h1>
          {subtitle && <p className="text-xs text-[var(--text-2)] mt-1 truncate">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {meta.length > 0 && (
            <dl className="hidden sm:flex items-stretch divide-x divide-[var(--border)] border border-[var(--border)] rounded">
              {meta.map((m) => (
                <div key={m.k} className="px-2.5 py-1 leading-tight">
                  <dt className="text-[9px] tracking-[0.1em] text-[var(--text-3)]">{m.k}</dt>
                  <dd className="text-[11px] num text-[var(--text)]">{m.v}</dd>
                </div>
              ))}
            </dl>
          )}
          {action}
        </div>
      </div>
    </div>
  )
}

// Material tonal chips (Google semantic colors)
const badgeColors = {
  slate: 'bg-[var(--slate-tint)] text-[var(--slate-text)]',
  blue: 'bg-[var(--blue-tint)] text-[var(--blue-text)]',
  green: 'bg-[var(--green-tint)] text-[var(--green-text)]',
  amber: 'bg-[var(--amber-tint)] text-[var(--amber-text)]',
  red: 'bg-[var(--red-tint)] text-[var(--red-text)]',
  purple: 'bg-[var(--purple-tint)] text-[var(--purple-text)]',
}

// Tonal chip — softened to a modern rounded tag (was hard 章戳 square)
export function Badge({ color = 'slate', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${badgeColors[color]} ${className}`}>{children}</span>
}

// Ball-in-court 責任標籤:一致的「球在誰手上」視覺。ball = { who, label }
const BALL_COLOR = { contractor: 'blue', supervisor: 'amber', owner: 'purple', design: 'slate', done: 'green' }
export function BallChip({ ball }) {
  if (!ball) return null
  return <Badge color={BALL_COLOR[ball.who] || 'slate'}>{ball.who === 'done' ? '✓' : '⏳'} {ball.label}</Badge>
}

// Pick a chip color from a status string
export function StatusBadge({ status }) {
  const map = {
    Review: 'amber', 'Not Started': 'slate', Submitted: 'blue', 'Submitted for Review': 'blue',
    'Under Review': 'amber', Approved: 'green', Closed: 'green', Rejected: 'red', Overdue: 'red',
    Open: 'red', 'In Progress': 'amber', '已上傳': 'slate', 'AI 已解析': 'purple',
    '草稿': 'slate', '已發布': 'green', '已送出': 'blue', '已產出': 'green', '施工中': 'blue',
    '審核中': 'amber', '核准': 'green', '核准(具註記)': 'green', '退回修正': 'red', '駁回': 'red', '已結案': 'green',
    '待回覆': 'amber', '已回覆': 'blue',
  }
  return <Badge color={map[status] || 'slate'}>{status}</Badge>
}

// Button hierarchy (modern-SaaS): one filled primary per context; everything else quiet.
//   primary  — the single main action (filled steel-blue)
//   secondary— common action (soft tinted fill, no loud border)
//   outline  — bordered, for neutral toolbar actions
//   ghost    — text-only tertiary
//   success  — confirm/approve (filled green)
//   danger   — destructive, filled red (real deletes only; use size="sm" ghost ✕ for row deletes)
const BTN_SIZES = {
  sm: 'px-2.5 py-1 text-xs gap-1 rounded-md',
  md: 'px-3.5 py-2 text-sm gap-1.5 rounded-lg',
  lg: 'px-5 py-2.5 text-sm gap-2 rounded-lg',
}
// 實心鈕頂緣一道極輕高光(材質受光感,§12 light catching)+ 半透明落影
const FILLED_SHADOW = '[box-shadow:0_1px_2px_rgba(22,32,43,.18),inset_0_1px_0_rgba(255,255,255,.16)]'
const BTN_VARIANTS = {
  primary: `bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] ${FILLED_SHADOW}`,
  secondary: 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border-2)]',
  outline: 'border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
  ghost: 'text-[var(--blue-text)] hover:bg-[var(--blue-tint)]',
  success: `bg-[var(--success)] text-white hover:bg-[var(--success-hover)] ${FILLED_SHADOW}`,
  danger: `bg-[var(--danger)] text-white hover:bg-[var(--danger-hover)] ${FILLED_SHADOW}`,
}
export const Button = forwardRef(function Button({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center font-medium whitespace-nowrap shrink-0 pressable
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)]/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface)]
        disabled:opacity-40 disabled:cursor-not-allowed ${BTN_SIZES[size] || BTN_SIZES.md} ${BTN_VARIANTS[variant] || BTN_VARIANTS.primary} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
})

export function Stat({ label, value, sub, color = 'text-[var(--text)]' }) {
  return (
    <div className="stat-card bg-[var(--surface)] rounded-2xl border border-[var(--border-card)] [box-shadow:var(--shadow-card)] px-4 py-3.5">
      <div className="text-[11px] text-[var(--text-3)] tracking-[0.06em]">{label}</div>
      <div className={`stat-value leading-tight font-semibold mt-1 tabular-nums tracking-[-0.01em] ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-3)] mt-1 tabular-nums leading-snug">{sub}</div>}
    </div>
  )
}

// Shared form controls (modern-SaaS: consistent height, soft border, focus ring).
// Pages still writing inline input classes should migrate to these on rollout.
const FIELD_BASE = 'w-full bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20 disabled:opacity-50'
export function Input({ className = '', ...props }) {
  return <input className={`${FIELD_BASE} ${className}`} {...props} />
}
export function Textarea({ className = '', ...props }) {
  return <textarea className={`${FIELD_BASE} resize-y ${className}`} {...props} />
}
export function Select({ className = '', children, ...props }) {
  return <select className={`${FIELD_BASE} pr-8 ${className}`} {...props}>{children}</select>
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-[var(--text)] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--text-3)] mt-1">{hint}</span>}
    </label>
  )
}

export function SourceTag({ doc, page, section }) {
  return (
    <div className="text-xs text-[var(--text-2)] bg-[var(--bg)] border border-[var(--border-2)] rounded-lg px-2.5 py-1.5">
      <FileText size={12} className="inline -mt-0.5 mr-1 text-[var(--text-3)]" aria-hidden /><span className="font-medium text-[var(--text)]">{doc}</span> · {page}
      {section && <span className="block text-[var(--text-3)] mt-0.5">{section}</span>}
    </div>
  )
}

export function Empty({ children }) {
  return <div className="text-center text-[var(--text-3)] text-sm py-10">{children}</div>
}

// 寫入/載入失敗的統一橫幅(U-03):所有頁面共用同一份樣式與關閉行為,
// 不再各頁複製 div。msg 為空(null/'')時不渲染,呼叫端可無條件擺著。
export function ErrorBanner({ msg, onClose, className = '' }) {
  if (!msg) return null
  return (
    <div className={`flex items-start justify-between gap-2 text-sm bg-[var(--red-tint)] border border-[var(--red-text)]/25 text-[var(--red-text)] rounded-lg px-3 py-2 enter-row ${className}`}>
      <span>{msg}</span>
      {onClose && <button onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity" aria-label="關閉錯誤訊息">✕</button>}
    </div>
  )
}

// 前置條件空狀態(P1-05):明確講「缺什麼、輪到誰、完成後解鎖什麼」+ 單一主 CTA。
// 對無權限角色不給死按鈕,改顯示責任方(who)。to=CTA 連結;cta=按鈕文字;who=負責角色說明。
export function PrerequisiteEmptyState({ title, need, unlocks, to, cta, who }) {
  return (
    <div className="text-center py-10 px-4">
      {title && <div className="text-sm font-medium text-[var(--text)] mb-1">{title}</div>}
      <div className="text-sm text-[var(--text-2)] max-w-md mx-auto">{need}</div>
      {unlocks && <div className="text-xs text-[var(--text-3)] mt-1.5 max-w-md mx-auto">完成後即可使用：{unlocks}</div>}
      <div className="mt-4">
        {to && cta
          ? <Link to={to}><Button>{cta}</Button></Link>
          : who && <span className="text-xs text-[var(--text-3)]">{who}</span>}
      </div>
    </div>
  )
}
