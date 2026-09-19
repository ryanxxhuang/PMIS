// 監造日誌(P3a;D-026 四類文書之二):這一頁是「監造日誌文件」的審核／簽署／提送頁,也是監造日誌**唯一**的
// 寫入入口——存檔=save_field_document_version(伺服器保存版本、算雜湊、判待補),簽署=sign_field_document
// (登入的平台帳號;事實表 supervisor_logs 在簽署交易內落庫),提送機關／機關收件／退回各走 RPC。
//
// 與施工日誌頁(SiteLog)共用 DocumentLifecycle／DocumentPhotos／IntakeUploader／WeatherPull／FieldSourceChip／RowsEditor;
// 欄位版面由伺服器範本 fn_field_document_template('supervisor_log')(示範範本,Q11)驅動,頁面與列印都標「示範範本」與免責聲明。
// 一天一份活文件(?d=);?doc=<id> 直達文件。沒有文件時是空白草稿:全部待補、收件情形與廠商施工情形只在同日
// 施工日誌已簽署／提送時才引用(來源 field_document:<id>:v<n>),否則留待補、不填「無」。
// 到場人員只能人填:AI 草稿永遠留空,人填了也只是「待親自確認」,按「確認到場人員」才 confirmed(伺服器 PD004
// needs_confirmation 同一條規則);廠商照片只能以「參考」附上(PD005)。
// 樂觀併發:base 版本≠目前版本(PD001／PD002)→ 明確提示重新載入,不默默覆蓋。簽後更正=人明確按「建立更正版本」。
// 視角:監造(can.approve)可編、簽、送;機關(提送對象)可收件／退回;廠商可讀(Q4 暫行)——唯讀除日期外沒有 input。
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Empty, PageHeader, SkeletonList, Input, Badge, ErrorBanner } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { taipeiToday } from '../../lib/dates.js'
import { billableLeaves } from '../../lib/boqCalc.js'
import { useUnsavedEdit } from '../../lib/unsavedEdits.js'
import {
  emptySupervisorLogContent, emptySupervisorLogSources, requiredKeysFor, unmetFields, fieldLabel, UNMET_STATUS_LABEL,
  templateConfirmRequiredKeys, templateFieldLabels, applySuggestion, mergeAttachments, attachmentIssues, fieldDocErrorGuidance, docStatusMeta, DOC_STATUS_LABEL,
  formalDailyLogFromDetail, applyFormalDailyLog, ORG_LABEL,
} from '../../lib/fieldDocs.js'
import { composeContractorSummary, isFormalDailyLog, dailyLogReceipt, formalDailyLogSource } from '../../lib/fieldDocText.js'
import { fieldAnchorId } from '../../components/sitelog/DailyLogFields.jsx'
import SupervisorLogFields from '../../components/sitelog/SupervisorLogFields.jsx'
import DocumentPhotos from '../../components/sitelog/DocumentPhotos.jsx'
import DocumentLifecycle from '../../components/sitelog/DocumentLifecycle.jsx'
import IntakeUploader from '../../components/sitelog/IntakeUploader.jsx'
import WeatherPull from '../../components/sitelog/WeatherPull.jsx'

const DOC_TYPE = 'supervisor_log'
const validDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null)
const EDITABLE_STATUSES = ['draft', 'pending_input', 'in_review', 'returned']
const FORMAL_HELPERS = { compose: composeContractorSummary, isFormal: isFormalDailyLog, receipt: dailyLogReceipt, source: formalDailyLogSource }

