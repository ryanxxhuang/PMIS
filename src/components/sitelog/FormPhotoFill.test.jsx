// @vitest-environment jsdom
// 表內上傳鈕(2026-09-21):選檔 → 先確保文件存在(頁面存檔流程)→ 建批次(帶文件日期)→ 同批同內容只傳一張 →
// 呼叫起稿 Edge 帶 target_document_id → 有 target 才回頁面合併(onFilled 帶發起時的文件 id);
// 失敗就地給「重新辨識」(明確重辨識這批照片,不沿用快取)與「或直接在表上填寫」;建不了文件就不上傳;示範模式停用並說明。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import FormPhotoFill, { FILL_BUTTON_LABEL } from './FormPhotoFill.jsx'

let container, root
const target = () => ({ document_id: 'D1', agent_action_id: 'A1', suggestion: { content: { work_summary: 'AI' }, field_sources: { work_summary: { status: 'filled', source: 'ai:photo' } }, attachments: [{ photo_id: 'P1', storage_path: 'x' }] }, pending_fields: [], notes: [] })
function makeStore(over = {}) {
  return {
    createIntake: vi.fn(async () => ({ error: null, intake: { id: 'I1' } })),
    uploadIntakePhoto: vi.fn(async () => ({ error: null, id: 'P1', storage_path: 'x' })),
    draftFromIntake: vi.fn(async () => ({ error: null, result: { target: target(), intake: { status: 'ready' }, documents: [], notes: [] } })),
    aiEnabled: () => true, isPersistedProject: true, demoMode: false, can: { write: true },
    ...over,
  }
}
const file = (name, bytes) => new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' })
const input = () => container.querySelector('input[type="file"]')
const pick = (files) => act(async () => {
  Object.defineProperty(input(), 'files', { value: files, configurable: true })
  input().dispatchEvent(new Event('change', { bubbles: true }))
})
const flush = (n = 4) => act(async () => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) })
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)

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
const render = (props = {}) => act(async () => { root.render(<FormPhotoFill docDate="2026-09-21" ensureDocument={async () => ({ documentId: 'D1' })} onFilled={vi.fn()} {...props} />) })

describe('表內上傳鈕', () => {
  it('先確保文件、再建批次(帶文件日期)、同批同內容只傳一張、Edge 帶 target_document_id、回頁面合併(帶發起時的文件 id)', async () => {
    state.store = makeStore()
    const calls = []
    const ensureDocument = vi.fn(async () => { calls.push('ensure'); return { documentId: 'D1' } })
    state.store.createIntake.mockImplementation(async () => { calls.push('intake'); return { error: null, intake: { id: 'I1' } } })
    const onFilled = vi.fn()
    await render({ ensureDocument, onFilled })
    expect(input().getAttribute('aria-label')).toBe(FILL_BUTTON_LABEL)
    expect(input().disabled).toBe(false)
    await pick([file('a.jpg', [1, 2, 3]), file('a-again.jpg', [1, 2, 3])])
    await flush()
    expect(calls).toEqual(['ensure', 'intake']) // 文件先存在,批次才建
    expect(state.store.createIntake).toHaveBeenCalledWith({ log_date: '2026-09-21' })
    expect(state.store.uploadIntakePhoto).toHaveBeenCalledTimes(1) // 同批同 sha 只傳一張(跨批次不查重)
    expect(state.store.draftFromIntake).toHaveBeenCalledWith('I1', expect.objectContaining({ targetDocumentId: 'D1', rerecognizePhotoIds: null }))
    expect(onFilled).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'D1', target: expect.objectContaining({ agent_action_id: 'A1' }) }))
    expect(container.textContent).toContain('照片已保存 2／2，辨識完成')
    expect(input().disabled).toBe(false) // 完成後可再傳
  })

  it('辨識失敗:照片已保存的保留、就地給「重新辨識」(明確重辨識這批照片)與「或直接在表上填寫」;沒有 target 也算失敗並顯示原因', async () => {
    state.store = makeStore({ draftFromIntake: vi.fn(async () => ({ error: { message: 'AI 服務逾時', code: 'timeout' } })) })
    const onFilled = vi.fn()
    await render({ onFilled })
    await pick([file('a.jpg', [1])])
    await flush()
    expect(onFilled).not.toHaveBeenCalled()
    const alert = container.querySelector('[role="alert"]')
    expect(alert.textContent).toContain('AI 服務逾時')
    expect(alert.textContent).toContain('或直接在表上填寫')
    state.store.draftFromIntake.mockResolvedValueOnce({ error: null, result: { intake: { status: 'partial', error_summary: '1 份文件起稿失敗' }, documents: [{ action: 'error', reason: '這份自主檢查表的檢查表範本已不存在' }], notes: [] } })
    await act(async () => button('重新辨識').click())
    await flush()
    expect(state.store.draftFromIntake).toHaveBeenLastCalledWith('I1', expect.objectContaining({ targetDocumentId: 'D1', rerecognizePhotoIds: ['P1'] }))
    expect(container.querySelector('[role="alert"]').textContent).toContain('檢查表範本已不存在')
    expect(state.store.createIntake).toHaveBeenCalledTimes(1) // 重辨識沿用同一批次
  })

  it('文件建不了(例如新自檢表沒選範本)→ 不建批次、不上傳,顯示原因;上傳全部失敗 → 可重試未保存的', async () => {
    state.store = makeStore()
    await render({ ensureDocument: async () => ({ error: { message: '請先選擇檢查表範本' } }) })
    await pick([file('a.jpg', [1])])
    await flush()
    expect(container.querySelector('[role="alert"]').textContent).toContain('請先選擇檢查表範本')
    expect(state.store.createIntake).not.toHaveBeenCalled()
    expect(state.store.uploadIntakePhoto).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    root = createRoot(container)
    state.store = makeStore({ uploadIntakePhoto: vi.fn(async () => ({ error: { message: 'storage 500' } })) })
    await render()
    await pick([file('a.jpg', [1])])
    await flush()
    expect(container.querySelector('[role="alert"]').textContent).toContain('仍在本機')
    expect(button('重試未保存的 1 張')).toBeTruthy()
    expect(state.store.draftFromIntake).not.toHaveBeenCalled()
  })

  it('示範模式:鈕停用並說明需正式專案;AI 功能未啟用亦停用;無寫入權不顯示', async () => {
    state.store = makeStore({ demoMode: true, isPersistedProject: false })
    await render()
    expect(input().disabled).toBe(true)
    expect(container.textContent).toContain('示範模式無法上傳，需正式專案')
    await act(async () => root.unmount())
    root = createRoot(container)
    state.store = makeStore({ aiEnabled: () => false })
    await render()
    expect(input().disabled).toBe(true)
    expect(container.textContent).toContain('AI 填表功能未啟用')
    await act(async () => root.unmount())
    root = createRoot(container)
    state.store = makeStore({ can: { write: false } })
    await render()
    expect(input()).toBeNull()
  })
})
