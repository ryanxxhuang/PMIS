// @vitest-environment jsdom
// 跨案總覽的載入失敗合約(規範 §6):portfolio_summary RPC 失敗時要說失敗並給重試,
// 不能把空列當成「0 案、各案均無未結例外」畫出來;重試成功後橫幅消失、他案出現。
// 定位只走 role/文字(規範 §7 零視覺耦合)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Portfolio from './Portfolio.jsx'

let container, root
const okRow = {
  project_id: 'p2', billable_total: 1000, latest_cum: 250, latest_period: 3, latest_status: '已核定',
  open_defects: 2, pending_inspections: 0, pending_change_orders: 1, acceptance_events: [],
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.store = {
    demoMode: false, isSupabaseConfigured: true,
    projects: [{ project_id: 'p1', project_name: 'A 案' }, { project_id: 'p2', project_name: 'B 案', project_code: 'B-1' }],
    currentProject: { project_id: 'p1' }, switchProject: vi.fn(), loadPortfolio: vi.fn(),
    project: { project_name: 'A 案', project_code: 'A-1' }, workItems: { items: [] },
    valuations: [], progressPlan: null, defects: [], inspections: [], changeOrders: [], acceptanceEvents: [],
    adjustedItems: [], revisedTotal: 0,
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

const render = () => act(async () => {
  root.render(<MemoryRouter initialEntries={['/portfolio']}><Portfolio /></MemoryRouter>)
})
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)

describe('跨案總覽 error state', () => {
  it('RPC 回 error:顯示失敗橫幅與重試,不畫例外帶的假 0;重試成功後他案出現', async () => {
    state.store.loadPortfolio
      .mockResolvedValueOnce({ rows: [], error: { message: 'boom' } })
      .mockResolvedValueOnce({ rows: [okRow], error: null })
    await render()
    expect(container.textContent).toContain('跨案彙總讀取失敗')
    expect(container.textContent).toContain('其他專案未列出')
    // 例外帶(「N 案」索引)不得在失敗時出現——那會說「1 案 各案均無未結例外」
    expect(container.textContent).not.toContain('各案均無未結例外')
    expect(container.textContent).not.toContain('B 案')
    const retry = button('重試')
    expect(retry).toBeTruthy()
    await act(async () => retry.click())
    expect(state.store.loadPortfolio).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('跨案彙總讀取失敗')
    expect(container.textContent).toContain('B 案')
    expect(container.textContent).toContain('2 案')
  })

  it('RPC 拋例外(網路層)同樣走失敗橫幅,不靜默', async () => {
    state.store.loadPortfolio.mockRejectedValueOnce(new Error('Failed to fetch'))
    await render()
    expect(container.textContent).toContain('跨案彙總讀取失敗')
    expect(button('重試')).toBeTruthy()
  })

  it('載入中不畫例外帶,只有本案卡與載入狀態', async () => {
    let resolve
    state.store.loadPortfolio.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    await render()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('正在載入')
    expect(container.textContent).not.toContain('各案均無未結例外')
    await act(async () => resolve({ rows: [], error: null }))
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.textContent).toContain('1 案')
  })
})
