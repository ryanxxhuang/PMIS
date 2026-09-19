// 估驗請款佐證包的本期證據(P6a):本期來源一律取 P4b 的確認量來源(`get_valuation_state.items[].sources` → 確認紀錄
// `inspection_confirmations`)與它們指向的簽署文件版本,不再以「同工項所有照片／日誌」當本期證據。
//   * 查驗表單:確認紀錄記著 document_id＋document_version_no＋content_hash(簽署當下的版本,append-only);照片取該版本的
//     attachments(版本雜湊涵蓋附件)、檢附的自主檢查取該版本內容的 self_check_record_id(已簽署的修訂列不可改)。
//   * 施工日誌:本期日期範圍內、送審時點(含)以前已簽署的版本(signedVersionIndex pinAt);草稿期=目前已簽署版本。
// 已送審／核定的期別,來源分配由 DB 凍結(valuation_item_sources 非草稿期不可改,含 service role),確認紀錄與版本不可變,
// 施工日誌以送審時點釘住——所以已提送的包永遠呈現當時使用的版本。缺件照 DB 的逐工項違反代碼明示(describeViolation)。
// 本檔只做挑選與組裝;數量、金額、違反與否全是 DB 的值,前端不算。
import { contentToLogShape, confirmationDocRef } from './fieldDocs.js'
import { describeViolation } from './valuationChecks.js'

export const versionKey = (documentId, versionNo) => `${documentId}:${versionNo}`
// 版本附件中的「證據」照片(role 預設 evidence;他方照片只能以 reference 附上,不是監造的證據,不列入佐證照片)
export const evidencePhotoIds = (version) => (Array.isArray(version?.attachments) ? version.attachments : [])
  .filter((a) => a?.photo_id && (a.role || 'evidence') === 'evidence').map((a) => a.photo_id)

// 本期施工日誌的日期範圍:迄＝本期計價截止日(含);起＝本期起日(含)或前期計價截止日(不含),第 1 期自開工起。
// 缺截止日就界定不了本期,回 gap(呼叫端明示缺件),不退回「全部日誌」。
export function periodWindow(selected, prev) {
  const to = selected?.period_end || null
  if (!to) return { from: null, fromInclusive: false, to: null, gap: 'period_end' }
  if (selected.period_start) return { from: selected.period_start, fromInclusive: true, to, gap: null }
  if (!prev) return { from: null, fromInclusive: false, to, gap: null }
  if (prev.period_end) return { from: prev.period_end, fromInclusive: false, to, gap: null }
  return { from: null, fromInclusive: false, to, gap: 'prev_period_end' }
}
export const inWindow = (date, w) => !!date && !!w?.to && !w.gap && date <= w.to
  && (w.from == null || (w.fromInclusive ? date >= w.from : date > w.from))

// 本期來源指向的查驗表單版本(要讀 attachments 與檢附的自主檢查)
export function formVersionRefs(state, confirmations = []) {
  const confById = new Map((confirmations || []).map((c) => [c.id, c]))
  const out = new Map()
  for (const it of state?.items || []) for (const s of it.sources || []) {
    const c = s.confirmation_id ? confById.get(s.confirmation_id) : null
    if (c?.document_id && c.document_version_no != null) out.set(versionKey(c.document_id, c.document_version_no), { document_id: c.document_id, version_no: c.document_version_no })
  }
  return [...out.values()]
}

