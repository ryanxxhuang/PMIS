// P-05 欄式編碼的等價護欄:rehydrate(compact) 必須與原 workItems.json 完全相同。
// 若 scripts/import_boq.py 重新產出標單而忘了跑 scripts/compact_workitems.py,
// 這裡會紅——demo 站吃的是 compact,兩檔不同步=demo 資料悄悄過期。
import { describe, it, expect } from 'vitest'
import { rehydrateWorkItems } from './boqCalc.js'
import original from '../data/workItems.json'
import compact from '../data/workItems.compact.json'

describe('workItems 欄式編碼等價性', () => {
  it('meta 完全相同', () => {
    expect(compact.meta).toEqual(original.meta)
  })

  it('items 逐項完全相同(數量/順序/每個欄位值)', () => {
    const { items } = rehydrateWorkItems(compact)
    expect(items.length).toBe(original.items.length)
    for (let i = 0; i < items.length; i++) {
      expect(items[i]).toEqual(original.items[i])
    }
  })
})
