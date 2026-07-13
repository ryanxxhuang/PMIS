import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  (await fs.readFile(new URL('../../.env', import.meta.url), 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    }),
)

export const stamp = '20260713-0815-r4'
export const password = 'Pmis-QA4-20260713!'
export const emails = {
  A: `pmis.qa.a.${stamp}@example.com`,
  B: `pmis.qa.b.${stamp}@example.com`,
  C: `pmis.qa.c.${stamp}@example.com`,
}

const actors = {
  A: { full_name: '第四輪施工廠商A', company: '第四輪營造有限公司', org_type: 'contractor', role: '品管工程師' },
  B: { full_name: '第四輪監造B', company: '第四輪監造顧問', org_type: 'supervisor', role: '監造工程師' },
  C: { full_name: '第四輪機關C', company: '第四輪主辦機關', org_type: 'owner', role: '承辦工程師' },
}

function client() {
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function createAndSignIn(role) {
  const db = client()
  const { data: signup, error: signupError } = await db.auth.signUp({
    email: emails[role], password,
    options: { data: actors[role] },
  })
  if (signupError && !/already registered/i.test(signupError.message)) {
    throw new Error(`${role} 註冊失敗: ${signupError.message}`)
  }
  if (!signup?.session) {
    const { data, error } = await db.auth.signInWithPassword({ email: emails[role], password })
    if (error) throw new Error(`${role} 無 session，可能需驗證信: ${error.message}`)
    return { db, user: data.user }
  }
  return { db, user: signup.user }
}

async function createProject(db, input) {
  const { data: existing, error: findError } = await db.from('projects')
    .select('*').eq('name', input.name).limit(1).maybeSingle()
  if (findError) throw new Error(`查詢專案 ${input.name} 失敗: ${findError.message}`)
  if (existing) return existing
  const { data, error } = await db.rpc('create_project', {
    p_name: input.name,
    p_code: input.code,
    p_owner: input.owner,
    p_contractor: input.contractor,
    p_supervisor: input.supervisor,
    p_location: input.location,
    p_start: input.start,
    p_end: input.end,
  })
  if (error) throw new Error(`建立專案 ${input.name} 失敗: ${error.message}`)
  return data
}

async function insertOne(db, table, row) {
  const { data, error } = await db.from(table).insert(row).select().single()
  if (error) throw new Error(`${table} 種子失敗: ${error.message}`)
  return data
}

const A = await createAndSignIn('A')
const B = await createAndSignIn('B')
const C = await createAndSignIn('C')

const alpha = await createProject(A.db, {
  name: `PMIS-R4-甲-正式驗收-${stamp}`,
  code: 'R4-ALPHA-20260713',
  owner: actors.C.company,
  contractor: actors.A.company,
  supervisor: actors.B.company,
  location: '桃園市', start: '2026-07-01', end: '2027-12-31',
})

for (const role of ['B', 'C']) {
  const { data, error } = await A.db.rpc('add_member_by_email', {
    p_project: alpha.id, p_email: emails[role], p_role: 'member',
  })
  if (error || data === 'not_found') throw new Error(`甲邀請 ${role} 失敗: ${error?.message || data}`)
}

const beta = await createProject(C.db, {
  name: `PMIS-R4-乙-隔離對照-${stamp}`,
  code: 'R4-BETA-ISOLATION',
  owner: actors.C.company,
  contractor: '乙案隔離施工廠商',
  supervisor: '乙案隔離監造',
  location: '新竹縣', start: '2026-06-01', end: '2027-06-30',
})

const betaMarker = `R4-BETA-SECRET-${stamp}`
const betaRows = {}
betaRows.valuations = await insertOne(C.db, 'valuations', {
  project_id: beta.id, period_no: 41, note: betaMarker,
  valuation_date: '2026-07-13', status: '草稿', retention_pct: 5,
})
betaRows.defects = await insertOne(C.db, 'defects', {
  project_id: beta.id, domain: 'quality', title: betaMarker,
  description: '乙案隔離資料，不得出現在甲案 session', severity: '重大',
  location: '乙案機密區', status: '開立',
})
betaRows.cost_items = await insertOne(C.db, 'cost_items', {
  project_id: beta.id, category: '材料', title: betaMarker,
  vendor: '乙案機密供應商', budget_amount: 987654, actual_amount: 123456,
  status: '進行中',
})
betaRows.submittals = await insertOne(C.db, 'submittals', {
  project_id: beta.id, submittal_no: 'BETA-SECRET-41', title: betaMarker,
  category: '材料設備', status: '已提送', revision: 0,
  submitted_date: '2026-07-13', attachment_note: '乙案機密送審',
})
betaRows.test_samples = await insertOne(C.db, 'test_samples', {
  project_id: beta.id, sample_no: 'BETA-TS-41', sampled_date: '2026-07-13',
  location: betaMarker, fc: 280, status: '待試驗',
})

const summary = {
  stamp,
  emails,
  password,
  users: { A: A.user.id, B: B.user.id, C: C.user.id },
  alpha: { id: alpha.id, name: alpha.name },
  beta: { id: beta.id, name: beta.name, marker: betaMarker },
  betaResources: Object.fromEntries(Object.entries(betaRows).map(([k, v]) => [k, v.id])),
}

await fs.writeFile(new URL('./state.json', import.meta.url), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  accounts: Object.keys(summary.users),
  alpha: summary.alpha,
  beta: summary.beta,
  betaResourceKinds: Object.keys(summary.betaResources),
}, null, 2))
