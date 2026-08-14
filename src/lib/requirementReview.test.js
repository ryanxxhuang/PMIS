import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_TYPE_LABELS,
  GENERATION_TYPE_LABELS,
  HIGHLIGHT_LIMIT,
  WORK_ITEM_LINK_STATE_LABELS,
  buildRequirementHighlights,
  canQuickApproveDeadline,
  filterRequirements,
  formatRequirementRule,
  inDefaultReviewScope,
  latestCompletedRunIds,
  sortForReviewQueue,
  sourcePageLabel,
  sourceVerificationLabel,
  sourceVerificationSummary,
} from './requirementReview.js'

const runs = [
  { id: 'run-old', document_version_id: 'v1', status: 'completed', started_at: '2026-07-01T10:00:00Z' },
  { id: 'run-new', document_version_id: 'v1', status: 'completed', started_at: '2026-07-09T10:00:00Z' },
  { id: 'run-failed', document_version_id: 'v1', status: 'failed', started_at: '2026-07-10T10:00:00Z' },
  { id: 'run-processing', document_version_id: 'v2', status: 'processing', started_at: '2026-07-10T11:00:00Z' },
  { id: 'run-pending', document_version_id: 'v2', status: 'pending', started_at: '2026-07-10T12:00:00Z' },
  { id: 'run-v2', document_version_id: 'v2', status: 'completed', started_at: '2026-07-08T10:00:00Z' },
]

describe('latestCompletedRunIds', () => {
  it('prefers the latest completed run per document version', () => {
    const ids = latestCompletedRunIds(runs)
    expect(ids.has('run-new')).toBe(true)
    expect(ids.has('run-old')).toBe(false)
    expect(ids.has('run-v2')).toBe(true)
  })

  it('never treats failed/processing/pending runs as current', () => {
    const ids = latestCompletedRunIds(runs)
    expect(ids.has('run-failed')).toBe(false)
    expect(ids.has('run-processing')).toBe(false)
    expect(ids.has('run-pending')).toBe(false)
  })
})

describe('inDefaultReviewScope', () => {
  const currentRunIds = latestCompletedRunIds(runs)

  it('always includes manual and migration requirements', () => {
    expect(inDefaultReviewScope({ origin: 'manual', ingestion_run_id: null }, currentRunIds)).toBe(true)
    expect(inDefaultReviewScope({ origin: 'migration', ingestion_run_id: null }, currentRunIds)).toBe(true)
  })

  it('includes AI suggestions only from the latest completed run', () => {
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: 'run-new' }, currentRunIds)).toBe(true)
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: 'run-old' }, currentRunIds)).toBe(false)
  })

  it('excludes failed/processing run suggestions and unlinked AI rows from the default queue', () => {
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: 'run-failed' }, currentRunIds)).toBe(false)
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: 'run-processing' }, currentRunIds)).toBe(false)
    expect(inDefaultReviewScope({ origin: 'ai', ingestion_run_id: null }, currentRunIds)).toBe(false)
  })
})

