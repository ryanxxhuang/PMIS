// 現場文書(P2c 施工日誌、P3a 監造日誌、P3b 自主檢查表;D-026)的純函式層:上傳批次狀態機、恢復、欄位來源狀態、
// 三類文書的內容形狀、簽署／提送的錯誤碼分流、送件重試的 client_request_id。
// 全部確定性、無 IO、無 React——store slice 與頁面都吃這一份,vitest 直接測。
//
// 內容形狀與 Edge 起稿(supabase/functions/_shared/fieldDocDraft.ts buildDailyLogDraft／buildSupervisorLogDraft／
// buildSelfCheckDraft)同一組鍵;必填鍵與待補判定鏡像 DB 的 fn_field_document_required_fields／fn_field_document_unmet_fields
// (migration 20260917205000、20260917221000、20260919141500)——這裡只是「存檔前先讓人看到哪些還缺」的預覽,伺服器存版時會
// 再算一次並寫回 field_documents.required_fields／recheck,以伺服器為準。範本(監造日誌示範範本、自檢表示範框架)只有 DB
// fn_field_document_template 一份定義;從範本推導必填鍵、人填欄、須確認欄的規則與 Edge 同一支
// (supabase/functions/_shared/fieldDocTemplate.ts,這裡 re-export),前端不另抄一份。
//
// 誠實原則(設計 §1.5):沒有來源的數量、天氣、出工、到場、實測值一律 pending;人填了才 confirmed;
// 「本日無」用 na＋reason,不得把空白填成「無」或 0。人填欄(到場)人填了也只是 filled=待親自確認,
// 明確按「確認」才 confirmed(鏡像 DB 的 needs_confirmation;任何照片都不是到場證明)。自檢表每個檢查項目都是
// 須確認欄:系統帶入(既有紀錄／建議)的值要人逐項確認才能簽;實測值系統永遠不填。
import {
  templateFields, templateRequiredKeys, templateHumanOnlyKeys, templateConfirmRequiredKeys, templateFieldLabels,
  checklistItemRules, checklistItemKeys, docRequiredKeys, docHumanOnlyKeys, docConfirmRequiredKeys, normalizeCqKey, CHECKLIST_DOC_TYPES,
} from '../../supabase/functions/_shared/fieldDocTemplate.ts'
import { fieldDocumentBalls, FIELD_DOC_TO_ORGS } from '../../supabase/functions/_shared/ballInCourtRules.ts'
export {
  templateFields, templateRequiredKeys, templateHumanOnlyKeys, templateConfirmRequiredKeys, templateFieldLabels,
  checklistItemRules, checklistItemKeys, docRequiredKeys, docHumanOnlyKeys, docConfirmRequiredKeys, normalizeCqKey, CHECKLIST_DOC_TYPES,
}

// ── 上傳批次:客戶端狀態機 ────────────────────────────────────────────────────
// 每張照片在客戶端的狀態。「已保存」只有 saved 一種——照片列已寫進伺服器(photos);
// 其餘全部是「仍在本機」:重新整理就沒有了,要如實告訴使用者。
export const UPLOAD_STATUS = Object.freeze({
  queued: 'queued',       // 仍在本機:排隊中
  hashing: 'hashing',     // 仍在本機:計算內容雜湊
  uploading: 'uploading', // 仍在本機:傳送中
  saved: 'saved',         // 已保存到伺服器
  duplicate: 'duplicate', // 本案已有同內容照片,不重複上傳(引用既有照片列)
  failed: 'failed',       // 仍在本機:上傳失敗,可重試
})
export const LOCAL_STATUSES = Object.freeze([UPLOAD_STATUS.queued, UPLOAD_STATUS.hashing, UPLOAD_STATUS.uploading, UPLOAD_STATUS.failed])

export const initialUploadState = () => ({ items: [], intakeId: null, phase: 'idle', error: null })

// 批次階段:idle → uploading(照片逐張上傳)→ drafting(伺服器辨識／起稿)→ done|error
export function uploadReducer(state, action) {
  switch (action.type) {
    case 'add_files':
      return {
        ...state,
        items: [...state.items, ...action.files.map((f) => ({
          key: f.key, name: f.name, size: f.size ?? 0, status: UPLOAD_STATUS.queued, sha256: null, photoId: null, error: null,
        }))],
      }
    case 'intake':
      return { ...state, intakeId: action.intakeId, phase: 'uploading', error: null }
    case 'hashing':
      return patch(state, action.key, { status: UPLOAD_STATUS.hashing })
    case 'hashed':
      return patch(state, action.key, { sha256: action.sha256 })
    case 'uploading':
      return patch(state, action.key, { status: UPLOAD_STATUS.uploading, error: null })
    case 'saved':
      return patch(state, action.key, { status: UPLOAD_STATUS.saved, photoId: action.photoId, error: null })
    case 'duplicate':
      return patch(state, action.key, { status: UPLOAD_STATUS.duplicate, photoId: action.photoId, error: null })
    case 'failed':
      return patch(state, action.key, { status: UPLOAD_STATUS.failed, error: action.error || '上傳失敗' })
    case 'retry':
      return {
        ...state,
        phase: 'uploading', error: null,
        items: state.items.map((it) => (it.status === UPLOAD_STATUS.failed ? { ...it, status: UPLOAD_STATUS.queued, error: null } : it)),
      }
    case 'remove':
      return { ...state, items: state.items.filter((it) => it.key !== action.key) }
    case 'drafting':
      return { ...state, phase: 'drafting', error: null }
    case 'done':
      return { ...state, phase: 'done', error: null }
    case 'error':
      return { ...state, phase: 'error', error: action.error || '處理失敗' }
    case 'reset':
      return initialUploadState()
    default:
      return state
  }
}
function patch(state, key, p) {
  return { ...state, items: state.items.map((it) => (it.key === key ? { ...it, ...p } : it)) }
}

// 「已保存 n／仍在本機 m」的計數:給進度列與存檔狀態章用
export function uploadSummary(items = []) {
  const count = (s) => items.filter((it) => it.status === s).length
  const local = items.filter((it) => LOCAL_STATUSES.includes(it.status)).length
  return {
    total: items.length,
    saved: count(UPLOAD_STATUS.saved),
    duplicate: count(UPLOAD_STATUS.duplicate),
    failed: count(UPLOAD_STATUS.failed),
    uploading: count(UPLOAD_STATUS.uploading) + count(UPLOAD_STATUS.hashing),
    local,
    // 伺服器上有東西可辨識(本批新存的或引用既有的)
    persisted: count(UPLOAD_STATUS.saved) + count(UPLOAD_STATUS.duplicate),
  }
}

// 同批同雜湊只上傳一次(第二張直接引用第一張的照片列);跨批次由 findExistingBySha 處理。
export function firstIndexBySha(items = []) {
  const first = new Map()
  items.forEach((it, i) => { if (it.sha256 && !first.has(it.sha256)) first.set(it.sha256, i) })
  return first
}

// ── 上傳批次:伺服器狀態的恢復判讀 ───────────────────────────────────────────
// Edge run 掛掉的判定門檻與 fieldDocDraftRun.DEFAULT_STALE_MS 同一個數字
export const RUN_STALE_MS = 10 * 60 * 1000
export const MAX_INTAKE_ATTEMPTS = 5

export const INTAKE_STATUS_LABEL = Object.freeze({
  received: '已保存,待辨識', recognizing: '辨識中', drafting: '起稿中', ready: '辨識完成',
  partial: '部分完成', failed: '辨識失敗', discarded: '已捨棄',
})

// 進入頁面(或重新登入、換裝置)時只看伺服器狀態決定下一步——本機不存任何批次進度。
//   draft:照片已保存但尚未起稿(上傳中途離頁);continue:預算用完的續跑;running:別的請求在跑;
//   retry:部分失敗可重跑;exhausted:重試用盡,請重新上傳;fix_date:有照片判不出日期;
//   empty:批次沒有任何已保存照片;done:完成;none:已捨棄。
export function intakeNextAction(intake, { now = Date.now(), photoCount = null } = {}) {
  if (!intake) return 'none'
  if (intake.status === 'discarded') return 'none'
  const running = !!intake.run_started_at
  const lastProgress = intake.last_progress_at ? Date.parse(intake.last_progress_at) : 0
  const stale = running && now - lastProgress > RUN_STALE_MS
  if (running && !stale) return 'running'
  const photos = photoCount ?? intake.photo_count ?? 0
  if (intake.status === 'received') return photos > 0 ? 'draft' : 'empty'
  if (intake.status === 'recognizing' || intake.status === 'drafting') return 'continue'
  if (intake.status === 'failed' || intake.status === 'partial') {
    if ((intake.attempts ?? 0) >= MAX_INTAKE_ATTEMPTS) return 'exhausted'
    return 'retry'
  }
  const blocked = Array.isArray(intake.candidates) && intake.candidates.some((c) => c?.state === 'blocked')
  if (blocked) return 'fix_date'
  return 'done'
}

