// P4c｜鏈 8:未經監造確認的量在頁面上不可請款、直接送審被擋並顯示原因(真 Supabase,正式模式)。
// P4e 收回 valuation_items 直接寫入之前,舊客戶端仍可 REST 寫入申報量(DB 標 backing=legacy、無來源)。
// 這條鏈模擬那條舊路徑:廠商以 REST 寫 100 → 新 UI 顯示「缺監造確認來源・申報,不計價」、本期可請款金額 0、
// 缺件卡列出處理入口 → 直接按「送監造審核」被 DB 檢查點(VQ004)擋下,畫面列出原因,狀態仍是草稿
// → 廠商按「同步確認量」(沒有確認即歸零)→ 缺件消失 → 送審成功。
// fixture 全走產品窄門 RPC;afterAll 走 delete_project RPC+admin API 清理,殘留 0。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, gotoHash, runCleanup,
} from './helpers.js'

const PROJECT_NAME = `鏈8未確認量工程-${Date.now().toString(36)}`
const conEmail = uniqueEmail('p4c8-con')
let conId, projectId, workItemId

const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: false, is_leaf: false, is_billable: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '鋼筋', unit: 't', quantity: 100, unit_price: 100, amount: 10000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]
test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈八廠商')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { data: wi, error: wiError } = await c.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.1').single()
  if (wiError) throw new Error(`讀工項失敗:${wiError.message}`)
  workItemId = wi.id
  const { data: fm, error: fmError } = await c.from('projects').update({ formal_mode: true }).eq('id', projectId).select('id')
  if (fmError || !fm?.length) throw new Error(`開啟正式模式失敗:${fmError?.message || 'RLS 未生效'}`)
  await c.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
  )
})

test('鏈 8:舊路徑寫入的申報量不可請款;直接送審被擋並列出原因;同步後歸零可送審', async ({ page }) => {
  await loginReal(page, conEmail)
  await gotoHash(page, '/valuation')
  await page.getByRole('button', { name: '＋ 新增估驗期' }).click()
  await page.getByRole('dialog', { name: /建立第 1 期估驗/ }).getByRole('button', { name: '建立估驗期' }).click()
  const tab1 = page.getByRole('button', { name: /第 1 期/ })
  await expect(tab1.getByText('草稿')).toBeVisible()

  // 舊客戶端路徑:REST 直接寫 100(P4e 之前仍可;DB 標 legacy、算金額、但沒有來源)
  const con = await signInClient(conEmail)
  const { data: periods } = await con.from('valuations').select('id').eq('project_id', projectId)
  const valuationId = periods[0].id
  const { error: restErr } = await con.from('valuation_items').upsert(
    { valuation_id: valuationId, work_item_id: workItemId, cum_qty: 100, source: 'daily_log' },
    { onConflict: 'valuation_id,work_item_id' },
  )
  if (restErr) throw new Error(`REST 寫入失敗:${restErr.message}`)

  // 新 UI:申報 100 看得到,但標「申報,不計價」,本期可請款金額 0;缺件卡送審前就列出並給處理入口
  await page.reload()
  await gotoHash(page, '/valuation')
  await expect(page.getByLabel('一 累計完成數量')).toHaveValue('100')
  await expect(page.getByText('缺監造確認來源・申報,不計價')).toBeVisible()
  await expect(page.getByText('本期可請款金額').locator('..').getByText('0', { exact: true })).toBeVisible()
  await expect(page.getByText('另 1 項申報未確認,不計價')).toBeVisible()
  await expect(page.getByText('缺件 1 項')).toBeVisible()
  const checks = page.getByRole('list', { name: '缺件與檢核' })
  const block = checks.getByRole('listitem').filter({ hasText: '申報量未經監造確認:1 項工項' })
  await expect(block).toBeVisible()
  await expect(block.getByText(/一 鋼筋。/)).toBeVisible()
  await expect(block.getByText('按動作列的「同步確認量」以確認量為準')).toBeVisible()
  await page.getByRole('button', { name: '無確認來源' }).click()
  await expect(page.getByRole('group', { name: '一 來源' }).getByText(/沒有任何來源分配/)).toBeVisible()

  // 直接送審:DB 檢查點 VQ004 擋下,畫面列出原因(代碼翻成人話),狀態仍是草稿
  await page.getByRole('button', { name: '送監造審核' }).click()
  await expect(page.getByText(/送出被資料庫檢查點擋下/)).toBeVisible()
  const reasons = page.getByRole('list', { name: '被擋下的原因' })
  await expect(reasons.getByText(/缺監造確認來源\(一 鋼筋\)/)).toBeVisible()
  await expect(tab1.getByText('草稿')).toBeVisible()
  const rest = await con.from('valuations').update({ status: '監造審核' }).eq('id', valuationId).select('id')
  expect(rest.error?.code).toBe('VQ004')                              // 繞過畫面也一樣

  // 同步確認量:沒有確認即歸零 → 缺件消失 → 送審成功
  await page.getByRole('button', { name: '同步確認量', exact: true }).click()
  await expect(page.getByText(/已依監造確認量同步/)).toBeVisible()
  await expect(page.getByLabel('一 累計完成數量')).toHaveValue('0')
  await expect(page.getByText('無缺件,與日誌相符')).toBeVisible()
  await page.getByRole('button', { name: '送監造審核' }).click()
  await expect(tab1.getByText('監造審核')).toBeVisible()
  await con.auth.signOut()
})
