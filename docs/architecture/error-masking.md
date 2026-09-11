# 對外錯誤遮罩（政府合規：錯誤只顯示簡短訊息及代碼）

> 狀態：**CURRENT（機制已提交、尚未部署）** ｜ 最後核對：2026-09-11（分支 `refactor/product-wide`；伺服器端遮罩由重構波次 B1 commit `bc2b2ea` 建立，**已提交、未合併 `main`、未部署——正式站的 Edge Function 仍跑舊行為**；前端 `friendlyError` 早於本波，已隨先前 PR 部署）
> 對應程式：`supabase/functions/_shared/publicError.ts`（唯一遮罩點）、`_shared/claude.ts`（`claudeJson` 與 `errorResponse`／`dbErrorResponse`／`exceptionResponse`）、`_shared/agent.ts`（`claudeAgent`）、`_shared/aiHandler.ts`（骨架）、`_shared/agentToolCommon.ts`（`toolError`）、`_shared/ingestionRun.ts`（`failRun`；B6 commit `c620fd5` 自 `extract-requirements/index.ts` 純搬移，機制不變，`extract-requirements/index.ts` 仍是唯一呼叫端）；前端 `src/lib/errorMessage.js`（`friendlyError`）、`src/lib/extractRequirements.js`（`functionErrorInfo`）
> 測試：`_shared/publicError.test.ts`、`_shared/errorLeak.scan.test.ts`、`src/lib/errorMessage.test.js`、`src/lib/errorLeak.scan.test.js`
> 合規依據：資通系統防護基準附表十構面五「開發階段」第三款——錯誤時使用者頁面僅顯示簡短訊息及代碼，不含詳細錯誤訊息（對照表見 [`../資安/資通系統防護基準-普通級-符合性對照.md`](../資安/資通系統防護基準-普通級-符合性對照.md)；缺口由 [`../健檢-2026-09-06/A-安全與權限.md`（歷史）](https://github.com/ryanxxhuang/PMIS/blob/c39e395fff5608813a8c2fa4c79700e87d607e3b/docs/%E5%81%A5%E6%AA%A2-2026-09-06/A-%E5%AE%89%E5%85%A8%E8%88%87%E6%AC%8A%E9%99%90.md) 指出）。本文件寫機制怎麼運作；沒有對應的 D-編號決策，這是合規基線而不是產品決策。

## 1. 這層在守什麼

錯誤訊息是攻擊者最便宜的偵察來源：Postgres 的 `error.message` 帶 RLS policy 名與 constraint 名（等於把資料表結構與授權規則名稱送出去）、Anthropic 的回應本文帶 request id／額度／模型名、runtime 例外帶內部欄位名與 stack。附表十構面五要求畫面只顯示「簡短訊息及代碼」；同時我們自己刻意寫給使用者看的業務規則（「只有監造可以核定估驗」）**不能被蓋掉**，否則使用者不知道為什麼被擋。

重構前的實際狀況（B1 commit 訊息與健檢 A 報告記錄）：

- 13 支「純 schema＋prompt」Edge Function 在 Claude 失敗時 `json({ error }, 502)`，而 `claudeJson` 的 `error` 字串含 Anthropic 回應本文前段；catch 區塊回 `e.message`。
- `extract-requirements` 多處直接回 PostgREST 的 `xxxError.message`，並把它 `slice(0, 2000)` 寫進 `document_ingestion_runs.error_message`——那個欄位整案成員可讀（policy `document_ingestion_runs_select`）且前端會顯示，等於**永久持久化的外洩**。
- `docs/資安` 的對照文件當時寫「edge function 原始回應皆不外洩」，但那是靠前端 `friendlyError` 轉譯；直接 `curl` 打 API、或 Sentry breadcrumb，就拿得到原文。

所以這層守的是**API 邊界**，不只是畫面：回應本文、工具回傳值、持久化欄位三處都不得含原文。

## 2. 一個概念一條判準：伺服器與前端共用「CJK ＝ 我們自己寫的」

「哪些訊息可以原樣放行」在兩端用同一條規則，不另立第二套：

```text
含中日韓表意文字（/[㐀-鿿豈-﫿]/）
  → 只會是我們自己刻意寫給使用者看的業務訊息（DB trigger raise exception 的 P0001、
     程式裡 throw 的繁中 Error、store slice 的防呆文案）→ 原樣放行
純 ASCII
  → Postgres／Anthropic／Deno／GoTrue／fetch 的原始錯誤永遠是英文 → 一律遮
```

伺服器端是 `publicError.ts` 的 `isOwnMessage(text)`；前端是 `errorMessage.js` 內的同一個正規表達式。`publicError.test.ts` 有一組案例明寫「與前端 errorMessage.js 同一條 CJK 判準」。這條判準能成立有一個**前提**（§6）：全站不得再用樣板字串把 raw `error.message` 拼進中文訊息，否則英文原文會搭中文便車通過判準。

## 3. 遮罩做在源頭，不做在呼叫端

遮罩點放在 `claudeJson`（`claude.ts`）與 `claudeAgent`（`agent.ts`）**回傳之前**：兩支函式回傳的 `error` 欄位永遠已是遮罩後的中文短語＋代碼。呼叫端可以直接 `json({ error })` 回前端而不外洩；未來新增呼叫端忘了遮也漏不出去。對照方案是在 15 個呼叫端各自遮——B1 之前骨架抄了 13 次，錯誤處理得改 13 處、漏一處就外洩，這正是為什麼同一波把骨架收斂成 `aiHandler.ts`（見 [`ai-gate-and-metering.md`](ai-gate-and-metering.md) §5）。

其他不經 `claudeJson` 的路徑各有對應的源頭遮罩：

| 路徑 | 遮罩點 | 說明 |
|---|---|---|
| PostgREST 查詢失敗 → HTTP 回應 | `dbErrorResponse(scope, error, status?, extra?)` | `scope` 寫「函式.步驟」（例 `extract-requirements.run_claim`）讓 log 找得到 |
| 未預期例外 → HTTP 回應 | `exceptionResponse(scope, e, status?, extra?)` | `aiHandler` 的最外層 catch、`agent-run`／`fetch-weather` 的 catch 都走這支 |
| PostgREST 錯誤 → agent 工具的 `tool_result` | `toolError(scope, error)`（`agentToolCommon.ts`） | 模型會把 tool_result 原文複述給使用者，所以工具回傳值也是對外邊界 |
| 工具執行丟例外 → `tool_result` | `agent.ts` 迴圈內 `maskException('agent.tool.<name>', e)` | 給模型的 `tool_result` 是短語（`is_error: true`）；例外原文只留在伺服器端的 `step.error`，`agent-run` 回前端前只取 `tool`／`ok`／`ms` |
| 抽取 run 失敗 → 持久化 | `failRun(service, runId, pub, metadata)`（`_shared/ingestionRun.ts`，由 `extract-requirements/index.ts` 呼叫） | `error_message` 只存 `pub.message`，代碼落 `metadata.error_code`（不動 schema） |
| `send-reminders` 讀 `projects` 失敗 | `maskDbError('send-reminders.projects', pErr)` | 回應只有 pg_cron 看得到，仍不放原文 |

`aiGate.ts` 的 401「未登入」、400「缺少有效的 project_id」、404「找不到專案或無權限」與 `gateVerdict` 的訊息本來就是我們自己寫的中文，直接 `json({ error })`——它們正是判準要放行的那一類。

## 4. 三類來源、對外形狀、原文去向

`publicError.ts` 三支純函式（無 runtime 依賴，vitest 直接測「原文不出現在回傳值」），回傳形狀一律 `{ message, code }`：

| 函式 | 來源 | 對外 `message` | `code` | 放行例外 |
|---|---|---|---|---|
| `maskClaudeError(scope, code, raw)` | Anthropic HTTP 本文、逾時、連線例外、`stop_reason` | `claudeErrorMessage(code)` 的處置建議（429「忙碌」、5xx「暫時無法使用」、其他 4xx「請聯絡系統管理者」、timeout「縮小輸入」…） | 傳入的分類碼原樣帶回（§5） | 無——Anthropic 本文永遠遮 |
| `maskDbError(scope, error)` | supabase-js `PostgrestError` | 「資料存取失敗，請稍後再試」 | `db_error` | `code === 'P0001'` **且** `isOwnMessage(message)` → 原樣、`code: 'P0001'`（英文 P0001 照遮） |
| `maskException(scope, e)` | 任意 throw 值 | 「系統發生錯誤，請稍後再試」 | `internal` | `isOwnMessage(e.message)` → 原樣、`code: 'business_rule'`（例：`loadDocumentPages` 刻意 throw 的「文件頁面仍在更新，請完成上傳後重試」） |

三支都先 `console.error` 原文再回短語；原文只進 Supabase Edge log（平台管理員可見）。Log 只留原文前 2,000 字（`LOG_MAX`），防止某次超長回應撐爆 log。`maskDbError` 連 `details` 與 `hint` 一起記——注意 PostgREST 的 `details` 可能含「Failing row contains (…)」的**列內容**，這些會進伺服器 log；log 留存與存取範圍受 [`../資安/日誌留存政策.md`](../資安/日誌留存政策.md) 約束。

對外 HTTP 回應的唯一出口形狀是 `errorResponse(pub, status, extra)` → `{ error: pub.message, code: pub.code, ...extra }`。`extra` 放呼叫端既有欄位（`extract-requirements` 的 `run_id`／`status`）。前端只讀 `error`（字串）與 `code`。

`aiHandler.ts` 在 `claudeJson` 回錯時寫的是 `json({ error, code: errorCode }, 502)`——形狀與 `errorResponse` 相同，只是沒經過那支包裝函式。

## 5. 錯誤代碼值域與呼叫端分流不受影響

B1 **沒有**發明新的分類碼；`maskClaudeError` 只是把「原文」換成「短語」，`code` 沿用 `claude.ts`／`agent.ts` 本來就在用的值域：

| `code` | 何時 | 呼叫端據此做什麼 |
|---|---|---|
| `http_<status>` | Anthropic 回非 2xx（429／5xx 會重試；其他 4xx 不重試立即回） | 記帳、log |
| `timeout` | `AbortSignal.timeout` 觸發 | `extract-requirements` 對半切（`retryTimeouts: false` 時不重試） |
| `network` | fetch 例外（非逾時） | 重試 |
| `max_tokens` | `stop_reason === 'max_tokens'`（tool_use 內容不可信，一律視為失敗） | `extract-requirements` 對半切 |
| `no_tool_use` | 回應沒有 `tool_use` block | 重試一次由呼叫端決定 |
| `config` | 缺 `ANTHROPIC_API_KEY` | 訊息不透露環境變數名（測試釘住） |
| `db_error`／`internal`／`business_rule`／`P0001` | 上表三支 | 前端 `friendlyError` 對 `P0001` 原樣顯示 |

`extract-requirements` 的 `run_conflict`／`restart_required`（409）走 `errorResponse(pub, 409, { run_id, status })`，`code` 由呼叫端自行指定；前端 `functionErrorInfo` 從 `error.context` 撈 body 的 `code` 分流——這條協定在 [`resumable-extraction.md`](resumable-extraction.md) §9，本波未改。

**一個要知道的落差**：`ai_usage_events.error_code` 記的不是這些細分類碼。`aiHandler` 與 `agent-run` 在 Claude 失敗時一律記 `errorCode: 'claude_error'`（例外路徑記 `'exception'`），細分類碼只在 HTTP 回應與 log 裡。要從用量表分析「逾時 vs 限流」目前做不到。

## 6. 訊息不得含冒號——前端截尾補救的副作用

前端 `friendlyError` 有一段舊資料補救：正式庫裡 `document_ingestion_runs.error_message` 存在 B1 之前寫入的「中文前綴:英文原始錯誤」樣板字串（例：`處理狀態寫入失敗:new row violates row-level security policy for table "…"`）。對含 CJK 的訊息，它會找第一個冒號（半形或全形），若前綴含 CJK、尾巴非空且**不含 CJK**，就截到冒號為止只留前綴，並 `console.error` 原文。

這條補救讓「冒號」在訊息裡變成語法：伺服器若寫「AI 服務忙碌中：http_429」，尾巴 `http_429` 是純 ASCII，整段會被截成「AI 服務忙碌中」——代碼到不了使用者，構面五要的「訊息**及代碼**」就少了一半。所以 `publicError.ts` 的 `withCode` 一律把代碼用**全形括號附在句尾**：`AI 服務忙碌中，請稍後再試（代碼 http_429）`。`publicError.test.ts` 對九種樣本逐一斷言「含 CJK、含 `（代碼 X）`、不含半形或全形冒號」。

冒號後仍是繁中的自組訊息（「需先核定:請至契約重點頁核定後重試」）不受截斷——`errorMessage.test.js` 釘住。

## 7. 前端 `friendlyError(error, fallback)` 的判定順序

呼叫端提供情境化 `fallback`（例「估驗未儲存」），函式依序：

1. 無 error → `fallback`。
2. `code === 'P0001'` 且有訊息 → 原樣（DB trigger 業務規則）。
3. 訊息含 CJK → 先做 §6 的冒號截尾，其餘原樣（我們自己組的繁中訊息，含 Edge Function 遮罩後的短語）。
4. 命中 `AUTH_MESSAGES`（GoTrue 已知英文訊息的小寫子字串比對）→ 對應中文（帳密錯誤不區分「帳號錯還是密碼錯」）。
5. 命中 `NETWORK`（failed to fetch 等）→ 「網路連線不穩…」（使用者能自己處理的問題講清楚比蓋掉有用）。
6. 其餘 → `console.error` 原文後回 `fallback（代碼 <code|status>）`；無代碼就只有 `fallback`。

第 3 條是伺服器遮罩與前端接上的地方：Edge Function 回的 `{ error }` 已是含 CJK 的短語，前端原樣顯示、不再二次包裝；supabase-js 對 non-2xx 只給 generic 英文（`Edge Function returned a non-2xx status code`），所以呼叫端要先用 `functionErrorInfo` 從 `error.context` 撈 body 再交給 `friendlyError`（`packageRuns.js`、`extractRequirements.js` 都這樣做）。

## 8. `errorLeak.scan` 凍結的前提：兩支原始碼掃描

判準 §2 的前提是「不得用樣板字串把 raw `error.message` 拼進中文訊息」。這不是約定，是兩支掃描式測試釘住的：

| 測試 | 掃描範圍 | 判定 | 放行 |
|---|---|---|---|
| `supabase/functions/_shared/errorLeak.scan.test.ts` | `supabase/functions/` 全部 `.ts`（排除 `.test.ts`） | 同一行同時出現「`json({`／`return { … error:`／`throw new Error(\``／`error: \``」與「error 形狀接收者（`error`／`err`／`e`／`*Error`／`*Err`）的 `.message`」 | 整行含 `console.`、`toolError(`、`maskDbError(`、`maskException(`、`maskClaudeError(`、`dbErrorResponse(`、`exceptionResponse(` |
| `src/lib/errorLeak.scan.test.js` | `src/pages`、`src/components` 的 `.jsx`（排除 `.test.`） | error 形狀接收者的 `.message`，或 `String(e|err|error)` | 整行含 `console.` 或 `friendlyError(`；另有 `WHITELIST`（目前為空） |

`pub.message`（已遮罩）與 `verdict.message`（`gateVerdict` 自己的中文）不在前者的判定內，因為變數名不是 error 形狀。前者另釘三件骨架接線防止手抄回來：13 支純 schema＋prompt 函式必須 `aiJsonHandler(` 且不得再出現 `openAiGate(`／`closeAiGate(`／`req.method === 'OPTIONS'`；`UUID_RE` 只在 `_shared/uuid.ts` 定義；`rpc('ai_feature_allowed'` 只在 `aiGate.ts` 與 `send-reminders/index.ts`。

已知限制（兩支測試檔頭都寫明）：排除是**整行**判定——同一行同時有 `friendlyError(` 與另一個 raw 用法擋不到；`console.error` 行整行放行。這兩種靠 code review。

## 9. 持久化欄位的紀律

錯誤一旦寫進資料表就不是「回應」而是「紀錄」，遮罩要在寫入前完成：

- `document_ingestion_runs.error_message`：`failRun` 只存 `pub.message.slice(0, 2000)`，代碼落 `metadata.error_code`。過期補償的訊息「解析逾時未完成,系統自動標記失敗;可重新啟動解析」是常數字串。
- `document_processing_runs.error_message`：由瀏覽器寫（`packageUpload.js`／`packageRuns.js`），寫入前一律先過 `friendlyError`；`staleProcessingPatch` 的訊息是常數字串（見 [`document-processing-pipeline.md`](document-processing-pipeline.md) §7）。
- 正式庫既存的舊格式列不回頭清洗；讀取時由 §6 的截尾補救處理。

## 10. 測試釘住

| 測試 | 釘什麼 |
|---|---|
| `_shared/publicError.test.ts` | 三類來源的原文（request id、policy 名、constraint 名、`secretField`、`ANTHROPIC` 環境變數名）不出現在回傳值、出現在 `console.error`；分類碼→處置建議；P0001 繁中放行／P0001 英文照遮；null／undefined／非 Error 值安全；九種樣本含 CJK、含 `（代碼 X）`、不含冒號；`isOwnMessage` 判準 |
| `_shared/errorLeak.scan.test.ts` | §8 的 functions/ 掃描與三件骨架接線 |
| `_shared/agent.test.ts` | 工具例外走 `is_error` 且原文不給模型（B1 補） |
| `_shared/agentTools.test.ts` | `toolError` 遮罩（B1 補） |
| `src/lib/errorMessage.test.js` | GoTrue 訊息中文化、P0001 原樣、繁中防呆原樣、42501 只剩「情境（代碼 42501）」、Edge Function generic 英文不外洩、網路錯誤、舊樣板截尾、冒號後仍繁中不截 |
| `src/lib/errorLeak.scan.test.js` | §8 的畫面層掃描 |

現查方式：

```bash
npx vitest run supabase/functions/_shared/publicError.test.ts supabase/functions/_shared/errorLeak.scan.test.ts
npx vitest run src/lib/errorMessage.test.js src/lib/errorLeak.scan.test.js
grep -rn "dbErrorResponse(\|exceptionResponse(\|maskDbError(\|maskException(\|maskClaudeError(" supabase/functions --include='*.ts' | grep -v test   # 遮罩呼叫點
```

## 11. 部署狀態與已知限制（如實記錄）

- **未部署**。commit `bc2b2ea` 已提交於 `refactor/product-wide`，未合併 `main`、未重佈任何 Edge Function。正式站 `app.gov-agent.ai` 對應的 Edge Function 仍是舊行為：Claude 回應本文與 PostgREST 原文仍會回到 API 呼叫者、仍會寫進 `document_ingestion_runs.error_message`。畫面層因既有 `friendlyError` 已合規；API 層要等部署。部署順序與寫回 `CURRENT.md` §6 的規則見 [`../operations/deploy.md`](../operations/deploy.md)。
- B1 的驗證極限（commit 訊息自述）：本機沒有 deno，未做 `deno check` 型別檢查、未做 Deno 實機或真後端 E2E；帶 `npm:` import 的 `aiHandler`／`aiGate` 只靠原始碼比對測試釘住接線；17 支 Edge Function 只過 esbuild bundle。
- `ai_usage_events.error_code` 只記 `claude_error`／`exception` 粗分類（§5）；用量表分不出逾時與限流（ROADMAP 未排入）。
- B6（`c620fd5`）拆檔時發現舊 `persistBatchItems` 的回傳型別標註是 `Promise<string | null>`，但 B1 之後實際回的是 `PublicError` 物件——Deno 型別檢查應該會擋，暗示線上 edge function 從未過 `deno check`；新簽名已取代它，執行期行為不變。這件事支持把 `deno check` 加進 CI（ROADMAP 未排入）。
- 伺服器 log 含 PostgREST `details`（可能有列內容）與例外 stack（§4）；這是刻意的（除錯需要），但 log 存取範圍與留存期要對得上日誌政策。
- Sentry 是否會以 breadcrumb 帶出 supabase-js 的原始錯誤本文：**未查證**（健檢 A 報告提到此可能，本波未驗）。
- `friendlyError` 的 `AUTH_MESSAGES` 是對 GoTrue 版本敏感的子字串比對；GoTrue 改文案會退回第 6 條的 fallback＋代碼，不會外洩但會失去中文化。
- 掃描測試的整行放行限制（§8）。
