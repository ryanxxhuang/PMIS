// Edge 原始碼「不得寫入」靜態掃描的共用實作(P4e valuationWrites.scan.test.ts 抽出;F1 anchorWrites.scan.test.ts 共用)。
// 兩支掃描只差「哪些表、哪些 RPC」,掃描器本身只能有一份——否則一邊修了跨行鏈／註解夾在鏈中間的解析,
// 另一邊就漏。放在 tests/lib(不在 supabase/functions 之下):Edge 打包碰不到、兩支掃描也不會把它當受掃原始碼。
//   1. 任何 .from(X) 的方法鏈上出現 insert／update／upsert／delete 時,X 不得是禁寫表,也不得是非字串常值(無法證明目標);
//   2. 不得呼叫禁用 RPC,.rpc() 的名稱也必須是字串常值;
//   3. 不得以原始 REST(/rest/v1/<禁寫表>)繞過 supabase-js。
import fs from 'node:fs'
import path from 'node:path'

const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete'])

// 從 open(指向 '(' 或 '<')起找對應的收尾,略過字串／樣板字串內容;回傳收尾的下一個位置
function skipBalanced(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '<': '>' }
  const close = pairs[src[open]]
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '\'' || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
      continue
    }
    if (c === src[open]) depth++
    else if (c === close && !(close === '>' && src[i - 1] === '=')) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return src.length
}

// .from(...) 之後的方法鏈:.a(...).b<T>(...)?.c(...),可跨行、可夾 // 註解
function chainMethods(src: string, from: number): string[] {
  const names: string[] = []
  let i = from
  for (;;) {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++
      if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue }
      break
    }
    if (src.startsWith('?.', i)) i += 2
    else if (src[i] === '.') i += 1
    else return names
    const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))
    if (!m) return names
    names.push(m[0])
    i += m[0].length
    while (i < src.length && /\s/.test(src[i])) i++
    if (src[i] === '<') i = skipBalanced(src, i)
    if (src[i] === '(') i = skipBalanced(src, i)
  }
}

export type Finding = { line: number; text: string }
export interface WriteScanRules { tables: readonly string[]; rpcs: readonly string[] }

// 回 offenders(違規寫入／RPC／REST)與 reads(對禁寫表的純讀取,供「掃描有效、不是空轉」的斷言)
export function scanWrites(src: string, rules: WriteScanRules): { offenders: Finding[]; reads: Finding[] } {
  const offenders: Finding[] = []
  const reads: Finding[] = []
  const lineOf = (idx: number) => src.slice(0, idx).split('\n').length
  for (const m of src.matchAll(/\.from\(/g)) {
    const open = m.index! + '.from'.length
    const end = skipBalanced(src, open)
    const arg = src.slice(open + 1, end - 1).trim()
    const literal = /^(['"`])([\w.]+)\1$/.exec(arg)?.[2]
    const writes = chainMethods(src, end).filter((n) => WRITE_METHODS.has(n))
    const text = `.from(${arg}) → ${writes.join(',') || 'read'}`
    if (writes.length && (!literal || rules.tables.includes(literal))) offenders.push({ line: lineOf(m.index!), text })
    else if (!writes.length && literal && rules.tables.includes(literal)) reads.push({ line: lineOf(m.index!), text })
  }
  for (const m of src.matchAll(/\.rpc\(\s*([^,)\s]+)/g)) {
    const name = /^(['"`])(\w+)\1$/.exec(m[1])?.[2]
    if (!name || rules.rpcs.includes(name)) offenders.push({ line: lineOf(m.index!), text: `.rpc(${m[1]})` })
  }
  for (const m of src.matchAll(/\/rest\/v1\/(\w+)/g)) {
    if (rules.tables.includes(m[1])) offenders.push({ line: lineOf(m.index!), text: m[0] })
  }
  return { offenders, reads }
}

// F2:列出原始碼裡「所有」寫入目標與 RPC 呼叫(允許清單掃描用:清單外的一律越界)。
//   tables:.from(X) 後方法鏈有 insert／update／upsert／delete 的 X(常值);dynamic:目標不是字串常值的寫入;
//   rpcs:.rpc(N) 的 N(常值);dynamicRpcs:名稱不是常值;rest:原始 REST 路徑。與 scanWrites 共用同一個鏈解析。
export function listWriteTargets(src: string): {
  tables: Array<{ table: string; line: number; writes: string[] }>
  dynamic: Finding[]
  rpcs: Array<{ name: string; line: number }>
  dynamicRpcs: Finding[]
  rest: Finding[]
} {
  const lineOf = (idx: number) => src.slice(0, idx).split('\n').length
  const tables: Array<{ table: string; line: number; writes: string[] }> = []
  const dynamic: Finding[] = []
  for (const m of src.matchAll(/\.from\(/g)) {
    const open = m.index! + '.from'.length
    const end = skipBalanced(src, open)
    const arg = src.slice(open + 1, end - 1).trim()
    const literal = /^(['"`])([\w.]+)\1$/.exec(arg)?.[2]
    const writes = chainMethods(src, end).filter((n) => WRITE_METHODS.has(n))
    if (!writes.length) continue
    if (literal) tables.push({ table: literal, line: lineOf(m.index!), writes })
    else dynamic.push({ line: lineOf(m.index!), text: `.from(${arg}) → ${writes.join(',')}` })
  }
  const rpcs: Array<{ name: string; line: number }> = []
  const dynamicRpcs: Finding[] = []
  for (const m of src.matchAll(/\.rpc\(\s*([^,)\s]+)/g)) {
    const name = /^(['"`])(\w+)\1$/.exec(m[1])?.[2]
    if (name) rpcs.push({ name, line: lineOf(m.index!) })
    else dynamicRpcs.push({ line: lineOf(m.index!), text: `.rpc(${m[1]})` })
  }
  const rest: Finding[] = [...src.matchAll(/\/rest\/v1\//g)].map((m) => ({ line: lineOf(m.index!), text: '原始 REST 路徑' }))
  return { tables, dynamic, rpcs, dynamicRpcs, rest }
}

// supabase/functions 之下所有會部署的 .ts(排除測試檔),連同 _shared;回 [相對路徑, 原始碼]
export function listEdgeSources(functionsDir: string): Array<{ rel: string; src: string }> {
  return fs.readdirSync(functionsDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((rel) => ({ rel, src: fs.readFileSync(path.join(functionsDir, rel), 'utf8') }))
}
