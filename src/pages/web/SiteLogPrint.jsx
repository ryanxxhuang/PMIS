import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import SiteLogOfficialSheet from '../../components/SiteLogOfficialSheet.jsx'

// 工具列藥丸鈕:列印頁刻意不 import ui.jsx(整頁即文件、不吃工作台元件),
// 所以 Button 的 Workspace 樣式在此就地複寫一份,四支列印頁維持同一組 class。
// 次要鈕留在 slate 色階:紙面永遠是亮色,套 --text-* 在深色模式會變淺字壓白底。
const TOOLBAR_BTN = 'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium max-sm:min-h-11'
const TOOLBAR_PRIMARY = `${TOOLBAR_BTN} bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]`
const TOOLBAR_SECONDARY = `${TOOLBAR_BTN} bg-white border border-slate-300 text-slate-700 hover:bg-slate-50`

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
      <div className="max-w-[210mm] mx-auto mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden px-1">
        <button onClick={() => navigate('/site-log')} className={TOOLBAR_SECONDARY}>← 返回施工日誌</button>
        <button onClick={() => window.print()} className={TOOLBAR_PRIMARY}>
          <MSym name="print" size={15} />列印 / 存 PDF
        </button>
      </div>

      {/* A4 文件 */}
      <SiteLogOfficialSheet project={project} log={log} siteLogs={siteLogs} itemList={workItems?.items || []} />
    </div>
  )
}
