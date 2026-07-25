// 驗證 agent.ts 多輪 tool-use 迴圈:用注入的 fetchImpl 假造 Claude 回應,
// 重點盯「會 400 的地方」——tool_result 同一則 user 訊息、快取斷點位置、禁傳參數。
import { describe, it, expect, beforeEach } from 'vitest'
import { claudeAgent, stableStringify } from './agent.ts'

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30, cache_creation_input_tokens: 20 }

// 依序回放假造回應,並記錄每次送出的 request body 供斷言
function mockFetch(responses: Array<Record<string, unknown> | Response>) {
  const bodies: Record<string, unknown>[] = []
  const fn = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    const next = responses.shift()
    if (next instanceof Response) return next
    return new Response(JSON.stringify(next ?? {}), { status: 200 })
  }) as typeof fetch
  return { fn, bodies }
}

const TOOLS = [
  { name: 'tool_a', description: '工具 A', input_schema: { type: 'object' } },
  { name: 'tool_b', description: '工具 B', input_schema: { type: 'object' } },
]

const endTurn = (text: string) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: USAGE,
})

const toolUseTurn = () => ({
  stop_reason: 'tool_use',
  content: [
    { type: 'text', text: '我來查查' },
    { type: 'tool_use', id: 'tu_1', name: 'tool_a', input: { keyword: '混凝土' } },
    { type: 'tool_use', id: 'tu_2', name: 'tool_b', input: { period_no: 3 } },
  ],
  usage: USAGE,
})

