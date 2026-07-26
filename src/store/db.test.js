// db.js 分頁載入的迴歸測試。
// 這裡防的是「靜默截斷」:PostgREST 單次回傳有 max_rows(預設 1000)上限,超過不報錯、
// 也沒有任何提示,前端只會少拿資料——估驗累計少算、S 曲線失真、勾稽漏抓,畫面卻正常。
// 因此每個載入函式都要驗「超過 1000 筆時全部載入」。
import { describe, it, expect, beforeEach, vi } from 'vitest'

const MAX_ROWS = 1000 // 模擬 PostgREST 的單次回傳上限

// 假表資料 + 每次請求的紀錄(用來斷言真的有分頁、.in() 有分批)
let tables = {}
let requests = []

// 依 orders 逐鍵比較,模擬 PostgREST 的多欄排序
function sortRows(rows, orders) {
  return [...rows].sort((a, b) => {
    for (const [col, dir] of orders) {
      const x = a[col], y = b[col]
      if (x === y) continue
      return (x > y ? 1 : -1) * dir
    }
    return 0
  })
}

function runQuery(q) {
  const src = tables[q.table]
  if (src instanceof Error) return { data: null, error: { message: src.message } }
  let rows = (src || []).filter((r) => q.filters.every((f) => f(r)))
  rows = sortRows(rows, q.orders)
  const from = q.from ?? 0
  const to = q.to == null ? rows.length - 1 : q.to
  // 關鍵:即使 range 要更多,伺服器最多只給 MAX_ROWS 筆
  const page = rows.slice(from, to + 1).slice(0, MAX_ROWS)
  requests.push({ table: q.table, from, to, inSize: q.inSize ?? null, returned: page.length })
  return { data: page, error: null }
}

// supabase query builder 的最小替身:鏈式 + thenable
function makeBuilder(table) {
  const q = { table, filters: [], orders: [], from: null, to: null, inSize: null }
  const api = {
    select: () => api,
    eq: (col, val) => { q.filters.push((r) => r[col] === val); return api },
    in: (col, vals) => {
      q.inSize = vals.length
      const set = new Set(vals)
      q.filters.push((r) => set.has(r[col]))
      return api
    },
    order: (col, opts) => { q.orders.push([col, opts?.ascending === false ? -1 : 1]); return api },
    range: (from, to) => { q.from = from; q.to = to; return api },
    then: (resolve, reject) => Promise.resolve(runQuery(q)).then(resolve, reject),
  }
  return api
}

vi.mock('../lib/supabase.js', () => ({
  supabase: { from: (table) => makeBuilder(table) },
  isSupabaseConfigured: true,
}))

const {
  fetchAllWorkItems, loadValuationsFromDB, loadSiteLogsFromDB, loadQcFromDB,
  loadQualityFromDB, loadDefectsFromDB, loadItemSchedulesFromDB, loadChangeOrdersFromDB,
  loadObligationsFromDB, loadCostItemsFromDB, loadSafetyFromDB, loadItpFromDB,
  loadAcceptanceFromDB, loadScheduleFromDB,
} = await import('./db.js')

const PID = 'p1'
const uid = (prefix, i) => `${prefix}-${String(i).padStart(6, '0')}`
// 產 n 筆列,id 遞增,project_id 固定
const rows = (prefix, n, extra = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ id: uid(prefix, i), project_id: PID, ...extra(i) }))

const reqsFor = (table) => requests.filter((r) => r.table === table)

beforeEach(() => { tables = {}; requests = [] })

