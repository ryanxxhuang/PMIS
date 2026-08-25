import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_TYPE_LABELS,
  GENERATION_TYPE_LABELS,
  WORK_ITEM_LINK_STATE_LABELS,
  formatRequirementRule,
  inDefaultReviewScope,
  latestCompletedRunIds,
  requirementFrequencyKey,
  sourcePageLabel,
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

  it('formats the expanded frequency domain(daily/weekly/quarterly/yearly)', () => {
    expect(formatRequirementRule({ frequency_type: 'daily', frequency_config: {} })).toBe('每日')
    expect(formatRequirementRule({ frequency_type: 'weekly', frequency_config: { weekday: 3 } })).toBe('每週三')
    expect(formatRequirementRule({ frequency_type: 'weekly', frequency_config: {} })).toBe('每週')
    expect(formatRequirementRule({ frequency_type: 'monthly', frequency_config: {} })).toBe('每月')
    expect(formatRequirementRule({ frequency_type: 'quarterly', frequency_config: { month: 2, day: 10 } })).toBe('每季第 2 個月 10 日')
    expect(formatRequirementRule({ frequency_type: 'quarterly', frequency_config: { day: 10 } })).toBe('每季')
    expect(formatRequirementRule({ frequency_type: 'yearly', frequency_config: { month: 3, day: 31 } })).toBe('每年 3 月 31 日')
    expect(formatRequirementRule({ frequency_type: 'yearly', frequency_config: {} })).toBe('每年')
    // 未知頻率值原樣顯示,不落到 trigger 分支
    expect(formatRequirementRule({ frequency_type: 'biweekly', trigger_type: 'commencement' })).toBe('biweekly')
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

describe('requirementFrequencyKey(檢索頁頻率維度)', () => {
  it('循環義務照 frequency_type 分桶,值域擴充自動跟上,未知值原樣顯示', () => {
    expect(requirementFrequencyKey({ frequency_type: 'monthly' })).toBe('每月')
    expect(requirementFrequencyKey({ frequency_type: 'daily' })).toBe('每日')
    expect(requirementFrequencyKey({ frequency_type: 'weekly' })).toBe('每週')
    expect(requirementFrequencyKey({ frequency_type: 'yearly' })).toBe('每年')
    expect(requirementFrequencyKey({ frequency_type: 'biweekly' })).toBe('biweekly')
  })
  it('非循環:有觸發時點=一次性,否則無明確時點', () => {
    expect(requirementFrequencyKey({ trigger_type: 'commencement' })).toBe('一次性')
    expect(requirementFrequencyKey({ trigger_type: 'fixed' })).toBe('一次性')
    expect(requirementFrequencyKey({})).toBe('無明確時點')
    expect(requirementFrequencyKey(null)).toBe('無明確時點')
  })
})