// 候選文書的狀態文案(設計 §3.1 第 6 步;P2c 只有施工日誌會真的起稿)
export const DOC_TYPE_LABEL = Object.freeze({
  daily_log: '施工日誌', supervisor_log: '監造日誌', self_check: '自主檢查表', inspection_form: '監造查驗表單',
})
export const CANDIDATE_STATE_LABEL = Object.freeze({
  ready: '已就緒', blocked: '待補', unsupported: '尚未支援', excluded: '已排除', drafted: '已起稿',
  unchanged: '內容未變', suggested: '已留建議', locked: '已簽署,未變更', error: '起稿失敗',
})
export const CANDIDATE_STATE_TONE = Object.freeze({
  ready: 'blue', blocked: 'amber', unsupported: 'slate', excluded: 'slate', drafted: 'green',
  unchanged: 'green', suggested: 'purple', locked: 'green', error: 'red',
})

// 使用者只能切換 excluded(DB guard 逐項比對其餘欄位);回傳整份新清單供 UPDATE
export function toggleCandidateExcluded(candidates = [], index, excluded) {
  return candidates.map((c, i) => (i === index ? { ...c, excluded: !!excluded } : c))
}

// ── 共用補值(P3e;批次結果頁「一次補齊」)──────────────────────────────────────────
// 欄位目錄(位置／當日數量／天氣,鍵帶日期)、每份文件的效果與寫入規則全在伺服器(list_／set_intake_shared_input);
// 這裡只做呈現:分組、標題、效果文案、輸入轉型(數量送 JSON 數字;合不合法由伺服器判 PD010)與套用結果的一句話。
export const SHARED_EFFECT_TONE = Object.freeze({ update: 'blue', applied: 'green', human_value: 'slate', locked: 'slate' })
const SHARED_LOCKED_REASON = Object.freeze({
  in_review: '內部核對中', signed: '已簽署', submitted: '已提送', received: '對方已收件', returned: '被退回待補正',
  draft: '簽後更正中', pending_input: '簽後更正中',
})

export function sharedFieldTitle(field) {
  const wi = field?.work_item
  const wiLabel = wi ? [wi.item_no, wi.description].filter(Boolean).join(' ') : ''
  return [field?.label || field?.field || '', wiLabel].filter(Boolean).join('・')
}

// 依業務日期分組(伺服器已排序:天氣在前、工項依標單順序)
export function groupSharedFields(fields = []) {
  const out = []
  for (const f of Array.isArray(fields) ? fields : []) {
    const last = out[out.length - 1]
    if (last && last.date === f.date) last.fields.push(f)
    else out.push({ date: f.date, fields: [f] })
  }
  return out
}

// 一份文件在這個欄位上的效果(伺服器判定)→ 文案
export function sharedEffectLabel(doc, field) {
  switch (doc?.effect) {
    case 'applied': return '已套用'
    case 'human_value':
      if (doc.current_source?.status === 'na') return '已標不適用，不覆蓋'
      return doc.current_value == null || doc.current_value === '' ? '已在文件中個別處理，不覆蓋' : `已個別填寫「${doc.current_value}」，不覆蓋`
    case 'locked': return `${SHARED_LOCKED_REASON[doc.status] || '已鎖定'}，不受影響`
    default: return field?.value != null ? '尚未套用' : '將寫入'
  }
}

export const sharedPendingDocs = (field) => (Array.isArray(field?.documents) ? field.documents : []).filter((d) => d.effect === 'update')

// 輸入轉型:數量欄送數字(非數字原樣送出,由伺服器回 PD010 說明);文字欄去頭尾空白
export function sharedInputValue(field, raw) {
  const s = String(raw ?? '').trim()
  if (field?.value_kind === 'number') {
    const n = Number(s)
    return s !== '' && Number.isFinite(n) ? n : s
  }
  return s
}

// 上傳當下的結果(Edge 回應的 documents)在補值後版本號前進:以伺服器回傳的新版本號更新,連結文字不停在舊版
export function documentsAfterShared(documents = [], result) {
  const updated = new Map((Array.isArray(result?.documents) ? result.documents : [])
    .filter((d) => d.result === 'updated').map((d) => [d.document_id, d]))
  return (documents || []).map((d) => {
    const u = updated.get(d.document_id || d.id)
    return u ? { ...d, version_no: u.version_no, current_version_no: u.version_no, status: u.status } : d
  })
}

// 套用結果(documents[].result = updated／unchanged／locked／human_value)的一句話
export function sharedApplySummary(result) {
  const docs = Array.isArray(result?.documents) ? result.documents : []
  const by = (r) => docs.filter((d) => d.result === r)
  const updated = by('updated')
  const parts = [updated.length
    ? `已更新 ${updated.length} 份（${updated.map((d) => `${DOC_TYPE_LABEL[d.doc_type] || d.doc_type} 版本 ${d.version_no}`).join('、')}）`
    : '沒有文件需要更新']
  if (by('unchanged').length) parts.push(`${by('unchanged').length} 份已是此值`)
  if (by('locked').length) parts.push(`${by('locked').length} 份已簽署或提送，未變更`)
  if (by('human_value').length) parts.push(`${by('human_value').length} 份已個別填寫，未覆蓋`)
  return parts.join('；')
}

// ── 欄位來源狀態 ───────────────────────────────────────────────────────────
export const FIELD_STATUS_LABEL = Object.freeze({ filled: '已帶入・待核對', pending: '待補', na: '不適用', confirmed: '已確認' })
export const FIELD_STATUS_TONE = Object.freeze({ filled: 'blue', pending: 'amber', na: 'slate', confirmed: 'green' })

// 來源字串(fieldDocDraft.ts FieldSource.source)→ 人看得懂的短句
export function sourceLabel(source) {
  if (!source) return null
  const s = String(source)
  if (s.startsWith('whiteboard:')) return '告示板轉錄'
  if (s.startsWith('photo_time:')) return '照片時間'
  if (s.startsWith('legacy:')) return '既有紀錄'
  if (s.startsWith('yesterday:')) return '沿用昨日'
  if (s.startsWith('shared:')) return '共用補值'
  if (s.startsWith('inspection:')) return '查驗紀錄'
  if (s.startsWith('field_document:')) return '同日施工日誌文件'
  if (s === 'system:inspections') return '系統查驗紀錄'
  if (s === 'system:defects') return '系統缺失紀錄'
  if (s === 'system:defects,inspections') return '系統缺失／查驗紀錄'
  if (s === 'system:field_documents') return '系統文件狀態'
  if (s === 'system:template_match') return '依工項挑選範本'
  if (s === 'ai:photo') return '照片 AI 說明'
  if (s === 'ai:agent') return 'AI 草稿'
  if (s === 'cwa') return '氣象署'
  if (s === 'intake') return '批次指定'
  if (s === 'human') return '人工填寫'
  return s
}

// 施工日誌固定必填欄(與 DB fn_field_document_required_fields 同一組)
export const DAILY_LOG_FIXED_REQUIRED = Object.freeze(['weather_am', 'weather_pm', 'work_summary', 'labor', 'equipment', 'materials'])
export const DAILY_LOG_EXTRAS_KEYS = Object.freeze(['technicians', 'edu', 'insured', 'ppe', 'safety_other', 'sampling', 'notice', 'important'])
// 欄位中文:施工日誌是公定格式(固定);監造日誌的欄位名以伺服器範本(fn_field_document_template)為準,
// 這裡只放範本讀不到時(錯誤訊息、示範模式未載)的後備,fieldLabel 先查傳入的範本標籤再查這份。
export const FIELD_LABEL = Object.freeze({
  log_date: '日期', weather_am: '天氣(上午)', weather_pm: '天氣(下午)', work_summary: '工作摘要',
  labor: '出工人數', equipment: '機具使用', materials: '材料使用',
  'extras.technicians': '應置技術士', 'extras.edu': '勤前教育', 'extras.insured': '新進勞工提報勞保', 'extras.ppe': '檢查個人防護具',
  'extras.safety_other': '其他安衛事項', 'extras.sampling': '施工取樣試驗紀錄', 'extras.notice': '通知協力廠商辦理事項', 'extras.important': '重要事項紀錄',
  attendance: '到場人員與時段', supervision_items: '監造事項', inspection_ids: '當日查驗', contractor_summary: '施工情形摘要',
  daily_log_receipt: '施工日誌收件情形', notices: '通知事項', followups: '追蹤事項', note: '備註', photos: '照片',
  check_date: '檢查日期', template_id: '檢查表範本', work_item_id: '對應工項', location: '檢查位置', results: '檢查項目',
})

