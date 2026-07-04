// Supabase Edge Function: draft-monthly-review
// ---------------------------------------------------------------------------
// 收月報彙整數據(前端算好的 stats)→ Claude 產生「本月檢討」與「下月工作計畫」草稿。
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
//
// 部署:supabase functions deploy draft-monthly-review

import { claudeJson, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    review: { type: 'string', description: '本月檢討,150 字內,工地主任口吻的短段落' },
    next_plan: { type: 'string', description: '下月工作計畫,150 字內,依本月施工內容合理延伸' },
  },
  required: ['review', 'next_plan'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { month, project_name, stats } = await req.json()
    if (!stats) return json({ error: '缺少 stats' }, 400)

    const prompt =
      `你是台灣公共工程承攬廠商的工地主任,正在撰寫「${project_name || '本工程'}」${month} 施工月報的` +
      `「本月檢討」與「下月工作計畫」兩欄。以下是系統彙整的當月數據(JSON):\n` +
      JSON.stringify(stats) +
      '\n請只根據數據撰寫,不要臆測數據以外的事實。' +
      '檢討需點出進度超前/落後與主要影響因素(如雨天數、缺失情形),口吻務實。' +
      '下月計畫依本月施工項目合理延伸,用「預定持續辦理…」等保守措辭。' +
      '各 150 字內,不用條列符號,直接寫成短段落,使用繁體中文。'

    const { data, error } = await claudeJson({
      model: MODELS.fast, name: 'monthly_review', schema: SCHEMA, maxTokens: 1024,
      content: prompt,
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
