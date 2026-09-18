// 現場文書起稿的純規則(P2b／P3a;設計 docs/architecture/field-documents-lifecycle.md §2.3、§3)。
// ---------------------------------------------------------------------------
// 全部確定性、無 IO、無 npm 依賴——vitest 直接測。這裡決定三件事:
//   1. 一批照片各屬哪一天(告示板日期 > 使用者指定的批次日期 > 拍攝時間的台北日曆日)、
//      哪些是重複照片(同批同雜湊)。
//   2. 依上傳方角色推斷「候選文書」:廠商→施工日誌(P2b)＋自主檢查表(P3b,列為尚未支援);
//      監造→監造日誌(P3a)＋監造查驗表單(P3c,列為尚未支援);機關→無。**廠商照片永遠推不出
//      監造文件,反之亦然**(DB guard 另有一道)。
//   3. 草稿的內容與每欄來源(field_sources):
//      * 沒有來源的數量、天氣、出工、到場一律 pending(待補);絕不填「無」「0」「合格」。
//      * 告示板清楚可讀才把數量／位置／日期／天氣標 filled 並附 source: whiteboard:<photo_id>;
//        同一工項多張板子數字不一致→pending 並列入 recheck,不挑一個。
//      * 出工／機具／材料沿用當日既有日誌(legacy)或昨日日誌(yesterday),標 filled 待核對。
//      * 天氣:告示板 > 當日既有日誌 > 中央氣象署(cwa);都沒有→pending。
//      * 摘要由各張照片的 AI 說明確定性拼接(不再打一次模型:說明本身已是模型輸出,
//        再餵給第二個 prompt 只會多一條把板上文字當指令的路)。
//      * 照片能證明「有施作」不能證明「做了多少」:配到工項只加列,數量仍 pending。
//      * 監造日誌(P3a):監造事項只從監造自己的照片與當日查驗紀錄整理;查驗／通知／追蹤只從系統
//        既有紀錄帶入並逐項標來源;廠商施工情形只引用同日已簽署／已提送的施工日誌文件。
//        **到場人員永遠 pending、內容留空**——任何照片(含監造自己的)都不能證明到場,只能人填
//        (DB 版本 guard 同樣拒絕 AI 版本帶入;簽署時須 confirmed)。
// 版本雜湊由 DB 算(fn_field_document_content_hash);這裡只比對 content 是否相同,
// 用的是 stableStringify(與 agent.ts 同一支),不重算雜湊、不做第二個引擎。

import { formatDate, parseDateUTC, taipeiTodayUTC } from './contractDue.ts'
import { stableStringify } from './agent.ts'
import { matchLeaf } from './photoMatch.ts'
import { FIELD_DOC_TYPE_LABELS } from './ballInCourtRules.ts'
import { FORMAL_DAILY_LOG_STATUSES, composeContractorSummary, dailyLogReceipt, formalDailyLogSource } from './fieldDocText.ts'
import type { SitePhotoResult, WhiteboardResult } from './sitePhotoVision.ts'

export const DAY_MS = 86400000
export { FIELD_DOC_TYPE_LABELS }

export type UploaderOrg = 'contractor' | 'supervisor' | 'owner'
export type DocType = 'daily_log' | 'supervisor_log' | 'self_check' | 'inspection_form'
export type PhotoAiStatus = 'pending' | 'done' | 'failed' | 'not_site' | 'unreadable' | 'duplicate'

export type LeafWorkItem = {
  id: string
  item_key: string | null
  item_no: string | null
  description: string
  unit: string | null
  sort_order: number | null
}

// 起稿端看到的一張照片(photos 列＋辨識結果)
export type DraftPhoto = {
  id: string
  storage_path: string
  content_sha256: string | null
  work_item_id: string | null
  caption: string | null
  location: string | null
  taken_at: string | null
  created_at: string
  classify: SitePhotoResult | null
  whiteboard: WhiteboardResult | null
  whiteboardSkipped: string | null // 'feature_disabled' | 'failed:<code>' | null
}

export type FieldSourceStatus = 'filled' | 'pending' | 'na' | 'confirmed'
export type FieldSource = {
  status: FieldSourceStatus
  source: string | null // 'whiteboard:<photo_id>' | 'photo_time:<photo_id>' | 'intake' | 'cwa' | 'legacy:<daily_log_id>' | 'yesterday:<daily_log_id>' | 'ai:photo'
  refs?: string[]
  reason?: string
}

// ── 日期 ─────────────────────────────────────────────────────────────────────
export function validDate(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const ms = parseDateUTC(s)
  return ms != null && formatDate(ms) === s ? s : null
}

// timestamptz → 台北日曆日(全站業務日期原則)
export function taipeiDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return formatDate(taipeiTodayUTC(ms))
}

export const previousDate = (date: string): string => formatDate(parseDateUTC(date)! - DAY_MS)

// timestamptz → 台北時刻 HH:MM(監造事項的時間欄)
export function taipeiTimeOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const t = new Date(ms + 8 * 3600000)
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
}

// 台北日曆日對應的 UTC 半開區間 [start, end),查「當日」的 timestamptz 紀錄用
export function taipeiDayRange(date: string): { start: string; end: string } {
  const startMs = parseDateUTC(date)! - 8 * 3600000
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + DAY_MS).toISOString() }
}

export type PhotoDate = {
  date: string | null
  source: 'whiteboard' | 'intake' | 'photo_time' | null
  ref: string | null // 來源照片 id(whiteboard／photo_time)
  conflict: string | null // 告示板日期與拍攝日不同時的說明(仍以告示板為準,但要列入 recheck)
}

