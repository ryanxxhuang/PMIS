// 施工日誌(P2c;D-026 第一條完整路徑):這一頁是「施工日誌文件」的審核／簽署／提送頁,也是施工日誌
// **唯一**的寫入入口——存檔=save_field_document_version(伺服器保存版本、算雜湊、判待補),簽署=
// sign_field_document(登入的平台帳號;事實表 daily_logs／daily_log_items 在簽署交易內落庫),提送／收件／退回
// 各走 RPC。舊的直接 upsert daily_logs、逐張辨識回填表單、onWhiteboard 把板上未寫數量填 0 的
// 路徑全部退場(store/slices/site.js)。
//
// 一天一份活文件(?d=);?doc=<id> 直達文件。沒有文件時:
//   * 該日有既有未簽署日誌(舊路徑寫的,正式 12 筆)→ 以其內容為草稿,來源全標「既有紀錄、待核對」,
//     第一次存檔才建立文件(設計 §9;不偽造簽署)。
//   * 都沒有 → 空白草稿(全部待補)。
// 欄位逐欄顯示值、來源與狀態(FieldSourceChip),待補集中在頂部;AI 建議(有人工版本後的
// suggest_field_update)以套用／拒絕呈現並留 agent_actions 紀錄。
// 樂觀併發:base 版本≠目前版本(PD001／PD002)→ 明確提示重新載入,不默默覆蓋。
// 簽後更正=人明確按「建立更正版本」→ 存檔開新版回草稿,舊簽署綁舊版(卡上明示)。
// 唯讀視角(監造／機關):同一份欄位與來源、只有文字沒有 input(e2e 契約),監造在已提送時可收件／退回。
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Empty, PageHeader, SkeletonList, Input, Badge, ErrorBanner } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { previousLog, copyableFromLog, frequentItems } from '../../lib/siteLogHelpers.js'
import { taipeiToday, taipeiDateTime } from '../../lib/dates.js'
import { billableLeaves } from '../../lib/boqCalc.js'
import { useUnsavedEdit } from '../../lib/unsavedEdits.js'
import {
  emptyDailyLogContent, emptyDailyLogSources, contentFromLegacyLog, requiredKeysFor, unmetFields, fieldLabel, fieldAnchorId,
  addItemRow, applySuggestion, mergeAttachments, attachmentIssues, fieldDocErrorGuidance, docStatusMeta, DOC_STATUS_LABEL,
} from '../../lib/fieldDocs.js'
import { stampFormTemplate } from '../../lib/officialForms.js'
import useDailyLogFacts from '../../lib/useDailyLogFacts.js'
import DocumentPhotos from '../../components/sitelog/DocumentPhotos.jsx'
import DocumentLifecycle from '../../components/sitelog/DocumentLifecycle.jsx'
import IntakeUploader from '../../components/sitelog/IntakeUploader.jsx'
import WeatherPull from '../../components/sitelog/WeatherPull.jsx'
import SiteLogOfficialSheet from '../../components/SiteLogOfficialSheet.jsx'

const validDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null)
const EDITABLE_STATUSES = ['draft', 'pending_input', 'in_review', 'returned']

