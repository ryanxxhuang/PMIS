import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import SiteLogOfficialSheet from '../../components/SiteLogOfficialSheet.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'
import { DocumentPrintStamp, PrintedVersionBody } from '../../components/sitelog/DocumentPrint.jsx'
import { contentToLogShape } from '../../lib/fieldDocs.js'
import usePrintedVersion from '../../lib/usePrintedVersion.js'

// 公共工程施工日誌（工程會 101.10.17 修正公定格式）— 不套 WebLayout，整頁即文件。
// 工具列(chrome,吃主題 token)與紙面(.paper,固定白底黑字)分開處理,理由見 PrintToolbar 與 index.css。
// A4 文件本體抽至 SiteLogOfficialSheet（S-8）供唯讀檢視共用;這裡只留工具列、守衛與「印哪一份」。
//
// P3d:有施工日誌文件時印「簽署列指向的版本」(與監造日誌／自主檢查表列印同一支 usePrintedVersion):頁首戳記印文件短碼、
// 版本、內容雜湊前 12 碼(DB 值)、簽署者與伺服器簽署時間;沒有簽署列印最新存檔版本並整張標「草稿・未簽署」。
// 內容取該版本(contentToLogShape),不讀可能已被後續更正覆寫的畫面草稿。沒有文件、只有舊流程寫入的既有日誌列
// (daily_logs,未簽署歷史)時印該列並如實標「既有紀錄・草稿・未簽署」(無版本與雜湊)。
// ?doc=<id> 直達;?d=<日期> 取該日活文件,沒有文件才取既有列;都沒給取最新一筆日誌(舊深連結相容)。
export default function SiteLogPrint() {
  const { project, workItems, siteLogs, currentUser, fieldDocuments, fieldDocsLoading, findActiveDailyLogDoc } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const docParam = sp.get('doc')
  const date = docParam ? null : (sp.get('d') || siteLogs[0]?.log_date || null)
  const doc = docParam
    ? (fieldDocuments?.documents || []).find((x) => x.id === docParam && x.doc_type === 'daily_log') || null
    : (date ? findActiveDailyLogDoc(date) : null)
  const legacyLog = !docParam && !doc && !fieldDocsLoading ? siteLogs.find((l) => l.log_date === date) || null : null
  const printed = usePrintedVersion(doc, { waiting: fieldDocsLoading })

  if (!currentUser) return <Navigate to="/login" replace />
  const backTo = doc ? `/site-log?doc=${encodeURIComponent(doc.id)}` : date ? `/site-log?d=${date}` : '/site-log'
  if (!doc && !legacyLog && !fieldDocsLoading) {
    return (
      <div className="p-10 text-center text-[var(--text-2)]">
        {docParam ? '無此施工日誌文件。' : '無施工日誌。'}<button onClick={() => navigate('/site-log')} className="text-[var(--blue-text)] underline">返回施工日誌</button>
      </div>
    )
  }
  const itemList = workItems?.items || []

  return (
    <div className="min-h-screen paper-desk py-6 print:py-0">
      <PrintToolbar backTo={backTo} backLabel="返回施工日誌" />

      {/* A4 文件 */}
      {legacyLog ? (
        <SiteLogOfficialSheet project={project} log={legacyLog} siteLogs={siteLogs} itemList={itemList}
          stamp={<DocumentPrintStamp draftNote="舊流程寫入的既有紀錄，非正式簽署紀錄" />} />
      ) : (
        <PrintedVersionBody printed={printed}>
          <SiteLogOfficialSheet project={project} siteLogs={siteLogs} itemList={itemList}
            log={printed.version ? contentToLogShape(printed.version.content, { id: printed.doc?.id, status: printed.doc?.status, logDate: printed.doc?.doc_date }) : null}
            stamp={<DocumentPrintStamp doc={printed.doc} version={printed.version} signature={printed.signature} />} />
        </PrintedVersionBody>
      )}
    </div>
  )
}
