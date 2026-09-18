// 監造日誌列印(P3a):不套 WebLayout,整頁即文件。印的是「已簽署版本」——簽署列指向的版本號與雜湊
// (與畫面上可能已開新版的草稿無關);沒有簽署列時印目前版本並整張標「草稿・未簽署」。
// 範本標記(示範範本、免責聲明)向伺服器 fn_field_document_template 取,與頁面同一份。
// ?doc=<id> 直達;?d=<日期> 取該日活文件。
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import PrintToolbar from '../../components/PrintToolbar.jsx'
import SupervisorLogSheet from '../../components/sitelog/SupervisorLogSheet.jsx'
import { SkeletonList } from '../../components/ui.jsx'

export default function SupervisorLogPrint() {
  const { project, adjustedItems, currentUser, fieldDocuments, fieldDocsLoading, findActiveFieldDoc, getFieldDocument, getFieldDocumentVersion, getFieldDocumentTemplate, inspections, defects, rfis, submittals } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const docParam = sp.get('doc')
  const dateParam = sp.get('d')
  const docs = fieldDocuments?.documents || []
  const doc = (docParam ? docs.find((x) => x.id === docParam) : null) || (dateParam ? findActiveFieldDoc('supervisor_log', dateParam) : null) || null
  const [state, setState] = useState({ loading: true, version: null, signature: null, template: null, doc: null })

  useEffect(() => {
    if (!doc) { setState((st) => ({ ...st, loading: fieldDocsLoading, doc: null })); return }
    let active = true
    ;(async () => {
      const [detail, { template }] = await Promise.all([getFieldDocument(doc.id), getFieldDocumentTemplate('supervisor_log')])
      // 簽署列指向的版本(最新一筆簽署);沒有簽署=草稿
      const sig = (detail?.signatures || []).slice().sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))[0] || null
      const version = sig
        ? (detail?.version?.version_no === sig.version_no ? detail.version : await getFieldDocumentVersion(doc.id, sig.version_no))
        : detail?.version || null
      if (!active) return
      setState({ loading: false, version, signature: sig, template, doc: detail?.doc || doc })
    })()
    return () => { active = false }
  }, [doc?.id, doc?.current_version_no, fieldDocsLoading]) // eslint-disable-line react-hooks/exhaustive-deps

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
  return (
    <div className="min-h-screen paper-desk py-6 print:py-0">
      <PrintToolbar backTo={backTo} backLabel="返回監造日誌" />
      {state.loading || !state.version
        ? <div className="max-w-[210mm] mx-auto" aria-busy="true"><SkeletonList rows={4} label="載入簽署版本…" /></div>
        : <SupervisorLogSheet project={project} doc={state.doc} version={state.version} signature={state.signature} template={state.template}
          lookups={{ inspections, defects, rfis, submittals }} byId={byId} />}
    </div>
  )
}
