// P3c｜鏈 10:監造查驗表單完整路徑——簽署即判定並寫入可估驗的確認量(真 Supabase,正式模式,本機 Edge stub 模型)。
//   廠商:自主檢查表以 RPC 簽署(checklist_records 落庫)→ 提出查驗申請(申報 100 M3、位置 3F 版牆、檢附自檢)
//   → 監造:上傳監造照片 → 伺服器起監造查驗表單草稿(查驗申請資料帶入待核對;判定與確認量留空 pending;不判合格、不填確認量)
//   → /site 現場文書清單直達 /inspection-form?doc= → 核對申請資料、判部分合格、本次確認 60、判定說明 → 存檔 → 簽署
//   (簽署前明示「可估驗依據」;inspections 判定＋確認量、inspection_confirmations 60、缺失同交易落庫)→ 列印頁印簽署版本
//   → 提送給施工廠商與機關(各一鈕)→ 以 RPC 直打:同版本重簽冪等、廠商簽署 PD006、改量重簽 PD008(先撤銷)
//   → 廠商估驗頁:建期、同步確認量 → 累計 60、來源展開列查驗與文件版本;RPC 設 61 回 VQ006(cap 60):其餘 40 不可請
//   → 廠商收件。前置同 chain 5(docs/REAL_BACKEND_E2E.md):另一個 terminal `supabase functions serve --env-file e2e-real/stub.env`;
//   本機 stack 已套用 20260919222000。帳號全部本次產生;afterAll 以建立者 delete_project＋admin API 清帳號,殘留 0。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup, tinyJpeg,
} from './helpers.js'

const PROJECT_NAME = `鏈10查驗表單-${Date.now().toString(36)}`
const conEmail = uniqueEmail('p3c10-con')
const supEmail = uniqueEmail('p3c10-sup')
let conId, supId, projectId, templateId, workItemId, recordId, inspectionId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: false, is_leaf: false, is_billable: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '結構工程', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]
const TEMPLATE_ITEMS = [
  { no: 'B1', group: '澆置前', item: '澆置 24 小時前已通知監造', kind: 'bool', standard: '≥24 小時前通知' },
  { no: 'C2', group: '澆置中', item: '坍度', kind: 'num', min: 15.5, max: 20.5, unit: 'cm', standard: '18±2.5' },
]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈十廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { data: wi } = await c.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.1').single()
  workItemId = wi.id
  const { error: inviteError } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' })
  if (inviteError) throw new Error(`邀請失敗:${inviteError.message}`)
  const { data: tpl, error: tplError } = await c.from('checklist_templates').insert({ project_id: projectId, title: '結構混凝土自主檢查表', source: '03310', items: TEMPLATE_ITEMS }).select('id').single()
  if (tplError) throw new Error(`建範本失敗:${tplError.message}`)
  templateId = tpl.id
  const { data: fm, error: fmError } = await c.from('projects').update({ formal_mode: true }).eq('id', projectId).select('id')
  if (fmError || !fm?.length) throw new Error(`開啟正式模式失敗:${fmError?.message || 'RLS 未生效'}`)

  // 廠商自主檢查表:RPC 直打簽署(chain 8 已走過 UI),落 checklist_records
  const { data: scDoc, error: scErr } = await c.from('field_documents').insert({ id: crypto.randomUUID(), project_id: projectId, doc_type: 'self_check', doc_date: today, template_id: templateId }).select('id').single()
  if (scErr) throw new Error(`建自檢表失敗:${scErr.message}`)
  const content = { check_date: today, template_id: templateId, template_title: '結構混凝土自主檢查表', template_source: '03310', work_item_id: workItemId, location: '3F 版牆', results: { B1: { value: true }, C2: { value: 18 } }, note: null, template: { key: 'self_check_demo', version: 1 }, photo_ids: [], unmatched_photo_ids: [] }
  const sources = { check_date: { status: 'confirmed', source: 'human' }, template_id: { status: 'confirmed', source: 'human' }, work_item_id: { status: 'confirmed', source: 'human' }, location: { status: 'confirmed', source: 'human' }, 'results.B1': { status: 'confirmed', source: 'human' }, 'results.C2': { status: 'confirmed', source: 'human' } }
  const { data: s1, error: s1Err } = await c.rpc('save_field_document_version', { p_document_id: scDoc.id, p_base_version_no: 0, p_content: content, p_field_sources: sources, p_attachments: null })
  if (s1Err) throw new Error(`自檢表存版失敗:${s1Err.message}`)
  const { data: g1, error: g1Err } = await c.rpc('sign_field_document', { p_document_id: scDoc.id, p_version_no: 1, p_content_hash: s1.content_hash, p_intent: '簽' })
  if (g1Err) throw new Error(`自檢表簽署失敗:${g1Err.message}`)
  recordId = g1.target_id
  // 查驗申請:申報 100 M3、位置 3F 版牆、檢附已簽署自檢(guard 由工項帶單位、由位置算批次鍵)
  const { data: insp, error: inspErr } = await c.from('inspections').insert({
    project_id: projectId, work_item_id: workItemId, title: '3F 版牆混凝土查驗', location: '3F 版牆', inspection_type: '施工查驗',
    requested_date: today, declared_qty: 100, checklist_record_id: recordId, requested_by: conId, status: '待查驗',
  }).select('id, unit, batch_key, declared_qty').single()
  if (inspErr) throw new Error(`查驗申請失敗:${inspErr.message}`)
  inspectionId = insp.id
  expect(insp).toMatchObject({ unit: 'M3', batch_key: '3f版牆', declared_qty: 100 })
  await c.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
  )
})

