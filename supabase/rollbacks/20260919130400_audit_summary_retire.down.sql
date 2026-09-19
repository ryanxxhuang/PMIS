-- 回復 20260919130400_audit_summary_retire:把 audit.summary 的平台總開關開回。
-- 只翻開關;列、用量歷史、專案覆寫本來就沒動。開回後伺服器端閘門即時放行(不需重佈 Edge),
-- 但前端呼叫端已於 P6c 移除,要真的重新提供功能得同時還原 RiskAudit.jsx／site.js 的 AI 路徑
-- 與兩份註冊表的 defaultEnabled(Git 可追溯 PR)。
update public.ai_features
   set enabled = true, updated_at = now()
 where key = 'audit.summary';
