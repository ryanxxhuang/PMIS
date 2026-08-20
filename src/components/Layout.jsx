import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { appConfirm } from './confirm.jsx'
import { visibleNavGroups } from '../lib/navConfig.js'
import CopilotFab from './CopilotFab.jsx'
import BottomNav, { NAV_SHORT } from './BottomNav.jsx'
import { MSym } from './icons.jsx'
import { ErrorBanner } from './ui.jsx'
import { getThemeMode, setThemeMode, THEME_MODES } from '../lib/theme.js'
import { useTodayTasks, mineCountForNavItem } from '../lib/useTodayTasks.js'

const SIDEBAR_COLLAPSED_KEY = 'pmis-sidebar-collapsed'


const initialSidebarCollapsed = () => {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1' } catch { return false }
}

// Top-bar project picker: switch / create / delete (real backend only).
function ProjectSwitcher() {
  const { project, projects, currentProject, switchProject, deleteProject, isSupabaseConfigured } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const firstItemRef = useRef(null)
  const prevOpen = useRef(false)
  // Esc 掛 window 層:原本綁在包裹 div 的 onKeyDown,焦點一離開該子樹（點了遮罩外
  // 或被移走）Esc 就失效,變成只能滑鼠關閉。開啟時才掛、關閉即拆,不常駐監聽。
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  // 鍵盤焦點:開啟移入第一個選單項（role=menu 慣例）、關閉還給觸發鈕,
  // 避免焦點落回 body 讓鍵盤使用者迷路。prevOpen 擋掉初掛載時的誤搶焦點。
  useEffect(() => {
    if (open) firstItemRef.current?.focus()
    else if (prevOpen.current) triggerRef.current?.focus()
    prevOpen.current = open
  }, [open])

  // Workspace 專案 chip:folder_open + 專案名 + 下拉箭頭(demo/單專案時純顯示)
  const chipClass = 'flex items-center gap-1.5 min-w-0 h-10 max-sm:min-h-11 rounded-full bg-[var(--surface-2)] pl-3 pr-2'
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
// TopBar 也是頁面的一部分;送出即導 /agent 代問(問 PMIS 是全域問答入口,不另建搜尋資料流)。
function GlobalSearch() {
  const navigate = useNavigate()
  const { aiEnabled } = useStore()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const inputRef = useRef(null)
  const btnRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
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
      <button ref={btnRef} onClick={() => setOpen(true)} aria-label="搜尋(問 PMIS 代查)" title="搜尋(問 PMIS 代查)"
        className="w-full h-11 rounded-full bg-[var(--g-search)] hover:bg-[var(--g-search-h)] hidden xl:flex items-center gap-2.5 px-4 pressable">
        <MSym name="search" size={20} className="text-[var(--text-2)]" />
        <span className="flex-1 text-left text-sm text-[var(--text-2)] truncate">搜尋工項、送審、缺失、契約條文……</span>
        <MSym name="tune" size={20} className="text-[var(--text-2)]" />
      </button>
      <button onClick={() => setOpen(true)} aria-label="搜尋(問 PMIS 代查)" title="搜尋(問 PMIS 代查)"
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
              placeholder="問 PMIS:輸入問題,Enter 代查本案資料…"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm text-[var(--text)] placeholder:text-[var(--text-3)]" />
          </form>
        </>
      )}
    </div>
  )
}

