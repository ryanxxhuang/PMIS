// persistBatchItems(B6 自 extract-requirements 抽出)的冪等性與計數時點。
// 冪等是續跑機制的基石:批內暫停後下個 request 會整批重跑,同 run 同 label 同 index
// 必須 upsert 到同一列(docs/architecture/resumable-extraction.md §4);計數時點則釘住
// 「驗證/引註計數不論落庫成敗都算、總數與連結只在落庫成功後加」——與抽出前閉包一致,
// 20260822010200 的計數修正是前車之鑑。
import { vi, describe, it, expect } from 'vitest'
import { persistBatchItems } from './requirementPersist.ts'
import type { PersistBatchContext } from './requirementPersist.ts'
import { buildWorkItemCatalog, deterministicUuid } from './requirementExtraction.ts'

type UpsertCall = { table: string; rows: Record<string, unknown>[]; opts: Record<string, unknown> }

// 最小可用的 service role client 假件:persistBatchItems 只用 from().upsert()
function fakeService(failOn: Record<string, { message: string; code?: string }> = {}) {
  const calls: UpsertCall[] = []
  const service = {
    from(table: string) {
      return {
        upsert(rows: Record<string, unknown>[], opts: Record<string, unknown>) {
          calls.push({ table, rows, opts })
          return Promise.resolve({ error: failOn[table] ?? null })
        },
      }
    },
  } as never
  return { service, calls }
}

const PAGE1 = '第三條 承包商應於開工前十四日內提送施工計畫書予監造單位審查，經核可後始得施工。'
const PAGE2 = '第四條 承包商應每日填寫施工日誌，並於次日中午前送監造單位。'
const pageRows = [
  { page_number: 1, extracted_text: PAGE1, extraction_method: 'pdf_text' },
  { page_number: 2, extracted_text: PAGE2, extraction_method: 'pdf_text' },
]
const catalog = buildWorkItemCatalog([
  { id: 'wi-plan', item_no: '1.1', description: '施工計畫書', is_leaf: true, is_rollup: false },
  { id: 'wi-log', item_no: '1.2', description: '施工日誌', is_leaf: true, is_rollup: false },
])
const RUN = '11111111-1111-4111-8111-111111111111'
const ctx = (
  service: PersistBatchContext['service'], over: Partial<PersistBatchContext> = {},
): PersistBatchContext => ({
  service, runId: RUN, projectId: 'proj-1', documentVersionId: 'dv-1', pageRows, paginated: true, catalog, ...over,
})

// 模型輸出形狀(SUGGESTION_SCHEMA);預設是一筆引註對得上第 1 頁、掛 W1 的有效項
const item = (over: Record<string, unknown> = {}) => ({
  title: '提送施工計畫書',
  description: '',
  requirement_type: 'submittal',
  responsible_party_type: 'contractor',
  lifecycle_phase: '開工前',
  trigger_type: 'commencement',
  trigger_config: { offset_days: 14, offset_dir: 'before', fixed_date: '' },
  frequency_type: '',
  frequency_config: { day: 0, weekday: 0, month: 0 },
  acceptance_criteria: '',
  evidence_requirement: '',
  confidence: 0.9,
  source: { page_number: 1, section: '', clause: '第三條', quotation: '開工前十四日內提送施工計畫書' },
  candidate_work_items: ['W1'],
  ...over,
})
const logItem = () => item({
  title: '填寫施工日誌',
  source: { page_number: 2, section: '', clause: '第四條', quotation: '每日填寫施工日誌' },
  candidate_work_items: ['W2'],
})
const fabricatedPage = () => item({
  source: { page_number: 99, section: '', clause: '', quotation: '開工前十四日內提送施工計畫書' },
})

describe('persistBatchItems 冪等性(同 run 同 label 同 index → 同 UUID)', () => {
  it('同一批重跑兩次:三張表送出的列逐位相同,且一律 ignoreDuplicates upsert', async () => {
    const a = fakeService()
    const b = fakeService()
    const items = [item(), logItem()]
    await persistBatchItems(ctx(a.service), items, 'b0')
    await persistBatchItems(ctx(b.service), items, 'b0')
    expect(a.calls.map((c) => c.table)).toEqual(['requirements', 'requirement_sources', 'requirement_work_items'])
    expect(b.calls).toEqual(a.calls)
    expect(a.calls[0].opts).toEqual({ onConflict: 'id', ignoreDuplicates: true })
    expect(a.calls[1].opts).toEqual({ onConflict: 'id', ignoreDuplicates: true })
    expect(a.calls[2].opts).toEqual({ onConflict: 'requirement_id,work_item_id', ignoreDuplicates: true })
  })

  it('identity 是 (runId, label, index):換 label(對半切子批)或換 run 就是不同列', async () => {
    const same = await deterministicUuid(`${RUN}:b0:requirement:0`)
    const a = fakeService()
    await persistBatchItems(ctx(a.service), [item()], 'b0')
    expect(a.calls[0].rows[0].id).toBe(same)
    const b = fakeService()
    await persistBatchItems(ctx(b.service), [item()], 'b0a')
    expect(b.calls[0].rows[0].id).not.toBe(same)
    const c = fakeService()
    await persistBatchItems(ctx(c.service, { runId: '22222222-2222-4222-8222-222222222222' }), [item()], 'b0')
    expect(c.calls[0].rows[0].id).not.toBe(same)
  })

  it('被丟棄的項目不讓後面的 index 前移:同一份模型輸出重跑仍對到同一列', async () => {
    const a = fakeService()
    const r = await persistBatchItems(ctx(a.service), [item(), { title: '' }, item({ title: '第三項' })], 'b0')
    expect(r.rejected).toEqual([{ index: 'b0:1', reason: 'missing title' }])
    expect(a.calls[0].rows.map((x) => x.id)).toEqual([
      await deterministicUuid(`${RUN}:b0:requirement:0`),
      await deterministicUuid(`${RUN}:b0:requirement:2`),
    ])
    expect(a.calls[1].rows.map((x) => x.id)).toEqual([
      await deterministicUuid(`${RUN}:b0:source:0`),
      await deterministicUuid(`${RUN}:b0:source:2`),
    ])
  })
})

