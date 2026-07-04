// Supabase Edge Function: parse-contract
// ---------------------------------------------------------------------------
// 收一份契約檔(PDF / 掃描 PDF / 圖片)→ Claude 通讀 → 回傳「時程義務清單」。
// 對齊 contract_obligations 表的欄位。長文件抽取用 smart 模型(Sonnet)。
//
// 部署:supabase functions deploy parse-contract
//
// 前端(store.jsx)會先抽出文字再呼叫:Word(.docx)、數位 PDF → 送純文字(準);
// 掃描 PDF/圖片抽不到字 → 退回送 base64 由模型「看」。本函式兩種輸入都吃。

import { claudeJson, imageBlock, pdfBlock, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const OBLIGATION = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '應辦事項' },
    category: { type: 'string', description: '所屬階段:開工前 | 施工中 | 完工 | 保固' },
    trigger_event: {
      type: 'string',
      enum: ['award', 'notice', 'commencement', 'completion', 'monthly', 'fixed', 'other'],
      description: '觸發點:award=決標、notice=接獲開工通知、commencement=開工、completion=完工/竣工、monthly=每月、fixed=契約明定固定日期、other=其他',
    },
    offset_days: { type: 'number', description: '期限天數(相對觸發點);不適用就 0' },
    offset_dir: { type: 'string', enum: ['before', 'after'], description: '在觸發點之前或之後' },
    fixed_date: { type: 'string', description: 'trigger_event=fixed 時的日期 YYYY-MM-DD;否則空字串' },
    recurring: { type: 'string', enum: ['', 'monthly'], description: '週期性;每月填 monthly,否則空字串' },
    recurring_day: { type: 'number', description: '每月幾號(recurring=monthly 時);否則 0' },
    responsible: { type: 'string', description: '負責方:廠商 | 監造 | 機關;不確定就空字串' },
    penalty: { type: 'string', description: '逾期或未提送的罰則;沒有就空字串' },
    source_clause: { type: 'string', description: '出處條款,如 §12.4;沒有就空字串' },
    source_page: { type: 'string', description: '頁碼,如 p.45;沒有就空字串' },
  },
  required: ['title', 'category', 'trigger_event', 'offset_days', 'offset_dir', 'fixed_date',
    'recurring', 'recurring_day', 'responsible', 'penalty', 'source_clause', 'source_page'],
}

const SCHEMA = {
  type: 'object',
  properties: { obligations: { type: 'array', items: OBLIGATION } },
  required: ['obligations'],
}

const PROMPT =
  '以下是台灣公共工程的契約文件。請通讀全文,把散落在各章節、與「時間/期限」有關的所有義務全部抽出來,' +
  '例如:接獲開工通知後幾日內開工;開工前或開工後幾日內應提送的各種計畫書(施工計畫、品質計畫、勞安計畫、預定進度表);' +
  '履約保證金、保險;定期報告(如每月進度報告);竣工/驗收申報期限等。' +
  '每一項請標出:應辦事項、所屬階段、觸發點(對應列舉值)、期限天數與在觸發點之前/之後、是否為每月等週期性、' +
  '負責方、逾期或未提送的罰則、以及出處條款與頁碼。只根據契約內容、不要臆測;找不到的欄位留空字串或 0。盡量找齊。'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { text, file_base64, mime_type, filename } = await req.json()
    if (!text && !file_base64) return json({ error: '缺少 text 或 file_base64' }, 400)

    // 優先用前端抽好的純文字(準);沒有才退回讓模型「看」PDF/圖片。
    let content
    if (text) {
      content = [{ type: 'text', text: `${PROMPT}\n\n=== 契約全文 ===\n${text}` }]
    } else {
      const isPdf = (mime_type || '').includes('pdf') || (filename || '').toLowerCase().endsWith('.pdf')
      content = [
        { type: 'text', text: PROMPT },
        isPdf ? pdfBlock(file_base64) : imageBlock(file_base64, mime_type || 'image/jpeg'),
      ]
    }

    const { data, error } = await claudeJson({
      model: MODELS.smart, name: 'contract_obligations', schema: SCHEMA, maxTokens: 8192,
      content,
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
