// 關鍵工項與停留點的檢視模型(P5d):履約時程的關鍵工項與停留點事項(逐工項排程頁 P6b 已移除)。
// 釘住:落後判定(與退場前的逐工項排程頁一字不差)、完成% 的分母是契約數量、停留點該叫驗的紅黃
// 與 lib/itp.js 同一條規則、時程事項的形狀(id 前綴、五色語意、到期日=計畫迄／掛工項的計畫迄)。
import { describe, it, expect } from 'vitest'
import {
  deriveWorkItemState, buildKeyWorkItems, keyWorkItemCounts, buildHoldPoints, holdPointCounts,
  buildWorkItemEntry, buildHoldPointEntry, workItemEntryId, holdPointEntryId, WORK_ITEM_TYPE, HOLD_POINT_TYPE,
} from './keyWorkItems.js'

const TODAY = new Date(2026, 8, 19) // 2026-09-19

describe('關鍵工項狀態(與退場前的排程頁同一條規則)', () => {
  it('完成% ≥ 99.99 → 已完成;今天過計畫迄 → 落後;起迄之間 → 進行中;未到起日 → 未開始;沒排 → 未排定', () => {
    expect(deriveWorkItemState({ planned_start: '2026-01-01', planned_finish: '2026-02-01' }, 100, TODAY)).toMatchObject({ key: 'done', status: 'done' })
    expect(deriveWorkItemState({ planned_start: '2026-01-01', planned_finish: '2026-02-01' }, 40, TODAY)).toMatchObject({ key: 'late', label: '落後', status: 'overdue', tone: 'red' })
    expect(deriveWorkItemState({ planned_start: '2026-09-01', planned_finish: '2026-10-01' }, 40, TODAY)).toMatchObject({ key: 'doing', status: 'scheduled' })
    expect(deriveWorkItemState({ planned_start: '2026-10-01', planned_finish: null }, 0, TODAY)).toMatchObject({ key: 'pending', status: 'scheduled' })
    expect(deriveWorkItemState({ planned_start: null, planned_finish: null }, 0, TODAY)).toMatchObject({ key: 'noplan', status: 'na' })
    // 只有計畫迄、今天還沒到 → 沒有起日不能算進行中,也不是未開始:未排定(起日缺)
    expect(deriveWorkItemState({ planned_finish: '2026-12-31' }, 10, TODAY).key).toBe('noplan')
  })
})

const items = [
  { item_key: 'A', item_no: '1.1', description: '鋼筋', unit: 'T', quantity: 100, is_billable: true },
  { item_key: 'B', item_no: '1.2', description: '模板', unit: 'M2', quantity: 0, is_billable: true },
  { item_key: 'C', item_no: '1.3', description: '混凝土', unit: 'M3', quantity: 50, is_billable: true },
]
const schedules = {
  C: { planned_start: '2026-09-10', planned_finish: '2026-10-10' },
  A: { planned_start: '2026-01-01', planned_finish: '2026-03-01' },
  B: { planned_start: null, planned_finish: null },
}
const valuations = [{ items: { A: 10 } }, { items: { A: 60, C: 50 } }]

describe('關鍵工項列', () => {
  it('依計畫起日排序;完成% = 最新一期估驗累計 ÷ 契約數量(封頂 100、分母 0 → 0);查不到工項不炸', () => {
    const rows = buildKeyWorkItems({ itemSchedules: { ...schedules, Z: { planned_start: '2026-05-01' } }, adjustedItems: items, valuations, today: TODAY })
    expect(rows.map((r) => r.key)).toEqual(['B', 'A', 'Z', 'C']) // 空起日排最前(字串比較),其餘依起日
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.A).toMatchObject({ pct: 60, cumQty: 60, state: { key: 'late' } })
    expect(byKey.C).toMatchObject({ pct: 100, state: { key: 'done' } })
    expect(byKey.B).toMatchObject({ pct: 0, state: { key: 'noplan' } })
    expect(byKey.Z.it).toEqual({})
    expect(byKey.Z.state.key).toBe('doing') // 起日已過、沒有迄日:進行中
    expect(keyWorkItemCounts(rows)).toEqual({ total: 4, late: 1, doing: 1, done: 1, pending: 0, noplan: 1 })
  })
  it('沒有估驗時完成% 為 0;沒有排程時空清單', () => {
    expect(buildKeyWorkItems({ itemSchedules: { A: schedules.A }, adjustedItems: items, valuations: [], today: TODAY })[0].pct).toBe(0)
    expect(buildKeyWorkItems({})).toEqual([])
  })
})

