// P0-07 requirement review presentation and queue helpers (pure functions).
// The Requirements page queries bounded data from Supabase; everything that
// decides what the reviewer sees - default queue scope, ordering, filters,
// source/citation labels - lives here so it is deterministic and testable.

export const REVIEW_DECISIONS = Object.freeze(['approve', 'reject', 'supersede'])

export const REQUIREMENT_STATUS_LABELS = Object.freeze({
  draft_ai: 'AI 草稿',
  needs_review: '待人工確認',
  approved: '已核定',
  rejected: '已駁回',
  superseded: '已廢止取代',
})

export const REQUIREMENT_TYPE_LABELS = Object.freeze({
  deadline: '期限', submittal: '送審', inspection: '檢驗', test: '試驗',
  checklist: '檢查表', evidence: '佐證', photo: '照片', report: '報告', other: '其他',
})

export const RESPONSIBLE_LABELS = Object.freeze({
  agency: '機關', supervisor: '監造', contractor: '廠商', other: '其他',
})

export const ORIGIN_LABELS = Object.freeze({
  ai: 'AI 擷取', manual: '人工建立', migration: '契約轉入',
})

export const WORK_ITEM_LINK_STATE_LABELS = Object.freeze({
  suggested: 'AI 建議', approved: '已核可', rejected: '已駁回',
})

export const ARTIFACT_TYPE_LABELS = Object.freeze({
  inspection_point: '檢驗停留點', checklist: '檢查表範本', test: '取樣試驗',
  submittal: '送審文件', evidence: '佐證照片', deadline: '契約期限',
})

export const GENERATION_TYPE_LABELS = Object.freeze({
  manual: '人工', ai_draft: 'AI 草稿', migration: '轉入',
})

// The current review scope for AI suggestions: the latest COMPLETED run per
// document version. Failed / processing / pending runs never define scope,
// and older completed runs stay inspectable through the explicit run filter.
export function latestCompletedRunIds(runs) {
  const latestByVersion = new Map()
  for (const run of runs || []) {
    if (run.status !== 'completed') continue
    const current = latestByVersion.get(run.document_version_id)
    if (!current || new Date(run.started_at) > new Date(current.started_at)) {
      latestByVersion.set(run.document_version_id, run)
    }
  }
  return new Set([...latestByVersion.values()].map((run) => run.id))
}

// Default queue membership: manual / migration Requirements always belong;
// AI suggestions only when they come from the current (latest completed) run
// of their document version.
export function inDefaultReviewScope(requirement, currentRunIds) {
  if (requirement.origin !== 'ai') return true
  return requirement.ingestion_run_id != null
    && currentRunIds.has(requirement.ingestion_run_id)
}

const STATUS_ORDER = { needs_review: 0, draft_ai: 1, approved: 2, rejected: 3, superseded: 4 }

// Deterministic review ordering: needs_review first, then draft_ai, then the
// reviewed states; within a status oldest first, id as the final tiebreak.
export function sortForReviewQueue(list) {
  return [...(list || [])].sort((a, b) => {
    const byStatus = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    if (byStatus !== 0) return byStatus
    const byCreated = new Date(a.created_at) - new Date(b.created_at)
    if (byCreated !== 0) return byCreated
    return String(a.id).localeCompare(String(b.id))
  })
}

// verificationByRequirement: Map(requirement_id -> 'verified'|'unverified'|'none')
export function filterRequirements(list, filters = {}, verificationByRequirement = new Map()) {
  return (list || []).filter((r) => {
    if (filters.status && r.status !== filters.status) return false
    if (filters.requirement_type && r.requirement_type !== filters.requirement_type) return false
    if (filters.responsible_party_type
      && r.responsible_party_type !== filters.responsible_party_type) return false
    if (filters.origin && r.origin !== filters.origin) return false
    if (filters.ingestion_run_id && r.ingestion_run_id !== filters.ingestion_run_id) return false
    if (filters.verification
      && (verificationByRequirement.get(r.id) || 'none') !== filters.verification) return false
    return true
  })
}

// Aggregate a requirement's sources into one verification state for filtering:
// any verified source -> 'verified'; sources but none verified -> 'unverified'.
export function sourceVerificationSummary(sources) {
  if (!sources?.length) return 'none'
  return sources.some((s) => s.source_verified) ? 'verified' : 'unverified'
}

// Citation page display: a persisted page number is grounded in stored
// document_pages (P0-06), so it may be shown as a contractual page. A null
// page (DOCX unpaginated or ungrounded claim) must say so - never a storage
// segment index.
export function sourcePageLabel(source) {
  return source?.page_number == null ? '無可靠頁碼' : `第 ${source.page_number} 頁`
}

// Neutral verification labels - deterministic check result, not an AI promise.
export function sourceVerificationLabel(source) {
  return source?.source_verified ? '來源已核對' : '來源待人工確認'
}

const TRIGGER_LABELS = {
  award: '決標', notice: '接獲開工通知', commencement: '開工',
  completion: '完工', monthly: '每月', fixed: '指定日期', other: '其他',
}

// Readable trigger/frequency line instead of raw JSON config.
export function formatRequirementRule(requirement) {
  if (!requirement) return ''
  if (requirement.frequency_type === 'monthly') {
    const day = requirement.frequency_config?.day
    return day ? `每月 ${day} 日` : '每月'
  }
  if (!requirement.trigger_type) return ''
  const config = requirement.trigger_config || {}
  if (requirement.trigger_type === 'fixed') {
    return config.fixed_date ? `指定 ${config.fixed_date}` : '指定日期'
  }
  const base = TRIGGER_LABELS[requirement.trigger_type] || requirement.trigger_type
  if (config.offset_days) {
    return `${base}${config.offset_dir === 'before' ? '前' : '後'} ${config.offset_days} 日內`
  }
  return base
}
