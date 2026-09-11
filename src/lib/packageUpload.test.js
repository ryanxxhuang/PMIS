import { vi } from 'vitest'
import { unconfigured } from '../testUtils/supabaseMock.js'
// 模組 import 鏈會建立真的 supabase client(node 環境無 WebSocket),測試裡換成空殼
vi.mock('./supabase.js', () => unconfigured())
import { describe, expect, it } from 'vitest'
import {
  UPLOAD_CONCURRENCY, formatElapsed, isInlineViewableMime, mapWithConcurrency,
  isValidStorageKey, packageStatusFromRuns, runFileLanded, staleProcessingPatch, storagePathFor, summarizePackageProgress,
  STAGE_ORDER, runPct, summarizeUploadBatch,
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
  it('部分完成或已完成但有覆蓋缺漏的契約仍需留意', () => {
    expect(packageStatusFromRuns([run({ status: 'partial', stage: 'failed' })])).toBe('needs_attention')
    expect(packageStatusFromRuns([run({ status: 'completed', stage: 'completed',
      metadata: { requirement_extraction_warning: '第 2 頁文字不足' },
    })])).toBe('needs_attention')
  })
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

  it('修復前寫入的中文壞路徑不得被 checksum 重用邏輯採用', () => {
    // 這筆是 2026-08-12 dry-run 真實卡死的紀錄形狀:version 已入庫但 storage 上傳從未成功
    expect(isValidStorageKey('projects/p1/contract-packages/pkg/d/v/02-工務局工程採購契約(稿)-1090720.pdf')).toBe(false)
    expect(isValidStorageKey('projects/p1/contract-packages/pkg/d/v/02-_-1090720.pdf')).toBe(true)
    expect(isValidStorageKey('')).toBe(false)
    expect(isValidStorageKey(null)).toBe(false)
  })

  it('storage key 一律退化成 ASCII(Supabase 只收 S3 安全字元,中文檔名會 Invalid key)', () => {
    // dry-run 2026-08-12 的真實案例:整串中文+全形括號,原樣進 key 直接被拒
    expect(storagePathFor({
      projectId: 'p1', packageId: 'pkg1', documentId: 'd1', versionId: 'v1',
      filename: '02-工務局工程採購契約(稿)-1090720.pdf',
    })).toBe('projects/p1/contract-packages/pkg1/d1/v1/02-_-1090720.pdf')
    // 全中文檔名 → 退到 file+副檔名(顯示名存 original_filename,不靠 key)
    expect(storagePathFor({
      projectId: 'p1', packageId: 'pkg1', documentId: 'd1', versionId: 'v1',
      filename: '工程採購契約.pdf',
    })).toBe('projects/p1/contract-packages/pkg1/d1/v1/file.pdf')
    // path separators in filenames cannot escape the package folder
    expect(storagePathFor({
      projectId: 'p1', packageId: 'pkg1', documentId: 'd1', versionId: 'v1',
      filename: '../../etc/passwd',
    })).toBe('projects/p1/contract-packages/pkg1/d1/v1/.._.._etc_passwd')
  })
})

