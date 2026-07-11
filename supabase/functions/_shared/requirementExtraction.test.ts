import { describe, expect, it } from 'vitest'
import {
  EXTRACTION_FOCUS,
  buildWorkItemCatalog,
  deterministicUuid,
  mapWorkItemRefs,
  validateSuggestion,
} from './requirementExtraction.ts'

describe('document-type extraction focus', () => {
  it('routes only the approved persistent document types to focused prompts', () => {
    expect(EXTRACTION_FOCUS.contract).toContain('期限與週期義務')
    expect(EXTRACTION_FOCUS.specification).toContain('取樣與試驗頻率')
    expect(EXTRACTION_FOCUS.quality_plan).toContain('自主檢查要求')
    expect(EXTRACTION_FOCUS.itp).toContain('檢驗停留點')
    expect(EXTRACTION_FOCUS.other).toBeUndefined()
  })
})

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
