// Supabase Edge Function: extract-requirements
// ---------------------------------------------------------------------------
// P0-06 traceable AI requirement extraction. Input is an already-persisted,
// immutable document version whose page text lives in document_pages; output
// is draft_ai / needs_review Requirement suggestions linked to a
// document_ingestion_run. The AI never approves anything and never decides
// source_verified - citation verification is deterministic (sourceVerify.ts)
// against the stored page text.
//
// 部署:supabase functions deploy extract-requirements
// verify_jwt 預設開啟(擋匿名);函式內再驗:getUser() + RLS 讀取文件版本
// (證明呼叫者看得到這個版本)+ can_manage_documents RPC(文件管理權限)。
// project_id 一律以 DB 解出的為準,request body 只做交叉檢查。
// 寫入(requirements / requirement_sources / requirement_work_items /
// document_ingestion_runs)使用 service role:一般使用者對 runs 沒有任何寫入
// 權限(system-managed),對 requirements 的 RLS 寫入權限屬於審查角色。

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { claudeJson, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'
import { openAiGate, closeAiGate } from '../_shared/aiGate.ts'
import { normalizeSourceText, verifySuggestionSource } from '../_shared/sourceVerify.ts'
import {
  PROMPT_VERSION, REQUIREMENT_TYPES, RESPONSIBLE_PARTY_TYPES, LIFECYCLE_PHASES,
  TRIGGER_TYPES, OFFSET_DIRS, FREQUENCY_TYPES,
  buildWorkItemCatalog, mapWorkItemRefs, validateSuggestion, deterministicUuid,
  buildDocumentBatches, splitBatch, mergeUsage,
} from '../_shared/requirementExtraction.ts'
import type { BatchPage, UsageLike } from '../_shared/requirementExtraction.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Pages whose normalized text is shorter than this carry no verifiable
// content (scanned/image pages - OCR is out of scope for P0-06).
const MIN_PAGE_TEXT_LENGTH = 20
// W10 分批抽取:每批的輸入字元預算 × 批數上限 = 總預算(舊制單批 160k,長契約
// 後半本被截斷)。超過總預算的頁一樣會被丟棄,但一律寫進 run metadata 並回傳
// 給前端揭露 - never silently。
const BATCH_CHAR_BUDGET = 120_000
const MAX_BATCHES = 4
// Edge Function 有平台 wall-clock 上限;逼近前主動停批,把已完成的批次落庫、
// 標記 stopped_early,而不是被平台砍掉留下永遠 processing 的 run。
const TIME_BUDGET_MS = 100_000
// 超過這個時間還掛在 pending/processing 的 run 一定已經死了(單批呼叫逾時
// 120s + 重試,總長遠小於 10 分鐘)——每次啟動新解析時順手標記失敗,
// 讓前端不再顯示永遠轉圈的解析中。
const STALE_RUN_MS = 10 * 60_000
const WORK_ITEM_CATALOG_LIMIT = 300

const SOURCE_SCHEMA = {
  type: 'object',
  properties: {
    page_number: { type: 'number', description: '引註所在頁碼,必須是輸入中「=== 第 N 頁 ===」的 N;無可靠頁碼(段落文件)填 0' },
    section: { type: 'string', description: '章節,如「第五章」或「5.2」;沒有就空字串' },
    clause: { type: 'string', description: '條款編號,如 §12.4 或 第九條;沒有就空字串' },
    quotation: { type: 'string', description: '逐字引註文件原文(不可改寫、不可摘要、不可翻譯),20~80 字' },
  },
  required: ['page_number', 'section', 'clause', 'quotation'],
}

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '需求標題,20 字內' },
    description: { type: 'string', description: '需求內容的中立描述;沒有補充就空字串' },
    requirement_type: { type: 'string', enum: [...REQUIREMENT_TYPES], description: '需求類型' },
    responsible_party_type: { type: 'string', enum: ['', ...RESPONSIBLE_PARTY_TYPES], description: '負責方:agency=機關、supervisor=監造、contractor=施工廠商;不確定就空字串' },
    lifecycle_phase: { type: 'string', enum: ['', ...LIFECYCLE_PHASES], description: '適用階段;不確定就空字串' },
    trigger_type: { type: 'string', enum: ['', ...TRIGGER_TYPES], description: '期限觸發點(僅期限/週期義務適用);沒有就空字串' },
    trigger_config: {
      type: 'object',
      properties: {
        offset_days: { type: 'number', description: '期限天數(相對觸發點);不適用就 0' },
        offset_dir: { type: 'string', enum: [...OFFSET_DIRS], description: '之前或之後' },
        fixed_date: { type: 'string', description: 'trigger_type=fixed 時 YYYY-MM-DD;否則空字串' },
      },
      required: ['offset_days', 'offset_dir', 'fixed_date'],
    },
    frequency_type: { type: 'string', enum: ['', ...FREQUENCY_TYPES], description: '週期性;每月填 monthly,否則空字串' },
    frequency_config: {
      type: 'object',
      properties: { day: { type: 'number', description: '每月幾號;不適用就 0' } },
      required: ['day'],
    },
    acceptance_criteria: { type: 'string', description: '允收/合格標準(引規範數值);沒有就空字串' },
    evidence_requirement: { type: 'string', description: '應留存的佐證(紀錄/照片/報告/試驗單);沒有就空字串' },
    source: SOURCE_SCHEMA,
    confidence: { type: 'number', description: '這項需求確為文件義務的信心 0~1' },
    candidate_work_items: {
      type: 'array',
      items: { type: 'string' },
      description: '相關 BOQ 工項代號(只能用下方工項清單的 W 代號),最多 3 個;沒有就空陣列',
    },
  },
  required: ['title', 'description', 'requirement_type', 'responsible_party_type',
    'lifecycle_phase', 'trigger_type', 'trigger_config', 'frequency_type',
    'frequency_config', 'acceptance_criteria', 'evidence_requirement', 'source',
    'confidence', 'candidate_work_items'],
}

