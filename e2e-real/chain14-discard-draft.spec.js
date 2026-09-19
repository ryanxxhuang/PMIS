// P3f｜鏈 14:捨棄現場文書草稿(真 Supabase,正式模式,本機 Edge stub 模型)。
//   廠商上傳一張照片 → 伺服器起施工日誌＋自主檢查表草稿(指向它們的 AI 草稿待覆核)→ /site 清單列上捨棄自主檢查表
//   (原因必填)→ 開施工日誌頁捨棄(原因必填)→ 回 /site 說明已捨棄 → DB:狀態 discarded、原因／捨棄者／時間、版本保留、
//   AI 草稿標 rejected、稽核帶原因 → RPC 直打:監造捨棄 PD006、同一請求重送冪等 → 重新上傳一張照片 → 伺服器起一份新的
//   同日施工日誌(不是捨棄的那份)→ 補齊並簽署(新草稿可簽署,daily_logs 落庫)→ 已簽署再捨棄 PD008、清單不再有捨棄入口。
// 前置同 chain 5(docs/REAL_BACKEND_E2E.md):另一個 terminal `supabase functions serve --env-file e2e-real/stub.env`;
// 本機 stack 已套用 20260920021000。帳號全部本次產生;afterAll 以建立者 delete_project＋admin API 清帳號,殘留 0。
import { test, expect } from '@playwright/test'
import {
  admin, uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, gotoHash, runCleanup, tinyJpeg,
} from './helpers.js'

