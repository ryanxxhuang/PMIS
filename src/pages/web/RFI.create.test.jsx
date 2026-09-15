// @vitest-environment jsdom
// 新疑義建立的操作可信度(UIUX 階段 1 U02),與 Submittals.create.test 同一組合約:
// 失敗不收表單(主旨與圖面標註都留著)、連點只建一筆、成功收表單並選中新疑義。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
// 圖面標註編輯器是 canvas 元件,jsdom 畫不了;這裡只要縮圖能證明 markup_data 還在表單裡
vi.mock('../../components/MarkupEditor.jsx', () => ({
  default: () => null,
  MarkupThumb: ({ src }) => <img alt="圖面標註縮圖" src={src} />,
}))
import RFI from './RFI.jsx'

let container, root
const newRow = { id: 'R9', rfi_no: 'RFI-009', title: '3F 樑柱接頭鋼筋與機電套管衝突', question: 'q', status: '待回覆', asked_date: '2026-09-15', markup_path: null }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  state.store = {
    rfis: [], createRfi: vi.fn(), answerRfi: vi.fn(), closeRfi: vi.fn(), deleteRfi: vi.fn(), draftRfiReply: vi.fn(),
    resolveMarkup: vi.fn(), isSupabaseConfigured: false, currentProject: { project_id: 'p1' },
    currentUser: { org_type: 'contractor' }, can: { submit: true, approve: false }, aiEnabled: () => false, isPlatformAdmin: false,
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.matchMedia
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

const render = () => act(async () => {
  root.render(<MemoryRouter initialEntries={['/rfi']}><RFI /></MemoryRouter>)
})
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const titleInput = () => container.querySelector('input[placeholder="如 3F 樑柱接頭鋼筋與機電套管衝突"]')
const type = (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('新疑義:失敗保留、成功定位', () => {
  it('建立失敗:主旨與圖面標註都保留、顯示可重試錯誤;重試成功後表單收起並選中新疑義', async () => {
    state.store.createRfi
      .mockResolvedValueOnce({ error: { message: 'boom' } })
      .mockImplementationOnce(async () => {
        state.store = { ...state.store, rfis: [newRow] }
        return { error: null, id: 'R9' }
      })
    await render()
    // 頁首「提出疑義」開表單;表單內的送出鈕同名,開表單後改用「提出中…」以外的那一顆
    await act(async () => button('提出疑義').click())
    await type(titleInput(), '3F 樑柱接頭鋼筋與機電套管衝突')
    const submitBtn = () => [...container.querySelectorAll('button')].filter((b) => b.textContent.trim() === '提出疑義').at(-1)
    await act(async () => submitBtn().click())
    expect(state.store.createRfi).toHaveBeenCalledTimes(1)
    expect(state.store.createRfi.mock.calls[0][0]).toMatchObject({ title: '3F 樑柱接頭鋼筋與機電套管衝突' })
    expect(titleInput()).toBeTruthy()
    expect(titleInput().value).toBe('3F 樑柱接頭鋼筋與機電套管衝突')
    expect(container.textContent).toContain('疑義未建立')
    expect(container.textContent).toContain('內容已保留')

    await act(async () => submitBtn().click())
    await render()
    expect(state.store.createRfi).toHaveBeenCalledTimes(2)
    // 失敗後表單物件沒被重置:第二次送出帶的是同一份 form(主旨、圖面標註等欄位一起保留)
    expect(state.store.createRfi.mock.calls[1][0]).toBe(state.store.createRfi.mock.calls[0][0])
    expect(titleInput()).toBeNull()
    expect(container.textContent).not.toContain('疑義未建立')
    expect(container.querySelector('[aria-label="RFI-009 詳情"]')).toBeTruthy()
  })

  it('送出中連點只建立一筆;非預期例外也收尾 busy', async () => {
    let resolve
    state.store.createRfi.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    await render()
    await act(async () => button('提出疑義').click())
    await type(titleInput(), '衝突')
    const submitBtn = () => [...container.querySelectorAll('button')].filter((b) => /^提出(疑義|中…)$/.test(b.textContent.trim())).at(-1)
    await act(async () => { submitBtn().click(); submitBtn().click() })
    expect(state.store.createRfi).toHaveBeenCalledTimes(1)
    expect(submitBtn().textContent.trim()).toBe('提出中…')
    expect(submitBtn().disabled).toBe(true)
    await act(async () => { resolve({ error: { message: 'boom' } }) })
    expect(submitBtn().disabled).toBe(false)

    state.store.createRfi.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await act(async () => submitBtn().click())
    expect(container.textContent).toContain('網路連線不穩')
    expect(titleInput().value).toBe('衝突')
    expect(submitBtn().disabled).toBe(false)
  })
})
