// Field-docs slice(P2c;D-026 第一條完整路徑):上傳批次(photo_intakes／photos)、起稿 Edge、
// 現場文書(field_documents 家族)的載入與五支 RPC。這是施工日誌**唯一**的寫入路徑——
// 事實表 daily_logs／daily_log_items 只由 sign_field_document 在簽署交易內落庫,前端不再直接
// upsert(舊 saveSiteLog 已移除;既有未簽署日誌開啟時以其內容建立文件草稿,見 lib/fieldDocs.js)。
//
// 寫入邊界(設計 field-documents-lifecycle §2.2):
//   * 客戶端直接 INSERT 只有三處:photo_intakes(id/project_id/log_date)、photos(既有欄＋intake_id／
//     content_sha256)、field_documents 草稿(id/project_id/doc_type/doc_date);UPDATE 只有 photo_intakes
//     的 log_date／status=discarded／candidates.excluded。其餘一律 RPC,RLS／guard 是安全邊界。
//   * 「已保存」=伺服器有列;本機的檔案狀態只在頁面 reducer(lib/fieldDocs.js),不做離線同步。
//   * 起稿由 Edge draft-field-documents 服務端執行(過 AI 閘門、記用量);remaining>0 就再呼叫續跑。
// demo 模式(未設 Supabase):文件草稿只進記憶體、可存版本;簽署／提送／上傳一律明確回「示範模式
// 無法…」,不假裝已簽署(不會有雜湊、簽署者與伺服器時間可核對)。
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { supabase, SIGNED_URL_TTL_S } from '../../lib/supabase.js'
import { loadSiteLogsFromDB, loadFieldDocumentsFromDB, FIELD_DOCUMENT_COLUMNS, FIELD_DOCUMENT_SUBMISSION_COLUMNS } from '../db.js'
import { pageAll, pageAllInSafe, chunked } from '../../lib/pagedQuery.js'
import { compressImage } from '../../lib/imageCompress.js'
import { readPhotoExif } from '../../lib/exifRead.js'
import { extractInvokeError } from './agent.js'
import {
  requiredKeysFor, unmetFields, sha256Hex, submissionRequestId, clearSubmissionRequestId,
  contentFromAgentDraft, TO_ORG_BY_DOC_TYPE,
} from '../../lib/fieldDocs.js'

const DOC_COLS = FIELD_DOCUMENT_COLUMNS
const INTAKE_COLS = 'id, project_id, created_by, uploader_org, log_date, status, photo_count, recognized_count, failed_count, candidates, run_started_at, last_progress_at, attempts, error_summary, created_at, updated_at'
const PHOTO_COLS = 'id, project_id, daily_log_id, work_item_id, storage_path, caption, location, taken_at, gps_lat, gps_lng, uploaded_by, uploader_org, intake_id, content_sha256, ai_status, ai_result, ai_run_at, work_item_hint, ai_source, created_at'
const VERSION_COLS = 'id, document_id, version_no, author_kind, created_by, content, field_sources, attachments, content_hash, change_note, amended_from_version, created_at'
// 續跑上限:Edge 每次 100 s 預算、每批最多幾百張,超過這個次數還沒完就是伺服器出狀況
const MAX_DRAFT_ROUNDS = 12
const DEMO_ERROR = { code: 'demo', message: '示範模式無法簽署／提送：正式專案需以平台帳號完成兩步驟驗證後簽署,才會有可核對的版本雜湊與簽署紀錄。' }
const DEMO_UPLOAD_ERROR = { code: 'demo', message: '示範模式不支援照片上傳(需正式專案)' }

// 私有 bucket → 批次簽名 URL(與 site.js listSitePhotos 同一套)
async function withSignedUrls(rows) {
  if (!rows?.length) return []
  const urlByPath = new Map()
  for (const batch of chunked(rows.map((p) => p.storage_path))) {
    const { data: signed } = await supabase.storage.from('photos').createSignedUrls(batch, SIGNED_URL_TTL_S)
    for (const s of signed || []) urlByPath.set(s.path, s.signedUrl)
  }
  return rows.map((p) => ({ ...p, url: urlByPath.get(p.storage_path) || null }))
}

// RPC 錯誤原樣帶 code／details／hint 回呼叫端(lib/fieldDocs.fieldDocErrorGuidance 分流)
const rpcError = (error) => ({ code: error?.code || null, message: error?.message || '操作未完成', details: error?.details || null, hint: error?.hint || null })

