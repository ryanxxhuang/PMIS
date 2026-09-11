// lib/packageRuns.js:專案文件頁的 run 生命週期——改分類/重試的狀態機、中斷復原
// 的寫入、單一契約包的讀取。原本這段住在 Contract.jsx 的事件處理器裡,只能掛載
// 整頁才測得到;抽到 lib 後在 node 直接驗狀態轉移與每一次寫入的 payload。
import { vi } from 'vitest'

// supabase 替身:from() 轉交給每個 describe 自己裝的 recorder(讀取用 fakePostgrest,
// 寫入用下方 writeRecorder);runRequirementExtraction 換成可控的 fn。
const h = vi.hoisted(() => ({ from: null, extract: vi.fn() }))
vi.mock('./supabase.js', () => ({ isSupabaseConfigured: true, supabase: { from: (table) => h.from(table) } }))
vi.mock('./extractRequirements.js', async (original) => ({
  ...await original(), runRequirementExtraction: (...args) => h.extract(...args),
}))

import { describe, it, expect, beforeEach } from 'vitest'
import { createFakePostgrest } from '../testUtils/fakePostgrest.js'
import { PROCESSING_STALE_MS } from './packageUpload.js'
import { loadPackageRuns, healStaleRuns, canRerouteExtraction, reclassifyProcessingRun } from './packageRuns.js'

// 寫入用的最小 builder:記下每次 update 的 table/payload/filters,回應由測試指定
function writeRecorder(respond = {}) {
  const calls = []
  const from = (table) => {
    const q = { table, op: 'select', payload: null, filters: [] }
    const api = {
      select: () => api, single: () => api, order: () => api, range: () => api,
      eq: (col, val) => { q.filters.push([col, val]); return api },
      update: (payload) => { q.op = 'update'; q.payload = payload; return api },
      then: (resolve, reject) => {
        calls.push(q)
        return Promise.resolve(respond[table] ? respond[table](q) : { data: null, error: null }).then(resolve, reject)
      },
    }
    return api
  }
  return { from, calls, updates: (table) => calls.filter((c) => c.op === 'update' && (!table || c.table === table)) }
}

const baseRun = (extra = {}) => ({
  id: 'run1', contract_package_id: 'pkg1', document_version_id: 'v1', project_id: 'p1',
  status: 'completed', stage: 'completed', parser_type: 'pdf', classification_status: 'needs_review',
  suggested_document_type: 'contract', metadata: { filename_kind: 'pdf', page_count: 12 }, ...extra,
})

describe('canRerouteExtraction(抽取前提)', () => {
  it('可抽取類型 + 有解析器 + 有逐頁文字才路由', () => {
    expect(canRerouteExtraction(baseRun(), 'contract')).toBe(true)
    expect(canRerouteExtraction(baseRun(), 'other')).toBe(false)
    expect(canRerouteExtraction(baseRun({ parser_type: 'none' }), 'contract')).toBe(false)
    expect(canRerouteExtraction(baseRun({ parser_type: null }), 'contract')).toBe(false)
  })
  it('掃描檔/上傳失敗(沒有頁)不打抽取——422 會蓋掉真正的失敗原因;legacy 列曾路由過就算有頁', () => {
    expect(canRerouteExtraction(baseRun({ metadata: { page_count: 0 } }), 'contract')).toBe(false)
    expect(canRerouteExtraction(baseRun({ metadata: {} }), 'contract')).toBe(false)
    expect(canRerouteExtraction(baseRun({ metadata: { requirement_extraction: 'failed' } }), 'contract')).toBe(true)
  })
})