export default function SupervisorLog() {
  const {
    project, workItems, adjustedItems, can, currentUser, demoMode, isPersistedProject,
    fieldDocuments: fieldDocState, fieldDocsLoading, reloadFieldDocs, findActiveFieldDoc, createFieldDocDraft, getFieldDocument, getFieldDocumentTemplate,
    saveFieldDocumentVersion, signFieldDocument, submitFieldDocument, receiveFieldDocument, returnFieldDocument, listPhotosByIds, listMembers,
    agentActions, resolveAgentAction, inspections, defects, rfis, submittals,
  } = useStore()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { state: navState } = useLocation()
  const docParam = params.get('doc')
  const [date, setDate] = useState(() => validDate(params.get('d')) || taipeiToday())
  const org = currentUser?.org_type || 'contractor'
  const editable = !!can.approve // 監造(或非正式模式的專案管理者);伺服器 RLS／RPC 才是邊界
  const fieldDocuments = useMemo(() => fieldDocState?.documents || [], [fieldDocState])
  const lookups = useMemo(() => ({ inspections, defects, rfis, submittals, documents: fieldDocuments }), [inspections, defects, rfis, submittals, fieldDocuments])

  const doc = findActiveFieldDoc(DOC_TYPE, date)
  const sameDayDailyLog = findActiveFieldDoc('daily_log', date)
  useEffect(() => {
    if (!docParam) return
    const d = fieldDocuments.find((x) => x.id === docParam)
    if (d && d.doc_date !== date) setDate(d.doc_date)
  }, [docParam, fieldDocuments]) // eslint-disable-line react-hooks/exhaustive-deps

  const { leaves, byId } = useMemo(() => {
    if (!workItems) return { leaves: [], byId: new Map() }
    return { leaves: billableLeaves(adjustedItems), byId: new Map(adjustedItems.filter((it) => it.id).map((it) => [it.id, it])) }
  }, [workItems, adjustedItems])

  // 範本(示範範本):標記、必填鍵、人填欄、欄位名都由它推導;讀不到就明說,不用前端猜
  const [template, setTemplate] = useState(null)
  const [templateErr, setTemplateErr] = useState(null)
  useEffect(() => {
    let active = true
    ;(async () => {
      const r = await getFieldDocumentTemplate(DOC_TYPE)
      if (!active) return
      setTemplate(r.template); setTemplateErr(r.error ? friendlyError(r.error, '無法讀取監造日誌範本') : (r.template ? null : '伺服器沒有監造日誌範本'))
    })()
    return () => { active = false }
  }, [getFieldDocumentTemplate])
  const labels = useMemo(() => templateFieldLabels(template), [template])
  const humanOnly = useMemo(() => templateConfirmRequiredKeys(template), [template]) // 須確認欄(到場;human_only 蘊含)

  // 本案監造方成員(到場人員可帶 user_id;RPC 只給本案成員,簽署時 DB 再驗)
  const [members, setMembers] = useState([])
  useEffect(() => {
    if (!editable || !isPersistedProject) { setMembers([]); return }
    let active = true
    listMembers().then(({ rows }) => { if (active) setMembers((rows || []).filter((m) => m.org_type === 'supervisor')) })
    return () => { active = false }
  }, [editable, isPersistedProject, listMembers])

  // 文件脈絡與表單
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [form, setForm] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [photosById, setPhotosById] = useState(new Map())
  const [dailyLogFormal, setDailyLogFormal] = useState(null) // 同日施工日誌文件現況(引用用)
  const [baseVersion, setBaseVersion] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [amendMode, setAmendMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [savedMsg, setSavedMsgRaw] = useState(null)
  const setSavedMsg = (text, tone = 'error') => setSavedMsgRaw(text ? { text, tone } : null)
  const [conflict, setConflict] = useState(null)
  const [busy, setBusy] = useState(null)
  const [lifecycleMsg, setLifecycleMsgRaw] = useState(null)
  const setLifecycleMsg = (text, tone = 'error') => setLifecycleMsgRaw(text ? { text, tone } : null)
  const [appliedSuggestions, setAppliedSuggestions] = useState([])
  useUnsavedEdit('supervisor-log', dirty ? `監造日誌 ${date}（未存檔）` : null)

  const prevKeyRef = useRef(null)
  const loadKey = `${date}|${doc?.id || ''}|${doc?.current_version_no ?? ''}|${doc?.status || ''}|${sameDayDailyLog?.id || ''}|${sameDayDailyLog?.status || ''}|${template ? template.key : ''}`
  useEffect(() => {
    if (!template) return
    const dateChanged = prevKeyRef.current?.split('|')[0] !== date
    if (!dateChanged && dirty) return // 有未存檔編輯:不覆寫(伺服器變動由存檔時的 PD001 揭露)
    prevKeyRef.current = loadKey
    let active = true
    ;(async () => {
      setDetailLoading(true)
      const [nextDetail, dlDetail] = await Promise.all([doc ? getFieldDocument(doc.id) : Promise.resolve(null), sameDayDailyLog ? getFieldDocument(sameDayDailyLog.id) : Promise.resolve(null)])
      const formal = formalDailyLogFromDetail(dlDetail)
      let nextForm, nextAttachments = []
      const v = nextDetail?.version
      if (doc && v) {
        nextForm = { content: v.content || emptySupervisorLogContent(date, template), sources: v.field_sources || {} }
        nextAttachments = Array.isArray(v.attachments) ? v.attachments : []
      } else {
        // 空白草稿:全部待補;同日施工日誌已簽署／提送才引用摘要,任何狀態都記錄收件情形(來源 system:field_documents)
        const empty = { content: emptySupervisorLogContent(date, template), sources: emptySupervisorLogSources(template) }
        nextForm = applyFormalDailyLog(empty, formal, byId, FORMAL_HELPERS).state
      }
      const photoRows = await listPhotosByIds(nextAttachments.map((a) => a.photo_id))
      if (!active) return
      setDetail(nextDetail); setForm(nextForm); setAttachments(nextAttachments); setDailyLogFormal(formal)
      setPhotosById(new Map(photoRows.map((p) => [p.id, p])))
      setBaseVersion(doc?.current_version_no ?? 0)
      setDirty(false); setAmendMode(false); setConflict(null); setAppliedSuggestions([])
      setDetailLoading(false)
    })()
    return () => { active = false }
  }, [loadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeDate = async (next) => {
    if (!next || next === date) return
    if (dirty && !(await appConfirm({ title: '切換日期將遺失未存檔內容', body: `${date} 的監造日誌尚未存檔，切到 ${next} 會遺失已填內容。`, danger: true, confirmLabel: '放棄並切換' }))) return
    setSavedAt(null); setSavedMsg(''); setLifecycleMsg('')
    setDate(next)
    setParams((p) => { const n = new URLSearchParams(p); n.set('d', next); n.delete('doc'); return n }, { replace: true, state: navState })
  }

  const status = doc?.status || null
  const formEditable = editable && form && !!template && (!doc || EDITABLE_STATUSES.includes(status) || amendMode) && status !== 'received'
  const onFormChange = useCallback((next) => { setForm(next); setDirty(true) }, [])
  const startAmend = async () => {
    if (!(await appConfirm({ title: '建立更正版本？', body: `版本 ${doc.current_version_no} 的簽署${status === 'submitted' ? '與提送' : ''}會保留並綁在該版本；更正內容存檔後成為新版本草稿，需重新簽署${status === 'submitted' ? '並重新提送' : ''}。`, confirmLabel: '建立更正版本' }))) return
    setAmendMode(true)
  }

  // 待補集中呈現:伺服器 recheck 為準(存檔後);未存檔時用同一套規則預覽(含人填欄的待親自確認)
  const serverRecheck = useMemo(() => (Array.isArray(doc?.recheck) ? doc.recheck : []), [doc?.recheck])
  const pending = useMemo(() => {
    if (!form) return []
    if (!dirty && doc && doc.current_version_no > 0) return serverRecheck.filter((r) => !String(r.key).startsWith('attachments')).map((r) => ({ key: r.key, status: r.status || 'pending' }))
    return unmetFields(requiredKeysFor(form.content, doc?.required_fields, { docType: DOC_TYPE, template }), form.sources, humanOnly)
  }, [form, dirty, doc, serverRecheck, template, humanOnly])
  const issueMap = useMemo(() => new Map(pending.map((u) => [u.key, u.status])), [pending])
  const attachmentIssueMap = useMemo(() => attachmentIssues(serverRecheck), [serverRecheck])

  const applyWeather = (r) => {
    if (!form) return
    const src = { status: 'filled', source: 'cwa' }
    const content = { ...form.content, weather_am: r.am || form.content.weather_am, weather_pm: r.pm || form.content.weather_pm }
    const sources = { ...form.sources, ...(r.am ? { weather_am: src } : {}), ...(r.pm ? { weather_pm: src } : {}) }
    onFormChange({ content, sources })
  }
  // 引用同日施工日誌(只在已簽署／提送／收件時):摘要與收件情形一起帶入並標來源;不引用草稿或退回的
  const canImportDailyLog = !!(formEditable && dailyLogFormal && isFormalDailyLog(dailyLogFormal))
  const importDailyLog = () => {
    if (!form || !dailyLogFormal) return
    const { state, applied } = applyFormalDailyLog(form, dailyLogFormal, byId, FORMAL_HELPERS)
    onFormChange(state)
    setSavedMsg(applied ? `已引用同日施工日誌 v${dailyLogFormal.version_no}（${DOC_STATUS_LABEL[dailyLogFormal.status] || dailyLogFormal.status}）的施工概況與數量，請核對後存檔` : '同日施工日誌沒有施工概況與數量可引用；收件情形已更新', 'info')
  }

  const suggestions = useMemo(() => (agentActions || []).filter((a) => a.kind === 'suggest_field_update' && a.target_id === doc?.id && a.status === 'pending'), [agentActions, doc?.id])
  const applyOneSuggestion = (a) => {
    if (!form) return
    const { state, applied } = applySuggestion(form, a.evidence?.suggestion)
    if (a.evidence?.suggestion?.attachments) setAttachments((cur) => mergeAttachments(cur, a.evidence.suggestion.attachments))
    onFormChange(state)
    setAppliedSuggestions((ids) => [...ids, a.id])
    setSavedMsg(applied.length ? `已套用建議 ${applied.length} 項(${applied.slice(0, 4).map((k) => fieldLabel(k, state.content, labels)).join('、')}${applied.length > 4 ? '…' : ''}),存檔後生效` : '建議沒有可補入的欄位(現有值不覆蓋;到場人員永遠不由系統帶入)', 'info')
  }
  const rejectSuggestion = async (a) => {
    const r = await resolveAgentAction(a.id, 'rejected')
    if (r?.error) setSavedMsg(friendlyError(r.error, '建議未標記'))
  }

  const onSave = async () => {
    if (!form) return
    setSaving(true); setSavedMsg(''); setConflict(null)
    let d = doc
    let base = baseVersion
    if (!d) {
      const r = await createFieldDocDraft(DOC_TYPE, date)
      if (r.error) { setSaving(false); setSavedMsg(friendlyError(r.error, '無法建立監造日誌草稿')); return }
      d = r.doc; base = d.current_version_no
    }
    const r = await saveFieldDocumentVersion({ documentId: d.id, baseVersionNo: base, content: form.content, fieldSources: form.sources, attachments, changeNote: amendMode ? '簽後更正' : null })
    setSaving(false)
    if (r.error) {
      const g = fieldDocErrorGuidance(r.error)
      if (g.kind === 'reload') { setConflict(g.message); setSavedMsg('') } else setSavedMsg(friendlyError(r.error, '監造日誌存檔失敗'))
      return
    }
    for (const id of appliedSuggestions) await resolveAgentAction(id, 'accepted')
    setAppliedSuggestions([])
    setDirty(false); setAmendMode(false)
    setSavedAt(new Date())
    setBaseVersion(r.result.version_no)
    const left = (r.result.recheck || []).length
    setSavedMsg(left ? `已存檔 ✓ 版本 ${r.result.version_no}，尚有 ${left} 項待補或待確認` : `已存檔 ✓ 版本 ${r.result.version_no}，可簽署`, 'success')
    if (!doc) reloadFieldDocs()
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
    setLifecycleMsg(`已簽署版本 ${r.result.version_no}（雜湊 ${String(r.result.content_hash).slice(0, 12)}），監造日誌已正式落庫；可提送給機關。`, 'success')
  }
  const onSubmit = async () => {
    setBusy('submit'); setLifecycleMsg('')
    const r = await submitFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, docType: DOC_TYPE })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '提送未完成'); return }
    setLifecycleMsg(`${r.receipt.idempotent ? '這筆已提送過，沿用原回執：' : ''}已提送給機關（${String(r.receipt.created_at).slice(0, 16).replace('T', ' ')}，回執 ${String(r.receipt.submission_id).slice(0, 8)}）；等待機關收件。`, 'success')
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
    setLifecycleMsg('已退回，原因已留存；監造補正並重新簽署後會再送。', 'success')
  }

  const toggleRole = (photoId, role) => { setAttachments((cur) => cur.map((a) => (a.photo_id === photoId ? { ...a, role } : a))); setDirty(true) }
  const removeAttachment = (photoId) => { setAttachments((cur) => cur.filter((a) => a.photo_id !== photoId)); setDirty(true) }

  // 右欄:本案未終態的監造日誌(新→舊);已收件的不在載入範圍(與 /site 清單同一份資料)
  const dateRows = useMemo(() => fieldDocuments.filter((d) => d.doc_type === DOC_TYPE && d.status !== 'discarded' && d.status !== 'superseded').sort((a, b) => b.doc_date.localeCompare(a.doc_date)), [fieldDocuments])

  const header = <PageHeader title="監造日誌" tagline="每日監造紀錄・審核・簽署・提送機關" subtitle="監造照片上傳後由系統擬稿（示範範本），逐欄核對來源與待補；到場人員親自確認後簽署，提送機關收件" />
  if (!form || (!template && !templateErr)) {
    return (
      <div className="space-y-5">
        {header}
        <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} /></Card>
      </div>
    )
  }

  const saveStatus = saving ? { text: '存檔中…', cls: 'bg-[var(--blue-tint)] text-[var(--blue-text)]' }
    : dirty ? { text: '未存檔', cls: 'bg-[var(--amber-tint)] text-[var(--amber-text)]' }
      : doc ? { text: `已存檔${savedAt ? ` ${savedAt.toTimeString().slice(0, 5)}` : ''}・版本 ${doc.current_version_no}`, cls: 'bg-[var(--green-tint)] text-[var(--green-text)]' }
        : { text: '本日尚無監造日誌', cls: 'bg-[var(--surface-2)] text-[var(--text-2)]' }
  const readOnlyNote = !editable
  const viewerLabel = org === 'owner' ? '機關檢視' : '廠商檢視'
  const attendanceIssue = issueMap.get('attendance')

  return (
    <div className="space-y-5">
      <div>{header}</div>
      {/* 兩欄都 min-w-0:grid item 預設 min-width:auto,監造事項列在 375 內自己折行,不撐出水平溢位(P2c 踩過) */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5 min-w-0">
          <Card title="本日監造日誌" action={template?.is_demo ? <Badge color="amber">{template.demo_label || '示範範本'}</Badge> : null}>
            {template?.is_demo && (
              <p role="note" className="mb-3 text-caption text-[var(--text-2)] bg-[var(--amber-tint)] rounded-lg px-3 py-2">{template.disclaimer}</p>
            )}
            {templateErr && <ErrorBanner msg={`${templateErr}；無法判定必填欄位，請重新整理或聯絡平台。`} className="mb-3" />}
            {readOnlyNote && (
              <div className="mb-3 text-xs text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
                {viewerLabel}：監造日誌由監造填報與簽署，此頁為<b>唯讀</b>，可切換日期檢視；{org === 'owner' ? '監造提送後可在下方收件或退回。' : '提送對象為機關。'}
              </div>
            )}
            <div className="flex items-end gap-3 flex-wrap mb-3">
              <div className="max-md:w-full"><Field label="日期"><Input type="date" value={date} onChange={(e) => changeDate(e.target.value)} /></Field></div>
              <span role="status" aria-label={`保存狀態：${saveStatus.text}`} className={`inline-flex items-center h-8 mb-0.5 px-2.5 rounded-lg text-footnote font-medium ${saveStatus.cls}`}>{saveStatus.text}</span>
              {doc && <Badge color={docStatusMeta(doc, org).tone}>{DOC_STATUS_LABEL[doc.status] || doc.status}</Badge>}
              {formEditable && <WeatherPull date={date} onApply={applyWeather} onMessage={setSavedMsg} />}
              {doc && (
                <Button variant="outline" onClick={async () => {
                  if (dirty && !(await appConfirm({ title: '離開將遺失未存檔內容', body: `${date} 的監造日誌尚未存檔；列印頁印的是已簽署版本（未簽署則標示草稿）。要放棄未存檔內容並前往列印嗎？`, danger: true, confirmLabel: '放棄並前往' }))) return
                  navigate(`/supervisor-log/print?doc=${encodeURIComponent(doc.id)}`)
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
            {!doc && !dirty && editable && (
              <p className="mb-3 text-footnote text-[var(--text-2)]">本日尚無監造日誌。上傳監造照片會自動擬稿（監造事項逐項標來源；到場人員一律由你親自填寫確認）；也可直接填寫後存檔。</p>
            )}
            {editable && doc && ['signed', 'submitted'].includes(status) && !amendMode && (
              <div className="mb-3 flex items-center gap-2 flex-wrap text-footnote text-[var(--text-2)]">
                <span>版本 {doc.current_version_no} 已簽署{status === 'submitted' ? '並提送' : ''}，內容已鎖定。</span>
                <Button variant="secondary" size="sm" onClick={startAmend}>建立更正版本</Button>
              </div>
            )}
            {doc && status === 'received' && <p className="mb-3 text-footnote text-[var(--text-2)]">機關已收件，本文件不可再修改。</p>}

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
                {attendanceIssue === 'needs_confirmation' && <p className="mt-1 text-[var(--red-text)]">到場人員已填但尚未由你親自確認：請核對後按「確認到場人員」。</p>}
              </div>
            )}
            {suggestions.length > 0 && formEditable && (
              <div className="mb-3 rounded-2xl bg-[var(--ai-tint)] p-3 space-y-2">
                <div className="flex items-center gap-1 text-caption font-medium text-[var(--ai-text)]"><MSym name="auto_awesome" size={14} className="text-[var(--ai)]" />AI 建議（文件已有人工版本，新辨識結果不自動套用；到場人員永遠不由系統帶入）</div>
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
              <Empty>此日期尚無監造日誌。監造日誌由監造填報。</Empty>
            ) : (
              <SupervisorLogFields state={form} template={template} labels={labels} editable={!!formEditable} leaves={leaves} byId={byId} onChange={onFormChange} issues={issueMap}
                lookups={lookups} currentUser={currentUser} members={members}
                contractorTools={canImportDailyLog ? (
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <Button variant="secondary" size="sm" onClick={importDailyLog}>引用同日施工日誌 v{dailyLogFormal.version_no}</Button>
                    <span className="text-caption text-[var(--text-3)]">施工日誌已{DOC_STATUS_LABEL[dailyLogFormal.status] || dailyLogFormal.status}；引用會標來源並待你核對。</span>
                  </div>
                ) : (formEditable && dailyLogFormal && !isFormalDailyLog(dailyLogFormal) ? (
                  <p className="mt-1.5 text-caption text-[var(--text-3)]">同日施工日誌尚未簽署／提送（目前{DOC_STATUS_LABEL[dailyLogFormal.status] || dailyLogFormal.status}），不引用未定版內容；待廠商完成後再引用或自行填寫。</p>
                ) : null)} />
            )}

            {(doc || editable) && (
              <DocumentPhotos attachments={attachments} photosById={photosById} editable={!!formEditable} byId={byId} ownerOrg="supervisor"
                issues={attachmentIssueMap} onToggleRole={toggleRole} onRemove={removeAttachment}
                uploader={formEditable ? (dirty
                  ? <p className="text-footnote text-[var(--text-3)]">先存檔目前的修改，再上傳照片（辨識結果會以新版本或建議帶入）。</p>
                  : <IntakeUploader fixedDate={date} compact onDrafted={() => { reloadFieldDocs(); prevKeyRef.current = null }} />) : null} />
            )}

            {doc && !detailLoading && (
              <div className="mt-5">
                <DocumentLifecycle doc={doc} version={detail?.version} signatures={detail?.signatures || []} submissions={detail?.submissions || []}
                  viewerOrg={org} canAct={org === 'owner' ? !!can.oversee : editable} dirty={dirty} content={form.content} labels={labels} templateMeta={template}
                  busy={busy} onSign={onSign} onSubmit={onSubmit} onReceive={onReceive} onReturn={onReturn}
                  message={lifecycleMsg} />
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
                <span className="text-xs text-[var(--text-3)]">{viewerLabel}：監造日誌由監造填報，此頁為唯讀。</span>
              )}
              {savedMsg && <span className={`text-sm ${savedMsg.tone === 'success' ? 'text-[var(--green-text)]' : savedMsg.tone === 'info' ? 'text-[var(--blue-text)]' : 'text-[var(--red-text)]'}`}>{savedMsg.text}</span>}
            </div>
          </Card>
        </div>

        <Card title={`監造日誌（${dateRows.length}）`} className="min-w-0" action={fieldDocsLoading ? <span className="text-caption text-[var(--text-3)]">同步中…</span> : null}>
          {dateRows.length === 0 ? <Empty>尚無處理中的監造日誌{demoMode ? '' : '；已收件的不再列出'}</Empty> : (
            <div className="space-y-1.5">
              {dateRows.map((d) => {
                const meta = docStatusMeta(d, org)
                return (
                  <div key={d.id} className={`px-3 py-2 rounded-lg text-sm border transition-colors ${d.doc_date === date ? 'bg-[var(--blue-tint)] border-[var(--blue)]' : 'border-[var(--border)] hover:bg-[var(--surface-2)]'}`}>
                    <div className="flex justify-between items-center gap-2">
                      <button onClick={() => changeDate(d.doc_date)} className="font-medium text-[var(--text)] num text-left flex-1 truncate max-md:min-h-11">{d.doc_date}</button>
                      <Badge color={meta.tone}>{meta.label}</Badge>
                    </div>
                    <div className="text-xs text-[var(--text-2)] mt-0.5 num">版本 {d.current_version_no}{meta.action ? `・${meta.action}` : ''}</div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="mt-3 text-caption text-[var(--text-3)]">{project?.project_name}・監造日誌可由{ORG_LABEL.contractor}與{ORG_LABEL.owner}查閱；只有監造可填寫簽署。</p>
        </Card>
      </div>

      {editable && (
        <p className="text-xs text-[var(--text-3)]">
          一天一份文件：存檔＝伺服器保存版本並列出待補；到場人員只能由你親自填寫並確認，任何照片都不是到場證明；簽署（登入的平台帳號）後監造日誌才正式落庫並可提送機關；簽後更正另開版本重簽。廠商照片只能以「參考」附上。
        </p>
      )}
    </div>
  )
}
