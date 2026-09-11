// @vitest-environment jsdom
// 抽屜/Modal 的無障礙合約(W8-5 F2):開啟時焦點進面板、Esc 關閉、aria-modal/aria-label
// 齊全;關閉時不渲染。搜尋欄 ref 直通 input(「/」快捷鍵靠它)、快篩 chip 帶 aria-pressed。
import React, { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { DetailDrawer, ModalShell, SearchField, StatusChip, MetaGrid, SourceQuote } from './listDetail.jsx'

let container, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = (el) => act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) })
const esc = () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })

describe('DetailDrawer', () => {
  it('開啟:dialog/aria-modal/aria-label、焦點進面板;Esc 與返回鈕都關閉', async () => {
    const onClose = vi.fn()
    await render(<DetailDrawer open onClose={onClose} label="義務詳情"><p>內容</p></DetailDrawer>)
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('義務詳情')
    expect(dialog.contains(document.activeElement)).toBe(true)
    await esc()
    expect(onClose).toHaveBeenCalledTimes(1)
    const back = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('返回清單'))
    await act(async () => back.click())
    expect(onClose).toHaveBeenCalledTimes(2)
  })
  it('關閉時不渲染,Esc 也不再呼叫 onClose', async () => {
    const onClose = vi.fn()
    await render(<DetailDrawer open={false} onClose={onClose} label="義務詳情">x</DetailDrawer>)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await esc()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ModalShell', () => {
  it('標題、關閉圖示鈕(aria-label=關閉)、Esc、遮罩點擊都關閉;焦點進面板', async () => {
    const onClose = vi.fn()
    await render(<ModalShell open onClose={onClose} title="回報 AI 擷取有誤"><p>表單</p></ModalShell>)
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-label')).toBe('回報 AI 擷取有誤')
    expect(container.querySelector('h2').textContent).toBe('回報 AI 擷取有誤')
    expect(dialog.contains(document.activeElement)).toBe(true)
    await act(async () => container.querySelector('button[aria-label="關閉"]').click())
    await esc()
    await act(async () => dialog.firstElementChild.click())
    expect(onClose).toHaveBeenCalledTimes(3)
  })
  it('onClose 換 identity 不會重新搶焦點', async () => {
    await render(<ModalShell open onClose={() => {}} title="t"><input aria-label="欄位" /></ModalShell>)
    const input = container.querySelector('input')
    await act(async () => input.focus())
    await render(<ModalShell open onClose={() => {}} title="t"><input aria-label="欄位" /></ModalShell>)
    expect(document.activeElement).toBe(input)
  })
})

describe('SearchField / StatusChip / MetaGrid / SourceQuote', () => {
  it('SearchField:ref 直通 input,aria-label 與 type=search 進 input', async () => {
    const ref = createRef()
    await render(<SearchField ref={ref} value="" onChange={() => {}} aria-label="搜尋契約義務" placeholder="p" />)
    expect(ref.current.tagName).toBe('INPUT')
    expect(ref.current.getAttribute('aria-label')).toBe('搜尋契約義務')
    expect(ref.current.type).toBe('search')
  })
  it('StatusChip:aria-pressed 反映選中,件數另成一格', async () => {
    await render(<><StatusChip active count={3} onClick={() => {}}>已逾期</StatusChip><StatusChip active={false} onClick={() => {}}>其他</StatusChip></>)
    const [on, off] = container.querySelectorAll('button')
    expect(on.getAttribute('aria-pressed')).toBe('true')
    expect(on.textContent).toBe('已逾期3')
    expect(off.getAttribute('aria-pressed')).toBe('false')
  })
  it('MetaGrid 逐列輸出;SourceQuote 有引述才畫 blockquote,cite 恆在', async () => {
    await render(<><MetaGrid rows={[['責任方', '廠商'], ['階段', '施工中']]} /><SourceQuote cite="契約 5.3 · 第 12 頁" quote="應於開工前提送" /><SourceQuote cite="僅出處" /></>)
    expect(container.textContent).toContain('責任方廠商')
    const quotes = container.querySelectorAll('blockquote')
    expect(quotes).toHaveLength(1)
    expect(quotes[0].textContent).toBe('「應於開工前提送」')
    expect(container.querySelectorAll('cite')).toHaveLength(2)
  })
})
