// C 包｜鏈 17:廠商**直接在真實表單的格子裡**編輯施工日誌(真 Supabase、正式模式)。
//   驗收退回的 P0 是「廠商編輯畫面與紙本不同」:以前要先填一份精簡表、再切「公定格式檢視」才看得到真表。
//   這條鏈證明改完之後,廠商一進 /site-log 看到的就是工程會附表四本身,而且:
//     原表欄名的格子可直接輸入 → 存檔(伺服器保存版本、判待補)→ 待補補齊 → 簽署(平台帳號,daily_logs 落庫)
//     → 提送監造 → 監造收件;監造開同一份文件時是同一張紙、但不長出任何輸入框。
//   另外釘住 C 包的兩條語意:
//     * 表單範本鍵與版本寫進內容(content.form_template),簽署版本因此自己記得當時的版面語意;
//     * 累計工期／預定進度等確定性欄位算不出來時紙上標「待補」,不由 AI 產生數字。
// 本鏈不需要照片辨識(不必另起 `supabase functions serve`);照片起稿的路徑仍由鏈 5／鏈 8 涵蓋。
// 帳號與專案全部本次產生,afterAll 清乾淨。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup,
} from './helpers.js'

const PROJECT_NAME = `鏈17紙本表單-${Date.now().toString(36)}`
const conEmail = uniqueEmail('c17-con')
const supEmail = uniqueEmail('c17-sup')
let conId, supId, projectId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '結構混凝土', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈十七廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十七監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '甲營造股份有限公司', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
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

