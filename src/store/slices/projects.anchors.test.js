// @vitest-environment jsdom
// P5c 基準日版本:前端改基準日只有一條路——RPC update_project_anchors(每次變更留一版、DB 同交易重算並記差異)。
// 釘住:1) 只送四個基準日鍵、帶類別／依據／生效日,不直寫 projects;2) 現行值以伺服器回傳的版本快照更新,
// RPC 回 null(值沒變)就不動;3) RPC 拒絕(非管理者)→ 回錯誤、本地不變;4) 非基準日設定(契約價金總額)走
// updateProjectSettings 直寫,但它拒絕基準日鍵(不能繞過留版)。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { renderHook } from '../../testUtils/renderHook.js'
import { configured } from '../../testUtils/supabaseMock.js'

const { pg } = await vi.hoisted(async () => {
  const { createScriptedSupabase } = await import('../../testUtils/scriptedSupabase.js')
  return { pg: createScriptedSupabase() }
})
vi.mock('../../lib/supabase.js', () => configured(pg.client))
vi.mock('../../lib/boqCalc.js', () => ({ loadWorkItems: vi.fn(async () => ({ items: [], meta: {} })) }))

import { useProjectsSlice } from './projects.js'

const PROJECT = { id: 'p1', name: '測試案', award_date: '2026-01-10', notice_date: null, commencement_date: '2026-02-20', end_date: '2026-12-31', contract_total: null }
const VERSION = (over = {}) => ({
  id: 'v2', project_id: 'p1', version_no: 2, change_kind: 'edit',
  anchors: { award_date: '2026-01-10', notice_date: null, commencement_date: '2026-04-10', end_date: '2026-12-31' },
  changed_keys: ['commencement_date'], effective_from: '2026-09-19', reason: null, source_ref: null, source_change_order_id: null,
  effects: [{ kind: 'rescheduled', obligation_id: 'o1', title: '開工後 15 日提送施工計畫', period_key: null, old_due: '2026-03-07', new_due: '2026-04-25', status: '待辦' }],
  created_by: 'u1', created_at: '2026-09-19T00:00:00Z', ...over,
})
const user = { real: true, user_id: 'u1', name: '管理者' }

async function mountWithProject() {
  pg.script('projects', 'select', { data: [PROJECT], error: null })
  pg.script('project_members', 'select', { data: [{ project_id: 'p1', role: 'admin' }], error: null })
  const r = renderHook(() => useProjectsSlice({ currentUser: user }))
  await act(async () => { await new Promise((res) => setTimeout(res, 0)) })
  expect(r.current.currentProject?.project_id).toBe('p1')
  return r
}

beforeEach(() => { pg.reset(); globalThis.localStorage?.clear?.() })