const SCHEMA = {
  type: 'object',
  properties: { requirements: { type: 'array', items: SUGGESTION_SCHEMA } },
  required: ['requirements'],
}

type PageRow = BatchPage

// 一批頁 → 模型輸入文字(批已依預算切好,這裡不再截斷)
function buildBatchText(pages: PageRow[], paginated: boolean) {
  return pages.map((p) => {
    const header = paginated
      ? `=== 第 ${p.page_number} 頁 ===`
      : `=== 段落 ${p.page_number}(此文件無可靠頁碼)===`
    return `${header}\n${p.extracted_text || ''}\n`
  }).join('\n')
}

function buildPrompt(opts: {
  title: string
  documentType: string
  paginated: boolean
  documentText: string
  catalogLines: string
  batchNote: string      // 分批時告知模型本段範圍,避免它以為整份文件只有這幾頁
}) {
  const pageRule = opts.paginated
    ? '每項的 source.page_number 必須是上方「=== 第 N 頁 ===」實際出現的 N,引註原文必須出現在該頁。'
    : '此文件沒有可靠頁碼:source.page_number 一律填 0,改以 section / clause 標明出處。'
  return (
    '以下是台灣公共工程專案文件的逐頁文字。\n' +
    `文件名稱:${opts.title}\n文件類型:${opts.documentType}\n` +
    (opts.batchNote ? `${opts.batchNote}\n` : '') + '\n' +
    '任務:通讀全文,抽出「可執行的履約需求」——必須提送/申報、應辦檢驗/試驗、應通知/會同/見證、' +
    '停留點(未查驗不得續作)、應留存的紀錄/照片/報告、期限與週期義務、允收標準、取樣/試驗頻率等。\n' +
    '不要把以下內容當成需求:一般背景說明、純名詞定義、目錄項目、沒有具體義務的敘述性文字。\n' +
    '每一項需求:\n' +
    '- source.quotation 必須是文件原文的逐字引註(不可改寫、不可摘要),20~80 字。\n' +
    `- ${pageRule}\n` +
    '- 各欄位只能使用列舉值;不確定的欄位留空字串或 0,不要臆測。\n' +
    '- 用中立語言描述義務本身;不要下違法、違約、疏失之類的定性判斷。\n' +
    '- candidate_work_items 只能引用下方工項清單的 W 代號(最多 3 個);沒有明確相關工項就回空陣列。\n\n' +
    (opts.catalogLines
      ? `=== 專案 BOQ 工項清單(代號 → 工項)===\n${opts.catalogLines}\n\n`
      : '=== 專案 BOQ 工項清單 ===\n(此專案尚無工項;candidate_work_items 一律回空陣列)\n\n') +
    `=== 文件內容 ===\n${opts.documentText}`
  )
}

