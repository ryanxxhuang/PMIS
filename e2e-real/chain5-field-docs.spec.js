// P2c｜鏈 5:現場文書第一條完整路徑(真 Supabase,正式模式,本機 Edge stub 模型)。
//   廠商上傳照片 → 伺服器保存＋辨識起稿(draft-field-documents) → 施工日誌草稿列待補 → 補齊存檔
//   → 簽署(登入的平台帳號;事實表 daily_logs 落庫)→ 提送監造 → 監造退回(必填原因)→ 廠商更正版本重簽再送
//   → 監造收件;另驗:切頁／重新登入後從伺服器恢復批次與草稿、同一張照片重傳不重建、簽舊版本被拒(PD001)。
// 前置(見 docs/REAL_BACKEND_E2E.md):
//   * 另一個 terminal:`supabase functions serve --env-file e2e-real/stub.env`——stub 只在本機 http 位址生效,
//     輸出固定(非真實辨識,只證明流程),起稿回應 notes 會明示「模型輸出為本機 stub」。
// 帳號全部本次產生;afterAll 以建立者 delete_project＋admin API 清帳號,殘留 0。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup, tinyJpeg,
} from './helpers.js'

const PROJECT_NAME = `鏈5文書工程-${Date.now().toString(36)}`
const conEmail = uniqueEmail('w6c5-con')
const supEmail = uniqueEmail('w6c5-sup')
const ownEmail = uniqueEmail('w6c5-own')
let conId, supId, ownId, projectId
// 與 stub.env 的 PMIS_VISION_STUB_HINT 對得上的末端工項(照片配到它 → 草稿出現待補的當日數量)
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '假設工程', unit: '式', quantity: 1, unit_price: 1000, amount: 1000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈五廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈五監造')
  ownId = await createConfirmedUser(ownEmail, 'owner', '鏈五機關')
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

