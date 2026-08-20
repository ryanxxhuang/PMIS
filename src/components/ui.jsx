// Shared UI — Google Workspace styling(design_handoff README):白卡 12px、
// 藥丸按鈕、五語意色票、24px/400 頁首＋chips 分頁。顏色一律走 index.css token。
import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import PageTabs from './PageTabs.jsx'

// 卡殼單一字串:Card/Stat/Surface 共用。rounded-2xl 的「class 名」是 e2e xpath
// 合約(5 處 ancestor 選擇器),值已在 @theme 改為 12px——名不動、視覺照規格。
const SURFACE = 'min-w-0 bg-[var(--surface)] rounded-2xl border border-[var(--border-card)] [box-shadow:var(--shadow-card)]'

// 自寫卡殼的頁面(Portfolio/Agent/Dashboard…)改吃這個,不再各自複製 class 字串
export function Surface({ as: Tag = 'div', className = '', children, ...props }) {
  return <Tag className={`${SURFACE} ${className}`} {...props}>{children}</Tag>
}

export function Card({ title, action, children, className = '', bodyClass = 'p-5', ...rest }) {
  // ...rest 直通根節點:呼叫端的 aria-busy/data-* 才不會被靜默丟棄
  return (
    <div className={`${SURFACE} ${className}`} {...rest}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--border-2)]">
          <h3 className="font-medium text-[var(--text)] text-[15px]">{title}</h3>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  )
}

// Workspace 頁首:標題 24px/400+說明 13px,右側資訊格與動作鈕;
// 標題塊下方自動長出工作面 chips 分頁列(PageTabs 反查 navConfig,26 頁零改動)。
export function PageHeader({ title, tagline, subtitle, meta = [], action }) {
  return (
    <div className="title-block">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-4xl">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h1 className="text-2xl font-normal text-[var(--text)] tracking-[-0.005em] leading-tight">{title}</h1>
            {tagline && <span className="text-sm font-normal text-[var(--text-3)]">{tagline}</span>}
          </div>
          {subtitle && <p className="text-[13px] leading-relaxed text-[var(--text-2)] mt-1.5 max-w-[660px]">{subtitle}</p>}
        </div>
        <div className="flex w-full sm:w-auto flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          {meta.length > 0 && (
            <dl className="hidden sm:flex items-stretch divide-x divide-[var(--border-2)] border border-[var(--border-2)] rounded-lg bg-[var(--surface)]">
              {meta.map((m) => (
                <div key={m.k} className="px-2.5 py-1 leading-tight">
                  {/* 10px+text-2:9px 加寬字距在 1x 螢幕幾乎不可讀,對比也不足(W8-5) */}
                  <dt className="text-[10px] text-[var(--text-2)]">{m.k}</dt>
                  <dd className="text-[11px] num text-[var(--text)]">{m.v}</dd>
                </div>
              ))}
            </dl>
          )}
          {action && <div className="w-full sm:w-auto">{action}</div>}
        </div>
      </div>
      <PageTabs />
    </div>
  )
}

// 五語意狀態色票(README 第三版):22px 高、6px 圓角、11px/500,顏色+文字並存。
// color key 沿用舊名:red=danger、amber=warn、green=ok、blue=info、slate=mute
// (purple 留給物調等非五語意標記)。呼叫端零改動。
const badgeColors = {
  slate: 'bg-[var(--slate-tint)] text-[var(--slate-text)]',
  blue: 'bg-[var(--blue-tint)] text-[var(--blue-text)]',
  green: 'bg-[var(--green-tint)] text-[var(--green-text)]',
  amber: 'bg-[var(--amber-tint)] text-[var(--amber-text)]',
  red: 'bg-[var(--red-tint)] text-[var(--red-text)]',
  purple: 'bg-[var(--purple-tint)] text-[var(--purple-text)]',
}