// ── 範本(fn_field_document_template 的回傳:supervisor_log 示範範本、self_check 示範框架)────────────────
// 範本是伺服器單一定義:必填鍵、人填欄、須確認欄、欄位標籤與「示範範本」標記都從它推導(規則實作在
// fieldDocTemplate.ts,與 Edge 同一支;本檔開頭 re-export)。自檢表的檢查項目取自本案 checklist_templates.items,
// 項目鍵 results.<no> 的標籤由 checklistItemLabels 給 fieldLabel 用。
export const checklistItemLabels = (items) => Object.fromEntries(
  (Array.isArray(items) ? items : []).filter((it) => it?.no).map((it) => [`results.${it.no}`, `${it.no} ${it.item || ''}`.trim()]))

// 必填鍵(鏡像 DB fn_field_document_required_fields):stored ∪ 類型固定欄 ∪ 施工日誌內容各工項的當日數量 ∪ 自檢表
// 範本每個項目(stored 的工項鍵／項目鍵一律忽略、由內容重算)。施工日誌固定六欄;其他類型取範本 required(沒範本只回 stored)。
export function requiredKeysFor(content, stored = [], { docType = 'daily_log', template = null, checklistItems = null, stageRequired = false } = {}) {
  const keys = new Set()
  for (const k of Array.isArray(stored) ? stored : []) {
    if (typeof k !== 'string' || !k.trim() || /^items\..+\.qty_today$/.test(k)) continue
    if (CHECKLIST_DOC_TYPES.includes(docType) && k.startsWith('results.')) continue
    if (docType === 'inspection_form' && k === 'stage_key') continue // 階段鍵永遠由工項的 ITP 必要階段重算
    keys.add(k)
  }
  if (docType === 'daily_log') {
    for (const k of DAILY_LOG_FIXED_REQUIRED) keys.add(k)
    for (const wid of Object.keys(content?.items || {})) keys.add(`items.${wid}.qty_today`)
  } else {
    for (const k of docRequiredKeys(docType, template, checklistItems, { stageRequired })) keys.add(k)
  }
  return [...keys].sort()
}

// 待補清單 [{key,status}](鏡像 DB fn_field_document_unmet_fields):須確認欄(confirmRequiredKeys=範本 human_only／
// confirm_required 欄 ∪ 自檢表每個項目;由 docConfirmRequiredKeys 推導)只被標 filled 回 needs_confirmation——
// 只有 confirmed 或 na＋reason 才算齊備。
export function unmetFields(required, sources, confirmRequiredKeys = []) {
  const out = []
  for (const k of required) {
    const src = sources?.[k]
    if (!src || typeof src !== 'object') { out.push({ key: k, status: 'missing' }); continue }
    if (src.status === 'filled' && confirmRequiredKeys.includes(k)) { out.push({ key: k, status: 'needs_confirmation' }); continue }
    if (src.status === 'filled' || src.status === 'confirmed') continue
    if (src.status === 'na') {
      if (String(src.reason || '').trim()) continue
      out.push({ key: k, status: 'na_without_reason' }); continue
    }
    if (src.status === 'pending') { out.push({ key: k, status: 'pending' }); continue }
    out.push({ key: k, status: 'unknown_status' })
  }
  return out
}

export const UNMET_STATUS_LABEL = Object.freeze({
  missing: '待補', pending: '待補', na_without_reason: '不適用需填原因', needs_confirmation: '待親自確認', unknown_status: '狀態不明',
})

export function fieldLabel(key, content, labels = null) {
  if (labels && labels[key]) return labels[key]
  if (FIELD_LABEL[key]) return FIELD_LABEL[key]
  const m = /^items\.([^.]+)\.(qty_today|location)$/.exec(key)
  if (m) {
    const it = content?.items?.[m[1]]
    const name = it ? [it.item_no, it.description].filter(Boolean).join(' ') : m[1]
    return `${name}${m[2] === 'qty_today' ? ' 當日數量' : ' 施作位置'}`
  }
  return key
}

// ── 施工日誌內容形狀 ─────────────────────────────────────────────────────────
export function emptyDailyLogContent(date) {
  return {
    log_date: date, weather_am: null, weather_pm: null,
    labor: [], equipment: [], materials: [], extras: {}, work_summary: null,
    items: {}, photo_ids: [], unmatched_photo_ids: [],
  }
}

// 新文件(沒有任何來源)的 field_sources:全部 pending,不假裝任何欄位有值
export function emptyDailyLogSources(content) {
  const sources = { log_date: { status: 'confirmed', source: 'human' } }
  for (const k of DAILY_LOG_FIXED_REQUIRED) sources[k] = { status: 'pending', source: null }
  for (const wid of Object.keys(content?.items || {})) {
    sources[`items.${wid}.qty_today`] = { status: 'pending', source: null }
  }
  return sources
}

// 既有未簽署日誌(daily_logs 舊路徑寫入,正式 12 筆)→ 文件草稿內容:全標 filled/legacy(待核對),
// 不偽造簽署、不把它當已確認(設計 §9)。工項鍵由 item_key 換成 work_items uuid;換不到的
// (標單已重匯)保留原 key——簽署時 DB 會以 PD010 擋下,人得在畫面上移除該列。
export function contentFromLegacyLog(log, byKey = new Map()) {
  const content = emptyDailyLogContent(log.log_date)
  content.weather_am = log.weather_am || log.weather || null
  content.weather_pm = log.weather_pm || null
  content.labor = Array.isArray(log.labor) ? log.labor : []
  content.equipment = Array.isArray(log.equipment) ? log.equipment : []
  content.materials = Array.isArray(log.materials) ? log.materials : []
  content.extras = log.extras && typeof log.extras === 'object' ? { ...log.extras } : {}
  content.work_summary = log.work_summary || null
  for (const [key, qty] of Object.entries(log.items || {})) {
    const wi = byKey.get(key)
    const id = wi?.id || key
    content.items[id] = {
      item_key: wi?.item_key ?? key, item_no: wi?.item_no ?? null, description: wi?.description ?? key, unit: wi?.unit ?? null,
      qty_today: qty == null || qty === '' ? null : Number(qty), location: null, note: null,
    }
  }
  const src = `legacy:${log.id}`
  const sources = { log_date: { status: 'filled', source: src } }
  const has = (v) => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '')
  for (const k of DAILY_LOG_FIXED_REQUIRED) {
    sources[k] = has(content[k]) ? { status: 'filled', source: src, reason: '既有紀錄,待核對' } : { status: 'pending', source: null }
  }
  for (const k of DAILY_LOG_EXTRAS_KEYS) {
    if (has(content.extras[k])) sources[`extras.${k}`] = { status: 'filled', source: src }
  }
  for (const [id, it] of Object.entries(content.items)) {
    sources[`items.${id}.qty_today`] = it.qty_today != null
      ? { status: 'filled', source: src, reason: '既有紀錄,待核對' }
      : { status: 'pending', source: null }
  }
  return { content, sources }
}