test('鏈 17:廠商在真實表單格子編輯 → 存檔 → 簽署 → 提送 → 監造收件(同一張紙、唯讀無輸入框)', async ({ page }) => {
  test.setTimeout(300_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })

  // ── 廠商:一進施工日誌就是工程會附表四本身(不必先填精簡表、也沒有「公定格式檢視」切換)──
  await loginReal(page, conEmail)
  await gotoHash(page, '/site-log')
  await expect(page.getByRole('heading', { level: 1, name: '施工日誌', exact: true })).toBeVisible()
  const card = page.getByRole('group', { name: '本日日誌', exact: true })
  // 嵌在頁面裡的紙本標題降一級(一頁只有一個 h1)
  await expect(card.getByRole('heading', { level: 2, name: '公共工程施工日誌', exact: true })).toBeVisible()
  await expect(card.getByText('參考工程會格式', { exact: false })).toBeVisible()
  await expect(card.getByText('未經機關核定', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '公定格式檢視' })).toHaveCount(0)
  // 專案資料自動帶入;確定性欄位算不出來標待補(本案沒有基準日與預定進度表)
  await expect(card.getByText('甲營造股份有限公司')).toBeVisible()
  await expect(card.getByText('核定工期：待補')).toBeVisible()
  await expect(card.getByText('預定進度(%)：待補')).toBeVisible()
  await expect(saveStatus).toHaveText('本日尚無日誌')

  // ── 在原表的格子裡逐欄輸入(欄名就是原表欄名)──────────────────────────────────
  await card.getByRole('textbox', { name: '表報編號' }).fill('A-113-001')
  await card.getByRole('textbox', { name: '本日天氣上午' }).fill('晴')
  await card.getByRole('textbox', { name: '本日天氣下午' }).fill('陰')
  await card.getByRole('textbox', { name: '施工概況摘要' }).fill('4F 版牆結構混凝土澆置')
  await card.getByRole('textbox', { name: '搜尋工項加入今日回報' }).fill('結構混凝土')
  await card.getByRole('button', { name: /結構混凝土/ }).click()
  await card.getByRole('spinbutton', { name: '一 結構混凝土 本日完成數量' }).fill('12.5')
  await card.getByRole('textbox', { name: '一 結構混凝土 備註' }).fill('B 區')
  await card.getByRole('button', { name: '新增工別列' }).click()
  await card.getByRole('textbox', { name: '工別 1' }).fill('模板工')
  await card.getByRole('spinbutton', { name: '工別 1 本日人數' }).fill('6')
  await card.getByRole('button', { name: '新增機具列' }).click()
  await card.getByRole('textbox', { name: '機具 1 名稱' }).fill('混凝土泵浦車')
  await card.getByRole('spinbutton', { name: '機具 1 本日使用數量' }).fill('1')
  await card.getByRole('button', { name: '新增材料列' }).click()
  await card.getByRole('textbox', { name: '材料 1 名稱' }).fill('3000psi 混凝土')
  await card.getByRole('textbox', { name: '材料 1 單位' }).fill('M3')
  await card.getByRole('spinbutton', { name: '材料 1 本日使用數量' }).fill('12.5')
  await expect(saveStatus).toHaveText('未存檔')

  // ── 存檔=伺服器保存版本;內容確實是從紙上那些格子來的 ─────────────────────────
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 1/)).toBeVisible({ timeout: 30_000 })
  const con = await signInClient(conEmail)
  const { data: docs } = await con.from('field_documents').select('id, status, current_version_no, doc_date').eq('project_id', projectId).eq('doc_type', 'daily_log')
  expect(docs).toHaveLength(1)
  const docId = docs[0].id
  expect(docs[0].doc_date).toBe(today)
  const { data: v1 } = await con.from('field_document_versions').select('content, field_sources, content_hash').eq('document_id', docId).eq('version_no', 1).single()
  expect(v1.content.doc_no).toBe('A-113-001')
  expect(v1.content.weather_am).toBe('晴')
  expect(v1.content.weather_pm).toBe('陰')
  expect(v1.content.work_summary).toBe('4F 版牆結構混凝土澆置')
  expect(v1.content.labor).toEqual([{ type: '模板工', count: 6 }])
  expect(v1.content.equipment).toEqual([{ name: '混凝土泵浦車', count: 1 }])
  expect(v1.content.materials).toEqual([{ name: '3000psi 混凝土', unit: 'M3', qty: 12.5 }])
  // 簽署版本記得自己的表單範本版本(之後改範本不改寫舊文件)
  expect(v1.content.form_template).toEqual({ key: 'pcc-daily-log-1080430', version: 1 })
  const itemId = Object.keys(v1.content.items)[0]
  expect(v1.content.items[itemId]).toMatchObject({ qty_today: 12.5, note: 'B 區' })
  expect(v1.field_sources[`items.${itemId}.qty_today`]).toEqual({ status: 'confirmed', source: 'human' })

  // ── 簽署(登入的平台帳號)→ daily_logs 落庫 → 提送監造 ─────────────────────────
  const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await expect(lifecycle.getByText(/版本 1・雜湊 [0-9a-f]{12}/)).toBeVisible()
  await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
  await expect(lifecycle.getByText(/版本 1 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  const { data: signedDoc } = await con.from('field_documents').select('status, target_id, target_table').eq('id', docId).single()
  expect(signedDoc).toMatchObject({ status: 'signed', target_table: 'daily_logs' })
  const { data: fact } = await con.from('daily_logs').select('log_date, weather_am, weather_pm, work_summary, labor').eq('id', signedDoc.target_id).single()
  expect(fact).toMatchObject({ log_date: today, weather_am: '晴', weather_pm: '陰', work_summary: '4F 版牆結構混凝土澆置' })
  await lifecycle.getByRole('button', { name: '提送給監造' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '提送', exact: true }).click()
  await expect(lifecycle.getByText(/已提送給監造/)).toBeVisible({ timeout: 30_000 })

  // ── 簽署後紙上的格子鎖定:要先「建立更正版本」才可再編 ──────────────────────────
  await expect(card.getByRole('textbox', { name: '本日天氣上午' })).toHaveCount(0)
  await expect(card.getByText(/內容已鎖定/)).toBeVisible()
  await expect(page.getByRole('button', { name: '建立更正版本' })).toBeVisible()

  // ── 監造:同一張紙、同樣的原表欄名,但沒有任何輸入框(唯讀),可收件 ────────────────
  await logoutReal(page)
  await loginReal(page, supEmail)
  await gotoHash(page, `/site-log?doc=${docId}`)
  const supCard = page.getByRole('group', { name: '本日日誌', exact: true })
  await expect(supCard.getByRole('heading', { level: 2, name: '公共工程施工日誌', exact: true })).toBeVisible()
  await expect(supCard.getByText('4F 版牆結構混凝土澆置')).toBeVisible()
  // 紙上(.paper)一個輸入元件都沒有;卡片其他地方的收件／退回原因不算紙本的格子
  await expect(supCard.locator('.paper input, .paper textarea, .paper select')).toHaveCount(0)
  const supLifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await supLifecycle.getByRole('button', { name: '收件', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '收件', exact: true }).click()
  await expect(supLifecycle.getByText(/監造已於 .* 收件（版本 1）/)).toBeVisible({ timeout: 30_000 })
  const { data: received } = await con.from('field_documents').select('status').eq('id', docId).single()
  expect(received.status).toBe('received')
})
