-- W3-3(D-008):「AI 問答助理」(assistant.chat)退場——/agent 是唯一對話入口。
-- 只關開關:不刪 ai_features 列(後台清單與用量報表要能對到歷史)、不刪
-- ai_usage_events 歷史、不刪 assistant-chat edge function 檔案(未部署變更即失效,
-- 且伺服器端閘門 openAiGate 讀這裡的 enabled=false 會直接擋下呼叫)。
-- 回復方式:後台 /admin 開回,或 update enabled = true。
update public.ai_features
   set enabled = false, updated_at = now()
 where key = 'assistant.chat';
