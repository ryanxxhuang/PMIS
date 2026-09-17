// Supabase Edge Function: classify-site-photo
// ---------------------------------------------------------------------------
// 一張工地照片 → Claude 視覺 → 施工照片簿分類:照片簿說明、類別、對應工項關鍵詞、
// 可見施作/數量線索、白板施作區域(location)。用於「批次辨識」:承包商一次丟多張
// 現場照,自動生說明+配工項;同工項不同區域(W8-5 ISSUE-4)靠 location 區分。
//
// schema 與 prompt 住在 _shared/sitePhotoVision.ts(P2b 起與 draft-field-documents
// 的逐張起稿共用同一份,頁面辨識與伺服器起稿對同一張照片必須講同一套話)。
// work_item_hint 只給「關鍵詞」,實際對應哪個標單工項由 _shared/photoMatch.ts 模糊比對
//(前端與 Edge 同一支),不在雲端硬編工項——工項因案而異(見 pmis-contract-driven-forms 原則)。
//
// 金鑰只存雲端 secret(ANTHROPIC_API_KEY);verify_jwt 預設開啟。
// 部署(colima 下必須 --use-api):supabase functions deploy classify-site-photo --use-api

import { jsonResponse as json } from '../_shared/claude.ts'
import { aiJsonHandler } from '../_shared/aiHandler.ts'
import { sitePhotoCall } from '../_shared/sitePhotoVision.ts'

Deno.serve(aiJsonHandler({
  feature: 'photo.classify',
  build: ({ body }) => {
    const { image_base64, mime_type } = body || {}
    if (!image_base64) return json({ error: '缺少 image_base64' }, 400)
    return sitePhotoCall(image_base64, mime_type)
  },
}))
