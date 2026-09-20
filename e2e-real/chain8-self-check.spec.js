// P3b｜鏈 8:自主檢查表完整路徑(真 Supabase,正式模式,本機 Edge stub 模型)。
//   廠商建本案檢查表範本 → 上傳照片 → 伺服器起施工日誌＋自主檢查表草稿(範本依工項確定性挑選;每個項目待補、實測值不帶值)
//   → /site 現場文書清單直達 /self-check?doc= → 廠商親自填實測值與勾選 → 存檔 → 簽署(登入的平台帳號;checklist_records 落庫,
//   判定由 DB 算)→ 提出查驗申請檢附此表(既有查驗申請流程)→ 監造收件;另以 RPC 直打證明:實測值未填簽署回 PD004、
//   監造簽署回 PD006、簽後更正未填原因回 PD010、填原因重簽落為 Rev.1。
// 前置同 chain 5(docs/REAL_BACKEND_E2E.md):另一個 terminal `supabase functions serve --env-file e2e-real/stub.env`。
// 帳號全部本次產生;afterAll 以建立者 delete_project＋admin API 清帳號,殘留 0。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup, tinyJpeg,
} from './helpers.js'

const PROJECT_NAME = `鏈8自檢表-${Date.now().toString(36)}`
const conEmail = uniqueEmail('w6c8-con')
const supEmail = uniqueEmail('w6c8-sup')
let conId, supId, projectId, templateId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '假設工程', unit: '式', quantity: 1, unit_price: 1000, amount: 1000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
]
// 本案檢查表範本:B1 勾選、C2 坍度 15.5–20.5(只有一張 → 候選推斷直接用)
const TEMPLATE_ITEMS = [
  { no: 'B1', group: '澆置前', item: '澆置 24 小時前已通知監造', kind: 'bool', standard: '≥24 小時前通知' },
  { no: 'C2', group: '澆置中', item: '坍度', kind: 'num', min: 15.5, max: 20.5, unit: 'cm', standard: '18±2.5' },
]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈八廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈八監造')
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
  const { data: tpl, error: tplError } = await c.from('checklist_templates').insert({ project_id: projectId, title: '結構混凝土自主檢查表', source: '03310', items: TEMPLATE_ITEMS }).select('id').single()
  if (tplError) throw new Error(`建範本失敗:${tplError.message}`)
  templateId = tpl.id
  const { data: fm, error: fmError } = await c.from('projects').update({ formal_mode: true }).eq('id', projectId).select('id')
  if (fmError || !fm?.length) throw new Error(`開啟正式模式失敗:${fmError?.message || 'RLS 未生效'}`)
  await c.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
  )
})

