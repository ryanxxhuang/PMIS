// 自主檢查表列印(P3b):不套 WebLayout,整頁即文件。印的是「已簽署版本」——簽署列指向的版本號與雜湊(與畫面上可能已開新版
// 的草稿無關);逐項判定取簽署落下的 checklist_records 列(DB 算);沒有簽署列時印目前版本並整張標「草稿・未簽署」。
// 框架範本標記(示範範本、免責聲明)向伺服器 fn_field_document_template('self_check') 取,與頁面同一份;檢查項目取本案範本。
// 版本挑選與載入／失敗狀態走三個列印頁共用的 usePrintedVersion＋PrintedVersionBody(P3d)。
import { useRef } from 'react'
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'
import SelfCheckSheet from '../../components/sitelog/SelfCheckSheet.jsx'
import { PrintedVersionBody } from '../../components/sitelog/DocumentPrint.jsx'
import usePrintedVersion from '../../lib/usePrintedVersion.js'
import { fieldDocFileName } from '../../lib/pdf/docFileName.js'

export default function SelfCheckPrint() {
  const { project, adjustedItems, currentUser, fieldDocuments, fieldDocsLoading, checklistTemplates, checklistRecords } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const paperRef = useRef(null)
  const docParam = sp.get('doc')
  const doc = (fieldDocuments?.documents || []).find((x) => x.id === docParam) || null
  const state = usePrintedVersion(doc, { templateType: 'self_check', waiting: fieldDocsLoading })

  if (!currentUser) return <Navigate to="/login" replace />
  const backTo = doc ? `/self-check?doc=${encodeURIComponent(doc.id)}` : '/self-check'
  if (!doc && !fieldDocsLoading) {
    return (
      <div className="p-10 text-center text-[var(--text-2)]">
        無此自主檢查表文件。<button onClick={() => navigate('/self-check')} className="text-[var(--blue-text)] underline">返回自主檢查表</button>
      </div>
    )
  }
  const byId = new Map((adjustedItems || []).filter((it) => it.id).map((it) => [it.id, it]))
  const content = state.version?.content || {}
  const checklistTemplate = (checklistTemplates || []).find((t) => t.id === content.template_id) || null
  // 簽署列指向的版本落下的事實列:文件 target_id 指向最新修訂;印簽署版本時它就是該版本落下的列
  const record = state.signature && state.doc?.target_id ? (checklistRecords || []).find((r) => r.id === state.doc.target_id) || null : null
  // 檔名跟著「實際印的是哪一版」走:印的是簽署列指向的版本就標已簽署,沒有簽署列就標草稿
  const pdf = {
    paperRef,
    title: '工程材料自主檢查表',
    fileName: fieldDocFileName({ label: '自主檢查表', date: state.doc?.doc_date, versionNo: state.version?.version_no, signed: !!state.signature }),
  }
  return (
    <div ref={paperRef} className="min-h-screen paper-desk py-6 print:py-0">
      <PrintToolbar backTo={backTo} backLabel="返回自主檢查表" pdf={pdf} />
      <PrintedVersionBody printed={state}>
        <SelfCheckSheet project={project} doc={state.doc} version={state.version} content={state.version?.content || null}
          sources={state.version?.field_sources || null} signature={state.signature} frame={state.template}
          checklistTemplate={checklistTemplate} record={record} byId={byId} />
      </PrintedVersionBody>
    </div>
  )
}
