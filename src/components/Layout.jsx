import { useState, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { appConfirm } from './confirm.jsx'
import { visibleNavGroups } from '../lib/navConfig.js'
import CopilotFab from './CopilotFab.jsx'
import { Menu, ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, Trash2, Moon, Sun, MonitorSmartphone, Plus, Bot, X } from 'lucide-react'
import { getThemeMode, setThemeMode, THEME_MODES } from '../lib/theme.js'

const SIDEBAR_COLLAPSED_KEY = 'pmis-sidebar-collapsed'

const initialSidebarCollapsed = () => {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1' } catch { return false }
}

// Top-bar project picker: switch / create / delete (real backend only).
function ProjectSwitcher() {
  const { project, projects, currentProject, switchProject, deleteProject, isSupabaseConfigured } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (!isSupabaseConfigured || !currentProject) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="hidden lg:inline text-[var(--text-3)] text-xs shrink-0">專案</span>
        <span className="font-medium truncate max-w-[24vw] sm:max-w-[36vw] md:max-w-[280px] text-[var(--text)]">{project.project_name}</span>
      </div>
    )
  }
  return (
    <div className="relative min-w-0" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-2 min-w-0 hover:bg-[var(--surface-2)] rounded-lg px-2 py-1.5 -ml-2 pressable">
        <span className="hidden lg:inline text-[var(--text-3)] text-xs shrink-0">專案</span>
        <span title={currentProject.project_name} className="font-medium truncate max-w-[24vw] sm:max-w-[36vw] md:max-w-[280px] text-[var(--text)]">{currentProject.project_name}</span>
        <ChevronDown size={14} className="text-[var(--text-2)] shrink-0" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 mt-1 w-72 bg-[var(--surface)] text-[var(--text)] rounded-lg shadow-xl border border-[var(--border)] py-1 z-20 enter-menu origin-top-left">
            {projects.map((p) => (
              <button key={p.project_id} onClick={() => { switchProject(p.project_id); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-2)] flex items-center gap-2 ${p.project_id === currentProject.project_id ? 'bg-[var(--blue-tint)]' : ''}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.project_id === currentProject.project_id ? 'bg-[var(--blue)]' : 'bg-[var(--border)]'}`} />
                <span className="truncate">{p.project_name}</span>
              </button>
            ))}
            <div className="border-t border-[var(--border-2)] my-1" />
            <button onClick={() => { setOpen(false); navigate('/project/new') }}
              className="w-full text-left px-3 py-2 text-sm text-[var(--blue-text)] hover:bg-[var(--surface-2)] flex items-center gap-1.5"><Plus size={14} aria-hidden /> 新增專案</button>
            <button onClick={async () => {
              setOpen(false)
              // 高危險:整案永久刪除 → 要求輸入專案名稱確認,防手滑
              const ok = await appConfirm({
                title: '永久刪除專案',
                body: `「${currentProject.project_name}」的標單、估驗、進度、施工日誌、查驗、缺失將一併永久刪除，無法復原。`,
                danger: true, confirmLabel: '永久刪除', requireText: currentProject.project_name,
              })
              if (ok) await deleteProject(currentProject.project_id)
            }} className="w-full text-left px-3 py-2 text-sm text-[var(--red-text)] hover:bg-[var(--red-tint)] flex items-center gap-1.5"><Trash2 size={14} aria-hidden /> 刪除此專案</button>
          </div>
        </>
      )}
    </div>
  )
}

// 主題三態循環(U-07):亮 → 暗 → 跟隨系統 → 亮
const THEME_META = {
  light: { icon: Sun, label: '亮色' },
  dark: { icon: Moon, label: '深色' },
  system: { icon: MonitorSmartphone, label: '跟隨系統' },
}

function TopBar({ onMenu, scrolled }) {
  const { currentUser, logout } = useStore()
  const navigate = useNavigate()
  const [mode, setMode] = useState(getThemeMode)
  const cycleTheme = () => {
    const next = THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]
    setThemeMode(next)
    setMode(next)
  }
  const ThemeIcon = THEME_META[mode].icon
  return (
    <header data-scrolled={scrolled} className="chrome-glass chrome-edge fixed top-0 inset-x-0 z-40 h-16 flex items-center justify-between px-3 md:px-5 print:hidden">
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        <button onClick={onMenu} aria-label="選單" className="md:hidden w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] pressable"><Menu size={20} aria-hidden /></button>
        <NavLink to={currentUser?.org_type === 'owner' ? '/portfolio' : '/dashboard'} aria-label="GovAgent 公共工程首頁" className="flex items-baseline gap-2 shrink-0">
          <span className="font-bold text-lg tracking-tight text-[var(--text)]">Gov<span className="text-[var(--accent-text)]">Agent</span></span>
          <span className="hidden xl:inline text-[11px] text-[var(--text-3)]">公共工程</span>
        </NavLink>
        <div className="h-6 w-px bg-[var(--border)] shrink-0 hidden sm:block" />
        <ProjectSwitcher />
      </div>
      <div className="flex items-center gap-1 sm:gap-2 md:gap-3 shrink-0">
        <NavLink to="/agent" aria-label="問 GovAgent" title="問 GovAgent"
          className={({ isActive }) => `h-9 inline-flex items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors ${isActive ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`}>
          <Bot size={17} aria-hidden />
          <span className="hidden lg:inline">問 GovAgent</span>
        </NavLink>
        <div className="text-right leading-tight hidden sm:block">
          <div className="text-sm text-[var(--text)]">{currentUser?.name}</div>
          <div className="text-[11px] text-[var(--text-2)]">{currentUser?.label}</div>
        </div>
        <button onClick={cycleTheme} aria-label={`主題:${THEME_META[mode].label}(點擊切換)`} title={`主題:${THEME_META[mode].label}(點擊切換)`} className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] pressable"><ThemeIcon size={18} aria-hidden /></button>
        <div className="hidden sm:flex w-9 h-9 rounded-full bg-[var(--primary)] items-center justify-center font-medium text-sm text-white">{currentUser?.name?.[0]}</div>
        <button onClick={async () => { await logout(); navigate('/login') }} className="text-sm text-[var(--text-2)] hover:text-[var(--text)]">登出</button>
      </div>
    </header>
  )
}

export function WebLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed)
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
  const { currentUser, can, workItemsSource, workItemsError, retryWorkItems, domainLoadError, retryDomainLoad, isPlatformAdmin } = useStore()
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
      <TopBar onMenu={() => setMenuOpen(true)} scrolled={scrolled} />
      {/* 手機:點背景關閉抽屜(蓋過頂欄,抽屜再蓋過遮罩) */}
      {menuOpen && <div className="fixed inset-0 z-50 bg-black/40 md:hidden enter-fade" onClick={() => setMenuOpen(false)} />}
      <aside
        className={`chrome-glass w-72 ${sidebarCollapsed ? 'md:w-16' : 'md:w-64'} border-r border-[var(--border-card)] flex flex-col print:hidden
          fixed top-16 bottom-0 left-0 z-[55] transition-[width,transform] duration-300 [transition-timing-function:var(--ease-drawer)]
          md:translate-x-0
          ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
          <div className="md:hidden flex items-center justify-between border-b border-[var(--border-2)] px-4 py-3">
            <span className="text-sm font-semibold text-[var(--text)]">功能選單</span>
            <button onClick={() => setMenuOpen(false)} aria-label="關閉選單" className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)]"><X size={19} aria-hidden /></button>
          </div>
          <div className={`hidden md:flex h-12 shrink-0 items-center ${sidebarCollapsed ? 'justify-center' : 'justify-end px-3'}`}>
            <button onClick={setDesktopCollapsed}
              aria-label={sidebarCollapsed ? '展開側邊欄' : '收合側邊欄'}
              title={sidebarCollapsed ? '展開側邊欄' : '收合側邊欄'}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] pressable">
              {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
            </button>
          </div>
          <nav aria-label="主要功能" className="flex-1 pb-4 overflow-auto">
            {visibleGroups.map((g) => (
              <div key={g.title} className="mb-2">
                <div className={`px-4 pt-4 pb-1.5 ${sidebarCollapsed ? 'md:hidden' : ''}`}>
                  <span className="text-xs font-medium text-[var(--text-3)]">{g.title}</span>
                </div>
                {g.items.map((n) => {
                  const Icon = n.icon
                  // 工作面與角色子頁都來自 navConfig，不在 Layout 重寫清單。
                  const wbActive = n.tabs?.some((t) => t.to === pathname)
                  const itemActive = pathname === n.to || wbActive
                  const expanded = expandedWorkbenches.has(n.to)
                  return (
                    <div key={n.to}>
                      <div className={`mx-2 my-0.5 rounded-xl transition-colors flex items-center ${
                        itemActive && (!n.tabs || !expanded)
                          ? 'bg-[var(--surface-2)] text-[var(--text)] font-semibold'
                          : itemActive
                            ? 'text-[var(--text)] font-semibold'
                            : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                      } ${sidebarCollapsed ? `md:justify-center ${itemActive ? 'md:bg-[var(--surface-2)] md:text-[var(--text)]' : ''}` : ''}`}>
                        <NavLink to={n.to} onClick={() => setMenuOpen(false)} title={sidebarCollapsed ? n.label : undefined}
                          aria-label={sidebarCollapsed ? n.label : undefined}
                          className={() => `min-w-0 min-h-11 flex-1 flex items-center gap-2.5 px-3 text-sm ${
                            sidebarCollapsed ? 'md:flex-none md:w-12 md:justify-center md:px-0' : ''
                          }`}>
                          <Icon size={17} strokeWidth={1.8} className="shrink-0 opacity-75" aria-hidden />
                          <span className={sidebarCollapsed ? 'md:hidden' : ''}>{n.label}</span>
                        </NavLink>
                        {n.tabs && (
                          <button type="button" onClick={() => toggleWorkbench(n.to)}
                            aria-expanded={expanded} aria-controls={`nav-children-${n.to.slice(1)}`}
                            aria-label={`${expanded ? '收合' : '展開'}${n.label}子頁`}
                            className={`w-9 h-9 mr-1 rounded-lg flex items-center justify-center text-[var(--text-3)] hover:bg-black/5 hover:text-[var(--text)] ${sidebarCollapsed ? 'md:hidden' : ''}`}>
                            {expanded ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                          </button>
                        )}
                      </div>
                      {n.tabs && expanded && (
                        <div id={`nav-children-${n.to.slice(1)}`} className={`pb-1 ${sidebarCollapsed ? 'md:hidden' : ''}`}>
                          {n.tabs.map((tab) => (
                            <NavLink key={tab.to} to={tab.to} onClick={() => setMenuOpen(false)}
                              className={({ isActive }) => `min-h-10 mx-2 pl-10 pr-3 rounded-xl flex items-center text-sm transition-colors ${
                                isActive
                                  ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium'
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
      </aside>
      <main className={`${sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'} transition-[margin] duration-300 p-4 md:p-6 pt-20 md:pt-[88px] min-w-0 print:ml-0 print:pt-0`}>
          {workItemsSource === 'error' && (
            <div className="mb-4 flex items-center gap-3 flex-wrap rounded-lg border border-[var(--red-text)]/25 bg-[var(--red-tint)] px-4 py-2.5 text-sm text-[var(--red-text)] print:hidden enter-row">
              <span>標單工項讀取失敗：{workItemsError || '連線異常'}。各頁資料可能不完整。</span>
              <button onClick={retryWorkItems} className="font-medium underline opacity-90 hover:opacity-100">重試</button>
            </div>
          )}
          {/* 領域資料載入失敗(B-09):不再靜默顯示「尚無資料」,如實回報並可重試 */}
          {domainLoadError && (
            <div className="mb-4 flex items-center gap-3 flex-wrap rounded-lg border border-[var(--red-text)]/25 bg-[var(--red-tint)] px-4 py-2.5 text-sm text-[var(--red-text)] print:hidden enter-row">
              <span>{domainLoadError}。各頁資料可能不完整。</span>
              <button onClick={retryDomainLoad} className="font-medium underline opacity-90 hover:opacity-100">重試</button>
            </div>
          )}
        {children}
      </main>
      <CopilotFab />
    </div>
  )
}
