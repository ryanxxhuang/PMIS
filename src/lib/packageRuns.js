// document_processing_runs 在上傳之後的生命週期(專案文件頁 Contract.jsx 的資料層):
//
// 1. loadPackageRuns:單一契約包的處理狀態——四段串接的分頁查詢(run → 文件 →
//    文件版本 → 擷取 run/已核定 requirement),純讀取,不寫資料庫。
// 2. healStaleRuns:中斷復原的寫入副作用,刻意從讀取函式拆出來——讀取函式偷偷
//    寫庫時,「誰可以寫」的判斷(canUploadDocs)只能混進讀取邏輯裡當旗標;拆開後
//    由頁面決定要不要修(能管理文件的人才修)、修到一半要不要停(切案/切包)。
// 3. reclassifyProcessingRun:改分類/確認分類/重試的 run 狀態機——3 次寫入
//    (documents.document_type → run 重啟 → run 收尾)+ 抽取接力 + 進度心跳。
//    不碰 React state:畫面更新透過 onRunPatch/onDocumentTyped 回呼,所以能在
//    node 環境直接測狀態轉移,不必掛載整頁。
//
// 分頁工具與 supabase 走既有共用層;所有「載入全部」都用 pagedQuery(PostgREST
// 1000 列上限會靜默截斷)。
import { supabase } from './supabase.js'
import { pageAllSafe, pageAllInSafe } from './pagedQuery.js'
import { friendlyError } from './errorMessage.js'
import { staleProcessingPatch } from './packageUpload.js'
import { EXTRACTABLE_DOCUMENT_TYPES } from './documentClassifier.js'
import { latestCompletedRunIds } from './requirementReview.js'
import { runRequirementExtraction, extractionSuccessMessage, extractionCoverageWarning } from './extractRequirements.js'

const RUNS = 'document_processing_runs'

// 回傳 { runs, docs, versions, aiCount }。runs 已合併「最近一次完成的擷取」的涵蓋率
// 警示(每個文件版本各自看最近一次 completed run——與契約兩頁 latestCompletedRunIds
// 同一判定,不能讓另一份成功文件蓋掉缺漏警示);aiCount=本包已歸檔的契約重點數。
// 任一段失敗就 throw,呼叫端統一轉 friendlyError。
export async function loadPackageRuns(packageId) {
  const [runResult, docResult] = await Promise.all([
    pageAllSafe((from, to) => supabase.from(RUNS).select('*')
      .eq('contract_package_id', packageId).order('started_at').order('id').range(from, to)),
    pageAllSafe((from, to) => supabase.from('documents').select('id, title, document_type')
      .eq('contract_package_id', packageId).order('id').range(from, to)),
  ])
  if (runResult.error) throw runResult.error
  if (docResult.error) throw docResult.error
  const docs = docResult.data
  const versionResult = await pageAllInSafe(docs.map((d) => d.id), (ids, from, to) => supabase.from('document_versions')
    .select('id, document_id, version_label, storage_path, original_filename, mime_type')
    .in('document_id', ids).order('id').range(from, to))
  if (versionResult.error) throw versionResult.error
  const versions = versionResult.data
  const ingResult = await pageAllInSafe(versions.map((v) => v.id), (ids, from, to) => supabase.from('document_ingestion_runs')
    .select('id, document_version_id, status, started_at, metadata').in('document_version_id', ids)
    .order('started_at', { ascending: false }).order('id').range(from, to))
  if (ingResult.error) throw ingResult.error
  const latestIds = latestCompletedRunIds(ingResult.data)
  const latestCoverage = new Map()
  for (const ingestion of ingResult.data) {
    if (latestIds.has(ingestion.id)) {
      latestCoverage.set(ingestion.document_version_id, extractionCoverageWarning(ingestion.metadata))
    }
  }
  const runs = runResult.data.map((run) => (
    run.metadata?.requirement_extraction === 'completed' && latestCoverage.has(run.document_version_id)
      ? { ...run, metadata: { ...run.metadata, requirement_extraction_warning: latestCoverage.get(run.document_version_id) } }
      : run
  ))
  const reqResult = await pageAllInSafe(ingResult.data.map((r) => r.id), (ids, from, to) => supabase.from('requirements')
    .select('id').eq('status', 'approved').in('ingestion_run_id', ids).order('id').range(from, to))
  if (reqResult.error) throw reqResult.error
  return { runs, docs, versions, aiCount: reqResult.data.length }
}

// 中斷復原:過期的 pending/processing 列蓋成誠實、可重試的 partial(判定在
// staleProcessingPatch)。回傳換好列的新陣列;寫入失敗的列原樣保留(下次載入再修)。
// shouldContinue:每一筆寫入前再問一次還要不要(切案/切包後停手,不把別包的列改掉)。
export async function healStaleRuns(runs, { now = Date.now(), shouldContinue = () => true } = {}) {
  const healed = [...(runs || [])]
  for (let i = 0; i < healed.length; i++) {
    const patch = staleProcessingPatch(healed[i], now)
    if (!patch || !shouldContinue()) continue
    const { data } = await supabase.from(RUNS).update(patch).eq('id', healed[i].id).select().single()
    if (data) healed[i] = data
  }
  return healed
}

