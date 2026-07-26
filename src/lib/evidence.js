// 佐證推導:某工項的估驗數量,是由哪些現場紀錄支撐的。
// 全確定性 join,不存關聯表——日誌改了佐證自動跟著對(能 join 出來的就不要存)。
// 純函式:不碰 store、不打網路,估驗頁與列印佐證包共用。
//
// join 規則(與 lib/integrityAudit.js 的勾稽語意一致):
// - 日誌:log.items[itemKey] > 0(與 fillValuationFromSiteLogs 的累加來源相同)
// - 查驗/檢查表:work_item_id 精確對應 item_key(uuid 經 wiMaps.idToKey 換 key;
//   demo 資料無 uuid 時允許 work_item_id 直接就是 item_key)。對不到=空陣列,
//   不做標題模糊比對——硬湊出來的佐證比沒有佐證更糟。
// - 試體:試體表無工項欄位,僅混凝土澆置工項(isConcretePourItem,同 integrityAudit 檢查 4)
//   以「取樣日=澆置日」對應——模板/打鑿等含「混凝土」字樣的非澆置工項不掛試體。
import { OVER_TOL, isConcretePourItem } from './integrityAudit.js'

export { OVER_TOL } // 差異警示容忍值與稽核頁同一份,兩邊判定不可分裂

export function collectEvidence(itemKey, {
  siteLogs = [], inspections = [], checklistRecords = [], testSamples = [],
  wiMaps, workItem,
} = {}) {
  const idToKey = wiMaps?.idToKey || new Map()
  // work_item_id → 是否為本工項:真資料是 uuid 走 idToKey;demo 無 uuid 時直接以 item_key 存放
  const isThisItem = (wid) => wid != null && (idToKey.get(wid) === itemKey || wid === itemKey)

  // 日誌:該工項有數量的日誌(qty > 0),依日期新→舊
  const logs = []
  let loggedTotal = 0
  for (const lg of siteLogs) {
    const q = Number(lg.items?.[itemKey]) || 0
    if (q > 0) {
      logs.push({ log_date: lg.log_date, qty: q, note: lg.work_summary || null })
      loggedTotal += q
    }
  }
  logs.sort((a, b) => (b.log_date || '').localeCompare(a.log_date || ''))

  // 查驗:work_item_id 對應本工項(null 不配對)
  const insp = inspections
    .filter((i) => isThisItem(i.work_item_id))
    .map((i) => ({ id: i.id, title: i.title, status: i.status, inspected_at: i.inspected_at || null }))

  // 自主檢查表:同樣以 work_item_id 對應。舊資料未寫入此欄(null)推導不到=空陣列,
  // 這是正確行為(佐證鏈在該環就是斷的),不硬湊。title 由呼叫端以範本標題去正規化。
  const checklists = checklistRecords
    .filter((r) => isThisItem(r.work_item_id))
    .map((r) => ({ id: r.id, title: r.title || r.template_title || '', check_date: r.check_date, overall: r.overall }))

  // 試體:僅混凝土澆置工項,以「取樣日 = 該工項有澆置數量的日誌日期」對應
  let samples = []
  if (isConcretePourItem(workItem?.description) && logs.length) {
    const pourDates = new Set(logs.map((l) => l.log_date))
    samples = testSamples
      .filter((s) => pourDates.has(s.sampled_date))
      .map((s) => ({ id: s.id, sample_no: s.sample_no, sampled_date: s.sampled_date, status: s.status, matchedBy: 'pour_date' }))
  }

  return {
    logs, loggedTotal, inspections: insp, checklists, samples,
    counts: { logs: logs.length, inspections: insp.length, checklists: checklists.length, samples: samples.length },
  }
}
