// 監造日誌列印(P3a):不套 WebLayout,整頁即文件。印的是「已簽署版本」——簽署列指向的版本號與雜湊
// (與畫面上可能已開新版的草稿無關);沒有簽署列時印目前版本並整張標「草稿・未簽署」。
// 版本挑選與載入／失敗狀態走三個列印頁共用的 usePrintedVersion＋PrintedVersionBody(P3d)。
// 範本標記(示範範本、免責聲明)向伺服器 fn_field_document_template 取,與頁面同一份。
// ?doc=<id> 直達;?d=<日期> 取該日活文件。
import { useRef } from 'react'
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'
import SupervisorLogSheet from '../../components/sitelog/SupervisorLogSheet.jsx'
import { PrintedVersionBody } from '../../components/sitelog/DocumentPrint.jsx'
import usePrintedVersion from '../../lib/usePrintedVersion.js'
import { fieldDocFileName } from '../../lib/pdf/docFileName.js'

export default function SupervisorLogPrint() {
  const { project, adjustedItems, currentUser, fieldDocuments, fieldDocsLoading, findActiveFieldDoc, inspections, defects, rfis, submittals } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const paperRef = useRef(null)
  const docParam = sp.get('doc')
  const dateParam = sp.get('d')
  const docs = fieldDocuments?.documents || []
  const doc = (docParam ? docs.find((x) => x.id === docParam) : null) || (dateParam ? findActiveFieldDoc('supervisor_log', dateParam) : null) || null
  const printed = usePrintedVersion(doc, { templateType: 'supervisor_log', waiting: fieldDocsLoading })

  if (!currentUser) return <Navigate to="/login" replace />
  const backTo = doc ? `/supervisor-log?doc=${encodeURIComponent(doc.id)}` : '/supervisor-log'
  if (!doc && !fieldDocsLoading) {
    return (
      <div className="p-10 text-center text-[var(--text-2)]">
        無此監造日誌文件。<button onClick={() => navigate('/supervisor-log')} className="text-[var(--blue-text)] underline">返回監造日誌</button>
      </div>
    )
  }
  const byId = new Map((adjustedItems || []).filter((it) => it.id).map((it) => [it.id, it]))
  // 檔名跟著「實際印的是哪一版」走:印的是簽署列指向的版本就標已簽署,沒有簽署列就標草稿
  const pdf = {
    paperRef,
    title: '公共工程監造報表（監造日誌）',
    fileName: fieldDocFileName({ label: '監造日誌', date: printed.doc?.doc_date, versionNo: printed.version?.version_no, signed: !!printed.signature }),
  }
  return (
    <div ref={paperRef} className="min-h-screen paper-desk py-6 print:py-0">
      <PrintToolbar backTo={backTo} backLabel="返回監造日誌" pdf={pdf} />
      <PrintedVersionBody printed={printed}>
        <SupervisorLogSheet project={project} doc={printed.doc} version={printed.version} signature={printed.signature} template={printed.template}
          lookups={{ inspections, defects, rfis, submittals }} byId={byId} />
      </PrintedVersionBody>
    </div>
  )
}
