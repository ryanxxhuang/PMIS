# GovAgent／PMIS — 目前系統真相

> 狀態：**CURRENT（現況權威文件）**
> 最後核對：2026-08-12
> 用途：回答「產品現在是什麼、已經做到哪裡、哪份文件說了算」。

## 1. 一句話定義

> **GovAgent 的最終目標，是讓政府機關的每一位承辦人，都有一個懂其業務、法規與文書格式的 AI Agent。**

目前只做第一個垂直領域：**公共工程專案管理**。因此：

- **GovAgent**：長期產品與平台名稱。
- **PMIS**：目前公共工程垂直領域的專案名稱、程式庫名稱與既有介面名稱。
- **`gov-agent.ai`**：目前正式站網域。

在公共工程階段驗證完成前，不因長期願景而提早開發戶政、社福等其他領域，也不為假想需求建立外掛系統或 DSL。

## 2. 目前服務對象

PMIS 目前讓同一個公共工程專案中的三方安全協作：

| 專案角色 | 主要工作 | Agent 介面 |
|---|---|---|
| 施工廠商 | 現場填報、施工日誌、估驗、成本、品質與工安 | 廠商 Agent |
| 監造單位 | 查驗、送審審查、缺失複查、估驗覆核 | 監造 Agent |
| 主辦機關 | 跨案監督、契約期限、付款、驗收與勾稽稽核 | 機關 Agent |

平台管理員是產品營運角色，管理 AI 功能、方案、用量與成本，不是工程專案中的第四方。

系統授權只有廠商、監造、機關三種。現場、品管、工安是廠商內部的人員分工，不是角色；所有廠商成員都在同一個廠商權限邊界內，由廠商自行決定誰處理什麼工作。

## 3. 三層產品邊界

```text
介面層
└── 每個角色的 Agent 主控台與人工工作頁

公共工程領域層
├── PCCES 標單與工項
├── 施工日誌、估驗、請款、成本與排程
├── 品質、ITP、試驗、缺失與工安
└── 送審、RFI、變更設計、驗收與結算

GovAgent 平台層
├── 身分、多租戶與多級權限
├── 文件攝取、版本、來源定位與履約需求
├── 期限引擎、佐證鏈與不可竄改稽核
├── AI 草稿收件匣與人工覆核
└── AI 功能開關、方案、用量與成本
```

判斷原則：換成戶政業務仍成立的是平台層；換成戶政就沒有意義的是公共工程領域層。

## 4. 兩條資料脊椎

### 4.1 工程數量與財務脊椎

```text
PCCES XML
  → work_items
    → daily_logs / daily_log_items
      → valuations / valuation_items
        → 請款收款、S 曲線、估驗文件
    → cost_items / item_schedules / change_orders
    → inspections / checklists / photos / defects
```

所有數量、金額與進度都應沿 `work_item_id` 串接。金額與判定由確定性程式或資料庫 Trigger 計算，AI 不自行運算。

### 4.2 文件與履約要求脊椎

```text
contract_packages
  → documents
    → document_versions
      → document_pages
      → document_ingestion_runs / document_processing_runs
        → requirements
          → requirement_sources
          → requirement_work_items → work_items
          → requirement_artifact_links
```

只有 `status = 'approved'` 的 Requirement 才是權威要求。W5-2 已在本機工作樹反轉相容方向：人工核准的 deadline Requirement 會在同一審查交易中冪等建立／更新一筆 `contract_obligations` 提醒 runtime；obligation 只保留狀態、佐證、罰則與歷史，不反向改寫契約內容。正式站在 migration `20260812000500` 部署前仍是舊方向。

## 5. AI 的不可跨越邊界

1. AI 只能查詢、彙整與產生草稿，不能核定、判定、結案、驗收或凍結。
2. 數字由確定性引擎計算，AI 只能引用工具回傳值。
3. Agent 草稿與動作寫入 `agent_actions`，必須由人接受或拒絕。
4. 每個 AI 功能都要經伺服器端功能閘門，並記錄 `ai_usage_events`；閘門查詢失敗時 fail-closed（D-010），用量記帳失敗則絕不影響回應。
5. 正式狀態轉移由 RLS、資料庫 Guard Trigger 與人的操作共同保護。

