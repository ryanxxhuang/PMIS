// W6-4｜鏈 3:文件上傳 → Requirement → 人工核定 → 義務時程(真 Supabase)。
// 走 D-012 單向鏈的真路徑:上傳契約文件(Storage+documents)→ 待審 deadline
// Requirement → 監造在 /requirements 核定(review_requirement RPC,伺服器蓋
// 審查人)→ 核定當下單向物化 contract_obligations → /contract 義務時程出現。
// 廠商端負向斷言:非審查角色(contractor)看不到核定鈕(鏡像 can_review_requirement,
// 刻意無專案管理者例外)。
// 有 ANTHROPIC_API_KEY 時,必須另以 `supabase functions serve extract-requirements`
// 啟動本機 Edge runtime,本 spec 會要求 live AI 成功並驗 ingestion run/citation。
// 沒有 key 時仍可跑 deterministic 部分,但不得視為 W6-4 完整驗收。
import { test, expect } from '@playwright/test'
import {
  uniqueEmail, createConfirmedUser, cleanupUser, deleteOwnedProjects,
  signInClient, loginReal, logoutReal, gotoHash, runCleanup, findUserIdByEmail,
} from './helpers.js'

const PROJECT_NAME = `鏈3文件工程-${Date.now().toString(36)}`
const REQ_TITLE = `開工後提送品質計畫-${Date.now().toString(36)}`
const LIVE_EDGE = Boolean(process.env.ANTHROPIC_API_KEY?.trim())
// 兩條條款各有用途:第三條是無歧義的「純期限」(live 斷言錨點——完工是期限不是送審,
// 抽取器只可能給 deadline);第十條是「帶期限的送審義務」,抽取器合理地會歸類為
// submittal(2026-08-15 實測如此),所以不對它做型別斷言,只靠它讓文件更像真契約。
const DEADLINE_DATE = '2026-10-31'
const CONTRACT_TEXT = [
  '本契約甲方為機關、乙方為廠商。',
  '第三條 工程期限：乙方應於2026年10月31日前完成全部工程。',
  '第十條 品質計畫提送：乙方應於2026年9月30日前提送品質計畫送審，並取得監造單位核可後始得施工。',
].join('\n')
// 與 _shared/sourceVerify.ts normalizeSourceText 同義的測試側鏡像(NFKC+去零寬+去空白):
// 引文比對必須用引擎自己的正規化口徑——原始字串完全相等比 sourceVerify 的驗證條件
// 還嚴,模型只要把全形空白正規化就會假紅燈。spec 是 Node 端無法直接 import .ts,故鏡像。
const normalizeSource = (text) => String(text ?? '')
  .normalize('NFKC')
  .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, '')
  .replace(/\u00ad/g, '')
  .replace(/\s+/g, '')
// requirements.extract 的 min_plan='pro'(migration 20260728000100),create_project
// 預設 standard——不升級方案,openAiGate 會在模型呼叫前 403,live 驗收會被誤讀成
// 「AI 串接失敗」。唯一的產品窄門是 admin_set_project_plan(平台管理員限定),而平台
// 管理員只能來自 platform_admin_bootstrap 名單(migration 20260728000000 寫死一筆
// email)。在拋棄式 staging 用該 email 建測試帳號即自動成為平台管理員;真正式庫上
// 這個 email 已註冊,createUser 會大聲失敗——這本身就是「別對正式庫跑」的第二道閘。
const BOOTSTRAP_ADMIN_EMAIL = 'ryanxhuang1212@gmail.com'
const conEmail = uniqueEmail('w6c3-con')
const supEmail = uniqueEmail('w6c3-sup')
let conId, supId, adminId, adminCreatedHere, projectId

test.beforeAll(async () => {
  conId = await createConfirmedUser(conEmail, 'contractor', '鏈三廠商')
  supId = await createConfirmedUser(supEmail, 'supervisor', '鏈三監造')
  const c = await signInClient(conEmail)
  const { data: project, error: createError } = await c.rpc('create_project', {
    p_name: PROJECT_NAME, p_code: null, p_owner: '機關', p_contractor: '廠商',
    p_supervisor: '監造', p_location: null, p_start: null, p_end: null,
  })
  if (createError) throw new Error(`建案失敗:${createError.message}`)
  projectId = project.id
  const { error: invErr } = await c.rpc('add_member_by_email', {
    p_project: project.id, p_email: supEmail, p_role: 'member', p_expected_org: 'supervisor',
  })
  if (invErr) throw new Error(`邀請失敗:${invErr.message}`)
  await c.auth.signOut()
  if (LIVE_EDGE) {
    // 冪等:重跑或前次清理失敗時帳號可能已存在——存在就沿用,只清理本次建立的
    adminId = await findUserIdByEmail(BOOTSTRAP_ADMIN_EMAIL)
    adminCreatedHere = !adminId
    if (!adminId) adminId = await createConfirmedUser(BOOTSTRAP_ADMIN_EMAIL, 'owner', '鏈三平台管理員')
    const a = await signInClient(BOOTSTRAP_ADMIN_EMAIL)
    const { error: planErr } = await a.rpc('admin_set_project_plan', {
      p_project: projectId, p_plan: 'pro',
    })
    if (planErr) throw new Error(`升級測試專案方案失敗(平台管理員 bootstrap 沒生效?):${planErr.message}`)
    await a.auth.signOut()
  }
})

