# 專案文件處理管線（上傳 → 分類 → 契約包歸屬 → 抽取）

> 狀態：**CURRENT** ｜ 最後核對：2026-09-11（分支 `refactor/product-wide`。契約包與處理 run 本體（P0-07.5，migration `20260712000800`）與 W14 四件套（PR #37／#38／#39／#44）已部署；2026-09-08 兩批——`packageRuns.js` 讀寫拆分、覆蓋警示併入 processing metadata、契約包 `partial` 不算 `ready`、`extract-requirements` 讀 `metadata.page_count` 核對頁數——**已提交、未合併 `main`、未部署**。`src/pages/web/Contract.jsx` 已由重構波次 4b commit `b7a1000` 抽取完成（1080→592）：`loadPackageRuns`（純讀）與 `healStaleRuns`（中斷復原寫入）拆進 `src/lib/packageRuns.js`，原頁內 `confirmClassification` 的 run 狀態機亦搬進同檔為 `reclassifyProcessingRun`；本文件只描述機制，不抄頁面內容）
> 對應程式：`src/lib/packageUpload.js`（逐檔流程、`STAGE_ORDER`、`packageStatusFromRuns`、`staleProcessingPatch`）、`src/lib/packageRuns.js`（上傳後的讀取、修復、改分類／重試）、`src/lib/documentClassifier.js`（確定性分類）、`src/lib/packageFileSupport.js`（收件與可分析的分界）、`src/lib/documentExtract.js`（逐頁抽文字）、`src/lib/extractRequirements.js`（抽取接力層）、`src/lib/documentIngestion.js`（不歸包的單檔舊路徑）、`supabase/functions/classify-document/index.ts`、`_shared/documentTypes.ts`（值域單一真相）、`extract-requirements/index.ts`（讀 `page_count` 核對）
> 對應 migration：`20260712000800_p0_07_5_contract_packages.sql`（`contract_packages`、`document_processing_runs`、分級 RLS、私有 bucket、留痕 trigger）、`20260822000300_document_delete.sql`（`delete_document` RPC）、`20260822000400_ai_classify_document.sql`（`documents.classify` 功能列）、`20260822010200_repair_w14_run_counts.sql`（一次性計數修正）、`20260824000900_contract_grading_completion.sql`（手動補登歸包）
> 測試：`src/lib/packageUpload.test.js`、`packageRuns.test.js`、`documentClassifier.test.js`、`packageFileSupport.test.js`、`documentExtract.test.js`、`src/pages/web/Contract.flow.test.jsx`；pgTAP `supabase/tests/p0_07_5_contract_packages.sql`、`document_delete.sql`；e2e `contract-flow.spec.js`
> 決策依據：[`../DECISIONS.md`](../DECISIONS.md) D-007（建案後第一站是專案文件）、D-018（契約分級可見性）；下游 D-012／D-017／D-019 在 [`requirement-review-boundary.md`](requirement-review-boundary.md)。上游的頁面／版本／引註驗證在 [`traceable-document-ingestion.md`](traceable-document-ingestion.md)，抽取的續跑在 [`resumable-extraction.md`](resumable-extraction.md)；本文件只寫「檔案從選檔到路由進抽取之間」這一段，以及它與那兩份的交界。

## 1. 一句話與全鏈

**一次上傳＝一個契約包收多個檔案；每個檔案有一列誠實的處理狀態，離開頁面或重新整理不會遺失進度；一個檔案失敗不會拖垮整包；重傳同一份內容是冪等的。**

```text
選檔（統一窗口；PCCES 標單 XML 在進管線前就分流到 BOQ 匯入）
  → 逐檔、併發上限 UPLOAD_CONCURRENCY（mapWithConcurrency 隔離每檔失敗）
    → 讀入＋sha256 checksum
    → 抽文字（PDF／DOCX／TXT 才「可分析」；其餘只收件）
    → 確定性分類（檔名規則 → 內文規則 → other）
    → get-or-create documents（同包＋同檔名＝同文件，歸入契約包）
    → get-or-create document_versions（同 checksum 重用；storage_path 在 INSERT 就定）
    → 上傳原始檔到私有 bucket contract-documents
    → 落 document_pages（每批 200 列）
    → （條件）AI 分類第二意見 classify-document
    → （條件）路由到 extract-requirements（W13 接力層）
    → 收尾：completed／partial／failed／unsupported
  每一步都 upsert 一列 document_processing_runs（onConflict: document_version_id）
```

