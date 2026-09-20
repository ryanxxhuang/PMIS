// 分頁規則的凍結測試。這支只測純邏輯(不碰 DOM、不產 PDF):
// 「不切在不可切的東西中間」「長表跨頁要重印表頭」「切不動時照實硬切並回報」
// 這三條是 PDF 交付的核心,壞掉的症狀是送到機關的文件表格被腰斬、第二頁沒有表頭。
import { describe, it, expect } from 'vitest'
import { planPages } from './paginate.js'

// 高 10 的列,連續排列
const rows = (n, h = 10, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ top: from + i * h, bottom: from + (i + 1) * h }))

describe('planPages', () => {
  it('內容比一頁短時只有一頁', () => {
    const { pages, forcedCuts } = planPages(120, rows(12), [], 500)
    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ top: 0, bottom: 120 })
    expect(forcedCuts).toBe(0)
  })

  it('分頁點落在列的邊界上,不會把列切成兩半', () => {
    // 每列 10 高、共 30 列(總高 300),每頁可容 95 → 只能切在 90
    const atoms = rows(30)
    const { pages, forcedCuts } = planPages(300, atoms, [], 95)
    expect(forcedCuts).toBe(0)
    for (const p of pages) {
      expect(p.top % 10).toBe(0)
      expect(p.bottom % 10).toBe(0)
      // 沒有任何一列被頁界橫跨
      const straddling = atoms.filter((a) => a.top < p.bottom - 0.5 && a.bottom > p.bottom + 0.5)
      expect(straddling).toEqual([])
    }
    expect(pages[pages.length - 1].bottom).toBe(300)
  })

  it('整份切完不重疊也不遺漏', () => {
    const atoms = rows(40, 7)
    const { pages } = planPages(280, atoms, [], 60)
    expect(pages[0].top).toBe(0)
    expect(pages[pages.length - 1].bottom).toBe(280)
    for (let i = 1; i < pages.length; i++) expect(pages[i].top).toBe(pages[i - 1].bottom)
  })

  it('表格跨頁時第二頁起要重印表頭,並讓出表頭高度', () => {
    // 表格 y=100..400,表頭 100..120;表身列 120..400
    const atoms = [...rows(10, 10, 0), { top: 100, bottom: 120 }, ...rows(28, 10, 120)]
    const table = { id: 'th0', top: 100, bottom: 400, headTop: 100, headBottom: 120 }
    const { pages } = planPages(400, atoms, [table], 150)
    expect(pages.length).toBeGreaterThan(2)
    expect(pages[0].headers).toEqual([]) // 第一頁表頭是本來就在的那一份
    const second = pages[1]
    expect(second.headers.map((t) => t.id)).toEqual(['th0'])
    expect(second.headerHeight).toBe(20)
    // 讓出表頭後本頁可容的內容高度少 20
    expect(second.bottom - second.top).toBeLessThanOrEqual(150 - 20 + 0.5)
  })

  it('表頭自己還沒印完就換頁時不重印(會變成兩份表頭)', () => {
    const atoms = [{ top: 0, bottom: 200 }, ...rows(20, 10, 200)]
    const table = { id: 'th0', top: 190, bottom: 400, headTop: 190, headBottom: 260 }
    const { pages } = planPages(400, atoms, [table], 210)
    // 第二頁開頭 y=200 落在表頭中間(headBottom=260 > 200)→ 不算「表身跨頁」
    expect(pages[1].headers).toEqual([])
  })

  it('單一原子比整頁還高時照實硬切,並回報次數', () => {
    const atoms = [{ top: 0, bottom: 500 }]
    const { pages, forcedCuts } = planPages(500, atoms, [], 200)
    expect(forcedCuts).toBeGreaterThan(0)
    expect(pages.length).toBe(3)
    expect(pages[pages.length - 1].bottom).toBe(500)
  })

  it('頁數失控時丟錯,不會無窮迴圈', () => {
    expect(() => planPages(1e6, [{ top: 0, bottom: 1e6 }], [], 10)).toThrow(/頁上限/)
  })

  it('分頁高度無效時丟錯', () => {
    expect(() => planPages(100, [], [], 0)).toThrow(/分頁高度/)
  })
})
