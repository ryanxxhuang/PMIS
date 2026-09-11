# 對外錯誤遮罩

> CURRENT｜2026-09-11。API 遮罩在本分支，正式版本未重核；不把本機測試當成線上合規證明。

## 出口

[publicError](../../supabase/functions/_shared/publicError.ts) 回 `{ message, code }`；HTTP 回 `{ error: message, code, ...context }`，代碼另以「（代碼 X）」附在中文句尾。Claude／DB 原文只進伺服器 log，不送 HTTP、tool_result 或可讀取的持久化欄位。

| 來源 | 遮罩位置 |
|---|---|
| Claude HTTP／逾時／無工具輸出 | claudeJson／claudeAgent 回傳前 maskClaudeError |
| PostgREST | dbErrorResponse／toolError → maskDbError |
| 未預期例外 | exceptionResponse／工具迴圈 → maskException |
| ingestion run 失敗 | failRun 只存 pub.message，metadata.error_code 存分類碼 |
| processing run 失敗 | 前端先 friendlyError 再持久化 |

保留既有 http_*、timeout、network、max_tokens、no_tool_use、config 等分類碼；抽取對 timeout／max_tokens 切批，409 用 run_conflict／restart_required 分流，不能把遮罩改成全部同碼。

## 業務訊息與限制

伺服器 DB 例外只有 P0001 且含 CJK 才視為自寫業務文案放行；一般 exception 含 CJK 也放行。這是啟發式判準，不是保密保證，因此禁止把原始 error.message 拼入中文文案。

前端 [friendlyError](../../src/lib/errorMessage.js) 保留 P0001，處理 CJK、已知 Auth／network 文案，其餘用情境 fallback＋代碼。舊資料「中文前綴:英文錯誤」只顯示前綴；故新錯誤碼用括號，避免被冒號截尾。Edge non-2xx 需先由 functionErrorInfo 讀 context body，再轉譯。

原始錯誤 log 截前 2,000 字；DB details 可能帶列內容，存取與留存依 [日誌政策](../資安/日誌留存政策.md)。歷史資料不回寫清洗。Sentry breadcrumb 是否帶原始本文仍未實測。

## 防回歸

[Edge 掃描](../../supabase/functions/_shared/errorLeak.scan.test.ts) 與 [前端掃描](../../src/lib/errorLeak.scan.test.js) 擋常見 raw error 出口，並固定 handler／UUID／閘門共用接線；整行白名單與變數名稱仍有限制，不能取代 code review。

[publicError 測試](../../supabase/functions/_shared/publicError.test.ts)、[friendlyError 測試](../../src/lib/errorMessage.test.js)、[Agent 測試](../../supabase/functions/_shared/agent.test.ts) 驗原文不出界、業務訊息保留與分流碼。Deno 型別檢查已納入 CI；它不驗真實模型／Edge 部署執行。