`documentIngestion.js` 是另一條**不歸包**的單檔舊路徑（需求頁單檔上傳）：不建處理 run、不上傳原始檔、直接落頁後呼叫抽取接力層。它的存在讓 `extract-requirements` 必須容忍「沒有 processing run 的版本」（§6）。

## 2. 契約包：一個專案裡的三方關係

`contract_packages` 一列＝一個契約關係（`package_type`：construction／supervision／other；`counterparty_project_party_id`＝乙方）。身分 `(project_id, package_type, counterparty)` 唯一，前端 get-or-create 因此確定性、重傳不會分岔出第二個包；`package_type` 與 counterparty 一經建立**不可變**（trigger）。

可見性是 D-018 的落點，由 `can_access_contract_package` 一支 `security definer` 決定：機關方看全部；監造方看施工包＋自己是乙方的包；其他方只看自己是乙方的包。文件、版本、頁、ingestion run、processing run、Requirement、出處、工項連結、稽核事件全部透過 `can_read_project_document`／`can_read_document_version`／`can_read_requirement_provenance` 沿這條鏈分級；未歸包（`contract_package_id` null）的文件維持專案成員可見（legacy 相容）。

寫入權 `can_upload_contract_package` ＝ `can_manage_documents`（文件管理權）**且**看得到那個包——廠商永遠填不進監造包，猜到 UUID 也改不了它的文件與頁（pgTAP 釘住）。沒有 DELETE policy：包只能改 `status` 歸檔。

`status` 值域 `draft／processing／ready／needs_attention／archived`，**由前端推導後寫回**（§8），資料庫不重算。留痕 trigger 只在 created／processing_started／ready 三種轉移寫 `audit_events`（`contract_package.*`）；轉成 `needs_attention` 不留痕。

## 3. 處理 run 的階段機器

`document_processing_runs` 一列＝一個文件版本在一個包裡的處理狀態；`unique (document_version_id)` 讓重試更新同一列（同內容→同 checksum→同版本→同列）。它是**UX 狀態**，由上傳者的瀏覽器寫（RLS：讀依包可見性、寫依 `can_upload_contract_package`），migration 明寫「不是契約權威，不繞過系統管理的 ingestion run 與審查邊界」。

前端 `STAGE_ORDER` 是階段的序：

```text
received(0) → uploaded(1) → extracting_text(2) → classifying(3) → extracting_requirements(4) → completed / failed / unsupported(5)
```

`runPct(run)` 由它推導等分刻度（不是假進度；原本頁面硬寫 `/5`，加一個階段就靜默算錯）。`status` 與 `stage` 是兩個維度，DB CHECK 釘住合法組合：

| `status` | `stage` | `completed_at` | 語意 |
|---|---|---|---|
| pending／processing | 任一非終態 | 必須 null | 進行中 |
| completed | 必須 completed | 必填 | 全部完成（含「路由到抽取且抽取完成」與「不需抽取」） |
| partial | failed | 必填 | 原始檔已落地但後段沒做完：掃描檔抽不到文字、抽取失敗、中斷復原（§7） |
| failed | failed | 必填 | 原始檔上傳失敗（bucket 拒收、超限） |
| unsupported | 必須 unsupported，且 `parser_type = 'none'`，且 `metadata.requirement_extraction ≠ 'completed'` | 必填 | 收件但不分析（圖片、試算表、舊格式）；**不得宣稱抽取完成**（pgTAP 釘住 `23514`） |

`TERMINAL_RUN_STATUSES = completed／partial／failed／unsupported`；面板列、文件表、進度統計吃同一個 `isTerminalRun`。`runFileLanded(run)` 回答「原始檔真的在 bucket 裡嗎」：`stage` 過了 `received`，且 failed／partial 列必須留有 `metadata.storage_path`（中斷復原會把停在 received 的列蓋成 partial，只看 stage 會誤判）——開檔／下載入口與進度統計吃同一個訊號。

