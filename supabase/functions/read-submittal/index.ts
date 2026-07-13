// Supabase Edge Function: read-submittal
// ---------------------------------------------------------------------------
// 送審文件「本體」(數位 PDF/docx 抽出的文字,或掃描/圖的 base64)+ 契約履約需求
// → Claude 實際「讀文件」逐項比對 → 每項需求判定(符合/部分符合/不符/未涵蓋/需人工確認)+
// 審查意見草稿 + 建議判定。這是送審審查助手的進化:不只出要點,而是讀真文件比對規範。
//
// 反幻覺至上(審查涉核准/計價):只依「文件實際內容 + 提供需求」判定;文件未提及某需求 →
// 「未涵蓋」不得臆測符合;涉及具體數值/計算/圖說尺寸須人工複核 → 「需人工確認」;
// 絕不捏造文件沒有的內容。文字模式優於視覺(抽得到字就送字)。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy read-submittal --use-api

import { claudeJson, imageBlock, pdfBlock, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array', description: '逐項比對契約需求的結果(每個提供的需求一項)。',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '該項需求標題。' },
          status: { type: 'string', enum: ['符合', '部分符合', '不符', '未涵蓋', '需人工確認'], description: '依文件實際內容判定。文件未提及=未涵蓋;涉及具體數值/尺寸須人工複核=需人工確認。' },
          note: { type: 'string', description: '判定理由,引用文件中的相關內容;文件未提及就說明。' },
        },
        required: ['requirement', 'status', 'note'],
      },
    },
    doc_summary: { type: 'string', description: '送審文件內容摘要,40 字內。' },
    summary_opinion: { type: 'string', description: '審查意見草稿,100–180 字,正式監造用語,供監造修改後採用。' },
    suggested_decision: { type: 'string', enum: ['核准', '核備', '退回補正', '需補充後再核'], description: '建議判定(僅建議,最終由監造裁量)。' },
    caution: { type: 'string', description: '重要提醒,如須人工複核之數值/圖說項目;無則空字串。' },
  },
  required: ['findings', 'doc_summary', 'summary_opinion', 'suggested_decision', 'caution'],
}

const SYS =
  '你是台灣公共工程的監造工程司,正在「審讀」廠商送審文件的實際內容,並逐項比對本專案契約履約需求。' +
  '嚴格反幻覺(本審查涉核准與後續計價):只依「文件實際內容」與「提供的需求」判定;' +
  '文件未提及某項需求時 status 一律「未涵蓋」,不得臆測為符合;涉及具體數值、計算書、圖說尺寸等須人工複核者標「需人工確認」;' +
  '絕不捏造文件中沒有的內容。逐項給判定與理由(引用文件相關敘述),再給文件摘要、審查意見草稿與建議判定。'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const p = await req.json()
    const reqs = (p.requirements || []).slice(0, 20)
    const reqText = reqs.length
      ? reqs.map((r: Record<string, unknown>, i: number) =>
          `需求${i + 1}【${r.title}】${r.acceptance_criteria ? ` 標準:${r.acceptance_criteria}` : ''}${r.evidence_requirement ? ` 應檢附:${r.evidence_requirement}` : ''}`).join('\n')
      : '(本專案尚無已解析的契約履約需求;請以送審類別之通用要點審視,並將各項標為需人工確認。)'
    const head = `送審名稱:${p.submittal?.title || ''}(類別:${p.submittal?.category || ''})\n\n契約履約需求:\n${reqText}\n\n以下為送審文件內容,請據實逐項比對:`

    let content: unknown
    if (p.doc_text && String(p.doc_text).trim()) {
      content = `${head}\n\n=== 送審文件文字 ===\n${p.doc_text}`
    } else if (p.file_base64) {
      const block = (p.mime_type === 'application/pdf') ? pdfBlock(p.file_base64) : imageBlock(p.file_base64, p.mime_type || 'image/jpeg')
      content = [{ type: 'text', text: head }, block]
    } else {
      return json({ error: '缺少送審文件內容(doc_text 或 file_base64)' }, 400)
    }

    const { data, error } = await claudeJson({
      model: MODELS.smart, name: 'submittal_read', schema: SCHEMA, maxTokens: 2400, system: SYS, content,
    })
    if (error) return json({ error }, 502)
    return json(data, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
