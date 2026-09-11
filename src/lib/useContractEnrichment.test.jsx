// @vitest-environment jsdom
// 契約 enrich hook 的載入合約:指定 id 只拉那些 requirement(出處與之並行)、'all'
// 拉全案;審查人只在要求時查;切案清空、同案重載保留舊列;patch 就地換列。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createFakePostgrest } from '../testUtils/fakePostgrest.js'

const state = vi.hoisted(() => ({ db: null }))
vi.mock('./supabase.js', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (...args) => state.db.supabase.from(...args) },
}))
import { useContractEnrichment } from './useContractEnrichment.js'

let container, root, last, seen
// seen:每次 render 看到的 loaded:列數——中間態(重載中仍保留舊列)只能從這裡觀察,
// 假 PostgREST 在同一個 act 內就把整條載入跑完了
function Probe(props) {
  last = useContractEnrichment(props)
  seen.push(`${last.loaded}:${last.rows.length}`)
  return null
}
const render = (props) => act(async () => { root.render(<Probe {...props} />) })
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  seen = []
  state.db = createFakePostgrest()
  state.db.setTable('requirements', [
    { id: 'r1', project_id: 'p1', ingestion_run_id: 'run1', reviewed_by: 'u1', created_at: '2' },
    { id: 'r2', project_id: 'p1', ingestion_run_id: 'run1', reviewed_by: null, created_at: '1' },
    { id: 'r9', project_id: 'p2', ingestion_run_id: null, created_at: '3' },
  ])
  state.db.setTable('requirement_sources', [
    { id: 's1', requirement_id: 'r1', document_version_id: 'v1' },
    { id: 's2', requirement_id: 'r1', document_version_id: 'v1' },
    { id: 's3', requirement_id: 'r2', document_version_id: 'v1' },
  ])
  state.db.setTable('document_ingestion_runs', [{ id: 'run1', project_id: 'p1', document_version_id: 'v1', status: 'completed' }])
  state.db.setTable('document_versions', [{ id: 'v1', documents: { title: '契約', contract_package_id: 'pkg1' } }])
  state.db.setTable('contract_packages', [{ id: 'pkg1', project_id: 'p1', title: '甲', package_type: 'construction' }])
  state.db.setTable('profiles', [{ id: 'u1', full_name: '林淑芬', company: '工務局' }])
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

describe('useContractEnrichment', () => {
  it('指定 id:只拉那幾列、出處分批以 requirement_id 查、Map 組好;不查 profiles', async () => {
    await render({ pid: 'p1', enabled: true, requirementIds: ['r1', null, 'r1'] })
    await settle()
    expect(last.loaded).toBe(true)
    expect(last.rows.map((r) => r.id)).toEqual(['r1'])
    expect(last.reqById.get('r1').ingestion_run_id).toBe('run1')
    expect(last.sourcesByReq.get('r1')).toHaveLength(2)
    expect(last.sourcesByReq.has('r2')).toBe(false)
    expect(last.versionsById.get('v1').documents.contract_package_id).toBe('pkg1')
    expect(last.runsById.get('run1').status).toBe('completed')
    expect(last.packages[0].package_type).toBe('construction')
    expect(state.db.requestsFor('requirement_sources')[0].inSize).toBe(1)
    expect(state.db.requestsFor('profiles')).toHaveLength(0)
  })
  it("'all' + reviewers:拉全案(依 project_id)與審查人;他案列不混入", async () => {
    await render({ pid: 'p1', enabled: true, requirementIds: 'all', reviewers: true })
    await settle()
    expect(last.rows.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(last.reviewersById.get('u1').full_name).toBe('林淑芬')
    expect(last.sourcesByReq.get('r2')).toHaveLength(1)
  })
  it('id 集合沒變(陣列換 identity)不重抓;變了才重抓', async () => {
    await render({ pid: 'p1', enabled: true, requirementIds: ['r1'] })
    await settle()
    const before = state.db.requestsFor('requirements').length
    await render({ pid: 'p1', enabled: true, requirementIds: ['r1'] })
    await settle()
    expect(state.db.requestsFor('requirements')).toHaveLength(before)
    await render({ pid: 'p1', enabled: true, requirementIds: ['r1', 'r2'] })
    await settle()
    expect(state.db.requestsFor('requirements').length).toBeGreaterThan(before)
    expect(last.rows).toHaveLength(2)
  })
  it('切案立刻拿不到舊案列(loaded=false、rows 空);同案 reload 保留舊列只翻 loaded', async () => {
    await render({ pid: 'p1', enabled: true, requirementIds: 'all' })
    await settle()
    expect(last.rows).toHaveLength(2)
    const before = state.db.requestsFor('requirements').length
    seen = []
    await act(async () => { last.reload() })
    await settle()
    // 重載中那一格:舊列仍在、loaded=false(畫面不閃骨架);完成後回 true
    expect(seen).toContain('false:2')
    expect(seen).not.toContain('false:0')
    expect(last.loaded).toBe(true)
    expect(state.db.requestsFor('requirements').length).toBeGreaterThan(before)
    seen = []
    await render({ pid: 'p2', enabled: true, requirementIds: 'all' })
    await settle()
    // 切案:第一格就拿不到舊案列(loaded=false、rows 空),不會拿 p1 的列做初次選取
    expect(seen[0]).toBe('false:0')
    expect(seen).not.toContain('false:2')
    expect(last.rows.map((r) => r.id)).toEqual(['r9'])
  })
  it('查詢失敗:error 帶訊息、loaded=true、保留上一份資料;demo 不打 DB', async () => {
    await render({ pid: 'p1', enabled: true, requirementIds: 'all' })
    await settle()
    state.db.setTable('requirements', new Error('boom'))
    await act(async () => { last.reload() })
    await settle()
    expect(last.loaded).toBe(true)
    expect(last.error).toBeTruthy()
    expect(last.rows).toHaveLength(2)
    state.db.reset()
    await render({ pid: 'p1', enabled: false, requirementIds: 'all' })
    await settle()
    expect(last.loaded).toBe(true)
    expect(last.error).toBe('')
    expect(state.db.requests).toHaveLength(0)
  })
  it('patch 就地換列,reqById 跟著更新', async () => {
    await render({ pid: 'p1', enabled: true, requirementIds: 'all' })
    await settle()
    await act(async () => { last.patch((d) => ({ rows: d.rows.map((r) => (r.id === 'r1' ? { ...r, status: 'approved' } : r)) })) })
    expect(last.reqById.get('r1').status).toBe('approved')
    expect(last.rows).toHaveLength(2)
  })
})
