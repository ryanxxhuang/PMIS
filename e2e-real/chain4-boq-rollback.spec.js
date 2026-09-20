// W6-5｜鏈 4:標單匯入失敗/重設失敗 rollback(真 Supabase,重演 W1 pgTAP 情境)。
// RPC 層(以真使用者身分,走 RLS):
//   缺父項 payload 整包拒收(全敗如未匯)→ 重試成功 → 重複匯入被擋。
// UI 層(P0-01 驗收的畫面半邊):
//   品質檢查紀錄連著工項時,「清空重匯」被證據 guard 擋下 → 紅色橫幅
//   「清空未執行,所有資料維持原狀」、標單與日誌原封不動(不再半刪)→
//   移除品質證據後重試 → 清空成功、回到「尚未匯入標單」onboarding。
// 第二段(F2,E 包列為未測):工項有 **有效的監造確認量** 時,「清空重匯」被 work_items_confirmation_guard
//   (20260919140000 §4.7)擋下 → 同一條橫幅列出工項與「請先撤銷確認」、標單與確認紀錄原封不動 →
//   監造撤銷(留原因)後才可清空;清空後確認紀錄隨工項 cascade 刪除,簽發／撤銷／清空三筆稽核留在 audit_events。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, logoutReal, gotoHash, runCleanup, admin,
} from './helpers.js'

const PROJECT_NAME = `鏈4回滾工程-${Date.now().toString(36)}`
const conEmail = uniqueEmail('w6c4-con')
const supEmail = uniqueEmail('w6c4-sup')
let conId, supId, projectId

const GOOD_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '假設工程', unit: '式', quantity: 1, unit_price: 1000, amount: 1000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: '式', quantity: 2, unit_price: 500, amount: 1000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
  { item_key: '1.3', parent_key: '1', item_no: '三', description: '混凝土', unit: 'M3', quantity: 100, unit_price: 1000, amount: 100000, is_leaf: true, is_billable: true, sort_order: 4, depth: 2 },
  { item_key: '2', parent_key: null, item_no: '貳', description: '第二章', is_rollup: true, sort_order: 5, depth: 1 },
]
const BAD_ITEMS = [
  { item_key: '8', parent_key: null, description: '孤兒測試', sort_order: 1 },
  { item_key: '9.1', parent_key: '9', description: '缺父項', sort_order: 2 },
]

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈四廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈四監造')
  const c = await signInClient(conEmail)
  const { data: project, error } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (error) throw new Error(`建案失敗:${error.message}`)
  projectId = project.id
  const { error: inviteError } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' })
  if (inviteError) throw new Error(`邀請失敗:${inviteError.message}`)
  await c.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
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
  expect(await countOf('work_items')).toBe(5)
  const dup = await c.rpc('import_work_items', { p_project_id: projectId, p_items: GOOD_ITEMS })
  expect(dup.error?.message).toContain('此專案已有標單工項,請先清空重匯')
  expect(await countOf('work_items')).toBe(5)

  // ── 佈置履約資料:日誌(無 guard,舊版會被半刪的受害者)+連著工項的品質檢查紀錄
  const { error: logErr } = await c.from('daily_logs').insert({
    project_id: projectId, log_date: '2026-08-13', work_summary: '模板組立',
  })
  if (logErr) throw new Error(`建日誌失敗:${logErr.message}`)
  const { data: wi } = await c.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.1').single()
  // 連著工項的品質證據以 service 建(P6b-3 起使用者直接登錄檢查紀錄已退場,只由自主檢查表簽署寫入;
  // 這裡要的是「舊流程留下的證據擋住清空」,來源不影響 guard 行為)
  const { data: cl, error: clErr } = await admin().from('checklist_records').insert({
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
  expect(await countOf('work_items')).toBe(5)
  expect(await countOf('daily_logs')).toBe(1) // 舊版災難點:日誌被靜默刪光;現在原封不動

  // ── 移除品質證據(未判定的紀錄;以 service 移除,使用者已無直接刪除權)→ 重試清空成功 → 回 onboarding ────
  const { error: delErr } = await admin().from('checklist_records').delete().eq('id', cl.id)
  if (delErr) throw new Error(`刪檢查紀錄失敗:${delErr.message}`)
  await page.getByRole('button', { name: /重新匯入標單/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: '清空重匯' }).click()
  await expect(page.getByText('尚未匯入標單')).toBeVisible()
  expect(await countOf('work_items')).toBe(0)
  expect(await countOf('daily_logs')).toBe(0)
  await c.auth.signOut()
})

