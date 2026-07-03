// Supabase Edge Function: describe-defect
// ---------------------------------------------------------------------------
// 收一張工地缺失照片 → OpenAI 視覺模型 → 缺失表單欄位(標題/說明/嚴重度/位置/改善建議)。
// 與 read-whiteboard 同模式:金鑰只在此,原生 fetch 零依賴,verify_jwt 預設開啟。
//
// 部署:supabase functions deploy describe-defect

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
    title: { type: 'string', description: '缺失標題,15 字內,如「鋼筋保護層不足」;照片無明顯缺失就空字串' },
    description: { type: 'string', description: '缺失狀況描述,60 字內,只描述照片可見的事實' },
    severity: { type: 'string', enum: ['輕微', '一般', '嚴重'], description: '嚴重度判斷' },
    location: { type: 'string', description: '照片可辨識的位置線索(樓層/構件),看不出來就空字串' },
    suggestion: { type: 'string', description: '改善建議,40 字內' },
  },
  required: ['title', 'description', 'severity', 'location', 'suggestion'],
}

const PROMPT =
  '這是台灣公共工程工地的品質缺失照片。請以三級品管的角度描述照片中可見的施工品質缺失,' +
  '產出:缺失標題、狀況描述、嚴重度(輕微/一般/嚴重)、位置線索、改善建議。' +
  '只根據照片可見內容,不要臆測;若照片看不出明顯缺失,title 回空字串並在 description 說明。'

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
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
        response_format: { type: 'json_schema', json_schema: { name: 'defect', strict: true, schema: SCHEMA } },
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
