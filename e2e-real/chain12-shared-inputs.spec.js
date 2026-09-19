// P3e｜鏈 12:共用補值(真 Supabase,正式模式,本機 Edge stub 模型)。
//   廠商上傳一張照片 → 伺服器起施工日誌＋自主檢查表草稿 → 上傳結果的「一次補齊」填一次施作位置 → 兩份文件各多一個
//   人工版本(雜湊由 DB 算、來源 confirmed/shared) → 補當日數量 → 只有施工日誌更新 → 簽署自主檢查表 → 重新整理後在
//   「上傳批次」再補另一個位置 → 施工日誌更新、已簽署的自主檢查表不變(版本、內容、雜湊)並在畫面標「已簽署，不受影響」
//   → 同值重送不產生版本(冪等) → 監造對廠商批次補值被伺服器擋(PD006)。
// 前置同 chain 5(docs/REAL_BACKEND_E2E.md):另一個 terminal `supabase functions serve --env-file e2e-real/stub.env`;
// 本機 stack 已套用 20260920001500。帳號全部本次產生;afterAll 以建立者 delete_project＋admin API 清帳號,殘留 0。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, gotoHash, runCleanup, tinyJpeg,
} from './helpers.js'

const PROJECT_NAME = `鏈12共用補值-${Date.now().toString(36)}`
const conEmail = uniqueEmail('w6c12-con')
const supEmail = uniqueEmail('w6c12-sup')
let conId, supId, projectId
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '假設工程', unit: '式', quantity: 1, unit_price: 1000, amount: 1000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
  { item_key: '1.2', parent_key: '1', item_no: '二', description: '結構工程', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 3, depth: 2 },
]
// 只有一張範本、一個勾選項:自檢表簽署只需人確認 B1
const TEMPLATE_ITEMS = [{ no: 'B1', group: '澆置前', item: '澆置 24 小時前已通知監造', kind: 'bool', standard: '≥24 小時前通知' }]

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈十二廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十二監造')
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

