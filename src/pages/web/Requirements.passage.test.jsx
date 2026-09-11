// @vitest-environment jsdom
// 詳情欄「契約原文＋條文高亮」(方向 C)的退路鏈:每一段都要有對應 UI,不能只有空白。
// 定位器本身的正確性在 sourceVerify.test.ts;這裡釘的是頁面把四段接對了沒。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createFakePostgrest } from '../../testUtils/fakePostgrest.js'
import { normalizeSourceText } from '../../../supabase/functions/_shared/sourceVerify.ts'

const state = vi.hoisted(() => ({ db: null, store: null }))
vi.mock('../../lib/supabase.js', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (...args) => state.db.supabase.from(...args) },
}))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Requirements from './Requirements.jsx'

const CLAUSE = '施工廠商應於開工前14日內,檢送施工計畫書予監造單位審查'
const PAGE_TEXT = '第十二條 施工計畫\n施工廠商應於開工前 14 日內，檢送施工計畫書\n予監造單位審查，未經核定不得施工。\n第十三條 品質計畫'

let container, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  state.db = createFakePostgrest()
  state.db.setTable('requirements', [{
    id: 'r0001', project_id: 'p1', title: '提送施工計畫書', status: 'approved', origin: 'ai',
    created_at: '2026-09-08T01:00:00Z', requirement_type: 'deadline', responsible_party_type: 'contractor',
  }])
  state.db.setTable('document_versions', [{ id: 'v1', version_label: 'v1', documents: { title: '工程契約' } }])
  state.store = {
    currentProject: { project_id: 'p1' }, project: {}, isPersistedProject: true,
    currentUser: { org_type: 'supervisor' }, can: { write: true },
    obligations: [{ id: 'ob1', requirement_id: 'r0001', title: '提送施工計畫書', responsible: '廠商', status: '待辦' }],
    submittals: [], reloadObligations: vi.fn(),
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

const source = (over = {}) => [{
  id: 's1', requirement_id: 'r0001', document_version_id: 'v1', page_number: 3,
  source_text: CLAUSE, source_verified: true, clause: '第十二條', ...over,
}]
// enrich 與頁文字是兩段各自 await 的查詢,多讓幾個 tick 落地
async function render() {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/requirements']}><Requirements /></MemoryRouter>)
  })
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('契約原文＋條文高亮的退路鏈', () => {
  it('④ 定位成功:整頁原文攤開、引述那段 <mark> 起來', async () => {
    state.db.setTable('requirement_sources', source())
    state.db.setTable('document_pages', [{ document_version_id: 'v1', page_number: 3, extracted_text: PAGE_TEXT }])
    await render()
    const region = container.querySelector('[aria-label="契約原文"]')
    expect(region).toBeTruthy()
    expect(region.textContent).toContain('第十三條 品質計畫')
    const mark = region.querySelector('mark')
    expect(mark).toBeTruthy()
    expect(normalizeSourceText(mark.textContent)).toBe(normalizeSourceText(CLAUSE))
    expect(container.querySelector('blockquote')).toBeNull()
    expect(container.textContent).toContain('來源已核對')
  })

  it('③ 有頁文字但定不到精確位置:退回引述並明說', async () => {
    // 標點寬容才驗得過('、' vs ','):source_verified 照舊,但不給高亮
    state.db.setTable('requirement_sources', source({ source_text: CLAUSE.replace(',', '、') }))
    state.db.setTable('document_pages', [{ document_version_id: 'v1', page_number: 3, extracted_text: PAGE_TEXT }])
    await render()
    expect(container.querySelector('mark')).toBeNull()
    expect(container.querySelector('blockquote')).toBeTruthy()
    expect(container.textContent).toContain('原文比對不到精確位置')
  })

  it('② 該頁沒有逐頁文字:退回引述,不加註', async () => {
    state.db.setTable('requirement_sources', source())
    state.db.setTable('document_pages', [])
    await render()
    expect(container.querySelector('mark')).toBeNull()
    expect(container.querySelector('blockquote')).toBeTruthy()
    expect(container.textContent).not.toContain('原文比對不到精確位置')
  })

  it('① DOCX 出處沒有頁碼:引述照舊,而且根本不查 document_pages', async () => {
    state.db.setTable('requirement_sources', source({ page_number: null }))
    state.db.setTable('document_pages', [{ document_version_id: 'v1', page_number: 3, extracted_text: PAGE_TEXT }])
    await render()
    expect(container.querySelector('blockquote')).toBeTruthy()
    expect(container.querySelector('mark')).toBeNull()
    expect(state.db.requestsFor('document_pages')).toHaveLength(0)
  })
})
