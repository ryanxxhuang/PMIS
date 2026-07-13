import fs from 'node:fs/promises'
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
const action = process.argv[2]

function client() {
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(role) {
  const db = client()
  const { data, error } = await db.auth.signInWithPassword({ email: state.emails[role], password: state.password })
  if (error) throw error
  return { db, token: data.session.access_token, user: data.user }
}

async function getOrInsert(db, table, match, row) {
  let query = db.from(table).select('*')
  for (const [k, v] of Object.entries(match)) query = query.eq(k, v)
  const { data: existing, error: findError } = await query.limit(1).maybeSingle()
  if (findError) throw findError
  if (existing) return existing
  const { data, error } = await db.from(table).insert(row).select().single()
  if (error) throw error
  return data
}

async function rawDelete(ctx, table, id) {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=id`, {
    method: 'DELETE',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ctx.token}`,
      Prefer: 'return=representation',
    },
  })
  const text = await response.text()
  let body = text
  try { body = text ? JSON.parse(text) : null } catch { /* keep */ }
  return { http: response.status, body }
}

if (action === 'seed') {
  const A = await signIn('A')
  const B = await signIn('B')
  const rows = {}
  rows.submittals = await getOrInsert(A.db, 'submittals', {
    project_id: state.alpha.id, submittal_no: 'R4-EVID-SUB-001',
  }, {
    project_id: state.alpha.id, submittal_no: 'R4-EVID-SUB-001',
    title: 'R4 stale 受理後不可刪送審', category: '施工計畫', revision: 0,
    status: '已提送', submitted_date: '2026-07-13', attachment_note: 'R4 初版附件說明',
    created_by: A.user.id,
  })
  rows.inspections = await getOrInsert(A.db, 'inspections', {
    project_id: state.alpha.id, title: 'R4 已判定查驗不可刪',
  }, {
    project_id: state.alpha.id, title: 'R4 已判定查驗不可刪',
    requested_date: '2026-07-13', requested_by: A.user.id, status: '待查驗',
  })
  if (rows.inspections.status === '待查驗') {
    const { data, error } = await B.db.from('inspections').update({
      status: '合格', result_note: 'R4 監造判定合格', inspected_by: B.user.id,
      inspected_at: new Date().toISOString(),
    }).eq('id', rows.inspections.id).select().single()
    if (error) throw error
    rows.inspections = data
  }
  rows.rfis = await getOrInsert(A.db, 'rfis', {
    project_id: state.alpha.id, rfi_no: 'R4-EVID-RFI-001',
  }, {
    project_id: state.alpha.id, rfi_no: 'R4-EVID-RFI-001',
    title: 'R4 已回覆 RFI 不可刪', question: 'R4 長文字回覆前置問題',
    status: '待回覆', asked_date: '2026-07-13', created_by: A.user.id,
  })
  if (rows.rfis.status === '待回覆') {
    const { data, error } = await B.db.from('rfis').update({
      status: '已回覆', answer: 'R4 監造正式回覆', answered_date: '2026-07-13',
    }).eq('id', rows.rfis.id).select().single()
    if (error) throw error
    rows.rfis = data
  }
  rows.valuations = await getOrInsert(A.db, 'valuations', {
    project_id: state.alpha.id, period_no: 4,
  }, {
    project_id: state.alpha.id, period_no: 4, period_start: '2026-07-01',
    period_end: '2026-07-31', valuation_date: '2026-07-13', retention_pct: 5,
    status: '草稿', note: 'R4 非草稿估驗不可刪', created_by: A.user.id,
  })
  if (rows.valuations.status === '草稿') {
    const { data, error } = await A.db.from('valuations').update({ status: '監造審核' })
      .eq('id', rows.valuations.id).select().single()
    if (error) throw error
    rows.valuations = data
  }
  const { data: sample, error: sampleError } = await A.db.from('test_samples').select('*')
    .eq('project_id', state.alpha.id).eq('sample_no', 'TS-20260610').single()
  if (sampleError) throw sampleError
  rows.test_samples = sample
  const out = Object.fromEntries(Object.entries(rows).map(([table, row]) => [table, { id: row.id, status: row.status }]))
  await fs.writeFile(new URL('./evidence-state.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(out, null, 2))
} else if (action === 'accept-submittal') {
  const B = await signIn('B')
  const ids = JSON.parse(await fs.readFile(new URL('./evidence-state.json', import.meta.url), 'utf8'))
  const { data, error } = await B.db.from('submittals').update({
    status: '審核中', review_note: 'R4 B 已受理，A 分頁保持 stale',
  }).eq('id', ids.submittals.id).select().single()
  if (error) throw error
  console.log(JSON.stringify({ id: data.id, status: data.status, review_note: data.review_note }))
} else if (action === 'probe-deletes') {
  const A = await signIn('A')
  const ids = JSON.parse(await fs.readFile(new URL('./evidence-state.json', import.meta.url), 'utf8'))
  const results = []
  for (const [table, row] of Object.entries(ids)) {
    const attempt = await rawDelete(A, table, row.id)
    const { count, error } = await A.db.from(table).select('id', { count: 'exact', head: true }).eq('id', row.id)
    results.push({ table, id: row.id, deleteHttp: attempt.http, body: attempt.body, rowsRemaining: error ? null : count })
  }
  console.log(JSON.stringify(results, null, 2))
} else {
  throw new Error(`unknown action ${action}`)
}
