// Supabase Edge Function: draft-field-documents(P2b;D-026 照片→AI 文書的起稿入口)
// ---------------------------------------------------------------------------
// 輸入 { project_id, intake_id, rerecognize_photo_ids? }:對一批已保存的照片逐張辨識、配工項、推斷候選文書,
// 並為廠商批次起施工日誌草稿(field_documents 的 AI 版本)。本單元只真的產生施工日誌;
// 監造日誌／自主檢查表／監造查驗表單只列為「需要／尚未支援」的候選(P3a–c)。
//
// 安全邊界:
//   * openAiGate('field_docs.draft'):登入、成員資格(RLS 讀 projects)、功能開關(fail-closed)。
//   * 逐張辨識沿用 photo.classify／sitelog.whiteboard 的 schema、prompt 與**各自的開關**——
//     經 aiGate.askAiFeature 問同一個 RPC,關了就停(整批 failed,不偷跑);用量各記各的 key。
//   * 呼叫者組織必須等於批次上傳方(伺服器以 my_org_type 決定,不信任前端);廠商批次永遠
//     推不出監造文件(候選規則＋DB guard 兩道)。
//   * 讀走 userClient(RLS);寫只用 serviceClient 且只寫 photos.ai_*、批次進度、AI 版本、agent_actions。
//     有人工版本的文件不覆寫(改留 suggest_field_update);版本雜湊由 DB 算。
//   * 照片與板上文字是資料不是指令(prompt 明示);模型輸出經 normalize 驗形狀。
// 續跑:每次呼叫時間預算 100 s、併發 3;處理不完回 { remaining } 由前端再呼叫一次即可繼續
//(批次狀態留在 recognizing、run_started_at 已釋放)。
//
// 部署(colima 下必須 --use-api):supabase functions deploy draft-field-documents --use-api

import { cors, jsonResponse as json, exceptionResponse, claudeJson, readEnv } from '../_shared/claude.ts'
import type { AiJsonCall } from '../_shared/aiHandler.ts'
import { openAiGate, closeAiGate, askAiFeature, recordAiUsage } from '../_shared/aiGate.ts'
import type { AiGateOk } from '../_shared/aiGate.ts'
import type { GateVerdict } from '../_shared/gatePolicy.ts'
import { isUuid } from '../_shared/uuid.ts'
import { supabaseDraftRepo } from '../_shared/fieldDocRepo.ts'
import { runDraftFieldDocuments } from '../_shared/fieldDocDraftRun.ts'
import type { DraftVision, VisionResult } from '../_shared/fieldDocDraftRun.ts'
import { sitePhotoCall, whiteboardCall } from '../_shared/sitePhotoVision.ts'
import { stubAllowed, stubClassify, stubWhiteboard, STUB_NOTE, STUB_MODEL } from '../_shared/visionStub.ts'

const FEATURE = 'field_docs.draft'
// 單張視覺呼叫:逾時 45 s、只對 429/5xx 重試一次、逾時不重試(同尺寸再逾時只會燒光預算)
const VISION_CALL = { timeoutMs: 45_000, retries: 1, retryTimeouts: false }

// 本機確定性 stub(P2c 真後端 E2E):只在 PMIS_VISION_STUB=1 且 SUPABASE_URL 為本機 http 位址時生效
//(visionStub.stubAllowed;正式 Edge 永遠 false)。stub 仍走各功能的開關與用量(model=stub:local、零 token),
// 閘門 fail-closed 語意不變;回應 notes 明示「模型輸出為本機 stub」。
const STUB = stubAllowed({ flag: readEnv('PMIS_VISION_STUB'), supabaseUrl: readEnv('SUPABASE_URL') })

