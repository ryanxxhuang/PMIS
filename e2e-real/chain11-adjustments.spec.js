// P4d｜鏈 11:撤銷／減量／補證／調整(真 Supabase,正式模式)。
// 11a:監造確認 60 → 廠商建期同步送審 → 監造核定 → 監造在估驗頁撤銷該筆確認(原因必填)→ 已核定量轉成待處理扣回
//     → 機關登錄請款日被擋(批次有效確認量少於已分配)→ 機關在「估驗調整」卡作廢(接受已計價)→ 請款日可登錄。
// 11b:歷史遷移期別(以 DBA 邊界建立:停用檢查點 trigger 核定 + fn_cq_backfill_legacy_internal,與正式庫 P4b 回填同一條路徑)
//     → 監造首頁「待監造補證」→ 估驗頁缺件「歷史遷移需補證」→ 來源展開「補證此期」→ 簽發並補證 → 缺件清空 → 機關登錄請款日。
// fixture 走產品窄門 RPC;歷史期別的 DBA 步驟走本機 stack 的 docker psql(正式庫的歷史期別是 migration 回填,不走這裡)。
// 前置:本機 stack 已套用 20260919160000;容器 supabase_db_PMIS 在跑。
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, logoutReal, gotoHash, runCleanup,
} from './helpers.js'

const PROJECT_NAME = `鏈11調整工程-${Date.now().toString(36)}`
const conEmail = uniqueEmail('p4d-con')
const supEmail = uniqueEmail('p4d-sup')
const ownEmail = uniqueEmail('p4d-own')
let conId, supId, ownId, projectId, wiA, wiB

// 一章兩葉:11a 用「一 混凝土」、11b 用「二 鋼筋」(各自獨立,前一段失敗不拖累後一段)
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: false, is_leaf: false, is_billable: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '混凝土', unit: 'm2', quantity: 100, unit_price: 100, amount: 10000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '鋼筋', unit: 't', quantity: 80, unit_price: 200, amount: 16000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
]
const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())

// DBA 邊界:本機 stack 的 postgres 超級使用者(與 pgTAP 的歷史期別 fixture 同一條路徑)
function dbaSql(sql) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_PMIS', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: sql, encoding: 'utf8' }).trim()
}

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈十一廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十一監造')
  ownId = await createConfirmedUser(ownEmail, 'owner', '鏈十一機關')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { data: wis, error: wiError } = await c.from('work_items').select('id, item_key').eq('project_id', projectId).in('item_key', ['1.1', '1.2'])
  if (wiError || wis.length !== 2) throw new Error(`讀工項失敗:${wiError?.message || wis.length}`)
  wiA = wis.find((w) => w.item_key === '1.1').id
  wiB = wis.find((w) => w.item_key === '1.2').id
  for (const [email, org] of [[supEmail, 'supervisor'], [ownEmail, 'owner']]) {
    const { error } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: email, p_role: 'member', p_expected_org: org })
    if (error) throw new Error(`邀請 ${org} 失敗:${error.message}`)
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

