// Supabase Edge Function: draft-valuation-summary
// ---------------------------------------------------------------------------
// 本期估驗工項 + 現場照片說明 + 施工日誌摘要 → Claude → 一段「本期施工說明」,
// 供估驗請款佐證包,交監造/機關審核。只依提供資料撰寫,不誇大、不臆造數字。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy draft-valuation-summary --use-api

import { claudeJson, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '本期施工說明,120–160 字,正式精簡的公共工程用語。只依提供資料,不誇大不臆造。' },
  },
  required: ['summary'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const p = await req.json()
    const items = (p.items || []).slice(0, 30)
      .map((i: Record<string, unknown>) => `${i.name}${i.period_qty ? `(本期 ${i.period_qty} ${i.unit || ''})` : ''}`).join('、')
    const caps = (p.photo_captions || []).slice(0, 12).join('、')
    const logs = (p.log_summaries || []).slice(0, 12).join('；')
    const facts =
      `第 ${p.period_no ?? ''} 期估驗。本期估驗金額 NT$ ${Math.round(p.period_amount || 0).toLocaleString()}，` +
      `累計完成度 ${(p.completion_pct ?? 0)}%。\n` +
      `本期估驗工項:${items || '(未提供)'}。\n` +
      `現場照片佐證:${caps || '(無)'}。\n` +
      `施工日誌摘要:${logs || '(無)'}。`
    const system =
      '你是台灣公共工程承包商的工地主任,要為「本期估驗計價」撰寫本期施工說明,交監造與機關審核。' +
      '只根據提供的事實撰寫,不得誇大或臆造未提供的數字/工項;語氣為正式、精簡的公共工程用語;120–160 字,單一段落。'
    const { data, error } = await claudeJson({
      model: MODELS.fast, name: 'valuation_summary', schema: SCHEMA, maxTokens: 512,
      system, content: facts,
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
