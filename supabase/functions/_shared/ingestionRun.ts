// document_ingestion_runs 的生命週期(B6 自 extract-requirements/index.ts 純搬移):
// 過期標記、續跑 CAS 認領、新建(23505 → 409)、失敗收尾。機制與事故史見
// docs/architecture/resumable-extraction.md §4~§6、§9;這裡不解釋第二次。
// ---------------------------------------------------------------------------
// 早退協定:回 Response 就是呼叫端要原樣 return 的 4xx/5xx(409 的 code 前端有讀:
// run_conflict / restart_required,不可改);回物件才是成功路徑。用 Response 聯集而
// 不是 { ok, response } 是為了讓搬過來的每一行 `return json(...)` 逐字不動。
// 只有 service role 能寫這張表(system-managed),呼叫端負責傳 service client 進來。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { MODELS, jsonResponse as json, dbErrorResponse } from './claude.ts'
import type { PublicError } from './publicError.ts'
import { PROMPT_VERSION } from './requirementPrompt.ts'

// 只存分類碼＋中文短語(B1 / H-2):error_message 整案成員可讀(policy
// document_ingestion_runs_select)且前端 packageUpload / Contract 會顯示,重構前
// 把 PostgREST / Claude 原文 slice(0,2000) 存進去等於持久化外洩。原文由各遮罩點
// console.error;代碼落在 metadata.error_code(不動 schema、對前端純加法)。
export async function failRun(
  service: SupabaseClient, runId: string, pub: PublicError,
  metadata: Record<string, unknown>,
) {
  await service.from('document_ingestion_runs').update({
    status: 'failed',
    completed_at: new Date().toISOString(),
    error_message: pub.message.slice(0, 2000),
    metadata: { ...metadata, error_code: pub.code },
  }).eq('id', runId)
}

// W10 卡死補償:程序被平台砍掉(wall-clock、crash)時 run 會永遠停在
// pending/processing,而 review_requirement 只准核定 completed run 的建議
// ——整批建議跟著卡死。每次啟動新解析時把本專案明顯過期的 run 標記失敗;
// best-effort,失敗不擋主流程。
// W13:過期判定看「最後進度」而不只是開跑時間——續跑中的長文件 run 可以
// 合法活過 10 分鐘,只要批次持續落庫(last_progress_at 會一直前進)。
// ISO 字串比大小=時間先後(同為 UTC Z 結尾),PostgREST 文字比較可用。
export async function markStaleRuns(service: SupabaseClient, projectId: string, staleCutoff: string): Promise<void> {
  await service.from('document_ingestion_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: '解析逾時未完成,系統自動標記失敗;可重新啟動解析',
    })
    .eq('project_id', projectId)
    .in('status', ['pending', 'processing'])
    .lt('started_at', staleCutoff)
    .or(`metadata->>last_progress_at.is.null,metadata->>last_progress_at.lt.${staleCutoff}`)
}

// W13 續跑認領:只認「同版本、processing、掛著 awaiting_continue」的 run。
// 讀後以 contains 條件做 CAS 更新——兩個並發續跑只有一個改得到旗標,
// 搶輸的拿 409,不會兩邊同時跑同一批。
// 回 { meta } = 認領成功,meta 是認領前的 metadata(呼叫端據此還原續跑計數)。
export async function claimContinuationRun(
  service: SupabaseClient, continueRunId: string, documentVersionId: string,
): Promise<Response | { meta: Record<string, unknown> }> {
  const { data: runRow, error: runReadError } = await service
    .from('document_ingestion_runs')
    .select('id, status, document_version_id, metadata')
    .eq('id', continueRunId)
    .maybeSingle()
  if (runReadError) return dbErrorResponse('extract-requirements.run_read', runReadError)
  const meta = (runRow?.metadata ?? {}) as Record<string, unknown>
  if (!runRow || runRow.document_version_id !== documentVersionId
    || runRow.status !== 'processing' || meta.awaiting_continue !== true) {
    // code=restart_required:終局狀態,前端必須走失敗收尾,不可當「還在跑」
    return json({
      error: '找不到可續跑的解析(可能已完成、失敗或已被接手),請重新整理查看最新狀態',
      run_id: continueRunId, status: 'failed', code: 'restart_required',
    }, 409)
  }
  const { data: claimed, error: claimError } = await service
    .from('document_ingestion_runs')
    .update({ metadata: { ...meta, awaiting_continue: false, last_progress_at: new Date().toISOString() } })
    .eq('id', continueRunId)
    .contains('metadata', { awaiting_continue: true })
    .select('id')
  if (claimError) return dbErrorResponse('extract-requirements.run_claim', claimError)
  if (!claimed?.length) {
    return json({ error: '這份文件已在解析中,請等它完成或失敗後再試', run_id: continueRunId, code: 'run_conflict' }, 409)
  }
  return { meta }
}

// 同一版本仍有存活的進行中 run:擋掉重複啟動(重複解析=重複建議+重複燒錢)。
// 「存活」與上方過期判定對稱:近期開跑或近期有進度都算。
export async function createExtractionRun(service: SupabaseClient, opts: {
  projectId: string; documentVersionId: string; staleCutoff: string;
  startedBy: string; inputPageCount: number;
}): Promise<Response | { runId: string }> {
  const { projectId, documentVersionId, staleCutoff, startedBy, inputPageCount } = opts
  const { data: activeRun } = await service.from('document_ingestion_runs')
    .select('id')
    .eq('document_version_id', documentVersionId)
    .in('status', ['pending', 'processing'])
    .or(`started_at.gte.${staleCutoff},metadata->>last_progress_at.gte.${staleCutoff}`)
    .limit(1)
    .maybeSingle()
  if (activeRun) {
    return json({ error: '這份文件已在解析中,請等它完成或失敗後再試', run_id: activeRun.id, code: 'run_conflict' }, 409)
  }

  // 刻意「不」清掉先前 run 的建議:審查清單只收最新 completed run 的建議
  // (requirementReview.js 的 latestCompletedRunIds),舊 run 的草稿列留在 DB
  // 無害;反之刪除會誤殺人工已編修的草稿(saveEdit 改內容不改 status)與
  // 已審的工項連結,且刪在新解析成功之前——Anthropic 一停機審查佇列就被清空
  // (W13 審查確認後撤掉原本的清理設計)。

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
      started_by: startedBy,
      input_page_count: inputPageCount,
      metadata: { last_progress_at: new Date().toISOString() },
    })
    .select('id')
    .single()
  if (runError) {
    // 23505=撞上 partial unique index(同版本同時只准一條 active run):
    // check-then-insert 的競態窗由 DB 唯一性收口,輸的請求拿 409(W13 審查)
    if ((runError as { code?: string }).code === '23505') {
      return json({ error: '這份文件已在解析中,請等它完成或失敗後再試', code: 'run_conflict' }, 409)
    }
    return dbErrorResponse('extract-requirements.run_insert', runError)
  }
  return { runId: run.id as string }
}
