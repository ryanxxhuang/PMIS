# 契約重點抽取的跨 request 續跑（W13）

> 狀態：**CURRENT** ｜ 最後核對：2026-09-11（分支 `refactor/product-wide`）。W13 本體（PR #36／#40／#41／#43，2026-08-21～22）已部署；2026-09-08 的逐頁完整性檢查與 B1 錯誤遮罩（`bc2b2ea`）已提交、未合併 `main`、未部署。
> 對應程式：`supabase/functions/extract-requirements/index.ts`、`_shared/requirementExtraction.ts`（純函式：切批、續跑狀態、逐頁讀取）、`_shared/claude.ts`（`claudeJson`）、前端 `src/lib/extractRequirements.js`（接力層）、`src/lib/documentIngestion.js`／`packageUpload.js`（呼叫端）
> 對應 migration：`20260712000600_p0_06_document_ingestion.sql`（`document_ingestion_runs`）、`20260822000100_ingestion_run_active_unique.sql`（partial unique index）、`20260822010200_repair_w14_run_counts.sql`（一次性計數修正）
> 上游脈絡：[`traceable-document-ingestion.md`](traceable-document-ingestion.md)（P0-06 管線與引註驗證）、[`requirement-review-boundary.md`](requirement-review-boundary.md)（完成後的自動確認）。本文件只寫「為什麼要續跑、怎麼續跑、哪裡會斷」。

## 1. 問題：牆鐘不是天花板，API 閘道才是

W10 以前整份文件一次餵模型；W10 改分批但單批 120k 字，69 頁契約整本塞進一次呼叫，輸出趕不上 120s 逾時，同尺寸重試三連發直接撞平台 wall-clock 被砍成殭屍 run（`pending`／`processing` 永遠轉圈；而 `review_requirement` 只准核定 `completed` run 的建議，整批跟著卡死）。

W13 縮批＋續跑後又撞到第二層：Edge Function 的牆鐘是 400s，但 **Supabase API 閘道對單一 request 有 150s 逾時**（2026-08-22 正式站實測 504）——回應必須在 150s 內送出，否則閘道切線、前端只拿到非 JSON 的 504。所以設計目標變成：**每個 request 只跑一小段、進度落庫、回 `in_progress`，由瀏覽器再打下一個 request 接力**。

## 2. 為什麼 driver 在瀏覽器

Edge Function 沒有背景工作與排程，一個 request 結束就結束；要讓「跑到完」跨越多個 request，就得有人在外面反覆呼叫。目前這個角色由瀏覽器承擔：`src/lib/extractRequirements.js` 的 `runRequirementExtraction()` 收到 `status: 'in_progress'` 就帶 `continue_run_id` 再打，直到 `completed`／`failed`，上限 `MAX_CONTINUATIONS = 40`（撞到上限代表伺服器端邏輯有問題——每個 request 都該有進度——誠實回報中止）。三個呼叫點（契約包上傳、契約頁確認分類／重試、需求頁單檔上傳）一律走這一支。

代價是使用者關掉分頁就沒人接力；run 會掛在 `awaiting_continue`，直到下一次啟動解析時被過期補償標成 `failed`（§5）或有人重新啟動。這是已接受的邊界，不是 bug。

前端接力層的檔頭註解寫 `MAX_BATCHES=12`，伺服器現值是 24（§3）——註解過期，行為不受影響（上限 40 仍足夠）。

## 3. 常數（以程式為準，這裡只解釋為什麼）

| 常數 | 值 | 為什麼 |
|---|---|---|
| `BATCH_CHAR_BUDGET` | 14,000 字元 | W14 二修：28k 單批實測要跑 ~95s，續跑 request 一撞 150s 閘道就 504；縮半讓單批 30～60s 內穩定跑完，不靠對半切救場 |
| `MAX_BATCHES` | 24 | 成本上限；超過的頁照舊寫進 metadata 並回傳揭露（`truncated_input`／`omitted_page_count`），never silently |
| `TIME_BUDGET_MS` | 60,000 | 單 request 軟預算：超過且還有批次沒跑 → 進度落庫、掛 `awaiting_continue`、回 `in_progress`。抓保守，一個 request 跑 1～2 批 |
| `REQUEST_ABS_CAP_MS` | 140,000 | 單 request 絕對上限，對齊 150s 閘道留 margin；每次 Claude 呼叫的 `timeoutMs` 依剩餘預算收斂 |
| `MIN_CALL_TIMEOUT_MS` | 20,000 | 剩餘預算不足以打一次有意義的呼叫 → 批內暫停（§7） |
| `CLAUDE_RETRIES` | 1 | 429／5xx 秒回，重試不吃生成窗口；逾時不重試（`retryTimeouts: false`） |
| `STALE_RUN_MS` | 10 分鐘 | 過期判定（§5） |
| `maxTokens` | 16,384 | 單批輸出上限；撞到 `max_tokens` 走對半切 |
| 模型 | `MODELS.smart`（`claude-sonnet-5`） | 長文件抽取 |

