// P0-06 pure helpers for AI requirement extraction (no I/O, no Deno APIs).
// Everything the extract-requirements Edge Function must decide
// deterministically lives here so it can be unit-tested:
// * enum validation/normalization of model output (the model never adds
//   vocabulary - invalid required enums reject the item, invalid optional
//   enums fall back to null with a recorded warning);
// * mapping model work-item references (W1..Wn) back to real work_items.id -
//   the LLM never emits UUIDs, so it cannot invent them;
// * deterministic per-run suggestion IDs so retrying a persistence step inside
//   the same run cannot insert duplicates.

export const PROMPT_VERSION = 'extract-requirements/v2'

// P0-07.5: extraction focus routed by the classified document type. Unknown
// types get no special focus (generic obligations prompt).
export const EXTRACTION_FOCUS: Record<string, string> = {
  contract:
    '本文件為契約條款:優先找出期限與週期義務、應提送/申報的文件(含開工前計畫書)、' +
    '通知與核准義務、各方責任分工、與罰則綁定的義務、應留存的佐證。',
  specification:
    '本文件為施工/技術規範:優先找出檢驗與試驗要求、允收/合格標準(含數值)、' +
    '取樣與試驗頻率、應留存的品質佐證(試驗報告/檢驗紀錄)。',
  quality_plan:
    '本文件為品質計畫:優先找出檢驗停留點、自主檢查要求、應建立的品質紀錄、' +
    '人員資格與訓練要求。',
  itp:
    '本文件為檢驗及測試計畫(ITP):優先找出檢驗停留點(見證點/停留點/文審點)、' +
    '通知監造的時機、見證與停留程序、各點的允收標準。',
}

// Vocabulary mirrors the P0-01 requirement domain (src/lib/requirements.js and
// the requirements table CHECK constraints) plus the legacy contract phase /
// trigger vocabulary already used by contract_obligations and lib/contractDue.
export const REQUIREMENT_TYPES = [
  'deadline', 'submittal', 'inspection', 'test', 'checklist',
  'evidence', 'photo', 'report', 'other',
] as const
export const RESPONSIBLE_PARTY_TYPES = ['agency', 'supervisor', 'contractor', 'other'] as const
export const LIFECYCLE_PHASES = ['開工前', '施工中', '完工', '保固'] as const
export const TRIGGER_TYPES = [
  'award', 'notice', 'commencement', 'completion', 'monthly', 'fixed', 'other',
] as const
export const OFFSET_DIRS = ['before', 'after'] as const
export const FREQUENCY_TYPES = ['monthly'] as const

const asTrimmed = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t === '' ? null : t
}

const inList = (value: string | null, list: readonly string[]): boolean =>
  value != null && list.includes(value)

export interface ValidatedSuggestion {
  title: string
  description: string | null
  requirement_type: string
  responsible_party_type: string | null
  lifecycle_phase: string | null
  trigger_type: string | null
  trigger_config: Record<string, unknown>
  frequency_type: string | null
  frequency_config: Record<string, unknown>
  acceptance_criteria: string | null
  evidence_requirement: string | null
  confidence: number | null
  source: {
    page_number: number | null
    section: string | null
    clause: string | null
    quotation: string | null
  }
  candidate_work_items: string[]
  warnings: string[]
}

export type SuggestionCheck =
  | { ok: true; value: ValidatedSuggestion }
  | { ok: false; reason: string }

