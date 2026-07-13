import fs from 'node:fs/promises'
import crypto from 'node:crypto'
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

const projectName = 'PMIS-R2-正式驗收-20260712-1500'
const password = 'Pmis-QA2-20260712!'
const emails = {
  A: 'pmis.qa.a.20260712-1500-r2@example.com',
  B: 'pmis.qa.b.20260712-1500-r2@example.com',
  C: 'pmis.qa.c.20260712-1500-r2@example.com',
}

function client() {
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(role) {
  const db = client()
  const { data, error } = await db.auth.signInWithPassword({ email: emails[role], password })
  if (error) throw new Error(`${role} 登入失敗: ${error.message}`)
  return { db, user: data.user, accessToken: data.session.access_token }
}

async function findProject(db) {
  const { data, error } = await db.from('projects')
    .select('id,name,formal_mode,created_by')
    .eq('name', projectName)
    .single()
  if (error) throw new Error(`專案查詢失敗: ${error.message}`)
  return data
}

async function importBoq() {
  const { db } = await signIn('A')
  const project = await findProject(db)
  const { count: existing, error: countError } = await db.from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', project.id)
  if (countError) throw countError
  if (existing) return { skipped: true, existing, project }

  const parsed = JSON.parse(await fs.readFile(new URL('../qa-e2e/boq.json', import.meta.url), 'utf8'))
  const ids = new Map(parsed.items.map((item) => [item.item_key, crypto.randomUUID()]))
  const rows = parsed.items.map((item) => ({
    id: ids.get(item.item_key),
    project_id: project.id,
    parent_id: item.parent_key ? ids.get(item.parent_key) : null,
    item_key: item.item_key,
    item_no: item.item_no,
    ref_item_code: item.ref_item_code,
    item_kind: item.item_kind,
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
    unit_price: item.unit_price,
    amount: item.amount,
    section: item.section,
    depth: item.depth,
    sort_order: item.sort_order,
    is_leaf: item.is_leaf,
    is_rollup: item.is_rollup,
    is_price_adjustable: item.is_price_adjustable,
    is_billable: item.is_billable,
    weight: item.weight,
    remark: item.remark,
  })).sort((a, b) => a.sort_order - b.sort_order)

  const startedAt = Date.now()
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('work_items').insert(rows.slice(i, i + 500))
    if (error) throw new Error(`工項 ${i + 1}-${Math.min(i + 500, rows.length)} 匯入失敗: ${error.message}`)
  }
  const { count, error } = await db.from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', project.id)
  if (error) throw error
  return {
    project,
    sourceItems: rows.length,
    persistedItems: count,
    elapsedMs: Date.now() - startedAt,
    meta: parsed.meta,
  }
}

function errorBody(error) {
  if (!error) return null
  return { code: error.code, message: error.message, details: error.details, hint: error.hint }
}

async function rawRest(ctx, table, method, query, body) {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method,
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed = text
  try { parsed = text ? JSON.parse(text) : null } catch { /* keep raw response text */ }
  return { httpStatus: response.status, ok: response.ok, body: parsed }
}

async function one(db, table, columns, filters) {
  let query = db.from(table).select(columns)
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value)
  const { data, error } = await query.limit(1).single()
  if (error) throw new Error(`${table} 測試資料查詢失敗: ${error.message}`)
  return data
}

function summarizeAttempt(name, response, before, after) {
  const unchanged = JSON.stringify(before) === JSON.stringify(after)
  const zeroRows = Array.isArray(response.body) && response.body.length === 0
  return {
    name,
    verdict: (!response.ok || zeroRows) && unchanged ? 'REJECTED' : unchanged ? 'NO_CHANGE' : 'MUTATED',
    response,
    before,
    after,
  }
}

