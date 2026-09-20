// C2 包｜鏈 18:監造**直接在真實表單的格子裡**判定並填本次確認數量(真 Supabase、正式模式)。
//   C 包把廠商的兩份(施工日誌、自主檢查表)收成「一份 mapping、一張紙」;本鏈證明監造查驗紀錄表
//   (臺北市「施工抽查紀錄表」)也是同一件事,而且**格內編輯沒有放寬任何伺服器規則**:
//     監造在原表格子輸入實際抽查情形與本次確認數量 → 存檔 → 簽署 → 確認量寫入監造確認紀錄
//     → 廠商估驗頁可請該量、超過一點就被 VQ006 擋。
//   另外釘住待確認閘門:紙本實測欄抄錄進來的值只標 filled、沒有人親自確認就簽署,伺服器回 PD004
//   (needs_confirmation)——換版面不換這條規則;人在紙上按「確認」之後才簽得下去。
// 本鏈不需要照片辨識(不必另起 `supabase functions serve`);照片起稿路徑仍由鏈 6／鏈 10 涵蓋。
// 帳號與專案全部本次產生,afterAll 清乾淨。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup,
} from './helpers.js'

const PROJECT_NAME = `鏈18監造紙本-${Date.now().toString(36)}`
const conEmail = uniqueEmail('c18-con')
const supEmail = uniqueEmail('c18-sup')
let conId, supId, projectId, workItemId, inspectionId, templateId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: false, is_leaf: false, is_billable: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '鋼筋工程', unit: 'T', quantity: 200, unit_price: 30000, amount: 6000000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]
// 抽查標準只取本案核定的查驗表範本(臺北市範例檔的示例數值一律不入產品)
const TEMPLATE_ITEMS = [
  { no: '1', group: '綁紮', item: '主筋間距', kind: 'num', min: 0, max: 15, unit: 'cm', standard: '≤15cm', source: '本案結構圖說 S-12' },
  { no: '2', group: '綁紮', item: '施工前已通知監造', kind: 'bool', standard: '施工前通知' },
]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈十八廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十八監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '甲營造股份有限公司', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { data: wi } = await c.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.1').single()
  workItemId = wi.id
  const { error: inviteError } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' })
  if (inviteError) throw new Error(`邀請失敗:${inviteError.message}`)
  const { data: tpl, error: tplError } = await c.from('checklist_templates')
    .insert({ project_id: projectId, title: '鋼筋工程查驗表', source: '本案監造計畫', kind: 'inspection_form', items: TEMPLATE_ITEMS })
    .select('id').single()
  if (tplError) throw new Error(`建查驗表範本失敗:${tplError.message}`)
  templateId = tpl.id
  const { data: fm, error: fmError } = await c.from('projects').update({ formal_mode: true }).eq('id', projectId).select('id')
  if (fmError || !fm?.length) throw new Error(`開啟正式模式失敗:${fmError?.message || 'RLS 未生效'}`)
  // 廠商提出查驗申請:申報 80 T、位置 5F 柱牆(guard 由工項帶單位、由位置算批次鍵)
  const { data: insp, error: inspErr } = await c.from('inspections').insert({
    project_id: projectId, work_item_id: workItemId, title: '5F 柱牆鋼筋查驗', location: '5F 柱牆', inspection_type: '施工查驗',
    requested_date: today, declared_qty: 80, requested_by: conId, status: '待查驗',
  }).select('id, unit, batch_key, declared_qty').single()
  if (inspErr) throw new Error(`查驗申請失敗:${inspErr.message}`)
  inspectionId = insp.id
  expect(insp).toMatchObject({ unit: 'T', batch_key: '5f柱牆', declared_qty: 80 })
  await c.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
  )
})

