// @vitest-environment jsdom
// 標單工項查找(Codex §5):輸入項次或名稱關鍵字 → 只列符合的工項與所屬各層(祖先全展開、符合列標記);
// 找不到就明說;清掉關鍵字回到原本的展開狀態(第一層展開、其餘收合)。只走 aria-label 與文字定位。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import BOQ from './BOQ.jsx'

let container, root
const items = [
  { item_key: 'A', parent_key: null, depth: 1, item_no: '壹', description: '發包工程費', unit: '式', quantity: 1, unit_price: 900, amount: 900, is_billable: true },
  { item_key: 'A1', parent_key: 'A', depth: 2, item_no: '壹.一', description: '結構工程', unit: '式', quantity: 1, unit_price: 900, amount: 900, is_billable: true },
  { item_key: 'A11', parent_key: 'A1', depth: 3, item_no: '壹.一.1', description: '鋼筋 SD420W', unit: 'T', quantity: 10, unit_price: 90, amount: 900, is_billable: true, is_leaf: true },
  { item_key: 'B', parent_key: null, depth: 1, item_no: '貳', description: '雜項工程', unit: '式', quantity: 1, unit_price: 100, amount: 100, is_billable: true },
  { item_key: 'B1', parent_key: 'B', depth: 2, item_no: '貳.一', description: '模板', unit: 'M2', quantity: 5, unit_price: 20, amount: 100, is_billable: true, is_leaf: true },
]

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  state.store = {
    workItems: { items, meta: { project_name: '測試案', owner_name: '機關', billable_total: 1000, item_count: 5, leaf_count: 2 } },
    workItemsSource: 'demo', workItemsError: null, retryWorkItems: vi.fn(), importWorkItems: vi.fn(), resetProjectBoq: vi.fn(),
    isSupabaseConfigured: false, currentProject: null, dbMode: false, can: {},
    currentUser: { org_type: 'contractor' }, isPlatformAdmin: false,
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

const render = () => act(async () => { root.render(<MemoryRouter initialEntries={['/boq']}><BOQ /></MemoryRouter>) })
const rows = () => [...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim())
const typeSearch = (value) => act(async () => {
  const el = container.querySelector('input[aria-label="搜尋工項"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('標單工項查找', () => {
  it('預設只展開第一層;輸入名稱關鍵字後只列符合列與所屬各層,符合列被標記', async () => {
    await render()
    expect(rows().some((r) => r.includes('結構工程'))).toBe(true) // 第一層預設展開,看得到第二層
    expect(rows().some((r) => r.includes('鋼筋'))).toBe(false)
    await typeSearch('鋼筋')
    const r = rows()
    expect(r.some((x) => x.includes('鋼筋 SD420W'))).toBe(true)
    expect(r.some((x) => x.includes('結構工程'))).toBe(true) // 祖先展開,路徑看得見
    expect(r.some((x) => x.includes('雜項工程'))).toBe(false) // 不相關章節不列
    expect(container.querySelector('tr[aria-current="true"]').textContent).toContain('鋼筋')
    expect(container.querySelector('[role="status"]').textContent).toContain('找到 1 項符合「鋼筋」')
  })

  it('項次也能找;找不到明說;清掉關鍵字回到原本的展開', async () => {
    await render()
    await typeSearch('貳.一')
    expect(rows().some((x) => x.includes('模板'))).toBe(true)
    expect(rows().some((x) => x.includes('發包工程費'))).toBe(false)
    await typeSearch('不存在的工項')
    expect(rows().length).toBe(0)
    expect(container.querySelector('[role="status"]').textContent).toContain('沒有符合「不存在的工項」')
    await typeSearch('')
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(rows().some((r) => r.includes('雜項工程'))).toBe(true)
    expect(rows().some((r) => r.includes('鋼筋'))).toBe(false) // 第三層仍收合
  })
})
