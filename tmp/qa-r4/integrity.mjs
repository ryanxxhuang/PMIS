import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries((await fs.readFile(new URL('../../.env', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const i = line.indexOf('=')
    return [line.slice(0, i), line.slice(i + 1)]
  }))
const state = JSON.parse(await fs.readFile(new URL('./state.json', import.meta.url), 'utf8'))
const evidence = JSON.parse(await fs.readFile(new URL('./evidence-state.json', import.meta.url), 'utf8'))
const payment = JSON.parse(await fs.readFile(new URL('./payment-state.json', import.meta.url), 'utf8'))
const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: auth, error: authError } = await db.auth.signInWithPassword({ email: state.emails.A, password: state.password })
if (authError) throw authError

const { data: events, error: auditError } = await db.from('audit_events').select('*')
  .eq('project_id', state.alpha.id).gte('occurred_at', '2026-07-13T00:00:00Z')
  .order('occurred_at', { ascending: true }).limit(1000)
if (auditError) throw auditError
const trackedIds = new Set([payment.id, ...Object.values(evidence).map((x) => x.id)])
const tracked = events.filter((e) => trackedIds.has(e.entity_id))
const actorSnapshotMissing = tracked.filter((e) => e.actor_user_id && (!e.actor_party_type || !e.actor_project_role))
const transitions = tracked.map((e) => ({
  occurred_at: e.occurred_at,
  event_type: e.event_type,
  entity_type: e.entity_type,
  entity_id: e.entity_id,
  actor_party_type: e.actor_party_type,
  actor_project_role: e.actor_project_role,
  action: e.action,
  from: e.before_data?.status ?? null,
  to: e.after_data?.status ?? null,
  reason: e.metadata?.reason ?? e.metadata?.review_note ?? e.after_data?.note ?? e.after_data?.review_note ?? null,
}))
const eventTypes = Object.entries(events.reduce((m, e) => ({ ...m, [e.event_type]: (m[e.event_type] || 0) + 1 }), {}))
  .sort((a, b) => a[0].localeCompare(b[0]))

const { data: checklists, error: checkError } = await db.from('checklist_records')
  .select('id,root_id,rev,supersedes_id,revision_reason,overall,results,created_at')
  .eq('project_id', state.alpha.id).order('rev')
if (checkError) throw checkError
const { data: checklistDefects, error: defectError } = await db.from('defects')
  .select('id,title,status,source_checklist_record_id,created_at').eq('project_id', state.alpha.id)
  .not('source_checklist_record_id', 'is', null)
if (defectError) throw defectError

const { data: valuation, error: valError } = await db.from('valuations').select('*').eq('id', payment.id).single()
if (valError) throw valError
const { data: valItems, error: itemError } = await db.from('valuation_items').select('cum_qty,amount_cum,work_items(item_no,parent_id,is_rollup)')
  .eq('valuation_id', payment.id)
if (itemError) throw itemError
const ledger = {
  status: valuation.status,
  invoice_date: valuation.invoice_date,
  paid_date: valuation.paid_date,
  paid_amount: Number(valuation.paid_amount),
  amount_cum_sum: valItems.reduce((s, x) => s + Number(x.amount_cum || 0), 0),
  item_count: valItems.length,
}

console.log(JSON.stringify({
  audit: { total: events.length, tracked: tracked.length, actorSnapshotMissing: actorSnapshotMissing.length, eventTypes, transitions },
  checklist: { rows: checklists.map((r) => ({ id: r.id, root_id: r.root_id, rev: r.rev, supersedes_id: r.supersedes_id,
    revision_reason: r.revision_reason, overall: r.overall, b1: r.results?.B1?.value })), defects: checklistDefects },
  ledger,
}, null, 2))
