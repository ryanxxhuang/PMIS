// 共用 Claude API 呼叫層(Anthropic Messages API)。
// 結構化輸出:強制 tool use(tool_choice 指定工具)→ 回傳一定符合 input_schema 的 JSON。
// 金鑰只在雲端 secret(ANTHROPIC_API_KEY),永不進前端。
// 模型分工:fast=視覺辨識/短文生成(便宜快);smart=長文件抽取(契約/規範)。

export const MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  smart: 'claude-sonnet-5',
}

type ContentBlock = Record<string, unknown>

export async function claudeJson(opts: {
  model: string
  content: ContentBlock[] | string
  schema: Record<string, unknown>
  name: string           // 工具名(描述輸出用途)
  maxTokens?: number
  system?: string
}): Promise<{ data?: unknown; error?: string }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return { error: '伺服器未設定 ANTHROPIC_API_KEY' }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
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
  })
  if (!resp.ok) return { error: `Claude ${resp.status}: ${await resp.text()}` }
  const data = await resp.json()
  const tu = (data.content || []).find((b: { type: string }) => b.type === 'tool_use')
  if (!tu?.input) return { error: 'AI 未回傳結構化內容' }
  return { data: tu.input }
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
