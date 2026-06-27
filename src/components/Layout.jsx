import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useStore, DEMO_STEPS } from '../store.jsx'

// Procore 風格：工具依群組分區
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
  { title: '契約與品質', items: [
    { to: '/quality', icon: '🔍', label: '品質查驗' },
    { to: '/contract-upload', icon: '📤', label: '契約上傳', proto: true },
    { to: '/ai-review', icon: '🤖', label: 'AI 解析審核', proto: true },
    { to: '/itp', icon: '🛑', label: '檢驗停留點', proto: true },
    { to: '/form-builder', icon: '📝', label: 'AI 表單產生器', proto: true },
  ] },
  { title: '協作往來', items: [
    { to: '/submittals', icon: '📨', label: '送審 Submittals', proto: true },
    { to: '/rfi', icon: '❓', label: 'RFI 工程疑義', proto: true },
  ] },
  { title: '現場作業', items: [
    { to: '/daily-logs', icon: '📓', label: '施工 / 監造日報', proto: true },
    { to: '/defects', icon: '⚠️', label: '缺失追蹤', proto: true },
  ] },
  { title: '產出與稽核', items: [
    { to: '/reports', icon: '📄', label: '報表中心', proto: true },
    { to: '/audit', icon: '🔒', label: 'Audit Trail', proto: true },
  ] },
]

const mobileNav = [
  { to: '/m/home', label: '首頁' },
  { to: '/m/daily-log', label: '日誌' },
  { to: '/m/self-inspection', label: '自主檢查' },
  { to: '/m/inspection-request', label: '查驗申請' },
  { to: '/m/supervisor-inspection', label: '監造查驗' },
  { to: '/m/defect-response', label: '缺失改善' },
]

// 深色 Procore 風頂列：品牌 + 專案 + 使用者
// 專案切換器（真實後端時可切換 / 新增；prototype 只顯示名稱）
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
  const { currentUser, logout, resetDemo } = useStore()
  const navigate = useNavigate()
  const onReset = () => {
    if (window.confirm('確定要重置 demo？所有進度（契約、表單、日誌、缺失、報表）將清除並回到登入頁。')) {
      resetDemo()
      navigate('/login')
    }
  }
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
        <button onClick={onReset} className="text-xs text-white/35 hover:text-rose-300">重置</button>
      </div>
    </header>
  )
}

// 上方的 demo 進度條（淺色，與產品頂列區隔）
export function DemoProgress({ compact = false }) {
  const { completedSteps } = useStore()
  const nextIdx = DEMO_STEPS.findIndex((_, i) => !completedSteps.includes(i))
  return (
    <div className={`bg-white border-b border-slate-200 ${compact ? 'px-3 py-2' : 'px-6 py-2'}`}>
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className={`shrink-0 font-semibold text-slate-400 uppercase tracking-wide mr-2 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>Demo 流程</span>
        {DEMO_STEPS.map((step, i) => {
          const done = completedSteps.includes(i)
          const active = i === nextIdx
          return (
            <div key={i} className="flex items-center gap-1.5 shrink-0">
              <span
                className={`inline-flex items-center justify-center rounded-full font-bold ${compact ? 'w-4 h-4 text-[9px]' : 'w-5 h-5 text-[10px]'} ${
                  done ? 'bg-emerald-500 text-white' : active ? 'bg-[#f26722] text-white animate-pulse' : 'bg-slate-200 text-slate-400'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              {!compact && (
                <span className={`text-[11px] ${done ? 'text-slate-400' : active ? 'text-[#c2410c] font-medium' : 'text-slate-300'}`}>{step}</span>
              )}
              {i < DEMO_STEPS.length - 1 && <span className="text-slate-300">›</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function WebLayout({ children }) {
  const { dbMode } = useStore()
  // 真實模式隱藏尚未接 DB 的 prototype 項目，並丟掉變空的群組
  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((n) => !(dbMode && n.proto)) }))
    .filter((g) => g.items.length)
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <TopBar />
      {!dbMode && <DemoProgress />}
      <div className="flex flex-1 min-h-0">
        <aside className="w-60 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <nav className="flex-1 py-3 overflow-auto">
            {groups.map((g) => (
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
          <div className="p-3 border-t border-slate-100">
            <NavLink to="/m/home" className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50">
              <span>📱</span> 切換到手機端
            </NavLink>
          </div>
        </aside>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

// 手機畫面外框（桌機上顯示成手機）
export function PhoneFrame({ title, children }) {
  const navigate = useNavigate()
  const { currentUser } = useStore()
  return (
    <div className="min-h-screen flex flex-col items-center py-6 bg-slate-200">
      <DemoProgress compact />
      <div className="mt-6 w-[390px] h-[800px] bg-black rounded-[3rem] p-3 shadow-2xl">
        <div className="w-full h-full bg-slate-50 rounded-[2.3rem] overflow-hidden flex flex-col relative">
          {/* status bar */}
          <div className="h-7 bg-[#1c2b39] text-white text-[11px] flex items-center justify-center relative shrink-0">
            <span className="absolute left-4">9:41</span>
            PMIS AI
            <span className="absolute right-4">📶 🔋</span>
          </div>
          {/* app top bar */}
          <div className="bg-[#f26722] text-white px-4 py-3 shrink-0">
            <div className="text-[11px] opacity-80">{currentUser?.label}</div>
            <div className="font-semibold">{title}</div>
          </div>
          <div className="flex-1 overflow-auto p-4">{children}</div>
          {/* bottom nav */}
          <div className="shrink-0 grid grid-cols-6 border-t border-slate-200 bg-white">
            {mobileNav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `text-center text-[9px] leading-tight py-2 px-0.5 ${isActive ? 'text-[#f26722] font-medium' : 'text-slate-400'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
      <button onClick={() => navigate('/dashboard')} className="mt-4 text-xs text-slate-500 hover:text-slate-700">
        ← 回到 Web 管理端
      </button>
    </div>
  )
}
