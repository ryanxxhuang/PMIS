// Supabase Edge Function: classify-site-photo
// ---------------------------------------------------------------------------
// 一張工地照片 → Claude 視覺 → 施工照片簿分類:照片簿說明、類別、對應工項關鍵詞、
// 可見施作/數量線索、白板施作區域(location)。用於「批次辨識」:承包商一次丟多張
// 現場照,自動生說明+配工項;同工項不同區域(W8-5 ISSUE-4)靠 location 區分。
//
// work_item_hint 只給「關鍵詞」,實際對應哪個標單工項由前端用標單模糊比對(matchLeaf),
// 不在雲端硬編工項——工項因案而異(見 pmis-contract-driven-forms 原則)。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy classify-site-photo --use-api

import { claudeJson, imageBlock, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'
import { openAiGate, closeAiGate } from '../_shared/aiGate.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string', description: '施工照片簿說明,40 字內。若照片中有查驗黑板/告示板/白板,**必須把板上可辨識的關鍵數據抄進來**(如鋼筋號數 #4(D13)、間距 15×15cm、搭接長度 ≥27cm、樓層/位置);沒有板子才用一句話描述可見內容,如「三樓外牆磁磚黏貼」。' },
    category: {
      type: 'string',
      enum: ['施工作業', '材料機具', '查驗會勘', '工地環境', '缺失異常', '其他'],
      description: '照片類別。施工作業=施作中;材料機具=料件進場/機具設備;查驗會勘=量測/會勘/驗收;工地環境=整地/圍籬/告示;缺失異常=可見缺失或安全異常。',
    },
    is_construction: { type: 'boolean', description: '照片是否為營建工地的施工/材料/機具/查驗現場。若為一般住宅室內、辦公室、風景、人像等非工地照片,回 false。' },
    work_item_hint: { type: 'string', description: '照片對應的工項關鍵詞(供比對標單),用標單常見的完整工項詞彙,如「鋼筋加工及組立」「模板組立」「混凝土澆置」「外牆磁磚」「瀝青混凝土鋪面」;避免只給單一名詞(如只寫「鋼筋」);**必須是被施作的對象(材料/構件),不得是活動類型**——「查驗」「會勘」「量測」「巡檢」不是工項,查驗照片的 hint 要寫被查驗的東西(如鋼筋);判斷不出、或 is_construction=false 時一律填空字串,寧可不配也不要硬套。' },
    visible_progress: { type: 'string', description: '照片「可見」的施作內容,25 字內;**只准描述看得到的物件與動作**,嚴禁使用「完成、已完成、測試中、就位、已驗收」等從照片無法判定的狀態詞;看不出填空字串。' },
    // W8-7:同工項多區域施作(如各區鋼筋)靠這欄分流到不同日誌列,所以獨立成結構化欄位,
    // 不能只混在 caption 自由文字裡;寧缺勿錯——location 之後直接進表單,猜錯比留空更難察覺。
    location: { type: ['string', 'null'], description: '施作區域/樓層,**只准照抄查驗黑板/告示板/白板上寫的區域欄位**(如「A區1F」「B棟3F 柱牆」);照片中沒有板子、或板上區域欄讀不清楚,一律回 null,**嚴禁從畫面自行推測區域**。' },
  },
  required: ['caption', 'category', 'is_construction', 'work_item_hint', 'visible_progress', 'location'],
}

const PROMPT =
  '這是要放進「施工照片簿」的照片。請以工地管理角度判讀:\n' +
  '1) 先判斷這是不是營建工地的施工/材料/機具/查驗現場(is_construction);若不是(如住宅室內、廚房、辦公室、風景),caption 據實描述、category 用「其他」、work_item_hint 與 visible_progress 一律空字串、location 一律 null,不得硬套工項或說成本案施工。\n' +
  '2) 照片簿說明:照片中若有查驗黑板/告示板,把板上讀得到的關鍵數據抄進說明(鋼筋號數、間距、搭接長度、樓層位置等,讀不清楚的字不要猜);沒有板子就一句話描述可見內容;\n' +
  '3) 照片類別;\n' +
  '4) 最相關的工項關鍵詞(供對應標單,只給關鍵詞不編項次;判斷不出留空);\n' +
  '5) 可見的施作內容(只描述看得到的,禁用「完成/測試中/就位/已驗收」等狀態詞);\n' +
  '6) 施作區域(location):**優先從查驗黑板/告示板/白板抄錄施作區域或樓層欄位**(如「A區1F」「B棟3F 柱牆」),照抄板上文字即可;照片中沒有板子、板上沒寫區域、或字跡讀不清楚,一律回 null,**不得從畫面推測**;說明(caption)裡仍可自然提到位置,兩者互不取代。\n' +
  '只根據照片「可見」內容判讀,不要臆測看不到的東西;寧可留空也不要編。'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  // 批 B 閘門:登入+成員資格+功能開關(擋下記 blocked);通過後 AI 呼叫結果記用量
  const body = await req.json().catch(() => null)
  const gate = await openAiGate(req, { feature: 'photo.classify', projectId: body?.project_id })
  if (!gate.ok) return gate.response
  try {
    const { image_base64, mime_type } = body || {}
    if (!image_base64) return json({ error: '缺少 image_base64' }, 400)
    const { data, error, usage, model } = await claudeJson({
      model: MODELS.fast, name: 'site_photo', schema: SCHEMA, maxTokens: 400,
      content: [{ type: 'text', text: PROMPT }, imageBlock(image_base64, mime_type || 'image/jpeg')],
    })
    if (error) {
      await closeAiGate(gate, { feature: 'photo.classify', model, usage, status: 'error', errorCode: 'claude_error' })
      return json({ error }, 502)
    }
    await closeAiGate(gate, { feature: 'photo.classify', model, usage, status: 'ok' })
    return json(data, 200)
  } catch (e) {
    await closeAiGate(gate, { feature: 'photo.classify', status: 'error', errorCode: 'exception' })
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
