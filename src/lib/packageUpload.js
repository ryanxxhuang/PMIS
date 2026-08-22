// P0-07.5 contract-package upload orchestration (browser side).
// One upload flow for the whole package:
//
//   pick package -> pick many files -> per file (bounded concurrency):
//     read + checksum -> extract text (PDF/DOCX/TXT) -> classify ->
//     get-or-create document (filed in the package) ->
//     get-or-create immutable version (storage_path set at INSERT) ->
//     upload original binary to the private bucket ->
//     persist document_pages -> route trusted types to extract-requirements ->
//     persist an honest per-file processing run at every stage
//
// Progress is persisted in document_processing_runs, so leaving the page or
// refreshing never loses state. One file's failure never fails the package.
// Retries are idempotent: same content -> same checksum -> same version ->
// same processing-run row (unique on document_version_id).
import { supabase } from './supabase.js'
import { friendlyError } from './errorMessage.js'
import { extractDocumentPages, hasExtractableText } from './documentExtract.js'
import { fileKind, analysisSupport, storedLimitationLabel } from './packageFileSupport.js'
import { classifyDocument, shouldExtractRequirements, AUTO_ACCEPT_THRESHOLD } from './documentClassifier.js'
import { runRequirementExtraction, extractionSuccessMessage } from './extractRequirements.js'

export const UPLOAD_CONCURRENCY = 2
export const PROCESSING_STALE_MS = 20 * 60 * 1000
// 單檔上限:對齊 Supabase Dashboard「Storage → Upload file size limit」的設定值,
// 調整那邊要同步改這裡(W14 建議值 300MB;預檢在前端先擋,伺服器超限另有特判訊息)
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024
const PAGE_INSERT_BATCH = 200
const FIRST_TEXT_SAMPLE_PAGES = 3

// FileList is live: clearing the input before copying it empties the selection.
export function takeSelectedFiles(input) {
  const files = [...(input?.files || [])].filter(Boolean)
  if (input) input.value = ''
  return files
}

export const STAGE_ORDER = Object.freeze({
  received: 0, uploaded: 1, extracting_text: 2, classifying: 3,
  extracting_requirements: 4, completed: 5, failed: 5, unsupported: 5,
})

export const STAGE_LABELS = Object.freeze({
  received: '已收到',
  uploaded: '已上傳',
  extracting_text: '正在讀取文字',
  classifying: '正在辨識文件類型',
  extracting_requirements: '正在分析契約重點',
  completed: '已完成',
  failed: '處理失敗',
  unsupported: '尚未支援內容分析',
})

export const RUN_STATUS_LABELS = Object.freeze({
  pending: '等待處理',
  processing: '處理中',
  completed: '已完成',
  partial: '部分完成',
  failed: '處理失敗',
  unsupported: '已收到',
})

// Real stage counts for the package progress header - no fake percentages.
export function summarizePackageProgress(runs) {
  const rows = runs || []
  const terminal = (r) => ['completed', 'partial', 'failed', 'unsupported'].includes(r.status)
  const uploaded = (r) => r.stage !== 'received'
    && (r.status !== 'failed' || !!r.metadata?.storage_path)
  const textExtracted = (r) => Number(r.metadata?.page_count || 0) > 0
    || ['classifying', 'extracting_requirements', 'completed'].includes(r.stage)
  const analyzable = rows.filter((r) => r.parser_type && r.parser_type !== 'none')
  return {
    total: rows.length,
    uploaded: rows.filter(uploaded).length,
    textExtracted: analyzable.filter(textExtracted).length,
    classified: rows.filter((r) => r.suggested_document_type != null).length,
    requirementsAnalyzed: rows.filter(
      (r) => r.status === 'completed' && r.metadata?.requirement_extraction === 'completed',
    ).length,
    completed: rows.filter((r) => r.status === 'completed').length,
    partial: rows.filter((r) => r.status === 'partial').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    unsupported: rows.filter((r) => r.status === 'unsupported').length,
    needsClassification: rows.filter((r) => r.classification_status === 'needs_review').length,
    active: rows.filter((r) => !terminal(r)).length,
  }
}