// 抽取前提:文件真的有逐頁文字。上傳失敗/掃描檔的 run 沒有 document_pages,打抽取
// 必吃 422 還會把真正的失敗原因(檔案太大/掃描檔)蓋成錯誤診斷(W14 審查);
// page_count>0=本批已落頁,requirement_extraction 有值=舊資料曾成功路由過
// (legacy 列 metadata 可能缺 page_count)。
export function canRerouteExtraction(run, documentType) {
  const hasPages = Number(run?.metadata?.page_count || 0) > 0
    || run?.metadata?.requirement_extraction != null
  return EXTRACTABLE_DOCUMENT_TYPES.includes(documentType)
    && !!run?.parser_type && run.parser_type !== 'none' && hasPages
}

// 修正/確認分類 → 視需要重新路由 AI 分析(也是「重試」的路徑)。
// 回傳(擇一):
// * { ok: true, run }                        —— 收尾寫入的伺服器列(select 失敗時 null)
// * { ok: false, inProgress: true, message } —— 已有別的解析在跑(409 run_conflict):
//                                               不可蓋寫成失敗,交持有那條解析的呼叫端收尾
// * { ok: false, inProgress: false, message }—— 分類寫入失敗,後續一步都沒做
// 回呼:onDocumentTyped(documentId, type) 在文件分類落庫後;onRunPatch(fields) 在
// run 重啟與每次進度心跳——fields 是 run 列的部分欄位,呼叫端自己合併進畫面。
// 防連點的鎖不在這裡:同步 check-and-set 必須貼著事件處理器(W13 審查)。
export async function reclassifyProcessingRun({ run, newType, documentId, projectId, onRunPatch, onDocumentTyped }) {
  if (documentId) {
    const { error } = await supabase.from('documents').update({ document_type: newType }).eq('id', documentId)
    if (error) return { ok: false, inProgress: false, message: friendlyError(error, '分類更新失敗') }
    onDocumentTyped?.(documentId, newType)
  }
  const patch = { classification_status: 'confirmed' }
  if (!canRerouteExtraction(run, newType)) {
    // 改成非抽取類型時,舊的「找到 N 項契約重點」訊息不能留著騙人——
    // 資料(建議仍在審查佇列)與畫面要說同一件事(W14 審查)
    const staleExtraction = run.metadata?.requirement_extraction === 'completed'
    const { data } = await supabase.from(RUNS).update({
      ...patch,
      ...(staleExtraction ? {
        metadata: {
          ...(run.metadata || {}),
          requirement_extraction: 'skipped',
          requirement_extraction_warning: null,
          requirement_extraction_message: '已改為非抽取類型;先前抽取的建議仍保留於審查佇列',
          routed_document_type: newType,
        },
      } : {}),
    }).eq('id', run.id).select().single()
    return { ok: true, run: data || null }
  }
  // started_at 一併重設:staleProcessingPatch 以它起算 20 分鐘過期,不重設的話
  // 「上傳很久之後才確認分類/重試」會被輪詢立刻誤判成中斷
  const restart = {
    ...patch, status: 'processing', stage: 'extracting_requirements',
    started_at: new Date().toISOString(), completed_at: null, error_message: null,
  }
  await supabase.from(RUNS).update(restart).eq('id', run.id)
  onRunPatch?.(restart)
  // W13:大文件伺服器端分段續跑,共用接力層負責 in_progress 接續;每段進度
  // 更新畫面並 best-effort 落庫(重新整理也看得到第 N/M 批)
  const result = await runRequirementExtraction({
    documentVersionId: run.document_version_id,
    projectId,
    onProgress: (p) => {
      const metadata = {
        ...(run.metadata || {}),
        extraction_progress: `${p.batches_completed}/${p.batches_total}`,
        // 進度心跳:staleProcessingPatch 用它判定「還活著」,長文件多段續跑的
        // 總時長可以正當超過 20 分鐘
        extraction_progress_at: new Date().toISOString(),
      }
      onRunPatch?.({ metadata })
      supabase.from(RUNS).update({ metadata }).eq('id', run.id).then(() => {}, () => {})
    },
  })
  if (!result.ok && result.inProgress) {
    // W13 殭屍事故裡,連點的 409 一路把活著的解析蓋成失敗。顯示伺服器原話;
    // friendlyError 不會動繁中原話,只擋 body 讀不到時的 generic 英文。
    return { ok: false, inProgress: true, message: friendlyError(result.message, '此文件已有解析在進行中，請稍候') }
  }
  const failed = !result.ok
  const data = result.ok ? result.data : null
  const { data: final } = await supabase.from(RUNS).update({
    ...patch,
    status: failed ? 'partial' : 'completed',
    stage: failed ? 'failed' : 'completed',
    completed_at: new Date().toISOString(),
    error_message: failed ? (result.message || 'AI 分析失敗') : null,
    metadata: {
      ...(run.metadata || {}),
      requirement_extraction: failed ? 'failed' : 'completed',
      // W10 揭露截斷:coverage_incomplete 時「找到 N 項」必須連著講清楚沒讀到哪裡
      requirement_extraction_message: failed ? result.message : extractionSuccessMessage(data),
      requirement_extraction_warning: data ? extractionCoverageWarning(data) : null,
      routed_document_type: newType,
    },
  }).eq('id', run.id).select().single()
  return { ok: true, run: final || null }
}
