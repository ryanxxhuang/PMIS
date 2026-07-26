// 測試用的假 PostgREST:重點是「會在 max_rows 截斷」,而且截斷時不回錯誤。
// 這正是正式環境咬人的行為——沒有這個替身,分頁的迴歸測試等於沒測到東西。
export const MAX_ROWS = 1000

export function createFakePostgrest() {
  const state = {
    tables: {},   // { [table]: rows[] } 或塞 Error 模擬查詢失敗
    requests: [], // 每次實際送出的請求(用來斷言有分頁、.in() 有分批)
  }

  // 依 orders 逐鍵比較,模擬 PostgREST 的多欄排序
  const sortRows = (rows, orders) => [...rows].sort((a, b) => {
    for (const [col, dir] of orders) {
      const x = a[col], y = b[col]
      if (x === y) continue
      return (x > y ? 1 : -1) * dir
    }
    return 0
  })

  function runQuery(q) {
    const src = state.tables[q.table]
    if (src instanceof Error) return { data: null, error: { message: src.message } }
    let rows = (src || []).filter((r) => q.filters.every((f) => f(r)))
    rows = sortRows(rows, q.orders)
    const from = q.from ?? 0
    const to = q.to == null ? rows.length - 1 : q.to
    // 關鍵:即使 range 要更多,伺服器最多只給 MAX_ROWS 筆,而且不當成錯誤
    const page = rows.slice(from, to + 1).slice(0, MAX_ROWS)
    state.requests.push({ table: q.table, from, to, inSize: q.inSize ?? null, returned: page.length })
    return { data: page, error: null }
  }

  // supabase query builder 的最小替身:鏈式 + thenable
  function makeBuilder(table) {
    const q = { table, filters: [], orders: [], from: null, to: null, inSize: null }
    const api = {
      select: () => api,
      eq: (col, val) => { q.filters.push((r) => r[col] === val); return api },
      neq: (col, val) => { q.filters.push((r) => r[col] !== val); return api },
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

  return {
    supabase: { from: (table) => makeBuilder(table) },
    setTable(name, rows) { state.tables[name] = rows },
    reset() { state.tables = {}; state.requests = [] },
    get requests() { return state.requests },
    requestsFor(table) { return state.requests.filter((r) => r.table === table) },
  }
}

// 產 n 筆列,id 遞增可排序
export const uid = (prefix, i) => `${prefix}-${String(i).padStart(6, '0')}`
export const makeRows = (prefix, n, extra = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ id: uid(prefix, i), ...extra(i) }))
