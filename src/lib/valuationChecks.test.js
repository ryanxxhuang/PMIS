// 估驗勾稽檢核的輸入組裝(D-026 P1b)。引擎本身由 integrityAudit.test.js 釘住;這裡釘的是
// 「store 資料形狀 → 引擎六個輸入」的組法:哪些列算末端工項、日誌怎麼累加、查驗怎麼對到工項、
// 澆置日怎麼取、檢核的是傳入的那一期——估驗頁與風險稽核頁共用同一支,組法只能有一份。
import { describe, it, expect } from 'vitest'
import { buildValuationChecks, describeViolation, VIOLATION_TEXT } from './valuationChecks.js'

const adjustedItems = [
  { id: 'u-A', item_key: 'A', item_no: '01', description: '結構體', unit: '式', quantity: null, is_billable: true, is_rollup: false },
  { id: 'u-A1', item_key: 'A1', item_no: '01-1', description: '基礎混凝土', unit: 'm3', quantity: 100, is_billable: true, is_rollup: false },
  { id: 'u-A2', item_key: 'A2', item_no: '01-2', description: '鋼筋', unit: 't', quantity: 50, is_billable: true, is_rollup: false },
  { id: 'u-A9', item_key: 'A9', item_no: '', description: '小計', unit: '', quantity: null, is_billable: true, is_rollup: true },
  { id: 'u-X', item_key: 'X', item_no: '99', description: '非計價項', unit: '式', quantity: 1, is_billable: false, is_rollup: false },
]
const childrenMap = new Map([['A', [adjustedItems[1], adjustedItems[2]]]])
const byTitle = (title, findings) => findings.find((f) => f.title.includes(title))

describe('buildValuationChecks', () => {
  it('末端工項=可計價、非合計、無可計價子項;checked 只數有計價的末端項', () => {
    const { summary } = buildValuationChecks({
      adjustedItems, childrenMap,
      siteLogs: [{ log_date: '2026-07-01', items: { A1: 100, A2: 50 } }],
      billedItems: { A: 1, A1: 100, A2: 50, A9: 5, X: 1 }, // 母項/合計/非計價列不算
    })
    expect(summary.checked).toBe(2)
  })

  it('日誌跨日累加;檢核的是傳入那一期的累計量(超前 5% 才報)', () => {
    const logs = [
      { log_date: '2026-07-01', items: { A2: 20 } },
      { log_date: '2026-07-02', items: { A2: 20 } },
    ]
    const clean = buildValuationChecks({ adjustedItems, childrenMap, siteLogs: logs, billedItems: { A2: 40 } })
    expect(byTitle('估驗超前施工日誌', clean.findings)).toBeFalsy()
    const over = buildValuationChecks({ adjustedItems, childrenMap, siteLogs: logs, billedItems: { A2: 50 } })
    expect(byTitle('估驗超前施工日誌', over.findings)?.status).toBe('risk')
    expect(byTitle('估驗超前施工日誌', over.findings).detail).toContain('鋼筋')
  })

  it('查驗以 work_item_id(uuid)對回 item_key,取最近一次;對不到的查驗不影響', () => {
    const inspections = [
      { work_item_id: 'u-A2', status: '不合格' }, // 最近
      { work_item_id: 'u-A2', status: '合格' },
      { work_item_id: null, status: '不合格' },
      { work_item_id: 'no-such', status: '不合格' },
    ]
    const { findings } = buildValuationChecks({
      adjustedItems, childrenMap, inspections,
      siteLogs: [{ log_date: '2026-07-01', items: { A2: 50 } }], billedItems: { A2: 50 },
    })
    const f = byTitle('查驗不合格工項仍計價', findings)
    expect(f?.status).toBe('risk')
    expect(f.detail).toContain('鋼筋')
    expect(f.detail).not.toContain('混凝土')
  })

  it('澆置日=澆置工項當日數量 >0 的日誌日期(模板等非澆置工項與 0 量不算);與試體取樣日對帳', () => {
    const items = [...adjustedItems,
      { id: 'u-A3', item_key: 'A3', item_no: '01-3', description: '混凝土模板', unit: 'm2', quantity: 10, is_billable: true, is_rollup: false }]
    const cm = new Map([['A', [items[1], items[2], items[5]]]])
    const siteLogs = [
      { log_date: '2026-07-01', items: { A1: 10 } },   // 澆置
      { log_date: '2026-07-02', items: { A1: 0 } },    // 0 量不算
      { log_date: '2026-07-03', items: { A3: 5 } },    // 模板不算
      { log_date: '2026-07-04', items: { A1: 10 } },   // 澆置、有試體
    ]
    const { findings } = buildValuationChecks({
      adjustedItems: items, childrenMap: cm, siteLogs, billedItems: {},
      testSamples: [{ sampled_date: '2026-07-04', status: '合格', sample_no: 'S1' }],
    })
    const f = byTitle('混凝土澆置未見取樣試體', findings)
    expect(f?.status).toBe('risk')
    expect(f.title).toContain('1 日')
    expect(f.detail).toContain('2026-07-01')
  })

  it('沒有資料:零發現、零計價工項,不炸;沒有 state(demo／載入前)就沒有缺件,不假裝通過', () => {
    const r = buildValuationChecks()
    expect(r.findings).toEqual([])
    expect(r.summary).toEqual({ block: 0, risk: 0, warn: 0, checked: 0, overKeys: [], noLogKeys: [], unbackedKeys: [] })
    expect(r.itemFlags.size).toBe(0)
    expect(buildValuationChecks({ adjustedItems, childrenMap, billedItems: null, siteLogs: [] }).findings).toEqual([])
  })
})

