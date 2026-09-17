// @vitest-environment jsdom
// 跨案總覽(選案清單)的載入失敗合約(規範 §6):portfolio_summary RPC 失敗時要說失敗並給重試,
// 不能把空列當成「你只有這一案」畫出來;重試成功後橫幅消失、他案出現在清單。
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
    project: { project_name: 'A 案', project_code: 'A-1' },
    valuations: [], defects: [], inspections: [], changeOrders: [],
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
const listItems = () => [...container.querySelectorAll('[aria-label="專案清單"] li')]

describe('跨案總覽(選案清單) error state', () => {
  it('RPC 回 error:顯示失敗橫幅與重試,清單只有本案且標題不假稱總數;重試成功後他案出現', async () => {
    state.store.loadPortfolio
      .mockResolvedValueOnce({ rows: [], error: { message: 'boom' } })
      .mockResolvedValueOnce({ rows: [okRow], error: null })
    await render()
    expect(container.textContent).toContain('跨案清單讀取失敗')
    expect(container.textContent).toContain('其他專案未列出')
    expect(container.textContent).not.toContain('B 案')
    // 失敗時卡頭不得寫「專案（1）」——那等於宣稱你只有一案
    expect(container.textContent).toContain('專案（載入中）')
    expect(listItems()).toHaveLength(1)
    const retry = button('重試')
    expect(retry).toBeTruthy()
    await act(async () => retry.click())
    expect(state.store.loadPortfolio).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('跨案清單讀取失敗')
    expect(container.textContent).toContain('專案（2）')
    const rows = listItems()
    expect(rows).toHaveLength(2)
    expect(rows[1].textContent).toContain('B 案')
    expect(rows[1].textContent).toContain('最近估驗 第 3 期（已核定）')
    expect(rows[1].textContent).toContain('缺失 2')
  })

  it('RPC 拋例外(網路層)同樣走失敗橫幅,不靜默', async () => {
    state.store.loadPortfolio.mockRejectedValueOnce(new Error('Failed to fetch'))
    await render()
    expect(container.textContent).toContain('跨案清單讀取失敗')
    expect(button('重試')).toBeTruthy()
  })

  it('載入中只有本案與載入狀態;載到空列後總數才是 1', async () => {
    let resolve
    state.store.loadPortfolio.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    await render()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('正在載入')
    expect(container.textContent).toContain('專案（載入中）')
    await act(async () => resolve({ rows: [], error: null }))
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.textContent).toContain('專案（1）')
  })

  it('點他案切換專案並回到今日工作;點本案不切換', async () => {
    state.store.loadPortfolio.mockResolvedValueOnce({ rows: [okRow], error: null })
    await render()
    const rows = listItems()
    await act(async () => rows[1].querySelector('button').click())
    expect(state.store.switchProject).toHaveBeenCalledWith('p2')
    await act(async () => rows[0].querySelector('button').click())
    expect(state.store.switchProject).toHaveBeenCalledTimes(1)
  })
})
