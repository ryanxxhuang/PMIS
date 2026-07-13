import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries((await fs.readFile(new URL('../../.env', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const i = line.indexOf('=')
    return [line.slice(0, i), line.slice(i + 1)]
  }))
const state = JSON.parse(await fs.readFile(new URL('./state.json', import.meta.url), 'utf8'))
const action = process.argv[2]
const makeDb = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
async function signIn(role) {
  const db = makeDb()
  const { data, error } = await db.auth.signInWithPassword({ email: state.emails[role], password: state.password })
  if (error) throw error
  return { db, user: data.user }
}
async function valuation(db) {
  const { data, error } = await db.from('valuations').select('*').eq('project_id', state.alpha.id).eq('period_no', 5).maybeSingle()
  if (error) throw error
  return data
}

if (action === 'seed') {
  const A = await signIn('A'); const B = await signIn('B'); const C = await signIn('C')
  let v = await valuation(A.db)
  if (!v) {
    const { data, error } = await A.db.from('valuations').insert({
      project_id: state.alpha.id, period_no: 5, period_start: '2026-07-01', period_end: '2026-07-31',
      valuation_date: '2026-07-13', retention_pct: 5, status: '草稿', note: 'R4 金流清空與極值序列', created_by: A.user.id,
    }).select().single()
    if (error) throw error
    v = data
  }
  const { data: wi, error: wiError } = await A.db.from('work_items')
    .select('id,item_no,description,quantity,amount').eq('project_id', state.alpha.id)
    .eq('is_billable', true).eq('is_rollup', false).gt('quantity', 0).gt('amount', 1000).limit(1).single()
  if (wiError) throw wiError
  const qty = Math.min(Number(wi.quantity), Math.max(0.01, Number(wi.quantity) * 0.01))
  const amount = Number(wi.amount) * qty / Number(wi.quantity)
  const { error: itemError } = await A.db.from('valuation_items').upsert({
    valuation_id: v.id, work_item_id: wi.id, cum_qty: qty, cum_pct: qty / Number(wi.quantity) * 100,
    amount_cum: amount, source: 'manual', note: 'R4 金流序列工項',
  }, { onConflict: 'valuation_id,work_item_id' })
  if (itemError) throw itemError
  if (v.status === '草稿') {
    const { data, error } = await A.db.from('valuations').update({ status: '監造審核' }).eq('id', v.id).select().single()
    if (error) throw error
    v = data
  }
  if (v.status === '監造審核') {
    const { data, error } = await B.db.from('valuations').update({ status: '已核定', note: 'R4 B 核定金流序列' }).eq('id', v.id).select().single()
    if (error) throw error
    v = data
  }
  const net = Math.round(amount * 0.95)
  const { data: paid, error: payError } = await C.db.from('valuations').update({
    invoice_date: '2026-07-10', paid_date: '2026-07-11', paid_amount: net,
  }).eq('id', v.id).select().single()
  if (payError) throw payError
  const out = { id: paid.id, period_no: paid.period_no, status: paid.status, invoice_date: paid.invoice_date,
    paid_date: paid.paid_date, paid_amount: Number(paid.paid_amount), expected_net: net, work_item: wi.item_no }
  await fs.writeFile(new URL('./payment-state.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(out, null, 2))
} else if (action === 'inspect') {
  const A = await signIn('A')
  const v = await valuation(A.db)
  console.log(JSON.stringify(v, null, 2))
} else if (action === 'b-return') {
  const B = await signIn('B')
  const v = await valuation(B.db)
  const { data, error } = await B.db.from('valuations').update({ status: '監造審核', note: 'R4 B 清空後退回核定確認' })
    .eq('id', v.id).select().single()
  if (error) throw error
  console.log(JSON.stringify(data, null, 2))
} else if (action === 'reapprove') {
  const A = await signIn('A'); const B = await signIn('B')
  let v = await valuation(A.db)
  if (v.status === '草稿') {
    const { data, error } = await A.db.from('valuations').update({ status: '監造審核', note: 'R4 清空退回後重新送審' })
      .eq('id', v.id).select().single()
    if (error) throw error
    v = data
  }
  if (v.status === '監造審核') {
    const { data, error } = await B.db.from('valuations').update({ status: '已核定', note: 'R4 清空循環後重新核定' })
      .eq('id', v.id).select().single()
    if (error) throw error
    v = data
  }
  console.log(JSON.stringify(v, null, 2))
} else {
  throw new Error(`unknown action: ${action}`)
}