async function apiProbes() {
  const A = await signIn('A')
  const B = await signIn('B')
  const C = await signIn('C')
  const project = await findProject(A.db)
  const valuation = await one(A.db, 'valuations', 'id,status,invoice_date,paid_date,paid_amount', { project_id: project.id, period_no: 1 })
  const submittal = await one(A.db, 'submittals', 'id,status,review_note', { project_id: project.id, submittal_no: 'SUB-001' })
  const rfi = await one(A.db, 'rfis', 'id,status,answer,answered_date', { project_id: project.id, rfi_no: 'RFI-001' })
  const inspection = await one(A.db, 'inspections', 'id,status,result_note,inspected_by,inspected_at', { project_id: project.id, title: 'R2混凝土澆置前查驗' })
  const defect = await one(A.db, 'defects', 'id,status,closed_at,correction_reason', { project_id: project.id, domain: 'quality' })
  const workItem = await one(A.db, 'work_items', 'id,item_key', { project_id: project.id, item_key: '2734' })
  const valuationItem = await one(A.db, 'valuation_items', 'id,cum_qty', { valuation_id: valuation.id, work_item_id: workItem.id })
  const results = []

  let before = { status: valuation.status }
  let response = await rawRest(A, 'valuations', 'PATCH', `id=eq.${valuation.id}`, { status: '已核定' })
  let afterRow = await one(A.db, 'valuations', 'status', { id: valuation.id })
  results.push(summarizeAttempt('A PATCH valuations.status=已核定', response, before, afterRow))
  if (afterRow.status !== before.status) await B.db.from('valuations').update(before).eq('id', valuation.id)

  before = { invoice_date: valuation.invoice_date, paid_amount: valuation.paid_amount }
  response = await rawRest(A, 'valuations', 'PATCH', `id=eq.${valuation.id}`, { invoice_date: '2026-07-12', paid_amount: 1 })
  afterRow = await one(A.db, 'valuations', 'invoice_date,paid_amount', { id: valuation.id })
  results.push(summarizeAttempt('A PATCH 未核定估驗 invoice_date/paid_amount', response, before, afterRow))
  if (JSON.stringify(afterRow) !== JSON.stringify(before)) await B.db.from('valuations').update(before).eq('id', valuation.id)

  const safetyTitle = `API越權監造紀錄-${Date.now()}`
  response = await rawRest(A, 'safety_records', 'POST', 'select=id,title,record_type', {
    project_id: project.id,
    record_type: '監造查驗',
    title: safetyTitle,
    record_date: '2026-07-12',
    status: '待改善',
  })
  const { data: safetyAfter, error: safetyReadError } = await A.db.from('safety_records').select('id,title,record_type').eq('title', safetyTitle)
  results.push(summarizeAttempt('A POST 監造類工安紀錄', response, [], safetyAfter || { error: errorBody(safetyReadError) }))
  if (safetyAfter?.length) await B.db.from('safety_records').delete().eq('id', safetyAfter[0].id)

  before = { status: inspection.status }
  response = await rawRest(A, 'inspections', 'PATCH', `id=eq.${inspection.id}`, { status: '合格' })
  afterRow = await one(A.db, 'inspections', 'status', { id: inspection.id })
  results.push(summarizeAttempt('A PATCH inspections.status=合格', response, before, afterRow))
  if (afterRow.status !== before.status) await B.db.from('inspections').update(before).eq('id', inspection.id)

  before = { status: submittal.status }
  response = await rawRest(A, 'submittals', 'PATCH', `id=eq.${submittal.id}`, { status: '核准' })
  afterRow = await one(A.db, 'submittals', 'status', { id: submittal.id })
  results.push(summarizeAttempt('A PATCH submittals.status=核准', response, before, afterRow))
  if (afterRow.status !== before.status) await B.db.from('submittals').update(before).eq('id', submittal.id)

  before = { status: rfi.status, answer: rfi.answer }
  response = await rawRest(A, 'rfis', 'PATCH', `id=eq.${rfi.id}`, { status: '已回覆', answer: 'A 越權回覆' })
  afterRow = await one(A.db, 'rfis', 'status,answer', { id: rfi.id })
  results.push(summarizeAttempt('A PATCH rfis.status/answer=已回覆', response, before, afterRow))
  if (JSON.stringify(afterRow) !== JSON.stringify(before)) await B.db.from('rfis').update(before).eq('id', rfi.id)

  before = { cum_qty: valuationItem.cum_qty }
  response = await rawRest(C, 'valuation_items', 'PATCH', `id=eq.${valuationItem.id}`, { cum_qty: 999 })
  afterRow = await one(C.db, 'valuation_items', 'cum_qty', { id: valuationItem.id })
  results.push(summarizeAttempt('C PATCH valuation_items.cum_qty', response, before, afterRow))
  if (JSON.stringify(afterRow) !== JSON.stringify(before)) await A.db.from('valuation_items').update(before).eq('id', valuationItem.id)

  before = { formal_mode: true }
  response = await rawRest(B, 'projects', 'PATCH', `id=eq.${project.id}`, { formal_mode: false })
  afterRow = await one(B.db, 'projects', 'formal_mode', { id: project.id })
  results.push(summarizeAttempt('B PATCH projects.formal_mode=false', response, before, afterRow))

  response = await rawRest(A, 'projects', 'PATCH', `id=eq.${project.id}`, { formal_mode: false })
  afterRow = await one(A.db, 'projects', 'formal_mode', { id: project.id })
  results.push(summarizeAttempt('A(建立者) PATCH projects.formal_mode=false', response, before, afterRow))
  if (!afterRow.formal_mode) await A.db.from('projects').update({ formal_mode: true }).eq('id', project.id)

  before = { status: defect.status }
  response = await rawRest(A, 'defects', 'PATCH', `id=eq.${defect.id}`, { status: '已結案', closed_at: new Date().toISOString() })
  afterRow = await one(A.db, 'defects', 'status', { id: defect.id })
  results.push(summarizeAttempt('A PATCH quality defect.status=已結案', response, before, afterRow))
  if (afterRow.status !== before.status) await B.db.from('defects').update({ ...before, closed_at: null }).eq('id', defect.id)

  return { project, actors: { A: A.user.id, B: B.user.id, C: C.user.id }, results }
}