同專案／同包一致性由 trigger `validate_document_processing_run` 守：run 的包必須等於文件版本所屬文件的包，跨包、跨案一律 raise。

`metadata` 的鍵（現查：`grep -n "metadata: {" src/lib/packageUpload.js src/lib/packageRuns.js`）：`filename_kind`、`storage_path`、`page_count`、`classification_reason`、`limitation`、`extraction_progress`／`extraction_progress_at`（W13 心跳）、`requirement_extraction`（skipped／in_progress／completed／failed）、`requirement_extraction_message`、`requirement_extraction_warning`、`routed_document_type`。

## 4. 分類：確定性優先，AI 只做第二意見

### 4.1 收件與可分析的分界（`packageFileSupport.js`）

上傳控制項**收整個契約包**（`ACCEPTED_EXTENSIONS` 含 pdf／docx／doc／txt／csv／xlsx／xls／jpg／png／tif／xml），但只有 `analysisSupport(kind) === 'full'`（pdf／docx／txt）會抽文字、落頁、進 AI；其餘 `stored`：原始檔保存、只依檔名分類、標誠實的限制標籤（圖片「等待 OCR 支援」、其他「尚未支援內容分析」），**不在選檔器拒收、也不假裝分析過**。

### 4.2 確定性分類器（`documentClassifier.js`）

純函式、不呼叫 AI，只會回 `CLASSIFIABLE_DOCUMENT_TYPES` 九種既有型別之一（`finish` 兜底成 `other`）：

1. `FILENAME_RULES` 依序第一個命中即回，信心 0.85（≥ `AUTO_ACCEPT_THRESHOLD` 0.8 → `auto_accepted`）。**價格 guard 刻意排在契約關鍵字之前**：檔名含「價目／標單／單價分析／預算書／價格」一律 `other`——單價分析表不能被當契約條文讀。
2. 檔名無命中且可分析、有文字 → `CONTENT_RULES` 對前 1,500 字（`normalizeSourceText` 後）比對，信心 0.7 → `needs_review`。
3. 都沒有 → `other`、0.4、`needs_review`。

`classification_status` 三值：`auto_accepted`（信心夠）、`needs_review`（待人確認）、`confirmed`（人確認過或既有文件）。

### 4.3 AI 第二意見（`classify-document`，W14）

只在三個條件同時成立時才問：**第一次入庫的新文件**（既有文件的型別已被人或前批確認，不重問）、確定性分類器判 `needs_review`、且有落頁。呼叫 `classify-document`（`documents.classify`，`MODELS.fast`，取前 3 頁最多 4,000 字＋檔名；schema 的 `document_type` 是 enum，只能選現有型別；`finish` 再做值域防呆與信心 clamp 0～1）。信心 ≥ 0.8 → `auto_accepted` 並**同步改 `documents.document_type`**（`documents_type_corrected_audit_event` trigger 留痕 `document.classification_corrected`）、照常路由抽取；信心低 → 只換成更好的建議，照舊進待確認。閘門與計量走 [`ai-gate-and-metering.md`](ai-gate-and-metering.md) 的標準路徑（`aiJsonHandler`；`body.project_id` 與文件版本解出的專案必須一致）。

**AI 分類失敗（方案關閉、模型錯誤、網路）一律回 null、靜默退回確定性判定**——分類建議永遠不值得擋掉一次上傳。分類是可逆的歸檔建議，不是核定，不踩紅線一。

值域單一真相在 `_shared/documentTypes.ts`（Deno 打包限制，真相放 functions 側、前端跨目錄 import，與 `sourceVerify.ts` 同慣例）。`documents.document_type`（`20260712000300`）與 `document_processing_runs.suggested_document_type`（`20260712000800`）的 CHECK 是同九值的 SQL 字面量；`documentClassifier.test.js` 只釘「分類器只回 `CLASSIFIABLE_DOCUMENT_TYPES` 內的值」，**TS 值域與兩處 SQL CHECK 是否一致沒有測試釘住**（未查證是否有其他機制）。

## 5. 路由到抽取：`shouldExtractRequirements`

只有「可承載義務的型別」**且**「分類已被信任」才送抽取：

