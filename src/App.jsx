import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom'
import { useStore } from './store.jsx'
import { WebLayout, WorkbenchTabs } from './components/Layout.jsx'
import { routeAllowed } from './lib/navConfig.js'
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
const Assistant = lazy(() => import('./pages/web/Assistant.jsx'))
const SupervisorReport = lazy(() => import('./pages/web/SupervisorReport.jsx'))
const RiskAudit = lazy(() => import('./pages/web/RiskAudit.jsx'))
const Portfolio = lazy(() => import('./pages/web/Portfolio.jsx'))
const Acceptance = lazy(() => import('./pages/web/Acceptance.jsx'))
const ITP = lazy(() => import('./pages/web/ITP.jsx'))

const PageLoading = () => (
  <div className="min-h-[40vh] grid place-items-center text-sm text-[var(--text-3)]">載入中…</div>
)

// Gate every page behind auth; force project creation before the workspace loads.
// 角色化路由守衛:與側欄同一份 roles 對照(routeAllowed)——導覽隱藏的頁,直接輸入網址也進不去。
function Web({ children }) {
  const { currentUser, authReady, isSupabaseConfigured, currentProject, projectLoading, can } = useStore()
  const { pathname } = useLocation()
  // session 恢復完成前先等,不可急著導 /login——否則深連結 F5 一律丟失落回 Dashboard(P1-04)
  if (!authReady) return <div className="min-h-screen grid place-items-center text-sm text-[var(--text-3)]">載入中…</div>
  if (!currentUser) return <Navigate to="/login" replace />
  if (isSupabaseConfigured && currentUser.real) {
    if (projectLoading) return <WebLayout><div className="text-center text-[var(--text-3)] text-sm py-20">載入專案…</div></WebLayout>
    if (!currentProject) return <WebLayout><ProjectSetup /></WebLayout>
  }
  if (!routeAllowed(pathname, currentUser.org_type || 'contractor', can.override)) {
    return (
      <WebLayout>
        <div className="text-center py-20 space-y-2">
          <div className="text-[var(--text)] font-medium">你的角色沒有此頁的存取權限</div>
          <p className="text-sm text-[var(--text-3)]">這個工作畫面僅開放給特定角色（如廠商內部成本、監造報表）。</p>
        </div>
      </WebLayout>
    )
  }
  return <WebLayout><WorkbenchTabs /><Suspense fallback={<PageLoading />}>{children}</Suspense></WebLayout>
}

// 找不到的路徑(U-02):原本靜默導回登入/首頁,使用者不知道自己打錯網址或收藏的連結已失效。
function NotFound() {
  const { pathname } = useLocation()
  return (
    <div className="text-center py-20 space-y-3">
      <div className="text-4xl">🧭</div>
      <div className="text-[var(--text)] font-medium">找不到這個頁面</div>
      <p className="text-sm text-[var(--text-3)]">網址 <code className="px-1 rounded bg-[var(--surface-2)]">{pathname}</code> 不存在——可能打錯了,或這個連結已失效。</p>
      <Link to="/dashboard" className="inline-block text-sm font-medium text-[var(--blue-text)] hover:underline">← 回到首頁</Link>
    </div>
  )
}

export default function App() {
  return (
    <>
    <ConfirmHost />
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Web><Dashboard /></Web>} />
      <Route path="/assistant" element={<Web><Assistant /></Web>} />
      <Route path="/supervisor-report" element={<Web><SupervisorReport /></Web>} />
      <Route path="/audit" element={<Web><RiskAudit /></Web>} />
      <Route path="/portfolio" element={<Web><Portfolio /></Web>} />
      <Route path="/acceptance" element={<Web><Acceptance /></Web>} />
      <Route path="/project/new" element={<Web><ProjectSetup /></Web>} />
      <Route path="/boq" element={<Web><BOQ /></Web>} />
      <Route path="/site-log" element={<Web><SiteLog /></Web>} />
      <Route path="/site-log/print" element={<SiteLogPrint />} />
      <Route path="/valuation" element={<Web><Valuation /></Web>} />
      <Route path="/valuation/print" element={<ValuationPrint />} />
      <Route path="/valuation/package" element={<ValuationPackage />} />
      <Route path="/payments" element={<Web><Payments /></Web>} />
      <Route path="/cost" element={<Web><Cost /></Web>} />
      <Route path="/change-orders" element={<Web><ChangeOrders /></Web>} />
      <Route path="/progress" element={<Web><Progress /></Web>} />
      <Route path="/schedule" element={<Web><Schedule /></Web>} />
      <Route path="/quality" element={<Web><Quality /></Web>} />
      <Route path="/itp" element={<Web><ITP /></Web>} />
      <Route path="/quality/checklist-print" element={<ChecklistPrint />} />
      <Route path="/safety" element={<Web><Safety /></Web>} />
      <Route path="/submittals" element={<Web><Submittals /></Web>} />
      <Route path="/rfi" element={<Web><RFI /></Web>} />
      <Route path="/members" element={<Web><Members /></Web>} />
      <Route path="/contract" element={<Web><Contract /></Web>} />
      <Route path="/alerts" element={<Web><Alerts /></Web>} />
      <Route path="/activity" element={<Web><Activity /></Web>} />
      <Route path="/requirements" element={<Web><Requirements /></Web>} />
      <Route path="/monthly-report" element={<Web><MonthlyReport /></Web>} />
      <Route path="*" element={<Web><NotFound /></Web>} />
    </Routes>
    </Suspense>
    </>
  )
}
