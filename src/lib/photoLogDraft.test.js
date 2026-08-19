import { describe, it, expect } from 'vitest'
import { mergeDraftItems, draftSummaryFromCaptions } from './photoLogDraft.js'

// 照片先行→AI 填日誌(W8-7):釘住兩條紅線行為——
// ① AI 只加「列骨架」(數量留空),絕不覆蓋人已填的數量;② 摘要有內容一律不動。

describe('mergeDraftItems(配到工項的照片 → 當日 items 草稿)', () => {
  it('配到工項的照片加列骨架:key 進表、數量留空(空字串,由人填)', () => {
    const { items, added } = mergeDraftItems({}, [{ work_item_key: 'A' }, { work_item_key: 'B' }])
    expect(items).toEqual({ A: '', B: '' })
    expect(added).toBe(2)
  })

  it('不覆蓋既有列:人已填的數量原樣保留', () => {
    const { items, added } = mergeDraftItems({ A: 12.5 }, [{ work_item_key: 'A' }, { work_item_key: 'B' }])
    expect(items.A).toBe(12.5) // 人填的數量不被 AI 洗掉
    expect(items.B).toBe('')
    expect(added).toBe(1) // 只計新加的列
  })

  it('同工項多張照片只加一列(查驗照常見同工項多角度)', () => {
    const { items, added } = mergeDraftItems({}, [{ work_item_key: 'A' }, { work_item_key: 'A' }])
    expect(Object.keys(items)).toEqual(['A'])
    expect(added).toBe(1)
  })

  it('沒配到工項的照片不加列(寧可漏配不硬套,與 matchLeaf 同原則)', () => {
    const { items, added } = mergeDraftItems({}, [{ work_item_key: '' }, {}, null])
    expect(items).toEqual({})
    expect(added).toBe(0)
  })

  it('既有列即使數量為空也不重算 added(骨架列可能來自「複製昨日」)', () => {
    const { added } = mergeDraftItems({ A: '' }, [{ work_item_key: 'A' }])
    expect(added).toBe(0)
  })
})

describe('draftSummaryFromCaptions(caption 彙整 → 摘要草稿)', () => {
  it('摘要為空 → 彙整各張 caption,前綴「AI 草稿:」', () => {
    expect(draftSummaryFromCaptions('', [{ caption: '3F 柱牆鋼筋綁紮' }, { caption: '模板組立' }]))
      .toBe('AI 草稿:3F 柱牆鋼筋綁紮;模板組立')
  })

  it('摘要已有內容(人填的)一律不覆蓋 → 回 null', () => {
    expect(draftSummaryFromCaptions('今日澆置混凝土', [{ caption: '鋼筋綁紮' }])).toBeNull()
    expect(draftSummaryFromCaptions('  今日澆置  ', [{ caption: '鋼筋綁紮' }])).toBeNull()
  })

  it('caption 去空、去重(同說明多張照片不重複進摘要)', () => {
    expect(draftSummaryFromCaptions('', [{ caption: '鋼筋綁紮' }, { caption: ' 鋼筋綁紮 ' }, { caption: '' }, {}]))
      .toBe('AI 草稿:鋼筋綁紮')
  })

  it('全部無 caption → null(不產生只剩前綴的空草稿)', () => {
    expect(draftSummaryFromCaptions('', [{ caption: '' }, {}])).toBeNull()
    expect(draftSummaryFromCaptions('', [])).toBeNull()
  })
})
