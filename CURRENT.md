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

只有 `status = 'approved'` 的 Requirement 才是權威要求。`contract_obligations` 是目前提醒與期限流程仍在使用的相容層，現行 migration 會把它同步成待審 Requirement；這是既有行為，不代表已核定。

## 5. AI 的不可跨越邊界

1. AI 只能查詢、彙整與產生草稿，不能核定、判定、結案、驗收或凍結。
2. 數字由確定性引擎計算，AI 只能引用工具回傳值。
3. Agent 草稿與動作寫入 `agent_actions`，必須由人接受或拒絕。
4. 每個 AI 功能都要經伺服器端功能閘門，並記錄 `ai_usage_events`。
5. 正式狀態轉移由 RLS、資料庫 Guard Trigger 與人的操作共同保護。

## 6. 目前技術現況

截至 2026-08-12 的盤點：

- React 18、Vite 6、Tailwind CSS 4 的靜態 SPA。
- Supabase Postgres、Auth、RLS、Storage 與 Deno Edge Functions。
- Cloudflare Workers 靜態資產部署，正式站為 <https://gov-agent.ai>。
- 36 條 React 路由、34 個頁面檔、9 個 Store slices。
- 50 張 migration 建立的資料表、1 個權威 Requirement View。
- 16 個已註冊的 AI／整合功能與 16 個 Edge Functions。
- 32 個 migrations；`supabase/migrations/` 是資料庫唯一真相。
- 54 個 Vitest 測試檔，共 499 個測試；12 個 Playwright 三角色 E2E；21 組 pgTAP SQL 測試。

已於 W1（標單資料安全，2026-08-12）確認：499 個單元測試通過、12 個 E2E 通過、正式建置成功；全套 pgTAP 於本機 `db reset` 後重跑，21 檔共 684 項全數通過。

標單重設與匯入自 W1 起走單一交易 RPC（`reset_project_boq`／`import_work_items`，migration `20260812000200`）：全成或全敗，權限沿用 `can_write`，證據 guard 擋下時整包 rollback 並留 `audit_events`；前端不再逐表刪除或分批寫入。

### 6.1 前端資料存取規則

- 跨頁共享、需要同步更新的資料放 Store。
- `Contract`、`Requirements`、`Activity` 的資料只在各自頁面使用，因此保留有界的頁面查詢。
- 純計算與重複查詢才放 `src/lib` 或 `src/store/db.js`。
- 同一段查詢沒有重複前，不新增 repository、service 或額外 Store slice。

## 7. 已知架構債

以下是現況，不應在沒有測試保護下直接刪除：

1. **雙成員資料仍待命名收斂**：責任已定案——`project_members` 管專案存取／admin，`project_memberships` 管文件與契約方身分；但舊欄位名稱與相容 RPC 仍容易讓人誤用。
2. **雙引擎同步**：Demo／前端確定性判定與伺服器 Trigger／Edge 規則有多組人工同步點。
3. **舊相容層**：`contract_obligations` 與 `requirements` 目前仍有同步關係；要不要解耦尚未定案，不得只改其中一邊。

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