export function useFieldDocsSlice({ demoMode, dbMode, isPersistedProject, currentProject, currentUser, wiMaps }, { setSiteLogs } = {}) {
  // { documents, submissions }:與 P5a 今日工作球權(useTodayTasks)同一份;documents 只含未終態
  const [docState, setDocState] = useState({ documents: [], submissions: [] })
  const setFieldDocuments = useCallback((fn) => setDocState((st) => ({ ...st, documents: typeof fn === 'function' ? fn(st.documents) : fn })), [])
  const [intakes, setIntakes] = useState([])
  const [fieldDocsLoading, setFieldDocsLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // demo:記憶體文件庫 { [id]: { doc, versions: [] } }。ref 與 state 同步寫:建草稿後緊接著存版本時,
  // 呼叫端拿到的仍是舊 closure 的 state,讀 ref 才看得到剛建的文件(否則回「找不到文件」)。
  const [demoDocs, setDemoDocsState] = useState({})
  const demoDocsRef = useRef(demoDocs)
  const setDemoDocs = useCallback((fn) => {
    const next = typeof fn === 'function' ? fn(demoDocsRef.current) : fn
    demoDocsRef.current = next
    setDemoDocsState(next)
  }, [])
  const pid = currentProject?.project_id
  const uid = currentUser?.user_id

  const reloadFieldDocs = useCallback(() => setReloadKey((k) => k + 1), [])

  // 真專案:文件(全案)與我的上傳批次(未捨棄)一起載;不依賴標單(未匯標單也要能收照片,設計 §3.5)
  useEffect(() => {
    if (!isPersistedProject || !pid || !uid) { setDocState({ documents: [], submissions: [] }); setIntakes([]); return }
    let active = true
    setFieldDocsLoading(true)
    ;(async () => {
      try {
        const [docs, intakeRows] = await Promise.all([
          loadFieldDocumentsFromDB(pid),
          pageAll((from, to) => supabase.from('photo_intakes').select(INTAKE_COLS)
            .eq('project_id', pid).eq('created_by', uid).neq('status', 'discarded')
            .order('created_at', { ascending: false }).order('id').range(from, to), '上傳批次'),
        ])
        // 每批照片的伺服器狀態計數(恢復畫面用):photos 只取 intake_id／ai_status
        const stats = new Map()
        if (intakeRows?.length) {
          const { data } = await pageAllInSafe(intakeRows.map((i) => i.id), (chunk, from, to) => supabase.from('photos')
            .select('intake_id, ai_status').eq('project_id', pid).in('intake_id', chunk).order('id').range(from, to))
          for (const p of data || []) {
            const s = stats.get(p.intake_id) || { total: 0 }
            s.total += 1
            s[p.ai_status || 'pending'] = (s[p.ai_status || 'pending'] || 0) + 1
            stats.set(p.intake_id, s)
          }
        }
        if (!active) return
        setDocState(docs)
        setIntakes((intakeRows || []).map((i) => ({ ...i, photoStats: stats.get(i.id) || { total: 0 } })))
      } catch (e) {
        if (active) console.warn('現場文書載入失敗:', e?.message)
      } finally {
        if (active) setFieldDocsLoading(false)
      }
    })()
    return () => { active = false }
  }, [isPersistedProject, pid, uid, reloadKey])

  const demoDocList = useMemo(() => Object.values(demoDocs).map((d) => d.doc), [demoDocs])
  const allDocuments = demoMode ? demoDocList : docState.documents
  const fieldDocuments = useMemo(() => (demoMode ? { documents: demoDocList, submissions: [] } : docState), [demoMode, demoDocList, docState])

  // ── 上傳批次 ──────────────────────────────────────────────────────────────
  const createIntake = useCallback(async ({ log_date = null } = {}) => {
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    const id = crypto.randomUUID()
    const { data, error } = await supabase.from('photo_intakes').insert({ id, project_id: pid, log_date: log_date || null }).select(INTAKE_COLS).single()
    if (error) return { error }
    return { error: null, intake: { ...data, photoStats: { total: 0 } } }
  }, [isPersistedProject, pid])

  // 本案已有同內容的照片 → 不重複上傳(回既有照片列;同批同雜湊由 reducer 先擋)
  const findExistingPhotosBySha = useCallback(async (shas) => {
    if (!isPersistedProject || !shas?.length) return new Map()
    const { data } = await pageAllInSafe([...new Set(shas)], (chunk, from, to) => supabase.from('photos')
      .select('id, intake_id, content_sha256, created_at').eq('project_id', pid).in('content_sha256', chunk).order('created_at').range(from, to))
    const m = new Map()
    for (const p of data || []) if (!m.has(p.content_sha256)) m.set(p.content_sha256, p)
    return m
  }, [isPersistedProject, pid])

  // 一張照片:壓縮 → Storage(<project>/intake/<intake>/<photo>.<ext>)→ photos 列(intake_id＋雜湊)。
  // 只有 photos 列寫成功才算「已保存」;Storage 成功但列失敗會清掉孤兒檔並回錯(仍在本機)。
  const uploadIntakePhoto = useCallback(async (intakeId, file, { sha256 = null } = {}) => {
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    const id = crypto.randomUUID()
    const exif = await readPhotoExif(file)
    const compressed = await compressImage(file)
    const ext = (compressed.name?.split('.').pop() || compressed.type?.split('/')[1] || 'jpg').toLowerCase()
    const path = `${pid}/intake/${intakeId}/${id}.${ext}`
    const { error: upErr } = await supabase.storage.from('photos').upload(path, compressed, { contentType: compressed.type || 'image/jpeg', upsert: false })
    if (upErr) return { error: upErr }
    const { error: insErr } = await supabase.from('photos').insert({
      id, project_id: pid, daily_log_id: null, work_item_id: null, storage_path: path, caption: null, location: null,
      intake_id: intakeId, content_sha256: sha256,
      taken_at: exif.takenAt || new Date().toISOString(), gps_lat: exif.gpsLat, gps_lng: exif.gpsLng,
      uploaded_by: uid,
    })
    if (insErr) { await supabase.storage.from('photos').remove([path]); return { error: insErr } }
    return { error: null, id, storage_path: path }
  }, [isPersistedProject, pid, uid])

  // 起稿:呼叫 Edge 直到 remaining=0。409 run_conflict=別的請求在跑(回給頁面改成輪詢);
  // 其他錯誤回 { error, code } 由頁面如實顯示。每輪的結果透過 onProgress 給頁面。
  const draftFromIntake = useCallback(async (intakeId, { onProgress } = {}) => {
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    let last = null
    for (let round = 0; round < MAX_DRAFT_ROUNDS; round++) {
      const { data, error } = await supabase.functions.invoke('draft-field-documents', { body: { project_id: pid, intake_id: intakeId } })
      if (error || !data || data.error) {
        let code = data?.code || null
        let body = data
        if (error) {
          try { body = await error.context?.clone?.()?.json?.() } catch { body = null }
          code = body?.code || code
        }
        const message = await extractInvokeError(error, data, '起稿服務暫時無法使用')
        reloadFieldDocs()
        return { error: { message, code }, intake: body?.intake || null, photos: body?.photos || null }
      }
      last = data
      onProgress?.(data)
      if (!data.remaining) break
    }
    reloadFieldDocs()
    return { error: null, result: last }
  }, [isPersistedProject, pid, reloadFieldDocs])

  const updateIntakeDate = useCallback(async (intakeId, date) => {
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    const { data, error } = await supabase.from('photo_intakes').update({ log_date: date || null }).eq('id', intakeId).select('id')
    if (error) return { error }
    if (!data?.length) return { error: { message: '批次日期未更新:可能無權限或批次已捨棄' } }
    setIntakes((rows) => rows.map((i) => (i.id === intakeId ? { ...i, log_date: date || null } : i)))
    return { error: null }
  }, [isPersistedProject])

  // 使用者只能切換 excluded;整份 candidates 送回,guard 逐項比對其餘欄位
  const setIntakeCandidates = useCallback(async (intakeId, candidates) => {
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    const { data, error } = await supabase.from('photo_intakes').update({ candidates }).eq('id', intakeId).select('id')
    if (error) return { error }
    if (!data?.length) return { error: { message: '候選未更新:可能無權限或批次已捨棄' } }
    setIntakes((rows) => rows.map((i) => (i.id === intakeId ? { ...i, candidates } : i)))
    return { error: null }
  }, [isPersistedProject])

  const discardIntake = useCallback(async (intakeId) => {
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    const { data, error } = await supabase.from('photo_intakes').update({ status: 'discarded' }).eq('id', intakeId).select('id')
    if (error) return { error }
    if (!data?.length) return { error: { message: '批次未捨棄:可能無權限' } }
    setIntakes((rows) => rows.filter((i) => i.id !== intakeId))
    return { error: null }
  }, [isPersistedProject])

  const listIntakePhotos = useCallback(async (intakeId) => {
    if (!isPersistedProject || !intakeId) return []
    const { data } = await supabase.from('photos').select(PHOTO_COLS).eq('project_id', pid).eq('intake_id', intakeId).order('created_at').order('id')
    return withSignedUrls(data || [])
  }, [isPersistedProject, pid])

  const listPhotosByIds = useCallback(async (ids) => {
    if (!isPersistedProject || !ids?.length) return []
    const { data } = await pageAllInSafe([...new Set(ids)], (chunk, from, to) => supabase.from('photos')
      .select(PHOTO_COLS).eq('project_id', pid).in('id', chunk).order('created_at').order('id').range(from, to))
    return withSignedUrls(data || [])
  }, [isPersistedProject, pid])

  // ── 文件本體 ──────────────────────────────────────────────────────────────
  // 一份文件的完整脈絡:文件列、最新版本、版本清單(不含 content)、簽署、提送歷史
  const getFieldDocument = useCallback(async (docId) => {
    if (!docId) return null
    if (demoMode) {
      const d = demoDocsRef.current[docId]
      if (!d) return null
      const versions = d.versions
      return {
        doc: d.doc, version: versions[versions.length - 1] || null,
        versions: versions.map((v) => ({ id: v.id, document_id: v.document_id, version_no: v.version_no, author_kind: v.author_kind, created_by: v.created_by, content_hash: v.content_hash, change_note: v.change_note, amended_from_version: v.amended_from_version, created_at: v.created_at })),
        signatures: [], submissions: [],
      }
    }
    const [{ data: doc, error: docErr }, { data: versions }, { data: latest }, { data: signatures }, { data: submissions }] = await Promise.all([
      supabase.from('field_documents').select(DOC_COLS).eq('id', docId).maybeSingle(),
      supabase.from('field_document_versions').select('id, document_id, version_no, author_kind, created_by, content_hash, change_note, amended_from_version, created_at')
        .eq('document_id', docId).order('version_no', { ascending: false }).limit(50),
      supabase.from('field_document_versions').select(VERSION_COLS).eq('document_id', docId).order('version_no', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('field_document_signatures').select('id, document_id, version_no, content_hash, signer_id, signer_org, signer_name_snapshot, signed_at, intent, method, aal')
        .eq('document_id', docId).order('signed_at', { ascending: false }).limit(50),
      supabase.from('field_document_submissions').select(FIELD_DOCUMENT_SUBMISSION_COLUMNS)
        .eq('document_id', docId).order('created_at', { ascending: false }).limit(100),
    ])
    if (docErr || !doc) return null
    return { doc, version: latest || null, versions: versions || [], signatures: signatures || [], submissions: submissions || [] }
  }, [demoMode])

  // 該日的活文件(discarded／superseded 不算)
  const findActiveDailyLogDoc = useCallback((date) =>
    allDocuments.find((d) => d.doc_type === 'daily_log' && d.doc_date === date && d.status !== 'discarded' && d.status !== 'superseded') || null,
  [allDocuments])

  // 建草稿(客戶端 INSERT 六欄之內;intake_id 不填——起稿冪等鍵由 Edge 寫,客戶端寫不出 target_key)。
  // 同日活文件撞唯一索引(23505)→ 重載後改用既有文件,不重複建件。
  const createDailyLogDraft = useCallback(async (date) => {
    if (demoMode) {
      const id = `FD-DEMO-${Object.keys(demoDocsRef.current).length + 1}-${Date.now().toString(36)}`
      const doc = { id, project_id: pid || 'demo', doc_type: 'daily_log', owner_org: 'contractor', target_table: 'daily_logs', target_id: null, target_key: null, intake_id: null, doc_date: date, status: 'draft', current_version_no: 0, required_fields: [], recheck: [], created_by: uid || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      setDemoDocs((m) => ({ ...m, [id]: { doc, versions: [] } }))
      return { error: null, doc }
    }
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    const id = crypto.randomUUID()
    const { data, error } = await supabase.from('field_documents').insert({ id, project_id: pid, doc_type: 'daily_log', doc_date: date }).select(DOC_COLS).single()
    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await supabase.from('field_documents').select(DOC_COLS).eq('project_id', pid).eq('doc_type', 'daily_log').eq('doc_date', date)
          .not('status', 'in', '("discarded","superseded")').maybeSingle()
        if (existing) { reloadFieldDocs(); return { error: null, doc: existing } }
      }
      return { error }
    }
    setFieldDocuments((docs) => [data, ...docs])
    return { error: null, doc: data }
  }, [demoMode, setDemoDocs, isPersistedProject, pid, uid, reloadFieldDocs, setFieldDocuments])

  // 存版本=伺服器保存(設計 §3.3);base 是畫面載入時的 current_version_no(樂觀併發,PD001 由頁面提示重新載入)
  const saveFieldDocumentVersion = useCallback(async ({ documentId, baseVersionNo, content, fieldSources, attachments = null, changeNote = null }) => {
    if (demoMode) {
      const d = demoDocsRef.current[documentId]
      if (!d) return { error: { code: 'PD006', message: '找不到文件' } }
      if (baseVersionNo !== d.doc.current_version_no) return { error: { code: 'PD001', message: `畫面載入的是版本 ${baseVersionNo},目前版本已是 ${d.doc.current_version_no},請重新載入後再編輯` } }
      if (['received', 'discarded', 'superseded'].includes(d.doc.status)) return { error: { code: 'PD008', message: `文件狀態為 ${d.doc.status},不可再新增版本` } }
      const versionNo = d.doc.current_version_no + 1
      const required = requiredKeysFor(content, d.doc.required_fields)
      const recheck = unmetFields(required, fieldSources)
      const content_hash = await sha256Hex(new Blob([JSON.stringify(content) + '\n' + JSON.stringify(attachments ?? null)]))
      const status = recheck.length ? 'pending_input' : 'draft'
      const version = { id: `FDV-DEMO-${documentId}-${versionNo}`, document_id: documentId, version_no: versionNo, author_kind: 'human', created_by: uid || null, content, field_sources: fieldSources, attachments, content_hash, change_note: changeNote, amended_from_version: null, created_at: new Date().toISOString() }
      const doc = { ...d.doc, current_version_no: versionNo, status, required_fields: required, recheck, updated_at: version.created_at }
      setDemoDocs((m) => ({ ...m, [documentId]: { doc, versions: [...d.versions, version] } }))
      return { error: null, result: { document_id: documentId, version_no: versionNo, content_hash, status, required_fields: required, recheck, amended_from_version: null } }
    }
    const { data, error } = await supabase.rpc('save_field_document_version', {
      p_document_id: documentId, p_base_version_no: baseVersionNo, p_content: content,
      p_field_sources: fieldSources || {}, p_attachments: attachments, p_change_note: changeNote,
    })
    if (error) return { error: rpcError(error) }
    setFieldDocuments((docs) => docs.map((d) => (d.id === documentId
      ? { ...d, current_version_no: data.version_no, status: data.status, required_fields: data.required_fields, recheck: data.recheck, updated_at: new Date().toISOString() }
      : d)))
    return { error: null, result: data }
  }, [demoMode, setDemoDocs, uid, setFieldDocuments])

  // 簽署:aal2 由 RPC 檢查(PD003 → 頁面引導 MFA);成功後事實表 daily_logs 已由 RPC 落庫,重載日誌
  const signFieldDocument = useCallback(async ({ documentId, versionNo, contentHash, intent }) => {
    if (demoMode) return { error: DEMO_ERROR }
    const { data, error } = await supabase.rpc('sign_field_document', {
      p_document_id: documentId, p_version_no: versionNo, p_content_hash: contentHash, p_intent: intent,
    })
    if (error) return { error: rpcError(error) }
    setFieldDocuments((docs) => docs.map((d) => (d.id === documentId ? { ...d, status: data.status, target_id: data.target_id, recheck: [] } : d)))
    if (dbMode && typeof setSiteLogs === 'function') {
      try { setSiteLogs(await loadSiteLogsFromDB(pid, wiMaps.idToKey)) } catch { /* 日誌重載失敗不影響簽署結果;下次進頁會重載 */ }
    }
    return { error: null, result: data }
  }, [demoMode, dbMode, pid, wiMaps, setSiteLogs, setFieldDocuments])

  // 提送／收件／退回:同一件事重試用同一個 client_request_id(伺服器冪等回同一張回執)
  const submitFieldDocument = useCallback(async ({ documentId, versionNo, docType = 'daily_log' }) => {
    if (demoMode) return { error: DEMO_ERROR }
    const toOrg = TO_ORG_BY_DOC_TYPE[docType]
    const reqKey = { documentId, versionNo, action: 'submit' }
    const { data, error } = await supabase.rpc('submit_field_document', {
      p_document_id: documentId, p_version_no: versionNo, p_to_org: toOrg, p_client_request_id: submissionRequestId(reqKey),
    })
    if (error) {
      const e = rpcError(error)
      if (e.code === 'PD009') clearSubmissionRequestId(reqKey) // 同 id 撞到不同請求:換新的
      return { error: e }
    }
    clearSubmissionRequestId(reqKey)
    setFieldDocuments((docs) => docs.map((d) => (d.id === documentId ? { ...d, status: data.status } : d)))
    reloadFieldDocs() // 提送列變了:今日工作的「待收件」球權讀 submissions
    return { error: null, receipt: data }
  }, [demoMode, reloadFieldDocs, setFieldDocuments])

  const receiveFieldDocument = useCallback(async ({ documentId, versionNo }) => {
    if (demoMode) return { error: DEMO_ERROR }
    const reqKey = { documentId, versionNo, action: 'receive' }
    const { data, error } = await supabase.rpc('receive_field_document', {
      p_document_id: documentId, p_version_no: versionNo, p_client_request_id: submissionRequestId(reqKey),
    })
    if (error) {
      const e = rpcError(error)
      if (e.code === 'PD009') clearSubmissionRequestId(reqKey)
      return { error: e }
    }
    clearSubmissionRequestId(reqKey)
    setFieldDocuments((docs) => docs.map((d) => (d.id === documentId ? { ...d, status: data.status } : d)))
    reloadFieldDocs() // 提送列變了:今日工作的「待收件」球權讀 submissions
    return { error: null, receipt: data }
  }, [demoMode, reloadFieldDocs, setFieldDocuments])

  const returnFieldDocument = useCallback(async ({ documentId, versionNo, reason }) => {
    if (demoMode) return { error: DEMO_ERROR }
    const reqKey = { documentId, versionNo, action: 'return', reason: String(reason || '').trim() }
    const { data, error } = await supabase.rpc('return_field_document', {
      p_document_id: documentId, p_version_no: versionNo, p_reason: reason, p_client_request_id: submissionRequestId(reqKey),
    })
    if (error) {
      const e = rpcError(error)
      if (e.code === 'PD009') clearSubmissionRequestId(reqKey)
      return { error: e }
    }
    clearSubmissionRequestId(reqKey)
    setFieldDocuments((docs) => docs.map((d) => (d.id === documentId ? { ...d, status: data.status } : d)))
    reloadFieldDocs() // 提送列變了:今日工作的「待收件」球權讀 submissions
    return { error: null, receipt: data }
  }, [demoMode, reloadFieldDocs, setFieldDocuments])

  // Agent 對話起稿(draft_daily_log)的接受:改走文件流程——找／建該日草稿,以人填數量存成人工版本;
  // 不再直接寫 daily_logs。已簽署／提送的文件也照樣開新版本(RPC 會標 amended_from_version)。
  const applyDailyLogDraft = useCallback(async (payload) => {
    const date = payload?.log_date
    if (!date) return { error: { message: '草稿沒有日期,無法建立施工日誌' } }
    let doc = findActiveDailyLogDoc(date)
    if (!doc) {
      const r = await createDailyLogDraft(date)
      if (r.error) return { error: r.error }
      doc = r.doc
    }
    const { content, sources } = contentFromAgentDraft(payload)
    const r = await saveFieldDocumentVersion({ documentId: doc.id, baseVersionNo: doc.current_version_no, content, fieldSources: sources, attachments: null, changeNote: '接受 AI 對話草稿' })
    if (r.error) return { error: r.error }
    return { error: null, document: doc, result: r.result }
  }, [findActiveDailyLogDoc, createDailyLogDraft, saveFieldDocumentVersion])

  // 登出／切案清理由 store.jsx 呼叫
  const clearFieldDocs = useCallback(() => { setDocState({ documents: [], submissions: [] }); setIntakes([]); setDemoDocs({}) }, [setDemoDocs])

  return {
    fieldDocuments, intakes, fieldDocsLoading, reloadFieldDocs, clearFieldDocs,
    createIntake, findExistingPhotosBySha, uploadIntakePhoto, draftFromIntake, updateIntakeDate, setIntakeCandidates, discardIntake, listIntakePhotos, listPhotosByIds,
    getFieldDocument, findActiveDailyLogDoc, createDailyLogDraft, saveFieldDocumentVersion,
    signFieldDocument, submitFieldDocument, receiveFieldDocument, returnFieldDocument, applyDailyLogDraft,
  }
}
