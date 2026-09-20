// P3g｜鏈 16:監造查驗表單範本的建立介面 ＋ 範本適用條件參與候選推斷 ＋ 舊快速判定查驗的更正入口
//   (真 Supabase,正式模式,本機 Edge stub 模型)。
//   監造:品質查驗「檢查表」分段建立 kind='inspection_form' 的查驗表單範本(用途、適用工項、檢查項目;
//   伺服器編版本、正規化適用條件)→ 廠商建同類範本被 CT006 擋下(範本是監造的文書,不新增角色)
//   → 廠商提出查驗申請(結構工程,申報 100 M3)→ 監造上傳照片 → 伺服器起查驗表單草稿:兩張查驗表範本中,
//   標題較相近的那張因為「指名了別的工項」被排除,挑到的是指名本工項的那張(applies_to 真的參與推斷)
//   → 監造簽署即判定、寫入可估驗確認量
//   → 舊流程快速判定的查驗(service 直寫,沒有簽署文件也沒有確認量):品質查驗詳情出現「以查驗表單更正判定」,
//   點下去建立該查驗的表單草稿,簽署後成為正式判定,舊紀錄照樣查得到。
//   表單頁的逐項核對與 UI 簽署已由 chain 10 走過,本鏈的簽署走 RPC(同一支 sign_field_document),
//   只驗本鏈新增的行為:範本建立介面、候選推斷用到 applies_to、舊判定的更正入口。
// 前置同 chain 5／10(docs/REAL_BACKEND_E2E.md):另一個 terminal `supabase functions serve --env-file e2e-real/stub.env`;
// 本機 stack 已套用 20260920050000。帳號全部本次產生;afterAll 以建立者 delete_project＋admin API 清帳號,殘留 0。
import { test, expect } from '@playwright/test'
import {
  admin, uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, gotoHash, runCleanup, tinyJpeg,
} from './helpers.js'

const PROJECT_NAME = `鏈16查驗範本-${Date.now().toString(36)}`
const conEmail = uniqueEmail('p3g16-con')
const supEmail = uniqueEmail('p3g16-sup')
let conId, supId, projectId, structId, formworkId, inspectionId, legacyInspectionId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: false, is_leaf: false, is_billable: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '結構工程', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '版模工程', unit: 'M2', quantity: 300, unit_price: 200, amount: 60000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈十六廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十六監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { data: wis } = await c.from('work_items').select('id, item_key').eq('project_id', projectId).in('item_key', ['1.1', '1.2'])
  structId = wis.find((w) => w.item_key === '1.1').id
  formworkId = wis.find((w) => w.item_key === '1.2').id
  const { error: inviteError } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' })
  if (inviteError) throw new Error(`邀請失敗:${inviteError.message}`)
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

