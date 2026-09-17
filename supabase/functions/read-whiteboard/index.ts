// Supabase Edge Function: read-whiteboard
// ---------------------------------------------------------------------------
// AI 現場辨識:收一張工程告示板/現場照片 → Claude 視覺(強制 tool use 結構化輸出)→ 回傳施工日誌欄位。
// schema 與 prompt 住在 _shared/sitePhotoVision.ts(P2b 起與 draft-field-documents 的
// 告示板轉錄共用同一份;板上沒寫的數量回 null 不回 0)。
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY),永不進前端 App。
//
// 部署:supabase functions deploy read-whiteboard --use-api
// verify_jwt 預設開啟 → 只有登入使用者(前端帶 JWT)才能呼叫,擋匿名濫用金鑰。

import { jsonResponse as json } from '../_shared/claude.ts'
import { aiJsonHandler } from '../_shared/aiHandler.ts'
import { whiteboardCall } from '../_shared/sitePhotoVision.ts'

Deno.serve(aiJsonHandler({
  feature: 'sitelog.whiteboard',
  build: ({ body }) => {
    const { image_base64, mime_type } = body || {}
    if (!image_base64) return json({ error: '缺少 image_base64' }, 400)
    return whiteboardCall(image_base64, mime_type)
  },
}))
