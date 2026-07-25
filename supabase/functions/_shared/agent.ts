// 共用 Claude Agent 迴圈層(Anthropic Messages API,多輪 tool use)。
// 對照 claude.ts 的單輪結構化輸出(claudeJson):這裡讓模型自主決定呼叫哪些查詢工具、
// 來回多輪直到 end_turn,適合「跨模組彙整回答」的 copilot 場景。
// 紅線:工具只查不寫;模型只能引用工具回傳的資料,禁止自行計算(由 system prompt 約束)。
// 金鑰只在雲端 secret(ANTHROPIC_API_KEY),永不進前端。
//
// Claude API 地雷(寫錯會 400,勿改):
// - Sonnet 5 / Opus 5 不可傳 temperature / top_p / top_k / thinking;effort 放 output_config。
// - 一則 assistant 訊息可能含多個 tool_use block(平行工具),全部 tool_result 必須
//   放在「同一則」user 訊息回傳;工具失敗也要回 is_error 的 tool_result,不可丟掉 block。
// - Prompt caching(斷點上限 4 個,超過 400):
//   ① persona(system[0],同角色跨使用者共用)② facts 快照(system[1],跨輪共用;
//   放 system 而非第一則 user 訊息,才不會被逐輪增長的 history 污染前綴、輪輪 cache write)
//   ③ tools 最後一個定義 ④ messages 的「滾動斷點」(每輪移動到最後一則訊息尾,
//   讓累積的 tool_result 吃到快取)。前綴必須逐位元組穩定(facts 用 stableStringify 排序 key)。

import { MODELS } from './claude.ts'

export type ToolDef = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type ToolExec = (name: string, input: Record<string, unknown>) => Promise<unknown>

export type AgentStep = {
  tool: string
  input: Record<string, unknown>
  ok: boolean
  ms: number
  error?: string
}

export type AgentUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type AgentResult = {
  text: string
  steps: AgentStep[]
  usage: AgentUsage
  stopReason: string // end_turn | max_steps | max_tokens | refusal | error
  error?: string
}

// key 排序的 JSON 序列化 —— 保證同樣的事實產生同樣的位元組,prompt cache 才會命中。
// 遞迴排序物件 key;陣列保持順序(元素 undefined 依 JSON 慣例視為 null);
// 物件值為 undefined 視為省略。
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // JSON.stringify(undefined) 會回 undefined,統一以 null 呈現避免產生非法 JSON
    return JSON.stringify(value) ?? 'null'
  }
  // Date 沒有 own enumerable key,走物件分支會變 {};比照 JSON 慣例序列化成 ISO 字串
  if (value instanceof Date) return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue
    parts.push(`${JSON.stringify(key)}:${stableStringify(obj[key])}`)
  }
  return `{${parts.join(',')}}`
}

type Block = Record<string, unknown>

// 工具回傳序列化上限:超過就截斷,避免單一工具輸出撐爆 context
const TOOL_RESULT_MAX_CHARS = 20000

// 滾動快取斷點:設在 messages 最後一則訊息的最後一個 content block,
// 讓迴圈中逐輪累積的 assistant content + tool_result 吃到快取,而非每輪全價重送。
// 斷點總數上限是 4(超過 400):persona + facts + tools 尾已用 3,messages 只剩 1 個名額,
// 所以斷點必須「移動」而非「累積」——每次送出前先清掉先前輪次設過的,再設到新尾端。
// 純字串 content(history、第一則 user 訊息)正規化成 text block 再掛,
// 讓第一輪就能把 history + 使用者問題一併納入快取前綴。
function applyRollingCacheBreakpoint(messages: Block[]) {
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const b of m.content as Block[]) delete b.cache_control
    }
  }
  const last = messages[messages.length - 1]
  if (!last) return
  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content }]
  }
  const blocks = last.content as Block[]
  if (blocks.length > 0) {
    blocks[blocks.length - 1].cache_control = { type: 'ephemeral' }
  }
}

