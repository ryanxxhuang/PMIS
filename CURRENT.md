# GovAgent／PMIS — 目前系統真相

> 狀態：**CURRENT（現況權威文件）**
> 最後核對：2026-09-11（分支 `refactor/product-wide` @ `b68bece`；`main` 最後合併的是 PR #62，正式站 `app.gov-agent.ai` 跑的仍是那一版。分支上三批工作——09-08 契約兩批、09-11 Apple UIUX 四包、全案重構 19 個 commit——**已提交、未合併 `main`、未部署**；正式庫 migration tracker 與 Edge Function 線上版本未重核，§6.3 保留最後一次核對紀錄）
> 用途：回答「產品現在是什麼、已經做到哪裡、哪份文件說了算」。本檔是**現況快照**：逐包交付敘述與續接排程在 [`docs/ROADMAP.md`](docs/ROADMAP.md)，測試與規模數字在 [`docs/BASELINE.md`](docs/BASELINE.md)，決策在 [`docs/DECISIONS.md`](docs/DECISIONS.md)；本檔不再累積日期式補記，現況改變就改對應小節。

## 1. 一句話定義

> **GovAgent 的最終目標，是讓政府機關的每一位承辦人，都有一個懂其業務、法規與文書格式的 AI Agent。**

目前只做第一個垂直領域：**公共工程專案管理**。因此：

- **GovAgent**：長期產品與平台名稱。
- **PMIS**：目前公共工程垂直領域的 repo／工程專案代稱。介面品牌字樣在 W8-1 統一為 `GovAgent｜公共工程`，2026-08-19 曾依使用者決定改為 `PM·IS`／「問 PMIS」（PR #24），2026-08-25 又改回 GovAgent（commit `4f5c084`，隨 PR #52 合併）；目前頁首、登入頁與 `index.html` 均為 GovAgent，「問 GovAgent」是全域入口。
- **`app.gov-agent.ai`**：App 正式站（Cloudflare Workers）。apex **`gov-agent.ai`** 自 2026-08-25 起由 `PMIS.marketing` repo 的行銷站（GitHub Pages）承接，App 路由在 apex 會回 404；行銷站的「開始使用」連到 `app.` 子網域。

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

只有 `status = 'approved'` 的 Requirement 才是權威要求。D-019 起，已完成抽取的 AI-origin 項目由伺服器自動確認（含帶 `triage_doubts` 的項目），人工補登仍走人工確認；D-020 起，所有已確認類型都冪等建立／更新一筆 `contract_obligations` runtime。obligation 保留執行狀態、佐證、罰則與歷史，不反向改寫契約內容。已確認要求被人工取代時，只把仍待辦的相容提醒標成「不適用」，保留原列與歷史。W5-2 的「人工核准 deadline-only」是此流程的歷史起點，已由上述決策擴充。

## 5. AI 的不可跨越邊界

1. AI 不能代替人執行業務核定、判定、結案、驗收或凍結。契約轉錄另有 D-019 的已接受例外：AI-origin 整理內容由伺服器全自動確認歸檔，即使帶核對疑慮也會進履約 runtime；必須保留疑慮並揭露原文優先，不能把自動確認等同核對無誤。
2. 數字由確定性引擎計算，AI 只能引用工具回傳值。
3. Agent 草稿與動作寫入 `agent_actions`，必須由人接受或拒絕。
4. 每個 AI 功能都要經伺服器端功能閘門，並記錄 `ai_usage_events`；閘門查詢失敗時 fail-closed（D-010），用量記帳失敗則絕不影響回應。
5. 正式狀態轉移由 RLS、資料庫 Guard Trigger 與人的操作共同保護。

## 6. 目前技術現況（快照）

截至 2026-09-11（分支 `refactor/product-wide` @ `b68bece`）。**數字一律以 [`docs/BASELINE.md`](docs/BASELINE.md) 為準**（手動核對快照，含指令）；路由、頁面、功能數以程式為準，本節只給現查入口，不抄表。逐包的「為什麼／改了什麼／驗證」在 `docs/ROADMAP.md` 的交付紀錄，這裡只寫「現在怎麼運作」。

### 6.1 堆疊、部署與表面