test('鏈 5:廠商上傳→起稿→補缺→簽署→提送→監造退回→廠商更正再送→監造收件;恢復、重傳不重建、簽舊版被拒', async ({ page }) => {
  test.setTimeout(420_000)
  const saveStatus = page.getByRole('status', { name: /保存狀態/ })

  // ── 廠商(一般登入,沒有驗證碼步驟):現場紀錄拍照／上傳兩張 → 已保存到伺服器 → 伺服器起稿 ──────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/site')
  await expect(page.getByRole('heading', { level: 1, name: '現場紀錄' })).toBeVisible()
  await page.getByLabel('選擇照片上傳').setInputFiles([
    { name: 'site-a.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('a') },
    { name: 'site-b.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('b') },
  ])
  await expect(page.getByText('已保存到伺服器 2／2')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('仍在本機')).toHaveCount(0)
  // 起稿完成:候選施工日誌已起稿、notes 明示 stub
  const uploadCard = page.getByRole('group', { name: '拍照／上傳' })
  await expect(uploadCard.getByText('已起稿').first()).toBeVisible({ timeout: 90_000 })
  await expect(uploadCard.getByText('本機 stub 模型輸出')).toBeVisible()
  await expect(uploadCard.getByText(/模型輸出為本機 stub/)).toBeVisible()

  // ── 恢復:重新整理後批次與文件都從伺服器回來(本機不存任何狀態) ─────────────────────
  await page.reload()
  await page.getByRole('button', { name: '登出', exact: true }).waitFor()
  const intakeCard = page.getByRole('group', { name: '上傳批次' })
  await expect(intakeCard.getByText('已保存 2 張')).toBeVisible({ timeout: 30_000 })
  await expect(intakeCard.getByText('辨識完成')).toBeVisible()
  const docCard = page.getByRole('group', { name: '現場文書' })
  await expect(docCard.getByRole('link', { name: new RegExp(`施工日誌 ${today}`) })).toBeVisible()

  // ── 重傳同一張:本案已有相同照片 → 不重複上傳、不重複建件 ──────────────────────────
  await page.getByLabel('選擇照片上傳').setInputFiles([{ name: 'site-a-again.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('a') }])
  await expect(page.getByText('本案已有相同照片,未重複上傳')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('已保存到伺服器 1／1')).toBeVisible()
  await expect(uploadCard.getByText(/未重複上傳；既有文件內容未變/)).toBeVisible()
  await expect(intakeCard.getByRole('listitem')).toHaveCount(1) // 沒有建第二個(空)批次
  const con = await signInClient(conEmail)
  const { data: docsAfterRetry } = await con.from('field_documents').select('id, status, current_version_no').eq('project_id', projectId).eq('doc_type', 'daily_log')
  expect(docsAfterRetry).toHaveLength(1) // 同日只有一份活文件
  const docId = docsAfterRetry[0].id
  const { count: photoCount } = await con.from('photos').select('id', { count: 'exact', head: true }).eq('project_id', projectId)
  expect(photoCount).toBe(2) // 第三次上傳引用既有照片,沒有第三列

  // ── 施工日誌:草稿逐欄有來源與待補;補齊 → 存檔成人工版本 ────────────────────────────
  await docCard.getByRole('link', { name: new RegExp(`施工日誌 ${today}`) }).click()
  await expect(page).toHaveURL(/#\/site-log\?doc=/)
  await expect(saveStatus).toHaveText(/已存檔.*版本 1/)
  await expect(page.getByText(/待補 \d+ 項/).first()).toBeVisible()
  await expect(page.getByText('已帶入・待核對・照片 AI 說明').first()).toBeVisible() // 摘要來自照片說明(stub)
  await expect(page.getByRole('button', { name: '簽署此版本' })).toHaveCount(0) // 待補未齊不給簽
  await page.getByLabel('結構工程 當日完成數量').fill('12.5') // stub hint 配到的工項,數量只有人填才不是待補
  await page.getByRole('textbox', { name: '天氣(上午)' }).fill('晴')
  await page.getByRole('textbox', { name: '天氣(下午)' }).fill('晴')
  await page.getByRole('button', { name: '加一列' }).first().click() // 出工人數
  await page.getByPlaceholder('工別（如 鋼筋工）').fill('模板工')
  await page.getByPlaceholder('人數').fill('4')
  // 機具／材料本日無:na＋原因(不得留空、不得填「無」);原因輸入是站內 appPrompt 對話框
  for (const reason of ['本日無機具', '本日無進料']) {
    await page.getByRole('button', { name: '本日無', exact: true }).nth(0).click()
    const naDialog = page.getByRole('dialog', { name: /本日不適用/ })
    await naDialog.locator('textarea').fill(reason)
    await naDialog.getByRole('button', { name: '確定', exact: true }).click()
    await expect(naDialog).toHaveCount(0)
  }
  await expect(saveStatus).toHaveText('未存檔')
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 2，可簽署/)).toBeVisible({ timeout: 30_000 })

  // ── 簽署(登入的平台帳號):顯示版本與雜湊、意願文字;成功後事實表落庫 ─────────────────────
  const lifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await expect(lifecycle.getByText(/版本 2・雜湊 [0-9a-f]{12}/)).toBeVisible()
  await expect(lifecycle.getByText(/本人確認 .* 施工日誌\(版本 2,內容雜湊 [0-9a-f]{12}\)/)).toBeVisible()
  await lifecycle.getByRole('button', { name: '簽署此版本' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
  await expect(lifecycle.getByText(/版本 2 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  await expect(lifecycle.getByText(/方式 平台帳號$/)).toBeVisible()
  await expect(lifecycle.getByText(/兩步驟驗證|驗證碼/)).toHaveCount(0)
  const { data: logRow } = await con.from('daily_logs').select('id, status, daily_log_items(qty_today)').eq('project_id', projectId).eq('log_date', today).maybeSingle()
  expect(logRow?.status).toBe('已簽署')
  expect(Number(logRow?.daily_log_items?.[0]?.qty_today)).toBe(12.5)
  // 簽舊版本被拒:版本 1 已不是目前版本 → PD001
  const { data: v1 } = await con.from('field_document_versions').select('content_hash').eq('document_id', docId).eq('version_no', 1).single()
  const { error: oldErr } = await con.rpc('sign_field_document', { p_document_id: docId, p_version_no: 1, p_content_hash: v1.content_hash, p_intent: '簽舊版' })
  expect(oldErr?.code).toBe('PD001')

  // ── 提送監造(client_request_id 冪等) ───────────────────────────────────────────────
  await lifecycle.getByRole('button', { name: '提送給監造' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '提送', exact: true }).click()
  await expect(lifecycle.getByText(/已提送給監造/)).toBeVisible({ timeout: 30_000 })
  await logoutReal(page)

  // ── 監造(桌機 1024):待收件 → 開啟文件 → 退回並填原因 ──────────────────────────────
  await page.setViewportSize({ width: 1024, height: 800 })
  await loginReal(page, supEmail)
  await gotoHash(page, '/site')
  const supDocCard = page.getByRole('group', { name: '現場文書' })
  await expect(supDocCard.getByText('已提送・待收件')).toBeVisible({ timeout: 30_000 })
  await supDocCard.getByRole('link', { name: new RegExp(`施工日誌 ${today}`) }).click()
  await expect(page.getByText(/此頁為唯讀/).first()).toBeVisible()
  await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '存檔', exact: true })).toHaveCount(0)
  const supLifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  await supLifecycle.getByRole('button', { name: '退回（填原因）' }).click()
  const returnDialog = page.getByRole('dialog')
  await returnDialog.locator('textarea').fill('材料使用請補進料證明')
  await returnDialog.getByRole('button', { name: '確定', exact: true }).click()
  await expect(supLifecycle.getByText(/已退回，原因已留存/)).toBeVisible({ timeout: 30_000 })
  await logoutReal(page)

  // ── 廠商(手機 375):看到退回原因 → 更正 → 存檔成版本 3 → 重簽 → 再送(diff 由 DB 算) ──
  await page.setViewportSize({ width: 375, height: 812 })
  await loginReal(page, conEmail)
  await gotoHash(page, `/site-log?doc=${docId}`)
  const conLifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  // 退回原因在頂部橫幅(歷史清單裡另有一筆帶「原因：」前綴),精確比對橫幅那一筆
  await expect(conLifecycle.getByText('材料使用請補進料證明', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(conLifecycle.getByText(/監造退回（版本 2/)).toBeVisible()
  await page.getByRole('textbox', { name: '工作摘要' }).fill('結構工程混凝土澆置 12.5 M3；材料進料證明已補')
  await page.getByRole('button', { name: '存檔', exact: true }).click()
  await expect(page.getByText(/已存檔 ✓ 版本 3，可簽署/)).toBeVisible({ timeout: 30_000 })
  await expect(conLifecycle.getByText(/版本 2 的簽署仍綁在該版本/)).toBeVisible()
  await conLifecycle.getByRole('button', { name: '簽署此版本' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '簽署', exact: true }).click()
  await expect(conLifecycle.getByText(/版本 3 已由 .* 簽署/)).toBeVisible({ timeout: 30_000 })
  await conLifecycle.getByRole('button', { name: '提送給監造' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '提送', exact: true }).click()
  await expect(conLifecycle.getByText(/已提送給監造/)).toBeVisible({ timeout: 30_000 })
  // 375 無水平溢位(a11y 合約);失敗時列出撐出視窗的元素,不用猜。登出鈕在手機收進抽屜,先回桌機寬度再登出
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    if (doc.scrollWidth <= doc.clientWidth) return null
    return [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 8).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`)
  })
  expect(overflow, '375 寬度不得水平溢位').toBeNull()
  await page.setViewportSize({ width: 1280, height: 800 })
  await logoutReal(page)

  // ── 監造:歷次退回原因與再送差異保留 → 收件 ────────────────────────────────────────
  await loginReal(page, supEmail)
  await gotoHash(page, `/site-log?doc=${docId}`)
  const supLifecycle2 = page.getByRole('region', { name: '文件狀態與簽署' })
  await supLifecycle2.getByText(/歷次提送紀錄/).click()
  await expect(supLifecycle2.getByText('原因：材料使用請補進料證明')).toBeVisible()
  await expect(supLifecycle2.getByText(/相對退回版本 2 的差異：.*工作摘要/)).toBeVisible()
  await supLifecycle2.getByRole('button', { name: '收件', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '收件', exact: true }).click()
  await expect(supLifecycle2.getByText(/監造已於 .* 收件（版本 3）/)).toBeVisible({ timeout: 30_000 })
  await logoutReal(page)

  // ── 機關:唯讀查閱 ───────────────────────────────────────────────────────────────
  await loginReal(page, ownEmail)
  await gotoHash(page, `/site-log?doc=${docId}`)
  await expect(page.getByText(/此頁為唯讀/).first()).toBeVisible()
  await expect(page.locator('input:not([type="date"])')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '文件狀態與簽署' }).getByText(/監造已於 .* 收件/)).toBeVisible()
  // P3d:退回歷史(退回人姓名由成員名單對照)與回執(完整 submission_id＝DB 送件列)、下一責任方
  const ownLifecycle = page.getByRole('region', { name: '文件狀態與簽署' })
  const history = ownLifecycle.getByRole('group', { name: '退回歷史' })
  await expect(history).toContainText('退回歷史（1）')
  await expect(history).toContainText('退回人 監造 鏈五監造')
  await expect(history).toContainText('原因：材料使用請補進料證明')
  const { data: lastSubmit } = await con.from('field_document_submissions').select('id').eq('document_id', docId).eq('action', 'submit').eq('version_no', 3).single()
  const receipt = ownLifecycle.getByRole('group', { name: '提送與回執' })
  await expect(receipt).toContainText(`回執編號${lastSubmit.id}`)
  await expect(receipt).toContainText('下一責任方：無（已收件）')
  // 列印:印簽署版本 3,頁首雜湊前 12 碼＝DB content_hash、簽署者;內容是版本 3 的更正摘要
  await gotoHash(page, `/site-log/print?doc=${docId}`)
  const { data: v3 } = await con.from('field_document_versions').select('content_hash').eq('document_id', docId).eq('version_no', 3).single()
  const stamp = page.getByRole('group', { name: '文件版本與簽署' })
  await expect(stamp).toContainText(`內容雜湊 ${v3.content_hash.slice(0, 12)}`, { timeout: 30_000 })
  await expect(stamp).toContainText('版本 3')
  await expect(stamp).toContainText('簽署 鏈五廠商・')
  await expect(page.getByText('草稿・未簽署')).toHaveCount(0)
  await expect(page.getByText('結構工程混凝土澆置 12.5 M3；材料進料證明已補')).toBeVisible()
  await page.getByRole('button', { name: '← 返回施工日誌' }).click() // 列印頁沒有工作台外框(無登出鈕)
  await expect(page).toHaveURL(/#\/site-log\?doc=/)
  await logoutReal(page)

  // 伺服器事實:提送列 submit→return→submit→receive 四筆保留;文件 received;事實列為簽署版本內容
  const { data: subs } = await con.from('field_document_submissions').select('action, version_no, reason, diff').eq('document_id', docId).order('created_at')
  expect(subs.map((s) => `${s.action}:${s.version_no}`)).toEqual(['submit:2', 'return:2', 'submit:3', 'receive:3'])
  expect(subs[1].reason).toBe('材料使用請補進料證明')
  expect(subs[2].diff?.against_version_no).toBe(2)
  expect(subs[2].diff?.changed_keys).toContain('work_summary')
  const { data: finalDoc } = await con.from('field_documents').select('status, current_version_no, target_id').eq('id', docId).single()
  expect(finalDoc).toMatchObject({ status: 'received', current_version_no: 3, target_id: logRow.id })
  await con.auth.signOut()
})
