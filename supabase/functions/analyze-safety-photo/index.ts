// Supabase Edge Function: analyze-safety-photo
// ---------------------------------------------------------------------------
// 一張工地照片 → Claude 視覺 → 職業安全衛生「危害判讀」:危害類別、違反法規依據、
// 嚴重度、位置、改善建議,產出工安缺失表單草稿。與 describe-defect 的差別=**職安衛法規比對**
// (依台灣營造職安衛法規判定違反哪一類、應依哪部法規),而非只描述缺失。
//
// 反幻覺紀律:法規只從下方 SAFETY_REF 內建參考(法規名稱+主題)引用,不自行編造條號;
// 若無合適項回「須現場核對適用條文」。條號交由工安/監造專業現場確認,不出貨錯誤法律引用。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy analyze-safety-photo --use-api

import { claudeJson, imageBlock, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

// 台灣營造業常見職災危害 → 適用職安衛法規(名稱+主題,不含臆造條號)。
// 依此清單 grounding,模型只能從中挑,避免捏造法條。
const SAFETY_REF = `台灣營造工程職業安全衛生法規對照(只可從此引用法規名稱與主題,勿自行編造條號):
- 墜落滾落(高度2公尺以上、開口部、施工架、屋頂、樓梯爬梯、洞口):營造安全衛生設施標準——護欄/護蓋/安全網/工作台;職業安全衛生設施規則——高處作業安全帶與母索。
- 物體飛落/落下:營造安全衛生設施標準——墜落物防護、防護棚、擋腳板、吊掛下方管制。
- 倒塌崩塌(開挖擋土、模板支撐、施工架、構造物):營造安全衛生設施標準——擋土支撐、模板支撐強度、施工架穩固。
- 感電:職業安全衛生設施規則——電氣設備絕緣與接地、漏電斷路器、活線及臨近活線防護。
- 被夾被捲/機械傷害:職業安全衛生設施規則——機械動力傳動裝置護罩、停機上鎖、迴轉部位防護。
- 局限空間/缺氧:缺氧症預防規則;職業安全衛生設施規則——通風換氣、氧濃度監測、進入許可與監視人。
- 火災爆炸/動火作業:職業安全衛生設施規則——危險物管理、動火許可、滅火設備與監火。
- 個人防護具不足:職業安全衛生設施規則——安全帽、安全鞋、護目、防墜等個人防護具之提供與使用。
- 作業環境(通道阻塞、料件堆置不穩、照明不足、未設警示):職業安全衛生設施規則——通道、物料堆放、照明、危險警示。
共通:職業安全衛生法第6條(雇主防止危害義務);違反經通知未改可能涉同法罰則。`

const SCHEMA = {
  type: 'object',
  properties: {
    has_violation: { type: 'boolean', description: '照片是否可見明確的職安衛危害或違規。看不出明顯危害則 false。' },
    hazard_type: {
      type: 'string',
      enum: ['墜落滾落', '物體飛落', '倒塌崩塌', '感電', '被夾被捲', '局限空間缺氧', '火災爆炸', '個人防護具', '作業環境', '其他', '無'],
      description: '職業災害危害類別;無明顯危害填「無」。',
    },
    title: { type: 'string', description: '工安缺失標題,15 字內,如「施工架臨空面未設護欄」;無危害填空字串。' },
    description: { type: 'string', description: '照片可見的危害現況事實描述,60 字內,只描述看得見的,不臆測。' },
    severity: { type: 'string', enum: ['輕微', '一般', '嚴重'], description: '嚴重度:可能致死/重傷(如高處墜落、感電、倒塌)判嚴重。' },
    location: { type: 'string', description: '照片可辨識的位置線索(樓層/構件/區域),看不出填空字串。' },
    violated_regulation: { type: 'string', description: '違反的職安衛法規「名稱+主題」,只可引用參考清單;不確定條號就不要寫條號,可寫「(依現場適用條文核對)」。無危害填空字串。' },
    suggestion: { type: 'string', description: '具體改善建議,40 字內,對應該危害應採取的防護措施。' },
  },
  required: ['has_violation', 'hazard_type', 'title', 'description', 'severity', 'location', 'violated_regulation', 'suggestion'],
}

const PROMPT =
  '你是台灣公共工程的職業安全衛生(工安)專業人員。這是一張施工現場照片,請以職安衛稽核角度判讀:\n' +
  '1) 照片中是否有可見的職安衛危害或違規;\n' +
  '2) 屬於哪一類危害;\n' +
  '3) 依台灣營造職安衛法規,違反或應依循的法規依據;\n' +
  '4) 嚴重度、位置線索、具體改善建議。\n' +
  '只根據照片「可見」的內容判讀,絕不臆測看不到的東西。法規依據只能引用下列參考清單中的法規名稱與主題,' +
  '**嚴禁自行編造法條條號**;若參考清單沒有明確條號,就只寫法規名稱與主題,並附「(依現場適用條文核對)」。' +
  '若照片看不出明顯危害,has_violation 回 false、hazard_type 回「無」、title 空字串,並在 description 說明照片看到的作業內容。\n\n' +
  SAFETY_REF

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { image_base64, mime_type } = await req.json()
    if (!image_base64) return json({ error: '缺少 image_base64' }, 400)
    const { data, error } = await claudeJson({
      model: MODELS.fast, name: 'safety_hazard', schema: SCHEMA, maxTokens: 640,
      content: [{ type: 'text', text: PROMPT }, imageBlock(image_base64, mime_type || 'image/jpeg')],
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