describe('reclassifyProcessingRun(改分類/確認分類/重試的狀態機)', () => {
  let rec
  beforeEach(() => { h.extract.mockReset() })

  it('文件分類寫入失敗:回錯誤訊息,不動 run、不打抽取、不回呼', async () => {
    rec = writeRecorder({ documents: () => ({ data: null, error: { message: 'permission denied' } }) })
    h.from = rec.from
    const onRunPatch = vi.fn(); const onDocumentTyped = vi.fn()
    const result = await reclassifyProcessingRun({ run: baseRun(), newType: 'contract', documentId: 'doc1', projectId: 'p1', onRunPatch, onDocumentTyped })
    expect(result.ok).toBe(false)
    expect(result.inProgress).toBe(false)
    expect(result.message).toContain('分類更新失敗')
    expect(rec.updates('document_processing_runs')).toHaveLength(0)
    expect(h.extract).not.toHaveBeenCalled()
    expect(onRunPatch).not.toHaveBeenCalled(); expect(onDocumentTyped).not.toHaveBeenCalled()
  })

  it('改成非抽取類型:只確認分類;舊的「找到 N 項」訊息改成 skipped,建議仍留在佇列', async () => {
    rec = writeRecorder({ document_processing_runs: (q) => ({ data: { id: 'run1', ...q.payload }, error: null }) })
    h.from = rec.from
    const onDocumentTyped = vi.fn()
    const run = baseRun({ metadata: { page_count: 12, requirement_extraction: 'completed', requirement_extraction_message: '找到 3 項契約重點建議' } })
    const result = await reclassifyProcessingRun({ run, newType: 'other', documentId: 'doc1', projectId: 'p1', onDocumentTyped })
    expect(onDocumentTyped).toHaveBeenCalledWith('doc1', 'other')
    expect(h.extract).not.toHaveBeenCalled()
    const writes = rec.updates('document_processing_runs')
    expect(writes).toHaveLength(1)
    expect(writes[0].filters).toEqual([['id', 'run1']])
    expect(writes[0].payload.classification_status).toBe('confirmed')
    expect(writes[0].payload.metadata).toMatchObject({
      requirement_extraction: 'skipped', requirement_extraction_warning: null, routed_document_type: 'other',
    })
    expect(writes[0].payload.metadata.requirement_extraction_message).not.toContain('找到')
    expect(result).toEqual({ ok: true, run: { id: 'run1', ...writes[0].payload } })
  })

  it('非抽取類型且沒有舊抽取:payload 只有 classification_status,不捏造 metadata', async () => {
    rec = writeRecorder(); h.from = rec.from
    await reclassifyProcessingRun({ run: baseRun(), newType: 'other', documentId: null, projectId: 'p1' })
    expect(rec.updates('documents')).toHaveLength(0)   // 沒有 documentId 就不碰 documents
    expect(rec.updates('document_processing_runs')[0].payload).toEqual({ classification_status: 'confirmed' })
  })

  it('可抽取類型:重啟 run(started_at 重設)→ 進度心跳落庫並回呼 → 收尾 completed 帶揭露訊息', async () => {
    rec = writeRecorder({ document_processing_runs: (q) => ({ data: { id: 'run1', ...q.payload }, error: null }) })
    h.from = rec.from
    h.extract.mockImplementation(async ({ documentVersionId, projectId, onProgress }) => {
      expect(documentVersionId).toBe('v1'); expect(projectId).toBe('p1')
      onProgress({ batches_completed: 1, batches_total: 3 })
      return { ok: true, data: { extracted_requirement_count: 5, auto_confirmed_count: 5, flagged_count: 1 } }
    })
    const onRunPatch = vi.fn()
    const before = Date.now()
    const result = await reclassifyProcessingRun({ run: baseRun(), newType: 'contract', documentId: 'doc1', projectId: 'p1', onRunPatch })
    const runWrites = rec.updates('document_processing_runs')
    expect(runWrites.map((w) => w.payload.status ?? 'heartbeat')).toEqual(['processing', 'heartbeat', 'completed'])
    // 重啟:staleProcessingPatch 以 started_at 起算 20 分鐘,不重設會被輪詢立刻誤判成中斷
    const restart = runWrites[0].payload
    expect(restart).toMatchObject({ classification_status: 'confirmed', stage: 'extracting_requirements', completed_at: null, error_message: null })
    expect(new Date(restart.started_at).getTime()).toBeGreaterThanOrEqual(before)
    expect(onRunPatch).toHaveBeenNthCalledWith(1, restart)
    // 心跳:extraction_progress + extraction_progress_at,原 metadata 保留
    const heartbeat = runWrites[1].payload.metadata
    expect(heartbeat).toMatchObject({ filename_kind: 'pdf', page_count: 12, extraction_progress: '1/3' })
    expect(heartbeat.extraction_progress_at).toBeTruthy()
    expect(onRunPatch).toHaveBeenNthCalledWith(2, { metadata: heartbeat })
    // 收尾
    const final = runWrites[2].payload
    expect(final).toMatchObject({ classification_status: 'confirmed', status: 'completed', stage: 'completed', error_message: null })
    expect(final.metadata).toMatchObject({ requirement_extraction: 'completed', requirement_extraction_warning: null, routed_document_type: 'contract' })
    expect(final.metadata.requirement_extraction_message).toContain('找到 5 項契約重點建議')
    expect(final.metadata.requirement_extraction_message).toContain('1 項未逐字核對')
    expect(result).toEqual({ ok: true, run: { id: 'run1', ...final } })
  })

  it('409 已有別的解析在跑:回 inProgress、不寫收尾——不可把活著的解析蓋成失敗(W13)', async () => {
    rec = writeRecorder(); h.from = rec.from
    h.extract.mockResolvedValue({ ok: false, inProgress: true, message: '此文件已有解析在進行中' })
    const result = await reclassifyProcessingRun({ run: baseRun(), newType: 'contract', documentId: null, projectId: 'p1' })
    expect(result).toEqual({ ok: false, inProgress: true, message: '此文件已有解析在進行中' })
    const runWrites = rec.updates('document_processing_runs')
    expect(runWrites).toHaveLength(1)
    expect(runWrites[0].payload.status).toBe('processing')
  })

  it('抽取真失敗:收尾成可重試的 partial/failed,錯誤原話進 error_message', async () => {
    rec = writeRecorder({ document_processing_runs: (q) => ({ data: { id: 'run1', ...q.payload }, error: null }) })
    h.from = rec.from
    h.extract.mockResolvedValue({ ok: false, inProgress: false, message: '方案未開通 AI 抽取' })
    const result = await reclassifyProcessingRun({ run: baseRun(), newType: 'specification', documentId: null, projectId: 'p1' })
    const final = rec.updates('document_processing_runs').at(-1).payload
    expect(final).toMatchObject({ status: 'partial', stage: 'failed', error_message: '方案未開通 AI 抽取' })
    expect(final.metadata).toMatchObject({ requirement_extraction: 'failed', requirement_extraction_message: '方案未開通 AI 抽取', requirement_extraction_warning: null })
    expect(result.ok).toBe(true)
  })

  it('收尾寫入 select 回不到列:仍算成功,run 為 null(呼叫端靠重載補)', async () => {
    rec = writeRecorder(); h.from = rec.from
    h.extract.mockResolvedValue({ ok: true, data: { extracted_requirement_count: 0 } })
    const result = await reclassifyProcessingRun({ run: baseRun(), newType: 'contract', documentId: null, projectId: 'p1' })
    expect(result).toEqual({ ok: true, run: null })
  })
})

