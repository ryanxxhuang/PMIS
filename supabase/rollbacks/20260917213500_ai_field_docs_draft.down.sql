-- 回復 20260917213500_ai_field_docs_draft:關閉 field_docs.draft 的平台總開關。
-- 不刪列:ai_usage_events.feature_key 的歷史用量要能對回功能列(退場慣例同 assistant.chat／contract.parse);
-- Edge 閘門(ai_feature_allowed)對 enabled=false 回 false → draft-field-documents 回 403 feature_disabled。
-- 已產生的 photos.ai_*、field_documents AI 版本、agent_actions 不隨本檔移除(那是資料,不是功能開關)。
update public.ai_features set enabled = false, updated_at = now() where key = 'field_docs.draft';
