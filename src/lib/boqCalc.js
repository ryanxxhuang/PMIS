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

// 由「{work_item_key: 累計完成數量}」算每個工項的累計估驗金額
// 葉 = 契約金額 × (累計完成數量 / 契約數量)；父 = 子項加總。
// （以金額×比例算，確保 100% 完成時累計金額正好等於契約金額，避免單價×數量的進位誤差）
export function buildCumMap(roots, childrenMap, qtyMap) {
  const map = new Map()
  const calc = (node) => {
    const kids = childrenMap.get(node.item_key) || []
    let v
    if (kids.length === 0) {
      const q = node.quantity || 0
      v = q > 0 ? (node.amount || 0) * ((qtyMap[node.item_key] || 0) / q) : 0
    } else {
      v = kids.reduce((s, k) => s + calc(k), 0)
    }
    map.set(node.item_key, v)
    return v
  }
  roots.forEach(calc)
  return map
}

// 整個工程的累計估驗金額
export function totalCumAmount(roots, cumMap) {
  return roots.reduce((s, r) => s + (cumMap.get(r.item_key) || 0), 0)
}
