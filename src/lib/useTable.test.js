// @vitest-environment jsdom
// 釘住 usePagination 的「頁碼何時該歸零」:原本綁 rows 的陣列 identity,
// 導致 Contract 契約文件表在 AI 分析輪詢(每 5 秒重載)時每次都彈回第 1 頁。
// 改成穩定簽章後,這裡要同時保住兩邊——重載不動頁碼、換資料集/換排序仍歸零。
import React from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { usePagination, useTableSort } from './useTable.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// 最小 renderHook:repo 沒有裝 @testing-library,直接用 react-dom + React.act。
// 刻意不寫 JSX(本檔是 .js,不依賴 JSX transform),用 createElement。
function renderHook(hook) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const result = { current: null }
  const Probe = ({ args }) => { result.current = hook(...args); return null }
  const rerender = (...args) => {
    React.act(() => { root.render(React.createElement(Probe, { args })) })
  }
  const unmount = () => { React.act(() => { root.unmount() }); container.remove() }
  return { result, rerender, unmount }
}

const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `第 ${i} 列` }))

let harness = null
beforeEach(() => { harness = null })
afterEach(() => { harness?.unmount() })

describe('usePagination:頁碼重設訊號', () => {
  it('輪詢重載(新陣列 identity、內容與列數不變)不重設頁碼', () => {
    const rows = makeRows(60)
    harness = renderHook((r) => usePagination(r, 25))
    harness.rerender(rows)

    React.act(() => { harness.result.current.pager.onPage(2) })
    expect(harness.result.current.pager.page).toBe(2)

    // 模擬 reloadRuns:同樣的 60 列,但是全新的陣列 + 全新的物件
    harness.rerender(rows.map((r) => ({ ...r })))
    expect(harness.result.current.pager.page).toBe(2)
    expect(harness.result.current.pageRows[0].id).toBe(50)
  })

  it('列數改變(換了資料集)→ 回第 1 頁', () => {
    harness = renderHook((r) => usePagination(r, 25))
    harness.rerender(makeRows(60))
    React.act(() => { harness.result.current.pager.onPage(2) })
    expect(harness.result.current.pager.page).toBe(2)

    harness.rerender(makeRows(59))
    expect(harness.result.current.pager.page).toBe(0)
  })

  it('resetKey 改變(排序/篩選換了但列數一樣)→ 回第 1 頁', () => {
    const rows = makeRows(60)
    harness = renderHook((r, key) => usePagination(r, 25, key))
    harness.rerender(rows, 'name:asc')
    React.act(() => { harness.result.current.pager.onPage(2) })
    expect(harness.result.current.pager.page).toBe(2)

    harness.rerender([...rows].reverse(), 'name:desc')
    expect(harness.result.current.pager.page).toBe(0)
  })

  it('資料變少的當幀就 clamp,不渲染超出範圍的空頁', () => {
    harness = renderHook((r) => usePagination(r, 25))
    harness.rerender(makeRows(60))
    React.act(() => { harness.result.current.pager.onPage(2) })

    // effect 歸零之前,同一幀的 pageRows 不可以是空的
    harness.rerender(makeRows(30))
    expect(harness.result.current.pageRows.length).toBeGreaterThan(0)
    expect(harness.result.current.pager.page).toBe(0)
  })

  it('改每頁筆數一律回第 1 頁', () => {
    harness = renderHook((r) => usePagination(r, 25))
    harness.rerender(makeRows(60))
    React.act(() => { harness.result.current.pager.onPage(2) })
    React.act(() => { harness.result.current.pager.onPageSize(50) })
    expect(harness.result.current.pager.page).toBe(0)
    expect(harness.result.current.pageRows).toHaveLength(50)
  })
})

describe('useTableSort:sortKey', () => {
  it('未排序為空字串,排序後隨欄位與方向變動(給 resetKey 用的穩定簽章)', () => {
    harness = renderHook((r) => useTableSort(r))
    harness.rerender(makeRows(3))
    expect(harness.result.current.sortKey).toBe('')

    React.act(() => { harness.result.current.toggleSort('name') })
    expect(harness.result.current.sortKey).toBe('name:asc')

    // 重新 render 但排序條件沒變 → 簽章必須一模一樣,否則頁碼又會被歸零
    harness.rerender(makeRows(3))
    expect(harness.result.current.sortKey).toBe('name:asc')

    React.act(() => { harness.result.current.toggleSort('name') })
    expect(harness.result.current.sortKey).toBe('name:desc')
  })
})