// 優先序:告示板日期(現場自己寫的)> 使用者指定的批次日期 > 拍攝時間的台北日。
// taken_at 沒 EXIF 時是上傳時刻(site.js uploadSitePhoto),所以排在使用者指定之後。
export function assignPhotoDate(
  photo: { id: string; taken_at: string | null },
  board: WhiteboardResult | null,
  intakeLogDate: string | null,
): PhotoDate {
  const boardDate = validDate(board?.log_date)
  const takenDate = taipeiDateOf(photo.taken_at)
  if (boardDate) {
    const conflict = takenDate && takenDate !== boardDate
      ? `告示板日期 ${boardDate} 與照片時間 ${takenDate} 不同,已依告示板`
      : null
    return { date: boardDate, source: 'whiteboard', ref: photo.id, conflict }
  }
  if (intakeLogDate) return { date: intakeLogDate, source: 'intake', ref: null, conflict: null }
  if (takenDate) return { date: takenDate, source: 'photo_time', ref: photo.id, conflict: null }
  return { date: null, source: null, ref: null, conflict: null }
}

// ── 重複照片:同批同雜湊,最早上傳的一張是正本,其餘標 duplicate(仍保存不刪)──
export function duplicateGroups(
  photos: { id: string; content_sha256: string | null; created_at: string }[],
): Map<string, string> {
  const canonical = new Map<string, string>() // sha → 正本 id
  const dups = new Map<string, string>()      // 重複 id → 正本 id
  const sorted = [...photos].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
  for (const p of sorted) {
    if (!p.content_sha256) continue
    const first = canonical.get(p.content_sha256)
    if (!first) canonical.set(p.content_sha256, p.id)
    else dups.set(p.id, first)
  }
  return dups
}

// ── 候選文書(確定性規則,不由模型決定) ─────────────────────────────────────
export type CandidateState =
  | 'ready'        // 可起稿(daily_log、supervisor_log)
  | 'blocked'      // 缺必要資料(blocked_by 列出),不建文件
  | 'unsupported'  // 需要但本輪尚未支援(P3b／P3c)
  | 'excluded'     // 使用者排除
  | 'drafted'      // 已建立文件／新增 AI 版本
  | 'unchanged'    // 重跑內容相同,未新增版本
  | 'suggested'    // 已有人工版本,只留建議(agent_actions)
  | 'locked'       // 該日文件已簽署／提送,不動
  | 'error'        // 寫入失敗(reason 說明,可重試)

export type Candidate = {
  doc_type: DocType
  target_key: string | null
  doc_date: string | null
  state: CandidateState
  support: 'supported' | 'unsupported'
  reason: string
  excluded: boolean
  photo_ids: string[]
  document_id: string | null
  blocked_by?: string[]
}

export type OpenInspection = {
  id: string
  title: string | null
  work_item_id: string | null
  requested_date: string | null
}

export function inferCandidates(input: {
  uploaderOrg: string
  sitePhotos: { id: string; date: string | null; work_item_id: string | null }[] // 已辨識為工地照且可辨的照片
  openInspections: OpenInspection[]
}): Candidate[] {
  const { uploaderOrg, sitePhotos, openInspections } = input
  if (uploaderOrg !== 'contractor' && uploaderOrg !== 'supervisor') return []

  const byDate = new Map<string, string[]>()
  const undated: string[] = []
  const wids = new Set<string>()
  for (const p of sitePhotos) {
    if (p.work_item_id) wids.add(p.work_item_id)
    if (p.date) {
      if (!byDate.has(p.date)) byDate.set(p.date, [])
      byDate.get(p.date)!.push(p.id)
    } else undated.push(p.id)
  }
  const dates = [...byDate.keys()].sort()
  const out: Candidate[] = []

  // 日誌類:每個日期一份(廠商→施工日誌、監造→監造日誌);無法判日的照片一份 blocked
  const logType: DocType = uploaderOrg === 'contractor' ? 'daily_log' : 'supervisor_log'
  const logLabel = FIELD_DOC_TYPE_LABELS[logType]
  for (const d of dates) {
    out.push({
      doc_type: logType, target_key: d, doc_date: d, state: 'ready', support: 'supported',
      reason: `該日 ${byDate.get(d)!.length} 張${uploaderOrg === 'contractor' ? '現場' : '監造'}照片`, excluded: false,
      photo_ids: byDate.get(d)!, document_id: null,
    })
  }
  if (undated.length) {
    out.push({
      doc_type: logType, target_key: null, doc_date: null, state: 'blocked', support: 'supported',
      reason: `${undated.length} 張照片無法判定日期(告示板無日期、照片無拍攝時間、批次未指定日期);請補批次日期後重試(${logLabel})`,
      excluded: false, photo_ids: undated, document_id: null, blocked_by: ['log_date'],
    })
  }

  if (uploaderOrg === 'contractor') {
    for (const wid of [...wids].sort()) {
      out.push({
        doc_type: 'self_check', target_key: wid, doc_date: dates[0] ?? null, state: 'unsupported', support: 'unsupported',
        reason: '自主檢查表起稿尚未支援(P3b;適用範本規則 applies_to 待 P3c)',
        excluded: false, photo_ids: sitePhotos.filter((p) => p.work_item_id === wid).map((p) => p.id), document_id: null,
      })
    }
    return out
  }

  // supervisor:監造查驗表單(P3c)本輪只列出,不起稿
  const dateSet = new Set(dates)
  for (const ins of [...openInspections].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const byDateHit = !!ins.requested_date && dateSet.has(ins.requested_date)
    const byItemHit = !!ins.work_item_id && wids.has(ins.work_item_id)
    if (!byDateHit && !byItemHit) continue
    out.push({
      doc_type: 'inspection_form', target_key: ins.id, doc_date: ins.requested_date && dateSet.has(ins.requested_date) ? ins.requested_date : (dates[0] ?? null),
      state: 'unsupported', support: 'unsupported',
      reason: `監造查驗表單起稿尚未支援(P3c);待查驗:${ins.title ?? ins.id}`,
      excluded: false,
      photo_ids: sitePhotos.filter((p) => (ins.work_item_id && p.work_item_id === ins.work_item_id) || (ins.requested_date && p.date === ins.requested_date)).map((p) => p.id),
      document_id: null,
    })
  }
  return out
}