// 逐張辨識的模型呼叫器:每個 feature 只問一次開關(擋下記一筆 blocked),每次呼叫各記用量
function makeVision(gate: AiGateOk): DraftVision {
  const verdicts = new Map<string, Promise<GateVerdict>>()
  const verdictOf = (feature: string) => {
    if (!verdicts.has(feature)) {
      verdicts.set(feature, (async () => {
        const v = await askAiFeature(gate.userClient, gate.projectId, feature)
        if (!v.allow) {
          await recordAiUsage(gate.serviceClient, {
            feature, projectId: gate.projectId, userId: gate.userId, actor: 'user', status: 'blocked', errorCode: v.code,
          })
        }
        return v
      })())
    }
    return verdicts.get(feature)!
  }
  const call = async (feature: string, built: AiJsonCall, stubData: () => unknown): Promise<VisionResult<unknown>> => {
    const v = await verdictOf(feature)
    if (!v.allow) return { blocked: v }
    if (STUB) {
      await recordAiUsage(gate.serviceClient, { feature, projectId: gate.projectId, userId: gate.userId, actor: 'user', model: STUB_MODEL, status: 'ok' })
      return { data: stubData() }
    }
    const t0 = Date.now()
    const { data, error, errorCode, usage, model } = await claudeJson({ ...built, ...VISION_CALL })
    await recordAiUsage(gate.serviceClient, {
      feature, projectId: gate.projectId, userId: gate.userId, actor: 'user', model, usage,
      durationMs: Date.now() - t0, status: error ? 'error' : 'ok', errorCode: error ? (errorCode ?? 'claude_error') : null,
    })
    if (error) return { error, errorCode: errorCode ?? 'claude_error' }
    return { data }
  }
  const hint = readEnv('PMIS_VISION_STUB_HINT')
  return {
    classify: (base64, mime) => call('photo.classify', sitePhotoCall(base64, mime), () => stubClassify(hint)),
    readBoard: (base64, mime) => call('sitelog.whiteboard', whiteboardCall(base64, mime), () => stubWhiteboard()),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const body = await req.json().catch(() => null)
  const gate = await openAiGate(req, { feature: FEATURE, projectId: body?.project_id })
  if (!gate.ok) return gate.response
  const intakeId = body?.intake_id
  // 輸入驗證早退不記帳(與 aiJsonHandler 的 build 回 Response 同一慣例)
  if (!isUuid(intakeId)) return json({ error: '缺少有效的 intake_id', code: 'invalid_input' }, 400)
  // 明確要求重新辨識的照片(使用者按「重新辨識」;只認 uuid,是否屬於本批由 run 再過濾一次)
  const rerecognizeRaw = body?.rerecognize_photo_ids
  if (rerecognizeRaw !== undefined && (!Array.isArray(rerecognizeRaw) || rerecognizeRaw.some((x: unknown) => !isUuid(x)))) {
    return json({ error: 'rerecognize_photo_ids 必須是照片 id 陣列', code: 'invalid_input' }, 400)
  }
  const rerecognizePhotoIds: string[] | undefined = Array.isArray(rerecognizeRaw) ? [...new Set(rerecognizeRaw as string[])] : undefined
  if (!gate.serviceClient) {
    return json({ error: '伺服器未設定,暫時無法起稿', code: 'server_not_configured' }, 500)
  }
  try {
    const repo = supabaseDraftRepo(gate.userClient, gate.serviceClient, gate.projectId as string)
    const result = await runDraftFieldDocuments({
      repo, vision: makeVision(gate), intakeId, userId: gate.userId, rerecognizePhotoIds,
    })
    await closeAiGate(gate, {
      feature: FEATURE,
      status: result.status >= 500 ? 'error' : 'ok',
      errorCode: result.status >= 400 ? String(result.body.code ?? result.status) : null,
    })
    if (STUB && Array.isArray(result.body.notes)) result.body.notes = [STUB_NOTE, ...(result.body.notes as unknown[])]
    return json(result.body, result.status)
  } catch (e) {
    await closeAiGate(gate, { feature: FEATURE, status: 'error', errorCode: 'exception' })
    return exceptionResponse('draft-field-documents', e)
  }
})
