// F1｜鏈 19:單次契約義務「時點待補」(真 Supabase;不需 Edge)。廠商驗收 E 未通過項的整條驗收:
//   缺頻率的義務(抽取器給觸發點 monthly 卻沒有 frequency_type,核定後物化成 trigger_event='monthly'、recurring=null)
//   以前只顯示「無到期日」;現在三處同口徑列為「時點待補（觸發點為每月，循環規則未設定）」並給處理入口。驗:
//   1) 廠商今日工作的「待補設定」卡列它、寫明缺什麼、連到擷取審核該筆;履約時程可用「時點待補」篩到它、詳情到期日欄與
//      待補設定區同一句、入口同一個;廢止取代是審核者的事,廠商在擷取審核沒有按鈕;
//   2) 監造從入口進擷取審核,廢止取代舊的、用「手動新增」補登每月 10 日的同一條(期限型,監造確認)→ DB 物化循環義務並依
//      開工日產生期次(恢復逐期追蹤);
//   3) 舊義務變不適用、不再列待補;新義務在履約時程有本期、時點待補 0 件;今日工作待補設定卡不再列它。
//   佈置走產品窄門(建案、邀請、基準日 RPC、契約重點補登＋監造確認);帳號全部本次產生;afterAll 清乾淨。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup, admin,
} from './helpers.js'

const PROJECT_NAME = `鏈19時點-${Date.now().toString(36)}`
const OLD_TITLE = `每月提送環境監測報告-${Date.now().toString(36)}`
const NEW_TITLE = `每月 10 日前提送環境監測報告-${Date.now().toString(36)}`
const GAP_LABEL = '時點待補（觸發點為每月，循環規則未設定）'
const conEmail = uniqueEmail('f1c19-con')
const supEmail = uniqueEmail('f1c19-sup')
let conId, supId, projectId, oldReqId

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈十九廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十九監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: invErr } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' })
  if (invErr) throw new Error(`邀請失敗:${invErr.message}`)
  // 基準日(開工日、竣工日)由管理者經留版 RPC 設定:補齊循環規則後期次才有起算日與界限日(不然會落到基準日／停止條件待補)
  const { error: anchorErr } = await c.rpc('update_project_anchors', {
    p_project: projectId, p_anchors: { commencement_date: '2026-03-01', end_date: '2027-12-31' }, p_change_kind: 'edit', p_reason: '鏈 19 佈置',
  })
  if (anchorErr) throw new Error(`設定基準日失敗:${anchorErr.message}`)
  // 「缺頻率」的契約重點:抽取器的形狀(trigger_type=monthly、frequency_type 空)——人工補登表單擋得掉,AI 抽取與舊資料擋不掉
  const { data: req, error: reqErr } = await c.from('requirements').insert({
    project_id: projectId, title: OLD_TITLE, description: '乙方應每月提送環境監測報告。',
    requirement_type: 'deadline', responsible_party_type: 'contractor', lifecycle_phase: '施工中',
    trigger_type: 'monthly', trigger_config: {}, frequency_type: null, frequency_config: {}, status: 'needs_review', origin: 'manual',
  }).select('id').single()
  if (reqErr) throw new Error(`補登契約重點失敗:${reqErr.message}`)
  oldReqId = req.id
  const { error: srcErr } = await c.from('requirement_sources').insert({ requirement_id: oldReqId, source_kind: 'manual', clause: '第 11 條' })
  if (srcErr) throw new Error(`補登出處失敗:${srcErr.message}`)
  await c.auth.signOut()
  const s = await signInClient(supEmail)
  const { error: revErr } = await s.rpc('review_requirement', { p_requirement_id: oldReqId, p_decision: 'approve' })
  if (revErr) throw new Error(`監造確認失敗:${revErr.message}`)
  await s.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
  )
})

