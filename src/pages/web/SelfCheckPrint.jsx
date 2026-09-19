// 自主檢查表列印(P3b):不套 WebLayout,整頁即文件。印的是「已簽署版本」——簽署列指向的版本號與雜湊(與畫面上可能已開新版
// 的草稿無關);逐項判定取簽署落下的 checklist_records 列(DB 算);沒有簽署列時印目前版本並整張標「草稿・未簽署」。
// 框架範本標記(示範範本、免責聲明)向伺服器 fn_field_document_template('self_check') 取,與頁面同一份;檢查項目取本案範本。
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'
import SelfCheckSheet from '../../components/sitelog/SelfCheckSheet.jsx'
import { SkeletonList } from '../../components/ui.jsx'

export default function SelfCheckPrint() {
  const { project, adjustedItems, currentUser, fieldDocuments, fieldDocsLoading, getFieldDocument, getFieldDocumentVersion, getFieldDocumentTemplate, checklistTemplates, checklistRecords } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const docParam = sp.get('doc')
  const doc = (fieldDocuments?.documents || []).find((x) => x.id === docParam) || null
  const [state, setState] = useState({ loading: true, version: null, signature: null, frame: null, doc: null })

  useEffect(() => {
    if (!doc) { setState((st) => ({ ...st, loading: fieldDocsLoading, doc: null })); return }
    let active = true
    ;(async () => {
      const [detail, { template }] = await Promise.all([getFieldDocument(doc.id), getFieldDocumentTemplate('self_check')])
      const sig = (detail?.signatures || []).slice().sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))[0] || null
      const version = sig
        ? (detail?.version?.version_no === sig.version_no ? detail.version : await getFieldDocumentVersion(doc.id, sig.version_no))
        : detail?.version || null
      if (!active) return
      setState({ loading: false, version, signature: sig, frame: template, doc: detail?.doc || doc })
    })()
    return () => { active = false }
  }, [doc?.id, doc?.current_version_no, fieldDocsLoading]) // eslint-disable-line react-hooks/exhaustive-deps

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
  return (
    <div className="min-h-screen paper-desk py-6 print:py-0">
      <PrintToolbar backTo={backTo} backLabel="返回自主檢查表" />
      {state.loading || !state.version
        ? <div className="max-w-[210mm] mx-auto" aria-busy="true"><SkeletonList rows={4} label="載入簽署版本…" /></div>
        : <SelfCheckSheet project={project} doc={state.doc} version={state.version} signature={state.signature} frame={state.frame}
          checklistTemplate={checklistTemplate} record={record} byId={byId} />}
    </div>
  )
}