describe('healStaleRuns(中斷復原的寫入,與讀取分開)', () => {
  const now = Date.parse('2026-09-11T10:00:00Z')
  const stale = { id: 'old', status: 'processing', stage: 'uploaded', started_at: new Date(now - PROCESSING_STALE_MS - 1000).toISOString(), metadata: {} }
  const fresh = { id: 'new', status: 'processing', stage: 'uploaded', started_at: new Date(now - 1000).toISOString(), metadata: {} }
  const done = { id: 'done', status: 'completed', stage: 'completed', started_at: new Date(now - PROCESSING_STALE_MS * 2).toISOString(), metadata: {} }

  it('只把過期的 processing 列蓋成 partial,新鮮列與終態列一筆都不碰', async () => {
    const rec = writeRecorder({ document_processing_runs: (q) => ({ data: { ...stale, ...q.payload }, error: null }) })
    h.from = rec.from
    const healed = await healStaleRuns([stale, fresh, done], { now })
    expect(rec.updates()).toHaveLength(1)
    expect(rec.updates()[0].filters).toEqual([['id', 'old']])
    expect(rec.updates()[0].payload).toMatchObject({ status: 'partial', stage: 'failed' })
    expect(healed[0]).toMatchObject({ id: 'old', status: 'partial' })
    expect(healed[1]).toBe(fresh); expect(healed[2]).toBe(done)
  })
  it('shouldContinue 回 false(切案/切包)就停手,不改別包的列', async () => {
    const rec = writeRecorder(); h.from = rec.from
    const healed = await healStaleRuns([stale], { now, shouldContinue: () => false })
    expect(rec.updates()).toHaveLength(0)
    expect(healed[0]).toBe(stale)
  })
  it('寫入回不到列:原列保留,下次載入再修', async () => {
    const rec = writeRecorder({ document_processing_runs: () => ({ data: null, error: { message: 'boom' } }) })
    h.from = rec.from
    const healed = await healStaleRuns([stale], { now })
    expect(healed[0]).toBe(stale)
  })
})

