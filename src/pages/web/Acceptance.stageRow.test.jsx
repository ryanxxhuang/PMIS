// @vitest-environment jsdom
// 驗收階段列的操作可信度(UIUX 階段 1 U01):
// - 需要結果的階段,使用者沒明選合格/不合格就按「登錄」→ 不發寫入、就近提示、焦點回結果欄;
// - 明選合格/不合格 → 依明選值送出,空值永遠不會被補成合格;
// - 寫入失敗 → 保持編輯狀態,日期/結果/備註全部留著。
// 定位只走 role/aria-label/文字(規範 §7 零視覺耦合)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

// StageRow 本身不讀 store,但 ui.jsx(PageHeader)在模組層引用 store.jsx;整包 mock 掉
vi.mock('../../store.jsx', () => ({ useStore: () => ({ currentUser: { org_type: 'owner' } }) }))
import { StageRow } from './Acceptance.jsx'

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

// state 'due' + 已有日期:進頁就是編輯表單(done 才是唯讀列),不必模擬 date 控件輸入
const stage = (over = {}) => ({
  key: 'initial', label: '初驗', by: '機關', state: 'due', basis: '竣工確認後 30 日', due: '2026-09-20', daysLeft: 5,
  event: { event_date: '2026-09-18', result: '', note: '' }, ...over,
})
const render = (props) => act(async () => {
  root.render(<MemoryRouter><ol><StageRow stage={stage()} allowed sequentialOk onClear={vi.fn()} {...props} /></ol></MemoryRouter>)
})
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const resultSelect = () => container.querySelector('select[aria-label="初驗 結果"]')
const choose = (value) => act(async () => {
  const el = resultSelect()
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
})

describe('StageRow 結果必須明選', () => {
  it('未選結果按登錄:不呼叫 onSave、出現提示、焦點回結果欄', async () => {
    const onSave = vi.fn().mockResolvedValue({ error: null })
    await render({ onSave })
    expect(resultSelect().value).toBe('')
    await act(async () => button('登錄').click())
    expect(onSave).not.toHaveBeenCalled()
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('請先選合格或不合格')
    expect(resultSelect().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(resultSelect())
  })

  it('明選不合格:送出的 result 就是不合格;明選合格才送合格', async () => {
    const onSave = vi.fn().mockResolvedValue({ error: null })
    await render({ onSave })
    await choose('不合格')
    await act(async () => button('登錄').click())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ event_date: '2026-09-18', result: '不合格' })
    // 提示在選了值之後要消失
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('不需結果的階段(報竣)照舊只憑日期登錄,result 為 null', async () => {
    const onSave = vi.fn().mockResolvedValue({ error: null })
    await render({ onSave, stage: stage({ key: 'report', label: '報竣', by: '廠商' }) })
    expect(container.querySelector('select')).toBeNull()
    await act(async () => button('登錄').click())
    expect(onSave.mock.calls[0][0]).toMatchObject({ event_date: '2026-09-18', result: null })
  })

  it('寫入失敗:留在編輯狀態,日期/結果/備註不清空', async () => {
    const onSave = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
    await render({ onSave })
    await choose('合格')
    await act(async () => button('登錄').click())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].result).toBe('合格')
    // 表單還在:日期輸入與結果選單都留著原值
    expect(container.querySelector('input[aria-label="初驗 實際辦理日"]').value).toBe('2026-09-18')
    expect(resultSelect().value).toBe('合格')
  })
})
