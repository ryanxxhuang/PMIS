// @vitest-environment jsdom
// 新送審建立的操作可信度(UIUX 階段 1 U02):
// - 建立失敗 → 表單不收、輸入全留、錯誤可重試(文案不假稱一定失敗);
// - 送出中連點 → 只建立一筆;
// - 重試成功 → 表單收起、新紀錄被選中(詳情欄顯示新編號)。
// 定位只走 role/aria-label/文字(規範 §7 零視覺耦合)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Submittals from './Submittals.jsx'

let container, root
const newRow = { id: 'S9', submittal_no: 'SUB-009', title: '4F 以上結構體施工計畫', category: '施工計畫', revision: 0, status: '已提送', submitted_date: '2026-09-15' }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // jsdom 沒有 matchMedia;殼 hook 在 openPane 時會直接呼叫,給一個「桌機」stub
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  state.store = {
    submittals: [], createSubmittal: vi.fn(), decideSubmittal: vi.fn(), resubmitSubmittal: vi.fn(), deleteSubmittal: vi.fn(),
    reviewSubmittal: vi.fn(), uploadSubmittalFile: vi.fn(), readSubmittalDoc: vi.fn(),
    isSupabaseConfigured: false, currentProject: { project_id: 'p1' }, currentUser: { org_type: 'contractor' },
    can: { submit: true, approve: false }, aiEnabled: () => false, isPlatformAdmin: false,
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
  root.render(<MemoryRouter initialEntries={['/submittals']}><Submittals /></MemoryRouter>)
})
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const titleInput = () => container.querySelector('input[placeholder="如 4F 以上結構體施工計畫"]')
const type = (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const openFormAndFill = async () => {
  await act(async () => button('提送送審').click())
  await type(titleInput(), '4F 以上結構體施工計畫')
}

describe('新送審:失敗保留、成功定位', () => {
  it('建立失敗:表單與輸入保留、顯示可重試錯誤;重試成功後表單收起並選中新件', async () => {
    state.store.createSubmittal
      .mockResolvedValueOnce({ error: { message: 'boom' } })
      .mockImplementationOnce(async () => {
        state.store = { ...state.store, submittals: [newRow] }
        return { error: null, id: 'S9' }
      })
    await render()
    await openFormAndFill()
    await act(async () => button('提送').click())
    expect(state.store.createSubmittal).toHaveBeenCalledTimes(1)
    expect(state.store.createSubmittal.mock.calls[0][0]).toMatchObject({ title: '4F 以上結構體施工計畫' })
    // 失敗:表單還在、輸入還在、錯誤說「未建立」而不是假稱已完成
    expect(titleInput()).toBeTruthy()
    expect(titleInput().value).toBe('4F 以上結構體施工計畫')
    expect(container.textContent).toContain('送審未建立')
    expect(container.textContent).toContain('內容已保留')
    // 重試:store 更新後重繪,表單收起、詳情欄就是新編號
    await act(async () => button('提送').click())
    await render()
    expect(state.store.createSubmittal).toHaveBeenCalledTimes(2)
    expect(titleInput()).toBeNull()
    expect(container.textContent).not.toContain('送審未建立')
    const detail = container.querySelector('[aria-label="SUB-009 詳情"]')
    expect(detail).toBeTruthy()
    // 進到該筆詳情後明示「紀錄已建立」與附件狀態,不把建立當成文件已送到(階段 3A U06)
    expect(detail.textContent).toContain('提送紀錄已建立（SUB-009，Rev.0，狀態：已提送）')
    expect(detail.textContent).toContain('尚未上傳文件本體：請在下方「文件與提送方式」上傳')
  })

  it('送出中連點兩次只建立一筆;store 丟非預期例外也會收尾 busy 並顯示錯誤', async () => {
    let resolve
    state.store.createSubmittal.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    await render()
    await openFormAndFill()
    await act(async () => { button('提送').click(); button('提送').click() })
    expect(state.store.createSubmittal).toHaveBeenCalledTimes(1)
    // 送出中按鈕禁用
    expect(button('提送中…')?.disabled).toBe(true)
    await act(async () => { resolve({ error: { message: 'boom' } }) })
    expect(button('提送')?.disabled).toBe(false)

    // 非預期例外(不是 { error })也不能讓按鈕永遠灰掉
    state.store.createSubmittal.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await act(async () => button('提送').click())
    expect(container.textContent).toContain('網路連線不穩')
    expect(titleInput().value).toBe('4F 以上結構體施工計畫')
    expect(button('提送')?.disabled).toBe(false)
  })
})
