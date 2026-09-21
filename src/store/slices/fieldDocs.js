// Field-docs slice(P2c 施工日誌、P3a 監造日誌、P3b 自主檢查表;D-026):上傳批次(photo_intakes／photos)、起稿 Edge、
// 現場文書(field_documents 家族)的載入與五支 RPC。這是施工日誌與監造日誌**唯一**的寫入路徑——
// 事實表 daily_logs／daily_log_items／supervisor_logs 只由 sign_field_document 在簽署交易內落庫,前端不再直接
// upsert(舊 saveSiteLog 已移除;既有未簽署日誌開啟時以其內容建立文件草稿,見 lib/fieldDocs.js)。自主檢查表文件簽署即寫
// checklist_records(首簽 Rev.0、再簽修訂 Rev.N,判定由 DB 算),簽署後重載檢查紀錄與缺失(不合格由 DB trigger 自動開)。
// 文書範本(監造日誌示範範本、自檢表示範框架)由 fn_field_document_template 取,示範模式讀 src/data 的 fixture。
//
// 寫入邊界(設計 field-documents-lifecycle §2.2):
//   * 客戶端直接 INSERT 只有三處:photo_intakes(id/project_id/log_date)、photos(既有欄＋intake_id／
//     content_sha256)、field_documents 草稿(id/project_id/doc_type/doc_date);UPDATE 只有 photo_intakes
//     的 log_date／status=discarded／candidates.excluded。其餘一律 RPC(含 P3e 共用補值 set_intake_shared_input),
//     RLS／guard 是安全邊界。
//   * 「已保存」=伺服器有列;本機的檔案狀態只在頁面 reducer(lib/fieldDocs.js),不做離線同步。
//   * 起稿由 Edge draft-field-documents 服務端執行(過 AI 閘門、記用量);remaining>0 就再呼叫續跑。
// demo 模式(未設 Supabase):文件草稿只進記憶體、可存版本;簽署／提送／上傳一律明確回「示範模式
// 無法…」,不假裝已簽署(不會有雜湊、簽署者與伺服器時間可核對)。種子另帶一組**示範用的已簽署版本**
// (O2;demoSeed.signedDocs)讓月報／佐證包演得出內容:每列帶 is_demo,版本標示印【示範資料】,
// 與使用者在示範模式按下簽署是兩回事——後者仍然被擋。
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { supabase, SIGNED_URL_TTL_S } from '../../lib/supabase.js'
import { loadSiteLogsFromDB, loadFieldDocumentsFromDB, loadFieldDocumentStatuses, loadQcFromDB, loadDefectsFromDB, FIELD_DOCUMENT_COLUMNS, FIELD_DOCUMENT_SUBMISSION_COLUMNS } from '../db.js'
import { pageAll, pageAllSafe, pageAllInSafe, chunked } from '../../lib/pagedQuery.js'
import { compressImage } from '../../lib/imageCompress.js'
import { readPhotoExif } from '../../lib/exifRead.js'
import { extractInvokeError } from './agent.js'
import {
  requiredKeysFor, unmetFields, sha256Hex, submissionRequestId, clearSubmissionRequestId,
  applyInboxQuantities, TO_ORG_BY_DOC_TYPE, docConfirmRequiredKeys,
} from '../../lib/fieldDocs.js'
import { demoFieldDocumentTemplate } from '../../data/demoFieldDocTemplates.js'
import { FIELD_DOC_OPEN_STATUSES } from '../../../supabase/functions/_shared/ballInCourtRules.ts'
import { taipeiToday } from '../../lib/dates.js'

