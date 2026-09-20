// 監造查驗表單(P3c;D-026 四類文書之四):這一頁是「監造查驗表單文件」的審核／判定／填確認數量／簽署／提送頁,也是查驗判定
// 寫入確認量的**唯一**入口——存檔=save_field_document_version(伺服器保存版本、算雜湊、判待補),簽署=sign_field_document
// (登入的平台帳號;簽署即判定:inspections 狀態＋確認量與 inspection_confirmations 在簽署交易內落庫,不合格由 DB 開缺失),
// 提送廠商／機關各一鈕、各自收件／退回。
//
// 與其他三類文書共用 DocumentLifecycle／DocumentPhotos;2026-09-20 C2:這一頁的表單就是**臺北市「施工抽查紀錄表」的那張紙**
// (InspectionFormSheet)——格內可編、畫面與列印／PDF 同一個元件同一份 mapping(lib/officialForms);格內編輯不放寬任何
// 伺服器驗證。框架必填欄仍由伺服器範本 fn_field_document_template('inspection_form')(示範範本,Q11)推導。
// 一份查驗申請一份表單(?inspection=<id> 由查驗申請直達:建立或取回草稿後改為 ?doc=;?doc=<id> 直達文件)。
// 查驗申請資料由系統帶入待核對;判定與本次確認數量只能監造親自填,畫面即時列出與 DB 簽署規則相同的一致性問題(伺服器為準)。
// 簽署前明示「這會成為可估驗依據」;簽後更正=另開版本,改量須先撤銷確認紀錄(P4b revoke)再重簽,伺服器 PD008 會擋。
// 視角:監造(can.approve)可編、簽、送;廠商與機關(提送對象)各自收件／退回、其餘唯讀——唯讀沒有 input。
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Button, Empty, PageHeader, SkeletonList, Badge, ErrorBanner, Select, Field } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { taipeiDateTime } from '../../lib/dates.js'
import { billableLeaves } from '../../lib/boqCalc.js'
import { useUnsavedEdit } from '../../lib/unsavedEdits.js'
import {
  emptyInspectionFormContent, emptyInspectionFormSources, requiredKeysFor, unmetFields, fieldLabel, UNMET_STATUS_LABEL,
  docConfirmRequiredKeys, templateFieldLabels, checklistItemLabels, applySuggestion, mergeAttachments, attachmentIssues, fieldDocErrorGuidance,
  docStatusMeta, DOC_STATUS_LABEL, ORG_LABEL, requiredStagesFor, currentBatchCum, INSPECTION_VERDICT_TONE, fieldAnchorId,
  setInspectionFormTemplate,
} from '../../lib/fieldDocs.js'
import { stampFormTemplate } from '../../lib/officialForms.js'

import InspectionFormSheet from '../../components/sitelog/InspectionFormSheet.jsx'
import DocumentPhotos from '../../components/sitelog/DocumentPhotos.jsx'
import DocumentLifecycle from '../../components/sitelog/DocumentLifecycle.jsx'

const DOC_TYPE = 'inspection_form'
const EDITABLE_STATUSES = ['draft', 'pending_input', 'in_review', 'returned']
const SIGN_NOTE = '簽署即判定：判定與本次確認數量會寫入查驗紀錄與監造確認紀錄，成為廠商可估驗的依據；不合格／部分合格由系統同時開立缺失。更正只能撤銷該確認紀錄後另開版本重新簽署。'

