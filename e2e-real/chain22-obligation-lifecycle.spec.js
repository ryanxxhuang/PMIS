// F2｜鏈 22:契約義務的四種轉移(逾期／改期／取消／已完成)＋角色化早報的真後端角色分流(真 Supabase＋本機 Edge)。
//   E 包列為未測:pgTAP 與 demo e2e 有,真後端沒有端到端。這裡全部走產品窄門:
//   廠商(建案者＝專案管理者)補登契約重點 → 監造 review_requirement 確認 → DB 物化義務與期次 →
//   1) 逾期:固定期限在 3 天前 → 履約時程列「逾期 3 日」且預設選中;首頁「現在輪到我」列出;早報 dry-run 進廠商 overdue。
//   2) 改期:開工後 30 日的義務,管理者在履約期程卡改開工日(類別展延、填依據函文)→ 留第 2 版、effects 記 rescheduled
//      舊到期→新到期、時程列顯示新到期日;非管理者(監造)改基準日被 RPC 拒絕。
//   3) 已完成:3 天後到期的義務 → 「標記完成」→ 列翻「已完成」、DB 蓋 completed_at 與到期日快照;「取消完成」回待辦、快照清空。
//   4) 取消:監造在擷取審核「廢止取代」一條每月循環義務 → requirements superseded、義務不適用、所有待辦期次不適用。
//   5) 早報(send-reminders,本機 supabase functions serve,POST ?dry=1、驗 x-cron-secret):只彙整不寄信、不記帳——
//      廠商收到 1)(overdue)與 3)(7 日內);監造只收到自己的 7 日內事項、看不到廠商的;機關沒事就 should_send=false;
//      3) 完成、4) 廢止之後再跑一次,兩者都從早報消失。**不寄給任何真實成員**:dry=1 從不呼叫 Resend,本機也不設 RESEND_API_KEY。
//   前置:本機 stack 已套 20260920230000;`supabase functions serve --env-file .env.e2e.real`(env-file 含 CRON_SECRET,
//   見 .env.e2e.real.example);reminder.daily 的方案門檻是 standard,測試案由平台管理員 bootstrap 帳號設為 standard(同 chain 3)。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup, findUserIdByEmail,
} from './helpers.js'

const SUFFIX = Date.now().toString(36)
const PROJECT_NAME = `鏈22義務生命週期-${SUFFIX}`
const T_OVERDUE = `逾期義務-${SUFFIX}`
const T_RESCHED = `開工後30日提送計畫-${SUFFIX}`
const T_DONE = `三天後到期義務-${SUFFIX}`
const T_CANCEL = `每月循環報表-${SUFFIX}`
const T_SUP = `監造兩天後到期-${SUFFIX}`
const BOOTSTRAP_ADMIN_EMAIL = 'ryanxhuang1212@gmail.com'
const conEmail = uniqueEmail('f2c22-con')
const supEmail = uniqueEmail('f2c22-sup')
const ownEmail = uniqueEmail('f2c22-own')
let conId, supId, ownId, adminId, adminCreatedHere, projectId
const reqIds = {}

const taipeiToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
const today = taipeiToday()
const D_OVERDUE = plusDays(today, -3)
const D_DONE = plusDays(today, 3)
const D_SUP = plusDays(today, 2)
const COMMENCE_1 = '2026-09-01'
const COMMENCE_2 = '2026-09-15'
const END_DATE = '2026-12-31'