- React 18、Vite 6、Tailwind CSS 4 靜態 SPA；Sentry 錯誤回報（`src/lib/sentry.js`，DSN 走環境變數）。UIUX 自 D-021 起為 Apple style：色票／字級／材質走 `src/index.css` token、圖示 `lucide-react`、單一真相 [`docs/UIUX-Apple-設計規範.md`](docs/UIUX-Apple-設計規範.md)；列印頁的紙面配色集中在 `index.css` 的 `.paper` 區塊與共用 `PrintToolbar`（`b4d495f`）。
- Supabase Postgres、Auth、RLS、Storage 與 Deno Edge Functions；`supabase/migrations/` 是資料庫唯一真相，RLS 覆蓋見 BASELINE §2。
- Cloudflare Workers 靜態資產（`wrangler.jsonc`，push 到 `main` 即部署），App 正式站 <https://app.gov-agent.ai>；apex <https://gov-agent.ai> 是行銷站（§1）。部署順序、寫回規則與地雷見 [`docs/operations/deploy.md`](docs/operations/deploy.md)。
- 路由與導覽的單一真相是 `src/lib/navConfig.js` 的 `routeRegistry`／`navGroups`（未登記 fail-closed，D-013；[`docs/architecture/route-registry-governance.md`](docs/architecture/route-registry-governance.md)）。側欄自 PR #54 起只露今日待辦／專案文件／契約重點／標單工項四個工作面入口，其餘五個工作面（現場與品質、審查與協作、進度與金流、報表與結案、專案）`hidden: true`——定義、角色限制與深連結全部保留，今日待辦與初始化清單仍會導向隱藏頁，加回一個功能＝移除一行 hidden（`navConfig.test.js` 釘住集合；`grep -c` 數到 6 是連檔頭註解一起算）。commit `2d3068f` 另在工作面之上加了「球在誰手上」群組（現在輪到我／等待對方／今天已完成，走 `?ball=` 不新增路由，[`docs/architecture/ball-in-court.md`](docs/architecture/ball-in-court.md) §6）；主畫面是收件匣式單桶聚焦，四張指標卡已退場、「最近施工日誌」卡刻意保留（它是可見表面通往 `/site-log` 的最後一條路）。
- 頁面檔在 `src/pages/web/`（另有 `src/pages/Login.jsx`、`Security.jsx`）；Store 組合根 `src/store.jsx` ＋ `src/store/slices/`；資料存取規則見 §6.6。
- AI／整合功能：DB `ai_features` 為執行期權威，程式鏡像 `src/lib/aiFeatures.js` 與 `supabase/functions/_shared/aiFeatures.ts`（值域一致有測試釘住；[`docs/architecture/ai-gate-and-metering.md`](docs/architecture/ai-gate-and-metering.md)）。`assistant.chat` 自 W3 停用保留；`contract.parse` 由 B5（`d873b07`）比照停用——migration `20260911100100` **尚未套用正式庫**，套用前正式庫該功能仍是 `enabled=true`（任何登入成員可直接打 API）。Edge Functions 清單現查 `ls -d supabase/functions/*/`；13 支「純 schema＋prompt」函式走共用骨架 `_shared/aiHandler.ts`，`extract-requirements`／`agent-run`／`fetch-weather`／`send-reminders` 形狀特殊保留本體（B1）。

### 6.2 驗證狀態（哪些驗過、哪些沒有）

| 層 | 狀態 | 出處 |
|---|---|---|
| Vitest／Demo E2E／production build | 2026-09-11 本機全綠 | [`docs/BASELINE.md`](docs/BASELINE.md) §1 |
| pgTAP | 2026-09-11 本機實跑全過（`supabase db reset` 從零套用全部 migration） | 同上 |
| 真後端 E2E（6 條） | **本輪未跑**：chain3 需有效模型金鑰，目前失效；最近一次成功紀錄 PR #54（6/6） | [`docs/REAL_BACKEND_E2E.md`](docs/REAL_BACKEND_E2E.md) |
| Deno 型別檢查 | **未做**（本機無 deno）；重構期間 17 支 Edge Function 只過 esbuild bundle；B6 發現舊型別標註錯誤，暗示線上版本從未過 `deno check` | ROADMAP 未排入 |
| 正式庫 migration tracker | 最後核對 2026-09-02；之後新增兩支**尚未套用** | §6.3 |
| Edge Function 線上版本 | 從未逐支核對；重構的 `_shared/` 改動**未部署** | §6.3、§7 債項 8 |
| 正式站冒煙 | 2026-09-07 首頁 200、七項安全標頭齊全（HEAD 檢查，不代表登入後流程） | [`docs/產品健檢與開發方向-2026-09-07.md`](docs/產品健檢與開發方向-2026-09-07.md) §2.1 |
| 真人驗收 | 桌機輪 2026-08-19 單人自測回填；手機輪與真案三角色實機目視未執行 | [`docs/W8-5-三角色真實使用者驗收清單-2026-08-15.md`](docs/W8-5-三角色真實使用者驗收清單-2026-08-15.md) |
| 契約抽取準確率／召回率 | **未用真實契約量測**；`completed` 只代表處理覆蓋，不代表語意全對 | [`docs/architecture/resumable-extraction.md`](docs/architecture/resumable-extraction.md) §11、§14 |

