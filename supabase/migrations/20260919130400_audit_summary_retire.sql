-- P6c(D-026 §4 瘦身):退場泛用「機關稽核意見草稿」audit.summary——關閉平台總開關。
--
-- 為什麼:D-026 定獨立風險稽核工作區退出新作業(P1b 已 hidden＋唯讀),估驗所需的勾稽檢核
-- 移入估驗流程並由確定性引擎(lib/valuationChecks.js → integrityAudit.js)給結果;「把發現
-- 寫成機關稽核意見」這個泛用 AI 用途不再有產品入口。正式 ai_usage_events 的 audit.summary
-- 為 0 筆(2026-09-17 盤點),沒有任何歷史用量會受影響;audit_events(專案稽核軌跡,1,290 筆)
-- 與本功能無關,完全不動。
--
-- 做法照 20260812000300(assistant.chat)與 20260911100100(contract.parse):只關開關。
-- 不刪 ai_features 列(後台清單、admin_ai_usage_by_feature 的 label 左接、ai_usage_events 與
-- project_ai_overrides 的 FK 都要能對到)、不刪 ai_usage_events 歷史、不刪 audit-summary edge
-- function 檔案(伺服器端閘門 _shared/aiGate.ts → ai_feature_allowed 讀到 enabled=false 直接
-- 回 403 並記一筆 blocked 用量,不需重佈;三支退場函式原始碼的移除與線上函式刪除列 P6b)。
-- 前端／Edge 註冊表同步改 defaultEnabled=false(src/lib/aiFeatures.test.js 釘住);呼叫端
-- (RiskAudit.jsx 的 AI 稽核意見按鈕、store site.js 的 auditSummary)於同一 PR 移除;
-- supabase/tests/ai_features_retired.sql 釘住 DB 側(關閉、閘門拒絕、覆寫翻不過、用量歷史查得到)。
--
-- 資料保留:不動任何用量歷史。相容:合併後無呼叫者;舊前端 bundle 若仍打 audit-summary 只會
-- 得到 403,不會寫到任何資料。回復:後台 /admin 開回,或
-- supabase/rollbacks/20260919130400_audit_summary_retire.down.sql。
update public.ai_features
   set enabled = false, updated_at = now()
 where key = 'audit.summary';