// 使用者只能切換 excluded(DB guard);重跑時把先前的排除沿用到同一候選(同類同 target_key)
export function mergeCandidateExclusions(previous: unknown, next: Candidate[]): Candidate[] {
  const prev = Array.isArray(previous) ? previous as Record<string, unknown>[] : []
  return next.map((c) => {
    const hit = prev.find((p) => p && p.doc_type === c.doc_type && (p.target_key ?? null) === (c.target_key ?? null))
    const excluded = hit?.excluded === true
    return excluded ? { ...c, excluded: true, state: 'excluded' } : c
  })
}

// ── 施工日誌草稿 ───────────────────────────────────────────────────────────
export type LegacyDailyLog = {
  id: string
  log_date: string
  weather: string | null
  weather_am: string | null
  weather_pm: string | null
  labor: unknown[] | null
  equipment: unknown[] | null
  materials: unknown[] | null
  extras: Record<string, unknown> | null
  work_summary: string | null
  daily_log_items?: { work_item_id: string; qty_today?: number | null }[] | null
}

// 公定格式(工程會施工日誌)四~八節的 extras 子欄位,與 SiteLog.jsx 表單同一組鍵
export const DAILY_LOG_EXTRAS_KEYS = ['technicians', 'edu', 'insured', 'ppe', 'safety_other', 'sampling', 'notice', 'important'] as const

export type DailyLogItemDraft = {
  item_key: string | null
  item_no: string | null
  description: string
  unit: string | null
  qty_today: number | null
  location: string | null
  note: string | null
}

// 四類文書草稿的共同形狀(流程層 fieldDocDraftRun 只認這個,寫入／冪等／建議邏輯與類型無關)
export type FieldDocDraft<C extends Record<string, unknown> = Record<string, unknown>> = {
  content: C
  field_sources: Record<string, FieldSource>
  attachments: { photo_id: string; storage_path: string; sha256?: string; role?: 'evidence' | 'reference' }[]
  required_fields: string[]
  recheck: { key: string; reason: string }[]
  status: 'draft' | 'pending_input'
  summary: string
  rationale: string
}

export type DailyLogContent = {
  log_date: string
  weather_am: string | null
  weather_pm: string | null
  labor: unknown[]
  equipment: unknown[]
  materials: unknown[]
  extras: Record<string, unknown>
  work_summary: string | null
  items: Record<string, DailyLogItemDraft>
  photo_ids: string[]
  unmatched_photo_ids: string[]
}
export type DailyLogDraft = FieldDocDraft<DailyLogContent>

export type DailyLogDraftInput = {
  date: string
  dateSource: { source: string; refs: string[] }
  photos: DraftPhoto[] // 該日已辨識為工地照且可辨的照片(含既有版本附件的照片)
  workItems: LeafWorkItem[]
  sameDayLog: LegacyDailyLog | null
  yesterdayLog: LegacyDailyLog | null
  weather: { am?: string | null; pm?: string | null } | null
  hasBoq: boolean
  notes: string[] // 本批其他狀態的揭露(非工地／不可辨／失敗／重複／日期衝突)
}

const nonEmpty = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0
const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const label = (wi: LeafWorkItem) => [wi.item_no, wi.description].filter(Boolean).join(' ')