// Normalize one raw model suggestion. Rejection (ok:false) is reserved for
// items that cannot be represented in the requirement domain at all; softer
// problems are coerced to null and reported as warnings so a single bad field
// never sinks the whole run.
export function validateSuggestion(raw: unknown): SuggestionCheck {
  if (raw == null || typeof raw !== 'object') {
    return { ok: false, reason: 'not an object' }
  }
  const r = raw as Record<string, unknown>
  const warnings: string[] = []

  const title = asTrimmed(r.title)
  if (!title) return { ok: false, reason: 'missing title' }

  const requirementType = asTrimmed(r.requirement_type)
  if (!inList(requirementType, REQUIREMENT_TYPES)) {
    return { ok: false, reason: `invalid requirement_type: ${String(r.requirement_type)}` }
  }

  const optionalEnum = (
    field: string, value: unknown, list: readonly string[],
  ): string | null => {
    const v = asTrimmed(value)
    if (v == null) return null
    if (list.includes(v)) return v
    warnings.push(`invalid ${field}: ${v}`)
    return null
  }

  const responsible = optionalEnum(
    'responsible_party_type', r.responsible_party_type, RESPONSIBLE_PARTY_TYPES)
  const lifecyclePhase = optionalEnum('lifecycle_phase', r.lifecycle_phase, LIFECYCLE_PHASES)
  const triggerType = optionalEnum('trigger_type', r.trigger_type, TRIGGER_TYPES)
  const frequencyType = optionalEnum('frequency_type', r.frequency_type, FREQUENCY_TYPES)

  // trigger_config only carries fields that survive validation; a dropped
  // trigger_type drops its config with it.
  const triggerConfig: Record<string, unknown> = {}
  if (triggerType != null) {
    const rawConfig = (r.trigger_config ?? {}) as Record<string, unknown>
    const offsetDays = Number(rawConfig.offset_days)
    if (Number.isInteger(offsetDays) && offsetDays > 0) triggerConfig.offset_days = offsetDays
    const offsetDir = asTrimmed(rawConfig.offset_dir)
    if (inList(offsetDir, OFFSET_DIRS)) triggerConfig.offset_dir = offsetDir
    const fixedDate = asTrimmed(rawConfig.fixed_date)
    if (triggerType === 'fixed' && fixedDate != null) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(fixedDate)) triggerConfig.fixed_date = fixedDate
      else warnings.push(`invalid fixed_date: ${fixedDate}`)
    }
  }

  const frequencyConfig: Record<string, unknown> = {}
  if (frequencyType === 'monthly') {
    const day = Number(((r.frequency_config ?? {}) as Record<string, unknown>).day)
    if (Number.isInteger(day) && day >= 1 && day <= 31) frequencyConfig.day = day
  }

  let confidence: number | null = null
  if (typeof r.confidence === 'number' && Number.isFinite(r.confidence)) {
    confidence = Math.min(1, Math.max(0, r.confidence))
  }

  const rawSource = (r.source ?? {}) as Record<string, unknown>
  const pageNumberRaw = Number(rawSource.page_number)
  const pageNumber = Number.isInteger(pageNumberRaw) && pageNumberRaw > 0 ? pageNumberRaw : null

  const rawRefs = Array.isArray(r.candidate_work_items) ? r.candidate_work_items : []
  const candidateWorkItems = [...new Set(
    rawRefs.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean),
  )].slice(0, 5)

  return {
    ok: true,
    value: {
      title,
      description: asTrimmed(r.description),
      requirement_type: requirementType as string,
      responsible_party_type: responsible,
      lifecycle_phase: lifecyclePhase,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      frequency_type: frequencyType,
      frequency_config: frequencyConfig,
      acceptance_criteria: asTrimmed(r.acceptance_criteria),
      evidence_requirement: asTrimmed(r.evidence_requirement),
      confidence,
      source: {
        page_number: pageNumber,
        section: asTrimmed(rawSource.section),
        clause: asTrimmed(rawSource.clause),
        quotation: asTrimmed(rawSource.quotation),
      },
      candidate_work_items: candidateWorkItems,
      warnings,
    },
  }
}

export interface WorkItemCatalogEntry {
  ref: string
  id: string
  item_no: string | null
  description: string
}

export interface WorkItemCatalog {
  entries: WorkItemCatalogEntry[]
  byRef: Map<string, WorkItemCatalogEntry>
}

// Bounded catalog handed to the model: stable refs (W1..Wn) over real BOQ
// leaf rows. Only identity fields - never unit prices, amounts, or any
// contractor-private cost value.
export function buildWorkItemCatalog(
  workItems: Array<{ id: string; item_no?: string | null; description?: string | null; is_leaf?: boolean | null; is_rollup?: boolean | null }>,
  limit = 300,
): WorkItemCatalog {
  const leaves = workItems
    .filter((w) => w.is_leaf === true && w.is_rollup !== true)
    .slice(0, limit)
  const entries = leaves.map((w, i) => ({
    ref: `W${i + 1}`,
    id: w.id,
    item_no: w.item_no ?? null,
    description: w.description ?? '',
  }))
  return { entries, byRef: new Map(entries.map((e) => [e.ref, e])) }
}

// Model refs -> real work_items.id. Unknown refs are dropped (never guessed),
// duplicates collapse to one link.
export function mapWorkItemRefs(refs: string[], catalog: WorkItemCatalog): string[] {
  const ids: string[] = []
  for (const ref of refs) {
    const entry = catalog.byRef.get(ref.trim().toUpperCase())
    if (entry && !ids.includes(entry.id)) ids.push(entry.id)
  }
  return ids
}

// Deterministic UUID from a stable name (SHA-256 based, v5-style version and
// variant bits). Suggestion identity is `${runId}:requirement:${index}`, so a
// retried persistence step inside the same run upserts the same rows instead
// of inserting duplicates. LLM wording is deliberately NOT part of identity.
export async function deterministicUuid(name: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name)),
  ).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
