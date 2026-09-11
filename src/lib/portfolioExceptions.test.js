// 跨案例外摘要帶的 Σ。卡片來自三種來源(本案即時計算/demo 靜態/portfolio_summary RPC),
// 欄位不齊是常態:RPC 尚未回來時陣列裡只有本案,demo 卡沒有 acceptance。
// 這支測試釘住「少欄位不能炸、也不能算錯」——摘要帶算錯比不顯示更糟。
import { describe, it, expect } from 'vitest'
import { portfolioExceptions } from './Portfolio.jsx'

const currentCard = {
  isCurrent: true, openDefects: 3, pendingInspections: 2, pendingCOs: 1,
  acceptance: { label: '初驗', done: 2, total: 8, overdue: false, finished: false },
}
const demoCard = { key: 'B', demo: true, openDefects: 1, pendingInspections: 0, pendingCOs: 4, acceptance: null }
const rpcCard = {
  key: 'p3', projectId: 'p3', openDefects: 5, pendingInspections: 7, pendingCOs: 0,
  acceptance: { label: '正式驗收（逾期）', done: 5, total: 8, overdue: true, finished: false },
}

describe('portfolioExceptions', () => {
  it('混合卡片形狀:各項正確加總', () => {
    const ex = portfolioExceptions([currentCard, demoCard, rpcCard])
    expect(ex).toEqual({
      projects: 3, openDefects: 9, pendingInspections: 9, pendingCOs: 5,
      acceptanceActive: 2, acceptanceOverdue: 1,
    })
  })

  it('null 卡與缺欄位卡不炸,缺的欄位當 0', () => {
    const ex = portfolioExceptions([null, undefined, { key: 'x' }, { key: 'y', openDefects: 2 }])
    expect(ex.projects).toBe(2)
    expect(ex.openDefects).toBe(2)
    expect(ex.pendingInspections).toBe(0)
    expect(ex.pendingCOs).toBe(0)
  })

  it('acceptance 缺省或已結案不計入驗收中', () => {
    const finished = { key: 'f', acceptance: { label: '結案（保固中）', done: 8, total: 8, finished: true } }
    const ex = portfolioExceptions([demoCard, finished])
    expect(ex.acceptanceActive).toBe(0)
    expect(ex.acceptanceOverdue).toBe(0)
  })

  it('全 0(含空陣列)輸出仍是完整結構', () => {
    expect(portfolioExceptions([])).toEqual({
      projects: 0, openDefects: 0, pendingInspections: 0, pendingCOs: 0,
      acceptanceActive: 0, acceptanceOverdue: 0,
    })
    expect(portfolioExceptions()).toEqual(portfolioExceptions([]))
  })

  it('非數值欄位(null/字串/NaN)不會汙染總和', () => {
    const ex = portfolioExceptions([{ openDefects: null, pendingInspections: '4', pendingCOs: NaN }])
    expect(ex.openDefects).toBe(0)
    expect(ex.pendingInspections).toBe(4)
    expect(ex.pendingCOs).toBe(0)
  })
})
