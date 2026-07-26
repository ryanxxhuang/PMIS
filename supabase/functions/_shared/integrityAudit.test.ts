// 驗證伺服器端移植與 src/lib/integrityAudit.js 的判斷一致(同一組案例)。
// 兩邊同時餵同一組輸入,斷言 findings/summary「完全相同」—— 這是防止日後
// 兩邊漂移的唯一保險;任何一邊改判斷邏輯,這裡會先紅。
import { describe, it, expect } from 'vitest'
// @ts-expect-error 前端 JS 模組無型別宣告 —— 對照測試刻意直接吃前端原檔
import { buildIntegrityFindings as buildWeb } from '../../../src/lib/integrityAudit.js'
import { buildIntegrityFindings as buildSrv } from './integrityAudit.ts'

const leaves = [
  { item_key: 'A', item_no: '01', description: '基礎混凝土', unit: 'm3', quantity: 100 },
  { item_key: 'B', item_no: '02', description: '鋼筋', unit: 't', quantity: 50 },
  { item_key: 'C', item_no: '03', description: '模板', unit: 'm2', quantity: 200 },
  { item_key: 'D', item_no: '04', description: '結構混凝土', unit: 'm3', quantity: 300 },
]

type Input = Parameters<typeof buildSrv>[0]

// 同一組輸入餵兩邊,先斷言逐位元組同判斷,再回傳結果供個案斷言
const both = (input?: Input) => {
  const web = input === undefined ? buildWeb() : buildWeb(input)
  const srv = input === undefined ? buildSrv() : buildSrv(input)
  expect(srv).toEqual(web)
  return srv
}
const byTitle = (title: string, findings: { title: string }[]) =>
  findings.find((f) => f.title.includes(title))