```text
EXTRACTABLE_DOCUMENT_TYPES = contract / specification / quality_plan / itp
classification_status ∈ { auto_accepted, confirmed }
```

`other`（含價目表）、圖說、表單、送審副本、報告一律保存＋分類但**不進抽取 prompt**。既有文件（同包同檔名重傳）以 `confirmed` 看待。

路由後呼叫 `runRequirementExtraction({ documentVersionId, projectId, onProgress })`——這是與 [`resumable-extraction.md`](resumable-extraction.md) 的**交界**：本文件到「交出去」為止，續跑、409 分流、批次參數都在那份。本側只做三件事：

- `onProgress` 每段把 `extraction_progress`（第 N/M 批）與 `extraction_progress_at`（心跳）best-effort 落庫，重新整理也看得到進度、且 §7 的過期判定據此知道還活著。
- 回傳三態的處置：`ok` → `completed`＋`requirement_extraction_message`（`extractionSuccessMessage`，W10 起截斷時連著講清楚讀到哪裡）＋`requirement_extraction_warning`（`extractionCoverageWarning`）；`inProgress`（409 `run_conflict`）→ **維持 processing、不蓋寫成失敗**（W13 殭屍事故裡連點的 409 曾一路把活著的解析蓋成失敗），由持有那條解析的呼叫端收尾，真斷頭交 §7；其他失敗 → `partial`／`failed`＋`error_message`。
- 上傳時的 `page_count` 寫進 metadata，供 `extract-requirements` 核對（§6）。

## 6. 兩張 run 表：分工與為什麼是兩張

| | `document_processing_runs`（本文件） | `document_ingestion_runs`（[`traceable-document-ingestion.md`](traceable-document-ingestion.md) §6） |
|---|---|---|
| 寫入者 | 瀏覽器（上傳者 JWT，RLS 依包） | 只有 service role；authenticated 連帶 JWT 的特權寫入都被 trigger 擋 |
| 粒度 | 一版本一列（`unique`），重試就地更新 | 一次抽取一列，重新解析開新 run，舊 run 與其建議不刪 |
| 涵蓋 | 上傳→分類→路由的整段（含不需抽取的檔案） | 只有 AI 抽取這一段 |
| 內容 | UX 狀態：階段、分類建議、限制標籤、心跳、揭露訊息 | 可追溯的 provenance：模型／prompt 版本、觸發者、計數、續跑快照、`coverage_incomplete` |
| 權威 | 無——migration 明寫不是契約權威 | Requirement 的 `ingestion_run_id` 指向它；審查只准核定 completed run 的建議 |

為什麼不是一張：寫入者的信任等級不同（瀏覽器可寫的表不能承載「AI 說了什麼、經誰授權」的紀錄）、生命週期不同（一列覆蓋 vs 每次新列）、涵蓋不同（收件的圖片也要有狀態列，但它永遠不會有 ingestion run）。

兩張表的交叉點只有三處，都是單向讀：

1. `extract-requirements` 以呼叫者 RLS client 讀 `document_processing_runs.metadata.page_count`（`maybeSingle`），交給 `loadDocumentPages` 核對儲存頁數；讀不到列（舊路徑、`documentIngestion.js`）維持可用但只能證明「已儲存文字讀取完整」（[`resumable-extraction.md`](resumable-extraction.md) §11）。
2. `packageRuns.loadPackageRuns` 讀最近一次 completed ingestion run 的 `metadata` 算出覆蓋警示，併進對應 processing run 的 `requirement_extraction_warning` 顯示（每個版本各看自己最近的 completed run，另一份文件成功不會清掉舊警示；與契約兩頁 `latestCompletedRunIds` 同一判定）。
3. `20260822010200` 一次性修正：跨三次部署的 run 顯示計數少算，按 `requirements` 實際列數回填 ingestion run 的計數欄，並同步重寫 processing run 上「找到 N 項契約重點建議」那句（只動數字開頭的既有訊息，冪等）。

## 7. 過期 run 的判定與修復

瀏覽器是這條管線的 driver，關分頁、重新整理、當機都會讓 run 停在 pending／processing 永遠轉圈。修復分兩段、刻意拆開：

