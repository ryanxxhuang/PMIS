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
import { normalizeSourceText, verifySuggestionSource } from '../_shared/sourceVerify.ts'
import {
  PROMPT_VERSION, REQUIREMENT_TYPES, RESPONSIBLE_PARTY_TYPES, LIFECYCLE_PHASES,
  TRIGGER_TYPES, OFFSET_DIRS, FREQUENCY_TYPES,
  buildWorkItemCatalog, mapWorkItemRefs, validateSuggestion, deterministicUuid,
} from '../_shared/requirementExtraction.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Pages whose normalized text is shorter than this carry no verifiable
// content (scanned/image pages - OCR is out of scope for P0-06).
const MIN_PAGE_TEXT_LENGTH = 20
// Character budget for the document text handed to the model. Pages beyond
// the budget are omitted and reported in run metadata - never silently.
const DOCUMENT_CHAR_BUDGET = 160_000
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

interface PageRow {
  page_number: number
  extracted_text: string | null
  extraction_method: string
}

function buildDocumentText(pages: PageRow[], paginated: boolean) {
  const parts: string[] = []
  let used = 0
  let lastIncludedPage: number | null = null
  let truncated = false
  for (const p of pages) {
    const header = paginated
      ? `=== 第 ${p.page_number} 頁 ===`
      : `=== 段落 ${p.page_number}(此文件無可靠頁碼)===`
    const block = `${header}\n${p.extracted_text || ''}\n`
    if (used + block.length > DOCUMENT_CHAR_BUDGET) { truncated = true; break }
    parts.push(block)
    used += block.length
    lastIncludedPage = p.page_number
  }
  return { documentText: parts.join('\n'), truncated, lastIncludedPage }
}

function buildPrompt(opts: {
  title: string
  documentType: string
  paginated: boolean
  documentText: string
  catalogLines: string
}) {
  const pageRule = opts.paginated
    ? '每項的 source.page_number 必須是上方「=== 第 N 頁 ===」實際出現的 N,引註原文必須出現在該頁。'
    : '此文件沒有可靠頁碼:source.page_number 一律填 0,改以 section / clause 標明出處。'
  return (
    '以下是台灣公共工程專案文件的逐頁文字。\n' +
    `文件名稱:${opts.title}\n文件類型:${opts.documentType}\n\n` +
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

  let service: SupabaseClient | null = null
  let runId: string | null = null
  try {
    const body = await req.json().catch(() => null)
    const documentVersionId = body?.document_version_id
    if (typeof documentVersionId !== 'string' || !UUID_RE.test(documentVersionId)) {
      return json({ error: '缺少有效的 document_version_id' }, 400)
    }

    // -- Caller authentication + authorization --------------------------------
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData } = await userClient.auth.getUser()
    const user = userData?.user
    if (!user) return json({ error: '未登入' }, 401)

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
        started_by: user.id,
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

    // -- AI extraction (page boundaries preserved in the input) ---------------
    const { documentText, truncated, lastIncludedPage } =
      buildDocumentText(pageRows, paginated)
    const prompt = buildPrompt({
      title: doc.title,
      documentType: doc.document_type,
      paginated,
      documentText,
      catalogLines,
    })
    const { data: aiData, error: aiError } = await claudeJson({
      model: MODELS.smart, name: 'requirement_suggestions', schema: SCHEMA,
      maxTokens: 16384, content: prompt,
    })
    if (aiError) {
      await failRun(service, runId, aiError, {
        pagination: paginated ? 'paginated' : 'unpaginated',
        empty_page_numbers: emptyPageNumbers,
        truncated_input: truncated,
      })
      return json({ error: aiError, run_id: runId, status: 'failed' }, 502)
    }

    // -- Deterministic validation + source verification ------------------------
    const rawItems = Array.isArray((aiData as Record<string, unknown>)?.requirements)
      ? (aiData as { requirements: unknown[] }).requirements
      : []
    const requirementRows: Record<string, unknown>[] = []
    const sourceRows: Record<string, unknown>[] = []
    const workItemRows: Record<string, unknown>[] = []
    const rejected: { index: number; reason: string }[] = []
    let verifiedCount = 0
    let needsReviewCount = 0

    for (let i = 0; i < rawItems.length; i++) {
      const check = validateSuggestion(rawItems[i])
      if (!check.ok) {
        rejected.push({ index: i, reason: check.reason })
        continue
      }
      const s = check.value
      const { verified, pageNumber } = verifySuggestionSource({
        source: s.source, pages: pageRows, paginated,
      })
      if (verified) verifiedCount++
      else needsReviewCount++

      // Suggestion identity is run-scoped and positional: retrying the same
      // persistence step upserts the same rows (no duplicates in one run).
      const requirementId = await deterministicUuid(`${runId}:requirement:${i}`)
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
        id: await deterministicUuid(`${runId}:source:${i}`),
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

    // -- Persist suggestions (idempotent within this run) ----------------------
    if (requirementRows.length) {
      const { error: reqError } = await service.from('requirements')
        .upsert(requirementRows, { onConflict: 'id', ignoreDuplicates: true })
      if (reqError) {
        await failRun(service, runId, reqError.message, {})
        return json({ error: reqError.message, run_id: runId, status: 'failed' }, 500)
      }
      const { error: srcError } = await service.from('requirement_sources')
        .upsert(sourceRows, { onConflict: 'id', ignoreDuplicates: true })
      if (srcError) {
        await failRun(service, runId, srcError.message, {})
        return json({ error: srcError.message, run_id: runId, status: 'failed' }, 500)
      }
      if (workItemRows.length) {
        const { error: wiError } = await service.from('requirement_work_items')
          .upsert(workItemRows, {
            onConflict: 'requirement_id,work_item_id', ignoreDuplicates: true,
          })
        if (wiError) {
          await failRun(service, runId, wiError.message, {})
          return json({ error: wiError.message, run_id: runId, status: 'failed' }, 500)
        }
      }
    }

    const { error: completeError } = await service.from('document_ingestion_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      extracted_requirement_count: requirementRows.length,
      verified_source_count: verifiedCount,
      unverified_source_count: needsReviewCount,
      metadata: {
        pagination: paginated ? 'paginated' : 'unpaginated',
        empty_page_numbers: emptyPageNumbers,
        truncated_input: truncated,
        last_included_page: lastIncludedPage,
        raw_item_count: rawItems.length,
        rejected_item_count: rejected.length,
        rejected_items: rejected.slice(0, 20),
        work_item_catalog_size: catalog.entries.length,
        work_item_link_count: workItemRows.length,
      },
    }).eq('id', runId)
    if (completeError) {
      return json({ error: completeError.message, run_id: runId, status: 'failed' }, 500)
    }

    return json({
      run_id: runId,
      status: 'completed',
      extracted_requirement_count: requirementRows.length,
      verified_source_count: verifiedCount,
      unverified_source_count: needsReviewCount,
      needs_review_count: needsReviewCount,
      rejected_item_count: rejected.length,
    }, 200)
  } catch (e) {
    const message = String((e as Error)?.message || e)
    if (service && runId) await failRun(service, runId, message, {})
    return json({ error: message, ...(runId ? { run_id: runId, status: 'failed' } : {}) }, 500)
  }
})