test('鏈 8:廠商上傳→起自檢表草稿→補實測值→簽署(checklist_records 落庫、DB 判定)→檢附查驗申請→監造收件;實測值未填／監造簽署／更正無原因被伺服器擋', async ({ page }) => {
  test.setTimeout(420_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })

  // ── 廠商(一般登入):現場紀錄上傳一張照片 → 伺服器起施工日誌＋自主檢查表草稿(stub hint 配到「結構工程」) ──
  await loginReal(page, conEmail)
  await gotoHash(page, '/site')
  await expect(page.getByRole('heading', { level: 1, name: '現場紀錄' })).toBeVisible()
  await expect(page.getByRole('group', { name: '拍照／上傳' }).getByText('施工日誌／自主檢查表自動起稿')).toBeVisible()
  await page.getByLabel('選擇照片上傳').setInputFiles([{ name: 'site-a.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('sc-a') }])
  await expect(page.getByText('已保存到伺服器 1／1')).toBeVisible({ timeout: 60_000 })
  const uploadCard = page.getByRole('group', { name: '拍照／上傳' })
  await expect(uploadCard.getByText('已起稿').first()).toBeVisible({ timeout: 90_000 })
  await expect(uploadCard.getByText(/自主檢查表 \d{4}-\d{2}-\d{2}/)).toBeVisible()
  await expect(uploadCard.getByText(/尚未支援/)).toHaveCount(0)
  const con = await signInClient(conEmail)
  const { data: scDocs } = await con.from('field_documents').select('id, status, current_version_no, template_id, target_key').eq('project_id', projectId).eq('doc_type', 'self_check')
  expect(scDocs).toHaveLength(1)
  const docId = scDocs[0].id
  expect(scDocs[0]).toMatchObject({ status: 'pending_input', template_id: templateId, current_version_no: 1 })
  expect(scDocs[0].target_key).toMatch(/^\d{4}-\d{2}-\d{2}:/)
  // AI 版本:每個項目待補、實測值不帶值(任何照片都不能推定實測值)
  const { data: v1 } = await con.from('field_document_versions').select('content, field_sources').eq('document_id', docId).eq('version_no', 1).single()
  expect(v1.content.results).toEqual({ B1: { value: null }, C2: { value: null } })
  expect(v1.field_sources['results.C2'].status).toBe('pending')
  expect(v1.content.template).toEqual({ key: 'self_check_demo', version: 1 })

  // ── /site 現場文書清單直達自主檢查表頁 ─────────────────────────────────────────────
  const docCard = page.getByRole('group', { name: '現場文書' })
  await docCard.getByRole('link', { name: /自主檢查表/ }).click()
  await expect(page).toHaveURL(/#\/self-check\?doc=/)
  await expect(page.getByRole('heading', { level: 1, name: '自主檢查表' })).toBeVisible()
  const card = page.getByRole('group', { name: '本份自主檢查表', exact: true })
  await expect(card.getByText('示範範本').first()).toBeVisible()
  await expect(card.getByRole('note')).toContainText('非任何機關公定或法定格式')
  await expect(saveStatus).toHaveText(/已存檔.*版本 1/)
  await expect(card.getByText('已帶入・待核對・依工項挑選範本')).toBeVisible()
  await expect(card.getByText('已帶入・待核對・照片 AI 說明').first()).toBeVisible() // 工項來自照片配對(stub)
  await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0)
  // 先只勾 B1、坍度不填就存檔 → 伺服器 recheck 仍列 C2;以 RPC 直打簽署 → PD004(伺服器規則,不是前端擋)
  await card.getByRole('checkbox', { name: 'B1 澆置 24 小時前已通知監造 合格' }).check()
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 2，尚有 1 項待補或待確認/)).toBeVisible({ timeout: 30_000 })
  const { data: v2 } = await con.from('field_document_versions').select('content_hash').eq('document_id', docId).eq('version_no', 2).single()
  const { error: pd004 } = await con.rpc('sign_field_document', { p_document_id: docId, p_version_no: 2, p_content_hash: v2.content_hash, p_intent: '測試:實測值未填' })
  expect(pd004?.code).toBe('PD004')
  expect(JSON.parse(pd004.details)).toEqual(expect.arrayContaining([{ key: 'results.C2', status: 'pending' }]))
  // 監造簽廠商自檢表 → PD006
  const sup = await signInClient(supEmail)
  const { error: pd006 } = await sup.rpc('sign_field_document', { p_document_id: docId, p_version_no: 2, p_content_hash: v2.content_hash, p_intent: '測試:監造簽' })
  expect(pd006?.code).toBe('PD006')

  // ── 補實測值(親自填)→ 存檔 → 簽署 ─────────────────────────────────────────────
  await page.getByRole('spinbutton', { name: 'C2 坍度 實際檢查情形' }).fill('18')
  await expect(card.getByText('■ 全部合格')).toBeVisible()
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 3，可簽署/)).toBeVisible({ timeout: 30_000 })
  const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await expect(lifecycle.getByText(/版本 3・雜湊 [0-9a-f]{12}/)).toBeVisible()
  await expect(lifecycle.getByText('示範範本')).toBeVisible()
  await expect(lifecycle.getByText(/本人確認 .* 自主檢查表\(版本 3,內容雜湊 [0-9a-f]{12}\)/)).toBeVisible()
  await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
  await expect(lifecycle.getByText(/版本 3 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  await expect(lifecycle.getByText(/方式 平台帳號$/)).toBeVisible()
  const { data: signedDoc } = await con.from('field_documents').select('status, target_id, target_table').eq('id', docId).single()
  expect(signedDoc).toMatchObject({ status: 'signed', target_table: 'checklist_records' })
  const { data: rec } = await con.from('checklist_records').select('id, template_id, check_date, results, overall, rev, root_id, work_item_id, created_by').eq('id', signedDoc.target_id).single()
  expect(rec).toMatchObject({ template_id: templateId, check_date: today, overall: '合格', rev: 0, created_by: conId })
  expect(rec.results).toEqual({ B1: { value: true, pass: true }, C2: { value: 18, pass: true } })
  expect(rec.work_item_id).toBeTruthy() // stub 配到的「結構工程」
  // 列印:印簽署版本(版本 3、雜湊、示範框架、簽署者、DB 判定)
  await gotoHash(page, `/self-check/print?doc=${docId}`)
  await expect(page.getByText('框架【示範範本】self_check_demo v1')).toBeVisible({ timeout: 30_000 })
  const { data: v3 } = await con.from('field_document_versions').select('content_hash').eq('document_id', docId).eq('version_no', 3).single()
  await expect(page.getByText(`內容雜湊 ${v3.content_hash.slice(0, 12)}`)).toBeVisible()
  await expect(page.getByText(/簽署 鏈八廠商・/)).toBeVisible()
  await expect(page.getByText('草稿・未簽署')).toHaveCount(0)
  await page.getByRole('button', { name: '← 返回自主檢查表' }).click()
  await expect(page).toHaveURL(/#\/self-check\?doc=/)

  // ── 提出查驗申請(檢附此表):既有查驗申請流程預填檢附 → 送出 ─────────────────────────
  await page.getByRole('button', { name: '提出查驗申請（檢附此表）' }).click()
  await expect(page).toHaveURL(/#\/quality\?/)
  const attachSelect = page.getByLabel('檢附自主檢查表（選填）')
  await expect(attachSelect).toHaveValue(rec.id)
  await expect(attachSelect.locator('option:checked')).toContainText('已簽署文件 v3')
  await page.getByLabel('查驗項目').fill('結構混凝土澆置前查驗')
  await page.getByRole('button', { name: '送出查驗申請' }).click()
  await expect(page.getByText(/查驗申請「結構混凝土澆置前查驗」已送出，已檢附自主檢查表/)).toBeVisible({ timeout: 30_000 })
  const { data: insp } = await con.from('inspections').select('id, checklist_record_id, status').eq('project_id', projectId).single()
  expect(insp).toMatchObject({ checklist_record_id: rec.id, status: '待查驗' })
  // 回文件頁:已檢附於查驗;提送監造
  await gotoHash(page, `/self-check?doc=${docId}`)
  await expect(page.getByText(/已檢附於查驗「結構混凝土澆置前查驗」/)).toBeVisible({ timeout: 30_000 })
  const lifecycle2 = page.getByRole('region', { name: '文件狀態與簽署' })
  await lifecycle2.getByRole('button', { name: '提送給監造' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '提送', exact: true }).click()
  await expect(lifecycle2.getByText(/已提送給監造/)).toBeVisible({ timeout: 30_000 })
  await logoutReal(page)

  // ── 監造(1024):/site 待收件 → 開頁唯讀 → 收件;查驗詳情的檢附連到已簽署文件 ────────────
  await page.setViewportSize({ width: 1024, height: 800 })
  await loginReal(page, supEmail)
  await gotoHash(page, '/site')
  const supDocCard = page.getByRole('group', { name: '現場文書' })
  await expect(supDocCard.getByText('已提送・待收件')).toBeVisible({ timeout: 30_000 })
  await supDocCard.getByRole('link', { name: /自主檢查表/ }).click()
  await expect(page).toHaveURL(/#\/self-check\?doc=/)
  await expect(page.getByText(/此頁為唯讀/).first()).toBeVisible()
  await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '存檔', exact: true })).toHaveCount(0)
  const supLifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await supLifecycle.getByRole('button', { name: '收件', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '收件', exact: true }).click()
  await expect(supLifecycle.getByText(/監造已於 .* 收件（版本 3）/)).toBeVisible({ timeout: 30_000 })
  await gotoHash(page, `/quality?seg=inspections&inspection=${insp.id}`)
  await expect(page.getByRole('region', { name: '結構混凝土澆置前查驗 詳情' }).getByRole('button', { name: '附自主檢查表（已簽署 v3）' })).toBeVisible({ timeout: 30_000 })
  await logoutReal(page)

  // ── 簽後更正=修訂版次(RPC 直打):對方收件後不可再存版(PD008)——用第二份文件走更正:建立→簽→更正無原因 PD010→填原因重簽 Rev.1 ──
  const { data: doc2, error: d2Err } = await con.from('field_documents').insert({ id: crypto.randomUUID(), project_id: projectId, doc_type: 'self_check', doc_date: today, template_id: templateId }).select('id').single()
  if (d2Err) throw new Error(`建第二份自檢表失敗:${d2Err.message}`)
  const content = { ...v1.content, results: { B1: { value: true }, C2: { value: 18 } }, work_item_id: rec.work_item_id }
  const sources = { ...v1.field_sources, 'results.B1': { status: 'confirmed', source: 'human' }, 'results.C2': { status: 'confirmed', source: 'human' } }
  const { data: s1, error: s1Err } = await con.rpc('save_field_document_version', { p_document_id: doc2.id, p_base_version_no: 0, p_content: content, p_field_sources: sources, p_attachments: null })
  if (s1Err) throw new Error(`第二份存版失敗:${s1Err.message}`)
  expect(s1.status).toBe('draft')
  const { data: g1, error: g1Err } = await con.rpc('sign_field_document', { p_document_id: doc2.id, p_version_no: 1, p_content_hash: s1.content_hash, p_intent: '簽' })
  if (g1Err) throw new Error(`第二份簽署失敗:${g1Err.message}`)
  expect(g1.status).toBe('signed')
  const { data: s2 } = await con.rpc('save_field_document_version', { p_document_id: doc2.id, p_base_version_no: 1, p_content: { ...content, results: { B1: { value: true }, C2: { value: 30 } } }, p_field_sources: sources, p_attachments: null })
  expect(s2.amended_from_version).toBe(1)
  const { error: pd010 } = await con.rpc('sign_field_document', { p_document_id: doc2.id, p_version_no: 2, p_content_hash: s2.content_hash, p_intent: '簽' })
  expect(pd010?.code).toBe('PD010') // 更正沒有原因
  const { data: s3 } = await con.rpc('save_field_document_version', { p_document_id: doc2.id, p_base_version_no: 2, p_content: { ...content, results: { B1: { value: true }, C2: { value: 30 } } }, p_field_sources: sources, p_attachments: null, p_change_note: '複核坍度登載錯誤,更正為 30cm' })
  const { data: g3, error: g3Err } = await con.rpc('sign_field_document', { p_document_id: doc2.id, p_version_no: 3, p_content_hash: s3.content_hash, p_intent: '簽' })
  if (g3Err) throw new Error(`更正重簽失敗:${g3Err.message}`)
  const { data: rec2 } = await con.from('checklist_records').select('rev, supersedes_id, root_id, revision_reason, overall').eq('id', g3.target_id).single()
  expect(rec2).toMatchObject({ rev: 1, supersedes_id: g1.target_id, root_id: g1.target_id, revision_reason: '複核坍度登載錯誤,更正為 30cm', overall: '不合格' })
  const { data: defs } = await con.from('defects').select('title, status, source_checklist_record_id').eq('project_id', projectId)
  expect(defs).toEqual([expect.objectContaining({ title: '自主檢查不合格：結構混凝土自主檢查表', status: '開立', source_checklist_record_id: g1.target_id })])
  await sup.auth.signOut()
  await con.auth.signOut()
})
