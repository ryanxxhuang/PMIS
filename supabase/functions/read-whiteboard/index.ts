// Supabase Edge Function: read-whiteboard
// ---------------------------------------------------------------------------
// 收一張工地白板照片 → 呼叫 OpenAI 視覺模型(結構化輸出)→ 回傳施工日誌欄位。
// OpenAI 金鑰只存在這裡(Deno.env.OPENAI_API_KEY),永不進到前端 App。
// 用原生 fetch 直打 OpenAI API(edge runtime 下零依賴最穩,不需打包 npm SDK)。
//
// 部署:supabase functions deploy read-whiteboard
// 設密鑰:supabase secrets set OPENAI_API_KEY=sk-...
// verify_jwt 預設開啟 → 只有登入使用者(前端帶 JWT)才能呼叫,擋匿名濫用金鑰。
//
// 想換模型就改下面 MODEL(需為支援視覺 + 結構化輸出的模型)。

const MODEL = 'gpt-4o'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// 結構化輸出 schema(OpenAI strict 模式需 additionalProperties:false 且每層 required 列全欄位)
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    log_date: { type: 'string', description: '白板上的日期,格式 YYYY-MM-DD;沒有就空字串' },
    weather: { type: 'string', description: '天氣;沒有就空字串' },
    location: { type: 'string', description: '施工位置/區域;沒有就空字串' },
    work_summary: { type: 'string', description: '當日工作摘要,一句話;沒有就空字串' },
    items: {
      type: 'array',
      description: '白板上列出的施工工項',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string', description: '工項名稱(照白板文字)' },
          quantity: { type: 'number', description: '當日完成數量;沒寫就 0' },
          unit: { type: 'string', description: '單位;沒寫就空字串' },
          note: { type: 'string', description: '備註;沒有就空字串' },
        },
        required: ['description', 'quantity', 'unit', 'note'],
      },
    },
  },
  required: ['log_date', 'weather', 'location', 'work_summary', 'items'],
}

const PROMPT =
  '這是台灣公共工程的施工現場白板照片。請辨識白板上(手寫或列印)的文字,' +
  '抽出當天施工日誌要填的內容:日期、天氣、施工位置、工作摘要,' +
  '以及白板上列出的各施工工項與其當日完成數量、單位。' +
  '數字一律用阿拉伯數字。看不到的欄位就留空字串、沒有工項就回空陣列。只根據照片內容,不要臆測。'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { image_base64, mime_type } = await req.json()
    if (!image_base64) return json({ error: '缺少 image_base64' }, 400)
    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: '伺服器未設定 OPENAI_API_KEY' }, 500)

    const dataUrl = `data:${mime_type || 'image/jpeg'};base64,${image_base64}`
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
        response_format: { type: 'json_schema', json_schema: { name: 'site_log', strict: true, schema: SCHEMA } },
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
