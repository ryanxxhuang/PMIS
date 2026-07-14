import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { appConfirm } from './confirm.jsx'
import { visibleNavGroups, workbenchFor } from '../lib/navConfig.js'
import CopilotFab from './CopilotFab.jsx'
import { Menu, ChevronDown, Trash2, Moon, Sun, Plus } from 'lucide-react'

// 工作台分頁列(§9 瘦身):同一工作台的路由以分頁互切,分頁可見性與導覽/守衛同源。
// 只有一個可見分頁時不渲染(例如監造的「估驗與金流」只剩估驗計價)。
export function WorkbenchTabs() {
  const { currentUser, can } = useStore()
  const { pathname } = useLocation()
  const wb = workbenchFor(pathname, currentUser?.org_type || 'contractor', can?.override)
  if (!wb || wb.tabs.length < 2) return null
  return (
    <div className="flex items-center gap-1 border-b border-[var(--border-2)] mb-5 print:hidden" role="tablist" aria-label={wb.label}>
      {wb.tabs.map((t) => (
        <NavLink key={t.to} to={t.to}
          className={({ isActive }) =>
            `px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-[var(--blue)] text-[var(--blue-text)] font-semibold'
                : 'border-transparent text-[var(--text-2)] hover:text-[var(--text)]'
            }`}>
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}

// Top-bar project picker: switch / create / delete (real backend only).
function ProjectSwitcher() {
  const { project, projects, currentProject, switchProject, deleteProject, isSupabaseConfigured } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (!isSupabaseConfigured || !currentProject) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[var(--text-3)] text-xs shrink-0">專案</span>
        <span className="font-medium truncate text-[var(--text)]">{project.project_name}</span>
      </div>
    )
  }
  return (
    <div className="relative min-w-0">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 hover:bg-[var(--surface-2)] rounded-lg px-2 py-1.5 -ml-2">
        <span className="text-[var(--text-3)] text-xs shrink-0">專案</span>
        <span title={currentProject.project_name} className="font-medium truncate max-w-[42vw] md:max-w-[280px] text-[var(--text)]">{currentProject.project_name}</span>
        <ChevronDown size={14} className="text-[var(--text-2)] shrink-0" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-1 w-72 bg-[var(--surface)] text-[var(--text)] rounded-lg shadow-xl border border-[var(--border)] py-1 z-20">
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

function TopBar({ onMenu }) {
  const { currentUser, logout } = useStore()
  const navigate = useNavigate()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggleTheme = () => {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('pmis-theme', next ? 'dark' : 'light') } catch { /* noop */ }
    setDark(next)
  }
  return (
    <header className="bg-[var(--surface)] border-b border-[var(--border)] h-16 flex items-center justify-between px-3 md:px-5 shrink-0 relative z-10 print:hidden">
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        <button onClick={onMenu} aria-label="選單" className="md:hidden w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)]"><Menu size={20} aria-hidden /></button>
        <div className="font-medium text-xl tracking-tight text-[var(--text)] shrink-0">PMIS <span className="text-[var(--accent-text)] font-bold">AI</span></div>
        <div className="h-6 w-px bg-[var(--border)] shrink-0 hidden sm:block" />
        <ProjectSwitcher />
      </div>
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <div className="text-right leading-tight hidden sm:block">
          <div className="text-sm text-[var(--text)]">{currentUser?.name}</div>
          <div className="text-[11px] text-[var(--text-2)]">{currentUser?.label}</div>
        </div>
        <button onClick={toggleTheme} aria-label="切換深色模式" title="切換深色模式" className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)]">{dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}</button>
        <div className="w-9 h-9 rounded-full bg-[var(--primary)] flex items-center justify-center font-medium text-sm text-white">{currentUser?.name?.[0]}</div>
        <button onClick={async () => { await logout(); navigate('/login') }} className="text-sm text-[var(--text-2)] hover:text-[var(--text)]">登出</button>
      </div>
    </header>
  )
}

export function WebLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { currentUser, can, workItemsSource, workItemsError, retryWorkItems } = useStore()
  const { pathname } = useLocation()
  // 角色化導覽:依 org_type 過濾工具（成本/請款/排程等）——非正式模式的
  // admin(專案建立者)看得到全部;正式模式後回歸自己的角色視角。
  const org = currentUser?.org_type || 'contractor'
  const visibleGroups = visibleNavGroups(org, can?.override)
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <TopBar onMenu={() => setMenuOpen(true)} />
      <div className="flex flex-1 min-h-0">
        {/* 手機:點背景關閉抽屜 */}
        {menuOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuOpen(false)} />}
        <aside
          className={`w-64 bg-[var(--surface)] border-r border-[var(--border-2)] flex flex-col shrink-0 print:hidden
            fixed top-16 bottom-0 left-0 z-40 transition-transform
            md:static md:top-auto md:z-auto md:translate-x-0
            ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <nav className="flex-1 py-3 overflow-auto">
            {visibleGroups.map((g) => (
              <div key={g.title} className="mb-3">
                <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                  <span className="text-[10px] font-medium tracking-[0.12em] text-[var(--text-3)] shrink-0">{g.title}</span>
                  <span className="flex-1 border-t border-[var(--border-2)]" />
                </div>
                {g.items.map((n) => {
                  const Icon = n.icon
                  // 工作台入口:站在任一分頁上都算 active(NavLink 只認自己的 to)
                  const wbActive = n.tabs?.some((t) => t.to === pathname)
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 mr-3 my-0.5 pl-[13px] pr-3 py-[7px] rounded-r-md text-sm border-l-[3px] transition ${
                          (isActive || wbActive)
                            ? 'border-[var(--blue)] bg-[var(--blue-tint)] text-[var(--blue-text)] font-semibold'
                            : 'border-transparent text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                        }`
                      }
                    >
                      <Icon size={16} strokeWidth={1.8} className="shrink-0 opacity-75" aria-hidden />
                      {n.label}
                    </NavLink>
                  )
                })}
              </div>
            ))}
          </nav>
        </aside>
        <main className="flex-1 p-4 md:p-6 overflow-auto min-w-0">
          {workItemsSource === 'error' && (
            <div className="mb-4 flex items-center gap-3 flex-wrap rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 print:hidden">
              <span>標單工項讀取失敗：{workItemsError || '連線異常'}。各頁資料可能不完整。</span>
              <button onClick={retryWorkItems} className="font-medium underline hover:text-rose-900">重試</button>
            </div>
          )}
          {children}
        </main>
      </div>
      <CopilotFab />
    </div>
  )
}
