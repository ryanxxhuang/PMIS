import { describe, it, expect } from 'vitest'
import { buildBillableTree, buildCumMap, totalCumAmount, valuationItemAmount } from './boqCalc.js'

// 最小標單樹：
//   A(母項, 發包)
//     A1 葉 qty 10 × 100 = 1000
//     A2 葉 qty 4  × 250 = 1000
//     A9 合計列(is_rollup, 金額重複母項 → 須排除)
//   B  葉(發包) qty 3 × 111 = 333（除不盡 → 驗證金額×比例無進位誤差）
//   Z  葉(非發包 → 須排除)
const items = [
  { item_key: 'A', parent_key: null, quantity: null, amount: 2000, is_billable: true, is_rollup: false },
  { item_key: 'A1', parent_key: 'A', quantity: 10, amount: 1000, is_billable: true, is_rollup: false },
  { item_key: 'A2', parent_key: 'A', quantity: 4, amount: 1000, is_billable: true, is_rollup: false },
  { item_key: 'A9', parent_key: 'A', quantity: null, amount: 2000, is_billable: true, is_rollup: true },
  { item_key: 'B', parent_key: null, quantity: 3, amount: 333, is_billable: true, is_rollup: false },
  { item_key: 'Z', parent_key: null, quantity: 1, amount: 999, is_billable: false, is_rollup: false },
]

describe('buildBillableTree', () => {
  it('只留發包、非合計列，並依 parent_key 分組', () => {
    const { childrenMap, roots } = buildBillableTree(items)
    expect(roots.map((r) => r.item_key)).toEqual(['A', 'B'])
    expect(childrenMap.get('A').map((c) => c.item_key)).toEqual(['A1', 'A2'])
    expect(childrenMap.has('Z')).toBe(false)
  })
})

describe('buildCumMap(P4c:葉 = 期別物件的 amounts[key],即 DB 的 amount_cum;父 = 子項加總)', () => {
  const { childrenMap, roots } = buildBillableTree(items)

  it('葉讀 amounts,母項加總;items(數量)不參與金額', () => {
    const cum = buildCumMap(roots, childrenMap, { items: { A1: 5, A2: 1 }, amounts: { A1: 500, A2: 250 } })
    expect(cum.get('A1')).toBe(500)
    expect(cum.get('A2')).toBe(250)
    expect(cum.get('A')).toBe(750)
  })

  it('前端不換算:只有數量沒有金額的期別,金額就是 0(不得用金額×比例或單價×數量補算)', () => {
    const cum = buildCumMap(roots, childrenMap, { items: { A1: 10, A2: 4, B: 3 } })
    expect(cum.get('A')).toBe(0)
    expect(cum.get('B')).toBe(0)
  })

  it('沒有期別／空期別 → 全 0;合計列與非發包列不在樹上', () => {
    expect(buildCumMap(roots, childrenMap, null).get('A')).toBe(0)
    const cum = buildCumMap(roots, childrenMap, { items: {}, amounts: { A9: 999, Z: 999 } })
    expect(cum.get('A')).toBe(0)
    expect(cum.has('Z')).toBe(false)
  })
})

describe('valuationItemAmount(fn_valuation_amount 鏡像:round(累計量 × 單價) 到元;只給 demo／fixture)', () => {
  it('四捨五入到元;缺值視為 0', () => {
    expect(valuationItemAmount(3, 111)).toBe(333)
    expect(valuationItemAmount(12.3456, 1000)).toBe(12346)
    expect(valuationItemAmount(2.5, 1)).toBe(3)
    expect(valuationItemAmount(null, 100)).toBe(0)
    expect(valuationItemAmount(5, null)).toBe(0)
  })
})

describe('totalCumAmount', () => {
  it('等於所有根節點累計金額之和', () => {
    const { childrenMap, roots } = buildBillableTree(items)
    const cum = buildCumMap(roots, childrenMap, { items: { A1: 10, A2: 4, B: 3 }, amounts: { A1: 1000, A2: 1000, B: 333 } })
    expect(totalCumAmount(roots, cum)).toBe(2333)
  })
})
