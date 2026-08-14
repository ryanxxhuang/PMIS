# GovAgent／PMIS — 目前系統真相

> 狀態：**CURRENT（現況權威文件）**
> 最後核對：2026-08-15
> 用途：回答「產品現在是什麼、已經做到哪裡、哪份文件說了算」。

## 1. 一句話定義

> **GovAgent 的最終目標，是讓政府機關的每一位承辦人，都有一個懂其業務、法規與文書格式的 AI Agent。**

目前只做第一個垂直領域：**公共工程專案管理**。因此：

- **GovAgent**：長期產品與平台名稱。
- **PMIS**：目前公共工程垂直領域的 repo／工程專案代稱；介面主品牌已在 W8-1 統一為 `GovAgent｜公共工程`。
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

只有 `status = 'approved'` 的 Requirement 才是權威要求。W5-2 已由 PR #6 部署：人工核准的 deadline Requirement 會在同一審查交易中冪等建立／更新一筆 `contract_obligations` 提醒 runtime；obligation 只保留狀態、佐證、罰則與歷史，不反向改寫契約內容。已核准期限被人工取代時，只把仍在待辦的相容提醒標成「不適用」並退出現行清單，原列與佐證／歷史仍保留。

## 5. AI 的不可跨越邊界

1. AI 只能查詢、彙整與產生草稿，不能核定、判定、結案、驗收或凍結。
2. 數字由確定性引擎計算，AI 只能引用工具回傳值。
3. Agent 草稿與動作寫入 `agent_actions`，必須由人接受或拒絕。
4. 每個 AI 功能都要經伺服器端功能閘門，並記錄 `ai_usage_events`；閘門查詢失敗時 fail-closed（D-010），用量記帳失敗則絕不影響回應。
5. 正式狀態轉移由 RLS、資料庫 Guard Trigger 與人的操作共同保護。

## 6. 目前技術現況

截至 2026-08-14 的盤點：

- React 18、Vite 6、Tailwind CSS 4 的靜態 SPA。
- Supabase Postgres、Auth、RLS、Storage 與 Deno Edge Functions。
- Cloudflare Workers 靜態資產部署，正式站為 <https://gov-agent.ai>。
- 36 條 React 路由、33 個頁面檔、9 個 Store slices。
- 50 張 migration 建立的資料表、1 個權威 Requirement View。
- 16 個已註冊的 AI／整合功能與 16 個 Edge Functions（`assistant.chat` 已於 W3-3 停用，列與用量歷史保留）。
- 36 個 migrations；`supabase/migrations/` 是資料庫唯一真相。
- 60 個 Vitest 測試檔，共 587 個測試；19 個 Playwright Demo 三角色／路由 E2E；5 條手動真 Supabase E2E（auth 冒煙＋四條業務鏈）；23 組 pgTAP SQL 測試（自 2026-08-13 起由獨立 CI workflow 在資料庫相關變更的 push/PR 自動全套執行）。

最近一次全套驗證（W7 PR #9，2026-08-13）：530 個單元測試、14 個 Demo E2E、5 個真 Supabase E2E 與 production build 全數通過。PR #8 已讓 23 檔 pgTAP 自動進 CI；其 main run 與一般 CI 均成功。W0～W5、W6 PR #7、pgTAP CI PR #8 與 W7 PR #9 已合併部署；PR #9 的 main CI 與 Cloudflare Workers build 成功，正式站首頁、`/requirements`、`/security` 與 `/site-log/print` 均回 HTTP 200。正式資料庫維持 `20260812000600`，W7 沒有資料庫變更。

標單重設與匯入自 W1 起走單一交易 RPC（`reset_project_boq`／`import_work_items`，migration `20260812000200`）：全成或全敗，權限沿用 `can_write`，證據 guard 擋下時整包 rollback 並留 `audit_events`；前端不再逐表刪除或分批寫入。

初始化自 W2 起只有一條路（D-007）：建案 → 專案文件一次上傳 → 三方成員 → 正式模式。Dashboard 對未開正式模式的真專案顯示四步初始化清單（狀態由既有資料推導）；`/agent` 不再因未匯標單整頁封鎖，僅提示工項類問題需先匯入；所有「無標單」空狀態統一指向專案文件。