## 6. 目前技術現況

截至 2026-08-12 的盤點：

- React 18、Vite 6、Tailwind CSS 4 的靜態 SPA。
- Supabase Postgres、Auth、RLS、Storage 與 Deno Edge Functions。
- Cloudflare Workers 靜態資產部署，正式站為 <https://gov-agent.ai>。
- 36 條 React 路由、33 個頁面檔、9 個 Store slices。
- 50 張 migration 建立的資料表、1 個權威 Requirement View。
- 16 個已註冊的 AI／整合功能與 16 個 Edge Functions（`assistant.chat` 已於 W3-3 停用，列與用量歷史保留）。
- 36 個 migrations；`supabase/migrations/` 是資料庫唯一真相。
- 57 個 Vitest 測試檔，共 522 個測試；12 個 Playwright 三角色 E2E；23 組 pgTAP SQL 測試。

最近一次全套驗證（W5-2～W5-4 本機實作，2026-08-12）：522 個單元測試、12 個 E2E、23 檔共 720 項 pgTAP 全數通過，正式建置與資料庫 lint 成功；從零重建會依序套用 W5-2 與 W5-3 migration，W5-4 沒有資料庫變更。W0～W4 已合併至 `main` 並部署；W5-2～W5-4 尚未 commit、開 PR 或部署，正式資料庫仍同步至 `20260812000400`。

標單重設與匯入自 W1 起走單一交易 RPC（`reset_project_boq`／`import_work_items`，migration `20260812000200`）：全成或全敗，權限沿用 `can_write`，證據 guard 擋下時整包 rollback 並留 `audit_events`；前端不再逐表刪除或分批寫入。

初始化自 W2 起只有一條路（D-007）：建案 → 專案文件一次上傳 → 三方成員 → 正式模式。Dashboard 對未開正式模式的真專案顯示四步初始化清單（狀態由既有資料推導）；`/agent` 不再因未匯標單整頁封鎖，僅提示工項類問題需先匯入；所有「無標單」空狀態統一指向專案文件。

AI 入口自 W3 起收斂為單一 Agent（D-008、D-010）：`/assistant` 導向 `/agent`，浮動 Copilot 是同一 Agent 的明示新對話入口；前端不再呼叫 `assistant.chat`，但功能列、Edge Function 與歷史用量保留。所有 AI 功能閘門查詢失敗時 fail-closed；403／503 錯誤會在 UI 如實顯示並可重試，不會偽裝成離線快答。

成員與正式模式自 W4 起採三方確認流程（D-009）：成員頁明確區分載入中、空名單、載入失敗與正常名單；邀請方必須指定廠商／監造／機關，伺服器會與受邀帳號的註冊身分比對，錯配即拒絕。開啟正式模式前會列出缺少哪一方並要求二次確認；三方未到齊仍可由專案建立者決定是否開啟。

W5-2 的正式庫變更前唯讀基線：65 筆 obligation、113 筆 Requirement，差額 48 筆全是未核定建議（24 筆 `draft_ai/ai`、23 筆 `needs_review/ai`、1 筆 `needs_review/manual`）；0 筆 orphan legacy，0 筆已核准 deadline 缺 obligation。65 筆 obligation 全為待辦、0 筆有佐證、21 筆有罰則，且 65 筆都有唯一 Requirement 連結。盤點只讀匿名數量，未匯出業務內容。

