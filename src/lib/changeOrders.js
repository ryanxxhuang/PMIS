// 變更設計(追加減帳)→ 估驗/進度的連動計算。
// 原則:只有「核准」的變更生效;有連結 work_item_id 的明細把數量/金額差套回該工項,
// 未連結的(變更新增項目)不進工項樹、只計入變更後契約金額。
// 變更設計頁、估驗、S 曲線、計價單、成本收入共用。

// 已核准變更的追加減淨額(NT$,可為負)
export function approvedNetAmount(changeOrders) {
  let net = 0
  for (const co of changeOrders || []) {
    if (co.status !== '核准') continue
    for (const it of co.items || []) net += Number(it.amount_delta) || 0
  }
  return net
}

// 變更後契約金額 = 原發包工程費 + 已核准追加減淨額
export function revisedContractTotal(billableTotal, changeOrders) {
  return (billableTotal || 0) + approvedNetAmount(changeOrders)
}

// 把已核准、有連結工項的明細差額套回工項清單(回傳新陣列,不改原資料)。
// 葉項的 quantity/amount 各加上 Σqty_delta / Σamount_delta(下限 0)。
// 沒有任何可套用差額時原樣回傳(避免無謂重建)。
export function applyApprovedChangeOrders(items, changeOrders) {
  const deltas = new Map() // work_item uuid → { qty, amt }
  for (const co of changeOrders || []) {
    if (co.status !== '核准') continue
    for (const it of co.items || []) {
      if (!it.work_item_id) continue
      const d = deltas.get(it.work_item_id) || { qty: 0, amt: 0 }
      d.qty += Number(it.qty_delta) || 0
      d.amt += Number(it.amount_delta) || 0
      deltas.set(it.work_item_id, d)
    }
  }
  if (!deltas.size) return items
  return items.map((it) => {
    const d = it.id ? deltas.get(it.id) : null
    if (!d) return it
    return {
      ...it,
      quantity: Math.max(0, (it.quantity || 0) + d.qty),
      amount: Math.max(0, (it.amount || 0) + d.amt),
    }
  })
}