const PROJECT_NAME = `鏈14捨棄草稿-${Date.now().toString(36)}`
const conEmail = uniqueEmail('w6c14-con')
const supEmail = uniqueEmail('w6c14-sup')
let conId, supId, projectId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '假設工程', unit: '式', quantity: 1, unit_price: 1000, amount: 1000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
]
const TEMPLATE_ITEMS = [{ no: 'B1', group: '澆置前', item: '澆置 24 小時前已通知監造', kind: 'bool', standard: '≥24 小時前通知' }]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈十四廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十四監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: boqError } = await c.rpc('import_work_items', { p_project_id: projectId, p_items: BOQ_ITEMS })
  if (boqError) throw new Error(`匯標單失敗:${boqError.message}`)
  const { error: inviteError } = await c.rpc('add_member_by_email', { p_project: projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' })
  if (inviteError) throw new Error(`邀請失敗:${inviteError.message}`)
  const { error: tplError } = await c.from('checklist_templates').insert({ project_id: projectId, title: '結構混凝土自主檢查表', source: '03310', items: TEMPLATE_ITEMS })
  if (tplError) throw new Error(`建範本失敗:${tplError.message}`)
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

test('鏈 14:廠商起稿→清單捨棄自檢表、文件頁捨棄施工日誌(原因必填)→版本保留、AI 草稿退回、稽核→重新上傳起新草稿→新草稿可簽署', async ({ page }) => {
  test.setTimeout(420_000)

  // ── 廠商上傳一張照片 → 伺服器起施工日誌＋自主檢查表草稿 ─────────────────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/site')
  await expect(page.getByRole('heading', { level: 1, name: '現場紀錄' })).toBeVisible()
  await page.getByLabel('選擇照片上傳').setInputFiles([{ name: 'site-a.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('c14-a') }])
  await expect(page.getByText('已保存到伺服器 1／1')).toBeVisible({ timeout: 60_000 })
  const uploadCard = page.getByRole('group', { name: '拍照／上傳' })
  await expect(uploadCard.getByText(/自主檢查表 \d{4}-\d{2}-\d{2}/)).toBeVisible({ timeout: 90_000 })

  const con = await signInClient(conEmail)
  const docsOf = async () => {
    const { data } = await con.from('field_documents')
      .select('id, doc_type, doc_date, status, current_version_no, discard_reason, discarded_by, discarded_at, discard_request_id')
      .eq('project_id', projectId).order('created_at')
    return data || []
  }
  let docs = await docsOf()
  const dl1 = docs.find((d) => d.doc_type === 'daily_log')
  const sc1 = docs.find((d) => d.doc_type === 'self_check')
  expect(dl1).toMatchObject({ doc_date: today, status: 'pending_input', current_version_no: 1, discard_reason: null })
  expect(sc1).toMatchObject({ status: 'pending_input', current_version_no: 1 })
  const { data: acts1 } = await con.from('agent_actions').select('id, status, target_id').eq('project_id', projectId).in('target_id', [dl1.id, sc1.id])
  expect(acts1.map((a) => a.status)).toEqual(['pending', 'pending']) // 起稿留下待覆核的 AI 草稿

  // ── /site 清單:在自主檢查表那一列捨棄(確認鈕在填原因前不可按)─────────────────────────────
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: '現場紀錄' })).toBeVisible()
  const docCard = page.getByRole('group', { name: '現場文書' })
  await expect(docCard.getByRole('link', { name: /自主檢查表/ })).toBeVisible({ timeout: 30_000 })
  await docCard.getByRole('button', { name: `捨棄草稿：${today} 自主檢查表` }).click()
  const scDialog = page.getByRole('dialog', { name: `捨棄 ${today} 自主檢查表草稿？` })
  await expect(scDialog.getByRole('button', { name: '捨棄草稿' })).toBeDisabled()
  await scDialog.getByRole('textbox').fill('工項配錯，這張不是混凝土')
  await scDialog.getByRole('button', { name: '捨棄草稿' }).click()
  await expect(page.getByRole('status').filter({ hasText: '已捨棄' })).toContainText(`已捨棄 ${today} 自主檢查表草稿（原因：工項配錯，這張不是混凝土）`)
  await expect(docCard.getByRole('link', { name: /自主檢查表/ })).toHaveCount(0)

  // ── 施工日誌頁:捨棄草稿 → 回 /site 並說明可重新起稿 ─────────────────────────────────────
  await docCard.getByRole('link', { name: new RegExp(`施工日誌 ${today}`) }).click()
  await expect(page).toHaveURL(/#\/site-log\?doc=/)
  await expect(page.getByRole('status', { name: /保存狀態/ })).toHaveText(/已存檔.*版本 1/, { timeout: 30_000 })
  await page.getByRole('button', { name: `捨棄草稿：${today} 施工日誌` }).click()
  const dlDialog = page.getByRole('dialog', { name: `捨棄 ${today} 施工日誌草稿？` })
  await expect(dlDialog).toContainText('1 個版本與照片都會保留')
  await dlDialog.getByRole('textbox').fill('  照片日期判錯，要重新上傳  ')
  await dlDialog.getByRole('button', { name: '捨棄草稿' }).click()
  await expect(page).toHaveURL(/#\/site$/)
  const notice = page.getByRole('status').filter({ hasText: '已捨棄' })
  await expect(notice).toContainText(`已捨棄 ${today} 施工日誌草稿（原因：照片日期判錯，要重新上傳）`)
  await expect(notice.getByRole('link', { name: '施工日誌頁' })).toHaveAttribute('href', `#/site-log?d=${today}`)
  await expect(page.getByRole('group', { name: '現場文書' }).getByRole('link', { name: /施工日誌/ })).toHaveCount(0)

  // ── DB:捨棄紀錄由伺服器寫、版本保留、AI 草稿標 rejected、稽核帶原因 ─────────────────────────
  docs = await docsOf()
  const dl1After = docs.find((d) => d.id === dl1.id)
  expect(dl1After).toMatchObject({ status: 'discarded', current_version_no: 1, discard_reason: '照片日期判錯，要重新上傳', discarded_by: conId })
  expect(dl1After.discarded_at).toBeTruthy()
  expect(dl1After.discard_request_id).toBeTruthy()
  expect(docs.find((d) => d.id === sc1.id)).toMatchObject({ status: 'discarded', discard_reason: '工項配錯，這張不是混凝土' })
  const { count: dlVersions } = await con.from('field_document_versions').select('id', { count: 'exact', head: true }).eq('document_id', dl1.id)
  expect(dlVersions).toBe(1)
  const { data: acts2 } = await con.from('agent_actions').select('status, resolved_by').eq('project_id', projectId).in('target_id', [dl1.id, sc1.id])
  expect(acts2).toEqual([{ status: 'rejected', resolved_by: conId }, { status: 'rejected', resolved_by: conId }])
  const { data: audit } = await admin().from('audit_events').select('event_type, actor_user_id, metadata').eq('project_id', projectId)
    .eq('event_type', 'field_document.discarded').eq('entity_id', dl1.id)
  expect(audit).toHaveLength(1)
  expect(audit[0]).toMatchObject({ actor_user_id: conId, metadata: { reason: '照片日期判錯，要重新上傳', doc_type: 'daily_log' } })

  // ── RPC 直打:監造不能捨棄廠商文件(PD006);同一請求重送冪等 ──────────────────────────────────
  const sup = await signInClient(supEmail)
  const { error: supErr } = await sup.rpc('discard_field_document', { p_document_id: dl1.id, p_reason: '監造想捨棄' })
  expect(supErr?.code).toBe('PD006')
  const { data: again, error: againErr } = await con.rpc('discard_field_document', {
    p_document_id: dl1.id, p_reason: '照片日期判錯，要重新上傳', p_client_request_id: dl1After.discard_request_id,
  })
  expect(againErr).toBeNull()
  expect(again).toMatchObject({ status: 'discarded', idempotent: true, agent_actions_resolved: 0 })

  // ── 重新上傳一張照片 → 伺服器起一份新的同日施工日誌(捨棄的那份不動) ─────────────────────────
  await page.getByLabel('選擇照片上傳').setInputFiles([{ name: 'site-b.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('c14-b') }])
  await expect(page.getByText('已保存到伺服器 1／1')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('group', { name: '拍照／上傳' }).getByText(/施工日誌 \d{4}-\d{2}-\d{2}/).first()).toBeVisible({ timeout: 90_000 })
  docs = await docsOf()
  const liveDaily = docs.filter((d) => d.doc_type === 'daily_log' && d.status !== 'discarded')
  expect(liveDaily).toHaveLength(1)
  const dl2 = liveDaily[0]
  expect(dl2.id).not.toBe(dl1.id)
  expect(dl2).toMatchObject({ doc_date: today, status: 'pending_input', current_version_no: 1 })
  expect(docs.find((d) => d.id === dl1.id)).toMatchObject({ status: 'discarded', current_version_no: 1 })
  // 新草稿在清單上有捨棄入口
  await page.reload()
  await expect(page.getByRole('group', { name: '現場文書' }).getByRole('button', { name: `捨棄草稿：${today} 施工日誌` })).toBeVisible({ timeout: 30_000 })

  // ── 新草稿可簽署:補齊(人工版本)→ 簽署 → daily_logs 落庫 ─────────────────────────────────────
  const { data: v1 } = await con.from('field_document_versions').select('content, field_sources, attachments').eq('document_id', dl2.id).eq('version_no', 1).single()
  const { data: wi } = await con.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.2').single()
  const content = {
    ...v1.content, weather_am: '晴', weather_pm: '晴', work_summary: '3F 版牆混凝土澆置',
    labor: [{ type: '泥作', count: 6 }], equipment: [], materials: [],
    items: { ...(v1.content.items || {}), [wi.id]: { ...((v1.content.items || {})[wi.id] || {}), qty_today: 12 } },
  }
  const OK = { status: 'confirmed', source: 'human' }
  const sources = {
    ...v1.field_sources, weather_am: OK, weather_pm: OK, work_summary: OK, labor: OK,
    equipment: { status: 'na', source: null, reason: '本日無機具' }, materials: { status: 'na', source: null, reason: '本日無進料' },
    [`items.${wi.id}.qty_today`]: OK,
  }
  const { data: saved, error: saveErr } = await con.rpc('save_field_document_version', {
    p_document_id: dl2.id, p_base_version_no: 1, p_content: content, p_field_sources: sources, p_attachments: v1.attachments,
  })
  if (saveErr) throw new Error(`新草稿存版失敗:${saveErr.message}`)
  expect(saved).toMatchObject({ version_no: 2, status: 'draft', recheck: [] })
  const { data: signed, error: signErr } = await con.rpc('sign_field_document', {
    p_document_id: dl2.id, p_version_no: 2, p_content_hash: saved.content_hash, p_intent: '本人確認施工日誌內容無誤並簽署',
  })
  if (signErr) throw new Error(`新草稿簽署失敗:${signErr.message}`)
  expect(signed).toMatchObject({ status: 'signed', target_table: 'daily_logs' })
  const { data: fact } = await con.from('daily_logs').select('id, log_date, status').eq('project_id', projectId).eq('log_date', today).single()
  expect(fact).toMatchObject({ id: signed.target_id, status: '已簽署' })

  // ── 已簽署不可捨棄(PD008);清單不再有捨棄入口 ─────────────────────────────────────────────
  const { error: signedErr } = await con.rpc('discard_field_document', { p_document_id: dl2.id, p_reason: '簽了又想撤' })
  expect(signedErr?.code).toBe('PD008')
  await page.reload()
  const docCard2 = page.getByRole('group', { name: '現場文書' })
  await expect(docCard2.getByRole('link', { name: new RegExp(`施工日誌 ${today}`) })).toBeVisible({ timeout: 30_000 })
  await expect(docCard2.getByRole('button', { name: /捨棄草稿：.*施工日誌/ })).toHaveCount(0)
  await con.auth.signOut()
  await sup.auth.signOut()
})