改動任何切批參數都有 §8 的副作用。

## 4. Run 的生命週期與 `metadata` 進度快照

`document_ingestion_runs` 是 system-managed 表（只有 service role 寫；authenticated 連帶 JWT 的特權寫入都被 trigger 擋），`metadata jsonb` 是續跑的全部狀態：

```text
batches_total, batches_completed          批次計畫與已完成批數
cum_requirement_count, cum_verified_count, cum_needs_review_count,
cum_raw_item_count, cum_work_item_link_count, cum_rejected_count
rejected_items (≤20), clipped_batches     揭露用清單
pending_split_batch, pending_split_depth, pending_split_done (≤64)   批內對半切的續跑狀態（§7）
awaiting_continue                         true = 暫停待續跑；續跑認領用 CAS 翻掉它
last_progress_at                          進度心跳（過期判定用）
error_code                                失敗時的分類碼（B1；`error_message` 只存中文短語）
```

`readResumeState(meta)` 把這些鍵還原成計數器，**欄位缺漏、壞型別、null 一律回安全預設**（舊 run 或壞 metadata 不能讓續跑炸掉，頂多從頭統計）。

**計數快照只寫「最後完成批」當下的值，不寫批內半途的活計數**：批內暫停後下個 request 會整批重跑，落庫本身靠 `deterministicUuid(`${runId}:${label}:requirement:${i}`)` 冪等（同 run 同 label 同 index → 同 UUID，`upsert … ignoreDuplicates`），但計數不冪等——若把半批計數寫進去就會重複累計。所以計數必須跟著同一條「批完成」邊界走；子批（對半切後）完成也算邊界，因為子批有 done-label 防重跑（§7）。`jsonb` 是整包覆蓋，`progressMetadata()` 每次寫全部鍵。

`20260822010200` 是這條規則沒守好的一次性修正：2026-08-22 上午一條跨三次部署的 run，顯示計數器在部署交界被斷點重置，最終回報「找到 28 項」但實際落庫 103 條；建議資料本身正確且不重複，只有 run 上的統計欄位少算，按實際列數重算回填。

## 5. 過期標記：看「最後進度」不只看開跑時間

每次啟動**新**解析時（不是續跑），best-effort 把本專案 `pending`／`processing`、`started_at < now − 10min`、且 `last_progress_at` 缺或 `< now − 10min` 的 run 標成 `failed`（訊息「解析逾時未完成，系統自動標記失敗；可重新啟動解析」）。失敗不擋主流程。

為什麼要吃心跳：續跑中的長文件 run 可以合法活過 10 分鐘，只要批次持續落庫（`last_progress_at` 一直前進）就不是殭屍。反過來，「同版本是否已有存活的 run」用**對稱**條件判定：`started_at >= cutoff` 或 `last_progress_at >= cutoff`。

## 6. 認領與 CAS、partial unique index 與 23505

兩種啟動路徑：

**續跑（帶 `continue_run_id`）**：先讀 run；必須同 `document_version_id`、`status = 'processing'`、`metadata.awaiting_continue === true`，否則回 **409 `restart_required`**（終局：run 已完成／失敗／被接手）。符合就做 CAS：

```text
update document_ingestion_runs
   set metadata = { ...meta, awaiting_continue: false, last_progress_at: now }
 where id = continue_run_id
   and metadata @> '{"awaiting_continue": true}'     -- .contains()
```

兩個並發續跑只有一個改得到旗標，搶輸的 `claimed` 為空 → **409 `run_conflict`**，不會兩邊同時跑同一批。

**新啟動**：先用存活條件查同版本有沒有進行中的 run（有 → 409 `run_conflict`），再 `insert` 一列 `processing`。但 select-then-insert 有時間窗——2026-08-21 正式站實測兩個相隔 17ms 的請求同穿前端防連點與伺服器 select 防呆並行抽取、雙倍燒 token。唯一擋得住的層是 DB 唯一性：

```sql
create unique index document_ingestion_runs_one_active_per_version
  on document_ingestion_runs (document_version_id)
  where status in ('pending', 'processing');
```

insert 撞上它回 SQLSTATE `23505`，函式端轉成 409 `run_conflict`。建 index 前 migration 先把當時所有 `pending`／`processing` 一律收斂成 `failed`：部署窗內沒有合法在跑的解析值得保護（被砍的殭屍佔多數），真的在跑的請求之後以 `id` 定位寫 `completed` 不受影響，續跑認領則誠實拿到 `restart_required`。

