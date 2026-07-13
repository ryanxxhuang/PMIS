// Supabase Edge Function: review-submittal
// ---------------------------------------------------------------------------
// 廠商送審(施工計畫/材料設備/配比/樣品…)→ Claude 依「本專案履約需求(規範解析)」+ 送審類別/工項
// → 監造審查要點清單 + 審查意見草稿 + 建議判定。監造最大時間殺手的自動化。
//
// 反幻覺:規範依據只可引用「傳入的需求」;通用審查要點須標「通用」;不得捏造契約條款/條號。
// 送審文件本體未附(本系統 v1 只追蹤流程),涉及文件實質內容者一律標「需監造核對文件」。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy review-submittal --use-api

import { claudeJson, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    checklist: {
      type: 'array',
      description: '審查要點清單,6–12 點。',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string', description: '應查核事項,一句話。' },
          basis: { type: 'string', description: '依據:若源自提供的履約需求,寫該需求標題;否則寫「通用」。不得捏造條號。' },
          status: { type: 'string', enum: ['已於送審敘明', '需補件', '需監造核對文件'], description: '依送審附件說明研判;涉及文件實質內容一律「需監造核對文件」。' },
        },
        required: ['point', 'basis', 'status'],
      },
    },
    opinion: { type: 'string', description: '審查意見草稿,100–180 字,正式監造用語,供監造修改後採用。' },
    suggested_decision: { type: 'string', enum: ['核准', '核備', '退回補正', '需補充後再核'], description: '建議判定(僅建議,最終由監造裁量)。' },
    caution: { type: 'string', description: '重要提醒,如需人工核對文件本體、需現場查驗等;無則空字串。' },
  },
  required: ['checklist', 'opinion', 'suggested_decision', 'caution'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const p = await req.json()
    const sub = p.submittal || {}
    const wi = p.work_item
    const reqs = (p.requirements || []).slice(0, 25)
    const reqText = reqs.length
      ? reqs.map((r: Record<string, unknown>, i: number) =>
          `需求${i + 1}【${r.title}】類型:${r.type || '其他'}${r.authoritative ? '(已核定)' : ''}` +
          `${r.acceptance_criteria ? ` 驗收標準:${r.acceptance_criteria}` : ''}` +
          `${r.evidence_requirement ? ` 應檢附:${r.evidence_requirement}` : ''}`).join('\n')
      : '(本專案尚無已解析的履約需求;請以該類別之通用審查要點為主,並標「通用」。)'
    const facts =
      `送審名稱:${sub.title || ''}\n類別:${sub.category || ''}${sub.revision ? `(第 ${sub.revision} 次修正)` : ''}\n` +
      `對應工項:${wi ? `${wi.no || ''} ${wi.desc || ''}${wi.unit ? `(${wi.unit})` : ''}` : '(未指定)'}\n` +
      `廠商附件說明:${sub.attachment_note || '(未敘明)'}\n\n本專案履約需求(規範解析):\n${reqText}`
    const system =
      '你是台灣公共工程的監造工程司,正在審查廠商送審。依提供的「本專案履約需求」與送審類別/工項,' +
      '產出:①審查要點清單(每點註明依據——源自提供需求就寫該需求標題,否則標「通用」;絕不捏造契約條號)' +
      '②審查意見草稿(正式監造用語,供監造修改採用)③建議判定(僅建議)。' +
      '注意:本系統只追蹤送審流程、未附文件本體,凡涉及文件實質內容(圖說尺寸、計算書、試驗數值等)一律標「需監造核對文件」,不得臆斷已符合。語氣正式、精簡、務實。'
    const { data, error } = await claudeJson({
      model: MODELS.fast, name: 'submittal_review', schema: SCHEMA, maxTokens: 1200,
      system, content: facts,
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
