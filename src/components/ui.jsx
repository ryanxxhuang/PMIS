// Shared UI — Apple style(2026-09-11 定案,取代 W9 Google Workspace/M3):白卡 12px
// 半像素描邊、圓角矩形按鈕(28–40px)、五語意色票、semibold large title。
// 顏色一律走 index.css token;字級一律走 @theme 的 Apple 階梯(text-caption…text-title1),
// 不再寫 text-[Npx]。規範文件:docs/UIUX-Apple-設計規範.md,改皮之前先讀那份。
// ⚠️ 本輪換皮的鐵律:字級只准「等值或更小」的替換(e2e 全路由 375/1024px 有
// scrollWidth <= clientWidth 斷言),任何一階放大都會整片翻紅。
import { forwardRef, useRef } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import PageTabs from './PageTabs.jsx'

// 表頭字級單一字串:各頁 <th> 的字型層(對齊/內距由各表自決)。
// 全站曾有 uppercase tracking-wide / text-3 / 無 font-medium 三種寫法,統一到這份。
// text-caption=11px,與舊 text-[11px] 等值,只是多帶階梯的行高與字距。
export const THEAD_CLS = 'text-caption font-medium text-[var(--text-2)]'

// 卡殼單一字串:Card/Stat/Surface 共用。rounded-2xl 的「class 名」是 e2e xpath
// 合約(7 條 ancestor::div[contains(@class,"rounded-2xl")] 選擇器靠它定位卡殼),
// 值已在 @theme 改為 12px——名一個字都不能動、視覺照規格。
const SURFACE = 'min-w-0 bg-[var(--surface)] rounded-2xl border border-[var(--border-card)] [box-shadow:var(--shadow-card)]'

// ── 鍵盤焦點(Apple):3px 主色 18% 外光暈 + 1px 主色描邊 ──────────────────
// 光暈用 outline(3px、offset 0、--focus-glow):不佔版面流,不像 ring-offset 那樣
// 寫死一層底色在非 --surface 背景露白,也不像 ring(box-shadow)被 overflow-hidden
// 父層裁掉——W8-5 踩過的兩個坑,所以仍是 outline 不是 ring。
// 1px 描邊不另畫一層:有框的控件(secondary/outline 鈕、表單欄位)把自己的 border
// 轉成 --focus 就是那 1px;實心鈕(primary/success/danger)描邊與底同色本來就看不見,
// 只留光暈,與 macOS 實心按鈕的焦點呈現一致;ghost 無框同理。
// 三個 outline 屬性要寫齊:少一個,index.css @layer base 的 2px/offset 2px 就會漏進來。
const FOCUS_VISIBLE = 'focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-glow)] focus-visible:border-[var(--focus)]'

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
          {/* text-callout=15px 與舊 text-[15px] 等值;卡標題升 semibold 是 Apple 的
              分區標題字重,CJK 字寬不隨字重變,不影響溢位斷言 */}
          <h3 className="font-semibold text-[var(--text)] text-callout">{title}</h3>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  )
}

