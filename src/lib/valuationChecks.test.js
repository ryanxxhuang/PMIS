// 估驗勾稽檢核的輸入組裝(D-026 P1b)。引擎本身由 integrityAudit.test.js 釘住;這裡釘的是
// 「store 資料形狀 → 引擎六個輸入」的組法:哪些列算末端工項、日誌怎麼累加、查驗怎麼對到工項、
// 澆置日怎麼取、檢核的是傳入的那一期——估驗頁與風險稽核頁共用同一支,組法只能有一份。
import { describe, it, expect } from 'vitest'
import { buildValuationChecks } from './valuationChecks.js'

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

  it('沒有資料:零發現、零計價工項,不炸', () => {
    expect(buildValuationChecks()).toEqual({ findings: [], summary: { risk: 0, warn: 0, checked: 0 } })
    expect(buildValuationChecks({ adjustedItems, childrenMap, billedItems: null, siteLogs: [] }).findings).toEqual([])
  })
})
