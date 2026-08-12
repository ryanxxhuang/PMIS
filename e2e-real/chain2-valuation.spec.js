// W6-3｜鏈 2:廠商提送 → 監造審核 → 機關核准/付款(真 Supabase,正式模式)。
// 走估驗金流的三方簽核:廠商建期送審 → 監造核定 → 機關登錄請款/收款。
// 正式模式開啟,角色分離是真的(廠商看不到核定鈕、金流未核定前鎖定——
// 同規則由 DB trigger 強制,這裡驗 UI+RLS 的整條真路徑)。
// fixture 全走產品窄門 RPC(create_project/import_work_items/add_member_by_email),
// 不繞過權限;afterAll 走 delete_project RPC+admin API 清理,殘留 0。
import { test, expect } from '@playwright/test'
import {
  password, uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, logoutReal, gotoHash,
} from './helpers.js'

const PROJECT_NAME = `鏈2估驗工程-${Date.now().toString(36)}`
const conEmail = uniqueEmail('w6c2-con')
const supEmail = uniqueEmail('w6c2-sup')
const ownEmail = uniqueEmail('w6c2-own')
let conId, supId, ownId

// 最小標單(與 import_work_items 的 p_items 同形狀):一章兩葉
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '假設工程', unit: '式', quantity: 1, unit_price: 1000, amount: 1000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: '式', quantity: 2, unit_price: 500, amount: 1000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
]

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈二廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈二監造')
  ownId = await createConfirmedUser(ownEmail, 'owner', '鏈二機關')

  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: project.id, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  for (const [email, org] of [[supEmail, 'supervisor'], [ownEmail, 'owner']]) {
    const { error } = await c.rpc('add_member_by_email', { p_project: project.id, p_email: email, p_role: 'member', p_expected_org: org })
    if (error) throw new Error(`邀請失敗(${email}):${error.message}`)
  }
  // 正式模式:關閉建立者跨角色例外,三方簽核角色分離才是真的
  const { data: fm, error: fmError } = await c.from('projects').update({ formal_mode: true }).eq('id', project.id).select('id')
  if (fmError || !fm?.length) throw new Error(`開啟正式模式失敗:${fmError?.message || 'RLS 未生效'}`)
  await c.auth.signOut()
})

test.afterAll(async () => {
  await deleteOwnedProjects(conEmail)
  await cleanupUser(conId)
  await cleanupUser(supId)
  await cleanupUser(ownId)
})

test('鏈 2:廠商建期送審 → 監造核定 → 機關請款/收款登錄', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10)

  // ── 廠商:建估驗期 → 送監造審核;正式模式下沒有核定鈕 ────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/valuation')
  await page.getByRole('button', { name: '＋ 新增估驗期' }).click()
  const tab1 = page.getByRole('button', { name: /第 1 期/ })
  await expect(tab1.getByText('草稿')).toBeVisible()
  await page.getByRole('button', { name: '送監造審核' }).click()
  await expect(tab1.getByText('監造審核')).toBeVisible()
  await expect(page.getByText('待監造核定')).toBeVisible()
  await expect(page.getByRole('button', { name: '核定估驗' })).toHaveCount(0) // 廠商不可核定
  await logoutReal(page)

  // ── 監造:核定 ───────────────────────────────────────────────────────────
  await loginReal(page, supEmail)
  await gotoHash(page, '/valuation')
  await expect(tab1.getByText('監造審核')).toBeVisible()
  await page.getByRole('button', { name: '核定估驗' }).click()
  await expect(tab1.getByText('已核定')).toBeVisible()
  await expect(page.getByRole('button', { name: '退回核定' })).toBeVisible()
  await logoutReal(page)

  // ── 機關:登錄請款日 → 收款日(狀態 待請款 → 已請款 → 已收款)──────────────
  await loginReal(page, ownEmail)
  await gotoHash(page, '/payments')
  await expect(page.getByText('待請款')).toBeVisible()
  await page.getByLabel('第 1 期請款日').fill(today)
  await page.getByLabel('第 1 期請款日').blur()
  await expect(page.getByText('已請款')).toBeVisible()
  await page.getByLabel('第 1 期收款日').fill(today)
  await page.getByLabel('第 1 期收款日').blur()
  await expect(page.getByText('已收款')).toBeVisible()
})
