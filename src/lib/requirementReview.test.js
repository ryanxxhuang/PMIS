import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_TYPE_LABELS,
  GENERATION_TYPE_LABELS,
  WORK_ITEM_LINK_STATE_LABELS,
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