**未查證／缺口**：`supabase/tests/` 目前沒有針對這條 partial unique index 的 pgTAP（`grep one_active_per_version supabase/tests/` 無命中）；競態防護只由 migration 與函式端 23505 處理保證。

## 7. 活鎖防護的由來（兩層，都是實測出來的）

**第一層：單次呼叫給滿生成窗口＋對半切深度持久化**（`3fcb424`）。原本把剩餘預算除以重試次數，67s 的窗口跑不完的批，每個 request 接力時都重演一次註定逾時的完整嘗試，卡死在 1/5。改法：`callTimeoutMs = min(120s, 剩餘預算 − 15s)` 不再除以次數（429／5xx 的重試是秒回的快失敗；逾時根本不重試）；批撞到 `max_tokens` 或 `timeout` 就對半切（最多兩層，單頁批切不動 → 記進 `clipped_batches` 揭露）；預算見底時「**批內暫停**」（`paused`，不是失敗）：記下 `pending_split_batch` 與 `nextDepth`，下一個 request 直接從切好的深度開跑（`forceSplitBelow`），不重演完整嘗試。

**第二層：子批完成 label 持久化**（`d6890d6`）。對半切後的子批總時長可能超過單一 request 預算；沒有記錄的話每輪都從第一塊重跑，最後一塊永遠輪不到。子批完成即 `doneSubLabels.push(label)` 並把計數快照與 metadata 一起落庫；續跑時 `depth > 0 && doneSubLabels.includes(label)` 直接跳過（落庫冪等，但重跑燒時間）。換到別批就清掉 done-labels（它只屬於 `pending_split_batch` 那一批）；被 clip 的子批也記為已處理，續跑不重 clip。

軟預算的例外：本 request 的**第一批一律照跑**（`bi > startBatch` 才檢查 `TIME_BUDGET_MS`），避免閘門與載入耗時導致每個 request 都空轉。

## 8. 改批次參數會讓在途 run 作廢（刻意的副作用）

切批是確定性的：頁不可變（`document_pages` 綁在不可變的文件版本）＋固定參數 → 同一版本每次算出同一份批次計畫。續跑靠這個假設才能用 `batches_completed` 定位。**部署若改了 `BATCH_CHAR_BUDGET` 或 `MAX_BATCHES`**，舊 run 的 `batches_total` 對不上新計畫，或 `batchesCompleted > totalBatches`：函式端寧可明確失敗——`failRun(... code: 'restart_required')` 回 409——也不錯位續抽。所以改這兩個常數的部署等於宣告：**所有掛在 `awaiting_continue` 的 run 要重跑**；已落庫的建議不會消失（§10），只是要重新啟動。

## 9. 409 帶 code 的協定（前端據此分流）

| HTTP | `code` | 語意 | 前端 `runRequirementExtraction` |
|---|---|---|---|
| 200 | — | `status: 'in_progress'`，帶 `run_id`／`batches_total`／`batches_completed`／`total_page_count` | 帶 `continue_run_id` 再打，`onProgress` 回報 |
| 200 | — | `status: 'completed'`，帶計數與涵蓋揭露（§11） | `ok: true` |
| 409 | `run_conflict` | 這份文件已在解析中（別的 run 活著、CAS 搶輸、或 23505） | `inProgress: true`——**顯示處理中，不得標失敗**（W13 殭屍事故裡連點重試的 409 曾一路把活著的解析蓋成失敗） |
| 409 | `restart_required` | 終局：run 已完成／失敗／被接手，或批次計畫已變更 | `inProgress: false`，走失敗收尾（否則 UI 掛在處理中空轉） |
| 409 | 無 code（部署空窗的舊版函式） | 不明 | 保守當 `inProgress`，避免蓋寫活解析 |
| 422 | `no_text` | 全部頁無可用文字（掃描件） | 真失敗 |
| 502 | 批次失敗碼 | 一批都沒成 | 真失敗 |
| 502／504（非 JSON） | — | 閘道逾時／上游斷線 | 特判為「伺服器處理逾時，已完成的進度已保留；請稍後按重試接續」 |
| 403／401／404／400 | — | 閘門與輸入驗證 | 真失敗，帶伺服器原話（supabase-js 對 non-2xx 只給 generic 英文，`functionErrorInfo` 從 `error.context` 撈 body） |

錯誤訊息紀律（B1）：`error_message` 整案成員可讀且前端會顯示，所以只存分類碼＋中文短語；PostgREST／Claude 原文只進 log；`loadDocumentPages` 等刻意 throw 的繁中訊息經 `maskException` 原樣放行。

