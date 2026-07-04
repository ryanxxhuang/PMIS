// Supabase Edge Function: read-whiteboard
// ---------------------------------------------------------------------------
// 收一張工地白板照片 → Claude 視覺(強制 tool use 結構化輸出)→ 回傳施工日誌欄位。
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY),永不進前端 App。
//
// 部署:supabase functions deploy read-whiteboard
// verify_jwt 預設開啟 → 只有登入使用者(前端帶 JWT)才能呼叫,擋匿名濫用金鑰。

import { claudeJson, imageBlock, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const SCHEMA = {
  type: 'object',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { image_base64, mime_type } = await req.json()
    if (!image_base64) return json({ error: '缺少 image_base64' }, 400)
    const { data, error } = await claudeJson({
      model: MODELS.fast, name: 'site_log', schema: SCHEMA, maxTokens: 1024,
      content: [{ type: 'text', text: PROMPT }, imageBlock(image_base64, mime_type || 'image/jpeg')],
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
