// 鏈 25(live,手動執行):demo 急件門檻 1——五張真實現場照片,在真後端從兩種表單「表內上傳」→ 真實模型 → 看到填值 →
//   直接改 → 存檔 → 重整仍在 → 下載 PDF。
//   施工日誌:表內上傳五張(真的呼叫模型)→ 摘要等欄位直接填在表上 → 人補一句 → 存檔 → 重整 → 儲存後的版本下載 PDF。
//   自主檢查表:新建、選本案鋼線網範本、日期改成紙上日期 → 表內上傳**同一批**照片(本案已辨識過,沿用結果、不再呼叫模型)
//   → 兩向尺寸讀數進「實際檢查情形」格(編號、方向、單位)→ 存檔(允許待確認)→ 重整 → 列印頁下載 PDF 印得出讀數。
//   **不在一般 e2e:real 裡跑**:要 E2E_LIVE_INFORM=1、`supabase functions serve` 不帶 PMIS_VISION_STUB(模型金鑰有效)、
//   repo 根目錄有五張照片(真實現場照、依約定不進版控;缺檔就 skip)。只打一次模型(約 USD 0.2)。
//   模型輸出每次可能不同:紅線只釘「讀數一定落在人工標註內、不截半、AI 抄錄不自動確認、第二次上傳不打模型」;
//   實際填了哪些欄寫進 test-results/live-inform-real-photos.json,不當門檻。
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readPdf } from '../e2e/pdfText.js'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, gotoHash, runCleanup, dbaSql,
} from './helpers.js'

const PHOTOS = ['LI2995~1_0.JPG', 'LI89DE~1_0.JPG', 'LIEE66~1_0.JPG', 'LIFA1C~1_0.JPG', 'LINE_A~4_0.JPG']
// 人工標註(與 chain 23 同一份):項次 → 編號 → 兩向尺寸(範本單位)
const TRUTH = { 1: { 1: '13×11', 4: '11×11' }, 2: { 1: '15×15', 4: '15×15' } }
const OUT = process.env.PDF_OUT_DIR || 'test-results'
const live = process.env.E2E_LIVE_INFORM === '1'
const missing = PHOTOS.filter((f) => !existsSync(resolve(f)))
const PAPER_DATE = '2026-08-04' // LINE_A 紙上手寫 115.8.4
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

const PROJECT_NAME = `鏈25表內真照片-${Date.now().toString(36)}`
const conEmail = uniqueEmail('c25-con')
let conId, projectId, templateId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '鋼筋及點焊鋼線網加工組立', unit: 'M2', quantity: 500, unit_price: 300, amount: 150000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]
const TEMPLATE_ITEMS = [
  { no: '1', group: '鋼線網', item: '鋼線網線徑', kind: 'num', min: 10, max: 14, unit: 'mm', standard: '依圖說(編號 1 13×11 mm、編號 4 11×11 mm)' },
  { no: '2', group: '鋼線網', item: '鋼線網網目', kind: 'num', min: 14, max: 16, unit: 'cm', standard: '15×15 cm' },
  { no: '3', group: '鋼線網', item: '搭接長度', kind: 'num', min: 27, unit: 'cm', standard: '≥27 cm' },
  { no: '4', group: '鋼線網', item: '鋼線網綁紮固定牢靠', kind: 'bool', standard: '目視' },
]
const dims = (r) => (r.value2 == null ? `${r.value}` : `${r.value}×${r.value2}`)
const usage = (feature) => Number(dbaSql(`select count(*) from public.ai_usage_events where project_id = '${projectId}' and feature_key = '${feature}' and status = 'ok'`))

test.skip(!live, '手動 live 鏈:設 E2E_LIVE_INFORM=1 且 functions serve 不開 stub 才跑')
test.skip(live && missing.length > 0, `缺本機照片:${missing.join('、')}(真實現場照不進版控)`)

test.beforeAll(async () => {
  if (!live || missing.length) return
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈廿五廠商')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { data: tpl, error: tplError } = await c.from('checklist_templates').insert({ project_id: projectId, title: '鋼線網自主檢查表', source: '本案圖說', items: TEMPLATE_ITEMS }).select('id').single()
  if (tplError) throw new Error(`建範本失敗:${tplError.message}`)
  templateId = tpl.id
  const { data: fm, error: fmError } = await c.from('projects').update({ formal_mode: true }).eq('id', projectId).select('id')
  if (fmError || !fm?.length) throw new Error(`開啟正式模式失敗:${fmError?.message || 'RLS 未生效'}`)
  await c.auth.signOut()
})

