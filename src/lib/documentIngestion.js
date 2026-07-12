// P0-06 ingestion orchestration (browser side).
// upload file → documents row → immutable document_versions row → persist
// document_pages → call extract-requirements Edge Function (which creates the
// document_ingestion_run, calls Claude, verifies citations against the stored
// pages, and persists draft_ai / needs_review Requirement suggestions).
//
// Version strategy (deliberately minimal for P0-06):
// * same project + document_type + title(filename) → same documents row;
// * identical content (sha256 checksum matches an existing version) → reuse
//   that version and just start a new extraction run;
// * changed content → new immutable version superseding the latest one.
// Audit events (document.created / document.version_created /
// requirement.created / document.ingestion_*) all flow from P0-05 DB triggers;
// nothing is inserted into audit_events from here.
import { supabase } from './supabase.js'
import { extractDocumentPages, hasExtractableText } from './documentExtract.js'

const PAGE_INSERT_BATCH = 200

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function insertPages(pages, versionId) {
  for (let i = 0; i < pages.length; i += PAGE_INSERT_BATCH) {
    const batch = pages
      .slice(i, i + PAGE_INSERT_BATCH)
      .map((p) => ({ ...p, document_version_id: versionId }))
    const { error } = await supabase.from('document_pages').insert(batch)
    if (error) return error
  }
  return null
}

// Best-effort extraction of the Edge Function's JSON error body (supabase-js
// wraps non-2xx responses in a FunctionsHttpError whose message is generic).
async function functionErrorMessage(error) {
  try {
    const body = await error?.context?.json()
    if (body?.error) return body.error
  } catch { /* keep generic message */ }
  return error?.message || '呼叫 AI 擷取服務失敗'
}

export async function ingestRequirementDocument({ projectId, userId, file, documentType = 'contract' }) {
  let extracted
  try {
    extracted = await extractDocumentPages(file)
  } catch (e) {
    return { error: { message: e?.message || '讀取文件失敗' } }
  }
  const { pages, buffer } = extracted
  if (!pages.length || !hasExtractableText(pages)) {
    return {
      error: {
        message: '未能從文件抽取文字(可能為掃描檔或影像 PDF);P0-06 不含 OCR,無法建立可追溯的需求建議。',
      },
    }
  }
  const checksum = `sha256:${await sha256Hex(buffer)}`
  const title = file.name || '未命名文件'

  const { data: existingDoc, error: findError } = await supabase
    .from('documents')
    .select('id')
    .eq('project_id', projectId)
    .eq('document_type', documentType)
    .eq('title', title)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (findError) return { error: findError }

  let documentId = existingDoc?.id || null
  if (!documentId) {
    const { data: docRow, error } = await supabase
      .from('documents')
      .insert({
        project_id: projectId,
        title,
        document_type: documentType,
        created_by: userId || null,
      })
      .select('id')
      .single()
    if (error) return { error }
    documentId = docRow.id
  }

  const { data: versions, error: versionsError } = await supabase
    .from('document_versions')
    .select('id, version_label, checksum')
    .eq('document_id', documentId)
    .order('uploaded_at', { ascending: false })
  if (versionsError) return { error: versionsError }

  let versionId = versions?.find((v) => v.checksum === checksum)?.id || null
  if (versionId) {
    // Same content re-uploaded → reuse the immutable version; heal pages if a
    // previous attempt failed between version insert and page persistence.
    const { count } = await supabase
      .from('document_pages')
      .select('id', { count: 'exact', head: true })
      .eq('document_version_id', versionId)
    if (!count) {
      const pageError = await insertPages(pages, versionId)
      if (pageError) return { error: pageError }
    }
  } else {
    const latest = versions?.[0] || null
    const { data: versionRow, error } = await supabase
      .from('document_versions')
      .insert({
        document_id: documentId,
        version_label: `v${(versions?.length || 0) + 1}`,
        revision_number: versions?.length || 0,
        original_filename: file.name || null,
        mime_type: file.type || null,
        file_size: file.size ?? null,
        checksum,
        uploaded_by: userId || null,
        supersedes_version_id: latest?.id || null,
      })
      .select('id')
      .single()
    if (error) return { error }
    versionId = versionRow.id
    const pageError = await insertPages(pages, versionId)
    if (pageError) return { error: pageError }
  }

  const { data, error } = await supabase.functions.invoke('extract-requirements', {
    body: { document_version_id: versionId, project_id: projectId },
  })
  if (error) return { error: { message: await functionErrorMessage(error) } }
  if (data?.error) return { error: { message: data.error }, run: data }
  return { error: null, run: data, document_id: documentId, document_version_id: versionId }
}
