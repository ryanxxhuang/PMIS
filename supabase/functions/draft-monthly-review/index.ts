// Supabase Edge Function: draft-monthly-review
// ---------------------------------------------------------------------------
// 收月報彙整數據(前端算好的 stats)→ OpenAI 產生「本月檢討」與「下月工作計畫」草稿。
// 與 read-whiteboard 同模式:金鑰只在此(Deno.env.OPENAI_API_KEY),原生 fetch 零依賴。
//
// 部署:supabase functions deploy draft-monthly-review
// verify_jwt 預設開啟 → 只有登入使用者可呼叫。

const MODEL = 'gpt-4o'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    review: { type: 'string', description: '本月檢討,150 字內,工地主任口吻的短段落' },
    next_plan: { type: 'string', description: '下月工作計畫,150 字內,依本月施工內容合理延伸' },
  },
  required: ['review', 'next_plan'],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { month, project_name, stats } = await req.json()
    if (!stats) return json({ error: '缺少 stats' }, 400)
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: '伺服器未設定 OPENAI_API_KEY' }, 500)

    const prompt =
      `你是台灣公共工程承攬廠商的工地主任,正在撰寫「${project_name || '本工程'}」${month} 施工月報的` +
      `「本月檢討」與「下月工作計畫」兩欄。以下是系統彙整的當月數據(JSON):\n` +
      JSON.stringify(stats) +
      '\n請只根據數據撰寫,不要臆測數據以外的事實。' +
      '檢討需點出進度超前/落後與主要影響因素(如雨天數、缺失情形),口吻務實。' +
      '下月計畫依本月施工項目合理延伸,用「預定持續辦理…」等保守措辭。' +
      '各 150 字內,不用條列符號,直接寫成短段落。'

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_schema', json_schema: { name: 'monthly_review', strict: true, schema: SCHEMA } },
      }),
    })

    if (!resp.ok) {
      const t = await resp.text()
      return json({ error: `OpenAI ${resp.status}: ${t}` }, 502)
    }
    const data = await resp.json()
    const msg = data.choices?.[0]?.message
    if (msg?.refusal) return json({ error: `AI 婉拒此請求:${msg.refusal}` }, 502)
    if (!msg?.content) return json({ error: 'AI 未回傳內容' }, 502)
    let parsed: unknown
    try { parsed = JSON.parse(msg.content) } catch { return json({ error: '回傳非 JSON', raw: msg.content }, 502) }
    return json(parsed, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