// Agent 對話起稿(draft_daily_log 工具)的 payload → 文件內容(acceptDraft 改走文件流程用)。
// payload.items 形如 { [work_item_id]: { item_key, item_no, description, unit, qty_today, needs_input } };
// 人填的數量 confirmed,沒填的 pending;其餘欄位有值標 filled(AI 草稿,待核對)。
export function contentFromAgentDraft(payload) {
  const content = emptyDailyLogContent(payload?.log_date)
  content.weather_am = payload?.weather_am || null
  content.weather_pm = payload?.weather_pm || null
  content.labor = Array.isArray(payload?.labor) ? payload.labor : []
  content.equipment = Array.isArray(payload?.equipment) ? payload.equipment : []
  content.materials = Array.isArray(payload?.materials) ? payload.materials : []
  content.extras = payload?.extras && typeof payload.extras === 'object' ? { ...payload.extras } : {}
  content.work_summary = payload?.work_summary || null
  const fs = payload?.field_sources || {}
  const sources = { log_date: { status: 'filled', source: 'ai:agent' } }
  const has = (v) => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '')
  sources.weather_am = has(content.weather_am) ? { status: 'filled', source: fs.weather === 'cwa' ? 'cwa' : 'ai:agent' } : { status: 'pending', source: null }
  sources.weather_pm = has(content.weather_pm) ? { status: 'filled', source: fs.weather === 'cwa' ? 'cwa' : 'ai:agent' } : { status: 'pending', source: null }
  sources.work_summary = has(content.work_summary) ? { status: 'filled', source: 'ai:photo' } : { status: 'pending', source: null }
  for (const k of ['labor', 'equipment', 'materials']) {
    sources[k] = has(content[k]) ? { status: 'filled', source: fs[k] === 'yesterday' ? 'yesterday:agent' : 'ai:agent', reason: '沿用,待核對' } : { status: 'pending', source: null }
  }
  for (const [wid, v] of Object.entries(payload?.items || {})) {
    const qty = Number(v?.qty_today)
    const filled = Number.isFinite(qty) && qty > 0
    content.items[wid] = {
      item_key: v?.item_key ?? null, item_no: v?.item_no ?? null, description: v?.description ?? wid, unit: v?.unit ?? null,
      qty_today: filled ? qty : null, location: v?.location ?? null, note: null,
    }
    sources[`items.${wid}.qty_today`] = filled ? { status: 'confirmed', source: 'human' } : { status: 'pending', source: null, reason: '照片證明有施作,數量待現場確認' }
  }
  return { content, sources }
}

// 內容(items 以 work_items uuid 為鍵)→ 既有頁面／列印看的日誌形狀({ item_key: 數量 })。
// 只給顯示用(公定格式紙本、右欄清單);事實表 daily_logs 只由簽署 RPC 寫。
// item_meta:版本內容裡的工項快照(項次／名稱／單位),列印以它為準——印的是簽署當下的內容,不是之後可能變動的工項表。
// from_document:紙本據此不做舊列的天氣回退(舊流程只有單一 weather 欄;文件版本的上下午天氣各自是簽署內容)。
// sources(版本的 field_sources):數量標「不適用」(na)的工項不是當日數量——與簽署分支 field_document_sign_daily_log_internal
// 寫 daily_log_items 時略過 na 同一條規則(na 只改來源、不清數字,不給 sources 會把 na 列的舊數字印成當日數量,與事實列不一致)。
export function contentToLogShape(content, { id = null, status = null, logDate = null, sources = null } = {}) {
  const items = {}
  const itemMeta = {}
  for (const [wid, it] of Object.entries(content?.items || {})) {
    if (it?.qty_today == null) continue
    if (sources?.[`items.${wid}.qty_today`]?.status === 'na') continue
    const key = it.item_key || wid
    items[key] = Number(it.qty_today)
    itemMeta[key] = { item_no: it.item_no ?? null, description: it.description ?? null, unit: it.unit ?? null, work_item_id: wid }
  }
  return {
    id, log_date: content?.log_date || logDate, status,
    weather: content?.weather_am || null, weather_am: content?.weather_am || null, weather_pm: content?.weather_pm || null,
    labor: content?.labor || [], equipment: content?.equipment || [], materials: content?.materials || [],
    extras: content?.extras || {}, work_summary: content?.work_summary || null, items, item_meta: itemMeta, from_document: true,
  }
}

// ── 監造日誌內容形狀(P3a;鍵與 Edge buildSupervisorLogDraft 同一組)────────────────────
export const SUPERVISOR_LOG_LIST_KEYS = Object.freeze(['attendance', 'supervision_items', 'inspection_ids', 'notices', 'followups'])
export const NOTICE_TO_OPTIONS = Object.freeze([{ value: 'contractor', label: '施工廠商' }, { value: 'owner', label: '機關' }])
export const FOLLOWUP_STATUS_OPTIONS = Object.freeze([{ value: 'open', label: '追蹤中' }, { value: 'closed', label: '已結案' }])
export function emptySupervisorLogContent(date, template = null) {
  return {
    log_date: date, weather_am: null, weather_pm: null,
    attendance: [], supervision_items: [], inspection_ids: [], notices: [], followups: [],
    contractor_summary: null, daily_log_receipt: null, note: null,
    template: template?.key ? { key: template.key, version: template.version ?? 1 } : null,
    photo_ids: [], unmatched_photo_ids: [],
  }
}
// 新文件(沒有任何來源)的 field_sources:範本每個欄位都 pending,只有日期是人選的(confirmed)
export function emptySupervisorLogSources(template) {
  const sources = { log_date: { status: 'confirmed', source: 'human' } }
  for (const f of templateFields(template)) if (f.key !== 'log_date') sources[f.key] = { status: 'pending', source: null }
  return sources
}
// 到場列的合法性(鏡像 DB 簽署分支 PD010;只是 UX 預檢,伺服器仍會再驗):每筆須有姓名或成員 user_id,時段 HH:MM
export function attendanceIssues(rows) {
  const out = []
  ;(Array.isArray(rows) ? rows : []).forEach((r, i) => {
    if (!r || typeof r !== 'object') { out.push({ index: i, reason: '格式不正確' }); return }
    if (!String(r.name || '').trim() && !r.user_id) out.push({ index: i, reason: '須有姓名' })
    for (const k of ['from', 'to']) if (r[k] && !/^\d{2}:\d{2}$/.test(r[k])) out.push({ index: i, reason: `${k === 'from' ? '到場' : '離場'}時間須為 HH:MM` })
  })
  return out
}
// 同日施工日誌文件的現況(getFieldDocument 的回傳)→ Edge／共用組字模組吃的 FormalDailyLog 形狀
export function formalDailyLogFromDetail(detail) {
  if (!detail?.doc) return null
  const ver = Number(detail.doc.current_version_no) || 0
  const at = (action) => (detail.submissions || []).find((x) => x.action === action && Number(x.version_no) === ver)?.created_at ?? null
  const sig = (detail.signatures || []).find((x) => Number(x.version_no) === ver)
  return {
    document_id: detail.doc.id, status: detail.doc.status, version_no: ver,
    content: ver > 0 && detail.version?.version_no === ver ? (detail.version.content || null) : null,
    signed_at: sig?.signed_at ?? null, submitted_at: at('submit'), received_at: at('receive'), returned_at: at('return'),
  }
}
// 引用同日施工日誌(只在已簽署／提送／收件時):摘要標 filled/field_document:<id>:v<n>;收件情形一律更新快照
export function applyFormalDailyLog(state, formal, wiById, { compose, isFormal, receipt, source }) {
  let next = { content: { ...state.content, daily_log_receipt: receipt(formal) }, sources: { ...state.sources, daily_log_receipt: { status: 'filled', source: 'system:field_documents', ...(formal ? { refs: [formal.document_id] } : {}) } } }
  if (!formal || !isFormal(formal)) return { state: next, applied: false }
  const text = compose(formal, wiById)
  if (!text) return { state: next, applied: false }
  next = { content: { ...next.content, contractor_summary: text }, sources: { ...next.sources, contractor_summary: { status: 'filled', source: source(formal), reason: '引用同日已簽署施工日誌,待核對' } } }
  return { state: next, applied: true }
}
// 通知／追蹤引用的單據名稱(顯示用;引用是否存在於本案由簽署 RPC 驗)
export function refTitle(ref, lookups = {}) {
  if (!ref?.ref_type || !ref?.ref_id) return null
  const table = { inspection: lookups.inspections, defect: lookups.defects, rfi: lookups.rfis, submittal: lookups.submittals, field_document: lookups.documents, daily_log: lookups.siteLogs }[ref.ref_type]
  const row = (table || []).find((r) => r.id === ref.ref_id)
  const kind = { inspection: '查驗', defect: '缺失', rfi: '疑義', submittal: '送審', field_document: '文件', daily_log: '施工日誌' }[ref.ref_type] || ref.ref_type
  return row ? `${kind}:${row.title || row.subject || row.log_date || row.id}` : `${kind}:${String(ref.ref_id).slice(0, 8)}`
}