test('鏈 10:廠商自檢→申請查驗(申報 100)→監造上傳→起稿(判定留空)→核對、判部分合格、確認 60→簽署→列印→提送兩方;RPC:冪等／廠商拒簽／改量須撤銷;廠商估驗頁可請 60、其餘 40 不可請', async ({ page }) => {
  test.setTimeout(480_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })
  const sup = await signInClient(supEmail)
  const con = await signInClient(conEmail)

  // 未簽署前:可估驗量為 0(backlog 空)
  const { data: backlog0 } = await con.rpc('list_billable_backlog', { p_project_id: projectId })
  expect(backlog0).toEqual([])

  // ── 監造:現場紀錄上傳一張監造照片 → 伺服器起監造日誌＋監造查驗表單草稿(stub 配到「結構工程」;查驗申請日=今天) ──
  await loginReal(page, supEmail)
  await gotoHash(page, '/site')
  await expect(page.getByRole('group', { name: '拍照／上傳' }).getByText('監造日誌／查驗表單自動起稿')).toBeVisible()
  await page.getByLabel('選擇照片上傳').setInputFiles([{ name: 'insp-a.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('if-a') }])
  await expect(page.getByText('已保存到伺服器 1／1')).toBeVisible({ timeout: 60_000 })
  const uploadCard = page.getByRole('group', { name: '拍照／上傳' })
  await expect(uploadCard.getByText('已起稿').first()).toBeVisible({ timeout: 90_000 })
  await expect(uploadCard.getByText(/監造查驗表單 \d{4}-\d{2}-\d{2}/)).toBeVisible()
  await expect(uploadCard.getByText(/尚未支援/)).toHaveCount(0)
  const { data: ifDocs } = await sup.from('field_documents').select('id, status, current_version_no, target_key, doc_date').eq('project_id', projectId).eq('doc_type', 'inspection_form')
  expect(ifDocs).toHaveLength(1)
  const docId = ifDocs[0].id
  expect(ifDocs[0]).toMatchObject({ status: 'pending_input', target_key: inspectionId, current_version_no: 1, doc_date: today })
  // AI 版本:查驗申請資料帶入待核對;判定與確認量留空 pending(系統不替監造判定、不填確認量)
  const { data: v1 } = await sup.from('field_document_versions').select('content, field_sources').eq('document_id', docId).eq('version_no', 1).single()
  expect(v1.content).toMatchObject({ inspection_id: inspectionId, work_item_id: workItemId, location: '3F 版牆', unit: 'M3', declared_qty: 100, self_check_record_id: recordId, verdict: null, confirmed_qty: null, template: { key: 'inspection_form_demo', version: 1 } })
  expect(v1.field_sources.declared_qty).toMatchObject({ status: 'filled', source: `inspection:${inspectionId}` })
  expect(v1.field_sources.verdict.status).toBe('pending')
  expect(v1.field_sources.confirmed_qty.status).toBe('pending')

  // ── /site 現場文書清單直達監造查驗表單頁 ─────────────────────────────────────────────
  const docCard = page.getByRole('group', { name: '現場文書' })
  await docCard.getByRole('link', { name: /監造查驗表單/ }).click()
  await expect(page).toHaveURL(/#\/inspection-form\?doc=/)
  await expect(page.getByRole('heading', { level: 1, name: '監造查驗表單' })).toBeVisible()
  const card = page.getByRole('group', { name: '本份監造查驗表單', exact: true })
  await expect(card.getByText('示範範本').first()).toBeVisible()
  await expect(card.getByRole('note').first()).toContainText('非任何機關公定或法定格式')
  await expect(saveStatus).toHaveText(/已存檔.*版本 1/)
  await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0)
  // 確認數量區並列申報量、單位、已確認累計、本次確認
  const qtyBox = page.getByRole('group', { name: '確認數量' })
  await expect(qtyBox).toContainText('申報數量')
  await expect(qtyBox).toContainText('100 M3')
  await expect(qtyBox).toContainText('此批次已確認累計')
  await expect(qtyBox).toContainText('0 M3')
  // 核對查驗申請帶入的位置與申報量(逐項「確認」),判部分合格、本次確認 60、填判定說明
  while (await page.getByRole('button', { name: '確認', exact: true }).count()) await page.getByRole('button', { name: '確認', exact: true }).first().click()
  await page.getByRole('radio', { name: '部分合格' }).check()
  await page.getByRole('spinbutton', { name: '本次確認數量' }).fill('60')
  await expect(qtyBox).toContainText('簽署後累計')
  await expect(qtyBox).toContainText('60 M3')
  await page.getByRole('textbox', { name: '判定說明' }).fill('版牆東側 40 M3 蜂窩待修補')
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 2，可簽署/)).toBeVisible({ timeout: 30_000 })
  // 廠商簽監造查驗表單 → PD006(伺服器規則)
  const { data: v2 } = await sup.from('field_document_versions').select('content_hash').eq('document_id', docId).eq('version_no', 2).single()
  const { error: pd006 } = await con.rpc('sign_field_document', { p_document_id: docId, p_version_no: 2, p_content_hash: v2.content_hash, p_intent: '測試:廠商簽' })
  expect(pd006?.code).toBe('PD006')

  // ── 簽署:簽署前明示可估驗依據;簽署即判定＋確認量落庫 ───────────────────────────────────
  const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await expect(lifecycle.getByRole('note')).toContainText('可估驗的依據')
  await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('可估驗的依據')
  await dialog.getByRole('button', { name: '簽署', exact: true }).click()
  await expect(lifecycle.getByText(/版本 2 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  await expect(lifecycle.getByText(/本次確認 60 M3 已寫入監造確認紀錄/)).toBeVisible()
  const { data: insp } = await sup.from('inspections').select('status, confirmed_qty, declared_qty, document_id, document_version_no, inspected_by').eq('id', inspectionId).single()
  expect(insp).toMatchObject({ status: '部分合格', confirmed_qty: 60, declared_qty: 100, document_id: docId, document_version_no: 2, inspected_by: supId })
  const { data: confs } = await sup.from('inspection_confirmations').select('qty_cum, qty_delta, basis, batch_key, unit, status, inspection_id, document_id, document_version_no, confirmed_by').eq('project_id', projectId)
  expect(confs).toEqual([expect.objectContaining({ qty_cum: 60, qty_delta: 60, basis: 'inspection', batch_key: '3f版牆', unit: 'M3', status: 'active', inspection_id: inspectionId, document_id: docId, document_version_no: 2, confirmed_by: supId })])
  const { data: defs } = await sup.from('defects').select('title, status, inspection_id, description').eq('project_id', projectId)
  expect(defs).toEqual([expect.objectContaining({ title: '查驗部分合格：3F 版牆混凝土查驗', status: '開立', inspection_id: inspectionId })])
  expect(defs[0].description).toContain('差額 40')
  // 同人同版本重簽 → 冪等,不重複累加
  const { data: again } = await sup.rpc('sign_field_document', { p_document_id: docId, p_version_no: 2, p_content_hash: v2.content_hash, p_intent: '簽' })
  expect(again.idempotent).toBe(true)
  const { count: confCount } = await sup.from('inspection_confirmations').select('id', { count: 'exact', head: true }).eq('project_id', projectId)
  expect(confCount).toBe(1)

  // ── 列印:印簽署版本(示範範本、雜湊、部分合格、確認 60) ──────────────────────────────────
  await gotoHash(page, `/inspection-form/print?doc=${docId}`)
  await expect(page.getByText('框架【示範範本】inspection_form_demo v1')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(`內容雜湊 ${v2.content_hash.slice(0, 12)}`)).toBeVisible()
  await expect(page.getByText(/簽署 鏈十監造・/)).toBeVisible()
  await expect(page.getByText('■ 部分合格')).toBeVisible()
  await expect(page.getByText('草稿・未簽署')).toHaveCount(0)
  await page.getByRole('button', { name: '← 返回監造查驗表單' }).click()
  await expect(page).toHaveURL(/#\/inspection-form\?doc=/)

  // ── 提送:廠商與機關各一鈕 ────────────────────────────────────────────────────────
  const lifecycle2 = page.getByRole('region', { name: '文件狀態與簽署' })
  await lifecycle2.getByRole('button', { name: '提送給施工廠商' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '提送', exact: true }).click()
  await expect(lifecycle2.getByText(/已提送給施工廠商/)).toBeVisible({ timeout: 30_000 })
  await expect(lifecycle2.getByRole('button', { name: '提送給機關' })).toBeVisible()
  await lifecycle2.getByRole('button', { name: '提送給機關' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '提送', exact: true }).click()
  await expect(lifecycle2.getByText(/已提送給機關/)).toBeVisible({ timeout: 30_000 })
  await expect(lifecycle2.getByRole('button', { name: /提送給/ })).toHaveCount(0)
  await logoutReal(page)

  // ── RPC 直打:簽後改量(70)重簽 → PD008 先撤銷;撤銷後重簽成功、確認量 70 ──────────────────
  const content2 = { ...v1.content, location: '3F 版牆', declared_qty: 100, verdict: '部分合格', confirmed_qty: 70, result_note: '複核後東側 30 M3 待修補' }
  const sources2 = { ...v1.field_sources, location: { status: 'confirmed', source: 'human' }, declared_qty: { status: 'confirmed', source: 'human' }, verdict: { status: 'confirmed', source: 'human' }, confirmed_qty: { status: 'confirmed', source: 'human' } }
  const { data: s3, error: s3Err } = await sup.rpc('save_field_document_version', { p_document_id: docId, p_base_version_no: 2, p_content: content2, p_field_sources: sources2, p_attachments: v1.content.photo_ids?.length ? undefined : null, p_change_note: '複核改量' })
  if (s3Err) throw new Error(`更正存版失敗:${s3Err.message}`)
  const { error: pd008 } = await sup.rpc('sign_field_document', { p_document_id: docId, p_version_no: 3, p_content_hash: s3.content_hash, p_intent: '簽' })
  expect(pd008?.code).toBe('PD008')
  const { data: revoked, error: rvErr } = await sup.rpc('revoke_inspection_confirmation', { p_id: (await sup.from('inspection_confirmations').select('id').eq('project_id', projectId).eq('status', 'active').single()).data.id, p_reason: '複核改量' })
  if (rvErr) throw new Error(`撤銷失敗:${rvErr.message}`)
  expect(revoked.applied).toBe(true)
  const { data: g3, error: g3Err } = await sup.rpc('sign_field_document', { p_document_id: docId, p_version_no: 3, p_content_hash: s3.content_hash, p_intent: '簽' })
  if (g3Err) throw new Error(`撤銷後重簽失敗:${g3Err.message}`)
  expect(g3.status).toBe('signed')
  const { data: confs2 } = await sup.from('inspection_confirmations').select('qty_cum, qty_delta, status').eq('project_id', projectId).order('created_at')
  expect(confs2).toEqual([{ qty_cum: 60, qty_delta: 60, status: 'revoked' }, { qty_cum: 70, qty_delta: 70, status: 'active' }])
  const { data: insp2 } = await sup.from('inspections').select('confirmed_qty, document_version_no').eq('id', inspectionId).single()
  expect(insp2).toMatchObject({ confirmed_qty: 70, document_version_no: 3 })
  // 廠商 backlog:可估驗 70
  const { data: backlog } = await con.rpc('list_billable_backlog', { p_project_id: projectId })
  expect(backlog).toHaveLength(1)
  expect(backlog[0]).toMatchObject({ work_item_id: workItemId, effective: 70, available: 70 })

  // ── 廠商估驗頁:建期 → 同步確認量 → 累計 70;來源展開列查驗與文件版本;設 71 回 VQ006(其餘 30 不可請) ────
  await loginReal(page, conEmail)
  await gotoHash(page, '/valuation')
  await page.getByRole('button', { name: '＋ 新增估驗期' }).click()
  await page.getByRole('dialog', { name: /建立第 1 期估驗/ }).getByRole('button', { name: '建立估驗期' }).click()
  const tab1 = page.getByRole('button', { name: /第 1 期/ })
  await expect(tab1.getByText('草稿')).toBeVisible()
  await page.getByRole('button', { name: '同步確認量', exact: true }).click()
  await expect(page.getByText(/已依監造確認量同步/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('一 累計完成數量')).toHaveValue('70')
  await page.getByRole('button', { name: /來源 1 筆/ }).click()
  const srcGroup = page.getByRole('group', { name: '一 來源' })
  await expect(srcGroup).toContainText('批次 3F 版牆')
  await expect(srcGroup.getByRole('link', { name: /3F 版牆混凝土查驗/ })).toBeVisible()
  await expect(srcGroup.getByRole('link', { name: /文件版本 v3/ })).toBeVisible()
  const { data: periods } = await con.from('valuations').select('id').eq('project_id', projectId)
  const { error: vq006 } = await con.rpc('set_valuation_item_cum', { p_valuation_id: periods[0].id, p_work_item_id: workItemId, p_cum_qty: 71 })
  expect(vq006?.code).toBe('VQ006')
  expect(vq006?.message).toContain('71')
  // 廠商收件監造查驗表單(對方版本已更正到 v3,原提送綁 v2;此處只驗廠商可開頁唯讀並看到判定)
  await gotoHash(page, `/inspection-form?doc=${docId}`)
  await expect(page.getByText(/此頁為唯讀/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
  await expect(page.getByRole('group', { name: '確認數量' })).toContainText('70 M3')
  await sup.auth.signOut()
  await con.auth.signOut()
})
