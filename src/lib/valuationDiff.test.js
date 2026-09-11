// W8-4B B2:估驗決策列差異彙總的紅線,用測試釘住——
// 1) 超計判斷與明細列 overBilled 同一條式子(OVER_TOL 同源),兩處不可分裂;
//    無日誌而有計價者也算超計,這正是核定前最該被看到的差異。
// 2) 只計 cum>0 的項:沒計價的工項不進任何計數(決策列不掃整棵樹的前提)。
// 3) 純計數不動金額——函式輸出只有件數與 key,沒有任何金額欄位可被改寫。
import { describe, it, expect } from 'vitest'
import { summarizeValuationDiff } from './Valuation.jsx'
import { OVER_TOL } from '../../lib/evidence.js'

// 佐證形狀對齊 collectEvidence 的回傳(只取本函式會讀的欄位)
const ev = (loggedTotal = 0, counts = {}) => ({
  loggedTotal,
  counts: { logs: 0, inspections: 0, checklists: 0, samples: 0, ...counts },
})

const fixture = () => {
  const leaves = [
    { item_key: '1.1' }, // 超計:估驗 100 > 日誌 50×1.05
    { item_key: '1.2' }, // 無佐證:有計價但全空 → 同時也超計(日誌 0)
    { item_key: '1.3' }, // 相符:估驗 100、日誌 100(容忍值內)
    { item_key: '1.4' }, // cum=0:不進任何計數
  ]
  const cumMap = { '1.1': 100, '1.2': 10, '1.3': 100, '1.4': 0 }
  const evidence = {
    '1.1': ev(50, { logs: 3 }),
    '1.2': ev(),
    '1.3': ev(100, { logs: 5, checklists: 1 }),
    '1.4': ev(),
  }
  return { leaves, cumMap, evidenceOf: (it) => evidence[it.item_key] }
}

describe('三情境計數', () => {
  it('超計:估驗累計 > 日誌累計×OVER_TOL 者列入,回傳 key 供展開佐證欄', () => {
    const { leaves, cumMap, evidenceOf } = fixture()
    const r = summarizeValuationDiff(leaves, cumMap, evidenceOf)
    expect(r.over).toBe(2)
    expect(r.overKeys).toEqual(['1.1', '1.2']) // 1.2 無日誌也算超計(與明細列警示一致)
  })
  it('無佐證:getEvidence 四類全空且有計價者列入', () => {
    const { leaves, cumMap, evidenceOf } = fixture()
    const r = summarizeValuationDiff(leaves, cumMap, evidenceOf)
    expect(r.noEvidence).toBe(1)
    expect(r.noEvidenceKeys).toEqual(['1.2'])
  })
  it('相符:日誌跟得上估驗的項不進任何清單;全相符時兩計數歸零', () => {
    const { evidenceOf } = fixture()
    const r = summarizeValuationDiff([{ item_key: '1.3' }], { '1.3': 100 }, evidenceOf)
    expect(r).toEqual({ over: 0, noEvidence: 0, overKeys: [], noEvidenceKeys: [] })
  })
})

describe('範圍紅線', () => {
  it('只算 cum>0 的項:cum=0 即使無佐證也不列入(未計價無差異可言)', () => {
    const { leaves, cumMap, evidenceOf } = fixture()
    const r = summarizeValuationDiff(leaves, cumMap, evidenceOf)
    expect(r.overKeys).not.toContain('1.4')
    expect(r.noEvidenceKeys).not.toContain('1.4')
  })
  it('容忍值邊界:恰為日誌×OVER_TOL 不算超計,超過才算(嚴格大於)', () => {
    const evidenceOf = () => ev(100, { logs: 1 })
    const at = summarizeValuationDiff([{ item_key: 'k' }], { k: 100 * OVER_TOL }, evidenceOf)
    expect(at.over).toBe(0)
    const above = summarizeValuationDiff([{ item_key: 'k' }], { k: 100 * OVER_TOL + 1 }, evidenceOf)
    expect(above.over).toBe(1)
  })
  it('空輸入安全:無葉項/無計價回傳全零,不丟例外', () => {
    expect(summarizeValuationDiff([], {}, () => ev())).toEqual({ over: 0, noEvidence: 0, overKeys: [], noEvidenceKeys: [] })
    expect(summarizeValuationDiff(undefined, undefined, () => ev())).toEqual({ over: 0, noEvidence: 0, overKeys: [], noEvidenceKeys: [] })
  })
})

describe('穩定性', () => {
  it('固定輸入結果穩定:同輸入兩次呼叫完全相等(順序含在內)', () => {
    const { leaves, cumMap, evidenceOf } = fixture()
    const a = summarizeValuationDiff(leaves, cumMap, evidenceOf)
    const b = summarizeValuationDiff(leaves, cumMap, evidenceOf)
    expect(a).toEqual(b)
  })
})
