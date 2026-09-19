// @vitest-environment jsdom
// Quality slice(三級品管:查驗/缺失、自主檢查表範本、取樣試驗)。這裡釘住的是:
//   1. 查驗判定與自主檢查紀錄只由文件簽署寫入(P3b／P3c;P6b-3 起 slice 不再有「快速判定」與「直接登錄檢查紀錄」
//      的寫入函式,DB 也收回了直接寫入);slice 只剩查驗申請、範本落庫與缺失／試體／停留點;
//   2. 不合格的法定後果不可靜默消失:試體 28 天不合格開嚴重缺失(demo 本地、真專案交 DB trigger);
//   3. B-07 假成功:已結案缺失/已判定查驗/已判定試體被 guard 擋下時不可假消失;
//   4. demo 與真 DB 的雙引擎不漂移。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { renderHook } from '../../testUtils/renderHook.js'
import { SILENT_ZERO_ROWS } from '../../testUtils/scriptedSupabase.js'
import { configured } from '../../testUtils/supabaseMock.js'

const { pg } = await vi.hoisted(async () => {
  const { createScriptedSupabase } = await import('../../testUtils/scriptedSupabase.js')
  return { pg: createScriptedSupabase() }
})
vi.mock('../../lib/supabase.js', () => configured(pg.client))
vi.mock('../db.js', () => ({
  loadQualityFromDB: vi.fn(async () => ({ inspections: [], defects: [] })),
  loadDefectsFromDB: vi.fn(async () => []),
}))

import { useQualitySlice } from './quality.js'
import { loadQualityFromDB, loadDefectsFromDB } from '../db.js'

// 一張有量化標準的檢查表:只要填的值超出 max 就判不合格
const TEMPLATE = {
  id: 'tpl-1', title: '混凝土澆置前自主檢查', source: '03310',
  items: [
    { no: '1', item: '模板垂直度', kind: 'num', max: 5, standard: '≤5mm' },
    { no: '2', item: '鋼筋間距確認', kind: 'bool', standard: '符合圖說' },
  ],
}
const WI = { id: 'wi-1', item_key: 'A1', item_no: '1', description: '假設工程' }
const ctx = (over = {}) => ({
  dbMode: true, isPersistedProject: true,
  currentProject: { project_id: 'p1' },
  currentUser: { user_id: 'u1', name: '測試員' },
  wiMaps: { byKey: new Map([['A1', WI]]), idToKey: new Map([['wi-1', 'A1']]), byId: new Map([['wi-1', WI]]) },
  saveMarkup: vi.fn(async (d) => d || null),
  ...over,
})
const demoCtx = (over = {}) => ctx({ dbMode: false, isPersistedProject: false, currentProject: null, ...over })
const mount = (c = ctx(), siteLogs = []) => renderHook(() => useQualitySlice(c, siteLogs))

beforeEach(() => {
  pg.reset()
  loadQualityFromDB.mockClear(); loadQualityFromDB.mockResolvedValue({ inspections: [], defects: [] })
  loadDefectsFromDB.mockClear(); loadDefectsFromDB.mockResolvedValue([])
})

describe('查驗判定與自主檢查紀錄只由文件簽署寫入(P6b-3)', () => {
  it('slice 不再暴露快速判定與直接登錄／刪除檢查紀錄的寫入函式', () => {
    const r = mount()
    expect(r.current.recordInspectionResult).toBeUndefined()
    expect(r.current.createChecklistRecord).toBeUndefined()
    expect(r.current.deleteChecklistRecord).toBeUndefined()
  })
})

describe('自主檢查表範本:內建範本首次使用才落 DB(自主檢查表文件掛本案範本 id)', () => {
  it('內建範本首次使用 → 落 DB 並加入本案範本清單,回落庫後的範本', async () => {
    const r = mount()
    pg.script('checklist_templates', 'insert', { data: { id: 'tpl-db', title: TEMPLATE.title, source: '03310' }, error: null })
    let res
    await act(async () => { res = await r.current.ensureChecklistTemplate({ ...TEMPLATE, builtin: true }) })
    expect(res).toMatchObject({ error: null, template: { id: 'tpl-db' } })
    expect(pg.argsOf('checklist_templates', 'insert')[0][0]).toMatchObject({ project_id: 'p1', title: TEMPLATE.title, source: '03310', created_by: 'u1' })
    expect(r.current.checklistTemplates.map((t) => t.id)).toContain('tpl-db')
  })

  it('範本落庫失敗 → 回錯誤(文件不可掛到不存在的 template_id);已在 DB 的範本原樣回傳、不寫', async () => {
    const r = mount()
    pg.script('checklist_templates', 'insert', { data: null, error: { message: 'denied' } })
    let res
    await act(async () => { res = await r.current.ensureChecklistTemplate({ ...TEMPLATE, builtin: true }) })
    expect(res.error.message).toBe('denied')
    pg.reset()
    await act(async () => { res = await r.current.ensureChecklistTemplate(TEMPLATE) })
    expect(res).toEqual({ error: null, template: TEMPLATE })
    expect(pg.hit('checklist_templates', 'insert')).toBe(false)
  })
})