### 6.3 正式環境核對紀錄（只記最後一次，不推論現值）

- **正式庫 migration**：2026-09-02 以 `supabase migration list --linked`（project `buylyonwoyvqdbvkkkbx`）核對，本機 57 支與遠端 57 筆逐一相符，遠端最新 `20260901040000`，沒有只在一邊的版本；2026-08-19 之後合併的 18 支（含 PR #34、#42、#56、#57 註明「merge 不會自動套」的那幾支）都已套用，PR #50 收編的 `20260824123253` 在遠端有對應列。**之後本機新增 `20260911100000_demo_requests_revoke_grants` 與 `20260911100100_contract_parse_retire`（B5，`d873b07`），尚未套用正式庫**；合併後套用時先 `migration list --linked` 再 `db push`，套完把版本號寫回本節（DEVELOPMENT.md §6 第 3 條）。
- **Edge Function 線上版本**：從未逐支核對；最後重佈紀錄是 PR #48（`extract-requirements`／`agent-run`／`send-reminders`）與 PR #51（`extract-requirements`）。重構的 B1（錯誤遮罩與骨架）、B4（`agentTools` 拆分）、B6（`extract-requirements` 拆檔）都動了 `_shared/`，部署時 17 支要一併重佈（colima 下必加 `--use-api`）；在此之前正式站的 API 仍會回 Claude 與 PostgREST 原文（[`docs/architecture/error-masking.md`](docs/architecture/error-masking.md) §11）。
- **前端與 CI**：正式站線上 bundle 為 PR #62 版本（2026-09-02 核對時 `/`、`/login`、`/agent`、`/requirements`、`/security`、`/site-log/print` 均回 200，HSTS／CSP／X-Frame-Options／X-Content-Type-Options／Referrer-Policy／Permissions-Policy／COOP 七項標頭齊全，bundle 含 PR #58 的 `AnchorDates` chunk；2026-09-07 再核首頁 200）。`main` 有 active ruleset（需 PR、`test-and-build`、`pgtap`），pgTAP 自 PR #62 起每個 PR 一律跑；仍允許 RepositoryRole 5 bypass、未要求核准人數與分支先更新到 base，不能宣稱完全不可繞過。pgTAP CI 自 `9c9a9bd` 起動態查 DB 容器名，不再寫死。
- **舊部署**：`pmis.pages.dev` 與 `ryanxxhuang.github.io/PMIS` 於 2026-09-07 仍回 200（§7 債項 7）。

### 6.4 已提交、未合併、未部署的工作（分支 `refactor/product-wide`）

從 `ui/apple-foundation` 分出，目前 20 個 commit（`d047437`…`b68bece`），三批；每批的五行規格、逐 commit 內容與驗證在 `docs/ROADMAP.md` 最上面的工作包格。合併前後要做的事在 §6.3。

