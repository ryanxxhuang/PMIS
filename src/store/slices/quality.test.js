// @vitest-environment jsdom
// Quality slice(三級品管:查驗/缺失、自主檢查表、取樣試驗)零測試,但它藏著整個
// 產品最不能漏的連動——「不合格」必須變成一筆有人負責的缺失。這裡釘住的是:
//   1. 不合格判定的法定後果不可靜默消失:缺失 insert 失敗要回 defectError,
//      不能因為判定寫成功就當沒事(機關的「查驗↔缺失」勾稽會對不上);
//   2. 同一鏈上不重複開缺失(P1-07 修訂版次 + 唯一索引 23505 的兩條路徑);
//   3. B-07 假成功:已結案缺失/已判定查驗/已判定試體被 guard 擋下時不可假消失;
//   4. demo 與真 DB 的雙引擎不漂移(inspected_at、completed 類欄位兩邊都要寫)。
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
  log: vi.fn(), saveMarkup: vi.fn(async (d) => d || null),
  ...over,
})
const demoCtx = (over = {}) => ctx({ dbMode: false, isPersistedProject: false, currentProject: null, ...over })
const mount = (c = ctx(), siteLogs = []) => renderHook(() => useQualitySlice(c, siteLogs))

beforeEach(() => {
  pg.reset()
  loadQualityFromDB.mockClear(); loadQualityFromDB.mockResolvedValue({ inspections: [], defects: [] })
  loadDefectsFromDB.mockClear(); loadDefectsFromDB.mockResolvedValue([])
})

describe('監造查驗判定:不合格一定要留下一筆缺失', () => {
  const insp = { id: 'in1', title: '基礎鋼筋查驗', location: 'A 區', work_item_id: 'wi-1' }

  it('不合格 → 同時寫查驗結果與缺失,缺失掛回該次查驗(勾稽鏈)', async () => {
    const r = mount()
    let res
    await act(async () => { res = await r.current.recordInspectionResult(insp, false, '保護層不足') })
    expect(res.error).toBeNull()
    expect(res.defectError).toBeNull()
    expect(pg.argsOf('inspections', 'update')[0][0]).toMatchObject({ status: '不合格', result_note: '保護層不足' })
    expect(pg.argsOf('defects', 'insert')[0][0]).toMatchObject({
      inspection_id: 'in1', work_item_id: 'wi-1', status: '開立', title: '查驗不合格：基礎鋼筋查驗',
    })
  })

  it('合格 → 不得開缺失', async () => {
    const r = mount()
    await act(async () => { await r.current.recordInspectionResult(insp, true, null) })
    expect(pg.hit('defects', 'insert')).toBe(false)
  })

  it('缺失寫入失敗 → 判定仍算成功,但要用 defectError 如實回報(不可靜默吞掉)', async () => {
    const r = mount()
    pg.script('defects', 'insert', { data: null, error: { message: 'permission denied for table defects' } })
    let res
    await act(async () => { res = await r.current.recordInspectionResult(insp, false, '保護層不足') })
    expect(res.error).toBeNull()
    expect(res.defectError.message).toContain('permission denied')
  })

  it('查驗結果寫入失敗 → 不得繼續開缺失(判定都沒落地)', async () => {
    const r = mount()
    pg.script('inspections', 'update', { data: null, error: { message: 'timeout' } })
    let res
    await act(async () => { res = await r.current.recordInspectionResult(insp, false, 'x') })
    expect(res.error.message).toBe('timeout')
    expect(pg.hit('defects', 'insert')).toBe(false)
  })

  it('demo 也要寫 inspected_at(真後端看得到、demo 永遠空白=雙引擎漂移)', async () => {
    const r = mount(demoCtx())
    await act(async () => { r.current.setInspections([{ ...insp, status: '待查驗' }]) })
    await act(async () => { await r.current.recordInspectionResult(insp, false, '保護層不足') })
    expect(r.current.inspections[0].inspected_at).toBeTruthy()
    expect(r.current.defects[0].title).toBe('查驗不合格：基礎鋼筋查驗')
    expect(pg.calls).toHaveLength(0)
  })
})