test.afterAll(async () => {
  await runCleanup(
    () => deleteOwnedProjects(conEmail),
    () => cleanupUser(conId),
    () => cleanupUser(supId),
    () => (adminCreatedHere && adminId ? cleanupUser(adminId) : undefined),
  )
})

test('鏈 3:上傳文件→待審 Requirement→監造核定→義務時程出現', async ({ page }) => {
  test.setTimeout(LIVE_EDGE ? 120_000 : 30_000)
  // ── 廠商:統一窗口上傳契約 txt(Storage+documents 真路徑)────────────────────
  await loginReal(page, conEmail)
  await gotoHash(page, '/contract')
  await expect(page.getByText('專案文件一次上傳')).toBeVisible()
  await expect(page.getByRole('option', { name: /我的施工契約/ })).toBeAttached()
  await page.locator('input[type="file"]').setInputFiles({
    name: '契約書.txt', mimeType: 'text/plain',
    buffer: Buffer.from(CONTRACT_TEXT, 'utf-8'),
  })
  await expect(page.getByText('契約書.txt').first()).toBeVisible({ timeout: 15_000 })

  const c = await signInClient(conEmail)
  let documentId = null
  await expect.poll(async () => {
    const { data } = await c.from('documents').select('id')
      .eq('project_id', projectId).eq('title', '契約書.txt').maybeSingle()
    documentId = data?.id || null
    return documentId
  }).not.toBeNull()
  const { data: version, error: versionErr } = await c.from('document_versions')
    .select('id').eq('document_id', documentId).single()
  if (versionErr) throw new Error(`找不到上傳文件版本:${versionErr.message}`)

  let requirementTitle = REQ_TITLE
  if (LIVE_EDGE) {
    let processingRun = null
    await expect.poll(async () => {
      const { data, error } = await c.from('document_processing_runs')
        .select('status,stage,error_message,metadata')
        .eq('document_version_id', version.id)
        .maybeSingle()
      if (error) throw new Error(`讀取文件處理狀態失敗:${error.message}`)
      processingRun = data
      return data?.status || null
    }, { timeout: 90_000 }).toMatch(/^(completed|partial|failed)$/)
    if (processingRun.status !== 'completed'
      || processingRun.metadata?.requirement_extraction !== 'completed') {
      // 客戶端只存 supabase-js 的泛化訊息;真正的失敗原因在伺服器端 ingestion run
      // 的 error_message(函式在 AI/schema 失敗時寫入)——一併撈出來,失敗才可診斷
      const { data: failedRun } = await c.from('document_ingestion_runs')
        .select('status,error_message')
        .eq('document_version_id', version.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      throw new Error(
        `文件沒有完成 live Requirement 抽取:status=${processingRun.status},`
        + `stage=${processingRun.stage},extraction=${processingRun.metadata?.requirement_extraction || 'missing'},`
        + `client_error=${processingRun.error_message || processingRun.metadata?.requirement_extraction_message || 'none'},`
        + `ingestion_run=${failedRun ? `${failedRun.status}:${failedRun.error_message || 'no message'}` : '不存在(可能在建 run 之前就失敗,如閘門 403)'}`,
      )
    }

    // 真 Edge 成功條件:同一文件版本的 ingestion run 完成,AI 產生帶固定期限的
    // deadline Requirement,且 citation 真正指向該 document_version。
    let run = null
    await expect.poll(async () => {
      const { data, error } = await c.from('document_ingestion_runs')
        .select('id,status,error_message')
        .eq('document_version_id', version.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(`讀取 ingestion run 失敗:${error.message}`)
      if (data?.status === 'failed') throw new Error(`live Edge 抽取失敗:${data.error_message}`)
      run = data
      return data?.status || null
    }, { timeout: 90_000 }).toBe('completed')

    const { data: suggestions, error: suggestionErr } = await c.from('requirements')
      .select('id,title,origin,status,requirement_type,trigger_type,trigger_config,ingestion_run_id')
      .eq('ingestion_run_id', run.id)
      .eq('origin', 'ai')
    if (suggestionErr) throw new Error(`讀取 AI Requirement 失敗:${suggestionErr.message}`)
    const requirement = (suggestions || []).find((row) =>
      row.requirement_type === 'deadline'
      && row.trigger_type === 'fixed'
      && row.trigger_config?.fixed_date === DEADLINE_DATE)
    if (!requirement) {
      // 模型輸出非決定性:失敗時把實際產出與 run metadata(模型回了幾筆、
      // 幾筆被確定性驗證拒絕、拒絕原因)攤開,才能分辨是「抽取品質問題」
      // 還是「斷言過嚴」——不看內容就重試只會白燒 token
      const dump = (suggestions || []).map((r) =>
        `[${r.requirement_type}/${r.trigger_type || 'no-trigger'}] ${r.title} ${JSON.stringify(r.trigger_config || {})}`).join('；')
      const { data: runRow } = await c.from('document_ingestion_runs')
        .select('extracted_requirement_count,metadata').eq('id', run.id).maybeSingle()
      throw new Error(
        `live AI 沒有產生契約明載的 ${DEADLINE_DATE} 固定期限 Requirement。`
        + `落庫 ${suggestions?.length || 0} 筆:${dump || '(空)'};`
        + `run metadata=${JSON.stringify(runRow?.metadata || {})}`,
      )
    }
    expect(['draft_ai', 'needs_review']).toContain(requirement.status)

    const { data: source, error: sourceErr } = await c.from('requirement_sources')
      .select('source_kind,document_version_id,source_text')
      .eq('requirement_id', requirement.id)
      .eq('document_version_id', version.id)
      .maybeSingle()
    if (sourceErr) throw new Error(`讀取 AI citation 失敗:${sourceErr.message}`)
    expect(source?.source_kind).toBe('document')
    expect(source?.source_text).toBeTruthy()
    // 用 sourceVerify 的正規化口徑比對:引文必須真的出自契約原文(防捏造),
    // 但允許空白/全形寬度差異(那是引擎自己也容忍的正規化範圍)
    expect(normalizeSource(CONTRACT_TEXT)).toContain(normalizeSource(source.source_text))
    requirementTitle = requirement.title
  } else {
    // 無 key 時只驗 deterministic 部分。fixture 必須在真上傳後建立並引用該
    // document_version；不能用一筆與文件無關的 Requirement 偽裝整條鏈已串起來。
    const { data: requirement, error: reqErr } = await c.from('requirements').insert({
      project_id: projectId, title: REQ_TITLE,
      description: '依契約規定於固定期限前提送品質計畫送審。',
      requirement_type: 'deadline', responsible_party_type: 'contractor',
      lifecycle_phase: '開工前', trigger_type: 'fixed',
      trigger_config: { fixed_date: DEADLINE_DATE },
      status: 'needs_review', origin: 'manual',
    }).select('id').single()
    if (reqErr) throw new Error(`建立待審 Requirement 失敗:${reqErr.message}`)
    const { error: sourceErr } = await c.from('requirement_sources').insert({
      requirement_id: requirement.id, document_version_id: version.id,
      source_kind: 'document', source_verified: false,
      source_text: '乙方應於2026年10月31日前完成全部工程',
    })
    if (sourceErr) throw new Error(`建立 Requirement 文件來源失敗:${sourceErr.message}`)
  }
  await c.auth.signOut()

  // ── 廠商在 /requirements(W8-3B 契約重點版面)看得到整理結果,但沒有任何核定
  //    動作——非審查角色只有「查看」與責任方說明,不渲染假操作 ──────────────
  await gotoHash(page, '/requirements')
  await expect(page.getByText(requirementTitle).first()).toBeVisible()
  await expect(page.getByText('契約核定由監造／機關辦理').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /核定/ })).toHaveCount(0)
  await logoutReal(page)

  // ── 監造:用契約重點的期限捷徑「核定並加入期限追蹤」(仍走 review_requirement
  //    RPC,伺服器蓋審查人;核定當下 D-012 單向物化義務)。deterministic fixture
  //    是 manual origin、live 是已核對來源的 AI deadline,兩者都符合捷徑資格。──
  await loginReal(page, supEmail)
  await gotoHash(page, '/requirements')
  const suggestionRow = page.getByText(requirementTitle).first()
    .locator('xpath=ancestor::div[contains(@class,"py-3.5")][1]')
  await suggestionRow.getByRole('button', { name: '核定並加入期限追蹤' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '核定並加入期限追蹤' }).click()
  // 核定成功=詳情卡出現僅 approved 才有的「廢止取代」(quickApprove 會先選取該筆)
  await expect(page.getByRole('button', { name: '廢止取代' })).toBeVisible()
  // ── 義務時程出現同標題(D-012 相容 runtime),狀態待辦、到期日=固定日 ───────
  await gotoHash(page, '/contract')
  await expect(page.getByText(requirementTitle).first()).toBeVisible()
  await expect(page.getByText(DEADLINE_DATE).first()).toBeVisible()
})
