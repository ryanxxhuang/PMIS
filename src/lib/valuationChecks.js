// 估驗勾稽檢核的輸入組裝(D-026 P1b:估驗所需檢核自獨立的風險稽核工作區移入估驗流程)。
// 判定引擎仍是 lib/integrityAudit.js 的 buildIntegrityFindings(全確定性,與 Edge 的
// _shared/integrityAudit.ts 逐案例對照);這一支只負責把 store 的資料形狀組成引擎的六個輸入,
// 估驗頁(本期)與風險稽核頁(最新期)共用——先前組裝寫在 RiskAudit.jsx 裡,估驗頁若再抄一份,
// 兩頁遲早對同一份資料給出不同發現。Edge 的 integrityAuditTool.ts 有等價的伺服器端組法
// (兩邊如改要同步,該檔檔頭有註明)。
//
// billedItems:{ item_key: 累計完成數量 }——傳哪一期就檢核哪一期(估驗頁傳選中的期別,
// 稽核頁傳最新期)。leaves 吃 adjustedItems(含已核准變更):「接近完成未申請查驗」以 b/q≥0.8
// 判定,q 用原契約量的話,核准追加後會拿舊分母算出假發現。
// 刻意不換成 boqCalc.billableLeaves:那支的父子對照建在「全部 items」上,這裡吃的是
// buildBillableTree 的 childrenMap(只含可計價非合計列);子項全是合計列的分項在兩把尺下結果
// 不同,要併必須先定案哪一個是規則。
import { buildIntegrityFindings, isConcretePourItem } from './integrityAudit.js'

export function buildValuationChecks({
  adjustedItems = [], childrenMap, siteLogs = [], billedItems = {}, inspections = [], testSamples = [],
} = {}) {
  const kids = childrenMap || new Map()
  const idToKey = new Map(adjustedItems.filter((it) => it.id).map((it) => [it.id, it.item_key]))
  const leaves = adjustedItems.filter((it) => it.is_billable && !it.is_rollup && !(kids.get(it.item_key)?.length))

  // 日誌:逐工項累加當日數量(item_key 為鍵)
  const loggedQty = new Map()
  for (const lg of siteLogs) {
    for (const [k, q] of Object.entries(lg.items || {})) loggedQty.set(k, (loggedQty.get(k) || 0) + (Number(q) || 0))
  }
  // 估驗:指定期別的各工項累計數量
  const billedQty = new Map(Object.entries(billedItems || {}).map(([k, v]) => [k, Number(v) || 0]))
  // 查驗:inspections 已依 created_at desc → 每工項第一個=最近一次;work_item_id(uuid)→item_key
  const inspStatusByItem = new Map()
  for (const ins of inspections) {
    const key = idToKey.get(ins.work_item_id)
    if (key && !inspStatusByItem.has(key)) inspStatusByItem.set(key, ins.status)
  }
  // 混凝土澆置日:澆置工項(isConcretePourItem)當日數量 >0 的日誌日期
  const concreteKeys = new Set(leaves.filter((it) => isConcretePourItem(it.description)).map((it) => it.item_key))
  const pourSet = new Set()
  for (const lg of siteLogs) {
    if (lg.log_date && Object.entries(lg.items || {}).some(([k, q]) => concreteKeys.has(k) && (Number(q) || 0) > 0)) pourSet.add(lg.log_date)
  }

  return buildIntegrityFindings({
    leaves, loggedQty, billedQty, inspStatusByItem,
    pourDates: [...pourSet].map((date) => ({ date })), testSamples,
  })
}
