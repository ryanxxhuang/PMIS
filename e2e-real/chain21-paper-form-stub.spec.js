// F2｜鏈 21:紙本查驗表的辨識結果 → 自主檢查表草稿欄位 → 標待確認(附紙上原文證據)→ 未確認不能簽 → 人填後簽署(真 Supabase＋本機 Edge stub)。
//   E 包列為未測:真後端鏈的視覺是 stub,沒有走過「紙表觀察 → 草稿」這段。這裡讓本機 stub 回 **真實模型對一張真實紙表
//   照片(LINE_A~4_0.JPG)的實際輸出**(visionStub.ts 的 paper_form_line_a,逐字取自 vision-after-b2.json 的 original 條件,
//   vitest 釘住不漂移),以 helpers.tinyJpeg 的尾巴標記選情境。**這仍是 stub**:不看影像、不呼叫模型,只證明流程;
//   真實模型的抄錄率與品質看續接清單 §9 B2,兩者分開報。只挑 LINE_A 的理由見 visionStub.ts 檔頭(另兩張的實測值只來自逐格切塊,
//   1×1 的 e2e 小圖走不到那條路)。
//   這張紙表的真實結果都是「兩向尺寸」(13×11 mm、15×15 cm)且有編號 1 與 4 兩個量測對象。2026-09-21 G 包起
//   (migration 20260921030000)系統把它們**分列抄錄**進格子(readings:編號＋兩向,不截半、不合併、不挑一個),
//   標 filled 待人逐項確認——所以這條鏈驗的是「紙上寫什麼、表上就是什麼,但仍要人確認才能簽」:
//     * 紙上日期 115.8.4 → 文件日期 2026-08-04、來源 whiteboard(施工日誌同日同來源);
//     * 線徑 = 編號 1 13×11 mm、編號 4 11×11 mm;網目 = 編號 1、4 各 15×15 cm;filled、證據帶兩筆原文與編號;
//       設計欄的搭接 ≥27 cm 不進任何格子;
//     * 分類猜的位置 B5-4-4-25m 沒有原文佐證 → 不落地(位置待補);逐格切塊對 1×1 的小圖偵測不到紙張 → 記原因退回整張路徑;
//     * 格子裡看得到逐筆讀數(編號／讀數／第二向),點「原文」看得到證據面板;
//     * 只抄錄未確認 → 簽署 RPC 回 PD004(needs_confirmation);人逐項按「確認」、勾 B1、存檔 → 重新整理仍在 → 簽署 →
//       checklist_records 每項保存完整讀數、判定由 DB 算、check_date=紙上日期 → 列印頁與下載的 PDF 印出逐筆讀數。
//   前置同 chain 5:`supabase functions serve --env-file .env.e2e.real`(含 PMIS_VISION_STUB=1)。
import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPdf } from '../e2e/pdfText.js'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, gotoHash, runCleanup, tinyJpeg,
} from './helpers.js'

const PROJECT_NAME = `鏈21紙表stub-${Date.now().toString(36)}`
const conEmail = uniqueEmail('f2c21-con')
const supEmail = uniqueEmail('f2c21-sup')
let conId, supId, projectId, templateId, wiId
const PAPER_DATE = '2026-08-04' // LINE_A 紙上手寫 115.8.4
const PDF_OUT = process.env.PDF_OUT_DIR || 'test-results/pdf'
// LINE_A 紙上實測欄(真實模型輸出,見檔頭):編號 1 與 4,兩向尺寸;數值已換成範本單位(線徑 mm、網目 cm)
const A1_READINGS = [
  { entry_no: '1', value: 13, value2: 11, raw_text: '13 * 11 MM' },
  { entry_no: '4', value: 11, value2: 11, raw_text: '11 * 11 MM' },
]
const A2_READINGS = [
  { entry_no: '1', value: 15, value2: 15, raw_text: '15 * 15 CM' },
  { entry_no: '4', value: 15, value2: 15, raw_text: '15 * 15 CM' },
]
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '鋼筋籠組立', unit: 'T', quantity: 20, unit_price: 30000, amount: 600000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]
// 範本項目與紙表欄名唯一對應(線徑 mm、網目 cm),另一項勾選
const TEMPLATE_ITEMS = [
  { no: 'A1', group: '鋼筋', item: '線徑', kind: 'num', min: 10, max: 14, unit: 'mm', standard: '依圖說' },
  { no: 'A2', group: '鋼筋', item: '網目', kind: 'num', min: 14, max: 16, unit: 'cm', standard: '15×15' },
  { no: 'B1', group: '鋼筋', item: '鋼筋表面清潔無鏽蝕', kind: 'bool', standard: '目視' },
]

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈廿一廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈廿一監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { data: wi } = await c.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.1').single()
  wiId = wi.id
  const { error: inviteError } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' })
  if (inviteError) throw new Error(`邀請失敗:${inviteError.message}`)
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
    () => cleanupUser(supId),
  )
})

