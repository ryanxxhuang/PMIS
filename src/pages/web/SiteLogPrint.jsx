import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { useStore } from '../../store.jsx'
import SiteLogOfficialSheet from '../../components/SiteLogOfficialSheet.jsx'

// 公共工程施工日誌（工程會 101.10.17 修正公定格式）— 不套 WebLayout，整頁即文件。
// A4 文件本體抽至 SiteLogOfficialSheet（S-8）供唯讀檢視共用;這裡只留工具列與守衛,
// 工項清單維持原本 workItems.items 口徑,列印輸出不變。
export default function SiteLogPrint() {
  const { project, workItems, siteLogs, currentUser } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const d = sp.get('d')
  const log = siteLogs.find((l) => l.log_date === d) || siteLogs[0]

  if (!currentUser) return <Navigate to="/login" replace />
  if (!log) {
    return (
      <div className="p-10 text-center text-slate-400">
        無施工日誌。<button onClick={() => navigate('/site-log')} className="text-[var(--blue-text)] underline">返回施工日誌</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white py-6 print:py-0">
      {/* 工具列（列印時隱藏）*/}
      <div className="max-w-[210mm] mx-auto mb-3 flex justify-between print:hidden px-1">
        <button onClick={() => navigate('/site-log')} className="text-sm text-slate-600 hover:underline">← 返回施工日誌</button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-sm font-medium bg-[var(--primary)] text-white rounded-lg px-4 py-1.5">
          <Printer size={15} aria-hidden />列印 / 存 PDF
        </button>
      </div>

      {/* A4 文件 */}
      <SiteLogOfficialSheet project={project} log={log} siteLogs={siteLogs} itemList={workItems?.items || []} />
    </div>
  )
}