// ── 自主檢查表內容形狀(P3b;鍵與 Edge buildSelfCheckDraft 同一組)────────────────────────
// 新文件:框架欄位由人選(日期／範本／工項=confirmed/human,位置沒填=pending),範本每個項目 pending;不填「合格」。
export function emptySelfCheckContent(date, frame, checklistTemplate, { workItemId = null, location = null } = {}) {
  const results = {}
  for (const it of Array.isArray(checklistTemplate?.items) ? checklistTemplate.items : []) if (it?.no) results[it.no] = { value: null }
  return {
    check_date: date, template_id: checklistTemplate?.id || null, template_title: checklistTemplate?.title || null, template_source: checklistTemplate?.source || null,
    work_item_id: workItemId, location, results, note: null,
    template: frame?.key ? { key: frame.key, version: frame.version ?? 1 } : null,
    photo_ids: [], unmatched_photo_ids: [],
  }
}
export function emptySelfCheckSources(content, checklistTemplate) {
  const sources = { check_date: { status: 'confirmed', source: 'human' }, template_id: { status: 'confirmed', source: 'human' } }
  if (content?.work_item_id) sources.work_item_id = { status: 'confirmed', source: 'human' }
  sources.location = content?.location ? { status: 'confirmed', source: 'human' } : { status: 'pending', source: null }
  for (const it of Array.isArray(checklistTemplate?.items) ? checklistTemplate.items : []) if (it?.no) sources[`results.${it.no}`] = { status: 'pending', source: null }
  return sources
}
// 檢查結果 {no:{value}} → judgeChecklist 要的 {no: value}(前端判定只是預覽,伺服器簽署時以 fn_checklist_judge 為準)
export const selfCheckValues = (content) => Object.fromEntries(Object.entries(content?.results || {}).map(([no, r]) => [no, r?.value ?? null]))
// 換範本:項目全部重來(值與來源一起走),框架欄位保留
export function setSelfCheckTemplate({ content, sources }, checklistTemplate) {
  const next = { ...content, template_id: checklistTemplate?.id || null, template_title: checklistTemplate?.title || null, template_source: checklistTemplate?.source || null, results: {} }
  const nextSources = Object.fromEntries(Object.entries(sources || {}).filter(([k]) => !k.startsWith('results.')))
  nextSources.template_id = { status: 'confirmed', source: 'human' }
  for (const it of Array.isArray(checklistTemplate?.items) ? checklistTemplate.items : []) if (it?.no) { next.results[it.no] = { value: null }; nextSources[`results.${it.no}`] = { status: 'pending', source: null } }
  return { content: next, sources: nextSources }
}

// ── 監造查驗表單內容形狀(P3c;鍵與 Edge buildInspectionFormDraft 同一組)────────────────────────
// 查驗申請資料(工項、位置、階段、申報量、檢附自檢)帶入並標 inspection:<id> 待監造核對;單位取自標單工項;判定與本次確認數量
// 永遠留空 pending,只能由監造親自填(簽署即判定並寫入監造確認紀錄)。
export const INSPECTION_VERDICTS = Object.freeze(['合格', '部分合格', '不合格'])
export const INSPECTION_VERDICT_TONE = Object.freeze({ 合格: 'green', 部分合格: 'amber', 不合格: 'red' })
// 工項的 ITP 必要階段(鏡像 DB fn_cq_required_stages_internal:H 點且 required_for_billing;鍵正規化排序)。
// refs 可同時給 uuid 與 item_key(真 DB 的 inspection_points 帶 work_item_id、示範種子帶 work_item_key)。
export function requiredStagesFor(inspectionPoints = [], refs = []) {
  const wanted = new Set((Array.isArray(refs) ? refs : [refs]).filter(Boolean))
  if (!wanted.size) return []
  const keys = new Set()
  for (const p of inspectionPoints || []) {
    if (!p || p.point_type !== 'H' || p.required_for_billing === false) continue
    if (!(wanted.has(p.work_item_id) || wanted.has(p.work_item_key))) continue
    const k = normalizeCqKey(p.stage_key)
    if (k) keys.add(k)
  }
  return [...keys].sort()
}
export function emptyInspectionFormContent(date, frame, inspection, workItem, { template = null } = {}) {
  const results = {}
  for (const it of Array.isArray(template?.items) ? template.items : []) if (it?.no) results[it.no] = { value: null }
  return {
    inspection_date: date, inspection_id: inspection?.id || null, inspection_title: inspection?.title || null,
    work_item_id: workItem?.id || null, location: inspection?.location || null, stage_key: inspection?.stage_key || null,
    unit: workItem?.unit || '', declared_qty: inspection?.declared_qty ?? null, self_check_record_id: inspection?.checklist_record_id || null,
    template_id: template?.id || null, template_title: template?.title || null, results,
    verdict: null, confirmed_qty: null, result_note: null, note: null,
    template: frame?.key ? { key: frame.key, version: frame.version ?? 1 } : null,
    photo_ids: [], unmatched_photo_ids: [],
  }
}
export function emptyInspectionFormSources(content, { requiredStages = [], template = null } = {}) {
  const ins = content?.inspection_id ? `inspection:${content.inspection_id}` : null
  const fromReq = (reason) => ({ status: 'filled', source: ins, reason })
  const sources = { inspection_date: { status: 'confirmed', source: 'human' } }
  if (ins) { sources.inspection_id = { status: 'filled', source: ins }; sources.work_item_id = { status: 'filled', source: ins } }
  if (content?.unit) sources.unit = { status: 'filled', source: 'system:work_item' }
  sources.location = content?.location ? fromReq('取自查驗申請,請核對後確認(確認數量以此位置累計)') : { status: 'pending', source: null }
  if (requiredStages.length) {
    const k = normalizeCqKey(content?.stage_key)
    sources.stage_key = k && requiredStages.includes(k) ? fromReq('取自查驗申請,請核對後確認')
      : { status: 'pending', source: null, reason: `此工項有必要查驗階段 ${requiredStages.join('、')},請選擇本次查驗的階段` }
  }
  sources.declared_qty = content?.declared_qty != null ? fromReq('取自查驗申請,請核對後確認') : { status: 'pending', source: null, reason: '查驗申請未載明申報數量,請依申請文件填入' }
  if (content?.self_check_record_id) sources.self_check_record_id = { status: 'filled', source: ins }
  if (template) sources.template_id = { status: 'confirmed', source: 'human' }
  for (const it of Array.isArray(template?.items) ? template.items : []) if (it?.no) sources[`results.${it.no}`] = { status: 'pending', source: null }
  sources.verdict = { status: 'pending', source: null, reason: '判定由監造親自勾選' }
  sources.confirmed_qty = { status: 'pending', source: null, reason: '本次確認數量由監造親自填寫' }
  return sources
}
// 換查驗表範本(kind=inspection_form):項目全部重來,其餘欄位保留
export function setInspectionFormTemplate({ content, sources }, template) {
  const next = { ...content, template_id: template?.id || null, template_title: template?.title || null, results: {} }
  const nextSources = Object.fromEntries(Object.entries(sources || {}).filter(([k]) => !k.startsWith('results.') && k !== 'template_id'))
  if (template) nextSources.template_id = { status: 'confirmed', source: 'human' }
  for (const it of Array.isArray(template?.items) ? template.items : []) if (it?.no) { next.results[it.no] = { value: null }; nextSources[`results.${it.no}`] = { status: 'pending', source: null } }
  return { content: next, sources: nextSources }
}
// 判定與確認數量的一致性(鏡像 DB 簽署分支 field_document_sign_inspection_form_internal;存檔前預覽,伺服器簽署時再驗一次為準)
export function inspectionFormIssues(content, { workItem = null, requiredStages = [], judged = null } = {}) {
  const out = []
  const v = content?.verdict || null
  const declared = content?.declared_qty == null ? null : Number(content.declared_qty)
  const confirmed = content?.confirmed_qty == null ? null : Number(content.confirmed_qty)
  if (workItem?.unit && normalizeCqKey(content?.unit) !== normalizeCqKey(workItem.unit)) out.push({ key: 'unit', message: `單位「${content?.unit || ''}」與標單工項單位「${workItem.unit}」不一致，不得簽署` })
  const stage = normalizeCqKey(content?.stage_key)
  if (requiredStages.length && stage && !requiredStages.includes(stage)) out.push({ key: 'stage_key', message: `階段「${content.stage_key}」不在必要查驗階段 ${requiredStages.join('、')} 之中` })
  if (!requiredStages.length && stage) out.push({ key: 'stage_key', message: '此工項沒有必要查驗階段（檢驗停留點無 H 點），不可帶階段' })
  if (v && !INSPECTION_VERDICTS.includes(v)) out.push({ key: 'verdict', message: '判定只能是 合格／部分合格／不合格' })
  if (declared != null && !(Number.isFinite(declared) && declared >= 0)) out.push({ key: 'declared_qty', message: '申報數量須為非負數字' })
  if (confirmed != null) {
    if (!Number.isFinite(confirmed) || confirmed < 0) out.push({ key: 'confirmed_qty', message: '本次確認數量須為非負數字' })
    else if (declared != null && Number.isFinite(declared)) {
      if (confirmed > declared) out.push({ key: 'confirmed_qty', message: `本次確認數量 ${confirmed} 超過申報數量 ${declared}` })
      else if (v === '合格' && confirmed !== declared) out.push({ key: 'confirmed_qty', message: `判定合格時本次確認數量須等於申報數量 ${declared}；未全數通過請判部分合格` })
      else if (v === '部分合格' && !(confirmed > 0 && confirmed < declared)) out.push({ key: 'confirmed_qty', message: `判定部分合格時本次確認數量須大於 0 且小於申報數量 ${declared}` })
      else if (v === '不合格' && confirmed !== 0) out.push({ key: 'confirmed_qty', message: '判定不合格時本次確認數量須為 0' })
    }
  }
  if (v && v !== '合格' && !String(content?.result_note || '').trim()) out.push({ key: 'result_note', message: `判定${v}必須填寫判定說明（作為自動開立缺失的說明）` })
  if (judged?.overall === '不合格' && v === '合格') out.push({ key: 'verdict', message: `查驗項目 ${(judged.failed || []).join('、')} 不合格，不得判定合格` })
  return out
}
// 此工項此批次此階段目前的有效累計確認量(取最新一筆 active;與 DB 累計語意相同):確認紀錄由 store 讀(RLS 成員可讀)
export function currentBatchCum(confirmations = [], { location, stageKey = null } = {}) {
  const batch = normalizeCqKey(location)
  const stage = normalizeCqKey(stageKey) || null
  if (!batch) return null
  const rows = (confirmations || []).filter((c) => c?.status === 'active' && c.batch_key === batch && (c.stage_key || null) === stage)
    .sort((a, b) => String(b.confirmed_at).localeCompare(String(a.confirmed_at)) || String(b.created_at).localeCompare(String(a.created_at)))
  return rows.length ? Number(rows[0].qty_cum) : 0
}

