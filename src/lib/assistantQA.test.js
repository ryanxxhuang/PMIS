import { describe, it, expect } from 'vitest'
import { answerQuestion } from './assistantQA.js'

describe('answerQuestion', () => {
  it('進度問句', () => {
    const r = answerQuestion('目前進度落後多少？', { progress: { actualPct: 20, plannedPct: 27.4 } })
    expect(r.answer).toContain('落後')
    expect(r.sources[0].to).toBe('/progress')
  })
  it('缺失問句只計未結案', () => {
    const r = answerQuestion('有哪些未結案缺失？', { defects: [{ title: 'A', status: '開立' }, { title: 'B', status: '已結案' }] })
    expect(r.answer).toContain('1 件')
    expect(r.answer).toContain('A')
  })
  it('請款問句抓未收款期別', () => {
    const r = answerQuestion('第幾期估驗還沒收款？', {
      valuations: [{ period_no: 4, status: '已核定', invoice_date: '2026-06-20', paid_date: null }], finance: {},
    })
    expect(r.answer).toContain('第 4 期')
  })
  it('取樣問句偵測澆置未取樣', () => {
    const r = answerQuestion('有沒有澆置沒取樣的？', {
      siteLogs: [{ log_date: '2026-07-01', materials: [{ name: '預拌混凝土 420kgf/cm²' }] }], testSamples: [],
    })
    expect(r.answer).toContain('尚未建立取樣試體')
  })
  it('契約保固關鍵字搜義務', () => {
    const r = answerQuestion('契約保固幾年？', { obligations: [{ title: '保固期五年', source_clause: '第 20 條' }] })
    expect(r.answer).toContain('保固')
  })
  it('待我處理問句(不同措辭)', () => {
    const r = answerQuestion('現在有什麼待我處理的？', { myItems: [{ tag: '估驗', meta: '待廠商送審' }] })
    expect(r.answer).toContain('1 件')
  })
  it('答不出來回 null', () => {
    expect(answerQuestion('今天午餐吃什麼？', {})).toBeNull()
    expect(answerQuestion('', {})).toBeNull()
  })
})
