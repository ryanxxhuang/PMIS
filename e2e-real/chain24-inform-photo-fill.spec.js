// 鏈 24:表內上傳「上傳照片,AI 填表」(2026-09-21 demo 第一優先;真 Supabase＋本機 Edge stub)。
//   施工日誌頁:先手填一格 → 表內上傳一張工地照(stub `site`,hint 配到「結構工程」)→ 系統先存一版建文件、再上傳、
//   Edge 只為這份文件留建議(不寫版本、不起自檢表)→ 結果直接填進表上(摘要、工項列;手填的天氣不覆蓋)→ 手改一格 →
//   存檔(版本 2,建議標 accepted)→ 重新整理仍在 → 同一張照片再上傳(本案已有同內容)仍能填表且**不重新呼叫模型**
//   (用量事件不增加、辨識結果沿用)→ 未存檔按列印 → 「儲存後下載」→ 列印頁下載 PDF 含改後值。
//   自主檢查表頁:新建(日期改成紙上日期)→ 先手填 A1 單一值 → 表內上傳紙表(stub paper_form_line_a)→ 系統建文件 →
//   A2 的兩筆讀數(編號、兩向、單位)出現在實際檢查情形格、A1 手填值不覆蓋、工項由照片多數決帶入 → 逐項確認、勾 B1 →
//   存檔 → 重整仍在 → 列印頁 PDF 印讀數。
//   stub 只證明流程,不證明辨識正確(同 chain 21)。前置:`supabase functions serve --env-file e2e-real/stub.env`。
import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPdf } from '../e2e/pdfText.js'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, gotoHash, runCleanup, tinyJpeg, dbaSql,
} from './helpers.js'

const PROJECT_NAME = `鏈24表內上傳-${Date.now().toString(36)}`
const conEmail = uniqueEmail('c24-con')
let conId, projectId, templateId, wiSteel, wiStruct
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
const PAPER_DATE = '2026-08-04' // LINE_A 紙上手寫 115.8.4
const PDF_OUT = process.env.PDF_OUT_DIR || 'test-results/pdf'
const A2_READINGS = [
  { entry_no: '1', value: 15, value2: 15, raw_text: '15 * 15 CM' },
  { entry_no: '4', value: 15, value2: 15, raw_text: '15 * 15 CM' },
]
// 兩個可計價工項:stub `site` 的 hint「結構工程」(施工日誌)、紙表 stub 的 hint「鋼筋籠組立」(自檢表)
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '鋼筋籠組立', unit: 'T', quantity: 20, unit_price: 30000, amount: 600000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
]
const TEMPLATE_ITEMS = [
  { no: 'A1', group: '鋼筋', item: '線徑', kind: 'num', min: 10, max: 14, unit: 'mm', standard: '依圖說' },
  { no: 'A2', group: '鋼筋', item: '網目', kind: 'num', min: 14, max: 16, unit: 'cm', standard: '15×15' },
  { no: 'B1', group: '鋼筋', item: '鋼筋表面清潔無鏽蝕', kind: 'bool', standard: '目視' },
]
const usageCount = () => Number(dbaSql(`select count(*) from public.ai_usage_events where project_id = '${projectId}' and feature_key = 'photo.classify'`))

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈廿四廠商')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { data: wis } = await c.from('work_items').select('id, item_key').eq('project_id', projectId).in('item_key', ['1.1', '1.2'])
  wiSteel = wis.find((w) => w.item_key === '1.1').id
  wiStruct = wis.find((w) => w.item_key === '1.2').id
  const { data: tpl, error: tplError } = await c.from('checklist_templates').insert({ project_id: projectId, title: '鋼筋自主檢查表', source: '03210', items: TEMPLATE_ITEMS }).select('id').single()
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
  )
})

