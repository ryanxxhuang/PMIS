import { describe, it, expect } from 'vitest'
import { buildBillableTree, buildCumMap, totalCumAmount } from './boqCalc.js'

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

describe('buildCumMap', () => {
  const { childrenMap, roots } = buildBillableTree(items)

  it('葉 = 金額 × 完成比例；母項 = 子項加總', () => {
    const cum = buildCumMap(roots, childrenMap, { A1: 5, A2: 1 })
    expect(cum.get('A1')).toBe(500) // 1000 × 5/10
    expect(cum.get('A2')).toBe(250) // 1000 × 1/4
    expect(cum.get('A')).toBe(750)
  })

  it('100% 完成時累計金額正好等於契約金額（無進位誤差）', () => {
    const cum = buildCumMap(roots, childrenMap, { A1: 10, A2: 4, B: 3 })
    expect(cum.get('A')).toBe(2000)
    expect(cum.get('B')).toBe(333) // 111×3 若用單價×數量會有浮點誤差
  })

  it('未填數量視為 0；契約數量為 0 或 null 的葉 = 0', () => {
    const cum = buildCumMap(roots, childrenMap, {})
    expect(cum.get('A1')).toBe(0)
    expect(cum.get('A')).toBe(0)
    const zeroQty = buildBillableTree([
      { item_key: 'X', parent_key: null, quantity: 0, amount: 100, is_billable: true, is_rollup: false },
    ])
    expect(buildCumMap(zeroQty.roots, zeroQty.childrenMap, { X: 5 }).get('X')).toBe(0)
  })
})

describe('totalCumAmount', () => {
  it('等於所有根節點累計金額之和', () => {
    const { childrenMap, roots } = buildBillableTree(items)
    const cum = buildCumMap(roots, childrenMap, { A1: 10, A2: 4, B: 3 })
    expect(totalCumAmount(roots, cum)).toBe(2333)
  })
})