// ── 人工編輯:每次改值同時改來源(值與來源永遠一起走,不會有「值變了、來源還說是 AI」)──
const setPath = (obj, key, value) => {
  const m = /^items\.([^.]+)\.(qty_today|location|note)$/.exec(key)
  if (m) {
    const items = { ...(obj.items || {}) }
    items[m[1]] = { ...(items[m[1]] || {}), [m[2]]: value }
    return { ...obj, items }
  }
  const ex = /^extras\.(.+)$/.exec(key)
  if (ex) return { ...obj, extras: { ...(obj.extras || {}), [ex[1]]: value } }
  // 自檢表檢查項目 results.<no>:值住在 results[no].value(與 Edge／DB 同形狀)
  const r = /^results\.(.+)$/.exec(key)
  if (r) return { ...obj, results: { ...(obj.results || {}), [r[1]]: { ...((obj.results || {})[r[1]] || {}), value } } }
  return { ...obj, [key]: value }
}
const getPath = (obj, key) => {
  const r = /^results\.(.+)$/.exec(key)
  if (r) return obj?.results?.[r[1]]?.value
  return obj?.[key]
}

export function setFieldValue({ content, sources }, key, value) {
  return {
    content: setPath(content, key, value),
    sources: { ...sources, [key]: { status: 'confirmed', source: 'human' } },
  }
}

// AI 帶入的值人核對過:值不動,狀態 filled → confirmed(保留原來源,稽核看得出是 AI 帶入、人確認)
export function confirmField({ content, sources }, key) {
  const prev = sources?.[key]
  if (!prev || prev.status !== 'filled') return { content, sources }
  return { content, sources: { ...sources, [key]: { ...prev, status: 'confirmed' } } }
}

// 「本日無」:na＋reason(reason 空白不算,DB 判待補);清單型欄位同時清空、文字欄清成 null
// (DB 簽署時到場 na 而陣列非空、廠商未施工卻留著摘要都是矛盾,值與來源必須一起走)
export function setFieldNa({ content, sources }, key, reason) {
  const r = String(reason || '').trim()
  const cur = getPath(content, key)
  const cleared = Array.isArray(cur) ? setPath(content, key, []) : (typeof cur === 'string' || key.startsWith('results.')) ? setPath(content, key, null) : content
  return {
    content: cleared,
    sources: { ...sources, [key]: { status: 'na', source: null, reason: r || undefined } },
  }
}

// 人填欄(範本 human_only;監造日誌到場):人填了也只是 filled=待親自確認,不會像一般欄位改值即 confirmed;
// 之後按「確認」(confirmField)才 confirmed;確認後再改,回到待確認。空清單=pending(不假裝有到場)。
export function fillHumanField({ content, sources }, key, value) {
  const empty = Array.isArray(value) ? value.length === 0 : value == null || value === ''
  return {
    content: setPath(content, key, value),
    sources: { ...sources, [key]: empty ? { status: 'pending', source: null } : { status: 'filled', source: 'human' } },
  }
}

export function addItemRow({ content, sources }, wi) {
  if (!wi?.id && !wi?.item_key) return { content, sources }
  const id = wi.id || wi.item_key
  if (content.items?.[id]) return { content, sources }
  const items = { ...(content.items || {}), [id]: {
    item_key: wi.item_key ?? null, item_no: wi.item_no ?? null, description: wi.description ?? '', unit: wi.unit ?? null,
    qty_today: null, location: null, note: null,
  } }
  return { content: { ...content, items }, sources: { ...sources, [`items.${id}.qty_today`]: { status: 'pending', source: null } } }
}

export function removeItemRow({ content, sources }, id) {
  const items = { ...(content.items || {}) }
  delete items[id]
  const next = { ...sources }
  for (const k of Object.keys(next)) if (k.startsWith(`items.${id}.`)) delete next[k]
  return { content: { ...content, items }, sources: next }
}

// AI 建議(agent_actions kind=suggest_field_update 的 evidence.suggestion)套進目前草稿:
// 只補「目前仍 pending／缺鍵」且建議 filled 的欄位,絕不覆蓋人填(confirmed)或人已標不適用的;
// 工項列只加不減;附件以 photo_id 聯集。回傳套用了哪些鍵供人看。
export function applySuggestion(state, suggestion) {
  if (!suggestion?.content) return { state, applied: [] }
  let { content, sources } = state
  const applied = []
  const sug = suggestion.field_sources || {}
  const take = (key, value) => {
    const cur = sources?.[key]
    if (cur && cur.status !== 'pending') return
    if (sug[key]?.status !== 'filled') return
    content = setPath(content, key, value)
    sources = { ...sources, [key]: { ...sug[key] } }
    applied.push(key)
  }
  // 頂層欄位逐鍵(三類共用);日期／範本／照片清單不是欄位,items／extras 另處理;自檢表 results 永遠不由建議帶入(實測值只能人填)
  for (const [k, v] of Object.entries(suggestion.content)) {
    if (['log_date', 'check_date', 'template', 'template_id', 'template_title', 'template_source', 'items', 'extras', 'results', 'photo_ids', 'unmatched_photo_ids'].includes(k)) continue
    if (v != null) take(k, v)
  }
  for (const [k, v] of Object.entries(suggestion.content.extras || {})) take(`extras.${k}`, v)
  for (const [wid, it] of Object.entries(suggestion.content.items || {})) {
    if (!content.items?.[wid]) {
      content = { ...content, items: { ...(content.items || {}), [wid]: { ...it, qty_today: null, location: it.location ?? null } } }
      sources = { ...sources, [`items.${wid}.qty_today`]: { status: 'pending', source: null } }
      applied.push(`items.${wid}`)
    }
    if (it.qty_today != null) take(`items.${wid}.qty_today`, it.qty_today)
    if (it.location) take(`items.${wid}.location`, it.location)
  }
  const photoIds = new Set([...(content.photo_ids || []), ...(suggestion.content.photo_ids || [])])
  content = { ...content, photo_ids: [...photoIds] }
  return { state: { content, sources }, applied }
}

