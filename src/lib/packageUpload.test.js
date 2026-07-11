import { describe, expect, it } from 'vitest'
import {
  UPLOAD_CONCURRENCY, formatElapsed, mapWithConcurrency,
  packageStatusFromRuns, staleProcessingPatch, storagePathFor, summarizePackageProgress,
  takeSelectedFiles,
} from './packageUpload.js'

const run = (overrides) => ({
  status: 'processing', stage: 'received', parser_type: 'pdf',
  suggested_document_type: null, classification_status: null, metadata: {},
  started_at: '2026-07-11T00:00:00Z', ...overrides,
})

describe('takeSelectedFiles', () => {
  it('snapshots a live FileList before clearing the input', () => {
    const selected = [{ name: 'contract.pdf' }, { name: 'specification.docx' }]
    const input = {
      files: selected,
      set value(_next) { this.files = [] },
    }
    expect(takeSelectedFiles(input)).toEqual(selected)
    expect(input.files).toEqual([])
  })
})

describe('summarizePackageProgress (real stage counts, no fake percentage)', () => {
  const runs = [
    run({ status: 'completed', stage: 'completed', suggested_document_type: 'contract', classification_status: 'auto_accepted', metadata: { requirement_extraction: 'completed' } }),
    run({ stage: 'extracting_text' }),
    run({ stage: 'classifying', suggested_document_type: 'specification', classification_status: 'needs_review' }),
    run({ status: 'unsupported', stage: 'unsupported', parser_type: 'none', suggested_document_type: 'other', classification_status: 'auto_accepted' }),
    run({ status: 'failed', stage: 'failed' }),
  ]

  it('counts stages from persisted run state', () => {
    const s = summarizePackageProgress(runs)
    expect(s.total).toBe(5)
    expect(s.uploaded).toBe(4)          // failed-before-upload does not count as uploaded
    expect(s.classified).toBe(3)        // suggested types persisted
    expect(s.requirementsAnalyzed).toBe(1)
    expect(s.completed).toBe(1)
    expect(s.unsupported).toBe(1)
    expect(s.failed).toBe(1)
    expect(s.needsClassification).toBe(1)
    expect(s.active).toBe(2)
  })

  it('treats an empty package as draft with no activity', () => {
    const s = summarizePackageProgress([])
    expect(s.total).toBe(0)
    expect(s.active).toBe(0)
  })
})

describe('packageStatusFromRuns', () => {
  it('reports processing while any file is still active', () => {
    expect(packageStatusFromRuns([run({ stage: 'classifying' })])).toBe('processing')
  })

  it('one failed or unclassified file marks the package needs_attention - never failed', () => {
    expect(packageStatusFromRuns([
      run({ status: 'completed', stage: 'completed' }),
      run({ status: 'failed', stage: 'failed' }),
    ])).toBe('needs_attention')
    expect(packageStatusFromRuns([
      run({ status: 'completed', stage: 'completed', classification_status: 'needs_review' }),
    ])).toBe('needs_attention')
  })

  it('unsupported files do not block ready', () => {
    expect(packageStatusFromRuns([
      run({ status: 'completed', stage: 'completed', classification_status: 'auto_accepted' }),
      run({ status: 'unsupported', stage: 'unsupported', classification_status: 'auto_accepted' }),
    ])).toBe('ready')
    expect(packageStatusFromRuns([])).toBe('draft')
  })
})

describe('elapsed time and storage paths', () => {
  it('formats real elapsed time, no remaining-time estimate', () => {
    expect(formatElapsed(102_000)).toBe('01:42')
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(3_599_000)).toBe('59:59')
  })

  it('builds the package-scoped private storage path with the original filename', () => {
    expect(storagePathFor({
      projectId: 'p1', packageId: 'pkg1', documentId: 'd1', versionId: 'v1',
      filename: '工程採購契約.pdf',
    })).toBe('projects/p1/contract-packages/pkg1/d1/v1/工程採購契約.pdf')
    // path separators in filenames cannot escape the package folder
    expect(storagePathFor({
      projectId: 'p1', packageId: 'pkg1', documentId: 'd1', versionId: 'v1',
      filename: '../../etc/passwd',
    })).toBe('projects/p1/contract-packages/pkg1/d1/v1/.._.._etc_passwd')
  })
})

describe('interrupted processing recovery', () => {
  it('turns only stale active rows into an honest retryable partial state', () => {
    const now = Date.parse('2026-07-11T01:00:00Z')
    expect(staleProcessingPatch(run({ started_at: '2026-07-11T00:00:00Z' }), now))
      .toMatchObject({ status: 'partial', stage: 'failed' })
    expect(staleProcessingPatch(run({ started_at: '2026-07-11T00:50:00Z' }), now)).toBeNull()
    expect(staleProcessingPatch(run({ status: 'completed', stage: 'completed' }), now)).toBeNull()
  })
})

describe('mapWithConcurrency', () => {
  it('bounds concurrency and isolates per-file failures', async () => {
    let inFlight = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], UPLOAD_CONCURRENCY, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      if (n === 3) throw new Error('boom')
      return n * 10
    })
    expect(peak).toBeLessThanOrEqual(UPLOAD_CONCURRENCY)
    expect(results.filter((r) => r.ok).map((r) => r.value)).toEqual([10, 20, 40, 50, 60])
    const failed = results.find((r) => !r.ok)
    expect(failed.error.message).toBe('boom')
  })
})
