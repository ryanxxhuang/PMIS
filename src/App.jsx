import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom'
import { useStore } from './store.jsx'
import { WebLayout } from './components/Layout.jsx'
import { routeAllowed, routeRegistry } from './lib/navConfig.js'
import { ConfirmHost } from './components/confirm.jsx'

import Login from './pages/Login.jsx'
import ProjectSetup from './pages/web/ProjectSetup.jsx'

// 頁面全部 lazy(P-02):原本 30 頁靜態 import 全進首屏 bundle(gzip 362KB),
// 登入頁也要先吞完估驗樹/圖表/報表。按路由切塊後,首載只拿 Login+骨架。
const Dashboard = lazy(() => import('./pages/web/Dashboard.jsx'))
const BOQ = lazy(() => import('./pages/web/BOQ.jsx'))
const SiteLog = lazy(() => import('./pages/web/SiteLog.jsx'))
const Submittals = lazy(() => import('./pages/web/Submittals.jsx'))
const RFI = lazy(() => import('./pages/web/RFI.jsx'))
const Members = lazy(() => import('./pages/web/Members.jsx'))
const SiteLogPrint = lazy(() => import('./pages/web/SiteLogPrint.jsx'))
const ChecklistPrint = lazy(() => import('./pages/web/ChecklistPrint.jsx'))
const Valuation = lazy(() => import('./pages/web/Valuation.jsx'))
const ValuationPrint = lazy(() => import('./pages/web/ValuationPrint.jsx'))
const ValuationPackage = lazy(() => import('./pages/web/ValuationPackage.jsx'))
const Progress = lazy(() => import('./pages/web/Progress.jsx'))
const Schedule = lazy(() => import('./pages/web/Schedule.jsx'))
const Quality = lazy(() => import('./pages/web/Quality.jsx'))
const Contract = lazy(() => import('./pages/web/Contract.jsx'))
const Safety = lazy(() => import('./pages/web/Safety.jsx'))
const Payments = lazy(() => import('./pages/web/Payments.jsx'))
const Cost = lazy(() => import('./pages/web/Cost.jsx'))
const ChangeOrders = lazy(() => import('./pages/web/ChangeOrders.jsx'))
const Alerts = lazy(() => import('./pages/web/Alerts.jsx'))
const Activity = lazy(() => import('./pages/web/Activity.jsx'))
const Requirements = lazy(() => import('./pages/web/Requirements.jsx'))
const MonthlyReport = lazy(() => import('./pages/web/MonthlyReport.jsx'))
// /assistant 已導向 /agent(D-008/W3-1):頁面檔與 edge fn 留待 W3-3 退場
const AgentConsole = lazy(() => import('./pages/web/Agent.jsx'))
const SupervisorReport = lazy(() => import('./pages/web/SupervisorReport.jsx'))
const RiskAudit = lazy(() => import('./pages/web/RiskAudit.jsx'))
const Portfolio = lazy(() => import('./pages/web/Portfolio.jsx'))
const Acceptance = lazy(() => import('./pages/web/Acceptance.jsx'))
const ITP = lazy(() => import('./pages/web/ITP.jsx'))
const Admin = lazy(() => import('./pages/web/Admin.jsx'))
// 漏洞回報頁刻意不掛 <Web>:機關要能不登入就讀到,否則「公開回報機制」不成立。
const Security = lazy(() => import('./pages/Security.jsx'))

const PageLoading = () => (
  <div className="min-h-[40vh] grid place-items-center text-sm text-[var(--text-3)]">載入中…</div>
)

// Gate every page behind auth; force project creation before the workspace loads.
// 角色化路由守衛:與側欄同一份 roles 對照(routeAllowed)——導覽隱藏的頁,直接輸入網址也進不去。
function Web({ children, bare = false, registryPath }) {
  const { currentUser, authReady, isSupabaseConfigured, currentProject, projectLoading, can, passwordRecovery, isPlatformAdmin, platformAdminChecked } = useStore()
  const { pathname } = useLocation()
  // session 恢復完成前先等,不可急著導 /login——否則深連結 F5 一律丟失落回 Dashboard(P1-04)
  if (!authReady) return <div className="min-h-screen grid place-items-center text-sm text-[var(--text-3)]">載入中…</div>
  // 密碼重設連結回來:recovery session 已生效,但必須先設新密碼才能進工作區
  if (passwordRecovery) return <Navigate to="/login" replace />
  if (!currentUser) return <Navigate to="/login" replace />
  // 平台後台不掛任何專案脈絡:沒有專案的平台帳號也要進得去(不被 ProjectSetup 卡住)
  if (isSupabaseConfigured && currentUser.real && pathname !== '/admin') {
    if (projectLoading) return <WebLayout><div className="text-center text-[var(--text-3)] text-sm py-20">載入專案…</div></WebLayout>
    if (!currentProject) return <WebLayout><ProjectSetup /></WebLayout>
  }
  // /admin:isPlatformAdmin 由 RPC 非同步判定,判定完成前先顯示載入——避免真正的
  // 平台管理員先閃過「無權限」畫面。前端守衛只是 UX;真正的把關在資料庫
  // (每支 admin RPC 第一行檢查 is_platform_admin() 並 raise,繞過前端也拿不到資料)。
  if (pathname === '/admin' && !platformAdminChecked) {
    return <div className="min-h-screen grid place-items-center text-sm text-[var(--text-3)]">載入中…</div>
  }
  if (!routeAllowed(registryPath || pathname, currentUser.org_type || 'contractor', can.override, isPlatformAdmin)) {
    return (
      <WebLayout>
        <div className="text-center py-20 space-y-2">
          <div className="text-[var(--text)] font-medium">你的角色沒有此頁的存取權限</div>
          <p className="text-sm text-[var(--text-3)]">這個工作畫面僅開放給特定角色（如廠商內部成本、監造報表）。</p>
        </div>
      </WebLayout>
    )
  }
  if (bare) return <Suspense fallback={<PageLoading />}>{children}</Suspense>
  return <WebLayout><Suspense fallback={<PageLoading />}>{children}</Suspense></WebLayout>
}

