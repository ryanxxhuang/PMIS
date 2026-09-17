-- P2b(D-026):AI 功能註冊 field_docs.draft → draft-field-documents Edge Function。
-- 照片批次(photo_intakes)逐張辨識、配工項、推斷候選文書並起施工日誌草稿(field_documents 的 AI 版本)。
-- 逐張辨識沿用 photo.classify／sitelog.whiteboard 的 prompt 與 schema,且各自的開關與用量照舊生效
-- (Edge 內經 aiGate.askAiFeature 問同一個 ai_feature_allowed);本列只管「起稿」這個入口能不能用。
-- 與上傳鏈同屬 trial(照片分類與告示板辨識都是 trial,起稿入口不該比它們更高),預設開啟(既有同類草稿功能慣例)。
-- 與雙註冊表(src/lib/aiFeatures.js、functions/_shared/aiFeatures.ts)同步新增;sort_order 105 排在
-- 估驗施工說明草稿(100)之後、告示板辨識(110)之前,同屬 draft 類。
-- 重放安全:on conflict do nothing,不覆蓋後台調過的 enabled／min_plan。
-- 資料保留:純新增一列,不動任何既有列。
-- 回復:supabase/rollbacks/20260917213500_ai_field_docs_draft.down.sql(關閉開關而非刪列——
-- ai_usage_events.feature_key 的歷史要能對回功能列,退場慣例同 assistant.chat／contract.parse)。
insert into public.ai_features
  (key, label, category, edge_function, min_plan, is_llm, enabled, sort_order)
values
  ('field_docs.draft', '現場文書起稿(照片)', 'draft', 'draft-field-documents', 'trial', true, true, 105)
on conflict (key) do nothing;
