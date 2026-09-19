// 估驗期別投影(P4c):DB 列 → 頁面期別物件。釘住的是「往前帶」與「金額不換算」兩條:
//   1. 一期沒有列的工項,累計量／金額 = 往前最近一期的值(與 DB fn_cq_prev_cum_internal 同定義);
//   2. amounts 就是 DB 的 amount_cum,不由數量×單價或金額×比例算;
//   3. own 只含本期自己的列(含 backing),供依據標示與來源展開;
//   4. 對不到 item_key 的列忽略;期別欄位(period_end、note、recheck)帶出。
import { describe, it, expect } from 'vitest'
import { projectValuationPeriods } from './valuationPeriods.js'

const idToKey = new Map([['w1', 'A1'], ['w2', 'A2']])
const vals = [
  { id: 'v2', period_no: 2, status: '草稿', retention_pct: 5, period_end: '2026-09-30', note: null, recheck_required: false },
  { id: 'v1', period_no: 1, status: '已核定', retention_pct: '5', period_end: '2026-08-31', note: '第一期', invoice_date: '2026-09-05', paid_amount: '95000' },
]
const rows = [
  { valuation_id: 'v1', work_item_id: 'w1', cum_qty: '10', amount_cum: '10000', backing: 'legacy' },
  { valuation_id: 'v1', work_item_id: 'w2', cum_qty: '3', amount_cum: '333', backing: 'legacy' },
  { valuation_id: 'v2', work_item_id: 'w1', cum_qty: '25', amount_cum: '25000', backing: 'confirmed' },
  { valuation_id: 'v2', work_item_id: 'w-unknown', cum_qty: '9', amount_cum: '9', backing: 'confirmed' },
]

describe('projectValuationPeriods', () => {
  it('依 period_no 升冪;沒有列的工項往前帶累計量與金額;own 只含本期自己的列', () => {
    const out = projectValuationPeriods(vals, rows, idToKey)
    expect(out.map((v) => v.period_no)).toEqual([1, 2])
    expect(out[0].items).toEqual({ A1: 10, A2: 3 })
    expect(out[0].amounts).toEqual({ A1: 10000, A2: 333 })
    expect(out[1].items).toEqual({ A1: 25, A2: 3 })      // A2 第 2 期沒有列 → 帶第 1 期的 3
    expect(out[1].amounts).toEqual({ A1: 25000, A2: 333 }) // 金額也是帶 DB 的值,不重算
    expect(out[1].own).toEqual({ A1: { cum_qty: 25, amount_cum: 25000, backing: 'confirmed' } })
    expect(out[0].own.A2.backing).toBe('legacy')
  })

  it('期別欄位帶出並轉型;對不到 item_key 的列忽略', () => {
    const out = projectValuationPeriods(vals, rows, idToKey)
    expect(out[0]).toMatchObject({ id: 'v1', status: '已核定', retention_pct: 5, period_end: '2026-08-31', note: '第一期', invoice_date: '2026-09-05', paid_amount: 95000, paid_date: null })
    expect(out[1]).toMatchObject({ id: 'v2', period_end: '2026-09-30', note: null, recheck_required: false, recheck_note: null })
    expect(Object.keys(out[1].items)).not.toContain('w-unknown')
  })

  it('往前帶不會回寫前期(每期各自一份物件);空輸入安全', () => {
    const out = projectValuationPeriods(vals, rows, idToKey)
    out[1].items.A1 = 999
    expect(out[0].items.A1).toBe(10)
    expect(projectValuationPeriods([], [], idToKey)).toEqual([])
    expect(projectValuationPeriods(undefined, undefined, idToKey)).toEqual([])
  })
})
