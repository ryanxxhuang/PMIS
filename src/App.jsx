import { Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store.jsx'
import { WebLayout } from './components/Layout.jsx'

import Login from './pages/Login.jsx'
import ProjectSetup from './pages/web/ProjectSetup.jsx'
import Dashboard from './pages/web/Dashboard.jsx'
import BOQ from './pages/web/BOQ.jsx'
import SiteLog from './pages/web/SiteLog.jsx'
import Valuation from './pages/web/Valuation.jsx'
import ValuationPrint from './pages/web/ValuationPrint.jsx'
import Progress from './pages/web/Progress.jsx'
import Quality from './pages/web/Quality.jsx'

// Gate every page behind auth; force project creation before the workspace loads.
function Web({ children }) {
  const { currentUser, isSupabaseConfigured, currentProject, projectLoading } = useStore()
  if (!currentUser) return <Navigate to="/login" replace />
  if (isSupabaseConfigured && currentUser.real) {
    if (projectLoading) return <WebLayout><div className="text-center text-[var(--text-3)] text-sm py-20">載入專案…</div></WebLayout>
    if (!currentProject) return <WebLayout><ProjectSetup /></WebLayout>
  }
  return <WebLayout>{children}</WebLayout>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Web><Dashboard /></Web>} />
      <Route path="/project/new" element={<Web><ProjectSetup /></Web>} />
      <Route path="/boq" element={<Web><BOQ /></Web>} />
      <Route path="/site-log" element={<Web><SiteLog /></Web>} />
      <Route path="/valuation" element={<Web><Valuation /></Web>} />
      <Route path="/valuation/print" element={<ValuationPrint />} />
      <Route path="/progress" element={<Web><Progress /></Web>} />
      <Route path="/quality" element={<Web><Quality /></Web>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
