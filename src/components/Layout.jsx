import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'

const navGroups = [
  { title: '總覽', items: [
    { to: '/dashboard', icon: '📊', label: '專案 Dashboard' },
    { to: '/alerts', icon: '🔔', label: '提醒中心' },
    { to: '/contract', icon: '📅', label: '契約管制' },
  ] },
  { title: '成本與進度', items: [
    { to: '/boq', icon: '📋', label: '標單工項' },
    { to: '/site-log', icon: '📝', label: '施工日誌' },
    { to: '/valuation', icon: '💰', label: '估驗計價' },
    { to: '/payments', icon: '🧾', label: '請款收款' },
    { to: '/cost', icon: '🧮', label: '成本管理' },
    { to: '/change-orders', icon: '🔧', label: '變更設計' },
    { to: '/progress', icon: '📈', label: '進度 S 曲線' },
    { to: '/schedule', icon: '🗓️', label: '逐工項排程' },
  ] },
  { title: '品質與工安', items: [
    { to: '/quality', icon: '🔍', label: '品質查驗' },
    { to: '/safety', icon: '🦺', label: '工安管理' },
  ] },
]

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
        <span className="font-medium truncate max-w-[42vw] md:max-w-[280px] text-[var(--text)]">{currentProject.project_name}</span>
        <span className="text-[var(--text-2)] text-[10px]">▼</span>
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
              className="w-full text-left px-3 py-2 text-sm text-[var(--blue-text)] hover:bg-[var(--surface-2)]">＋ 新增專案</button>
            <button onClick={async () => {
              if (window.confirm(`確定刪除專案「${currentProject.project_name}」？\n此專案的標單、估驗、進度、施工日誌、查驗、缺失將一併永久刪除，無法復原。`)) {
                setOpen(false); await deleteProject(currentProject.project_id)
              }
            }} className="w-full text-left px-3 py-2 text-sm text-rose-500 hover:bg-rose-50">🗑 刪除此專案</button>
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
    <header className="bg-[var(--surface)] border-b border-[var(--border)] h-16 flex items-center justify-between px-3 md:px-5 shrink-0 relative z-10">
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        <button onClick={onMenu} aria-label="選單" className="md:hidden w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-xl text-[var(--text-2)] hover:bg-[var(--surface-2)]">☰</button>
        <div className="font-medium text-xl tracking-tight text-[var(--text-2)] shrink-0">PMIS <span className="text-[var(--blue)] font-bold">AI</span></div>
        <div className="h-6 w-px bg-[var(--border)] shrink-0 hidden sm:block" />
        <ProjectSwitcher />
      </div>
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <div className="text-right leading-tight hidden sm:block">
          <div className="text-sm text-[var(--text)]">{currentUser?.name}</div>
          <div className="text-[11px] text-[var(--text-2)]">{currentUser?.label}</div>
        </div>
        <button onClick={toggleTheme} aria-label="切換深色模式" title="切換深色模式" className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)]">{dark ? '☀️' : '🌙'}</button>
        <div className="w-9 h-9 rounded-full bg-[#1a73e8] flex items-center justify-center font-medium text-sm text-white">{currentUser?.name?.[0]}</div>
        <button onClick={async () => { await logout(); navigate('/login') }} className="text-sm text-[var(--text-2)] hover:text-[var(--text)]">登出</button>
      </div>
    </header>
  )
}

export function WebLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <TopBar onMenu={() => setMenuOpen(true)} />
      <div className="flex flex-1 min-h-0">
        {/* 手機:點背景關閉抽屜 */}
        {menuOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuOpen(false)} />}
        <aside
          className={`w-64 bg-[var(--surface)] border-r border-[var(--border-2)] flex flex-col shrink-0
            fixed top-16 bottom-0 left-0 z-40 transition-transform
            md:static md:top-auto md:z-auto md:translate-x-0
            ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <nav className="flex-1 py-3 overflow-auto">
            {navGroups.map((g) => (
              <div key={g.title} className="mb-2">
                <div className="px-6 pt-3 pb-1.5 text-[11px] font-medium tracking-wide text-[var(--text-3)]">{g.title}</div>
                {g.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 mx-3 my-0.5 px-4 py-2 rounded-full text-sm transition ${
                        isActive
                          ? 'bg-[var(--blue-tint)] text-[var(--blue-text)] font-medium'
                          : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
                      }`
                    }
                  >
                    <span className="text-base">{n.icon}</span>
                    {n.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <main className="flex-1 p-4 md:p-6 overflow-auto min-w-0">{children}</main>
      </div>
    </div>
  )
}
