// P5e｜鏈 14:保固類循環義務的停止條件(真 Supabase;不需 Edge)。使用者 2026-09-20 決定:
//   保固期滿日＝正式驗收合格日＋契約載明的保固期間,兩者都有依據才計算並記來源;缺任一項列「停止條件待補」。
//   佈置走產品窄門:廠商(建案者＝專案管理者)補登兩條契約重點(保固期間 2 年、保固期間每月巡檢)→ 監造確認(review_requirement)
//   → 義務由 DB 物化。驗:
//   1) 履約期程卡先列「保固期滿日待補(缺正式驗收合格日、缺契約保固期間)」;保固類每月巡檢不產生期次、詳情說缺什麼與入口;
//   2) 管理者在履約期程卡登錄保固期間 2 年並引用已確認的條文 → 留一版;仍缺合格日 → 仍不產生期次;
//   3) 機關登錄正式驗收合格 2025-03-15 → DB 產生保固期間的期次、只到期滿日 2027-03-15;監造(非管理者)看到同一份期滿日與兩項
//      依據(驗收紀錄、契約條文),沒有登錄／更正入口;期次依據句寫出合格日與期滿日。
//   帳號全部本次產生;afterAll 以建立者 delete_project＋admin API 清帳號,殘留 0。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup, admin,
} from './helpers.js'

const PROJECT_NAME = `鏈14保固-${Date.now().toString(36)}`
const TERM_TITLE = `保固期間自驗收合格日起 2 年-${Date.now().toString(36)}`
const INSPECT_TITLE = `保固期間每月巡檢-${Date.now().toString(36)}`
const conEmail = uniqueEmail('p5e14-con')
const supEmail = uniqueEmail('p5e14-sup')
const ownEmail = uniqueEmail('p5e14-own')
let conId, supId, ownId, projectId, termReqId, inspectReqId

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈十四廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十四監造')
  ownId = await createConfirmedUser(ownEmail, 'owner', '鏈十四機關')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  for (const [email, org] of [[supEmail, 'supervisor'], [ownEmail, 'owner']]) {
    const { error } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: email, p_role: 'member', p_expected_org: org })
    if (error) throw new Error(`邀請失敗:${error.message}`)
  }
  // 人工補登兩條契約重點(待確認)＋出處條款;確認由監造做(D-019:人工補登需監造／機關確認)
  const { data: reqs, error: reqErr } = await c.from('requirements').insert([
    { project_id: projectId, title: TERM_TITLE, description: '本契約標的自驗收合格日起，由廠商保固 2 年。',
      requirement_type: 'other', responsible_party_type: 'contractor', lifecycle_phase: '保固', frequency_config: {}, status: 'needs_review', origin: 'manual' },
    { project_id: projectId, title: INSPECT_TITLE, description: '保固期間每月 10 日前提送巡檢紀錄。',
      requirement_type: 'deadline', responsible_party_type: 'contractor', lifecycle_phase: '保固',
      frequency_type: 'monthly', frequency_config: { day: 10 }, status: 'needs_review', origin: 'manual' },
  ]).select('id, title')
  if (reqErr) throw new Error(`補登契約重點失敗:${reqErr.message}`)
  termReqId = reqs.find((r) => r.title === TERM_TITLE).id
  inspectReqId = reqs.find((r) => r.title === INSPECT_TITLE).id
  const { error: srcErr } = await c.from('requirement_sources').insert({ requirement_id: termReqId, source_kind: 'manual', clause: '第 16 條' })
  if (srcErr) throw new Error(`補登出處失敗:${srcErr.message}`)
  await c.auth.signOut()
  const s = await signInClient(supEmail)
  for (const id of [termReqId, inspectReqId]) {
    const { error } = await s.rpc('review_requirement', { p_requirement_id: id, p_decision: 'approve' })
    if (error) throw new Error(`監造確認失敗:${error.message}`)
  }
  await s.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
    () => cleanupUser(ownId),
  )
})

