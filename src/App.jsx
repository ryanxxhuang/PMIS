import { Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store.jsx'
import { WebLayout, PhoneFrame } from './components/Layout.jsx'

import Login from './pages/Login.jsx'
import ProjectSetup from './pages/web/ProjectSetup.jsx'
import Dashboard from './pages/web/Dashboard.jsx'
import BOQ from './pages/web/BOQ.jsx'
import Valuation from './pages/web/Valuation.jsx'
import Progress from './pages/web/Progress.jsx'
import ValuationPrint from './pages/web/ValuationPrint.jsx'
import SiteLog from './pages/web/SiteLog.jsx'
import Quality from './pages/web/Quality.jsx'
import ContractUpload from './pages/web/ContractUpload.jsx'
import AIReview from './pages/web/AIReview.jsx'
import ITP from './pages/web/ITP.jsx'
import FormBuilder from './pages/web/FormBuilder.jsx'
import Submittals from './pages/web/Submittals.jsx'
import RFI from './pages/web/RFI.jsx'
import Defects from './pages/web/Defects.jsx'
import DailyLogs from './pages/web/DailyLogs.jsx'
import Reports from './pages/web/Reports.jsx'
import Audit from './pages/web/Audit.jsx'

import MobileHome from './pages/mobile/Home.jsx'
import DailyLog from './pages/mobile/DailyLog.jsx'
import SelfInspection from './pages/mobile/SelfInspection.jsx'
import InspectionRequest from './pages/mobile/InspectionRequest.jsx'
import SupervisorInspection from './pages/mobile/SupervisorInspection.jsx'
import DefectResponse from './pages/mobile/DefectResponse.jsx'
import PhotoUpload from './pages/mobile/PhotoUpload.jsx'

function Web({ children }) {
  const { currentUser, isSupabaseConfigured, currentProject, projectLoading } = useStore()
  if (!currentUser) return <Navigate to="/login" replace />
  // 真實使用者尚無專案 → 先建專案（涵蓋所有 web 頁面）
  if (isSupabaseConfigured && currentUser.real) {
    if (projectLoading) return <WebLayout><div className="text-center text-slate-400 text-sm py-20">載入專案…</div></WebLayout>
    if (!currentProject) return <WebLayout><ProjectSetup /></WebLayout>
  }
  return <WebLayout>{children}</WebLayout>
}

function Mobile({ title, children }) {
  const { currentUser } = useStore()
  if (!currentUser) return <Navigate to="/login" replace />
  return <PhoneFrame title={title}>{children}</PhoneFrame>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/dashboard" element={<Web><Dashboard /></Web>} />
      <Route path="/project/new" element={<Web><ProjectSetup /></Web>} />
      <Route path="/boq" element={<Web><BOQ /></Web>} />
      <Route path="/valuation" element={<Web><Valuation /></Web>} />
      <Route path="/valuation/print" element={<ValuationPrint />} />
      <Route path="/progress" element={<Web><Progress /></Web>} />
      <Route path="/site-log" element={<Web><SiteLog /></Web>} />
      <Route path="/quality" element={<Web><Quality /></Web>} />
      <Route path="/contract-upload" element={<Web><ContractUpload /></Web>} />
      <Route path="/ai-review" element={<Web><AIReview /></Web>} />
      <Route path="/itp" element={<Web><ITP /></Web>} />
      <Route path="/form-builder" element={<Web><FormBuilder /></Web>} />
      <Route path="/submittals" element={<Web><Submittals /></Web>} />
      <Route path="/rfi" element={<Web><RFI /></Web>} />
      <Route path="/defects" element={<Web><Defects /></Web>} />
      <Route path="/daily-logs" element={<Web><DailyLogs /></Web>} />
      <Route path="/reports" element={<Web><Reports /></Web>} />
      <Route path="/audit" element={<Web><Audit /></Web>} />

      <Route path="/m/home" element={<Mobile title="現場首頁"><MobileHome /></Mobile>} />
      <Route path="/m/daily-log" element={<Mobile title="施工日誌 / 監造日報"><DailyLog /></Mobile>} />
      <Route path="/m/self-inspection" element={<Mobile title="自主檢查表"><SelfInspection /></Mobile>} />
      <Route path="/m/inspection-request" element={<Mobile title="查驗申請"><InspectionRequest /></Mobile>} />
      <Route path="/m/supervisor-inspection" element={<Mobile title="監造查驗"><SupervisorInspection /></Mobile>} />
      <Route path="/m/defect-response" element={<Mobile title="缺失改善"><DefectResponse /></Mobile>} />
      <Route path="/m/photo" element={<Mobile title="拍照上傳"><PhotoUpload /></Mobile>} />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
