// @vitest-environment jsdom
// 品質頁旅程(UIUX 階段 3B U07;P6b-3 起檢查表分段只剩查閱、查驗沒有快速判定):
// 檢查表分段列出紀錄(舊流程登錄／已簽署文件)、「新增自主檢查表」導向文件頁、沒有就地表單 → 由紀錄「提出查驗申請」
// (工項與現行版證據預填)→ 送出 → 看到已送出、已檢附、等待監造。監造的查驗詳情只有「以監造查驗表單判定」一條路。
// 另測:送出失敗表單與檢附留著;從待辦進來切分段 taskReturn 不消失。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { TEMPLATE_03310 } from '../../data/checklist03310.js'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Quality from './Quality.jsx'

function LocationSpy() {
  const { pathname, search, state } = useLocation()
  return <><output data-testid="path">{pathname}</output><output data-testid="search">{search}</output><output data-testid="state">{JSON.stringify(state)}</output></>
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
    createInspection: vi.fn(), deleteInspection: vi.fn(),
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

describe('廠商品質旅程', () => {
  it('檢查表分段只剩查閱:沒有就地表單,新增導向自主檢查表頁;由紀錄提出查驗申請 → 送出 → 等待監造', async () => {
    state.store = { ...state.store, checklistRecords: [record] }
    await render()
    expect(segChip('檢查表').getAttribute('aria-pressed')).toBe('true')
    // 舊流程直接登錄的紀錄照常列出(判定、覆蓋程度),標「舊流程登錄」,沒有修訂／刪除／實測值輸入
    expect(container.textContent).toContain('舊流程登錄')
    expect(container.textContent).toContain('已檢 1／15，14 項未檢')
    expect(container.querySelector('input[type="number"]')).toBeNull()
    expect(button('修訂')).toBeUndefined()
    expect(button('新增檢查')).toBeUndefined()
    expect(container.querySelector('[aria-label="刪除未判定的檢查紀錄"]')).toBeNull()

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

  it('「新增自主檢查表」導向文件頁(新增一律走文件起稿、確認、簽署)', async () => {
    await render()
    await act(async () => button('新增自主檢查表').click())
    expect(container.querySelector('[data-testid="path"]').textContent).toBe('/self-check')
  })

  it('監造的待查驗詳情只有「以監造查驗表單判定」,沒有合格／不合格快速判定', async () => {
    state.store = {
      ...state.store, currentUser: { org_type: 'supervisor' }, can: { edit: false, submit: false, approve: true },
      inspections: [{ id: 'I1', title: '4F 柱牆鋼筋查驗', status: '待查驗', requested_date: '2026-09-15', inspection_type: '施工查驗' }],
      fieldDocuments: { documents: [] },
    }
    await render('/quality?seg=inspections&inspection=I1')
    expect(button('合格')).toBeUndefined()
    expect(button('不合格')).toBeUndefined()
    expect([...container.querySelectorAll('button')].some((b) => b.textContent.includes('以監造查驗表單判定'))).toBe(true)
  })
})
