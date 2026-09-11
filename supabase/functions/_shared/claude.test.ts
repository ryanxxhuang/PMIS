// claudeJson 的錯誤遮罩(B1 / H-1):用 globalThis.fetch 假造 Anthropic 回應,
// 釘住「上游回應本文不出現在 error 欄位」。金鑰走 readEnv 的 process.env 退路,
// Node 下不需要 Deno;retries:0 讓每個案例只打一次不等退避。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { claudeJson, readEnv } from './claude.ts'

const SECRET_BODY = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_0123SECRET"}'
const CALL = { model: 'claude-test', content: 'x', schema: { type: 'object' }, name: 'unit_test', retries: 0 }

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ANTHROPIC_API_KEY
})
const logged = () => errSpy.mock.calls.flat().map(String).join('\n')

describe('readEnv:Deno 不存在時退回 process.env', () => {
  it('Node 下讀得到 process.env', () => {
    expect(readEnv('ANTHROPIC_API_KEY')).toBe('test-key')
    expect(readEnv('NOPE_NOT_SET_XYZ')).toBeUndefined()
  })
})

describe('claudeJson 錯誤遮罩', () => {
  it('529 過載:error 是中文短語＋http_529,request_id 與原文只在 console.error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(SECRET_BODY, { status: 529 }))
    const r = await claudeJson(CALL)
    expect(r.errorCode).toBe('http_529')
    expect(r.model).toBe('claude-test')
    expect(r.error).toContain('http_529')
    expect(r.error).not.toContain('req_0123SECRET')
    expect(r.error).not.toContain('Overloaded')
    expect(logged()).toContain('req_0123SECRET')
    expect(logged()).toContain('unit_test')
  })

  it('400 請求錯誤:不重試、遮罩,原文進 log', async () => {
    const fn = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"messages.0: invalid secret detail"}}', { status: 400 }),
    )
    const r = await claudeJson({ ...CALL, retries: 2 })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(r.errorCode).toBe('http_400')
    expect(r.error).not.toContain('invalid secret detail')
    expect(logged()).toContain('invalid secret detail')
  })

  it('網路例外:errorCode=network、例外訊息不外洩', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET host-internal-secret'))
    const r = await claudeJson(CALL)
    expect(r.errorCode).toBe('network')
    expect(r.error).toContain('network')
    expect(r.error).not.toContain('host-internal-secret')
    expect(logged()).toContain('host-internal-secret')
  })

  it('stop_reason=max_tokens:遮罩後短語含 max_tokens,usage/model 照帶(要記帳)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      model: 'claude-real', stop_reason: 'max_tokens', usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', input: { partial: true } }],
    }), { status: 200 }))
    const r = await claudeJson(CALL)
    expect(r.errorCode).toBe('max_tokens')
    expect(r.error).toContain('max_tokens')
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5 })
    expect(r.model).toBe('claude-real')
    expect(r.data).toBeUndefined()
  })

  it('沒有 tool_use block:errorCode=no_tool_use', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'hi' }],
    }), { status: 200 }))
    const r = await claudeJson(CALL)
    expect(r.errorCode).toBe('no_tool_use')
    expect(r.error).toContain('no_tool_use')
  })

  it('缺 ANTHROPIC_API_KEY:errorCode=config,訊息不透露環境變數名', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fn = vi.spyOn(globalThis, 'fetch')
    const r = await claudeJson(CALL)
    expect(fn).not.toHaveBeenCalled()
    expect(r.errorCode).toBe('config')
    expect(r.error).not.toContain('ANTHROPIC')
  })

  it('成功路徑形狀不變:{ data, usage, model, stopReason }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      model: 'claude-real', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 2 },
      content: [{ type: 'tool_use', input: { answer: 42 } }],
    }), { status: 200 }))
    const r = await claudeJson(CALL)
    expect(r.error).toBeUndefined()
    expect(r.data).toEqual({ answer: 42 })
    expect(r.model).toBe('claude-real')
    expect(r.stopReason).toBe('tool_use')
  })
})