export function buildDailyLogDraft(input: DailyLogDraftInput): DailyLogDraft {
  const { date, photos, sameDayLog, yesterdayLog, weather } = input
  const wiById = new Map(input.workItems.map((w) => [w.id, w]))
  const sources: Record<string, FieldSource> = {}
  const recheck: { key: string; reason: string }[] = []
  const photoIds = photos.map((p) => p.id)

  // 日期
  sources.log_date = { status: 'filled', source: input.dateSource.source, refs: input.dateSource.refs }

  // 告示板轉錄(逐板、逐項附來源照片)
  type Reading = { qty: number; photoId: string }
  const qtyByItem = new Map<string, Reading[]>()
  const boardLocByItem = new Map<string, Map<string, string[]>>() // wid → location → photo ids
  const boardWeather: { text: string; photoId: string }[] = []
  const boardSummary: { text: string; photoId: string }[] = []
  const boards = photos.filter((p) => p.whiteboard)
  for (const p of boards) {
    const wb = p.whiteboard!
    if (wb.weather) boardWeather.push({ text: wb.weather, photoId: p.id })
    if (wb.work_summary) boardSummary.push({ text: wb.work_summary, photoId: p.id })
    for (const it of wb.items) {
      const wi = input.hasBoq ? matchLeaf(it.description, input.workItems) : null
      if (!wi) continue
      if (it.quantity != null) {
        if (!qtyByItem.has(wi.id)) qtyByItem.set(wi.id, [])
        qtyByItem.get(wi.id)!.push({ qty: it.quantity, photoId: p.id })
      }
      const loc = textOrNull(wb.location)
      if (loc) {
        if (!boardLocByItem.has(wi.id)) boardLocByItem.set(wi.id, new Map())
        const m = boardLocByItem.get(wi.id)!
        if (!m.has(loc)) m.set(loc, [])
        m.get(loc)!.push(p.id)
      }
    }
  }

  // 工項列:照片配到的工項 ∪ 告示板列出的工項(照片證明有施作;數量除非板上寫了,否則 pending)
  const itemIds = new Set<string>()
  const photosByItem = new Map<string, DraftPhoto[]>()
  for (const p of photos) {
    if (p.work_item_id && wiById.has(p.work_item_id)) {
      itemIds.add(p.work_item_id)
      if (!photosByItem.has(p.work_item_id)) photosByItem.set(p.work_item_id, [])
      photosByItem.get(p.work_item_id)!.push(p)
    }
  }
  for (const wid of qtyByItem.keys()) itemIds.add(wid)
  for (const wid of boardLocByItem.keys()) itemIds.add(wid)
  const orderedItems = [...itemIds].map((id) => wiById.get(id)!).filter(Boolean)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id < b.id ? -1 : 1))

  const items: Record<string, DailyLogItemDraft> = {}
  // 必填鍵與 P2d fn_field_document_required_fields 的固定欄一致(簽署 RPC 會再算一次並聯集),
  // 這裡先算是為了讓批次回應的 pending_input／recheck 與簽署時的判定相同
  const required: string[] = ['log_date', 'weather_am', 'weather_pm', 'work_summary', 'labor', 'equipment', 'materials']
  for (const wi of orderedItems) {
    const itemPhotos = photosByItem.get(wi.id) ?? []
    // 數量:板上寫了且各板一致才帶入;不一致→pending 並列 recheck;沒寫→pending
    const readings = qtyByItem.get(wi.id) ?? []
    const distinctQty = [...new Set(readings.map((r) => r.qty))]
    let qty: number | null = null
    const qtyKey = `items.${wi.id}.qty_today`
    required.push(qtyKey)
    if (distinctQty.length === 1) {
      qty = distinctQty[0]
      sources[qtyKey] = { status: 'filled', source: `whiteboard:${readings[0].photoId}`, refs: readings.map((r) => r.photoId) }
    } else if (distinctQty.length > 1) {
      sources[qtyKey] = { status: 'pending', source: null, refs: readings.map((r) => r.photoId), reason: `多張告示板數量不一致(${distinctQty.join('、')}),請現場確認` }
      recheck.push({ key: qtyKey, reason: `${label(wi)}:多張告示板數量不一致(${distinctQty.join('、')})` })
    } else {
      sources[qtyKey] = { status: 'pending', source: null, refs: itemPhotos.map((p) => p.id), reason: '照片可證明有施作,不能證明做了多少;數量待現場確認' }
      recheck.push({ key: qtyKey, reason: `${label(wi)}:數量待現場確認` })
    }
    // 位置:照片的板上區域 ∪ 告示板轉錄的位置;唯一才帶入,多個要人分列
    const locRefs = new Map<string, string[]>()
    for (const p of itemPhotos) {
      const loc = textOrNull(p.location) ?? textOrNull(p.classify?.location)
      if (!loc) continue
      if (!locRefs.has(loc)) locRefs.set(loc, [])
      locRefs.get(loc)!.push(p.id)
    }
    for (const [loc, ids] of boardLocByItem.get(wi.id) ?? []) {
      if (!locRefs.has(loc)) locRefs.set(loc, [])
      locRefs.get(loc)!.push(...ids)
    }
    const locKey = `items.${wi.id}.location`
    let location: string | null = null
    if (locRefs.size === 1) {
      const [loc, ids] = [...locRefs.entries()][0]
      location = loc
      sources[locKey] = { status: 'filled', source: `whiteboard:${ids[0]}`, refs: [...new Set(ids)] }
    } else if (locRefs.size > 1) {
      sources[locKey] = { status: 'pending', source: null, refs: [...new Set([...locRefs.values()].flat())], reason: `多個施作位置(${[...locRefs.keys()].join('、')}),請分列` }
      recheck.push({ key: locKey, reason: `${label(wi)}:多個施作位置(${[...locRefs.keys()].join('、')}),請分列` })
    } else {
      sources[locKey] = { status: 'pending', source: null, reason: '照片與告示板未載明施作位置' }
    }
    items[wi.id] = {
      item_key: wi.item_key ?? null, item_no: wi.item_no ?? null, description: wi.description, unit: wi.unit ?? null,
      qty_today: qty, location, note: null,
    }
  }

  // 天氣:告示板 > 當日既有日誌 > 中央氣象署;都沒有→pending
  const pickWeather = (key: 'weather_am' | 'weather_pm'): string | null => {
    if (key === 'weather_am' && boardWeather.length) {
      sources[key] = { status: 'filled', source: `whiteboard:${boardWeather[0].photoId}`, refs: boardWeather.map((b) => b.photoId) }
      return boardWeather[0].text
    }
    const legacy = sameDayLog ? textOrNull(sameDayLog[key]) ?? (key === 'weather_am' ? textOrNull(sameDayLog.weather) : null) : null
    if (legacy) {
      sources[key] = { status: 'filled', source: `legacy:${sameDayLog!.id}` }
      return legacy
    }
    const cwa = weather ? textOrNull(key === 'weather_am' ? weather.am : weather.pm) : null
    if (cwa) {
      sources[key] = { status: 'filled', source: 'cwa' }
      return cwa
    }
    sources[key] = { status: 'pending', source: null, reason: '無告示板天氣、無當日既有日誌、氣象署查詢無結果' }
    recheck.push({ key, reason: key === 'weather_am' ? '上午天氣待填' : '下午天氣待填' })
    return null
  }
  const weatherAm = pickWeather('weather_am')
  const weatherPm = pickWeather('weather_pm')

  // 出工/機具/材料:當日既有日誌 > 昨日日誌(天天雷同,複製是合理預設,填錯代價遠低於數量)> pending
  const pickList = (key: 'labor' | 'equipment' | 'materials'): unknown[] => {
    if (sameDayLog && nonEmpty(sameDayLog[key])) {
      sources[key] = { status: 'filled', source: `legacy:${sameDayLog.id}` }
      return sameDayLog[key] as unknown[]
    }
    if (yesterdayLog && nonEmpty(yesterdayLog[key])) {
      sources[key] = { status: 'filled', source: `yesterday:${yesterdayLog.id}`, reason: '沿用昨日,待核對' }
      return yesterdayLog[key] as unknown[]
    }
    sources[key] = { status: 'pending', source: null, reason: '無當日或昨日日誌可沿用;本日確無則標不適用並填原因' }
    recheck.push({ key, reason: key === 'labor' ? '出工人數待填' : key === 'equipment' ? '機具使用待填(本日無機具請標不適用)' : '材料使用待填(本日無進料請標不適用)' })
    return []
  }
  const labor = pickList('labor')
  const equipment = pickList('equipment')
  const materials = pickList('materials')

  // 公定格式其餘各節:只有當日既有日誌填過的才帶入;其餘 pending,不填「無」
  const extras: Record<string, unknown> = {}
  for (const k of DAILY_LOG_EXTRAS_KEYS) {
    const legacyVal = sameDayLog?.extras ? sameDayLog.extras[k] : undefined
    if (legacyVal !== undefined && legacyVal !== null && legacyVal !== '') {
      extras[k] = legacyVal
      sources[`extras.${k}`] = { status: 'filled', source: `legacy:${sameDayLog!.id}` }
    } else {
      sources[`extras.${k}`] = { status: 'pending', source: null, reason: '照片無法判定,待人填寫' }
    }
  }

  // 摘要:當日既有日誌 > 照片 AI 說明確定性拼接(去空去重)> 告示板摘要 > pending
  let workSummary: string | null = null
  const legacySummary = sameDayLog ? textOrNull(sameDayLog.work_summary) : null
  const captions = [...new Set(photos.map((p) => textOrNull(p.caption) ?? textOrNull(p.classify?.caption)).filter((c): c is string => !!c))]
  if (legacySummary) {
    workSummary = legacySummary
    sources.work_summary = { status: 'filled', source: `legacy:${sameDayLog!.id}` }
  } else if (captions.length) {
    const itemParts = orderedItems.map((wi) => `${label(wi)}(照片 ${(photosByItem.get(wi.id) ?? []).length} 張)`)
    workSummary = (itemParts.length ? `依現場照片,本日施作:${itemParts.join('、')}。` : '') + `照片說明:${captions.join(';')}`
    sources.work_summary = { status: 'filled', source: 'ai:photo', refs: photoIds, reason: 'AI 依照片說明拼接,待核對' }
  } else if (boardSummary.length) {
    workSummary = boardSummary[0].text
    sources.work_summary = { status: 'filled', source: `whiteboard:${boardSummary[0].photoId}`, refs: boardSummary.map((b) => b.photoId) }
  } else {
    sources.work_summary = { status: 'pending', source: null, reason: '照片沒有可用的說明' }
    recheck.push({ key: 'work_summary', reason: '工作摘要待填' })
  }

  // 未配對照片:誠實揭露;未匯標單時全部待配對(不寫入任何工項)
  const unmatched = photos.filter((p) => !p.work_item_id || !wiById.has(p.work_item_id)).map((p) => p.id)
  if (unmatched.length) {
    recheck.push({
      key: 'photos',
      reason: input.hasBoq
        ? `${unmatched.length} 張照片未配對工項(待配對),未納入工項列`
        : `本案尚未匯入標單,${unmatched.length} 張照片全部待配對;匯入後可對同一批重跑`,
    })
  }
  for (const n of input.notes) recheck.push({ key: 'photos', reason: n })

  const pendingRequired = required.filter((k) => sources[k]?.status === 'pending')
  const status: DailyLogDraft['status'] = pendingRequired.length ? 'pending_input' : 'draft'

  const [, m, d] = date.split('-')
  const summary =
    `已依 ${photos.length} 張現場照片擬好 ${Number(m)}/${Number(d)} 施工日誌草稿` +
    `(${orderedItems.length} 個工項,${pendingRequired.length} 項待補)`
  const rationaleParts = [
    `日期:${input.dateSource.source === 'intake' ? '依批次指定日期' : input.dateSource.source.startsWith('whiteboard') ? '依告示板日期' : '依照片時間的台北日曆日'}。`,
    `工項清單:依 ${photos.filter((p) => p.work_item_id).length} 張已配對工項的照片與告示板列出的工項自動帶出(確定性比對,非模型判讀)。`,
    '數量:只有告示板清楚寫出且各板一致的才帶入並標來源照片;其餘留空待你親自填寫——照片能證明有施作,不能證明做了多少。',
    sources.labor.status === 'filled' ? `出工/機具/材料:沿用${sources.labor.source?.startsWith('legacy') ? '當日既有日誌' : '昨日日誌'},請核對後調整。` : '出工/機具/材料:無可沿用的日誌,留空待填。',
    sources.weather_am.status === 'filled' ? `天氣:${sources.weather_am.source === 'cwa' ? '依工地座標向中央氣象署帶入' : sources.weather_am.source?.startsWith('whiteboard') ? '依告示板' : '沿用當日既有日誌'}。` : '天氣:無來源,未帶入,請手動填寫。',
    ...recheck.filter((r) => r.key === 'photos').map((r) => r.reason),
  ]

  return {
    content: {
      log_date: date,
      weather_am: weatherAm,
      weather_pm: weatherPm,
      labor, equipment, materials, extras,
      work_summary: workSummary,
      items,
      photo_ids: photoIds,
      unmatched_photo_ids: unmatched,
    },
    field_sources: sources,
    attachments: photos.map((p) => ({ photo_id: p.id, storage_path: p.storage_path, ...(p.content_sha256 ? { sha256: p.content_sha256 } : {}) })),
    required_fields: required,
    recheck,
    status,
    summary,
    rationale: rationaleParts.join('\n'),
  }
}

