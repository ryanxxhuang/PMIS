// W6-5｜鏈 4:標單匯入失敗/重設失敗 rollback(真 Supabase,重演 W1 pgTAP 情境)。
// RPC 層(以真使用者身分,走 RLS):
//   缺父項 payload 整包拒收(全敗如未匯)→ 重試成功 → 重複匯入被擋。
// UI 層(P0-01 驗收的畫面半邊):
//   品質檢查紀錄連著工項時,「清空重匯」被證據 guard 擋下 → 紅色橫幅
//   「清空未執行,所有資料維持原狀」、標單與日誌原封不動(不再半刪)→
//   移除品質證據後重試 → 清空成功、回到「尚未匯入標單」onboarding。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, gotoHash, runCleanup,
} from './helpers.js'

const PROJECT_NAME = `鏈4回滾工程-${Date.now().toString(36)}`
const conEmail = uniqueEmail('w6c4-con')
let conId, projectId

const GOOD_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '假設工程', unit: '式', quantity: 1, unit_price: 1000, amount: 1000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: '式', quantity: 2, unit_price: 500, amount: 1000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
  { item_key: '2', parent_key: null, item_no: '貳', description: '第二章', is_rollup: true, sort_order: 4, depth: 1 },
]
const BAD_ITEMS = [
  { item_key: '8', parent_key: null, description: '孤兒測試', sort_order: 1 },
  { item_key: '9.1', parent_key: '9', description: '缺父項', sort_order: 2 },
]

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈四廠商')
  const c = await signInClient(conEmail)
  const { data: project, error } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (error) throw new Error(`建案失敗:${error.message}`)
  projectId = project.id
  await c.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
  )
})

test('鏈 4:匯入全敗如未匯→重試成功→重設被 guard 擋(UI 顯錯不半刪)→排除後成功', async ({ page }) => {
  const c = await signInClient(conEmail)
  const countOf = async (table) => {
    const { count } = await c.from(table).select('id', { count: 'exact', head: true }).eq('project_id', projectId)
    return count || 0
  }

  // ── RPC:缺父項整包拒收,全敗如未匯(P0-02)────────────────────────────────
  const bad = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BAD_ITEMS })
  expect(bad.error?.message).toContain('標單資料的父項不存在:9')
  expect(await countOf('work_items')).toBe(0)

  // ── RPC:重試成功;重複匯入被擋(兩份標單不可混)────────────────────────────
  const good = await c.rpc('import_work_items', { p_project_id: projectId, p_items: GOOD_ITEMS })
  expect(good.error).toBeNull()
  expect(await countOf('work_items')).toBe(4)
  const dup = await c.rpc('import_work_items', { p_project_id: projectId, p_items: GOOD_ITEMS })
  expect(dup.error?.message).toContain('此專案已有標單工項,請先清空重匯')
  expect(await countOf('work_items')).toBe(4)

  // ── 佈置履約資料:日誌(無 guard,舊版會被半刪的受害者)+連著工項的品質檢查紀錄
  const { error: logErr } = await c.from('daily_logs').insert({
    project_id: projectId, log_date: '2026-08-13', work_summary: '模板組立',
  })
  if (logErr) throw new Error(`建日誌失敗:${logErr.message}`)
  const { data: wi } = await c.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.1').single()
  const { data: cl, error: clErr } = await c.from('checklist_records').insert({
    project_id: projectId, check_date: '2026-08-13', work_item_id: wi.id,
  }).select('id').single()
  if (clErr) throw new Error(`建檢查紀錄失敗:${clErr.message}`)

  // ── UI:清空重匯被證據 guard 擋下 → 紅色橫幅+資料原封不動(P0-01 畫面半邊)──
  await loginReal(page, conEmail)
  await gotoHash(page, '/boq')
  await expect(page.getByText('假設工程')).toBeVisible()
  await page.getByRole('button', { name: /重新匯入標單/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: '清空重匯' }).click()
  await expect(page.getByText(/清空未執行,所有資料維持原狀/)).toBeVisible()
  await expect(page.getByText('假設工程')).toBeVisible() // 標單還在,沒有半刪
  expect(await countOf('work_items')).toBe(4)
  expect(await countOf('daily_logs')).toBe(1) // 舊版災難點:日誌被靜默刪光;現在原封不動

  // ── 移除品質證據(草稿檢查紀錄本人可刪)→ 重試清空成功 → 回 onboarding ────
  const { error: delErr } = await c.from('checklist_records').delete().eq('id', cl.id)
  if (delErr) throw new Error(`刪檢查紀錄失敗:${delErr.message}`)
  await page.getByRole('button', { name: /重新匯入標單/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: '清空重匯' }).click()
  await expect(page.getByText('尚未匯入標單')).toBeVisible()
  expect(await countOf('work_items')).toBe(0)
  expect(await countOf('daily_logs')).toBe(0)
  await c.auth.signOut()
})
