// 現場文書起稿的純規則(P2b;設計 docs/architecture/field-documents-lifecycle.md §2.3、§3)。
// ---------------------------------------------------------------------------
// 全部確定性、無 IO、無 npm 依賴——vitest 直接測。這裡決定三件事:
//   1. 一批照片各屬哪一天(告示板日期 > 使用者指定的批次日期 > 拍攝時間的台北日曆日)、
//      哪些是重複照片(同批同雜湊)。
//   2. 依上傳方角色推斷「候選文書」:廠商→施工日誌(本單元實作)＋自主檢查表(P3b,列為尚未支援);
//      監造→監造日誌(P3a)＋監造查驗表單(P3c),都列為尚未支援;機關→無。**廠商照片永遠推不出
//      監造文件,反之亦然**(DB guard 另有一道)。
//   3. 施工日誌草稿的內容與每欄來源(field_sources):
//      * 沒有來源的數量、天氣、出工一律 pending(待補);絕不填「無」「0」「合格」。
//      * 告示板清楚可讀才把數量／位置／日期／天氣標 filled 並附 source: whiteboard:<photo_id>;
//        同一工項多張板子數字不一致→pending 並列入 recheck,不挑一個。
//      * 出工／機具／材料沿用當日既有日誌(legacy)或昨日日誌(yesterday),標 filled 待核對。
//      * 天氣:告示板 > 當日既有日誌 > 中央氣象署(cwa);都沒有→pending。
//      * 摘要由各張照片的 AI 說明確定性拼接(不再打一次模型:說明本身已是模型輸出,
//        再餵給第二個 prompt 只會多一條把板上文字當指令的路)。
//      * 照片能證明「有施作」不能證明「做了多少」:配到工項只加列,數量仍 pending。
// 版本雜湊由 DB 算(fn_field_document_content_hash);這裡只比對 content 是否相同,
// 用的是 stableStringify(與 agent.ts 同一支),不重算雜湊、不做第二個引擎。

import { formatDate, parseDateUTC, taipeiTodayUTC } from './contractDue.ts'
import { stableStringify } from './agent.ts'
import { matchLeaf } from './photoMatch.ts'
import type { SitePhotoResult, WhiteboardResult } from './sitePhotoVision.ts'

export const DAY_MS = 86400000

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
  | 'ready'        // 可起稿(本單元只有 daily_log 會真的起)
  | 'blocked'      // 缺必要資料(blocked_by 列出),不建文件
  | 'unsupported'  // 需要但本輪尚未支援(P3a–c)
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

  if (uploaderOrg === 'contractor') {
    for (const d of dates) {
      out.push({
        doc_type: 'daily_log', target_key: d, doc_date: d, state: 'ready', support: 'supported',
        reason: `該日 ${byDate.get(d)!.length} 張現場照片`, excluded: false,
        photo_ids: byDate.get(d)!, document_id: null,
      })
    }
    if (undated.length) {
      out.push({
        doc_type: 'daily_log', target_key: null, doc_date: null, state: 'blocked', support: 'supported',
        reason: `${undated.length} 張照片無法判定日期(告示板無日期、照片無拍攝時間、批次未指定日期);請補批次日期後重試`,
        excluded: false, photo_ids: undated, document_id: null, blocked_by: ['log_date'],
      })
    }
    for (const wid of [...wids].sort()) {
      out.push({
        doc_type: 'self_check', target_key: wid, doc_date: dates[0] ?? null, state: 'unsupported', support: 'unsupported',
        reason: '自主檢查表起稿尚未支援(P3b;適用範本規則 applies_to 待 P3c)',
        excluded: false, photo_ids: sitePhotos.filter((p) => p.work_item_id === wid).map((p) => p.id), document_id: null,
      })
    }
    return out
  }

  // supervisor:監造日誌(P3a)與監造查驗表單(P3c)本輪都只列出,不起稿
  for (const d of dates) {
    out.push({
      doc_type: 'supervisor_log', target_key: d, doc_date: d, state: 'unsupported', support: 'unsupported',
      reason: '監造日誌起稿尚未支援(P3a;事實表 supervisor_logs 尚未建立)',
      excluded: false, photo_ids: byDate.get(d)!, document_id: null,
    })
  }
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

export type DailyLogDraft = {
  content: {
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
  field_sources: Record<string, FieldSource>
  attachments: { photo_id: string; storage_path: string; sha256?: string }[]
  required_fields: string[]
  recheck: { key: string; reason: string }[]
  status: 'draft' | 'pending_input'
  summary: string
  rationale: string
}

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

// 重跑冪等:content 與 attachments 都相同就不新增版本(雜湊由 DB 算,這裡只比內容)
export function draftUnchanged(
  previous: { content: unknown; attachments: unknown } | null,
  next: { content: unknown; attachments: unknown },
): boolean {
  if (!previous) return false
  return stableStringify(previous.content) === stableStringify(next.content)
    && stableStringify(previous.attachments ?? null) === stableStringify(next.attachments ?? null)
}