1. **09-08 契約兩批**（`d047437`，重構前保存工作區交付；[`docs/契約自動整理品質優化-2026-09-08.md`](docs/契約自動整理品質優化-2026-09-08.md)、[`docs/契約整理流程-UIUX-2026-09-08.md`](docs/契約整理流程-UIUX-2026-09-08.md)）：保留 D-019 自動確認，新增「只看需留意項目」；契約重點／擷取審核兩頁共用核對狀態（明確空陣列 `triage_doubts = []` 才顯示核對通過，有疑慮與未取得核對結果分別揭露——修掉 09-07 健檢 H-01 的主頁誤標）；擷取審核移除最近 300 筆限制改分頁；Edge 抽取逐頁讀取並檢查 exact count、連續頁序與上傳 `page_count`，讀取失敗、缺頁或頁數不符不開始模型抽取；無文字頁、無效輸出與截斷揭露為處理不完整，契約包 `partial` 不算 `ready`。流程面：`/contract`、`/requirements`、`/requirements/review` 共用流程入口（`ContractFlow`）與登入角色說明，文件結果入口帶 `?package=`、重點頁可選契約範圍；上傳／重試後刷新義務、處理中輪詢；文件查詢分頁且載入錯誤可重試不偽裝無文件、切案時舊回應不覆蓋；機關檢視帳號不顯示上傳鈕；無可計算到期日的義務統一顯示「無到期日」。無新路由／角色／權限規則、無 migration。24 批上限、OCR、語意漏抽與跨條款理解未解。
2. **09-11 Apple UIUX 四包**（`c848c59`／`2d3068f`／`7aa94e9`／`8b87c9e`，D-021）：基礎層 token 與 primitives（`ui.jsx` 新增 `Segmented`／`Dot`，26 個既有匯出 API 不變、圓角 class 名一個未改）；球權來源進側欄、主畫面改收件匣（`navGroups`／`routeRegistry`／`routeAllowed`／`defaultLandingPath` 一行未動）；字級全站收斂到七階；圖示換 `lucide-react`（`MSym` 元件名與 props 不變、271 個呼叫點零改動、98 個對映逐一驗證，bundle 924.51→980.88 kB）。`src/lib/iconFont.test.js` 隨字型工具退場（當時 Vitest 由 820 降 818，不是測試遺失）。尚未做：三欄殼實作、行銷站套用、登入頁依三欄殼重做。
3. **全案重構 19 個 commit**（`b13f469`…`b68bece`；ROADMAP「全案重構」格逐 commit 列）：前端碼債（圖示字型死碼、台北日曆日 15 檔收斂、`format.js`、契約兩頁共用殼、列印頁色票、`Contract`／`Quality`／`SiteLog`／`Valuation` 四頁抽取）、後端（`publicError.ts` 錯誤遮罩與 `aiHandler.ts` 骨架、`agentTools.ts` 1759→62 拆 9 模組與 `handoff_sent` 留痕、AI 閘門 fail-open 收口、`extract-requirements` 794→534 純搬移）、資料庫（`demo_requests` 收權、`contract.parse` 退場，兩支 migration 未套用）、測試（Vitest +127 支、pgTAP 33→40 檔含唯一索引 8 條）、文件（事實校正與 D-021 補登、七份架構文件、部署 runbook、BASELINE 與本節快照化）。巨型檔前後：`agentTools.ts` 1759→62、`Contract.jsx` 1080→592、`RequirementsReview.jsx` 1196→1004、`Requirements.jsx` 1032→842、`Quality.jsx` 813→272、`SiteLog.jsx` 961→696、`Valuation.jsx` 610→437、`extract-requirements/index.ts` 794→534。

### 6.5 現行機制的單一真相（只寫「現在怎麼運作」與去哪讀）