describe('claudeAgent — 多輪 tool-use 迴圈', () => {
  it('單輪 end_turn:回傳文字正確、usage 累加、steps 為空', async () => {
    const { fn } = mockFetch([endTurn('本期估驗已送審。')])
    const r = await claudeAgent({
      system: 'sys',
      tools: TOOLS,
      exec: async () => ({}),
      userMessage: '估驗到哪了?',
      fetchImpl: fn,
    })
    expect(r.stopReason).toBe('end_turn')
    expect(r.text).toBe('本期估驗已送審。')
    expect(r.steps).toEqual([])
    expect(r.usage).toEqual(USAGE)
    expect(r.error).toBeUndefined()
  })

  it('一輪 tool_use(兩個 block):兩工具都執行、tool_result 同在一則 user 訊息、第二次請求結構正確', async () => {
    const { fn, bodies } = mockFetch([toolUseTurn(), endTurn('查完了。')])
    const called: string[] = []
    const r = await claudeAgent({
      system: 'sys',
      tools: TOOLS,
      exec: async (name) => {
        called.push(name)
        return { from: name }
      },
      userMessage: '幫我查',
      fetchImpl: fn,
    })
    expect(r.stopReason).toBe('end_turn')
    expect(called.sort()).toEqual(['tool_a', 'tool_b'])
    expect(r.steps.map((s) => s.tool)).toEqual(['tool_a', 'tool_b'])
    expect(r.steps.every((s) => s.ok)).toBe(true)
    // usage 兩輪累加
    expect(r.usage.input_tokens).toBe(200)
    expect(r.usage.cache_read_input_tokens).toBe(60)

    // 第二次請求的 messages:原第一則 user + assistant 完整 content + 單一 user 含 2 個 tool_result
    const msgs = bodies[1].messages as Array<{ role: string; content: unknown }>
    expect(msgs).toHaveLength(3)
    expect(msgs[1].role).toBe('assistant')
    // assistant content 原樣保留(含 tool_use block,缺了會 400)
    const asstBlocks = msgs[1].content as Array<{ type: string }>
    expect(asstBlocks.filter((b) => b.type === 'tool_use')).toHaveLength(2)
    expect(msgs[2].role).toBe('user')
    const results = msgs[2].content as Array<{ type: string; tool_use_id: string; content: string }>
    expect(results).toHaveLength(2)
    expect(results.every((b) => b.type === 'tool_result')).toBe(true)
    expect(results.map((b) => b.tool_use_id)).toEqual(['tu_1', 'tu_2'])
    expect(JSON.parse(results[0].content)).toEqual({ from: 'tool_a' })
  })

  it('工具丟例外:對應 tool_result 帶 is_error、迴圈繼續、steps 記 ok:false', async () => {
    const { fn, bodies } = mockFetch([toolUseTurn(), endTurn('部分資料查不到。')])
    const r = await claudeAgent({
      system: 'sys',
      tools: TOOLS,
      exec: async (name) => {
        if (name === 'tool_a') throw new Error('資料庫連線失敗')
        return { ok: true }
      },
      userMessage: '幫我查',
      fetchImpl: fn,
    })
    // 迴圈沒有被例外中斷,仍走到 end_turn
    expect(r.stopReason).toBe('end_turn')
    const stepA = r.steps.find((s) => s.tool === 'tool_a')!
    const stepB = r.steps.find((s) => s.tool === 'tool_b')!
    expect(stepA.ok).toBe(false)
    expect(stepA.error).toContain('資料庫連線失敗')
    expect(stepB.ok).toBe(true)

    const results = (bodies[1].messages as Array<{ content: unknown }>)[2]
      .content as Array<{ tool_use_id: string; is_error?: boolean; content: string }>
    const ra = results.find((b) => b.tool_use_id === 'tu_1')!
    const rb = results.find((b) => b.tool_use_id === 'tu_2')!
    expect(ra.is_error).toBe(true)
    expect(ra.content).toContain('資料庫連線失敗')
    expect(rb.is_error).toBeUndefined()
  })

  it('maxSteps 用盡:stopReason 為 max_steps,不無限迴圈', async () => {
    // 每輪都回 tool_use,只準備 2 份回應 → maxSteps: 2 必須剛好停下
    const { fn, bodies } = mockFetch([toolUseTurn(), toolUseTurn()])
    const r = await claudeAgent({
      system: 'sys',
      tools: TOOLS,
      exec: async () => ({}),
      userMessage: '查',
      maxSteps: 2,
      fetchImpl: fn,
    })
    expect(r.stopReason).toBe('max_steps')
    expect(bodies).toHaveLength(2)
    expect(r.steps).toHaveLength(4) // 兩輪 × 兩工具
  })

  it('HTTP 500:stopReason 為 error 且訊息含狀態碼', async () => {
    const { fn } = mockFetch([new Response('boom', { status: 500 })])
    const r = await claudeAgent({
      system: 'sys',
      tools: TOOLS,
      exec: async () => ({}),
      userMessage: '查',
      fetchImpl: fn,
    })
    expect(r.stopReason).toBe('error')
    expect(r.error).toContain('500')
    expect(r.error).toContain('boom')
  })

  it('快取佈局:persona/facts 各佔 system 一個 block 且都有斷點,facts 不在 user 訊息', async () => {
    const { fn, bodies } = mockFetch([endTurn('好')])
    const toolsInput = TOOLS.map((t) => ({ ...t }))
    await claudeAgent({
      system: 'sys',
      tools: toolsInput,
      exec: async () => ({}),
      userMessage: '進度如何?',
      facts: { project: '道路改善', period: 3 },
      fetchImpl: fn,
    })
    const body = bodies[0]
    // system 兩個 block(persona + facts),兩個都帶斷點;facts 內容在 system[1]
    const system = body.system as Array<Record<string, unknown>>
    expect(system).toHaveLength(2)
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(system[0].text).toBe('sys')
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' })
    expect(String(system[1].text)).toContain('本案事實快照')
    const tools = body.tools as Array<Record<string, unknown>>
    expect(tools[tools.length - 1].cache_control).toEqual({ type: 'ephemeral' })
    expect(tools[0].cache_control).toBeUndefined()
    // 呼叫端傳入的陣列不可被改動(斷點是加在複本上)
    expect(toolsInput[toolsInput.length - 1]).not.toHaveProperty('cache_control')

    // 第一則 user 訊息不再含 facts,只有使用者問題(正規化成 text block 以掛滾動斷點)
    const firstUser = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]
    expect(firstUser.content).toHaveLength(1)
    expect(firstUser.content[0].text).toBe('進度如何?')
    expect(String(JSON.stringify(firstUser.content))).not.toContain('本案事實快照')
    // 斷點總數不可超過 4(超過會 400):persona + facts + tools 尾 + 滾動斷點 = 剛好 4
    expect((JSON.stringify(body).match(/"cache_control"/g) ?? []).length).toBeLessThanOrEqual(4)
  })

  it('滾動斷點:每輪只有一個 messages 斷點且在最後一則訊息尾,總數不超過 4', async () => {
    const { fn, bodies } = mockFetch([toolUseTurn(), toolUseTurn()])
    await claudeAgent({
      system: 'sys',
      tools: TOOLS,
      exec: async () => ({}),
      userMessage: '查',
      facts: { a: 1 },
      maxSteps: 2,
      fetchImpl: fn,
    })
    const body = bodies[1] // 第二輪:messages 已累積 assistant content + tool_result
    const msgs = body.messages as Array<{ content: Array<Record<string, unknown>> }>
    // messages 中帶 cache_control 的 block 恰好一個(移動、不累積)
    const marked = msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.cache_control)
    expect(marked).toHaveLength(1)
    // 且它就是最後一則訊息的最後一個 block
    const lastMsg = msgs[msgs.length - 1]
    expect(lastMsg.content[lastMsg.content.length - 1].cache_control).toEqual({ type: 'ephemeral' })
    // 整包 body 的斷點總數不超過 4(最重要,直接防 400)
    expect((JSON.stringify(body).match(/"cache_control"/g) ?? []).length).toBeLessThanOrEqual(4)
  })

  it('stop_reason 為 tool_use 但沒有 tool_use block:視為 end_turn,不送第二次請求', async () => {
    const { fn, bodies } = mockFetch([
      { stop_reason: 'tool_use', content: [{ type: 'text', text: '嗯' }], usage: USAGE },
    ])
    const r = await claudeAgent({
      system: 'sys',
      tools: TOOLS,
      exec: async () => ({}),
      userMessage: '查',
      fetchImpl: fn,
    })
    expect(r.stopReason).toBe('end_turn')
    expect(r.text).toBe('嗯')
    expect(bodies).toHaveLength(1)
  })

  it('stableStringify:key 順序不同的等價物件產生相同字串', () => {
    const a = { b: 1, a: { y: [1, 2], x: 'v' }, c: undefined }
    const b = { a: { x: 'v', y: [1, 2] }, b: 1 }
    expect(stableStringify(a)).toBe(stableStringify(b))
    expect(stableStringify(a)).toBe('{"a":{"x":"v","y":[1,2]},"b":1}')
  })

  it('送出的 body 不含 temperature / top_p / top_k / thinking', async () => {
    const { fn, bodies } = mockFetch([endTurn('好')])
    await claudeAgent({ system: 'sys', tools: TOOLS, exec: async () => ({}), userMessage: '查', fetchImpl: fn })
    const body = bodies[0]
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('top_k')
    expect(body).not.toHaveProperty('thinking')
    expect(body.output_config).toEqual({ effort: 'high' })
  })
})
