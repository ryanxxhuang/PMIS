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

// ── 分批抽取(W10)────────────────────────────────────────────────────────────
// 長契約一次餵給模型有兩個天花板:輸入預算截斷(漏抽後半本)與輸出 max_tokens
// 截斷(密集義務的章節回到一半被剪掉)。切批是確定性的、以頁為單位、保序:
// 每批餵一段連續頁,批間互不重疊,模型只看得到該批的頁碼——引註驗證
// (sourceVerify)仍對全文件頁面查核,批次邊界不影響 source_verified 判定。

export interface BatchPage {
  page_number: number
  extracted_text: string | null
  extraction_method: string
}

export interface DocumentBatchPlan {
  batches: BatchPage[][]
  truncated: boolean            // 超過 maxBatches 而被丟棄的頁存在
  lastIncludedPage: number | null
  omittedPageCount: number
}

// 頁列表 → 批次計畫。單頁超過 batchCharBudget 時自成一批(不切頁內文字——
// 頁是引註驗證的最小單位,切了會做出驗證不了的引註)。
export function buildDocumentBatches(
  pages: BatchPage[],
  { batchCharBudget, maxBatches }: { batchCharBudget: number; maxBatches: number },
): DocumentBatchPlan {
  const batches: BatchPage[][] = []
  let current: BatchPage[] = []
  let currentChars = 0
  let truncated = false
  let lastIncludedPage: number | null = null
  let omittedPageCount = 0

  for (const p of pages) {
    const len = (p.extracted_text || '').length
    if (current.length && currentChars + len > batchCharBudget) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    if (!current.length && batches.length >= maxBatches) {
      truncated = true
      omittedPageCount++
      continue
    }
    current.push(p)
    currentChars += len
    lastIncludedPage = p.page_number
  }
  if (current.length) batches.push(current)
  return { batches, truncated, lastIncludedPage, omittedPageCount }
}

// 撞到輸出上限(stop_reason=max_tokens)時把一批對半切重試。
// 單頁批切不動(回 null)——那是文件本身的極端,交上層記錄並跳過。
export function splitBatch(batch: BatchPage[]): [BatchPage[], BatchPage[]] | null {
  if (batch.length < 2) return null
  const mid = Math.ceil(batch.length / 2)
  return [batch.slice(0, mid), batch.slice(mid)]
}

// W13 跨 request 續跑:run.metadata 保存的累計進度(每個 request 只跑部分批次,
// 收尾/暫停時寫回;下一個 request 用這個還原計數器)。欄位缺漏一律回安全預設——
// 舊版 run 或壞 metadata 不能讓續跑炸掉,頂多從頭統計。
export interface ResumeState {
  batchesCompleted: number
  totalRequirements: number
  verifiedCount: number
  needsReviewCount: number
  rawItemCount: number
  workItemLinkCount: number
  rejectedCount: number
  rejectedItems: { index: string; reason: string }[]
  clippedBatches: string[]
  // 批內對半切的續跑狀態:哪一批(index)需要從第幾層切開始跑——
  // 沒有這個,每個 request 都會重演一次註定逾時的完整嘗試(活鎖+燒錢)
  pendingSplitBatch: number
  pendingSplitDepth: number
  // 該批已完成的子批 label(如 b4a、b4ba):子批總時長可能超過單一 request
  // 預算,續跑必須能跳過已完成的子批,否則每輪都從 q1 重跑、最後一塊永遠輪不到
  pendingSplitDone: string[]
}

const nonNegInt = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0

export function readResumeState(meta: unknown): ResumeState {
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
  return {
    batchesCompleted: nonNegInt(m.batches_completed),
    totalRequirements: nonNegInt(m.cum_requirement_count),
    verifiedCount: nonNegInt(m.cum_verified_count),
    needsReviewCount: nonNegInt(m.cum_needs_review_count),
    rawItemCount: nonNegInt(m.cum_raw_item_count),
    workItemLinkCount: nonNegInt(m.cum_work_item_link_count),
    rejectedCount: nonNegInt(m.cum_rejected_count),
    rejectedItems: Array.isArray(m.rejected_items)
      ? (m.rejected_items as { index: string; reason: string }[]).slice(0, 20)
      : [],
    clippedBatches: Array.isArray(m.clipped_batches)
      ? (m.clipped_batches as string[]).filter((x) => typeof x === 'string')
      : [],
    pendingSplitBatch: typeof m.pending_split_batch === 'number' && Number.isInteger(m.pending_split_batch)
      && m.pending_split_batch >= 0 ? m.pending_split_batch : -1,
    pendingSplitDepth: nonNegInt(m.pending_split_depth),
    pendingSplitDone: Array.isArray(m.pending_split_done)
      ? (m.pending_split_done as string[]).filter((x) => typeof x === 'string').slice(0, 64)
      : [],
  }
}

// 多批呼叫的 token 用量合併(記帳一次記總量;缺欄位當 0)
export interface UsageLike {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function mergeUsage(a: UsageLike | null | undefined, b: UsageLike | null | undefined): UsageLike {
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
    cache_read_input_tokens: (a?.cache_read_input_tokens ?? 0) + (b?.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: (a?.cache_creation_input_tokens ?? 0) + (b?.cache_creation_input_tokens ?? 0),
  }
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
