import { describe, it, expect } from 'vitest'
import { auditProject } from './riskAudit.js'

const TODAY = new Date('2026-07-08T00:00:00')

describe('auditProject', () => {
  it('證據齊全的乾淨專案 → 每項都有結果、全數 pass', () => {
    const { checks, summary } = auditProject({
      periodAmounts: [{ period_no: 1, thisAmt: 100 }, { period_no: 2, thisAmt: 110 }, { period_no: 3, thisAmt: 105 }],
      changeOrders: [], defects: [],
      obligations: [{ title: '投保', status: '待辦', trigger_event: 'fixed', fixed_date: '2026-12-31' }],
      billableTotal: 1000,
      progress: { actualPct: 25, plannedPct: 26 },
    }, TODAY)
    expect(checks.length).toBe(5) // 估驗/變更/品質/契約/進度
    expect(summary.pass).toBe(5)
    expect(summary.na).toBe(0)
  })

  it('最小證據:資料不足 → 未評估(na),不算通過(P1-2 錯誤安全感)', () => {
    const { checks, summary } = auditProject({
      periodAmounts: [{ period_no: 1, thisAmt: 100 }], // 只有一期:不得稱「平穩」
      changeOrders: [], defects: [], obligations: [],  // 無契約義務:不得稱「無逾期」
      billableTotal: 0,                                // 無標單:變更佔比算不出
    }, TODAY)
    expect(checks.find((c) => c.category === '估驗').status).toBe('na')
    expect(checks.find((c) => c.category === '契約').status).toBe('na')
    expect(checks.find((c) => c.category === '變更').status).toBe('na')
    expect(summary.na).toBe(3)
    expect(summary.pass).toBe(1) // 只剩品質(無未結缺失)有證據可通過
  })

  it('未結缺失沒設改善期限 → 品質未評估,不得宣稱「均在期限內」', () => {
    const { checks } = auditProject({
      defects: [{ title: '蜂窩', status: '開立' }], // 無 due_date
      billableTotal: 1000,
    }, TODAY)
    const q = checks.find((c) => c.category === '品質')
    expect(q.status).toBe('na')
    expect(q.detail).toContain('蜂窩')
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