describe('取樣試驗:28 天不合格必須自動開嚴重缺失', () => {
  it('建立試體 → 由取樣日推 7/28 天到期日、狀態待試驗', async () => {
    const r = mount()
    pg.script('test_samples', 'insert', { data: [{ id: 'ts-1', sampled_date: '2026-09-01' }], error: null })
    await act(async () => { await r.current.createTestSamples([{ sampled_date: '2026-09-01', fc: 280 }]) })
    expect(pg.argsOf('test_samples', 'insert')[0][0][0]).toMatchObject({
      sampled_date: '2026-09-01', d7_due: '2026-09-08', d28_due: '2026-09-29', status: '待試驗', cylinders: 6,
    })
  })

  it('demo:填 28 天值判不合格 → 立刻開一筆「嚴重」缺失並掛 test_sample_id', async () => {
    const r = mount(demoCtx())
    await act(async () => { r.current.setTestSamples([{ id: 'ts-1', sample_no: 'TS-20260901', fc: 280, d28_values: null, status: '待試驗' }]) })
    await act(async () => { await r.current.updateTestSample('ts-1', { d28_values: [200, 210, 205] }) })
    expect(r.current.testSamples[0].status).toBe('不合格')
    expect(r.current.defects[0]).toMatchObject({ severity: '嚴重', test_sample_id: 'ts-1' })
    expect(r.current.defects[0].title).toContain('TS-20260901')
  })

  it('demo:同一組試體不得開第二筆缺失(與 DB 的唯一索引同規則)', async () => {
    const r = mount(demoCtx())
    await act(async () => {
      r.current.setTestSamples([{ id: 'ts-1', sample_no: 'TS-1', fc: 280, status: '待試驗' }])
      r.current.setDefects([{ id: 'DEF-old', test_sample_id: 'ts-1', status: '已結案' }])
    })
    await act(async () => { await r.current.updateTestSample('ts-1', { d28_values: [200, 210, 205] }) })
    expect(r.current.defects.filter((d) => d.test_sample_id === 'ts-1')).toHaveLength(1)
  })

  it('真專案:只寫值,判定與自動開缺失交給 DB trigger,寫完才重載', async () => {
    const r = mount()
    await act(async () => { await r.current.updateTestSample('ts-1', { d28_values: [300, 310, 305] }) })
    expect(pg.argsOf('test_samples', 'update')[0][0]).toEqual({ d28_values: [300, 310, 305] })
    expect(pg.hit('defects', 'insert')).toBe(false)
    expect(loadQualityFromDB).toHaveBeenCalled()
  })

  it('真專案寫值被靜默擋下 → 回失敗且不重載(重載會把使用者輸入洗掉)', async () => {
    const r = mount()
    pg.script('test_samples', 'update', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.updateTestSample('ts-1', { d28_values: [300] }) })
    expect(res.error.message).toContain('試驗值未寫入')
    expect(loadQualityFromDB).not.toHaveBeenCalled()
  })

  it('刪除已判定試體被 guard 擋下 → 不可從畫面消失', async () => {
    const r = mount()
    await act(async () => { r.current.setTestSamples([{ id: 'ts-1', sample_no: 'TS-1' }]) })
    pg.script('test_samples', 'delete', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.deleteTestSample('ts-1') })
    expect(res.error.message).toContain('試體已判定或無權限')
    expect(r.current.testSamples).toHaveLength(1)
  })
})