test('鏈 4b:工項有有效的監造確認量 → 清空重匯被擋(橫幅列出工項與「請先撤銷確認」、資料原封不動)→ 監造撤銷後才可清空;稽核留痕', async ({ page }) => {
  const c = await signInClient(conEmail)
  const countOf = async (table) => {
    const { count } = await c.from(table).select('id', { count: 'exact', head: true }).eq('project_id', projectId)
    return count || 0
  }
  // 重新匯入(上一段已清空)→ 監造親簽 混凝土 A區 60(產品窄門)
  const good = await c.rpc('import_work_items', { p_project_id: projectId, p_items: GOOD_ITEMS })
  expect(good.error).toBeNull()
  const { data: wi } = await c.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.3').single()
  const s = await signInClient(supEmail)
  const { data: cert, error: certErr } = await s.rpc('issue_supervisor_certificate', {
    p_project_id: projectId, p_work_item_id: wi.id, p_batch_key: 'A區', p_location_label: 'A區', p_stage_key: null,
    p_unit: 'M3', p_qty_cum: 60, p_reason: '監造親簽', p_client_request_id: 'c4b-req-1',
  })
  if (certErr) throw new Error(`簽確認單失敗:${certErr.message}`)
  expect(cert.applied).toBe(true)

  // 廠商 UI:清空重匯 → work_items_confirmation_guard 擋下(VQ010),橫幅同一形態、訊息指明工項與撤銷入口;資料原封不動
  await loginReal(page, conEmail)
  await gotoHash(page, '/boq')
  await expect(page.getByText('混凝土')).toBeVisible()
  await page.getByRole('button', { name: /重新匯入標單/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: '清空重匯' }).click()
  const banner = page.getByText(/清空未執行,所有資料維持原狀/)
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('工項「混凝土」已有有效的監造確認,不可刪除或重匯標單;請先撤銷確認')
  await expect(page.getByText('假設工程')).toBeVisible()
  expect(await countOf('work_items')).toBe(5)
  const { data: confBefore } = await c.from('inspection_confirmations').select('id, status, qty_cum').eq('project_id', projectId)
  expect(confBefore).toEqual([{ id: cert.confirmation_id, status: 'active', qty_cum: 60 }])
  // RPC 直打同樣被擋(不是前端擋)
  const direct = await c.rpc('reset_project_boq', { p_project_id: projectId })
  expect(direct.error?.code).toBe('VQ010')
  expect(direct.error?.message).toContain('請先撤銷確認')

  // 監造撤銷(留原因)→ 廠商再清空 → 成功;確認紀錄隨工項 cascade 刪除(留痕在 audit_events)
  const { data: revoked, error: revokeErr } = await s.rpc('revoke_inspection_confirmation', { p_id: cert.confirmation_id, p_reason: '標單匯錯要重匯' })
  if (revokeErr) throw new Error(`撤銷失敗:${revokeErr.message}`)
  expect(revoked.applied).toBe(true)
  await page.getByRole('button', { name: /重新匯入標單/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: '清空重匯' }).click()
  await expect(page.getByText('尚未匯入標單')).toBeVisible()
  expect(await countOf('work_items')).toBe(0)
  const { data: confAfter } = await c.from('inspection_confirmations').select('id').eq('project_id', projectId)
  expect(confAfter).toEqual([]) // 既有規則:撤銷後的紀錄不再擋,隨工項 cascade;歷史由稽核保存
  const { data: audits } = await c.from('audit_events').select('event_type').eq('project_id', projectId).in('event_type', ['confirmation.issued', 'confirmation.revoked', 'boq.reset'])
  expect(audits.map((a) => a.event_type).sort()).toEqual(['boq.reset', 'boq.reset', 'confirmation.issued', 'confirmation.revoked'])
  await logoutReal(page)
  await s.auth.signOut()
  await c.auth.signOut()
})
