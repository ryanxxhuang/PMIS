// @vitest-environment jsdom
// 廠商品質流程一條完整旅程(UIUX 階段 3B U07):
// 填自主檢查表填到一半 → 切到查驗分段(chip 標「未存檔」、URL 記分段)→ 切回來值還在 →
// 存檔並判定 → 由該紀錄「提出查驗申請」(工項與現行版證據預填)→ 送出 → 看到已送出、
// 已檢附、等待監造。另測:送出失敗表單與檢附留著;切換專案後未存檔表單不沿用。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { TEMPLATE_03310 } from '../../data/checklist03310.js'
import { unsavedEditLabels } from '../../lib/unsavedEdits.js'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Quality from './Quality.jsx'

function LocationSpy() {
  const { search, state } = useLocation()
  return <><output data-testid="search">{search}</output><output data-testid="state">{JSON.stringify(state)}</output></>
}

let container, root
const template = { id: 'T1', ...TEMPLATE_03310 }
const record = { id: 'CR1', template_id: 'T1', check_date: '2026-09-15', location: '4F 版牆', overall: '合格', rev: 0, results: { B4: { value: 24, pass: true } } }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  Element.prototype.scrollIntoView ??= () => {}
  state.store = {
    workItems: { items: [] }, workItemsSource: 'demo', isSupabaseConfigured: false,
    currentProject: { project_id: 'p1' }, currentUser: { org_type: 'contractor' },
    can: { edit: true, submit: true, approve: false }, aiEnabled: () => false, isPlatformAdmin: false,
    inspections: [], defects: [], observations: [], testSamples: [],
    checklistTemplates: [template], checklistRecords: [],
    createInspection: vi.fn(), recordInspectionResult: vi.fn(), deleteInspection: vi.fn(),
    createChecklistRecord: vi.fn(), deleteChecklistRecord: vi.fn(),
    createTestSamples: vi.fn(), generateSamplesFromLogs: vi.fn(), updateTestSample: vi.fn(), deleteTestSample: vi.fn(),
    createObservation: vi.fn(), updateObservation: vi.fn(), escalateObservation: vi.fn(), deleteObservation: vi.fn(),
    resolveMarkup: vi.fn(),
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
const render = (entry = '/quality?seg=checklist') => act(async () => {
  root.render(<MemoryRouter initialEntries={[entry]}><Quality /><LocationSpy /></MemoryRouter>)
})
const search = () => new URLSearchParams(container.querySelector('[data-testid="search"]').textContent)
const segChip = (name) => [...container.querySelector('[aria-label="品質分段"]').querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(name))
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const numInput = () => container.querySelector('input[type="number"]')
const checklistWrap = () => numInput()?.closest('[hidden]')
const setValue = (el, value) => act(async () => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value))
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
})

