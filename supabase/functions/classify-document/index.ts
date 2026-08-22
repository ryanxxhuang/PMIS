// Supabase Edge Function: classify-document
// ---------------------------------------------------------------------------
// W14 AI 文件分類:確定性分類器(檔名/內文規則)沒把握時的第二意見。
// 輸入是已入庫的文件版本(document_pages 前幾頁文字),輸出既有分類值域之一
// +信心+一句理由——**只能選現有類型,不准發明新類型**;信心高就自動歸檔
// (使用者事後隨時可改分類,見 W14 改分類功能),信心低照舊進待確認佇列。
// 分類是可逆的「歸檔建議」,不是核定/判定,不踩紅線 1。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy classify-document --use-api

import { createClient } from 'npm:@supabase/supabase-js@2'
import { claudeJson, MODELS, cors, jsonResponse as json } from '../_shared/claude.ts'
import { openAiGate, closeAiGate } from '../_shared/aiGate.ts'
import { CLASSIFIABLE_DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '../_shared/documentTypes.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAMPLE_PAGES = 3
const SAMPLE_CHARS = 4_000

const SCHEMA = {
  type: 'object',
  properties: {
    document_type: {
      type: 'string',
      enum: [...CLASSIFIABLE_DOCUMENT_TYPES],
      description: Object.entries(DOCUMENT_TYPE_LABELS)
        .map(([k, v]) => `${k}=${v}`).join('、'),
    },
    confidence: { type: 'number', description: '分類信心 0~1;拿不準就誠實給低分' },
    reason: { type: 'string', description: '一句話理由(30 字內),說明依據文件的哪個特徵' },
  },
  required: ['document_type', 'confidence', 'reason'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const body = await req.json().catch(() => null)
  const gate = await openAiGate(req, { feature: 'documents.classify', projectId: body?.project_id })
  if (!gate.ok) return gate.response
  try {
    const versionId = body?.document_version_id
    if (typeof versionId !== 'string' || !UUID_RE.test(versionId)) {
      return json({ error: '缺少有效的 document_version_id' }, 400)
    }
    // RLS-scoped:讀得到版本=看得到這份文件;拿檔名與前幾頁文字當樣本
    const { data: version, error: versionError } = await gate.userClient
      .from('document_versions')
      .select('id, original_filename, documents!inner(project_id, title)')
      .eq('id', versionId)
      .maybeSingle()
    if (versionError) return json({ error: versionError.message }, 500)
    if (!version) return json({ error: '找不到文件版本或無權限' }, 404)
    const docRow = version.documents as unknown as { project_id: string; title: string }
    // 既定範式(extract-requirements 同款):閘門用 body.project_id 判功能開關與
    // 計量歸戶,權威專案由 DB 從文件版本解出——兩者必須一致,否則同時是 A/B
    // 成員的人可帶 A 的 project_id 繞過 B 的功能開關並把用量錯記到 A 頭上
    if (body?.project_id && body.project_id !== docRow.project_id) {
      return json({ error: '文件版本不屬於指定專案' }, 403)
    }
    const { data: pages, error: pagesError } = await gate.userClient
      .from('document_pages')
      .select('page_number, extracted_text')
      .eq('document_version_id', versionId)
      .order('page_number')
      .limit(SAMPLE_PAGES)
    if (pagesError) return json({ error: pagesError.message }, 500)
    const sample = (pages ?? [])
      .map((p) => p.extracted_text || '')
      .join('\n')
      .slice(0, SAMPLE_CHARS)
    if (!sample.trim()) return json({ error: '文件沒有可用文字樣本,無法 AI 分類' }, 422)

    const prompt =
      '這是台灣公共工程專案的一份文件,請依檔名與開頭內文判斷它屬於哪一類。\n' +
      '只能從列舉值域中選;信心請誠實——樣本不足以判斷就給低分,不要硬猜。\n' +
      '注意:價目/標單/單價分析等「價格表」類文件一律歸 other(不是 contract)。\n\n' +
      `檔名:${version.original_filename || docRow.title}\n\n=== 文件開頭內文 ===\n${sample}`
    const { data, error, usage, model } = await claudeJson({
      model: MODELS.fast, name: 'document_classification', schema: SCHEMA,
      maxTokens: 300, content: prompt,
    })
    if (error) {
      await closeAiGate(gate, { feature: 'documents.classify', model, usage, status: 'error', errorCode: 'claude_error' })
      return json({ error }, 502)
    }
    const result = data as { document_type: string; confidence: number; reason: string }
    // 值域防呆:schema 已強制 enum,這層是最後保險——絕不落庫未知類型
    const documentType = (CLASSIFIABLE_DOCUMENT_TYPES as readonly string[]).includes(result.document_type)
      ? result.document_type : 'other'
    const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0))
    await closeAiGate(gate, { feature: 'documents.classify', model, usage, status: 'ok' })
    return json({
      document_type: documentType,
      confidence,
      reason: String(result.reason || '').slice(0, 60),
    }, 200)
  } catch (e) {
    await closeAiGate(gate, { feature: 'documents.classify', status: 'error', errorCode: 'exception' })
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