export default function InspectionForm() {
  const {
    project, workItems, adjustedItems, can, currentUser, demoMode,
    fieldDocuments: fieldDocState, fieldDocsLoading, reloadFieldDocs, createInspectionFormDraft, getFieldDocument, getFieldDocumentTemplate,
    saveFieldDocumentVersion, signFieldDocument, submitFieldDocument, receiveFieldDocument, returnFieldDocument, listPhotosByIds, listInspectionConfirmations,
    agentActions, resolveAgentAction, checklistTemplates, inspections, inspectionPoints,
  } = useStore()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { state: navState } = useLocation()
  const docParam = params.get('doc')
  const inspectionParam = params.get('inspection')
  const org = currentUser?.org_type || 'contractor'
  const editable = !!can.approve // 監造(或非正式模式的專案管理者);伺服器 RLS／RPC 才是邊界
  const fieldDocuments = useMemo(() => fieldDocState?.documents || [], [fieldDocState])
  const doc = docParam ? fieldDocuments.find((x) => x.id === docParam && x.doc_type === DOC_TYPE) || null : null
  const setDocParam = useCallback((id) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('doc', id); else n.delete('doc'); n.delete('inspection'); return n }, { replace: true, state: navState }), [setParams, navState])

  const { leaves, byId } = useMemo(() => {
    if (!workItems) return { leaves: [], byId: new Map() }
    return { leaves: billableLeaves(adjustedItems), byId: new Map(adjustedItems.filter((it) => it.id).map((it) => [it.id, it])) }
  }, [workItems, adjustedItems])
  // 查驗申請的工項:真 DB 帶 work_item_id;示範種子只有 work_item_no,以項次對回末端工項
  const workItemOf = useCallback((insp) => {
    if (!insp) return null
    return (insp.work_item_id && byId.get(insp.work_item_id)) || leaves.find((l) => l.item_key === insp.work_item_key) || (insp.work_item_no ? leaves.find((l) => l.item_no === insp.work_item_no) : null) || null
  }, [byId, leaves])
  // 本案監造查驗用途的範本(kind=inspection_form;既有列 kind 預設 self_check)
  const inspectionTemplates = useMemo(() => (checklistTemplates || []).filter((t) => t.kind === 'inspection_form'), [checklistTemplates])
  // 監造查驗表單活文件(查驗 id → 文件):待判定清單只列還沒有表單的查驗
  const docByInspection = useMemo(() => {
    const m = new Map()
    for (const d of fieldDocuments) if (d.doc_type === DOC_TYPE && d.target_key && !['discarded', 'superseded'].includes(d.status)) m.set(d.target_key, d)
    return m
  }, [fieldDocuments])
  const pendingInspections = useMemo(() => (inspections || []).filter((i) => i.status === '待查驗' && !docByInspection.has(i.id)), [inspections, docByInspection])

  // 範本(示範範本):標記、必填鍵、人填欄、欄位名都由它推導;讀不到就明說
  const [frame, setFrame] = useState(null)
  const [frameErr, setFrameErr] = useState(null)
  useEffect(() => {
    let active = true
    ;(async () => {
      const r = await getFieldDocumentTemplate(DOC_TYPE)
      if (!active) return
      setFrame(r.template); setFrameErr(r.error ? friendlyError(r.error, '無法讀取監造查驗表單範本') : (r.template ? null : '伺服器沒有監造查驗表單範本'))
    })()
    return () => { active = false }
  }, [getFieldDocumentTemplate])

  // ?inspection=<id>:由查驗申請直達 → 建立或取回草稿(RPC 冪等),改成 ?doc=
  const [createErr, setCreateErr] = useState(null)
  const [creating, setCreating] = useState(false)
  const startFrom = useCallback(async (inspectionId) => {
    setCreating(true); setCreateErr(null)
    const r = await createInspectionFormDraft(inspectionId)
    setCreating(false)
    if (r.error) { setCreateErr(friendlyError(r.error, '無法建立監造查驗表單')); return }
    setDocParam(r.doc.id)
    if (r.created) reloadFieldDocs()
  }, [createInspectionFormDraft, setDocParam, reloadFieldDocs])
  const startedRef = useRef(null)
  useEffect(() => {
    if (!inspectionParam || docParam || startedRef.current === inspectionParam) return
    startedRef.current = inspectionParam
    const existing = docByInspection.get(inspectionParam)
    if (existing) { setDocParam(existing.id); return }
    if (!editable) { setCreateErr('監造查驗表單只有監造成員可建立；此查驗尚無表單。'); return }
    startFrom(inspectionParam)
  }, [inspectionParam, docParam, docByInspection, editable, startFrom, setDocParam])

  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [form, setForm] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [photosById, setPhotosById] = useState(new Map())
  const [confirmations, setConfirmations] = useState([])
  const [baseVersion, setBaseVersion] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [amendMode, setAmendMode] = useState(false)
  const [amendReason, setAmendReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [savedMsg, setSavedMsgRaw] = useState(null)
  const setSavedMsg = (text, tone = 'error') => setSavedMsgRaw(text ? { text, tone } : null)
  const [conflict, setConflict] = useState(null)
  const [busy, setBusy] = useState(null)
  const [lifecycleMsg, setLifecycleMsgRaw] = useState(null)
  const setLifecycleMsg = (text, tone = 'error') => setLifecycleMsgRaw(text ? { text, tone } : null)
  const [appliedSuggestions, setAppliedSuggestions] = useState([])
  // 提送／收件／退回後文件狀態可能不變(第二個對象提送、第一方收件),但提送列變了:以 tick 強制重讀文件脈絡
  const [detailTick, setDetailTick] = useState(0)
  useUnsavedEdit('inspection-form', dirty ? `監造查驗表單 ${form?.content?.inspection_title || ''}（未存檔）` : null)

  const inspection = useMemo(() => (inspections || []).find((i) => i.id === (doc?.target_key || form?.content?.inspection_id)) || null, [inspections, doc?.target_key, form?.content?.inspection_id])
  const workItem = useMemo(() => (form?.content?.work_item_id && byId.get(form.content.work_item_id)) || workItemOf(inspection), [form?.content?.work_item_id, byId, inspection, workItemOf])
  const requiredStages = useMemo(() => requiredStagesFor(inspectionPoints, workItem ? [workItem.id, workItem.item_key] : []), [inspectionPoints, workItem])
  const checklistTemplate = useMemo(() => (checklistTemplates || []).find((t) => t.id === form?.content?.template_id) || null, [checklistTemplates, form?.content?.template_id])
  const checklistItems = checklistTemplate?.items || null
  const labels = useMemo(() => ({ ...templateFieldLabels(frame), ...checklistItemLabels(checklistItems) }), [frame, checklistItems])
  const confirmRequired = useMemo(() => docConfirmRequiredKeys(DOC_TYPE, frame, checklistItems), [frame, checklistItems])
  const selfCheckDoc = useMemo(() => (form?.content?.self_check_record_id ? fieldDocuments.find((d) => d.doc_type === 'self_check' && d.target_id === form.content.self_check_record_id && ['signed', 'submitted', 'received'].includes(d.status)) || null : null), [fieldDocuments, form?.content?.self_check_record_id])
  const batchCum = useMemo(() => (form?.content?.location ? currentBatchCum(confirmations, { location: form.content.location, stageKey: form.content.stage_key }) : null), [confirmations, form?.content?.location, form?.content?.stage_key])

  const prevKeyRef = useRef(null)
  const loadKey = `${docParam || 'none'}|${doc?.id || ''}|${doc?.current_version_no ?? ''}|${doc?.status || ''}|${frame ? frame.key : ''}|${inspection?.id || ''}|${detailTick}`
  useEffect(() => {
    if (!frame || !doc) { if (!doc) { setForm(null); setDetail(null) } return }
    if (prevKeyRef.current === loadKey) return
    const docChanged = prevKeyRef.current?.split('|')[0] !== docParam
    if (!docChanged && dirty) return // 有未存檔編輯:不覆寫(伺服器變動由存檔時的 PD001 揭露)
    prevKeyRef.current = loadKey
    let active = true
    ;(async () => {
      setDetailLoading(true)
      const nextDetail = await getFieldDocument(doc.id)
      let nextForm, nextAttachments = []
      const v = nextDetail?.version
      if (v) {
        nextForm = { content: v.content, sources: v.field_sources || {} }
        nextAttachments = Array.isArray(v.attachments) ? v.attachments : []
      } else {
        // 空白草稿:查驗申請資料帶入待核對;判定與確認量 pending
        const insp = (inspections || []).find((i) => i.id === doc.target_key) || null
        const wi = workItemOf(insp)
        const stages = requiredStagesFor(inspectionPoints, wi ? [wi.id, wi.item_key] : [])
        const content = emptyInspectionFormContent(doc.doc_date, frame, insp, wi)
        nextForm = { content, sources: emptyInspectionFormSources(content, { requiredStages: stages }) }
      }
      const wid = nextForm.content?.work_item_id || workItemOf((inspections || []).find((i) => i.id === doc.target_key))?.id || null
      const [photoRows, confRows] = await Promise.all([listPhotosByIds(nextAttachments.map((a) => a.photo_id)), listInspectionConfirmations(wid)])
      if (!active) return
      setDetail(nextDetail); setForm(nextForm); setAttachments(nextAttachments); setConfirmations(confRows || [])
      setPhotosById(new Map(photoRows.map((p) => [p.id, p])))
      setBaseVersion(doc.current_version_no ?? 0)
      setDirty(false); setAmendMode(false); setAmendReason(''); setConflict(null); setAppliedSuggestions([])
      setDetailLoading(false)
    })()
    return () => { active = false }
  }, [loadKey, frame]) // eslint-disable-line react-hooks/exhaustive-deps

  const status = doc?.status || null
  const formEditable = editable && form && !!frame && (EDITABLE_STATUSES.includes(status) || amendMode) && status !== 'received'
  const onFormChange = useCallback((next) => { setForm(next); setDirty(true) }, [])
  // 換查驗表範本:抽查項目與標準的唯一來源是本案範本,換了就要清掉已填的抽查結果(項目不同不能沿用)
  const onTemplateChange = async (id) => {
    if (!form) return
    const t = id ? inspectionTemplates.find((x) => x.id === id) || null : null
    const filled = Object.values(form.content.results || {}).some((r) => r?.value != null && r.value !== '')
    if (filled && !(await appConfirm({ title: '換查驗表範本？', body: '換範本會清掉已填的抽查結果（項目不同，值不能沿用）。', danger: true, confirmLabel: '換範本' }))) return
    onFormChange(setInspectionFormTemplate(form, t))
  }
  const startAmend = async () => {
    const reason = await appPrompt({ title: '建立更正版本？', label: `版本 ${doc.current_version_no} 的簽署${status === 'submitted' ? '與提送' : ''}會保留並綁在該版本；更正存檔後成為新版本草稿，重新簽署時重新判定。改確認數量須先撤銷原確認紀錄，否則伺服器會拒簽。更正原因（必填）`, required: true, confirmLabel: '建立更正版本' })
    if (reason === null) return
    setAmendReason(reason); setAmendMode(true)
  }

  // 待補集中呈現:伺服器 recheck 為準(存檔後);未存檔時用同一套規則預覽(帶入的查驗申請資料要人確認)
  const serverRecheck = useMemo(() => (Array.isArray(doc?.recheck) ? doc.recheck : []), [doc?.recheck])
  const pending = useMemo(() => {
    if (!form) return []
    if (!dirty && doc && doc.current_version_no > 0) return serverRecheck.filter((r) => !String(r.key).startsWith('attachments')).map((r) => ({ key: r.key, status: r.status || 'pending' }))
    return unmetFields(requiredKeysFor(form.content, doc?.required_fields, { docType: DOC_TYPE, template: frame, checklistItems, stageRequired: requiredStages.length > 0 }), form.sources, confirmRequired)
  }, [form, dirty, doc, serverRecheck, frame, checklistItems, confirmRequired, requiredStages])
  const issueMap = useMemo(() => new Map(pending.map((u) => [u.key, u.status])), [pending])
  const attachmentIssueMap = useMemo(() => attachmentIssues(serverRecheck), [serverRecheck])

  const suggestions = useMemo(() => (agentActions || []).filter((a) => a.kind === 'suggest_field_update' && a.target_id === doc?.id && a.status === 'pending'), [agentActions, doc?.id])
  const applyOneSuggestion = (a) => {
    if (!form) return
    const { state, applied } = applySuggestion(form, a.evidence?.suggestion)
    if (a.evidence?.suggestion?.attachments) setAttachments((cur) => mergeAttachments(cur, a.evidence.suggestion.attachments))
    onFormChange(state)
    setAppliedSuggestions((ids) => [...ids, a.id])
    setSavedMsg(applied.length ? `已套用建議 ${applied.length} 項(${applied.slice(0, 4).map((k) => fieldLabel(k, state.content, labels)).join('、')}),存檔後生效` : '建議沒有可補入的欄位(現有值不覆蓋;判定與確認數量永遠不由系統帶入)', 'info')
  }
  const rejectSuggestion = async (a) => {
    const r = await resolveAgentAction(a.id, 'rejected')
    if (r?.error) setSavedMsg(friendlyError(r.error, '建議未標記'))
  }

  const onSave = async () => {
    if (!form || !doc) return
    setSaving(true); setSavedMsg(''); setConflict(null)
    let changeNote = amendMode ? amendReason : null
    if (!changeNote && (detail?.signatures?.length || 0) > 0) {
      const reason = await appPrompt({ title: '更正原因', label: '本文件已簽署過；存檔會建立更正版本，重新簽署時重新判定。更正原因（必填）', required: true })
      if (reason === null) { setSaving(false); return }
      changeNote = reason; setAmendReason(reason)
    }
    // 存檔時把「當時用的表單範本」寫進內容:簽署版本自己記得版面語意(C 包)
    const content = stampFormTemplate(form.content, 'inspection_form')
    const r = await saveFieldDocumentVersion({ documentId: doc.id, baseVersionNo: baseVersion, content, fieldSources: form.sources, attachments, changeNote })
    setSaving(false)
    if (r.error) {
      const g = fieldDocErrorGuidance(r.error)
      if (g.kind === 'reload') { setConflict(g.message); setSavedMsg('') } else setSavedMsg(friendlyError(r.error, '監造查驗表單存檔失敗'))
      return
    }
    for (const id of appliedSuggestions) await resolveAgentAction(id, 'accepted')
    setAppliedSuggestions([])
    setDirty(false); setAmendMode(false)
    setSavedAt(new Date())
    setBaseVersion(r.result.version_no)
    const left = (r.result.recheck || []).length
    setSavedMsg(left ? `已存檔 ✓ 版本 ${r.result.version_no}，尚有 ${left} 項待補或待確認` : `已存檔 ✓ 版本 ${r.result.version_no}，可簽署`, 'success')
  }
  const reloadFromServer = () => { setDirty(false); setConflict(null); prevKeyRef.current = null; reloadFieldDocs() }

  const handleLifecycleError = (error, fallback) => {
    const g = fieldDocErrorGuidance(error)
    if (g.kind === 'reload') { setConflict(g.message); return }
    if (g.kind === 'pending') { setLifecycleMsg(`${g.message}:${g.details.map((u) => `${fieldLabel(u.key, form?.content, labels)}${u.status === 'needs_confirmation' ? `（${UNMET_STATUS_LABEL.needs_confirmation}）` : ''}`).join('、')}`); reloadFieldDocs(); return }
    if (g.kind === 'attachments') { setLifecycleMsg(g.message); reloadFieldDocs(); return }
    setLifecycleMsg(friendlyError(error, fallback))
  }
  const onSign = async (intent) => {
    setBusy('sign'); setLifecycleMsg('')
    const r = await signFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, contentHash: detail?.version?.content_hash, intent })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '簽署未完成'); return }
    const c = form?.content || {}
    setLifecycleMsg(`已簽署版本 ${r.result.version_no}（雜湊 ${String(r.result.content_hash).slice(0, 12)}）：查驗判定「${c.verdict}」已落庫${c.verdict !== '不合格' && Number(c.confirmed_qty) > 0 ? `，本次確認 ${c.confirmed_qty} ${c.unit || ''} 已寫入監造確認紀錄成為可估驗依據` : ''}${c.verdict !== '合格' ? '；系統已開立缺失' : ''}。可提送給施工廠商與機關。`, 'success')
    prevKeyRef.current = null // 重新載入確認紀錄與判定
    reloadFieldDocs()
  }
  const onSubmit = async (toOrg) => {
    setBusy('submit'); setLifecycleMsg('')
    const r = await submitFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, docType: DOC_TYPE, toOrg })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '提送未完成'); return }
    setLifecycleMsg(`${r.receipt.idempotent ? '這筆已提送過，沿用原回執：' : ''}已提送給${ORG_LABEL[toOrg] || toOrg}（${taipeiDateTime(r.receipt.created_at)}，回執 ${String(r.receipt.submission_id).slice(0, 8)}）；等待${ORG_LABEL[toOrg] || '對方'}收件。`, 'success')
    setDetailTick((t) => t + 1)
  }
  const onReceive = async () => {
    setBusy('receive'); setLifecycleMsg('')
    const r = await receiveFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '收件未完成'); return }
    setLifecycleMsg(`已收件（${taipeiDateTime(r.receipt.created_at)}）。`, 'success')
    setDetailTick((t) => t + 1)
  }
  const onReturn = async (reason) => {
    setBusy('return'); setLifecycleMsg('')
    const r = await returnFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, reason })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '退回未完成'); return }
    setLifecycleMsg('已退回，原因已留存；監造補正並重新簽署後會再送。', 'success')
    setDetailTick((t) => t + 1)
  }
  const toggleRole = (photoId, role) => { setAttachments((cur) => cur.map((a) => (a.photo_id === photoId ? { ...a, role } : a))); setDirty(true) }
  const removeAttachment = (photoId) => { setAttachments((cur) => cur.filter((a) => a.photo_id !== photoId)); setDirty(true) }

  // 右欄:本案未終態的監造查驗表單(新→舊)
  const rows = useMemo(() => fieldDocuments.filter((d) => d.doc_type === DOC_TYPE && d.status !== 'discarded' && d.status !== 'superseded')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))), [fieldDocuments])
  const rowLabel = (d) => {
    const insp = (inspections || []).find((i) => i.id === d.target_key)
    return [d.doc_date, insp?.title || (d.target_key ? `查驗 ${String(d.target_key).slice(0, 8)}` : null)].filter(Boolean).join('・')
  }
  const openDoc = async (id) => {
    if (dirty && !(await appConfirm({ title: '切換文件將遺失未存檔內容', body: '目前這份監造查驗表單尚未存檔，切換會遺失已填內容。', danger: true, confirmLabel: '放棄並切換' }))) return
    setSavedAt(null); setSavedMsg(''); setLifecycleMsg('')
    setDocParam(id)
  }
  const [pickInspection, setPickInspection] = useState('')

  const header = <PageHeader title="監造查驗表單" tagline="二級品管・判定・確認數量・簽署・提送" subtitle="由查驗申請建立表單（示範範本）；判定與本次確認數量一律由監造親自填寫，簽署即判定並成為廠商可估驗的依據" />
  if (!frame && !frameErr) {
    return (
      <div className="space-y-5">
        {header}
        <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} /></Card>
      </div>
    )
  }
  if (docParam && !doc && !fieldDocsLoading) {
    return (
      <div className="space-y-5">
        {header}
        <Card><Empty>找不到編號 {docParam} 的監造查驗表單（可能已捨棄、不在本案，或連結已失效）。<Button variant="secondary" className="ml-2" onClick={() => openDoc(null)}>回監造查驗表單</Button></Empty></Card>
      </div>
    )
  }

  const saveStatus = saving ? { text: '存檔中…', cls: 'bg-[var(--blue-tint)] text-[var(--blue-text)]' }
    : dirty ? { text: '未存檔', cls: 'bg-[var(--amber-tint)] text-[var(--amber-text)]' }
      : doc ? { text: `已存檔${savedAt ? ` ${savedAt.toTimeString().slice(0, 5)}` : ''}・版本 ${doc.current_version_no}`, cls: 'bg-[var(--green-tint)] text-[var(--green-text)]' }
        : { text: '尚未選擇查驗申請', cls: 'bg-[var(--surface-2)] text-[var(--text-2)]' }
  const readOnlyNote = !editable
  const viewerLabel = org === 'owner' ? '機關檢視' : '施工廠商檢視'
  const canAct = org === 'supervisor' ? editable : org === 'contractor' ? !!can.edit : !!(can.write || can.override)

  return (
    <div className="space-y-5">
      <div>{header}</div>
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5 min-w-0">
          <Card title={doc ? '本份監造查驗表單' : '建立監造查驗表單'} action={frame?.is_demo ? <Badge color="amber">{frame.demo_label || '示範範本'}</Badge> : null}>
            {frame?.is_demo && (
              <p role="note" className="mb-3 text-caption text-[var(--text-2)] bg-[var(--amber-tint)] rounded-lg px-3 py-2">{frame.disclaimer}</p>
            )}
            {frameErr && <ErrorBanner msg={`${frameErr}；無法判定必填欄位，請重新整理或聯絡平台。`} className="mb-3" />}
            {createErr && <ErrorBanner msg={createErr} className="mb-3" onClose={() => setCreateErr(null)} />}
            {readOnlyNote && (
              <div className="mb-3 text-xs text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
                {viewerLabel}：監造查驗表單由監造填報與簽署，此頁為<b>唯讀</b>；監造提送後可在下方收件或退回。{org === 'contractor' ? '對判定有異議請以工程疑義（RFI）提出。' : ''}
              </div>
            )}
            <div className="flex items-end gap-3 flex-wrap mb-3">
              <span role="status" aria-label={`保存狀態：${saveStatus.text}`} className={`inline-flex items-center h-8 mb-0.5 px-2.5 rounded-lg text-footnote font-medium ${saveStatus.cls}`}>{saveStatus.text}</span>
              {doc && <Badge color={docStatusMeta(doc, org).tone}>{DOC_STATUS_LABEL[doc.status] || doc.status}</Badge>}
              {inspection && inspection.status !== '待查驗' && <Badge color={INSPECTION_VERDICT_TONE[inspection.status] || 'slate'}>查驗 {inspection.status}{inspection.confirmed_qty != null ? `・確認 ${inspection.confirmed_qty} ${inspection.unit || ''}` : ''}</Badge>}
              {doc && (
                <Button variant="outline" onClick={async () => {
                  if (dirty && !(await appConfirm({ title: '離開將遺失未存檔內容', body: '列印頁印的是已簽署版本（未簽署則標示草稿）。要放棄未存檔內容並前往列印嗎？', danger: true, confirmLabel: '放棄並前往' }))) return
                  navigate(`/inspection-form/print?doc=${encodeURIComponent(doc.id)}`)
                }}><MSym name="print" size={15} />列印</Button>
              )}
            </div>

            {conflict && (
              <div role="alert" className="mb-3 rounded-lg bg-[var(--red-tint)] p-3 text-footnote">
                <div className="font-medium text-[var(--red-text)]">{conflict}</div>
                <div className="text-[var(--text-2)] mt-1">重新載入會以伺服器最新版本取代畫面上未存檔的內容。</div>
                <Button variant="secondary" size="sm" className="mt-2" onClick={reloadFromServer}>重新載入最新版本</Button>
              </div>
            )}

            {!doc && (
              editable ? (
                <div className="space-y-3">
                  <p className="text-footnote text-[var(--text-2)]">一份查驗申請一份表單。選擇待查驗的申請建立表單（上傳監造照片會自動起稿並列在右側）。</p>
                  {pendingInspections.length === 0 ? <Empty>目前沒有尚未建立表單的待查驗申請；已建立的在右側清單。</Empty> : (
                    <div className="flex items-end gap-3 flex-wrap">
                      <div className="w-full md:flex-1 md:min-w-[16rem]">
                        <Field label="待查驗的申請">
                          <Select value={pickInspection} onChange={(e) => setPickInspection(e.target.value)} aria-label="待查驗的申請">
                            <option value="">請選擇…</option>
                            {pendingInspections.map((i) => <option key={i.id} value={i.id}>{i.title}{i.location ? `（${i.location}）` : ''}{i.declared_qty != null ? `・申報 ${i.declared_qty} ${i.unit || ''}` : ''}</option>)}
                          </Select>
                        </Field>
                      </div>
                      <Button onClick={() => startFrom(pickInspection)} busy={creating} disabled={!pickInspection}>建立表單</Button>
                    </div>
                  )}
                  {demoMode && <p className="text-caption text-[var(--text-3)]">示範模式：表單只存在本次瀏覽；簽署與提送需正式專案。</p>}
                </div>
              ) : <Empty>監造查驗表單由監造建立；從右側清單或現場紀錄開啟已有的文件查閱。</Empty>
            )}

            {doc && form && (<>
              {editable && ['signed', 'submitted'].includes(status) && !amendMode && (
                <div className="mb-3 flex items-center gap-2 flex-wrap text-footnote text-[var(--text-2)]">
                  <span>版本 {doc.current_version_no} 已簽署{status === 'submitted' ? '並提送' : ''}，判定已落為查驗紀錄；內容已鎖定。</span>
                  <Button variant="secondary" size="sm" onClick={startAmend}>建立更正版本</Button>
                </div>
              )}
              {status === 'received' && <p className="mb-3 text-footnote text-[var(--text-2)]">對方已收件，本文件不可再修改。</p>}

              {pending.length > 0 && (formEditable || !editable) && (
                <div className="mb-3 rounded-lg bg-[var(--amber-tint)] p-3 text-footnote">
                  <div className="font-medium text-[var(--amber-text)]">待補 {pending.length} 項{formEditable ? '（補齊並存檔後才能簽署）' : ''}</div>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {pending.map((u) => (
                      <li key={u.key}><button type="button" onClick={() => document.getElementById(fieldAnchorId(u.key))?.scrollIntoView?.({ block: 'center' })} className={`hover:underline min-h-11 md:min-h-0 ${u.status === 'needs_confirmation' ? 'text-[var(--red-text)] font-medium' : 'text-[var(--blue-text)]'}`}>
                        {fieldLabel(u.key, form.content, labels)}{u.status && u.status !== 'pending' && u.status !== 'missing' && UNMET_STATUS_LABEL[u.status] ? `（${UNMET_STATUS_LABEL[u.status]}）` : ''}
                      </button></li>
                    ))}
                  </ul>
                </div>
              )}
              {suggestions.length > 0 && formEditable && (
                <div className="mb-3 rounded-2xl bg-[var(--ai-tint)] p-3 space-y-2">
                  <div className="flex items-center gap-1 text-caption font-medium text-[var(--ai-text)]"><MSym name="auto_awesome" size={14} className="text-[var(--ai)]" />AI 建議（文件已有人工版本，新辨識結果不自動套用；判定與確認數量永遠不由系統帶入）</div>
                  {suggestions.map((a) => (
                    <div key={a.id} className="flex items-start gap-2 flex-wrap text-footnote">
                      <span className="min-w-0 flex-1 text-[var(--text)]">{a.summary}</span>
                      <Button size="sm" variant="secondary" onClick={() => applyOneSuggestion(a)} disabled={appliedSuggestions.includes(a.id)}>{appliedSuggestions.includes(a.id) ? '已套用' : '套用建議'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => rejectSuggestion(a)}>拒絕</Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto -mx-2 px-2">
                <InspectionFormSheet project={project} doc={doc} version={detail?.version} content={form.content} sources={form.sources}
                  signature={null} frame={frame} inspection={inspection} checklistTemplates={inspectionTemplates} checklistTemplate={checklistTemplate}
                  byId={byId} workItem={workItem} requiredStages={requiredStages} batchCum={batchCum} selfCheckDoc={selfCheckDoc}
                  stamp={null} titleAs="h2" className="min-w-[680px] !p-4"
                  edit={{ org, editable: !!formEditable, onChange: onFormChange, state: form, issues: issueMap, photosById, onTemplateChange }} />
              </div>

              <DocumentPhotos attachments={attachments} photosById={photosById} editable={!!formEditable} byId={byId} ownerOrg="supervisor"
                issues={attachmentIssueMap} onToggleRole={toggleRole} onRemove={removeAttachment}
                uploader={formEditable ? <p className="text-footnote text-[var(--text-3)]">要補更多查驗照片請到<Link to="/site" className="text-[var(--blue-text)] hover:underline mx-1">現場紀錄</Link>上傳；辨識結果會以新版本或建議帶入。</p> : null} />

              {!detailLoading && (
                <div className="mt-5 space-y-3">
                  <DocumentLifecycle doc={doc} version={detail?.version} signatures={detail?.signatures || []} submissions={detail?.submissions || []}
                    viewerOrg={org} canAct={canAct} dirty={dirty} content={form.content} labels={labels} templateMeta={frame} signNote={editable ? SIGN_NOTE : null}
                    busy={busy} onSign={onSign} onSubmit={onSubmit} onReceive={onReceive} onReturn={onReturn}
                    message={lifecycleMsg} />
                  {inspection && inspection.status !== '待查驗' && (
                    <p className="text-footnote text-[var(--text-2)]">查驗「{inspection.title}」判定 {inspection.status}{inspection.confirmed_qty != null ? `，本次確認 ${inspection.confirmed_qty} ${inspection.unit || ''}` : ''}。{inspection.status !== '合格' ? <Link to="/quality?seg=defects" className="text-[var(--blue-text)] hover:underline ml-1">查看缺失</Link> : null}<Link to={`/quality?seg=inspections&inspection=${encodeURIComponent(inspection.id)}`} className="text-[var(--blue-text)] hover:underline ml-2">前往查驗</Link></p>
                  )}
                </div>
              )}
              {detailLoading && <div className="mt-5" aria-busy="true"><SkeletonList rows={2} label="載入文件狀態…" /></div>}
              {demoMode && editable && (
                <p className="mt-2 text-caption text-[var(--text-3)]">示範模式：草稿只存在本次瀏覽；簽署與提送需正式專案。</p>
              )}

              <div className={`flex items-center gap-3 mt-4 flex-wrap${editable ? ' sticky max-md:bottom-[var(--bottom-nav-h)] md:bottom-0 z-10 bg-[var(--surface)] border-t border-[var(--border-2)] -mx-5 px-5 py-2.5' : ''}`}>
                {editable ? (
                  <Button onClick={onSave} busy={saving} disabled={!formEditable}>存檔</Button>
                ) : (
                  <span className="text-xs text-[var(--text-3)]">{viewerLabel}：監造查驗表單由監造填報，此頁為唯讀。</span>
                )}
                {savedMsg && <span className={`text-sm ${savedMsg.tone === 'success' ? 'text-[var(--green-text)]' : savedMsg.tone === 'info' ? 'text-[var(--blue-text)]' : 'text-[var(--red-text)]'}`}>{savedMsg.text}</span>}
              </div>
            </>)}
            {doc && !form && <div aria-busy="true"><SkeletonList rows={3} label="載入文件…" /></div>}
          </Card>
        </div>

        <Card title={`監造查驗表單（${rows.length}）`} className="min-w-0" action={editable && doc ? <Button variant="secondary" size="sm" onClick={() => openDoc(null)}><MSym name="add" size={14} />建立</Button> : (fieldDocsLoading ? <span className="text-caption text-[var(--text-3)]">同步中…</span> : null)}>
          {rows.length === 0 ? <Empty>尚無處理中的監造查驗表單{demoMode ? '' : '；已收件的不再列出'}</Empty> : (
            <div className="space-y-1.5">
              {rows.map((d) => {
                const meta = docStatusMeta(d, org)
                return (
                  <div key={d.id} className={`px-3 py-2 rounded-lg text-sm border transition-colors ${d.id === doc?.id ? 'bg-[var(--blue-tint)] border-[var(--blue)]' : 'border-[var(--border)] hover:bg-[var(--surface-2)]'}`}>
                    <div className="flex justify-between items-center gap-2">
                      <button onClick={() => openDoc(d.id)} className="font-medium text-[var(--text)] text-left flex-1 truncate max-md:min-h-11">{rowLabel(d)}</button>
                      <Badge color={meta.tone}>{meta.label}</Badge>
                    </div>
                    <div className="text-xs text-[var(--text-2)] mt-0.5 num">版本 {d.current_version_no}{meta.action ? `・${meta.action}` : ''}</div>
                  </div>
                )
              })}
            </div>
          )}
          {editable && pendingInspections.length > 0 && (
            <div className="mt-3 text-footnote">
              <div className="text-[var(--text-2)] mb-1">待判定、尚未建立表單（{pendingInspections.length}）</div>
              <ul className="space-y-1">
                {pendingInspections.slice(0, 8).map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[var(--text)]">{i.title}</span>
                    <Button size="sm" variant="ghost" onClick={() => startFrom(i.id)} busy={creating}>建立表單</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-caption text-[var(--text-3)]">{project?.project_name}・監造查驗表單可由{ORG_LABEL.contractor}與{ORG_LABEL.owner}查閱與收件；只有監造可填寫簽署。判定與確認數量也顯示在<Link to="/quality?seg=inspections" className="text-[var(--blue-text)] hover:underline mx-1">品質查驗</Link>與估驗的來源展開。</p>
        </Card>
      </div>

      {editable && (
        <p className="text-xs text-[var(--text-3)]">
          一份查驗申請＝一份監造查驗表單：存檔＝伺服器保存版本並列出待補；查驗申請帶入的資料要逐項確認；判定與本次確認數量只能親自填寫；簽署（登入的平台帳號）即判定並寫入監造確認紀錄（不合格／部分合格自動開缺失），可提送給施工廠商與機關；簽後更正另開版本，改確認數量須先撤銷原確認紀錄。
        </p>
      )}
    </div>
  )
}
