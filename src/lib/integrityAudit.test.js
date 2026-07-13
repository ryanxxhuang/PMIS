import { describe, it, expect } from 'vitest'
import { buildIntegrityFindings } from './integrityAudit.js'

const leaves = [
  { item_key: 'A', item_no: '01', description: '基礎混凝土', unit: 'm3', quantity: 100 },
  { item_key: 'B', item_no: '02', description: '鋼筋', unit: 't', quantity: 50 },
  { item_key: 'C', item_no: '03', description: '模板', unit: 'm2', quantity: 200 },
]
const byId = (title, findings) => findings.find((f) => f.title.includes(title))

describe('buildIntegrityFindings', () => {
  it('乾淨資料無發現', () => {
    const { findings, summary } = buildIntegrityFindings({
      leaves,
      loggedQty: new Map([['A', 100], ['B', 50]]),
      billedQty: new Map([['A', 100], ['B', 50]]),
      inspStatusByItem: new Map([['A', '合格'], ['B', '合格']]),
      pourDates: [{ date: '2026-07-01' }],
      testSamples: [{ sampled_date: '2026-07-01', status: '合格', sample_no: 'S1' }],
    })
    expect(findings).toHaveLength(0)
    expect(summary.risk).toBe(0)
  })

  it('估驗超前日誌逾 5% → risk', () => {
    const { findings } = buildIntegrityFindings({
      leaves, loggedQty: new Map([['A', 50]]), billedQty: new Map([['A', 80]]),
    })
    const f = byId('估驗超前施工日誌', findings)
    expect(f).toBeTruthy()
    expect(f.status).toBe('risk')
    expect(f.detail).toContain('基礎混凝土')
  })

  it('容忍 5% 內誤差不報', () => {
    const { findings } = buildIntegrityFindings({
      leaves, loggedQty: new Map([['A', 100]]), billedQty: new Map([['A', 104]]),
    })
    expect(byId('估驗超前施工日誌', findings)).toBeFalsy()
  })

  it('估驗但日誌零 → warn(非超前)', () => {
    const { findings } = buildIntegrityFindings({
      leaves, loggedQty: new Map(), billedQty: new Map([['B', 20]]),
    })
    expect(byId('估驗無施工日誌佐證', findings)?.status).toBe('warn')
    expect(byId('估驗超前施工日誌', findings)).toBeFalsy() // 零日誌走 warn 而非 risk
  })

  it('查驗不合格仍計價 → risk', () => {
    const { findings } = buildIntegrityFindings({
      leaves, loggedQty: new Map([['A', 100]]), billedQty: new Map([['A', 100]]),
      inspStatusByItem: new Map([['A', '不合格']]),
    })
    expect(byId('查驗不合格工項仍計價', findings)?.status).toBe('risk')
  })

  it('混凝土澆置日無試體 → risk;有試體則不報', () => {
    const miss = buildIntegrityFindings({ leaves, pourDates: [{ date: '2026-07-01' }, { date: '2026-07-02' }], testSamples: [{ sampled_date: '2026-07-01', status: '合格' }] })
    const f = byId('混凝土澆置未見取樣試體', miss.findings)
    expect(f?.status).toBe('risk')
    expect(f.detail).toContain('2026-07-02')
    expect(f.detail).not.toContain('2026-07-01')
  })

  it('試體不合格 → risk', () => {
    const { findings } = buildIntegrityFindings({ leaves, testSamples: [{ sampled_date: '2026-07-01', status: '不合格', sample_no: 'S9' }] })
    expect(byId('混凝土試體強度不合格', findings)?.detail).toContain('S9')
  })

  it('接近完成(≥80%)無查驗 → warn;有查驗則不報', () => {
    const { findings } = buildIntegrityFindings({
      leaves, billedQty: new Map([['A', 85], ['B', 40]]),
      inspStatusByItem: new Map([['B', '合格']]), // B 有查驗
    })
    const f = byId('接近完成未申請查驗', findings)
    expect(f?.status).toBe('warn')
    expect(f.detail).toContain('基礎混凝土') // A 接近完成無查驗
    expect(f.detail).not.toContain('鋼筋')     // B 有查驗,排除
  })

  it('空輸入不崩', () => {
    expect(buildIntegrityFindings().findings).toEqual([])
    expect(buildIntegrityFindings({}).summary.risk).toBe(0)
  })
})
