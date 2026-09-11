// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createFakePostgrest } from '../../testUtils/fakePostgrest.js'

const state = vi.hoisted(() => ({ db: null, store: null }))
vi.mock('../../lib/supabase.js', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (...args) => state.db.supabase.from(...args) },
}))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import RequirementsReview from './RequirementsReview.jsx'
import Requirements from './Requirements.jsx'

let container, root
const req = (i, doubts = []) => ({
  id: `r${String(i).padStart(4, '0')}`, project_id: 'p1',
  title: `契約事項 ${i}`, description: '依原文辦理', status: 'approved', origin: 'ai',
  reviewed_at: '2026-09-08T01:00:00Z', reviewed_by: null, triage_doubts: doubts,
  created_at: `2026-09-08T01:${String(i % 60).padStart(2, '0')}:00Z`,
  requirement_type: 'deadline', responsible_party_type: 'contractor', lifecycle_phase: '施工中',
})

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  state.db = createFakePostgrest()
  state.store = {
    currentProject: { project_id: 'p1' }, project: {}, isPersistedProject: true,
    currentUser: { org_type: 'supervisor' }, can: { write: true },
    workItems: { items: [] }, obligations: [], submittals: [], reloadObligations: vi.fn(),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
  vi.unstubAllGlobals()
})

async function render(Page, path) {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Page /></MemoryRouter>)
  })
}
async function clickByText(text) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  expect(button, text).toBeTruthy()
  await act(async () => button.click())
}

describe('契約核對的實際頁面流程', () => {
  it('從文件帶入契約範圍，只顯示該契約重點，也保留返回文件的範圍', async () => {
    state.db.setTable('contract_packages', [{ id: 'pkg1', project_id: 'p1', title: '甲契約' }, { id: 'pkg2', project_id: 'p1', title: '乙契約' }])
    state.db.setTable('requirements', [1, 2].map((i) => ({ ...req(i), ingestion_run_id: `run${i}` })))
    state.db.setTable('document_ingestion_runs', [1, 2].map((i) => ({ id: `run${i}`, document_version_id: `v${i}`, project_id: 'p1', status: 'completed' })))
    state.db.setTable('document_versions', [1, 2].map((i) => ({ id: `v${i}`, documents: { title: `文件 ${i}`, contract_package_id: `pkg${i}` } })))
    state.store.obligations = [1, 2].map((i) => ({ id: `ob${i}`, requirement_id: `r000${i}`, title: `履約事項 ${i}`, responsible: '廠商', status: '待辦' }))
    await render(Requirements, '/requirements?package=pkg2')
    const list = container.querySelector('[aria-label="履約義務時間軸"]')
    expect(list.textContent).toContain('履約事項 2')
    expect(list.textContent).not.toContain('履約事項 1')
    expect(container.querySelector('a[href="/contract?package=pkg2"]')).toBeTruthy()
    expect(container.querySelector('a[href="/requirements/review?package=pkg2"]')).toBeTruthy()
    expect(state.store.reloadObligations).toHaveBeenCalled()
    const picker = container.querySelector('[aria-label="契約範圍"]')
    await act(async () => { picker.value = ''; picker.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(list.textContent).toContain('履約事項 1')
    expect(list.textContent).toContain('履約事項 2')
  })

  it.each([['contractor', ['廠商']], ['supervisor', ['廠商', '監造']], ['owner', ['廠商', '監造', '機關']]])('角色 %s 的重點展示範圍', async (role, visible) => {
    state.store.currentUser = { org_type: role }
    state.store.isPersistedProject = false
    state.store.obligations = ['廠商', '監造', '機關'].map((responsible, i) => ({ id: `ob${i}`, title: `${responsible}專屬事項`, responsible, status: '待辦' }))
    await render(Requirements, '/requirements')
    const list = container.querySelector('[aria-label="履約義務時間軸"]')
    for (const party of ['廠商', '監造', '機關']) {
      expect(list.textContent.includes(`${party}專屬事項`)).toBe(visible.includes(party))
    }
  })

  it('整理進行中不能把使用者導回重新上傳', async () => {
    state.db.setTable('document_ingestion_runs', [{ id: 'run1', project_id: 'p1', status: 'processing' }])
    await render(Requirements, '/requirements')
    expect(container.textContent).toContain('AI 正在整理契約')
    expect(container.textContent).not.toContain('前往專案文件上傳契約')
  })

  it('進入疑慮檢視仍保留契約範圍，不顯示別份契約的項目', async () => {
    state.db.setTable('requirements', [1, 2].map((i) => ({ ...req(i, ['引文未核對']), contract_package_id: `pkg${i}` })))
    await render(RequirementsReview, '/requirements/review?package=pkg2')
    const list = container.querySelector('[aria-label="契約重點清單"]')
    expect(list.textContent).toContain('契約事項 2')
    expect(list.textContent).not.toContain('契約事項 1')
    expect(container.querySelector('a[href="/requirements?package=pkg2"]')).toBeTruthy()
  })
  it('1001 筆中的最後一筆疑慮仍可一鍵找到，且不要求重看其餘已核對內容', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      ...req(i, i === 1000 ? ['期限數字不符'] : []), created_at: String(2000 - i),
    }))
    state.db.setTable('requirements', rows)
    await render(RequirementsReview, '/requirements/review')
    expect(container.textContent).toContain('有 1 項需留意')
    expect(state.db.requestsFor('requirements').some((q) => q.from === 1000)).toBe(true)
    await clickByText('只看需留意項目')
    const list = container.querySelector('[aria-label="契約重點清單"]')
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(1)
    expect(list.textContent).toContain('契約事項 1000')
    await act(async () => list.querySelector('[role="listitem"]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('期限數字不符')
    expect(container.textContent).not.toContain('系統核對無誤')
  })

  it('單條深連結仍能開啟已核對項目，不被例外篩選擋住', async () => {
    state.db.setTable('requirements', [req(1), req(2, ['引文未核對'])])
    await render(RequirementsReview, '/requirements/review?highlight=r0001')
    expect(container.querySelector('#hl-r0001')?.getAttribute('aria-current')).toBe('true')
    expect(container.textContent).toContain('不代表已驗證全部語意或沒有漏項')
  })

  it('履約主頁呈現真實疑慮與原文入口，不誤標核對無誤', async () => {
    state.db.setTable('requirements', [req(1, ['期限數字不符'])])
    state.store.obligations = [{ id: 'ob1', requirement_id: 'r0001', title: '應提送計畫',
      responsible: '廠商', status: '待辦', trigger_event: 'fixed', fixed_date: '2026-09-09', category: '施工中' }]
    await render(Requirements, '/requirements?obligation=ob1')
    expect(container.textContent).toContain('期限數字不符')
    expect(container.textContent).not.toContain('系統核對無誤')
    expect(container.querySelector('a[href="/requirements/review?highlight=r0001"]')).toBeTruthy()
  })

  it('沒有義務時也會顯示文件缺漏，而不只在有結果時警示', async () => {
    state.db.setTable('document_ingestion_runs', [{ id: 'run1', project_id: 'p1', document_version_id: 'v1',
      status: 'completed', metadata: { empty_page_numbers: [2], total_page_count: 3, last_included_page: 3 } }])
    state.db.setTable('document_versions', [{ id: 'v1', documents: { title: '施工契約' } }])
    await render(Requirements, '/requirements')
    expect(container.textContent).toContain('施工契約')
    expect(container.textContent).toContain('頁／段 2')
    expect(container.textContent).toContain('需要檢查完整性')
  })
})
