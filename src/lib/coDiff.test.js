import { describe, it, expect } from 'vitest'
import { diffBoq, billableLeaves } from './coDiff.js'

// 最小工項樹：父節點 + 發包末端 + 非發包 + 合計列
const leaf = (key, over = {}) => ({
  item_key: key, parent_key: 'P1', item_no: key, description: `工項${key}`, unit: 'M2',
  quantity: 100, unit_price: 10, amount: 1000,
  is_leaf: true, is_rollup: false, is_billable: true, ...over,
})
const parent = { item_key: 'P1', parent_key: null, item_no: '壹', description: '工程', unit: '式', quantity: 1, unit_price: null, amount: 5000, is_leaf: false, is_rollup: false, is_billable: true }

describe('billableLeaves', () => {
  it('排除父節點、合計列、非發包', () => {
    const items = [parent, leaf('A'), leaf('B', { is_rollup: true }), leaf('C', { is_billable: false })]
    expect(billableLeaves(items).map((i) => i.item_key)).toEqual(['A'])
  })
})

describe('diffBoq', () => {
  it('數量不變 → 無明細', () => {
    const cur = [parent, leaf('A')]
    const { rows, summary } = diffBoq(cur, [parent, leaf('A')])
    expect(rows).toEqual([])
    expect(summary.net).toBe(0)
  })

  it('數量增減：qty_delta = 新 − 舊、金額 = Δ × 單價', () => {
    const { rows, summary } = diffBoq([parent, leaf('A')], [parent, leaf('A', { quantity: 130 })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: '數量增減', work_item_key: 'A', qty_delta: 30, unit_price: 10, amount_delta: 300 })
    expect(summary).toMatchObject({ changed: 1, added: 0, removed: 0, net: 300 })
  })

  it('減量為負數', () => {
    const { rows } = diffBoq([parent, leaf('A')], [parent, leaf('A', { quantity: 60 })])
    expect(rows[0]).toMatchObject({ qty_delta: -40, amount_delta: -400 })
  })

  it('刪除項：全量減帳並連結現行工項', () => {
    const { rows, summary } = diffBoq([parent, leaf('A'), leaf('B')], [parent, leaf('A')])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: '刪除項', work_item_key: 'B', qty_delta: -100, amount_delta: -1000 })
    expect(summary.removed).toBe(1)
  })

  it('新增項：全量追加、不連結（work_item_key = null）', () => {
    const { rows } = diffBoq([parent, leaf('A')], [parent, leaf('A'), leaf('N', { description: '新增工項', quantity: 5, unit_price: 200 })])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: '新增項', work_item_key: null, qty_delta: 5, unit_price: 200, amount_delta: 1000 })
  })

  it('單價變更 → 兩筆：減原量@原價 + 追加新量@新價', () => {
    const { rows, summary } = diffBoq([parent, leaf('A')], [parent, leaf('A', { quantity: 120, unit_price: 12 })])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: '單價變更-減', work_item_key: 'A', qty_delta: -100, unit_price: 10, amount_delta: -1000 })
    expect(rows[1]).toMatchObject({ kind: '單價變更-加', work_item_key: null, qty_delta: 120, unit_price: 12, amount_delta: 1440 })
    expect(summary.net).toBe(440) // 120×12 − 100×10
  })

  it('項次重編（itemKey 全換）→ 名稱+單位一對一後備比對，數量差正確', () => {
    const cur = [parent, leaf('A', { description: '鋼筋' }), leaf('B', { description: '模板' })]
    const rev = [parent, leaf('X', { description: '鋼筋', quantity: 110 }), leaf('Y', { description: '模板' })]
    const { rows, summary } = diffBoq(cur, rev)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: '數量增減', work_item_key: 'A', qty_delta: 10 })
    expect(summary.added).toBe(0)
    expect(summary.removed).toBe(0)
  })

  it('同名工項多筆時不後備比對（進新增/刪除，避免誤配）', () => {
    const cur = [parent, leaf('A', { description: '挖方' }), leaf('B', { description: '挖方' })]
    const rev = [parent, leaf('X', { description: '挖方' })]
    const { summary } = diffBoq(cur, rev)
    expect(summary.removed).toBe(2)
    expect(summary.added).toBe(1)
  })

  it('浮點數量四捨五入到 2 位', () => {
    const { rows } = diffBoq([parent, leaf('A', { quantity: 0.1 })], [parent, leaf('A', { quantity: 0.3 })])
    expect(rows[0].qty_delta).toBe(0.2)
  })
})
