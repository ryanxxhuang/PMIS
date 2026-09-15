// @vitest-environment jsdom
// 自主檢查表的未存檔保護(UIUX 階段 3B U07):
// - 填了值就登記到未存檔登記簿並回報頁面(分段 chip 標記),表單內出現「未存檔」提示;
// - 取消要先確認,取消確認就留在表單、值不丟;確認放棄才清空並解除登記;
// - 存檔成功解除登記;存檔失敗值留著、登記仍在(可重試)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import ChecklistSection from './ChecklistSection.jsx'
import { TEMPLATE_03310 } from '../../data/checklist03310.js'
import { unsavedEditLabels } from '../../lib/unsavedEdits.js'

let container, root
const templates = [{ id: 'T1', ...TEMPLATE_03310 }]

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.confirm
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = (props) => act(async () => {
  root.render(<MemoryRouter><ChecklistSection templates={templates} records={[]} canEdit onCreate={vi.fn()} onDelete={vi.fn()} {...props} /></MemoryRouter>)
})
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const numInput = () => container.querySelector('input[type="number"]')
const typeNumber = (value) => act(async () => {
  const el = numInput()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value))
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('自主檢查表未存檔保護', () => {
  it('填值後登記未存檔、回報頁面並顯示提示;取消先確認,拒絕就留著,確認才放棄', async () => {
    const onDirtyChange = vi.fn()
    await render({ onDirtyChange })
    await act(async () => button('新增檢查').click())
    expect(unsavedEditLabels()).toEqual([])
    await typeNumber(24)
    expect(numInput().value).toBe('24')
    expect(unsavedEditLabels()).toEqual(['自主檢查表（未存檔）'])
    // W03:只檢一項時,判定旁邊要說覆蓋程度,不讓「合格」被讀成整表完成
    expect(container.textContent).toContain('目前判定：合格')
    expect(container.textContent).toContain('已檢 1／15，14 項未檢；判定僅依已檢項')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('未存檔')

    window.confirm = vi.fn(() => false)
    await act(async () => button('取消').click())
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(numInput().value).toBe('24')
    expect(unsavedEditLabels()).toEqual(['自主檢查表（未存檔）'])

    window.confirm = vi.fn(() => true)
    await act(async () => button('取消').click())
    expect(numInput()).toBeNull()
    expect(unsavedEditLabels()).toEqual([])
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('存檔失敗:值留著、登記仍在;存檔成功:解除登記並顯示已存檔', async () => {
    const onCreate = vi.fn()
      .mockResolvedValueOnce({ error: { message: 'boom' } })
      .mockResolvedValueOnce({ error: null, overall: '合格', rev: 0 })
    await render({ onCreate })
    await act(async () => button('新增檢查').click())
    await typeNumber(24)
    await act(async () => button('存檔並判定').click())
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate.mock.calls[0][0].values).toEqual({ B4: 24 })
    expect(container.textContent).toContain('存檔未完成')
    expect(numInput().value).toBe('24')
    expect(unsavedEditLabels()).toEqual(['自主檢查表（未存檔）'])

    await act(async () => button('存檔並判定').click())
    expect(container.textContent).toContain('已存檔')
    expect(container.textContent).toContain('（已檢 1／15，14 項未檢）')
    expect(numInput()).toBeNull()
    expect(unsavedEditLabels()).toEqual([])
  })
})