describe('updateProjectAnchors(P5c):基準日只走 RPC 留版', () => {
  it('送出四個基準日鍵與依據;成功後現行值=伺服器版本快照,回傳版本列(含受影響事項)', async () => {
    const r = await mountWithProject()
    pg.script('rpc:update_project_anchors', 'rpc', { data: VERSION(), error: null })
    let res
    await act(async () => {
      res = await r.current.updateProjectAnchors({ commencement_date: '2026-04-10', contract_total: 999 }, { change_kind: 'edit', reason: '實際開工日更正', source_ref: '', effective_from: null })
    })
    expect(res.error).toBeNull()
    expect(res.version.version_no).toBe(2)
    expect(res.version.effects).toHaveLength(1)
    expect(pg.argsOf('rpc:update_project_anchors', 'rpc')[0][0]).toEqual({
      p_project: 'p1', p_anchors: { commencement_date: '2026-04-10' }, p_change_kind: 'edit',
      p_reason: '實際開工日更正', p_source_ref: null, p_source_change_order_id: null, p_effective_from: null,
    })
    expect(pg.hit('projects', 'update')).toBe(false) // 不直寫 projects(直寫會留版但沒有依據)
    expect(r.current.currentProject.commencement_date).toBe('2026-04-10')
    expect(r.current.currentProject.award_date).toBe('2026-01-10')
  })

  it('展延:類別／函文／變更案／生效日原樣送出;空字串日期送 null(清空基準日)', async () => {
    const r = await mountWithProject()
    pg.script('rpc:update_project_anchors', 'rpc', { data: VERSION({ change_kind: 'extension', changed_keys: ['end_date', 'notice_date'], anchors: { award_date: '2026-01-10', notice_date: null, commencement_date: '2026-02-20', end_date: '2027-03-31' } }), error: null })
    await act(async () => {
      await r.current.updateProjectAnchors({ end_date: '2027-03-31', notice_date: '' }, { change_kind: 'extension', reason: '機關核准展延 90 日', source_ref: '府工字第 1 號', source_change_order_id: 'co-1', effective_from: '2026-09-01' })
    })
    expect(pg.argsOf('rpc:update_project_anchors', 'rpc')[0][0]).toMatchObject({
      p_anchors: { end_date: '2027-03-31', notice_date: null }, p_change_kind: 'extension', p_reason: '機關核准展延 90 日',
      p_source_ref: '府工字第 1 號', p_source_change_order_id: 'co-1', p_effective_from: '2026-09-01',
    })
    expect(r.current.currentProject.end_date).toBe('2027-03-31')
  })

  it('RPC 回 null(直接修改但值沒變)→ 沒有新版本、本地不動;RPC 拒絕(非管理者)→ 回錯誤、本地不動', async () => {
    const r = await mountWithProject()
    pg.script('rpc:update_project_anchors', 'rpc', { data: null, error: null })
    let res
    await act(async () => { res = await r.current.updateProjectAnchors({ commencement_date: '2026-02-20' }, {}) })
    expect(res).toEqual({ error: null, version: null })
    pg.script('rpc:update_project_anchors', 'rpc', { data: null, error: { message: '未生效:僅專案管理者可修改基準日' } })
    await act(async () => { res = await r.current.updateProjectAnchors({ commencement_date: '2026-05-01' }, {}) })
    expect(res.error.message).toContain('僅專案管理者')
    expect(r.current.currentProject.commencement_date).toBe('2026-02-20')
  })

  it('沒有基準日鍵且類別是直接修改 → 直接回錯誤,不打 RPC;停工(不改日期)仍打 RPC 留版', async () => {
    const r = await mountWithProject()
    let res
    await act(async () => { res = await r.current.updateProjectAnchors({ contract_total: 1 }, {}) })
    expect(res.error.message).toContain('沒有要變更的基準日')
    expect(pg.hit('rpc:update_project_anchors', 'rpc')).toBe(false)
    pg.script('rpc:update_project_anchors', 'rpc', { data: VERSION({ change_kind: 'suspension', changed_keys: [], anchors: PROJECT, effects: [] }), error: null })
    await act(async () => { res = await r.current.updateProjectAnchors({}, { change_kind: 'suspension', reason: '颱風停工', effective_from: '2026-09-10' }) })
    expect(res.version.change_kind).toBe('suspension')
    expect(pg.argsOf('rpc:update_project_anchors', 'rpc')[0][0]).toMatchObject({ p_anchors: {}, p_change_kind: 'suspension', p_effective_from: '2026-09-10' })
  })
})

describe('updateProjectSettings:非基準日設定直寫,但拒絕基準日鍵', () => {
  it('契約價金總額直寫 projects;帶基準日鍵一律拒絕(不能繞過留版)', async () => {
    const r = await mountWithProject()
    let res
    await act(async () => { res = await r.current.updateProjectSettings({ contract_total: 1000 }) })
    expect(res.error).toBeNull()
    expect(pg.hit('projects', 'update')).toBe(true)
    expect(r.current.currentProject.contract_total).toBe(1000)
    pg.reset()
    await act(async () => { res = await r.current.updateProjectSettings({ end_date: '2027-01-01' }) })
    expect(res.error.message).toContain('留版')
    expect(pg.hit('projects', 'update')).toBe(false)
  })
})