test.afterAll(async () => {
  if (!live || missing.length) return
  await runCleanup(() => deleteOwnedProjects(conEmail), () => cleanupUser(conId))
})

test('鏈 25(live):五張真照片表內上傳 → 施工日誌填值／改／存檔／重整／PDF → 自檢表同批照片(不再打模型)讀數進格子／存檔／重整／PDF', async ({ page }) => {
  test.setTimeout(900_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })
  const fillInput = page.getByLabel('上傳照片，AI 填表')
  const report = { tested_at_utc: new Date().toISOString(), photos: PHOTOS, truth: TRUTH }
  mkdirSync(OUT, { recursive: true })
  const writeReport = () => writeFileSync(join(OUT, 'live-inform-real-photos.json'), JSON.stringify(report, null, 2))
  const con = await signInClient(conEmail)

  // ── A. 施工日誌 ────────────────────────────────────────────────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/site-log')
  await expect(saveStatus).toHaveText('本日尚無日誌')
  const t0 = Date.now()
  await fillInput.setInputFiles(PHOTOS.map((f) => resolve(f)))
  await expect(page.getByText(/AI 已填入 \d+ 欄|AI 辨識完成，沒有可補的空白欄位/)).toBeVisible({ timeout: 600_000 })
  report.daily_log_fill_ms = Date.now() - t0
  report.daily_log_message = await page.getByText(/AI 已填入 \d+ 欄|AI 辨識完成/).first().textContent()
  await expect(page.getByText(/模型輸出為本機 stub/)).toHaveCount(0) // 必須是真實模型
  const classifyAfterDaily = usage('photo.classify')
  report.classify_calls_daily = classifyAfterDaily
  expect(classifyAfterDaily, '第一次上傳真的呼叫了模型').toBeGreaterThan(0)
  const summaryBox = page.getByRole('textbox', { name: '施工概況摘要' })
  const aiSummary = await summaryBox.inputValue()
  report.daily_log_ai_summary = aiSummary
  expect(aiSummary.trim(), 'AI 應擬出施工概況(照片可支持的描述)').not.toBe('')
  // 工程師直接改:在摘要後補一句 → 存檔 → 重整仍在
  await summaryBox.fill(`${aiSummary}（人工補充：鏈25核對）`)
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 \d+/)).toBeVisible({ timeout: 30_000 })
  const { data: dlDocs } = await con.from('field_documents').select('id, doc_type, doc_date, current_version_no').eq('project_id', projectId)
  expect(dlDocs.map((d) => d.doc_type), '表內上傳只填這一份,不另起自檢表').toEqual(['daily_log'])
  const dl = dlDocs[0]
  expect(dl.doc_date).toBe(today)
  const { data: dlV } = await con.from('field_document_versions').select('content, field_sources, attachments').eq('document_id', dl.id).eq('version_no', dl.current_version_no).single()
  report.daily_log_saved = { version: dl.current_version_no, content: dlV.content, sources: dlV.field_sources, attachments: dlV.attachments.length }
  writeReport()
  expect(dlV.content.work_summary).toContain('人工補充：鏈25核對')
  expect(dlV.attachments.length).toBeGreaterThan(0)
  await page.reload()
  await expect(saveStatus).toHaveText(new RegExp(`已存檔.*版本 ${dl.current_version_no}`), { timeout: 30_000 })
  await expect(summaryBox).toHaveValue(/人工補充：鏈25核對/)
  await gotoHash(page, `/site-log/print?doc=${dl.id}`)
  await expect(page.getByRole('button', { name: '下載 PDF' })).toBeVisible({ timeout: 30_000 })
  const [dlDownload] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), page.getByRole('button', { name: '下載 PDF' }).click()])
  const dlPdfPath = join(OUT, `chain25-${dlDownload.suggestedFilename()}`)
  await dlDownload.saveAs(dlPdfPath)
  const dlPdf = readPdf(readFileSync(dlPdfPath))
  expect(dlPdf.hasFontFile).toBe(true)
  expect(dlPdf.text.replace(/\s+/g, '')).toContain('人工補充：鏈25核對')
  expect(dlPdf.text).toContain('草稿・未簽署')

  // ── B. 自主檢查表:同一批照片 → 沿用辨識結果(不再打模型)→ 讀數進格子 ─────────────────────
  await gotoHash(page, '/self-check')
  await expect(page.getByRole('heading', { level: 1, name: '自主檢查表' })).toBeVisible()
  const card = page.getByRole('group', { name: '新自主檢查表', exact: true })
  await card.getByLabel('檢查日期').fill(PAPER_DATE)
  await card.getByRole('combobox', { name: '檢查表範本' }).selectOption(templateId)
  const t1 = Date.now()
  await fillInput.setInputFiles(PHOTOS.map((f) => resolve(f)))
  await expect(page.getByText(/AI 已填入 \d+ 欄|AI 辨識完成，沒有可補的空白欄位/)).toBeVisible({ timeout: 600_000 })
  report.self_check_fill_ms = Date.now() - t1
  report.self_check_message = await page.getByText(/AI 已填入 \d+ 欄|AI 辨識完成/).first().textContent()
  report.classify_calls_after_self_check = usage('photo.classify')
  expect(usage('photo.classify'), '同一批照片第二次上傳沿用辨識結果,不再呼叫模型').toBe(classifyAfterDaily)
  await expect(page).toHaveURL(/#\/self-check\?doc=/)
  const docCard = page.getByRole('group', { name: '本份自主檢查表', exact: true })
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 \d+/)).toBeVisible({ timeout: 30_000 })
  const { data: scDocs } = await con.from('field_documents').select('id, current_version_no, template_id').eq('project_id', projectId).eq('doc_type', 'self_check')
  expect(scDocs).toHaveLength(1)
  const sc = scDocs[0]
  expect(sc.template_id).toBe(templateId)
  const { data: scV } = await con.from('field_document_versions').select('content, field_sources, attachments').eq('document_id', sc.id).eq('version_no', sc.current_version_no).single()
  report.self_check_saved = {
    version: sc.current_version_no, work_item_id: scV.content.work_item_id ?? null, attachments: scV.attachments.length,
    cells: Object.fromEntries(TEMPLATE_ITEMS.map((it) => [it.no, { item: it.item, result: scV.content.results?.[it.no] ?? null, source: scV.field_sources[`results.${it.no}`] ?? null }])),
  }
  const got = []
  for (const no of ['1', '2']) for (const r of scV.content.results?.[no]?.readings || []) got.push({ no, entry_no: r.entry_no, dims: dims(r), in_truth: TRUTH[no]?.[r.entry_no] === dims(r) })
  report.readings = got
  writeReport()
  // 紅線:讀數一定落在人工標註內(編號不混、兩向不截半);設計欄搭接不進格子;AI 抄錄不自動確認
  for (const g of got) expect(g.in_truth, `項次 ${g.no} 編號 ${g.entry_no} ${g.dims} 不在人工標註內`).toBe(true)
  expect(scV.content.results?.['3']?.readings ?? null).toBeNull()
  for (const no of ['1', '2']) {
    if (scV.content.results?.[no]?.readings?.length) expect(scV.field_sources[`results.${no}`]?.status, 'AI 抄錄不得自動確認').toBe('filled')
  }
  expect(got.length, '至少一筆兩向讀數進格子(紙表上共 4 筆)').toBeGreaterThan(0)
  // 畫面:讀數在實際檢查情形格裡(編號、兩向),重整仍在
  await page.reload()
  await expect(saveStatus).toHaveText(new RegExp(`已存檔.*版本 ${sc.current_version_no}`), { timeout: 30_000 })
  const first = got[0]
  const it = TEMPLATE_ITEMS.find((x) => x.no === first.no)
  await expect(docCard.getByRole('textbox', { name: `${it.no} ${it.item} 第 1 筆 編號` })).toHaveValue(/\S/)
  await expect(docCard.getByRole('spinbutton', { name: `${it.no} ${it.item} 第 1 筆 第二向` })).not.toHaveValue('')
  await page.screenshot({ path: join(OUT, 'live-inform-selfcheck.png'), fullPage: true })
  await gotoHash(page, `/self-check/print?doc=${sc.id}`)
  await expect(page.getByRole('button', { name: '下載 PDF' })).toBeVisible({ timeout: 30_000 })
  const [scDownload] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), page.getByRole('button', { name: '下載 PDF' }).click()])
  const scPdfPath = join(OUT, `chain25-${scDownload.suggestedFilename()}`)
  await scDownload.saveAs(scPdfPath)
  const scPdf = readPdf(readFileSync(scPdfPath))
  expect(scPdf.hasFontFile).toBe(true)
  const flat = scPdf.text.replace(/\s+/g, '')
  expect(flat).toContain(`編號${first.entry_no}${first.dims}`)
  expect(scPdf.text).toContain('草稿・未簽署')
  report.pdfs = [dlPdfPath, scPdfPath]
  writeReport()
  await con.auth.signOut()
})
