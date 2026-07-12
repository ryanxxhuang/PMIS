import { describe, expect, it } from 'vitest'
import {
  INBOX_TABS, REVIEW_ACTION_LABELS, buildInboxSummary, partitionInboxTabs, summarySourceLabel,
} from './requirementInbox.js'

const rows = [
  { id: 'r1', status: 'needs_review', origin: 'ai', ingestion_run_id: 'run-current', requirement_type: 'submittal', trigger_type: 'commencement', created_at: '2026-07-11T01:00:00Z' },
  { id: 'r2', status: 'draft_ai', origin: 'ai', ingestion_run_id: 'run-current', requirement_type: 'inspection', trigger_type: null, created_at: '2026-07-11T02:00:00Z' },
  { id: 'r3', status: 'approved', origin: 'ai', ingestion_run_id: 'run-current', requirement_type: 'deadline', trigger_type: 'notice', created_at: '2026-07-11T03:00:00Z' },
  { id: 'r4', status: 'needs_review', origin: 'ai', ingestion_run_id: 'run-failed', requirement_type: 'test', trigger_type: null, created_at: '2026-07-11T04:00:00Z' },
  { id: 'r5', status: 'needs_review', origin: 'manual', ingestion_run_id: null, requirement_type: 'checklist', trigger_type: null, created_at: '2026-07-11T05:00:00Z' },
]
const currentRunIds = new Set(['run-current'])

describe('inbox tabs', () => {
  it('exposes exactly the three primary tabs in user language', () => {
    expect(INBOX_TABS.map((t) => t.label)).toEqual(['待我確認', '全部要求', '已核定'])
  })

  it('待我確認 shows pending current-scope suggestions plus manual rows', () => {
    const { pending } = partitionInboxTabs(rows, currentRunIds)
    expect(pending.map((r) => r.id)).toEqual(['r1', 'r5', 'r2'])
  })

  it('failed-run suggestions never enter the default queue but stay in 全部要求', () => {
    const { pending, all } = partitionInboxTabs(rows, currentRunIds)
    expect(pending.some((r) => r.id === 'r4')).toBe(false)
    expect(all.some((r) => r.id === 'r4')).toBe(true)
  })

  it('已核定 lists approved requirements only', () => {
    const { approved } = partitionInboxTabs(rows, currentRunIds)
    expect(approved.map((r) => r.id)).toEqual(['r3'])
  })
})

describe('buildInboxSummary', () => {
  it('summarizes in plain language counts', () => {
    const summary = buildInboxSummary(rows, {
      verificationByReq: new Map([['r1', 'verified'], ['r2', 'unverified'], ['r3', 'verified']]),
      currentRunIds,
    })
    expect(summary.total).toBe(4)          // r4 (failed run) out of scope
    expect(summary.pending).toBe(3)        // r1, r2, r5
    expect(summary.verified).toBe(2)
    expect(summary.deadlines).toBe(2)      // r1 trigger + r3 deadline type
    expect(summary.submittals).toBe(1)
    expect(summary.inspections).toBe(1)
    expect(summary.approved).toBe(1)
  })
})

describe('review action labels', () => {
  it('uses user-facing language, not raw lifecycle vocabulary', () => {
    expect(REVIEW_ACTION_LABELS.approve).toBe('核定為履約要求')
    expect(REVIEW_ACTION_LABELS.reject).toBe('不列入')
    expect(REVIEW_ACTION_LABELS.edit).toBe('修正')
    for (const label of Object.values(REVIEW_ACTION_LABELS)) {
      expect(label).not.toMatch(/approved|rejected|draft_ai|needs_review/)
    }
  })
})

describe('summarySourceLabel', () => {
  it('names the single source package and falls back to 契約文件', () => {
    const runsById = new Map([['run-current', { id: 'run-current', document_version_id: 'v1' }]])
    const versionsById = new Map([['v1', { id: 'v1', documents: { contract_package_id: 'pkg1' } }]])
    const packagesById = new Map([['pkg1', { display_title: '我的施工契約' }]])
    expect(summarySourceLabel(rows, { runsById, versionsById, packagesById })).toBe('我的施工契約')
    expect(summarySourceLabel(rows, {})).toBe('契約文件')
  })
})
