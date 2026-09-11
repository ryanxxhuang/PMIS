// 可編劇本的 supabase 替身:slice 測試要問的不是「SQL 對不對」(那是 pgTAP 的事),
// 而是「DB 回這個結果時,前端快取有沒有被騙」——所以這支只要能做到兩件事:
//   1. 記錄每一次 from(table).op(args),讓「有沒有真的打 DB」「送了什麼」可斷言;
//   2. 讓測試指定某張表的某個動作回什麼(錯誤、或 RLS 靜默 0 列)。
//
// 用法(client 必須在 vi.mock 之前就存在,所以走 async vi.hoisted):
//   const { pg } = await vi.hoisted(async () => {
//     const { createScriptedSupabase } = await import('../../testUtils/scriptedSupabase.js')
//     return { pg: createScriptedSupabase() }
//   })
//   vi.mock('../../lib/supabase.js', () => configured(pg.client))
//
// 預設值刻意設成「成功寫到一列」:mutationOutcome 把「無 error 但 0 列」當失敗,
// 若預設回空陣列,每支測試都得先把成功路徑鋪一次,反而看不出重點。
const WRITE_OPS = ['insert', 'update', 'upsert', 'delete']
const TERMINAL_OPS = [...WRITE_OPS, 'select']

export function createScriptedSupabase() {
  const calls = []
  const scripted = new Map() // `${table}.${op}` → 結果或 (ops) => 結果

  const defaultResult = (ops) => {
    const names = ops.map((o) => o.op)
    const single = names.includes('single') || names.includes('maybeSingle')
    if (names.some((n) => WRITE_OPS.includes(n))) {
      return { data: single ? { id: 'row-1' } : [{ id: 'row-1' }], error: null }
    }
    return { data: single ? null : [], error: null, count: 0 }
  }

  const resolve = (table, ops) => {
    const names = ops.map((o) => o.op)
    for (const op of TERMINAL_OPS) {          // 寫入動作優先於鏈上的 select
      const hit = scripted.get(`${table}.${op}`)
      if (names.includes(op) && hit !== undefined) return typeof hit === 'function' ? hit(ops) : hit
    }
    return defaultResult(ops)
  }

  // 鏈式呼叫一路回傳同一個代理,最後 await 時才依累積的 ops 決定結果
  const from = (table) => {
    const ops = []
    const api = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          const p = Promise.resolve(resolve(table, ops))
          return p.then.bind(p)
        }
        return (...args) => { ops.push({ op: prop, args }); calls.push({ table, op: prop, args }); return api }
      },
    })
    return api
  }

  return {
    client: { from },
    calls,
    // 指定某表某動作的回傳:script('defects', 'insert', { data: null, error: {...} })
    script(table, op, result) { scripted.set(`${table}.${op}`, result) },
    reset() { calls.length = 0; scripted.clear() },
    // 斷言輔助
    hit(table, op) { return calls.some((c) => c.table === table && c.op === op) },
    argsOf(table, op) { return calls.filter((c) => c.table === table && c.op === op).map((c) => c.args) },
    countOf(table, op) { return calls.filter((c) => c.table === table && c.op === op).length },
  }
}

// RLS 靜默擋下:沒有 error,但一列都沒寫到——前端若當成功就是假成功(B-07)
export const SILENT_ZERO_ROWS = { data: [], error: null }
