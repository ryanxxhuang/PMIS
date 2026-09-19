// 關鍵工項與停留點的檢視模型(P5d:逐工項排程頁退場,日期承接到履約時程)。
// 資料不搬表:關鍵工項的計畫起迄仍是 item_schedules(store itemSchedules),停留點仍是
// inspection_points;這裡只把「哪一項落後／進行中」「哪個停留點該叫驗」算成與契約義務同一條
// 時間軸能讀的事項。/schedule(唯讀歷史查閱)與 /requirements 都吃這一份——以前落後判定
// 只住在 Schedule.jsx 裡,承接時再抄一份就會分岔。
import { parseLocalDate, localISODate } from './dates.js'
import { itpStatus, itpActivity, POINT_TYPES } from './itp.js'
import { countdownLabel, phaseOf } from './obligationTimeline.js'

const today0 = (base) => { const d = base ? new Date(base) : new Date(); d.setHours(0, 0, 0, 0); return d }

// 關鍵工項狀態:依計畫起迄＋完成% 推導。tone 回 Badge 的語意色鍵;status 是時程的五色語意
// (與 OB_STATUS 同鍵:落後=overdue、進行中／未開始=scheduled、已完成=done、未排定=na),
// 讓契約義務、關鍵工項、停留點在同一份快篩與色點上可比。
export const WORK_ITEM_STATES = Object.freeze({
  done: { label: '已完成', tone: 'green', status: 'done' },
  late: { label: '落後', tone: 'red', status: 'overdue' },
  doing: { label: '進行中', tone: 'blue', status: 'scheduled' },
  pending: { label: '未開始', tone: 'slate', status: 'scheduled' },
  noplan: { label: '未排定', tone: 'slate', status: 'na' },
})
export function deriveWorkItemState(sch, pct, today) {
  const pick = (key) => ({ key, ...WORK_ITEM_STATES[key] })
  if (pct >= 99.99) return pick('done')
  const t = today0(today), end = parseLocalDate(sch?.planned_finish), start = parseLocalDate(sch?.planned_start)
  if (end && t > end) return pick('late')
  if (start && t >= start) return pick('doing')
  if (start && t < start) return pick('pending')
  return pick('noplan')
}

// 完成% 的分子:最新一期估驗的累計完成數量({ item_key: cum_qty })
export const latestCumQty = (valuations = []) => valuations[valuations.length - 1]?.items || {}

// 關鍵工項列:每個有排程的工項一列(依計畫起日排序)。吃 adjustedItems 而非原始 workItems
// (財務單一真相層 B-02):完成% 的分母是契約數量,核准追加減後不用變更後數量,追加的工項會被
// 誤判「已完成」、追減的永遠到不了 100%,落後判斷跟估驗頁分裂。
export function buildKeyWorkItems({ itemSchedules = {}, adjustedItems = [], valuations = [], today } = {}) {
  const byKey = new Map(adjustedItems.map((it) => [it.item_key, it]))
  const cum = latestCumQty(valuations)
  return Object.keys(itemSchedules).map((key) => {
    const it = byKey.get(key) || {}
    const q = it.quantity || 0
    const done = cum[key] || 0
    const pct = q > 0 ? Math.min(100, (done / q) * 100) : 0
    const sch = itemSchedules[key] || {}
    return { key, it, sch, pct, cumQty: done, state: deriveWorkItemState(sch, pct, today) }
  }).sort((a, b) => (a.sch.planned_start || '').localeCompare(b.sch.planned_start || ''))
}

export function keyWorkItemCounts(rows) {
  const c = { total: rows.length, late: 0, doing: 0, done: 0, pending: 0, noplan: 0 }
  for (const r of rows) c[r.state.key]++
  return c
}