describe('分頁載入:超過 PostgREST 單次上限時要全部取回', () => {
  it('fetchAllWorkItems 抓滿 2,500 筆標單工項(分 3 次請求)', async () => {
    tables.work_items = rows('wi', 2500, (i) => ({ item_key: `k${i}`, sort_order: i }))
    const got = await fetchAllWorkItems(PID)
    expect(got).toHaveLength(2500)
    expect(new Set(got.map((r) => r.id)).size).toBe(2500) // 無重複、無遺漏
    expect(got[0].sort_order).toBe(0)
    expect(got[2499].sort_order).toBe(2499)
    expect(reqsFor('work_items')).toHaveLength(3) // 1000 + 1000 + 500
  })

  it('剛好 1,000 筆時會再抓一頁確認到底(不會少一筆也不會多)', async () => {
    tables.work_items = rows('wi', 1000, (i) => ({ sort_order: i }))
    const got = await fetchAllWorkItems(PID)
    expect(got).toHaveLength(1000)
    expect(reqsFor('work_items')).toHaveLength(2) // 第 2 頁回 0 筆才知道抓完了
  })

  it('0 筆時只送一次請求', async () => {
    tables.work_items = []
    expect(await fetchAllWorkItems(PID)).toEqual([])
    expect(reqsFor('work_items')).toHaveLength(1)
  })

  it('loadItemSchedulesFromDB 抓滿 3,000 筆逐工項排程', async () => {
    tables.item_schedules = rows('is', 3000, (i) => ({
      work_item_id: uid('wi', i), planned_start: '2026-01-01', planned_finish: '2026-02-01',
    }))
    const idToKey = new Map(Array.from({ length: 3000 }, (_, i) => [uid('wi', i), `k${i}`]))
    const map = await loadItemSchedulesFromDB(PID, idToKey)
    expect(Object.keys(map)).toHaveLength(3000)
    expect(map.k2999).toEqual({ planned_start: '2026-01-01', planned_finish: '2026-02-01' })
  })

  it('loadValuationsFromDB 的估驗明細跨期別分批 + 分頁,累計數量不漏', async () => {
    // 3 期 × 1,200 工項 = 3,600 筆明細,遠超單次上限
    tables.valuations = rows('v', 3, (i) => ({ period_no: i + 1, retention_pct: 5, status: 'approved' }))
    tables.valuation_items = []
    for (let v = 0; v < 3; v++) {
      for (let i = 0; i < 1200; i++) {
        tables.valuation_items.push({
          id: uid(`vi${v}`, i), valuation_id: uid('v', v), work_item_id: uid('wi', i), cum_qty: i + v,
        })
      }
    }
    const idToKey = new Map(Array.from({ length: 1200 }, (_, i) => [uid('wi', i), `k${i}`]))
    const vals = await loadValuationsFromDB(PID, idToKey)
    expect(vals).toHaveLength(3)
    for (let v = 0; v < 3; v++) {
      expect(Object.keys(vals[v].items)).toHaveLength(1200)
      expect(vals[v].items.k1199).toBe(1199 + v) // 最後一筆也在
    }
  })

  it('loadSiteLogsFromDB 抓滿 1,200 篇日誌,明細分批查(每批 .in() 不超過 100 個 id)', async () => {
    tables.daily_logs = rows('dl', 1200, (i) => ({ log_date: `2026-${String((i % 12) + 1).padStart(2, '0')}-01` }))
    // 每篇日誌 2 筆明細 → 2,400 筆
    tables.daily_log_items = []
    for (let l = 0; l < 1200; l++) {
      for (let j = 0; j < 2; j++) {
        tables.daily_log_items.push({
          id: uid(`dli${l}`, j), daily_log_id: uid('dl', l), work_item_id: uid('wi', j), qty_today: l + j,
        })
      }
    }
    const idToKey = new Map([[uid('wi', 0), 'kA'], [uid('wi', 1), 'kB']])
    const logs = await loadSiteLogsFromDB(PID, idToKey)
    expect(logs).toHaveLength(1200)
    // 每篇都拿到自己的兩筆明細(不是只有前 1,000 篇有)
    expect(logs.every((l) => Object.keys(l.items).length === 2)).toBe(true)
    const byId = new Map(logs.map((l) => [l.id, l]))
    expect(byId.get(uid('dl', 1199)).items).toEqual({ kA: 1199, kB: 1200 })

    const itemReqs = reqsFor('daily_log_items')
    expect(itemReqs).toHaveLength(12) // 1,200 個 id / 每批 100
    expect(Math.max(...itemReqs.map((r) => r.inSize))).toBeLessThanOrEqual(100)
  })

  it('loadChangeOrdersFromDB 的變更明細跨變更單分批載入', async () => {
    tables.change_orders = rows('co', 150, (i) => ({ sort_order: i, created_at: `2026-01-${i}` }))
    tables.change_order_items = rows('coi', 150, (i) => ({
      change_order_id: uid('co', i), sort_order: 0, created_at: 'x', amount_delta: i,
    }))
    const cos = await loadChangeOrdersFromDB(PID)
    expect(cos).toHaveLength(150)
    expect(cos.every((c) => c.items.length === 1)).toBe(true)
    expect(reqsFor('change_order_items')).toHaveLength(2) // 150 個 id / 每批 100
  })

  it('loadQcFromDB 三張表各自分頁(試體 1,500 筆全拿)', async () => {
    tables.checklist_templates = rows('ct', 5, (i) => ({ created_at: `2026-01-0${i}` }))
    tables.checklist_records = rows('cr', 1100, (i) => ({ check_date: '2026-01-01' }))
    tables.test_samples = rows('ts', 1500, (i) => ({ sampled_date: '2026-01-01' }))
    const qc = await loadQcFromDB(PID)
    expect(qc.templates).toHaveLength(5)
    expect(qc.records).toHaveLength(1100)
    expect(qc.samples).toHaveLength(1500)
  })

  it('loadQualityFromDB 的查驗與缺失各自分頁', async () => {
    tables.inspections = rows('ins', 1300, () => ({ created_at: '2026-01-01', work_item_id: 'w1' }))
    tables.defects = rows('def', 1050, () => ({ created_at: '2026-01-01', work_item_id: 'w1' }))
    const byId = new Map([['w1', { item_no: '1.1', description: '鋼筋' }]])
    const q = await loadQualityFromDB(PID, byId)
    expect(q.inspections).toHaveLength(1300)
    expect(q.defects).toHaveLength(1050)
    expect(q.inspections[0].work_item_no).toBe('1.1') // 轉換邏輯不變
  })

  it('其餘專案層列表載入也都分頁', async () => {
    tables.contract_obligations = rows('ob', 1200, (i) => ({ sort_order: i }))
    tables.cost_items = rows('ci', 1400, (i) => ({ sort_order: i, created_at: 'x' }))
    tables.safety_records = rows('sr', 1300, () => ({ record_date: '2026-01-01', created_at: 'x' }))
    tables.inspection_points = rows('ip', 1100, (i) => ({ sort_order: i, created_at: 'x', work_item_id: null }))
    tables.acceptance_events = rows('ae', 1010, () => ({ created_at: 'x' }))
    tables.schedule_periods = rows('sp', 1020, (i) => ({ period_label: `2026-${i}`, planned_pct: 1 }))

    expect(await loadObligationsFromDB(PID)).toHaveLength(1200)
    expect(await loadCostItemsFromDB(PID)).toHaveLength(1400)
    expect(await loadSafetyFromDB(PID)).toHaveLength(1300)
    expect(await loadItpFromDB(PID, new Map(), new Map())).toHaveLength(1100)
    expect(await loadAcceptanceFromDB(PID)).toHaveLength(1010)
    const sched = await loadScheduleFromDB({ project_id: PID, start_date: 'a', end_date: 'b' })
    expect(sched.months).toHaveLength(1020)
  })

  it('只回本專案的列(分頁不會把別案的資料一起撈進來)', async () => {
    tables.defects = [
      ...rows('def', 1200, () => ({ created_at: '2026-01-01' })),
      ...Array.from({ length: 500 }, (_, i) => ({ id: uid('other', i), project_id: 'p2', created_at: '2026-01-01' })),
    ]
    const got = await loadDefectsFromDB(PID)
    expect(got).toHaveLength(1200)
    expect(got.every((r) => r.project_id === PID)).toBe(true)
  })

  it('分頁途中查詢失敗仍往上拋(不會靜默回半份資料)', async () => {
    tables.defects = new Error('permission denied')
    await expect(loadDefectsFromDB(PID)).rejects.toThrow(/缺失讀取失敗/)
  })
})