// P4c:DB 檢查點的違反清單(get_valuation_state.violations／items[].violations)翻成缺件與逐工項標示,
// 與勾稽發現同一份輸出;決策列的超前／無日誌計數也從這裡拿(valuationDiff.js 已刪)。
describe('缺件(DB 檢查點)與口徑合併', () => {
  const state = {
    violations: [
      { code: 'period_end_missing', message: '計價截止日(period_end)未填,送審／核定前必填' },
      { work_item_id: 'u-A2', code: 'source_mismatch', message: '本期增量 50 與來源分配 0 不符(缺監造確認來源)', delta: 50, sources_sum: 0 },
      { work_item_id: 'u-A1', code: 'legacy_source', message: '數量 100 來自歷史遷移,不是監造確認;需人工補證(監造確認單)' },
      { work_item_id: 'u-A1', code: 'legacy_source', message: '數量 100 來自歷史遷移,不是監造確認;需人工補證(監造確認單)' }, // 同工項同代碼不重複列
    ],
    items: [
      { work_item_id: 'u-A2', violations: [{ code: 'source_mismatch', message: 'x' }], sources: [] },
      { work_item_id: 'u-A1', violations: [{ code: 'legacy_source', message: 'y' }], sources: [{ kind: 'legacy' }] },
      { work_item_id: 'u-X', violations: [{ code: 'basis_missing', message: 'z' }], sources: [] },
      { work_item_id: 'no-such', violations: [{ code: 'over_contract' }] }, // 對不到工項的略過
    ],
  }

  it('每種代碼一項缺件(block),列出涉及工項的人話與處理入口;期別層級代碼沒有工項', () => {
    const { findings, summary } = buildValuationChecks({ adjustedItems, childrenMap, billedItems: { A1: 100, A2: 50 }, state })
    const blocks = findings.filter((f) => f.status === 'block')
    expect(blocks.map((f) => f.code)).toEqual(['period_end_missing', 'source_mismatch', 'legacy_source'])
    expect(blocks[0]).toMatchObject({ title: '計價截止日未填', action: 'period_end', keys: [] })
    expect(blocks[1]).toMatchObject({ title: '申報量未經監造確認:1 項工項', action: 'sync', keys: ['A2'] })
    expect(blocks[1].detail).toContain('01-2 鋼筋')
    expect(blocks[1].detail).toContain('不計價')
    expect(blocks[2]).toMatchObject({ title: '數量來自歷史遷移,不是監造確認:1 項工項', action: 'certificate', keys: ['A1'] })
    expect(blocks[2].detail).toContain('補證')
    expect(summary.block).toBe(3)
    // 缺件排在勾稽發現之前(送審會被擋的先看)
    expect(findings[0].status).toBe('block')
  })

  it('逐工項標示:items[].violations → itemFlags(item_key → 缺件清單);unbackedKeys 供可請款投影排除', () => {
    const { itemFlags, summary } = buildValuationChecks({ adjustedItems, childrenMap, billedItems: { A1: 100, A2: 50 }, state })
    expect(itemFlags.get('A2')[0]).toMatchObject({ code: 'source_mismatch', label: '缺監造確認來源' })
    expect(itemFlags.get('A1')[0]).toMatchObject({ code: 'legacy_source', label: '歷史遷移需補證' })
    expect(itemFlags.get('X')[0]).toMatchObject({ code: 'basis_missing', label: '計價依據待設定', action: 'basis' })
    expect(summary.unbackedKeys.sort()).toEqual(['A1', 'A2', 'X'])
  })

  it('超前日誌／無日誌申報的鍵來自勾稽發現本身(單一口徑,決策列與明細列不各判一次)', () => {
    const logs = [{ log_date: '2026-07-01', items: { A1: 50 } }]
    const { summary, findings } = buildValuationChecks({ adjustedItems, childrenMap, siteLogs: logs, billedItems: { A1: 100, A2: 10 } })
    expect(summary.overKeys).toEqual(['A1'])   // 100 > 50 × 1.05
    expect(summary.noLogKeys).toEqual(['A2'])  // 有計價、日誌 0
    expect(findings.find((f) => f.title.startsWith('估驗超前施工日誌')).keys).toEqual(['A1'])
    expect(summary.block).toBe(0)
  })

  it('describeViolation:每個 P4b 代碼都有短標、標題、處理入口;未知代碼不炸', () => {
    for (const code of Object.keys(VIOLATION_TEXT)) {
      const d = describeViolation({ code, message: 'm' })
      expect(d.label).toBeTruthy(); expect(d.title).toBeTruthy(); expect(d.action).toBeTruthy()
    }
    expect(describeViolation({ code: 'brand_new' })).toMatchObject({ label: 'brand_new', action: 'none' })
    expect(describeViolation({ code: 'batch_over_allocated', missing_stages: ['鋼筋'] }).missing_stages).toEqual(['鋼筋'])
  })
})
