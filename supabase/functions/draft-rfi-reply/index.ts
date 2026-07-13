// Supabase Edge Function: draft-rfi-reply
// ---------------------------------------------------------------------------
// 廠商工程疑義(RFI)+ 本專案契約履約需求 → Claude → 監造回覆草稿 + 工期/費用影響研判。
// 回覆為正式契約文件——反幻覺至上:只依提供的契約需求作答;涉及設計圖說/規範細節而
// 提供資料不足者,needs_designer=true 並在回覆載明「需設計單位/建築師釋疑,不宜逕予認定」,
// 絕不臆造規範數值/尺寸/條號。供監造修改後採用。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy draft-rfi-reply --use-api

import { claudeJson, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: '回覆草稿,80–180 字,正式監造用語,供監造修改後採用。' },
    basis: { type: 'string', description: '依據:若源自提供的履約需求,寫該需求標題;若屬通用工程慣例寫「通用」;若須設計釋疑寫「需設計單位釋疑」。不得捏造條號。' },
    needs_designer: { type: 'boolean', description: '此疑義是否須由設計單位/建築師/專業技師釋疑(涉及設計判斷、圖說變更、規範認定而現有資料不足時為 true)。' },
    cost_impact: { type: 'boolean', description: '研判是否可能涉及費用影響。' },
    schedule_impact: { type: 'boolean', description: '研判是否可能涉及工期影響。' },
    caution: { type: 'string', description: '重要提醒;無則空字串。' },
  },
  required: ['answer', 'basis', 'needs_designer', 'cost_impact', 'schedule_impact', 'caution'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const p = await req.json()
    const rfi = p.rfi || {}
    const reqs = (p.requirements || []).slice(0, 20)
    const reqText = reqs.length
      ? reqs.map((r: Record<string, unknown>, i: number) =>
          `需求${i + 1}【${r.title}】${r.acceptance_criteria ? ` 標準:${r.acceptance_criteria}` : ''}${r.evidence_requirement ? ` 應檢附:${r.evidence_requirement}` : ''}`).join('\n')
      : '(本專案尚無已解析的契約履約需求可供比對。)'
    const facts = `疑義主旨:${rfi.title || ''}\n疑義內容:${rfi.question || '(未敘明)'}\n` +
      `廠商註記:${rfi.schedule_impact ? '涉工期影響 ' : ''}${rfi.cost_impact ? '涉費用影響' : ''}\n\n本專案契約履約需求:\n${reqText}`
    const system =
      '你是台灣公共工程的監造工程司,正在回覆廠商提出的工程疑義(RFI)。依提供的契約履約需求與疑義內容草擬回覆。' +
      '這是正式契約文件,務必嚴謹:只依提供的契約需求作答,不得臆造規範數值、尺寸或條號。' +
      '若疑義涉及設計圖說判斷、規範認定而提供資料不足,needs_designer 設為 true,並在回覆中明確載明「本案涉及設計判斷,建議轉請設計單位/建築師釋疑後辦理,不宜逕予認定」。' +
      '一併研判是否涉及工期或費用影響。回覆為草稿,供監造修改後正式發出,語氣正式、精簡。'
    const { data, error } = await claudeJson({
      model: MODELS.fast, name: 'rfi_reply', schema: SCHEMA, maxTokens: 700, system, content: facts,
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