W5-3 已在本機把雙成員模型的防誤用規則固定：[`docs/architecture/three-party-role-model.md`](docs/architecture/three-party-role-model.md#成員模型的唯一判斷規則) 是唯一說明點；migration `20260812000600` 只替兩張表與 helper 加 schema comment，關鍵前端／提醒呼叫點也有短註解。沒有改名、刪表或變更 RLS；正式站要等 migration 部署後才有資料庫 metadata。

W5-4 只修正一條可重現的 Demo／DB 漂移：同一組 28 天試體判定不合格時，正式 DB 會在同一交易建立並以 `test_sample_id` 去重缺失，但 Demo 曾因 React state updater 時序漏開缺失，重試時又可能重複開。現在 Demo 以 `deriveTestSampleUpdate` 同步推導判定，並以 `shouldCreateTestSampleDefect` 保持一組試體一筆缺失；其他尚未發生漂移的雙引擎規則沒有重構。

### 6.1 前端資料存取規則

- 跨頁共享、需要同步更新的資料放 Store。
- `Contract`、`Requirements`、`Activity` 的資料只在各自頁面使用，因此保留有界的頁面查詢。
- 純計算與重複查詢才放 `src/lib` 或 `src/store/db.js`。
- 同一段查詢沒有重複前，不新增 repository、service 或額外 Store slice。

## 7. 已知架構債

以下是現況，不應在沒有測試保護下直接刪除：

1. **雙成員資料仍保留相近名稱**：W5-3 已用單一架構規則、schema comment 與高風險呼叫點註解降低誤用；為維持相容，未改表名、刪相容 helper 或動 RLS。
2. **雙引擎同步**：W5-4 已修正試體不合格缺失的漏開／重複開漂移；其餘 Demo／前端與伺服器 Trigger／Edge 規則仍有人工同步點，詳見 `docs/architecture/dual-engine-sync.md`。
3. **期限相容層仍存在**：W5-2 已把方向收斂為 approved deadline Requirement → obligation，但時間軸、提醒與部分 Agent 查詢仍讀 `contract_obligations`；它是有 rollback 的 runtime 相容層，不是第二份契約權威。正式站在 `20260812000500` 部署前仍跑舊 trigger。

## 8. 文件權威順序

遇到文件互相矛盾時，依下列順序判斷：

| 問題 | 權威來源 |
|---|---|
| 開發流程與完成定義 | `DEVELOPMENT.md` |
| 目前產品定位與現況 | `CURRENT.md` |
| 已定案產品／架構決策 | `docs/DECISIONS.md` 與對應 ACTIVE 架構文件 |
| 尚未核准的候選改動 | `docs/ROADMAP.md`；不得當成現況或實作授權 |
| 長期產品北極星 | `docs/北極星-政府機關-Agent-平台.md` |
| AI 協作入口 | `AGENTS.md`；細節仍以 `DEVELOPMENT.md` 為準 |
| 前端路由 | `src/App.jsx` |
| 導覽、分頁與前端路由角色限制 | `src/lib/navConfig.js` |
| 資料庫 Schema、RLS、RPC、Trigger | `supabase/migrations/` |
| AI 功能註冊 | DB `ai_features`；程式鏡像為 `src/lib/aiFeatures.js` 與 `supabase/functions/_shared/aiFeatures.ts` |
| 測試與建置基線 | 實際執行 `npm test`、`npm run test:e2e`、`npm run build` 與 `supabase/tests/` |

`SCOPE.md` 與 `PRD.md` 是歷史規劃快照；日期式驗收、UX、資安與簡報文件是當時證據，不是目前功能清單。

## 9. 已定案的角色與成員責任

2026-08-12 已定案：

- `profiles.org_type` 是廠商／監造／機關三方業務角色與 Agent 身分來源。
- `project_members` 只管能否進入專案及專案 admin。
- `project_parties` 與 `project_memberships` 只管文件歸屬、契約方與稽核身分。
- `project_memberships.project_role` 是歷史相容／描述欄位，不作授權、Agent 或提醒分流。
- 廠商 Agent 同時支援現場與品管工作；不再建立 `field/qc` 系統角色。

完整決策見 [`docs/architecture/three-party-role-model.md`](docs/architecture/three-party-role-model.md)。頁面直接查詢與 Store 的責任已依 §6.1 定案，不再為形式一致搬動資料。
