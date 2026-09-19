// P3a｜鏈 6:監造日誌完整路徑(真 Supabase,正式模式,本機 Edge stub 模型)。
//   監造上傳自己的照片 → 伺服器起稿監造日誌(示範範本;到場永遠留空)→ 監造親自填寫並確認到場、補天氣與廠商施工情形
//   → 存檔 → 簽署(登入的平台帳號;事實表 supervisor_logs 落庫)→ 提送機關 → 機關退回(必填原因)→ 監造更正版本重簽再送
//   → 機關收件;另驗:廠商可讀但唯讀(Q4)、到場只被標 filled 時簽署被 PD004 needs_confirmation 擋、廠商照片不能作監造證據(PD005)。
// 前置同 chain 5(docs/REAL_BACKEND_E2E.md):另一個 terminal `supabase functions serve --env-file e2e-real/stub.env`。
// 帳號全部本次產生;afterAll 以建立者 delete_project＋admin API 清帳號,殘留 0。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup, tinyJpeg,
} from './helpers.js'

const PROJECT_NAME = `鏈6監造日誌-${Date.now().toString(36)}`
const conEmail = uniqueEmail('w6c6-con')
const supEmail = uniqueEmail('w6c6-sup')
const ownEmail = uniqueEmail('w6c6-own')
let conId, supId, ownId, projectId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '假設工程', unit: '式', quantity: 1, unit_price: 1000, amount: 1000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈六廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈六監造')
  ownId = await createConfirmedUser(ownEmail, 'owner', '鏈六機關')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  for (const [email, org] of [[supEmail, 'supervisor'], [ownEmail, 'owner']]) {
    const { error } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: email, p_role: 'member', p_expected_org: org })
    if (error) throw new Error(`邀請失敗(${email}):${error.message}`)
  }
  const { data: fm, error: fmError } = await c.from('projects').update({ formal_mode: true }).eq('id', projectId).select('id')
  if (fmError || !fm?.length) throw new Error(`開啟正式模式失敗:${fmError?.message || 'RLS 未生效'}`)
  await c.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
    () => cleanupUser(ownId),
  )
})