describe('廠商品質旅程', () => {
  it('填一半 → 切走 → 回來 → 存檔 → 提出查驗申請 → 送出 → 等待監造', async () => {
    await render()
    expect(segChip('檢查表').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('新增檢查').click())
    await setValue(numInput(), 24)
    expect(segChip('檢查表').textContent).toContain('未存檔')

    // 切到查驗:URL 記分段;檢查表只是隱藏,輸入還在
    await act(async () => segChip('查驗').click())
    expect(search().get('seg')).toBe('inspections')
    expect(segChip('查驗').getAttribute('aria-pressed')).toBe('true')
    expect(numInput()).toBeTruthy()
    expect(checklistWrap()).toBeTruthy()
    expect(numInput().value).toBe('24')

    // 切回來:可見且值不變
    await act(async () => segChip('檢查表').click())
    expect(search().get('seg')).toBe('checklist')
    expect(checklistWrap()).toBeNull()
    expect(numInput().value).toBe('24')

    // 存檔並判定:store 多一筆現行版合格紀錄
    state.store.createChecklistRecord.mockImplementationOnce(async () => {
      state.store = { ...state.store, checklistRecords: [record] }
      return { error: null, overall: '合格', rev: 0 }
    })
    await act(async () => button('存檔並判定').click())
    await render()
    expect(container.textContent).toContain('已存檔')
    expect(container.textContent).toContain('已檢 1／15，14 項未檢')
    expect(segChip('檢查表').textContent).not.toContain('未存檔')
    expect(unsavedEditLabels()).toEqual([])

    // 由該紀錄提出查驗申請:切到查驗、表單預填範本標題與現行版檢附
    await act(async () => button('提出查驗申請').click())
    expect(segChip('查驗').getAttribute('aria-pressed')).toBe('true')
    expect(search().get('seg')).toBe('inspections')
    expect(container.querySelector('input[placeholder="如 混凝土澆置前查驗"]').value).toBe(TEMPLATE_03310.title)
    const attachSelect = [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'CR1'))
    expect(attachSelect.value).toBe('CR1')
    expect(attachSelect.selectedOptions[0].textContent).toContain('2026-09-15')
    // W03:檢附選項與紀錄列都帶覆蓋程度
    expect(attachSelect.selectedOptions[0].textContent).toContain('合格（已檢 1／15，14 項未檢）')

    // 送出:成功後表單收起、回饋說已送出＋檢附了什麼＋等待監造,並選中新查驗
    state.store.createInspection.mockImplementationOnce(async (input) => {
      state.store = { ...state.store, inspections: [{ id: 'I9', title: input.title, status: '待查驗', requested_date: input.requested_date, checklist_record_id: input.checklist_record_id, location: input.location }] }
      return { error: null, id: 'I9' }
    })
    await act(async () => button('送出查驗申請').click())
    expect(state.store.createInspection.mock.calls[0][0]).toMatchObject({ checklist_record_id: 'CR1', title: TEMPLATE_03310.title })
    await render()
    const status = [...container.querySelectorAll('[role="status"]')].map((n) => n.textContent).join(' ')
    expect(status).toContain(`查驗申請「${TEMPLATE_03310.title}」已送出`)
    expect(status).toContain('已檢附自主檢查表 2026-09-15（合格）')
    expect(status).toContain('等待監造現場查驗')
    expect(container.querySelector('input[placeholder="如 混凝土澆置前查驗"]')).toBeNull()
    expect(search().get('inspection')).toBe('I9')
    expect(container.querySelector('[role="listitem"][aria-current]')?.textContent).toContain(TEMPLATE_03310.title)
  })

  it('從待辦進來後切分段、點佇列:taskReturn 仍在(返回今日工作不消失,W05)', async () => {
    const taskReturn = { to: '/dashboard?q=x', label: '今日工作', key: '查驗:I1' }
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[{ pathname: '/quality', search: '?seg=checklist', state: { taskReturn } }]}><Quality /><LocationSpy /></MemoryRouter>)
    })
    await act(async () => segChip('查驗').click())
    expect(search().get('seg')).toBe('inspections')
    expect(JSON.parse(container.querySelector('[data-testid="state"]').textContent)).toEqual({ taskReturn })
  })

  it('送出查驗申請失敗:表單與已選檢附都留著,可重試', async () => {
    state.store = { ...state.store, checklistRecords: [record] }
    state.store.createInspection.mockResolvedValueOnce({ error: { message: 'boom' } })
    await render()
    await act(async () => button('提出查驗申請').click())
    await act(async () => button('送出查驗申請').click())
    expect(container.textContent).toContain('查驗申請未送出')
    const attachSelect = [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'CR1'))
    expect(attachSelect.value).toBe('CR1')
    expect(button('送出查驗申請').disabled).toBe(false)
  })

  it('切換專案後未存檔的檢查表不沿用', async () => {
    await render()
    await act(async () => button('新增檢查').click())
    await setValue(numInput(), 24)
    expect(unsavedEditLabels()).toEqual(['自主檢查表（未存檔）'])
    state.store = { ...state.store, currentProject: { project_id: 'p2' } }
    await render()
    expect(numInput()).toBeNull()
    expect(unsavedEditLabels()).toEqual([])
    expect(segChip('檢查表').textContent).not.toContain('未存檔')
  })
})