- **標單重設與匯入**：單一交易 RPC `reset_project_boq`／`import_work_items`（migration `20260812000200`），全成或全敗，權限沿用 `can_write`，證據 guard 擋下時整包 rollback 並留 `audit_events`；前端不逐表刪除或分批寫入（W1）。
- **初始化只有一條路**（D-007）：建案 → 專案文件一次上傳（含 PCCES）→ 三方成員 → 設定開工日 → 開啟正式模式。Dashboard 對未開正式模式的真專案顯示五步初始化卡（PR #58 由四步擴為五步；D-014 條文仍寫四步，修訂待補），第 3 步只看本案是否有 `status = 'completed'` 的 `document_ingestion_runs`，第 5 步不被任何步驟或三方未齊鎖住；`/agent` 不因未匯標單整頁封鎖。已匯標單且正式模式時卡片消失，成員頁的一般介面入口有缺口（09-07 H-05，未修）。
- **AI 入口收斂為單一 Agent**（D-008、D-010）：`/assistant` 導向 `/agent`，浮動 Copilot 是同一 Agent 的明示新對話入口；閘門查詢失敗 fail-closed，`63ce2eb` 再把「`allowed` 非 `true`」一律擋下並回 503（不謊稱 403 已明確關閉）；用量記帳失敗不影響回應；`agent-run` 改走共用 `openAiGate`，message 4,000／facts 100k 字元上限（B1）。工具邊界 12 支（7 唯讀＋5 草稿）由原始碼掃描測試保證；`raise_to` 成功後再寫一筆 `handoff_sent` 給發起人（B4，紅線三發起方留痕）；唯讀工具的呼叫軌跡仍不落庫（ROADMAP 待決）。細節 [`docs/architecture/agent-tool-boundary.md`](docs/architecture/agent-tool-boundary.md)。
- **成員與正式模式**（D-009）：邀請方必須指定三方身分並與受邀帳號 `profiles.org_type` 比對，錯配即拒絕；開正式模式前列出缺哪一方並二次確認。`project_members`＝授權、`project_memberships`＝身分快照（[`docs/architecture/three-party-role-model.md`](docs/architecture/three-party-role-model.md)）。變更設計核准／駁回為機關專屬、核准必經審核中（D-016，`change_orders_guard`）。
- **文件管線**：上傳 → 確定性分類（AI 只做第二意見）→ 契約包歸屬 → 抽取，[`docs/architecture/document-processing-pipeline.md`](docs/architecture/document-processing-pipeline.md)；`delete_document` RPC 是唯一刪除路徑；私有 bucket、原始檔一經上傳凍結、300MB 前端預檢；契約分級可見性 D-018 是 RLS 邊界。抽取跨 request 續跑（W13）與 09-08 起的逐頁完整性檢查在 [`docs/architecture/resumable-extraction.md`](docs/architecture/resumable-extraction.md)；`document_processing_runs`（20 分鐘）與 `document_ingestion_runs`（10 分鐘）兩個過期時鐘各管各的表。
- **契約重點與履約時程**：D-017 語意是「確認轉錄」不是「核定生效」；D-019 AI-origin 整理內容全自動確認歸檔，確定性核對（引文逐字＋期限數字）只是透明度註記，帶疑慮者照樣物化並揭露原文優先；D-020 任何已核定 Requirement 都物化一列 `contract_obligations`（無時點＝「未觸發」）。`/requirements` 是「契約重點 · 履約時程」三方共用檢視頁（PR #55，`src/lib/obligationTimeline.js`：可見範圍看角色、動作只看歸屬，`VISIBLE` 表是前端 shim 不是安全邊界）；`/deadlines` 做期限管理、罰款試算與基準日；`/requirements/review` 是擷取審核。`contract_obligations` UPDATE 只看歸屬、`completed_at`／`completed_by` 由 trigger 蓋（migration `20260825120000`）；準時率＝「應完成項準時率」；循環義務只推算下次日期、無逐期紀錄（09-07 H-03）。契約兩頁共用清單＋詳情殼（`8e0fb33`：`useListDetailPane`／`useListKeyboardNav`／`listDetail.jsx`／`useContractEnrichment`）。
- **球權與今日待辦**：`src/lib/todayTasks.js` 是今日待辦唯一聚合（Dashboard、`/alerts`、側欄件數共用 `useTodayTasks`），單筆球權判定在 `src/lib/ballInCourt.js`／`_shared/ballInCourt.ts` 兩份，同步點與已知差異（機關自有期限不進今日待辦、伺服器缺變更／查驗／觀察三類、`status` 判定實作不同）登記在 [`docs/architecture/dual-engine-sync.md`](docs/architecture/dual-engine-sync.md) #5；`dueText` 句型被 `OVERDUE_RE` 與 e2e 綁死（[`docs/architecture/ball-in-court.md`](docs/architecture/ball-in-court.md) §5）。
- **錯誤遮罩**：伺服器 `_shared/publicError.ts` 唯一遮罩點、前端 `friendlyError` 共用「CJK＝我們自己寫的」判準，兩支 `errorLeak.scan` 掃描測試凍結前提（[`docs/architecture/error-masking.md`](docs/architecture/error-masking.md)）；伺服器端**未部署**。
- **業務日期與金額**：「今天」一律台北日曆日（`src/lib/dates.js`；`4d2489b` 收掉 15 檔各自的本地時間 helper，系統時戳維持 UTC）；金額格式統一 `src/lib/format.js`（null 顯示「—」，不偽裝成 0）；`billableLeaves` 收到 `boqCalc.js`（`RiskAudit`／`Progress`／`ValuationPackage`／`ValuationPrint` 四處因尺度不同刻意未併，註解說明）。
- **現場與品質**：照片先行→AI 填日誌（W8-7：批次辨識只回填表單、落庫仍由人存檔；`photos.location` 白板區域結構化），查驗↔自主檢查表縫合（`inspections.checklist_record_id`）；試體 28 天不合格同交易開缺失且以 `test_sample_id` 去重（W5-4）；`/quality` 工作佇列只來自既有球權與試體齡期引擎。
- **稽核**：`audit_events` append-only 含 IP（[`docs/architecture/audit-events.md`](docs/architecture/audit-events.md)）；文件讀取走 `log_document_access` RPC 留痕（fail-closed）。

