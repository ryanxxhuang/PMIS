// 標單金額計算共用工具（估驗 / 進度共用）

// 欄式 → 列物件(P-05):範例標單存成 { meta, cols, rows }(key 只存一次,
// 檔案 1.38MB→0.65MB);這裡還原成與原 workItems.json 完全相同的 { meta, items }。
// 等價性由 workItemsCompact.test.js 逐項保證;重新產檔見 scripts/compact_workitems.py。
export function rehydrateWorkItems(compact) {
  const { meta, cols, rows } = compact
  const items = rows.map((row) => {
    const it = {}
    for (let i = 0; i < cols.length; i++) it[cols[i]] = row[i]
    return it
  })
  return { meta, items }
}

let _cache = null
// 載入並快取 work_items（Vite 會 code-split 這份 JSON）
export function loadWorkItems() {
  if (!_cache) _cache = import('../data/workItems.compact.json').then((m) => rehydrateWorkItems(m.default))
  return _cache
}

// 只取「發包工程費、非合計列」，建 parent_key → children 對照（合計列會重複母項金額，須排除）
export function buildBillableTree(items) {
  const childrenMap = new Map()
  for (const it of items) {
    if (!it.is_billable || it.is_rollup) continue
    const k = it.parent_key || '__root__'
    if (!childrenMap.has(k)) childrenMap.set(k, [])
    childrenMap.get(k).push(it)
  }
  return { childrenMap, roots: childrenMap.get('__root__') || [] }
}

// 「發包末端工項」= 估驗/日誌回報/變更連結/ITP 管制點共用的計價單元定義。
// 這是資料脊椎的定義,原本散在九頁各抄一次(is_rollup 語意一改就要找九個地方),
// 搬到這裡與 buildBillableTree 並列。
//
// ⚠️ 與 buildBillableTree 的 childrenMap 不是同一把尺,不可互換:
// 這裡的父子對照建在「全部 items」上,buildBillableTree 只建在「可計價非合計列」上。
// 差別出在「子項全是合計列或全是非發包列」的分項——那種節點在這裡不是末端
// (它有子項),在 buildBillableTree 的 childrenMap 下卻會被當成末端。
// 現行範例標單兩者結果相同(2787 項),但這是資料剛好,不是規則相同。
export function billableLeaves(items) {
  const childMap = new Map()
  for (const it of items) {
    const k = it.parent_key || '__root__'
    if (!childMap.has(k)) childMap.set(k, [])
    childMap.get(k).push(it)
  }
  return items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
}

// 估驗期別的累計金額樹:葉 = 該期該工項的累計金額(DB `valuation_items.amount_cum`,由
// `fn_valuation_amount` 逐工項四捨五入到元,續接清單 §6 Q2);父 = 子項加總。
// P4c 起前端不再由「數量 × 單價」或「金額 × 比例」自算金額——同一筆數量在 DB 與畫面算出
// 不同的錢(進位口徑不同)就是估驗單與稽核對不起來的根因;這裡只做加總,不做換算。
// period = 期別物件 { items: {item_key: 累計量}, amounts: {item_key: 累計金額} }
//(DB 模式由 lib/valuationPeriods.js 投影;demo 由 demoSeed 以 valuationItemAmount 產生)。
export function buildCumMap(roots, childrenMap, period) {
  const amounts = period?.amounts || {}
  const map = new Map()
  const calc = (node) => {
    const kids = childrenMap.get(node.item_key) || []
    const v = kids.length === 0
      ? (Number(amounts[node.item_key]) || 0)
      : kids.reduce((s, k) => s + calc(k), 0)
    map.set(node.item_key, v)
    return v
  }
  roots.forEach(calc)
  return map
}

// `fn_valuation_amount` 的鏡像:累計金額 = round(累計量 × 單價) 到元(Q2 暫行口徑;要改口徑
// 兩邊一起改)。**只給沒有 DB 的 demo 模式與測試 fixture 用**——DB 模式的金額一律讀
// `valuation_items.amount_cum`,前端不得用這支重算(DB 端由 pgTAP `confirmed_quantity_calc.sql` 釘住)。
export function valuationItemAmount(cumQty, unitPrice) {
  return Math.round((Number(cumQty) || 0) * (Number(unitPrice) || 0))
}

// 整個工程的累計估驗金額
export function totalCumAmount(roots, cumMap) {
  return roots.reduce((s, r) => s + (cumMap.get(r.item_key) || 0), 0)
}
