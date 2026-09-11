import { describe, it, expect } from 'vitest'
import { previousLog, copyableFromLog, frequentItems, addUniqueRow } from './siteLogHelpers.js'

const logs = [
  { log_date: '2026-07-10', weather_am: '晴', weather_pm: '陣雨', work_summary: '10日work', items: { a: 5 },
    labor: [{ type: '鋼筋工', count: 8 }], equipment: [{ name: '吊車', count: 1 }],
    materials: [{ name: '鋼筋', unit: 'T', qty: 3 }], extras: { edu: true } },
  { log_date: '2026-07-11', weather_am: '多雲', work_summary: '11日',
    labor: [{ type: '鋼筋工', count: 6 }, { type: '模板工', count: 4 }], equipment: [{ name: '吊車', count: 1 }],
    materials: [{ name: '鋼筋', unit: 'T', qty: 2 }, { name: '模板', unit: 'm2', qty: 10 }] },
]

describe('previousLog', () => {
  it('取 date 之前最近一筆', () => {
    expect(previousLog(logs, '2026-07-13').log_date).toBe('2026-07-11')
    expect(previousLog(logs, '2026-07-11').log_date).toBe('2026-07-10')
    expect(previousLog(logs, '2026-07-10')).toBeNull()
  })
})

describe('copyableFromLog', () => {
  it('帶重複欄位(人力/機具/材料/extras/天氣),不帶摘要', () => {
    const c = copyableFromLog(logs[0])
    expect(c.labor).toEqual([{ type: '鋼筋工', count: 8 }])
    expect(c.weather).toBe('晴'); expect(c.weather_pm).toBe('陣雨')
    expect(c.from).toBe('2026-07-10')
    expect(c).not.toHaveProperty('work_summary')
  })
  it('工項帶列骨架:key 保留、數量留空(C-4);無 items 時給空物件', () => {
    expect(copyableFromLog(logs[0]).items).toEqual({ a: '' }) // 昨日 a:5 → 數量不複製
    expect(copyableFromLog(logs[1]).items).toEqual({})
  })
  it('deep copy:改複製結果不動原日誌', () => {
    const c = copyableFromLog(logs[0]); c.labor[0].count = 99
    expect(logs[0].labor[0].count).toBe(8)
  })
})

describe('frequentItems(從歷史自學)', () => {
  it('依出現次數排序、去重', () => {
    const f = frequentItems(logs)
    expect(f.labor[0]).toEqual({ type: '鋼筋工', count: '' }) // 出現 2 次,排最前
    expect(f.labor.map((r) => r.type)).toContain('模板工')
    expect(f.equipment[0]).toEqual({ name: '吊車', count: '' })
    expect(f.materials.find((m) => m.name === '鋼筋')).toEqual({ name: '鋼筋', unit: 'T', qty: '' })
  })
})

describe('addUniqueRow', () => {
  const keyOf = (r) => r.type
  it('同鍵不重複加', () => {
    const rows = [{ type: '鋼筋工', count: 5 }]
    expect(addUniqueRow(rows, { type: '鋼筋工', count: '' }, keyOf)).toBe(rows) // 原陣列(未變)
    expect(addUniqueRow(rows, { type: '模板工', count: '' }, keyOf)).toHaveLength(2)
  })
})

// ── 波次 7 由 SiteLog.jsx 搬出的兩支純函式 ──
import { readOnlyOfficialRows, flattenSiteLogsForCsv, SITE_LOG_CSV_COLUMNS } from './siteLogHelpers.js'

describe('readOnlyOfficialRows(唯讀摘要的公定格式各節)', () => {
  it('無日誌回空陣列', () => {
    expect(readOnlyOfficialRows(null)).toEqual([])
    expect(readOnlyOfficialRows(undefined)).toEqual([])
  })
  it('只列有資料的節;人力/機具/材料壓成一句,材料帶單位', () => {
    const rows = readOnlyOfficialRows({
      labor: [{ type: '鋼筋工', count: 8 }, { type: '', count: 3 }], // 空工別不算
      equipment: [{ name: '吊車', count: 1 }, { name: '挖土機' }],  // 無數量顯示 —
      materials: [{ name: '鋼筋', unit: 'T', qty: 3 }, { name: '模板', qty: 10 }],
      extras: { technicians: '混凝土工程技術士 2 名', sampling: '', notice: null, important: '颱風警報' },
    })
    expect(rows).toEqual([
      ['出工人數', '鋼筋工×8'],
      ['機具使用', '吊車×1、挖土機×—'],
      ['材料使用', '鋼筋×3 T、模板×10'],
      ['四、應置技術士', '混凝土工程技術士 2 名'],
      ['八、重要事項紀錄', '颱風警報'],
    ])
  })
  it('五、安衛:勾選壓成一句;insured 預設「無新進勞工」不算有值', () => {
    expect(readOnlyOfficialRows({ extras: { edu: true, ppe: true, insured: '無新進勞工' } }))
      .toEqual([['五、職業安全衛生', '勤前教育（含危害告知）、檢查個人防護具']])
    expect(readOnlyOfficialRows({ extras: { insured: '有' } }))
      .toEqual([['五、職業安全衛生', '新進勞工提報勞保:有']])
    expect(readOnlyOfficialRows({ extras: { insured: '無新進勞工' } })).toEqual([]) // 全無=整節不出現
  })
})

describe('flattenSiteLogsForCsv', () => {
  const byKey = new Map([['a', { item_no: '1.1', description: '鋼筋', unit: 'T' }]])
  it('每筆日誌的每個工項攤一列,日期/天氣/摘要重複帶;查不到的 key 以 key 當名稱', () => {
    const flat = flattenSiteLogsForCsv([
      { log_date: '2026-07-10', weather: '晴', work_summary: '綁紮', items: { a: 5, zzz: 2 } },
      { log_date: '2026-07-11', items: {} },
    ], byKey)
    expect(flat).toEqual([
      { log_date: '2026-07-10', weather: '晴', work_summary: '綁紮', item_no: '1.1', description: '鋼筋', unit: 'T', qty: 5 },
      { log_date: '2026-07-10', weather: '晴', work_summary: '綁紮', item_no: '', description: 'zzz', unit: '', qty: 2 },
    ])
  })
  it('欄位規格與攤平結果的 key 一一對應', () => {
    const [row] = flattenSiteLogsForCsv([{ log_date: 'd', items: { a: 1 } }], byKey)
    expect(SITE_LOG_CSV_COLUMNS.map((c) => c.key)).toEqual(Object.keys(row))
  })
})