function TopBar({ onMenu, scrolled, menuBtnRef, dueCount = 0 }) {
  const { currentUser, logout } = useStore()
  const navigate = useNavigate()
  const [mode, setMode] = useState(getThemeMode)
  const cycleTheme = () => {
    const next = THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]
    setThemeMode(next)
    setMode(next)
  }
  const base = import.meta.env.BASE_URL
  return (
    <header data-scrolled={scrolled} className="chrome-glass chrome-edge fixed top-0 inset-x-0 z-40 h-16 flex items-center gap-3 md:gap-5 px-3 md:px-4 print:hidden">
      <div className="flex items-center gap-2 md:gap-3 min-w-0 shrink-0">
        {/* 44px 觸控目標:漢堡鈕只在手機出現,直接升到 w-11;ref 供抽屜關閉時焦點還原 */}
        <button ref={menuBtnRef} onClick={onMenu} aria-label="選單" className="md:hidden w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] pressable"><MSym name="menu" size={22} /></button>
        <NavLink to={currentUser?.org_type === 'owner' ? '/portfolio' : '/dashboard'} aria-label="PMIS 公共工程首頁" className="flex items-center gap-1.5 shrink-0">
          <img src={`${base}brand/pmis-mark.svg`} alt="" className="w-6 h-6 dark:hidden" />
          <img src={`${base}brand/pmis-mark-dark.svg`} alt="" className="w-6 h-6 hidden dark:block" />
          <span className="text-xl font-medium tracking-tight text-[var(--text)]">PMIS<span className="text-[var(--blue)]">.ai</span></span>
        </NavLink>
        <ProjectSwitcher />
      </div>
      <GlobalSearch />
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 ml-auto">
        <button onClick={cycleTheme} aria-label={`主題:${THEME_META[mode].label}(點擊切換)`} title={`主題:${THEME_META[mode].label}(點擊切換)`} className="w-10 h-10 max-sm:w-11 max-sm:h-11 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] pressable"><MSym name={THEME_META[mode].icon} size={20} /></button>
        <NavLink to="/alerts" aria-label="提醒中心" title="提醒中心"
          className={({ isActive }) => `relative w-10 h-10 max-sm:w-11 max-sm:h-11 rounded-full flex items-center justify-center pressable ${isActive ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
          <MSym name="notifications" size={20} />
          {/* 紅點只在真的有「輪到我」時亮(靜態紅點=說謊);aria-hidden,
              count 語意由側欄 badge 與今日待辦頁承擔 */}
          {dueCount > 0 && <span aria-hidden className="absolute top-2 right-2.5 w-[7px] h-[7px] rounded-full bg-[var(--danger)] border-[1.5px] border-[var(--surface)]" />}
        </NavLink>
        {/* 帳戶區(兩行):登入者本人,沒有角色切換——身分在註冊時決定 */}
        <div className="hidden sm:flex items-center gap-2 pl-1.5 pr-2 py-1 ml-0.5 rounded-full">
          <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center font-medium text-[13px] text-[var(--primary-fg)]">{currentUser?.name?.[0]}</div>
          <div className="leading-tight text-left hidden sm:block">
            <div className="text-[12.5px] font-medium text-[var(--text)] whitespace-nowrap">{currentUser?.name}</div>
            <div className="text-[11px] text-[var(--text-2)] whitespace-nowrap">{currentUser?.label}</div>
          </div>
        </div>
        {/* 44px 觸控目標:純文字鈕撐高、負 margin 吸收 padding,視覺間距不變 */}
        <button onClick={async () => { await logout(); navigate('/login') }} className="inline-flex items-center h-11 px-2 text-sm text-[var(--text-2)] hover:text-[var(--text)]">登出</button>
      </div>
    </header>
  )
}

export function WebLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuBtnRef = useRef(null)
  const drawerCloseRef = useRef(null)
  const prevMenuOpen = useRef(false)
  // 手機抽屜 Esc 關閉:掛 window 層（同 CopilotFab 寫法）,開著才監聽
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])
  // 抽屜焦點管理:開啟移到關閉鈕、關閉還給漢堡鈕。prevMenuOpen 擋初載誤搶焦點
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
    if (prevMenuOpen.current) menuBtnRef.current?.focus()
    prevMenuOpen.current = false
  }, [menuOpen])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed)
  // 平板(768–1279)一律 icon rail:collapsed 是「衍生值」不回寫 localStorage,
  // 平板逛一圈不會污染桌機(≥1280)的收合偏好;Playwright 預設 1280×720 落在記憶分支。
  const [isTablet, setIsTablet] = useState(() => window.matchMedia?.('(min-width: 768px) and (max-width: 1279.98px)').matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 768px) and (max-width: 1279.98px)')
    if (!mq) return
    const onChange = () => setIsTablet(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const collapsed = isTablet || sidebarCollapsed
  // 工作面預設收合；展開狀態只保留在本次瀏覽，不製造另一份持久導覽設定。
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
  const { mine: dueMine } = useTodayTasks()
  const { pathname } = useLocation()
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
      <TopBar onMenu={() => setMenuOpen(true)} scrolled={scrolled} menuBtnRef={menuBtnRef} dueCount={dueMine.length} />
      {/* 手機:點背景關閉抽屜(蓋過頂欄,抽屜再蓋過遮罩);純滑鼠 scrim,對報讀器隱藏 */}
      {menuOpen && <div aria-hidden="true" className="fixed inset-0 z-50 bg-black/40 md:hidden enter-fade" onClick={() => setMenuOpen(false)} />}
      {/* 關閉時 max-md:invisible:visibility hidden = 不可聚焦＋離開 a11y 樹,擋掉
          「Tab 進看不見的抽屜」;visibility 進 transition 清單讓滑出動畫跑完才隱藏
          （hidden→visible 則是動畫起點就顯示,開啟不閃爍）。桌機 md 斷點不受影響。 */}
      {/* 分層:手機抽屜要蓋過 z-50 遮罩故 z-[55];桌機側欄必須退到頂欄(z-40)之下——
          專案下拉/搜尋浮層錨定在頂欄,側欄若壓過頂欄,下拉會被蓋住、誤點直接觸發
          側欄導覽而換頁(ISSUE-9)。chrome 已改實心(毛玻璃退場),但層級關係不變。 */}
      <aside
        className={`chrome-glass w-72 ${collapsed ? 'md:w-20' : 'md:w-64'} border-r border-[var(--border-card)] flex flex-col print:hidden
          fixed top-16 bottom-0 left-0 z-[55] md:z-30 transition-[width,transform,visibility] duration-300 [transition-timing-function:var(--ease-drawer)]
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
          {/* 問 PMIS:佔 Gemini 在 Workspace 的位置(白底浮起鈕);自 TopBar 移入。
              aria-label 恆掛,收合成純圖示時 accessible name 不變。 */}
          <NavLink to="/agent" onClick={() => setMenuOpen(false)} aria-label="問 PMIS" title="問 PMIS"
            className={({ isActive }) => `mx-3 mt-2 md:mt-0 mb-3 h-11 rounded-[22px] flex items-center gap-2.5 px-4 text-sm font-medium shrink-0 pressable
              ${collapsed ? 'md:mx-auto md:w-14 md:px-0 md:justify-center md:mt-3' : ''}
              ${isActive
                ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]'
                : 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border-card)] [box-shadow:var(--shadow-card)] hover:[box-shadow:var(--shadow-md)]'}`}>
            <MSym name="auto_awesome" size={20} className="text-[var(--ai)]" />
            <span className={collapsed ? 'md:hidden' : ''}>問 PMIS</span>
          </NavLink>
          <nav aria-label="主要功能" className="flex-1 pb-4 overflow-auto">
            {visibleGroups.map((g) => (
              <div key={g.title} className="mb-2">
                <div className={`px-4 pt-3 pb-1.5 ${collapsed ? 'md:hidden' : ''}`}>
                  <span className="text-[11px] font-medium text-[var(--text-2)]">{g.title}</span>
                </div>
                {g.items.map((n) => {
                  // 工作面與角色子頁都來自 navConfig，不在 Layout 重寫清單。
                  const mineCount = mineCountForNavItem(dueMine, n)
                  const wbActive = n.tabs?.some((t) => t.to === pathname)
                  const itemActive = pathname === n.to || wbActive
                  const expanded = expandedWorkbenches.has(n.to)
                  return (
                    <div key={n.to}>
                      {/* Workspace 藥丸:貼齊左緣、右側全圓(0 100px 100px 0);
                          選取=淺藍底深藍字+FILL 1 圖示。收合時縮成置中圓形。 */}
                      <div className={`mr-4 my-0.5 rounded-r-full transition-colors flex items-center ${
                        itemActive && (!n.tabs || !expanded)
                          ? 'bg-[var(--blue-tint)] text-[var(--blue-text)] font-medium'
                          : itemActive
                            ? 'text-[var(--text)] font-medium'
                            : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                      } ${collapsed ? 'md:mx-0 md:mr-0 md:my-1 md:rounded-none md:bg-transparent md:justify-center' : ''}`}>
                        <NavLink to={n.to} onClick={() => setMenuOpen(false)} title={collapsed ? n.label : undefined}
                          aria-label={collapsed ? n.label : undefined}
                          className={() => `min-w-0 min-h-11 flex-1 flex items-center gap-3.5 pl-4 pr-3 text-sm rounded-r-full ${
                            collapsed ? 'md:flex-none md:w-16 md:flex-col md:gap-1 md:justify-center md:px-0 md:py-1 md:rounded-2xl' : ''
                          }`}>
                          {/* rail(collapsed):56×32 藥丸圖示+10.5px 短標直排(README 平板規格) */}
                          <span className={`relative flex items-center justify-center ${collapsed ? `md:w-14 md:h-8 md:rounded-full ${itemActive ? 'md:bg-[var(--blue-tint)]' : ''}` : ''}`}>
                            <MSym name={n.icon} size={20} fill={itemActive} className={itemActive ? 'text-[var(--blue-text)]' : 'opacity-80'} />
                            {/* rail 的未處理數:藥丸右上紅色小數字 */}
                            {collapsed && mineCount > 0 && (
                              <span aria-hidden className="hidden md:block absolute -top-1 right-0.5 text-[10px] leading-none font-medium num text-[var(--red-text)]">{mineCount}</span>
                            )}
                          </span>
                          {/* 手機抽屜永遠全名(collapsed 只影響 md+ 的 rail);rail 用短標 */}
                          <span className={collapsed ? 'md:hidden' : ''}>{n.label}</span>
                          {collapsed && <span className="hidden md:block text-[10.5px] leading-none font-medium">{NAV_SHORT[n.label] || n.label}</span>}
                          {/* 展開態:右側未處理件數(README 導覽規格)。aria-hidden——
                              e2e 用 exact accessible name 抓連結,數字不得混進名字 */}
                          {mineCount > 0 && (
                            <span aria-hidden className={`ml-auto text-xs font-medium num ${itemActive ? 'text-[var(--blue-text)]' : 'text-[var(--text-2)]'} ${collapsed ? 'md:hidden' : ''}`}>{mineCount}</span>
                          )}
                        </NavLink>
                        {n.tabs && (
                          <button type="button" onClick={() => toggleWorkbench(n.to)}
                            aria-expanded={expanded} aria-controls={`nav-children-${n.to.slice(1)}`}
                            aria-label={`${expanded ? '收合' : '展開'}${n.label}子頁`}
                            className={`w-11 h-11 rounded-full flex items-center justify-center text-[var(--text-3)] hover:bg-black/5 hover:text-[var(--text)] ${collapsed ? 'md:hidden' : ''}`}>
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
          {/* 底部模式列:正式模式=稽核中(綠);未開正式=準備模式;demo=示範模式 */}
          <div className={`shrink-0 px-4 py-3 flex items-center gap-2 text-xs text-[var(--text-2)] ${collapsed ? 'md:justify-center md:px-0' : ''}`}>
            <MSym name="verified_user" size={16} className={project?.formal_mode ? 'text-[var(--green-text)]' : 'text-[var(--text-3)]'} />
            <span className={collapsed ? 'md:hidden' : ''}>
              {demoMode ? '示範模式' : project?.formal_mode ? '正式模式 · 稽核中' : '準備模式'}
            </span>
          </div>
      </aside>
      <main className={`${collapsed ? 'md:ml-20' : 'md:ml-64'} transition-[margin] duration-300 p-4 md:p-6 pt-20 md:pt-[88px] max-md:pb-24 min-w-0 print:ml-0 print:pt-0`}>
          {workItemsSource === 'error' && (
            <ErrorBanner className="mb-4 print:hidden" onRetry={retryWorkItems}
              msg={`標單工項讀取失敗：${workItemsError || '連線異常'}。各頁資料可能不完整。`} />
          )}
          {/* 領域資料載入失敗(B-09):不再靜默顯示「尚無資料」,如實回報並可重試 */}
          {domainLoadError && (
            <ErrorBanner className="mb-4 print:hidden" onRetry={retryDomainLoad}
              msg={`${domainLoadError}。各頁資料可能不完整。`} />
          )}
        {children}
      </main>
      <BottomNav items={visibleGroups.flatMap((g) => g.items)} homeTo={currentUser?.org_type === 'owner' ? '/portfolio' : '/dashboard'} />
      <CopilotFab />
    </div>
  )
}