**判定**（`staleProcessingPatch(run, now, threshold)`，純函式）：只看 pending／processing；最後活動時間取 `started_at` 與 `metadata.extraction_progress_at` **較晚者**（W13：長文件多段續跑的總時長可以正當超過 20 分鐘，只要心跳還在前進就不是中斷；心跳是壞字串就退回用 `started_at`）；距今 ≥ `PROCESSING_STALE_MS`（20 分鐘）才回 patch：`status: 'partial'`、`stage: 'failed'`、`completed_at`、常數訊息「處理曾被中斷；原始檔已保存，請重新上傳相同檔案繼續處理」。

**寫入**（`healStaleRuns(runs, { now, shouldContinue })`）：從讀取函式拆出來——讀取函式偷偷寫庫時，「誰可以寫」只能混進讀取邏輯當旗標；拆開後由頁面決定要不要修（**能管理文件的人才修**；機關唯讀者只讀不寫）、修到一半要不要停（`shouldContinue` 每筆寫入前再問一次，切案／切包後停手，不把別包的列改掉）。寫入失敗的列原樣保留，下次載入再修。

`reclassifyProcessingRun` 重啟 run 時**一併重設 `started_at`**：不重設的話「上傳很久之後才確認分類／重試」會被輪詢立刻誤判成中斷。

要分清楚的是：這個 20 分鐘時鐘只管 processing run。ingestion run 另有自己的 10 分鐘過期補償（`STALE_RUN_MS`，看 `last_progress_at`，在每次啟動新解析時執行；[`resumable-extraction.md`](resumable-extraction.md) §5）。**兩個時鐘各管各的表**，一個 processing run 被標 partial 不代表對應的 ingestion run 已被標 failed，反之亦然。

## 8. 契約包 `ready`／`needs_attention` 的語意（09-08 起 `partial` 不算 ready）

`packageStatusFromRuns(runs)` 由 `summarizePackageProgress` 的真實計數推導，順序固定：

```text
total = 0                                             → draft
active > 0（任一列非終態）                              → processing
failed > 0 或 partial > 0 或 incomplete > 0 或 needsClassification > 0 → needs_attention
其餘                                                    → ready
```

`incomplete` ＝ 帶 `requirement_extraction_warning` 的列（抽取完成但覆蓋不完整）；`needsClassification` ＝ `classification_status = 'needs_review'`。所以：一個檔案失敗或待分類就讓整包 `needs_attention`，**永遠不會是 failed**（包只描述「需要人看一眼」，不替單檔背失敗）；`unsupported` 的檔案不阻擋 `ready`（收件成功就是它的完成）；`partial` 與覆蓋不完整自 2026-09-08 起明確列入 `needs_attention`（`packageUpload.test.js`「部分完成或已完成但有覆蓋缺漏的契約仍需留意」）——在那之前 `partial` 未被計入，整包可能顯示綠色 `ready` 而其中一份契約其實只整理了一半。

同一批的面板統計 `summarizeUploadBatch` 對「完成」的判準更嚴：`completed` 但 `needs_review` 或帶覆蓋警示的檔案歸 `needs`，不是 `ok`（面板報綠色「已抽取」就是說謊，W11 審查）；「重試」只對 `metadata.requirement_extraction === 'failed'` 有效——上傳失敗或掃描檔重打抽取必吃 422 且會蓋掉真正的失敗原因，正確復原是重新上傳同檔（checksum 相同會自動接續、補落頁）；進度母數定錨在**選檔總數**而非已建列數（列是開工才建的，母數會長大、進度會倒退）。

包的 `status` 寫回時機（現查：`grep -n "from('contract_packages').update" src/pages/web/Contract.jsx`）：開始上傳前寫 `processing`，整批結束後重讀該包全部 run 再寫 `packageStatusFromRuns` 的結果。`healStaleRuns` 與 `reclassifyProcessingRun` **不寫回包的 status**——修復或重試之後，包的狀態要等下一次上傳才會重算。

## 9. 改分類、確認分類、重試：同一台狀態機

`reclassifyProcessingRun({ run, newType, documentId, projectId, onRunPatch, onDocumentTyped })` 不碰 React state（畫面更新走回呼），所以能在 node 直接測狀態轉移：

