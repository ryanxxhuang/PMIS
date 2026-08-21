import { vi } from 'vitest'
// 模組 import 鏈會建立真的 supabase client(node 環境無 WebSocket),測試裡換成可編程假件
vi.mock('./supabase.js', () => ({
  supabase: { functions: { invoke: vi.fn() } },
  isSupabaseConfigured: false,
}))
import { beforeEach, describe, expect, it } from 'vitest'
import { supabase } from './supabase.js'
import {
  runRequirementExtraction, functionErrorInfo,
  extractionSuccessMessage, extractionProgressLabel,
} from './extractRequirements.js'

const invoke = supabase.functions.invoke
const httpError = (status, body) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), { status }),
})

beforeEach(() => invoke.mockReset())

describe('runRequirementExtraction(W13 續跑接力)', () => {
  it('一次完成:單一呼叫、不帶 continue_run_id', async () => {
    invoke.mockResolvedValueOnce({ data: { run_id: 'r1', status: 'completed', extracted_requirement_count: 3 }, error: null })
    const result = await runRequirementExtraction({ documentVersionId: 'v1', projectId: 'p1' })
    expect(result.ok).toBe(true)
    expect(result.data.extracted_requirement_count).toBe(3)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][1].body).toEqual({ document_version_id: 'v1', project_id: 'p1' })
  })

  it('in_progress 兩段後完成:自動帶 continue_run_id 接力,onProgress 逐段回報', async () => {
    invoke
      .mockResolvedValueOnce({ data: { run_id: 'r1', status: 'in_progress', batches_total: 3, batches_completed: 1 }, error: null })
      .mockResolvedValueOnce({ data: { run_id: 'r1', status: 'in_progress', batches_total: 3, batches_completed: 2 }, error: null })
      .mockResolvedValueOnce({ data: { run_id: 'r1', status: 'completed', extracted_requirement_count: 9 }, error: null })
    const seen = []
    const result = await runRequirementExtraction({
      documentVersionId: 'v1', projectId: 'p1', onProgress: (p) => seen.push(p.batches_completed),
    })
    expect(result.ok).toBe(true)
    expect(seen).toEqual([1, 2])
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke.mock.calls[0][1].body.continue_run_id).toBeUndefined()
    expect(invoke.mock.calls[1][1].body.continue_run_id).toBe('r1')
    expect(invoke.mock.calls[2][1].body.continue_run_id).toBe('r1')
  })

  it('409 run_conflict(已在解析中)→ inProgress:true + 伺服器原話,呼叫端不得標失敗', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError(409, { error: '這份文件已在解析中,請等它完成或失敗後再試', run_id: 'r9', code: 'run_conflict' }),
    })
    const result = await runRequirementExtraction({ documentVersionId: 'v1', projectId: 'p1' })
    expect(result.ok).toBe(false)
    expect(result.inProgress).toBe(true)
    expect(result.message).toContain('已在解析中')
    expect(result.runId).toBe('r9')
  })

  it('沒帶 code 的 409(部署空窗的舊版函式)保守當 inProgress,避免蓋寫活解析', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError(409, { error: '這份文件已在解析中,請等它完成或失敗後再試', run_id: 'r9' }),
    })
    const result = await runRequirementExtraction({ documentVersionId: 'v1', projectId: 'p1' })
    expect(result.inProgress).toBe(true)
  })

  it('409 restart_required(計畫變更/run 已死)→ 終局失敗,不是「還在跑」', async () => {
    invoke
      .mockResolvedValueOnce({ data: { run_id: 'r1', status: 'in_progress', batches_total: 8, batches_completed: 2 }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: httpError(409, { error: '解析批次計畫已變更(系統更新),請重新啟動解析', run_id: 'r1', status: 'failed', code: 'restart_required' }),
      })
    const result = await runRequirementExtraction({ documentVersionId: 'v1', projectId: 'p1' })
    expect(result.ok).toBe(false)
    expect(result.inProgress).toBe(false)
    expect(result.message).toContain('重新啟動')
  })

  it('403(方案閘門)→ inProgress:false + 伺服器原話(不再是 generic 英文)', async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: httpError(403, { error: '此 AI 功能未啟用(規範需求抽取),請聯絡系統管理者', code: 'feature_disabled' }),
    })
    const result = await runRequirementExtraction({ documentVersionId: 'v1', projectId: 'p1' })
    expect(result).toMatchObject({ ok: false, inProgress: false })
    expect(result.message).toContain('未啟用')
  })

  it('2xx 但 body 帶 error(掃描檔 422 類)→ 真失敗、原話回傳', async () => {
    invoke.mockResolvedValueOnce({ data: { error: '文件沒有可用的已抽取文字', run_id: 'r2', status: 'failed' }, error: null })
    const result = await runRequirementExtraction({ documentVersionId: 'v1', projectId: 'p1' })
    expect(result).toMatchObject({ ok: false, inProgress: false, runId: 'r2' })
    expect(result.message).toContain('已抽取文字')
  })

  it('error.context 讀不出 JSON → 退回 generic 訊息,不炸', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'Failed to send a request' } })
    const result = await runRequirementExtraction({ documentVersionId: 'v1', projectId: 'p1' })
    expect(result).toMatchObject({ ok: false, inProgress: false, message: 'Failed to send a request' })
  })

  it('永遠 in_progress → 撞接力上限後誠實中止,不無限迴圈', async () => {
    invoke.mockResolvedValue({ data: { run_id: 'r1', status: 'in_progress', batches_total: 99, batches_completed: 1 }, error: null })
    const result = await runRequirementExtraction({ documentVersionId: 'v1', projectId: 'p1' })
    expect(result.ok).toBe(false)
    expect(result.inProgress).toBe(false)
    expect(result.message).toContain('已中止')
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(41)
  })
})

describe('functionErrorInfo', () => {
  it('從 FunctionsHttpError 的 Response body 撈出伺服器訊息與狀態碼', async () => {
    const info = await functionErrorInfo(httpError(503, { error: 'AI 功能開關暫時無法確認', code: 'gate_unavailable' }))
    expect(info).toEqual({ status: 503, message: 'AI 功能開關暫時無法確認', runId: null, code: 'gate_unavailable' })
  })

  it('沒有 context 時退回 error.message', async () => {
    const info = await functionErrorInfo({ message: 'boom' })
    expect(info).toEqual({ status: null, message: 'boom', runId: null, code: null })
  })
})

describe('extraction 訊息組裝', () => {
  it('完整涵蓋:只報數量', () => {
    expect(extractionSuccessMessage({ extracted_requirement_count: 12 }))
      .toBe('找到 12 項契約重點建議')
  })

  it('未涵蓋整份文件:必須連著講清楚讀到哪裡(W10 揭露)', () => {
    expect(extractionSuccessMessage({
      extracted_requirement_count: 8, coverage_incomplete: true,
      last_included_page: 41, total_page_count: 69,
    })).toBe('找到 8 項契約重點建議(未涵蓋整份文件:解析至第 41 頁/共 69 頁)')
  })

  it('進度短語', () => {
    expect(extractionProgressLabel({ batches_completed: 2, batches_total: 3 }))
      .toBe('正在分析契約重點(第 2/3 批)')
  })
})
