// W6-4｜鏈 3:文件上傳 → Requirement → 人工核定 → 義務時程(真 Supabase)。
// 走 D-012 單向鏈的真路徑:上傳契約文件(Storage+documents)→ 待審 deadline
// Requirement → 監造在 /requirements 核定(review_requirement RPC,伺服器蓋
// 審查人)→ 核定當下單向物化 contract_obligations → /contract 義務時程出現。
// 廠商端負向斷言:非審查角色(contractor)看不到核定鈕(鏡像 can_review_requirement,
// 刻意無專案管理者例外)。
// 註:AI 建議(extract-requirements edge fn)本機 staging 無 edge runtime/API key。
// 此鏈在真文件版本建立後,以帶 document source 的人工待審 Requirement 代替 AI 輸出;
// 不把這條測試誤稱為 live AI/Edge 成功路徑。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, logoutReal, gotoHash,
} from './helpers.js'

const PROJECT_NAME = `鏈3文件工程-${Date.now().toString(36)}`
const REQ_TITLE = `開工後提送品質計畫-${Date.now().toString(36)}`
const conEmail = uniqueEmail('w6c3-con')
const supEmail = uniqueEmail('w6c3-sup')
let conId, supId, projectId

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈三廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈三監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: invErr } = await c.rpc('add_member_by_email', {
    p_project: project.id, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor',
  })
  if (invErr) throw new Error(`邀請失敗:${invErr.message}`)
  await c.auth.signOut()
})

test.afterAll(async () => {
  await deleteOwnedProjects(conEmail)
  await cleanupUser(conId)
  await cleanupUser(supId)
})

test('鏈 3:上傳文件→待審 Requirement→監造核定→義務時程出現', async ({ page }) => {
  // ── 廠商:統一窗口上傳契約 txt(Storage+documents 真路徑)────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/contract')
  await expect(page.getByText('專案文件一次上傳')).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({
    name: '契約書.txt', mimeType: 'text/plain',
    buffer: Buffer.from('本契約甲方為機關、乙方為廠商。乙方應於開工後提送品質計畫送審。', 'utf-8'),
  })
  await expect(page.getByText('契約書.txt').first()).toBeVisible({ timeout: 15_000 })

  // 本機沒有 live AI/Edge,但替代 fixture 必須在真上傳之後建立,並引用剛產生的
  // document_version；不能用一筆與文件無關的 Requirement 偽裝整條鏈已串起來。
  const c = await signInClient(conEmail)
  let documentId = null
  await expect.poll(async () => {
    const { data } = await c.from('documents').select('id')
      .eq('project_id', projectId).eq('title', '契約書.txt').maybeSingle()
    documentId = data?.id || null
    return documentId
  }).not.toBeNull()
  const { data: version, error: versionErr } = await c.from('document_versions')
    .select('id').eq('document_id', documentId).single()
  if (versionErr) throw new Error(`找不到上傳文件版本:${versionErr.message}`)
  const { data: requirement, error: reqErr } = await c.from('requirements').insert({
    project_id: projectId, title: REQ_TITLE,
    description: '依契約規定於固定期限前提送品質計畫送審。',
    requirement_type: 'deadline', responsible_party_type: 'contractor',
    lifecycle_phase: '開工前', trigger_type: 'fixed',
    trigger_config: { fixed_date: '2026-09-30' },
    status: 'needs_review', origin: 'manual',
  }).select('id').single()
  if (reqErr) throw new Error(`建立待審 Requirement 失敗:${reqErr.message}`)
  const { error: sourceErr } = await c.from('requirement_sources').insert({
    requirement_id: requirement.id, document_version_id: version.id,
    source_kind: 'document', source_verified: false,
    source_text: '乙方應於開工後提送品質計畫送審。',
  })
  if (sourceErr) throw new Error(`建立 Requirement 文件來源失敗:${sourceErr.message}`)
  await c.auth.signOut()

  // ── 廠商在 /requirements 看得到待審,但沒有核定鈕(非審查角色)──────────────
  await gotoHash(page, '/requirements')
  await page.getByText(REQ_TITLE).first().click()
  await expect(page.getByRole('button', { name: '核定' })).toHaveCount(0)
  await logoutReal(page)

  // ── 監造:核定(review_requirement RPC;核定當下單向物化義務)────────────────
  await loginReal(page, supEmail)
  await gotoHash(page, '/requirements')
  await page.getByText(REQ_TITLE).first().click()
  await page.getByRole('button', { name: '核定' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '核定' }).click()
  await expect(page.getByRole('button', { name: '廢止取代' })).toBeVisible() // 僅 approved 才出現
  // ── 義務時程出現同標題(D-012 相容 runtime),狀態待辦、到期日=固定日 ───────
  await gotoHash(page, '/contract')
  await expect(page.getByText(REQ_TITLE).first()).toBeVisible()
  await expect(page.getByText('2026-09-30').first()).toBeVisible()
})