const obligationOf = async (requirementId) => {
  const { data, error } = await admin().from('contract_obligations')
    .select('id, status, trigger_event, recurring, recurring_day, periods:obligation_periods(period_key, due_date, status)')
    .eq('requirement_id', requirementId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

test('鏈 19:缺頻率的義務列為時點待補並給入口;監造廢止取代後補登每月幾日 → 恢復逐期追蹤', async ({ page }) => {
  // 佈置核對:物化出來的是「觸發點每月、沒有循環規則」的單次義務,沒有期次
  const before = await obligationOf(oldReqId)
  expect(before).toMatchObject({ status: '待辦', trigger_event: 'monthly', recurring: null })
  expect(before.periods).toHaveLength(0)

  // ── 1. 廠商:今日工作的待補設定卡寫明缺什麼、連到擷取審核該筆 ────────────────────────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/dashboard')
  const setupList = page.getByRole('list', { name: '待補設定清單' })
  const setupRow = setupList.getByRole('link').filter({ hasText: OLD_TITLE })
  await expect(setupRow).toHaveCount(1)
  await expect(setupRow).toContainText(GAP_LABEL)
  await expect(setupRow).toHaveAttribute('href', `#/requirements/review?highlight=${oldReqId}`)
  // 不進「現在輪到我」(沒有到期日就不會到期;缺口不算任何人的件數)
  await expect(page.getByRole('list', { name: '現在輪到我清單' }).getByText(OLD_TITLE)).toHaveCount(0)

  // 履約時程:可用「時點待補」篩到;詳情的到期日欄、待補設定區同一句,入口同一個
  await gotoHash(page, '/requirements')
  const setupFilter = page.getByRole('combobox', { name: '待補設定' })
  await expect(setupFilter.locator('option[value="timing"]')).toHaveText('時點待補（1）')
  await setupFilter.selectOption('timing')
  const timeline = page.getByRole('list', { name: '履約義務時間軸' })
  await expect(timeline.getByRole('listitem')).toHaveCount(1)
  await expect(timeline.getByRole('listitem').first()).toContainText(OLD_TITLE)
  await expect(timeline.getByRole('listitem').first()).toContainText('待補設定')
  await gotoHash(page, `/requirements?obligation=${oldReqId}`)
  const setupBox = page.getByRole('status').filter({ hasText: '待補設定（1）' })
  await expect(setupBox).toContainText(GAP_LABEL)
  await expect(page.getByText(GAP_LABEL).first()).toBeVisible() // 到期日欄同一句(不再是「依條件觸發」)
  await expect(page.getByText('依條件觸發')).toHaveCount(0)
  const entry = setupBox.getByRole('link', { name: '到擷取審核廢止取代後補登' })
  await expect(entry).toHaveAttribute('href', `#/requirements/review?highlight=${oldReqId}`)
  // 期限追蹤的詳情也說同一句(三頁一個來源),不再只有「無期限」
  await gotoHash(page, `/deadlines?obligation=${oldReqId}`)
  await expect(page.getByRole('region', { name: `${OLD_TITLE} 詳情` })).toContainText(GAP_LABEL)
  await gotoHash(page, `/requirements?obligation=${oldReqId}`)
  await setupBox.getByRole('link', { name: '到擷取審核廢止取代後補登' }).click()
  await expect(page).toHaveURL(new RegExp(`#/requirements/review\\?highlight=${oldReqId}`))
  // 廢止取代是審核者的事:廠商在擷取審核沒有按鈕(RPC 也擋,chain 3 已釘)
  await expect(page.getByRole('listitem').filter({ hasText: OLD_TITLE }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '廢止取代', exact: true })).toHaveCount(0)
  await logoutReal(page)

  // ── 2. 監造:從同一個入口進擷取審核,廢止取代舊的、手動新增補齊「每月 10 日」,確認 → DB 物化循環義務並產生期次 ──
  await loginReal(page, supEmail)
  await gotoHash(page, `/requirements/review?highlight=${oldReqId}`)
  await page.getByRole('listitem').filter({ hasText: OLD_TITLE }).first().click()
  await page.getByRole('button', { name: '廢止取代', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '廢止取代', exact: true }).click()
  await expect(page.getByRole('button', { name: '廢止取代', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '手動新增' }).click()
  const modal = page.getByRole('dialog', { name: '手動新增契約重點' }) // 頁面篩選列也有「類型」,限定在表單裡
  await modal.getByLabel('標題').fill(NEW_TITLE)
  await modal.getByLabel('類型').selectOption('deadline')
  await modal.getByLabel('責任方').selectOption('contractor')
  await modal.getByLabel('時點方式').selectOption('monthly')
  await modal.getByLabel('每月幾號').fill('10')
  await modal.getByRole('button', { name: '新增(待確認)' }).click()
  await expect(modal).toHaveCount(0)
  await page.getByRole('listitem').filter({ hasText: NEW_TITLE }).first().click()
  await page.getByRole('button', { name: '確認無誤', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '確認無誤', exact: true }).click()
  await expect(page.getByRole('button', { name: '廢止取代', exact: true })).toBeVisible()

  // DB:舊義務不適用;新義務是每月 10 日的循環義務,依開工日物化期次(逐期追蹤恢復)
  const old = await obligationOf(oldReqId)
  expect(old.status).toBe('不適用')
  const { data: newReq, error: newReqErr } = await admin().from('requirements').select('id').eq('project_id', projectId).eq('title', NEW_TITLE).single()
  if (newReqErr) throw new Error(newReqErr.message)
  const fresh = await obligationOf(newReq.id)
  expect(fresh).toMatchObject({ status: '待辦', recurring: 'monthly', recurring_day: 10 })
  expect(fresh.periods.length).toBeGreaterThan(0)
  expect(fresh.periods.every((p) => p.due_date.endsWith('-10'))).toBe(true)

  // ── 3. 監造:履約時程時點待補 0 件、新義務有本期;今日工作待補設定卡不再列它 ──────────────────────────────
  await gotoHash(page, '/requirements')
  await expect(page.getByRole('combobox', { name: '待補設定' }).locator('option[value="timing"]')).toHaveText('時點待補（0）')
  await gotoHash(page, `/requirements?obligation=${newReq.id}`)
  await expect(page.getByRole('status').filter({ hasText: /待補設定（\d+）/ })).toHaveCount(0)
  await expect(page.getByText(/^本期$/).first()).toBeVisible()
  await expect(page.getByText(OLD_TITLE)).toHaveCount(0) // 不適用的義務不載入
  await gotoHash(page, '/dashboard')
  await expect(page.getByRole('list', { name: '待補設定清單' }).getByText(OLD_TITLE)).toHaveCount(0)
  await expect(page.getByRole('list', { name: '待補設定清單' }).getByText(NEW_TITLE)).toHaveCount(0)
})