test('鏈 11a:核定後監造撤銷確認 → 待處理扣回擋請款 → 機關作廢 → 請款日可登錄', async ({ page }) => {
  const today = taipeiToday()
  // ── fixture(RPC):監造確認 60;廠商建期、同步、送審;監造核定 ─────────────────────
  const sup = await signInClient(supEmail)
  const cert = await sup.rpc('issue_supervisor_certificate', {
    p_project_id: projectId, p_work_item_id: wiA, p_batch_key: 'A區', p_location_label: 'A區',
    p_stage_key: null, p_unit: 'm2', p_qty_cum: 60, p_reason: '依查驗紀錄', p_client_request_id: 'e2e-11a-cert',
  })
  if (cert.error) throw new Error(`簽發確認單失敗:${cert.error.message}`)
  const con = await signInClient(conEmail)
  const valuationId = crypto.randomUUID()
  const { error: insErr } = await con.from('valuations').insert({ id: valuationId, project_id: projectId, period_no: 1, valuation_date: today, period_end: today, retention_pct: 5, status: '草稿' })
  if (insErr) throw new Error(`建期失敗:${insErr.message}`)
  const sync = await con.rpc('sync_valuation_from_confirmations', { p_valuation_id: valuationId })
  if (sync.error) throw new Error(`同步失敗:${sync.error.message}`)
  const submit = await con.rpc('transition_valuation', { p_valuation_id: valuationId, p_from: '草稿', p_to: '監造審核', p_note: null })
  if (submit.error) throw new Error(`送審失敗:${submit.error.message}`)
  await con.auth.signOut()
  const approve = await sup.rpc('transition_valuation', { p_valuation_id: valuationId, p_from: '監造審核', p_to: '已核定', p_note: null })
  if (approve.error) throw new Error(`核定失敗:${approve.error.message}`)
  await sup.auth.signOut()

  // ── 監造(UI):來源展開 → 有效確認 1 筆 → 撤銷(原因必填)→ 已核定量轉成待處理扣回 ──────
  await loginReal(page, supEmail)
  await gotoHash(page, `/valuation?period=${valuationId}`)
  const tab1 = page.getByRole('button', { name: /第 1 期/ })
  await expect(tab1.getByText('已核定')).toBeVisible()
  await page.getByRole('button', { name: '來源 1 筆' }).click()
  const sources = page.getByRole('group', { name: '一 來源' })
  await expect(sources.getByText('有效確認 1 筆')).toBeVisible()
  await expect(sources.getByText(/鏈十一監造/).first()).toBeVisible()  // 來源列與有效確認列都列確認人
  await page.getByRole('button', { name: '撤銷確認 A區' }).click()
  const revokeDialog = page.getByRole('dialog', { name: /撤銷確認：一 混凝土/ })
  await expect(revokeDialog.getByText('此欄必填')).toBeVisible()               // 原因必填
  await revokeDialog.getByRole('textbox').fill('複核後發現數量計算錯誤')
  await revokeDialog.getByRole('button', { name: '撤銷確認' }).click()
  await expect(page.getByText(/已撤銷 一 批次 A區 的確認:已核定量轉成待處理扣回/)).toBeVisible()
  const adjCard = page.getByRole('list', { name: '估驗調整' })
  await expect(adjCard.getByText('待處理')).toBeVisible()
  await expect(adjCard.getByText(/-60 m2 · 一 混凝土\(第 1 期已核定量\)/)).toBeVisible()
  await expect(page.getByRole('button', { name: /作廢調整/ })).toHaveCount(0)      // 監造沒有作廢入口
  await expect(page.getByRole('group', { name: '一 來源' }).getByText('有效確認 0 筆')).toBeVisible()
  await logoutReal(page)

  // ── 機關(UI):請款日先被擋(已核定期分配失去確認來源)→ 作廢扣回 → 請款日可登錄 ───────────
  await loginReal(page, ownEmail)
  await gotoHash(page, '/payments')
  await page.getByLabel('第 1 期請款日').fill(today)
  await page.getByLabel('第 1 期請款日').blur()
  await expect(page.getByText(/未儲存：.*(VQ004|被擋)/)).toBeVisible()             // 第三檢查點:DB 訊息原樣
  await gotoHash(page, `/valuation?period=${valuationId}`)
  await expect(page.getByText('1 筆待處理 · 共 1 筆')).toBeVisible()
  await page.getByRole('button', { name: '作廢調整 一' }).click()
  const voidDialog = page.getByRole('dialog', { name: /作廢扣回：一 混凝土/ })
  await expect(voidDialog.getByText(/接受該量已計價/)).toBeVisible()             // 語意明講:不產生新可用量
  await voidDialog.getByRole('textbox').fill('機關接受該量已計價,不再追扣')
  await voidDialog.getByRole('button', { name: '作廢(接受已計價)' }).click()
  await expect(page.getByText(/已作廢 一 混凝土 的扣回 -60 m2/)).toBeVisible()
  await expect(page.getByRole('list', { name: '估驗調整' }).getByText('已作廢')).toBeVisible()
  await expect(page.getByText('0 筆待處理 · 共 1 筆')).toBeVisible()
  await gotoHash(page, '/payments')
  await page.getByLabel('第 1 期請款日').fill(today)
  await page.getByLabel('第 1 期請款日').blur()
  await expect(page.getByText('已請款')).toBeVisible()
  await logoutReal(page)
})

