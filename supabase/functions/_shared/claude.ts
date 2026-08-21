// 共用 Claude API 呼叫層(Anthropic Messages API)。
// 結構化輸出:強制 tool use(tool_choice 指定工具)→ 回傳一定符合 input_schema 的 JSON。
// 金鑰只在雲端 secret(ANTHROPIC_API_KEY),永不進前端。
// 模型分工:fast=視覺辨識/短文生成(便宜快);smart=長文件抽取(契約/規範);
// agent=多輪 tool-use 迴圈主力(見 agent.ts);judge=監造審查/機關稽核等高判斷成本場景。

export const MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  smart: 'claude-sonnet-5',
  agent: 'claude-sonnet-5',   // agent 多輪迴圈主力
  judge: 'claude-opus-5',     // 監造審查/機關稽核等高判斷成本
}

type ContentBlock = Record<string, unknown>

// Anthropic 回應的 usage 形狀(批 B 計量用;欄位可能缺)
export type ClaudeUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// 逾時/重試預設:單次呼叫逾時 120s(長文件抽取一批約 30~90s);429/5xx/網路錯誤
// 重試 2 次、指數退避。逾時或重試耗盡都回明確 error,不再無限等待或靜默失敗。
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 回傳除 { data, error } 外亦帶 usage / model(批 B 計量用,純加法——
// 既有呼叫端只解構 { data, error } 完全不受影響)。
// errorCode / stopReason 亦為純加法:
// * errorCode='max_tokens' = 輸出撞上 maxTokens 上限,tool_use 內容不可信——
//   呼叫端可縮小輸入分批重試;沒檢查 stop_reason 前這種情況會靜默吃到殘缺 JSON。
// * errorCode='timeout' / 'http_<status>' / 'network' 供呼叫端分類記帳。
export async function claudeJson(opts: {
  model: string
  content: ContentBlock[] | string
  schema: Record<string, unknown>
  name: string           // 工具名(描述輸出用途)
  maxTokens?: number
  system?: string
  timeoutMs?: number     // 單次嘗試逾時
  retries?: number       // 僅對 429/5xx/網路錯誤重試
}): Promise<{ data?: unknown; error?: string; errorCode?: string; usage?: ClaudeUsage; model?: string; stopReason?: string }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return { error: '伺服器未設定 ANTHROPIC_API_KEY', errorCode: 'config' }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = opts.retries ?? DEFAULT_RETRIES
  let lastError = ''
  let lastCode = 'network'

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
    let resp: Response
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens ?? 4096,
          ...(opts.system ? { system: opts.system } : {}),
          tools: [{ name: opts.name, description: '回傳結構化解析結果', input_schema: opts.schema }],
          tool_choice: { type: 'tool', name: opts.name },
          messages: [{ role: 'user', content: opts.content }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      const isTimeout = (e as Error)?.name === 'TimeoutError'
      lastError = isTimeout ? `Claude 呼叫逾時(${Math.round(timeoutMs / 1000)}s)` : `Claude 連線失敗:${String((e as Error)?.message || e)}`
      lastCode = isTimeout ? 'timeout' : 'network'
      continue
    }
    if (!resp.ok) {
      lastError = `Claude ${resp.status}: ${(await resp.text()).slice(0, 500)}`
      lastCode = `http_${resp.status}`
      // 429(限流)與 5xx(含 529 過載)可重試;其他 4xx 是請求本身的問題,重試無益
      if (resp.status === 429 || resp.status >= 500) continue
      return { error: lastError, errorCode: lastCode, model: opts.model }
    }
    const data = await resp.json()
    // usage / model 原樣帶回(token 已燒掉,連「未回結構化內容」的失敗也要能記帳)
    const usage = data.usage as ClaudeUsage | undefined
    const model = typeof data.model === 'string' ? data.model : opts.model
    const stopReason = typeof data.stop_reason === 'string' ? data.stop_reason : undefined
    // stop_reason=max_tokens:tool_use input 可能中途被截斷,即使 JSON 湊巧完整
    // 也可能少了後半的項目——一律視為失敗,交呼叫端決定縮小輸入重試
    if (stopReason === 'max_tokens') {
      return { error: 'AI 輸出超過長度上限(stop_reason=max_tokens),結果不完整', errorCode: 'max_tokens', usage, model, stopReason }
    }
    const tu = (data.content || []).find((b: { type: string }) => b.type === 'tool_use')
    if (!tu?.input) return { error: 'AI 未回傳結構化內容', errorCode: 'no_tool_use', usage, model, stopReason }
    return { data: tu.input, usage, model, stopReason }
  }
  return { error: lastError, errorCode: lastCode, model: opts.model }
}

export const imageBlock = (base64: string, mediaType = 'image/jpeg') =>
  ({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } })

export const pdfBlock = (base64: string) =>
  ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } })

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}
