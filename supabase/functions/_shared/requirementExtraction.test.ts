import { describe, expect, it } from 'vitest'
import {
  buildDocumentBatches,
  buildWorkItemCatalog,
  deterministicUuid,
  mapWorkItemRefs,
  mergeUsage,
  splitBatch,
  validateSuggestion,
} from './requirementExtraction.ts'

const validRaw = {
  title: '開工前提送施工計畫書',
  description: '開工前 14 日內檢送施工計畫書予監造單位審查',
  requirement_type: 'submittal',
  responsible_party_type: 'contractor',
  lifecycle_phase: '開工前',
  trigger_type: 'commencement',
  trigger_config: { offset_days: 14, offset_dir: 'before', fixed_date: '' },
  frequency_type: '',
  frequency_config: { day: 0 },
  acceptance_criteria: '',
  evidence_requirement: '核定函',
  source: { page_number: 12, section: '第五章', clause: '§12.4', quotation: '施工廠商應於開工前14日內檢送施工計畫書' },
  confidence: 0.9,
  candidate_work_items: ['W1', 'W1', ' w2 ', 'W99'],
}

describe('validateSuggestion', () => {
  it('accepts a valid suggestion and normalizes fields', () => {
    const check = validateSuggestion(validRaw)
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.value.requirement_type).toBe('submittal')
    expect(check.value.trigger_config).toEqual({ offset_days: 14, offset_dir: 'before' })
    expect(check.value.frequency_type).toBeNull()
    expect(check.value.frequency_config).toEqual({})
    expect(check.value.acceptance_criteria).toBeNull()
    expect(check.value.source.page_number).toBe(12)
    // trimmed + deduplicated, unknown refs kept for later catalog mapping
    expect(check.value.candidate_work_items).toEqual(['W1', 'w2', 'W99'])
    expect(check.value.warnings).toEqual([])
  })

  it('rejects items without a representable requirement_type or title', () => {
    expect(validateSuggestion({ ...validRaw, requirement_type: 'hold_point' }))
      .toEqual({ ok: false, reason: 'invalid requirement_type: hold_point' })
    expect(validateSuggestion({ ...validRaw, title: '  ' }))
      .toEqual({ ok: false, reason: 'missing title' })
    expect(validateSuggestion(null)).toEqual({ ok: false, reason: 'not an object' })
  })

  it('nulls invented optional enum values instead of persisting new vocabulary', () => {
    const check = validateSuggestion({
      ...validRaw,
      responsible_party_type: 'subcontractor',
      lifecycle_phase: 'pre-construction',
      trigger_type: 'weekly',
      frequency_type: 'weekly',
    })
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.value.responsible_party_type).toBeNull()
    expect(check.value.lifecycle_phase).toBeNull()
    expect(check.value.trigger_type).toBeNull()
    // an invalid trigger drops its config with it
    expect(check.value.trigger_config).toEqual({})
    expect(check.value.frequency_type).toBeNull()
    expect(check.value.warnings).toHaveLength(4)
  })

  it('validates fixed dates, clamps confidence, and drops bad page numbers', () => {
    const check = validateSuggestion({
      ...validRaw,
      trigger_type: 'fixed',
      trigger_config: { offset_days: -3, offset_dir: 'sideways', fixed_date: '2026/07/10' },
      confidence: 7,
      source: { page_number: -2, section: '', clause: '', quotation: '' },
    })
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.value.trigger_config).toEqual({})
    expect(check.value.warnings).toContain('invalid fixed_date: 2026/07/10')
    expect(check.value.confidence).toBe(1)
    expect(check.value.source.page_number).toBeNull()
    expect(check.value.source.quotation).toBeNull()
  })
})

describe('work item catalog mapping', () => {
  const workItems = [
    { id: 'a0000000-0000-0000-0000-000000000001', item_no: '壹.一.1', description: '混凝土', is_leaf: true, is_rollup: false },
    { id: 'a0000000-0000-0000-0000-000000000002', item_no: '壹.一', description: '小計', is_leaf: false, is_rollup: true },
    { id: 'a0000000-0000-0000-0000-000000000003', item_no: '壹.一.2', description: '鋼筋', is_leaf: true, is_rollup: false },
  ]

  it('builds stable refs over BOQ leaves only', () => {
    const catalog = buildWorkItemCatalog(workItems)
    expect(catalog.entries.map((e) => [e.ref, e.description]))
      .toEqual([['W1', '混凝土'], ['W2', '鋼筋']])
  })

  it('maps refs to real work_items.id, dropping unknown refs and duplicates', () => {
    const catalog = buildWorkItemCatalog(workItems)
    expect(mapWorkItemRefs(['W2', 'w2', 'W1', 'W99', 'not-a-ref'], catalog)).toEqual([
      'a0000000-0000-0000-0000-000000000003',
      'a0000000-0000-0000-0000-000000000001',
    ])
    expect(mapWorkItemRefs([], catalog)).toEqual([])
  })

  it('respects the catalog size bound', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `b0000000-0000-0000-0000-00000000000${i}`, item_no: `${i}`, description: `項目${i}`,
      is_leaf: true, is_rollup: false,
    }))
    expect(buildWorkItemCatalog(many, 3).entries).toHaveLength(3)
  })
})