export function Badge({ color = 'slate', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[11px] font-medium whitespace-nowrap ${badgeColors[color]} ${className}`}>{children}</span>
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

// Button hierarchy(Workspace):藥丸 100px 圓角、36px 高;one filled primary per context。
//   primary  — the single main action(實心 M3 藍;深色淺藍底深字,靠 --primary-fg)
//   secondary— 白底藍字+邊框(Google secondary)
//   outline  — bordered neutral toolbar actions
//   ghost    — text-only tertiary
//   success  — confirm/approve(filled green)
//   danger   — destructive, filled red(real deletes only)
// busy=true:送出中——disabled+progress_activity 旋轉(README 狀態規格)。
// max-sm:min-h-11:手機主要操作至少 44px(W8-5),a11y spec 有 boundingBox 斷言。
const BTN_SIZES = {
  sm: 'h-8 px-3 text-xs gap-1 rounded-full max-sm:min-h-11',
  md: 'h-9 px-4 text-sm gap-1.5 rounded-full max-sm:min-h-11',
  lg: 'h-10 px-5 text-sm gap-2 rounded-full max-sm:min-h-11',
}
const BTN_VARIANTS = {
  primary: 'bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]',
  secondary: 'bg-[var(--surface)] text-[var(--blue-text)] border border-[var(--border)] hover:bg-[var(--blue-tint)]',
  outline: 'border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
  ghost: 'text-[var(--blue-text)] hover:bg-[var(--blue-tint)]',
  success: 'bg-[var(--success)] text-white hover:bg-[var(--success-hover)]',
  danger: 'bg-[var(--danger)] text-white hover:bg-[var(--danger-hover)]',
}
// 不能用 <button> 的呼叫端(label 檔案上傳鈕、<a>)用這支拿同一套皮,
// 別再手抄 bg-[var(--primary)] 殼——散裝複本正是深色對比漏修的來源
export const buttonClass = (variant = 'primary', size = 'md') =>
  `inline-flex items-center justify-center font-medium whitespace-nowrap shrink-0 pressable
    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]
    ${BTN_SIZES[size] || BTN_SIZES.md} ${BTN_VARIANTS[variant] || BTN_VARIANTS.primary}`

// 焦點樣式用 outline 而非 ring(W8-5):ring-offset 寫死底色會在非 --surface 背景上
// 露出白色缺口,ring(box-shadow)又會被 overflow-hidden 父層裁切;outline 不佔版面流、不被裁切。
export const Button = forwardRef(function Button({ variant = 'primary', size = 'md', busy = false, disabled, className = '', children, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center font-medium whitespace-nowrap shrink-0 pressable
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]
        disabled:opacity-40 disabled:cursor-not-allowed ${BTN_SIZES[size] || BTN_SIZES.md} ${BTN_VARIANTS[variant] || BTN_VARIANTS.primary} ${className}`}
      {...props}
    >
      {busy && <MSym name="progress_activity" size={16} className="msym-spin" />}
      {children}
    </button>
  )
})