1. 有 `documentId` → 先寫 `documents.document_type`（失敗就整個停，`{ ok: false, inProgress: false }`，不動 run、不打抽取）。
2. `canRerouteExtraction(run, newType)` 判要不要重跑抽取：可抽取型別、`parser_type` 非 none／null、且**真的有逐頁文字**（`metadata.page_count > 0`，或 legacy 列曾有 `requirement_extraction` 值）。不符 → 只寫 `classification_status: 'confirmed'`；若舊列還掛著「找到 N 項」的成功訊息，改成 `skipped` 並換成「已改為非抽取類型；先前抽取的建議仍保留於審查佇列」——資料（建議仍在佇列）與畫面要說同一件事。
3. 符合 → 重啟（`processing`／`extracting_requirements`／重設 `started_at`／清 `completed_at`／清 `error_message`）→ 走 §5 的接力層與心跳 → 收尾 `completed` 或 `partial`／`failed`。409 `run_conflict` 時只回 `inProgress: true`，**不寫收尾**。

防連點的鎖不在這支：同步 check-and-set 必須貼著事件處理器（W13 審查）。

## 10. 原始檔：私有 bucket 與不可變

- 路徑 `projects/{project}/contract-packages/{package}/{document}/{version}/{filename}`，**第 4 段是包 id**，storage 物件 policy 直接以它判 `can_read_contract_package`／`can_upload_contract_package`，物件存取與包可見性完全一致；bucket 私有、無公開 URL。
- `storagePathFor` 把檔名退化成 ASCII（Supabase 只收 S3 安全字元，政府文件幾乎都中文檔名——dry-run 第一份真實契約就炸在這裡）；顯示用原始檔名在 `document_versions.original_filename`；唯一性由路徑中的 document／version id 保證。
- `storage_path` 在版本 INSERT 時就決定（它是不可變版本身分的一部分）；同 checksum 重用既有版本時只重用 **`isValidStorageKey` 合法**的那筆——修復前寫入的中文壞路徑代表原始檔從未成功上傳，重用它等於永遠卡死在同一筆失敗紀錄（2026-08-12 實際發生）。
- 上傳撞 409 exists／duplicate 視為冪等成功；超過平台 Storage 上限的錯誤特判成指向真正解法的訊息（壓縮／拆分／調整 Supabase 設定），不沿用「重新上傳會自動接續」的通用指引。前端另有 `MAX_UPLOAD_BYTES`（300MB）預檢，**要與 Supabase Dashboard 的 upload file size limit 同步改**。
- 沒有 UPDATE／DELETE 物件 policy——原始檔一經上傳即凍結。唯一例外是 `20260822000300` 為 `delete_document` RPC 開的 DELETE policy，且只准清「不再被任何 `document_versions.storage_path` 引用」的孤兒檔；刪文件的順序是 RPC 先刪 DB 列、前端再清 storage。

## 11. 留痕

- `document.classified`：processing run 的 `suggested_document_type` 從 null 變有值時記一次（每檔一次，不逐階段記），metadata 只有 id 與型別、**不含檔名**。
- `document.classification_corrected`：`documents.document_type` 任何變動（AI 自動歸檔、人改分類都走這條）。
- `contract_package.created`／`processing_started`／`ready`（§2）。
- 這些事件在共用稽核流裡受 `can_read_audit_entity` 分級：實體仍存在就依包可見性，實體已刪則專案可讀。細節見 [`audit-events.md`](audit-events.md)。

## 12. 現查方式

```bash
node -e "import('./src/lib/packageUpload.js').then(m=>console.log(m.STAGE_ORDER, m.TERMINAL_RUN_STATUSES, m.PROCESSING_STALE_MS, m.MAX_UPLOAD_BYTES, m.UPLOAD_CONCURRENCY))"
node -e "import('./src/lib/documentClassifier.js').then(m=>console.log(m.CLASSIFIABLE_DOCUMENT_TYPES, m.EXTRACTABLE_DOCUMENT_TYPES, m.AUTO_ACCEPT_THRESHOLD))"
grep -n "check (" supabase/migrations/20260712000800_p0_07_5_contract_packages.sql | grep -i "status\|stage\|unsupported"   # run 的合法組合
npx vitest run src/lib/packageUpload.test.js src/lib/packageRuns.test.js src/lib/documentClassifier.test.js src/lib/packageFileSupport.test.js src/pages/web/Contract.flow.test.jsx
```

