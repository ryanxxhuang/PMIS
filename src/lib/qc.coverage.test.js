// 檢查表覆蓋程度(W03):只是呈現,overall 不變——已檢 1／15 合格仍是「合格」,但要能說出 14 項未檢。
import { describe, it, expect } from 'vitest'
import { judgeChecklist, checklistCoverage, coverageText } from './qc.js'
import { TEMPLATE_03310 } from '../data/checklist03310.js'

describe('checklistCoverage', () => {
  it('只填一項:overall 合格、已檢 1／15、14 項未檢', () => {
    const { results, overall } = judgeChecklist(TEMPLATE_03310, { C2: 18.5 })
    expect(overall).toBe('合格')
    const cov = checklistCoverage(TEMPLATE_03310, results)
    expect(cov).toEqual({ checked: 1, total: 15, unchecked: 14 })
    expect(coverageText(cov)).toBe('已檢 1／15，14 項未檢')
  })
  it('全填:無未檢;含不合格仍算已檢;完全未填:已檢 0', () => {
    const all = Object.fromEntries(TEMPLATE_03310.items.map((it) => [it.no, it.kind === 'bool' ? true : (it.min ?? it.max ?? 1)]))
    const full = judgeChecklist(TEMPLATE_03310, all)
    expect(coverageText(checklistCoverage(TEMPLATE_03310, full.results))).toBe('已檢 15／15')
    const bad = judgeChecklist(TEMPLATE_03310, { C2: 99, B1: true })
    expect(bad.overall).toBe('不合格')
    expect(checklistCoverage(TEMPLATE_03310, bad.results).checked).toBe(2)
    expect(checklistCoverage(TEMPLATE_03310, judgeChecklist(TEMPLATE_03310, {}).results).checked).toBe(0)
  })
  it('範本已刪除:只報已檢數', () => {
    expect(coverageText(checklistCoverage(null, { C2: { value: 1, pass: true } }))).toBe('已檢 1 項')
  })
})