describe('停留點(狀態與 /itp 同一條規則)', () => {
  const inspections = [{ id: 'I1', title: '鋼筋查驗', status: '待查驗' }, { id: 'I2', title: '模板查驗', status: '合格' }, { id: 'I3', title: '澆置查驗', status: '不合格' }]
  const siteLogs = [{ items: { A: 5, C: 0 } }]
  const points = [
    { id: 'P1', point_type: 'H', title: 'H 施作中未叫驗', work_item_key: 'A', inspection_id: null },
    { id: 'P2', point_type: 'W', title: 'W 施作中應見證', work_item_key: 'A', inspection_id: null },
    { id: 'P3', point_type: 'R', title: 'R 文審不算叫驗', work_item_key: 'A', inspection_id: null },
    { id: 'P4', point_type: 'H', title: '未施作', work_item_key: 'C', inspection_id: null },
    { id: 'P5', point_type: 'H', title: '已申請', work_item_key: 'A', inspection_id: 'I1' },
    { id: 'P6', point_type: 'H', title: '通過', work_item_key: 'A', inspection_id: 'I2' },
    { id: 'P7', point_type: 'H', title: '不通過', work_item_key: null, inspection_id: 'I3' },
  ]
  it('六種狀態的色鍵、五色語意與現在該動的一方', () => {
    const rows = buildHoldPoints({ inspectionPoints: points, inspections, siteLogs, itemSchedules: schedules })
    expect(rows.map((r) => [r.point.id, r.state.key, r.state.status, r.state.who])).toEqual([
      ['P1', 'hot_h', 'overdue', '廠商'], ['P2', 'hot_w', 'due', '廠商'], ['P3', 'pending', 'scheduled', '廠商'],
      ['P4', 'pending', 'scheduled', '廠商'], ['P5', 'requested', 'scheduled', '監造'], ['P6', 'passed', 'done', null], ['P7', 'failed', 'overdue', '廠商'],
    ])
    expect(rows[0].schedule).toEqual(schedules.A)
    expect(rows[6].schedule).toBeNull()
    expect(rows[4].inspection.title).toBe('鋼筋查驗')
    expect(holdPointCounts(rows)).toEqual({ total: 7, hot: 2, requested: 1, failed: 1 })
  })
})

describe('時程事項的形狀(與契約義務同一條清單)', () => {
  it('關鍵工項:id 前綴 wi:、責任方廠商、到期=計畫迄、進行中算 inProgress、搜尋文字含工項與狀態', () => {
    const row = buildKeyWorkItems({ itemSchedules: { A: schedules.A }, adjustedItems: items, valuations, today: TODAY })[0]
    const e = buildWorkItemEntry(row, { anchors: { commencement_date: '2026-01-01' }, today: TODAY })
    expect(e).toMatchObject({
      id: workItemEntryId('A'), entryKind: 'work_item', who: '廠商', status: 'overdue', statusLabel: '落後', tone: 'red',
      dateLabel: '2026-03-01', type: WORK_ITEM_TYPE, title: '1.1 鋼筋', setup: [], recurring: false, inProgress: false,
      planned: { start: '2026-01-01', finish: '2026-03-01' }, pct: 60,
    })
    expect(e.diff).toBeLessThan(0)
    expect(e.countdown).toMatch(/^逾期 \d+ 日$/)
    expect(e.searchText).toContain('鋼筋')
    expect(e.searchText).toContain('落後')
    const doing = buildWorkItemEntry({ ...row, sch: { planned_start: '2026-09-01', planned_finish: '2026-12-01' }, state: deriveWorkItemState({ planned_start: '2026-09-01', planned_finish: '2026-12-01' }, 60, TODAY) }, { today: TODAY })
    expect(doing).toMatchObject({ status: 'scheduled', statusLabel: '進行中', inProgress: true })
    const none = buildWorkItemEntry({ ...row, sch: {}, state: deriveWorkItemState({}, 60, TODAY) }, { today: TODAY })
    expect(none).toMatchObject({ status: 'na', dateLabel: '—', countdown: '計畫迄未定', diff: null })
  })
  it('停留點:id 前綴 itp:、到期=掛工項的計畫迄(沒掛就無到期日)、該叫驗的倒數欄講狀態而不是天數', () => {
    const rows = buildHoldPoints({
      inspectionPoints: [{ id: 'P1', point_type: 'H', title: '鋼筋停留點', work_item_key: 'A', work_item_no: '1.1', work_item_desc: '鋼筋', frequency: '每層', inspection_id: null }, { id: 'P2', point_type: 'R', title: '文審', work_item_key: null, inspection_id: null }],
      inspections: [], siteLogs: [{ items: { A: 1 } }], itemSchedules: { A: schedules.A },
    })
    const hot = buildHoldPointEntry(rows[0], { today: TODAY })
    expect(hot).toMatchObject({ id: holdPointEntryId('P1'), entryKind: 'hold_point', who: '廠商', status: 'overdue', statusLabel: '施作中未申請查驗', type: HOLD_POINT_TYPE, kind: 'H 停留點', dateLabel: '2026-03-01', inProgress: true, countdown: '施作中未申請查驗' })
    expect(hot.searchText).toContain('1.1 鋼筋'.toLowerCase())
    const doc = buildHoldPointEntry(rows[1], { today: TODAY })
    expect(doc).toMatchObject({ who: '廠商', status: 'scheduled', dateLabel: '—', countdown: '依工項施作', inProgress: false, diff: null })
  })
})
