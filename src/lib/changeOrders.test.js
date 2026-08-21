import { describe, it, expect } from 'vitest'
import { approvedNetAmount, revisedContractTotal, applyApprovedChangeOrders } from './changeOrders.js'

const cos = [
  {
    status: '核准',
    items: [
      { work_item_id: 'u1', qty_delta: 50, amount_delta: 100000 },   // 連結工項:追加
      { work_item_id: null, qty_delta: 180, amount_delta: 756000 },  // 新增項目:只進總額
    ],
  },
  {
    status: '審核中', // 未核准 → 完全不生效
    items: [{ work_item_id: 'u1', qty_delta: 999, amount_delta: 9e9 }],
  },
  {
    status: '核准',
    items: [{ work_item_id: 'u2', qty_delta: -30, amount_delta: -60000 }], // 追減
  },
]

describe('approvedNetAmount / revisedContractTotal', () => {
  it('只加總「核准」的明細(含未連結工項的新增項目)', () => {
    expect(approvedNetAmount(cos)).toBe(100000 + 756000 - 60000)
    expect(revisedContractTotal(1000000, cos)).toBe(1796000)
  })
  it('空值安全', () => {
    expect(approvedNetAmount([])).toBe(0)
    expect(approvedNetAmount(null)).toBe(0)
    expect(revisedContractTotal(500, null)).toBe(500)
  })
})

describe('applyApprovedChangeOrders', () => {
  const items = [
    { id: 'u1', item_key: 'A', quantity: 100, amount: 200000 },
    { id: 'u2', item_key: 'B', quantity: 40, amount: 80000 },
    { id: 'u3', item_key: 'C', quantity: 10, amount: 5000 },
  ]

  it('核准且連結工項的差額套回 quantity/amount;其餘工項原樣', () => {
    const out = applyApprovedChangeOrders(items, cos)
    expect(out.find((i) => i.item_key === 'A')).toMatchObject({ quantity: 150, amount: 300000 })
    expect(out.find((i) => i.item_key === 'B')).toMatchObject({ quantity: 10, amount: 20000 })
    expect(out.find((i) => i.item_key === 'C')).toBe(items[2]) // 沒動到的保留同一參照
  })

  it('追減超過原量 → 夾在 0(不出現負數量/負金額)', () => {
    const out = applyApprovedChangeOrders(items, [
      { status: '核准', items: [{ work_item_id: 'u3', qty_delta: -99, amount_delta: -99999 }] },
    ])
    expect(out.find((i) => i.item_key === 'C')).toMatchObject({ quantity: 0, amount: 0 })
  })

  it('沒有可套用差額 → 回傳原陣列(同一參照);不改動原資料', () => {
    expect(applyApprovedChangeOrders(items, [])).toBe(items)
    applyApprovedChangeOrders(items, cos)
    expect(items[0].quantity).toBe(100) // 原陣列未被改
  })
})

// 核准變更後的數字口徑(B-02 殘留破口回歸):逐工項排程的完成% 與風險稽核
// 「接近完成未申請查驗」都以「累計估驗量 ÷ 契約數量」判定,分母必須是
// 變更後數量——用原契約量,核准追加後 100/125 會被誤算成 100% 完成,
// 落後判斷失真、機關稽核也會產出假發現。
describe('核准變更後的完成% 分母口徑', () => {
  it('核准追加後,完成% 以變更後數量為分母(套用前後結論不同)', () => {
    const items = [{ id: 'u1', item_key: 'A', quantity: 100, amount: 200000, is_billable: true }]
    const adj = applyApprovedChangeOrders(items, [
      { status: '核准', items: [{ work_item_id: 'u1', qty_delta: 25, amount_delta: 50000 }] },
    ])
    const billed = 100 // 累計估驗量
    expect((billed / items[0].quantity) * 100).toBe(100)  // 舊口徑:誤判已完成
    expect((billed / adj[0].quantity) * 100).toBe(80)     // 正確口徑:還有兩成沒做
  })
})