describe('自主檢查表:不合格連動缺失,同一鏈不得重複開', () => {
  const fail = { '1': 12, '2': true }   // 模板垂直度 12mm > 5mm → 不合格
  const pass = { '1': 3, '2': true }

  it('不合格 → 開一筆缺失並掛在鏈根上,回 defectAction=created', async () => {
    const r = mount()
    pg.script('checklist_records', 'insert', { data: { id: 'rec-1', root_id: 'rec-1', rev: 0 }, error: null })
    let res
    await act(async () => {
      res = await r.current.createChecklistRecord({ template: TEMPLATE, check_date: '2026-09-11', location: 'A 區', values: fail })
    })
    expect(res.overall).toBe('不合格')
    expect(res.defectAction).toBe('created')
    expect(pg.argsOf('defects', 'insert')[0][0]).toMatchObject({ source_checklist_record_id: 'rec-1' })
    expect(pg.argsOf('defects', 'insert')[0][0].description).toContain('模板垂直度')
  })

  it('鏈上已有未結案缺失 → 不再開新的,回 linked', async () => {
    const r = mount()
    pg.script('checklist_records', 'insert', { data: { id: 'rec-2', root_id: 'rec-1', rev: 1 }, error: null })
    pg.script('defects', 'select', { data: [{ id: 'def-1', status: '開立' }], error: null })
    let res
    await act(async () => {
      res = await r.current.createChecklistRecord({ template: TEMPLATE, check_date: '2026-09-11', values: fail })
    })
    expect(res.defectAction).toBe('linked')
    expect(res.openDefectRemains).toBe(true)
    expect(pg.hit('defects', 'insert')).toBe(false)
  })

  it('並發下撞到唯一索引(23505)→ 視為已關聯,不當成錯誤丟給使用者', async () => {
    const r = mount()
    pg.script('checklist_records', 'insert', { data: { id: 'rec-3', root_id: 'rec-3', rev: 0 }, error: null })
    pg.script('defects', 'insert', { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
    let res
    await act(async () => {
      res = await r.current.createChecklistRecord({ template: TEMPLATE, check_date: '2026-09-11', values: fail })
    })
    expect(res.error).toBeNull()
    expect(res.defectAction).toBe('linked')
  })

  it('更正為合格 → 不動原缺失(結案是監造的權限),但要回報仍在追蹤', async () => {
    const r = mount()
    pg.script('checklist_records', 'insert', { data: { id: 'rec-4', root_id: 'rec-1', rev: 1 }, error: null })
    pg.script('defects', 'select', { data: [{ id: 'def-1', status: '改善中' }], error: null })
    let res
    await act(async () => {
      res = await r.current.createChecklistRecord({ template: TEMPLATE, check_date: '2026-09-12', values: pass, revises: { id: 'rec-1', rev: 0 }, revision_reason: '重新丈量' })
    })
    expect(res.overall).toBe('合格')
    expect(res.defectAction).toBeNull()
    expect(res.openDefectRemains).toBe(true)
    expect(pg.hit('defects', 'insert')).toBe(false)
  })

  it('內建範本首次使用 → 先把範本落 DB,紀錄才掛得到 template_id', async () => {
    const r = mount()
    pg.script('checklist_templates', 'insert', { data: { id: 'tpl-db', title: TEMPLATE.title, source: '03310' }, error: null })
    pg.script('checklist_records', 'insert', { data: { id: 'rec-5', root_id: 'rec-5', rev: 0 }, error: null })
    await act(async () => {
      await r.current.createChecklistRecord({ template: { ...TEMPLATE, builtin: true }, check_date: '2026-09-11', values: pass })
    })
    expect(pg.argsOf('checklist_records', 'insert')[0][0].template_id).toBe('tpl-db')
    expect(r.current.checklistTemplates.map((t) => t.id)).toContain('tpl-db')
  })

  it('範本落庫失敗 → 不建紀錄(不可掛到不存在的 template_id)', async () => {
    const r = mount()
    pg.script('checklist_templates', 'insert', { data: null, error: { message: 'denied' } })
    let res
    await act(async () => {
      res = await r.current.createChecklistRecord({ template: { ...TEMPLATE, builtin: true }, check_date: '2026-09-11', values: pass })
    })
    expect(res.error.message).toBe('denied')
    expect(pg.hit('checklist_records', 'insert')).toBe(false)
  })

  it('工項關聯:UI 傳 work_item_key → 換成 uuid 寫入(demo 另存 key 才顯示得出來)', async () => {
    const r = mount()
    pg.script('checklist_records', 'insert', { data: { id: 'rec-6', root_id: 'rec-6', rev: 0 }, error: null })
    await act(async () => {
      await r.current.createChecklistRecord({ template: TEMPLATE, check_date: '2026-09-11', values: pass, work_item_key: 'A1' })
    })
    expect(pg.argsOf('checklist_records', 'insert')[0][0].work_item_id).toBe('wi-1')
  })

  it('demo 修訂版次:rev+1、root_id 沿用鏈根、supersedes 指向被修訂那筆', async () => {
    const r = mount(demoCtx())
    await act(async () => {
      await r.current.createChecklistRecord({
        template: TEMPLATE, check_date: '2026-09-12', values: pass,
        revises: { id: 'CLR-1', rev: 1, root_id: 'CLR-0', work_item_id: 'wi-1', work_item_key: 'A1' },
        revision_reason: '重新丈量',
      })
    })
    expect(r.current.checklistRecords[0]).toMatchObject({
      rev: 2, root_id: 'CLR-0', supersedes_id: 'CLR-1', revision_reason: '重新丈量', work_item_key: 'A1',
    })
    expect(pg.calls).toHaveLength(0)
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
