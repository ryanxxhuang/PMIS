-- B5:退場功能 contract.parse(舊「契約解析(時程/罰則)」)關閉平台總開關。
--
-- 為什麼:D-012(2026-08-12)定「requirements 是唯一契約要求權威」,新文件只跑
-- extract-requirements;parse-contract 自 PR #6 起就沒有前端呼叫者(grep src/ 為零),
-- 但 ai_features 仍 enabled=true——任何登入成員可直接打 /functions/v1/parse-contract
-- 燒 Sonnet 8192 token,產出繞過 sourceVerify / document_ingestion_runs / requirements
-- 的 obligations,與 D-012、D-017 的單一權威相衝。
--
-- 做法照 20260812000300(assistant.chat 退場):只關開關。不刪 ai_features 列(後台
-- 清單與 ai_usage_events 歷史要能對到)、不刪 edge function 檔案(伺服器端閘門
-- _shared/aiGate.ts → ai_feature_allowed 讀到 enabled=false 直接擋下並記一筆 blocked
-- 用量,不需重佈)。seed 用 on conflict do nothing,db reset 重放後本檔仍會把它關掉。
-- 兩份註冊表(src/lib/aiFeatures.js、_shared/aiFeatures.ts)同步改 defaultEnabled=false,
-- 由 src/lib/aiFeatures.test.js 釘住;supabase/tests/ai_features_retired.sql 釘住 DB 側。
--
-- 資料保留:不動任何用量歷史。相容:無呼叫者。
-- 回復:後台 /admin 開回,或 supabase/rollbacks/20260911100100_contract_parse_retire.down.sql。
update public.ai_features
   set enabled = false, updated_at = now()
 where key = 'contract.parse';