## 13. 測試釘住

| 測試 | 釘什麼 |
|---|---|
| `src/lib/packageUpload.test.js` | `takeSelectedFiles` 快照 live FileList；`summarizePackageProgress` 真實階段計數；`packageStatusFromRuns` 四種結果（含 09-08 的 partial／覆蓋缺漏→needs_attention、unsupported 不擋 ready、永不 failed）；`staleProcessingPatch` 只標過期的進行中列、心跳新鮮不算中斷、壞心跳退回 started_at；`runFileLanded`；storage key ASCII 退化與壞路徑不重用；`mapWithConcurrency` 併發上限與失敗隔離；`runPct` 由 `STAGE_ORDER` 推導；`summarizeUploadBatch` 面板帳 |
| `src/lib/packageRuns.test.js` | `canRerouteExtraction` 前提；`reclassifyProcessingRun` 每一次寫入的 payload 與順序（重啟→心跳→收尾）、非抽取型別的 skipped 改寫、409 不寫收尾、真失敗收尾 partial；`healStaleRuns` 只碰過期列、`shouldContinue` 停手、寫入失敗保留原列；`loadPackageRuns` 純讀、覆蓋警示只看最近 completed、超過 1,000 列讀齊、任一段失敗 throw |
| `src/lib/documentClassifier.test.js` | 檔名規則與信心、價目表永不歸契約、內文規則 needs_review、未知→other、不可分析只看檔名、只回既有型別；`shouldExtractRequirements` 只放行信任的義務型別；`presentationGroup` |
| `src/pages/web/Contract.flow.test.jsx` | 上傳完成更新履約資料並帶 `?package=`、載入失敗可重試不偽裝無文件、覆蓋不完整顯示「部分整理」不顯示已完成、機關檢視不顯示上傳鈕且零寫入、契約超過 1,000 筆仍選得到、切案後遲到回應不覆蓋 |
| pgTAP `p0_07_5_contract_packages.sql`（plan 37） | 三方包可見性矩陣、猜 UUID 改不了監造包的文件與頁、包／文件／run 的同專案與同包 trigger、unsupported 不得宣稱抽取完成（23514）、審查權限不受影響、刪案 cascade、`document_versions_select` 的 INSERT..RETURNING 根因回歸 |
| e2e `contract-flow.spec.js` | 三角色×兩寬度：文件頁→契約重點→回上傳的入口不斷鏈、廠商看不到監造義務、無水平溢位 |

## 14. 已知缺口與未查證

- `Contract.jsx` 的抽取（`b7a1000`）已落地：§7 的「只有能管理文件的人才修」現為頁面在 `canUploadDocs` 為真時才呼叫 `healStaleRuns`（現查 `grep -n "healStaleRuns" src/pages/web/Contract.jsx`），§8 的包狀態寫回時機不變；之後仍以現查為準。
- `contract_packages.status` 由前端推導寫回，修復與重試後不重算（§8）；轉成 `needs_attention` 不留痕（§2）。
- 處理 run 的狀態機只有 DB CHECK 守合法組合，沒有 trigger 守轉移順序——任何有上傳權的人都能把列改成任一合法組合（它是 UX 狀態，migration 明寫非權威）。pgTAP 只釘了 unsupported 那一條 CHECK，其餘組合未逐一釘住。
- 兩個過期時鐘（20 分鐘 processing、10 分鐘 ingestion）各管各的表（§7）。
- `_shared/documentTypes.ts` 與兩處 SQL CHECK 的值域一致性沒有測試釘住（§4.3，未查證是否有其他機制）。
- AI 分類只在「新文件且 needs_review」時觸發；既有文件的待確認列不會再問 AI，只能人改。
- `documentIngestion.js` 舊路徑不建 processing run、不留原始檔（§1），其抽取只能核對已儲存頁數。
- 無 OCR；圖片與掃描 PDF 只收件（[`traceable-document-ingestion.md`](traceable-document-ingestion.md) §5）。
- 09-08 兩批在本機通過 Vitest 與 build，未跑真後端 E2E、未部署。