describe('deterministicUuid', () => {
  it('is stable for the same name and distinct for different names', async () => {
    const a1 = await deterministicUuid('run-1:requirement:0')
    const a2 = await deterministicUuid('run-1:requirement:0')
    const b = await deterministicUuid('run-1:requirement:1')
    const c = await deterministicUuid('run-2:requirement:0')
    expect(a1).toBe(a2)
    expect(new Set([a1, b, c]).size).toBe(3)
  })

  it('produces a well-formed UUID', async () => {
    const id = await deterministicUuid('any-name')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('buildDocumentBatches', () => {
  const page = (n, chars) => ({
    page_number: n, extracted_text: 'x'.repeat(chars), extraction_method: 'pdf_text',
  })

  it('packs consecutive pages into one batch under the budget', () => {
    const plan = buildDocumentBatches([page(1, 100), page(2, 100), page(3, 100)], {
      batchCharBudget: 1000, maxBatches: 4,
    })
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0].map((p) => p.page_number)).toEqual([1, 2, 3])
    expect(plan.truncated).toBe(false)
    expect(plan.lastIncludedPage).toBe(3)
    expect(plan.omittedPageCount).toBe(0)
  })

  it('splits into multiple batches preserving page order', () => {
    const plan = buildDocumentBatches(
      [page(1, 600), page(2, 600), page(3, 600), page(4, 600)],
      { batchCharBudget: 1000, maxBatches: 4 },
    )
    expect(plan.batches.map((b) => b.map((p) => p.page_number))).toEqual([[1], [2], [3], [4]])
    expect(plan.truncated).toBe(false)
  })

  it('keeps an oversized single page as its own batch (pages are never split)', () => {
    const plan = buildDocumentBatches([page(1, 100), page(2, 5000), page(3, 100)], {
      batchCharBudget: 1000, maxBatches: 4,
    })
    expect(plan.batches.map((b) => b.map((p) => p.page_number))).toEqual([[1], [2], [3]])
  })

  it('drops pages beyond maxBatches and reports the truncation', () => {
    const plan = buildDocumentBatches(
      [page(1, 900), page(2, 900), page(3, 900), page(4, 900)],
      { batchCharBudget: 1000, maxBatches: 2 },
    )
    expect(plan.batches).toHaveLength(2)
    expect(plan.truncated).toBe(true)
    expect(plan.lastIncludedPage).toBe(2)
    expect(plan.omittedPageCount).toBe(2)
  })

  it('handles an empty page list', () => {
    const plan = buildDocumentBatches([], { batchCharBudget: 1000, maxBatches: 4 })
    expect(plan.batches).toHaveLength(0)
    expect(plan.lastIncludedPage).toBe(null)
    expect(plan.truncated).toBe(false)
  })
})

describe('splitBatch', () => {
  const pages = (ns) => ns.map((n) => ({ page_number: n, extracted_text: '', extraction_method: 'pdf_text' }))

  it('halves a multi-page batch preserving order', () => {
    const halves = splitBatch(pages([1, 2, 3, 4, 5]))
    expect(halves[0].map((p) => p.page_number)).toEqual([1, 2, 3])
    expect(halves[1].map((p) => p.page_number)).toEqual([4, 5])
  })

  it('refuses to split a single-page batch', () => {
    expect(splitBatch(pages([1]))).toBe(null)
    expect(splitBatch(pages([]))).toBe(null)
  })
})

describe('mergeUsage', () => {
  it('sums token fields treating missing values as zero', () => {
    expect(mergeUsage(
      { input_tokens: 10, output_tokens: 5 },
      { input_tokens: 3, cache_read_input_tokens: 7 },
    )).toEqual({
      input_tokens: 13, output_tokens: 5,
      cache_read_input_tokens: 7, cache_creation_input_tokens: 0,
    })
    expect(mergeUsage(null, undefined)).toEqual({
      input_tokens: 0, output_tokens: 0,
      cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    })
  })
})
