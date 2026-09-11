# AI 功能閘門與用量

> CURRENT｜2026-09-11。執行期真相在 DB；正式值與部署狀態見 [CURRENT](../../CURRENT.md#63-正式環境最後核對不是即時狀態)。

## 註冊與方案

`ai_features` 管 enabled／min_plan；前端 [aiFeatures.js](../../src/lib/aiFeatures.js) 與 Edge [aiFeatures.ts](../../supabase/functions/_shared/aiFeatures.ts) 是顯示／部署鏡像，七欄由測試比對。保留一列一筆格式供該測試解析。靜態預設不覆蓋後台調整值。

`ai_feature_allowed` 依序檢查：平台總開關 → 專案存在 → project_ai_overrides → trial／standard／pro 門檻。覆寫不能翻過總開關；未註冊回 false，無 project 只接受 trial 門檻。前端 aiEnabled 只做 UX，載入未知時可能顯示入口，不能當安全判斷。

assistant.chat／contract.parse 退場以關閉功能列處理，保留 Edge 與歷史用量關聯；contract.parse 的關閉 migration 尚未套正式庫。projects.ai_monthly_token_quota 只有欄位，未強制成本上限。

## 伺服器流程

[openAiGate](../../supabase/functions/_shared/aiGate.ts) 驗證 auth.getUser、project UUID、以 caller JWT 查專案，再詢問閘門。業務查詢用 userClient 套 RLS；serviceClient 只記帳／寫 system-managed 表，不能拿來繞過業務讀取權。

[gateVerdict](../../supabase/functions/_shared/gatePolicy.ts) 僅明確 true 放行：

| RPC 結果 | HTTP／code |
|---|---|
| true 且查詢成功 | 放行 |
| false 且查詢成功 | 403 feature_disabled |
| 查詢錯誤、null、undefined | 503 gate_unavailable |

[aiJsonHandler](../../supabase/functions/_shared/aiHandler.ts) 供 13 支 schema／prompt 類函式共用 OPTIONS → body → gate → build → Claude → usage → reply。build 回驗證 Response 時不記帳；確定性 reply 記 ok、零 token。agent-run／extract-requirements／fetch-weather 自管流程仍用 openAiGate；send-reminders 用排程身分逐案呼叫同一 gateVerdict。

## 記帳與後台

recordAiUsage／closeAiGate 在成功、模型失敗、功能被擋的計量路徑寫 ai_usage_events；缺 service key、記帳失敗或例外只記 log，不阻擋主要回應。這不代表登入／輸入驗證前的每個 HTTP 請求都會有用量列。

`record_ai_usage` 只 grant service_role，依 ai_model_pricing 當下四種 token 單價算 USD；未知模型記 0 成本以保留事件。project／user 刪除設 null，歷史成本保留。續跑每個 request 計一次，Agent 彙整多輪一次，提醒 dry 模式不記帳。用量錯誤碼目前多是 claude_error／exception 粗分類，沒有補記後台。

平台 admin 是營運身分。profiles guard 擋自行升權；bootstrap 名單不開讀取，管理員旗標不讀使用者可控 metadata。profiles SELECT 限自己／共案成員／平台 admin 並逐欄授權，前端問 is_platform_admin RPC。

每個 admin RPC 內部再次檢查平台權限；期間為半開區間、每日依台北切日。前端 [Admin](../../src/pages/web/Admin.jsx) 負責資料載入，[UsageTabs](../../src/components/admin/UsageTabs.jsx) 呈現統計，[SettingsTabs](../../src/components/admin/SettingsTabs.jsx) 處理開關／方案與覆寫。平台設定不寫綁專案的 audit_events，保留 updated_by／updated_at；唯讀 Agent 軌跡仍未落庫。

## 修改與驗證

新增功能需兩份 registry、DB migration、帶 project_id 的前端呼叫、伺服器 gate／usage 與對應測試。新增表明確收回 default grants；新增 DB 規則附 pgTAP。退場列不刪，部署依 [runbook](../operations/deploy.md)。

[registry 測試](../../src/lib/aiFeatures.test.js)、[閘門測試](../../supabase/functions/_shared/gatePolicy.test.ts)、[平台 pgTAP](../../supabase/tests/ai_platform.sql)、[退場 pgTAP](../../supabase/tests/ai_features_retired.sql)；17 支入口以 `npm run check:edge` 驗型別，依 deno.lock 固定相依套件。
