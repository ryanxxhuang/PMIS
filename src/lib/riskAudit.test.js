import { describe, it, expect } from 'vitest'
import { auditProject } from './riskAudit.js'

const TODAY = new Date('2026-07-08T00:00:00')

describe('auditProject', () => {
  it('乾淨專案 → 每項都有結果、且多為 pass', () => {
    const { checks, summary } = auditProject({
      periodAmounts: [{ period_no: 1, thisAmt: 100 }, { period_no: 2, thisAmt: 110 }],
      changeOrders: [], defects: [], obligations: [], billableTotal: 1000,
      progress: { actualPct: 25, plannedPct: 26 },
    }, TODAY)
    expect(checks.length).toBe(5) // 估驗/變更/品質/契約/進度
    expect(summary.pass).toBe(5)
  })

  it('偵測估驗跳增', () => {
    const { checks } = auditProject({
      periodAmounts: [{ period_no: 1, thisAmt: 100 }, { period_no: 2, thisAmt: 100 }, { period_no: 3, thisAmt: 400 }],
      billableTotal: 1000,
    }, TODAY)
    const est = checks.find((c) => c.category === '估驗')
    expect(est.status).toBe('warn')
    expect(est.detail).toContain('第 3 期')
  })

  it('偵測待核定變更佔比偏高', () => {
    const { checks } = auditProject({
      changeOrders: [{ status: '審核中', items: [{ amount_delta: 80 }] }],
      billableTotal: 1000, // 8% > 5%
    }, TODAY)
    expect(checks.find((c) => c.category === '變更').status).toBe('warn')
  })

  it('偵測逾期缺失與逾期契約義務', () => {
    const { checks, summary } = auditProject({
      defects: [{ title: '蜂窩', status: '開立', due_date: '2026-07-01' }],
      obligations: [{ title: '投保', status: '待辦', trigger_event: 'fixed', fixed_date: '2026-07-01', penalty: '扣款' }],
      billableTotal: 1000,
    }, TODAY)
    expect(checks.find((c) => c.category === '品質').status).toBe('warn')
    expect(checks.find((c) => c.category === '契約').status).toBe('risk')
    expect(summary.risk).toBe(1)
  })
})