describe('loadPackageRuns(單一契約包的處理狀態,純讀取)', () => {
  let db
  beforeEach(() => {
    db = createFakePostgrest(); h.from = db.supabase.from
    db.setTable('documents', [{ id: 'doc1', contract_package_id: 'pkg1', title: '契約.pdf', document_type: 'contract' }])
    db.setTable('document_versions', [{ id: 'v1', document_id: 'doc1', version_label: 'v1' }])
  })

  it('涵蓋率警示只看每個版本「最近一次完成」的擷取;舊 run 的缺漏不得蓋到新 run', async () => {
    db.setTable('document_processing_runs', [
      { id: 'run1', contract_package_id: 'pkg1', document_version_id: 'v1', status: 'completed', started_at: '2026-09-01T00:00:00Z', metadata: { requirement_extraction: 'completed' } },
    ])
    db.setTable('document_ingestion_runs', [
      { id: 'ing-old', document_version_id: 'v1', status: 'completed', started_at: '2026-09-01T00:00:00Z', metadata: { coverage_incomplete: true, last_included_page: 3, total_page_count: 9 } },
      { id: 'ing-new', document_version_id: 'v1', status: 'completed', started_at: '2026-09-02T00:00:00Z', metadata: { coverage_incomplete: false } },
      { id: 'ing-failed', document_version_id: 'v1', status: 'failed', started_at: '2026-09-03T00:00:00Z', metadata: { coverage_incomplete: true } },
    ])
    db.setTable('requirements', [
      { id: 'r1', ingestion_run_id: 'ing-new', status: 'approved' },
      { id: 'r2', ingestion_run_id: 'ing-old', status: 'approved' },
      { id: 'r3', ingestion_run_id: 'ing-new', status: 'rejected' },
    ])
    const { runs, docs, versions, aiCount } = await loadPackageRuns('pkg1')
    expect(runs[0].metadata.requirement_extraction_warning).toBeNull()
    expect(docs.map((d) => d.id)).toEqual(['doc1']); expect(versions.map((v) => v.id)).toEqual(['v1'])
    expect(aiCount).toBe(2)   // 已核定=approved,不分新舊 run
    // 純讀取:一次寫入都沒有(fakePostgrest 只有查詢,能走到這裡就代表沒呼叫 update)
    expect(db.requests.every((r) => r.table)).toBe(true)
  })

  it('最近一次完成的擷取有缺漏 → 警示併進 completed run 的 metadata;未跑抽取的 run 不掛警示', async () => {
    db.setTable('document_processing_runs', [
      { id: 'run1', contract_package_id: 'pkg1', document_version_id: 'v1', status: 'completed', started_at: '2026-09-01T00:00:00Z', metadata: { requirement_extraction: 'completed' } },
      { id: 'run-skip', contract_package_id: 'pkg1', document_version_id: 'v1', status: 'completed', started_at: '2026-09-01T00:00:01Z', metadata: { requirement_extraction: 'skipped' } },
    ])
    db.setTable('document_ingestion_runs', [
      { id: 'ing1', document_version_id: 'v1', status: 'completed', started_at: '2026-09-01T00:00:00Z', metadata: { coverage_incomplete: true, last_included_page: 3, total_page_count: 9 } },
    ])
    db.setTable('requirements', [])
    const { runs } = await loadPackageRuns('pkg1')
    expect(runs[0].metadata.requirement_extraction_warning).toContain('未涵蓋整份文件')
    expect(runs[1].metadata.requirement_extraction_warning).toBeUndefined()
  })

  it('任一段查詢失敗就 throw(呼叫端顯示可重試的錯誤,不偽裝成無文件)', async () => {
    db.setTable('document_processing_runs', new Error('文件服務暫時無法使用'))
    await expect(loadPackageRuns('pkg1')).rejects.toMatchObject({ message: '文件服務暫時無法使用' })
  })

  it('超過 1000 筆 run 仍全部讀回(PostgREST 靜默截斷的護欄)', async () => {
    db.setTable('document_processing_runs', Array.from({ length: 1001 }, (_, i) => ({
      id: `run${String(i).padStart(4, '0')}`, contract_package_id: 'pkg1', document_version_id: 'v1', status: 'completed', started_at: '2026-09-01T00:00:00Z', metadata: {},
    })))
    db.setTable('document_ingestion_runs', []); db.setTable('requirements', [])
    const { runs } = await loadPackageRuns('pkg1')
    expect(runs).toHaveLength(1001)
    expect(db.requestsFor('document_processing_runs').some((q) => q.from === 1000)).toBe(true)
  })
})