test('鏈 18:監造在抽查紀錄表格子輸入本次確認數量 → 簽署 → 確認量寫入 → 廠商可請該量;抄錄值未親自確認簽署被 PD004 擋', async ({ page }) => {
  test.setTimeout(480_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })

  // ── 監造:由查驗申請直達,一開頁看到的就是臺北市「施工抽查紀錄表」本身 ─────────────────
  await loginReal(page, supEmail)
  await gotoHash(page, `/inspection-form?inspection=${inspectionId}`)
  await expect(page).toHaveURL(/#\/inspection-form\?doc=/, { timeout: 60_000 })
  const card = page.getByRole('group', { name: '本份監造查驗表單', exact: true })
  await expect(card.getByRole('heading', { level: 2, name: /施\s*工\s*抽\s*查\s*紀\s*錄\s*表/ })).toBeVisible({ timeout: 30_000 })
  await expect(card.getByText('參考臺北市格式', { exact: false })).toBeVisible()
  await expect(card.getByText('未經機關核定', { exact: false })).toBeVisible()
  // 原表欄名與符號說明;範例檔的示例數值與良好／不良範例判定不得出現
  await expect(card.getByText('設計圖說、規範之抽查標準（定性定量）')).toBeVisible()
  await expect(card.getByText('實際抽查情形（載明抽查數值及單位）')).toBeVisible()
  await expect(card.getByText('○ 檢查合格　╳ 有缺失需改正　／ 無此檢查項目')).toBeVisible()
  await expect(card.getByText('不良範例')).toHaveCount(0)
  await expect(card.getByText('4.5cm')).toHaveCount(0)
  // 專案資料自動帶入
  await expect(card.getByText('甲營造股份有限公司')).toBeVisible()

  // ── 在原表的格子裡逐欄輸入(欄名就是原表欄名)────────────────────────────────────
  await card.getByRole('textbox', { name: '編號' }).fill('S-115-018')
  await card.getByRole('textbox', { name: '分項工程名稱' }).fill('鋼筋工程')
  await expect(card.getByRole('heading', { level: 2, name: /鋼筋工程\s*施\s*工\s*抽\s*查\s*紀\s*錄\s*表/ })).toBeVisible()
  await card.getByRole('combobox', { name: '抽查時機' }).selectOption('檢驗停留點')
  await card.getByRole('combobox', { name: '查驗表範本' }).selectOption(templateId)
  // 查驗申請帶入的位置與申報量要逐項核對確認(確認前不能簽署)
  while (await card.getByRole('button', { name: '確認', exact: true }).count()) {
    await card.getByRole('button', { name: '確認', exact: true }).first().click()
  }
  await card.getByRole('spinbutton', { name: '1 主筋間距 實際抽查情形' }).fill('13')
  await card.getByRole('checkbox', { name: '2 施工前已通知監造 合格' }).check()
  await card.getByRole('radio', { name: '合格', exact: true }).check()
  await card.getByRole('spinbutton', { name: '本次確認數量' }).fill('80')
  const qtyBox = card.getByRole('group', { name: '確認數量' })
  await expect(qtyBox).toContainText('申報數量')
  await expect(qtyBox).toContainText('80 T')
  await expect(qtyBox).toContainText('簽署後累計')
  // 判定與確認量一致 → 畫面不再列出一致性問題(規則真的過了,不是把警示藏起來)
  await expect(card.getByRole('alert', { name: '判定與確認數量檢查' })).toHaveCount(0)
  await expect(saveStatus).toHaveText('未存檔')
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 1/)).toBeVisible({ timeout: 30_000 })

  // 內容確實是從紙上那些格子來的;簽署版本記得自己的表單範本版本
  const sup = await signInClient(supEmail)
  const { data: docs } = await sup.from('field_documents').select('id, status, current_version_no').eq('project_id', projectId).eq('doc_type', 'inspection_form')
  expect(docs).toHaveLength(1)
  const docId = docs[0].id
  const { data: v1 } = await sup.from('field_document_versions').select('content, field_sources, content_hash').eq('document_id', docId).eq('version_no', 1).single()
  expect(v1.content).toMatchObject({
    doc_no: 'S-115-018', subproject_name: '鋼筋工程', check_timing: '檢驗停留點',
    location: '5F 柱牆', unit: 'T', declared_qty: 80, verdict: '合格', confirmed_qty: 80, template_id: templateId,
  })
  expect(v1.content.results).toMatchObject({ 1: { value: 13 }, 2: { value: true } })
  expect(v1.content.form_template).toEqual({ key: 'taipei-inspection-ref', version: 1 })
  expect(v1.field_sources['results.1']).toEqual({ status: 'confirmed', source: 'human' })

  // ── 抄錄閘門:紙本實測欄抄錄進來的值只標 filled、沒人親自確認 → 簽署被 PD004 擋 ──────────
  const photoId = crypto.randomUUID()
  const copied = {
    ...v1.field_sources,
    'results.1': {
      status: 'filled', source: `record:${photoId}`, refs: [photoId],
      evidence: [{ photo_id: photoId, raw_text: '主筋間距 13 cm', unit: 'cm', kind: 'measured', label: '實測' }],
    },
  }
  const { data: s2, error: s2Err } = await sup.rpc('save_field_document_version', {
    p_document_id: docId, p_base_version_no: 1, p_content: v1.content, p_field_sources: copied, p_attachments: null,
  })
  if (s2Err) throw new Error(`存抄錄版本失敗:${s2Err.message}`)
  expect(s2.recheck).toEqual(expect.arrayContaining([{ key: 'results.1', status: 'needs_confirmation' }]))
  const { error: pd004 } = await sup.rpc('sign_field_document', { p_document_id: docId, p_version_no: 2, p_content_hash: s2.content_hash, p_intent: '簽' })
  expect(pd004?.code).toBe('PD004')
  expect(pd004?.details || '').toContain('needs_confirmation')

  // ── 人在紙上看得到原文、按「確認」後才簽得下去 ──────────────────────────────────
  await page.reload()
  await gotoHash(page, `/inspection-form?doc=${docId}`)
  await expect(card.getByText('紙上原文：主筋間距 13 cm')).toBeVisible({ timeout: 30_000 })
  await expect(card.getByText(/待補 1 項/)).toBeVisible()
  await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0)
  await card.getByRole('button', { name: '確認', exact: true }).first().click()
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 3，可簽署/)).toBeVisible({ timeout: 30_000 })
  const { data: v3 } = await sup.from('field_document_versions').select('content_hash, field_sources').eq('document_id', docId).eq('version_no', 3).single()
  // 確認只改狀態、不改值也不抹掉來源(稽核看得出是抄錄進來、人確認過)
  expect(v3.field_sources['results.1']).toMatchObject({ status: 'confirmed', source: `record:${photoId}` })

  // ── 簽署即判定:inspections 與 inspection_confirmations 在同一交易落庫 ─────────────────
  const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await expect(lifecycle.getByRole('note')).toContainText('可估驗的依據')
  await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
  await expect(lifecycle.getByText(/版本 3 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  const { data: insp } = await sup.from('inspections').select('status, confirmed_qty, declared_qty, document_id, document_version_no, inspected_by').eq('id', inspectionId).single()
  expect(insp).toMatchObject({ status: '合格', confirmed_qty: 80, declared_qty: 80, document_id: docId, document_version_no: 3, inspected_by: supId })
  const { data: confs } = await sup.from('inspection_confirmations').select('qty_cum, qty_delta, basis, batch_key, unit, status, inspection_id, confirmed_by').eq('project_id', projectId)
  expect(confs).toEqual([expect.objectContaining({ qty_cum: 80, qty_delta: 80, basis: 'inspection', batch_key: '5f柱牆', unit: 'T', status: 'active', inspection_id: inspectionId, confirmed_by: supId })])

  // ── 列印:同一張紙的純文字輸出(沒有任何輸入框),印的是簽署版本 ────────────────────────
  await gotoHash(page, `/inspection-form/print?doc=${docId}`)
  await expect(page.getByText(`內容雜湊 ${v3.content_hash.slice(0, 12)}`)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('■ 合格')).toBeVisible()
  await expect(page.locator('.paper input, .paper textarea, .paper select')).toHaveCount(0)
  await expect(page.getByText('草稿・未簽署')).toHaveCount(0)
  await page.getByRole('button', { name: '← 返回監造查驗表單' }).click()
  await expect(page).toHaveURL(/#\/inspection-form\?doc=/)
  await logoutReal(page)

  // ── 廠商:可估驗量＝監造確認的 80;估驗頁同步後累計 80,多一點就被 VQ006 擋 ─────────────
  const con = await signInClient(conEmail)
  const { data: backlog } = await con.rpc('list_billable_backlog', { p_project_id: projectId })
  expect(backlog).toHaveLength(1)
  expect(backlog[0]).toMatchObject({ work_item_id: workItemId, effective: 80, available: 80 })
  await loginReal(page, conEmail)
  await gotoHash(page, '/valuation')
  await page.getByRole('button', { name: '＋ 新增估驗期' }).click()
  await page.getByRole('dialog', { name: /建立第 1 期估驗/ }).getByRole('button', { name: '建立估驗期' }).click()
  await page.getByRole('button', { name: '同步確認量', exact: true }).click()
  await expect(page.getByText(/已依監造確認量同步/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('一 累計完成數量')).toHaveValue('80')
  const { data: periods } = await con.from('valuations').select('id').eq('project_id', projectId)
  const { error: vq006 } = await con.rpc('set_valuation_item_cum', { p_valuation_id: periods[0].id, p_work_item_id: workItemId, p_cum_qty: 81 })
  expect(vq006?.code).toBe('VQ006')

  // ── 廠商開同一份監造查驗表單:同一張紙、唯讀不長輸入框 ────────────────────────────
  await gotoHash(page, `/inspection-form?doc=${docId}`)
  await expect(page.getByText(/此頁為唯讀/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.paper input, .paper textarea, .paper select')).toHaveCount(0)
  await expect(page.getByRole('group', { name: '確認數量' })).toContainText('80 T')
  await sup.auth.signOut()
  await con.auth.signOut()
})