async function forceSubmittalResubmitForContinuation() {
  const B = await signIn('B')
  const project = await findProject(B.db)
  const row = await one(B.db, 'submittals', 'id,status,revision', { project_id: project.id, submittal_no: 'SUB-001' })
  const response = await rawRest(B, 'submittals', 'PATCH', `id=eq.${row.id}`, {
    status: '已提送',
    revision: (row.revision || 0) + 1,
    decided_date: null,
    submitted_date: '2026-07-12',
  })
  const after = await one(B.db, 'submittals', 'status,revision,decided_date', { id: row.id })
  return { workaround: '以監造 session REST 解開施工端無法持久化的退回死路，只供後續核准測試', before: row, response, after }
}

async function paymentRollbackProbe() {
  const B = await signIn('B')
  const project = await findProject(B.db)
  const row = await one(B.db, 'valuations', 'id,status,invoice_date,paid_date,paid_amount', { project_id: project.id, period_no: 1 })
  const response = await rawRest(B, 'valuations', 'PATCH', `id=eq.${row.id}`, { status: '草稿' })
  const after = await one(B.db, 'valuations', 'status,invoice_date,paid_date,paid_amount', { id: row.id })
  if (after.status !== row.status) await B.db.from('valuations').update({ status: row.status }).eq('id', row.id)
  return summarizeAttempt('B PATCH 已有金流之已核定估驗 status=草稿', response, row, { id: row.id, ...after })
}

async function stateSummary() {
  const A = await signIn('A')
  const project = await findProject(A.db)
  const pid = project.id
  const tables = {}
  for (const [name, columns] of [
    ['valuations', 'period_no,status,invoice_date,paid_date,paid_amount'],
    ['submittals', 'submittal_no,revision,status,review_note'],
    ['rfis', 'rfi_no,status,answer'],
    ['inspections', 'title,status,result_note'],
    ['defects', 'title,domain,status,improvement_note,correction_reason'],
    ['change_orders', 'co_no,title,status'],
    ['change_order_items', 'description,qty_delta,unit_price,amount_delta'],
    ['acceptance_events', 'stage_key,event_date,result,note'],
  ]) {
    const { data, error } = await A.db.from(name).select(columns).eq('project_id', pid)
    tables[name] = error ? { error: errorBody(error) } : data
  }
  const counts = {}
  for (const name of ['work_items', 'audit_events', 'defect_audits']) {
    const { count, error } = await A.db.from(name).select('id', { count: 'exact', head: true }).eq('project_id', pid)
    counts[name] = error ? { error: errorBody(error) } : count
  }
  return { project, counts, tables }
}

const command = process.argv[2]
if (command === 'import-boq') console.log(JSON.stringify(await importBoq(), null, 2))
else if (command === 'api-probes') console.log(JSON.stringify(await apiProbes(), null, 2))
else if (command === 'force-submittal-resubmit') console.log(JSON.stringify(await forceSubmittalResubmitForContinuation(), null, 2))
else if (command === 'payment-rollback-probe') console.log(JSON.stringify(await paymentRollbackProbe(), null, 2))
else if (command === 'state-summary') console.log(JSON.stringify(await stateSummary(), null, 2))
else throw new Error(`未知命令: ${command || '(空白)'}`)
