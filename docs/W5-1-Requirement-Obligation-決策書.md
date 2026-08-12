# W5-1｜Requirement／Obligation 決策書

> 狀態：**ACCEPTED（2026-08-12，使用者選 A）**
> 盤點日：2026-08-12
> 範圍：唯讀盤點；未修改程式、migration 或正式資料。

## 結論

W5-1 盤點時不是單純有兩張表，而是**建築契約包在 obligation 尚為空時，同一批契約文件會跑兩次 AI 抽取**：新管線直接產生 `requirements`，舊管線另產生 `contract_obligations`，再由 DB trigger 鏡像出另一筆 `requirements`。兩套結果的標題與拆分方式可能不同，無法靠 UUID 自動判斷哪兩筆是同一件事。

**已定案選 A：只保留一次 Requirement 抽取；人工核定的 deadline Requirement 再單向產生／更新 obligation。** 這符合現行「只有 approved Requirement 才是契約權威」的規則，也能真正移除重複 AI 成本與隱性雙寫。

本文件完成方向定案；W5-2 已於同日完成本機實作與驗證，尚未 commit、開 PR 或部署。範圍與收包狀態以 `docs/ROADMAP.md` 為準。

## 正式庫快照

資料來源是 `supabase inspect db table-stats --linked` 的唯讀 PostgreSQL 統計；它回傳 `estimated_row_count`，不是匯出資料後的精確 `count(*)`。完整資料匯出因會複製業務內容而未執行。

| 正式表 | 估計筆數 | 解讀 |
|---|---:|---|
| `contract_obligations` | 65 | 目前仍供期限、提醒與執行狀態使用 |
| `requirements` | 113 | 包含 legacy 鏡像、文件 AI 建議、人工或已保留審查快照 |
| 差額 | 約 48 | 不是現存 obligation 的一對一根；組成需在 W5-2 變更前做精確唯讀 preflight |
| `requirement_sources` | 112 | 文件來源與 legacy 來源合計 |
| `documents`／`document_ingestion_runs` | 2／2 | 正式庫已有新文件抽取管線資料，不可當空庫處理 |

正式 migration 已對齊至 `20260812000400`。以現行 constraint／trigger 可直接確認：

- 每筆現存 obligation 都必須有 `requirement_id`，且 FK 指向 Requirement；正常寫入不會留下「obligation 有、Requirement 無」。
- obligation 的 `requirement_id` 與 Requirement 的 `legacy_contract_obligation_id` 都有唯一索引；正常寫入不會產生一對多鏡像。
- obligation 刪除時只會刪除 `draft_ai`／`needs_review` 鏡像；`approved`／`rejected`／`superseded` Requirement 會刻意保留，所以約 48 筆差額不能直接視為垃圾。
- Requirement 一旦完成審查便是不可變快照；之後修改 obligation 時，trigger 不再覆寫該 Requirement。這是保護機制，也是兩邊內容可能分歧的來源。

### W5-2 精確唯讀 preflight

2026-08-12 以已連結專案的 Supabase 官方唯讀 query 執行 `count(*)`；只回傳分組數量，沒有讀取或匯出專案 id、標題、條款、文件內容。

| 分類 | 精確筆數 |
|---|---:|
| obligations／requirements／差額 | 65／113／48 |
| 差額：`draft_ai + ai` | 24 |
| 差額：`needs_review + ai` | 23 |
| 差額：`needs_review + manual` | 1 |
| 差額中的 deadline | 3（1 draft、2 needs_review、0 approved） |
| orphan legacy Requirement | 0 |
| approved deadline 缺 obligation | 0 |

obligation runtime 保留基線：65 筆全為待辦、0 筆掛佐證、21 筆有罰則、0 筆有 note，65 筆都有唯一 `requirement_id` 連結。精確結果證明不需要猜配對、刪歷史或自動核定；migration 可沿用原 65 列並只反轉同步方向。

## W5-1 實作前的寫入與使用點（歷史快照）

| 路徑 | 寫入 | W5-1 時效果 |
|---|---|---|
| [`packageUpload.js`](../src/lib/packageUpload.js) → `extract-requirements` | `requirements`、sources、工項連結 | 新文件管線；產生待審建議 |
| [`Contract.jsx`](../src/pages/web/Contract.jsx) → `parseContractFromText` | 呼叫舊期限解析 | 同一批契約文字又跑一次 AI；只有 obligation 為空時自動執行 |
| [`ledger.js`](../src/store/slices/ledger.js) | insert/delete/update `contract_obligations` | 重建期限清單、更新已提送／完成狀態 |
| [`20260712000300_p0_01_requirement_domain.sql`](../supabase/migrations/20260712000300_p0_01_requirement_domain.sql) | obligation → Requirement trigger | 每次 obligation insert/update 都嘗試鏡像待審 Requirement |
| [`Requirements.jsx`](../src/pages/web/Requirements.jsx) → `review_requirement` | 只改 `requirements` | 審查與內容編輯不會反向更新 obligation |

W5-1 因此判定兩邊都不能直接刪：

- `contract_obligations` 仍供契約時間軸、提醒中心、Dashboard／風險稽核、Agent 期限查詢與「球在誰手上」使用；`status`、`evidence_submittal_id` 是執行狀態。
- `requirements` 是人工審查後的權威契約要求，供需求審查、送審／RFI AI 依據、Agent 的 approved requirement 查詢使用。

## 方案比較（A 已定案）

| | A｜單向產生（**建議**） | B｜完全解耦 |
|---|---|---|
| 權威來源 | `requirements` 唯一權威 | 兩表各自負責，彼此不保證一致 |
| 新文件 | 只跑 `extract-requirements` 一次 | 若保留現有體驗，仍跑兩次 AI |
| deadline 流程 | Requirement 經人工 `approved` 後，才產生／更新 obligation | obligation 由舊 parser 或人工獨立維護 |
| 舊資料 | 保留 65 筆 obligation 的執行狀態與佐證；先分類約 48 筆差額 | 保留全部資料，但使用者仍會看到兩套不同清單 |
| 初次改動 | 中：要反轉同步方向並補 migration／pgTAP | 小至中：移除同步較快，但需明確切開 UI 與責任 |
| 長期成本 | 低：一份契約事實、一次 AI 抽取 | 高：雙 parser、雙審查語意、差異需長期人工解釋 |
| 主要風險 | 轉換時必須保住 obligation 的 `status`／佐證 | 產品的「亂」會從隱性同步變成顯性不一致 |

## W5-2 的硬邊界（A，已由本機實作遵守）

W5-2 先以正式庫唯讀 `count(*)` 精確分類差額，再停止新文件的 legacy 二次解析，將「核定 deadline」接到 obligation 相容 runtime；既有 `status`、佐證與歷史 Requirement 不刪。

不得直接刪表、批次刪資料或把待審 AI 建議自動升為權威；rollback 與 pgTAP 必須在實作 PR 內一併提供。
