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

function client() {
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(role) {
  const db = client()
  const { data, error } = await db.auth.signInWithPassword({
    email: state.emails[role], password: state.password,
  })
  if (error) throw error
  return { db, token: data.session.access_token }
}

async function rest(ctx, table, method, query, body) {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method,
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body == null ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed = text
  try { parsed = text ? JSON.parse(text) : null } catch { /* keep text */ }
  return { status: response.status, body: parsed }
}

async function readOne(db, table, id, columns) {
  const { data, error } = await db.from(table).select(columns).eq('id', id).single()
  if (error) throw new Error(`${table} C 讀回失敗: ${error.message}`)
  return data
}

const A = await signIn('A')
const C = await signIn('C')
const configs = {
  valuations: { columns: 'id,project_id,note', patch: { note: 'A-CROSS-PROJECT-WRITE' } },
  defects: { columns: 'id,project_id,description', patch: { description: 'A-CROSS-PROJECT-WRITE' } },
  cost_items: { columns: 'id,project_id,note', patch: { note: 'A-CROSS-PROJECT-WRITE' } },
  submittals: { columns: 'id,project_id,attachment_note', patch: { attachment_note: 'A-CROSS-PROJECT-WRITE' } },
  test_samples: { columns: 'id,project_id,note', patch: { note: 'A-CROSS-PROJECT-WRITE' } },
}

const results = []
for (const [table, cfg] of Object.entries(configs)) {
  const id = state.betaResources[table]
  const before = await readOne(C.db, table, id, cfg.columns)
  const read = await rest(A, table, 'GET', `id=eq.${id}&select=${cfg.columns}`)
  const write = await rest(A, table, 'PATCH', `id=eq.${id}&select=${cfg.columns}`, cfg.patch)
  const after = await readOne(C.db, table, id, cfg.columns)
  const unchanged = JSON.stringify(before) === JSON.stringify(after)
  results.push({
    table, betaResourceId: id,
    readHttp: read.status, readRows: Array.isArray(read.body) ? read.body.length : null,
    writeHttp: write.status, writeRows: Array.isArray(write.body) ? write.body.length : null,
    unchanged,
  })
}

const betaProjectRead = await rest(A, 'projects', 'GET', `id=eq.${state.beta.id}&select=id,name`)
const betaMarkerSearch = {}
for (const table of Object.keys(configs)) {
  const q = table === 'valuations' ? 'note' : table === 'cost_items' ? 'title' : table === 'test_samples' ? 'location' : 'title'
  const response = await rest(A, table, 'GET', `${q}=ilike.*${encodeURIComponent(state.beta.marker)}*&select=id`)
  betaMarkerSearch[table] = { http: response.status, rows: Array.isArray(response.body) ? response.body.length : null }
}

console.log(JSON.stringify({
  alpha: state.alpha.id,
  beta: state.beta.id,
  betaProjectRead: { http: betaProjectRead.status, rows: Array.isArray(betaProjectRead.body) ? betaProjectRead.body.length : null },
  resources: results,
  markerSearch: betaMarkerSearch,
  allBlocked: results.every((r) => r.readRows === 0 && r.writeRows === 0 && r.unchanged),
}, null, 2))