// 早報 dry-run:本機 Edge(kong → edge runtime),驗 x-cron-secret;dry=1 不寄、不記帳
async function remindersDry() {
  const url = process.env.E2E_REAL_SUPABASE_URL.trim().replace(/\/$/, '')
  const anon = process.env.E2E_REAL_SUPABASE_ANON_KEY.trim()
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) throw new Error('缺 CRON_SECRET:請照 .env.e2e.real.example 加到 .env.e2e.real(functions serve 與本測試共用同一個值)')
  let res
  try {
    res = await fetch(`${url}/functions/v1/send-reminders?dry=1`, {
      method: 'POST', headers: { 'x-cron-secret': secret, Authorization: `Bearer ${anon}`, apikey: anon },
    })
  } catch (e) {
    throw new Error(`打不到本機 send-reminders(${e?.message});另一個 terminal 要先 supabase functions serve --env-file .env.e2e.real`)
  }
  if (!res.ok) throw new Error(`send-reminders dry-run HTTP ${res.status}:${(await res.text()).slice(0, 300)}(401=CRON_SECRET 與 functions serve 讀到的不同)`)
  const body = await res.json()
  expect(body.dry).toBe(true)
  const mine = body.projects.find((p) => p.project === PROJECT_NAME)
  if (!mine) throw new Error(`早報結果沒有本案:${JSON.stringify(body.projects.map((p) => p.project))}`)
  if (mine.skipped || mine.error) throw new Error(`本案被跳過或出錯:${JSON.stringify(mine)}`)
  return mine
}
const titlesOf = (items) => items.map((it) => it.title)
const notCancel = (t) => !t.startsWith(T_CANCEL)

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈廿二廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈廿二監造')
  ownId = await createConfirmedUser(ownEmail, 'owner', '鏈廿二機關')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  for (const [email, org] of [[supEmail, 'supervisor'], [ownEmail, 'owner']]) {
    const { error } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: email, p_role: 'member', p_expected_org: org })
    if (error) throw new Error(`邀請失敗:${error.message}`)
  }
  // 基準日第 1 版(管理者;開工 9/1、竣工 12/31):開工後 30 日 → 10/1;每月循環到竣工日止
  const { error: anchorErr } = await c.rpc('update_project_anchors', {
    p_project: projectId, p_anchors: { commencement_date: COMMENCE_1, end_date: END_DATE }, p_change_kind: 'edit',
  })
  if (anchorErr) throw new Error(`設基準日失敗:${anchorErr.message}`)
  const base = { project_id: projectId, status: 'needs_review', origin: 'manual', lifecycle_phase: '施工中', requirement_type: 'deadline', frequency_config: {} }
  const { data: reqs, error: reqErr } = await c.from('requirements').insert([
    { ...base, title: T_OVERDUE, description: '固定期限(3 天前)。', responsible_party_type: 'contractor', trigger_type: 'fixed', trigger_config: { fixed_date: D_OVERDUE } },
    { ...base, title: T_RESCHED, description: '開工後 30 日內提送。', responsible_party_type: 'contractor', trigger_type: 'commencement', trigger_config: { offset_days: 30, offset_dir: 'after' } },
    { ...base, title: T_DONE, description: '固定期限(3 天後)。', responsible_party_type: 'contractor', trigger_type: 'fixed', trigger_config: { fixed_date: D_DONE } },
    { ...base, title: T_CANCEL, description: '每月 10 日前提送。', responsible_party_type: 'contractor', frequency_type: 'monthly', frequency_config: { day: 10 } },
    { ...base, title: T_SUP, description: '監造兩天後到期。', responsible_party_type: 'supervisor', trigger_type: 'fixed', trigger_config: { fixed_date: D_SUP } },
  ]).select('id, title')
  if (reqErr) throw new Error(`補登契約重點失敗:${reqErr.message}`)
  for (const r of reqs) reqIds[r.title] = r.id
  await c.auth.signOut()
  const s = await signInClient(supEmail)
  for (const id of Object.values(reqIds)) {
    const { error } = await s.rpc('review_requirement', { p_requirement_id: id, p_decision: 'approve' })
    if (error) throw new Error(`監造確認失敗:${error.message}`)
  }
  await s.auth.signOut()
  // reminder.daily 門檻 standard:平台管理員 bootstrap 帳號(存在就沿用,只清理本次建立的;同 chain 3)
  adminId = await findUserIdByEmail(BOOTSTRAP_ADMIN_EMAIL)
  adminCreatedHere = !adminId
  if (!adminId) adminId = await createConfirmedUser(BOOTSTRAP_ADMIN_EMAIL, 'owner', '鏈廿二平台管理員')
  const a = await signInClient(BOOTSTRAP_ADMIN_EMAIL)
  const { error: planErr } = await a.rpc('admin_set_project_plan', { p_project: projectId, p_plan: 'standard' })
  if (planErr) throw new Error(`設測試案方案失敗(平台管理員 bootstrap 沒生效?):${planErr.message}`)
  await a.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
    () => cleanupUser(ownId),
    () => (adminCreatedHere && adminId ? cleanupUser(adminId) : undefined),
  )
})

