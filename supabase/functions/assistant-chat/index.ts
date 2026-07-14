// Supabase Edge Function: assistant-chat
// ---------------------------------------------------------------------------
// 開放式專案 copilot:收本案「事實快照」(前端 buildAssistantFacts 產)+使用者問題,
// 回傳自然語言答案 + 出處連結。定位同 /assistant:唯讀、只幫你看到、不替你做。
// 反幻覺紀律:只准引用 facts JSON 內的值,絕不自行計算或臆造數字;無資料就說沒有。
// 金鑰只在雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟(登入者才可用)。
//
// 部署(colima 下必須 --use-api):supabase functions deploy assistant-chat --use-api

import { claudeJson, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: '繁體中文答案,務實簡潔;被問彙整時逐模組回答並點出責任角色與下一步' },
    sources: {
      type: 'array',
      description: '答案依據的頁面出處(0~4 個);label 與 route 都必須取自 facts.可引用路由',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, route: { type: 'string' } },
        required: ['label', 'route'],
      },
    },
  },
  required: ['answer', 'sources'],
}

const SYSTEM =
  '你是台灣公共工程專案管理系統的 AI 助理,服務施工廠商/監造/機關三種角色。' +
  '規則(務必遵守):' +
  '(1) 只能根據使用者訊息裡提供的「本案事實快照」JSON 回答;那是唯一資料來源。' +
  '(2) 嚴禁自行計算、換算或臆造任何數字——只能原樣引用快照中已有的值;快照沒有的數字就不要寫。' +
  '(3) 某模組的 has=false 或某值為 null,代表「目前沒有這項資料」,要誠實說沒有/未評估,不可編造。' +
  '(4) 被要求「彙整」多個面向時,逐一涵蓋被問到的每個模組(有資料/無資料都要交代),' +
  '並在合適處點出「球在誰手上(責任角色)」與「下一步該做什麼」——參考快照的「待我處理」與各狀態。' +
  '(5) sources 只能從快照的「可引用路由」挑,label 與 route 要一致;答不出時 sources 給空陣列。' +
  '(6) 你是唯讀助理,只幫使用者看到與判斷,絕不宣稱已替他送出、核定或修改任何東西。' +
  '(7) **資料一致性**:若快照標示異常(如「金流.資料異常期」非空,或欄位彼此矛盾——已請款未收款卻顯示無、實收為負、未請款卻有實收等),' +
  '必須主動指出「該資料不一致、無法據以判定」,列出相關原始欄位,絕不可把矛盾資料當正常事實推論。' +
  '(8) 被問到具體數字時,問句中每個被問到的項目都要回覆或明說「快照無此資料」,不可略過。' +
  '(9) 用繁體中文,語氣務實、簡潔;金額可加千分位但數值需與快照一致。' +
  '(10) 回答用純文字,不要使用 Markdown 標記(不要用 ** 粗體、# 標題、- 條列符號),需要分項時直接用數字或頓號。'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { question, facts } = await req.json()
    if (!question || !facts) return json({ error: '缺少 question 或 facts' }, 400)

    const { data, error } = await claudeJson({
      model: MODELS.fast, name: 'project_answer', schema: SCHEMA, maxTokens: 1500, system: SYSTEM,
      content:
        `本案事實快照(唯一資料來源):\n${JSON.stringify(facts)}\n\n` +
        `使用者問題:${question}\n\n只根據上面快照回答,附出處。`,
    })
    if (error) return json({ error }, 502)

    // 出處路由白名單防呆:過濾掉不在快照可引用路由內的 route(避免 AI 生假連結)
    const allow = new Set(Object.values(facts.可引用路由 || {}))
    const sources = Array.isArray((data as { sources?: unknown[] }).sources)
      ? (data as { sources: { label: string; route: string }[] }).sources
          .filter((s) => s && typeof s.route === 'string' && allow.has(s.route))
          .map((s) => ({ label: s.label, to: s.route }))
      : []
    return json({ answer: (data as { answer: string }).answer, sources }, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