const DOC_COLS = FIELD_DOCUMENT_COLUMNS
const INTAKE_COLS = 'id, project_id, created_by, uploader_org, log_date, status, photo_count, recognized_count, failed_count, candidates, run_started_at, last_progress_at, attempts, error_summary, created_at, updated_at'
const PHOTO_COLS = 'id, project_id, daily_log_id, work_item_id, storage_path, caption, location, taken_at, gps_lat, gps_lng, uploaded_by, uploader_org, intake_id, content_sha256, ai_status, ai_result, ai_run_at, work_item_hint, ai_source, created_at'
const VERSION_COLS = 'id, document_id, version_no, author_kind, created_by, content, field_sources, attachments, content_hash, change_note, amended_from_version, created_at'
// 續跑上限:Edge 每次 100 s 預算、每批最多幾百張,超過這個次數還沒完就是伺服器出狀況
const MAX_DRAFT_ROUNDS = 12
const DEMO_ERROR = { code: 'demo', message: '示範模式無法簽署／提送：正式專案以登入的平台帳號簽署,才會有可核對的版本雜湊與簽署紀錄。' }
const DEMO_UPLOAD_ERROR = { code: 'demo', message: '示範模式不支援照片上傳(需正式專案)' }
// 文件類型 → 責任方／事實表(鏡像 DB generated column fn_field_document_owner_org／fn_field_document_target_table;
// 只給示範模式的記憶體文件用,真專案由 DB 算)
const DOC_TYPE_META = {
  daily_log: { owner_org: 'contractor', target_table: 'daily_logs' }, self_check: { owner_org: 'contractor', target_table: 'checklist_records' },
  supervisor_log: { owner_org: 'supervisor', target_table: 'supervisor_logs' }, inspection_form: { owner_org: 'supervisor', target_table: 'inspections' },
}

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