// 頁首(Apple large title):標題 semibold + 負字距(HIG §Typography),不是 W9 的 24px/400;
// 右側資訊格與動作鈕;標題塊下方自動長出工作面 chips 分頁列(PageTabs 反查 navConfig,26 頁零改動)。
// 標題用 text-title2(22px)不用 title1(28px):比舊 24px 小 2px,e2e 全路由 375/1024px
// 的 scrollWidth 斷言絕不會因此翻紅;字距/行高交給階梯,不再自帶 tracking/leading。
export function PageHeader({ title, tagline, subtitle, meta = [], action }) {
  return (
    <div className="title-block">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-4xl">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h1 className="text-title2 font-semibold text-[var(--text)]">{title}</h1>
            {tagline && <span className="text-body font-normal text-[var(--text-3)]">{tagline}</span>}
          </div>
          {subtitle && <p className="text-body leading-relaxed text-[var(--text-2)] mt-1.5 max-w-[660px]">{subtitle}</p>}
        </div>
        <div className="flex w-full sm:w-auto flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          {meta.length > 0 && (
            <dl className="hidden sm:flex items-stretch divide-x divide-[var(--border-2)] border border-[var(--border-2)] rounded-lg bg-[var(--surface)]">
              {meta.map((m) => (
                <div key={m.k} className="px-2.5 py-1 leading-tight">
                  {/* 10px+text-2:9px 加寬字距在 1x 螢幕幾乎不可讀,對比也不足(W8-5)。
                      階梯最小一階是 caption 11px,dt 刻意停在 10px 不升——本輪禁止放大
                      既有字級(1024px 的 meta 列橫向最擠),留待 meta 版式重看時一起處理 */}
                  <dt className="text-micro text-[var(--text-2)]">{m.k}</dt>
                  <dd className="text-caption num text-[var(--text)]">{m.v}</dd>
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

// 五語意狀態色票:22px 高、6px 圓角(rounded-md)、caption/500,顏色+文字並存。
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
  return <span className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-caption font-medium whitespace-nowrap ${badgeColors[color]} ${className}`}>{children}</span>
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

// ── 狀態圓點 ───────────────────────────────────────────────────────────────
// 取代各頁自寫的 w-2 h-2 rounded-full bg-[…]。色鍵沿用 badge(slate/blue/green/amber/red/purple)。
// 圓點是「圖形」,門檻是 WCAG 1.4.11 的 3:1 而非文字的 4.5:1;但淺灰也過不了 3:1,
// 所以 slate 用 --dot-mute 而不是 --text-3 以外的任何淺灰。
// 四個語意色用 *-text 而不是 *-tint / --green-bar / --danger:tint 是底色;
// --green-bar #34c759 在白卡只有 2.22、--danger 深色對 --surface 只有 2.24,看得到但不合規。
// 下列是對 --surface / --bg / --surface-2 的實算(亮 | 暗),改色前要重算:
//   dot-mute    4.15 / 3.81 / 3.62 | 4.27 / 5.22 / 3.48
//   blue        4.70 / 4.31 / 4.10 | 4.31 / 5.26 / 3.51
//   green-text  6.58 / 6.05 / 5.75 | 7.71 / 9.41 / 6.28
//   amber-text  7.23 / 6.64 / 6.31 | 8.46 / 10.33 / 6.89
//   red-text    7.18 / 6.60 / 6.27 | 6.10 / 7.45 / 4.97
//   purple-text 7.86 / 7.22 / 6.86 | 7.12 / 8.69 / 5.80
// aria-hidden:顏色不能是唯一資訊載體(WCAG 1.4.1),語意由旁邊的文字承擔。
const dotColors = {
  slate: 'bg-[var(--dot-mute)]',
  blue: 'bg-[var(--blue)]',
  green: 'bg-[var(--green-text)]',
  amber: 'bg-[var(--amber-text)]',
  red: 'bg-[var(--red-text)]',
  purple: 'bg-[var(--purple-text)]',
}
export function Dot({ color = 'slate', size = 7, className = '' }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${dotColors[color] || dotColors.slate} ${className}`} style={{ width: size, height: size }} />
}

// Button hierarchy(Apple):圓角矩形、28–40px 高;one filled primary per context。
//   primary  — the single main action(實心主色;深色是淺藍底深字,靠 --primary-fg,
//              絕不寫死 text-white——白字對深色 --primary 只有 3.65)
//   secondary— 白底藍字+邊框
//   outline  — bordered neutral toolbar actions
//   ghost    — text-only tertiary
//   success  — confirm/approve(filled green;深色仍配白字,值已算過 >= AA)
//   danger   — destructive, filled red(real deletes only;同上)
// busy=true:送出中——disabled+progress_activity 旋轉。
// 去藥丸:sm/md 用 rounded-lg(8px)、lg 用 10px,取代 W9 的 rounded-full。
// 高度只降不升(sm 32→28、md 36→32、lg 40 不動),避免動到溢位斷言;
// lg 字級 14→15(text-callout)是本檔唯一放大的一處:四個呼叫端全是 Login 的 px-8/w-full
// 送出鈕與 Dashboard 的 w-full 手機鈕,標籤 2–4 個字,沒有溢位可能。
// 字重 font-medium:Apple 控件的 510 在 web 上最接近 500。
// max-md:min-h-11:手機主要操作至少 44px(W8-5)。斷點必須跟「手機層」一致——
// BottomNav 是 md:hidden(<768),所以觸控目標也走 max-md;W9 初版寫成 max-sm(<640)
// 會讓 640-767(iPad mini 直式 744px)拿到手機版面卻是桌機尺寸的觸控目標。
const BTN_SIZES = {
  sm: 'h-7 px-3 text-footnote gap-1 rounded-lg max-md:min-h-11',
  md: 'h-8 px-4 text-body gap-1.5 rounded-lg max-md:min-h-11',
  lg: 'h-10 px-5 text-callout gap-2 rounded-[10px] max-md:min-h-11',
}
const BTN_VARIANTS = {
  primary: 'bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]',
  secondary: 'bg-[var(--surface)] text-[var(--blue-text)] border border-[var(--border)] hover:bg-[var(--blue-tint)]',
  outline: 'border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
  ghost: 'text-[var(--blue-text)] hover:bg-[var(--blue-tint)]',
  success: 'bg-[var(--success)] text-white hover:bg-[var(--success-hover)]',
  danger: 'bg-[var(--danger)] text-white hover:bg-[var(--danger-hover)]',
}
// buttonClass 與 Button 共用同一段底,焦點樣式只在 FOCUS_VISIBLE 一處定義
const BTN_BASE = `inline-flex items-center justify-center font-medium whitespace-nowrap shrink-0 pressable ${FOCUS_VISIBLE}`

// 不能用 <button> 的呼叫端(label 檔案上傳鈕、<a>)用這支拿同一套皮,
// 別再手抄 bg-[var(--primary)] 殼——散裝複本正是深色對比漏修的來源
export const buttonClass = (variant = 'primary', size = 'md') =>
  `${BTN_BASE} ${BTN_SIZES[size] || BTN_SIZES.md} ${BTN_VARIANTS[variant] || BTN_VARIANTS.primary}`

export const Button = forwardRef(function Button({ variant = 'primary', size = 'md', busy = false, disabled, className = '', children, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || busy}
      className={`${BTN_BASE} disabled:opacity-40 disabled:cursor-not-allowed ${BTN_SIZES[size] || BTN_SIZES.md} ${BTN_VARIANTS[variant] || BTN_VARIANTS.primary} ${className}`}
      {...props}
    >
      {busy && <MSym name="progress_activity" size={16} className="msym-spin" />}
      {children}
    </button>
  )
})

// ── 分段控制(macOS/iOS Segmented Control):同一視圖內的「顯示模式」切換 ────────
// 外框 --surface-2 底、2px 內距、9px 圓角;選中段 --surface 底(亮色即白、深色即卡面)
// + --shadow-card、7px 圓角——內外圓角差 2px 正好等於內距,內段才與外框同心。
// 語意是 role=tablist/tab(切的是同一份資料的呈現,不是路由)。工作面分頁是 PageTabs,
// 它刻意不是 tablist(e2e/routes.spec.js 釘 /requirements 的 tablist 數為 0),
// 不要拿 Segmented 做導覽。
// 鍵盤:←/→ 循環、Home/End 首尾,移動即選取(WAI-ARIA tabs 自動啟用模式);
// roving tabindex 讓 Tab 鍵在整組只停一次。value 對不到任何選項時沒有選中段,
// 但第一段仍可 Tab 到,鍵盤不會被鎖在外面。
// 焦點:光暈畫在外框(:has(:focus-visible)),1px 描邊畫在該段內側(負 offset)——
// 外框有 overflow-x-auto,會裁掉子元素往外長的 outline,光暈不能掛在段上;
// 不支援 :has 的舊瀏覽器仍看得到內側描邊,焦點不會消失。這也正是 macOS 的畫法:
// 焦點環包整個控件,不包單一段。
// overflow-x-auto + max-w-full:選項多於手機寬度時在控件內捲,不撐寬頁面
// (e2e 全路由 375px 的 scrollWidth 斷言)。
// ...rest 直通 tablist 根節點:呼叫端要給 aria-label,無名的 tablist 對報讀器只是「分頁」。
const SEG_SIZES = {
  sm: 'h-6 px-2.5 text-footnote',
  md: 'h-7 px-3 text-body',
}
export function Segmented({ value, onChange, options, size = 'md', className = '', ...rest }) {
  const refs = useRef([])
  const idx = options.findIndex((o) => o.value === value)
  const onKeyDown = (e) => {
    const n = options.length
    if (!n) return
    const cur = idx < 0 ? 0 : idx
    let next
    if (e.key === 'ArrowRight') next = (cur + 1) % n
    else if (e.key === 'ArrowLeft') next = (cur - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else return
    e.preventDefault()
    onChange?.(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div role="tablist" onKeyDown={onKeyDown}
      className={`inline-flex max-w-full overflow-x-auto p-[2px] rounded-[9px] bg-[var(--surface-2)]
        has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-0 has-[:focus-visible]:outline-[var(--focus-glow)] ${className}`}
      {...rest}>
      {options.map((o, i) => {
        const on = i === idx
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on}
            tabIndex={on || (idx < 0 && i === 0) ? 0 : -1}
            ref={(el) => { refs.current[i] = el }}
            onClick={() => onChange?.(o.value)}
            className={`${SEG_SIZES[size] || SEG_SIZES.md} max-md:min-h-11 shrink-0 inline-flex items-center gap-1 rounded-[7px] font-medium whitespace-nowrap pressable
              focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--focus)]
              ${on ? 'bg-[var(--surface)] text-[var(--text)] [box-shadow:var(--shadow-card)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}>
            {o.label}
            {o.count != null && <span className={`num text-caption ${on ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}`}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Stat({ label, value, sub, color = 'text-[var(--text)]' }) {
  return (
    <div className={`stat-card ${SURFACE} px-4 py-3.5`}>
      <div className="text-caption text-[var(--text-2)]">{label}</div>
      {/* 數值字級由 index.css 的 .stat-value 以 container query 決定(卡寬縮就縮),
          這裡只給字重與字距:Apple 的大數字是中粗+緊字距;字距收緊剛好抵掉字重帶來的寬度 */}
      <div className={`stat-value leading-tight font-medium mt-1 tabular-nums tracking-[-0.02em] ${color}`}>{value}</div>
      {sub && <div className="text-caption text-[var(--text-3)] mt-1 tabular-nums leading-snug">{sub}</div>}
    </div>
  )
}

// Shared form controls(8px 圓角、focus 轉主色)。頁面不要再自寫 input class 字串——
// 歷史複本已收斂到這裡(DefectTracker/ProjectSetup/Login 曾各抄一份)。
// 焦點用 :focus 不用 :focus-visible:文字欄位滑鼠點進去也要亮框(Apple 文字欄位行為)。
// 光暈+描邊的做法與 FOCUS_VISIBLE 同一套(outline 光暈、border 轉 --focus 當 1px 描邊),
// 不再用 ring——理由見 FOCUS_VISIBLE。
// text-body(13px)取代 text-sm(14px):macOS 表單控件的內文尺寸;都 <16px,
// iOS Safari 聚焦縮放行為與之前相同,沒有新回歸。
// max-md:min-h-11:手機表單控件補到 44px(W8-5);Textarea 本來就更高,min-h 不會縮小它
export const FIELD_BASE = 'w-full bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg px-3 py-2 text-body transition-colors placeholder:text-[var(--text-3)] focus:outline-[3px] focus:outline-offset-0 focus:outline-[var(--focus-glow)] focus:border-[var(--focus)] disabled:opacity-50 max-md:min-h-11'
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
      <span className="block text-body font-medium text-[var(--text)] mb-1">
        {label}{required && <span className="text-[var(--red-text)] ml-0.5" aria-hidden>＊</span>}
      </span>
      {children}
      {hint && <span className="block text-footnote text-[var(--text-3)] mt-1">{hint}</span>}
    </label>
  )
}

export function SourceTag({ doc, page, section }) {
  return (
    <div className="text-footnote text-[var(--text-2)] bg-[var(--bg)] border border-[var(--border-2)] rounded-lg px-2.5 py-1.5">
      <MSym name="description" size={12} className="inline -mt-0.5 mr-1 text-[var(--text-3)]" /><span className="font-medium text-[var(--text)]">{doc}</span> · {page}
      {section && <span className="block text-[var(--text-3)] mt-0.5">{section}</span>}
    </div>
  )
}

// 空狀態:置中 40px inbox 圖示+說明。children=說明文字,
// 呼叫端可自帶連結/按鈕;title 選填(多數空狀態一句話就夠)。
export function Empty({ icon = 'inbox', title, children }) {
  return (
    <div className="text-center py-10 px-4">
      <MSym name={icon} size={40} className="text-[var(--text-3)] opacity-60" />
      {title && <div className="text-body font-medium text-[var(--text)] mt-2.5">{title}</div>}
      <div className={`text-body text-[var(--text-3)] leading-relaxed ${title ? 'mt-1' : 'mt-2'}`}>{children}</div>
    </div>
  )
}

// 骨架屏:列高與欄位位置必須等於載入後(載入完成不位移)。
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
// onRetry 選填:查詢失敗要說失敗並給重試,不可靜默當成 0 筆。
export function ErrorBanner({ msg, onClose, onRetry, className = '' }) {
  if (!msg) return null
  return (
    <div className={`flex items-start gap-2.5 text-body bg-[var(--red-tint)] text-[var(--red-text)] rounded-lg px-3.5 py-2.5 enter-row ${className}`}>
      <MSym name="error" size={18} className="mt-px" />
      <span className="flex-1 leading-relaxed">{msg}</span>
      {onRetry && <button onClick={onRetry} className="shrink-0 font-medium underline opacity-90 hover:opacity-100">重試</button>}
      {/* p-2 -m-1:擴大 ✕ 命中區,負 margin 吸收 padding、橫幅高度不變(W8-5) */}
      {onClose && <button onClick={onClose} className="shrink-0 p-2 -m-1 opacity-60 hover:opacity-100 transition-opacity" aria-label="關閉錯誤訊息">✕</button>}
    </div>
  )
}

// ── 表格互動三件組(排序、篩選、分頁)──────────────────────────────────────
// 排序/分頁的資料端在 src/lib/useTable.js(client-side 表用);伺服器分頁的表
// 只共用 TablePager 皮。樹狀表(BOQ/Valuation)刻意不套,理由見 useTable.js。

// 排序表頭:th 內是 button(整格可點),點擊循環 asc/desc;active 欄文字轉
// 主色並附 16px 箭頭,th 帶 aria-sort 供報讀器。字級/內距/對齊由呼叫端
// className 決定(Admin 沿用自己的 TH/THR 常數)——這裡只負責互動與 active 視覺。
export function SortableTh({ label, field, sort, onSort, numeric = false, align = 'left', className = '' }) {
  const active = sort?.field === field
  return (
    <th className={className}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => onSort(field, numeric)}
        className={`w-full max-md:min-h-11 inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''} ${active ? 'text-[var(--blue-text)]' : 'hover:text-[var(--text)]'}`}>
        {label}
        {active && <MSym name={sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'} size={16} />}
      </button>
    </th>
  )
}

// 篩選 chip:未套用=白底+前置圖示(filter_list/calendar_month);已套用=淺藍底
// 深藍字+尾端 close。class 字面值與 PageTabs 的 CHIP_BASE/CHIP_ON/CHIP_OFF 對齊
// ——刻意複製而非 import:不想再加深 ui↔PageTabs 的耦合,改 chips 皮時兩處一起動。
// 本輪只動本檔:這裡的 text-body 與 PageTabs 仍寫著的 text-[13px] 等值(13px),
// 視覺沒有漂移;PageTabs 換皮那輪再把它的字面值也換成階梯名。圓角維持 8px。
// 同一顆 button 負責套用與移除(aria-pressed 供報讀器分辨),close 只是視覺提示。
export function FilterChip({ label, icon = 'filter_list', active = false, onToggle }) {
  return (
    <button type="button" aria-pressed={active} onClick={onToggle}
      className={`h-8 max-md:min-h-11 shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-lg text-body font-medium whitespace-nowrap pressable ${active
        ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]'
        : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`}>
      {!active && <MSym name={icon} size={16} />}
      {label}
      {active && <MSym name="close" size={16} />}
    </button>
  )
}

// 卡底分頁列:「每頁列數 25 ▾ · 1–25 / 106 · ‹ ›」,靠右、數字 tabular。
// 不可用的箭頭降 --border 且 disabled;頁碼 0-based,對外顯示才 +1。
// 箭頭鈕維持正圓(rounded-full):按鈕去藥丸只針對文字鈕,Apple 的純圖示鈕本來就是正圓。
// select 用裸樣式而非 FIELD_BASE——這裡要的是行內小控件,不是全寬表單欄位。
// disabled=true 供伺服器分頁的表在載入中整組鎖住(client-side 表用不到)。
export function TablePager({ page, pageSize, total, onPage, onPageSize, sizes = [10, 25, 50], disabled = false, className = '' }) {
  const start = total === 0 ? 0 : page * pageSize + 1
  const end = Math.min(total, (page + 1) * pageSize)
  const canPrev = !disabled && page > 0
  const canNext = !disabled && end < total
  const arrow = (ok) => `w-8 h-8 max-md:min-h-11 max-md:min-w-11 grid place-items-center rounded-full ${ok ? 'text-[var(--text-2)] hover:bg-[var(--surface-2)] pressable' : 'text-[var(--border)]'}`
  return (
    <div className={`flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-4 py-1.5 border-t border-[var(--border-2)] text-body text-[var(--text-2)] ${className}`}>
      <label className="flex items-center gap-1.5">
        每頁列數
        <select value={pageSize} disabled={disabled} aria-label="每頁列數"
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="num bg-transparent border border-[var(--border)] rounded-md px-1 py-0.5 max-md:min-h-11 text-body text-[var(--text)] disabled:opacity-50">
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
      {title && <div className="text-body font-medium text-[var(--text)] mb-1">{title}</div>}
      <div className="text-body text-[var(--text-2)] max-w-md mx-auto">{need}</div>
      {unlocks && <div className="text-footnote text-[var(--text-3)] mt-1.5 max-w-md mx-auto">完成後即可使用：{unlocks}</div>}
      <div className="mt-4">
        {/* Link 包 Button 是巢狀互動元素:內層退出 tab 序避免 Tab 停兩次,
            Link 給 inline-flex+圓角讓全域 focus outline 落在正確形狀上(W8-5 最小修法,不改 Button API)。
            圓角跟著 md 按鈕走 rounded-lg——按鈕已去藥丸,這裡再寫 rounded-full 焦點框會比按鈕圓 */}
        {to && cta
          ? <Link to={to} className="inline-flex rounded-lg"><Button tabIndex={-1}>{cta}</Button></Link>
          : who && <span className="text-footnote text-[var(--text-3)]">{who}</span>}
      </div>
    </div>
  )
}