export function Stat({ label, value, sub, color = 'text-[var(--text)]' }) {
  return (
    <div className={`stat-card ${SURFACE} px-4 py-3.5`}>
      <div className="text-[11px] text-[var(--text-2)]">{label}</div>
      <div className={`stat-value leading-tight font-normal mt-1 tabular-nums tracking-[-0.01em] ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-3)] mt-1 tabular-nums leading-snug">{sub}</div>}
    </div>
  )
}

// Shared form controls(8px 圓角、focus 轉主色)。頁面不要再自寫 input class 字串——
// 歷史複本已收斂到這裡(DefectTracker/ProjectSetup/Login 曾各抄一份)。
// max-sm:min-h-11:手機表單控件補到 44px(W8-5);Textarea 本來就更高,min-h 不會縮小它
export const FIELD_BASE = 'w-full bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20 disabled:opacity-50 max-sm:min-h-11'
export function Input({ className = '', ...props }) {
  return <input className={`${FIELD_BASE} ${className}`} {...props} />
}
export function Textarea({ className = '', ...props }) {
  return <textarea className={`${FIELD_BASE} resize-y ${className}`} {...props} />
}
export function Select({ className = '', children, ...props }) {
  return <select className={`${FIELD_BASE} pr-8 ${className}`} {...props}>{children}</select>
}

// required 只影響視覺標示:必填語意仍由控件自身的原生 required 提供,所以紅＊
// 掛 aria-hidden——否則報讀器會把「必填」唸兩次。預設 false,既有呼叫端輸出不變。
export function Field({ label, children, hint, required = false }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-[var(--text)] mb-1">
        {label}{required && <span className="text-[var(--red-text)] ml-0.5" aria-hidden>＊</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-[var(--text-3)] mt-1">{hint}</span>}
    </label>
  )
}

export function SourceTag({ doc, page, section }) {
  return (
    <div className="text-xs text-[var(--text-2)] bg-[var(--bg)] border border-[var(--border-2)] rounded-lg px-2.5 py-1.5">
      <MSym name="description" size={12} className="inline -mt-0.5 mr-1 text-[var(--text-3)]" /><span className="font-medium text-[var(--text)]">{doc}</span> · {page}
      {section && <span className="block text-[var(--text-3)] mt-0.5">{section}</span>}
    </div>
  )
}

// 空狀態(README 狀態規格):置中 40px inbox 圖示+說明。children=說明文字,
// 呼叫端可自帶連結/按鈕;title 選填(多數空狀態一句話就夠)。
export function Empty({ icon = 'inbox', title, children }) {
  return (
    <div className="text-center py-10 px-4">
      <MSym name={icon} size={40} className="text-[var(--text-3)] opacity-60" />
      {title && <div className="text-sm font-medium text-[var(--text)] mt-2.5">{title}</div>}
      <div className={`text-sm text-[var(--text-3)] leading-relaxed ${title ? 'mt-1' : 'mt-2'}`}>{children}</div>
    </div>
  )
}

// 骨架屏:列高與欄位位置必須等於載入後(README:載入完成不位移)。
// aria-hidden——載入中對報讀器保持安靜,由頁面自己的 loading 文案/aria-busy 承擔語意。
export function Skeleton({ className = '', style }) {
  return <div aria-hidden className={`skeleton ${className}`} style={style} />
}
// 清單場景的現成組合:圓點+兩條線 × rows(對應原型 states 頁的骨架樣板)
export function SkeletonList({ rows = 3, label = '載入中…' }) {
  const widths = [['78%', '44%'], ['64%', '52%'], ['86%', '38%']]
  // 外層不能 aria-hidden——那會讓報讀器把載入中頁面讀成「什麼都沒有」;
  // 視覺列自身 hidden(Skeleton 內建),語意由 sr-only 文字承擔
  return (
    <div className="space-y-3 py-1">
      <span className="sr-only" role="status">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="w-5 h-5 !rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-[11px] mb-1.5" style={{ width: widths[i % 3][0] }} />
            <Skeleton className="h-[9px]" style={{ width: widths[i % 3][1] }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// 寫入/載入失敗的統一橫幅(U-03):所有頁面共用同一份樣式與關閉行為,
// 不再各頁複製 div。msg 為空(null/'')時不渲染,呼叫端可無條件擺著。
// onRetry 選填:查詢失敗要說失敗並給重試,不可靜默當成 0 筆(README 狀態規格)。
export function ErrorBanner({ msg, onClose, onRetry, className = '' }) {
  if (!msg) return null
  return (
    <div className={`flex items-start gap-2.5 text-sm bg-[var(--red-tint)] text-[var(--red-text)] rounded-lg px-3.5 py-2.5 enter-row ${className}`}>
      <MSym name="error" size={18} className="mt-px" />
      <span className="flex-1 leading-relaxed">{msg}</span>
      {onRetry && <button onClick={onRetry} className="shrink-0 font-medium underline opacity-90 hover:opacity-100">重試</button>}
      {/* p-2 -m-1:擴大 ✕ 命中區,負 margin 吸收 padding、橫幅高度不變(W8-5) */}
      {onClose && <button onClick={onClose} className="shrink-0 p-2 -m-1 opacity-60 hover:opacity-100 transition-opacity" aria-label="關閉錯誤訊息">✕</button>}
    </div>
  )
}

// ── 表格互動三件組(README「表格:排序、篩選、分頁」)──────────────────────
// 排序/分頁的資料端在 src/lib/useTable.js(client-side 表用);伺服器分頁的表
// 只共用 TablePager 皮。樹狀表(BOQ/Valuation)刻意不套,理由見 useTable.js。

// 排序表頭:th 內是 button(整格可點),點擊循環 asc/desc;active 欄文字轉
// accent 並附 16px 箭頭,th 帶 aria-sort 供報讀器。字級/內距/對齊由呼叫端
// className 決定(Admin 沿用自己的 TH/THR 常數)——這裡只負責互動與 active 視覺。
export function SortableTh({ label, field, sort, onSort, numeric = false, align = 'left', className = '' }) {
  const active = sort?.field === field
  return (
    <th className={className}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => onSort(field, numeric)}
        className={`w-full max-sm:min-h-11 inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''} ${active ? 'text-[var(--blue-text)]' : 'hover:text-[var(--text)]'}`}>
        {label}
        {active && <MSym name={sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'} size={16} />}
      </button>
    </th>
  )
}

// 篩選 chip:未套用=白底+前置圖示(filter_list/calendar_month);已套用=淺藍底
// 深藍字+尾端 close。class 字面值與 PageTabs 的 CHIP_BASE/CHIP_ON/CHIP_OFF 對齊
// ——刻意複製而非 import:不想再加深 ui↔PageTabs 的耦合,改 chips 皮時兩處一起動。
// 同一顆 button 負責套用與移除(aria-pressed 供報讀器分辨),close 只是視覺提示。
export function FilterChip({ label, icon = 'filter_list', active = false, onToggle }) {
  return (
    <button type="button" aria-pressed={active} onClick={onToggle}
      className={`h-8 max-sm:min-h-11 shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-lg text-[13px] font-medium whitespace-nowrap pressable ${active
        ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]'
        : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`}>
      {!active && <MSym name={icon} size={16} />}
      {label}
      {active && <MSym name="close" size={16} />}
    </button>
  )
}

// 卡底分頁列:「每頁列數 25 ▾ · 1–25 / 106 · ‹ ›」,靠右、數字 tabular。
// 不可用的箭頭降 --border 且 disabled(規格);頁碼 0-based,對外顯示才 +1。
// select 用裸樣式而非 FIELD_BASE——這裡要的是行內小控件,不是全寬表單欄位。
// disabled=true 供伺服器分頁的表在載入中整組鎖住(client-side 表用不到)。
export function TablePager({ page, pageSize, total, onPage, onPageSize, sizes = [10, 25, 50], disabled = false, className = '' }) {
  const start = total === 0 ? 0 : page * pageSize + 1
  const end = Math.min(total, (page + 1) * pageSize)
  const canPrev = !disabled && page > 0
  const canNext = !disabled && end < total
  const arrow = (ok) => `w-8 h-8 max-sm:min-h-11 max-sm:min-w-11 grid place-items-center rounded-full ${ok ? 'text-[var(--text-2)] hover:bg-[var(--surface-2)] pressable' : 'text-[var(--border)]'}`
  return (
    <div className={`flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-4 py-1.5 border-t border-[var(--border-2)] text-[13px] text-[var(--text-2)] ${className}`}>
      <label className="flex items-center gap-1.5">
        每頁列數
        <select value={pageSize} disabled={disabled} aria-label="每頁列數"
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="num bg-transparent border border-[var(--border)] rounded-md px-1 py-0.5 max-sm:min-h-11 text-[13px] text-[var(--text)] disabled:opacity-50">
          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <span className="num">{start}–{end} / {total}</span>
      <div className="flex items-center">
        <button type="button" onClick={() => onPage(page - 1)} disabled={!canPrev} aria-label="上一頁" className={arrow(canPrev)}>
          <MSym name="chevron_left" size={20} />
        </button>
        <button type="button" onClick={() => onPage(page + 1)} disabled={!canNext} aria-label="下一頁" className={arrow(canNext)}>
          <MSym name="chevron_right" size={20} />
        </button>
      </div>
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
        {/* Link 包 Button 是巢狀互動元素:內層退出 tab 序避免 Tab 停兩次,
            Link 給 inline-flex+圓角讓全域 focus outline 落在正確形狀上(W8-5 最小修法,不改 Button API) */}
        {to && cta
          ? <Link to={to} className="inline-flex rounded-full"><Button tabIndex={-1}>{cta}</Button></Link>
          : who && <span className="text-xs text-[var(--text-3)]">{who}</span>}
      </div>
    </div>
  )
}
