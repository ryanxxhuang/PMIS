// Supabase Edge Function: audit-summary
// ---------------------------------------------------------------------------
// 文件勾稽鏈稽核的「確定性發現」→ Claude → 機關稽核意見摘要 + 建議事項。
// AI 只把已算好的發現寫成文字,**不參與判定、不臆造未列出的問題**(判定全在 integrityAudit.js)。
// 定位:「值得複查的異常提示,非違規認定」。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy audit-summary --use-api

import { claudeJson, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'
import { openAiGate, closeAiGate } from '../_shared/aiGate.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    opinion: { type: 'string', description: '稽核意見摘要,120–200 字,機關稽核用語、客觀;只根據提供的發現,並敘明此為值得複查之提示而非違規認定。' },
    recommendations: {
      type: 'array', description: '建議事項,3–6 條,對應提供的發現,具體可執行。',
      items: { type: 'string' },
    },
  },
  required: ['opinion', 'recommendations'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  // 批 B 閘門:登入+成員資格+功能開關(擋下記 blocked);通過後 AI 呼叫結果記用量
  const p = await req.json().catch(() => null) || {}
  const gate = await openAiGate(req, { feature: 'audit.summary', projectId: p?.project_id })
  if (!gate.ok) return gate.response
  try {
    const findings = (p.findings || []).slice(0, 20)
    if (!findings.length) {
      // 無發現走確定性罐頭回覆、不打 LLM——仍記一筆 ok(token 0)計次
      await closeAiGate(gate, { feature: 'audit.summary', status: 'ok' })
      return json({ opinion: '本案經文件勾稽鏈自動比對(估驗、施工日誌、查驗、試體),未發現明顯對不起來之處,證據鏈大致完整。仍請依契約與相關法令續行常態監督。', recommendations: [] }, 200)
    }
    const list = findings.map((f: Record<string, unknown>, i: number) =>
      `${i + 1}.[${f.status === 'risk' ? '風險' : '注意'}/${f.category}] ${f.title}:${f.detail}`).join('\n')
    const facts = `工程名稱:${p.project_name || '(未提供)'}\n稽核統計:風險 ${p.summary?.risk ?? 0} 項、注意 ${p.summary?.warn ?? 0} 項、已勾稽計價工項 ${p.summary?.checked ?? 0} 項。\n\n勾稽發現(系統確定性比對結果):\n${list}`
    const system =
      '你是台灣公共工程主管機關的稽核工程司,依「文件勾稽鏈稽核」系統比對出的發現,撰寫稽核意見摘要與建議事項。' +
      '嚴格只根據提供的發現撰寫,不得臆造或延伸未列出的問題;語氣客觀、機關稽核用語。' +
      '**你只能建議「要查證什麼資料、要求補哪些紀錄」,絕不得作出工程技術或契約處置決策**——' +
      '嚴禁出現「剔除、補強、打除、停工、罰款、扣款、解約、驗收不合格」等處置字眼(那是結構技師、監造與機關依法定程序的權責)。' +
      '例:試體 7 天未達標,只能建議「確認齡期、設計強度、28 天試驗結果與監造紀錄」,不得建議剔除或補強。' +
      '務必敘明本結果為「值得複查的異常提示,非違規認定」,實際處置應依契約與相關法令查證。'
    // 機關稽核意見是給機關看的正式文字,品質對齊監造審查:smart(Sonnet)而非
    // fast(Haiku),單次成本約 3 倍。輸出短(摘要+建議),但 stop_reason=max_tokens
    // 現在是硬失敗(W10 後不再靜默截斷),Sonnet 又比 Haiku 略囉嗦——上限留 1500
    // 消除這條失敗路徑(maxTokens 是上限不是計費,放寬零成本)。
    const { data, error, usage, model } = await claudeJson({
      model: MODELS.smart, name: 'audit_summary', schema: SCHEMA, maxTokens: 1500, system, content: facts,
    })
    if (error) {
      await closeAiGate(gate, { feature: 'audit.summary', model, usage, status: 'error', errorCode: 'claude_error' })
      return json({ error }, 502)
    }
    await closeAiGate(gate, { feature: 'audit.summary', model, usage, status: 'ok' })
    return json(data, 200)
  } catch (e) {
    await closeAiGate(gate, { feature: 'audit.summary', status: 'error', errorCode: 'exception' })
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
