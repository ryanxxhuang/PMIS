// P4e｜Edge 不寫估驗(原始碼掃描)——對照 DB 端 20260920001500 收回 valuation_items 直接寫入。
// 估驗期別、明細、來源分配、調整、監造確認量與計價依據只由使用者本人經 DB 的 P4b RPC／簽署路徑寫入
// (設計 docs/architecture/confirmed-quantity-valuation.md §9、§19)。Edge 多半以 service role 執行、繞過 RLS;
// DB guard 雖對非重算寫入一律 VQ010,但 Edge 原始碼出現這類寫入本身就是越界(AI 只查詢、彙整、擬稿),在這裡擋。
// 掃描器只有一份(tests/lib/edgeWriteScan.ts;F1 的 anchorWrites.scan.test.ts 共用),本檔以合成片段驗它會抓、不誤判,
// 並要求在真實原始碼裡確實讀到估驗表(不是空轉)。
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanWrites, listEdgeSources } from '../../../tests/lib/edgeWriteScan.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const FUNCTIONS_DIR = path.resolve(here, '..')

const RULES = {
  tables: [
    'valuations', 'valuation_items', 'valuation_item_sources', 'valuation_adjustments',
    'inspection_confirmations', 'work_item_pricing_basis',
  ],
  rpcs: [
    'sync_valuation_from_confirmations', 'set_valuation_item_cum', 'transition_valuation',
    'issue_supervisor_certificate', 'revoke_inspection_confirmation', 'void_valuation_adjustment',
    'admin_adjust_valuation_item', 'set_work_item_pricing_basis',
    'sign_field_document', // 簽署監造查驗表單在同交易寫確認量(P3c);簽署只能是人
  ],
}
const scanValuationWrites = (src: string) => scanWrites(src, RULES)

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
  const findings = listEdgeSources(FUNCTIONS_DIR).map(({ rel, src }) => ({ rel, ...scanValuationWrites(src) }))

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
