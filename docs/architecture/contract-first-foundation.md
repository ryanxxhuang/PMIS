# 契約與標單資料模型

> CURRENT｜2026-09-11。描述本分支實作；部署狀態只見 [CURRENT](../../CURRENT.md#63-正式環境最後核對不是即時狀態)。

## 兩條資料鏈

```text
PCCES → work_items → 日誌數量 → 估驗 → 請款／付款／進度
契約包 → documents → document_versions → document_pages → ingestion run
                                                   ↓
requirements → requirement_sources
             → requirement_work_items → work_items
             → contract_obligations（履約 runtime）
```

`requirements.status = 'approved'` 是契約要求唯一權威；`is_authoritative` 為生成欄位。來源 `ai/manual/migration`、審查時間與履約完成狀態都不能單獨賦予權威。

## 不變條件

- `documents` 是邏輯文件；版本是確切原檔身分，替換檔案建立新版本。版本的路徑、檔名、MIME、大小、checksum、上傳人／時間不得由使用者改寫；`supersedes_version_id` 只能指同文件。
- `document_pages` 在同版本內頁序正整數且唯一。Requirement、文件與工項的專案身分不可變；來源與工項橋接都有同案檢查。
- `requirement_sources.source_kind` 區分 document／manual／legacy；document 必須指真實版本，其他來源可無版本。不得為舊頁碼虛造原檔或已驗證引註。算法見 [來源驗證](traceable-document-ingestion.md)。
- `requirement_work_items` 是多對多橋接，`review_status` 是 suggested／approved／rejected 的權威欄位，舊 `reviewed` boolean 由 trigger 同步推導。不是新增一條標單資料來源。
- 三方與契約方快照已實作，見 [身分模型](three-party-role-model.md)。Requirement 的責任標籤不是授權角色。

## 單向履約 runtime

D-012 移除了 obligation → Requirement 的同步／刪除 trigger。D-019 自動確認 AI 轉錄；D-020 將所有已確認類型冪等物化一列 obligation。更新契約欄位時保留 runtime 身分、執行狀態、佐證、罰則與歷史；廢止取代只讓仍待辦的 runtime 變成「不適用」。無時點項目沒有到期日，也不產生到期提醒。

循環義務（`recurring` 非空）的執行狀態自 P5b（`20260917233000`）起在 `obligation_periods` 逐期記錄：義務列插入／規則變更時由 trigger 依規則＋基準日確定性物化期次，廢止取代把仍待辦的期次一併標不適用；義務列本身不可再標已提送／已完成。見 [球權與今日工作](ball-in-court.md)、[瘦身入口與退場](slimming-entrypoints-and-retirement.md) §4.2。

專案四個基準日（決標／接獲開工通知／開工／竣工）自 P5c（`20260919021500`）起每次變更留一版 `project_anchor_versions`（append-only；類別、依據函文／變更案、生效日、受影響事項），期次蓋產生時的版本、單次義務完成時留到期日快照——基準日更正只重算未完成的，不改歷史；循環期次只產生到實際竣工日（驗收事件）或契約竣工日為止。見同一份 §4.3。

`legacy_contract_obligation_id` 是歷史來源識別，刻意沒有反向 FK，避免循環依賴。現行期限頁、提醒、Agent 與 Demo 都還讀 obligation，因此不能刪表。`parse-contract` 沒有前端呼叫者；退場功能列保留供歷史用量對帳，Edge 原始碼已於 P6b 移除（要回復須連原始碼一起還原）；功能關閉 migration 與線上函式狀態見 CURRENT。

## 程式與驗證入口

[單向 adapter migration](../../supabase/migrations/20260812000500_requirement_obligation_one_way.sql)、[全部類型物化](../../supabase/migrations/20260901040000_materialize_all_requirement_types.sql)；確認流程見 [審核邊界](requirement-review-boundary.md)。

pgTAP：[資料模型](../../supabase/tests/p0_01_requirement_domain.sql)、[單向 runtime](../../supabase/tests/requirement_obligation_one_way.sql)、[契約分級](../../supabase/tests/contract_grading_completion.sql)。