export default function SiteLog() {
  const {
    project, workItems, adjustedItems, siteLogs, can, currentUser, demoMode,
    fieldDocuments: fieldDocState, fieldDocsLoading, reloadFieldDocs, findActiveDailyLogDoc, createDailyLogDraft, getFieldDocument, saveFieldDocumentVersion,
    signFieldDocument, submitFieldDocument, receiveFieldDocument, returnFieldDocument, listPhotosByIds, listSitePhotos,
    agentActions, resolveAgentAction,
  } = useStore()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { state: navState } = useLocation()
  const docParam = params.get('doc')
  const [date, setDate] = useState(() => validDate(params.get('d')) || taipeiToday())
  const org = currentUser?.org_type || 'contractor'
  const editable = !!can.edit
  const fieldDocuments = useMemo(() => fieldDocState?.documents || [], [fieldDocState]) // { documents, submissions } 與今日工作球權同一份(P5a)

  // 該日的活文件與事實列(daily_logs:已簽署或既有未簽署)
  const doc = findActiveDailyLogDoc(date)
  const legacyLog = useMemo(() => siteLogs.find((l) => l.log_date === date) || null, [siteLogs, date])
  // ?doc=<id> 直達:文件載到後把日期切過去(只切一次)
  useEffect(() => {
    if (!docParam) return
    const d = fieldDocuments.find((x) => x.id === docParam)
    if (d && d.doc_date !== date) setDate(d.doc_date)
  }, [docParam, fieldDocuments]) // eslint-disable-line react-hooks/exhaustive-deps

  const { leaves, byKey, byId } = useMemo(() => {
    if (!workItems) return { leaves: [], byKey: new Map(), byId: new Map() }
    return {
      leaves: billableLeaves(adjustedItems),
      byKey: new Map(adjustedItems.map((it) => [it.item_key, it])),
      byId: new Map(adjustedItems.filter((it) => it.id).map((it) => [it.id, it])),
    }
  }, [workItems, adjustedItems])

  // 文件脈絡(版本、簽署、提送)與表單
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [form, setForm] = useState(null) // { content, sources }
  const [attachments, setAttachments] = useState([])
  const [photosById, setPhotosById] = useState(new Map())
  const [legacyPhotos, setLegacyPhotos] = useState([])
  const [baseVersion, setBaseVersion] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [amendMode, setAmendMode] = useState(false) // 已簽署／提送文件人按「建立更正版本」後才可編
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [savedMsg, setSavedMsgRaw] = useState(null)
  const setSavedMsg = (text, tone = 'error') => setSavedMsgRaw(text ? { text, tone } : null)
  const [conflict, setConflict] = useState(null) // PD001／PD002:伺服器版本已前進
  const [busy, setBusy] = useState(null)
  const [lifecycleMsg, setLifecycleMsgRaw] = useState(null)
  const setLifecycleMsg = (text, tone = 'error') => setLifecycleMsgRaw(text ? { text, tone } : null)
  const [appliedSuggestions, setAppliedSuggestions] = useState([])
  useUnsavedEdit('site-log', dirty ? `施工日誌 ${date}（未存檔）` : null)
  // 表頭的確定性事實(工期／進度):與列印／PDF 同一支,算不出來紙上標待補(C 包)
  const facts = useDailyLogFacts(date)

  // 載入:切日期一律整包載;同日期下文件變動(存檔後、起稿後)只在 !dirty 時同步,dirty 時絕不覆寫輸入
  const prevKeyRef = useRef(null)
  const loadKey = `${date}|${doc?.id || ''}|${doc?.current_version_no ?? ''}|${doc?.status || ''}|${legacyLog?.id || ''}`
  useEffect(() => {
    const dateChanged = prevKeyRef.current?.split('|')[0] !== date
    if (!dateChanged && dirty && prevKeyRef.current === loadKey) return
    if (!dateChanged && dirty) return // 有未存檔編輯:不覆寫(伺服器變動由存檔時的 PD001 揭露)
    prevKeyRef.current = loadKey
    let active = true
    ;(async () => {
      setDetailLoading(true)
      let nextForm, nextAttachments = [], nextDetail = null
      if (doc) {
        nextDetail = await getFieldDocument(doc.id)
        const v = nextDetail?.version
        nextForm = v ? { content: v.content || emptyDailyLogContent(date), sources: v.field_sources || {} } : { content: emptyDailyLogContent(date), sources: emptyDailyLogSources(emptyDailyLogContent(date)) }
        nextAttachments = Array.isArray(v?.attachments) ? v.attachments : []
      } else if (legacyLog) {
        nextForm = contentFromLegacyLog(legacyLog, byKey)
      } else {
        const content = emptyDailyLogContent(date)
        nextForm = { content, sources: emptyDailyLogSources(content) }
      }
      const [photoRows, legacyRows] = await Promise.all([
        listPhotosByIds(nextAttachments.map((a) => a.photo_id)),
        legacyLog?.id ? listSitePhotos(legacyLog.id) : Promise.resolve([]),
      ])
      if (!active) return
      setDetail(nextDetail); setForm(nextForm); setAttachments(nextAttachments)
      setPhotosById(new Map(photoRows.map((p) => [p.id, p]))); setLegacyPhotos(legacyRows)
      setBaseVersion(doc?.current_version_no ?? 0)
      setDirty(false); setAmendMode(false); setConflict(null); setAppliedSuggestions([])
      setDetailLoading(false)
    })()
    return () => { active = false }
  }, [loadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeDate = async (next) => {
    if (!next || next === date) return
    if (dirty && !(await appConfirm({ title: '切換日期將遺失未存檔內容', body: `${date} 的日誌尚未存檔，切到 ${next} 會遺失已填內容。`, danger: true, confirmLabel: '放棄並切換' }))) return
    setSavedAt(null); setSavedMsg(''); setLifecycleMsg('')
    setDate(next)
    setParams((p) => { const n = new URLSearchParams(p); n.set('d', next); n.delete('doc'); return n }, { replace: true, state: navState })
  }

  // 表單改動:值與來源一起走(lib/fieldDocs);已簽署／提送的文件要先按「建立更正版本」
  const status = doc?.status || null
  const formEditable = editable && form && (!doc || EDITABLE_STATUSES.includes(status) || amendMode) && status !== 'received'
  const onFormChange = useCallback((next) => { setForm(next); setDirty(true) }, [])
  const startAmend = async () => {
    if (!(await appConfirm({ title: '建立更正版本？', body: `版本 ${doc.current_version_no} 的簽署${status === 'submitted' ? '與提送' : ''}會保留並綁在該版本；更正內容存檔後成為新版本草稿，需重新簽署${status === 'submitted' ? '並重新提送' : ''}。`, confirmLabel: '建立更正版本' }))) return
    setAmendMode(true)
  }

  // 待補集中呈現:以伺服器 recheck 為準(存檔後),尚未存檔時用同一套規則預覽
  const serverRecheck = useMemo(() => (Array.isArray(doc?.recheck) ? doc.recheck : []), [doc?.recheck])
  const pendingKeys = useMemo(() => {
    if (!form) return []
    if (!dirty && doc && doc.current_version_no > 0) return serverRecheck.filter((r) => !String(r.key).startsWith('attachments')).map((r) => r.key)
    return unmetFields(requiredKeysFor(form.content, doc?.required_fields), form.sources).map((u) => u.key)
  }, [form, dirty, doc, serverRecheck])
  const issueMap = useMemo(() => new Map(pendingKeys.map((k) => [k, 'pending'])), [pendingKeys])
  const attachmentIssueMap = useMemo(() => attachmentIssues(serverRecheck), [serverRecheck])

  // 零輸入:複製昨日(來源標「沿用昨日、待核對」;工項只帶列骨架、數量待補)、帶入天氣(氣象署)
  const prevLog = useMemo(() => previousLog(siteLogs, date), [siteLogs, date])
  const freq = useMemo(() => frequentItems(siteLogs), [siteLogs])
  const copyYesterday = () => {
    const c = copyableFromLog(prevLog)
    if (!c || !form) return
    const src = { status: 'filled', source: `yesterday:${prevLog.id}`, reason: '沿用昨日,待核對' }
    let next = { content: { ...form.content, labor: c.labor, equipment: c.equipment, materials: c.materials, extras: { ...form.content.extras, ...c.extras } }, sources: { ...form.sources, labor: src, equipment: src, materials: src } }
    for (const key of Object.keys(c.items)) {
      const wi = byKey.get(key)
      if (wi) next = addItemRow(next, wi)
    }
    if (c.weather && !next.content.weather_am) { next.content = { ...next.content, weather_am: c.weather }; next.sources = { ...next.sources, weather_am: src } }
    if (c.weather_pm && !next.content.weather_pm) { next.content = { ...next.content, weather_pm: c.weather_pm }; next.sources = { ...next.sources, weather_pm: src } }
    onFormChange(next)
    setSavedMsg(`已帶入 ${c.from} 的班組/機具/材料與工項列表,數量請填今日實際值後存檔`, 'info')
  }
  // 帶入天氣(WeatherPull 共用元件):值與來源 cwa 一起寫進表單
  const applyWeather = (r) => {
    if (!form) return
    const src = { status: 'filled', source: 'cwa' }
    const content = { ...form.content, weather_am: r.am || form.content.weather_am, weather_pm: r.pm || form.content.weather_pm }
    const sources = { ...form.sources, ...(r.am ? { weather_am: src } : {}), ...(r.pm ? { weather_pm: src } : {}) }
    onFormChange({ content, sources })
  }

  // AI 建議(文件已有人工版本後,重新辨識只留建議):套用進表單(dirty)、存檔成功才標 accepted;拒絕即標 rejected
  const suggestions = useMemo(() => (agentActions || []).filter((a) => a.kind === 'suggest_field_update' && a.target_id === doc?.id && a.status === 'pending'), [agentActions, doc?.id])
  const applyOneSuggestion = (a) => {
    if (!form) return
    const { state, applied } = applySuggestion(form, a.evidence?.suggestion)
    if (a.evidence?.suggestion?.attachments) setAttachments((cur) => mergeAttachments(cur, a.evidence.suggestion.attachments))
    onFormChange(state)
    setAppliedSuggestions((ids) => [...ids, a.id])
    setSavedMsg(applied.length ? `已套用建議 ${applied.length} 項(${applied.slice(0, 4).map((k) => fieldLabel(k, state.content)).join('、')}${applied.length > 4 ? '…' : ''}),存檔後生效` : '建議沒有可補入的欄位(現有值不覆蓋)', 'info')
  }
  const rejectSuggestion = async (a) => {
    const r = await resolveAgentAction(a.id, 'rejected')
    if (r?.error) setSavedMsg(friendlyError(r.error, '建議未標記'))
  }

  // 存檔=伺服器保存版本(沒有文件先建草稿;既有未簽署日誌也在此時第一次變成文件)
  const onSave = async () => {
    if (!form) return
    setSaving(true); setSavedMsg(''); setConflict(null)
    let d = doc
    let base = baseVersion
    if (!d) {
      const r = await createDailyLogDraft(date)
      if (r.error) { setSaving(false); setSavedMsg(friendlyError(r.error, '無法建立日誌草稿')); return }
      d = r.doc; base = d.current_version_no
    }
    const note = amendMode ? '簽後更正' : legacyLog && base === 0 ? '由既有紀錄建立草稿' : null
    // 存檔時把「當時用的表單範本」寫進內容:簽署版本自己記得版面語意,日後改範本不動舊文件(C 包)
    const content = stampFormTemplate(form.content, 'daily_log')
    const r = await saveFieldDocumentVersion({ documentId: d.id, baseVersionNo: base, content, fieldSources: form.sources, attachments, changeNote: note })
    setSaving(false)
    if (r.error) {
      const g = fieldDocErrorGuidance(r.error)
      if (g.kind === 'reload') { setConflict(g.message); setSavedMsg('') } else setSavedMsg(friendlyError(r.error, '日誌存檔失敗'))
      return
    }
    for (const id of appliedSuggestions) await resolveAgentAction(id, 'accepted')
    setAppliedSuggestions([])
    setDirty(false); setAmendMode(false)
    setSavedAt(new Date())
    setBaseVersion(r.result.version_no)
    const pending = (r.result.recheck || []).length
    setSavedMsg(pending ? `已存檔 ✓ 版本 ${r.result.version_no}，尚有 ${pending} 項待補` : `已存檔 ✓ 版本 ${r.result.version_no}，可簽署`, 'success')
    if (!doc) reloadFieldDocs()
  }
  const reloadFromServer = () => { setDirty(false); setConflict(null); prevKeyRef.current = null; reloadFieldDocs() }

  // 簽署／提送／收件／退回
  const handleLifecycleError = (error, fallback) => {
    const g = fieldDocErrorGuidance(error)
    if (g.kind === 'reload') { setConflict(g.message); return }
    if (g.kind === 'pending') { setLifecycleMsg(`${g.message}:${g.details.map((u) => fieldLabel(u.key, form?.content)).join('、')}`); reloadFieldDocs(); return }
    if (g.kind === 'attachments') { setLifecycleMsg(g.message); reloadFieldDocs(); return }
    setLifecycleMsg(friendlyError(error, fallback))
  }
  const onSign = async (intent) => {
    setBusy('sign'); setLifecycleMsg('')
    const r = await signFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, contentHash: detail?.version?.content_hash, intent })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '簽署未完成'); return }
    setLifecycleMsg(`已簽署版本 ${r.result.version_no}（雜湊 ${String(r.result.content_hash).slice(0, 12)}），施工日誌已正式落庫；可提送給監造。`, 'success')
  }
  const onSubmit = async () => {
    setBusy('submit'); setLifecycleMsg('')
    const r = await submitFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, docType: 'daily_log' })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '提送未完成'); return }
    setLifecycleMsg(`${r.receipt.idempotent ? '這筆已提送過，沿用原回執：' : ''}已提送給監造（${taipeiDateTime(r.receipt.created_at)}，回執 ${String(r.receipt.submission_id).slice(0, 8)}）；等待監造收件。`, 'success')
  }
  const onReceive = async () => {
    setBusy('receive'); setLifecycleMsg('')
    const r = await receiveFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '收件未完成'); return }
    setLifecycleMsg(`已收件（${taipeiDateTime(r.receipt.created_at)}）。`, 'success')
  }
  const onReturn = async (reason) => {
    setBusy('return'); setLifecycleMsg('')
    const r = await returnFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, reason })
    setBusy(null)
    if (r.error) { handleLifecycleError(r.error, '退回未完成'); return }
    setLifecycleMsg(`已退回，原因已留存；廠商補正並重新簽署後會再送。`, 'success')
  }

  // 附件
  const toggleRole = (photoId, role) => { setAttachments((cur) => cur.map((a) => (a.photo_id === photoId ? { ...a, role } : a))); setDirty(true) }
  const removeAttachment = (photoId) => { setAttachments((cur) => cur.filter((a) => a.photo_id !== photoId)); setDirty(true) }
  const addLegacy = (p) => {
    setAttachments((cur) => mergeAttachments(cur, [{ photo_id: p.id, storage_path: p.storage_path, role: 'evidence' }]))
    setPhotosById((m) => new Map(m).set(p.id, p)); setDirty(true)
  }

  // 右欄清單:文件 ∪ 事實列的日期(去重、新→舊)
  const dateRows = useMemo(() => {
    const m = new Map()
    for (const l of siteLogs) m.set(l.log_date, { date: l.log_date, log: l, doc: null })
    for (const d of fieldDocuments) {
      if (d.doc_type !== 'daily_log' || d.status === 'discarded' || d.status === 'superseded') continue
      m.set(d.doc_date, { ...(m.get(d.doc_date) || { date: d.doc_date, log: null }), doc: d })
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [siteLogs, fieldDocuments])

  const header = <PageHeader title="施工日誌" tagline="每日紀錄・審核・簽署・提送" subtitle="照片上傳後由系統擬稿，逐欄核對來源與待補，簽署後正式落庫並提送監造" />
  if (!workItems || !form) {
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
        : legacyLog ? { text: '既有紀錄・未簽署、待核對', cls: 'bg-[var(--amber-tint)] text-[var(--amber-text)]' }
          : { text: '本日尚無日誌', cls: 'bg-[var(--surface-2)] text-[var(--text-2)]' }
  const readOnlyNote = !editable
  // C 包:畫面上的表單就是紙本本身。可編視角在原表格子裡直接編(哪一格可編由 lib/officialForms 的 mapping 決定),
  // 唯讀視角(監造／機關)同一張紙、同一份來源章,只是不長 input。
  const sheetEdit = {
    org, editable: !!formEditable, onChange: onFormChange, state: form, issues: issueMap,
    photosById, leaves, byId, freq: formEditable ? freq : null,
  }

  return (
    <div className="space-y-5">
      <div>{header}</div>
      {/* 兩欄都 min-w-0:grid item 預設 min-width:auto,工項表(min-w 520)的橫向捲動容器才會在 375 內自己捲,
          不會把整頁撐出水平溢位(舊頁在 demo 沒有工項列所以沒踩到;真後端有工項時撐出 375) */}
      <div className="grid xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5 min-w-0">
          <Card title="本日日誌">
            {readOnlyNote && (
              <div className="mb-3 text-xs text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
                {can.oversee ? '機關監督檢視' : '監造檢視'}：施工日誌由施工廠商填報與簽署，此頁為<b>唯讀</b>，可切換日期檢視；{org === 'supervisor' ? '廠商提送後可在下方收件或退回。' : '提送對象為監造。'}
              </div>
            )}
            {/* 卡頭:日期＋保存狀態章＋帶入動作 */}
            <div className="flex items-end gap-3 flex-wrap mb-3">
              <div className="max-md:w-full"><Field label="日期"><Input type="date" value={date} onChange={(e) => changeDate(e.target.value)} /></Field></div>
              <span role="status" aria-label={`保存狀態：${saveStatus.text}`} className={`inline-flex items-center h-8 mb-0.5 px-2.5 rounded-lg text-footnote font-medium ${saveStatus.cls}`}>{saveStatus.text}</span>
              {doc && <Badge color={docStatusMeta(doc, org).tone}>{DOC_STATUS_LABEL[doc.status] || doc.status}</Badge>}
              {formEditable && <WeatherPull date={date} onApply={applyWeather} onMessage={setSavedMsg} />}
              {formEditable && !legacyLog && prevLog && !(form.content.labor?.length) && (
                <Button variant="secondary" onClick={copyYesterday} title={`帶入 ${prevLog.log_date} 的班組/機具/材料`}>
                  <MSym name="library_add" size={14} />複製昨日
                </Button>
              )}
            </div>

            {/* 樂觀併發:伺服器版本已前進(別人或 AI 起稿加了版本)→ 明講、由人決定重新載入,不默默覆蓋 */}
            {conflict && (
              <div role="alert" className="mb-3 rounded-lg bg-[var(--red-tint)] p-3 text-footnote">
                <div className="font-medium text-[var(--red-text)]">{conflict}</div>
                <div className="text-[var(--text-2)] mt-1">重新載入會以伺服器最新版本取代畫面上未存檔的內容。</div>
                <Button variant="secondary" size="sm" className="mt-2" onClick={reloadFromServer}>重新載入最新版本</Button>
              </div>
            )}
            {!legacyLog && !doc && !dirty && editable && (
              <p className="mb-3 text-footnote text-[var(--text-2)]">本日尚無日誌。上傳現場照片會自動擬稿；也可直接填寫後存檔。</p>
            )}
            {legacyLog && !doc && (
              <p className="mb-3 text-footnote text-[var(--amber-text)]">此日有既有紀錄（舊流程寫入、未簽署）；以下欄位已帶入該紀錄，來源標「既有紀錄、待核對」。核對後存檔會建立文件草稿，簽署後才是正式紀錄。</p>
            )}
            {editable && doc && ['signed', 'submitted'].includes(status) && !amendMode && (
              <div className="mb-3 flex items-center gap-2 flex-wrap text-footnote text-[var(--text-2)]">
                <span>版本 {doc.current_version_no} 已簽署{status === 'submitted' ? '並提送' : ''}，內容已鎖定。</span>
                <Button variant="secondary" size="sm" onClick={startAmend}>建立更正版本</Button>
              </div>
            )}
            {doc && status === 'received' && <p className="mb-3 text-footnote text-[var(--text-2)]">監造已收件，本文件不可再修改。</p>}
            {!leaves.length && editable && <p className="mb-3 text-footnote text-[var(--text-3)]">本案尚未匯入標單：工項數量無法在此回報，照片會保存並列「待配對」，匯入標單後可重新辨識配對。</p>}

            {(!doc && !legacyLog && readOnlyNote) ? (
              <Empty>此日期尚無日誌。施工日誌由施工廠商填報。</Empty>
            ) : (
              <div className="overflow-x-auto -mx-2 px-2">
                <SiteLogOfficialSheet project={project} content={form.content} sources={form.sources} docDate={date}
                  siteLogs={siteLogs} itemList={adjustedItems} facts={facts} edit={sheetEdit} titleAs="h2" className="min-w-[680px] !p-4 !shadow-none" />
              </div>
            )}

            {/* 文件狀態、簽署、提送、收件／退回與歷史 */}
            {doc && !detailLoading && (
              <div className="mt-5">
                <DocumentLifecycle doc={doc} version={detail?.version} signatures={detail?.signatures || []} submissions={detail?.submissions || []}
                  viewerOrg={org} canAct={org === 'supervisor' ? !!can.approve : editable} dirty={dirty} content={form.content}
                  busy={busy} onSign={onSign} onSubmit={onSubmit} onReceive={onReceive} onReturn={onReturn}
                  message={lifecycleMsg} />
              </div>
            )}
            {doc && detailLoading && <div className="mt-5" aria-busy="true"><SkeletonList rows={2} label="載入文件狀態…" /></div>}
            {demoMode && editable && doc && (
              <p className="mt-2 text-caption text-[var(--text-3)]">示範模式：草稿只存在本次瀏覽；簽署與提送需正式專案。</p>
            )}

            {/* 貼底存檔列(手機讓開底部導覽;桌機也 sticky) */}
            <div className={`flex items-center gap-3 mt-4 flex-wrap${editable ? ' sticky max-md:bottom-[var(--bottom-nav-h)] md:bottom-0 z-10 bg-[var(--surface)] border-t border-[var(--border-2)] -mx-5 px-5 py-2.5' : ''}`}>
              {editable ? (
                <Button onClick={onSave} busy={saving} disabled={!formEditable}>存檔</Button>
              ) : (
                <span className="text-xs text-[var(--text-3)]">{can.oversee ? '機關監督檢視' : '監造檢視'}：施工日誌由施工廠商填報，此頁為唯讀。</span>
              )}
              {/* 列印:有文件印簽署版本(未簽署則最新存檔版本並標草稿・未簽署);只有既有紀錄時印該列並標未簽署 */}
              {((doc && doc.current_version_no > 0) || legacyLog) && (
                <Button variant="secondary" onClick={async () => {
                  if (dirty && !(await appConfirm({ title: '離開將遺失未存檔內容', body: `${date} 的日誌尚未存檔；列印頁印的是已簽署版本（未簽署則為最新存檔版本並標示草稿）。要放棄未存檔內容並前往列印嗎？`, danger: true, confirmLabel: '放棄並前往' }))) return
                  navigate(doc ? `/site-log/print?doc=${encodeURIComponent(doc.id)}` : `/site-log/print?d=${date}`)
                }}>
                  <MSym name="print" size={15} />列印公定格式日誌
                </Button>
              )}
              {savedMsg && <span className={`text-sm ${savedMsg.tone === 'success' ? 'text-[var(--green-text)]' : savedMsg.tone === 'info' ? 'text-[var(--blue-text)]' : 'text-[var(--red-text)]'}`}>{savedMsg.text}</span>}
            </div>
          </Card>
        </div>

        {/* 右欄:照片與待補提示(C 包:桌面左側以表單為主,提示與照片靠右,不在表單上鋪滿工具卡) */}
        <div className="space-y-5 min-w-0">
          {/* 待補集中呈現(伺服器 recheck 為準;未存檔時同規則預覽),點一項捲到紙上那一格 */}
          {pendingKeys.length > 0 && (formEditable || !editable) && (
            <Card title={`待補 ${pendingKeys.length} 項`}>
              <p className="text-footnote text-[var(--amber-text)]">{formEditable ? '補齊並存檔後才能簽署；點一項會捲到表單上那一格。' : '這份文件尚有待補欄位。'}</p>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-footnote">
                {pendingKeys.map((k) => (
                  <li key={k}><button type="button" onClick={() => {
                    const el = document.getElementById(fieldAnchorId(k))
                    el?.scrollIntoView?.({ block: 'center' })
                    el?.querySelector?.('input, select, textarea')?.focus?.()
                  }} className="text-[var(--blue-text)] hover:underline min-h-11 md:min-h-0">{fieldLabel(k, form.content)}</button></li>
                ))}
              </ul>
            </Card>
          )}

          {suggestions.length > 0 && formEditable && (
            <Card title="AI 建議">
              <div className="space-y-2">
                <div className="flex items-center gap-1 text-caption font-medium text-[var(--ai-text)]"><MSym name="auto_awesome" size={14} className="text-[var(--ai)]" />文件已有人工版本，新辨識結果不自動套用</div>
                {suggestions.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 flex-wrap text-footnote">
                    <span className="min-w-0 flex-1 text-[var(--text)]">{a.summary}</span>
                    <Button size="sm" variant="secondary" onClick={() => applyOneSuggestion(a)} disabled={appliedSuggestions.includes(a.id)}>{appliedSuggestions.includes(a.id) ? '已套用' : '套用建議'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => rejectSuggestion(a)}>拒絕</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {(doc || legacyLog || editable) && (
            <Card title="現場照片">
              <DocumentPhotos attachments={attachments} photosById={photosById} legacyPhotos={legacyPhotos} editable={!!formEditable} byId={byId}
                issues={attachmentIssueMap} onToggleRole={toggleRole} onRemove={removeAttachment} onAddLegacy={addLegacy}
                uploader={formEditable ? (dirty
                  ? <p className="text-footnote text-[var(--text-3)]">先存檔目前的修改，再上傳照片（辨識結果會以新版本或建議帶入）。</p>
                  : <IntakeUploader fixedDate={date} compact onDrafted={() => { reloadFieldDocs(); prevKeyRef.current = null }} />) : null} />
            </Card>
          )}

        <Card title={`施工日誌（${dateRows.length}）`} className="min-w-0" action={fieldDocsLoading ? <span className="text-caption text-[var(--text-3)]">同步中…</span> : null}>
          {dateRows.length === 0 ? <Empty>尚無日誌</Empty> : (
            <div className="space-y-1.5">
              {dateRows.map((r) => {
                const meta = r.doc ? docStatusMeta(r.doc, org) : { label: r.log?.status === '已簽署' ? '已簽署' : '既有紀錄', tone: r.log?.status === '已簽署' ? 'green' : 'amber' }
                return (
                  <div key={r.date} className={`px-3 py-2 rounded-lg text-sm border transition-colors ${r.date === date ? 'bg-[var(--blue-tint)] border-[var(--blue)]' : 'border-[var(--border)] hover:bg-[var(--surface-2)]'}`}>
                    <div className="flex justify-between items-center gap-2">
                      <button onClick={() => changeDate(r.date)} className="font-medium text-[var(--text)] num text-left flex-1 truncate max-md:min-h-11">{r.date}</button>
                      <Badge color={meta.tone}>{meta.label}</Badge>
                    </div>
                    {(r.log?.work_summary) && <div className="text-xs text-[var(--text-2)] truncate mt-0.5">{r.log.work_summary}</div>}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
        </div>
      </div>

      {editable && (
        <p className="text-xs text-[var(--text-3)]">
          一天一份文件：存檔＝伺服器保存版本並列出待補；簽署（登入的平台帳號）後施工日誌才正式落庫並可提送監造；簽後更正另開版本重簽。估驗帶入的累計數量只計已落庫（已簽署或既有）的日誌。
        </p>
      )}
      <ErrorBanner msg={null} />
    </div>
  )
}