export function packageStatusFromRuns(runs) {
  const s = summarizePackageProgress(runs)
  if (s.total === 0) return 'draft'
  if (s.active > 0) return 'processing'
  if (s.failed > 0 || s.needsClassification > 0) return 'needs_attention'
  return 'ready'
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

// Browser processing can be interrupted by a refresh. Persisted rows remain
// visible immediately; after a conservative timeout they become an honest,
// retryable partial result instead of an unexplained permanent spinner.
// W13:過期起算點取「開始時間」與「最後一次抽取進度心跳」較晚者——長文件
// 多段續跑的總時長可以正當超過 20 分鐘,只要進度還在前進就不是中斷。
export function staleProcessingPatch(run, now = Date.now(), threshold = PROCESSING_STALE_MS) {
  if (!['pending', 'processing'].includes(run?.status)) return null
  const started = new Date(run.started_at).getTime()
  const progressAt = new Date(run?.metadata?.extraction_progress_at || 0).getTime()
  const lastActivity = Math.max(
    Number.isFinite(started) ? started : 0,
    Number.isFinite(progressAt) ? progressAt : 0,
  )
  if (!lastActivity || now - lastActivity < threshold) return null
  return {
    status: 'partial',
    stage: 'failed',
    completed_at: new Date(now).toISOString(),
    error_message: '處理曾被中斷；原始檔已保存，請重新上傳相同檔案繼續處理',
  }
}

// Bounded-concurrency map: keeps the browser responsive on 40+ file packages
// and isolates each file's failure into its own result.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      try {
        results[index] = { ok: true, value: await fn(items[index], index) }
      } catch (e) {
        results[index] = { ok: false, error: e }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker))
  return results
}

// storage key 是否為 Supabase 接受的合法路徑(ASCII 安全字元)。
// 用途:「相同 checksum 重用既有 version」時,若那筆 version 是修復前寫入的
// 中文壞路徑(上傳從未成功),不能重用——否則會一直撞同一筆壞紀錄,修復永遠輪不到執行。
export function isValidStorageKey(path) {
  return typeof path === 'string' && path.length > 0 && /^[A-Za-z0-9._\-/]+$/.test(path)
}

export function storagePathFor({ projectId, packageId, documentId, versionId, filename }) {
  // Supabase Storage 的物件 key 只收 S3 安全字元(ASCII)——中文或全形符號會讓整個
  // 上傳被拒(Invalid key)。dry-run 第一份真實契約「02-工務局工程採購契約(稿)-1090720.pdf」
  // 就炸在這裡:政府文件檔名幾乎都是中文,key 必須退化成 ASCII。
  // 顯示用的原始檔名存於 document_versions.original_filename,不受影響;
  // 唯一性由路徑中的 documentId/versionId 保證,檔名只是給人在 bucket 裡辨識的尾巴。
  const raw = filename || 'file'
  const ext = (raw.match(/\.[A-Za-z0-9]{1,10}$/) || [''])[0]
  const base = raw.slice(0, raw.length - ext.length)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '') || 'file'
  return `projects/${projectId}/contract-packages/${packageId}/${documentId}/${versionId}/${base}${ext}`
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// W14:AI 分類第二意見(classify-document Edge Function)。任何失敗都回 null,
// 讓上傳流程靜默退回確定性判定——分類建議永遠不值得擋掉一次上傳。
async function classifyDocumentWithAi({ versionId, projectId }) {
  try {
    const { data, error } = await supabase.functions.invoke('classify-document', {
      body: { document_version_id: versionId, project_id: projectId },
    })
    if (error || data?.error || !data?.document_type) return null
    return data
  } catch {
    return null
  }
}

async function upsertRun(run) {
  const { data, error } = await supabase
    .from('document_processing_runs')
    .upsert(run, { onConflict: 'document_version_id' })
    .select()
    .single()
  if (error) throw new Error(friendlyError(error, '處理狀態寫入失敗'))
  return data
}

async function insertPages(pages, versionId) {
  for (let i = 0; i < pages.length; i += PAGE_INSERT_BATCH) {
    const batch = pages
      .slice(i, i + PAGE_INSERT_BATCH)
      .map((p) => ({ ...p, document_version_id: versionId }))
    const { error } = await supabase.from('document_pages').insert(batch)
    if (error) throw new Error(friendlyError(error, '逐頁保存失敗'))
  }
}