// 找不到的路徑(U-02):原本靜默導回登入/首頁,使用者不知道自己打錯網址或收藏的連結已失效。
function NotFound() {
  const { pathname } = useLocation()
  const { currentUser } = useStore()
  const home = currentUser?.org_type === 'owner' ? '/portfolio' : '/dashboard'
  const homeLabel = currentUser?.org_type === 'owner' ? '回到跨案總覽' : '回到今日待辦'
  return (
    <div className="text-center py-20 space-y-3">
      <div className="text-4xl">🧭</div>
      <div className="text-[var(--text)] font-medium">找不到這個頁面</div>
      <p className="text-sm text-[var(--text-3)]">網址 <code className="px-1 rounded bg-[var(--surface-2)]">{pathname}</code> 不存在——可能打錯了,或這個連結已失效。</p>
      <Link to={home} className="inline-block text-sm font-medium text-[var(--blue-text)] hover:underline">← {homeLabel}</Link>
    </div>
  )
}

function HomeRedirect() {
  const { currentUser, authReady } = useStore()
  if (!authReady) return <div className="min-h-screen grid place-items-center text-sm text-[var(--text-3)]">載入中…</div>
  if (!currentUser) return <Navigate to="/login" replace />
  return <Navigate to={currentUser.org_type === 'owner' ? '/portfolio' : '/dashboard'} replace />
}

const appRoutes = [
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <Login /> },
  { path: '/security', element: <Security /> },
  { path: '/dashboard', element: <Dashboard /> },
  // D-008(W3-1):/agent 是唯一完整 AI 入口；/assistant 只保留相容導向。
  { path: '/assistant', element: <Navigate to="/agent" replace /> },
  { path: '/agent', element: <AgentConsole /> },
  { path: '/supervisor-report', element: <SupervisorReport /> },
  { path: '/audit', element: <RiskAudit /> },
  { path: '/portfolio', element: <Portfolio /> },
  { path: '/acceptance', element: <Acceptance /> },
  { path: '/project/new', element: <ProjectSetup /> },
  { path: '/boq', element: <BOQ /> },
  { path: '/site-log', element: <SiteLog /> },
  { path: '/site-log/print', element: <SiteLogPrint /> },
  { path: '/valuation', element: <Valuation /> },
  { path: '/valuation/print', element: <ValuationPrint /> },
  { path: '/valuation/package', element: <ValuationPackage /> },
  { path: '/payments', element: <Payments /> },
  { path: '/cost', element: <Cost /> },
  { path: '/change-orders', element: <ChangeOrders /> },
  { path: '/progress', element: <Progress /> },
  { path: '/schedule', element: <Schedule /> },
  { path: '/quality', element: <Quality /> },
  { path: '/itp', element: <ITP /> },
  { path: '/quality/checklist-print', element: <ChecklistPrint /> },
  { path: '/safety', element: <Safety /> },
  { path: '/submittals', element: <Submittals /> },
  { path: '/rfi', element: <RFI /> },
  { path: '/members', element: <Members /> },
  { path: '/contract', element: <Contract /> },
  { path: '/alerts', element: <Alerts /> },
  { path: '/activity', element: <Activity /> },
  { path: '/requirements', element: <Requirements /> },
  { path: '/monthly-report', element: <MonthlyReport /> },
  { path: '/admin', element: <Admin /> },
  { path: '*', element: <NotFound /> },
]

for (const { path } of appRoutes) {
  if (!routeRegistry[path]) throw new Error(`前端路由尚未登記：${path}`)
}

function guardedElement({ path, element }) {
  const rule = routeRegistry[path]
  if (rule.access === 'public' || rule.access === 'redirect') return element
  return <Web bare={rule.surface === 'print'} registryPath={path}>{element}</Web>
}

export default function App() {
  return (
    <>
    <ConfirmHost />
    <Suspense fallback={<PageLoading />}>
    <Routes>
      {appRoutes.map((route) => (
        <Route key={route.path} path={route.path} element={guardedElement(route)} />
      ))}
    </Routes>
    </Suspense>
    </>
  )
}
