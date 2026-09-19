// P4b／P4c｜鏈 7:確認量在估驗頁的完整路徑(真 Supabase,正式模式)。
// 廠商在估驗頁直接填 100 → set_valuation_item_cum 回 VQ006(上限 0),畫面顯示前期累計／上限／可用量、輸入框回到 DB 的值
// → 監造以登入身分簽發監造確認單 60(撤銷／確認單介面 P4d 才進 UI,這裡走 RPC;廠商不能簽)→ DB 自動同步到草稿期
// → 廠商重新整理看到 60、可估驗清單有效 60、來源展開列出批次／確認人 → 填 61 再被擋 → 按「同步確認量」(冪等) → 送審 → 監造核定。
// fixture 全走產品窄門 RPC;afterAll 走 delete_project RPC+admin API 清理,殘留 0。
// 前置:本機 stack 已套用 20260919140000(supabase migration up --local)。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, logoutReal, gotoHash, runCleanup,
} from './helpers.js'

const PROJECT_NAME = `鏈7確認量工程-${Date.now().toString(36)}`
const conEmail = uniqueEmail('p4c-con')
const supEmail = uniqueEmail('p4c-sup')
let conId, supId, projectId, workItemId

// 一章一葉:混凝土 m2 100 × 100
const BOQ_ITEMS = [
  // 章列 is_rollup=false:估驗頁的 buildBillableTree 會略過 is_rollup(合計列),章是合計列時葉子就沒有可掛的根,表格空白
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: false, is_leaf: false, is_billable: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '混凝土', unit: 'm2', quantity: 100, unit_price: 100, amount: 10000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]

// 台北日曆日(全站業務日期口徑;UTC 在台灣 00:00–08:00 會落成前一天)
const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈七廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈七監造')
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
  const { error } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' })
  if (error) throw new Error(`邀請失敗:${error.message}`)
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