test('鏈 16:監造建查驗表單範本(指名工項)→廠商建同類範本被擋→查驗申請→起稿挑到指名的那張→簽署判定;舊快速判定查驗可建更正表單', async ({ page }) => {
  test.setTimeout(600_000)
  const sup = await signInClient(supEmail)
  const con = await signInClient(conEmail)

  // ── 1. 監造在品質查驗「檢查表」分段建立查驗表單範本(P3g 之前只能用 API 建) ─────────────────
  await loginReal(page, supEmail)
  await gotoHash(page, '/quality?seg=checklist')
  const tplCard = page.getByRole('group', { name: /檢查表範本/ })
  await expect(tplCard).toBeVisible({ timeout: 30_000 })
  await tplCard.getByRole('button', { name: '新增範本' }).click()
  const form = page.getByRole('group', { name: '範本編輯' })
  await form.getByRole('combobox', { name: '範本用途' }).selectOption('inspection_form')
  await form.getByRole('textbox', { name: '標題（必填）' }).fill('甲表')
  await form.getByRole('textbox', { name: '依據（選填）' }).fill('ITP-01')
  // 適用工項:指名「結構工程」——這是候選推斷的硬條件,不是標題猜的
  await form.getByPlaceholder('搜尋並加入適用工項…').fill('結構工程')
  await form.getByRole('button', { name: /結構工程/ }).click()
  await expect(form).toContainText('目前會配到 1 個工項')
  await form.getByRole('textbox', { name: '第 1 項項次' }).fill('S1')
  await form.getByRole('textbox', { name: '第 1 項檢查內容' }).fill('鋼筋保護層符合圖說')
  await form.getByRole('button', { name: '建立範本' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: '甲表' })).toContainText('監造查驗表單', { timeout: 30_000 })

  const { data: tpls } = await sup.from('checklist_templates').select('id, title, kind, source, version, stage_key, applies_to, items').eq('project_id', projectId)
  expect(tpls).toHaveLength(1)
  const rightTpl = tpls[0]
  expect(rightTpl).toMatchObject({
    title: '甲表', kind: 'inspection_form', source: 'ITP-01', version: 1, stage_key: null,
    applies_to: { work_item_ids: [structId] },
  })
  expect(rightTpl.items).toEqual([{ no: 'S1', item: '鋼筋保護層符合圖說', kind: 'bool' }])
  // 清單上如實說出適用範圍(指名了哪個工項)
  await expect(page.getByRole('listitem').filter({ hasText: '甲表' })).toContainText('指名工項：一 結構工程')

  // 標題與「結構工程」高度相符、卻指名了別的工項的另一張範本:候選推斷必須排除它
  const { data: wrongTpl, error: wrongErr } = await sup.from('checklist_templates').insert({
    project_id: projectId, title: '結構工程 監造查驗表', kind: 'inspection_form',
    items: [{ no: 'X1', item: '不該被挑到', kind: 'bool' }], applies_to: { work_item_ids: [formworkId] },
  }).select('id').single()
  if (wrongErr) throw new Error(`建對照範本失敗:${wrongErr.message}`)

  // 廠商不能建立／編輯監造查驗表單範本(CT006;自主檢查表範本照舊可建)
  const { error: ct006 } = await con.from('checklist_templates').insert({
    project_id: projectId, title: '廠商偷改的查驗表', kind: 'inspection_form', items: [{ no: 'A1', item: '放水', kind: 'bool' }],
  })
  expect(ct006?.message).toContain('監造查驗表單範本只有監造成員可建立或編輯')
  const { error: ct006b } = await con.from('checklist_templates').update({ applies_to: null }).eq('id', rightTpl.id)
  expect(ct006b?.message).toContain('監造查驗表單範本只有監造成員可建立或編輯')
  const { error: scOk } = await con.from('checklist_templates').insert({
    project_id: projectId, title: '結構混凝土 自主檢查表', items: [{ no: 'B1', item: '模板無積水', kind: 'bool' }],
  })
  expect(scOk).toBeNull()

  // ── 2. 廠商提出查驗申請(結構工程,申報 100 M3) ─────────────────────────────────────────
  const { data: insp, error: inspErr } = await con.from('inspections').insert({
    project_id: projectId, work_item_id: structId, title: '3F 版牆結構查驗', location: '3F 版牆', inspection_type: '施工查驗',
    requested_date: today, declared_qty: 100, requested_by: conId, status: '待查驗',
  }).select('id, unit, batch_key').single()
  if (inspErr) throw new Error(`查驗申請失敗:${inspErr.message}`)
  inspectionId = insp.id
  expect(insp).toMatchObject({ unit: 'M3', batch_key: '3f版牆' })

  // ── 3. 監造上傳照片 → 伺服器起查驗表單草稿,範本由 applies_to 挑出(不是標題猜的) ────────────
  await gotoHash(page, '/site')
  await page.getByLabel('選擇照片上傳').setInputFiles([{ name: 'insp-16.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('c16-a') }])
  await expect(page.getByText('已保存到伺服器 1／1')).toBeVisible({ timeout: 60_000 })
  const uploadCard = page.getByRole('group', { name: '拍照／上傳' })
  await expect(uploadCard.getByText(/監造查驗表單 \d{4}-\d{2}-\d{2}/)).toBeVisible({ timeout: 90_000 })
  await expect(uploadCard).toContainText('範本指名此工項')

  const { data: ifDocs } = await sup.from('field_documents').select('id, status, current_version_no, target_key').eq('project_id', projectId).eq('doc_type', 'inspection_form')
  expect(ifDocs).toHaveLength(1)
  const docId = ifDocs[0].id
  expect(ifDocs[0]).toMatchObject({ status: 'pending_input', target_key: inspectionId, current_version_no: 1 })
  const { data: v1 } = await sup.from('field_document_versions').select('content, field_sources').eq('document_id', docId).eq('version_no', 1).single()
  expect(v1.content.template_id).toBe(rightTpl.id)
  expect(v1.content.template_id).not.toBe(wrongTpl.id)
  expect(v1.content.template_title).toBe('甲表')
  expect(v1.content.results).toEqual({ S1: { value: null } })
  // 判定與確認量永遠留空(P3c 紅線,不因為有範本就被系統填)
  expect(v1.content.verdict).toBeNull()
  expect(v1.content.confirmed_qty).toBeNull()

  // ── 4. 監造簽署即判定(UI 逐項核對見 chain 10;這裡走同一支 RPC) ────────────────────────────
  const content2 = {
    ...v1.content, location: '3F 版牆', declared_qty: 100, verdict: '合格', confirmed_qty: 100,
    results: { S1: { value: true } }, result_note: null,
  }
  const sources2 = {
    ...v1.field_sources,
    location: { status: 'confirmed', source: 'human' }, declared_qty: { status: 'confirmed', source: 'human' },
    unit: { status: 'confirmed', source: 'human' }, work_item_id: { status: 'confirmed', source: 'human' },
    verdict: { status: 'confirmed', source: 'human' }, confirmed_qty: { status: 'confirmed', source: 'human' },
    'results.S1': { status: 'confirmed', source: 'human' },
  }
  const { data: s2, error: s2Err } = await sup.rpc('save_field_document_version', { p_document_id: docId, p_base_version_no: 1, p_content: content2, p_field_sources: sources2, p_attachments: null })
  if (s2Err) throw new Error(`存版失敗:${s2Err.message}`)
  const { error: signErr } = await sup.rpc('sign_field_document', { p_document_id: docId, p_version_no: s2.version_no, p_content_hash: s2.content_hash, p_intent: '簽' })
  if (signErr) throw new Error(`簽署失敗:${signErr.message}`)
  const { data: signed } = await sup.from('inspections').select('status, confirmed_qty, template_id, results, document_id, inspected_by').eq('id', inspectionId).single()
  expect(signed).toMatchObject({ status: '合格', confirmed_qty: 100, template_id: rightTpl.id, document_id: docId, inspected_by: supId })
  expect(signed.results).toEqual({ S1: { value: true, pass: true } })
  // 範本一旦被查驗引用就不可再改內容(改了等於改動已簽署紀錄的呈現);適用條件仍可調
  const { error: ct008 } = await sup.from('checklist_templates').update({ items: [{ no: 'S1', item: '放寬後的項目', kind: 'bool' }] }).eq('id', rightTpl.id)
  expect(ct008?.message).toContain('不可再更改')
  const { error: stillOk } = await sup.from('checklist_templates').update({ applies_to: { work_item_ids: [structId], keywords: ['結構'] } }).eq('id', rightTpl.id)
  expect(stillOk).toBeNull()
  const { error: delBlocked } = await sup.from('checklist_templates').delete().eq('id', rightTpl.id)
  expect(delBlocked?.message).toContain('不可刪除')

  // ── 5. 舊流程快速判定的查驗:沒有簽署文件也沒有確認量,P3g 之前沒有任何更正入口 ────────────────
  const a = admin()
  const { data: legacy, error: legacyErr } = await a.from('inspections').insert({
    project_id: projectId, work_item_id: structId, title: '2F 版牆結構查驗（舊）', location: '2F 版牆',
    inspection_type: '施工查驗', requested_date: today, status: '合格', inspected_by: supId, inspected_at: new Date().toISOString(),
  }).select('id, status, confirmed_qty, document_id').single()
  if (legacyErr) throw new Error(`建舊判定查驗失敗:${legacyErr.message}`)
  legacyInspectionId = legacy.id
  expect(legacy).toMatchObject({ status: '合格', confirmed_qty: null, document_id: null })

  await gotoHash(page, '/quality')
  await page.reload() // 這筆是 service 直寫的,store 不會自己重抓;整頁重載才讀得到
  const row = page.getByRole('listitem').filter({ hasText: '2F 版牆結構查驗（舊）' })
  await expect(row).toBeVisible({ timeout: 60_000 })
  await row.click()
  const detail = page.getByRole('region', { name: '2F 版牆結構查驗（舊） 詳情' })
  await expect(detail).toContainText('（舊流程快速判定，未填確認數量）')
  await detail.getByRole('button', { name: /以查驗表單更正判定/ }).click()
  await expect(page).toHaveURL(/#\/inspection-form\?doc=/, { timeout: 60_000 })
  await expect(page.getByRole('heading', { level: 1, name: '監造查驗表單' })).toBeVisible()

  // 由查驗申請建立的表單只建文件本體(版本 0),內容在表單頁填完存檔才成為版本 1——與待查驗的路徑完全一樣
  const { data: fixDocs } = await sup.from('field_documents').select('id, target_key, status, current_version_no, doc_date').eq('project_id', projectId).eq('doc_type', 'inspection_form').eq('target_key', legacyInspectionId)
  expect(fixDocs).toHaveLength(1)
  expect(fixDocs[0]).toMatchObject({ status: 'draft', current_version_no: 0, doc_date: today })
  const fixId = fixDocs[0].id

  // 更正表單簽署後即為正式判定:舊紀錄補上確認量與簽署文件,判定說明與判定都來自這次簽署
  const fixContent = {
    inspection_date: today, inspection_id: legacyInspectionId, inspection_title: '2F 版牆結構查驗（舊）',
    work_item_id: structId, location: '2F 版牆', stage_key: null, unit: 'M3', declared_qty: 50,
    self_check_record_id: null, template_id: rightTpl.id, template_title: '甲表',
    results: { S1: { value: true } }, verdict: '部分合格', confirmed_qty: 30,
    result_note: '舊判定補正:實際僅 30 M3 通過', note: null,
    template: v1.content.template, photo_ids: [], unmatched_photo_ids: [],
  }
  const human = { status: 'confirmed', source: 'human' }
  const fixSources = {
    inspection_date: human, inspection_id: human, work_item_id: human, location: human, unit: human,
    declared_qty: human, template_id: human, 'results.S1': human, verdict: human, confirmed_qty: human, result_note: human,
  }
  const { data: fs2, error: fs2Err } = await sup.rpc('save_field_document_version', { p_document_id: fixId, p_base_version_no: 0, p_content: fixContent, p_field_sources: fixSources, p_attachments: null })
  if (fs2Err) throw new Error(`更正表單存版失敗:${fs2Err.message}`)
  const { error: fixSignErr } = await sup.rpc('sign_field_document', { p_document_id: fixId, p_version_no: fs2.version_no, p_content_hash: fs2.content_hash, p_intent: '簽' })
  if (fixSignErr) throw new Error(`更正表單簽署失敗:${fixSignErr.message}`)
  const { data: fixed } = await sup.from('inspections').select('status, confirmed_qty, declared_qty, document_id, result_note').eq('id', legacyInspectionId).single()
  expect(fixed).toMatchObject({ status: '部分合格', confirmed_qty: 30, declared_qty: 50, document_id: fixId })
  expect(fixed.result_note).toContain('舊判定補正')
  // 舊紀錄保留可查:這筆查驗沒有被刪、仍是同一列(id 不變),只是補上了正式判定
  const { count } = await sup.from('inspections').select('id', { count: 'exact', head: true }).eq('project_id', projectId)
  expect(count).toBe(2)
  // 更正後廠商才拿得到可估驗量(舊判定原本一毛都請不到)
  const { data: backlog } = await con.rpc('list_billable_backlog', { p_project_id: projectId })
  const struct = backlog.find((b) => b.work_item_id === structId)
  expect(struct).toMatchObject({ effective: 130, available: 130 })

  await sup.auth.signOut()
  await con.auth.signOut()
})