describe('integrityAudit 伺服器移植 — 與前端同判斷(同一組案例)', () => {
  it('乾淨資料:兩邊皆零發現、summary 相同', () => {
    const { findings, summary } = both({
      leaves,
      loggedQty: new Map([['A', 100], ['B', 50]]),
      billedQty: new Map([['A', 100], ['B', 50]]),
      inspStatusByItem: new Map([['A', '合格'], ['B', '合格']]),
      pourDates: [{ date: '2026-07-01' }],
      testSamples: [{ sampled_date: '2026-07-01', status: '合格', sample_no: 'S1' }],
    })
    expect(findings).toHaveLength(0)
    expect(summary).toEqual({ risk: 0, warn: 0, checked: 2 })
  })

  it('檢查1 估驗超前日誌逾 5% → risk,detail 含數字格式(千分位)', () => {
    const { findings } = both({
      leaves, loggedQty: new Map([['A', 1000]]), billedQty: new Map([['A', 1200]]),
    })
    const f = byTitle('估驗超前施工日誌', findings)!
    expect(f.status).toBe('risk')
    expect(f.detail).toContain('01 基礎混凝土(估驗 1,200 > 日誌 1,000)')
  })

  it('檢查1 容忍值邊界:恰為 1.05 倍不報、超過才報(嚴格大於)', () => {
    expect(byTitle('估驗超前施工日誌', both({
      leaves, loggedQty: new Map([['A', 100]]), billedQty: new Map([['A', 105]]),
    }).findings)).toBeFalsy()
    expect(byTitle('估驗超前施工日誌', both({
      leaves, loggedQty: new Map([['A', 100]]), billedQty: new Map([['A', 105.01]]),
    }).findings)).toBeTruthy()
  })

  it('檢查2 估驗但日誌零 → warn(走無佐證,不算超前)', () => {
    const { findings } = both({ leaves, loggedQty: new Map(), billedQty: new Map([['B', 20]]) })
    expect(byTitle('估驗無施工日誌佐證', findings)?.status).toBe('warn')
    expect(byTitle('估驗超前施工日誌', findings)).toBeFalsy()
  })

  it('檢查3 查驗不合格仍計價 → risk;未計價的不合格工項不報', () => {
    const { findings } = both({
      leaves,
      loggedQty: new Map([['A', 100]]),
      billedQty: new Map([['A', 100]]),
      inspStatusByItem: new Map([['A', '不合格'], ['C', '不合格']]), // C 未計價
    })
    const f = byTitle('查驗不合格工項仍計價', findings)!
    expect(f.status).toBe('risk')
    expect(f.detail).toContain('基礎混凝土')
    expect(f.detail).not.toContain('模板')
  })

  it('檢查4 澆置日無試體 → risk;超過 4 日截斷「等 N 日」', () => {
    const pourDates = ['2026-07-05', '2026-07-04', '2026-07-03', '2026-07-02', '2026-07-01']
      .map((date) => ({ date }))
    const { findings } = both({
      leaves, pourDates, testSamples: [{ sampled_date: '2026-07-03', status: '合格' }],
    })
    const f = byTitle('混凝土澆置未見取樣試體', findings)!
    expect(f.status).toBe('risk')
    expect(f.title).toContain('4 日')
    expect(f.detail).not.toContain('2026-07-03') // 有試體的澆置日不列
    expect(f.detail).toContain('2026-07-05、2026-07-04、2026-07-02、2026-07-01')
  })

  it('檢查5 試體不合格 → risk;無 sample_no 以取樣日呈現', () => {
    const { findings } = both({
      leaves,
      testSamples: [
        { sampled_date: '2026-07-01', status: '不合格', sample_no: 'S9' },
        { sampled_date: '2026-07-02', status: '不合格', sample_no: null },
        { sampled_date: '2026-07-03', status: '合格', sample_no: 'S3' },
      ],
    })
    const f = byTitle('混凝土試體強度不合格', findings)!
    expect(f.title).toContain('2 組')
    expect(f.detail).toContain('S9、2026-07-02')
  })

  it('檢查6 完成 ≥8 成無查驗 → warn;恰 80% 也算;有查驗紀錄則排除', () => {
    const { findings } = both({
      leaves,
      billedQty: new Map([['A', 80], ['B', 40], ['C', 100]]), // A=80%、B=80%、C=50%
      inspStatusByItem: new Map([['B', '合格']]),
    })
    const f = byTitle('接近完成未申請查驗', findings)!
    expect(f.status).toBe('warn')
    expect(f.detail).toContain('基礎混凝土') // A:恰 80%,無查驗 → 報
    expect(f.detail).not.toContain('鋼筋')   // B:有查驗 → 排除
    expect(f.detail).not.toContain('模板')   // C:未達 8 成 → 不報
  })

  it('few 截斷:同類發現超過 3 項 → 「等 N 項」;summary 統計相同', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      item_key: `K${i}`, item_no: `${i + 1}`, description: `工項${i}`, quantity: 10,
    }))
    const { findings, summary } = both({
      leaves: many,
      billedQty: new Map(many.map((it) => [it.item_key, 5])),
    })
    const f = byTitle('估驗無施工日誌佐證', findings)!
    expect(f.detail).toContain('等 5 項')
    expect(summary.checked).toBe(5)
    expect(summary.warn).toBe(1)
  })

  it('多類發現並存:順序與內容兩邊完全一致', () => {
    const { findings } = both({
      leaves,
      loggedQty: new Map([['A', 50]]),
      billedQty: new Map([['A', 80], ['B', 45]]),
      inspStatusByItem: new Map([['A', '不合格']]),
      pourDates: [{ date: '2026-07-09' }],
      testSamples: [{ sampled_date: '2026-07-08', status: '不合格', sample_no: 'S2' }],
    })
    expect(findings.map((f) => f.title.split(':')[0])).toEqual([
      '估驗超前施工日誌', '估驗無施工日誌佐證', '查驗不合格工項仍計價',
      '混凝土澆置未見取樣試體', '混凝土試體強度不合格', '接近完成未申請查驗',
    ])
    for (const f of findings) expect(['/valuation', '/quality']).toContain(f.route)
  })

  it('空輸入 / 無參數不崩,兩邊同回空', () => {
    expect(both().findings).toEqual([])
    expect(both({}).summary).toEqual({ risk: 0, warn: 0, checked: 0 })
  })
})