test('鏈 6:監造上傳→起稿→到場親自確認→簽署→提送機關→機關退回→補正再送→機關收件;廠商唯讀、到場未確認與廠商照片被伺服器擋', async ({ page }) => {
  test.setTimeout(420_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })

  // ── 廠商先傳一張照片(不起簽署):供「廠商照片不能作監造證據」用 ─────────────────────
  const con = await signInClient(conEmail)
  const conPhotoId = crypto.randomUUID()
  {
    const { data: intake, error } = await con.from('photo_intakes').insert({ id: crypto.randomUUID(), project_id: projectId, log_date: today }).select('id').single()
    if (error) throw new Error(`廠商批次建立失敗:${error.message}`)
    const path = `${projectId}/intake/${intake.id}/${conPhotoId}.jpg`
    const { error: upErr } = await con.storage.from('photos').upload(path, tinyJpeg('con'), { contentType: 'image/jpeg' })
    if (upErr) throw new Error(`廠商照片上傳失敗:${upErr.message}`)
    const { error: insErr } = await con.from('photos').insert({ id: conPhotoId, project_id: projectId, daily_log_id: null, work_item_id: null, storage_path: path, intake_id: intake.id, content_sha256: null, taken_at: new Date().toISOString(), uploaded_by: conId })
    if (insErr) throw new Error(`廠商照片列寫入失敗:${insErr.message}`)
  }

  // ── 監造(一般登入,沒有驗證碼步驟):現場紀錄上傳兩張監造照片 → 伺服器起稿監造日誌 ──────────────
  await loginReal(page, supEmail)
  await gotoHash(page, '/site')
  await expect(page.getByRole('heading', { level: 1, name: '現場紀錄' })).toBeVisible()
  await expect(page.getByRole('group', { name: '拍照／上傳' }).getByText('監造日誌／查驗表單自動起稿')).toBeVisible()
  await page.getByLabel('選擇照片上傳').setInputFiles([
    { name: 'sup-a.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('sa') },
    { name: 'sup-b.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('sb') },
  ])
  await expect(page.getByText('已保存到伺服器 2／2')).toBeVisible({ timeout: 60_000 })
  const uploadCard = page.getByRole('group', { name: '拍照／上傳' })
  await expect(uploadCard.getByText('已起稿').first()).toBeVisible({ timeout: 90_000 })
  await expect(uploadCard.getByText(/監造日誌 \d{4}-\d{2}-\d{2}/).first()).toBeVisible()
  await expect(uploadCard.getByText(/監造查驗表單/)).toBeVisible() // 候選列出但尚未支援
  const sup = await signInClient(supEmail)
  const { data: supDocs } = await sup.from('field_documents').select('id, status, current_version_no, doc_type').eq('project_id', projectId).eq('doc_type', 'supervisor_log')
  expect(supDocs).toHaveLength(1)
  const docId = supDocs[0].id
  expect(supDocs[0].status).toBe('pending_input') // 到場待人填
  // AI 版本:到場留空且 pending(任何照片都不是到場證明)
  const { data: v1 } = await sup.from('field_document_versions').select('content, field_sources, content_hash').eq('document_id', docId).eq('version_no', 1).single()
  expect(v1.content.attendance).toEqual([])
  expect(v1.field_sources.attendance.status).toBe('pending')

  // ── /site 現場文書清單直達監造日誌頁 ─────────────────────────────────────────────
  const docCard = page.getByRole('group', { name: '現場文書' })
  await docCard.getByRole('link', { name: new RegExp(`監造日誌 ${today}`) }).click()
  await expect(page).toHaveURL(/#\/supervisor-log\?doc=/)
  await expect(page.getByRole('heading', { level: 1, name: '監造日誌' })).toBeVisible()
  const card = page.getByRole('group', { name: '本日監造日誌', exact: true })
  await expect(card.getByText('示範範本').first()).toBeVisible()
  await expect(card.getByRole('note')).toContainText('非任何機關公定或法定格式')
  await expect(saveStatus).toHaveText(/已存檔.*版本 1/)
  await expect(card.getByText('已帶入・待核對・照片 AI 說明').first()).toBeVisible() // 監造事項來自監造照片(stub)
  await expect(card.getByText('來源：照片 AI 說明').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0)
  // 到場:帶入本人 → 待親自確認 → 確認;天氣人填;廠商施工情形:當日無施工日誌 → 標「廠商未施工」＋原因
  await card.getByRole('button', { name: '帶入本人' }).click()
  await expect(card.getByText('已填・待親自確認')).toBeVisible()
  await page.getByLabel('鏈六監造 到場時間').fill('09:00')
  await page.getByLabel('鏈六監造 離場時間').fill('12:00')
  // 先只「填」不「確認」就存檔 → 伺服器 recheck 標 needs_confirmation,簽署被擋(不是前端擋)
  await page.getByRole('textbox', { name: '天氣(上午)' }).fill('晴')
  await page.getByRole('textbox', { name: '天氣(下午)' }).fill('多雲')
  await card.getByRole('button', { name: '廠商未施工' }).click()
  const naDialog = page.getByRole('dialog', { name: /本日不適用/ })
  await naDialog.locator('textarea').fill('廠商本日未施工')
  await naDialog.getByRole('button', { name: '確定', exact: true }).click()
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 2，尚有 1 項待補或待確認/)).toBeVisible({ timeout: 30_000 })
  // 指名頁面「待補」清單的那一項(按鈕):存檔後文件狀態卡重載完也會列「伺服器待補清單：到場人員與時段（待親自確認）」,
  // 用 getByText 會在重載完成前後命中 1 或 2 個元素,快慢不同就假紅(T1 連跑實測 strict mode violation)
  await expect(card.getByRole('button', { name: '到場人員與時段（待親自確認）', exact: true })).toBeVisible()
  const { data: v2 } = await sup.from('field_document_versions').select('content_hash').eq('document_id', docId).eq('version_no', 2).single()
  // 直接呼叫簽署 RPC(繞過前端):到場只被標 filled → PD004 needs_confirmation(這是伺服器規則,不是前端擋)
  await sup.auth.signOut()
  const supApi = await signInClient(supEmail)
  const { error: unconfirmedErr } = await supApi.rpc('sign_field_document', { p_document_id: docId, p_version_no: 2, p_content_hash: v2.content_hash, p_intent: '測試:到場未確認' })
  expect(unconfirmedErr?.code).toBe('PD004')
  expect(JSON.parse(unconfirmedErr.details)).toEqual(expect.arrayContaining([{ key: 'attendance', status: 'needs_confirmation' }]))
  // 廠商照片當監造證據 → 存版 recheck 列附件問題、簽署 PD005
  const { data: v2full } = await supApi.from('field_document_versions').select('content, field_sources, attachments').eq('document_id', docId).eq('version_no', 2).single()
  const confirmedSources = { ...v2full.field_sources, attendance: { status: 'confirmed', source: 'human' } }
  const { data: saved3, error: save3Err } = await supApi.rpc('save_field_document_version', {
    p_document_id: docId, p_base_version_no: 2, p_content: v2full.content, p_field_sources: confirmedSources,
    p_attachments: [...v2full.attachments, { photo_id: conPhotoId, role: 'evidence' }], p_change_note: '測試:廠商照片當證據',
  })
  if (save3Err) throw new Error(`存版 3 失敗:${save3Err.message}`)
  expect(saved3.recheck).toEqual(expect.arrayContaining([{ key: `attachments.${conPhotoId}`, status: 'uploader_org:contractor' }]))
  const { error: pd005 } = await supApi.rpc('sign_field_document', { p_document_id: docId, p_version_no: 3, p_content_hash: saved3.content_hash, p_intent: '測試:廠商照片' })
  expect(pd005?.code).toBe('PD005')
  await supApi.auth.signOut()

  // ── 回頁面:伺服器版本已前進(版本 3)→ 重新載入;附件問題逐張標示 → 改為參考;確認到場 → 存檔 → 簽署 ──
  await page.reload()
  await page.getByRole('heading', { level: 1, name: '監造日誌' }).waitFor()
  await expect(saveStatus).toHaveText(/已存檔.*版本 3/)
  await expect(card.getByText('施工廠商上傳的照片,只能以「參考」附上')).toBeVisible()
  await expect(card.getByText('施工廠商提供')).toBeVisible()
  await card.getByRole('button', { name: '改為參考' }).last().click()
  // 版本 3 的到場已在 RPC 步驟標 confirmed(要讓 PD005 不被 PD004 先擋),頁面顯示「已確認」、沒有確認鈕;
  // 「填→待親自確認→確認」的 UI 閘門由本鏈前段(版本 2)與 Demo E2E／Vitest 釘住
  await expect(card.getByRole('button', { name: '確認到場人員' })).toHaveCount(0)
  await expect(card.getByText(/到場人員與時段（待親自確認）/)).toHaveCount(0)
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 4，可簽署/)).toBeVisible({ timeout: 30_000 })
  const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await expect(lifecycle.getByText(/版本 4・雜湊 [0-9a-f]{12}/)).toBeVisible()
  await expect(lifecycle.getByText('示範範本')).toBeVisible()
  await expect(lifecycle.getByText(/本人確認 .* 監造日誌\(版本 4,內容雜湊 [0-9a-f]{12}\)/)).toBeVisible()
  await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
  await expect(lifecycle.getByText(/版本 4 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  await expect(lifecycle.getByText(/方式 平台帳號$/)).toBeVisible()
  await expect(lifecycle.getByText(/兩步驟驗證|驗證碼/)).toHaveCount(0)
  const supRead = await signInClient(supEmail)
  const { data: logRow } = await supRead.from('supervisor_logs').select('id, attendance, weather_am, contractor_summary, template_key, template_version').eq('project_id', projectId).eq('log_date', today).maybeSingle()
  expect(logRow?.attendance?.[0]).toMatchObject({ user_id: supId, from: '09:00', to: '12:00' })
  expect(logRow?.weather_am).toBe('晴')
  expect(logRow?.contractor_summary).toBeNull() // 不適用不寫「無」
  expect(logRow?.template_key).toBe('supervisor_log_demo')
  // 列印:印簽署版本(版本 4、雜湊、示範範本、簽署者)
  await gotoHash(page, `/supervisor-log/print?doc=${docId}`)
  await expect(page.getByText('【示範範本】範本 supervisor_log_demo v1')).toBeVisible({ timeout: 30_000 })
  const { data: v4 } = await supRead.from('field_document_versions').select('content_hash').eq('document_id', docId).eq('version_no', 4).single()
  await expect(page.getByText(`內容雜湊 ${v4.content_hash.slice(0, 12)}`)).toBeVisible()
  await expect(page.getByText(/簽署 鏈六監造・/)).toBeVisible()
  await expect(page.getByText('草稿・未簽署')).toHaveCount(0)
  await page.getByRole('button', { name: '← 返回監造日誌' }).click()
  await expect(page).toHaveURL(/#\/supervisor-log\?doc=/)

  // ── 提送機關 ──────────────────────────────────────────────────────────────────────
  await lifecycle.getByRole('button', { name: '提送給機關' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '提送', exact: true }).click()
  await expect(lifecycle.getByText(/已提送給機關/)).toBeVisible({ timeout: 30_000 })
  await logoutReal(page)

  // ── 廠商:可讀但唯讀(Q4);沒有收件鈕 ─────────────────────────────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, `/supervisor-log?doc=${docId}`)
  await expect(page.getByText(/此頁為唯讀/).first()).toBeVisible()
  await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '存檔', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '收件', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '文件狀態與簽署' }).getByText('施工廠商為查閱視角；提送對象是機關')).toBeVisible()
  await logoutReal(page)

  // ── 機關(桌機 1024):待收件 → 開啟 → 退回並填原因 ────────────────────────────────
  await page.setViewportSize({ width: 1024, height: 800 })
  await loginReal(page, ownEmail)
  await gotoHash(page, '/site')
  const ownDocCard = page.getByRole('group', { name: '現場文書' })
  await expect(ownDocCard.getByText('已提送・待收件')).toBeVisible({ timeout: 30_000 })
  await ownDocCard.getByRole('link', { name: new RegExp(`監造日誌 ${today}`) }).click()
  await expect(page).toHaveURL(/#\/supervisor-log\?doc=/)
  await expect(page.getByText(/此頁為唯讀/).first()).toBeVisible()
  await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
  const ownLifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await ownLifecycle.getByRole('button', { name: '退回（填原因）' }).click()
  const returnDialog = page.getByRole('dialog')
  await returnDialog.locator('textarea').fill('請補當日查驗情形說明')
  await returnDialog.getByRole('button', { name: '確定', exact: true }).click()
  await expect(ownLifecycle.getByText(/已退回，原因已留存/)).toBeVisible({ timeout: 30_000 })
  await logoutReal(page)

  // ── 監造(手機 375):看到退回原因 → 更正備註 → 存檔版本 5 → 重簽 → 再送(diff 由 DB 算);375 無溢位 ──
  await page.setViewportSize({ width: 375, height: 812 })
  await loginReal(page, supEmail)
  await gotoHash(page, `/supervisor-log?doc=${docId}`)
  const supLifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await expect(supLifecycle.getByText('請補當日查驗情形說明', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(supLifecycle.getByText(/機關退回（版本 4/)).toBeVisible()
  await page.getByRole('textbox', { name: '備註' }).fill('本日無查驗申請；已電話通知廠商明日申請 4F 模板查驗')
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 5，可簽署/)).toBeVisible({ timeout: 30_000 })
  await expect(supLifecycle.getByText(/版本 4 的簽署仍綁在該版本/)).toBeVisible()
  await supLifecycle.getByRole('button', { name: '簽署此版本' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
  await expect(supLifecycle.getByText(/版本 5 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  await supLifecycle.getByRole('button', { name: '提送給機關' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '提送', exact: true }).click()
  await expect(supLifecycle.getByText(/已提送給機關/)).toBeVisible({ timeout: 30_000 })
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    if (doc.scrollWidth <= doc.clientWidth) return null
    return [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 8).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`)
  })
  expect(overflow, '375 寬度不得水平溢位').toBeNull()
  await page.setViewportSize({ width: 1280, height: 800 })
  await logoutReal(page)

  // ── 機關:歷次退回原因與再送差異保留 → 收件 ─────────────────────────────────────
  await loginReal(page, ownEmail)
  await gotoHash(page, `/supervisor-log?doc=${docId}`)
  const ownLifecycle2 = page.getByRole('region', { name: '文件狀態與簽署' })
  await ownLifecycle2.getByText(/歷次提送紀錄/).click()
  await expect(ownLifecycle2.getByText('原因：請補當日查驗情形說明')).toBeVisible()
  await expect(ownLifecycle2.getByText(/相對退回版本 4 的差異：.*備註/)).toBeVisible()
  await ownLifecycle2.getByRole('button', { name: '收件', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '收件', exact: true }).click()
  await expect(ownLifecycle2.getByText(/機關已於 .* 收件（版本 5）/)).toBeVisible({ timeout: 30_000 })
  await logoutReal(page)

  // 伺服器事實:提送列 submit:4→return:4→submit:5→receive:5;文件 received 綁同一 supervisor_logs 列;事實列為版本 5 內容
  const { data: subs } = await supRead.from('field_document_submissions').select('action, version_no, reason, diff').eq('document_id', docId).order('created_at')
  expect(subs.map((s) => `${s.action}:${s.version_no}`)).toEqual(['submit:4', 'return:4', 'submit:5', 'receive:5'])
  expect(subs[1].reason).toBe('請補當日查驗情形說明')
  expect(subs[2].diff?.against_version_no).toBe(4)
  expect(subs[2].diff?.changed_keys).toContain('note')
  const { data: finalDoc } = await supRead.from('field_documents').select('status, current_version_no, target_id, target_table').eq('id', docId).single()
  expect(finalDoc).toMatchObject({ status: 'received', current_version_no: 5, target_id: logRow.id, target_table: 'supervisor_logs' })
  const { data: finalLog } = await supRead.from('supervisor_logs').select('note').eq('id', logRow.id).single()
  expect(finalLog.note).toContain('明日申請 4F 模板查驗')
  await supRead.auth.signOut()
  await con.auth.signOut()
})
