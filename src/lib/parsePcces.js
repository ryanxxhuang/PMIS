// PCCES 預算書/標單（eTender XML）瀏覽器端解析器。
// 對應 scripts/import_boq.py，輸出與 workItems.json 同形狀：{ meta, items }。
// 走 <DetailList> 工項樹；發包/非發包用「非發包」標記偵測（不寫死壹/貳，支援任何案子）。

const NS_LOCAL = (el, name) => [...el.children].filter((c) => c.localName === name)

// 取子元素文字，Description/Unit 有 language 屬性 → 取 zh-TW；其餘取第一個
function localText(el, name, lang = 'zh-TW') {
  for (const c of el.children) {
    if (c.localName === name) {
      const l = c.getAttribute('language')
      if (l === null || l === lang) return (c.textContent || '').trim()
    }
  }
  return ''
}

const num = (s) => {
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

const ROLLUP_KINDS = new Set(['subtotal']) // 合計列：金額重複母項，加總時排除（formula 是真實金額不排除）

export function parsePccesXml(xmlString) {
  const clean = (xmlString || '').replace(/^﻿/, '') // 去 BOM
  const doc = new DOMParser().parseFromString(clean, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML 解析失敗，檔案格式不正確')
  const root = doc.documentElement
  if (!root || root.localName !== 'ETenderSheet') {
    throw new Error('這不是 PCCES 預算書 XML（找不到 ETenderSheet）')
  }
  const info = NS_LOCAL(root, 'TenderInformation')[0]
  const detail = NS_LOCAL(root, 'DetailList')[0]
  if (!detail) throw new Error('找不到 DetailList（標單明細）')

  const meta = {
    contract_no: (info?.getAttribute('contractNo') || '').trim(),
    owner_name: info ? localText(info, 'ProcuringEntity') : '',
    project_name: info ? localText(info, 'ContractTitle') : '',
    location: info ? localText(info, 'ContractLocation') : '',
  }

  const items = []
  let order = 0
  let nonBillable = false // 一旦碰到頂層「非發包」分段，其後皆非發包

  function walk(node, parentKey, depth, section, billable) {
    for (const c of NS_LOCAL(node, 'PayItem')) {
      const itemNo = (c.getAttribute('itemNo') || '').trim()
      const kind = c.getAttribute('itemKind') || ''
      const desc = localText(c, 'Description')
      const kids = NS_LOCAL(c, 'PayItem')

      let sect = section
      let bill = billable
      if (depth === 1) {
        if (itemNo && !itemNo.includes('.')) sect = itemNo
        if (nonBillable || desc.includes('非發包')) bill = false
        else bill = true
        if (desc.includes('非發包')) nonBillable = true
      }

      order += 1
      const item = {
        item_key: (c.getAttribute('itemKey') || '').trim(),
        parent_key: parentKey,
        item_no: itemNo,
        ref_item_code: (c.getAttribute('refItemCode') || '').trim(),
        item_kind: kind,
        description: desc,
        unit: localText(c, 'Unit'),
        quantity: num(localText(c, 'Quantity')),
        unit_price: num(localText(c, 'Price')),
        amount: num(localText(c, 'Amount')),
        section: sect,
        depth,
        sort_order: order,
        is_leaf: kids.length === 0,
        is_rollup: ROLLUP_KINDS.has(kind),
        is_price_adjustable: kind === 'variablePrice',
        is_billable: bill,
        remark: localText(c, 'Remark'),
        weight: null,
      }
      items.push(item)
      walk(c, item.item_key, depth + 1, sect, bill)
    }
  }
  walk(detail, null, 1, null, true)

  if (!items.length) throw new Error('DetailList 內沒有工項')

  // 進度權重：發包末端非合計工項，amount / 發包末端總額
  const billableLeafTotal = items
    .filter((it) => it.is_billable && it.is_leaf && !it.is_rollup)
    .reduce((s, it) => s + (it.amount || 0), 0)
  if (billableLeafTotal) {
    for (const it of items) {
      if (it.is_billable && it.is_leaf && !it.is_rollup) it.weight = (it.amount || 0) / billableLeafTotal
    }
  }
  meta.billable_total = Math.round(billableLeafTotal)
  meta.item_count = items.length
  meta.leaf_count = items.filter((it) => it.is_leaf && !it.is_rollup).length

  return { meta, items }
}
