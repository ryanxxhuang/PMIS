// 自主檢查表(P3b;D-026 四類文書之三):這一頁是「自主檢查表文件」的審核／填實測值／簽署／提送頁,也是自檢表文件**唯一**的
// 寫入入口——存檔=save_field_document_version(伺服器保存版本、算雜湊、判待補),簽署=sign_field_document(登入的平台帳號;
// 事實表 checklist_records 在簽署交易內落庫:首簽 Rev.0、簽後更正再簽=修訂 Rev.N,合格判定由 DB 依範本量化標準計算,
// 不合格由 DB 同交易開缺失),提送監造／監造收件／退回各走 RPC。
//
// 與施工日誌／監造日誌頁共用 DocumentLifecycle／DocumentPhotos／FieldSourceChip;框架版面由伺服器範本
// fn_field_document_template('self_check')(示範框架範本,Q11)驅動,檢查項目取自本案檢查表範本(品質查驗建立;內建 03310 首次
// 使用才落 DB)。一份文件=一次自檢(?doc=<id> 直達;沒有 ?doc= 是「新建」:選日期／範本／工項後第一次存檔才建文件)。
// 實測值只能人填:AI 草稿永遠留空(告示板讀數只是提示),每個項目系統帶入的值都要人逐項「確認」才能簽(伺服器 PD004
// needs_confirmation 同一條規則);簽署後可「提出查驗申請」檢附此表(沿用既有查驗申請流程)。
// 樂觀併發:base 版本≠目前版本(PD001／PD002)→ 明確提示重新載入,不默默覆蓋。簽後更正=人明確按「建立更正版本」並填更正原因
// (成為修訂版次的 revision_reason;伺服器沒有原因即拒簽)。
// 視角:廠商(can.edit)可編、簽、送;監造(提送對象)可收件／退回;機關可讀——唯讀除日期外沒有 input。
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Button, Empty, PageHeader, SkeletonList, Badge, ErrorBanner } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { taipeiToday } from '../../lib/dates.js'
import { billableLeaves } from '../../lib/boqCalc.js'
import { useUnsavedEdit } from '../../lib/unsavedEdits.js'
import {
  emptySelfCheckContent, emptySelfCheckSources, requiredKeysFor, unmetFields, fieldLabel, UNMET_STATUS_LABEL,
  docConfirmRequiredKeys, templateFieldLabels, checklistItemLabels, applySuggestion, mergeAttachments, attachmentIssues, fieldDocErrorGuidance,
  docStatusMeta, DOC_STATUS_LABEL, ORG_LABEL,
} from '../../lib/fieldDocs.js'
import { fieldAnchorId } from '../../components/sitelog/DailyLogFields.jsx'
import SelfCheckFields from '../../components/sitelog/SelfCheckFields.jsx'
import DocumentPhotos from '../../components/sitelog/DocumentPhotos.jsx'
import DocumentLifecycle from '../../components/sitelog/DocumentLifecycle.jsx'

const DOC_TYPE = 'self_check'
const validDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null)
const EDITABLE_STATUSES = ['draft', 'pending_input', 'in_review', 'returned']

