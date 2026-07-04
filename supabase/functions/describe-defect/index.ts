// Supabase Edge Function: describe-defect
// ---------------------------------------------------------------------------
// 收一張工地缺失照片 → Claude 視覺 → 缺失表單欄位(標題/說明/嚴重度/位置/改善建議)。
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
//
// 部署:supabase functions deploy describe-defect

import { claudeJson, imageBlock, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const SCHEMA = {
  type: 'object',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { image_base64, mime_type } = await req.json()
    if (!image_base64) return json({ error: '缺少 image_base64' }, 400)
    const { data, error } = await claudeJson({
      model: MODELS.fast, name: 'defect', schema: SCHEMA, maxTokens: 512,
      content: [{ type: 'text', text: PROMPT }, imageBlock(image_base64, mime_type || 'image/jpeg')],
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
