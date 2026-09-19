// @vitest-environment jsdom
// 批次結果的「一次補齊」(P3e):欄位與每份文件的效果只呈現伺服器 list_intake_shared_inputs 的判定;
// 套用送 set_intake_shared_input(數量送數字)並顯示伺服器回的結果;伺服器拒絕(PD010)原樣顯示;
// 不可補值(非上傳方／已捨棄)或沒有共用欄位時整塊不出現。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import IntakeSharedInputs from './IntakeSharedInputs.jsx'

const W1 = 'a3e30000-0000-0000-0000-000000000001'
const list = (over = {}) => ({
  intake_id: 'I1', uploader_org: 'contractor', can_edit: true,
  fields: [
    { key: `location:2026-09-18:${W1}`, field: 'location', label: '施作位置', date: '2026-09-18', value_kind: 'text',
      work_item: { id: W1, item_no: '壹.一.1', description: '結構混凝土', unit: 'M3' }, value: null,
      documents: [
        { document_id: 'D1', doc_type: 'daily_log', status: 'pending_input', effect: 'update' },
        { document_id: 'S1', doc_type: 'self_check', status: 'signed', effect: 'locked' },
      ] },
    { key: `qty:2026-09-18:${W1}`, field: 'qty', label: '當日完成數量', date: '2026-09-18', value_kind: 'number',
      work_item: { id: W1, item_no: '壹.一.1', description: '結構混凝土', unit: 'M3' }, value: null,
      documents: [{ document_id: 'D1', doc_type: 'daily_log', status: 'pending_input', effect: 'update' }] },
  ],
  ...over,
})

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
const render = (props = {}) => act(async () => { root.render(<MemoryRouter><IntakeSharedInputs intakeId="I1" {...props} /></MemoryRouter>) })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const inputOf = (label) => [...container.querySelectorAll('label')].find((l) => l.textContent.startsWith(label))?.querySelector('input')
const buttonNear = (input) => input.closest('li').querySelector('button')
const type = (input, value) => act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('一次補齊', () => {
  it('列出伺服器給的欄位與每份文件的效果(已簽署標不受影響),文件可直達', async () => {
    state.store = { listIntakeSharedInputs: vi.fn().mockResolvedValue({ error: null, data: list() }), setIntakeSharedInput: vi.fn() }
    await render(); await flush()
    const section = container.querySelector('[role="group"][aria-label="一次補齊"]')
    expect(section.textContent).toContain('已簽署或已提送的文件不會被改動')
    const docs = container.querySelector(`ul[aria-label="施作位置・壹.一.1 結構混凝土 影響的文件"]`)
    expect([...docs.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['施工日誌・將寫入', '自主檢查表・已簽署，不受影響'])
    expect(docs.querySelector('a').getAttribute('href')).toBe('/site-log?doc=D1')
    expect(section.textContent).toContain('M3')
    expect(state.store.listIntakeSharedInputs).toHaveBeenCalledWith('I1')
  })

  it('套用:數量送數字,顯示伺服器結果並重讀清單、通知呼叫端', async () => {
    const result = { key: `qty:2026-09-18:${W1}`, updated: 1, documents: [{ document_id: 'D1', doc_type: 'daily_log', result: 'updated', version_no: 2, status: 'pending_input' }] }
    const onApplied = vi.fn()
    state.store = {
      listIntakeSharedInputs: vi.fn().mockResolvedValue({ error: null, data: list() }),
      setIntakeSharedInput: vi.fn().mockResolvedValue({ error: null, result }),
    }
    await render({ onApplied }); await flush()
    const input = inputOf('當日完成數量')
    expect(buttonNear(input).disabled).toBe(true) // 還沒填
    await type(input, '12.5')
    expect(buttonNear(input).disabled).toBe(false)
    await act(async () => { buttonNear(input).click() }); await flush()
    expect(state.store.setIntakeSharedInput).toHaveBeenCalledWith('I1', `qty:2026-09-18:${W1}`, 12.5)
    expect(container.textContent).toContain('已更新 1 份（施工日誌 版本 2）')
    expect(onApplied).toHaveBeenCalledWith(result)
    expect(state.store.listIntakeSharedInputs).toHaveBeenCalledTimes(2)
  })

  it('伺服器拒絕(PD010)原樣顯示,不假裝已套用', async () => {
    state.store = {
      listIntakeSharedInputs: vi.fn().mockResolvedValue({ error: null, data: list() }),
      setIntakeSharedInput: vi.fn().mockResolvedValue({ error: { code: 'PD010', message: '數量必須是 0 以上的數字' }, result: null }),
    }
    await render(); await flush()
    const input = inputOf('當日完成數量')
    await type(input, '-3')
    await act(async () => { buttonNear(input).click() }); await flush()
    expect(state.store.setIntakeSharedInput).toHaveBeenCalledWith('I1', `qty:2026-09-18:${W1}`, -3)
    expect(container.textContent).toContain('數量必須是 0 以上的數字')
    expect(container.textContent).not.toContain('已更新')
  })

  it('補值已存但有文件尚未套用(補值後才起稿的新文件):同值可「套用到其餘」;全部已套用則不可按', async () => {
    const f = list().fields[0]
    const data = list({ fields: [{ ...f, value: 'A區 3F', documents: [{ ...f.documents[0], effect: 'applied' }, { document_id: 'S9', doc_type: 'self_check', status: 'pending_input', effect: 'update' }] }] })
    state.store = { listIntakeSharedInputs: vi.fn().mockResolvedValue({ error: null, data }), setIntakeSharedInput: vi.fn() }
    await render(); await flush()
    const input = inputOf('施作位置')
    expect(input.value).toBe('A區 3F')
    expect(buttonNear(input).textContent).toBe('套用到其餘 1 份')
    expect(container.textContent).toContain('自主檢查表・尚未套用')

    const done = list({ fields: [{ ...f, value: 'A區 3F', documents: [{ ...f.documents[0], effect: 'applied' }] }] })
    state.store = { listIntakeSharedInputs: vi.fn().mockResolvedValue({ error: null, data: done }), setIntakeSharedInput: vi.fn() }
    await render(); await flush()
    expect(buttonNear(inputOf('施作位置')).disabled).toBe(true)
  })

  it('不可補值或沒有共用欄位:整塊不出現', async () => {
    state.store = { listIntakeSharedInputs: vi.fn().mockResolvedValue({ error: null, data: list({ can_edit: false }) }), setIntakeSharedInput: vi.fn() }
    await render(); await flush()
    expect(container.querySelector('[role="group"][aria-label="一次補齊"]')).toBeNull()
    state.store = { listIntakeSharedInputs: vi.fn().mockResolvedValue({ error: null, data: list({ fields: [] }) }), setIntakeSharedInput: vi.fn() }
    await render({ intakeId: 'I2' }); await flush()
    expect(container.querySelector('[role="group"][aria-label="一次補齊"]')).toBeNull()
  })
})
