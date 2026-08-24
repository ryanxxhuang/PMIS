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

// 頻率維度(檢索頁篩選):循環義務照 frequency_type 分桶,非循環分「一次性」
// (有觸發時點)與「無明確時點」。標籤表涵蓋抽取引擎未來的值域(每日/每週/
// 每季/每年);引擎目前只會產 monthly,值域擴充時這裡自動跟上,未知值原樣顯示。
export const FREQUENCY_LABELS = Object.freeze({
  daily: '每日', weekly: '每週', monthly: '每月', quarterly: '每季', yearly: '每年',
})
export function requirementFrequencyKey(requirement) {
  if (requirement?.frequency_type) {
    return FREQUENCY_LABELS[requirement.frequency_type] || requirement.frequency_type
  }
  return requirement?.trigger_type ? '一次性' : '無明確時點'
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

const HIGHLIGHT_TYPE_ORDER = Object.freeze({
  deadline: 0, submittal: 1, inspection: 2, test: 2, checklist: 3,
  evidence: 4, photo: 4, report: 4, other: 5,
})
const VERIFICATION_ORDER = Object.freeze({ verified: 0, unverified: 1, none: 2 })

const normalizedText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

// W8-3B 只合併完全相同的呈現內容。這是 UI 去重 key，不更改 DB 列，
// 也不做模糊／語意合併，避免把不同契約條款誤當成同一件事。
export function requirementHighlightKey(requirement) {
  const r = requirement || {}
  return [
    r.requirement_type, r.responsible_party_type, r.lifecycle_phase,
    r.title, r.description, r.trigger_type, stableJson(r.trigger_config),
    r.frequency_type, stableJson(r.frequency_config),
    r.acceptance_criteria, r.evidence_requirement,
  ].map(normalizedText).join('\u001f')
}

function compareHighlightRows(a, b, verificationByRequirement) {
  const typeOrder = (HIGHLIGHT_TYPE_ORDER[a.requirement_type] ?? 9)
    - (HIGHLIGHT_TYPE_ORDER[b.requirement_type] ?? 9)
  if (typeOrder !== 0) return typeOrder
  const verificationOrder = (VERIFICATION_ORDER[verificationByRequirement.get(a.id) || 'none'] ?? 9)
    - (VERIFICATION_ORDER[verificationByRequirement.get(b.id) || 'none'] ?? 9)
  if (verificationOrder !== 0) return verificationOrder
  const createdA = Number.isNaN(new Date(a.created_at).getTime()) ? 0 : new Date(a.created_at).getTime()
  const createdB = Number.isNaN(new Date(b.created_at).getTime()) ? 0 : new Date(b.created_at).getTime()
  if (createdA !== createdB) return createdA - createdB
  return String(a.id).localeCompare(String(b.id))
}

function groupHighlights(rows, verificationByRequirement) {
  const grouped = new Map()
  for (const requirement of rows || []) {
    const key = requirementHighlightKey(requirement)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(requirement)
  }
  return [...grouped.entries()].map(([key, requirements]) => {
    const sorted = [...requirements].sort((a, b) => compareHighlightRows(a, b, verificationByRequirement))
    return { key, requirement: sorted[0], requirements: sorted }
  }).sort((a, b) => compareHighlightRows(a.requirement, b.requirement, verificationByRequirement))
}

// 已核定契約事實不受最新 run 限制；未核定 AI 則只取每個文件版本的
// 最新成功 run。rejected/superseded 只存在追溯清單，不進一般契約重點。
export function buildRequirementHighlights(
  requirements,
  currentRunIds,
  verificationByRequirement = new Map(),
) {
  const approved = groupHighlights(
    (requirements || []).filter((r) => r.status === 'approved'),
    verificationByRequirement,
  )
  const approvedKeys = new Set(approved.map((group) => group.key))
  const suggestions = groupHighlights(
    (requirements || []).filter((r) => (
      ['draft_ai', 'needs_review'].includes(r.status)
      && inDefaultReviewScope(r, currentRunIds)
      && !approvedKeys.has(requirementHighlightKey(r))
    )),
    verificationByRequirement,
  )
  return { approved, suggestions }
}