### 6.6 前端資料存取規則

- 跨頁共享、需要同步更新的資料放 Store。
- 目前直接查 Supabase 的頁面有五個：`Contract`、`Requirements`、`RequirementsReview`、`Activity`，以及 `Dashboard`（只為初始化清單各查一個 `count: 'exact', head: true`）。契約三頁共用的 enrich 查詢自 `8e0fb33` 起收在 `useContractEnrichment` hook——共用的是「查詢配方」不是「同一份狀態」，刻意不進 Store（理由寫在檔頭）。
- 純計算與重複查詢才放 `src/lib` 或 `src/store/db.js`。
- 同一段查詢沒有重複前，不新增 repository、service 或額外 Store slice。

## 7. 已知架構債

以下是現況，不應在沒有測試保護下直接刪除：

1. **雙成員資料仍保留相近名稱**：W5-3 已用單一架構規則、schema comment 與高風險呼叫點註解降低誤用；為維持相容，未改表名、刪相容 helper 或動 RLS。
2. **雙引擎同步**：W5-4 已修正試體不合格缺失的漏開／重複開漂移；其餘 Demo／前端與伺服器 Trigger／Edge 規則仍有人工同步點，詳見 `docs/architecture/dual-engine-sync.md`。
3. **期限相容層仍存在**：W5-2 已把方向收斂為 approved deadline Requirement → obligation，但時間軸、提醒與部分 Agent 查詢仍讀 `contract_obligations`；它是有 rollback 的 runtime 相容層，不是第二份契約權威。正式站已套用 `20260812000500`，舊的 obligation → Requirement triggers 已退役。 D-020 起所有已核定 Requirement 都物化一列義務，`contract_obligations` 現在是履約時程頁的直接資料來源；方向仍是單向，未改變權威。
4. **履約時程可見範圍仍是前端 shim**：PR #55 的 `VISIBLE` 表與逐筆 `canAct` 尚未由後端依身分回傳。PR #56 已把 UPDATE 政策收到歸屬、D-018 提供 SELECT 分級，安全邊界在 RLS；但前端仍自行過濾可見集合，目標契約是後端逐筆回 `canAct` 後整表刪除。
5. **Migration 回復檔只覆蓋少數**（數字見 `docs/BASELINE.md` §2）：PR #60 補了 `20260824130000`、`20260825000100`、`20260825120000` 的 down 檔，B5 再補兩支新 migration 的 down 檔；除 W5-2 與 D-020 曾做 down→up 循環外未演練其餘回復，不能僅由檔案存在推論可安全還原。
6. **五個工作面處於 hidden**：PR #54 起 `/site-log`、`/quality`、`/valuation`、`/payments`、`/portfolio` 等只能深連結或由今日待辦導入；逐項復出是產品決定，不是技術債，但 E2E 對這些頁的守衛仍在跑。
7. **過時部署仍可公開存取**：`pmis.pages.dev`（舊 Cloudflare 部署，bundle 落後）與 `ryanxxhuang.github.io/PMIS`（GitHub Pages 仍啟用，`gh-pages` 分支停在 2026-08-11，舊品牌）都帶正式 anon key。待關閉 GitHub Pages、刪 `gh-pages` 分支、處理舊 Cloudflare 專案（2026-09-02 健檢列為 P1）。
8. **Edge Function 線上版本未逐支核對**：migration tracker 已於 2026-09-02 核對一致（§6.3），但 17 支 Edge Function 的線上版本與 `main` 是否一致沒有紀錄，最後一次重佈紀錄是 PR #51；重構的 B1／B4／B6 都動了 `_shared/`，部署那次要 17 支一併重佈並以 `supabase functions list` 對帳。
9. **`contract_obligations.status` 無 CHECK 約束**：前端與伺服器的「未結」判定只在現行四值域下等價（`docs/architecture/dual-engine-sync.md` #5）；`document_processing_runs` 的狀態機也只有 CHECK 守合法組合、無 trigger 守轉移順序。09-06 健檢 B-15 點名的 11 張領域表狀態欄零 check constraint 尚未處理（ROADMAP 候選）。