test('鏈 12:廠商上傳→起施工日誌＋自檢表→補一次位置／數量→兩份都更新→簽自檢表→再補另一個位置→已簽署那份不變;同值冪等、監造補廠商批次被擋', async ({ page }) => {
  test.setTimeout(420_000)

  // ── 廠商:現場紀錄上傳一張照片 → 伺服器起施工日誌＋自主檢查表(stub 配到「結構工程」,位置與數量待補) ──
  await loginReal(page, conEmail)
  await gotoHash(page, '/site')
  await expect(page.getByRole('heading', { level: 1, name: '現場紀錄' })).toBeVisible()
  await page.getByLabel('選擇照片上傳').setInputFiles([{ name: 'site-a.jpg', mimeType: 'image/jpeg', buffer: tinyJpeg('c12-a') }])
  await expect(page.getByText('已保存到伺服器 1／1')).toBeVisible({ timeout: 60_000 })
  const uploadCard = page.getByRole('group', { name: '拍照／上傳' })
  await expect(uploadCard.getByText(/自主檢查表 \d{4}-\d{2}-\d{2}/)).toBeVisible({ timeout: 90_000 })

  const con = await signInClient(conEmail)
  const docsOf = async () => {
    const { data } = await con.from('field_documents').select('id, doc_type, status, current_version_no').eq('project_id', projectId).order('doc_type')
    return Object.fromEntries((data || []).map((d) => [d.doc_type, d]))
  }
  const verOf = async (docId, no) => {
    const { data } = await con.from('field_document_versions').select('version_no, author_kind, created_by, content, field_sources, attachments, content_hash, change_note')
      .eq('document_id', docId).eq('version_no', no).single()
    return data
  }
  let docs = await docsOf()
  expect(docs.daily_log).toMatchObject({ status: 'pending_input', current_version_no: 1 })
  expect(docs.self_check).toMatchObject({ status: 'pending_input', current_version_no: 1 })
  const dl = docs.daily_log.id
  const sc = docs.self_check.id
  const { data: wi } = await con.from('work_items').select('id').eq('project_id', projectId).eq('item_key', '1.2').single()
  const dlV1 = await verOf(dl, 1)
  expect(dlV1.content.items[wi.id]).toMatchObject({ location: null, qty_today: null })
  expect(dlV1.field_sources[`items.${wi.id}.location`].status).toBe('pending')

  // ── 一次補齊:位置填一次 → 施工日誌與自主檢查表各一個人工版本 ─────────────────────────────
  const shared = uploadCard.getByRole('group', { name: '一次補齊' })
  await expect(shared).toBeVisible({ timeout: 30_000 })
  const locDocs = shared.getByRole('list', { name: '施作位置・二 結構工程 影響的文件' })
  await expect(locDocs.getByText('施工日誌・將寫入')).toBeVisible()
  await expect(locDocs.getByText('自主檢查表・將寫入')).toBeVisible()
  const locInput = shared.getByRole('textbox', { name: '施作位置・二 結構工程' })
  await locInput.fill('A區 3F 版牆')
  await locInput.locator('xpath=ancestor::li[1]').getByRole('button', { name: '套用' }).click()
  await expect(shared.getByText('已更新 2 份（施工日誌 版本 2、自主檢查表 版本 2）')).toBeVisible({ timeout: 30_000 })
  await expect(locDocs.getByText('施工日誌・已套用')).toBeVisible()
  await expect(locDocs.getByText('自主檢查表・已套用')).toBeVisible()

  docs = await docsOf()
  expect(docs.daily_log.current_version_no).toBe(2)
  expect(docs.self_check.current_version_no).toBe(2)
  const dlV2 = await verOf(dl, 2)
  const scV2 = await verOf(sc, 2)
  const key = dlV2.field_sources[`items.${wi.id}.location`].source.slice('shared:'.length)
  expect(key).toMatch(new RegExp(`^location:\\d{4}-\\d{2}-\\d{2}:${wi.id}$`))
  for (const [v, path, value] of [[dlV2, `items.${wi.id}.location`, dlV2.content.items[wi.id].location], [scV2, 'location', scV2.content.location]]) {
    expect(value).toBe('A區 3F 版牆')
    expect(v).toMatchObject({ author_kind: 'human', created_by: conId })
    expect(v.field_sources[path]).toMatchObject({ status: 'confirmed', source: `shared:${key}`, confirmed_by: conId })
    expect(v.content_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(v.change_note).toBe(`共用補值:施作位置・二 結構工程・${key.split(':')[1]}`)
  }
  expect(dlV2.attachments).toEqual(dlV1.attachments) // 附件原樣(角色隔離不因補值改變)

  // ── 補當日數量:只有施工日誌用到 ───────────────────────────────────────────────────
  const qtyInput = shared.getByRole('spinbutton', { name: /當日完成數量・二 結構工程/ })
  await qtyInput.fill('12.5')
  await qtyInput.locator('xpath=ancestor::li[1]').getByRole('button', { name: '套用' }).click()
  await expect(shared.getByText('已更新 1 份（施工日誌 版本 3）')).toBeVisible({ timeout: 30_000 })
  expect((await verOf(dl, 3)).content.items[wi.id].qty_today).toBe(12.5)
  expect((await docsOf()).self_check.current_version_no).toBe(2)

  // ── 簽署自主檢查表(RPC:填 B1 並確認 → 簽署;頁面流程由 chain 8 覆蓋) ────────────────────────
  const { data: s3, error: s3Err } = await con.rpc('save_field_document_version', {
    p_document_id: sc, p_base_version_no: 2, p_content: { ...scV2.content, results: { B1: { value: true } } },
    p_field_sources: { ...scV2.field_sources, 'results.B1': { status: 'confirmed', source: 'human' } }, p_attachments: scV2.attachments,
  })
  if (s3Err) throw new Error(`自檢表存版失敗:${s3Err.message}`)
  expect(s3.status).toBe('draft')
  const { data: g3, error: g3Err } = await con.rpc('sign_field_document', { p_document_id: sc, p_version_no: 3, p_content_hash: s3.content_hash, p_intent: '本人確認自主檢查表內容' })
  if (g3Err) throw new Error(`自檢表簽署失敗:${g3Err.message}`)
  expect(g3.status).toBe('signed')

  // ── 重新整理(手機寬 375):從「上傳批次」接續,再補另一個位置 → 施工日誌更新、已簽署自檢表不動 ─────────
  await page.setViewportSize({ width: 375, height: 812 })
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: '現場紀錄' })).toBeVisible()
  const batches = page.getByRole('group', { name: '上傳批次' })
  await batches.getByRole('button', { name: /的照片/ }).first().click()
  const shared2 = batches.getByRole('group', { name: '一次補齊' })
  await expect(shared2).toBeVisible({ timeout: 30_000 })
  const locDocs2 = shared2.getByRole('list', { name: '施作位置・二 結構工程 影響的文件' })
  await expect(locDocs2.getByText('自主檢查表・已簽署，不受影響')).toBeVisible()
  await expect(locDocs2.getByText('施工日誌・已套用')).toBeVisible()
  const locInput2 = shared2.getByRole('textbox', { name: '施作位置・二 結構工程' })
  await expect(locInput2).toHaveValue('A區 3F 版牆')
  await locInput2.fill('B區 2F 版牆')
  await locInput2.locator('xpath=ancestor::li[1]').getByRole('button', { name: '套用' }).click()
  await expect(shared2.getByText('已更新 1 份（施工日誌 版本 4）；1 份已簽署或提送，未變更')).toBeVisible({ timeout: 30_000 })
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    if (doc.scrollWidth <= doc.clientWidth) return null
    return [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 8).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`)
  })
  expect(overflow, '375 寬度不得水平溢位').toBeNull()
  const applyBox = await locInput2.locator('xpath=ancestor::li[1]').getByRole('button', { name: '套用' }).boundingBox()
  expect(applyBox.height).toBeGreaterThanOrEqual(44) // 手機觸控目標

  docs = await docsOf()
  expect(docs.daily_log.current_version_no).toBe(4)
  expect((await verOf(dl, 4)).content.items[wi.id].location).toBe('B區 2F 版牆')
  expect(docs.self_check).toMatchObject({ status: 'signed', current_version_no: 3 })
  const scNow = await verOf(sc, 3)
  expect(scNow.content.location).toBe('A區 3F 版牆')
  expect(scNow.content_hash).toBe(s3.content_hash)
  const { count: scVersions } = await con.from('field_document_versions').select('id', { count: 'exact', head: true }).eq('document_id', sc)
  expect(scVersions).toBe(3)
  const { data: rec } = await con.from('checklist_records').select('location').eq('id', g3.target_id).single()
  expect(rec.location).toBe('A區 3F 版牆') // 簽署落下的事實列保留簽署當時的位置

  // ── 同值重送:畫面按鈕不可按;RPC 直打也不產生版本(冪等) ─────────────────────────────────
  await expect(locInput2.locator('xpath=ancestor::li[1]').getByRole('button', { name: '套用' })).toBeDisabled()
  const { data: intakes } = await con.from('photo_intakes').select('id, shared_inputs').eq('project_id', projectId)
  expect(intakes).toHaveLength(1)
  expect(intakes[0].shared_inputs[key]).toMatchObject({ value: 'B區 2F 版牆', set_by: conId })
  const { data: again, error: againErr } = await con.rpc('set_intake_shared_input', { p_intake_id: intakes[0].id, p_key: key, p_value: 'B區 2F 版牆' })
  if (againErr) throw new Error(`同值重送失敗:${againErr.message}`)
  expect(again.updated).toBe(0)
  expect(again.documents.map((d) => [d.doc_type, d.result])).toEqual([['daily_log', 'unchanged'], ['self_check', 'locked']])
  expect((await docsOf()).daily_log.current_version_no).toBe(4)

  // ── 補值不跨角色:監造對廠商批次補值 → PD006 ─────────────────────────────────────────
  const sup = await signInClient(supEmail)
  const { error: pd006 } = await sup.rpc('set_intake_shared_input', { p_intake_id: intakes[0].id, p_key: key, p_value: 'C區' })
  expect(pd006?.code).toBe('PD006')
  expect((await docsOf()).daily_log.current_version_no).toBe(4)
  await sup.auth.signOut()
  await con.auth.signOut()
})