// Process ONE file end to end. Never throws for per-file business failures -
// the returned run row carries the honest status instead.
async function processPackageFile({ file, packageRow, projectId, userId, onRun }) {
  const filename = file.name || '未命名文件'
  const kind = fileKind(filename, file.type || '')
  const analyzable = analysisSupport(kind) === 'full'
  // 超大檔在前端先擋:丟到伺服器也一定被 Storage 上限退回,先給人看得懂的原因
  if ((file.size ?? 0) > MAX_UPLOAD_BYTES) {
    throw new Error(`「${filename}」約 ${Math.round(file.size / 1024 / 1024)}MB,超過單檔上限 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB;請壓縮或拆分後再上傳`)
  }
  const report = async (patch) => {
    const run = await upsertRun(patch)
    onRun?.(run)
    return run
  }

  const buffer = await file.arrayBuffer()
  const checksum = `sha256:${await sha256Hex(buffer)}`

  // Text extraction first: classification wants the first page text.
  let pages = []
  let extractionError = null
  if (analyzable) {
    try {
      const extracted = await extractDocumentPages(file)
      pages = extracted.pages
      if (!pages.length || !hasExtractableText(pages)) {
        pages = []
        extractionError = '未能抽取文字（可能為掃描檔），等待 OCR 支援'
      }
    } catch (e) {
      extractionError = friendlyError(e, '讀取文件失敗')
    }
  }
  const firstText = pages
    .slice(0, FIRST_TEXT_SAMPLE_PAGES)
    .map((p) => p.extracted_text)
    .join('\n')
  let classification = classifyDocument({
    filename, firstText, analyzable: analyzable && !extractionError,
  })

  // Document: same package + same filename => same document.
  const { data: existingDoc, error: findError } = await supabase
    .from('documents')
    .select('id, document_type, contract_package_id')
    .eq('project_id', projectId)
    .eq('title', filename)
    .eq('contract_package_id', packageRow.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (findError) throw new Error(findError.message)
  let documentId = existingDoc?.id || null
  let documentType = existingDoc?.document_type || classification.document_type
  if (!documentId) {
    const { data: docRow, error } = await supabase
      .from('documents')
      .insert({
        project_id: projectId,
        title: filename,
        document_type: classification.document_type,
        contract_package_id: packageRow.id,
        created_by: userId || null,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    documentId = docRow.id
    documentType = classification.document_type
  }

  // Immutable version: identical checksum reuses the existing version.
  const { data: versions, error: versionsError } = await supabase
    .from('document_versions')
    .select('id, version_label, checksum, storage_path')
    .eq('document_id', documentId)
    .order('uploaded_at', { ascending: false })
  if (versionsError) throw new Error(versionsError.message)
  // 只重用「storage key 合法」的 version:壞路徑的那筆代表原始檔從未成功上傳,
  // 重用它等於永遠卡死在同一筆失敗紀錄(dry-run 2026-08-12 實際發生)。
  const reused = versions?.find((v) => v.checksum === checksum && isValidStorageKey(v.storage_path)) || null
  let versionId = reused?.id || null
  let storagePath = reused?.storage_path || null
  let newVersion = false
  if (!versionId) {
    versionId = crypto.randomUUID()
    // storage_path is part of the immutable version identity, so it is set
    // at INSERT time using the deterministic path.
    storagePath = storagePathFor({
      projectId, packageId: packageRow.id, documentId, versionId, filename,
    })
    const { error } = await supabase.from('document_versions').insert({
      id: versionId,
      document_id: documentId,
      version_label: `v${(versions?.length || 0) + 1}`,
      revision_number: versions?.length || 0,
      original_filename: filename,
      mime_type: file.type || null,
      file_size: file.size ?? null,
      checksum,
      storage_path: storagePath,
      uploaded_by: userId || null,
      supersedes_version_id: versions?.[0]?.id || null,
    }).select('id').single()
    if (error) throw new Error(error.message)
    newVersion = true
  }

  await report({
    project_id: projectId,
    contract_package_id: packageRow.id,
    document_version_id: versionId,
    status: 'processing',
    stage: 'received',
    parser_type: analyzable ? kind : 'none',
    started_by: userId || null,
    started_at: new Date().toISOString(),
    completed_at: null,
    error_message: null,
    metadata: { filename_kind: kind },
  })

  // Original binary into the private bucket (idempotent: 409 = already there).
  const uploadPath = storagePath || storagePathFor({
    projectId, packageId: packageRow.id, documentId, versionId, filename,
  })
  const { error: uploadError } = await supabase.storage
    .from('contract-documents')
    .upload(uploadPath, buffer, { contentType: file.type || 'application/octet-stream' })
  if (uploadError && !/exists|duplicate/i.test(uploadError.message || '')) {
    // 超過平台 Storage 上限:重傳同一份必再失敗,訊息要指向真正的解法,
    // 不能沿用「重新上傳會自動接續」的通用指引(W14:39-地質鑽探報告實案)
    const oversize = /exceeded the maximum allowed size/i.test(uploadError.message || '')
    return report({
      contract_package_id: packageRow.id, document_version_id: versionId,
      project_id: projectId,
      status: 'failed', stage: 'failed',
      completed_at: new Date().toISOString(),
      error_message: oversize
        ? '原始檔上傳失敗:檔案超過平台單檔上限。請壓縮或拆分後重新上傳;需要更大上限請調整 Supabase Storage 設定'
        : friendlyError(uploadError, '原始檔上傳失敗'),
      metadata: { filename_kind: kind },
    })
  }
  await report({
    project_id: projectId, contract_package_id: packageRow.id,
    document_version_id: versionId, status: 'processing', stage: 'uploaded',
    metadata: { filename_kind: kind, storage_path: uploadPath },
  })

  // Accepted-but-unanalyzed types stop here, honestly labeled.
  if (!analyzable) {
    return report({
      project_id: projectId, contract_package_id: packageRow.id,
      document_version_id: versionId,
      status: 'unsupported', stage: 'unsupported',
      classification_status: classification.classification_status,
      suggested_document_type: classification.document_type,
      classification_confidence: classification.confidence,
      completed_at: new Date().toISOString(),
      error_message: null,
      metadata: {
        filename_kind: kind, storage_path: uploadPath,
        limitation: storedLimitationLabel(kind),
        classification_reason: classification.reason,
      },
    })
  }

  if (extractionError) {
    // Scanned/unreadable analyzable file: binary preserved, no fake success.
    return report({
      project_id: projectId, contract_package_id: packageRow.id,
      document_version_id: versionId,
      status: 'partial', stage: 'failed',
      classification_status: classification.classification_status,
      suggested_document_type: classification.document_type,
      classification_confidence: classification.confidence,
      completed_at: new Date().toISOString(),
      error_message: extractionError,
      metadata: { filename_kind: kind, storage_path: uploadPath },
    })
  }

  await report({
    project_id: projectId, contract_package_id: packageRow.id,
    document_version_id: versionId, status: 'processing', stage: 'extracting_text',
    metadata: { filename_kind: kind, storage_path: uploadPath, page_count: pages.length },
  })
  if (newVersion) {
    const { count } = await supabase
      .from('document_pages')
      .select('id', { count: 'exact', head: true })
      .eq('document_version_id', versionId)
    if (!count) await insertPages(pages, versionId)
  } else {
    // Reused version: heal pages if an earlier attempt failed between steps.
    const { count } = await supabase
      .from('document_pages')
      .select('id', { count: 'exact', head: true })
      .eq('document_version_id', versionId)
    if (!count) await insertPages(pages, versionId)
  }

  await report({
    project_id: projectId, contract_package_id: packageRow.id,
    document_version_id: versionId, status: 'processing', stage: 'classifying',
    suggested_document_type: classification.document_type,
    classification_status: classification.classification_status,
    classification_confidence: classification.confidence,
    metadata: {
      filename_kind: kind, storage_path: uploadPath,
      page_count: pages.length, classification_reason: classification.reason,
    },
  })

  // W14 AI 分類:確定性分類器沒把握、且是第一次入庫的新文件 → 問 AI 第二意見
  // (既有文件的類型已被人或前批確認,不重問)。信心夠高就自動歸檔並照常路由
  // 抽取——使用者事後隨時可改分類;信心低只換成更好的建議,照舊進待確認。
  // AI 失敗(方案關閉/模型錯誤/網路)絕不擋上傳,靜默退回確定性判定。
  if (!existingDoc && classification.classification_status === 'needs_review' && pages.length) {
    const ai = await classifyDocumentWithAi({ versionId, projectId })
    if (ai) {
      const accepted = ai.confidence >= AUTO_ACCEPT_THRESHOLD
      classification = {
        document_type: ai.document_type,
        confidence: ai.confidence,
        reason: `AI 分類:${ai.reason}`,
        classification_status: accepted ? 'auto_accepted' : 'needs_review',
      }
      if (accepted && ai.document_type !== documentType) {
        // 自動歸檔=同步改 documents.document_type(改分類稽核 trigger 會留痕)
        const { error: retypeError } = await supabase.from('documents')
          .update({ document_type: ai.document_type }).eq('id', documentId)
        if (!retypeError) documentType = ai.document_type
      }
      await report({
        project_id: projectId, contract_package_id: packageRow.id,
        document_version_id: versionId, status: 'processing', stage: 'classifying',
        suggested_document_type: classification.document_type,
        classification_status: classification.classification_status,
        classification_confidence: classification.confidence,
        metadata: {
          filename_kind: kind, storage_path: uploadPath,
          page_count: pages.length, classification_reason: classification.reason,
        },
      })
    }
  }

  // Route only trusted, obligation-bearing types to Requirement extraction.
  const routing = shouldExtractRequirements({
    document_type: documentType,
    classification_status: existingDoc ? 'confirmed' : classification.classification_status,
  })
  let extractionState = 'skipped'
  let extractionMessage = null
  if (routing) {
    await report({
      project_id: projectId, contract_package_id: packageRow.id,
      document_version_id: versionId, status: 'processing',
      stage: 'extracting_requirements',
      metadata: { filename_kind: kind, storage_path: uploadPath, page_count: pages.length },
    })
    // W13:大文件伺服器端分多個 request 續跑,這裡負責接力;每段進度
    // best-effort 落庫,重新整理也看得到「第 N/M 批」而不是死轉圈
    const result = await runRequirementExtraction({
      documentVersionId: versionId,
      projectId,
      onProgress: (p) => report({
        project_id: projectId, contract_package_id: packageRow.id,
        document_version_id: versionId, status: 'processing',
        stage: 'extracting_requirements',
        metadata: {
          filename_kind: kind, storage_path: uploadPath, page_count: pages.length,
          extraction_progress: `${p.batches_completed}/${p.batches_total}`,
          // 進度心跳:staleProcessingPatch 據此判定續跑還活著
          extraction_progress_at: new Date().toISOString(),
        },
      }).catch(() => {}),
    })
    if (result.ok) {
      extractionState = 'completed'
      // W10 揭露截斷:未涵蓋整份文件時,成功訊息必須連著講清楚讀到哪裡
      extractionMessage = extractionSuccessMessage(result.data)
    } else if (result.inProgress) {
      // 已有別的解析在跑(同檔另開分頁/重複上傳):不可蓋寫成失敗——
      // W13 殭屍事故就是 409 一路把活著的解析蓋成失敗。run 維持 processing,
      // 由持有那條解析的呼叫端收尾;真斷頭則交 PROCESSING_STALE_MS 誠實逾時。
      return report({
        project_id: projectId, contract_package_id: packageRow.id,
        document_version_id: versionId, status: 'processing',
        stage: 'extracting_requirements',
        suggested_document_type: classification.document_type,
        classification_status: classification.classification_status,
        classification_confidence: classification.confidence,
        metadata: {
          filename_kind: kind, storage_path: uploadPath, page_count: pages.length,
          classification_reason: classification.reason,
          requirement_extraction: 'in_progress',
          requirement_extraction_message: result.message,
          routed_document_type: documentType,
        },
      })
    } else {
      extractionState = 'failed'
      extractionMessage = result.message || 'AI 分析失敗'
    }
  }

  const failedExtraction = extractionState === 'failed'
  return report({
    project_id: projectId, contract_package_id: packageRow.id,
    document_version_id: versionId,
    status: failedExtraction ? 'partial' : 'completed',
    stage: failedExtraction ? 'failed' : 'completed',
    suggested_document_type: classification.document_type,
    classification_status: classification.classification_status,
    classification_confidence: classification.confidence,
    completed_at: new Date().toISOString(),
    error_message: failedExtraction ? extractionMessage : null,
    metadata: {
      filename_kind: kind, storage_path: uploadPath, page_count: pages.length,
      classification_reason: classification.reason,
      requirement_extraction: extractionState,
      requirement_extraction_message: extractionMessage,
      routed_document_type: documentType,
    },
  })
}

// Whole-package upload. Requirement extraction is the only contractual AI
// pipeline; approved deadlines are materialized by the database review action.
export async function uploadFilesToPackage({
  files, packageRow, projectId, userId, onRun,
}) {
  const results = await mapWithConcurrency([...files], UPLOAD_CONCURRENCY, async (file) => {
    return processPackageFile({ file, packageRow, projectId, userId, onRun })
  })
  const runs = results.filter((r) => r.ok).map((r) => r.value)
  // 失敗清單會整串上畫面:原始錯誤(可能含 DB/Storage 細節)先轉安全訊息
  const failures = results.filter((r) => !r.ok).map((r) => friendlyError(r.error, '未能開始處理'))
  return { runs, failures }
}
