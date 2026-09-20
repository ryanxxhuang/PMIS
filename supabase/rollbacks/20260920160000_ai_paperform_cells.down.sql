-- 回復 20260920160000_ai_paperform_cells:關閉 paperform.cells 的平台總開關。
-- 不刪列:ai_usage_events.feature_key 的歷史用量要能對回功能列(退場慣例同 assistant.chat／
-- contract.parse／audit.summary)。
-- 關閉後的行為:draft-field-documents 的逐格路徑不啟用,紙本表單退回「整張圖讀兩次、
-- 只留兩次一致的格子」(B 包做法);其他照片與其他 AI 功能完全不受影響,不會整批失敗。
-- 已經產生的 photos.ai_result(含 observations.source 的原圖座標)、field_documents 版本
-- 都不隨本檔移除——那是資料,不是功能開關。
update public.ai_features set enabled = false, updated_at = now() where key = 'paperform.cells';
