import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import SiteLogOfficialSheet from '../../components/SiteLogOfficialSheet.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'

// 公共工程施工日誌（工程會 101.10.17 修正公定格式）— 不套 WebLayout，整頁即文件。
// 工具列(chrome,吃主題 token)與紙面(.paper,固定白底黑字)分開處理,理由見 PrintToolbar 與 index.css。
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
      <div className="p-10 text-center text-[var(--text-2)]">
        無施工日誌。<button onClick={() => navigate('/site-log')} className="text-[var(--blue-text)] underline">返回施工日誌</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen paper-desk py-6 print:py-0">
      <PrintToolbar backTo="/site-log" backLabel="返回施工日誌" />

      {/* A4 文件 */}
      <SiteLogOfficialSheet project={project} log={log} siteLogs={siteLogs} itemList={workItems?.items || []} />
    </div>
  )
}