export default function SelfCheck() {
  const {
    project, workItems, adjustedItems, can, currentUser, demoMode,
    fieldDocuments: fieldDocState, fieldDocsLoading, reloadFieldDocs, createFieldDocDraft, getFieldDocument, getFieldDocumentTemplate,
    saveFieldDocumentVersion, signFieldDocument, submitFieldDocument, receiveFieldDocument, returnFieldDocument, listPhotosByIds,
    agentActions, resolveAgentAction, checklistTemplates, ensureChecklistTemplate, inspections,
  } = useStore()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { state: navState } = useLocation()
  const docParam = params.get('doc')
  const org = currentUser?.org_type || 'contractor'
  const editable = !!can.edit // 廠商(或非正式模式的專案管理者);伺服器 RLS／RPC 才是邊界
  const fieldDocuments = useMemo(() => fieldDocState?.documents || [], [fieldDocState])
  const doc = docParam ? fieldDocuments.find((x) => x.id === docParam && x.doc_type === DOC_TYPE) || null : null
  const isNew = !docParam
  const [date, setDate] = useState(() => validDate(params.get('d')) || taipeiToday())

  const { leaves, byId } = useMemo(() => {
    if (!workItems) return { leaves: [], byId: new Map() }
    return { leaves: billableLeaves(adjustedItems), byId: new Map(adjustedItems.filter((it) => it.id).map((it) => [it.id, it])) }
  }, [workItems, adjustedItems])

  // 框架範本(示範框架):標記、必填鍵、須確認欄、欄位名都由它推導;讀不到就明說
  const [frame, setFrame] = useState(null)
  const [frameErr, setFrameErr] = useState(null)
  useEffect(() => {
    let active = true
    ;(async () => {
      const r = await getFieldDocumentTemplate(DOC_TYPE)
      if (!active) return
      setFrame(r.template); setFrameErr(r.error ? friendlyError(r.error, '無法讀取自主檢查表框架範本') : (r.template ? null : '伺服器沒有自主檢查表框架範本'))
    })()
    return () => { active = false }
  }, [getFieldDocumentTemplate])

  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [form, setForm] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [photosById, setPhotosById] = useState(new Map())
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
  useUnsavedEdit('self-check', dirty ? `自主檢查表 ${form?.content?.check_date || date}（未存檔）` : null)

  const checklistTemplate = useMemo(() => (checklistTemplates || []).find((t) => t.id === form?.content?.template_id) || null, [checklistTemplates, form?.content?.template_id])
  const checklistItems = checklistTemplate?.items || null
  const labels = useMemo(() => ({ ...templateFieldLabels(frame), ...checklistItemLabels(checklistItems) }), [frame, checklistItems])
  const confirmRequired = useMemo(() => docConfirmRequiredKeys(DOC_TYPE, frame, checklistItems), [frame, checklistItems])

  const prevKeyRef = useRef(null)
  const loadKey = `${docParam || 'new'}|${doc?.id || ''}|${doc?.current_version_no ?? ''}|${doc?.status || ''}|${frame ? frame.key : ''}`
  useEffect(() => {
    if (!frame) return
    if (prevKeyRef.current === loadKey) return
    const docChanged = prevKeyRef.current?.split('|')[0] !== (docParam || 'new')
    if (!docChanged && dirty) return // 有未存檔編輯:不覆寫(伺服器變動由存檔時的 PD001 揭露)
    prevKeyRef.current = loadKey
    let active = true
    ;(async () => {
      setDetailLoading(true)
      const nextDetail = doc ? await getFieldDocument(doc.id) : null
      let nextForm, nextAttachments = []
      const v = nextDetail?.version
      if (doc && v) {
        nextForm = { content: v.content || emptySelfCheckContent(doc.doc_date, frame, null), sources: v.field_sources || {} }
        nextAttachments = Array.isArray(v.attachments) ? v.attachments : []
      } else if (doc) {
        const tpl = (checklistTemplates || []).find((t) => t.id === doc.template_id) || null
        const content = emptySelfCheckContent(doc.doc_date, frame, tpl)
        nextForm = { content, sources: emptySelfCheckSources(content, tpl) }
      } else {
        // 新建:預設第一張本案範本(沒有就留空,由人選);日期預設今天
        const tpl = (checklistTemplates || [])[0] || null
        const content = emptySelfCheckContent(date, frame, tpl)
        nextForm = { content, sources: emptySelfCheckSources(content, tpl) }
      }
      const photoRows = await listPhotosByIds(nextAttachments.map((a) => a.photo_id))
      if (!active) return
      setDetail(nextDetail); setForm(nextForm); setAttachments(nextAttachments)
      setPhotosById(new Map(photoRows.map((p) => [p.id, p])))
      setBaseVersion(doc?.current_version_no ?? 0)
      if (doc) setDate(doc.doc_date)
      setDirty(false); setAmendMode(false); setAmendReason(''); setConflict(null); setAppliedSuggestions([])
      setDetailLoading(false)
    })()
    return () => { active = false }
  }, [loadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const status = doc?.status || null
  const formEditable = editable && form && !!frame && (!doc || EDITABLE_STATUSES.includes(status) || amendMode) && status !== 'received'
  const onFormChange = useCallback((next) => { setForm(next); setDirty(true) }, [])
  const onDateChange = (next) => { if (!validDate(next)) return; setDate(next); onFormChange({ ...form, content: { ...form.content, check_date: next } }) }
  const startAmend = async () => {
    const reason = await appPrompt({ title: '建立更正版本？', label: `版本 ${doc.current_version_no} 的簽署${status === 'submitted' ? '與提送' : ''}會保留並綁在該版本；更正存檔後成為新版本草稿，重新簽署時以修訂版次（Rev.N）落庫。更正原因（必填，簽署時寫進修訂紀錄）`, required: true, confirmLabel: '建立更正版本' })
    if (reason === null) return
    setAmendReason(reason); setAmendMode(true)
  }

  // 待補集中呈現:伺服器 recheck 為準(存檔後);未存檔時用同一套規則預覽(每個項目 filled 都要人確認)
  const serverRecheck = useMemo(() => (Array.isArray(doc?.recheck) ? doc.recheck : []), [doc?.recheck])
  const pending = useMemo(() => {
    if (!form) return []
    if (!dirty && doc && doc.current_version_no > 0) return serverRecheck.filter((r) => !String(r.key).startsWith('attachments')).map((r) => ({ key: r.key, status: r.status || 'pending' }))
    return unmetFields(requiredKeysFor(form.content, doc?.required_fields, { docType: DOC_TYPE, template: frame, checklistItems }), form.sources, confirmRequired)
  }, [form, dirty, doc, serverRecheck, frame, checklistItems, confirmRequired])
  const issueMap = useMemo(() => new Map(pending.map((u) => [u.key, u.status])), [pending])
  const attachmentIssueMap = useMemo(() => attachmentIssues(serverRecheck), [serverRecheck])

  const suggestions = useMemo(() => (agentActions || []).filter((a) => a.kind === 'suggest_field_update' && a.target_id === doc?.id && a.status === 'pending'), [agentActions, doc?.id])
  const applyOneSuggestion = (a) => {
    if (!form) return
    const { state, applied } = applySuggestion(form, a.evidence?.suggestion)
    if (a.evidence?.suggestion?.attachments) setAttachments((cur) => mergeAttachments(cur, a.evidence.suggestion.attachments))
    onFormChange(state)
    setAppliedSuggestions((ids) => [...ids, a.id])
    setSavedMsg(applied.length ? `已套用建議 ${applied.length} 項(${applied.slice(0, 4).map((k) => fieldLabel(k, state.content, labels)).join('、')}),存檔後生效` : '建議沒有可補入的欄位(現有值不覆蓋;檢查結果永遠不由系統帶入)', 'info')
  }
  const rejectSuggestion = async (a) => {
    const r = await resolveAgentAction(a.id, 'rejected')
    if (r?.error) setSavedMsg(friendlyError(r.error, '建議未標記'))
  }

  const onSave = async () => {
    if (!form) return
    if (!form.content.template_id) { setSavedMsg('請先選擇檢查表範本'); return }
    setSaving(true); setSavedMsg(''); setConflict(null)
    let d = doc
    let base = baseVersion
    let content = form.content
    if (!d) {
      // 內建範本(尚未落 DB)先落庫,文件才掛得到本案範本 id(與品質查驗的檢查表同一條規則)
      const chosen = (checklistTemplates || []).find((t) => t.id === form.content.template_id)
      const ensured = await ensureChecklistTemplate(chosen)
      if (ensured.error) { setSaving(false); setSavedMsg(friendlyError(ensured.error, '檢查表範本落庫失敗')); return }
      if (ensured.template.id !== content.template_id) content = { ...content, template_id: ensured.template.id }
      const r = await createFieldDocDraft(DOC_TYPE, content.check_date, { templateId: ensured.template.id })
      if (r.error) { setSaving(false); setSavedMsg(friendlyError(r.error, '無法建立自主檢查表草稿')); return }
      d = r.doc; base = d.current_version_no
    }
    // 有簽署紀錄的文件再存版=更正:更正原因必填(簽署時成為修訂版次的 revision_reason)
    let changeNote = amendMode ? amendReason : null
    if (!changeNote && (detail?.signatures?.length || 0) > 0) {
      const reason = await appPrompt({ title: '更正原因', label: '本文件已簽署過；存檔會建立更正版本，重新簽署時以修訂版次落庫。更正原因（必填）', required: true })
      if (reason === null) { setSaving(false); return }
      changeNote = reason; setAmendReason(reason)
    }
    const r = await saveFieldDocumentVersion({ documentId: d.id, baseVersionNo: base, content, fieldSources: form.sources, attachments, changeNote })
    setSaving(false)
    if (r.error) {
      const g = fieldDocErrorGuidance(r.error)
      if (g.kind === 'reload') { setConflict(g.message); setSavedMsg('') } else setSavedMsg(friendlyError(r.error, '自主檢查表存檔失敗'))
      return
    }
    for (const id of appliedSuggestions) await resolveAgentAction(id, 'accepted')
    setAppliedSuggestions([])
    setDirty(false); setAmendMode(false)
    setSavedAt(new Date())
    setBaseVersion(r.result.version_no)
    const left = (r.result.recheck || []).length
    setSavedMsg(left ? `已存檔 ✓ 版本 ${r.result.version_no}，尚有 ${left} 項待補或待確認` : `已存檔 ✓ 版本 ${r.result.version_no}，可簽署`, 'success')
    if (!doc) {
      prevKeyRef.current = null
      setParams((p) => { const n = new URLSearchParams(p); n.set('doc', d.id); n.delete('d'); return n }, { replace: true, state: navState })
      reloadFieldDocs()
    }
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
    setLifecycleMsg(`已簽署版本 ${r.result.version_no}（雜湊 ${String(r.result.content_hash).slice(0, 12)}），自主檢查紀錄已正式落庫（判定由伺服器計算）；可提送給監造，或提出查驗申請檢附此表。`, 'success')
  }
  const onSubmit = async () => {
    setBusy('submit'); setLifecycleMsg('')
    const r = await submitFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, docType: DOC_TYPE })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '提送未完成'); return }
    setLifecycleMsg(`${r.receipt.idempotent ? '這筆已提送過，沿用原回執：' : ''}已提送給監造（${String(r.receipt.created_at).slice(0, 16).replace('T', ' ')}，回執 ${String(r.receipt.submission_id).slice(0, 8)}）；等待監造收件。`, 'success')
  }
  const onReceive = async () => {
    setBusy('receive'); setLifecycleMsg('')
    const r = await receiveFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '收件未完成'); return }
    setLifecycleMsg(`已收件（${String(r.receipt.created_at).slice(0, 16).replace('T', ' ')}）。`, 'success')
  }
  const onReturn = async (reason) => {
    setBusy('return'); setLifecycleMsg('')
    const r = await returnFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, reason })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '退回未完成'); return }
    setLifecycleMsg('已退回，原因已留存；廠商補正並重新簽署後會再送。', 'success')
  }
  const toggleRole = (photoId, role) => { setAttachments((cur) => cur.map((a) => (a.photo_id === photoId ? { ...a, role } : a))); setDirty(true) }
  const removeAttachment = (photoId) => { setAttachments((cur) => cur.filter((a) => a.photo_id !== photoId)); setDirty(true) }

  // 右欄:本案未終態的自檢表文件(新→舊);已收件的不在載入範圍(與 /site 清單同一份資料)
  const rows = useMemo(() => fieldDocuments.filter((d) => d.doc_type === DOC_TYPE && d.status !== 'discarded' && d.status !== 'superseded')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))), [fieldDocuments])
  const rowLabel = (d) => {
    const wid = d.target_key ? d.target_key.split(':')[1] : null
    const wi = wid ? byId.get(wid) : null
    const tpl = (checklistTemplates || []).find((t) => t.id === d.template_id)
    return [d.doc_date, tpl?.title, wi ? `工項 ${wi.item_no || ''}` : null].filter(Boolean).join('・')
  }
  const openDoc = async (id) => {
    if (dirty && !(await appConfirm({ title: '切換文件將遺失未存檔內容', body: '目前這份自主檢查表尚未存檔，切換會遺失已填內容。', danger: true, confirmLabel: '放棄並切換' }))) return
    setSavedAt(null); setSavedMsg(''); setLifecycleMsg('')
    setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('doc', id); else n.delete('doc'); n.delete('d'); return n }, { replace: true, state: navState })
  }
  // 簽署後檢附查驗:走既有查驗申請流程(/quality 帶 ?attach=<record_id> 預填檢附),已檢附就顯示查驗名稱
  const attachedInspection = useMemo(() => (doc?.target_id ? (inspections || []).find((i) => i.checklist_record_id === doc.target_id) || null : null), [inspections, doc?.target_id])
  const canRequestInspection = !!(doc?.target_id && ['signed', 'submitted', 'received'].includes(status) && can.submit && !attachedInspection)

  const header = <PageHeader title="自主檢查表" tagline="一級品管・審核・填實測值・簽署・提送監造" subtitle="現場照片上傳後由系統依本案檢查表範本擬稿（示範框架範本）；實測值一律親自量測填寫，簽署後判定由伺服器計算、可隨查驗申請檢附" />
  if (!form || (!frame && !frameErr)) {
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
        <Card><Empty>找不到編號 {docParam} 的自主檢查表（可能已捨棄、不在本案，或連結已失效）。<Button variant="secondary" className="ml-2" onClick={() => openDoc(null)}>回自主檢查表</Button></Empty></Card>
      </div>
    )
  }

  const saveStatus = saving ? { text: '存檔中…', cls: 'bg-[var(--blue-tint)] text-[var(--blue-text)]' }
    : dirty ? { text: '未存檔', cls: 'bg-[var(--amber-tint)] text-[var(--amber-text)]' }
      : doc ? { text: `已存檔${savedAt ? ` ${savedAt.toTimeString().slice(0, 5)}` : ''}・版本 ${doc.current_version_no}`, cls: 'bg-[var(--green-tint)] text-[var(--green-text)]' }
        : { text: '尚未建立（新自主檢查表）', cls: 'bg-[var(--surface-2)] text-[var(--text-2)]' }
  const readOnlyNote = !editable
  const viewerLabel = org === 'owner' ? '機關檢視' : '監造檢視'

  return (
    <div className="space-y-5">
      <div>{header}</div>
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5 min-w-0">
          <Card title={doc ? '本份自主檢查表' : '新自主檢查表'} action={frame?.is_demo ? <Badge color="amber">{frame.demo_label || '示範範本'}</Badge> : null}>
            {frame?.is_demo && (
              <p role="note" className="mb-3 text-caption text-[var(--text-2)] bg-[var(--amber-tint)] rounded-lg px-3 py-2">{frame.disclaimer}</p>
            )}
            {frameErr && <ErrorBanner msg={`${frameErr}；無法判定必填欄位，請重新整理或聯絡平台。`} className="mb-3" />}
            {readOnlyNote && (
              <div className="mb-3 text-xs text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
                {viewerLabel}：自主檢查表由施工廠商填報與簽署，此頁為<b>唯讀</b>；{org === 'supervisor' ? '廠商提送後可在下方收件或退回。' : '提送對象為監造。'}
              </div>
            )}
            <div className="flex items-end gap-3 flex-wrap mb-3">
              <span role="status" aria-label={`保存狀態：${saveStatus.text}`} className={`inline-flex items-center h-8 mb-0.5 px-2.5 rounded-lg text-footnote font-medium ${saveStatus.cls}`}>{saveStatus.text}</span>
              {doc && <Badge color={docStatusMeta(doc, org).tone}>{DOC_STATUS_LABEL[doc.status] || doc.status}</Badge>}
              {doc && (
                <Button variant="outline" onClick={async () => {
                  if (dirty && !(await appConfirm({ title: '離開將遺失未存檔內容', body: '列印頁印的是已簽署版本（未簽署則標示草稿）。要放棄未存檔內容並前往列印嗎？', danger: true, confirmLabel: '放棄並前往' }))) return
                  navigate(`/self-check/print?doc=${encodeURIComponent(doc.id)}`)
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
            {!doc && editable && (
              <p className="mb-3 text-footnote text-[var(--text-2)]">選檢查日期、本案檢查表範本與對應工項後存檔即建立文件。上傳現場照片會自動擬稿（每個配到工項的照片一份，實測值一律留待你親自量測）。{(checklistTemplates || []).length === 0 ? '本案尚無檢查表範本，請先到品質查驗建立。' : ''}</p>
            )}
            {editable && doc && ['signed', 'submitted'].includes(status) && !amendMode && (
              <div className="mb-3 flex items-center gap-2 flex-wrap text-footnote text-[var(--text-2)]">
                <span>版本 {doc.current_version_no} 已簽署{status === 'submitted' ? '並提送' : ''}，內容已鎖定；已落為自主檢查紀錄{detail?.signatures?.length > 1 ? `（修訂 Rev.${detail.signatures.length - 1}）` : '（Rev.0）'}。</span>
                <Button variant="secondary" size="sm" onClick={startAmend}>建立更正版本</Button>
              </div>
            )}
            {doc && status === 'received' && <p className="mb-3 text-footnote text-[var(--text-2)]">監造已收件，本文件不可再修改。</p>}

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
                <div className="flex items-center gap-1 text-caption font-medium text-[var(--ai-text)]"><MSym name="auto_awesome" size={14} className="text-[var(--ai)]" />AI 建議（文件已有人工版本，新辨識結果不自動套用；檢查結果永遠不由系統帶入）</div>
                {suggestions.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 flex-wrap text-footnote">
                    <span className="min-w-0 flex-1 text-[var(--text)]">{a.summary}</span>
                    <Button size="sm" variant="secondary" onClick={() => applyOneSuggestion(a)} disabled={appliedSuggestions.includes(a.id)}>{appliedSuggestions.includes(a.id) ? '已套用' : '套用建議'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => rejectSuggestion(a)}>拒絕</Button>
                  </div>
                ))}
              </div>
            )}

            {!doc && readOnlyNote ? (
              <Empty>自主檢查表由施工廠商填報；從右側清單或現場紀錄開啟已有的文件查閱。</Empty>
            ) : (
              <SelfCheckFields state={form} frame={frame} checklistTemplates={checklistTemplates || []} checklistTemplate={checklistTemplate} labels={labels}
                editable={!!formEditable} leaves={leaves} byId={byId} onChange={onFormChange} issues={issueMap}
                isNew={isNew} date={form.content.check_date || date} onDateChange={onDateChange} />
            )}

            {doc && (
              <DocumentPhotos attachments={attachments} photosById={photosById} editable={!!formEditable} byId={byId} ownerOrg="contractor"
                issues={attachmentIssueMap} onToggleRole={toggleRole} onRemove={removeAttachment}
                uploader={formEditable ? <p className="text-footnote text-[var(--text-3)]">要補更多照片請到<Link to="/site" className="text-[var(--blue-text)] hover:underline mx-1">現場紀錄</Link>上傳；辨識結果會以新版本或建議帶入。</p> : null} />
            )}

            {doc && !detailLoading && (
              <div className="mt-5 space-y-3">
                <DocumentLifecycle doc={doc} version={detail?.version} signatures={detail?.signatures || []} submissions={detail?.submissions || []}
                  viewerOrg={org} canAct={org === 'supervisor' ? !!can.approve : editable} dirty={dirty} content={form.content} labels={labels} templateMeta={frame}
                  busy={busy} onSign={onSign} onSubmit={onSubmit} onReceive={onReceive} onReturn={onReturn}
                  message={lifecycleMsg} />
                {doc.target_id && ['signed', 'submitted', 'received'].includes(status) && (
                  <div className="flex items-center gap-2 flex-wrap text-footnote">
                    {attachedInspection
                      ? <span className="text-[var(--text-2)]">已檢附於查驗「{attachedInspection.title}」（{attachedInspection.status}）。<Link to={`/quality?seg=inspections&inspection=${encodeURIComponent(attachedInspection.id)}`} className="text-[var(--blue-text)] hover:underline ml-1">前往查驗</Link></span>
                      : canRequestInspection
                        ? <><Button variant="secondary" size="sm" onClick={() => navigate(`/quality?seg=inspections&attach=${encodeURIComponent(doc.target_id)}`)}>提出查驗申請（檢附此表）</Button><span className="text-caption text-[var(--text-3)]">走既有查驗申請流程，送出前可改。</span></>
                        : <span className="text-[var(--text-3)]">已落為自主檢查紀錄；查驗申請時可在品質查驗檢附。</span>}
                  </div>
                )}
              </div>
            )}
            {doc && detailLoading && <div className="mt-5" aria-busy="true"><SkeletonList rows={2} label="載入文件狀態…" /></div>}
            {demoMode && editable && doc && (
              <p className="mt-2 text-caption text-[var(--text-3)]">示範模式：草稿只存在本次瀏覽；簽署與提送需正式專案。</p>
            )}

            <div className={`flex items-center gap-3 mt-4 flex-wrap${editable ? ' sticky max-md:bottom-[var(--bottom-nav-h)] md:bottom-0 z-10 bg-[var(--surface)] border-t border-[var(--border-2)] -mx-5 px-5 py-2.5' : ''}`}>
              {editable ? (
                <Button onClick={onSave} busy={saving} disabled={!formEditable}>存檔</Button>
              ) : (
                <span className="text-xs text-[var(--text-3)]">{viewerLabel}：自主檢查表由施工廠商填報，此頁為唯讀。</span>
              )}
              {savedMsg && <span className={`text-sm ${savedMsg.tone === 'success' ? 'text-[var(--green-text)]' : savedMsg.tone === 'info' ? 'text-[var(--blue-text)]' : 'text-[var(--red-text)]'}`}>{savedMsg.text}</span>}
            </div>
          </Card>
        </div>

        <Card title={`自主檢查表（${rows.length}）`} className="min-w-0" action={editable ? <Button variant="secondary" size="sm" onClick={() => openDoc(null)}><MSym name="add" size={14} />新建</Button> : (fieldDocsLoading ? <span className="text-caption text-[var(--text-3)]">同步中…</span> : null)}>
          {rows.length === 0 ? <Empty>尚無處理中的自主檢查表{demoMode ? '' : '；已收件的不再列出'}</Empty> : (
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
          <p className="mt-3 text-caption text-[var(--text-3)]">{project?.project_name}・自主檢查表可由{ORG_LABEL.supervisor}與{ORG_LABEL.owner}查閱；只有施工廠商可填寫簽署。簽署落下的紀錄與直接登錄的紀錄都在<Link to="/quality?seg=checklist" className="text-[var(--blue-text)] hover:underline mx-1">品質查驗</Link>。</p>
        </Card>
      </div>

      {editable && (
        <p className="text-xs text-[var(--text-3)]">
          一份文件＝一次自主檢查：存檔＝伺服器保存版本並列出待補；實測值只能親自量測填寫，系統帶入的值要逐項確認；簽署（登入的平台帳號）後才落為自主檢查紀錄（判定由伺服器計算、不合格自動開缺失）並可提送監造或檢附查驗申請；簽後更正另開版本、填原因、重簽即修訂版次。
        </p>
      )}
    </div>
  )
}
