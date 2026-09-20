// @vitest-environment jsdom
// O2:估驗佐證包的「AI 本期施工說明」。原本失敗時把錯誤丟掉——按鈕按了沒反應、說明欄一直空白,
// 使用者無從判斷是 AI 關掉、額度用完還是網路斷。這裡釘住:失敗要看得到可理解的錯誤與重試入口。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import ValuationPackage from './ValuationPackage.jsx'

let container, root
const items = [
  { id: 'wi-1', item_key: '1.1', parent_key: null, item_no: '一', description: '結構混凝土', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_billable: true, is_leaf: true, is_rollup: false, sort_order: 1 },
]
const V1 = { id: 'V1', period_no: 1, status: '草稿', valuation_date: '2026-09-30', period_end: '2026-09-30', retention_pct: 5, items: { 1.1: 60 }, amounts: { 1.1: 30000 } }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.store = {
    project: { project_name: '測試案' }, workItems: { items }, adjustedItems: items, revisedTotal: 100000, dbMode: true,
    valuations: [V1], currentUser: { user_id: 'u1', org_type: 'contractor' },
    inspections: [], checklistRecords: [], siteLogs: [], fieldDocuments: { documents: [], submissions: [] },
    fetchValuationState: vi.fn(async () => ({ state: { items: [] }, error: null })),
    fetchConfirmations: vi.fn(async () => ({ rows: [], error: null })),
    fetchValuationSubmittedAt: vi.fn(async () => ({ at: null, error: null })),
    listSignedVersions: vi.fn(async () => ({ rows: [], error: null })),
    getFieldDocumentVersions: vi.fn(async () => ({ versions: new Map(), error: null })),
    listPhotosByIds: vi.fn(async () => []),
    listMembers: vi.fn(async () => ({ rows: [], error: null })),
    draftValuationSummary: vi.fn(async () => ({ error: { message: 'AI 用量已達本月上限' }, result: null })),
    aiEnabled: () => true,
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

const render = () => act(async () => { root.render(<MemoryRouter initialEntries={['/valuation/package?p=V1']}><ValuationPackage /></MemoryRouter>) })
const text = () => container.textContent

describe('佐證包 AI 施工說明的失敗呈現', () => {
  it('產生失敗:顯示錯誤與重試入口,不靜默吞掉', async () => {
    await render()
    expect(state.store.draftValuationSummary).toHaveBeenCalled()
    expect(text()).toContain('AI 用量已達本月上限')
    expect(text()).toContain('重新產生施工說明')
    expect(text()).toContain('可按上方「重新產生施工說明」重試')
  })

  it('AI 回了但沒有內容:一樣明說,不讓說明欄無聲留白', async () => {
    state.store.draftValuationSummary = vi.fn(async () => ({ error: null, result: {} }))
    await render()
    expect(text()).toContain('AI 沒有回傳施工說明內容')
  })

  it('成功就帶入說明,不出現錯誤列', async () => {
    state.store.draftValuationSummary = vi.fn(async () => ({ error: null, result: { summary: '本期完成 3F 版牆澆置。' } }))
    await render()
    expect(container.querySelector('[aria-label="本期施工說明"]').value).toBe('本期完成 3F 版牆澆置。')
    expect(text()).not.toContain('可按上方「重新產生施工說明」重試')
  })
})
