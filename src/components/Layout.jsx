import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { appConfirm } from './confirm.jsx'
import {
  LayoutDashboard, LayoutGrid, Sparkles, Bell, CalendarClock, Newspaper, BadgeCheck,
  ClipboardList, PencilLine, Coins, Receipt, Wallet, Wrench, TrendingUp, CalendarRange,
  ShieldCheck, ShieldAlert, ClipboardCheck, HardHat, FileCheck2, MessageSquareWarning, Users, Flag,
  Menu, ChevronDown, Trash2, Moon, Sun, Plus,
} from 'lucide-react'

const navGroups = [
  { title: '總覽', items: [
    { to: '/portfolio', icon: LayoutGrid, label: '跨案總覽' },
    { to: '/dashboard', icon: LayoutDashboard, label: '專案 Dashboard' },
    { to: '/assistant', icon: Sparkles, label: 'AI 助理' },
    { to: '/alerts', icon: Bell, label: '提醒中心' },
    { to: '/contract', icon: CalendarClock, label: '契約管制' },
    { to: '/acceptance', icon: BadgeCheck, label: '驗收結算' },
    { to: '/monthly-report', icon: Newspaper, label: '施工月報' },
    { to: '/audit', icon: ShieldAlert, label: '風險稽核', roles: ['owner'] }, // 機關防弊
  ] },
  { title: '成本與進度', items: [
    { to: '/boq', icon: ClipboardList, label: '標單工項' },
    { to: '/site-log', icon: PencilLine, label: '施工日誌' },
    { to: '/valuation', icon: Coins, label: '估驗計價' },
    { to: '/payments', icon: Receipt, label: '請款收款', roles: ['contractor', 'owner'], perm: 'updatePayment' }, // 監造不經手請款
    { to: '/cost', icon: Wallet, label: '成本管理', roles: ['contractor'], perm: 'accessContractorPrivate' }, // 廠商毛利機密(contractor_pm)
    { to: '/change-orders', icon: Wrench, label: '變更設計' },
    { to: '/progress', icon: TrendingUp, label: '進度 S 曲線' },
    { to: '/schedule', icon: CalendarRange, label: '逐工項排程', roles: ['contractor'] },   // 廠商內部規劃
  ] },
  { title: '品質與工安', items: [
    { to: '/quality', icon: ShieldCheck, label: '品質查驗' },
    { to: '/itp', icon: Flag, label: '檢驗停留點' },
    { to: '/safety', icon: HardHat, label: '工安管理' },
  ] },
  { title: '監造協作', items: [
    { to: '/submittals', icon: FileCheck2, label: '送審文件' },
    { to: '/rfi', icon: MessageSquareWarning, label: '工程疑義' },
    { to: '/supervisor-report', icon: ClipboardCheck, label: '監造報表', roles: ['supervisor'] }, // AI 監造報表
    { to: '/members', icon: Users, label: '專案成員' },
  ] },
]

// Top-bar project picker: switch / create / delete (real backend only).
function ProjectSwitcher() {
  const { project, projects, currentProject, switchProject, deleteProject, isSupabaseConfigured, can } = useStore()
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
            {can.manageProjectIdentity && <button onClick={async () => {
              setOpen(false)
              // 高危險:整案永久刪除 → 要求輸入專案名稱確認,防手滑
              const ok = await appConfirm({
                title: '永久刪除專案',
                body: `「${currentProject.project_name}」的標單、估驗、進度、施工日誌、查驗、缺失將一併永久刪除，無法復原。`,
                danger: true, confirmLabel: '永久刪除', requireText: currentProject.project_name,
              })
              if (ok) await deleteProject(currentProject.project_id)
            }} className="w-full text-left px-3 py-2 text-sm text-[var(--red-text)] hover:bg-[var(--red-tint)] flex items-center gap-1.5"><Trash2 size={14} aria-hidden /> 刪除此專案</button>}
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
  const { partyOrgKey, can } = useStore()
  // 角色化導覽(P0-03):依「這個專案」的 membership party 過濾工具——切換專案時
  // 跟著變(A 案廠商/B 案監造看到不同側欄)。未解析身分只看共用工具。
  // 技術管理員不再因 admin 看到全部(技術管理 ≠ 契約權限);perm 鍵對應 can 矩陣。
  const visibleGroups = navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((n) =>
        (!n.roles || (partyOrgKey && n.roles.includes(partyOrgKey)))
        && (!n.perm || can?.[n.perm])),
    }))
    .filter((g) => g.items.length)
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
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 mr-3 my-0.5 pl-[13px] pr-3 py-[7px] rounded-r-md text-sm border-l-[3px] transition ${
                          isActive
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
        <main className="flex-1 p-4 md:p-6 overflow-auto min-w-0">{children}</main>
      </div>
    </div>
  )
}
