// G 包｜鏈 23(live,手動執行):五張真實現場照片 → 真實模型 → 自主檢查表格子(分列讀數)→ 人確認 → 存檔重整 → 簽署 → 列印與 PDF。
//   2026-09-20 廠商驗收指令 B 要求「以同一組圖片逐欄比較」且「另驗上傳實際送圖流程」:這條鏈走的就是網頁真的上傳
//   (前端壓縮後送 Storage)→ 本機 Edge 呼叫真實模型(不開 stub)→ 起稿 → 畫面操作,不是只驗共用呼叫函式。
//   **不在一般 e2e:real 裡跑**:要 E2E_LIVE_PHOTOS=1、`supabase functions serve` 不帶 PMIS_VISION_STUB(模型金鑰有效)、
//   且 repo 根目錄有五張照片(真實現場照、含可識別資訊,依約定不進版控;缺檔就 skip)。會呼叫付費模型(約 USD 0.2)。
//   模型輸出每次可能不同(B2 實測逐格抄錄 7–8/8),所以斷言分兩層:
//     * 紅線(每次都必須成立,錯了就紅):設計欄的搭接 ≥27 cm 不進格子;卡尺特寫不產生讀數;每一筆讀數都落在人工標註的
//       真值內(不同編號不混、兩向不截半);AI 版本沒有任何項目被系統自動確認;簽署後事實列保存讀數、PDF 印得出讀數。
//     * 抄錄率:逐筆對照人工標註寫進報告 test-results/live-paper-photos.json(另存到驗收附件),不當成通過門檻。
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readPdf } from '../e2e/pdfText.js'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, gotoHash, runCleanup,
} from './helpers.js'

const PHOTOS = ['LI2995~1_0.JPG', 'LI89DE~1_0.JPG', 'LIEE66~1_0.JPG', 'LIFA1C~1_0.JPG', 'LINE_A~4_0.JPG']
// 人工標註(驗收報告「照片驗收:本機目視基準」):項次 → 編號 → 兩向尺寸(範本單位)
const TRUTH = { 1: { 1: '13×11', 4: '11×11' }, 2: { 1: '15×15', 4: '15×15' } }
const OUT = process.env.PDF_OUT_DIR || 'test-results'
const live = process.env.E2E_LIVE_PHOTOS === '1'
const missing = PHOTOS.filter((f) => !existsSync(resolve(f)))

const PROJECT_NAME = `鏈23真照片-${Date.now().toString(36)}`
const conEmail = uniqueEmail('g23-con')
let conId, projectId, templateId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '鋼筋及點焊鋼線網加工組立', unit: 'M2', quantity: 500, unit_price: 300, amount: 150000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]
// 本案自訂的鋼線網自主檢查項目(單位與紙上欄位一致;量化標準由本案訂,不取台北市範例的示例值)
const TEMPLATE_ITEMS = [
  { no: '1', group: '鋼線網', item: '鋼線網線徑', kind: 'num', min: 10, max: 14, unit: 'mm', standard: '依圖說(編號 1 13×11 mm、編號 4 11×11 mm)' },
  { no: '2', group: '鋼線網', item: '鋼線網網目', kind: 'num', min: 14, max: 16, unit: 'cm', standard: '15×15 cm' },
  { no: '3', group: '鋼線網', item: '搭接長度', kind: 'num', min: 27, unit: 'cm', standard: '≥27 cm' },
  { no: '4', group: '鋼線網', item: '鋼線網綁紮固定牢靠', kind: 'bool', standard: '目視' },
]
const dims = (r) => (r.value2 == null ? `${r.value}` : `${r.value}×${r.value2}`)

test.skip(!live, '手動 live 鏈:設 E2E_LIVE_PHOTOS=1 且 functions serve 不開 stub 才跑')
test.skip(live && missing.length > 0, `缺本機照片:${missing.join('、')}(真實現場照不進版控)`)