// 逐工項的本期證據。leaves=本期有增量的末端工項(頁面既有算法);state=get_valuation_state(demo／未載入為 null);
// formVersions=Map(versionKey → 版本列);formIndex=inspection_form 的 signedVersionIndex(target=查驗 id,判斷版本是否仍是該表單的列印版本);
// selfCheckIndex=self_check 的 signedVersionIndex(target=checklist_records.id)。
//   status:unchecked(沒有後端狀態,未經核對)｜blocked(DB 列出違反＝缺件)｜confirmed(有監造確認來源且無違反)｜none(無來源)。
export function packageItemEvidence({ leaves = [], state = null, keyOf = () => null, confirmations = [], formVersions = new Map(),
  formIndex = new Map(), inspections = [], checklistRecords = [], selfCheckIndex = new Map() }) {
  const stateByKey = new Map()
  for (const it of state?.items || []) { const k = keyOf(it.work_item_id); if (k != null) stateByKey.set(k, it) }
  const confById = new Map((confirmations || []).map((c) => [c.id, c]))
  const inspById = new Map((inspections || []).filter((i) => i?.id).map((i) => [i.id, i]))
  const recById = new Map((checklistRecords || []).filter((r) => r?.id).map((r) => [r.id, r]))
  return leaves.map((item) => {
    const st = state ? stateByKey.get(item.item_key) || null : null
    const sources = (st?.sources || []).map((s) => {
      const c = s.confirmation_id ? confById.get(s.confirmation_id) || null : null
      let form = null, selfCheck = null
      const ref = confirmationDocRef(c, formIndex)
      if (ref) {
        const v = formVersions.get(versionKey(ref.document_id, ref.version_no)) || null
        form = {
          ref: { ...ref, content_hash: ref.content_hash || v?.content_hash || null },
          loaded: !!v,
          photoIds: evidencePhotoIds(v),
        }
        const recId = v?.content?.self_check_record_id || null
        if (recId) {
          const rec = recById.get(recId) || null
          selfCheck = { record_id: recId, record: rec, ref: selfCheckIndex.get(recId) || null }
        }
      }
      return {
        id: s.id, kind: s.kind, qty: Number(s.qty), batch_key: s.batch_key,
        confirmation: c, inspection: c?.inspection_id ? inspById.get(c.inspection_id) || null : null, form, selfCheck,
      }
    })
    const issues = (st?.violations || []).map(describeViolation)
    const photoIds = [...new Set(sources.flatMap((s) => s.form?.photoIds || []))]
    const status = !state ? 'unchecked' : issues.length ? 'blocked' : sources.some((s) => s.kind === 'confirmation') ? 'confirmed' : 'none'
    return { item, state: st, sources, issues, photoIds, status }
  })
}

// 本期施工日誌(已簽署版本):index=daily_log 的 signedVersionIndex(已依送審時點 pinAt 釘住);只挑本期範圍內的版本。
export function pinnedDailyLogRefs(index = new Map(), window) {
  return [...index.values()].filter((r) => inWindow(r.doc_date, window)).sort((a, b) => a.doc_date.localeCompare(b.doc_date))
}

// 組附件列:每份版本取本期工項的當日數量(版本內容 → contentToLogShape,na 不算);沒有本期工項的日誌不列。
// 範圍內未簽署(或送審時尚未簽署)的日誌由 reportSources.unsignedDays 列出,與施工月報同一條規則。
export function packageDailyLogs({ refs = [], versions = new Map(), leaves = [] }) {
  const leafById = new Map(leaves.filter((l) => l.id).map((l) => [l.id, l]))
  const leafByKey = new Map(leaves.map((l) => [l.item_key, l]))
  const rows = []
  let missing = 0
  for (const ref of refs) {
    const v = versions.get(versionKey(ref.document_id, ref.version_no))
    if (!v) { missing += 1; continue }
    const log = contentToLogShape(v.content, { sources: v.field_sources, logDate: ref.doc_date })
    const items = []
    for (const [key, qty] of Object.entries(log.items)) {
      const meta = log.item_meta[key] || {}
      const leaf = leafById.get(meta.work_item_id) || leafByKey.get(key)
      if (!leaf || !(qty > 0)) continue
      items.push({ item_key: leaf.item_key, item_no: leaf.item_no, description: leaf.description, unit: leaf.unit, qty })
    }
    if (!items.length) continue
    rows.push({
      date: ref.doc_date, ref,
      weather: [log.weather_am, log.weather_pm].filter(Boolean).join(' / ') || '—',
      summary: log.work_summary || '', items,
    })
  }
  return { rows: rows.sort((a, b) => b.date.localeCompare(a.date)), missing }
}
