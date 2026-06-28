import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'

const navGroups = [
  { title: '總覽', items: [
    { to: '/dashboard', icon: '📊', label: '專案 Dashboard' },
  ] },
  { title: '成本與進度', items: [
    { to: '/boq', icon: '📋', label: '標單工項' },
    { to: '/site-log', icon: '📝', label: '施工日誌' },
    { to: '/valuation', icon: '💰', label: '估驗計價' },
    { to: '/progress', icon: '📈', label: '進度 S 曲線' },
  ] },
  { title: '品質', items: [
    { to: '/quality', icon: '🔍', label: '品質查驗' },
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
        <span className="text-white/40 text-xs shrink-0">專案</span>
        <span className="font-medium truncate">{project.project_name}</span>
      </div>
    )
  }
  return (
    <div className="relative min-w-0">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 hover:bg-white/5 rounded px-2 py-1 -ml-2">
        <span className="text-white/40 text-xs shrink-0">專案</span>
        <span className="font-medium truncate max-w-[280px]">{currentProject.project_name}</span>
        <span className="text-white/40 text-[10px]">▼</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-1 w-72 bg-white text-slate-700 rounded-lg shadow-xl border border-slate-200 py-1 z-20">
            {projects.map((p) => (
              <button key={p.project_id} onClick={() => { switchProject(p.project_id); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${p.project_id === currentProject.project_id ? 'bg-[#fdf0e9]' : ''}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.project_id === currentProject.project_id ? 'bg-[#f26722]' : 'bg-slate-200'}`} />
                <span className="truncate">{p.project_name}</span>
              </button>
            ))}
            <div className="border-t border-slate-100 my-1" />
            <button onClick={() => { setOpen(false); navigate('/project/new') }}
              className="w-full text-left px-3 py-2 text-sm text-[#c2410c] hover:bg-slate-50">＋ 新增專案</button>
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

function TopBar() {
  const { currentUser, logout } = useStore()
  const navigate = useNavigate()
  return (
    <header className="bg-[#1c2b39] text-white h-14 flex items-center justify-between px-5 shrink-0">
      <div className="flex items-center gap-4 min-w-0">
        <div className="font-bold text-lg tracking-tight shrink-0">PMIS <span className="text-[#f26722]">AI</span></div>
        <div className="h-5 w-px bg-white/15 shrink-0" />
        <ProjectSwitcher />
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right leading-tight hidden sm:block">
          <div className="text-sm text-white/90">{currentUser?.name}</div>
          <div className="text-[11px] text-white/45">{currentUser?.label}</div>
        </div>
        <div className="w-8 h-8 rounded-full bg-[#f26722] flex items-center justify-center font-bold text-sm">{currentUser?.name?.[0]}</div>
        <button onClick={async () => { await logout(); navigate('/login') }} className="text-xs text-white/50 hover:text-white">登出</button>
      </div>
    </header>
  )
}

export function WebLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <aside className="w-60 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <nav className="flex-1 py-3 overflow-auto">
            {navGroups.map((g) => (
              <div key={g.title} className="mb-1">
                <div className="px-5 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</div>
                {g.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 pl-[17px] pr-4 py-2 text-sm border-l-[3px] transition ${
                        isActive
                          ? 'bg-[#fdf0e9] text-[#c2410c] font-medium border-[#f26722]'
                          : 'text-slate-600 hover:bg-slate-50 border-transparent'
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
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