async function failRun(
  service: SupabaseClient, runId: string, message: string,
  metadata: Record<string, unknown>,
) {
  await service.from('document_ingestion_runs').update({
    status: 'failed',
    completed_at: new Date().toISOString(),
    error_message: message.slice(0, 2000),
    metadata,
  }).eq('id', runId)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: '伺服器未設定 Supabase 環境變數' }, 500)
  }

  // 批 B 閘門:身分/成員資格/功能開關統一走 openAiGate(body.project_id 前端必帶;
  // 權威 project 仍由 DB 從文件版本解出,下方 cross-check 保證兩者一致——
  // 閘門判定不會套錯專案)。gate.userClient 沿用為本函式的 RLS-scoped client。
  const body = await req.json().catch(() => null)
  const gate = await openAiGate(req, { feature: 'requirements.extract', projectId: body?.project_id })
  if (!gate.ok) return gate.response
  const userClient = gate.userClient

  let service: SupabaseClient | null = null
  let runId: string | null = null
  try {
    const documentVersionId = body?.document_version_id
    if (typeof documentVersionId !== 'string' || !UUID_RE.test(documentVersionId)) {
      return json({ error: '缺少有效的 document_version_id' }, 400)
    }

    // RLS-scoped read proves the caller can see this version and pins the
    // project server-side; project_id from the body is only cross-checked.
    const { data: version, error: versionError } = await userClient
      .from('document_versions')
      .select('id, document_id, documents!inner(id, project_id, title, document_type)')
      .eq('id', documentVersionId)
      .maybeSingle()
    if (versionError) return json({ error: versionError.message }, 500)
    if (!version) return json({ error: '找不到文件版本或無權限' }, 404)
    const doc = version.documents as unknown as {
      id: string; project_id: string; title: string; document_type: string
    }
    const projectId = doc.project_id
    if (body?.project_id && body.project_id !== projectId) {
      return json({ error: '文件版本不屬於指定專案' }, 403)
    }

    const { data: canManage, error: permError } =
      await userClient.rpc('can_manage_documents', { p: projectId })
    if (permError) return json({ error: permError.message }, 500)
    if (canManage !== true) return json({ error: '無文件管理權限,不可啟動 AI 需求擷取' }, 403)

    // -- Load stored page text (RLS-scoped) -----------------------------------
    const { data: pages, error: pagesError } = await userClient
      .from('document_pages')
      .select('page_number, extracted_text, extraction_method')
      .eq('document_version_id', documentVersionId)
      .order('page_number')
    if (pagesError) return json({ error: pagesError.message }, 500)
    const pageRows = (pages ?? []) as PageRow[]

    // -- Start the traceability run (service role, system-managed table) ------
    service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // W10 卡死補償:程序被平台砍掉(wall-clock、crash)時 run 會永遠停在
    // pending/processing,而 review_requirement 只准核定 completed run 的建議
    // ——整批建議跟著卡死。每次啟動新解析時把本專案明顯過期的 run 標記失敗;
    // best-effort,失敗不擋主流程。
    const staleCutoff = new Date(Date.now() - STALE_RUN_MS).toISOString()
    await service.from('document_ingestion_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: '解析逾時未完成,系統自動標記失敗;可重新啟動解析',
      })
      .eq('project_id', projectId)
      .in('status', ['pending', 'processing'])
      .lt('started_at', staleCutoff)

    // 同一版本仍有未過期的進行中 run:擋掉重複啟動(重複解析=重複建議+重複燒錢)
    const { data: activeRun } = await service.from('document_ingestion_runs')
      .select('id')
      .eq('document_version_id', documentVersionId)
      .in('status', ['pending', 'processing'])
      .gte('started_at', staleCutoff)
      .limit(1)
      .maybeSingle()
    if (activeRun) {
      return json({ error: '這份文件已在解析中,請等它完成或失敗後再試', run_id: activeRun.id }, 409)
    }

    const { data: run, error: runError } = await service
      .from('document_ingestion_runs')
      .insert({
        project_id: projectId,
        document_version_id: documentVersionId,
        run_type: 'requirement_extraction',
        status: 'processing',
        model_provider: 'anthropic',
        model_name: MODELS.smart,
        prompt_version: PROMPT_VERSION,
        started_by: gate.userId,
        input_page_count: pageRows.length,
      })
      .select('id')
      .single()
    if (runError) return json({ error: runError.message }, 500)
    runId = run.id as string

    const paginated = pageRows.length > 0 &&
      pageRows.every((p) => p.extraction_method === 'pdf_text')
    const emptyPageNumbers = pageRows
      .filter((p) => normalizeSourceText(p.extracted_text).length < MIN_PAGE_TEXT_LENGTH)
      .map((p) => p.page_number)

    if (!pageRows.length || emptyPageNumbers.length === pageRows.length) {
      const message =
        '文件沒有可用的已抽取文字(可能為掃描件或影像 PDF);P0-06 不含 OCR,無法建立可追溯的需求建議'
      await failRun(service, runId, message, {
        pagination: paginated ? 'paginated' : 'unpaginated',
        empty_page_numbers: emptyPageNumbers,
      })
      return json({ error: message, run_id: runId, status: 'failed' }, 422)
    }

    // -- Bounded BOQ catalog (identity fields only - never prices/costs) ------
    const { data: workItems, error: workItemsError } = await userClient
      .from('work_items')
      .select('id, item_no, description, is_leaf, is_rollup')
      .eq('project_id', projectId)
      .order('sort_order')
      .limit(2000)
    if (workItemsError) {
      await failRun(service, runId, workItemsError.message, {})
      return json({ error: workItemsError.message, run_id: runId, status: 'failed' }, 500)
    }
    const catalog = buildWorkItemCatalog(workItems ?? [], WORK_ITEM_CATALOG_LIMIT)
    const catalogLines = catalog.entries
      .map((e) => `${e.ref} ${e.item_no || '-'} ${e.description}`.slice(0, 120))
      .join('\n')

    // -- AI extraction in batches (page boundaries preserved) -----------------
    // 切批是確定性的(頁序、字元預算);每批抽完立刻落庫,中途死掉不會
    // 整包蒸發。引註驗證一律對全文件頁面查核,與批次邊界無關。
    const plan = buildDocumentBatches(pageRows, {
      batchCharBudget: BATCH_CHAR_BUDGET, maxBatches: MAX_BATCHES,
    })
    const totalBatches = plan.batches.length
    const startedAtMs = Date.now()

    let totalUsage: UsageLike = {}
    let usedModel: string | undefined
    let totalRequirements = 0
    let verifiedCount = 0
    let needsReviewCount = 0
    let rawItemCount = 0
    let workItemLinkCount = 0
    const rejected: { index: string; reason: string }[] = []
    const clippedBatches: string[] = []
    let failedBatch: { label: string; error: string } | null = null
    let batchesCompleted = 0
    let stoppedEarly = false

    // 驗證 + 引註查核 + 落庫一批模型輸出。identity 帶批次標籤
    // (`${runId}:${label}:…`),同一 run 內重試同一批 upsert 相同的列。
    const persistBatchItems = async (items: unknown[], label: string): Promise<string | null> => {
      const requirementRows: Record<string, unknown>[] = []
      const sourceRows: Record<string, unknown>[] = []
      const workItemRows: Record<string, unknown>[] = []
      for (let i = 0; i < items.length; i++) {
        const check = validateSuggestion(items[i])
        if (!check.ok) {
          rejected.push({ index: `${label}:${i}`, reason: check.reason })
          continue
        }
        const s = check.value
        const { verified, pageNumber } = verifySuggestionSource({
          source: s.source, pages: pageRows, paginated,
        })
        if (verified) verifiedCount++
        else needsReviewCount++
        const requirementId = await deterministicUuid(`${runId}:${label}:requirement:${i}`)
        requirementRows.push({
          id: requirementId,
          project_id: projectId,
          title: s.title,
          description: s.description,
          requirement_type: s.requirement_type,
          responsible_party_type: s.responsible_party_type,
          lifecycle_phase: s.lifecycle_phase,
          trigger_type: s.trigger_type,
          trigger_config: s.trigger_config,
          frequency_type: s.frequency_type,
          frequency_config: s.frequency_config,
          acceptance_criteria: s.acceptance_criteria,
          evidence_requirement: s.evidence_requirement,
          status: verified ? 'draft_ai' : 'needs_review',
          origin: 'ai',
          confidence: s.confidence,
          ingestion_run_id: runId,
        })
        sourceRows.push({
          id: await deterministicUuid(`${runId}:${label}:source:${i}`),
          requirement_id: requirementId,
          document_version_id: documentVersionId,
          source_kind: 'document',
          source_verified: verified,
          // pageNumber is null unless the claimed page exists in stored
          // document_pages - fabricated pages are never persisted.
          page_number: pageNumber,
          section: s.source.section,
          clause: s.source.clause,
          source_text: s.source.quotation,
        })
        for (const workItemId of mapWorkItemRefs(s.candidate_work_items, catalog)) {
          workItemRows.push({
            requirement_id: requirementId,
            work_item_id: workItemId,
            match_type: 'ai',
            confidence: s.confidence,
            reviewed: false,
          })
        }
      }
      if (!requirementRows.length) return null
      const { error: reqError } = await service!.from('requirements')
        .upsert(requirementRows, { onConflict: 'id', ignoreDuplicates: true })
      if (reqError) return reqError.message
      const { error: srcError } = await service!.from('requirement_sources')
        .upsert(sourceRows, { onConflict: 'id', ignoreDuplicates: true })
      if (srcError) return srcError.message
      if (workItemRows.length) {
        const { error: wiError } = await service!.from('requirement_work_items')
          .upsert(workItemRows, {
            onConflict: 'requirement_id,work_item_id', ignoreDuplicates: true,
          })
        if (wiError) return wiError.message
      }
      totalRequirements += requirementRows.length
      workItemLinkCount += workItemRows.length
      return null
    }

    // 單批抽取。輸出撞上限(stop_reason=max_tokens)代表這批義務太密,
    // 對半切重試(最多兩層);單頁批切不動就記進 clipped_batches 揭露。
    const runBatch = async (pages: PageRow[], label: string, depth: number): Promise<{ ok: boolean; error?: string }> => {
      const first = pages[0]?.page_number
      const last = pages[pages.length - 1]?.page_number
      const batchNote = totalBatches > 1 || depth > 0
        ? `(本次輸入為此文件的第 ${first}~${last} ${paginated ? '頁' : '段'},其餘部分另行處理;只抽取本段出現的需求)`
        : ''
      const prompt = buildPrompt({
        title: doc.title,
        documentType: doc.document_type,
        paginated,
        documentText: buildBatchText(pages, paginated),
        catalogLines,
        batchNote,
      })
      const res = await claudeJson({
        model: MODELS.smart, name: 'requirement_suggestions', schema: SCHEMA,
        maxTokens: 16384, content: prompt,
      })
      totalUsage = mergeUsage(totalUsage, res.usage)
      if (res.model) usedModel = res.model
      if (res.errorCode === 'max_tokens') {
        const halves = depth < 2 ? splitBatch(pages) : null
        if (!halves) {
          clippedBatches.push(`${label}(第 ${first}~${last} ${paginated ? '頁' : '段'})`)
          return { ok: true }
        }
        const firstHalf = await runBatch(halves[0], `${label}a`, depth + 1)
        if (!firstHalf.ok) return firstHalf
        return await runBatch(halves[1], `${label}b`, depth + 1)
      }
      if (res.error) return { ok: false, error: res.error }
      const items = Array.isArray((res.data as Record<string, unknown>)?.requirements)
        ? (res.data as { requirements: unknown[] }).requirements
        : []
      rawItemCount += items.length
      const persistError = await persistBatchItems(items, label)
      if (persistError) return { ok: false, error: persistError }
      return { ok: true }
    }

    for (let bi = 0; bi < totalBatches; bi++) {
      // Edge Function 有平台 wall-clock 上限:逼近前主動停批並揭露,
      // 已落庫的批次保留、run 正常 completed,而不是被砍掉留下殭屍 run
      if (bi > 0 && Date.now() - startedAtMs > TIME_BUDGET_MS) {
        stoppedEarly = true
        break
      }
      const result = await runBatch(plan.batches[bi], `b${bi}`, 0)
      if (!result.ok) {
        failedBatch = { label: `b${bi}`, error: result.error || '' }
        break
      }
      batchesCompleted = bi + 1
      if (totalBatches > 1) {
        // 增量進度(best-effort;完成時會被最終 metadata 覆蓋)
        await service.from('document_ingestion_runs')
          .update({ metadata: { batches_total: totalBatches, batches_completed: batchesCompleted } })
          .eq('id', runId)
      }
    }

    // 已處理的實際涵蓋範圍(供揭露「解析到第幾頁」)
    const lastProcessedBatch = plan.batches[batchesCompleted - 1]
    const lastProcessedPage = lastProcessedBatch
      ? lastProcessedBatch[lastProcessedBatch.length - 1].page_number
      : null
    const coverageIncomplete = plan.truncated || stoppedEarly ||
      failedBatch != null || clippedBatches.length > 0

    const coverageMetadata = {
      pagination: paginated ? 'paginated' : 'unpaginated',
      empty_page_numbers: emptyPageNumbers,
      total_page_count: pageRows.length,
      batches_total: totalBatches,
      batches_completed: batchesCompleted,
      truncated_input: plan.truncated || stoppedEarly,
      stopped_early: stoppedEarly,
      omitted_page_count: plan.omittedPageCount,
      last_included_page: lastProcessedPage,
      clipped_batches: clippedBatches,
      failed_batch: failedBatch ? { label: failedBatch.label, error: failedBatch.error.slice(0, 500) } : null,
      coverage_incomplete: coverageIncomplete,
    }

    // 一批都沒成:整個 run 失敗(照舊)。有成功批次時即使後面失敗也走
    // completed + 揭露——已落庫的建議要能被核定,缺的範圍明講。
    if (failedBatch && batchesCompleted === 0 && totalRequirements === 0) {
      await closeAiGate(gate, { feature: 'requirements.extract', model: usedModel, usage: totalUsage, status: 'error', errorCode: 'claude_error' })
      await failRun(service, runId, failedBatch.error, coverageMetadata)
      return json({ error: failedBatch.error, run_id: runId, status: 'failed' }, 502)
    }
    // AI 呼叫結束即記總用量(token 已花掉);之後的收尾失敗不影響這筆記帳,
    // 也不在外層 catch 再記(避免同一次呼叫重複計數)
    await closeAiGate(gate, { feature: 'requirements.extract', model: usedModel, usage: totalUsage, status: 'ok' })

    const { error: completeError } = await service.from('document_ingestion_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      extracted_requirement_count: totalRequirements,
      verified_source_count: verifiedCount,
      unverified_source_count: needsReviewCount,
      metadata: {
        ...coverageMetadata,
        raw_item_count: rawItemCount,
        rejected_item_count: rejected.length,
        rejected_items: rejected.slice(0, 20),
        work_item_catalog_size: catalog.entries.length,
        work_item_link_count: workItemLinkCount,
      },
    }).eq('id', runId)
    if (completeError) {
      return json({ error: completeError.message, run_id: runId, status: 'failed' }, 500)
    }

    return json({
      run_id: runId,
      status: 'completed',
      extracted_requirement_count: totalRequirements,
      verified_source_count: verifiedCount,
      unverified_source_count: needsReviewCount,
      needs_review_count: needsReviewCount,
      rejected_item_count: rejected.length,
      coverage_incomplete: coverageIncomplete,
      total_page_count: pageRows.length,
      last_included_page: lastProcessedPage,
      batches_total: totalBatches,
      batches_completed: batchesCompleted,
    }, 200)
  } catch (e) {
    const message = String((e as Error)?.message || e)
    if (service && runId) await failRun(service, runId, message, {})
    return json({ error: message, ...(runId ? { run_id: runId, status: 'failed' } : {}) }, 500)
  }
})
