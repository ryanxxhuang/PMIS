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
