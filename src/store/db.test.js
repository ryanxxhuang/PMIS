// db.js 分頁載入的迴歸測試。
// 這裡防的是「靜默截斷」:PostgREST 單次回傳有 max_rows(預設 1000)上限,超過不報錯、
// 也沒有任何提示,前端只會少拿資料——估驗累計少算、S 曲線失真、勾稽漏抓,畫面卻正常。
// 因此每個載入函式都要驗「超過 1000 筆時全部載入」。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakePostgrest, uid, makeRows } from '../testUtils/fakePostgrest.js'

const pg = createFakePostgrest()
vi.mock('../lib/supabase.js', () => ({ supabase: pg.supabase, isSupabaseConfigured: true }))

const {
  fetchAllWorkItems, loadValuationsFromDB, loadSiteLogsFromDB, loadQcFromDB,
  loadQualityFromDB, loadDefectsFromDB, loadItemSchedulesFromDB, loadChangeOrdersFromDB,
  loadObligationsFromDB, loadCostItemsFromDB, loadSafetyFromDB, loadItpFromDB,
  loadAcceptanceFromDB, loadScheduleFromDB,
  loadSubmittalsFromDB, loadRfisFromDB, loadObservationsFromDB,
} = await import('./db.js')

const PID = 'p1'
// 本專案的 n 筆列
const rows = (prefix, n, extra = () => ({})) =>
  makeRows(prefix, n, (i) => ({ project_id: PID, ...extra(i) }))

beforeEach(() => { pg.reset() })