test('鏈 11b:歷史遷移期別 → 監造首頁待補證 → 補證此期 → 請款日可登錄', async ({ page }) => {
  const today = taipeiToday()
  // ── DBA 邊界:歷史已核定期(period 2,鋼筋 50)＋ P4b 同一支回填 legacy 來源 ─────────────
  const legacyId = crypto.randomUUID()
  const backfilled = dbaSql(`
    begin;
    insert into public.valuations (id, project_id, period_no, valuation_date, period_end, retention_pct, status)
      values ('${legacyId}', '${projectId}', 2, '${today}', '${today}', 5, '草稿');
    insert into public.valuation_items (valuation_id, work_item_id, cum_qty) values ('${legacyId}', '${wiB}', 50);
    alter table public.valuations disable trigger valuations_checkpoint_guard;
    update public.valuations set status = '已核定' where id = '${legacyId}';
    alter table public.valuations enable trigger valuations_checkpoint_guard;
    select public.fn_cq_backfill_legacy_internal('${projectId}');
    commit;`)
  expect(backfilled.split('\n').pop()).toBe('1')                                   // 回填 1 筆 legacy 來源

  // ── 監造(UI):首頁球在監造補證;估驗頁缺件指到「補證此期」;簽發並補證 ───────────────────
  await loginReal(page, supEmail)
  await gotoHash(page, '/dashboard')
  await expect(page.getByText('待監造補證').first()).toBeVisible()
  await gotoHash(page, `/valuation?period=${legacyId}`)
  await expect(page.getByRole('button', { name: /第 2 期/ }).getByText('已核定')).toBeVisible()
  await expect(page.getByText('數量來自歷史遷移,不是監造確認:1 項工項')).toBeVisible()  // 缺件卡(VIOLATION_TEXT.title)
  await expect(page.getByText('歷史遷移需補證・申報,不計價')).toBeVisible()          // 明細列短標
  await expect(page.getByText('待監造補證')).toBeVisible()                            // 決策列球權(共用規則)
  await expect(page.getByText('展開該列來源,按「補證此期」簽發監造確認單')).toBeVisible()
  await page.getByRole('button', { name: '展開 1 列' }).click()
  await page.getByRole('button', { name: '補證此期 二' }).click()
  const form = page.getByRole('form', { name: /補證第 2 期:二 鋼筋/ })
  await expect(form.getByText('該期歷史遷移量 50 t')).toBeVisible()              // 涵蓋範圍
  await expect(form.getByLabel('累計確認量')).toHaveValue('50')
  await form.getByLabel('批次／位置').fill('舊估驗補證')
  await form.getByLabel('依據／說明').fill('依第 2 期估驗單與監造日誌複核')
  await form.getByRole('button', { name: '簽發並補證第 2 期' }).click()
  await expect(page.getByText(/第 2 期此工項的歷史遷移量已改以本確認單為計價依據/)).toBeVisible()
  await expect(page.getByText('歷史遷移需補證・申報,不計價')).toHaveCount(0)
  await expect(page.getByText(/數量來自歷史遷移,不是監造確認/)).toHaveCount(0)
  await expect(page.getByText('待監造補證')).toHaveCount(0)                            // 球離開監造(決策列)
  await expect(page.getByText(/0 項缺件 · 0 項風險/)).toBeVisible()               // 缺件清空(勾稽「無日誌申報」的注意仍在,不擋請款)
  const src = page.getByRole('group', { name: '二 來源' })
  await expect(src.getByText('批次 舊估驗補證').first()).toBeVisible()  // 來源列與有效確認列都列批次
  await expect(src.getByText('依據 監造確認單')).toBeVisible()
  await expect(src.getByText('有效確認 1 筆')).toBeVisible()
  await gotoHash(page, '/dashboard')
  await expect(page.getByText('待監造補證')).toHaveCount(0)                     // 球離開監造
  await logoutReal(page)

  // ── 機關(UI):請款日可登錄 ───────────────────────────────────────────────────────
  await loginReal(page, ownEmail)
  await gotoHash(page, '/payments')
  await page.getByLabel('第 2 期請款日').fill(today)
  await page.getByLabel('第 2 期請款日').blur()
  await expect(page.getByText('已請款').first()).toBeVisible()
  await logoutReal(page)
})
