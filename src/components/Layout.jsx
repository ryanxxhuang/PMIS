import { useState, useEffect, useRef } from 'react'
import { NavLink, Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { appConfirm } from './confirm.jsx'
import { visibleNavGroups, defaultLandingPath, BALL_SOURCES, resolveBallKey } from '../lib/navConfig.js'
import CopilotFab, { CopilotMark, useCopilotAvailable } from './CopilotFab.jsx'
import BottomNav, { NAV_SHORT } from './BottomNav.jsx'
import { MSym } from './icons.jsx'
import { ErrorBanner } from './ui.jsx'
import { friendlyError } from '../lib/errorMessage.js'
import { getThemeMode, setThemeMode, THEME_MODES } from '../lib/theme.js'
import { useTodayTasks, mineCountForNavItem } from '../lib/useTodayTasks.js'
import { useEscape } from '../lib/useEscape.js'
import { useMediaQuery, TABLET_QUERY } from '../lib/useMediaQuery.js'
import { useScrollLock } from '../lib/useScrollLock.js'
import { useVisualViewport } from '../lib/useVisualViewport.js'

const SIDEBAR_COLLAPSED_KEY = 'pmis-sidebar-collapsed'

const initialSidebarCollapsed = () => {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1' } catch { return false }
}

// ── 側欄列(工作面列與球權列共用)────────────────────────────────────
// 樣式只有這一份:散裝複本正是深色對比漏修的來源(規範 §6)。外層連結與 tabs
// 展開鈕由呼叫端各自負責(工作面列多一顆展開鈕,球權列沒有)。
// 列殼=Workspace 藥丸:貼齊左緣、右側全圓(0 100px 100px 0);選取=淺藍底深藍字。
// 收合(md+ rail)時縮成置中圓形。selected=淺藍底;open=工作面已展開子頁,只加粗不上底。
// (旗標用布林不用字串純粹是介面偏好;原本是為了閃避 subset 字型的 manifest
// 掃描,那套工具已隨 lucide 改版移除,這裡維持布林是因為它本來就比較好讀。)
const rowClass = ({ selected = false, open = false }, collapsed) => `mr-4 my-0.5 rounded-r-full transition-colors flex items-center ${
  selected
    ? 'bg-[var(--blue-tint)] text-[var(--blue-text)] font-medium'
    : open
      ? 'text-[var(--text)] font-medium'
      : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
} ${collapsed ? 'md:mx-0 md:mr-0 md:my-1 md:rounded-none md:bg-transparent md:justify-center' : ''}`
const linkClass = (collapsed) => `min-w-0 min-h-11 flex-1 flex items-center gap-3.5 pl-4 pr-3 text-sm rounded-r-full ${
  collapsed ? 'md:flex-none md:w-16 md:flex-col md:gap-1 md:justify-center md:px-0 md:py-1 md:rounded-2xl' : ''
}`
// 列內容:圖示＋全名/短標＋件數。rail(collapsed,md+):56×32 藥丸圖示+短標直排,
// 件數改掛藥丸右上角小數字。件數一律 aria-hidden——e2e 用 exact accessible name
// 抓連結,數字不得混進名字;count 語意由目的頁承擔。alert=rail 小數字用紅色
// (輪到我的未處理數);等對方與已完成不是警訊,不借紅色(顏色不可單獨承載語意)。
function NavRowContent({ icon, label, short, active, count = 0, alert = false, collapsed }) {
  const rowCountCls = active ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'
  const railCountCls = alert ? 'text-[var(--red-text)]' : rowCountCls
  return (
    <>
      <span className={`relative flex items-center justify-center ${collapsed ? `md:w-14 md:h-8 md:rounded-full ${active ? 'md:bg-[var(--blue-tint)]' : ''}` : ''}`}>
        <MSym name={icon} size={20} fill={active} className={active ? 'text-[var(--blue-text)]' : 'opacity-80'} />
        {collapsed && count > 0 && (
          <span aria-hidden className={`hidden md:block absolute -top-1 right-0.5 text-micro leading-none font-medium num ${railCountCls}`}>{count}</span>
        )}
      </span>
      {/* 手機抽屜永遠全名(collapsed 只影響 md+ 的 rail);rail 用短標 */}
      <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
      {collapsed && <span className="hidden md:block text-micro leading-none font-medium">{short}</span>}
      {/* 展開態:右側件數 */}
      {count > 0 && (
        <span aria-hidden className={`ml-auto text-footnote font-medium num ${rowCountCls} ${collapsed ? 'md:hidden' : ''}`}>{count}</span>
      )}
    </>
  )
}

// Top-bar project picker: switch / create / delete (real backend only).
function ProjectSwitcher() {
  const { project, projects, currentProject, switchProject, deleteProject, isSupabaseConfigured } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const firstItemRef = useRef(null)
  const prevOpen = useRef(false)
  useEscape(open, () => setOpen(false))
  // 鍵盤焦點:開啟移入第一個選單項（role=menu 慣例）、關閉還給觸發鈕,
  // 避免焦點落回 body 讓鍵盤使用者迷路。prevOpen 擋掉初掛載時的誤搶焦點。
  useEffect(() => {
    if (open) firstItemRef.current?.focus()
    else if (prevOpen.current) triggerRef.current?.focus()
    prevOpen.current = open
  }, [open])

  // Workspace 專案 chip:folder_open + 專案名 + 下拉箭頭(demo/單專案時純顯示)
  const chipClass = 'flex items-center gap-1.5 min-w-0 h-10 max-md:min-h-11 rounded-full bg-[var(--surface-2)] pl-3 pr-2'
  if (!isSupabaseConfigured || !currentProject) {
    return (
      <div className={chipClass}>
        <MSym name="folder_open" size={18} className="text-[var(--text-2)]" />
        <span title={project.project_name} className="text-sm truncate max-w-[24vw] sm:max-w-[36vw] md:max-w-[280px] text-[var(--text)]">{project.project_name}</span>
      </div>
    )
  }
  return (
    <div className="relative min-w-0">
      <button ref={triggerRef} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className={`${chipClass} hover:bg-[var(--border-2)] pressable`}>
        <MSym name="folder_open" size={18} className="text-[var(--text-2)]" />
        <span title={currentProject.project_name} className="text-sm truncate max-w-[24vw] sm:max-w-[36vw] md:max-w-[280px] text-[var(--text)]">{currentProject.project_name}</span>
        <MSym name="arrow_drop_down" size={20} className="text-[var(--text-2)]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 mt-1 w-72 bg-[var(--surface)] text-[var(--text)] rounded-lg [box-shadow:var(--shadow-md)] border border-[var(--border-2)] py-2 z-20 enter-menu origin-top-left">
            {projects.map((p, i) => {
              const isCurrent = p.project_id === currentProject.project_id
              return (
                // aria-current＋Check:目前專案不能只靠底色/色點表達（色弱與報讀器都讀不到）
                <button key={p.project_id} ref={i === 0 ? firstItemRef : undefined}
                  onClick={() => { switchProject(p.project_id); setOpen(false) }}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2 min-h-11 text-sm hover:bg-[var(--surface-2)] flex items-center gap-2 ${isCurrent ? 'bg-[var(--blue-tint)]' : ''}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCurrent ? 'bg-[var(--blue)]' : 'bg-[var(--border)]'}`} />
                  <span className="truncate">{p.project_name}</span>
                  {isCurrent && <MSym name="check" size={16} className="ml-auto text-[var(--blue-text)]" />}
                </button>
              )
            })}
            <div className="border-t border-[var(--border-2)] my-1" />
            <button onClick={() => { setOpen(false); navigate('/project/new') }}
              className="w-full text-left px-3 py-2 min-h-11 text-sm text-[var(--blue-text)] hover:bg-[var(--surface-2)] flex items-center gap-1.5"><MSym name="add" size={16} /> 新增專案</button>
            <button onClick={async () => {
              setOpen(false)
              // 高危險:整案永久刪除 → 要求輸入專案名稱確認,防手滑
              const ok = await appConfirm({
                title: '永久刪除專案',
                body: `「${currentProject.project_name}」的標單、估驗、進度、施工日誌、查驗、缺失將一併永久刪除，無法復原。`,
                danger: true, confirmLabel: '永久刪除', requireText: currentProject.project_name,
              })
              if (ok) await deleteProject(currentProject.project_id)
            }} className="w-full text-left px-3 py-2 min-h-11 text-sm text-[var(--red-text)] hover:bg-[var(--red-tint)] flex items-center gap-1.5"><MSym name="delete" size={16} /> 刪除此專案</button>
          </div>
        </>
      )}
    </div>
  )
}

// 主題三態循環(U-07):亮 → 暗 → 跟隨系統 → 亮
const THEME_META = {
  light: { icon: 'light_mode', label: '亮色' },
  dark: { icon: 'dark_mode', label: '深色' },
  system: { icon: 'brightness_auto', label: '跟隨系統' },
}

// 全域搜尋:Gmail 式藥丸「鈕」,點開才出現真 input(浮層)。
// 刻意不做常駐 input——監造唯讀頁有「全頁 input 計數=0」的 e2e 合約,
// TopBar 也是頁面的一部分;送出即導 /agent 代問(問 GovAgent 是全域問答入口,不另建搜尋資料流)。
function GlobalSearch() {
  const navigate = useNavigate()
  const { aiEnabled } = useStore()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const inputRef = useRef(null)
  const btnRef = useRef(null)
  // Esc 關閉後把焦點還給觸發鈕,鍵盤使用者不會掉回 body
  useEscape(open, () => { setOpen(false); btnRef.current?.focus() })
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])
  const submit = (e) => {
    e.preventDefault()
    const text = q.trim()
    if (!text) return
    setOpen(false); setQ('')
    navigate('/agent', { state: { q: text } })
  }
  // agent.run 關閉的專案:搜尋送出會落到 /agent 的「未啟用」空頁、問題被吞——
  // 功能關閉時整顆入口不渲染(與批 B「功能關閉時藏對話入口」同一條 UX 規則)
  if (!aiEnabled('agent.run')) return <div className="flex-1 hidden md:block" />
  return (
    <div className="relative flex-1 max-w-[560px] min-w-0 hidden md:block">
      {/* ≥1280 全寬藥丸;768–1279 收成圖示鈕(README 平板規格),兩者共用同一浮層 */}
      <button ref={btnRef} onClick={() => setOpen(true)} aria-label="搜尋(問 GovAgent 代查)" title="搜尋(問 GovAgent 代查)"
        className="w-full h-11 rounded-full bg-[var(--g-search)] hover:bg-[var(--g-search-h)] hidden xl:flex items-center gap-2.5 px-4 pressable">
        <MSym name="search" size={20} className="text-[var(--text-2)]" />
        {/* 文案必須等於行為:這裡沒有檢索引擎,送出是把整句丟給 /agent 代問。
            舊文案「搜尋工項、送審、缺失、契約條文」承諾了逐條檢索,實際做不到;
            改成「問 GovAgent」開頭,後面只列可問的題材,不再暗示關鍵字搜尋。 */}
        <span className="flex-1 text-left text-sm text-[var(--text-2)] truncate">問 GovAgent：工項、送審、缺失、契約……</span>
        <MSym name="tune" size={20} className="text-[var(--text-2)]" />
      </button>
      <button onClick={() => setOpen(true)} aria-label="搜尋(問 GovAgent 代查)" title="搜尋(問 GovAgent 代查)"
        className="hidden md:flex xl:hidden w-11 h-11 ml-auto rounded-full items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] pressable">
        <MSym name="search" size={22} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <form onSubmit={submit}
            className="absolute top-0 right-0 w-[min(560px,72vw)] xl:w-auto xl:inset-x-0 z-20 h-11 rounded-full bg-[var(--surface)] [box-shadow:var(--shadow-md)] flex items-center gap-2.5 px-4 enter-menu">
            <MSym name="search" size={20} className="text-[var(--text-2)]" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="問 GovAgent:輸入問題,Enter 代查本案資料…"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm text-[var(--text)] placeholder:text-[var(--text-3)]" />
          </form>
        </>
      )}
    </div>
  )
}

// 主題切換鈕:桌機在頂欄、手機在導覽抽屜底部(規範 §9.3:手機頂欄只留品牌、專案、AI、提醒)。
// 兩個使用點共用同一個 mode(state 在 WebLayout),不各存一份——各存會在手機切完、轉成
// 桌機視窗時顯示過期的圖示。
function ThemeToggle({ mode, onCycle, className = '' }) {
  return (
    <button onClick={onCycle} aria-label={`主題:${THEME_META[mode].label}(點擊切換)`} title={`主題:${THEME_META[mode].label}(點擊切換)`}
      className={`w-10 h-10 max-md:w-11 max-md:h-11 rounded-full items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] pressable ${className}`}>
      <MSym name={THEME_META[mode].icon} size={20} />
    </button>
  )
}

// 登出:同上,桌機頂欄、手機抽屜底部。
// 44px 觸控目標:純文字鈕撐高(h-11)、px-2 撐寬。稽核量到 42×44——兩個字在桌機
// 13px 只有 26 寬,+16 padding 差 2px。max-md:min-w-11 把面積補到 44×44(規範 §9.2);
// justify-center 讓 min-w 咬到時文字仍置中。手機階梯下兩個字 34 寬,+16 已是 50,
// min-w 實際不會咬到,所以視覺間距不變、不需要負 margin 吸收。
function LogoutButton({ className = '' }) {
  const { logout } = useStore()
  const navigate = useNavigate()
  return (
    <button onClick={async () => { await logout(); navigate('/login') }}
      className={`items-center justify-center h-11 max-md:min-w-11 px-2 text-sm text-[var(--text-2)] hover:text-[var(--text)] ${className}`}>登出</button>
  )
}

function TopBar({ scrolled, dueCount = 0, mode, onCycleTheme, copilotOpen, onCopilotToggle }) {
  const { currentUser } = useStore()
  const copilotAvailable = useCopilotAvailable()
  const base = import.meta.env.BASE_URL
  return (
    <header data-scrolled={scrolled} className="chrome-bar chrome-edge fixed top-0 inset-x-0 z-40 h-[var(--top-bar-h)] flex items-center gap-3 md:gap-5 px-3 md:px-4 print:hidden">
      <div className="flex items-center gap-2 md:gap-3 min-w-0 shrink-0">
        {/* 44px 觸控目標:品牌連結稽核量到 102×24——寬夠、高只有圖示的 24。max-md:h-11 撐高,
            header 是 flex items-center 且比 44 高,連結沒有底色,撐高後視覺位置一個像素都不動,
            所以這裡不需要負 margin(那招是給「有 padding 撐寬」的鈕吸收水平間距用的)。 */}
        <NavLink to={defaultLandingPath(currentUser?.org_type)} aria-label="GovAgent 公共工程首頁" className="flex items-center gap-1.5 shrink-0 max-md:h-11 max-md:min-w-11">
          <img src={`${base}brand/pmis-mark.svg`} alt="" className="w-6 h-6 dark:hidden" />
          <img src={`${base}brand/pmis-mark-dark.svg`} alt="" className="w-6 h-6 hidden dark:block" />
          <span className="text-title3 font-medium tracking-tight text-[var(--text)]">Gov<span className="text-[var(--blue)]">Agent</span></span>
        </NavLink>
        <ProjectSwitcher />
      </div>
      <GlobalSearch />
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 ml-auto">
        {/* 手機的 AI 助理入口(規範 §9.5):FAB 在 <md 退場,改成頂欄尾端與提醒並列的圖示鈕;
            aria-label 沿用 FAB 的兩態文案。開合 state 在 WebLayout,與 CopilotFab 同一份。
            可用性(未選專案 / agent.run 關閉)與 FAB 同一支 hook 判斷,功能關閉時整顆不渲染。 */}
        {copilotAvailable && (
          <button type="button" onClick={onCopilotToggle} aria-label={copilotOpen ? '收合 AI 助理' : '開啟 AI 助理'} aria-expanded={copilotOpen}
            className={`md:hidden w-11 h-11 rounded-full flex items-center justify-center pressable ${copilotOpen ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
            <CopilotMark size={22} />
          </button>
        )}
        <ThemeToggle mode={mode} onCycle={onCycleTheme} className="hidden md:flex" />
        <NavLink to="/alerts" aria-label="提醒中心" title="提醒中心"
          className={({ isActive }) => `relative w-10 h-10 max-md:w-11 max-md:h-11 rounded-full flex items-center justify-center pressable ${isActive ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
          <MSym name="notifications" size={20} />
          {/* 紅點只在真的有「輪到我」時亮(靜態紅點=說謊);aria-hidden,
              count 語意由側欄 badge 與今日待辦頁承擔 */}
          {dueCount > 0 && <span aria-hidden className="absolute top-2 right-2.5 w-[7px] h-[7px] rounded-full bg-[var(--danger)] border-[1.5px] border-[var(--surface)]" />}
        </NavLink>
        {/* 帳戶區(兩行):登入者本人,沒有角色切換——身分在註冊時決定。
            md 起才顯示:手機頂欄 44px 塞不下兩行帳戶區,稽核量到頂欄 434 > 375(「登出」在畫面外)。 */}
        <div className="hidden md:flex items-center gap-2 pl-1.5 pr-2 py-1 ml-0.5 rounded-full">
          <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center font-medium text-body text-[var(--primary-fg)]">{currentUser?.name?.[0]}</div>
          <div className="leading-tight text-left">
            <div className="text-footnote font-medium text-[var(--text)] whitespace-nowrap">{currentUser?.name}</div>
            <div className="text-caption text-[var(--text-2)] whitespace-nowrap">{currentUser?.label}</div>
          </div>
        </div>
        <LogoutButton className="hidden md:inline-flex" />
      </div>
    </header>
  )
}

export function WebLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  // 抽屜的觸發鈕是 BottomNav 的「更多」(規範 §9.3;頂欄漢堡已退場),關閉時焦點還給它
  const moreBtnRef = useRef(null)
  const drawerCloseRef = useRef(null)
  const prevMenuOpen = useRef(false)
  useEscape(menuOpen, () => setMenuOpen(false))
  // 抽屜開著鎖背景捲動;與 DetailDrawer / ModalShell 同一支 hook(引用計數,疊開不互相干擾)
  useScrollLock(menuOpen)
  // --vvh(可視視口高)全站只寫這一次;sheet / 抽屜 / 對話框的高度都讀它
  useVisualViewport()
  // Copilot 開合只有這一份 state:桌機 FAB 與手機頂欄鈕都是它的觸發器(規範 §9.5)
  const [copilotOpen, setCopilotOpen] = useState(false)
  // 主題三態(U-07):亮 → 暗 → 跟隨系統 → 亮。state 在這一層,頂欄(桌機)與抽屜底部(手機)
  // 兩顆切換鈕共用同一個 mode。
  const [themeMode, setThemeModeState] = useState(getThemeMode)
  const cycleTheme = () => {
    const next = THEME_MODES[(THEME_MODES.indexOf(themeMode) + 1) % THEME_MODES.length]
    setThemeMode(next)
    setThemeModeState(next)
  }
  // 抽屜焦點管理:開啟移到關閉鈕、關閉還給「更多」鈕。prevMenuOpen 擋初載誤搶焦點
  // （桌機 menuOpen 恆為 false,不會進到還原分支）。
  // 開啟聚焦不能同步做也不能只推遲一個 frame:visibility 在 transition 清單裡,
  // transition progress=0 時 computed 仍是 hidden,hidden 元素不可聚焦、focus()
  // 靜默失敗;progress 何時 >0 又依環境 frame 節奏而定(CI 慢機第二個 rAF 仍打不到)。
  // 改成有界重試:每 25ms 試一次直到焦點真的落上,500ms 內必然涵蓋 transition 起跑。
  useEffect(() => {
    if (menuOpen) {
      prevMenuOpen.current = true
      let tries = 0
      let timer = null
      const attempt = () => {
        const el = drawerCloseRef.current
        if (el) { el.focus(); if (document.activeElement === el) return }
        if (++tries < 20) timer = setTimeout(attempt, 25)
      }
      attempt()
      return () => clearTimeout(timer)
    }
    if (prevMenuOpen.current) moreBtnRef.current?.focus()
    prevMenuOpen.current = false
  }, [menuOpen])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed)
  // 平板(768–1279)一律 icon rail:collapsed 是「衍生值」不回寫 localStorage,
  // 平板逛一圈不會污染桌機(≥1280)的收合偏好;Playwright 預設 1280×720 落在記憶分支。
  const isTablet = useMediaQuery(TABLET_QUERY)
  const collapsed = isTablet || sidebarCollapsed
  // 「工作」群組預設收合；展開狀態只保留在本次瀏覽，不製造另一份持久導覽設定。
  const [expandedWorkbenches, setExpandedWorkbenches] = useState(() => new Set())
  // scroll edge:內容捲到 chrome 底下才浮出界線(置頂時頂欄與背景齊平)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const { currentUser, can, workItemsSource, workItemsError, retryWorkItems, domainLoadError, retryDomainLoad, isPlatformAdmin, project, demoMode } = useStore()
  // 件數單一真相:與今日待辦頁同一支聚合(useTodayTasks),側欄 badge/通知紅點
  // 不另算一份——兩套實作的數字遲早對不上(W8-2A §2.1)
  const { mine: dueMine, waiting: dueWaiting, doneToday: dueDone } = useTodayTasks()
  const { pathname } = useLocation()
  // 球權來源的選取態:三個入口共用 /dashboard,NavLink 的 isActive 只比 pathname
  // 會三個同時亮;改比 ?ball=,與 Dashboard 的聚焦同一支解析(resolveBallKey)。
  const [searchParams] = useSearchParams()
  const ballKey = pathname === '/dashboard' ? resolveBallKey(searchParams) : null
  const ballCounts = { mine: dueMine.length, waiting: dueWaiting.length, done: dueDone.length }
  // 角色化導覽:依 org_type 過濾工具（成本/請款/排程等）——非正式模式的
  // admin(專案建立者)看得到全部;正式模式後回歸自己的角色視角。
  // isPlatformAdmin 是獨立的「平台」維度(僅控制 /admin 入口可見;真正把關在 DB 的 admin RPC)。
  const org = currentUser?.org_type || 'contractor'
  const visibleGroups = visibleNavGroups(org, can?.override, isPlatformAdmin)
  const setDesktopCollapsed = () => {
    setSidebarCollapsed((value) => {
      const next = !value
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }
  const toggleWorkbench = (to) => {
    setExpandedWorkbenches((current) => {
      const next = new Set(current)
      next.has(to) ? next.delete(to) : next.add(to)
      return next
    })
  }
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopBar scrolled={scrolled} dueCount={dueMine.length} mode={themeMode} onCycleTheme={cycleTheme}
        copilotOpen={copilotOpen} onCopilotToggle={() => setCopilotOpen((o) => !o)} />
      {/* 手機:點背景關閉抽屜(蓋過頂欄,抽屜再蓋過遮罩);純滑鼠 scrim,對報讀器隱藏 */}
      {menuOpen && <div aria-hidden="true" className="fixed inset-0 z-50 bg-[var(--scrim)] md:hidden enter-fade" onClick={() => setMenuOpen(false)} />}
      {/* 關閉時 max-md:invisible:visibility hidden = 不可聚焦＋離開 a11y 樹,擋掉
          「Tab 進看不見的抽屜」;visibility 進 transition 清單讓滑出動畫跑完才隱藏
          （hidden→visible 則是動畫起點就顯示,開啟不閃爍）。桌機 md 斷點不受影響。 */}
      {/* 分層(登記在 index.css 的 z 階梯):手機抽屜要蓋過 z-50 遮罩故 z-[55];桌機側欄必須退到
          頂欄(z-40)之下——專案下拉/搜尋浮層錨定在頂欄,側欄若壓過頂欄,下拉會被蓋住、誤點直接
          觸發側欄導覽而換頁(ISSUE-9)。chrome 材質(側欄 chrome-glass/頂欄 chrome-bar)不改層級關係。
          id 給 BottomNav「更多」的 aria-controls。 */}
      <aside id="app-drawer"
        className={`chrome-glass w-72 ${collapsed ? 'md:w-20' : 'md:w-64'} border-r border-[var(--border-card)] flex flex-col print:hidden
          fixed top-[var(--top-bar-h)] bottom-0 left-0 z-[55] md:z-30 transition-[width,transform,visibility] duration-300 [transition-timing-function:var(--ease-drawer)]
          md:translate-x-0
          ${menuOpen ? 'translate-x-0' : '-translate-x-full max-md:invisible'}`}
      >
          <div className="md:hidden flex items-center justify-between border-b border-[var(--border-2)] px-4 py-3">
            <span className="text-sm font-semibold text-[var(--text)]">功能選單</span>
            <button ref={drawerCloseRef} onClick={() => setMenuOpen(false)} aria-label="關閉選單" className="w-11 h-11 -my-1 -mr-1 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)]"><MSym name="close" size={20} /></button>
          </div>
          <div className={`hidden xl:flex h-12 shrink-0 items-center ${collapsed ? 'justify-center' : 'justify-end px-3'}`}>
            <button onClick={setDesktopCollapsed}
              aria-label={sidebarCollapsed ? '展開側邊欄' : '收合側邊欄'}
              title={sidebarCollapsed ? '展開側邊欄' : '收合側邊欄'}
              className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] pressable">
              <MSym name={sidebarCollapsed ? "left_panel_open" : "left_panel_close"} size={20} />
            </button>
          </div>
          {/* 問 GovAgent:佔 Gemini 在 Workspace 的位置(白底浮起鈕);自 TopBar 移入。
              aria-label 恆掛,收合成純圖示時 accessible name 不變。 */}
          <NavLink to="/agent" onClick={() => setMenuOpen(false)} aria-label="問 GovAgent" title="問 GovAgent"
            className={({ isActive }) => `mx-3 mt-2 md:mt-0 mb-3 h-11 rounded-[22px] flex items-center gap-2.5 px-4 text-sm font-medium shrink-0 pressable
              ${collapsed ? 'md:mx-auto md:w-14 md:px-0 md:justify-center md:mt-3' : ''}
              ${isActive
                ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]'
                : 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border-card)] [box-shadow:var(--shadow-card)] hover:[box-shadow:var(--shadow-md)]'}`}>
            <MSym name="auto_awesome" size={20} className="text-[var(--ai)]" />
            <span className={collapsed ? 'md:hidden' : ''}>問 GovAgent</span>
          </NavLink>
          <nav aria-label="主要功能" className="flex-1 pb-4 overflow-auto">
            {/* 球權來源(疊合版 IA §0):主畫面是收件匣,側欄先問「球在誰手上」。
                三個入口共用 /dashboard 的登記與角色判斷,以 ?ball= 分流(為何不開新路由
                見 navConfig BALL_SOURCES)。/dashboard 只有這一組入口——下方的工作/參考
                分區沒有任何項目指向它,所以 aria-current 天然只落一處,不需要去重複。
                件數與工作項 badge 同源(useTodayTasks),不另算一份。 */}
            <div className="mb-2">
              <div className={`px-4 pt-3 pb-1.5 ${collapsed ? 'md:hidden' : ''}`}>
                <span className="text-caption font-medium text-[var(--text-2)]">球在誰手上</span>
              </div>
              {BALL_SOURCES.map((b) => {
                const active = ballKey === b.key
                return (
                  <div key={b.key} className={rowClass({ selected: active }, collapsed)}>
                    {/* Link 而非 NavLink:isActive 只比 pathname,三個來源會同時亮;
                        aria-current 自己掛,報讀器仍知道現在在哪一個來源 */}
                    <Link to={b.to} onClick={() => setMenuOpen(false)} aria-current={active ? 'page' : undefined}
                      title={collapsed ? b.label : undefined} aria-label={collapsed ? b.label : undefined}
                      className={linkClass(collapsed)}>
                      <NavRowContent icon={b.icon} label={b.label} short={b.short} active={active}
                        count={ballCounts[b.key]} alert={b.key === 'mine'} collapsed={collapsed} />
                    </Link>
                  </div>
                )
              })}
            </div>
            {visibleGroups.map((g) => (
              <div key={g.title} className="mb-2">
                <div className={`px-4 pt-3 pb-1.5 ${collapsed ? 'md:hidden' : ''}`}>
                  <span className="text-caption font-medium text-[var(--text-2)]">{g.title}</span>
                </div>
                {g.items.map((n) => {
                  // 群組與角色子頁都來自 navConfig，不在 Layout 重寫清單。
                  const mineCount = mineCountForNavItem(dueMine, n)
                  const wbActive = n.tabs?.some((t) => t.to === pathname)
                  const itemActive = pathname === n.to || wbActive
                  const expanded = expandedWorkbenches.has(n.to)
                  return (
                    <div key={n.to}>
                      <div className={rowClass({ selected: itemActive && (!n.tabs || !expanded), open: itemActive }, collapsed)}>
                        {/* className 走函式形:字串形會被 NavLink 自動補一個 "active" class */}
                        <NavLink to={n.to} onClick={() => setMenuOpen(false)} title={collapsed ? n.label : undefined}
                          aria-label={collapsed ? n.label : undefined}
                          className={() => linkClass(collapsed)}>
                          {/* 未處理件數(README 導覽規格)=「現在輪到我」落在此群組的數 */}
                          <NavRowContent icon={n.icon} label={n.label} short={NAV_SHORT[n.label] || n.label}
                            active={itemActive} count={mineCount} alert collapsed={collapsed} />
                        </NavLink>
                        {n.tabs && (
                          <button type="button" onClick={() => toggleWorkbench(n.to)}
                            aria-expanded={expanded} aria-controls={`nav-children-${n.to.slice(1)}`}
                            aria-label={`${expanded ? '收合' : '展開'}${n.label}子頁`}
                            className={`w-11 h-11 rounded-full flex items-center justify-center text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] ${collapsed ? 'md:hidden' : ''}`}>
                            <MSym name={expanded ? "expand_more" : "chevron_right"} size={18} />
                          </button>
                        )}
                      </div>
                      {n.tabs && expanded && (
                        <div id={`nav-children-${n.to.slice(1)}`} className={`pb-1 ${collapsed ? 'md:hidden' : ''}`}>
                          {n.tabs.map((tab) => (
                            <NavLink key={tab.to} to={tab.to} onClick={() => setMenuOpen(false)}
                              className={({ isActive }) => `min-h-11 mr-4 pl-[54px] pr-3 rounded-r-full flex items-center text-sm transition-colors ${
                                isActive
                                  ? 'bg-[var(--blue-tint)] text-[var(--blue-text)] font-medium'
                                  : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                              }`}>
                              {tab.label}
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </nav>
          {/* 底部模式列:正式模式=稽核中(綠);未開正式=準備模式;demo=示範模式。
              手機(<md)右側並排主題切換與登出——它們從 44px 的頂欄移進來(規範 §9.3);
              兩顆都是 44 高,列的垂直內距縮到 py-1.5 讓列高維持 56,底下留 home indicator 安全區。 */}
          <div className={`shrink-0 px-4 py-3 max-md:py-1.5 max-md:pb-[calc(6px_+_env(safe-area-inset-bottom))] flex items-center gap-2 text-xs text-[var(--text-2)] ${collapsed ? 'md:justify-center md:px-0' : ''}`}>
            <MSym name="verified_user" size={16} className={project?.formal_mode ? 'text-[var(--green-text)]' : 'text-[var(--text-3)]'} />
            <span className={collapsed ? 'md:hidden' : ''}>
              {demoMode ? '示範模式' : project?.formal_mode ? '正式模式 · 稽核中' : '準備模式'}
            </span>
            <div className="md:hidden ml-auto flex items-center gap-1">
              <ThemeToggle mode={themeMode} onCycle={cycleTheme} className="flex" />
              <LogoutButton className="inline-flex" />
            </div>
          </div>
      </aside>
      {/* 上內距從 --top-bar-h 算:手機 44+16、桌機 64+24(=先前的 pt-20 / pt-[88px]) */}
      <main className={`${collapsed ? 'md:ml-20' : 'md:ml-64'} transition-[margin] duration-300 p-4 md:p-6 pt-[calc(var(--top-bar-h)_+_16px)] md:pt-[calc(var(--top-bar-h)_+_24px)] max-md:pb-24 min-w-0 print:ml-0 print:pt-0`}>
          {workItemsSource === 'error' && (
            <ErrorBanner className="mb-4 print:hidden" onRetry={retryWorkItems}
              msg={`標單工項讀取失敗：${friendlyError(workItemsError, '連線異常')}。各頁資料可能不完整。`} />
          )}
          {/* 領域資料載入失敗(B-09):不再靜默顯示「尚無資料」,如實回報並可重試 */}
          {domainLoadError && (
            <ErrorBanner className="mb-4 print:hidden" onRetry={retryDomainLoad}
              msg={`${friendlyError(domainLoadError, '專案資料載入失敗')}。各頁資料可能不完整。`} />
          )}
        {children}
      </main>
      {/* 主畫面槽=「現在輪到我」:它的 to 就是落地頁(/dashboard),等對方/已完成是同頁的分段,
          頁內 Segmented 就能切,不佔手機的格子 */}
      <BottomNav items={visibleGroups.flatMap((g) => g.items)} home={BALL_SOURCES.find((b) => b.key === 'mine')}
        menuOpen={menuOpen} onMore={() => setMenuOpen(true)} moreRef={moreBtnRef} />
      <CopilotFab open={copilotOpen} onOpenChange={setCopilotOpen} />
    </div>
  )
}
