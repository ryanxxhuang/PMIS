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
import { pageAllSafe } from './pagedQuery.js'
import { extractDocumentPages, hasExtractableText } from './documentExtract.js'
import { fileKind, analysisSupport, storedLimitationLabel } from './packageFileSupport.js'
import { classifyDocument, shouldExtractRequirements } from './documentClassifier.js'

export const UPLOAD_CONCURRENCY = 2
export const PROCESSING_STALE_MS = 20 * 60 * 1000
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
  extracting_requirements: '正在分析履約要求',
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
export function staleProcessingPatch(run, now = Date.now(), threshold = PROCESSING_STALE_MS) {
  if (!['pending', 'processing'].includes(run?.status)) return null
  const started = new Date(run.started_at).getTime()
  if (!Number.isFinite(started) || now - started < threshold) return null
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

async function upsertRun(run) {
  const { data, error } = await supabase
    .from('document_processing_runs')
    .upsert(run, { onConflict: 'document_version_id' })
    .select()
    .single()
  if (error) throw new Error(`處理狀態寫入失敗:${error.message}`)
  return data
}

async function insertPages(pages, versionId) {
  for (let i = 0; i < pages.length; i += PAGE_INSERT_BATCH) {
    const batch = pages
      .slice(i, i + PAGE_INSERT_BATCH)
      .map((p) => ({ ...p, document_version_id: versionId }))
    const { error } = await supabase.from('document_pages').insert(batch)
    if (error) throw new Error(`逐頁保存失敗:${error.message}`)
  }
}

// Process ONE file end to end. Never throws for per-file business failures -
// the returned run row carries the honest status instead.
async function processPackageFile({ file, packageRow, projectId, userId, onRun }) {
  const filename = file.name || '未命名文件'
  const kind = fileKind(filename, file.type || '')
  const analyzable = analysisSupport(kind) === 'full'
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
      extractionError = e?.message || '讀取文件失敗'
    }
  }
  const firstText = pages
    .slice(0, FIRST_TEXT_SAMPLE_PAGES)
    .map((p) => p.extracted_text)
    .join('\n')
  const classification = classifyDocument({
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
    return report({
      contract_package_id: packageRow.id, document_version_id: versionId,
      project_id: projectId,
      status: 'failed', stage: 'failed',
      completed_at: new Date().toISOString(),
      error_message: `原始檔上傳失敗:${uploadError.message}`,
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
    const { data, error } = await supabase.functions.invoke('extract-requirements', {
      body: { document_version_id: versionId, project_id: projectId },
    })
    if (error || data?.error) {
      extractionState = 'failed'
      extractionMessage = data?.error || error?.message || 'AI 分析失敗'
    } else {
      extractionState = 'completed'
      extractionMessage = `找到 ${data?.extracted_requirement_count ?? 0} 項履約要求建議`
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

// Whole-package upload. Returns per-file results plus the extracted text of
// trusted contract-type files so the caller can feed the LEGACY deadline
// parser once per batch (no second upload of the same files).
export async function uploadFilesToPackage({
  files, packageRow, projectId, userId, onRun,
}) {
  const contractTexts = []
  const results = await mapWithConcurrency([...files], UPLOAD_CONCURRENCY, async (file) => {
    const run = await processPackageFile({ file, packageRow, projectId, userId, onRun })
    if (run?.suggested_document_type === 'contract'
      && run.classification_status === 'auto_accepted'
      && packageRow.package_type === 'construction') {
      try {
        // 契約全文可達上千頁,不分頁只會拿到前 1,000 頁
        const { data: pageRows } = await pageAllSafe((from, to) => supabase
          .from('document_pages')
          .select('extracted_text')
          .eq('document_version_id', run.document_version_id)
          .order('page_number').order('id').range(from, to))
        if (pageRows?.length) {
          contractTexts.push(pageRows.map((p) => p.extracted_text).join('\n'))
        }
      } catch { /* legacy deadline text is best-effort */ }
    }
    return run
  })
  const runs = results.filter((r) => r.ok).map((r) => r.value)
  const failures = results.filter((r) => !r.ok).map((r) => r.error?.message || String(r.error))
  return { runs, failures, contractTexts }
}