// setChecklistRecords／setDefects／checklistTemplates(quality slice):自檢表簽署後重載檢查紀錄與缺失;示範模式存版時由範本項目算待補
export function useFieldDocsSlice({ demoMode, dbMode, isPersistedProject, currentProject, currentUser, wiMaps }, { setSiteLogs, setChecklistRecords, setDefects, reloadQuality = null, checklistTemplates = [] } = {}) {
  // { documents, submissions }:與 P5a 今日工作球權(useTodayTasks)同一份;documents 只含未終態
  const [docState, setDocState] = useState({ documents: [], submissions: [], signedDocumentIds: [] })
  const setFieldDocuments = useCallback((fn) => setDocState((st) => ({ ...st, documents: typeof fn === 'function' ? fn(st.documents) : fn })), [])
  const [intakes, setIntakes] = useState([])
  // 批次候選指向、但已不在活文件清單裡的文件的現況(Map id→status):候選列是起稿當下的快照,文件捨棄後不會回寫,
  // 批次結果頁靠它把「已起稿」改成「已捨棄,可重新起稿」。示範模式恆為空(示範草稿捨棄後本來就只留在記憶體)。
  const [candidateDocStatus, setCandidateDocStatus] = useState(new Map())
  const [fieldDocsLoading, setFieldDocsLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // demo:記憶體文件庫 { [id]: { doc, versions: [] } }。ref 與 state 同步寫:建草稿後緊接著存版本時,
  // 呼叫端拿到的仍是舊 closure 的 state,讀 ref 才看得到剛建的文件(否則回「找不到文件」)。
  const [demoDocs, setDemoDocsState] = useState({})
  const demoDocsRef = useRef(demoDocs)
  // demo:示範用的已簽署列與監造日誌事實列(O2;種子 demoSeed.signedDocs／supervisorLogs)。示範模式不能真的簽署,
  // 這是「示範資料」——每列帶 is_demo,版本標示印【示範資料】;真實模式這兩份恆為空,一律走伺服器。
  const [demoSignatures, setDemoSignatures] = useState([])
  const [demoSupervisorLogs, setDemoSupervisorLogs] = useState([])
  const templateCache = useRef(new Map()) // docType → template(fn_field_document_template 是純映射,取一次即可)
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
    if (!isPersistedProject || !pid || !uid) { setDocState({ documents: [], submissions: [], signedDocumentIds: [] }); setIntakes([]); setCandidateDocStatus(new Map()); return }
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
        // 批次候選指向、但已不在活文件清單裡的文件(被捨棄或取代):補查一次現況,批次結果頁才不會一直標「已起稿」
        const openIds = new Set((docs.documents || []).map((d) => d.id))
        const missing = (intakeRows || []).flatMap((i) => (Array.isArray(i.candidates) ? i.candidates : []).map((c) => c?.document_id))
          .filter((id) => id && !openIds.has(id))
        const statuses = await loadFieldDocumentStatuses(pid, missing)
        if (!active) return
        setDocState(docs)
        setCandidateDocStatus(statuses)
        setIntakes((intakeRows || []).map((i) => ({ ...i, photoStats: stats.get(i.id) || { total: 0 } })))
      } catch (e) {
        if (active) console.warn('現場文書載入失敗:', e?.message)
      } finally {
        if (active) setFieldDocsLoading(false)
      }
    })()
    return () => { active = false }
  }, [isPersistedProject, pid, uid, reloadKey])

  // 與真專案同口徑只列未終態(捨棄的示範草稿不再出現在清單)。示範模式使用者仍然不能簽署(簽署一律回 DEMO_ERROR);
  // signedDocumentIds 列的是種子帶進來的「示範已簽署文件」,/site 據此不對它們顯示「捨棄草稿」——與真專案同一條規則。
  const demoDocList = useMemo(() => Object.values(demoDocs).map((d) => d.doc).filter((d) => FIELD_DOC_OPEN_STATUSES.includes(d.status)), [demoDocs])
  const demoSignedDocIds = useMemo(() => [...new Set(demoSignatures.map((s) => s.document_id))], [demoSignatures])
  const allDocuments = demoMode ? demoDocList : docState.documents
  const fieldDocuments = useMemo(() => (demoMode ? { documents: demoDocList, submissions: [], signedDocumentIds: demoSignedDocIds } : docState), [demoMode, demoDocList, demoSignedDocIds, docState])

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
      // taken_at 只放 EXIF 拍攝時間(baseline 欄位定義「≠ uploaded」);沒有 EXIF(LINE 轉存、截圖)就留空,
      // 起稿端改以 created_at 為「上傳日」並明寫來源、列待確認——不把上傳時刻冒充成拍攝時間(2026-09-21 G 包)
      taken_at: exif.takenAt || null, gps_lat: exif.gpsLat, gps_lng: exif.gpsLng,
      uploaded_by: uid,
    })
    if (insErr) { await supabase.storage.from('photos').remove([path]); return { error: insErr } }
    return { error: null, id, storage_path: path }
  }, [isPersistedProject, pid, uid])

  // 起稿:呼叫 Edge 直到 remaining=0。409 run_conflict=別的請求在跑(回給頁面改成輪詢);
  // 其他錯誤回 { error, code } 由頁面如實顯示。每輪的結果透過 onProgress 給頁面。
  // targetDocumentId(表內上傳):只填那一份文件,Edge 不推候選、不寫版本,只留建議並在 result.target 帶回;
  // rerecognizePhotoIds:明確要求重新辨識(不沿用同內容照片的既有結果)。
  const draftFromIntake = useCallback(async (intakeId, { onProgress, targetDocumentId = null, rerecognizePhotoIds = null } = {}) => {
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    let last = null
    const body = {
      project_id: pid, intake_id: intakeId,
      ...(targetDocumentId ? { target_document_id: targetDocumentId } : {}),
      ...(rerecognizePhotoIds?.length ? { rerecognize_photo_ids: rerecognizePhotoIds } : {}),
    }
    for (let round = 0; round < MAX_DRAFT_ROUNDS; round++) {
      const { data, error } = await supabase.functions.invoke('draft-field-documents', { body })
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

  // ── 共用補值(P3e):批次結果頁「一次補齊」。欄位目錄、每份文件的效果(將寫入／已套用／已個別填寫／已簽署不受影響)
  // 與寫入規則全在伺服器(list_／set_intake_shared_input);補值成功會替本批草稿各建人工版本,所以重載文件清單。
  const listIntakeSharedInputs = useCallback(async (intakeId) => {
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR, data: null }
    const { data, error } = await supabase.rpc('list_intake_shared_inputs', { p_intake_id: intakeId })
    if (error) return { error: rpcError(error), data: null }
    return { error: null, data }
  }, [isPersistedProject])

  const setIntakeSharedInput = useCallback(async (intakeId, key, value) => {
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR, result: null }
    const { data, error } = await supabase.rpc('set_intake_shared_input', { p_intake_id: intakeId, p_key: key, p_value: value })
    if (error) return { error: rpcError(error), result: null }
    if (data?.updated) reloadFieldDocs()
    return { error: null, result: data }
  }, [isPersistedProject, reloadFieldDocs])

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

  // ── 文書範本(P3a):監造日誌的示範範本由伺服器 fn_field_document_template 取,介面／列印的「示範範本」
  // 標記、必填鍵與人填欄都從它推導;其他類型回 null。示範模式讀 fixture(與 Edge 鏡像由測試釘住)。
  const getFieldDocumentTemplate = useCallback(async (docType) => {
    if (!docType) return { error: null, template: null }
    if (demoMode || !isPersistedProject) return { error: null, template: demoFieldDocumentTemplate(docType) }
    if (templateCache.current.has(docType)) return { error: null, template: templateCache.current.get(docType) }
    const { data, error } = await supabase.rpc('fn_field_document_template', { p_doc_type: docType })
    if (error) return { error: rpcError(error), template: null }
    templateCache.current.set(docType, data ?? null)
    return { error: null, template: data ?? null }
  }, [demoMode, isPersistedProject])

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

  // 該日該類型的活文件(discarded／superseded 不算);日誌類一天一份
  const findActiveFieldDoc = useCallback((docType, date) =>
    allDocuments.find((d) => d.doc_type === docType && d.doc_date === date && d.status !== 'discarded' && d.status !== 'superseded') || null,
  [allDocuments])
  const findActiveDailyLogDoc = useCallback((date) => findActiveFieldDoc('daily_log', date), [findActiveFieldDoc])

  // 建草稿(客戶端 INSERT 六欄之內;intake_id 不填——起稿冪等鍵由 Edge 寫,客戶端寫不出 target_key;自檢表帶 template_id=本案檢查表範本)。
  // 責任方由 DB generated column 決定(監造建施工日誌、廠商建監造日誌會被 RLS 擋);
  // 同日活文件撞唯一索引(23505,日誌類)→ 重載後改用既有文件,不重複建件。
  const createFieldDocDraft = useCallback(async (docType, date, { templateId = null, targetKey = null } = {}) => {
    if (demoMode) {
      const id = `FD-DEMO-${Object.keys(demoDocsRef.current).length + 1}-${Date.now().toString(36)}`
      const meta = DOC_TYPE_META[docType] || DOC_TYPE_META.daily_log
      const doc = { id, project_id: pid || 'demo', doc_type: docType, owner_org: meta.owner_org, target_table: meta.target_table, target_id: null, target_key: targetKey, intake_id: null, doc_date: date, status: 'draft', current_version_no: 0, template_id: templateId, required_fields: [], recheck: [], created_by: uid || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      setDemoDocs((m) => ({ ...m, [id]: { doc, versions: [] } }))
      return { error: null, doc }
    }
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    const id = crypto.randomUUID()
    const { data, error } = await supabase.from('field_documents').insert({ id, project_id: pid, doc_type: docType, doc_date: date, ...(templateId ? { template_id: templateId } : {}) }).select(DOC_COLS).single()
    if (error) {
      if (error.code === '23505' && docType !== 'self_check') {
        const { data: existing } = await supabase.from('field_documents').select(DOC_COLS).eq('project_id', pid).eq('doc_type', docType).eq('doc_date', date)
          .not('status', 'in', '("discarded","superseded")').maybeSingle()
        if (existing) { reloadFieldDocs(); return { error: null, doc: existing } }
      }
      return { error }
    }
    setFieldDocuments((docs) => [data, ...docs])
    return { error: null, doc: data }
  }, [demoMode, setDemoDocs, isPersistedProject, pid, uid, reloadFieldDocs, setFieldDocuments])
  const createDailyLogDraft = useCallback((date) => createFieldDocDraft('daily_log', date), [createFieldDocDraft])

  // 監造查驗表單草稿(P3c):由查驗申請建立或取回既有活文件(target_key=查驗 id;伺服器 RPC 檢查監造成員與同案,唯一索引兜底)
  const createInspectionFormDraft = useCallback(async (inspectionId) => {
    if (!inspectionId) return { error: { code: 'PD010', message: '缺少查驗申請' } }
    if (demoMode) {
      const existing = Object.values(demoDocsRef.current).map((d) => d.doc).find((d) => d.doc_type === 'inspection_form' && d.target_key === inspectionId && !['discarded', 'superseded'].includes(d.status))
      if (existing) return { error: null, doc: existing, created: false }
      const r = await createFieldDocDraft('inspection_form', taipeiToday(), { targetKey: inspectionId })
      return r.error ? r : { ...r, created: true }
    }
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    const { data, error } = await supabase.rpc('create_inspection_form_draft', { p_inspection_id: inspectionId })
    if (error) return { error: rpcError(error) }
    const { created, ...doc } = data || {}
    setFieldDocuments((docs) => (docs.some((d) => d.id === doc.id) ? docs.map((d) => (d.id === doc.id ? { ...d, ...doc } : d)) : [doc, ...docs]))
    return { error: null, doc, created: !!created }
  }, [demoMode, isPersistedProject, createFieldDocDraft, setFieldDocuments])

  // 此工項的監造確認紀錄(P3c 表單顯示「已確認累計」;RLS 成員可讀,寫入只走簽署與 P4b RPC)
  const listInspectionConfirmations = useCallback(async (workItemId) => {
    if (demoMode || !isPersistedProject || !workItemId) return []
    const { data } = await supabase.from('inspection_confirmations')
      .select('id, work_item_id, batch_key, location_label, stage_key, unit, qty_cum, qty_delta, basis, inspection_id, document_id, document_version_no, status, confirmed_at, created_at')
      .eq('project_id', pid).eq('work_item_id', workItemId).order('confirmed_at', { ascending: false }).limit(500)
    return data || []
  }, [demoMode, isPersistedProject, pid])

  // 指定版本(列印頁印「已簽署版本」用:簽署列指向的版本號,不一定是目前版本)
  const getFieldDocumentVersion = useCallback(async (docId, versionNo) => {
    if (!docId || !versionNo) return null
    if (demoMode) return demoDocsRef.current[docId]?.versions.find((v) => v.version_no === versionNo) || null
    const { data } = await supabase.from('field_document_versions').select(VERSION_COLS).eq('document_id', docId).eq('version_no', versionNo).maybeSingle()
    return data || null
  }, [demoMode])

  // ── 已簽署資料的重用(P6a:施工月報／監造月報／估驗佐證包)──────────────────────────────────
  // 只讀 RLS 成員可讀的 field_documents／field_document_signatures／field_document_versions／supervisor_logs,不開 RPC、不寫入。
  // 失敗原樣回 error(頁面顯示載入失敗,不當成「沒有已簽署資料」)。示範模式無法簽署(DEMO_ERROR),一律回空——報表如實全列未簽署。

  // 某類文書的全部簽署列,各帶所屬文件的類型／日期／狀態／事實列(lib/fieldDocs.signedVersionIndex 的輸入)。
  // 只取已綁事實列的文件(target_id 由簽署落庫時綁定),含已被新文件取代(superseded)的舊文件:新文件簽署前事實列仍是舊文件的版本。
  const listSignedVersions = useCallback(async (docType) => {
    // 示範模式:回種子的示範簽署列(每列 is_demo,版本標示印【示範資料】)。形狀與真專案一致——
    // 簽署列 + 所屬文件的類型／日期／狀態／事實列,判定仍由 signedVersionIndex 做。
    if (demoMode) {
      const rows = []
      for (const s of demoSignatures) {
        const d = demoDocs[s.document_id]?.doc
        if (!d || d.doc_type !== docType || !d.target_id) continue
        rows.push({ ...s, doc_type: d.doc_type, doc_date: d.doc_date, doc_status: d.status, target_id: d.target_id })
      }
      return { rows, error: null }
    }
    if (!isPersistedProject || !docType) return { rows: [], error: null }
    const { data: docs, error } = await pageAllSafe((from, to) => supabase.from('field_documents')
      .select('id, doc_type, doc_date, status, target_id').eq('project_id', pid).eq('doc_type', docType)
      .not('target_id', 'is', null).order('doc_date').order('id').range(from, to))
    if (error) return { rows: [], error }
    if (!docs.length) return { rows: [], error: null }
    const { data: sigs, error: sigErr } = await pageAllInSafe(docs.map((d) => d.id), (chunk, from, to) => supabase.from('field_document_signatures')
      .select('id, document_id, version_no, content_hash, signer_name_snapshot, signed_at').in('document_id', chunk)
      .order('signed_at').order('id').range(from, to))
    if (sigErr) return { rows: [], error: sigErr }
    const docById = new Map(docs.map((d) => [d.id, d]))
    return {
      rows: sigs.map((s) => {
        const d = docById.get(s.document_id)
        return { ...s, doc_type: d.doc_type, doc_date: d.doc_date, doc_status: d.status, target_id: d.target_id }
      }),
      error: null,
    }
  }, [demoMode, demoDocs, demoSignatures, isPersistedProject, pid])

  // 監造日誌事實列(P3a supervisor_logs;RLS 成員可讀)。監造月報只彙整其中已簽署者(以 listSignedVersions 判定)。
  const listSupervisorLogs = useCallback(async ({ from, to }) => {
    // 示範模式:回種子的示範監造日誌事實列(同一組日期區間規則)
    if (demoMode) return { rows: demoSupervisorLogs.filter((r) => (!from || r.log_date >= from) && (!to || r.log_date <= to)), error: null }
    if (!isPersistedProject || !from || !to) return { rows: [], error: null }
    const { data, error } = await pageAllSafe((f, t) => supabase.from('supervisor_logs')
      .select('id, log_date, weather_am, weather_pm, attendance, supervision_items, inspection_ids, notices, followups, contractor_summary, note, template_key, template_version')
      .eq('project_id', pid).gte('log_date', from).lte('log_date', to).order('log_date').order('id').range(f, t))
    return { rows: data || [], error: error || null }
  }, [demoMode, demoSupervisorLogs, isPersistedProject, pid])

  // 指定的文件版本(佐證包:確認紀錄指向的查驗表單版本、送審時點的施工日誌版本);回 Map(`文件:版本` → 版本列)
  const getFieldDocumentVersions = useCallback(async (refs = []) => {
    if (!refs.length) return { versions: new Map(), error: null }
    // 示範模式:版本從記憶體文件庫取(示範已簽署版本與示範草稿都在裡面)
    if (demoMode) {
      const versions = new Map()
      for (const r of refs) {
        const v = demoDocsRef.current[r.document_id]?.versions?.find((x) => Number(x.version_no) === Number(r.version_no))
        if (v) versions.set(`${r.document_id}:${r.version_no}`, v)
      }
      return { versions, error: null }
    }
    if (!isPersistedProject) return { versions: new Map(), error: null }
    const wanted = new Set(refs.map((r) => `${r.document_id}:${r.version_no}`))
    const versionNos = [...new Set(refs.map((r) => Number(r.version_no)))]
    const { data, error } = await pageAllInSafe([...new Set(refs.map((r) => r.document_id))], (chunk, from, to) => supabase.from('field_document_versions')
      .select('document_id, version_no, content, field_sources, attachments, content_hash').in('document_id', chunk).in('version_no', versionNos)
      .order('document_id').order('version_no').range(from, to))
    if (error) return { versions: new Map(), error }
    return { versions: new Map(data.filter((v) => wanted.has(`${v.document_id}:${v.version_no}`)).map((v) => [`${v.document_id}:${v.version_no}`, v])), error: null }
  }, [demoMode, isPersistedProject])

  // 存版本=伺服器保存(設計 §3.3);base 是畫面載入時的 current_version_no(樂觀併發,PD001 由頁面提示重新載入)
  const saveFieldDocumentVersion = useCallback(async ({ documentId, baseVersionNo, content, fieldSources, attachments = null, changeNote = null }) => {
    if (demoMode) {
      const d = demoDocsRef.current[documentId]
      if (!d) return { error: { code: 'PD006', message: '找不到文件' } }
      if (baseVersionNo !== d.doc.current_version_no) return { error: { code: 'PD001', message: `畫面載入的是版本 ${baseVersionNo},目前版本已是 ${d.doc.current_version_no},請重新載入後再編輯` } }
      if (['received', 'discarded', 'superseded'].includes(d.doc.status)) return { error: { code: 'PD008', message: `文件狀態為 ${d.doc.status},不可再新增版本` } }
      const versionNo = d.doc.current_version_no + 1
      // 必填鍵與待補鏡像 DB:依類型取範本(示範模式讀 fixture;自檢表另取內容指定的本案檢查表範本項目),須確認欄只被標 filled 算待確認
      const template = demoFieldDocumentTemplate(d.doc.doc_type)
      const checklistItems = d.doc.doc_type === 'self_check' ? ((checklistTemplates || []).find((t) => t.id === content?.template_id)?.items || []) : null
      const required = requiredKeysFor(content, d.doc.required_fields, { docType: d.doc.doc_type, template, checklistItems })
      const recheck = unmetFields(required, fieldSources, docConfirmRequiredKeys(d.doc.doc_type, template, checklistItems))
      const content_hash = await sha256Hex(new Blob([JSON.stringify(content) + '\n' + JSON.stringify(attachments ?? null)]))
      const status = recheck.length ? 'pending_input' : 'draft'
      const version = { id: `FDV-DEMO-${documentId}-${versionNo}`, document_id: documentId, version_no: versionNo, author_kind: 'human', created_by: uid || null, content, field_sources: fieldSources, attachments, content_hash, change_note: changeNote, amended_from_version: null, created_at: new Date().toISOString() }
      const doc = { ...d.doc, current_version_no: versionNo, status, required_fields: required, recheck, updated_at: version.created_at, ...(d.doc.doc_type === 'self_check' && content?.template_id ? { template_id: content.template_id } : {}) }
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
  }, [demoMode, setDemoDocs, uid, setFieldDocuments, checklistTemplates])

  // 簽署:身分／責任方／版本／雜湊由 RPC 檢查;成功後事實表已由 RPC 落庫,重載對應讀端
  const signFieldDocument = useCallback(async ({ documentId, versionNo, contentHash, intent }) => {
    if (demoMode) return { error: DEMO_ERROR }
    const { data, error } = await supabase.rpc('sign_field_document', {
      p_document_id: documentId, p_version_no: versionNo, p_content_hash: contentHash, p_intent: intent,
    })
    if (error) return { error: rpcError(error) }
    setFieldDocuments((docs) => docs.map((d) => (d.id === documentId ? { ...d, status: data.status, target_id: data.target_id, recheck: [] } : d)))
    // 施工日誌簽署落 daily_logs → 重載 siteLogs(施工月報、勾稽、列印吃它);監造日誌落 supervisor_logs,監造月報開頁時才讀(P6a,不常駐 store);
    // 自檢表落 checklist_records(品質查驗清單、查驗申請檢附候選)＋不合格由 DB trigger 開缺失 → 重載兩者。重載失敗不影響簽署結果。
    if (dbMode && data?.target_table === 'daily_logs' && typeof setSiteLogs === 'function') {
      try { setSiteLogs(await loadSiteLogsFromDB(pid, wiMaps.idToKey)) } catch { /* 下次進頁會重載 */ }
    }
    if (dbMode && data?.target_table === 'checklist_records') {
      try {
        if (typeof setChecklistRecords === 'function') setChecklistRecords((await loadQcFromDB(pid)).records)
        if (typeof setDefects === 'function') setDefects(await loadDefectsFromDB(pid, wiMaps.byId))
      } catch { /* 下次進頁會重載 */ }
    }
    // 監造查驗表單簽署即判定(inspections 狀態／確認量)＋不合格由 DB trigger 開缺失 → 重載查驗與缺失
    if (dbMode && data?.target_table === 'inspections' && typeof reloadQuality === 'function') {
      try { await reloadQuality() } catch { /* 下次進頁會重載 */ }
    }
    return { error: null, result: data }
  }, [demoMode, dbMode, pid, wiMaps, setSiteLogs, setChecklistRecords, setDefects, reloadQuality, setFieldDocuments])

  // 提送／收件／退回:同一件事重試用同一個 client_request_id(伺服器冪等回同一張回執)
  // 提送:對象預設該類型第一順位(施工日誌／自檢→監造、監造日誌→機關、查驗表單→廠商);多對象文件由頁面逐一指定 toOrg
  const submitFieldDocument = useCallback(async ({ documentId, versionNo, docType = 'daily_log', toOrg = null }) => {
    if (demoMode) return { error: DEMO_ERROR }
    const to = toOrg || TO_ORG_BY_DOC_TYPE[docType]
    const reqKey = { documentId, versionNo, action: 'submit', reason: to }
    const { data, error } = await supabase.rpc('submit_field_document', {
      p_document_id: documentId, p_version_no: versionNo, p_to_org: to, p_client_request_id: submissionRequestId(reqKey),
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

  // 捨棄草稿(P3f):只有責任方、從未簽署／提送的文件,原因必填——規則全在 DB discard_field_document(PD006／PD008／PD010);
  // 同一件事重試用同一個 client_request_id(伺服器冪等回原結果)。成功後文件是終態,從未終態清單移除;版本、照片都保留。
  // 伺服器同交易把指向本文件的待覆核 AI 草稿標 rejected(回 agent_actions_resolved;收件匣由 store 重載)。
  const discardFieldDocument = useCallback(async ({ documentId, versionNo = null, reason }) => {
    const why = String(reason || '').trim()
    if (demoMode) {
      const d = demoDocsRef.current[documentId]
      if (!d) return { error: { code: 'PD006', message: '找不到文件' } }
      if (!why) return { error: { code: 'PD010', message: '捨棄必須填寫原因' } }
      if (!['draft', 'pending_input', 'in_review'].includes(d.doc.status)) return { error: { code: 'PD008', message: `文件狀態為 ${d.doc.status},不可捨棄` } }
      const doc = { ...d.doc, status: 'discarded', discard_reason: why, discarded_by: uid || null, discarded_at: new Date().toISOString() }
      setDemoDocs((m) => ({ ...m, [documentId]: { ...d, doc } }))
      return { error: null, result: { document_id: documentId, doc_type: doc.doc_type, doc_date: doc.doc_date, status: 'discarded', version_no: doc.current_version_no, discard_reason: why, agent_actions_resolved: 0, idempotent: false } }
    }
    if (!isPersistedProject) return { error: DEMO_UPLOAD_ERROR }
    const reqKey = { documentId, versionNo: versionNo ?? '', action: 'discard', reason: why }
    const { data, error } = await supabase.rpc('discard_field_document', {
      p_document_id: documentId, p_reason: why, p_client_request_id: submissionRequestId(reqKey),
    })
    if (error) {
      const e = rpcError(error)
      if (e.code === 'PD009') clearSubmissionRequestId(reqKey)
      return { error: e }
    }
    clearSubmissionRequestId(reqKey)
    setDocState((st) => ({ ...st, documents: st.documents.filter((d) => d.id !== documentId), submissions: st.submissions.filter((x) => x.document_id !== documentId) }))
    return { error: null, result: data }
  }, [demoMode, setDemoDocs, uid, isPersistedProject])

  // Agent 對話起稿(draft_daily_log;P6b-2)的接受:草稿文件已由 Edge 建好(agent_actions.target_id),這裡只把收件匣卡片上
  // 人填的數量疊到該文件目前版本、存成人工版本(伺服器 save_field_document_version 算必填與待補);沒填任何數量就不新增版本。
  // 已簽署／提送的文件照樣開新版本(RPC 標 amended_from_version),與文件頁同一條規則。
  const fillAgentDraftQuantities = useCallback(async ({ documentId, quantities }) => {
    const got = await getFieldDocument(documentId)
    if (!got?.doc || !got.version) return { error: { message: '找不到這份草稿文件(可能已捨棄或無權限);請拒絕此草稿後請 Agent 重新起稿' } }
    const { content, sources, applied } = applyInboxQuantities(got.version.content, got.version.field_sources, quantities)
    if (!applied) return { error: null, document: got.doc, result: null }
    const r = await saveFieldDocumentVersion({
      documentId, baseVersionNo: got.doc.current_version_no, content, fieldSources: sources,
      attachments: got.version.attachments ?? null, changeNote: '接受 AI 對話草稿(填入數量)',
    })
    if (r.error) return { error: r.error }
    return { error: null, document: got.doc, result: r.result }
  }, [getFieldDocument, saveFieldDocumentVersion])

  // 示範模式:Agent 收件匣的示範草稿所指的文件(demoSeed.fieldDocuments)一次種進記憶體文件庫
  // entries=示範草稿;signed=示範已簽署文件(含 signatures);supervisorLogs=示範監造日誌事實列。
  // 兩者都進同一個記憶體文件庫,頁面與報表不必分辨「草稿或已簽署」——差別只在有沒有簽署列。
  const seedDemoDocs = useCallback((entries = [], { signed = [], supervisorLogs = [] } = {}) => {
    if (!demoMode) return
    setDemoDocs(Object.fromEntries([...entries, ...signed].map((e) => [e.doc.id, e])))
    setDemoSignatures(signed.flatMap((e) => e.signatures || []))
    setDemoSupervisorLogs(supervisorLogs)
  }, [demoMode, setDemoDocs])

  // 登出／切案清理由 store.jsx 呼叫
  const clearFieldDocs = useCallback(() => {
    setDocState({ documents: [], submissions: [], signedDocumentIds: [] }); setIntakes([]); setCandidateDocStatus(new Map())
    setDemoDocs({}); setDemoSignatures([]); setDemoSupervisorLogs([])
  }, [setDemoDocs])

  return {
    fieldDocuments, intakes, candidateDocStatus, fieldDocsLoading, reloadFieldDocs, clearFieldDocs,
    createIntake, findExistingPhotosBySha, uploadIntakePhoto, draftFromIntake, updateIntakeDate, setIntakeCandidates, discardIntake, listIntakePhotos, listPhotosByIds,
    listIntakeSharedInputs, setIntakeSharedInput,
    getFieldDocument, getFieldDocumentVersion, getFieldDocumentTemplate, findActiveFieldDoc, findActiveDailyLogDoc, createFieldDocDraft, createDailyLogDraft, createInspectionFormDraft, listInspectionConfirmations, saveFieldDocumentVersion,
    listSignedVersions, listSupervisorLogs, getFieldDocumentVersions,
    signFieldDocument, submitFieldDocument, receiveFieldDocument, returnFieldDocument, discardFieldDocument, fillAgentDraftQuantities, seedDemoDocs,
  }
}