describe('db.js 分頁載入:超過 PostgREST 單次上限時要全部取回', () => {
  it('fetchAllWorkItems 抓滿 2,500 筆標單工項(分 3 次請求)', async () => {
    pg.setTable('work_items', rows('wi', 2500, (i) => ({ item_key: `k${i}`, sort_order: i })))
    const got = await fetchAllWorkItems(PID)
    expect(got).toHaveLength(2500)
    expect(new Set(got.map((r) => r.id)).size).toBe(2500) // 無重複、無遺漏
    expect(got[0].sort_order).toBe(0)
    expect(got[2499].sort_order).toBe(2499)
    expect(pg.requestsFor('work_items')).toHaveLength(3) // 1000 + 1000 + 500
  })

  it('剛好 1,000 筆時會再抓一頁確認到底(不會少一筆也不會多)', async () => {
    pg.setTable('work_items', rows('wi', 1000, (i) => ({ sort_order: i })))
    expect(await fetchAllWorkItems(PID)).toHaveLength(1000)
    expect(pg.requestsFor('work_items')).toHaveLength(2) // 第 2 頁回 0 筆才知道抓完了
  })

  it('0 筆時只送一次請求', async () => {
    pg.setTable('work_items', [])
    expect(await fetchAllWorkItems(PID)).toEqual([])
    expect(pg.requestsFor('work_items')).toHaveLength(1)
  })

  it('loadItemSchedulesFromDB 抓滿 3,000 筆逐工項排程', async () => {
    pg.setTable('item_schedules', rows('is', 3000, (i) => ({
      work_item_id: uid('wi', i), planned_start: '2026-01-01', planned_finish: '2026-02-01',
    })))
    const idToKey = new Map(Array.from({ length: 3000 }, (_, i) => [uid('wi', i), `k${i}`]))
    const map = await loadItemSchedulesFromDB(PID, idToKey)
    expect(Object.keys(map)).toHaveLength(3000)
    expect(map.k2999).toEqual({ planned_start: '2026-01-01', planned_finish: '2026-02-01' })
  })

  it('loadValuationsFromDB 的估驗明細跨期別分批 + 分頁,累計數量不漏', async () => {
    // 3 期 × 1,200 工項 = 3,600 筆明細,遠超單次上限
    pg.setTable('valuations', rows('v', 3, (i) => ({ period_no: i + 1, retention_pct: 5, status: 'approved' })))
    const vItems = []
    for (let v = 0; v < 3; v++) {
      for (let i = 0; i < 1200; i++) {
        vItems.push({ id: uid(`vi${v}`, i), valuation_id: uid('v', v), work_item_id: uid('wi', i), cum_qty: i + v })
      }
    }
    pg.setTable('valuation_items', vItems)
    const idToKey = new Map(Array.from({ length: 1200 }, (_, i) => [uid('wi', i), `k${i}`]))
    const vals = await loadValuationsFromDB(PID, idToKey)
    expect(vals).toHaveLength(3)
    for (let v = 0; v < 3; v++) {
      expect(Object.keys(vals[v].items)).toHaveLength(1200)
      expect(vals[v].items.k1199).toBe(1199 + v) // 最後一筆也在
    }
  })

  it('loadSiteLogsFromDB 抓滿 1,200 篇日誌,明細分批查(每批 .in() 不超過 100 個 id)', async () => {
    pg.setTable('daily_logs', rows('dl', 1200, (i) => ({ log_date: `2026-${String((i % 12) + 1).padStart(2, '0')}-01` })))
    // 每篇日誌 2 筆明細 → 2,400 筆
    const items = []
    for (let l = 0; l < 1200; l++) {
      for (let j = 0; j < 2; j++) {
        items.push({ id: uid(`dli${l}`, j), daily_log_id: uid('dl', l), work_item_id: uid('wi', j), qty_today: l + j })
      }
    }
    pg.setTable('daily_log_items', items)
    const idToKey = new Map([[uid('wi', 0), 'kA'], [uid('wi', 1), 'kB']])
    const logs = await loadSiteLogsFromDB(PID, idToKey)
    expect(logs).toHaveLength(1200)
    // 每篇都拿到自己的兩筆明細(不是只有前 1,000 篇有)
    expect(logs.every((l) => Object.keys(l.items).length === 2)).toBe(true)
    expect(new Map(logs.map((l) => [l.id, l])).get(uid('dl', 1199)).items).toEqual({ kA: 1199, kB: 1200 })

    const itemReqs = pg.requestsFor('daily_log_items')
    expect(itemReqs).toHaveLength(12) // 1,200 個 id / 每批 100
    expect(Math.max(...itemReqs.map((r) => r.inSize))).toBeLessThanOrEqual(100)
  })

  it('loadChangeOrdersFromDB 的變更明細跨變更單分批載入', async () => {
    pg.setTable('change_orders', rows('co', 150, (i) => ({ sort_order: i, created_at: `2026-01-${i}` })))
    pg.setTable('change_order_items', rows('coi', 150, (i) => ({
      change_order_id: uid('co', i), sort_order: 0, created_at: 'x', amount_delta: i,
    })))
    const cos = await loadChangeOrdersFromDB(PID)
    expect(cos).toHaveLength(150)
    expect(cos.every((c) => c.items.length === 1)).toBe(true)
    expect(pg.requestsFor('change_order_items')).toHaveLength(2) // 150 個 id / 每批 100
  })

  it('loadQcFromDB 三張表各自分頁(試體 1,500 筆全拿)', async () => {
    pg.setTable('checklist_templates', rows('ct', 5, (i) => ({ created_at: `2026-01-0${i}` })))
    pg.setTable('checklist_records', rows('cr', 1100, () => ({ check_date: '2026-01-01' })))
    pg.setTable('test_samples', rows('ts', 1500, () => ({ sampled_date: '2026-01-01' })))
    const qc = await loadQcFromDB(PID)
    expect(qc.templates).toHaveLength(5)
    expect(qc.records).toHaveLength(1100)
    expect(qc.samples).toHaveLength(1500)
  })

  it('loadQualityFromDB 的查驗與缺失各自分頁,去正規化欄位不變', async () => {
    pg.setTable('inspections', rows('ins', 1300, () => ({ created_at: '2026-01-01', work_item_id: 'w1' })))
    pg.setTable('defects', rows('def', 1050, () => ({ created_at: '2026-01-01', work_item_id: 'w1' })))
    const byId = new Map([['w1', { item_no: '1.1', description: '鋼筋' }]])
    const q = await loadQualityFromDB(PID, byId)
    expect(q.inspections).toHaveLength(1300)
    expect(q.defects).toHaveLength(1050)
    expect(q.inspections[0].work_item_no).toBe('1.1') // 轉換邏輯不變
  })

  it('其餘專案層列表載入也都分頁(含協作三表)', async () => {
    pg.setTable('contract_obligations', rows('ob', 1200, (i) => ({ sort_order: i })))
    pg.setTable('cost_items', rows('ci', 1400, (i) => ({ sort_order: i, created_at: 'x' })))
    pg.setTable('safety_records', rows('sr', 1300, () => ({ record_date: '2026-01-01', created_at: 'x' })))
    pg.setTable('inspection_points', rows('ip', 1100, (i) => ({ sort_order: i, created_at: 'x', work_item_id: null })))
    pg.setTable('acceptance_events', rows('ae', 1010, () => ({ created_at: 'x' })))
    pg.setTable('schedule_periods', rows('sp', 1020, (i) => ({ period_label: `2026-${i}`, planned_pct: 1 })))
    pg.setTable('submittals', rows('sb', 1200, () => ({ created_at: 'x' })))
    pg.setTable('rfis', rows('rf', 1100, () => ({ created_at: 'x' })))
    pg.setTable('observations', rows('ob2', 1050, () => ({ created_at: 'x' })))

    expect(await loadObligationsFromDB(PID)).toHaveLength(1200)
    expect(await loadCostItemsFromDB(PID)).toHaveLength(1400)
    expect(await loadSafetyFromDB(PID)).toHaveLength(1300)
    expect(await loadItpFromDB(PID, new Map(), new Map())).toHaveLength(1100)
    expect(await loadAcceptanceFromDB(PID)).toHaveLength(1010)
    expect(await loadSubmittalsFromDB(PID)).toHaveLength(1200)
    expect(await loadRfisFromDB(PID)).toHaveLength(1100)
    expect(await loadObservationsFromDB(PID)).toHaveLength(1050)
    const sched = await loadScheduleFromDB({ project_id: PID, start_date: 'a', end_date: 'b' })
    expect(sched.months).toHaveLength(1020)
  })

  it('只回本專案的列(分頁不會把別案的資料一起撈進來)', async () => {
    pg.setTable('defects', [
      ...rows('def', 1200, () => ({ created_at: '2026-01-01' })),
      ...makeRows('other', 500, () => ({ project_id: 'p2', created_at: '2026-01-01' })),
    ])
    const got = await loadDefectsFromDB(PID)
    expect(got).toHaveLength(1200)
    expect(got.every((r) => r.project_id === PID)).toBe(true)
  })

  it('分頁途中查詢失敗仍往上拋(不會靜默回半份資料)', async () => {
    pg.setTable('defects', new Error('permission denied'))
    await expect(loadDefectsFromDB(PID)).rejects.toThrow(/缺失讀取失敗/)
  })
})