describe('persistBatchItems 落庫內容與計數時點', () => {
  it('引註對得上 → draft_ai + source_verified;捏造頁碼 → needs_review 且 page_number 不落庫', async () => {
    const a = fakeService()
    const r = await persistBatchItems(ctx(a.service), [item(), fabricatedPage()], 'b3')
    expect(r).toMatchObject({
      error: null, verifiedCount: 1, needsReviewCount: 1, rejectedCount: 0,
      totalRequirements: 2, workItemLinkCount: 2,
    })
    const [req, src, wi] = a.calls
    expect(req.rows[0]).toMatchObject({
      status: 'draft_ai', origin: 'ai', project_id: 'proj-1', ingestion_run_id: RUN,
      requirement_type: 'submittal', trigger_config: { offset_days: 14, offset_dir: 'before' },
    })
    expect(req.rows[1]).toMatchObject({ status: 'needs_review' })
    expect(src.rows[0]).toMatchObject({
      requirement_id: req.rows[0].id, document_version_id: 'dv-1', source_kind: 'document',
      source_verified: true, page_number: 1, clause: '第三條', source_text: '開工前十四日內提送施工計畫書',
    })
    expect(src.rows[1]).toMatchObject({ source_verified: false, page_number: null })
    expect(wi.rows).toEqual([
      { requirement_id: req.rows[0].id, work_item_id: 'wi-plan', match_type: 'ai', confidence: 0.9, reviewed: false },
      { requirement_id: req.rows[1].id, work_item_id: 'wi-plan', match_type: 'ai', confidence: 0.9, reviewed: false },
    ])
  })

  it('不認識的工項代號直接丟棄(不猜);沒有連結就不打 requirement_work_items', async () => {
    const a = fakeService()
    const r = await persistBatchItems(ctx(a.service), [item({ candidate_work_items: ['W9'] })], 'b0')
    expect(r.workItemLinkCount).toBe(0)
    expect(a.calls.map((c) => c.table)).toEqual(['requirements', 'requirement_sources'])
  })

  it('整批無有效項目:不打 DB、error null、只有丟棄計數', async () => {
    const a = fakeService()
    const r = await persistBatchItems(ctx(a.service), [{ title: '' }, null, { title: 'x', requirement_type: 'bogus' }], 'b1')
    expect(a.calls).toEqual([])
    expect(r).toEqual({
      error: null, rejectedCount: 3,
      rejected: [
        { index: 'b1:0', reason: 'missing title' },
        { index: 'b1:1', reason: 'not an object' },
        { index: 'b1:2', reason: 'invalid requirement_type: bogus' },
      ],
      verifiedCount: 0, needsReviewCount: 0, totalRequirements: 0, workItemLinkCount: 0,
    })
  })

  it.each([
    ['requirements', ['requirements']],
    ['requirement_sources', ['requirements', 'requirement_sources']],
    ['requirement_work_items', ['requirements', 'requirement_sources', 'requirement_work_items']],
  ])('%s upsert 失敗:回遮罩短語不含原文,驗證/引註已計但總數與連結為 0,後面的表不再寫', async (table, written) => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = 'duplicate key value violates unique constraint "requirements_pkey"'
    const a = fakeService({ [table]: { message: raw, code: '23505' } })
    const r = await persistBatchItems(ctx(a.service), [item(), fabricatedPage()], 'b0')
    expect(r.error?.code).toBe('db_error')
    expect(r.error?.message).not.toContain('requirements_pkey')
    expect(r).toMatchObject({ verifiedCount: 1, needsReviewCount: 1, rejectedCount: 0, totalRequirements: 0, workItemLinkCount: 0 })
    expect(a.calls.map((c) => c.table)).toEqual(written)
    expect(errSpy.mock.calls.some((c) => c.join(' ').includes(raw))).toBe(true)
    errSpy.mockRestore()
  })

  it('非分頁文件:引註對全文查核,page_number 一律 null', async () => {
    const a = fakeService()
    const r = await persistBatchItems(ctx(a.service, {
      paginated: false,
      pageRows: [{ page_number: 1, extracted_text: PAGE1 + PAGE2, extraction_method: 'docx_text' }],
    }), [item({ source: { page_number: 0, section: '', clause: '', quotation: '每日填寫施工日誌' } })], 'b0')
    expect(r.verifiedCount).toBe(1)
    expect(a.calls[1].rows[0]).toMatchObject({ source_verified: true, page_number: null })
  })
})
