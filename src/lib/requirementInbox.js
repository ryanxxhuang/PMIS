// P0-07.5 review inbox presentation (pure).
// /requirements is a human review inbox, not a database browser: the primary
// surface is three tabs and a plain-language summary. Internal vocabulary
// (ingestion run, prompt version, model, origin, latest successful run) never
// appears here - it belongs to the 追溯資訊 panel only.
import { inDefaultReviewScope, sortForReviewQueue } from './requirementReview.js'

export const INBOX_TABS = Object.freeze([
  { key: 'pending', label: '待我確認' },
  { key: 'all', label: '全部要求' },
  { key: 'approved', label: '已核定' },
])

export const PENDING_STATUSES = Object.freeze(['needs_review', 'draft_ai'])

// User-facing review actions -> internal decisions. The raw lifecycle
// vocabulary is never a primary label.
export const REVIEW_ACTION_LABELS = Object.freeze({
  approve: '核定為履約要求',
  edit: '修正',
  reject: '不列入',
  supersede: '廢止取代',
})

// Tab partition. 待我確認 shows only current-scope suggestions (manual +
// latest completed extraction of each document); nothing is deleted - older
// runs stay reachable through 篩選.
export function partitionInboxTabs(rows, currentRunIds) {
  const pending = sortForReviewQueue(
    (rows || []).filter((r) => PENDING_STATUSES.includes(r.status)
      && inDefaultReviewScope(r, currentRunIds)),
  )
  const all = sortForReviewQueue(rows || [])
  const approved = sortForReviewQueue((rows || []).filter((r) => r.status === 'approved'))
  return { pending, all, approved }
}

// Plain-language summary for the inbox header.
// verificationByReq: Map(id -> 'verified'|'unverified'|'none')
export function buildInboxSummary(rows, { verificationByReq = new Map(), currentRunIds = new Set() } = {}) {
  const scoped = (rows || []).filter((r) => inDefaultReviewScope(r, currentRunIds))
  const pending = scoped.filter((r) => PENDING_STATUSES.includes(r.status))
  return {
    total: scoped.length,
    pending: pending.length,
    verified: scoped.filter((r) => verificationByReq.get(r.id) === 'verified').length,
    deadlines: scoped.filter((r) => r.requirement_type === 'deadline' || r.trigger_type != null).length,
    submittals: scoped.filter((r) => r.requirement_type === 'submittal').length,
    inspections: scoped.filter(
      (r) => r.requirement_type === 'inspection' || r.requirement_type === 'test',
    ).length,
    approved: scoped.filter((r) => r.status === 'approved').length,
  }
}

// "AI 從「施工契約」找到 N 項" - resolve each AI row's package title through
// run -> version -> document -> package; falls back to a generic label.
export function summarySourceLabel(rows, { runsById = new Map(), versionsById = new Map(), packagesById = new Map() } = {}) {
  const titles = new Set()
  for (const r of rows || []) {
    if (r.origin !== 'ai' || !r.ingestion_run_id) continue
    const run = runsById.get(r.ingestion_run_id)
    const version = run ? versionsById.get(run.document_version_id) : null
    const packageId = version?.documents?.contract_package_id
    const pkg = packageId ? packagesById.get(packageId) : null
    if (pkg?.display_title) titles.add(pkg.display_title)
  }
  if (titles.size === 1) return [...titles][0]
  if (titles.size > 1) return '契約文件'
  return '契約文件'
}