// ── 監造日誌草稿(P3a) ───────────────────────────────────────────────────────
// 範本=DB fn_field_document_template('supervisor_log') 的示範範本(is_demo);這裡只帶範本鍵與版本進內容,
// 必填鍵鏡像該範本的 required(DB 存版與簽署時會重算並聯集,以 DB 為準),到場欄鏡像 human_only。
export const SUPERVISOR_LOG_TEMPLATE = { key: 'supervisor_log_demo', version: 1 } as const
export const SUPERVISOR_LOG_REQUIRED_KEYS = ['log_date', 'weather_am', 'weather_pm', 'attendance', 'supervision_items', 'contractor_summary'] as const

export type DayInspection = {
  id: string
  title: string | null
  status: string | null          // 待查驗 | 合格 | 不合格
  work_item_id: string | null
  location: string | null
  inspection_type: string | null
  requested_date: string | null
  inspected_at: string | null
  result_note: string | null
}
export type DayDefect = {
  id: string
  title: string | null
  status: string | null          // 開立 | 改善中 | 待複查 | 已結案
  severity: string | null
  location: string | null
  due_date: string | null
  created_at: string | null
  inspection_id: string | null
}
// 同日施工日誌文件(field_documents)的現況;只有 signed／submitted／received 的內容才可被引用
export type FormalDailyLog = {
  document_id: string
  status: string
  version_no: number
  content: { work_summary?: unknown; items?: unknown; weather_am?: unknown; weather_pm?: unknown } | null
  signed_at: string | null
  submitted_at: string | null
  received_at: string | null
  returned_at: string | null
}

