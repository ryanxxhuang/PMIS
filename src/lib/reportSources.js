// 月報的資料來源(P6a):施工月報與監造月報只彙整「已簽署」的現場文書,未簽署的明列「未簽署、不列入」。
// 兩張月報同一個報告月份共用這裡的規則(施工天數、雨天、查驗判定歸月),不各自實作——雨天口徑曾在兩張報表分家(P1-07)。
// 已簽署的判定與版本追溯見 lib/fieldDocs.signedVersionIndex(事實列＝指向它的文件最晚一次簽署的版本);
// 進度數字(累計實際／預定、截止日、取期)不在這裡,仍走 lib/progressAsOf.js 的 D-024 口徑,本檔不碰。
import { rainDayCount } from './weatherMetrics.js'
import { taipeiISODate } from './dates.js'
import { INSPECTION_VERDICTS } from './fieldDocs.js'

const ym = (s) => (s || '').slice(0, 7)
const OPEN_UNSIGNED = new Set(['draft', 'pending_input', 'in_review', 'returned'])

// 事實列依已簽署與否分開(month 給了才只取該月;dateKey 預設 log_date)。index 是 signedVersionIndex 的結果。
export function splitBySignature(rows = [], index = new Map(), { month = null, dateKey = 'log_date' } = {}) {
  const signed = [], unsigned = []
  for (const r of rows || []) {
    if (month && ym(r?.[dateKey]) !== month) continue
    const ref = r?.id ? index.get(r.id) : null
    if (ref) signed.push({ ...r, ref })
    else unsigned.push(r)
  }
  const byDate = (a, b) => String(a[dateKey] || '').localeCompare(String(b[dateKey] || ''))
  return { signed: signed.sort(byDate), unsigned: unsigned.sort(byDate) }
}

// 範圍內「未簽署、不列入」的日誌清單(施工月報=該月;佐證包=本期範圍):事實列沒有簽署(舊流程寫入的既有紀錄,
// 或同日文件尚未簽署、在釘住時點以後才簽署)＋範圍內尚未簽署、也還沒有事實列的活文件(新流程草稿)。
// 每日一列,附文件狀態供標示;signedDates 裡的日期(已列入的)不會出現在這裡。
export function unsignedDays({ unsignedRows = [], signedDates = new Set(), openDocs = [], docType, inRange = () => true }) {
  const docByDate = new Map()
  for (const d of openDocs || []) {
    if (d?.doc_type !== docType || !inRange(d.doc_date)) continue
    if (!docByDate.has(d.doc_date)) docByDate.set(d.doc_date, d)
  }
  const out = new Map()
  for (const r of unsignedRows) {
    if (!inRange(r.log_date) || signedDates.has(r.log_date) || out.has(r.log_date)) continue
    const doc = docByDate.get(r.log_date) || null
    out.set(r.log_date, { date: r.log_date, doc, legacy: !doc })
  }
  for (const [date, doc] of docByDate) {
    if (signedDates.has(date) || out.has(date) || !OPEN_UNSIGNED.has(doc.status)) continue
    out.set(date, { date, doc, legacy: false })
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// 已簽署施工日誌的月彙整:施工天數、雨天、出工(工別合計人・日)、工項數量(本月／截至月底累計)。
// cumRows:截至月底(含)的全部已簽署日誌——累計完成同樣只算已簽署的,與本月同一條規則。
export function aggregateDailyLogs(monthRows = [], cumRows = []) {
  const sumQty = (rows) => {
    const m = new Map()
    for (const l of rows) for (const [k, q] of Object.entries(l.items || {})) m.set(k, (m.get(k) || 0) + (Number(q) || 0))
    return m
  }
  const labor = new Map()
  for (const l of monthRows) for (const r of Array.isArray(l.labor) ? l.labor : []) {
    const t = String(r?.type || '').trim() || '未分類'
    labor.set(t, (labor.get(t) || 0) + (Number(r?.count) || 0))
  }
  return {
    workDays: monthRows.length,
    rainDays: rainDayCount(monthRows), // 與監造月報／AI 助理同源(任一時段含雨=雨天)
    labor: [...labor.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    laborTotal: [...labor.values()].reduce((s, n) => s + n, 0),
    qtyMonth: sumQty(monthRows),
    qtyCum: sumQty(cumRows),
  }
}

// 查驗的月報歸屬與判定依據(兩張月報同一條):本月申請或本月判定(判定時間以台北日曆日歸月)。
// 判定只有經「已簽署監造查驗表單」者列入統計(inspections.document_id 只由簽署路徑寫入,P3c guard);
// 快速判定(未經表單,不寫確認量)明列「未經簽署查驗表單、不列入」。formIndex=inspection_form 的 signedVersionIndex(target=查驗 id)。
export function inspectionsOfMonth(inspections = [], month, formIndex = new Map()) {
  const list = (inspections || []).filter((i) => ym(i.requested_date) === month || ym(taipeiISODate(i.inspected_at)) === month)
  const judged = list.filter((i) => INSPECTION_VERDICTS.includes(i.status))
  const signed = judged.filter((i) => i.document_id).map((i) => ({ ...i, ref: formIndex.get(i.id) || null }))
  const unsigned = judged.filter((i) => !i.document_id)
  const count = (s) => signed.filter((i) => i.status === s).length
  return {
    list, signed, unsigned,
    pass: count('合格'), partial: count('部分合格'), fail: count('不合格'),
    pendingNow: (inspections || []).filter((i) => i.status === '待查驗').length, // 現況(不限本月)
  }
}

// 本月的監造確認量(inspection_confirmations,RLS 成員可讀):本月確認(confirmed_at)與本月撤銷(revoked_at),台北日曆日歸月。
export function confirmationsOfMonth(confirmations = [], month) {
  const byTime = (k) => (a, b) => String(a[k] || '').localeCompare(String(b[k] || ''))
  return {
    confirmed: (confirmations || []).filter((c) => ym(taipeiISODate(c.confirmed_at)) === month).sort(byTime('confirmed_at')),
    revoked: (confirmations || []).filter((c) => c.status === 'revoked' && ym(taipeiISODate(c.revoked_at)) === month).sort(byTime('revoked_at')),
  }
}