export async function claudeAgent(opts: {
  system: string
  tools: ToolDef[]
  exec: ToolExec
  userMessage: string
  facts?: unknown // 本案事實快照,序列化成 system 的第二個 block 並下快取斷點
  history?: { role: 'user' | 'assistant'; content: string }[] // 只放純文字歷史
  model?: string // 預設 MODELS.agent
  maxSteps?: number // 預設 8
  maxTokens?: number // 預設 8000
  fetchImpl?: typeof fetch // 測試注入用,預設 globalThis.fetch
}): Promise<AgentResult> {
  const steps: AgentStep[] = []
  const usage: AgentUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }

  // Deno.env 只能在函式內取用、且要能容忍 Deno 不存在:
  // 此檔會被 vitest(Node)import 測試,模組頂層或裸寫 Deno.env 會直接 ReferenceError。
  const apiKey =
    (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno?.env?.get?.(
      'ANTHROPIC_API_KEY',
    ) ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { text: '', steps, usage, stopReason: 'error', error: '伺服器未設定 ANTHROPIC_API_KEY' }
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const model = opts.model ?? MODELS.agent
  const maxSteps = opts.maxSteps ?? 8
  const maxTokens = opts.maxTokens ?? 8000

  // system 傳陣列,兩個 block 各下一個快取斷點(system 內不得含時間戳等變動內容):
  // - persona(system[0]):同角色跨使用者共用
  // - facts 快照(system[1]):跨輪共用。放這裡而不是第一則 user 訊息,
  //   否則 facts 的快取前綴含逐輪增長的 history → 每輪都是 cache write、永遠讀不到
  const system: Block[] = [
    { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
    ...(opts.facts !== undefined
      ? [
          {
            type: 'text',
            text: '本案事實快照(唯一資料來源):\n' + stableStringify(opts.facts),
            cache_control: { type: 'ephemeral' },
          },
        ]
      : []),
  ]

  // tools 複製一份(不改動呼叫端的陣列),最後一個工具定義下快取斷點;
  // 呼叫端須保證工具「順序固定」,否則快取前綴失效
  const tools: Block[] = opts.tools.map((t, i) =>
    i === opts.tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : { ...t },
  )

  const messages: Block[] = [
    ...(opts.history ?? []).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: opts.userMessage },
  ]

  const textOf = (content: Block[]) =>
    content
      .filter((b) => b.type === 'text')
      .map((b) => String(b.text ?? ''))
      .join('\n')

  let lastText = ''

  for (let round = 0; round < maxSteps; round++) {
    // 每輪把滾動斷點移到 messages 尾端(第 4 個、也是最後一個可用斷點)
    applyRollingCacheBreakpoint(messages)
    const resp = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      // 不含 temperature/top_p/top_k/thinking:Sonnet 5 會回 400;
      // 省略 thinking 即為 adaptive thinking,effort 一律走 output_config
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        tools,
        messages,
        output_config: { effort: 'high' },
      }),
    })
    if (!resp.ok) {
      return {
        text: lastText,
        steps,
        usage,
        stopReason: 'error',
        error: `Claude ${resp.status}: ${await resp.text()}`,
      }
    }

    const data = await resp.json()
    // usage 欄位可能缺(如未啟用快取),缺就當 0 累加
    const u = (data.usage ?? {}) as Record<string, number | undefined>
    usage.input_tokens += u.input_tokens ?? 0
    usage.output_tokens += u.output_tokens ?? 0
    usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
    usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0

    const content: Block[] = Array.isArray(data.content) ? data.content : []
    lastText = textOf(content) || lastText

    if (data.stop_reason === 'refusal') {
      return {
        text: 'AI 基於安全考量拒絕回應此請求,請調整提問內容後再試。',
        steps,
        usage,
        stopReason: 'refusal',
      }
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = content.filter((b) => b.type === 'tool_use')
      // 防呆:宣稱 tool_use 卻沒有任何 tool_use block → 視為正常收尾,
      // 不可 push 空的 tool_result 訊息(下一輪 API 會 400)
      if (toolUses.length === 0) {
        return { text: lastText, steps, usage, stopReason: 'end_turn' }
      }
      // 整包 content 原樣 append:只取 text 會遺失 tool_use block,下一輪必 400
      messages.push({ role: 'assistant', content })
      // 平行執行全部工具(模型平行呼叫時才不會被序列化拖慢);單一工具失敗不中斷整輪
      const settled = await Promise.all(
        toolUses.map(async (tu) => {
          const name = String(tu.name ?? '')
          const input = (tu.input ?? {}) as Record<string, unknown>
          const t0 = Date.now()
          try {
            const out = await opts.exec(name, input)
            let text = JSON.stringify(out) ?? 'null'
            if (text.length > TOOL_RESULT_MAX_CHARS) {
              text = text.slice(0, TOOL_RESULT_MAX_CHARS) + '…(已截斷)'
            }
            return {
              step: { tool: name, input, ok: true, ms: Date.now() - t0 } as AgentStep,
              result: { type: 'tool_result', tool_use_id: tu.id, content: text } as Block,
            }
          } catch (e) {
            const msg = String((e as { message?: unknown })?.message ?? e)
            return {
              step: { tool: name, input, ok: false, ms: Date.now() - t0, error: msg } as AgentStep,
              result: { type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true } as Block,
            }
          }
        }),
      )
      for (const s of settled) steps.push(s.step)
      // 全部 tool_result 放同一則 user 訊息:拆多則會讓模型之後不再平行呼叫,缺 block 則 400
      messages.push({ role: 'user', content: settled.map((s) => s.result) })
      continue
    }

    if (data.stop_reason === 'max_tokens') {
      return { text: lastText, steps, usage, stopReason: 'max_tokens' }
    }
    // end_turn(或未知 stop_reason 一律視為正常收尾)
    return { text: lastText, steps, usage, stopReason: 'end_turn' }
  }

  // 迴圈用盡仍在呼叫工具 → 以最後一次的 text 收場(可能為空),讓呼叫端決定如何呈現
  return { text: lastText, steps, usage, stopReason: 'max_steps' }
}