## 8. 文件權威順序

遇到文件互相矛盾時，依下列順序判斷：

| 問題 | 權威來源 |
|---|---|
| 開發流程與完成定義 | `DEVELOPMENT.md` |
| 目前產品定位與現況 | `CURRENT.md` |
| 已定案產品／架構決策 | `docs/DECISIONS.md` 與對應 ACTIVE 架構文件 |
| 尚未核准的候選改動、續接排程 | `docs/ROADMAP.md`（**唯一的續接依據**；兩份健檢報告的排程節已併入，報告本身只留證據與燈號）；不得當成現況或實作授權 |
| 長期產品北極星 | `docs/北極星-政府機關-Agent-平台.md` |
| AI 協作入口 | `AGENTS.md`；細節仍以 `DEVELOPMENT.md` 為準 |
| UI/UX 設計規範 | `docs/UIUX-Apple-設計規範.md`（D-021，2026-09-11 起取代 W9 的 Google／Material 3 handoff） |
| 前端頁面與元件對應 | `src/App.jsx` |
| 路由登記、導覽、分頁與前端角色限制 | `src/lib/navConfig.js` 的 `routeRegistry`／`navGroups` |
| 今日待辦的三段聚合、球權與完成條件 | `src/lib/todayTasks.js`（Dashboard 與 `/alerts` 共用；協作項球權仍在 `src/lib/ballInCourt.js`） |
| 資料庫 Schema、RLS、RPC、Trigger | `supabase/migrations/` |
| AI 功能註冊 | DB `ai_features`；程式鏡像為 `src/lib/aiFeatures.js` 與 `supabase/functions/_shared/aiFeatures.ts` |
| 履約時程可見範圍與動作歸屬（前端） | `src/lib/obligationTimeline.js`；安全邊界仍是 RLS（D-018、`20260825120000`） |
| 契約重點期限與循環規則文字 | `src/lib/contractDue.js`（`buildDueList`、`formatObligationRule`）與 Edge 端同名引擎，兩份需人工同步 |
| 文件類型值域 | `supabase/functions/_shared/documentTypes.ts` |
| 業務日期「今天」 | `src/lib/dates.js`（台北時區；系統時戳維持 UTC） |
| 部署位置 | App `app.gov-agent.ai`（Cloudflare Workers，`wrangler.jsonc`）；apex 為 `PMIS.marketing` 行銷站 |
| 測試與規模數字 | `docs/BASELINE.md`（手動核對快照，含每個數字的指令與核對日期）；要現值就重跑那些指令 |

`SCOPE.md` 與 `PRD.md` 是歷史規劃快照；日期式驗收、UX、資安與簡報文件是當時證據，不是目前功能清單。


## 9. 已定案的角色與成員責任

2026-08-12 已定案：

- `profiles.org_type` 是廠商／監造／機關三方業務角色與 Agent 身分來源。
- `project_members` 只管能否進入專案及專案 admin。
- `project_parties` 與 `project_memberships` 只管文件歸屬、契約方與稽核身分。
- `project_memberships.project_role` 是歷史相容／描述欄位，不作授權、Agent 或提醒分流。
- 廠商 Agent 同時支援現場與品管工作；不再建立 `field/qc` 系統角色。

完整決策見 [`docs/architecture/three-party-role-model.md`](docs/architecture/three-party-role-model.md)。頁面直接查詢與 Store 的責任已依 §6.1 定案，不再為形式一致搬動資料。
