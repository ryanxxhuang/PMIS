// 監造查驗表單列印(P3c):不套 WebLayout,整頁即文件。印的是「已簽署版本」——簽署列指向的版本號與雜湊(與畫面上可能已開新版
// 的更正草稿無關);判定、本次確認數量與查驗項目結果取簽署落下的 inspections 列(DB 算);沒有簽署列時印目前版本並整張標「草稿・未簽署」。
// 版本挑選與載入／失敗狀態走三個列印頁共用的 usePrintedVersion＋PrintedVersionBody(P3d);範本標記向伺服器取,與頁面同一份。
import { useRef } from 'react'
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'
import InspectionFormSheet from '../../components/sitelog/InspectionFormSheet.jsx'
import { PrintedVersionBody } from '../../components/sitelog/DocumentPrint.jsx'
import usePrintedVersion from '../../lib/usePrintedVersion.js'
import { fieldDocFileName } from '../../lib/pdf/docFileName.js'

export default function InspectionFormPrint() {
  const { project, adjustedItems, currentUser, fieldDocuments, fieldDocsLoading, checklistTemplates, inspections } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const paperRef = useRef(null)
  const docParam = sp.get('doc')
  const doc = (fieldDocuments?.documents || []).find((x) => x.id === docParam) || null
  const state = usePrintedVersion(doc, { templateType: 'inspection_form', waiting: fieldDocsLoading })

  if (!currentUser) return <Navigate to="/login" replace />
  const backTo = doc ? `/inspection-form?doc=${encodeURIComponent(doc.id)}` : '/inspection-form'
  if (!doc && !fieldDocsLoading) {
    return (
      <div className="p-10 text-center text-[var(--text-2)]">
        無此監造查驗表單文件。<button onClick={() => navigate('/inspection-form')} className="text-[var(--blue-text)] underline">返回監造查驗表單</button>
      </div>
    )
  }
  const byId = new Map((adjustedItems || []).filter((it) => it.id).map((it) => [it.id, it]))
  const content = state.version?.content || {}
  const checklistTemplate = (checklistTemplates || []).find((t) => t.id === content.template_id) || null
  const inspection = (inspections || []).find((i) => i.id === (state.doc?.target_key || content.inspection_id)) || null
  // 檔名跟著「實際印的是哪一版」走:印的是簽署列指向的版本就標已簽署,沒有簽署列就標草稿
  const pdf = {
    paperRef,
    title: '監造查驗表單',
    fileName: fieldDocFileName({ label: '監造查驗表單', date: state.doc?.doc_date, versionNo: state.version?.version_no, signed: !!state.signature }),
  }
  return (
    <div ref={paperRef} className="min-h-screen paper-desk py-6 print:py-0">
      <PrintToolbar backTo={backTo} backLabel="返回監造查驗表單" pdf={pdf} />
      <PrintedVersionBody printed={state}>
        <InspectionFormSheet project={project} doc={state.doc} version={state.version} signature={state.signature} frame={state.template}
          inspection={inspection} checklistTemplate={checklistTemplate} byId={byId} />
      </PrintedVersionBody>
    </div>
  )
}
