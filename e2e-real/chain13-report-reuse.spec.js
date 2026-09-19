// P6a｜鏈 13:施工月報／監造月報／估驗佐證包只重用「已簽署」資料(真 Supabase,正式模式;不需 Edge stub)。
//   佈置全走產品 RPC／RLS 窄門(簽署流程 UI 已由 chain 5／6／8／10 走過):
//   廠商:施工日誌 d1(10 M3)、d2(20 M3)簽署,d3(999 M3)只存版不簽 → 自主檢查表簽署 → 查驗申請(申報 100、檢附自檢)
//   → 監造:上傳一張監造照片、監造查驗表單判部分合格確認 60(附照片為證據)簽署、d2 監造日誌(到場已確認)簽署、
//     d3 直接寫一列未簽署的監造日誌事實列 → 廠商:建第 1 期(截止日=月底)、同步確認量 60、送監造審核
//   → 送審後廠商更正 d1 為 15 M3 並重簽 v2(事實列變 15;已提送的佐證包仍須是送審當時的 v1 的 10)。
//   驗:廠商施工月報只彙整 d1(v2)＋d2＝35、d3 列「未簽署、不列入」、每份附版本;監造月報(標題取 navConfig)列已簽署監造日誌
//   與查驗表單判定／確認量(附版本)、未簽署監造日誌不列入;佐證包列本期確認來源(查驗表單版本雜湊、檢附自檢、附件照片)、
//   施工日誌取送審時點的版本(d1 v1＝10、標「之後另有 v2」)、d3 送審時未簽署不列入。
//   帳號全部本次產生;afterAll 以建立者 delete_project＋admin API 清帳號,殘留 0。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects, signInClient, loginReal, logoutReal, gotoHash, runCleanup, tinyJpeg,
} from './helpers.js'

const PROJECT_NAME = `鏈13月報重用-${Date.now().toString(36)}`
const conEmail = uniqueEmail('p6a13-con')
const supEmail = uniqueEmail('p6a13-sup')
const BOQ_ITEMS = [
  { item_key: '1', parent_key: null, item_no: '壹', description: '第一章', is_rollup: false, is_leaf: false, is_billable: true, sort_order: 1, depth: 1 },
  { item_key: '1.1', parent_key: '1', item_no: '一', description: '結構工程', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_leaf: true, is_billable: true, sort_order: 2, depth: 2 },
]
const TEMPLATE_ITEMS = [{ no: 'B1', group: '澆置前', item: '澆置 24 小時前已通知監造', kind: 'bool', standard: '≥24 小時前通知' }]
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
const month = today.slice(0, 7)
const [d1, d2, d3] = ['01', '02', '03'].map((d) => `${month}-${d}`)
const monthEnd = (() => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) })()
const OK = { status: 'confirmed', source: 'human' }
const s = {} // 佈置結果(文件 id、版本雜湊…)

async function must(label, p) {
  const { data, error } = await p
  if (error) throw new Error(`${label}失敗:${error.message}`)
  return data
}
const dailyContent = (date, qty, labor, weatherAm, weatherPm, summary) => ({
  log_date: date, weather_am: weatherAm, weather_pm: weatherPm, labor, equipment: [], materials: [], extras: {}, work_summary: summary,
  items: { [s.workItemId]: { item_key: '1.1', item_no: '一', description: '結構工程', unit: 'M3', qty_today: qty, location: '3F 版牆', note: null } },
  photo_ids: [], unmatched_photo_ids: [],
})
const dailySources = () => ({
  log_date: OK, weather_am: OK, weather_pm: OK, work_summary: OK, labor: OK,
  equipment: { status: 'na', source: null, reason: '本日無機具' }, materials: { status: 'na', source: null, reason: '本日無進料' },
  [`items.${s.workItemId}.qty_today`]: OK,
})
async function newDoc(client, docType, date, extra = {}) {
  return must(`建${docType}`, client.from('field_documents').insert({ id: crypto.randomUUID(), project_id: s.projectId, doc_type: docType, doc_date: date, ...extra }).select('id, current_version_no').single())
}
async function saveAndSign(client, docId, base, content, sources, { attachments = null, changeNote = null, sign = true } = {}) {
  const saved = await must('存版', client.rpc('save_field_document_version', { p_document_id: docId, p_base_version_no: base, p_content: content, p_field_sources: sources, p_attachments: attachments, p_change_note: changeNote }))
  if (sign) await must('簽署', client.rpc('sign_field_document', { p_document_id: docId, p_version_no: saved.version_no, p_content_hash: saved.content_hash, p_intent: '本人確認內容無誤並簽署' }))
  return saved
}