export type SupervisionItemDraft = {
  time: string | null
  item: string
  location: string | null
  work_item_id: string | null
  note: string | null
  source: string                 // 'ai:photo' | 'inspection:<id>'
  photo_ids: string[]
}
export type SupervisorLogContent = {
  log_date: string
  weather_am: string | null
  weather_pm: string | null
  attendance: unknown[]          // 一律空:只能人填
  supervision_items: SupervisionItemDraft[]
  inspection_ids: string[]
  notices: { to: 'contractor' | 'owner'; content: string; ref_type: string | null; ref_id: string | null }[]
  followups: { ref_type: string | null; ref_id: string | null; content: string; status: 'open' | 'closed' }[]
  contractor_summary: string | null
  daily_log_receipt: Record<string, unknown> | null
  note: string | null
  template: { key: string; version: number }
  photo_ids: string[]
  unmatched_photo_ids: string[]
}
export type SupervisorLogDraft = FieldDocDraft<SupervisorLogContent>

export type SupervisorLogDraftInput = {
  date: string
  dateSource: { source: string; refs: string[] }
  photos: DraftPhoto[]               // 監造自己的、已辨識為工地照且可辨的照片
  workItems: LeafWorkItem[]
  inspections: DayInspection[]       // 當日申請或當日判定的查驗
  openInspections: OpenInspection[]  // 全案待查驗(追蹤事項)
  defects: DayDefect[]               // 當日開立 ∪ 未結案的缺失
  dailyLog: FormalDailyLog | null    // 同日施工日誌文件(任何狀態)
  weather: { am?: string | null; pm?: string | null } | null
  hasBoq: boolean
  notes: string[]
}