export function mergeAttachments(current = [], incoming = []) {
  const byId = new Map(current.map((a) => [a.photo_id, a]))
  for (const a of incoming) if (a?.photo_id && !byId.has(a.photo_id)) byId.set(a.photo_id, a)
  return [...byId.values()]
}

// recheck 裡的附件問題([{key:'attachments.<photo_id>', status}])→ photo_id → 說明
export const ATTACHMENT_ISSUE_LABEL = Object.freeze({
  uploader_unknown: '上傳方不明的舊照片,不能當施作證據', not_found: '照片不存在或不在本案', invalid: '附件格式不正確',
  invalid_role: '附件角色不正確',
})
export function attachmentIssues(recheck = []) {
  const out = new Map()
  for (const r of Array.isArray(recheck) ? recheck : []) {
    const m = /^attachments\.(.+)$/.exec(r?.key || '')
    if (!m) continue
    const st = String(r.status || '')
    const label = st.startsWith('uploader_org:')
      ? `${ORG_LABEL[st.slice('uploader_org:'.length)] || '他方'}上傳的照片,只能以「參考」附上`
      : (ATTACHMENT_ISSUE_LABEL[st] || st)
    out.set(m[1], label)
  }
  return out
}

// ── 文件狀態文案(依觀看者角色與文書類型) ─────────────────────────────────────
export const DOC_STATUS_LABEL = Object.freeze({
  draft: '草稿', pending_input: '待補件', in_review: '內部核對中', signed: '已簽署', submitted: '已提送',
  received: '對方已收件', returned: '已退回', discarded: '已捨棄', superseded: '已取代',
})
// 提送對象(P2d 對象矩陣;單一來源 ballInCourtRules.FIELD_DOC_TO_ORGS 鏡像 DB fn_field_document_to_org_allowed,Vitest 對 migration 釘住):
// 施工日誌／自檢→監造、監造日誌→機關、監造查驗表單→廠商(第一順位,判定與缺失的相對人)＋機關(備查);多對象各自提送、各自收件
export const TO_ORGS_BY_DOC_TYPE = FIELD_DOC_TO_ORGS
export const TO_ORG_BY_DOC_TYPE = Object.freeze(Object.fromEntries(Object.entries(FIELD_DOC_TO_ORGS).map(([k, v]) => [k, v[0]])))
export const ORG_LABEL = Object.freeze({ contractor: '施工廠商', supervisor: '監造', owner: '機關' })
export const docToOrgs = (doc) => TO_ORGS_BY_DOC_TYPE[doc?.doc_type] || []
export const docToOrg = (doc) => docToOrgs(doc)[0] || null
export const docToOrgLabel = (doc) => docToOrgs(doc).map((o) => ORG_LABEL[o]).join('／') || '對方'
// 文件頁路由(四類皆有頁面;/site 清單與今日工作直達)
export const DOC_PAGE_PATH = Object.freeze({ daily_log: '/site-log', supervisor_log: '/supervisor-log', self_check: '/self-check', inspection_form: '/inspection-form' })
export const docPagePath = (docType) => DOC_PAGE_PATH[docType] || null
export const docPageLink = (doc) => (docPagePath(doc?.doc_type) && doc?.id ? `${docPagePath(doc.doc_type)}?doc=${encodeURIComponent(doc.id)}` : null)

export function docStatusMeta(doc, viewerOrg) {
  const s = doc?.status
  const owner = doc?.owner_org
  const mine = owner === viewerOrg
  const tos = docToOrgs(doc)
  const toLabel = docToOrgLabel(doc)
  const pendingCount = Array.isArray(doc?.recheck) ? doc.recheck.length : 0
  switch (s) {
    case 'pending_input': return { label: `待補 ${pendingCount || ''}`.trim(), tone: 'amber', action: mine ? '補齊後簽署' : null }
    case 'draft': return { label: '草稿・可簽署', tone: 'blue', action: mine ? '審核後簽署' : null }
    case 'in_review': return { label: '內部核對中', tone: 'blue', action: mine ? '核對後簽署' : null }
    case 'signed': return { label: '已簽署・待提送', tone: 'green', action: mine ? `提送給${toLabel}` : null }
    case 'submitted': return { label: '已提送・待收件', tone: 'blue', action: !mine && tos.includes(viewerOrg) ? '收件或退回' : null }
    case 'received': return { label: `${tos.length > 1 ? '對方' : toLabel}已收件`, tone: 'green', action: null }
    case 'returned': return { label: '已退回', tone: 'red', action: mine ? '補正後重新簽署' : null }
    case 'discarded': return { label: '已捨棄', tone: 'slate', action: null }
    case 'superseded': return { label: '已取代', tone: 'slate', action: null }
    default: return { label: s || '—', tone: 'slate', action: null }
  }
}

export const formatHash = (h) => (h ? String(h).slice(0, 12) : '—')

// ── 列印版本與提送回執(P3d;四類共用。只挑選／排列伺服器列,不重算雜湊、差異或狀態)────────────
export const SIGN_METHOD_LABEL = Object.freeze({ platform_account: '平台帳號', paper_scan: '紙本簽回掃描' })

// 列印印「簽署列指向的版本」:簽署列 append-only,一個版本只會有一位簽署者(他人再簽＝PD008),簽後更正在較新版本上
// 再簽——取版本號最大的一筆(同版本取伺服器時間較晚者)。沒有簽署列回 null＝草稿(印最新存檔版本並整張標草稿・未簽署)。
export function printSignature(signatures = []) {
  let best = null
  for (const s of signatures || []) {
    if (!s) continue
    const dv = Number(s.version_no) - Number(best?.version_no)
    if (!best || dv > 0 || (dv === 0 && String(s.signed_at) > String(best.signed_at))) best = s
  }
  return best
}

// ── 已簽署版本的重用(P6a:施工月報／監造月報／估驗佐證包只彙整已簽署資料)──────────────────────
// 事實列(daily_logs／supervisor_logs／checklist_records／inspections)只由簽署 RPC 以被簽的版本內容寫入,簽署後的事實列只有
// 簽署交易能改(fn_field_document_fact_guard)——所以一列事實「目前的內容」＝指向它(target_id)的文件中最晚一次簽署的那個版本;
// 沒有任何簽署列指向的事實列＝未簽署(舊流程寫入或直接寫入),報表不列入。與 DB fn_field_document_target_signed 同一個定義。
// rows:store listSignedVersions 回的簽署列,每列帶所屬文件的 doc_type／doc_date／doc_status／target_id(含已被新文件取代的
// 舊文件——新文件簽署前,事實列仍是舊文件的版本)。
// pinAt(ISO 時間,可選):只看該時點(含)以前的簽署——已送審的佐證包保留送審當時使用的版本;之後的簽署記在 newer。
// 回傳 Map(target_id → { document_id, doc_type, doc_date, doc_status, target_id, version_no, content_hash, signed_at,
//   signer_name, latest_of_doc(此版本是否為該文件目前列印的簽署版本), newer({document_id, version_no, signed_at}|null) })。
const tsOf = (s) => {
  if (s == null) return null
  const t = Date.parse(String(s).replace(/(\.\d{3})\d+/, '$1')) // Postgres 微秒截到毫秒,Date.parse 才穩定
  return Number.isFinite(t) ? t : null
}
export function signedVersionIndex(rows = [], { pinAt = null } = {}) {
  const pin = pinAt == null ? null : tsOf(pinAt)
  const latestByDoc = new Map()
  const byTarget = new Map()
  for (const r of rows || []) {
    if (!r?.document_id || !r.target_id || tsOf(r.signed_at) == null) continue
    const v = Number(r.version_no)
    if (!(latestByDoc.get(r.document_id) >= v)) latestByDoc.set(r.document_id, v)
    if (!byTarget.has(r.target_id)) byTarget.set(r.target_id, [])
    byTarget.get(r.target_id).push(r)
  }
  const out = new Map()
  for (const [target, list] of byTarget) {
    const sorted = list.slice().sort((a, b) => (tsOf(a.signed_at) - tsOf(b.signed_at)) || (Number(a.version_no) - Number(b.version_no)))
    let chosen = null, newer = null
    for (const r of sorted) {
      if (pin == null || tsOf(r.signed_at) <= pin) chosen = r
      else if (!newer) newer = r
    }
    if (!chosen) continue // 該時點以前沒有任何簽署=當時未簽署
    out.set(target, {
      document_id: chosen.document_id, doc_type: chosen.doc_type, doc_date: chosen.doc_date, doc_status: chosen.doc_status,
      target_id: target, version_no: Number(chosen.version_no), content_hash: chosen.content_hash || null,
      signed_at: chosen.signed_at, signer_name: chosen.signer_name_snapshot || null,
      latest_of_doc: latestByDoc.get(chosen.document_id) === Number(chosen.version_no),
      newer: newer ? { document_id: newer.document_id, version_no: Number(newer.version_no), signed_at: newer.signed_at } : null,
    })
  }
  return out
}

