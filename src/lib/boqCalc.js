// 標單金額計算共用工具（估驗 / 進度共用）

let _cache = null
// 載入並快取 work_items（Vite 會 code-split 這份 JSON）
export function loadWorkItems() {
  if (!_cache) _cache = import('../data/workItems.json').then((m) => m.default)
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