describe('看上傳的檔案(開檔/下載的前提訊號)', () => {
  it('runFileLanded:上傳前失敗的 run 原始檔從未落地,不得給開檔入口', () => {
    // version.storage_path 在 INSERT 時就寫入,不能當「檔案存在」的證據
    expect(runFileLanded(run({ status: 'failed', stage: 'failed', metadata: {} }))).toBe(false)
    expect(runFileLanded(run({ status: 'processing', stage: 'received' }))).toBe(false)
    expect(runFileLanded(null)).toBe(false)
    // 中斷在 received 的列被 staleProcessingPatch 蓋成 partial/failed(stage 一律
    // 'failed'、metadata 不動):沒有 storage_path 就是沒落地,不能只看 stage
    expect(runFileLanded(run({ status: 'partial', stage: 'failed', metadata: { filename_kind: 'pdf' } }))).toBe(false)
    // 上傳成功後的各種終態/中途態都可開檔
    expect(runFileLanded(run({ status: 'failed', stage: 'failed', metadata: { storage_path: 'p' } }))).toBe(true)
    expect(runFileLanded(run({ status: 'partial', stage: 'failed', metadata: { storage_path: 'p' } }))).toBe(true)
    expect(runFileLanded(run({ status: 'processing', stage: 'extracting_requirements' }))).toBe(true)
    expect(runFileLanded(run({ status: 'completed', stage: 'completed', metadata: { storage_path: 'p' } }))).toBe(true)
    expect(runFileLanded(run({ status: 'unsupported', stage: 'unsupported', metadata: { storage_path: 'p' } }))).toBe(true)
  })

  it('isInlineViewableMime:PDF/圖片/純文字開分頁預覽,其他格式走下載', () => {
    expect(isInlineViewableMime('application/pdf')).toBe(true)
    expect(isInlineViewableMime('image/png')).toBe(true)
    expect(isInlineViewableMime('text/plain')).toBe(true)
    expect(isInlineViewableMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false)
    expect(isInlineViewableMime('text/xml')).toBe(false)
    expect(isInlineViewableMime(null)).toBe(false)
    expect(isInlineViewableMime('')).toBe(false)
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

  it('W13:抽取進度心跳新鮮就不算中斷——長文件多段續跑可以正當超過 20 分鐘', () => {
    const now = Date.parse('2026-07-11T01:00:00Z')
    // started_at 已超過 20 分,但 5 分鐘前還有批次進度 → 還活著,不可標中斷
    expect(staleProcessingPatch(run({
      started_at: '2026-07-11T00:00:00Z',
      metadata: { extraction_progress: '7/12', extraction_progress_at: '2026-07-11T00:55:00Z' },
    }), now)).toBeNull()
    // 心跳也停了超過 20 分 → 誠實標中斷
    expect(staleProcessingPatch(run({
      started_at: '2026-07-11T00:00:00Z',
      metadata: { extraction_progress: '7/12', extraction_progress_at: '2026-07-11T00:30:00Z' },
    }), now)).toMatchObject({ status: 'partial', stage: 'failed' })
    // 心跳是壞字串 → 回退用 started_at 判定,不炸
    expect(staleProcessingPatch(run({
      started_at: '2026-07-11T00:00:00Z',
      metadata: { extraction_progress_at: 'not-a-date' },
    }), now)).toMatchObject({ status: 'partial', stage: 'failed' })
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

describe('runPct / summarizeUploadBatch(上傳回饋面板的帳)', () => {
  it('runPct 由 STAGE_ORDER 終態值推導:階段等分刻度,completed 一律 100', () => {
    const last = STAGE_ORDER.completed
    for (const [stage, order] of Object.entries(STAGE_ORDER)) {
      expect(runPct(run({ stage }))).toBe(Math.min(100, Math.round((order / last) * 100)))
    }
    expect(runPct(run({ stage: 'received' }))).toBe(0)
    expect(runPct(run({ stage: 'classifying' }))).toBe(60)
    expect(runPct(run({ stage: 'uploaded', status: 'completed' }))).toBe(100)
    expect(runPct(run({ stage: 'nonsense' }))).toBe(0)
  })
  it('面板列=本批(以 version id 記)+任何仍在處理中的 run;歷史終態列不進面板', () => {
    const rows = [
      run({ id: 'a', document_version_id: 'v-a', status: 'completed', stage: 'completed', classification_status: 'auto_accepted' }),
      run({ id: 'b', document_version_id: 'v-b', status: 'processing', stage: 'classifying' }),
      run({ id: 'c', document_version_id: 'v-c', status: 'completed', stage: 'completed' }),
    ]
    const batch = summarizeUploadBatch(rows, { batchVersionIds: new Set(['v-a']), batchTotal: 2 })
    expect(batch.rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(batch.active).toBe(true)
  })
  it('分類待確認/覆蓋不完整 ≠ 完成;unsupported 算落地完成;重試只認 AI 分析失敗', () => {
    const rows = [
      run({ id: 'ok', document_version_id: 'v1', status: 'completed', stage: 'completed', classification_status: 'auto_accepted' }),
      run({ id: 'needs', document_version_id: 'v2', status: 'completed', stage: 'completed', classification_status: 'needs_review' }),
      run({ id: 'partial-cov', document_version_id: 'v3', status: 'completed', stage: 'completed', classification_status: 'confirmed', metadata: { requirement_extraction_warning: '未涵蓋整份文件' } }),
      run({ id: 'unsup', document_version_id: 'v4', status: 'unsupported', stage: 'unsupported' }),
      run({ id: 'ai-fail', document_version_id: 'v5', status: 'partial', stage: 'failed', metadata: { requirement_extraction: 'failed' } }),
      run({ id: 'upload-fail', document_version_id: 'v6', status: 'failed', stage: 'failed' }),
    ]
    const ids = (list) => list.map((r) => r.id)
    const batch = summarizeUploadBatch(rows, { batchVersionIds: new Set(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']) })
    expect(ids(batch.ok)).toEqual(['ok', 'unsup'])
    expect(ids(batch.needs)).toEqual(['needs', 'partial-cov'])
    expect(ids(batch.failed)).toEqual(['ai-fail', 'upload-fail'])
    expect(ids(batch.extractionFailed)).toEqual(['ai-fail'])
    expect(batch.active).toBe(false)
  })
  it('進度母數定錨在選檔總數:還沒建列的檔案以 0% 計入,母數不會隨列增加而倒退', () => {
    const rows = [run({ document_version_id: 'v1', status: 'processing', stage: 'uploaded' })]  // 20%
    expect(summarizeUploadBatch(rows, { batchVersionIds: new Set(['v1']), batchTotal: 4 })).toMatchObject({ total: 4, overallPct: 5 })
    expect(summarizeUploadBatch(rows, { batchVersionIds: new Set(['v1']), batchTotal: 0 })).toMatchObject({ total: 1, overallPct: 20 })
    expect(summarizeUploadBatch([], { batchVersionIds: new Set() })).toMatchObject({ total: 0, overallPct: 0, active: false })
  })
})
