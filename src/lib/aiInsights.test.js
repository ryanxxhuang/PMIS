import { describe, it, expect } from 'vitest'
import { buildInsights, insightsForRole } from './aiInsights.js'

const TODAY = new Date('2026-07-07T00:00:00')

const data = {
  progress: { actualPct: 20, plannedPct: 27.4 }, // 落後 7.4%
  siteLogs: [{ log_date: '2026-07-01', weather: '晴', materials: [{ name: '預拌混凝土 420kgf/cm²' }] }],
  testSamples: [], // → 澆置未取樣
  defects: [
    { title: '牆面蜂窩', status: '開立', due_date: '2026-07-01' }, // 逾期
    { title: '已修', status: '已結案', due_date: '2026-06-01' },
  ],
  obligations: [
    { id: 'o1', title: '投保營造綜合保險', status: '待辦', trigger_event: 'fixed', fixed_date: '2026-07-01', penalty: '未投保得代辦扣款' }, // 逾期
    { id: 'o2', title: '提送施工計畫', status: '待辦', trigger_event: 'fixed', fixed_date: '2026-07-10' }, // 3 天內
  ],
  valuations: [{ period_no: 4, status: '已核定', invoice_date: '2026-06-20', paid_date: null }], // 未收款
  changeOrders: [{ status: '審核中', items: [{ amount_delta: 500000 }] }], // 待核定
  anchors: {},
}

describe('buildInsights', () => {
  const ins = buildInsights(data, TODAY)
  const ids = ins.map((i) => i.id)
  it('偵測進度落後 / 澆置未取樣 / 缺失逾期 / 未收款 / 待核定變更', () => {
    expect(ids).toContain('progress-behind')
    expect(ids).toContain('pending-samples')
    expect(ids).toContain('overdue-defects')
    expect(ids).toContain('unpaid')
    expect(ids).toContain('pending-co')
  })
  it('契約義務逾期與即將到期各出一項', () => {
    expect(ids.filter((x) => x.startsWith('ob-')).length).toBe(2)
  })
  it('只有未結案缺失計入(排除已結案)', () => {
    expect(ins.find((i) => i.id === 'overdue-defects').title).toContain('1 件')
  })
})

describe('insightsForRole', () => {
  const ins = buildInsights(data, TODAY)
  it('施工廠商看得到澆置未取樣、機關看不到', () => {
    expect(insightsForRole(ins, 'contractor').map((i) => i.id)).toContain('pending-samples')
    expect(insightsForRole(ins, 'owner').map((i) => i.id)).not.toContain('pending-samples')
  })
  it('risk 排在 watch 前面', () => {
    const sevs = insightsForRole(ins, 'contractor').map((i) => i.sev)
    const firstWatch = sevs.indexOf('watch')
    const lastRisk = sevs.lastIndexOf('risk')
    if (firstWatch !== -1 && lastRisk !== -1) expect(lastRisk).toBeLessThan(firstWatch)
  })
})