// 停留點狀態:由連結查驗推導(lib/itp.js),再加「施作中未叫驗」(H 不得續作=紅、W 應通知見證=黃)。
// who 是現在該動的一方(申請查驗／改善=廠商,判定=監造);通過就沒有人要動。
export const HOLD_POINT_STATES = Object.freeze({
  hot_h: { label: '施作中未申請查驗', tone: 'red', status: 'overdue', who: '廠商' },
  hot_w: { label: '施作中應通知見證', tone: 'amber', status: 'due', who: '廠商' },
  pending: { label: '未申請查驗', tone: 'slate', status: 'scheduled', who: '廠商' },
  requested: { label: '已申請，待監造查驗', tone: 'blue', status: 'scheduled', who: '監造' },
  passed: { label: '通過', tone: 'green', status: 'done', who: null },
  failed: { label: '不通過', tone: 'red', status: 'overdue', who: '廠商' },
})
export function buildHoldPoints({ inspectionPoints = [], inspections = [], siteLogs = [], itemSchedules = {} } = {}) {
  return inspectionPoints.map((p) => {
    const st = itpStatus(p, inspections)
    const active = itpActivity(p, siteLogs)
    const hot = st.key === 'pending' && active && p.point_type !== 'R'
    const key = hot ? (p.point_type === 'H' ? 'hot_h' : 'hot_w') : st.key
    const inspection = p.inspection_id ? inspections.find((i) => i.id === p.inspection_id) || null : null
    const schedule = p.work_item_key ? itemSchedules[p.work_item_key] || null : null
    return { point: p, st, active, hot, inspection, schedule, state: { key, ...HOLD_POINT_STATES[key] }, typeLabel: POINT_TYPES[p.point_type]?.label || p.point_type }
  })
}

export function holdPointCounts(rows) {
  return { total: rows.length, hot: rows.filter((r) => r.hot).length, requested: rows.filter((r) => r.st.key === 'requested').length, failed: rows.filter((r) => r.st.key === 'failed').length }
}

// ── 時程事項(與契約義務同一條清單的形狀,見 obligationTimeline.buildTimelineItem)────────
// 關鍵工項:到期日=計畫迄;誰的事=廠商(內部規劃);進行中的一律算近期(inProgress)。
export const WORK_ITEM_TYPE = '關鍵工項'
export const HOLD_POINT_TYPE = '停留點'
export const workItemEntryId = (key) => `wi:${key}`
export const holdPointEntryId = (id) => `itp:${id}`

const diffDays = (due, today) => (due ? Math.round((due - today0(today)) / 86400000) : null)

export function buildWorkItemEntry(row, { anchors, today } = {}) {
  const due = parseLocalDate(row.sch?.planned_finish)
  const start = parseLocalDate(row.sch?.planned_start)
  const status = row.state.status
  const diff = status === 'done' ? null : diffDays(due, today)
  const title = `${row.it.item_no ? `${row.it.item_no} ` : ''}${row.it.description || row.key}`
  const entry = {
    id: workItemEntryId(row.key), entryKind: 'work_item', row,
    who: '廠商', status, statusLabel: row.state.label, tone: row.state.tone,
    due, diff, phase: phaseOf({ category: '施工中' }, due, anchors),
    dateLabel: due ? localISODate(due) : '—',
    countdown: status === 'done' ? '已完成' : due ? countdownLabel(status, diff) : '計畫迄未定',
    title, desc: '', type: WORK_ITEM_TYPE, kind: '', recurring: false, periods: [], setup: [],
    inProgress: row.state.key === 'doing',
    onTime: null, completedAt: null,
    planned: { start: start ? localISODate(start) : '', finish: due ? localISODate(due) : '' },
    pct: row.pct,
  }
  entry.searchText = [title, row.it.unit, WORK_ITEM_TYPE, row.state.label, entry.planned.start, entry.planned.finish].filter(Boolean).join(' ').toLowerCase()
  return entry
}

// 停留點:到期日=掛的工項計畫迄(有排程才有),沒有就無到期日;「該叫驗」的紅黃由施作事實決定、不看日期。
export function buildHoldPointEntry(row, { anchors, today } = {}) {
  const due = parseLocalDate(row.schedule?.planned_finish)
  const status = row.state.status
  const diff = status === 'done' ? null : diffDays(due, today)
  const p = row.point
  const entry = {
    id: holdPointEntryId(p.id), entryKind: 'hold_point', row,
    who: row.state.who, status, statusLabel: row.state.label, tone: row.state.tone,
    due, diff, phase: phaseOf({ category: '施工中' }, due, anchors),
    dateLabel: due ? localISODate(due) : '—',
    countdown: status === 'done' ? row.state.label : row.hot ? row.state.label : due ? countdownLabel(status, diff) : '依工項施作',
    title: p.title, desc: p.acceptance_criteria || '', type: HOLD_POINT_TYPE, kind: row.typeLabel,
    recurring: false, periods: [], setup: [],
    inProgress: row.hot || row.st.key === 'requested' || row.st.key === 'failed',
    onTime: null, completedAt: null,
  }
  entry.searchText = [p.title, row.typeLabel, p.work_item_no, p.work_item_desc, p.acceptance_criteria, p.frequency, p.source_clause, HOLD_POINT_TYPE, row.state.label]
    .filter(Boolean).join(' ').toLowerCase()
  return entry
}
