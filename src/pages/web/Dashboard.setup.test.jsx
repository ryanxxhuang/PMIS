// @vitest-environment jsdom
// 未匯標單時,初始化準備與已可執行的待辦並存(UIUX 階段 2 U05):
// - 真專案沒標單但有待審送審 → 「專案初始化」卡與「現在輪到我」清單同時出現,待辦可點;
// - 一般成員(非專案管理者)看到「由專案管理者完成」的說明,不被要求越權設定;
// - 切到「等待對方」時初始化卡不跟過去(它只屬於「現在該做什麼」的脈絡)。
// 定位只走 role/文字(規範 §7 零視覺耦合)。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
// SetupChecklist 的三個 head 查詢:thenable builder,eq 可鏈,await 直接回 count 0
vi.mock('../../lib/supabase.js', () => {
  const q = { eq: () => q, then: (res) => res({ count: 0, error: null }) }
  return { supabase: { from: () => ({ select: () => q }) } }
})
import Dashboard from './Dashboard.jsx'

let container, root
const submittal = { id: 'S1', submittal_no: 'SUB-001', title: '整體品質計畫', status: '已提送', revision: 0, submitted_date: '2026-09-10', due_date: '2026-09-30' }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.store = {
    project: { project_name: 'A 案', project_code: 'A-1', formal_mode: false },
    currentProject: { project_id: 'p1' },
    currentUser: { org_type: 'supervisor' },            // 已提送送審輪到監造
    workItems: null, workItemsSource: 'none', demoMode: false, isPersistedProject: true,
    valuations: [], progressPlan: null, inspections: [], defects: [], siteLogs: [], obligations: [], costItems: [],
    safetyRecords: [], changeOrders: [], itemSchedules: [], adjustedItems: [], revisedTotal: 0,
    checklistTemplates: [], checklistRecords: [], testSamples: [], submittals: [submittal], rfis: [], observations: [],
    acceptanceEvents: [], inspectionPoints: [],
    aiEnabled: () => false, can: { admin: false, override: false }, isPlatformAdmin: false,
    listMembers: vi.fn().mockResolvedValue({ rows: [], error: null }),
    agentActions: [], agentRuns: [],
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
const render = (entry = '/dashboard') => act(async () => {
  root.render(<MemoryRouter initialEntries={[entry]}><Dashboard /></MemoryRouter>)
})

describe('無標單的真專案首頁', () => {
  it('初始化卡與「現在輪到我」清單並存,待辦可點進單據', async () => {
    await render()
    expect(container.textContent).toContain('專案初始化')
    const list = container.querySelector('[role="list"][aria-label="現在輪到我清單"]')
    expect(list).toBeTruthy()
    const link = [...list.querySelectorAll('a')].find((a) => a.textContent.includes('SUB-001'))
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toContain('/submittals?submittal=S1')
  })

  it('一般成員看到初始化由專案管理者完成,不被要求自己設定;管理者不顯示這句', async () => {
    await render()
    expect(container.textContent).toContain('初始化由專案管理者完成')
    await act(async () => root.unmount())
    root = createRoot(container)
    state.store = { ...state.store, can: { admin: true, override: true } }
    await render()
    expect(container.textContent).toContain('專案初始化')
    expect(container.textContent).not.toContain('初始化由專案管理者完成')
  })

  it('從單據返回但原項已不在清單:明說可能已完成或交給對方(U11)', async () => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[{ pathname: '/dashboard', state: { returnedTask: 'gone-task', returnedTo: '/change-orders?co=C2' } }]}><Dashboard /></MemoryRouter>)
    })
    const status = [...container.querySelectorAll('[role="status"]')].map((n) => n.textContent).join(' ')
    expect(status).toContain('剛才處理的事項已不在「現在輪到我」')
    expect(status).not.toContain('今天已完成')
    // W06:給確定的回找入口,指向剛才那一筆
    const back = [...container.querySelectorAll('a')].find((a) => a.textContent.includes('回到剛才處理的那一筆'))
    expect(back?.getAttribute('href')).toBe('/change-orders?co=C2')
  })

  it('等待對方/今天已完成不帶初始化卡,只列該桶清單', async () => {
    await render('/dashboard?ball=waiting')
    expect(container.textContent).not.toContain('專案初始化')
    expect(container.textContent).toContain('等待對方')
  })
})
