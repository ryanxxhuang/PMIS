// 一批模型輸出的落庫(B6 自 extract-requirements/index.ts 純搬移):驗證 → 引註查核
// → 冪等 upsert 三張表。identity 帶批次標籤(`${runId}:${label}:requirement:${i}`),
// 同一 run 內重試同一批 upsert 相同的列——這是續跑「批內暫停後整批重跑」不會
// 重複建議的唯一保證(docs/architecture/resumable-extraction.md §4)。
// ---------------------------------------------------------------------------
// 原本是 handler 內的閉包,直接遞增 request 層級的計數器;抽出後改回「本批增量」,
// 由呼叫端累加。時點刻意與原閉包一致:驗證/引註/丟棄計數在迴圈內就算、不論後續
// 落庫成敗;totalRequirements / workItemLinkCount 只在三張表都寫成功才計(失敗回 0)。
// 丟棄清單的 20 筆上限是跨批累計的,所以留在呼叫端套。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { maskDbError } from './publicError.ts'
import type { PublicError } from './publicError.ts'
import { validateSuggestion, mapWorkItemRefs, deterministicUuid } from './requirementExtraction.ts'
import type { BatchPage, WorkItemCatalog } from './requirementExtraction.ts'
import { verifySuggestionSource } from './sourceVerify.ts'

// 本 run 內不變的上下文(呼叫端組一次,每批重用)
export interface PersistBatchContext {
  service: SupabaseClient
  runId: string
  projectId: string
  documentVersionId: string
  pageRows: BatchPage[]
  paginated: boolean
  catalog: WorkItemCatalog
}

export interface PersistBatchResult {
  error: PublicError | null     // 遮罩後的 DB 錯誤(原文已進 log);null = 本批落庫成功或無可落庫項目
  rejectedCount: number
  rejected: { index: string; reason: string }[]
  verifiedCount: number
  needsReviewCount: number
  totalRequirements: number
  workItemLinkCount: number
}

// 驗證 + 引註查核 + 落庫一批模型輸出。identity 帶批次標籤
// (`${runId}:${label}:…`),同一 run 內重試同一批 upsert 相同的列。
export async function persistBatchItems(
  ctx: PersistBatchContext, items: unknown[], label: string,
): Promise<PersistBatchResult> {
  const { service, runId, projectId, documentVersionId, pageRows, paginated, catalog } = ctx
  const requirementRows: Record<string, unknown>[] = []
  const sourceRows: Record<string, unknown>[] = []
  const workItemRows: Record<string, unknown>[] = []
  let rejectedCount = 0
  const rejected: { index: string; reason: string }[] = []
  let verifiedCount = 0
  let needsReviewCount = 0
  for (let i = 0; i < items.length; i++) {
    const check = validateSuggestion(items[i])
    if (!check.ok) {
      rejectedCount++
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
  const tally = { rejectedCount, rejected, verifiedCount, needsReviewCount, totalRequirements: 0, workItemLinkCount: 0 }
  if (!requirementRows.length) return { error: null, ...tally }
  const { error: reqError } = await service.from('requirements')
    .upsert(requirementRows, { onConflict: 'id', ignoreDuplicates: true })
  if (reqError) return { error: maskDbError('extract-requirements.persist.requirements', reqError), ...tally }
  const { error: srcError } = await service.from('requirement_sources')
    .upsert(sourceRows, { onConflict: 'id', ignoreDuplicates: true })
  if (srcError) return { error: maskDbError('extract-requirements.persist.sources', srcError), ...tally }
  if (workItemRows.length) {
    const { error: wiError } = await service.from('requirement_work_items')
      .upsert(workItemRows, {
        onConflict: 'requirement_id,work_item_id', ignoreDuplicates: true,
      })
    if (wiError) return { error: maskDbError('extract-requirements.persist.work_items', wiError), ...tally }
  }
  return { error: null, ...tally, totalRequirements: requirementRows.length, workItemLinkCount: workItemRows.length }
}