export function buildSupervisorLogDraft(input: SupervisorLogDraftInput): SupervisorLogDraft {
  const { date, photos, inspections, defects, dailyLog, weather } = input
  const wiById = new Map(input.workItems.map((w) => [w.id, w]))
  const sources: Record<string, FieldSource> = {}
  const recheck: { key: string; reason: string }[] = []
  const photoIds = photos.map((p) => p.id)
  const byTime = <T extends { time: string | null }>(a: T, b: T) =>
    (a.time ?? '99:99') < (b.time ?? '99:99') ? -1 : (a.time ?? '99:99') > (b.time ?? '99:99') ? 1 : 0

  sources.log_date = { status: 'filled', source: input.dateSource.source, refs: input.dateSource.refs }

  // 到場:永遠留空、pending——照片不能證明到場,只能人填(DB guard 也擋 AI 帶入)
  sources.attendance = { status: 'pending', source: null, reason: '到場人員與時段只能由監造親自填寫並確認;系統不從任何照片推定到場' }
  recheck.push({ key: 'attendance', reason: '到場人員與時段請親自填寫確認(本日未到場請標不適用並填原因)' })

  const formal = dailyLog && FORMAL_DAILY_LOG_STATUSES.includes(dailyLog.status) ? dailyLog : null
  const formalSource = formal ? formalDailyLogSource(formal) : null

  // 天氣:同日已簽署／提送的施工日誌 > 中央氣象署 > pending
  const pickWeather = (key: 'weather_am' | 'weather_pm'): string | null => {
    const fromLog = formal ? textOrNull(formal.content?.[key]) : null
    if (fromLog) {
      sources[key] = { status: 'filled', source: formalSource!, reason: '沿用同日施工日誌,待核對' }
      return fromLog
    }
    const cwa = weather ? textOrNull(key === 'weather_am' ? weather.am : weather.pm) : null
    if (cwa) {
      sources[key] = { status: 'filled', source: 'cwa' }
      return cwa
    }
    sources[key] = { status: 'pending', source: null, reason: '無已簽署施工日誌可沿用、氣象署查詢無結果' }
    recheck.push({ key, reason: key === 'weather_am' ? '上午天氣待填' : '下午天氣待填' })
    return null
  }
  const weatherAm = pickWeather('weather_am')
  const weatherPm = pickWeather('weather_pm')

  // 監造事項:監造自己的照片(配到工項的併成一項、未配對的逐張)＋當日判定的查驗;逐項標來源
  const items: SupervisionItemDraft[] = []
  const photosByItem = new Map<string, DraftPhoto[]>()
  const unmatched: DraftPhoto[] = []
  for (const p of photos) {
    if (p.work_item_id && wiById.has(p.work_item_id)) {
      if (!photosByItem.has(p.work_item_id)) photosByItem.set(p.work_item_id, [])
      photosByItem.get(p.work_item_id)!.push(p)
    } else unmatched.push(p)
  }
  const orderedItems = [...photosByItem.keys()].map((id) => wiById.get(id)!)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id < b.id ? -1 : 1))
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))]
  for (const wi of orderedItems) {
    const ps = photosByItem.get(wi.id)!
    const locs = uniq(ps.map((p) => textOrNull(p.location) ?? textOrNull(p.classify?.location)))
    const notes = uniq(ps.map((p) => textOrNull(p.caption) ?? textOrNull(p.classify?.caption)))
    const times = uniq(ps.map((p) => taipeiTimeOf(p.taken_at))).sort()
    items.push({
      time: times[0] ?? null, item: `抽查 ${label(wi)}`, location: locs.length === 1 ? locs[0] : null,
      work_item_id: wi.id, note: [...(locs.length > 1 ? [`多個位置:${locs.join('、')}`] : []), ...notes].join(';') || null,
      source: 'ai:photo', photo_ids: ps.map((p) => p.id),
    })
  }
  for (const p of unmatched) {
    items.push({
      time: taipeiTimeOf(p.taken_at), item: textOrNull(p.caption) ?? textOrNull(p.classify?.caption) ?? '現場巡查(照片)',
      location: textOrNull(p.location) ?? textOrNull(p.classify?.location), work_item_id: null,
      note: textOrNull(p.classify?.visible_progress), source: 'ai:photo', photo_ids: [p.id],
    })
  }
  const judgedToday = inspections.filter((i) => (i.status === '合格' || i.status === '不合格') && taipeiDateOf(i.inspected_at) === date)
  for (const i of judgedToday) {
    items.push({
      time: taipeiTimeOf(i.inspected_at), item: `查驗:${i.title ?? i.id}(${i.status})`, location: textOrNull(i.location),
      work_item_id: i.work_item_id && wiById.has(i.work_item_id) ? i.work_item_id : null,
      note: textOrNull(i.result_note), source: `inspection:${i.id}`, photo_ids: [],
    })
  }
  items.sort(byTime)
  if (items.length) {
    sources.supervision_items = {
      status: 'filled', source: 'ai:photo', refs: [...photoIds, ...judgedToday.map((i) => i.id)],
      reason: '依監造照片與當日查驗紀錄整理,待核對',
    }
  } else {
    sources.supervision_items = { status: 'pending', source: null, reason: '無監造照片與當日查驗紀錄可整理;請填寫監造事項,本日未到場請標不適用並填原因' }
    recheck.push({ key: 'supervision_items', reason: '監造事項待填' })
  }

  // 當日查驗:系統紀錄(申請日=當日或當日判定),空也是事實
  const inspectionIds = [...new Set(inspections.map((i) => i.id))].sort()
  sources.inspection_ids = {
    status: 'filled', source: 'system:inspections', refs: inspectionIds,
    ...(inspectionIds.length ? {} : { reason: '系統無當日查驗申請或判定紀錄' }),
  }

  // 通知:當日開立的缺失、當日判定不合格且尚無缺失列的查驗;只帶系統既有紀錄
  const sameDayDefects = defects.filter((d) => taipeiDateOf(d.created_at) === date)
  const notices: SupervisorLogContent['notices'] = sameDayDefects.map((d) => ({
    to: 'contractor' as const,
    content: `缺失通知:${d.title ?? d.id}${d.severity ? `(${d.severity})` : ''}${d.location ? ` ${d.location}` : ''}${d.due_date ? `,改善期限 ${d.due_date}` : ''}`,
    ref_type: 'defect', ref_id: d.id,
  }))
  for (const i of judgedToday) {
    if (i.status !== '不合格' || sameDayDefects.some((d) => d.inspection_id === i.id)) continue
    notices.push({ to: 'contractor', content: `查驗不合格:${i.title ?? i.id}${i.result_note ? `(${i.result_note})` : ''}`, ref_type: 'inspection', ref_id: i.id })
  }
  notices.sort((a, b) => (a.content < b.content ? -1 : 1))
  if (notices.length) sources.notices = { status: 'filled', source: 'system:defects', refs: notices.map((n) => n.ref_id!) }
  else sources.notices = { status: 'pending', source: null, reason: '系統無當日缺失或不合格紀錄;現場口頭或書面通知請補填,無則標不適用' }

  // 追蹤:未結案缺失、全案待查驗
  const followups: SupervisorLogContent['followups'] = [
    ...defects.filter((d) => d.status !== '已結案').map((d) => ({
      ref_type: 'defect', ref_id: d.id, status: 'open' as const,
      content: `缺失:${d.title ?? d.id}(${d.status ?? '開立'}${d.due_date ? `,期限 ${d.due_date}` : ''})`,
    })),
    ...input.openInspections.map((i) => ({
      ref_type: 'inspection', ref_id: i.id, status: 'open' as const,
      content: `待查驗:${i.title ?? i.id}${i.requested_date ? `(申請日 ${i.requested_date})` : ''}`,
    })),
  ].sort((a, b) => (a.content < b.content ? -1 : 1))
  if (followups.length) sources.followups = { status: 'filled', source: 'system:defects,inspections', refs: followups.map((f) => f.ref_id!) }
  else sources.followups = { status: 'pending', source: null, reason: '系統無未結案缺失或待查驗;另有追蹤事項請補填,無則標不適用' }

  // 廠商施工情形:只引用同日已簽署／已提送的施工日誌文件;否則 pending(不猜)
  let contractorSummary: string | null = null
  if (formal) {
    const text = composeContractorSummary(formal, wiById)
    if (text) {
      contractorSummary = text
      sources.contractor_summary = { status: 'filled', source: formalSource!, reason: '引用同日已簽署施工日誌,待核對' }
    } else {
      sources.contractor_summary = { status: 'pending', source: formalSource, reason: '同日施工日誌已簽署但無施工概況與數量' }
      recheck.push({ key: 'contractor_summary', reason: '廠商施工情形待填' })
    }
  } else {
    const reason = !dailyLog
      ? '當日無廠商施工日誌文件;廠商未施工請標不適用並填原因'
      : dailyLog.status === 'returned'
        ? `廠商施工日誌 v${dailyLog.version_no} 已退回補正,待廠商再送;請勿引用未定版內容`
        : `廠商施工日誌尚未簽署／提送(目前 ${dailyLog.status});待廠商完成後重跑或人填`
    sources.contractor_summary = { status: 'pending', source: null, reason }
    recheck.push({ key: 'contractor_summary', reason })
  }
  const receipt = dailyLogReceipt(dailyLog)
  sources.daily_log_receipt = { status: 'filled', source: 'system:field_documents', ...(dailyLog ? { refs: [dailyLog.document_id] } : {}) }

  const unmatchedIds = unmatched.map((p) => p.id)
  if (unmatchedIds.length) {
    recheck.push({
      key: 'photos',
      reason: input.hasBoq
        ? `${unmatchedIds.length} 張監造照片未配對工項(待配對),已逐張列為監造事項`
        : `本案尚未匯入標單,${unmatchedIds.length} 張監造照片全部待配對;匯入後可對同一批重跑`,
    })
  }
  for (const n of input.notes) recheck.push({ key: 'photos', reason: n })

  const required = [...SUPERVISOR_LOG_REQUIRED_KEYS]
  const pendingRequired = required.filter((k) => sources[k]?.status === 'pending')
  const status: SupervisorLogDraft['status'] = pendingRequired.length ? 'pending_input' : 'draft'

  const [, m, d] = date.split('-')
  const summary =
    `已依 ${photos.length} 張監造照片與 ${inspections.length} 筆當日查驗擬好 ${Number(m)}/${Number(d)} 監造日誌草稿(示範範本)` +
    `(${items.length} 項監造事項,${pendingRequired.length} 項待補;到場人員請親自填寫)`
  const rationale = [
    `日期:${input.dateSource.source === 'intake' ? '依批次指定日期' : input.dateSource.source.startsWith('whiteboard') ? '依告示板日期' : '依照片時間的台北日曆日'}。`,
    '到場人員:不由任何照片推定,留空待監造親自填寫確認。',
    `監造事項:依 ${photos.length} 張監造照片(${orderedItems.length} 個配到的工項)與當日判定的 ${judgedToday.length} 筆查驗整理,逐項標來源,請核對。`,
    `查驗情形:系統當日查驗紀錄 ${inspectionIds.length} 筆。`,
    `通知／追蹤:只帶系統既有的缺失與查驗紀錄(通知 ${notices.length}、追蹤 ${followups.length}),現場口頭事項請補填。`,
    formal ? `廠商施工情形:引用同日施工日誌文件 v${formal.version_no}(${formal.status}),請核對。` : `廠商施工情形:${sources.contractor_summary.reason}`,
    sources.weather_am.status === 'filled' ? `天氣:${sources.weather_am.source === 'cwa' ? '依工地座標向中央氣象署帶入' : '沿用同日施工日誌'}。` : '天氣:無來源,未帶入,請手動填寫。',
    ...recheck.filter((r) => r.key === 'photos').map((r) => r.reason),
  ].join('\n')

  return {
    content: {
      log_date: date, weather_am: weatherAm, weather_pm: weatherPm,
      attendance: [], supervision_items: items, inspection_ids: inspectionIds, notices, followups,
      contractor_summary: contractorSummary, daily_log_receipt: receipt, note: null,
      template: { ...SUPERVISOR_LOG_TEMPLATE },
      photo_ids: photoIds, unmatched_photo_ids: unmatchedIds,
    },
    field_sources: sources,
    attachments: photos.map((p) => ({ photo_id: p.id, storage_path: p.storage_path, ...(p.content_sha256 ? { sha256: p.content_sha256 } : {}) })),
    required_fields: required,
    recheck,
    status,
    summary,
    rationale,
  }
}

// 重跑冪等:content 與 attachments 都相同就不新增版本(雜湊由 DB 算,這裡只比內容)
export function draftUnchanged(
  previous: { content: unknown; attachments: unknown } | null,
  next: { content: unknown; attachments: unknown },
): boolean {
  if (!previous) return false
  return stableStringify(previous.content) === stableStringify(next.content)
    && stableStringify(previous.attachments ?? null) === stableStringify(next.attachments ?? null)
}