describe('缺失與查驗:被 guard 擋下不可假消失(B-07)', () => {
  it('缺失改狀態為已結案 → 蓋 closed_at 並帶上撤銷理由欄位', async () => {
    const r = mount()
    await act(async () => { await r.current.updateDefectStatus('def-1', '已結案', { improvement_note: '已重新綁紮' }) })
    const patch = pg.argsOf('defects', 'update')[0][0]
    expect(patch).toMatchObject({ status: '已結案', improvement_note: '已重新綁紮' })
    expect(patch.closed_at).toBeTruthy()
    expect(loadDefectsFromDB).toHaveBeenCalled()
  })

  it('缺失改狀態被靜默擋下 → 回失敗且不重載', async () => {
    const r = mount()
    pg.script('defects', 'update', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.updateDefectStatus('def-1', '已結案') })
    expect(res.error.message).toContain('未寫入')
    expect(loadDefectsFromDB).not.toHaveBeenCalled()
  })

  it('刪除已結案缺失被擋 → 仍在清單上', async () => {
    const r = mount()
    await act(async () => { r.current.setDefects([{ id: 'def-1', title: '保護層不足' }]) })
    pg.script('defects', 'delete', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.deleteDefect('def-1') })
    expect(res.error.message).toContain('刪除被拒絕')
    expect(r.current.defects).toHaveLength(1)
  })

  it('刪除已判定查驗被擋 → 仍在清單上,且不觸發重載', async () => {
    const r = mount()
    await act(async () => { r.current.setInspections([{ id: 'in1', title: '基礎鋼筋查驗' }]) })
    pg.script('inspections', 'delete', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.deleteInspection('in1') })
    expect(res.error.message).toContain('查驗已判定或無權限')
    expect(r.current.inspections).toHaveLength(1)
    expect(loadQualityFromDB).not.toHaveBeenCalled()
  })

  it('工安缺失在匯標單前(dbMode=false、isPersistedProject=true)也要進 DB', async () => {
    const r = mount(ctx({ dbMode: false }))
    await act(async () => { await r.current.createDefect({ domain: 'safety', title: '未戴安全帽' }) })
    expect(pg.argsOf('defects', 'insert')[0][0]).toMatchObject({ domain: 'safety', project_id: 'p1', status: '開立' })
  })
})

describe('ITP 停留點:連結建立失敗不得留下半套狀態', () => {
  const point = { id: 'pt-1', title: '鋼筋綁紮完成查驗', work_item_id: 'wi-1', work_item_no: '1' }

  it('申請成功 → 建查驗並把 inspection_id 回寫停留點(狀態自此由查驗推導)', async () => {
    const r = mount()
    await act(async () => { r.current.setInspectionPoints([point]) })
    let res
    await act(async () => { res = await r.current.requestInspectionForPoint(point) })
    expect(res.error).toBeNull()
    const inspRow = pg.argsOf('inspections', 'insert')[0][0]
    expect(inspRow).toMatchObject({ inspection_type: '停留點查驗', status: '待查驗', work_item_id: 'wi-1' })
    expect(pg.argsOf('inspection_points', 'update')[0][0]).toEqual({ inspection_id: inspRow.id })
    expect(r.current.inspectionPoints[0].inspection_id).toBe(inspRow.id)
  })

  it('建查驗失敗 → 停留點不得掛上 inspection_id(否則顯示成已申請卻查無此查驗)', async () => {
    const r = mount()
    await act(async () => { r.current.setInspectionPoints([point]) })
    pg.script('inspections', 'insert', { data: null, error: { message: 'denied' } })
    let res
    await act(async () => { res = await r.current.requestInspectionForPoint(point) })
    expect(res.error.message).toBe('denied')
    expect(pg.hit('inspection_points', 'update')).toBe(false)
    expect(r.current.inspectionPoints[0].inspection_id).toBeUndefined()
  })

  it('回寫連結失敗 → 如實回報,不把停留點標成已申請', async () => {
    const r = mount()
    await act(async () => { r.current.setInspectionPoints([point]) })
    pg.script('inspection_points', 'update', { data: null, error: { message: 'denied' } })
    let res
    await act(async () => { res = await r.current.requestInspectionForPoint(point) })
    expect(res.error.message).toBe('denied')
    expect(r.current.inspectionPoints[0].inspection_id).toBeUndefined()
  })

  it('刪除停留點被靜默擋下 → 不可假消失', async () => {
    const r = mount()
    await act(async () => { r.current.setInspectionPoints([point]) })
    pg.script('inspection_points', 'delete', SILENT_ZERO_ROWS)
    let res
    await act(async () => { res = await r.current.deleteInspectionPoint('pt-1') })
    expect(res.error.message).toContain('刪除被拒絕')
    expect(r.current.inspectionPoints).toHaveLength(1)
  })
})

describe('內建範本清單', () => {
  it('尚無同源專案範本時露出內建 03310(標成 builtin,首次使用才落 DB)', () => {
    const r = mount()
    expect(r.current.allChecklistTemplates.some((t) => t.builtin)).toBe(true)
  })

  it('已有同源專案範本 → 不再重複露出內建版(避免兩張同名範本)', async () => {
    const r = mount()
    const source = r.current.allChecklistTemplates.find((t) => t.builtin).source
    await act(async () => { r.current.setChecklistTemplates([{ id: 'tpl-db', title: '自主檢查', source }]) })
    expect(r.current.allChecklistTemplates).toHaveLength(1)
    expect(r.current.allChecklistTemplates[0].id).toBe('tpl-db')
  })
})
