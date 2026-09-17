// 現場文書(P2c;D-026 第一條完整路徑)的純函式層:上傳批次狀態機、恢復、欄位來源狀態、
// 施工日誌內容形狀、簽署／提送的錯誤碼分流、送件重試的 client_request_id。
// 全部確定性、無 IO、無 React——store slice 與頁面都吃這一份,vitest 直接測。
//
// 內容形狀與 Edge 起稿(supabase/functions/_shared/fieldDocDraft.ts buildDailyLogDraft)同一組鍵;
// 必填鍵與待補判定鏡像 DB 的 fn_field_document_required_fields／fn_field_document_unmet_fields
// (migration 20260917205000)——這裡只是「存檔前先讓人看到哪些還缺」的預覽,伺服器存版時會
// 再算一次並寫回 field_documents.required_fields／recheck,以伺服器為準。
//
// 誠實原則(設計 §1.5):沒有來源的數量、天氣、出工一律 pending;人填了才 confirmed;
// 「本日無」用 na＋reason,不得把空白填成「無」或 0。

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
export const FIELD_LABEL = Object.freeze({
  log_date: '日期', weather_am: '天氣(上午)', weather_pm: '天氣(下午)', work_summary: '工作摘要',
  labor: '出工人數', equipment: '機具使用', materials: '材料使用',
  'extras.technicians': '應置技術士', 'extras.edu': '勤前教育', 'extras.insured': '新進勞工提報勞保', 'extras.ppe': '檢查個人防護具',
  'extras.safety_other': '其他安衛事項', 'extras.sampling': '施工取樣試驗紀錄', 'extras.notice': '通知協力廠商辦理事項', 'extras.important': '重要事項紀錄',
})

// 必填鍵=固定欄 ∪ 內容各工項的當日數量(鏡像 DB;stored 的工項鍵一律忽略、由內容重算)
export function requiredKeysFor(content, stored = []) {
  const keys = new Set()
  for (const k of Array.isArray(stored) ? stored : []) {
    if (typeof k === 'string' && k.trim() && !/^items\..+\.qty_today$/.test(k)) keys.add(k)
  }
  for (const k of DAILY_LOG_FIXED_REQUIRED) keys.add(k)
  for (const wid of Object.keys(content?.items || {})) keys.add(`items.${wid}.qty_today`)
  return [...keys].sort()
}

// 待補清單 [{key,status}](鏡像 DB fn_field_document_unmet_fields)
export function unmetFields(required, sources) {
  const out = []
  for (const k of required) {
    const src = sources?.[k]
    if (!src || typeof src !== 'object') { out.push({ key: k, status: 'missing' }); continue }
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

export function fieldLabel(key, content) {
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
export function contentToLogShape(content, { id = null, status = null } = {}) {
  const items = {}
  for (const [wid, it] of Object.entries(content?.items || {})) {
    if (it?.qty_today == null) continue
    items[it.item_key || wid] = Number(it.qty_today)
  }
  return {
    id, log_date: content?.log_date, status,
    weather: content?.weather_am || null, weather_am: content?.weather_am || null, weather_pm: content?.weather_pm || null,
    labor: content?.labor || [], equipment: content?.equipment || [], materials: content?.materials || [],
    extras: content?.extras || {}, work_summary: content?.work_summary || null, items,
  }
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
  return { ...obj, [key]: value }
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

// 「本日無」:na＋reason(reason 空白不算,DB 判待補);清單型欄位同時清空值
export function setFieldNa({ content, sources }, key, reason) {
  const r = String(reason || '').trim()
  const isList = ['labor', 'equipment', 'materials'].includes(key)
  return {
    content: isList ? setPath(content, key, []) : content,
    sources: { ...sources, [key]: { status: 'na', source: null, reason: r || undefined } },
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
  for (const k of ['weather_am', 'weather_pm', 'work_summary', 'labor', 'equipment', 'materials']) {
    if (suggestion.content[k] != null) take(k, suggestion.content[k])
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
      ? `${st.slice('uploader_org:'.length) === 'supervisor' ? '監造' : '他方'}上傳的照片,只能以「參考」附上`
      : (ATTACHMENT_ISSUE_LABEL[st] || st)
    out.set(m[1], label)
  }
  return out
}

// ── 文件狀態文案(依觀看者角色) ──────────────────────────────────────────────
export const DOC_STATUS_LABEL = Object.freeze({
  draft: '草稿', pending_input: '待補件', in_review: '內部核對中', signed: '已簽署', submitted: '已提送',
  received: '對方已收件', returned: '已退回', discarded: '已捨棄', superseded: '已取代',
})
export function docStatusMeta(doc, viewerOrg) {
  const s = doc?.status
  const owner = doc?.owner_org
  const mine = owner === viewerOrg
  const pendingCount = Array.isArray(doc?.recheck) ? doc.recheck.length : 0
  switch (s) {
    case 'pending_input': return { label: `待補 ${pendingCount || ''}`.trim(), tone: 'amber', action: mine ? '補齊後簽署' : null }
    case 'draft': return { label: '草稿・可簽署', tone: 'blue', action: mine ? '審核後簽署' : null }
    case 'in_review': return { label: '內部核對中', tone: 'blue', action: mine ? '核對後簽署' : null }
    case 'signed': return { label: '已簽署・待提送', tone: 'green', action: mine ? '提送給監造' : null }
    case 'submitted': return { label: '已提送・待收件', tone: 'blue', action: !mine && viewerOrg === 'supervisor' ? '收件或退回' : null }
    case 'received': return { label: '監造已收件', tone: 'green', action: null }
    case 'returned': return { label: '已退回', tone: 'red', action: mine ? '補正後重新簽署' : null }
    case 'discarded': return { label: '已捨棄', tone: 'slate', action: null }
    case 'superseded': return { label: '已取代', tone: 'slate', action: null }
    default: return { label: s || '—', tone: 'slate', action: null }
  }
}

// 提送對象(P2d 對象矩陣):施工日誌只能送監造
export const TO_ORG_BY_DOC_TYPE = Object.freeze({ daily_log: 'supervisor', self_check: 'supervisor', supervisor_log: 'owner', inspection_form: 'contractor' })
export const ORG_LABEL = Object.freeze({ contractor: '施工廠商', supervisor: '監造', owner: '機關' })

export const formatHash = (h) => (h ? String(h).slice(0, 12) : '—')

// 簽署意願聲明:簽署當下畫面顯示的同一段,原樣送進 RPC(field_document_signatures.intent)
export function signIntentText({ docLabel = '施工日誌', docDate, versionNo, contentHash }) {
  return `本人確認 ${docDate} ${docLabel}(版本 ${versionNo},內容雜湊 ${formatHash(contentHash)})內容屬實,同意以平台帳號及兩步驟驗證簽署本文件。`
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
// mfa(引導兩步驟驗證)、pending(待補欄高亮)、attachments(附件角色)、request_id(換新 id)…
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
    case 'PD003': return { kind: 'mfa', message, details }
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
export function changedKeysLabel(diff, content) {
  const keys = Array.isArray(diff?.changed_keys) ? diff.changed_keys : []
  return keys.map((k) => fieldLabel(k, content))
}
