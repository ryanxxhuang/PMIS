// @vitest-environment jsdom
// O2:期限追蹤頁「基準日與契約總價」的可編輯性必須鏡像伺服器。基準日走 RPC update_project_anchors
// (授權＝projects 的 update policy is_project_admin)、契約價金總額直接 update projects——非專案管理者
// 送出一定被拒。原本吃 can.edit(廠商角色)會渲染出送出必被擋的假可編輯欄位。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Deadlines from './Deadlines.jsx'

let container, root
const baseStore = (over = {}) => ({
  currentProject: { project_id: 'p1', contract_total: 1000000 },
  project: { project_id: 'p1', award_date: '2026-02-01', notice_date: '2026-02-10', commencement_date: '2026-03-01', end_date: '2027-06-30' },
  isPersistedProject: true, demoMode: false,
  currentUser: { user_id: 'u1', org_type: 'contractor' },
  workItems: { meta: { billable_total: 900000 }, items: [] },
  can: { edit: true, admin: false, override: false },
  obligations: [], updateObligationStatus: vi.fn(), transitionObligationPeriod: vi.fn(),
  changeProjectAnchors: vi.fn(async () => ({ error: null, version: null })), updateProjectSettings: vi.fn(async () => ({ error: null })),
  anchorVersions: [], acceptanceEvents: [], submittals: [], projectWarranty: null,
  ...over,
})

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

const render = () => act(async () => { root.render(<MemoryRouter initialEntries={['/deadlines']}><Deadlines /></MemoryRouter>) })
const field = (label) => [...container.querySelectorAll('label')].find((l) => l.textContent.includes(label))?.querySelector('input, select')

describe('基準日與契約價金總額的可編輯性', () => {
  it('非專案管理者(即使是廠商角色):四個基準日與契約價金總額都唯讀,並說明為什麼', async () => {
    state.store = baseStore()
    await render()
    for (const label of ['決標日', '接獲開工通知日', '開工日', '竣工日']) expect(field(label).disabled, label).toBe(true)
    expect(field('契約價金總額').disabled).toBe(true)
    expect(container.textContent).toContain('只有專案管理者可以修改')
  })

  it('專案管理者:可編輯,且不再出現唯讀說明', async () => {
    state.store = baseStore({ can: { edit: true, admin: true, override: true } })
    await render()
    expect(field('決標日').disabled).toBe(false)
    expect(field('契約價金總額').disabled).toBe(false)
    expect(container.textContent).not.toContain('只有專案管理者可以修改')
  })

  it('示範模式:基準日只進記憶體,可以改;契約價金總額沒有可寫的地方,唯讀', async () => {
    state.store = baseStore({ demoMode: true, isPersistedProject: false, can: { edit: true, admin: false, override: false } })
    await render()
    expect(field('決標日').disabled).toBe(false)
    expect(field('契約價金總額').disabled).toBe(true)
  })
})
