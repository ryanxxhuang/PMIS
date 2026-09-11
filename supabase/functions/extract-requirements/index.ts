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
//
// B6 拆檔索引(純搬移,行為不變):提示詞與 SCHEMA → _shared/requirementPrompt.ts;
// run 生命週期(過期標記/續跑認領/新建/failRun)→ _shared/ingestionRun.ts;
// 逐批落庫(冪等 id)→ _shared/requirementPersist.ts。runBatch 遞迴與主迴圈留在這裡。

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { claudeJson, MODELS, cors, jsonResponse as json, errorResponse, dbErrorResponse } from '../_shared/claude.ts'
import { maskDbError, maskException } from '../_shared/publicError.ts'
import type { PublicError } from '../_shared/publicError.ts'
import { isUuid } from '../_shared/uuid.ts'
import { openAiGate, closeAiGate } from '../_shared/aiGate.ts'
import { normalizeSourceText } from '../_shared/sourceVerify.ts'
import {
  buildWorkItemCatalog,
  buildDocumentBatches, splitBatch, mergeUsage, readResumeState,
  loadDocumentPages, extractionCoverageIncomplete,
} from '../_shared/requirementExtraction.ts'
import type { BatchPage, UsageLike } from '../_shared/requirementExtraction.ts'
import { SCHEMA, buildBatchText, buildPrompt } from '../_shared/requirementPrompt.ts'
import { failRun, markStaleRuns, claimContinuationRun, createExtractionRun } from '../_shared/ingestionRun.ts'
import { persistBatchItems } from '../_shared/requirementPersist.ts'

// Pages whose normalized text is shorter than this carry no verifiable
// content (scanned/image pages - OCR is out of scope for P0-06).
const MIN_PAGE_TEXT_LENGTH = 20
// W10 分批抽取 → W13 縮批+續跑:單批 120k 字讓 69 頁契約整本塞進一次呼叫,
// 輸出趕不上 120s 逾時、同尺寸重試三連發直接撞平台 wall-clock 被砍成殭屍 run。
// 批次縮到單批一次呼叫穩定跑得完;涵蓋範圍改由「跨 request 續跑」承擔,
// MAX_BATCHES 只再作為成本上限(超過照舊寫進 metadata 並回傳揭露 - never silently)。
// W14 二修:實測 28k 單批要跑 ~95s,續跑 request 一撞到「API 閘道 150s 逾時」
// (比 Edge 牆鐘 400s 更緊的真實上限)就 504。批再縮半:單批一次呼叫 30~60s
// 內穩定跑完,不靠對半切救場;批數上限加倍維持同樣的涵蓋範圍。
const BATCH_CHAR_BUDGET = 14_000
const MAX_BATCHES = 24
// 單一 request 的軟時間預算:超過且還有批次沒跑 → 進度落庫、標 awaiting_continue,
// 回 in_progress 讓前端帶 continue_run_id 接力(取代舊的 stopped_early 提早完結)。
// 抓保守——回應得穿過平台/代理的閒置逾時,一個 request 跑 1~2 批就好。
const TIME_BUDGET_MS = 60_000
// 單一 request 的絕對時間上限:每次 Claude 呼叫的 timeoutMs 依剩餘預算收斂,
// (attempts × timeoutMs)最壞總長壓在這條線內。真實天花板不是 Edge 牆鐘
// (400s)而是 **API 閘道的 150s request 逾時**(2026-08-22 實測 504)——
// 回應必須在 150s 內送出,否則閘道切線、前端只拿到非 JSON 的 504。
const REQUEST_ABS_CAP_MS = 140_000
// 剩餘預算不足以打一次有意義的呼叫時,改走「批內暫停」——本批不計完成,
// 掛 awaiting_continue 交下一個 request 重跑本批(同 run 同 label,落庫冪等)
const MIN_CALL_TIMEOUT_MS = 20_000
// 429/5xx 的重試次數:這類失敗是秒回的,重試不吃生成窗口;逾時不重試
// (retryTimeouts:false),所以 timeout 預算不必除以重試次數
const CLAUDE_RETRIES = 1
// 超過這個時間還掛在 pending/processing 的 run 一定已經死了(單批呼叫逾時
// 120s + 重試,總長遠小於 10 分鐘)——每次啟動新解析時順手標記失敗,
// 讓前端不再顯示永遠轉圈的解析中。
const STALE_RUN_MS = 10 * 60_000
const WORK_ITEM_CATALOG_LIMIT = 300

