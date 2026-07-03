// 變更設計預算書 diff：新版 PCCES 預算書 vs 現行工項樹 → 追加減帳明細草稿。
// 只比對「發包末端」工項（與變更設計頁可連結工項同一規則）。
// 比對鍵：item_key（PCCES itemKey）優先；未中者以「名稱+單位」一對一後備比對（項次重編時）。
// 單價變更以兩筆表達（減帳原量@原價 + 追加新量@新價），與追加減帳表實務一致，
// 也維持 amount_delta = qty_delta × unit_price 的既有不變式。

export function billableLeaves(items) {
  const childMap = new Map()
  for (const it of items) {
    const k = it.parent_key || '__root__'
    if (!childMap.has(k)) childMap.set(k, [])
    childMap.get(k).push(it)
  }
  return items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
}

const round2 = (n) => Math.round(n * 100) / 100
const descKey = (it) => `${(it.description || '').replace(/\s/g, '')}||${(it.unit || '').trim()}`

// currentItems / revisedItems：parsePccesXml 輸出的 items 陣列（或 workItems.items）
// 回傳 { rows, summary }；rows 形狀對齊 addChangeOrderItem 的 input
// （work_item_key 連回現行工項；新增項為 null）
export function diffBoq(currentItems, revisedItems) {
  const cur = billableLeaves(currentItems)
  const rev = billableLeaves(revisedItems)

  const curByKey = new Map(cur.map((it) => [it.item_key, it]))
  const revByKey = new Map(rev.map((it) => [it.item_key, it]))

  const pairs = []          // [curItem, revItem]
  const curLeft = []        // 現行有、新版沒有（候選：刪除項）
  const revLeft = []        // 新版有、現行沒有（候選：新增項）

  for (const it of cur) {
    if (revByKey.has(it.item_key)) pairs.push([it, revByKey.get(it.item_key)])
    else curLeft.push(it)
  }
  for (const it of rev) if (!curByKey.has(it.item_key)) revLeft.push(it)

  // 後備比對：名稱+單位 兩邊各恰好一筆才配對（避免同名工項誤配）
  const groupBy = (arr) => {
    const m = new Map()
    for (const it of arr) { const k = descKey(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it) }
    return m
  }
  const curGroups = groupBy(curLeft), revGroups = groupBy(revLeft)
  const removed = [], added = []
  for (const [k, cs] of curGroups) {
    const rs = revGroups.get(k)
    if (cs.length === 1 && rs?.length === 1) { pairs.push([cs[0], rs[0]]); revGroups.delete(k) }
    else removed.push(...cs)
  }
  for (const rs of revGroups.values()) added.push(...rs)

  const rows = []
  const push = (kind, work_item_key, src, qty_delta, unit_price, note) => {
    if (!qty_delta) return
    rows.push({
      kind, work_item_key,
      item_no: src.item_no || '', description: src.description || '', unit: src.unit || '',
      qty_delta: round2(qty_delta), unit_price: unit_price ?? 0,
      amount_delta: round2(qty_delta * (unit_price ?? 0)),
      note: note || null,
    })
  }

  for (const [c, r] of pairs) {
    const q1 = c.quantity || 0, q2 = r.quantity || 0
    const p1 = c.unit_price ?? 0, p2 = r.unit_price ?? 0
    if (p1 === p2) {
      if (q1 !== q2) push('數量增減', c.item_key, c, q2 - q1, p1)
    } else {
      // 單價變更：減帳原量@原價、追加新量@新價
      push('單價變更-減', c.item_key, c, -q1, p1, `單價變更 ${p1}→${p2}`)
      push('單價變更-加', null, r, q2, p2, `單價變更 ${p1}→${p2}`)
    }
  }
  for (const c of removed) push('刪除項', c.item_key, c, -(c.quantity || 0), c.unit_price ?? 0)
  for (const r of added) push('新增項', null, r, r.quantity || 0, r.unit_price ?? 0)

  const net = round2(rows.reduce((s, r) => s + r.amount_delta, 0))
  return {
    rows,
    summary: {
      changed: rows.filter((r) => r.kind === '數量增減').length,
      priceChanged: pairs.filter(([c, r]) => (c.unit_price ?? 0) !== (r.unit_price ?? 0)).length,
      added: added.length, removed: removed.length,
      net,
    },
  }
}