test('鏈 7:填 100 被上限擋;確認 60 後自動同步、來源可展開、送審、核定', async ({ page }) => {
  const today = taipeiToday()

  // ── 廠商:建期(截止日今天)、可估驗清單空、填 100 被 VQ006 擋、輸入框回到 DB 的值 ──────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/valuation')
  await expect(page.getByText('尚無監造確認量')).toBeVisible()          // list_billable_backlog 空
  await page.getByRole('button', { name: '＋ 新增估驗期' }).click()
  const dialog = page.getByRole('dialog', { name: /建立第 1 期估驗/ })
  await expect(dialog.getByLabel(/計價截止日/)).toHaveValue(today)
  await dialog.getByRole('button', { name: '建立估驗期' }).click()
  const tab1 = page.getByRole('button', { name: /第 1 期/ })
  await expect(tab1.getByText('草稿')).toBeVisible()
  const qty = page.getByLabel('一 累計完成數量')
  await expect(qty).toHaveValue('')
  await qty.fill('100')
  await qty.blur()
  await expect(page.getByText(/本期最多可新增 0(\.0+)?\(有效確認量 0/)).toBeVisible()   // VQ006:DB 訊息原樣(橫幅)
  await expect(page.getByText(/前期累計 0・本期起算值 0・本期最多可新增 0・可用確認量 0・你填的 100/)).toBeVisible()
  await expect(page.getByLabel('一 累計完成數量')).toHaveValue('')     // 被拒的數字不留在框裡
  await expect(page.getByText('本期可請款金額').locator('..').getByText('0', { exact: true })).toBeVisible()
  const con = await signInClient(conEmail)
  const { data: periods, error: pErr } = await con.from('valuations').select('id, period_end').eq('project_id', projectId)
  if (pErr || periods.length !== 1) throw new Error(`讀估驗期失敗:${pErr?.message || periods.length}`)
  const valuationId = periods[0].id
  expect(periods[0].period_end).toBe(today)                            // 建期對話框寫進 DB
  const { data: st } = await con.rpc('get_valuation_state', { p_valuation_id: valuationId })
  expect(st.items.find((i) => i.work_item_id === workItemId)?.cum_qty ?? null).toBeNull() // 100 沒有寫進去
  await logoutReal(page)

  // ── 監造:簽發監造確認單 60 → DB 自動同步到草稿期;廠商不能簽 ───────────────────────────
  const conDenied = await con.rpc('issue_supervisor_certificate', {
    p_project_id: projectId, p_work_item_id: workItemId, p_batch_key: 'A區', p_location_label: 'A區',
    p_stage_key: null, p_unit: 'm2', p_qty_cum: 60, p_reason: '依查驗紀錄', p_client_request_id: 'e2e-0',
  })
  expect(conDenied.error?.code).toBe('VQ001')                       // 廠商不是監造
  const sup = await signInClient(supEmail)
  const cert = await sup.rpc('issue_supervisor_certificate', {
    p_project_id: projectId, p_work_item_id: workItemId, p_batch_key: 'A區', p_location_label: 'A區',
    p_stage_key: null, p_unit: 'm2', p_qty_cum: 60, p_reason: '依查驗紀錄', p_client_request_id: 'e2e-1',
  })
  if (cert.error) throw new Error(`簽發確認單失敗:${cert.error.message}`)
  expect(cert.data.applied).toBe(true)
  await sup.auth.signOut()

  // ── 廠商:畫面是 DB 的 60;可估驗清單、來源展開;填 61 再被擋;同步(冪等);送審 ──────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/valuation')
  await expect(page.getByLabel('一 累計完成數量')).toHaveValue('60')
  await expect(page.getByText('可再增 0')).toBeVisible()               // headroom 由 DB 給
  await expect(page.getByText('1 項有監造確認 · 0 項有可用量')).toBeVisible()
  const backlog = page.getByRole('list', { name: '可估驗清單' })
  await expect(backlog.getByText('有效 60 m2')).toBeVisible()
  await expect(backlog.getByText('第 1 期草稿')).toBeVisible()          // occupied_by
  await expect(page.getByText('監造確認', { exact: true })).toBeVisible()    // backing=confirmed
  await page.getByRole('button', { name: '來源 1 筆' }).click()
  const sources = page.getByRole('group', { name: '一 來源' })
  await expect(sources.getByText('批次 A區')).toBeVisible()
  await expect(sources.getByText('確認累計 60 m2')).toBeVisible()
  await expect(sources.getByText(/鏈七監造/)).toBeVisible()             // 確認人(成員名字)與時間
  await expect(sources.getByText('依據 監造確認單')).toBeVisible()
  await expect(sources.getByText('歷史遷移')).toHaveCount(0)
  await expect(page.getByText('本期可請款金額').locator('..').getByText('6,000', { exact: true })).toBeVisible() // 60 × 100,DB 算
  const qty2 = page.getByLabel('一 累計完成數量')
  await qty2.fill('61')
  await qty2.blur()
  await expect(page.getByText(/本期最多可新增 60(\.0+)?\(有效確認量 60/)).toBeVisible() // VQ006(橫幅;DB 訊息的 numeric 帶小數位)
  await expect(page.getByLabel('一 累計完成數量')).toHaveValue('60')
  await page.getByRole('button', { name: '同步確認量', exact: true }).click()
  await expect(page.getByText(/已依監造確認量同步/)).toBeVisible()
  await expect(page.getByLabel('一 累計完成數量')).toHaveValue('60')    // 冪等
  await expect(page.getByText('缺件', { exact: false }).filter({ hasText: /缺件 \d+ 項/ })).toHaveCount(0)
  await expect(page.getByText('無日誌申報 1 項')).toBeVisible()          // 日誌申報只作差異比對,不擋送審
  await page.getByRole('button', { name: '送監造審核' }).click()
  await expect(tab1.getByText('監造審核')).toBeVisible()
  await con.auth.signOut()
  await logoutReal(page)

  // ── 監造:核定 ───────────────────────────────────────────────────────────
  await loginReal(page, supEmail)
  await gotoHash(page, '/valuation')
  await expect(tab1.getByText('監造審核')).toBeVisible()
  await page.getByRole('button', { name: '核定估驗' }).click()
  await expect(tab1.getByText('已核定')).toBeVisible()
})