## 10. 不清舊建議

新啟動**刻意不**刪先前 run 的建議：審查清單只收最新 completed run 的建議（`requirementReview.js` 的 `latestCompletedRunIds`），舊 run 的草稿列留在 DB 無害；反之刪除會誤殺人工已編修的草稿（`saveEdit` 改內容不改 status）與已審的工項連結，且刪在新解析成功之前——模型供應商一停機審查佇列就被清空。W13 審查確認後撤掉原本的清理設計。

## 11. 逐頁讀取的完整性檢查（2026-09-08 加，未部署）

`loadDocumentPages(build, expectedPageCount)`（`requirementExtraction.ts`）取代原本「回傳少於 1,000 列就當讀完」的推論：

- 每批請求 `{ count: 'exact' }`，以 `count` 為總數；PostgREST 可能套比請求更小的 `max_rows`（例如 500），仍依實收筆數續讀直到 `pages.length === count`。
- `count` 為 null／非整數／負數 → 拒絕；途中 `count` 變動 → 「文件頁面仍在更新」拒絕；某批回空但還沒讀完 → 拒絕。
- **頁序必須從 1 連續**（`page.page_number === pages.length + 1`），否則「文件頁序不完整」。
- `document_processing_runs.metadata.page_count`（上傳時由 `packageUpload.js` 寫入）有值時，儲存頁數必須相符，否則「文件頁數與上傳紀錄不符」；格式錯誤（非整數）**不降級為未知放行**。舊流程沒有這個欄位時維持可用，但只能證明「已儲存文字讀取完整」，不能證明原檔沒有遺失尾頁。
- 讀取失敗中途錯誤不會把半份資料送模型；PostgREST 原文只進 log。

同批補的完整性語意：模型未回傳 `requirements` 陣列視為該批失敗（`no_requirements`），不再偽裝成成功空結果；`extractionCoverageIncomplete()` 在 `truncated`／`failed`／`clipped > 0`／`emptyPage > 0`／`rejected > 0` 任一成立時為 true，寫進 `coverage_incomplete` 並回前端；前端逐文件版本顯示最近一次 completed run 的警示，另一份文件成功不會清掉舊警示。**`completed` 不等於內容全對**——處理覆蓋與語意準確率是兩個指標，後者尚未用真實契約量測。

## 12. 記帳與收尾

- 每個 request 各記一筆 `ai_usage_events`（`closeAiGate`）：暫停待續跑時也先落帳（token 已花掉），完成時再記本 request 的量；被平台砍掉最多掉一批在途量。
- 有成功批次時即使後面失敗也走 `completed` ＋ 揭露（`failed_batch` 進 metadata）：已落庫的建議要能被確認，缺的範圍明講。一批都沒成才整個 run `failed`（502）。
- 完成後呼叫 `apply_transcription_triage(p_run)`（D-017／D-019 的確定性自動確認）；分流失敗不擋 run 完結，列維持待確認、安全退化。

## 13. 測試釘住

| 測試 | 釘什麼 |
|---|---|
| `_shared/requirementExtraction.test.ts` | `loadDocumentPages`（500 列上限仍讀完、後半失敗拒絕、count 變動、缺尾頁、格式錯誤不放行）、`extractionCoverageIncomplete`、`buildDocumentBatches`（保序、單頁不切、超過 maxBatches 揭露）、`splitBatch`、`mergeUsage`、`readResumeState`（完整還原、壞 metadata 安全預設、對半切欄位） |
| `src/lib/extractRequirements.test.js` | 接力（一次完成、多段 `in_progress`）、409 兩種 code 分流、無 code 的 409 保守處理、403／422 原話、接力上限中止、覆蓋警示不互相掩蓋 |
| `supabase/tests/p0_06_document_ingestion.sql` | run 的 provenance 完整性、跨案隔離、system-managed 寫入邊界（不含 W13 的唯一 index） |

## 14. 已知限制與未查證

- 24 批上限、無 OCR、語意漏抽與跨條款理解未解；準確率／召回率未用真實契約量測（[`../契約自動整理品質優化-2026-09-08.md`](../契約自動整理品質優化-2026-09-08.md) 列了評測方法，尚未實作）。
- partial unique index 無 pgTAP（§6）。
- 前端接力層註解的 `MAX_BATCHES=12` 過期（§2）。
- 使用者關閉分頁後的 run 只能等過期補償或人工重啟；沒有伺服器端排程接手（刻意不做背景工作框架）。
- 2026-09-08 的完整性修正只在本機通過 Vitest 與 esbuild bundle，Deno 實機與真模型端到端未重跑。
