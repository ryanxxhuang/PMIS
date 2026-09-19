// P4b｜鏈 7:未經監造確認的量無法送審／核定(真 Supabase,正式模式)。
// 廠商在估驗頁直接填 100(舊前端路徑,P4e 前仍可寫草稿)→ 送監造審核被 DB 檢查點擋下(VQ004,畫面原樣顯示原因)
// → 直接 REST 與 RPC 也擋 → 監造以登入身分簽發監造確認單 60(R1 起不要求兩步驟驗證)→ 廠商同步後累計=60 → 送審 → 監造核定。
// fixture 全走產品窄門 RPC;afterAll 走 delete_project RPC+admin API 清理,殘留 0。
// 前置:本機 stack 已套用 20260919140000(supabase migration up --local)。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, logoutReal, gotoHash, runCleanup,
} from './helpers.js'

const PROJECT_NAME = `鏈7確認量工程-${Date.now().toString(36)}`
const conEmail = uniqueEmail('p4b-con')
const supEmail = uniqueEmail('p4b-sup')
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

test('鏈 7:申報 100 未經監造確認不能送審;確認 60 後同步、送審、核定', async ({ page }) => {
  // ── 廠商:建期、直接填 100(舊路徑)、送審被擋 ──────────────────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/valuation')
  await page.getByRole('button', { name: '＋ 新增估驗期' }).click()
  const tab1 = page.getByRole('button', { name: /第 1 期/ })
  await expect(tab1.getByText('草稿')).toBeVisible()
  const con = await signInClient(conEmail)
  const { data: periods, error: pErr } = await con.from('valuations').select('id').eq('project_id', projectId)
  if (pErr || periods.length !== 1) throw new Error(`讀估驗期失敗:${pErr?.message || periods.length}`)
  const valuationId = periods[0].id
  // 截止日(P4c 才進 UI;P4b 起送審必填)由廠商以自己的身分補
  const { error: endErr } = await con.from('valuations').update({ period_end: taipeiToday() }).eq('id', valuationId)
  if (endErr) throw new Error(`補截止日失敗:${endErr.message}`)

  const qty = page.locator('input[type="number"]').first()
  await qty.fill('100')
  await qty.blur()
  await page.getByRole('button', { name: '送監造審核' }).click()
  await expect(page.getByText(/缺監造確認來源/)).toBeVisible()      // DB 檢查點原因原樣顯示
  await expect(tab1.getByText('草稿')).toBeVisible()               // 狀態沒變

  // 直接 REST 與 RPC 同樣被擋(檢查在 trigger,不在畫面)
  const rest = await con.from('valuations').update({ status: '監造審核' }).eq('id', valuationId).select('id')
  expect(rest.error?.code).toBe('VQ004')
  const rpc = await con.rpc('transition_valuation', { p_valuation_id: valuationId, p_from: '草稿', p_to: '監造審核' })
  expect(rpc.error?.code).toBe('VQ004')
  const { data: st } = await con.rpc('get_valuation_state', { p_valuation_id: valuationId })
  expect(st.items.find((i) => i.work_item_id === workItemId).cap).toBe(0)
  await logoutReal(page)

  // ── 監造:簽發監造確認單 60 → 自動同步草稿期;廠商不能簽 ───────────────────────────
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
  const replay = await sup.rpc('issue_supervisor_certificate', {
    p_project_id: projectId, p_work_item_id: workItemId, p_batch_key: 'A區', p_location_label: 'A區',
    p_stage_key: null, p_unit: 'm2', p_qty_cum: 60, p_reason: '依查驗紀錄', p_client_request_id: 'e2e-1',
  })
  expect(replay.data.applied).toBe(false)                           // 重播不重複入帳
  await sup.auth.signOut()

  // ── 廠商:同步(冪等)後累計 60、上限 60;送審成功 ──────────────────────────────────
  const synced = await con.rpc('sync_valuation_from_confirmations', { p_valuation_id: valuationId })
  if (synced.error) throw new Error(`同步失敗:${synced.error.message}`)
  const over = await con.rpc('set_valuation_item_cum', { p_valuation_id: valuationId, p_work_item_id: workItemId, p_cum_qty: 61 })
  expect(over.error?.code).toBe('VQ006')
  const { data: st2 } = await con.rpc('get_valuation_state', { p_valuation_id: valuationId })
  const item = st2.items.find((i) => i.work_item_id === workItemId)
  expect(item.cum_qty).toBe(60)
  expect(item.cap).toBe(60)
  expect(st2.violations).toEqual([])
  await con.auth.signOut()

  await loginReal(page, conEmail)
  await gotoHash(page, '/valuation')
  await expect(page.locator('input[type="number"]').first()).toHaveValue('60')
  await page.getByRole('button', { name: '送監造審核' }).click()
  await expect(tab1.getByText('監造審核')).toBeVisible()
  await logoutReal(page)

  // ── 監造:核定 ───────────────────────────────────────────────────────────
  await loginReal(page, supEmail)
  await gotoHash(page, '/valuation')
  await expect(tab1.getByText('監造審核')).toBeVisible()
  await page.getByRole('button', { name: '核定估驗' }).click()
  await expect(tab1.getByText('已核定')).toBeVisible()
})