test('鏈 24:施工日誌表內上傳→填進表上(手填不覆蓋)→改一格→存檔→重整仍在→同一張再上傳不打模型→儲存後下載 PDF;自檢表表內上傳→讀數進格子→確認→存檔→重整→PDF', async ({ page }) => {
  test.setTimeout(480_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })
  const fillInput = page.getByLabel('上傳照片，AI 填表')
  const con = await signInClient(conEmail)

  // ── A. 施工日誌:先手填天氣,再表內上傳 ─────────────────────────────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/site-log')
  await expect(saveStatus).toHaveText('本日尚無日誌')
  await page.getByRole('textbox', { name: '本日天氣上午' }).fill('陰')
  await expect(saveStatus).toHaveText('未存檔')
  const usageBefore = usageCount()
  await fillInput.setInputFiles([{ name: 'site-a.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('c24-site-a') }])
  await expect(page.getByText(/AI 已填入 \d+ 欄/)).toBeVisible({ timeout: 150_000 })
  expect(usageCount()).toBe(usageBefore + 1) // 第一次:真的辨識了一次(stub 也記用量 model=stub:local)
  // 結果直接在表上:摘要來自照片說明(stub)、工項列帶出(數量待補)、手填的天氣沒被覆蓋
  await expect(page.getByRole('textbox', { name: '施工概況摘要' })).toHaveValue(/本機 stub/)
  await expect(page.getByLabel('二 結構工程 本日完成數量')).toHaveValue('')
  await expect(page.getByRole('textbox', { name: '本日天氣上午' })).toHaveValue('陰')
  await expect(saveStatus).toHaveText('未存檔')
  // 伺服器:文件由頁面先存一版(版本 1 含「陰」),Edge 沒寫版本、沒起自檢表,只留一筆表內建議;批次記一筆代表目標
  const { data: docsA } = await con.from('field_documents').select('id, doc_type, doc_date, status, current_version_no').eq('project_id', projectId)
  expect(docsA.map((d) => d.doc_type)).toEqual(['daily_log'])
  const dl = docsA[0]
  expect(dl).toMatchObject({ doc_date: today, current_version_no: 1 })
  const { data: v1 } = await con.from('field_document_versions').select('author_kind, content').eq('document_id', dl.id).eq('version_no', 1).single()
  expect(v1.author_kind).toBe('human')
  expect(v1.content.weather_am).toBe('陰')
  const { data: acts1 } = await con.from('agent_actions').select('id, kind, status, evidence').eq('project_id', projectId).eq('target_id', dl.id)
  expect(acts1.map((a) => [a.kind, a.status])).toEqual([['suggest_field_update', 'pending']])
  expect(acts1[0].evidence).toMatchObject({ origin: 'in_form', document_id: dl.id, doc_type: 'daily_log' })
  expect(acts1[0].evidence.suggestion.content.items[wiStruct]).toMatchObject({ qty_today: null })
  const { data: intakes1 } = await con.from('photo_intakes').select('id, log_date, status, candidates').eq('project_id', projectId)
  expect(intakes1).toHaveLength(1)
  expect(intakes1[0]).toMatchObject({ log_date: today, status: 'ready' })
  expect(intakes1[0].candidates).toEqual([expect.objectContaining({ doc_type: 'daily_log', state: 'suggested', document_id: dl.id, target_key: `document:${dl.id}` })])

  // 工程師直接改一格 → 存檔:版本 2 含合併內容與改後值,建議標 accepted
  await page.getByLabel('二 結構工程 本日完成數量').fill('12.5')
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 2/)).toBeVisible({ timeout: 30_000 })
  const { data: v2 } = await con.from('field_document_versions').select('content, field_sources, attachments').eq('document_id', dl.id).eq('version_no', 2).single()
  expect(v2.content.work_summary).toContain('本機 stub')
  expect(v2.content.weather_am).toBe('陰')
  expect(Number(v2.content.items[wiStruct].qty_today)).toBe(12.5)
  expect(v2.field_sources.work_summary).toMatchObject({ status: 'filled', source: 'ai:photo' })
  expect(v2.field_sources.weather_am).toMatchObject({ status: 'confirmed', source: 'human' })
  expect(v2.attachments).toHaveLength(1)
  const { data: acts2 } = await con.from('agent_actions').select('status').eq('id', acts1[0].id).single()
  expect(acts2.status).toBe('accepted')
  // 重新整理仍在
  await page.reload()
  await expect(saveStatus).toHaveText(/已存檔.*版本 2/, { timeout: 30_000 })
  await expect(page.getByLabel('二 結構工程 本日完成數量')).toHaveValue('12.5')
  await expect(page.getByRole('textbox', { name: '施工概況摘要' })).toHaveValue(/本機 stub/)

  // ── A2. 同一張照片再上傳(本案已有同內容):仍能填表、不重新呼叫模型 ───────────────────
  const usageMid = usageCount()
  await fillInput.setInputFiles([{ name: 'site-a-again.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('c24-site-a') }])
  await expect(page.getByText(/AI 辨識完成，沒有可補的空白欄位|AI 已填入 \d+ 欄/)).toBeVisible({ timeout: 150_000 })
  expect(usageCount()).toBe(usageMid) // 沿用先前同內容照片的辨識結果:沒有新的模型用量
  const { data: photos2 } = await con.from('photos').select('id, intake_id, content_sha256, ai_status, ai_result, work_item_id').eq('project_id', projectId).order('created_at')
  expect(photos2).toHaveLength(2) // 新批次一列(不跨批次查重),沒有第三列
  expect(photos2[0].content_sha256).toBe(photos2[1].content_sha256)
  expect(photos2[1]).toMatchObject({ ai_status: 'done', work_item_id: wiStruct })
  expect(photos2[1].ai_result.classify).toEqual(photos2[0].ai_result.classify)
  const { data: intakes2 } = await con.from('photo_intakes').select('id').eq('project_id', projectId)
  expect(intakes2).toHaveLength(2)
  const { data: docsA2 } = await con.from('field_documents').select('id, current_version_no').eq('project_id', projectId)
  expect(docsA2).toEqual([{ id: dl.id, current_version_no: 2 }]) // 沒有新版本、沒有新文件

  // ── A3. 未存檔按列印 → 先存檔再下載 → 列印頁 PDF 含改後值 ─────────────────────────
  await expect(saveStatus).toHaveText('未存檔') // 第二批附件併進表單
  await page.getByRole('button', { name: '列印公定格式日誌' }).click()
  const saveDialog = page.getByRole('dialog', { name: '先存檔再下載' })
  await saveDialog.getByRole('button', { name: '儲存後下載', exact: true }).click()
  await expect(page).toHaveURL(/#\/site-log\/print\?doc=/, { timeout: 30_000 })
  const { data: dlAfter } = await con.from('field_documents').select('current_version_no').eq('id', dl.id).single()
  expect(dlAfter.current_version_no).toBe(3) // 「儲存後下載」真的存了一版
  await expect(page.getByRole('group', { name: '文件版本與簽署' })).toContainText('版本 3', { timeout: 30_000 })
  const [dlDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByRole('button', { name: '下載 PDF' }).click(),
  ])
  mkdirSync(PDF_OUT, { recursive: true })
  const dlPdfPath = join(PDF_OUT, `chain24-${dlDownload.suggestedFilename()}`)
  await dlDownload.saveAs(dlPdfPath)
  expect(dlDownload.suggestedFilename()).toMatch(/v3_草稿未簽署\.pdf$/)
  const dlPdf = readPdf(readFileSync(dlPdfPath))
  expect(dlPdf.hasFontFile, '中文字型必須內嵌').toBe(true)
  expect(dlPdf.text.replace(/\s+/g, '')).toContain('12.5')
  expect(dlPdf.text.replace(/\s+/g, '')).toContain('本機stub')
  expect(dlPdf.text).toContain('草稿・未簽署')

  // ── B. 自主檢查表:新建、日期改成紙上日期、先手填 A1、再表內上傳紙表 ───────────────────
  await gotoHash(page, '/self-check')
  await expect(page.getByRole('heading', { level: 1, name: '自主檢查表' })).toBeVisible()
  const card = page.getByRole('group', { name: '新自主檢查表', exact: true })
  await card.getByLabel('檢查日期').fill(PAPER_DATE)
  // 新建預設是內建 03310 範本;這裡選本案的鋼筋範本(紙表 stub 的線徑／網目才對得上)
  await card.getByRole('combobox', { name: '檢查表範本' }).selectOption(templateId)
  await page.getByRole('spinbutton', { name: 'A1 線徑 實際檢查情形' }).fill('12')
  await expect(saveStatus).toHaveText('未存檔')
  await fillInput.setInputFiles([{ name: 'paper-line-a.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('pmis-stub-scene=paper_form_line_a;c24-paper') }])
  await expect(page.getByText(/AI 已填入 \d+ 欄/)).toBeVisible({ timeout: 150_000 })
  await expect(page).toHaveURL(/#\/self-check\?doc=/) // 系統先建了文件
  const docCard = page.getByRole('group', { name: '本份自主檢查表', exact: true })
  // A2 兩筆讀數(編號、兩向、單位)出現在實際檢查情形格;A1 手填的 12 沒被覆蓋;工項由照片多數決帶入
  await expect(docCard.getByRole('textbox', { name: 'A2 網目 第 1 筆 編號' })).toHaveValue('1')
  await expect(docCard.getByRole('spinbutton', { name: 'A2 網目 第 1 筆 讀數' })).toHaveValue('15')
  await expect(docCard.getByRole('spinbutton', { name: 'A2 網目 第 1 筆 第二向' })).toHaveValue('15')
  await expect(docCard.getByRole('textbox', { name: 'A2 網目 第 2 筆 編號' })).toHaveValue('4')
  await expect(docCard.getByRole('row').filter({ hasText: '網目' }).first()).toContainText('cm')
  await expect(page.getByRole('spinbutton', { name: 'A1 線徑 實際檢查情形' })).toHaveValue('12')
  await expect(docCard.getByRole('combobox', { name: '對應工項' })).toHaveValue(wiSteel)
  await expect(docCard.getByText('A2 網目（待親自確認）')).toBeVisible() // 抄錄仍要人確認
  await expect(saveStatus).toHaveText('未存檔')
  const { data: scDocs } = await con.from('field_documents').select('id, doc_date, template_id, current_version_no, status').eq('project_id', projectId).eq('doc_type', 'self_check')
  expect(scDocs).toHaveLength(1)
  const sc = scDocs[0]
  expect(sc).toMatchObject({ doc_date: PAPER_DATE, template_id: templateId, current_version_no: 1 })
  const { data: scActs } = await con.from('agent_actions').select('kind, status, evidence').eq('project_id', projectId).eq('target_id', sc.id)
  expect(scActs.map((a) => [a.kind, a.status])).toEqual([['suggest_field_update', 'pending']])
  expect(scActs[0].evidence.suggestion.content.results.A2).toEqual({ value: null, readings: A2_READINGS })
  expect(scActs[0].evidence.suggestion.content.work_item_id).toBe(wiSteel)

  // 逐項確認、勾 B1、存檔 → 重整仍在
  await docCard.getByRole('row').filter({ hasText: '網目' }).first().getByRole('button', { name: '確認', exact: true }).click()
  await docCard.getByRole('checkbox', { name: 'B1 鋼筋表面清潔無鏽蝕 合格' }).check()
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 2，可簽署/)).toBeVisible({ timeout: 30_000 })
  const { data: scV2 } = await con.from('field_document_versions').select('content, field_sources').eq('document_id', sc.id).eq('version_no', 2).single()
  expect(scV2.content.results).toEqual({ A1: { value: 12 }, A2: { value: null, readings: A2_READINGS }, B1: { value: true } })
  expect(scV2.field_sources['results.A1']).toMatchObject({ status: 'confirmed', source: 'human' })
  expect(scV2.field_sources['results.A2']).toMatchObject({ status: 'confirmed', source: expect.stringMatching(/^record:/) })
  await page.reload()
  await expect(saveStatus).toHaveText(/已存檔.*版本 2/, { timeout: 30_000 })
  await expect(docCard.getByRole('spinbutton', { name: 'A2 網目 第 2 筆 讀數' })).toHaveValue('15')

  // 列印頁 PDF 印讀數
  await gotoHash(page, `/self-check/print?doc=${sc.id}`)
  await expect(page.getByText(/編號 1\s15×15 cm/)).toBeVisible({ timeout: 30_000 })
  const [scDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByRole('button', { name: '下載 PDF' }).click(),
  ])
  const scPdfPath = join(PDF_OUT, `chain24-${scDownload.suggestedFilename()}`)
  await scDownload.saveAs(scPdfPath)
  const scPdf = readPdf(readFileSync(scPdfPath))
  expect(scPdf.hasFontFile).toBe(true)
  expect(scPdf.text.replace(/\s+/g, '')).toContain('編號115×15cm')
  expect(scPdf.text.replace(/\s+/g, '')).toContain('編號415×15cm')
  await con.auth.signOut()
})
