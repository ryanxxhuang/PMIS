// P4e｜Edge 不寫估驗(原始碼掃描)——對照 DB 端 20260920001500 收回 valuation_items 直接寫入。
// 估驗期別、明細、來源分配、調整、監造確認量與計價依據只由使用者本人經 DB 的 P4b RPC／簽署路徑寫入
// (設計 docs/architecture/confirmed-quantity-valuation.md §9、§19)。Edge 多半以 service role 執行、繞過 RLS;
// DB guard 雖對非重算寫入一律 VQ010,但 Edge 原始碼出現這類寫入本身就是越界(AI 只查詢、彙整、擬稿),在這裡擋:
//   1. 任何 .from(X) 的方法鏈上出現 insert／update／upsert／delete 時,X 不得是下列估驗表,也不得是非字串常值(無法證明目標);
//   2. 不得呼叫改動估驗數量／確認量／計價依據／簽署的 RPC,.rpc() 的名稱也必須是字串常值;
//   3. 不得以原始 REST(/rest/v1/<估驗表>)繞過 supabase-js。
// 掃描器本身另以合成片段驗證(會抓、不誤判),並要求在真實原始碼裡確實讀到估驗表(不是空轉)。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const FUNCTIONS_DIR = path.resolve(here, '..')
const sourceFiles = fs.readdirSync(FUNCTIONS_DIR, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
const read = (rel: string) => fs.readFileSync(path.join(FUNCTIONS_DIR, rel), 'utf8')

const VALUATION_TABLES = [
  'valuations', 'valuation_items', 'valuation_item_sources', 'valuation_adjustments',
  'inspection_confirmations', 'work_item_pricing_basis',
]
const VALUATION_WRITE_RPCS = [
  'sync_valuation_from_confirmations', 'set_valuation_item_cum', 'transition_valuation',
  'issue_supervisor_certificate', 'revoke_inspection_confirmation', 'void_valuation_adjustment',
  'admin_adjust_valuation_item', 'set_work_item_pricing_basis',
  'sign_field_document', // 簽署監造查驗表單在同交易寫確認量(P3c);簽署只能是人
]
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

type Finding = { line: number; text: string }
function scanValuationWrites(src: string) {
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
    if (writes.length && (!literal || VALUATION_TABLES.includes(literal))) offenders.push({ line: lineOf(m.index!), text })
    else if (!writes.length && literal && VALUATION_TABLES.includes(literal)) reads.push({ line: lineOf(m.index!), text })
  }
  for (const m of src.matchAll(/\.rpc\(\s*([^,)\s]+)/g)) {
    const name = /^(['"`])(\w+)\1$/.exec(m[1])?.[2]
    if (!name || VALUATION_WRITE_RPCS.includes(name)) offenders.push({ line: lineOf(m.index!), text: `.rpc(${m[1]})` })
  }
  for (const m of src.matchAll(/\/rest\/v1\/(\w+)/g)) {
    if (VALUATION_TABLES.includes(m[1])) offenders.push({ line: lineOf(m.index!), text: m[0] })
  }
  return { offenders, reads }
}

describe('掃描器本身(合成片段)', () => {
  it('抓得到直接寫估驗表、動態目標的寫入、估驗 RPC 與原始 REST', () => {
    const src = [
      "await service.from('valuation_items').upsert(row, { onConflict: 'valuation_id,work_item_id' })",
      "await db.from('valuation_item_sources')",
      "  // 註解夾在鏈中間",
      "  .delete()",
      "  .eq('valuation_id', id)",
      "await db.from(table).update({ cum_qty: 1 }).eq('id', id)",
      "await db.from('valuations').select('id').returns<Array<{ id: string }>>().update({ status: 'x' })",
      "await db.rpc('set_valuation_item_cum', { p_valuation_id: v })",
      "await db.rpc(name, {})",
      "await fetch(`${url}/rest/v1/valuation_adjustments`, { method: 'POST' })",
    ].join('\n')
    expect(scanValuationWrites(src).offenders.map((o) => o.line)).toEqual([1, 2, 6, 7, 8, 9, 10])
  })

  it('讀取、無關的 .from／.delete 與其他表的寫入不誤判', () => {
    const src = [
      "const { data } = await db.from('valuation_items')",
      "  .select('work_item_id, cum_qty, valuations!inner(project_id)')",
      "  .eq('valuations.project_id', projectId)",
      "const hex = Array.from(bytes, (b) => b.toString(16)).join('')",
      "cache.delete(key); hash.update(chunk)",
      "await service.from('agent_actions').insert({ kind: 'draft' })",
      "await db.from(table).select(cols).eq('id', id)",
      "await db.rpc('my_org_type')",
    ].join('\n')
    const r = scanValuationWrites(src)
    expect(r.offenders).toEqual([])
    expect(r.reads.map((x) => x.line)).toEqual([1])
  })
})

describe('supabase/functions 不寫估驗(原始碼掃描)', () => {
  const findings = sourceFiles.map((rel) => ({ rel, ...scanValuationWrites(read(rel)) }))

  it('沒有任何估驗表寫入、估驗 RPC 或原始 REST', () => {
    const offenders = findings.flatMap((f) => f.offenders.map((o) => `${f.rel}:${o.line}  ${o.text}`))
    expect(offenders, `Edge 不得寫估驗(改由使用者經 DB RPC 寫入):\n${offenders.join('\n')}`).toEqual([])
  })

  it('掃描有效:真實原始碼裡確實讀到估驗表(早報／Agent／勾稽)', () => {
    const reads = findings.flatMap((f) => f.reads.map((r) => `${f.rel}:${r.line}`))
    expect(reads.some((r) => r.startsWith(`_shared${path.sep}integrityAuditTool.ts`))).toBe(true)
    expect(reads.some((r) => r.startsWith(`_shared${path.sep}ballInCourt.ts`))).toBe(true)
    expect(reads.length).toBeGreaterThanOrEqual(5)
  })
})
