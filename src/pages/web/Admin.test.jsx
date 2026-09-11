// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Admin from './Admin.jsx'

let container, root
const feature = { key: 'agent.run', label: 'Agent 對話', category: 'agent', enabled: true, min_plan: 'trial', is_llm: true }
const project = (id) => ({ project_id: id, name: id, ai_plan: 'trial', override_count: 0 })
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.store = {
    isPlatformAdmin: true,
    loadAdminOverview: vi.fn(async () => ({ row: { total_calls: 3, cost_usd: 0.004 } })),
    loadAdminDaily: vi.fn(async () => ({ rows: [] })),
    loadAdminByFeature: vi.fn(async () => ({ rows: [] })),
    loadAdminByProject: vi.fn(async () => ({ rows: [] })),
    loadAdminByUser: vi.fn(async () => ({ rows: [] })),
    loadAdminFeatures: vi.fn(async () => ({ rows: [feature] })),
    loadAdminProjects: vi.fn(async () => ({ rows: [project('甲案'), project('乙案')] })),
    loadProjectOverrides: vi.fn(async () => ({ rows: [] })),
    setFeatureEnabled: vi.fn(async () => ({ error: null })),
  }
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function render() { await act(async () => root.render(<MemoryRouter initialEntries={['/admin']}><Admin /></MemoryRouter>)) }
async function tab(label) {
  const button = [...container.querySelectorAll('[role="tab"]')].find((el) => el.textContent === label)
  await act(async () => button.click())
}
it('非平台管理員不觸發跨專案用量 RPC', async () => {
  state.store.isPlatformAdmin = false
  await render()
  expect(container.textContent).toContain('需要平台管理員權限')
  expect(state.store.loadAdminOverview).not.toHaveBeenCalled()
})
it('用量、功能、方案分頁保留載入與設定行為', async () => {
  await render()
  expect(container.textContent).toContain('$0.0040')
  for (const label of ['依功能', '依專案', '依使用者']) await tab(label)
  expect(state.store.loadAdminByFeature).toHaveBeenCalledOnce()
  expect(state.store.loadAdminByProject).toHaveBeenCalledOnce()
  expect(state.store.loadAdminByUser).toHaveBeenCalledOnce()
  await tab('AI 功能開關')
  expect(container.querySelector('[aria-pressed]')).toBeNull()
  await act(async () => container.querySelector('[role="switch"]').click())
  expect(state.store.setFeatureEnabled).toHaveBeenCalledWith('agent.run', false)
  // 重載後使用伺服器的 enabled,不是永久保留本機樂觀值。
  expect(container.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
  await tab('專案方案')
  expect(container.textContent).toContain('甲案')
  expect(container.textContent).toContain('乙案')
})
it('切換覆寫專案時,舊請求遲到不能覆蓋新專案設定', async () => {
  let finishOld
  state.store.loadProjectOverrides.mockImplementation((id) => id === '甲案'
    ? new Promise((resolve) => { finishOld = resolve })
    : Promise.resolve({ rows: [{ feature_key: feature.key, enabled: false }] }))
  await render(); await tab('專案方案')
  const expand = async (id) => {
    const row = [...container.querySelectorAll('tr')].find((el) => el.textContent.includes(id))
    await act(async () => row.querySelector('button').click())
  }
  await expand('甲案'); await expand('乙案')
  const values = () => [...container.querySelectorAll('select')].map((el) => el.value)
  expect(values()).toContain('off')
  await act(async () => finishOld({ rows: [{ feature_key: feature.key, enabled: true }] }))
  expect(values()).toContain('off')
  expect(values()).not.toContain('on')
})
