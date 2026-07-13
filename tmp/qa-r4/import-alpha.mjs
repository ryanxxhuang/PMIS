import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  (await fs.readFile(new URL('../../.env', import.meta.url), 'utf8'))
    .split(/\r?\n/).filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    }),
)
const state = JSON.parse(await fs.readFile(new URL('./state.json', import.meta.url), 'utf8'))
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { error: authError } = await db.auth.signInWithPassword({
  email: state.emails.A, password: state.password,
})
if (authError) throw authError

const { count: existing, error: countError } = await db.from('work_items')
  .select('id', { count: 'exact', head: true }).eq('project_id', state.alpha.id)
if (countError) throw countError
if (existing) {
  console.log(JSON.stringify({ skipped: true, persistedItems: existing }))
  process.exit(0)
}

const parsed = JSON.parse(await fs.readFile(new URL('../qa-e2e/boq.json', import.meta.url), 'utf8'))
const ids = new Map(parsed.items.map((item) => [item.item_key, crypto.randomUUID()]))
const rows = parsed.items.map((item) => ({
  id: ids.get(item.item_key), project_id: state.alpha.id,
  parent_id: item.parent_key ? ids.get(item.parent_key) : null,
  item_key: item.item_key, item_no: item.item_no, ref_item_code: item.ref_item_code,
  item_kind: item.item_kind, description: item.description, unit: item.unit,
  quantity: item.quantity, unit_price: item.unit_price, amount: item.amount,
  section: item.section, depth: item.depth, sort_order: item.sort_order,
  is_leaf: item.is_leaf, is_rollup: item.is_rollup,
  is_price_adjustable: item.is_price_adjustable, is_billable: item.is_billable,
  weight: item.weight, remark: item.remark,
})).sort((a, b) => a.sort_order - b.sort_order)

const started = Date.now()
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await db.from('work_items').insert(rows.slice(i, i + 500))
  if (error) throw new Error(`匯入 ${i + 1}-${Math.min(i + 500, rows.length)} 失敗: ${error.message}`)
}
const { count, error } = await db.from('work_items')
  .select('id', { count: 'exact', head: true }).eq('project_id', state.alpha.id)
if (error) throw error
console.log(JSON.stringify({ sourceItems: rows.length, persistedItems: count, elapsedMs: Date.now() - started }))
