// F2｜鏈 20:Edge 憑證(service role)對受保護表的執行期寫入一律被 DB 拒絕(真 Supabase,經 PostgREST)。
//   E 包指出 Edge 只有原始碼靜態掃描、沒有 runtime 證明。這裡以 **Edge 實際持有的憑證** 打 **Edge 實際走的通道**:
//   本機 `supabase functions serve` 注入給每支函式的 SUPABASE_SERVICE_ROLE_KEY 就是本機 stack 的 service role key,
//   與 .env.e2e.real 的 E2E_REAL_SERVICE_ROLE_KEY 同一把(JWT role claim=service_role,本鏈先驗這一點);
//   Edge 的 supabase-js service client 與這裡的 admin() 都經 kong → PostgREST → DB 以 service_role 執行,
//   DB 看到的是完全相同的角色、相同的一次請求一個交易。所以下面每一條拒絕就是「Edge 這樣寫會被 DB 拒絕」。
//   佈置全走產品窄門(廠商建案、匯標單、建草稿期;監造 issue_supervisor_certificate 簽 60;廠商同步確認量),
//   證明同一批 payload 由正確的人經 RPC 寫得進去——被拒的原因是「誰在寫」,不是 payload 不合法。
//   矩陣(全部期望 DB 錯誤碼,不是 RLS 空結果):
//     估驗明細 valuation_items insert／update／delete → VQ010(P4e 20260920001500)
//     來源分配 valuation_item_sources insert、調整 valuation_adjustments insert → VQ010
//     確認量 inspection_confirmations insert(內容合法)／active→revoked／delete → VQ010(F2 20260920230000)
//     期別 valuations 直接建已核定／改狀態／登請款日 → VQ010(F2)
//     計價依據 work_item_pricing_basis insert → VQ010(F2)
//     寫入 RPC 以服務憑證呼叫(auth.uid() 為 null):十三支各回登入／權限錯誤
//     先以 RPC 開內部旗標(fn_cq_set_internal)再寫:仍 VQ010(旗標只活在那一個 PostgREST 交易,跨請求無效)
//   最後核對 DB 狀態一列未變。不需 Edge stub(不上傳照片)。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, runCleanup, admin,
} from './helpers.js'

const PROJECT_NAME = `鏈20服務憑證封堵-${Date.now().toString(36)}`
const conEmail = uniqueEmail('f2c20-con')
const supEmail = uniqueEmail('f2c20-sup')
let conId, supId, projectId, wiId, valuationId, confirmationId
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '結構混凝土', unit: 'M3', quantity: 100, unit_price: 1000, amount: 100000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈二十廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈二十監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { error: inviteError } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' })
  if (inviteError) throw new Error(`邀請失敗:${inviteError.message}`)
  const { data: wi } = await c.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.1').single()
  wiId = wi.id
  const { data: v, error: vErr } = await c.from('valuations').insert({ project_id: projectId, period_no: 1, valuation_date: today, period_end: today, retention_pct: 5, status: '草稿', created_by: conId }).select('id').single()
  if (vErr) throw new Error(`建草稿期失敗:${vErr.message}`)
  valuationId = v.id
  await c.auth.signOut()
  // 監造親簽 60(合法路徑);廠商同步 → 明細 60
  const s = await signInClient(supEmail)
  const { data: cert, error: certErr } = await s.rpc('issue_supervisor_certificate', {
    p_project_id: projectId, p_work_item_id: wiId, p_batch_key: 'A區', p_location_label: 'A區', p_stage_key: null,
    p_unit: 'M3', p_qty_cum: 60, p_reason: '監造親簽', p_client_request_id: 'c20-req-1',
  })
  if (certErr) throw new Error(`簽確認單失敗:${certErr.message}`)
  confirmationId = cert.confirmation_id
  await s.auth.signOut()
  const c2 = await signInClient(conEmail)
  const { error: syncErr } = await c2.rpc('sync_valuation_from_confirmations', { p_valuation_id: valuationId })
  if (syncErr) throw new Error(`同步確認量失敗:${syncErr.message}`)
  await c2.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
  )
})

// 每一條都要有明確的 DB 錯誤碼;「沒錯誤但沒寫進去」不算通過(那是 RLS 空結果,service role 沒有 RLS)
const expectCode = (label, res, code) => {
  expect(res.error, `${label}:預期被 DB 拒絕(${code}),卻沒有錯誤`).toBeTruthy()
  expect(res.error.code, `${label}:${res.error.message}`).toBe(code)
}