test.beforeAll(async () => {
  s.conId = await createConfirmedUser(conEmail, 'contractor', '鏈十三廠商')
  s.supId = await createConfirmedUser(supEmail, 'supervisor', '鏈十三監造')
  const con = await signInClient(conEmail)
  const project = await must('建案', con.rpc('create_project', { p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商', p_supervisor: '監造', p_location: null, p_start: null, p_end: null }))
  s.projectId = project.id
  await must('匯標單', con.rpc('import_work_items', { p_project_id: s.projectId, p_items: BOQ_ITEMS }))
  s.workItemId = (await must('讀工項', con.from('work_items').select('id').eq('project_id', s.projectId).eq('item_key', '1.1').single())).id
  await must('邀請監造', con.rpc('add_member_by_email', { p_project: s.projectId, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor' }))
  const tpl = await must('建範本', con.from('checklist_templates').insert({ project_id: s.projectId, title: '結構混凝土自主檢查表', source: '03310', items: TEMPLATE_ITEMS }).select('id').single())
  const fm = await must('正式模式', con.from('projects').update({ formal_mode: true }).eq('id', s.projectId).select('id'))
  if (!fm.length) throw new Error('開啟正式模式失敗:RLS 未生效')

  // ── 廠商:施工日誌 d1、d2 簽署;d3 只存版(未簽署) ─────────────────────────────────────
  const doc1 = await newDoc(con, 'daily_log', d1)
  s.d1 = { id: doc1.id, v1: await saveAndSign(con, doc1.id, 0, dailyContent(d1, 10, [{ type: '鋼筋工', count: 6 }], '晴', '晴', '3F 版牆鋼筋綁紮'), dailySources()) }
  const doc2 = await newDoc(con, 'daily_log', d2)
  s.d2 = { id: doc2.id, v1: await saveAndSign(con, doc2.id, 0, dailyContent(d2, 20, [{ type: '鋼筋工', count: 4 }, { type: '模板工', count: 2 }], '晴', '陣雨', '3F 版牆混凝土澆置'), dailySources()) }
  const doc3 = await newDoc(con, 'daily_log', d3)
  s.d3 = { id: doc3.id, v1: await saveAndSign(con, doc3.id, 0, dailyContent(d3, 999, [{ type: '雜工', count: 9 }], '雨', '雨', '未簽署內容'), dailySources(), { sign: false }) }

  // ── 廠商:自主檢查表簽署 → 查驗申請(申報 100、檢附自檢)──────────────────────────────────
  const sc = await newDoc(con, 'self_check', d2, { template_id: tpl.id })
  const scContent = { check_date: d2, template_id: tpl.id, template_title: '結構混凝土自主檢查表', template_source: '03310', work_item_id: s.workItemId, location: '3F 版牆', results: { B1: { value: true } }, note: null, template: { key: 'self_check_demo', version: 1 }, photo_ids: [], unmatched_photo_ids: [] }
  const scSources = { check_date: OK, template_id: OK, work_item_id: OK, location: OK, 'results.B1': OK }
  const scSaved = await must('自檢表存版', con.rpc('save_field_document_version', { p_document_id: sc.id, p_base_version_no: 0, p_content: scContent, p_field_sources: scSources, p_attachments: null }))
  const scSigned = await must('自檢表簽署', con.rpc('sign_field_document', { p_document_id: sc.id, p_version_no: 1, p_content_hash: scSaved.content_hash, p_intent: '簽' }))
  s.recordId = scSigned.target_id
  s.scDocId = sc.id
  const insp = await must('查驗申請', con.from('inspections').insert({
    project_id: s.projectId, work_item_id: s.workItemId, title: '3F 版牆混凝土查驗', location: '3F 版牆', inspection_type: '施工查驗',
    requested_date: d2, declared_qty: 100, checklist_record_id: s.recordId, requested_by: s.conId, status: '待查驗',
  }).select('id').single())
  s.inspectionId = insp.id

  // ── 監造:照片 → 查驗表單(部分合格、確認 60、照片為證據)簽署 → d2 監造日誌簽署 → d3 未簽署事實列 ─────────
  const sup = await signInClient(supEmail)
  s.photoId = crypto.randomUUID()
  const path = `${s.projectId}/p6a/${s.photoId}.jpg`
  const { error: upErr } = await sup.storage.from('photos').upload(path, tinyJpeg('p6a-13'), { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw new Error(`上傳照片失敗:${upErr.message}`)
  await must('照片列', sup.from('photos').insert({ id: s.photoId, project_id: s.projectId, daily_log_id: null, work_item_id: null, storage_path: path, caption: '3F 版牆澆置查驗', location: '3F 版牆', taken_at: new Date().toISOString(), uploaded_by: s.supId }))
  const form = await must('建查驗表單', sup.rpc('create_inspection_form_draft', { p_inspection_id: s.inspectionId }))
  const formContent = {
    inspection_date: today, inspection_id: s.inspectionId, inspection_title: '3F 版牆混凝土查驗', work_item_id: s.workItemId, location: '3F 版牆', stage_key: null,
    unit: 'M3', declared_qty: 100, self_check_record_id: s.recordId, template_id: null, template_title: null, results: {},
    verdict: '部分合格', confirmed_qty: 60, result_note: '東側 40 M3 蜂窩待修補', note: null,
    template: { key: 'inspection_form_demo', version: 1 }, photo_ids: [s.photoId], unmatched_photo_ids: [],
  }
  const formSources = { inspection_date: OK, inspection_id: OK, work_item_id: OK, location: OK, unit: OK, declared_qty: OK, self_check_record_id: OK, verdict: OK, confirmed_qty: OK, result_note: OK }
  s.form = { id: form.id, v: await saveAndSign(sup, form.id, form.current_version_no ?? 0, formContent, formSources, { attachments: [{ photo_id: s.photoId, role: 'evidence' }] }) }
  const sl = await newDoc(sup, 'supervisor_log', d2)
  const slContent = {
    log_date: d2, weather_am: '晴', weather_pm: '陣雨',
    attendance: [{ user_id: s.supId, name: '鏈十三監造', from: '09:00', to: '12:00' }],
    supervision_items: [{ time: '10:00', item: '3F 版牆混凝土查驗', location: '3F 版牆', work_item_id: s.workItemId, note: null, source: 'human', photo_ids: [] }],
    inspection_ids: [s.inspectionId], notices: [], followups: [], contractor_summary: '廠商 3F 版牆混凝土澆置', daily_log_receipt: null, note: null,
    template: { key: 'supervisor_log_demo', version: 1 }, photo_ids: [], unmatched_photo_ids: [],
  }
  const slSources = { log_date: OK, weather_am: OK, weather_pm: OK, attendance: OK, supervision_items: OK, inspection_ids: OK, contractor_summary: OK }
  s.sl = { id: sl.id, v: await saveAndSign(sup, sl.id, 0, slContent, slSources) }
  // 未經文件、直接寫入的監造日誌事實列(RLS 允許監造寫;沒有任何簽署列指向)→ 監造月報「未簽署、不列入」
  await must('未簽署監造日誌列', sup.from('supervisor_logs').insert({ project_id: s.projectId, log_date: d3, weather_am: '雨', weather_pm: '雨' }))
  await sup.auth.signOut()

  // ── 廠商:第 1 期(截止日=月底)、同步確認量 60、送監造審核;送審後更正 d1 為 15 並重簽 v2 ──────────────
  s.valuationId = crypto.randomUUID()
  await must('建估驗期', con.from('valuations').insert({ id: s.valuationId, project_id: s.projectId, period_no: 1, valuation_date: today, period_end: monthEnd, retention_pct: 5, status: '草稿', created_by: s.conId }))
  await must('同步確認量', con.rpc('sync_valuation_from_confirmations', { p_valuation_id: s.valuationId }))
  const tr = await must('送審', con.rpc('transition_valuation', { p_valuation_id: s.valuationId, p_from: '草稿', p_to: '監造審核', p_note: null }))
  if (!tr.applied) throw new Error(`送審未套用:${JSON.stringify(tr)}`)
  s.d1.v2 = await saveAndSign(con, s.d1.id, 1, dailyContent(d1, 15, [{ type: '鋼筋工', count: 6 }], '晴', '晴', '3F 版牆鋼筋綁紮(數量更正)'), dailySources(), { changeNote: '複核數量更正為 15 M3' })
  await con.auth.signOut()
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(s.conId),
    () => cleanupUser(s.supId),
  )
})

const tag = (id, v, hash) => `文件 ${String(id).slice(0, 8)} v${v}・雜湊 ${String(hash).slice(0, 12)}`

test('鏈 13:兩份簽署日誌＋一份未簽署 → 月報只彙整兩份;監造月報列已簽署監造日誌與查驗確認;佐證包列本期確認來源版本且保留送審當時版本', async ({ page }) => {
  test.setTimeout(240_000)
  // DB 事實:d1 事實列已是送審後的 v2(15);d3 沒有事實列(未簽署);確認紀錄 60 指向查驗表單版本
  const sup = await signInClient(supEmail)
  const { data: facts } = await sup.from('daily_logs').select('log_date, status').eq('project_id', s.projectId).order('log_date')
  expect(facts.map((f) => f.log_date)).toEqual([d1, d2])
  const { data: confs } = await sup.from('inspection_confirmations').select('qty_cum, document_id, document_version_no, content_hash, status').eq('project_id', s.projectId)
  expect(confs).toEqual([expect.objectContaining({ qty_cum: 60, document_id: s.form.id, document_version_no: s.form.v.version_no, content_hash: s.form.v.content_hash, status: 'active' })])
  await sup.auth.signOut()

  // ── 廠商:施工月報(本月)──────────────────────────────────────────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/monthly-report')
  await expect(page.getByRole('heading', { level: 1, name: '施工月報' })).toBeVisible()
  const signedLogs = page.getByRole('list', { name: '已簽署施工日誌' })
  await expect(signedLogs.getByRole('listitem')).toHaveCount(2, { timeout: 30_000 })
  await expect(signedLogs).toContainText(tag(s.d1.id, 2, s.d1.v2.content_hash)) // d1 目前的簽署版本 v2
  await expect(signedLogs).toContainText(tag(s.d2.id, 1, s.d2.v1.content_hash))
  await expect(page.getByText('施工天數（已簽署日誌）：2 天')).toBeVisible()
  await expect(page.getByText('雨天：1 天')).toBeVisible()
  await expect(page.getByText('出工合計：12 人・日')).toBeVisible()
  const row = page.getByRole('row', { name: /結構工程/ })
  await expect(row).toContainText('35') // 15＋20;d3 的 999 未簽署不列入
  await expect(page.getByText('999')).toHaveCount(0)
  await expect(page.getByRole('note', { name: '未簽署、不列入' })).toContainText(`${d3}（草稿）`)
  await expect(page.getByText('簽署表單判定 合格 / 部分合格 / 不合格：0 / 1 / 0')).toBeVisible()
  await logoutReal(page)

  // ── 監造:監造月報(標題取 navConfig)──────────────────────────────────────────────────
  await loginReal(page, supEmail)
  await gotoHash(page, '/supervisor-report')
  await expect(page.getByRole('heading', { level: 1, name: '監造月報' })).toBeVisible()
  const supLogs = page.getByRole('list', { name: '已簽署監造日誌' })
  await expect(supLogs.getByRole('listitem')).toHaveCount(1, { timeout: 30_000 })
  await expect(supLogs).toContainText('到場 鏈十三監造')
  await expect(supLogs).toContainText(tag(s.sl.id, s.sl.v.version_no, s.sl.v.content_hash))
  await expect(page.getByRole('note', { name: '未簽署監造日誌' })).toContainText(`${d3}（未經文件簽署）`)
  const judged = page.getByRole('list', { name: '已簽署查驗表單判定' })
  await expect(judged).toContainText('3F 版牆混凝土查驗')
  await expect(judged).toContainText('部分合格')
  await expect(judged).toContainText('申報 100／確認 60 M3')
  await expect(judged).toContainText(tag(s.form.id, s.form.v.version_no, s.form.v.content_hash))
  const conf = page.getByRole('list', { name: '本月監造確認紀錄' })
  await expect(conf).toContainText('一 結構工程・批次 3F 版牆')
  await expect(conf).toContainText('+60 M3（累計 60）')
  await expect(page.getByText('本月已簽署施工日誌 2 日（雨天 1 日）；另 1 日未簽署、不列入')).toBeVisible() // d3 草稿:與施工月報同一條
  await expect(page.getByRole('textbox', { name: '監造意見與建議' })).toHaveValue(/本月已簽署監造日誌 1 份（監造到場 1 日），另 1 份未簽署、不列入/)

  // ── 監造:估驗佐證包(第 1 期已送審)───────────────────────────────────────────────────
  await gotoHash(page, `/valuation/package?p=${s.valuationId}`)
  const src = page.getByRole('list', { name: '本期確認來源' })
  await expect(src).toContainText('監造確認 60 M3', { timeout: 30_000 })
  await expect(src).toContainText('批次 3F 版牆')
  await expect(src).toContainText(tag(s.form.id, s.form.v.version_no, s.form.v.content_hash))
  await expect(src).toContainText('3F 版牆混凝土查驗（部分合格）')
  await expect(src).toContainText('簽署 鏈十三監造')
  await expect(src).toContainText(`檢附自主檢查：${d2} Rev.0（合格）`)
  await expect(page.locator('figure')).toHaveCount(1) // 只有簽署查驗表單的證據照片
  await expect(page.getByText(/本期已送審：施工日誌取送審時點（.+）以前已簽署的版本/)).toBeVisible()
  const logTable = page.getByRole('table').filter({ hasText: '簽署版本' })
  const r1 = logTable.getByRole('row', { name: new RegExp(d1) })
  await expect(r1).toContainText('10 M3') // 送審當時的 v1,不是送審後更正的 15
  await expect(r1).toContainText(tag(s.d1.id, 1, s.d1.v1.content_hash))
  await expect(r1).toContainText('之後另有 v2')
  await expect(logTable.getByRole('row', { name: new RegExp(d2) })).toContainText('20 M3')
  await expect(page.getByText(`本期範圍內另有 1 日的施工日誌送審時尚未簽署，不列入（${d3}）。`)).toBeVisible()
  await expect(page.getByText('999')).toHaveCount(0)
})