const periodCount = async () => {
  const { data, error } = await admin().from('obligation_periods').select('period_key, period_start, basis').eq('obligation_id', inspectReqId)
  if (error) throw new Error(error.message)
  return data
}

test('鏈 14:保固期滿日＝正式驗收合格日＋契約保固期間;缺一不產生、齊全後只到期滿日', async ({ page }) => {
  const basis = page.getByLabel('保固期滿日與依據')

  // ── 1. 兩項皆缺:期程卡說缺什麼;保固類每月巡檢沒有期次、詳情給入口 ─────────────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/requirements')
  await expect(basis).toContainText('保固期滿日待補')
  await expect(basis).toContainText('缺正式驗收合格日、缺契約保固期間')
  expect(await periodCount()).toHaveLength(0)
  await gotoHash(page, `/requirements?obligation=${inspectReqId}`)
  await expect(page.getByText('停止條件待補（缺正式驗收合格日、缺契約保固期間，無法判定保固期滿日）').first()).toBeVisible()

  // ── 2. 管理者登錄保固期間 2 年並引用已確認的條文 → 留一版;仍缺合格日 → 仍不產生 ──────────────────────
  await basis.getByRole('button', { name: '登錄' }).click()
  await expect(page.getByLabel('保固期間數值')).toBeFocused()
  await page.getByLabel('保固期間數值').fill('2')
  await page.getByLabel('保固期間單位').selectOption('year')
  await page.getByLabel('引用的契約條文').selectOption({ label: `第 16 條 ${TERM_TITLE}` })
  await page.getByRole('button', { name: '儲存保固期間' }).click()
  await expect(page.getByRole('status').filter({ hasText: /已留第 \d+ 版/ })).toBeVisible()
  await expect(basis).toContainText(`2 年，依 第 16 條 「${TERM_TITLE}」`)
  await expect(basis).toContainText('缺正式驗收合格日，無法判定保固期滿日')
  expect(await periodCount()).toHaveLength(0)
  await logoutReal(page)

  // ── 3. 機關登錄正式驗收合格(RLS＋驗收 guard 的產品窄門)→ DB 產生保固期間的期次,只到期滿日 ──────────────
  const o = await signInClient(ownEmail)
  const { error: accErr } = await o.from('acceptance_events').insert({ project_id: projectId, stage_key: 'final', event_date: '2025-03-15', result: '合格', created_by: ownId })
  if (accErr) throw new Error(`登錄正式驗收失敗:${accErr.message}`)
  const { data: facts } = await o.rpc('get_project_warranty', { p_project: projectId })
  expect(facts).toMatchObject({ acceptance_date: '2025-03-15', term_value: 2, term_unit: 'year', source_ok: true, expiry: '2027-03-15', needs: [], gap: null })
  await o.auth.signOut()
  const periods = await periodCount()
  expect(periods.length).toBeGreaterThan(0)
  expect(periods.map((p) => p.period_key).sort()[0]).toBe('2025-04') // 2025-03-10 早於合格日,不列
  expect(periods.every((p) => p.period_start <= '2027-03-15')).toBe(true) // 只到期滿日
  expect(periods.every((p) => p.basis.bound_kind === 'warranty_expiry' && p.basis.anchor_date === '2025-03-15')).toBe(true)

  // 監造(非管理者)看到同一份期滿日與兩項依據,沒有登錄／更正入口;期次依據句寫出合格日與期滿日
  await loginReal(page, supEmail)
  await gotoHash(page, `/requirements?obligation=${inspectReqId}`)
  await expect(basis).toContainText('保固期滿 2027-03-15')
  await expect(basis.getByRole('link', { name: '2025-03-15（驗收紀錄）' })).toHaveAttribute('href', '#/acceptance?stage=final')
  await expect(basis).toContainText(`2 年，依 第 16 條 「${TERM_TITLE}」`)
  await expect(basis.getByRole('button')).toHaveCount(0)
  await expect(page.getByText('正式驗收合格日 2025-03-15 起、保固期滿 2027-03-15 止').first()).toBeVisible()
  await expect(page.getByText(/停止條件待補（.*保固期滿日/)).toHaveCount(0)
})