// 版本標示(報表／紙本都印得出來):文件短碼、版本、內容雜湊前 12 碼(DB 值)。
export const signedVersionText = (ref) => (ref ? `文件 ${String(ref.document_id).slice(0, 8)} v${ref.version_no}・雜湊 ${formatHash(ref.content_hash)}` : '')

// 監造確認紀錄(inspection_confirmations)指向的查驗表單版本 → 版本標示用的 ref。確認紀錄 append-only,記的是簽署當下的
// document_id／document_version_no／content_hash;formIndex(inspection_form 的 signedVersionIndex,target=查驗 id)只用來判斷
// 這個版本是否仍是該表單目前列印的簽署版本(撤銷後重簽的舊確認指向舊版本,不給會印出新版本的連結)。監造確認單沒有文件,回 null。
export function confirmationDocRef(c, formIndex = new Map()) {
  if (!c?.document_id || c.document_version_no == null) return null
  const cur = c.inspection_id ? formIndex.get(c.inspection_id) : null
  const v = Number(c.document_version_no)
  return {
    document_id: c.document_id, doc_type: 'inspection_form', version_no: v, content_hash: c.content_hash || null,
    latest_of_doc: !!cur && cur.document_id === c.document_id && cur.version_no === v && cur.latest_of_doc,
  }
}

// 各類文書的列印頁(印「該文件目前的簽署版本」,即 printSignature)
export const DOC_PRINT_PATH = Object.freeze({ daily_log: '/site-log/print', supervisor_log: '/supervisor-log/print', self_check: '/self-check/print', inspection_form: '/inspection-form/print' })
// 可直達的列印連結:只有「這個版本就是該文件目前列印的簽署版本」且文件仍在本案活文件清單(列印頁只找得到活文件)時才給;
// 否則回 null,呼叫端只印版本標示——連到會印出別的版本的頁面,比沒有連結更糟。
export function signedVersionLink(ref, openDocIds) {
  if (!ref?.latest_of_doc || !DOC_PRINT_PATH[ref.doc_type] || !openDocIds?.has?.(ref.document_id)) return null
  return `${DOC_PRINT_PATH[ref.doc_type]}?doc=${encodeURIComponent(ref.document_id)}`
}

// 提送列依伺服器時間由舊到新(同時間以 id 穩定排序);getFieldDocument 回的是新→舊
const bySubmittedAt = (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id))
export const submissionsChronological = (submissions = []) => (submissions || []).filter(Boolean).slice().sort(bySubmittedAt)

// 提送回執:最近一輪送件(最新一筆 submit 列的版本)的每一筆 submit 列(監造查驗表單同版本可送兩個對象),
// 各配上該對象方對同版本最後一次回應(receive／return;收件後仍可退回,取最後一筆)。沒送過回 []。
export function submissionReceipts(submissions = []) {
  const rows = submissionsChronological(submissions)
  const newestFirst = rows.slice().reverse()
  const last = newestFirst.find((r) => r.action === 'submit')
  if (!last) return []
  return rows.filter((r) => r.action === 'submit' && Number(r.version_no) === Number(last.version_no)).map((submit) => ({
    submit,
    response: newestFirst.find((r) => (r.action === 'receive' || r.action === 'return') && Number(r.version_no) === Number(submit.version_no)
      && r.actor_org === submit.to_org && bySubmittedAt(r, submit) > 0) || null,
  }))
}

// 退回歷史:每一筆 return 列依時間由舊到新全部列出(不只最新一筆),配上其後第一筆「相對此退回版本」的再送列——
// 再送列的 diff({against_version_no, changed_keys})由 DB trigger 比對退回版本與再送版本算好,這裡只配對不重算。
// 尚未補正再送者 resubmit=null。
export function returnHistory(submissions = []) {
  const rows = submissionsChronological(submissions)
  return rows.filter((r) => r.action === 'return').map((ret) => ({
    ...ret,
    resubmit: rows.find((r) => r.action === 'submit' && r.diff && Number(r.diff.against_version_no) === Number(ret.version_no) && bySubmittedAt(r, ret) > 0) || null,
  }))
}

// 下一責任方:與今日工作球權同一支判定(ballInCourtRules.fieldDocumentBalls),不在呈現層另寫狀態規則。
export function nextResponsibleText(doc, submissions = []) {
  const balls = fieldDocumentBalls(doc, submissions)
  const open = balls.filter((b) => b.who !== 'done')
  if (!open.length) return `無（${DOC_STATUS_LABEL[balls[0]?.label] || balls[0]?.label || '流程已結束'}）`
  return open.map((b) => `${ORG_LABEL[b.who] || '待補設定'}（${b.label}）`).join('、')
}

// 簽署意願聲明:簽署當下畫面顯示的同一段,原樣送進 RPC(field_document_signatures.intent)
export function signIntentText({ docLabel = '施工日誌', docDate, versionNo, contentHash }) {
  return `本人確認 ${docDate} ${docLabel}(版本 ${versionNo},內容雜湊 ${formatHash(contentHash)})內容屬實,同意以本人登入的平台帳號簽署本文件。`
}

// ── 送件重試的 client_request_id:同一件事重試用同一個 id(伺服器冪等回同一張回執)──
// 存在 sessionStorage(重新整理仍在;換分頁／裝置由 RPC 的自然鍵冪等兜底)。
const REQ_PREFIX = 'pmis-fd-req:'
export function submissionRequestId({ documentId, versionNo, action, reason = '' }, storage = safeSessionStorage(), uuid = randomUuid) {
  const key = `${REQ_PREFIX}${documentId}:${versionNo}:${action}:${reason}`
  const existing = storage?.getItem?.(key)
  if (existing) return existing
  const id = uuid()
  try { storage?.setItem?.(key, id) } catch { /* 存不進去也不影響:自然鍵冪等仍在 */ }
  return id
}
export function clearSubmissionRequestId({ documentId, versionNo, action, reason = '' }, storage = safeSessionStorage()) {
  try { storage?.removeItem?.(`${REQ_PREFIX}${documentId}:${versionNo}:${action}:${reason}`) } catch { /* noop */ }
}
function safeSessionStorage() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null }
}
function randomUuid() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// ── 錯誤碼分流(P2d SQLSTATE PD001–PD010;設計 §5 表)──────────────────────────
// 回 { kind, message, details }:kind 決定前端動作——reload(畫面是舊版,重新載入、不默默覆蓋)、
// pending(待補欄高亮)、attachments(附件角色)、request_id(換新 id)…PD003(兩步驟驗證)已於 R1 廢止,不再有分支。
export function fieldDocErrorGuidance(error) {
  const code = String(error?.code || '')
  const message = error?.message || '操作未完成'
  let details = null
  if (error?.details) {
    try { details = JSON.parse(error.details) } catch { details = null }
  }
  switch (code) {
    case 'PD001': return { kind: 'reload', message, details }
    case 'PD002': return { kind: 'reload', message, details }
    case 'PD004': return { kind: 'pending', message, details: Array.isArray(details) ? details : [] }
    case 'PD005': return { kind: 'attachments', message, details: Array.isArray(details) ? details : [] }
    case 'PD006': return { kind: 'forbidden', message, details }
    case 'PD007': return { kind: 'unsupported', message, details }
    case 'PD008': return { kind: 'state', message, details }
    case 'PD009': return { kind: 'request_id', message, details }
    case 'PD010': return { kind: 'invalid', message, details }
    default: return { kind: 'unknown', message, details }
  }
}

// 施工日誌內容雜湊的來源說明(前端不重算;只顯示 DB 算好的值)
export async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer()
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 版本之間頂層鍵的差異(退回再送的 diff 由 DB 算;這裡只給人看的預覽)
export function changedKeysLabel(diff, content, labels = null) {
  const keys = Array.isArray(diff?.changed_keys) ? diff.changed_keys : []
  return keys.map((k) => fieldLabel(k, content, labels))
}