AI 入口自 W3 起收斂為單一 Agent（D-008、D-010）：`/assistant` 導向 `/agent`，浮動 Copilot 是同一 Agent 的明示新對話入口；前端不再呼叫 `assistant.chat`，但功能列、Edge Function 與歷史用量保留。所有 AI 功能閘門查詢失敗時 fail-closed；403／503 錯誤會在 UI 如實顯示並可重試，不會偽裝成離線快答。

成員與正式模式自 W4 起採三方確認流程（D-009）：成員頁明確區分載入中、空名單、載入失敗與正常名單；邀請方必須指定廠商／監造／機關，伺服器會與受邀帳號的註冊身分比對，錯配即拒絕。開啟正式模式前會列出缺少哪一方並要求二次確認；三方未到齊仍可由專案建立者決定是否開啟。

W5-2 的正式庫變更前唯讀基線：65 筆 obligation、113 筆 Requirement，差額 48 筆全是未核定建議（24 筆 `draft_ai/ai`、23 筆 `needs_review/ai`、1 筆 `needs_review/manual`）；0 筆 orphan legacy，0 筆已核准 deadline 缺 obligation。65 筆 obligation 全為待辦、0 筆有佐證、21 筆有罰則，且 65 筆都有唯一 Requirement 連結。盤點只讀匿名數量，未匯出業務內容。