describe('sortForReviewQueue', () => {
  it('orders needs_review first, then draft_ai, then reviewed states, oldest first', () => {
    const sorted = sortForReviewQueue([
      { id: 'd', status: 'approved', created_at: '2026-07-01T00:00:00Z' },
      { id: 'b', status: 'draft_ai', created_at: '2026-07-02T00:00:00Z' },
      { id: 'a', status: 'needs_review', created_at: '2026-07-03T00:00:00Z' },
      { id: 'c', status: 'draft_ai', created_at: '2026-07-01T00:00:00Z' },
    ])
    expect(sorted.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('breaks exact ties deterministically by id', () => {
    const sorted = sortForReviewQueue([
      { id: 'z', status: 'draft_ai', created_at: '2026-07-01T00:00:00Z' },
      { id: 'a', status: 'draft_ai', created_at: '2026-07-01T00:00:00Z' },
    ])
    expect(sorted.map((r) => r.id)).toEqual(['a', 'z'])
  })
})

describe('filterRequirements', () => {
  const list = [
    { id: 'r1', status: 'needs_review', requirement_type: 'submittal', responsible_party_type: 'contractor', origin: 'ai', ingestion_run_id: 'run-new' },
    { id: 'r2', status: 'approved', requirement_type: 'inspection', responsible_party_type: 'supervisor', origin: 'manual', ingestion_run_id: null },
  ]
  const verification = new Map([['r1', 'verified'], ['r2', 'none']])

  it('filters by status, type, responsibility, origin, and run', () => {
    expect(filterRequirements(list, { status: 'approved' }).map((r) => r.id)).toEqual(['r2'])
    expect(filterRequirements(list, { requirement_type: 'submittal' }).map((r) => r.id)).toEqual(['r1'])
    expect(filterRequirements(list, { responsible_party_type: 'supervisor' }).map((r) => r.id)).toEqual(['r2'])
    expect(filterRequirements(list, { origin: 'ai' }).map((r) => r.id)).toEqual(['r1'])
    expect(filterRequirements(list, { ingestion_run_id: 'run-new' }).map((r) => r.id)).toEqual(['r1'])
  })

  it('filters by aggregated source verification state', () => {
    expect(filterRequirements(list, { verification: 'verified' }, verification).map((r) => r.id))
      .toEqual(['r1'])
    expect(filterRequirements(list, { verification: 'none' }, verification).map((r) => r.id))
      .toEqual(['r2'])
  })
})

describe('source presentation', () => {
  it('summarizes verification across sources', () => {
    expect(sourceVerificationSummary([])).toBe('none')
    expect(sourceVerificationSummary([{ source_verified: false }])).toBe('unverified')
    expect(sourceVerificationSummary([{ source_verified: false }, { source_verified: true }]))
      .toBe('verified')
  })

  it('shows a grounded PDF page and never a fabricated one', () => {
    expect(sourcePageLabel({ page_number: 12 })).toBe('第 12 頁')
  })

  it('says so when there is no reliable page (DOCX / ungrounded claim)', () => {
    expect(sourcePageLabel({ page_number: null })).toBe('無可靠頁碼')
    expect(sourcePageLabel(null)).toBe('無可靠頁碼')
  })

  it('uses neutral verified/unverified labels', () => {
    expect(sourceVerificationLabel({ source_verified: true })).toBe('來源已核對')
    expect(sourceVerificationLabel({ source_verified: false })).toBe('來源待人工確認')
  })
})

describe('formatRequirementRule', () => {
  it('formats offset triggers and monthly frequency readably', () => {
    expect(formatRequirementRule({
      trigger_type: 'commencement',
      trigger_config: { offset_days: 14, offset_dir: 'before' },
    })).toBe('開工前 14 日內')
    expect(formatRequirementRule({
      frequency_type: 'monthly', frequency_config: { day: 5 },
    })).toBe('每月 5 日')
    expect(formatRequirementRule({
      trigger_type: 'fixed', trigger_config: { fixed_date: '2026-08-01' },
    })).toBe('指定 2026-08-01')
  })

  it('returns empty text instead of raw JSON when nothing applies', () => {
    expect(formatRequirementRule({ trigger_type: null, frequency_type: null })).toBe('')
    expect(formatRequirementRule(null)).toBe('')
  })
})

describe('W8-3B requirement highlights', () => {
  const currentRunIds = new Set(['run-new'])
  const base = {
    title: '施工計畫送審', description: '開工前提送', requirement_type: 'submittal',
    responsible_party_type: 'contractor', lifecycle_phase: '開工前', trigger_type: null,
    trigger_config: null, frequency_type: null, frequency_config: null,
    acceptance_criteria: null, evidence_requirement: '核定本', origin: 'ai',
    ingestion_run_id: 'run-new', created_at: '2026-08-01T00:00:00Z',
  }

  it('always keeps approved contract facts, but only current unreviewed AI suggestions', () => {
    const rows = [
      { ...base, id: 'approved-old', status: 'approved', ingestion_run_id: 'run-old' },
      { ...base, id: 'current', status: 'needs_review', title: '目前建議' },
      { ...base, id: 'stale', status: 'needs_review', ingestion_run_id: 'run-old', title: '舊建議' },
      { ...base, id: 'rejected', status: 'rejected', title: '已駁回' },
      { ...base, id: 'superseded', status: 'superseded', title: '已廢止' },
    ]
    const result = buildRequirementHighlights(rows, currentRunIds)
    expect(result.approved.map((g) => g.requirement.id)).toEqual(['approved-old'])
    expect(result.suggestions.map((g) => g.requirement.id)).toEqual(['current'])
  })

  it('groups exact duplicate display rows without changing the source array', () => {
    const rows = [
      { ...base, id: 'b', status: 'needs_review', created_at: '2026-08-02T00:00:00Z' },
      { ...base, id: 'a', status: 'needs_review' },
    ]
    const result = buildRequirementHighlights(rows, currentRunIds)
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].requirement.id).toBe('a')
    expect(result.suggestions[0].requirements.map((r) => r.id)).toEqual(['a', 'b'])
    expect(rows).toHaveLength(2)
  })

  it('never fuzzily merges a different party, phase, rule, or content', () => {
    const rows = [
      { ...base, id: 'base', status: 'needs_review' },
      { ...base, id: 'party', status: 'needs_review', responsible_party_type: 'supervisor' },
      { ...base, id: 'phase', status: 'needs_review', lifecycle_phase: '施工中' },
      { ...base, id: 'rule', status: 'needs_review', trigger_type: 'commencement' },
      { ...base, id: 'content', status: 'needs_review', description: '不同內容' },
    ]
    expect(buildRequirementHighlights(rows, currentRunIds).suggestions).toHaveLength(5)
  })

  it('does not repeat a suggestion when identical approved content already exists', () => {
    const rows = [
      { ...base, id: 'approved', status: 'approved', ingestion_run_id: 'run-old' },
      { ...base, id: 'pending', status: 'needs_review' },
    ]
    const result = buildRequirementHighlights(rows, currentRunIds)
    expect(result.approved).toHaveLength(1)
    expect(result.suggestions).toHaveLength(0)
  })

  it('orders important types and verified sources deterministically without using confidence', () => {
    const rows = [
      { ...base, id: 'report', status: 'needs_review', requirement_type: 'report', confidence: 0.99 },
      { ...base, id: 'deadline-unverified', status: 'needs_review', requirement_type: 'deadline', title: '期限 B', confidence: 0.99 },
      { ...base, id: 'deadline-verified', status: 'needs_review', requirement_type: 'deadline', title: '期限 A', confidence: 0.01 },
    ]
    const verification = new Map([
      ['report', 'verified'], ['deadline-unverified', 'unverified'], ['deadline-verified', 'verified'],
    ])
    const result = buildRequirementHighlights(rows, currentRunIds, verification)
    expect(result.suggestions.map((g) => g.requirement.id))
      .toEqual(['deadline-verified', 'deadline-unverified', 'report'])
    expect(HIGHLIGHT_LIMIT).toBe(6)
  })
})

describe('W8-3B deadline quick action', () => {
  const deadline = {
    status: 'needs_review', requirement_type: 'deadline', origin: 'ai',
    trigger_type: 'commencement', trigger_config: { offset_days: 14, offset_dir: 'after' },
  }

  it('allows only a reviewer with a trackable rule and verified AI source', () => {
    expect(canQuickApproveDeadline(deadline, 'verified', true)).toBe(true)
    expect(canQuickApproveDeadline(deadline, 'unverified', true)).toBe(false)
    expect(canQuickApproveDeadline(deadline, 'verified', false)).toBe(false)
  })

  it('allows human/migration rows without an AI citation, but rejects incomplete deadlines', () => {
    expect(canQuickApproveDeadline({ ...deadline, origin: 'manual' }, 'none', true)).toBe(true)
    expect(canQuickApproveDeadline({ ...deadline, origin: 'migration' }, 'none', true)).toBe(true)
    expect(canQuickApproveDeadline({ ...deadline, trigger_type: 'fixed', trigger_config: {} }, 'verified', true)).toBe(false)
    expect(canQuickApproveDeadline({ ...deadline, trigger_type: 'fixed', trigger_config: { fixed_date: '2026-02-31' } }, 'verified', true)).toBe(false)
    expect(canQuickApproveDeadline({ ...deadline, frequency_type: 'monthly', frequency_config: { day: 32 }, trigger_type: null }, 'verified', true)).toBe(false)
  })

  it('never offers the shortcut for approved or non-deadline requirements', () => {
    expect(canQuickApproveDeadline({ ...deadline, status: 'approved' }, 'verified', true)).toBe(false)
    expect(canQuickApproveDeadline({ ...deadline, requirement_type: 'submittal' }, 'verified', true)).toBe(false)
  })
})

describe('link label mappings', () => {
  it('labels BOQ link review states', () => {
    expect(WORK_ITEM_LINK_STATE_LABELS.suggested).toBe('AI 建議')
    expect(WORK_ITEM_LINK_STATE_LABELS.approved).toBe('已核可')
    expect(WORK_ITEM_LINK_STATE_LABELS.rejected).toBe('已駁回')
  })

  it('labels every supported artifact type and generation type', () => {
    expect(Object.keys(ARTIFACT_TYPE_LABELS).sort()).toEqual(
      ['checklist', 'deadline', 'evidence', 'inspection_point', 'submittal', 'test'],
    )
    expect(GENERATION_TYPE_LABELS.ai_draft).toBe('AI 草稿')
  })
})