test('鏈 22:逾期／改期／已完成／廢止四種轉移端到端;早報 dry-run 三方角色分流,完成與廢止後從早報消失', async ({ page }) => {
  test.setTimeout(240_000)
  const c = await signInClient(conEmail)
  const obligationOf = async (title) => {
    const { data, error } = await c.from('contract_obligations').select('id, status, completed_at, due_date_snapshot, anchor_version_no').eq('requirement_id', reqIds[title]).single()
    if (error) throw new Error(`讀義務失敗(${title}):${error.message}`)
    return data
  }

  // ── 1. 逾期:時程列「逾期 3 日」且預設選中;首頁「現在輪到我」列出 ───────────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/requirements')
  const list = page.getByRole('list', { name: '履約義務時間軸' })
  const overdueRow = list.getByRole('listitem').filter({ hasText: T_OVERDUE }).first()
  await expect(overdueRow).toBeVisible()
  await expect(overdueRow.getByText('逾期 3 日')).toBeVisible()
  await expect(overdueRow).toHaveAttribute('aria-current', 'true')
  await expect(list.getByRole('listitem').filter({ hasText: T_SUP })).toHaveCount(0) // 廠商只看自己
  await gotoHash(page, '/dashboard')
  await expect(page.getByRole('group', { name: '現在輪到我', exact: true })).toContainText(T_OVERDUE)

  // ── 5a. 早報 dry-run(完成／廢止前):廠商 overdue＋7 日內;監造只看自己;機關沒事 ─────────────────
  const brief1 = await remindersDry()
  const byUser = (r) => Object.fromEntries(r.recipients.map((x) => [x.user_id, x]))
  const b1 = byUser(brief1)
  expect(b1[conId]).toMatchObject({ role: 'contractor', should_send: true })
  expect(titlesOf(b1[conId].sections.overdue).filter(notCancel)).toEqual([T_OVERDUE])
  expect(titlesOf(b1[conId].sections.dueSoon).filter(notCancel)).toEqual([T_DONE])
  expect(titlesOf(b1[conId].sections.overdue).some((t) => t.startsWith(T_CANCEL))).toBe(true) // 每月 10 日:本月期次已逾期
  expect(JSON.stringify(b1[conId].sections)).not.toContain(T_SUP)
  expect(b1[supId]).toMatchObject({ role: 'supervisor', should_send: true, overdue: 0, soon: 1 })
  expect(titlesOf(b1[supId].sections.dueSoon)).toEqual([T_SUP])
  expect(JSON.stringify(b1[supId].sections)).not.toContain(T_OVERDUE)
  expect(b1[ownId]).toMatchObject({ role: 'owner', should_send: false, overdue: 0, soon: 0, email: null })
  expect(b1[ownId].sections).toBeUndefined()
  expect(brief1.emails_sent).toBe(0)

  // ── 2. 改期:管理者改開工日(展延、填依據)→ 留第 2 版、rescheduled 10/1 → 10/15;時程列顯示新到期 ────
  const before = await obligationOf(T_RESCHED)
  expect(before.status).toBe('待辦')
  await gotoHash(page, '/requirements')
  await page.getByRole('button', { name: '設定基準日' }).click()
  await page.getByLabel('變更類別').selectOption('extension')
  await page.getByLabel('依據(函文字號／變更案號)').fill('府工字第 1130001 號')
  await page.getByLabel('開工日').fill(COMMENCE_2)
  await expect(page.getByRole('status').filter({ hasText: /已留第 2 版：\d+ 個事項改期／增減/ })).toBeVisible({ timeout: 30_000 })
  const { data: v2 } = await c.from('project_anchor_versions').select('version_no, change_kind, source_ref, anchors, effects').eq('project_id', projectId).eq('version_no', 2).single()
  expect(v2).toMatchObject({ change_kind: 'extension', source_ref: '府工字第 1130001 號' })
  expect(v2.anchors.commencement_date).toBe(COMMENCE_2)
  expect(v2.effects).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'rescheduled', obligation_id: before.id, old_due: '2026-10-01', new_due: '2026-10-15' }),
  ]))
  await page.getByRole('tab', { name: /^全期/ }).click()
  await expect(list.getByRole('listitem').filter({ hasText: T_RESCHED }).first()).toContainText('2026-10-15')
  // 非管理者(監造)改基準日:RPC 拒絕(權限在 DB,不是前端藏按鈕)
  const s = await signInClient(supEmail)
  const denied = await s.rpc('update_project_anchors', { p_project: projectId, p_anchors: { commencement_date: '2026-09-20' }, p_change_kind: 'edit' })
  expect(denied.error?.message).toContain('僅專案管理者可修改基準日')

  // ── 3. 已完成:標記完成 → 列翻已完成、DB 蓋完成時間與到期日快照;取消完成回待辦 ─────────────────
  await page.getByRole('tab', { name: /^近期/ }).click()
  const doneRow = list.getByRole('listitem').filter({ hasText: T_DONE }).first()
  await doneRow.click()
  await page.getByRole('button', { name: '標記完成' }).click()
  await expect(doneRow.getByText('已完成').first()).toBeVisible()
  let done = await obligationOf(T_DONE)
  expect(done.status).toBe('已完成')
  expect(done.completed_at).not.toBeNull()
  expect(done.due_date_snapshot).toBe(D_DONE)
  expect(done.anchor_version_no).toBe(2)
  await page.getByRole('button', { name: '取消完成' }).click()
  await expect(page.getByRole('button', { name: '標記完成' })).toBeVisible()
  done = await obligationOf(T_DONE)
  expect(done).toMatchObject({ status: '待辦', completed_at: null, due_date_snapshot: null })
  await page.getByRole('button', { name: '標記完成' }).click()
  await expect(doneRow.getByText('已完成').first()).toBeVisible()
  await logoutReal(page)

  // ── 4. 廢止取代(監造,擷取審核):requirements superseded、義務不適用、待辦期次全部不適用 ──────────
  const { data: periodsBefore } = await c.from('obligation_periods').select('status').eq('obligation_id', (await obligationOf(T_CANCEL)).id)
  expect(periodsBefore.length).toBeGreaterThan(0)
  expect(periodsBefore.every((p) => p.status === '待辦')).toBe(true)
  await loginReal(page, supEmail)
  await gotoHash(page, '/requirements')
  await page.getByRole('main').getByRole('link', { name: '擷取審核', exact: true }).click()
  await page.getByRole('listitem').filter({ hasText: T_CANCEL }).first().click()
  await page.getByRole('button', { name: '廢止取代', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '廢止取代', exact: true }).click()
  await expect(page.getByText(/廢止取代 · .*\(伺服器記錄\)/)).toBeVisible({ timeout: 30_000 })
  const { data: cancelReq } = await c.from('requirements').select('status').eq('id', reqIds[T_CANCEL]).single()
  expect(cancelReq.status).toBe('superseded')
  const cancelOb = await obligationOf(T_CANCEL)
  expect(cancelOb.status).toBe('不適用')
  const { data: periodsAfter } = await c.from('obligation_periods').select('status').eq('obligation_id', cancelOb.id)
  expect(periodsAfter.length).toBe(periodsBefore.length)
  expect(periodsAfter.every((p) => p.status === '不適用')).toBe(true)
  await gotoHash(page, '/requirements')
  await page.getByRole('tab', { name: /^全期/ }).click()
  await expect(list.getByRole('listitem').filter({ hasText: T_CANCEL })).toHaveCount(0) // 不適用不列在時程

  // ── 5b. 早報 dry-run(完成／廢止後):已完成與廢止的都不再出現;逾期的還在;監造不受影響 ──────────
  const brief2 = await remindersDry()
  const b2 = byUser(brief2)
  expect(titlesOf(b2[conId].sections.overdue)).toEqual([T_OVERDUE])
  expect(b2[conId].sections.dueSoon).toEqual([])
  expect(JSON.stringify(b2[conId].sections)).not.toContain(T_CANCEL)
  expect(JSON.stringify(b2[conId].sections)).not.toContain(T_DONE)
  expect(b2[conId]).toMatchObject({ overdue: 1, soon: 0, should_send: true })
  expect(b2[supId]).toMatchObject({ overdue: 0, soon: 1, should_send: true })
  expect(b2[ownId]).toMatchObject({ should_send: false })
  expect(brief2.emails_sent).toBe(0)
  await s.auth.signOut()
  await c.auth.signOut()
})