W5-3 已把雙成員模型的防誤用規則固定：[`docs/architecture/three-party-role-model.md`](docs/architecture/three-party-role-model.md#成員模型的唯一判斷規則) 是唯一說明點；已部署的 migration `20260812000600` 只替兩張表與 helper 加 schema comment，關鍵前端／提醒呼叫點也有短註解。沒有改名、刪表或變更 RLS。

W5-4 只修正一條可重現的 Demo／DB 漂移：同一組 28 天試體判定不合格時，正式 DB 會在同一交易建立並以 `test_sample_id` 去重缺失，但 Demo 曾因 React state updater 時序漏開缺失，重試時又可能重複開。現在 Demo 以 `deriveTestSampleUpdate` 同步推導判定，並以 `shouldCreateTestSampleDefect` 保持一組試體一筆缺失；其他尚未發生漂移的雙引擎規則沒有重構。

W6 PR #7 已合併並部署，5 條本機真後端測試於 2026-08-13 重跑全綠：`npm run test:e2e:real`（環境變數注入、拒絕正式 Supabase、不進預設 CI）對一次性本機 staging 跑 auth 冒煙、鏈 1 初始化（含邀請錯配拒絕與正式模式）、鏈 2 估驗三方簽核與請款收款、鏈 3 文件上傳＋綁定真文件版本的人工待審 Requirement→核定→D-012 義務物化、鏈 4 匯入/重設 rollback（含 UI 錯誤橫幅與「日誌不半刪」）。fixture 走產品窄門 RPC，清理含 Storage 物件，跑後殘留 0。

但 W6 尚未完整收官：鏈 3 目前仍以人工 fixture 代替 live AI 輸出，沒有驗證 `extract-requirements` 成功寫入 ingestion run、AI-origin Requirement 與 citation。2026-08-13 手動重驗已能由未追蹤環境檔注入金鑰，但 Supabase CLI 2.113.0 的本機 Edge main worker 在模型呼叫前即發生 entrypoint boot error；待 CLI 修復或一次性 hosted staging 再完成，不代表產品或金鑰驗證失敗。細節見 `docs/REAL_BACKEND_E2E.md`。

W7 已由 PR #9 部署並依 D-013 收口前端路由：`src/lib/navConfig.js` 的 `routeRegistry` 明確登記全部 36 條 App 路由，未登記業務路由 fail-closed；登入、公開、重新導向、列印與 404 各自標註。`src/App.jsx` 由這份路由表統一決定共同守衛與版面，四條列印路由現在也會先驗證登入與專案狀態，但仍保留無工作台外框的列印版面。既有三方頁面權限、導覽、RLS 與資料庫均未改動。

W8-1 由 PR #11 完成：主品牌統一為 `GovAgent｜公共工程`；側欄固定為今日待辦、現場與品質、審查與協作、進度與金流、文件與結案、專案六個工作面；`問 GovAgent` 是頁首全域入口；機關仍落在跨案總覽。36 條路由與原角色限制不變。2026-08-14 使用者核准 W8-0 第三版後，W8-1R 由 PR #14 完成並部署：桌面側欄預設常駐展開、可收合成圖示列並記住同一瀏覽器偏好；工作面的子頁選單預設收合，包含目前所在工作面也可自由展開與再次收合；手機抽屜使用同一階層；內容區原 `WorkbenchTabs` 與手機子頁下拉已移除。側欄視覺採 Codex 式安靜層級：工作面用圖示與較強文字，子頁縮排；目前頁與 hover 使用完整中性圓角底，不再使用藍色左線與子頁分隔線。`navConfig.js` 仍是導覽與路由守衛的單一真相來源，36 條路由、角色限制、RLS、資料庫與業務頁均未改。

W8-2 由 PR #12 交付：今日待辦的聚合收斂為單一純函式 [`src/lib/todayTasks.js`](src/lib/todayTasks.js)，`/dashboard` 與 `/alerts` 吃同一份，`/agent` 不再重複待辦清單（只留無件數的「前往今日待辦」連結）。`/dashboard` 改為「現在輪到我／等待對方／今天已完成」三段，每段最多 5 筆、溢位連 `/alerts`；統計帶、球權統計與未結案缺失卡移除，AI 主動觀察降為一行風險摘要。待辦一律由既有業務狀態推導：協作項沿用 `ballInCourt.js`（新增共用的 `collaborationItems()`），期限型沿用 `contractDue`／`qc`／`acceptance`／`itp` 既有引擎，`Alerts.jsx` 內嵌的第二套規則已刪除。

W8-2 的三條硬規則寫在函式與測試裡：AI 草稿與未核定 Requirement 不是 `buildTodayTasks` 的輸入，結構上進不了待辦；契約義務只接受 `廠商／監造／機關` 三個精確 `responsible` 值，且只有廠商責任者列為待辦（`/contract` 的完成鈕吃 `can.edit`，監造／機關按不到，不製造做不到的假待辦）；「今天已完成」只採可靠操作時間戳 `defects.closed_at` 與 `inspections.inspected_at`（依 `Asia/Taipei` 判日），可回填的業務日期與沒有完成時間欄位的估驗核定／變更核准一律不列。驗收階段的角色白名單移到 [`src/lib/acceptance.js`](src/lib/acceptance.js) 的 `ACCEPTANCE_STAGE_ORGS`，驗收頁與待辦聚合共用。

W8-2 未動路由數、頁面權限、RLS、資料庫與 Edge Function。同批修正三個既有缺陷：估驗「待廠商請款」導向改為 `/payments`（請款日欄位在該頁）、`recordInspectionResult` 的 demo 分支補寫 `inspected_at`（原本只有 DB 分支寫，造成雙引擎漂移）、`computeObligationDue` 新增可注入的 `today`（每月重複義務不再讀系統時鐘）；期限判斷一律先正規化為台北日曆日午夜，避免傍晚開頁時第 8 天被誤列進「7 日內」。本機基線為 563 Vitest、19 Demo E2E 與 production build 全綠。初始化第 3 步語意與契約重點改版仍屬 W8-3，不得寫成已完成。

W8-3A 由 PR #13 交付：未開正式模式的真專案仍保留一張四步初始化卡片；每步顯示責任方、完成狀態與單一目的地，卡片另顯示完成數與唯一下一步。第 3 步只以本案是否存在 `status = 'completed'` 的 `document_ingestion_runs` 判定 AI 是否整理完成，不再讀 Requirement 待審／核定數；即使仍有 106 筆待審或擷取結果為 0 筆也算完成。完成但 0 筆時 `/requirements` 會顯示「沒有找到建議」的有效空結果，不會把使用者導回重新上傳；人工核定只決定內容是否成為契約規則，不是開啟正式模式的門檻。第 4 步維持可由專案建立者直接前往 `/members` 開啟，前三步或三方未齊只提供提醒，不會鎖住按鈕。

W8-3A 驗證（2026-08-14）：60 個 Vitest 檔、583 個測試與 19 個 Demo E2E 全綠，production build 與 PR CI 成功，`git diff --check` clean；沒有變更路由、角色、RLS、資料庫、migration、Edge Function 或 Store slice。另以既有 staging 測試帳號建立未開正式模式的真實專案，完成 Dashboard 初始化卡片桌面與 375px 目視，以及 `/contract`、`/requirements`、`/members` 三個銜接頁的 375px 無水平溢位驗收；臨時專案已刪除。

W8-1R 驗證（2026-08-14）：60 個 Vitest 檔、576 個測試與 19 個 Demo E2E 全綠，production build 成功，`git diff --check` clean。測試數由 main 的 583 降為 576，是因移除 7 個只驗證已刪除 `workbenchFor()`／`WorkbenchTabs` 的過時測試；桌面側欄展開／收合／偏好保留、工作面子頁預設收合且目前工作面也可再次收合，以及 375px 同源抽屜均由 `e2e/routes.spec.js` 驗證。PR #14 的 main CI 與 Cloudflare Workers build 成功，正式站 bundle 已確認包含 `pmis-sidebar-collapsed` 與側欄展開／收合程式碼。

W8-3B 由 PR #15 交付並部署：`/requirements` 一般畫面改為「已生效的契約重點」、最多 6 筆「值得留意的整理結果」與可收合完整追溯；舊 run 的 approved 在 300 筆有界查詢內仍保留，舊 run 未核定 AI 建議只在追溯區顯示。預設去重只合併呈現內容完全相同的列，不改 DB；只有可追蹤 deadline 能透過原 `review_requirement` 捷徑「核定並加入期限追蹤」並由 D-012 物化 obligation，其他類型不假裝建立尚不存在的工作流。收合追溯時同時關閉歷史詳情，rejected／superseded 不殘留在一般畫面。側欄分頁標籤同步改為「契約重點」。手機磨光依規格 §11 完成：375px 動作鈕與六個追溯篩選至少 44px（`max-sm:min-h-11`，桌面與共用 `ui.jsx` 不動）、廠商唯一查看動作補中性邊框、無核定權提示改淡底提示列。587 Vitest、19 Demo E2E、production build 全綠；main CI 與 Cloudflare Workers build 成功，正式站冒煙 200。**真案三角色桌面／375px 實機目視尚未執行**（無可用帳號），不得寫成已完成，列為 W8-5 前待補。

### 6.1 前端資料存取規則

- 跨頁共享、需要同步更新的資料放 Store。
- `Contract`、`Requirements`、`Activity` 的資料只在各自頁面使用，因此保留有界的頁面查詢。
- 純計算與重複查詢才放 `src/lib` 或 `src/store/db.js`。
- 同一段查詢沒有重複前，不新增 repository、service 或額外 Store slice。

## 7. 已知架構債

以下是現況，不應在沒有測試保護下直接刪除：

1. **雙成員資料仍保留相近名稱**：W5-3 已用單一架構規則、schema comment 與高風險呼叫點註解降低誤用；為維持相容，未改表名、刪相容 helper 或動 RLS。
2. **雙引擎同步**：W5-4 已修正試體不合格缺失的漏開／重複開漂移；其餘 Demo／前端與伺服器 Trigger／Edge 規則仍有人工同步點，詳見 `docs/architecture/dual-engine-sync.md`。
3. **期限相容層仍存在**：W5-2 已把方向收斂為 approved deadline Requirement → obligation，但時間軸、提醒與部分 Agent 查詢仍讀 `contract_obligations`；它是有 rollback 的 runtime 相容層，不是第二份契約權威。正式站已套用 `20260812000500`，舊的 obligation → Requirement triggers 已退役。

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
| 前端頁面與元件對應 | `src/App.jsx` |
| 路由登記、導覽、分頁與前端角色限制 | `src/lib/navConfig.js` 的 `routeRegistry`／`navGroups` |
| 今日待辦的三段聚合、球權與完成條件 | `src/lib/todayTasks.js`（Dashboard 與 `/alerts` 共用；協作項球權仍在 `src/lib/ballInCourt.js`） |
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