test('鏈 20:服務憑證直寫估驗明細／來源／調整／確認量／期別狀態／計價依據與十三支寫入 RPC 全部被 DB 拒絕;旗標跨請求無效;狀態一列未變', async () => {
  // ── 0. 這把 key 的 role claim 就是 service_role(與 functions serve 注入 Edge 的 SUPABASE_SERVICE_ROLE_KEY 同一角色)
  const jwt = process.env.E2E_REAL_SERVICE_ROLE_KEY.trim()
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
  expect(claims.role).toBe('service_role')
  const svc = admin()
  const snapshot = async () => {
    const [items, confs, vals, basis, sources, adjustments] = await Promise.all([
      svc.from('valuation_items').select('cum_qty, backing').eq('valuation_id', valuationId),
      svc.from('inspection_confirmations').select('id, status, qty_cum').eq('project_id', projectId).order('created_at'),
      svc.from('valuations').select('id, status, invoice_date, paid_date').eq('project_id', projectId).order('period_no'),
      svc.from('work_item_pricing_basis').select('basis').eq('project_id', projectId),
      svc.from('valuation_item_sources').select('qty, kind').eq('project_id', projectId),
      svc.from('valuation_adjustments').select('id').eq('project_id', projectId),
    ])
    return { items: items.data, confs: confs.data, vals: vals.data, basis: basis.data, sources: sources.data, adjustments: adjustments.data }
  }
  const before = await snapshot()
  expect(before.items).toEqual([{ cum_qty: 60, backing: 'confirmed' }])
  expect(before.confs).toEqual([{ id: confirmationId, status: 'active', qty_cum: 60 }])
  expect(before.vals).toEqual([{ id: valuationId, status: '草稿', invoice_date: null, paid_date: null }])
  expect(before.basis).toEqual([])

  // ── 1. 估驗明細 / 來源分配 / 調整 ──────────────────────────────────────────────────────
  expectCode('valuation_items update', await svc.from('valuation_items').update({ cum_qty: 90 }).eq('valuation_id', valuationId).eq('work_item_id', wiId), 'VQ010')
  expectCode('valuation_items delete', await svc.from('valuation_items').delete().eq('valuation_id', valuationId), 'VQ010')
  const { data: v2Draft, error: v2Err } = await svc.from('valuations').insert({ project_id: projectId, period_no: 2, valuation_date: today, period_end: today, retention_pct: 5, status: '草稿', created_by: conId }).select('id').single()
  expect(v2Err, '建第 2 期草稿(草稿本身不在封堵範圍)').toBeNull()
  expectCode('valuation_items insert', await svc.from('valuation_items').insert({ valuation_id: v2Draft.id, work_item_id: wiId, cum_qty: 90 }), 'VQ010')
  expectCode('valuation_item_sources insert', await svc.from('valuation_item_sources').insert({ project_id: projectId, valuation_id: v2Draft.id, work_item_id: wiId, batch_key: 'a區', qty: 1, kind: 'confirmation', confirmation_id: confirmationId }), 'VQ010')
  expectCode('valuation_adjustments insert', await svc.from('valuation_adjustments').insert({ project_id: projectId, work_item_id: wiId, batch_key: 'a區', qty_delta: -1, reason: '服務憑證扣回' }), 'VQ010')

  // ── 2. 確認量:內容合法(確認人=本案監造)仍 VQ010;撤銷(連原因都填了)VQ010;刪除 VQ010 ──────────
  expectCode('inspection_confirmations insert', await svc.from('inspection_confirmations').insert({
    project_id: projectId, work_item_id: wiId, batch_key: 'B區', unit: 'M3', qty_cum: 30, basis: 'supervisor_certificate', confirmed_by: supId, reason: '服務憑證代簽',
  }), 'VQ010')
  expectCode('inspection_confirmations revoke', await svc.from('inspection_confirmations').update({ status: 'revoked', reason: '服務憑證撤銷' }).eq('id', confirmationId), 'VQ010')
  expectCode('inspection_confirmations delete', await svc.from('inspection_confirmations').delete().eq('id', confirmationId), 'VQ010')

  // ── 3. 期別狀態:直接建已核定、改狀態、登請款／撥款 ─────────────────────────────────────────
  expectCode('valuations insert 已核定', await svc.from('valuations').insert({ project_id: projectId, period_no: 3, valuation_date: today, period_end: today, retention_pct: 5, status: '已核定', created_by: conId }), 'VQ010')
  expectCode('valuations status 草稿→監造審核', await svc.from('valuations').update({ status: '監造審核' }).eq('id', valuationId), 'VQ010')
  expectCode('valuations status 草稿→已核定', await svc.from('valuations').update({ status: '已核定' }).eq('id', valuationId), 'VQ010')
  expectCode('valuations invoice_date', await svc.from('valuations').update({ invoice_date: today }).eq('id', valuationId), 'VQ010')
  expectCode('valuations paid', await svc.from('valuations').update({ paid_date: today, paid_amount: 1 }).eq('id', valuationId), 'VQ010')

  // ── 4. 計價依據 ───────────────────────────────────────────────────────────────────────────
  expectCode('work_item_pricing_basis insert', await svc.from('work_item_pricing_basis').insert({ work_item_id: wiId, project_id: projectId, basis: 'excluded' }), 'VQ010')

  // ── 5. 寫入 RPC 以服務憑證呼叫:auth.uid() 為 null → 登入／權限錯誤(不是「跑了但沒效果」)────────
  const rpcCases = [
    ['issue_supervisor_certificate', { p_project_id: projectId, p_work_item_id: wiId, p_batch_key: 'C區', p_location_label: 'C區', p_stage_key: null, p_unit: 'M3', p_qty_cum: 10, p_reason: 'x', p_client_request_id: 'c20-svc' }, 'VQ001'],
    ['set_valuation_item_cum', { p_valuation_id: valuationId, p_work_item_id: wiId, p_cum_qty: 90 }, 'VQ001'],
    ['transition_valuation', { p_valuation_id: valuationId, p_from: '草稿', p_to: '監造審核' }, 'VQ001'],
    ['sync_valuation_from_confirmations', { p_valuation_id: valuationId }, 'VQ001'],
    ['revoke_inspection_confirmation', { p_id: confirmationId, p_reason: 'x' }, 'VQ001'],
    ['set_work_item_pricing_basis', { p_work_item_id: wiId, p_basis: 'excluded' }, 'VQ001'],
    ['admin_adjust_valuation_item', { p_valuation_id: valuationId, p_work_item_id: wiId, p_cum_qty: 1, p_reason: 'x' }, 'VQ001'],
    ['void_valuation_adjustment', { p_id: valuationId, p_reason: 'x' }, 'VQ001'],
    ['sign_field_document', { p_document_id: valuationId, p_version_no: 1, p_content_hash: 'x', p_intent: 'x' }, 'PD006'],
    ['update_project_anchors', { p_project: projectId, p_anchors: { commencement_date: today }, p_change_kind: 'edit' }, 'P0001'],
    ['transition_obligation_period', { p_period: valuationId, p_status: '已完成' }, 'P0001'],
    ['review_requirement', { p_requirement_id: valuationId, p_decision: 'approve' }, 'P0001'],
    ['reset_project_boq', { p_project_id: projectId }, 'P0001'],
    ['import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS }, 'P0001'],
  ]
  for (const [fn, args, code] of rpcCases) {
    const res = await svc.rpc(fn, args)
    expectCode(`rpc ${fn}`, res, code)
    if (code === 'P0001') expect(res.error.message).toMatch(/not authenticated|請先登入/)
  }

  // ── 6. 旗標跨請求無效:先 rpc fn_cq_set_internal(true)(service_role 有執行權)再寫,仍 VQ010 ──────
  const flag = await svc.rpc('fn_cq_set_internal', { p_on: true })
  expect(flag.error).toBeNull()
  expectCode('開旗標後另一請求 update valuation_items', await svc.from('valuation_items').update({ cum_qty: 90 }).eq('valuation_id', valuationId).eq('work_item_id', wiId), 'VQ010')
  expectCode('開旗標後另一請求 insert inspection_confirmations', await svc.from('inspection_confirmations').insert({
    project_id: projectId, work_item_id: wiId, batch_key: 'B區', unit: 'M3', qty_cum: 30, basis: 'supervisor_certificate', confirmed_by: supId, reason: 'x',
  }), 'VQ010')

  // ── 7. 狀態一列未變;正確的人經 RPC 仍寫得進去(被拒的是憑證不是 payload) ─────────────────────
  const after = await snapshot()
  expect(after.items).toEqual(before.items)
  expect(after.confs).toEqual(before.confs)
  expect(after.vals.filter((v) => v.id === valuationId)).toEqual(before.vals)
  expect(after.basis).toEqual([])
  expect(after.sources).toEqual(before.sources)
  expect(after.adjustments).toEqual([])
  const s = await signInClient(supEmail)
  const { data: cert2, error: cert2Err } = await s.rpc('issue_supervisor_certificate', {
    p_project_id: projectId, p_work_item_id: wiId, p_batch_key: 'B區', p_location_label: 'B區', p_stage_key: null,
    p_unit: 'M3', p_qty_cum: 30, p_reason: '監造親簽(與服務憑證被拒的 payload 相同)', p_client_request_id: 'c20-req-2',
  })
  expect(cert2Err).toBeNull()
  expect(cert2.applied).toBe(true)
  const { data: basisRes, error: basisErr } = await s.rpc('set_work_item_pricing_basis', { p_work_item_id: wiId, p_basis: 'supervisor_certificate' })
  expect(basisErr).toBeNull()
  expect(basisRes.basis).toBe('supervisor_certificate')
  await s.auth.signOut()
  const { data: confsNow } = await svc.from('inspection_confirmations').select('batch_key, status, qty_cum').eq('project_id', projectId).order('created_at')
  expect(confsNow).toEqual([{ batch_key: 'a區', status: 'active', qty_cum: 60 }, { batch_key: 'b區', status: 'active', qty_cum: 30 }])
})