test.beforeAll(async () => {
  if (!live || missing.length) return
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈廿三廠商')
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

test('鏈 23(live):五張真實照片 → 真實模型 → 自檢表格子分列讀數 → 確認 → 重整 → 簽署 → PDF', async ({ page }) => {
  test.setTimeout(900_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })
  await loginReal(page, conEmail)
  await gotoHash(page, '/site')
  const started = Date.now()
  await page.getByLabel('選擇照片上傳').setInputFiles(PHOTOS.map((f) => resolve(f)))
  await expect(page.getByText(`已保存到伺服器 ${PHOTOS.length}／${PHOTOS.length}`)).toBeVisible({ timeout: 180_000 })
  const uploadCard = page.getByRole('group', { name: '拍照／上傳' })
  await expect(uploadCard.getByText('已起稿').first()).toBeVisible({ timeout: 600_000 })
  await expect(uploadCard.getByText(/模型輸出為本機 stub/)).toHaveCount(0) // 必須是真實模型
  const draftMs = Date.now() - started

  // ── 報告:每張照片的辨識結果＋每份自檢表草稿的每一格(先寫檔再斷言,紅了也留得下資料)──────────────
  const con = await signInClient(conEmail)
  const { data: photos } = await con.from('photos').select('id, storage_path, content_sha256, ai_status, ai_result, location, taken_at').eq('project_id', projectId)
  const { data: docs } = await con.from('field_documents').select('id, doc_type, doc_date, status').eq('project_id', projectId).order('doc_date')
  const selfChecks = docs.filter((d) => d.doc_type === 'self_check')
  const versions = []
  for (const d of selfChecks) {
    const { data: v } = await con.from('field_document_versions').select('version_no, author_kind, content, field_sources, attachments').eq('document_id', d.id).eq('version_no', 1).single()
    versions.push({ doc: d, v })
  }
  const report = {
    tested_at_utc: new Date().toISOString(),
    scope: '網頁真的上傳(前端壓縮)→ 本機 Edge draft-field-documents 呼叫真實模型(未開 stub)→ 起稿 → 自檢表格子;模型同產品設定',
    photos_uploaded: PHOTOS,
    draft_ms: draftMs,
    truth: TRUTH,
    photos: photos.map((p) => ({
      id: p.id, ai_status: p.ai_status, location: p.location, taken_at: p.taken_at,
      record_medium: p.ai_result?.classify?.record_medium ?? null, text_legible: p.ai_result?.classify?.text_legible ?? null,
      caption: p.ai_result?.classify?.caption ?? null, work_item_hint: p.ai_result?.classify?.work_item_hint ?? null,
      log_date: p.ai_result?.whiteboard?.log_date ?? null, whiteboard_skipped: p.ai_result?.whiteboard_skipped ?? null,
      paper_cells_skipped: p.ai_result?.paper_cells_skipped ?? null,
      measured: (p.ai_result?.whiteboard?.observations || []).filter((o) => o.kind === 'measured').map((o) => ({ label: o.label, entry_no: o.entry_no, raw_text: o.raw_text, value: o.value, value2: o.value2, unit: o.unit })),
      design_count: (p.ai_result?.whiteboard?.observations || []).filter((o) => o.kind === 'design').length,
    })),
    self_checks: versions.map(({ doc, v }) => ({
      doc_id: doc.id, doc_date: doc.doc_date, status: doc.status, author_kind: v.author_kind,
      attachments: (v.attachments || []).length,
      cells: Object.fromEntries(TEMPLATE_ITEMS.map((it) => [it.no, {
        item: it.item, value: v.content.results?.[it.no]?.value ?? null, readings: v.content.results?.[it.no]?.readings ?? null,
        status: v.field_sources[`results.${it.no}`]?.status ?? null, reason: v.field_sources[`results.${it.no}`]?.reason ?? null,
        evidence_photos: [...new Set((v.field_sources[`results.${it.no}`]?.evidence || []).map((e) => e.photo_id))],
      }])),
    })),
  }
  // 抄錄率(兩個口徑,都只記錄不當門檻):
  //   * 逐張照片:三張紙表人工標註共 8 筆實測(LINE_A 4、LI2995 2、LIFA1C 2);照片列不帶原檔名(前端壓縮後重算雜湊),
  //     所以只數「讀到的實測觀察有幾筆落在標註內、幾筆不在」,不對檔名;
  //   * 表上:跨照片去重後,自檢表格子裡的 (項次, 編號, 兩向) 有幾筆命中 4 個標註值。
  const itemOf = (label) => (/線徑/.test(label) ? '1' : /網目/.test(label) ? '2' : /搭接/.test(label) ? '3' : null)
  const perPhoto = { measured: 0, in_truth: 0, not_in_truth: [] }
  for (const p of report.photos) for (const o of p.measured) {
    perPhoto.measured++
    const no = itemOf(o.label)
    const entry = String(o.entry_no || '').replace(/\D/g, '')
    if (no && TRUTH[no]?.[entry] === dims(o)) perPhoto.in_truth++
    else perPhoto.not_in_truth.push({ photo: p.id, ...o })
  }
  report.per_photo_measured = { ...perPhoto, annotated_total: 8 }
  const got = new Set()
  for (const sc of report.self_checks) for (const no of ['1', '2']) for (const r of sc.cells[no].readings || []) got.add(`${no}:${r.entry_no}:${dims(r)}`)
  const expected = Object.entries(TRUTH).flatMap(([no, m]) => Object.entries(m).map(([e, d]) => `${no}:${e}:${d}`))
  report.transcription = { expected, got: [...got], hit: expected.filter((k) => got.has(k)).length, of: expected.length }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'live-paper-photos.json'), JSON.stringify(report, null, 2))

  // ── 紅線 ─────────────────────────────────────────────────────────────────────────────────────
  expect(photos).toHaveLength(PHOTOS.length)
  expect(selfChecks.length, '至少起一份自主檢查表').toBeGreaterThan(0)
  const paperIds = new Set(report.photos.filter((p) => p.record_medium === 'paper_form').map((p) => p.id))
  for (const { v } of versions) expect(v.content.template_id, '自檢表用本案的鋼線網範本').toBe(templateId)
  for (const sc of report.self_checks) {
    expect(sc.cells['3'].value, '設計欄的搭接 ≥27 cm 不得進實測格').toBeNull()
    expect(sc.cells['3'].readings, '設計欄的搭接 ≥27 cm 不得進實測格').toBeNull()
    for (const no of ['1', '2']) {
      const c = sc.cells[no]
      expect(['filled', 'pending'], 'AI 版本不得自動確認').toContain(c.status)
      for (const r of c.readings || []) {
        expect(TRUTH[no][r.entry_no], `項次 ${no} 的讀數 編號 ${r.entry_no} ${dims(r)} 不在人工標註內`).toBe(dims(r))
      }
      if (c.value != null) expect(Object.values(TRUTH[no]).join('×').split('×').map(Number)).toContain(c.value)
      for (const pid of c.evidence_photos) expect(paperIds.has(pid), '讀數只能來自紙表照片(卡尺特寫不得產生讀數)').toBe(true)
    }
    expect(sc.cells['4'].status, '勾選項沒有逐項依據,不代為勾選').toBe('pending')
  }
  for (const p of report.photos.filter((x) => x.record_medium !== 'paper_form')) expect(p.measured, '非紙表照片不得有實測讀數').toEqual([])

  // ── 畫面:讀數最多的那份 → 格子裡看得到讀數 → 逐項確認／標不適用 → 存檔 → 重整 → 簽署 → 列印 → PDF ───────
  const target = [...report.self_checks].sort((a, b) =>
    ((b.cells['1'].readings?.length || 0) + (b.cells['2'].readings?.length || 0)) - ((a.cells['1'].readings?.length || 0) + (a.cells['2'].readings?.length || 0)))[0]
  await gotoHash(page, `/self-check?doc=${target.doc_id}`)
  const card = page.getByRole('group', { name: '本份自主檢查表', exact: true })
  await expect(saveStatus).toHaveText(/已存檔.*版本 1/, { timeout: 30_000 })
  await page.screenshot({ path: join(OUT, 'live-selfcheck-draft.png'), fullPage: true })
  for (const it of TEMPLATE_ITEMS.filter((x) => x.kind === 'num')) {
    const cell = target.cells[it.no]
    const row = card.getByRole('row').filter({ hasText: it.item }).first()
    for (const [i, r] of (cell.readings || []).entries()) {
      await expect(card.getByRole('spinbutton', { name: `${it.no} ${it.item} 第 ${i + 1} 筆 讀數` })).toHaveValue(String(r.value))
    }
    if (cell.status === 'filled') {
      await row.getByRole('button', { name: '確認', exact: true }).click()
    } else {
      await row.getByRole('button', { name: '不適用', exact: true }).click()
      const dlg = page.getByRole('dialog')
      await dlg.getByRole('textbox').fill('紙上實測欄沒有這一項的紀錄,本次未檢')
      await dlg.getByRole('button', { name: '確定' }).click()
    }
  }
  await card.getByRole('checkbox', { name: '4 鋼線網綁紮固定牢靠 合格' }).check()
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 2，可簽署/)).toBeVisible({ timeout: 30_000 })
  await page.reload()
  await expect(saveStatus).toHaveText(/已存檔.*版本 2/, { timeout: 30_000 })
  const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
  await expect(lifecycle.getByText(/版本 2 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  const { data: signed } = await con.from('field_documents').select('status, target_id').eq('id', target.doc_id).single()
  const { data: rec } = await con.from('checklist_records').select('results, overall').eq('id', signed.target_id).single()
  for (const no of ['1', '2']) expect(rec.results[no].readings ?? null).toEqual(target.cells[no].readings)
  report.signed = { overall: rec.overall, results: rec.results }

  await gotoHash(page, `/self-check/print?doc=${target.doc_id}`)
  await expect(page.getByRole('button', { name: '下載 PDF' })).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: join(OUT, 'live-selfcheck-print.png'), fullPage: true })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByRole('button', { name: '下載 PDF' }).click(),
  ])
  const pdfPath = join(OUT, `live-${download.suggestedFilename()}`)
  await download.saveAs(pdfPath)
  const pdf = readPdf(readFileSync(pdfPath))
  const flat = pdf.text.replace(/\s+/g, '')
  for (const no of ['1', '2']) {
    const unit = TEMPLATE_ITEMS.find((x) => x.no === no).unit
    for (const r of target.cells[no].readings || []) expect(flat).toContain(`${r.entry_no ? `編號${r.entry_no}` : ''}${dims(r)}${unit}`)
  }
  report.pdf = { file: pdfPath, pages: pdf.pageCount, font_embedded: pdf.hasFontFile }
  writeFileSync(join(OUT, 'live-paper-photos.json'), JSON.stringify(report, null, 2))
  await con.auth.signOut()
})
