// Supabase Edge Function: classify-site-photo
// ---------------------------------------------------------------------------
// 一張工地照片 → Claude 視覺 → 施工照片簿分類:照片簿說明、類別、對應工項關鍵詞、
// 可見施作/數量線索。用於「批次辨識」:承包商一次丟多張現場照,自動生說明+配工項。
//
// work_item_hint 只給「關鍵詞」,實際對應哪個標單工項由前端用標單模糊比對(matchLeaf),
// 不在雲端硬編工項——工項因案而異(見 pmis-contract-driven-forms 原則)。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy classify-site-photo --use-api

import { claudeJson, imageBlock, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string', description: '施工照片簿說明,20 字內,如「三樓外牆磁磚黏貼」「基礎底版鋼筋綁紮」。只描述照片可見內容。' },
    category: {
      type: 'string',
      enum: ['施工作業', '材料機具', '查驗會勘', '工地環境', '缺失異常', '其他'],
      description: '照片類別。施工作業=施作中;材料機具=料件進場/機具設備;查驗會勘=量測/會勘/驗收;工地環境=整地/圍籬/告示;缺失異常=可見缺失或安全異常。',
    },
    work_item_hint: { type: 'string', description: '照片對應的工項關鍵詞(供比對標單),如「外牆磁磚」「鋼筋」「模板」「瀝青鋪面」;判斷不出填空字串。' },
    visible_progress: { type: 'string', description: '照片可見的施作內容或數量線索,25 字內,如「約完成一面外牆」;看不出填空字串。' },
  },
  required: ['caption', 'category', 'work_item_hint', 'visible_progress'],
}

const PROMPT =
  '這是台灣公共工程的工地現場照片,要放進「施工照片簿」。請以工地管理角度判讀:\n' +
  '1) 一句話的照片簿說明(工項/部位/施作內容);\n' +
  '2) 照片類別;\n' +
  '3) 最相關的工項關鍵詞(供對應標單,只給關鍵詞不要編標單項次);\n' +
  '4) 可見的施作進度或數量線索。\n' +
  '只根據照片「可見」內容判讀,不要臆測看不到的東西;無法判斷的欄位回空字串。'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { image_base64, mime_type } = await req.json()
    if (!image_base64) return json({ error: '缺少 image_base64' }, 400)
    const { data, error } = await claudeJson({
      model: MODELS.fast, name: 'site_photo', schema: SCHEMA, maxTokens: 400,
      content: [{ type: 'text', text: PROMPT }, imageBlock(image_base64, mime_type || 'image/jpeg')],
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