test('鏈 21:紙表觀察→草稿格子(分列讀數／證據／待確認)→簽署被擋(PD004)→人確認→重整仍在→簽署落庫→列印與 PDF 印讀數', async ({ page }) => {
  test.setTimeout(420_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })

  // ── 廠商上傳一張(標記選 stub 情境)→ 伺服器起稿:紙上日期那一天的施工日誌＋自主檢查表 ─────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/site')
  await page.getByLabel('選擇照片上傳').setInputFiles([
    { name: 'paper-line-a.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('pmis-stub-scene=paper_form_line_a;c21-a') },
  ])
  await expect(page.getByText('已保存到伺服器 1／1')).toBeVisible({ timeout: 60_000 })
  const uploadCard = page.getByRole('group', { name: '拍照／上傳' })
  await expect(uploadCard.getByText('已起稿').first()).toBeVisible({ timeout: 120_000 })
  await expect(uploadCard.getByText(/模型輸出為本機 stub/)).toBeVisible()

  const con = await signInClient(conEmail)
  const { data: docs } = await con.from('field_documents').select('id, doc_type, doc_date, status, template_id, target_key').eq('project_id', projectId).order('doc_date')
  const selfChecks = docs.filter((d) => d.doc_type === 'self_check')
  const dailyLogs = docs.filter((d) => d.doc_type === 'daily_log')
  expect(selfChecks.map((d) => d.doc_date)).toEqual([PAPER_DATE]) // 不是上傳日:日期來自紙上
  expect(dailyLogs.map((d) => d.doc_date)).toEqual([PAPER_DATE])
  const lineA = selfChecks[0]
  expect(lineA).toMatchObject({ status: 'pending_input', template_id: templateId, target_key: `${PAPER_DATE}:${wiId}` })

  // ── 照片列:辨識結果(真實輸出的形狀)落 ai_result;分類猜的位置沒有原文佐證 → 不寫進 photos.location ──
  const { data: photos } = await con.from('photos').select('id, location, work_item_id, taken_at, ai_status, ai_result').eq('project_id', projectId)
  expect(photos).toHaveLength(1)
  const pA = photos[0]
  expect(pA.ai_result.whiteboard.log_date).toBe(PAPER_DATE)
  expect(pA.ai_status).toBe('done')
  expect(pA.work_item_id).toBe(wiId)
  expect(pA.ai_result.classify).toMatchObject({ record_medium: 'paper_form', has_board: true, location: 'B5-4-4-25m' })
  expect(pA.location).toBeNull() // groundedLocation:轉錄沒讀到位置,分類猜的不落地
  expect(pA.ai_result.whiteboard.observations).toHaveLength(8)
  expect(pA.ai_result.whiteboard.observations.filter((o) => o.kind === 'measured').every((o) => o.source?.method === 'paper_cells')).toBe(true)
  expect(typeof pA.ai_result.paper_cells_skipped).toBe('string') // 1×1 小圖偵測不到紙張 → 記原因、退回整張路徑

  // ── LINE_A 草稿:日期來自紙上;線徑／網目分列抄錄(filled 待確認)、證據兩筆原文;位置待補 ──────────────
  const { data: vA } = await con.from('field_document_versions').select('content, field_sources, content_hash').eq('document_id', lineA.id).eq('version_no', 1).single()
  expect(vA.content.results).toEqual({ A1: { value: null, readings: A1_READINGS }, A2: { value: null, readings: A2_READINGS }, B1: { value: null } })
  expect(vA.content.check_date).toBe(PAPER_DATE)
  expect(vA.field_sources.check_date).toMatchObject({ status: 'filled', source: `whiteboard:${pA.id}` }) // 日期綁到讀出它的那張照片
  const a1 = vA.field_sources['results.A1']
  expect(a1).toMatchObject({ status: 'filled', source: `record:${pA.id}`, refs: [pA.id] })
  expect(a1.reason).toContain('編號 1 13×11 mm、編號 4 11×11 mm')
  expect(a1.reason).toContain('未代為量測')
  expect(a1.evidence.map((e) => `${e.entry_no}:${e.raw_text}:${e.kind}:${e.unit}`).sort()).toEqual(['1:13 * 11 MM:measured:MM', '4:11 * 11 MM:measured:MM'])
  expect(a1.hint).toBeUndefined()
  const a2 = vA.field_sources['results.A2']
  expect(a2.status).toBe('filled')
  expect(a2.evidence.map((e) => `${e.entry_no}:${e.raw_text}`).sort()).toEqual(['1:15 * 15 CM', '4:15 * 15 CM'])
  expect(JSON.stringify(vA.content.results)).not.toContain('27') // 設計欄的搭接 ≥27 cm 不得進任何格子
  expect(vA.field_sources['results.B1'].status).toBe('pending')
  expect(vA.field_sources.location).toMatchObject({ status: 'pending' })
  expect(vA.field_sources.location.reason).toContain('未載明檢查位置')
  expect(vA.field_sources.work_item_id).toMatchObject({ status: 'filled', source: 'ai:photo' })
  // 施工日誌同日:日期也是紙上的
  const { data: dlA } = await con.from('field_document_versions').select('field_sources').eq('document_id', dailyLogs.find((d) => d.doc_date === PAPER_DATE).id).eq('version_no', 1).single()
  expect(dlA.field_sources.log_date).toMatchObject({ status: 'filled', source: `whiteboard:${pA.id}` })

  // ── 簽署 RPC:抄錄值只標 filled、人沒確認 → PD004 needs_confirmation(伺服器規則) ─────────────────────
  const { error: pd004 } = await con.rpc('sign_field_document', { p_document_id: lineA.id, p_version_no: 1, p_content_hash: vA.content_hash, p_intent: '測試:未確認即簽' })
  expect(pd004?.code).toBe('PD004')
  expect(JSON.parse(pd004.details)).toEqual(expect.arrayContaining([{ key: 'results.A1', status: 'needs_confirmation' }, { key: 'results.A2', status: 'needs_confirmation' }]))

  // ── UI:格子裡逐筆讀數;證據面板;沒有簽署鈕;人逐項確認、存檔、重整仍在、簽署 → checklist_records 保存讀數 ──
  await gotoHash(page, `/self-check?doc=${lineA.id}`)
  const card = page.getByRole('group', { name: '本份自主檢查表', exact: true })
  await expect(saveStatus).toHaveText(/已存檔.*版本 1/)
  await expect(card.getByText(/檢查日期/).first()).toBeVisible()
  await expect(card.getByText('115 年 8 月 4 日').first()).toBeVisible() // 紙上 115.8.4 → 表頭以民國年呈現(rocDateText)
  await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0)
  // 「原文」按鈕每個格子各一顆(位置欄也有一顆);要看的是 A1 線徑那一列的
  const rowA1 = card.getByRole('row').filter({ hasText: '線徑' }).first()
  await rowA1.getByRole('button', { name: '原文' }).click()
  const evidenceA = rowA1.getByRole('group', { name: '欄位證據' })
  await expect(evidenceA).toContainText('編號 1 13×11 mm、編號 4 11×11 mm')
  await expect(evidenceA).toContainText('線徑：「13 * 11 MM」（編號 1）（單位 MM）（紙上實測欄）')
  await expect(evidenceA).toContainText('線徑：「11 * 11 MM」（編號 4）（單位 MM）（紙上實測欄）')
  // 格子裡就是紙上的逐筆讀數(編號／讀數／第二向),不是空格
  await expect(card.getByRole('textbox', { name: 'A1 線徑 第 1 筆 編號' })).toHaveValue('1')
  await expect(card.getByRole('spinbutton', { name: 'A1 線徑 第 1 筆 讀數' })).toHaveValue('13')
  await expect(card.getByRole('spinbutton', { name: 'A1 線徑 第 1 筆 第二向' })).toHaveValue('11')
  await expect(card.getByRole('textbox', { name: 'A1 線徑 第 2 筆 編號' })).toHaveValue('4')
  await expect(card.getByRole('spinbutton', { name: 'A1 線徑 第 2 筆 讀數' })).toHaveValue('11')
  await expect(card.getByRole('spinbutton', { name: 'A2 網目 第 2 筆 第二向' })).toHaveValue('15')
  // 人逐項核對後按「確認」(值不動、來源保留 record:,稽核看得出是抄錄後人確認)
  await rowA1.getByRole('button', { name: '確認', exact: true }).click()
  await card.getByRole('row').filter({ hasText: '網目' }).first().getByRole('button', { name: '確認', exact: true }).click()
  await card.getByRole('checkbox', { name: 'B1 鋼筋表面清潔無鏽蝕 合格' }).check()
  await expect(card.getByText('■ 全部合格')).toBeVisible()
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 2，可簽署/)).toBeVisible({ timeout: 30_000 })
  const { data: v2 } = await con.from('field_document_versions').select('content, field_sources').eq('document_id', lineA.id).eq('version_no', 2).single()
  expect(v2.field_sources['results.A1']).toMatchObject({ status: 'confirmed', source: `record:${pA.id}` })
  expect(v2.content.results.A1).toEqual({ value: null, readings: A1_READINGS })
  // 重新整理:存下來的讀數還在格子裡
  await page.reload()
  await expect(saveStatus).toHaveText(/已存檔.*版本 2/, { timeout: 30_000 })
  await expect(card.getByRole('spinbutton', { name: 'A1 線徑 第 2 筆 讀數' })).toHaveValue('11')
  const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
  await expect(lifecycle.getByText(/版本 2 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  const { data: signed } = await con.from('field_documents').select('status, target_id, target_table').eq('id', lineA.id).single()
  expect(signed).toMatchObject({ status: 'signed', target_table: 'checklist_records' })
  const { data: rec } = await con.from('checklist_records').select('template_id, check_date, results, overall, work_item_id, created_by').eq('id', signed.target_id).single()
  expect(rec).toMatchObject({ template_id: templateId, check_date: PAPER_DATE, overall: '合格', work_item_id: wiId, created_by: conId })
  expect(rec.results).toEqual({
    A1: { value: null, pass: true, readings: A1_READINGS }, A2: { value: null, pass: true, readings: A2_READINGS }, B1: { value: true, pass: true },
  })

  // ── 列印頁與下載的 PDF:同一張紙、印逐筆讀數(已簽版本) ───────────────────────────────────────
  await gotoHash(page, `/self-check/print?doc=${lineA.id}`)
  await expect(page.getByText(/編號 1\s13×11 mm/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/編號 4\s11×11 mm/)).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByRole('button', { name: '下載 PDF' }).click(),
  ])
  const pdfPath = join(PDF_OUT, `chain21-${download.suggestedFilename()}`)
  mkdirSync(PDF_OUT, { recursive: true })
  await download.saveAs(pdfPath)
  expect(download.suggestedFilename()).toMatch(/v2_已簽署\.pdf$/)
  const pdf = readPdf(readFileSync(pdfPath))
  expect(pdf.hasFontFile, '中文字型必須內嵌').toBe(true)
  expect(pdf.text.replace(/\s+/g, '')).toContain('編號113×11mm')
  expect(pdf.text.replace(/\s+/g, '')).toContain('編號411×11mm')
  expect(pdf.text.replace(/\s+/g, '')).toContain('編號415×15cm')
  expect(pdf.text, '已簽版本不得出現草稿標示').not.toContain('草稿・未簽署')
  await con.auth.signOut()
})