type PageRow = BatchPage

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
    if (!isUuid(documentVersionId)) {
      return json({ error: '缺少有效的 document_version_id' }, 400)
    }
    // W13 續跑:前端收到 in_progress 後帶回 continue_run_id 接力下一段批次
    const continueRunId = isUuid(body?.continue_run_id) ? body.continue_run_id as string : null

    // RLS-scoped read proves the caller can see this version and pins the
    // project server-side; project_id from the body is only cross-checked.
    const { data: version, error: versionError } = await userClient
      .from('document_versions')
      .select('id, document_id, documents!inner(id, project_id, title, document_type)')
      .eq('id', documentVersionId)
      .maybeSingle()
    if (versionError) return dbErrorResponse('extract-requirements.version', versionError)
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
    if (permError) return dbErrorResponse('extract-requirements.can_manage_documents', permError)
    if (canManage !== true) return json({ error: '無文件管理權限,不可啟動 AI 需求擷取' }, 403)

    // -- Load stored page text (RLS-scoped) -----------------------------------
    const { data: processingRun, error: processingError } = await userClient
      .from('document_processing_runs').select('metadata')
      .eq('document_version_id', documentVersionId).maybeSingle()
    if (processingError) {
      console.error('[extract-requirements.processing_run] PostgREST 錯誤:', processingError.message)
      return json({ error: '無法讀取文件上傳紀錄，請重試', code: 'db_error' }, 500)
    }
    // 舊攝取流程可能沒有 processing run；有上傳頁數時必須對得上，不能把
    // 只存入前半的連續頁當成完整文件。這不是對原始檔語意/OCR 品質的保證。
    const pageRows = await loadDocumentPages((from, to) => userClient
      .from('document_pages')
      .select('page_number, extracted_text, extraction_method', { count: 'exact' })
      .eq('document_version_id', documentVersionId)
      .order('page_number')
      .range(from, to), processingRun?.metadata?.page_count)

    // -- Start the traceability run (service role, system-managed table) ------
    service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // 過期補償(W10)與存活判定(W13)都以 staleCutoff 為基準,規則與為什麼見 ingestionRun.ts
    const staleCutoff = new Date(Date.now() - STALE_RUN_MS).toISOString()
    await markStaleRuns(service, projectId, staleCutoff)

    let resumeState: ReturnType<typeof readResumeState> | null = null
    let resumeBatchesTotal: number | null = null
    if (continueRunId) {
      // W13 續跑認領(CAS 細節在 ingestionRun.ts):拿到 Response 就是 409 早退或 DB 錯誤
      const claim = await claimContinuationRun(service, continueRunId, documentVersionId)
      if (claim instanceof Response) return claim
      const { meta } = claim
      runId = continueRunId
      resumeState = readResumeState(meta)
      resumeBatchesTotal = typeof meta.batches_total === 'number' ? meta.batches_total : null
    } else {
      // 新啟動:存活 run 檢查 + insert(23505 → 409 run_conflict)在 ingestionRun.ts
      const created = await createExtractionRun(service, {
        projectId, documentVersionId, staleCutoff,
        startedBy: gate.userId, inputPageCount: pageRows.length,
      })
      if (created instanceof Response) return created
      runId = created.runId
    }

    const paginated = pageRows.length > 0 &&
      pageRows.every((p) => p.extraction_method === 'pdf_text')
    const emptyPageNumbers = pageRows
      .filter((p) => normalizeSourceText(p.extracted_text).length < MIN_PAGE_TEXT_LENGTH)
      .map((p) => p.page_number)

    if (!pageRows.length || emptyPageNumbers.length === pageRows.length) {
      const message =
        '文件沒有可用的已抽取文字(可能為掃描件或影像 PDF);P0-06 不含 OCR,無法建立可追溯的需求建議'
      const pub = { message, code: 'no_text' }
      await failRun(service, runId, pub, {
        pagination: paginated ? 'paginated' : 'unpaginated',
        empty_page_numbers: emptyPageNumbers,
      })
      return errorResponse(pub, 422, { run_id: runId, status: 'failed' })
    }

    // -- Bounded BOQ catalog (identity fields only - never prices/costs) ------
    const { data: workItems, error: workItemsError } = await userClient
      .from('work_items')
      .select('id, item_no, description, is_leaf, is_rollup')
      .eq('project_id', projectId)
      .order('sort_order')
      .limit(2000)
    if (workItemsError) {
      const pub = maskDbError('extract-requirements.work_items', workItemsError)
      await failRun(service, runId, pub, {})
      return errorResponse(pub, 500, { run_id: runId, status: 'failed' })
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

    // W13 續跑防呆:切批是確定性的(頁不可變+固定參數),但部署若改了批次參數,
    // 舊 run 的進度會對不上新計畫——寧可明確失敗要求重跑,不可錯位續抽。
    if (resumeState && (
      (resumeBatchesTotal != null && resumeBatchesTotal !== totalBatches)
      || resumeState.batchesCompleted > totalBatches
    )) {
      const pub = { message: '解析批次計畫已變更(系統更新),請重新啟動解析', code: 'restart_required' }
      await failRun(service, runId, pub, { batches_total: totalBatches })
      return errorResponse(pub, 409, { run_id: runId, status: 'failed' })
    }

    // 計數器從續跑狀態還原(全新 run 全為 0);totalUsage 只記「本 request」的
    // 用量——每個 request 各記一筆 ai_usage_events,被平台砍掉時最多掉一批在途量
    const prior = resumeState ?? readResumeState(null)
    let totalUsage: UsageLike = {}
    let usedModel: string | undefined
    let totalRequirements = prior.totalRequirements
    let verifiedCount = prior.verifiedCount
    let needsReviewCount = prior.needsReviewCount
    let rawItemCount = prior.rawItemCount
    let workItemLinkCount = prior.workItemLinkCount
    let rejectedCount = prior.rejectedCount
    const rejected: { index: string; reason: string }[] = [...prior.rejectedItems]
    const clippedBatches: string[] = [...prior.clippedBatches]
    let failedBatch: { label: string; message: string; code: string } | null = null
    let batchesCompleted = prior.batchesCompleted
    let pausedForContinuation = false
    // 批內對半切的跨 request 續跑:上個 request 若在某批逾時後預算見底,
    // 這裡直接從記錄的切分深度開跑,不重演註定逾時的完整嘗試(活鎖防止)
    let pendingSplitBatch = prior.pendingSplitBatch
    let pendingSplitDepth = prior.pendingSplitDepth
    // 該批已完成的子批 label:子批總時長可能超過單一 request 預算,續跑要能
    // 跳過已完成的子批(否則每輪從第一塊重跑,最後一塊永遠輪不到——實測活鎖)
    let doneSubLabels: string[] = [...prior.pendingSplitDone]

    // 進度 metadata 只寫「最後完成批」當下的計數快照,不寫批內半途的活計數——
    // 批內暫停後下個 request 會整批重跑,若把半批計數寫進去會重複累計
    // (落庫本身靠 deterministicUuid 冪等,計數必須跟著同一條邊界走)。
    // jsonb 是整包覆蓋,不能只寫兩個鍵。awaiting_continue=true 是「暫停待續跑」
    // 的旗標,續跑認領用 CAS 翻掉它。
    let committed = {
      totalRequirements, verifiedCount, needsReviewCount, rawItemCount,
      workItemLinkCount, rejectedCount,
      rejectedItems: [...rejected], clippedBatches: [...clippedBatches],
    }
    const progressMetadata = (opts: { awaitingContinue: boolean }) => ({
      pagination: paginated ? 'paginated' : 'unpaginated',
      batches_total: totalBatches,
      batches_completed: batchesCompleted,
      cum_requirement_count: committed.totalRequirements,
      cum_verified_count: committed.verifiedCount,
      cum_needs_review_count: committed.needsReviewCount,
      cum_raw_item_count: committed.rawItemCount,
      cum_work_item_link_count: committed.workItemLinkCount,
      cum_rejected_count: committed.rejectedCount,
      rejected_items: committed.rejectedItems.slice(0, 20),
      clipped_batches: committed.clippedBatches,
      pending_split_batch: pendingSplitBatch,
      pending_split_depth: pendingSplitDepth,
      pending_split_done: doneSubLabels.slice(0, 64),
      awaiting_continue: opts.awaitingContinue,
      last_progress_at: new Date().toISOString(),
    })

    // 驗證 + 引註查核 + 落庫在 requirementPersist.ts(identity 帶批次標籤,同一 run
    // 內重試同一批 upsert 相同的列);這裡只準備本 run 內不變的上下文
    const persistContext = { service, runId, projectId, documentVersionId, pageRows, paginated, catalog }

    // 單批抽取。輸出撞上限(stop_reason=max_tokens)代表這批義務太密,
    // 對半切重試(最多兩層);單頁批切不動就記進 clipped_batches 揭露。
    // forceSplitBelow:續跑帶進來的「先切再跑」深度——上個 request 已證明
    // depth < forceSplitBelow 的尺寸會逾時,直接從切好的子批開始
    const runBatch = async (pages: PageRow[], label: string, depth: number, forceSplitBelow = 0): Promise<{ ok: boolean; fail?: PublicError; paused?: boolean; nextDepth?: number }> => {
      if (depth < forceSplitBelow) {
        const halves = splitBatch(pages)
        if (halves) {
          const firstHalf = await runBatch(halves[0], `${label}a`, depth + 1, forceSplitBelow)
          if (!firstHalf.ok) return firstHalf
          return await runBatch(halves[1], `${label}b`, depth + 1, forceSplitBelow)
        }
      }
      // 已在先前 request 完成並落庫的子批:直接跳過(落庫冪等,但重跑燒時間)
      if (depth > 0 && doneSubLabels.includes(label)) return { ok: true }
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
      // 單次呼叫給滿剩餘預算(留 15s 收尾 margin),不再除以重試次數——
      // 429/5xx 的重試是秒回的快失敗,逾時則根本不重試(retryTimeouts:false),
      // 除以次數只會把生成窗口砍到不夠用,製造「每個 request 都逾時」的活鎖
      // (2026-08-22 實測:67s 窗口跑不完的批,每輪接力重演一次,卡死在 1/5)。
      // 預算見底就「批內暫停」:記下 nextDepth 交下一個 request 從切好的深度續跑。
      const remainingMs = REQUEST_ABS_CAP_MS - (Date.now() - startedAtMs)
      const callTimeoutMs = Math.min(120_000, remainingMs - 15_000)
      if (callTimeoutMs < MIN_CALL_TIMEOUT_MS) {
        return { ok: false, paused: true, nextDepth: depth }
      }
      const res = await claudeJson({
        model: MODELS.smart, name: 'requirement_suggestions', schema: SCHEMA,
        maxTokens: 16384, content: prompt, retryTimeouts: false,
        timeoutMs: callTimeoutMs, retries: CLAUDE_RETRIES,
      })
      totalUsage = mergeUsage(totalUsage, res.usage)
      if (res.model) usedModel = res.model
      // 輸出撞上限(max_tokens)或單次呼叫逾時都代表「這批太大」:對半切重試。
      // 逾時不做同尺寸重試(retryTimeouts:false)——同尺寸只會再逾時一次,
      // 卻把 wall-clock 燒光(W13 殭屍 run 的直接死因)
      if (res.errorCode === 'max_tokens' || res.errorCode === 'timeout') {
        const halves = depth < 2 ? splitBatch(pages) : null
        if (!halves) {
          clippedBatches.push(`${label}(第 ${first}~${last} ${paginated ? '頁' : '段'})`)
          if (depth > 0) doneSubLabels.push(label)  // 記為已處理,續跑不重clip
          return { ok: true }
        }
        const firstHalf = await runBatch(halves[0], `${label}a`, depth + 1)
        if (!firstHalf.ok) return firstHalf
        return await runBatch(halves[1], `${label}b`, depth + 1)
      }
      // res.error 已是 claudeJson 遮罩後的短語(原文在它的 log),errorCode 一路帶到 failRun
      if (res.error) return { ok: false, fail: { message: res.error, code: res.errorCode ?? 'claude_error' } }
      if (!Array.isArray((res.data as Record<string, unknown>)?.requirements)) {
        return { ok: false, fail: { message: 'AI 回傳缺少契約重點清單，無法判定本批已完整整理', code: 'no_requirements' } }
      }
      const items = (res.data as { requirements: unknown[] }).requirements
      rawItemCount += items.length
      const persisted = await persistBatchItems(persistContext, items, label)
      // 本批增量累加回 request 計數器,時點與原閉包一致:驗證/引註/丟棄計數不論
      // 落庫成敗都算,總數與工項連結只在落庫成功後才加(失敗時回 0)
      rejectedCount += persisted.rejectedCount
      for (const r of persisted.rejected) if (rejected.length < 20) rejected.push(r)
      verifiedCount += persisted.verifiedCount
      needsReviewCount += persisted.needsReviewCount
      totalRequirements += persisted.totalRequirements
      workItemLinkCount += persisted.workItemLinkCount
      if (persisted.error) return { ok: false, fail: persisted.error }
      // 子批完成即記錄+落庫:下一個 request 直接跳過,只跑剩下的子批。
      // 計數快照同步推進——子批已不會重跑(done-labels 防重),把它的計數
      // 掉在快照外反而會讓最終總數漏掉被跳過的子批
      if (depth > 0) {
        doneSubLabels.push(label)
        committed = {
          totalRequirements, verifiedCount, needsReviewCount, rawItemCount,
          workItemLinkCount, rejectedCount,
          rejectedItems: [...rejected], clippedBatches: [...clippedBatches],
        }
        await service!.from('document_ingestion_runs')
          .update({ metadata: progressMetadata({ awaitingContinue: false }) })
          .eq('id', runId)
      }
      return { ok: true }
    }

    const startBatch = batchesCompleted
    for (let bi = startBatch; bi < totalBatches; bi++) {
      // 單一 request 的軟預算:時間到且還有批次沒跑 → 暫停待續跑(awaiting_continue),
      // 已落庫的批次保留;本 request 的第一批一律照跑,避免閘門/載入耗時導致空轉
      if (bi > startBatch && Date.now() - startedAtMs > TIME_BUDGET_MS) {
        pausedForContinuation = true
        break
      }
      // 換到別批就清掉子批完成記錄(它只屬於 pendingSplitBatch 那一批)
      if (bi !== pendingSplitBatch) doneSubLabels.length = 0
      const result = await runBatch(
        plan.batches[bi], `b${bi}`, 0,
        bi === pendingSplitBatch ? pendingSplitDepth : 0,
      )
      if (!result.ok) {
        // 批內暫停(剩餘時間不足以再打一次呼叫)≠ 批失敗:記下本批要從哪個
        // 切分深度續跑,交下一個 request 接手,不記 failed_batch
        if (result.paused) {
          const priorDepth = bi === pendingSplitBatch ? pendingSplitDepth : 0
          pendingSplitBatch = bi
          pendingSplitDepth = Math.max(result.nextDepth ?? 0, priorDepth)
          pausedForContinuation = true
          break
        }
        failedBatch = { label: `b${bi}`, ...(result.fail ?? { message: '', code: 'batch_failed' }) }
        break
      }
      pendingSplitBatch = -1
      pendingSplitDepth = 0
      doneSubLabels.length = 0
      batchesCompleted = bi + 1
      committed = {
        totalRequirements, verifiedCount, needsReviewCount, rawItemCount,
        workItemLinkCount, rejectedCount,
        rejectedItems: [...rejected], clippedBatches: [...clippedBatches],
      }
      // 每批進度落庫(含累計計數快照):續跑靠這個還原,過期判定靠 last_progress_at
      await service.from('document_ingestion_runs')
        .update({ metadata: progressMetadata({ awaitingContinue: false }) })
        .eq('id', runId)
    }

    // W13 暫停:進度已逐批落庫,掛上 awaiting_continue 讓前端帶 continue_run_id 接力。
    // 本 request 的 AI 用量先落帳——token 已花掉,下一個 request 另記一筆。
    if (pausedForContinuation) {
      await closeAiGate(gate, { feature: 'requirements.extract', model: usedModel, usage: totalUsage, status: 'ok' })
      const { error: pauseError } = await service.from('document_ingestion_runs')
        .update({ metadata: progressMetadata({ awaitingContinue: true }) })
        .eq('id', runId)
      if (pauseError) {
        // 旗標掛不上=沒人能續跑,誠實回錯誤;run 會由過期補償收屍
        return dbErrorResponse('extract-requirements.pause', pauseError, 500, { run_id: runId, status: 'failed' })
      }
      return json({
        run_id: runId,
        status: 'in_progress',
        batches_total: totalBatches,
        batches_completed: batchesCompleted,
        total_page_count: pageRows.length,
      }, 200)
    }

    // 已處理的實際涵蓋範圍(供揭露「解析到第幾頁」)
    const lastProcessedBatch = plan.batches[batchesCompleted - 1]
    const lastProcessedPage = lastProcessedBatch
      ? lastProcessedBatch[lastProcessedBatch.length - 1].page_number
      : null
    const coverageIncomplete = extractionCoverageIncomplete({
      truncated: plan.truncated, failed: failedBatch != null,
      clippedCount: clippedBatches.length, emptyPageCount: emptyPageNumbers.length,
      rejectedCount,
    })

    const coverageMetadata = {
      pagination: paginated ? 'paginated' : 'unpaginated',
      empty_page_numbers: emptyPageNumbers,
      total_page_count: pageRows.length,
      batches_total: totalBatches,
      batches_completed: batchesCompleted,
      truncated_input: plan.truncated,
      omitted_page_count: plan.omittedPageCount,
      last_included_page: lastProcessedPage,
      clipped_batches: clippedBatches,
      // metadata 的 error 鍵名沿用(前端相容);內容已是遮罩短語
      failed_batch: failedBatch ? { label: failedBatch.label, error: failedBatch.message.slice(0, 500), code: failedBatch.code } : null,
      coverage_incomplete: coverageIncomplete,
      awaiting_continue: false,
      last_progress_at: new Date().toISOString(),
    }

    // 一批都沒成:整個 run 失敗(照舊)。有成功批次時即使後面失敗也走
    // completed + 揭露——已落庫的建議要能被核定,缺的範圍明講。
    if (failedBatch && batchesCompleted === 0 && totalRequirements === 0) {
      await closeAiGate(gate, { feature: 'requirements.extract', model: usedModel, usage: totalUsage, status: 'error', errorCode: 'claude_error' })
      const pub = { message: failedBatch.message, code: failedBatch.code }
      await failRun(service, runId, pub, coverageMetadata)
      return errorResponse(pub, 502, { run_id: runId, status: 'failed' })
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
        rejected_item_count: rejectedCount,
        rejected_items: rejected.slice(0, 20),
        work_item_catalog_size: catalog.entries.length,
        work_item_link_count: workItemLinkCount,
      },
    }).eq('id', runId)
    if (completeError) {
      return dbErrorResponse('extract-requirements.complete', completeError, 500, { run_id: runId, status: 'failed' })
    }

    // 轉錄分流(D-017,確定性引擎):引文已核對且期限數字與引文一致的自動確認
    // 並物化義務;對不上的標記疑慮進人工。分流失敗不擋 run 完結——列維持待確認,
    // 安全退化(全部進人工)。
    let autoConfirmedCount = 0
    let flaggedCount = 0
    try {
      const { data: triageRows, error: triageError } = await service
        .rpc('apply_transcription_triage', { p_run: runId })
      const triage = Array.isArray(triageRows) ? triageRows[0] : triageRows
      if (!triageError && triage) {
        autoConfirmedCount = Number(triage.auto_confirmed) || 0
        flaggedCount = Number(triage.flagged) || 0
      }
    } catch { /* 安全退化 */ }

    return json({
      run_id: runId,
      status: 'completed',
      auto_confirmed_count: autoConfirmedCount,
      flagged_count: flaggedCount,
      extracted_requirement_count: totalRequirements,
      verified_source_count: verifiedCount,
      unverified_source_count: needsReviewCount,
      needs_review_count: needsReviewCount,
      rejected_item_count: rejectedCount,
      coverage_incomplete: coverageIncomplete,
      empty_page_numbers: emptyPageNumbers,
      clipped_batches: clippedBatches,
      total_page_count: pageRows.length,
      last_included_page: lastProcessedPage,
      batches_total: totalBatches,
      batches_completed: batchesCompleted,
    }, 200)
  } catch (e) {
    // loadDocumentPages 等刻意 throw 的繁中訊息原樣放行,runtime 原文遮罩(規則見 publicError.ts)
    const pub = maskException('extract-requirements', e)
    if (service && runId) await failRun(service, runId, pub, {})
    return errorResponse(pub, 500, runId ? { run_id: runId, status: 'failed' } : {})
  }
})
