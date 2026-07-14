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
    is_construction: { type: 'boolean', description: '照片是否為營建工地的施工/材料/機具/查驗現場。若為一般住宅室內、辦公室、風景、人像等非工地照片,回 false。' },
    work_item_hint: { type: 'string', description: '照片對應的工項關鍵詞(供比對標單),如「外牆磁磚」「鋼筋」「模板」「瀝青鋪面」;判斷不出、或 is_construction=false 時一律填空字串,寧可不配也不要硬套。' },
    visible_progress: { type: 'string', description: '照片「可見」的施作內容,25 字內;**只准描述看得到的物件與動作**,嚴禁使用「完成、已完成、測試中、就位、已驗收」等從照片無法判定的狀態詞;看不出填空字串。' },
  },
  required: ['caption', 'category', 'is_construction', 'work_item_hint', 'visible_progress'],
}

const PROMPT =
  '這是要放進「施工照片簿」的照片。請以工地管理角度判讀:\n' +
  '1) 先判斷這是不是營建工地的施工/材料/機具/查驗現場(is_construction);若不是(如住宅室內、廚房、辦公室、風景),caption 據實描述、category 用「其他」、work_item_hint 與 visible_progress 一律空字串,不得硬套工項或說成本案施工。\n' +
  '2) 一句話的照片簿說明(只描述可見內容);\n' +
  '3) 照片類別;\n' +
  '4) 最相關的工項關鍵詞(供對應標單,只給關鍵詞不編項次;判斷不出留空);\n' +
  '5) 可見的施作內容(只描述看得到的,禁用「完成/測試中/就位/已驗收」等狀態詞)。\n' +
  '只根據照片「可見」內容判讀,不要臆測看不到的東西;寧可留空也不要編。'

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
