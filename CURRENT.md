# GovAgent／PMIS — 目前系統真相

> 狀態：**CURRENT（現況權威文件）**
> 最後核對：2026-09-11（分支 `refactor/product-wide`；09-08 契約兩批與 09-11 Apple UIUX 四包都**已提交、尚未合併 `main`、尚未部署**；正式 Supabase migration tracker 與 Edge Function 線上版本未重核，歷史部署日期分別保留）
> 用途：回答「產品現在是什麼、已經做到哪裡、哪份文件說了算」。

### 2026-09-11 Apple style UIUX 改版（四包已提交於 `refactor/product-wide`，未合併 `main`、未部署）

- 使用者於 2026-09-11 拍板：全產品（App 與行銷站）UIUX 一律改 Apple style，取代 W9 的 Google Workspace／Material 3 方向；此後所有 UIUX 都 follow [`docs/UIUX-Apple-設計規範.md`](docs/UIUX-Apple-設計規範.md)。決策補登為 D-021，資訊架構採疊合版（落地點＝收件匣、殼＝來源欄／清單欄／詳情欄、詳情＝契約原文＋條文高亮）。
- `c848c59` 基礎層：`src/index.css` 換 Apple 系統色票（亮暗雙軌，每個值實算對比度並寫回註解）、字級階梯進 `@theme`、毛玻璃只給 chrome 而內容卡實心、reduced-motion／reduced-transparency／contrast-more 三訊號分開處理；`ui.jsx` 按鈕去藥丸改 Apple 焦點環，新增 `Segmented` 與 `Dot`，26 個既有匯出的 API 形狀與 props 不變。圓角 class 名一個未改。
- `2d3068f` 落地點：側欄新增「球在誰手上」群組（現在輪到我／等待對方／今天已完成），走 `?ball=` query param 不新增路由；主畫面四張指標卡退場改收件匣式單桶聚焦，「最近施工日誌」卡刻意保留（`/site-log` 與 `/valuation` 都是 `hidden: true`，那是可見表面通往施工日誌的最後一條路）。`navGroups`／`routeRegistry`／`routeAllowed`／`visibleNavGroups`／`defaultLandingPath` 一行未動，未解封任何 hidden 工作面。
- `7aa94e9` 字級：全站 13 種任意字級（含 11.5／12.5／10.5 半像素）收斂到七階；Tailwind 內建 `--text-xs/sm/base/lg` 對映同一份階梯（只改值不改名，460+ 處零編輯生效），另逐處改寫 35 檔 158 處。`Contract.jsx`／`Requirements.jsx`／`RequirementsReview.jsx` 共 78 處刻意未處理，避免與契約抽取那條工作線混進同一個 commit，待另一包收尾。
- `8b87c9e` 圖示：Material Symbols 自架 subset 字型退場改 `lucide-react`；`MSym` 元件名與 props 不變、271 個呼叫點零改動，98 個對映逐一對照 lucide 1.44 實際匯出驗證，漏對映退路是中性圓圈＋dev console 警告。bundle 924.51→980.88 kB（gzip 286.93→300.99）。`src/lib/iconFont.test.js`（2 個測試）隨字型工具一起退場——**這就是 Vitest 由 820 降為 818、檔數由 73 降為 72 的原因，不是測試遺失**。
- 基線（2026-09-11 本機實測）：72 檔 818 Vitest、48 Demo E2E、production build 全綠。未跑 pgTAP、未跑真後端 E2E、未部署。尚未做：三欄殼實作、行銷站套用、登入頁依三欄殼重做（見 ROADMAP）。

### 2026-09-08 契約完整流程與 UI/UX（已提交於 `refactor/product-wide`，未合併 `main`、未部署）

- 使用者後續明確聚焦「契約上傳 → AI 自動爬梳 → 重點整理 → 不同角色看不同內容」。已在既有 `/contract`、`/requirements`、`/requirements/review` 完成流程銜接；無新路由／角色／權限規則。
- 文件與重點頁共用流程入口及登入角色說明；上傳格式能力如實區分，使用可鍵盤操作的上傳按鈕；手機文件表改為直向列，AI 狀態與原因不需橫向捲動。一般機關檢視帳號不顯示上傳按鈕。
- 文件結果入口帶 `?package=`，重點頁可選契約範圍，審核與返回連結延續同一契約。AI-origin 由 ingestion run 的文件版本推導契約，人工項目使用既有 `contract_package_id`。前端篩選只作展示，D-018 RLS 仍為資料安全邊界。
- 上傳／重試後刷新義務；進入重點頁重新載入義務，仍有 ingestion run 處理中時輪詢刷新。文件查詢分頁且載入錯誤可重試，不偽裝無文件；切案時舊載入回應不能覆蓋新畫面。處理覆蓋警示落入 processing metadata，亦可從既有 ingestion metadata 還原；部分整理不再顯示綠色已完成，契約包 partial 亦不再算 ready。
- 無可計算到期日的義務統一顯示「無到期日」，避免「無需處理」造成忽略；未改期限計算、確認或業務執行權限。
- 本輪當日 73 檔／820 Vitest、48 Demo E2E、production build 通過；另以真元件＋測試資料檢查上傳頁 1440／375px，無水平溢出且部分整理原因在可見寬度內。未驗證正式契約、真模型或新一輪真 Supabase／pgTAP。交付與限制見 [`docs/契約整理流程-UIUX-2026-09-08.md`](docs/契約整理流程-UIUX-2026-09-08.md)。（此後 `8b87c9e` 刪除 `src/lib/iconFont.test.js`，目前基線為 72 檔／818。）
- 交付已由 commit `d047437` 提交於 `refactor/product-wide`，仍未合併 `main`、未部署。

### 2026-09-08 契約自動整理品質修正（前一批，已提交於 `refactor/product-wide`，未合併 `main`、未部署）

- 使用者要求減少逐條人工審核並開始優化。此次保留 D-019：AI-origin 仍自動確認，有疑慮亦可進履約 runtime；新增「只看需留意項目」入口，不新增人工放行門檻。
- 契約重點／擷取審核兩頁共用核對狀態：明確空陣列 `triage_doubts = []` 才顯示既有核對通過標示；有疑慮與未取得核對結果分別揭露。主頁已補讀核對欄位，修正 09-07 健檢的誤標問題。通過引文／適用期限數字核對不等於全部語意正確或沒有漏項。
- 擷取審核移除最近 300 筆限制，以既有分頁工具讀取目前權限可見資料；runs 亦分頁讀取。每個文件版本的最近一次 completed run 都檢查完整性，另一份成功文件不再遮蔽警示。
- Edge 抽取逐頁讀取並檢查 exact count、連續頁序；有上傳 `metadata.page_count` 時再比對該頁數。讀取失敗、缺頁或上傳頁數不符不開始模型抽取。無文字頁、無效輸出與截斷均揭露為處理不完整，缺少模型清單不再偽裝成成功空結果。
- 無資料庫／權限變更、無 migration；前端與 `extract-requirements` 都已提交於 `refactor/product-wide`，仍未合併 `main`、未部署。舊流程沒有上傳頁數時只能核對已儲存資料；24 批上限、OCR、語意漏抽與跨條款理解仍未解決，也尚未用真實契約量測準確率／召回率。
- 本次本機 72 檔／807 Vitest、42 Demo E2E、production build 通過；Edge 入口 esbuild bundle 通過，不等同 Deno 實機驗證。build 仍有大於 500 kB chunk 警告；未重跑真 Supabase／模型端到端或 pgTAP（本次無 DB 變更）。
- 交付範圍、驗證與下一階段建議見 [`docs/契約自動整理品質優化-2026-09-08.md`](docs/契約自動整理品質優化-2026-09-08.md)。下方 09-07 報告與部署紀錄保留當日狀態。

### 2026-09-07 健檢補記

- PR #59、#60、#61、#62 已在目前 HEAD 歷史中合併。本次本機 71 檔／767 Vitest、42 Demo E2E、production build 全通過；同一 commit 的 GitHub pgTAP 為 33 檔／927 斷言通過。production 依賴 `npm audit --omit=dev` 回報已知弱點 0；不代表開發／Deno 依賴或全系統無漏洞。
- main 已有 active ruleset，要求 PR 與 `test-and-build`、`pgtap`；pgTAP 已改為所有 PR／main push 執行。仍有 RepositoryRole 5 的 PR bypass，未要求人工核准人數與分支先更新到 base，不能宣稱完全不可繞過。
- migrations 仍為 57 支，rollback 現為 7 支；新增三份回復檔不等於已做回復演練。本次未重核正式 migration tracker 或 Edge Function 版本；真後端 E2E 因本機 Docker daemon 未啟動而未重跑。
- 目前今日待辦的契約期限包含廠商、監造，仍排除機關；但履約時程已允許機關操作自己的義務。循環期限只推算下次日期，尚無逐期完成／逾期紀錄；循環項的準時率不是逐期準時率。
- 履約時程的自動確認標示未讀 `triage_doubts`，帶疑慮資料仍可能顯示「系統核對無誤」；本次只記錄問題，尚未修正。已匯標單且為正式模式時，初始化卡不再顯示，成員頁的一般介面入口有缺口。
- `app.gov-agent.ai` 首頁本次 HEAD 回 200 且七項既有安全標頭齊全；兩個舊網址仍回 200。HTTP 標頭檢查不代表登入後業務流程驗收。
- 完整發現、驗證限制與尚未核准的開發建議見 [`docs/產品健檢與開發方向-2026-09-07.md`](docs/產品健檢與開發方向-2026-09-07.md)。下方日期式工作包敘述保留當時脈絡；有衝突時以本補記與較新的已接受 Decision 為準。

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

## 6. 目前技術現況

截至 2026-09-11 的盤點（分支 `refactor/product-wide`；最後合併進 `main` 的是 PR #62，之後的 09-08 契約兩批與 09-11 Apple UIUX 四包尚未合併、尚未部署）：

- React 18、Vite 6、Tailwind CSS 4 的靜態 SPA；Sentry 錯誤回報（`src/lib/sentry.js`，DSN 走環境變數）。
- Supabase Postgres、Auth、RLS、Storage 與 Deno Edge Functions。
- Cloudflare Workers 靜態資產部署（`wrangler.jsonc`，push 到 `main` 即部署），App 正式站為 <https://app.gov-agent.ai>；apex <https://gov-agent.ai> 是行銷站，見 §1。
- 39 條登記路由（`routeRegistry`）、34 個業務頁面檔（`src/pages/web/`，另有 `Login.jsx` 與 `Security.jsx`，總頁面 36）、9 個 Store slices。側欄自 PR #54 起只露出今日待辦／專案文件／契約重點／標單工項四個扁平入口，其餘五個工作面（現場與品質、審查與協作、進度與金流、報表與結案、專案）`hidden: true`（5 個定義，`navConfig.test.js` 釘住集合；`grep -c` 數到 6 是連檔頭註解一起算進去了）——定義、角色限制與深連結全部保留，今日待辦與初始化清單仍會導向隱藏頁；加回一個功能＝移除一行 hidden。commit `2d3068f` 另在工作面之上加了「球在誰手上」群組（現在輪到我／等待對方／今天已完成，走 `?ball=` 不新增路由），側欄不再只有四個扁平入口。
- 57 個 migrations 建立 51 張資料表、1 個權威 Requirement View；`supabase/migrations/` 是資料庫唯一真相（檔數與最新版本以 `ls supabase/migrations` 為準，最新為 `20260901040000`）。`supabase/rollbacks/` 有 7 支 down 檔（與 §7 債項 5 一致）；補齊三支不等於已演練回復。
- 17 個已註冊的 AI／整合功能與 17 個 Edge Functions（`assistant.chat` 停用保留；PR #37 新增 `documents.classify`＝`classify-document`）。
- 72 個 Vitest 測試檔，共 818 個測試；48 個 Playwright Demo E2E（8 檔，三角色／路由／無障礙／RFI／送審球權）；6 條真 Supabase E2E（auth 冒煙＋四條業務鏈＋檔案檢視 `file-viewing.spec.js`）；33 組 pgTAP SQL 測試，`plan()` 加總 927 條斷言（**靜態統計，本輪未實跑**；DB 相關變更的 push／PR 由 CI 自動全套執行）。

最近一次本機驗證（2026-09-11，分支 `refactor/product-wide`）：72 檔 818 Vitest、48 Demo E2E 與 production build 全綠；`npm audit --omit=dev` 回報 0 漏洞（含 dev 依賴則有 2 個 moderate，都在 `@vitest/mocker`，修復需升 vitest 5 大版）。本輪未跑 pgTAP、未跑真後端 E2E、未連正式環境核對 migration tracker 或 Edge Function 線上版本。Vitest 由 09-08 的 73 檔 820 降為 72 檔 818，是 commit `8b87c9e` 隨圖示字型工具刪除 `src/lib/iconFont.test.js`（2 個測試），不是測試遺失。

前一次在 `main` 上的全套驗證（本機，2026-09-02，main `ba6ab45`）：767 Vitest、42 Demo E2E 與 production build 全綠；main 最近 10 次 CI（含 pgTAP workflow）全部成功；`app.gov-agent.ai` 的 `/`、`/login`、`/agent`、`/requirements`、`/security`、`/site-log/print` 均回 200，HSTS／CSP／X-Frame-Options／X-Content-Type-Options／Referrer-Policy／Permissions-Policy／COOP 七項標頭齊全，線上 bundle 已含 PR #58 的 `AnchorDates` chunk。真後端 E2E 最近一次紀錄為 PR #54（6/6）。

**正式資料庫 migration 已核對（2026-09-02，`supabase migration list --linked`，project `buylyonwoyvqdbvkkkbx`）**：本機 57 支與遠端 57 筆逐一相符，遠端最新為 `20260901040000`，沒有只在一邊的版本。2026-08-19 之後合併的 18 支（含 PR #34、#42、#56、#57 註明「merge 不會自動套」的那幾支）都已套用；PR #50 收編的 `20260824123253` 在遠端有對應列。Edge Function 線上版本仍未逐支核對，最後一次文件紀錄是 PR #48（extract-requirements／agent-run／send-reminders）與 PR #51（extract-requirements）重佈。

標單重設與匯入自 W1 起走單一交易 RPC（`reset_project_boq`／`import_work_items`，migration `20260812000200`）：全成或全敗，權限沿用 `can_write`，證據 guard 擋下時整包 rollback 並留 `audit_events`；前端不再逐表刪除或分批寫入。

初始化自 W2 起只有一條路（D-007）：建案 → 專案文件一次上傳 → 三方成員 → 正式模式。Dashboard 對未開正式模式的真專案顯示四步初始化清單（狀態由既有資料推導）；`/agent` 不再因未匯標單整頁封鎖，僅提示工項類問題需先匯入；所有「無標單」空狀態統一指向專案文件。

AI 入口自 W3 起收斂為單一 Agent（D-008、D-010）：`/assistant` 導向 `/agent`，浮動 Copilot 是同一 Agent 的明示新對話入口；前端不再呼叫 `assistant.chat`，但功能列、Edge Function 與歷史用量保留。所有 AI 功能閘門查詢失敗時 fail-closed；403／503 錯誤會在 UI 如實顯示並可重試，不會偽裝成離線快答。

成員與正式模式自 W4 起採三方確認流程（D-009）：成員頁明確區分載入中、空名單、載入失敗與正常名單；邀請方必須指定廠商／監造／機關，伺服器會與受邀帳號的註冊身分比對，錯配即拒絕。開啟正式模式前會列出缺少哪一方並要求二次確認；三方未到齊仍可由專案建立者決定是否開啟。

W5-2 的正式庫變更前唯讀基線：65 筆 obligation、113 筆 Requirement，差額 48 筆全是未核定建議（24 筆 `draft_ai/ai`、23 筆 `needs_review/ai`、1 筆 `needs_review/manual`）；0 筆 orphan legacy，0 筆已核准 deadline 缺 obligation。65 筆 obligation 全為待辦、0 筆有佐證、21 筆有罰則，且 65 筆都有唯一 Requirement 連結。盤點只讀匿名數量，未匯出業務內容。

W5-3 已把雙成員模型的防誤用規則固定：[`docs/architecture/three-party-role-model.md`](docs/architecture/three-party-role-model.md#成員模型的唯一判斷規則) 是唯一說明點；已部署的 migration `20260812000600` 只替兩張表與 helper 加 schema comment，關鍵前端／提醒呼叫點也有短註解。沒有改名、刪表或變更 RLS。

W5-4 只修正一條可重現的 Demo／DB 漂移：同一組 28 天試體判定不合格時，正式 DB 會在同一交易建立並以 `test_sample_id` 去重缺失，但 Demo 曾因 React state updater 時序漏開缺失，重試時又可能重複開。現在 Demo 以 `deriveTestSampleUpdate` 同步推導判定，並以 `shouldCreateTestSampleDefect` 保持一組試體一筆缺失；其他尚未發生漂移的雙引擎規則沒有重構。

W6 PR #7 已合併並部署，5 條本機真後端測試於 2026-08-13 重跑全綠：`npm run test:e2e:real`（環境變數注入、拒絕正式 Supabase、不進預設 CI）對一次性本機 staging 跑 auth 冒煙、鏈 1 初始化（含邀請錯配拒絕與正式模式）、鏈 2 估驗三方簽核與請款收款、鏈 3 文件上傳＋綁定真文件版本的人工待審 Requirement→核定→D-012 義務物化、鏈 4 匯入/重設 rollback（含 UI 錯誤橫幅與「日誌不半刪」）。fixture 走產品窄門 RPC，清理含 Storage 物件，跑後殘留 0。

W6-4 已於 2026-08-15 收官：先前的「CLI boot error」查明為誤診，真因是 colima 未掛載 repo 所在的外接 SSD（連同本機 service_role 權限、pro 方案閘門與 W8 UI 漂移一併修復，已由 PR #20 合併）。同日本機一次性 staging 上全套 5/5 通過且鏈 3 為 live 模式——`extract-requirements` 真呼叫 Anthropic API、`document_ingestion_runs` completed、AI-origin 固定期限 Requirement 與經正規化比對的契約原文 citation，監造核定後 D-012 義務物化；`ai_usage_events` 留有 `requirements.extract`、token 非 0、`status='ok'` 的記帳列。細節見 `docs/REAL_BACKEND_E2E.md`。

W7 已由 PR #9 部署並依 D-013 收口前端路由：`src/lib/navConfig.js` 的 `routeRegistry` 明確登記全部 36 條 App 路由，未登記業務路由 fail-closed；登入、公開、重新導向、列印與 404 各自標註。`src/App.jsx` 由這份路由表統一決定共同守衛與版面，四條列印路由現在也會先驗證登入與專案狀態，但仍保留無工作台外框的列印版面。既有三方頁面權限、導覽、RLS 與資料庫均未改動。

W8-1 由 PR #11 完成：主品牌統一為 `GovAgent｜公共工程`；側欄固定為今日待辦、現場與品質、審查與協作、進度與金流、文件與結案、專案六個工作面；`問 GovAgent` 是頁首全域入口；機關仍落在跨案總覽。36 條路由與原角色限制不變。2026-08-14 使用者核准 W8-0 第三版後，W8-1R 由 PR #14 完成並部署：桌面側欄預設常駐展開、可收合成圖示列並記住同一瀏覽器偏好；工作面的子頁選單預設收合，包含目前所在工作面也可自由展開與再次收合；手機抽屜使用同一階層；內容區原 `WorkbenchTabs` 與手機子頁下拉已移除。側欄視覺採 Codex 式安靜層級：工作面用圖示與較強文字，子頁縮排；目前頁與 hover 使用完整中性圓角底，不再使用藍色左線與子頁分隔線。`navConfig.js` 仍是導覽與路由守衛的單一真相來源，36 條路由、角色限制、RLS、資料庫與業務頁均未改。

W8-2 由 PR #12 交付：今日待辦的聚合收斂為單一純函式 [`src/lib/todayTasks.js`](src/lib/todayTasks.js)，`/dashboard` 與 `/alerts` 吃同一份，`/agent` 不再重複待辦清單（只留無件數的「前往今日待辦」連結）。`/dashboard` 改為「現在輪到我／等待對方／今天已完成」三段，每段最多 5 筆、溢位連 `/alerts`；統計帶、球權統計與未結案缺失卡移除，AI 主動觀察降為一行風險摘要。待辦一律由既有業務狀態推導：協作項沿用 `ballInCourt.js`（新增共用的 `collaborationItems()`），期限型沿用 `contractDue`／`qc`／`acceptance`／`itp` 既有引擎，`Alerts.jsx` 內嵌的第二套規則已刪除。

W8-2 的三條硬規則寫在函式與測試裡：AI 草稿與未核定 Requirement 不是 `buildTodayTasks` 的輸入，結構上進不了待辦；契約義務只接受 `廠商／監造／機關` 三個精確 `responsible` 值，且只有廠商責任者列為待辦（`/contract` 的完成鈕吃 `can.edit`，監造／機關按不到，不製造做不到的假待辦）；「今天已完成」只採可靠操作時間戳 `defects.closed_at` 與 `inspections.inspected_at`（依 `Asia/Taipei` 判日），可回填的業務日期與沒有完成時間欄位的估驗核定／變更核准一律不列。驗收階段的角色白名單移到 [`src/lib/acceptance.js`](src/lib/acceptance.js) 的 `ACCEPTANCE_STAGE_ORGS`，驗收頁與待辦聚合共用。

W8-2 未動路由數、頁面權限、RLS、資料庫與 Edge Function。同批修正三個既有缺陷：估驗「待廠商請款」導向改為 `/payments`（請款日欄位在該頁）、`recordInspectionResult` 的 demo 分支補寫 `inspected_at`（原本只有 DB 分支寫，造成雙引擎漂移）、`computeObligationDue` 新增可注入的 `today`（每月重複義務不再讀系統時鐘）；期限判斷一律先正規化為台北日曆日午夜，避免傍晚開頁時第 8 天被誤列進「7 日內」。本機基線為 563 Vitest、19 Demo E2E 與 production build 全綠。初始化第 3 步語意與契約重點改版仍屬 W8-3，不得寫成已完成。

W8-3A 由 PR #13 交付：未開正式模式的真專案仍保留一張四步初始化卡片；每步顯示責任方、完成狀態與單一目的地，卡片另顯示完成數與唯一下一步。第 3 步只以本案是否存在 `status = 'completed'` 的 `document_ingestion_runs` 判定 AI 是否整理完成，不再讀 Requirement 待審／核定數；即使仍有 106 筆待審或擷取結果為 0 筆也算完成。完成但 0 筆時 `/requirements` 會顯示「沒有找到建議」的有效空結果，不會把使用者導回重新上傳；人工核定只決定內容是否成為契約規則，不是開啟正式模式的門檻。第 4 步維持可由專案建立者直接前往 `/members` 開啟，前三步或三方未齊只提供提醒，不會鎖住按鈕。

W8-3A 驗證（2026-08-14）：60 個 Vitest 檔、583 個測試與 19 個 Demo E2E 全綠，production build 與 PR CI 成功，`git diff --check` clean；沒有變更路由、角色、RLS、資料庫、migration、Edge Function 或 Store slice。另以既有 staging 測試帳號建立未開正式模式的真實專案，完成 Dashboard 初始化卡片桌面與 375px 目視，以及 `/contract`、`/requirements`、`/members` 三個銜接頁的 375px 無水平溢位驗收；臨時專案已刪除。

W8-1R 驗證（2026-08-14）：60 個 Vitest 檔、576 個測試與 19 個 Demo E2E 全綠，production build 成功，`git diff --check` clean。測試數由 main 的 583 降為 576，是因移除 7 個只驗證已刪除 `workbenchFor()`／`WorkbenchTabs` 的過時測試；桌面側欄展開／收合／偏好保留、工作面子頁預設收合且目前工作面也可再次收合，以及 375px 同源抽屜均由 `e2e/routes.spec.js` 驗證。PR #14 的 main CI 與 Cloudflare Workers build 成功，正式站 bundle 已確認包含 `pmis-sidebar-collapsed` 與側欄展開／收合程式碼。

W8-3B 由 PR #15 交付並部署：`/requirements` 一般畫面改為「已生效的契約重點」、最多 6 筆「值得留意的整理結果」與可收合完整追溯；舊 run 的 approved 在 300 筆有界查詢內仍保留，舊 run 未核定 AI 建議只在追溯區顯示。預設去重只合併呈現內容完全相同的列，不改 DB；只有可追蹤 deadline 能透過原 `review_requirement` 捷徑「核定並加入期限追蹤」並由 D-012 物化 obligation，其他類型不假裝建立尚不存在的工作流。收合追溯時同時關閉歷史詳情，rejected／superseded 不殘留在一般畫面。側欄分頁標籤同步改為「契約重點」。手機磨光依規格 §11 完成：375px 動作鈕與六個追溯篩選至少 44px（`max-sm:min-h-11`，桌面與共用 `ui.jsx` 不動）、廠商唯一查看動作補中性邊框、無核定權提示改淡底提示列。587 Vitest、19 Demo E2E、production build 全綠；main CI 與 Cloudflare Workers build 成功，正式站冒煙 200。**真案三角色桌面／375px 實機目視尚未執行**（無可用帳號），不得寫成已完成，列為 W8-5 前待補。

W8-4A 由 PR #16、W8-4B 由 PR #18、W8-4C 由 PR #17 交付並部署：/quality 首屏改「現在要處理」工作佇列＋五段分段控制，佇列只來自既有球權與試體齡期引擎，判不合格後原地回饋並可一鍵切到缺失分段；/site-log 手機存檔列貼底（唯讀分支未動）。/portfolio 新增跨案例外數字帶；/payments 手機改唯讀期別時間線（桌面表格與登錄欄位不變）；/change-orders 待核定群排前、已定案明細收合。W8-4B 補上監造視角：/valuation 首屏決策列（狀態＋BallChip 責任方＋「超計 N 項／無佐證 M 項」確定性差異彙總，動作按鈕整段搬移非複製、`e2e-real` 四檔零改動）；監造／機關日誌改摘要式唯讀檢視（假可編欄位歸零，廠商視角 DOM 零改動）；/submittals 依 `submittalBall` 分「待我處理／等待對方／已完成」。三包均未改 store 寫入、金額／期限確定性計算、權限條件、RLS 與路由；最新基線 607 Vitest、22 Demo E2E、build 全綠，各包合併後 main CI、Cloudflare build 與正式站冒煙均成功。

W8-5 由 PR #19 交付並部署，W8（W8-1～W8-5）全數完成：手機觸控目標由共用元件一點式解決（`max-sm:min-h-11`，桌機不變；表格內行內輸入為 38px 已知例外）；全站鍵盤焦點可見（`@layer base` 的 `:focus-visible` outline）；修復三個鍵盤陷阱（關閉的抽屜可被 Tab 進入、對話框焦點外流後 Esc 失效、專案切換器同款）與手機照片刪除鈕永不可點的 bug；icon-only 控件補可及名稱、狀態色點補文字語意；`--text-3` 調至 AA 對比（亮 `#636f7b`／深 `#8b97a4`）。

真人驗收（桌機輪）於 2026-08-19 由使用者本人單人自測完成並回填 `docs/W8-5-三角色真實使用者驗收清單-2026-08-15.md` §八（手機輪暫緩）；26 項發現經 11 組唯讀讀碼 triage（P0 交叉驗證）後由 **W8-6（PR #21）交付並部署**：變更設計核定收斂為機關專屬（migration `20260819111252` 重寫 `change_orders_guard`：核准/駁回含撤銷僅機關、核准必經審核中、提出↔審核中＝監造/機關；新 pgTAP `change_order_approval.sql` 13 項角色×轉移矩陣，決策 D-016）；施工日誌 dirty 防護修掉「帶入天氣清空表單」P0 資料遺失、複製昨日補種工項列骨架、公定格式欄位預設展開、唯讀分支預設紙本公定格式（抽 `SiteLogOfficialSheet` 共用，列印頁輸出不變）；請款收款「已收款」需收款日＋實收皆登錄且統計卡只計已核定期別（`src/lib/payments.js` 純函式）；「AI 估驗草擬」正名「帶入日誌累計」（該按鈕本為純確定性引擎，對齊紅線二敘事）；今日待辦補「今天的施工日誌尚未填寫」（開工錨點或既有日誌防誤報，W8-2A 文件同步翻案）；品質缺失手動開立收斂為監造（工安不變、RLS 不動）；另含查驗申請日必填預設今日、查驗履歷篩選、桌機側欄 `md:z-30` 修專案下拉被蓋、驗收期限紅/琥珀分級、佐證包空狀態與非正式計價單常駐警語、建案表單必填＊與「預計開工日」語意、契約基準日補竣工日、標單匯入進度回饋、成員邀請列對齊。基線：64 檔 627 Vitest、30 Demo E2E、production build 全綠；PR 與 main 的 CI＋pgTAP 全綠，migration 已套用至正式庫（remote `20260819111252`），Cloudflare 部署與正式站冒煙成功。驗收中點名但 W8-6 未做的大功能列於 ROADMAP 未排入清單待另立案。

**W8-7（PR #22）交付並部署**：照片先行→AI 填日誌——未存檔即可批次「選照片 AI 辨識後上傳」，確認上傳時自動 upsert 建空白草稿日誌再掛照片（人觸發，紅線一不破）；辨識結果只回填表單（配到的工項自動加列、數量留空，caption 彙整成「AI 草稿:」摘要僅空時預填），落庫仍由人按存檔，與 W8-6 dirty 防護相容。`photos.location`（migration `20260819120000`）＋ classify-site-photo schema/prompt 結構化白板施作區域（只准照抄、嚴禁推測、辨識不到=null、required 保證鍵存在），覆核區可清除 chip、佐證包照片說明前綴區域（`photoEvidenceLine`）。查驗↔自主檢查表縫合：`inspections.checklist_record_id` FK（migration `20260819120100`，on delete set null；pgTAP `inspection_checklist_link.sql` plan 11）；查驗申請可檢附已判定現行版檢查紀錄並在查驗列顯示 chip；檢查表分段對自檢合格的紀錄提供「提出查驗申請」一鍵預填（工項／項目／位置／檢附／申請日，送出仍由人），整鏈任一版已被檢附則顯示「已附查驗」不再給入口。基線：65 檔 640 Vitest、30 Demo E2E、build 全綠；PR 與 main CI＋pgTAP 全綠；兩支 migration 先於前端套用正式庫（remote `20260819120100`），classify-site-photo 以 `--use-api` 重新部署。仍未做：機關模板估驗計價單套版、進度網圖驅動提醒、查驗單正式列印格式（見 ROADMAP 未排入）。

> 以上 W8-1～W8-7 段落中關於側欄六工作面、`/requirements` 畫面、「核定生效」語意與品牌字樣的描述，已被 2026-08-20 之後的改版取代；現況以 §6.2 為準，舊段落保留作為決策脈絡。

### 6.2 2026-08-19 之後的交付（PR #23～#58）

**CI 與品牌**（PR #23、#24）：CI 以 lockfile 的 Playwright 版號快取 Chromium，CDN 劣化不再撞 timeout。品牌字樣改 PMIS 後於 08-25 改回 GovAgent（見 §1）；網址與 repo 名不變。

**W9 Google Workspace 風格改版**（PR #25／#26／#27／#28，08-20～08-21）：純視覺與互動層換殼——token 換值不換名、Noto Sans TC 與 Material Symbols 全面 self-host（零 CDN，CSP `font-src 'self' data:`）、lucide 退場；App bar 搜尋藥丸鈕導 `/agent` 代問；<768 底部導覽、768–1279 icon rail、≥1280 完整側欄；M3 深色全表。W9b 補側欄件數 badge（`useTodayTasks` 為聚合唯一入口，Layout 與 Dashboard 同一份）、`SortableTh`／`FilterChip`／`TablePager`＋`useTable.js`、「AI 今日已代辦」純統計卡、信賴度門檻上色。W9 修正批修掉 P0「手機存檔列被 BottomNav 蓋住」（`--bottom-nav-h`）、71 處觸控目標 `max-sm`→`max-md` 對齊手機層定義、對比 token 過 AA、圖示字型 subset 103KB→15KB。W9c 依統一規範修約 160 項：CHIP／FilterChip 為唯一切換語言、`TaskRow` 待辦列單一渲染、按鈕三級制、表格與輸入回共用元件。四包均未動 `routeRegistry`、roles、slices、RPC、RLS。

**W10 契約期限追蹤鏈精修**（PR #29，08-21）：`_shared/claude.ts` 補 `stop_reason` 檢查（max_tokens 視為失敗）、單次 120s 逾時與 429／5xx 指數退避；`extract-requirements` 分批抽取、逐批落庫、涵蓋率（truncated／stopped_early／clipped／failed_batch）進 metadata、`PROMPT_VERSION` v2；啟動時自動標記逾時 run 失敗，同版本進行中 run 擋重複啟動。監造可上傳契約與勾已提送；`projects.contract_total` 手填契約總價（migration `20260821000100`），罰款試算優先吃手填；手動新增契約重點（manual→needs_review→核定→物化，零 schema 變更）。命名收斂：上游「契約重點」、下游「契約義務」。

**W11 文件管理員獨立**（PR #30，08-21）：側欄「專案文件」抽出為獨立項；`/contract` 依 mockup 重建為上傳＋回饋面板與文件清單（AI 處理四狀態），上傳後自動分類自動歸檔分流；期限追蹤整組併入 `/requirements`，「契約義務」一詞自 UI 退場（PR #46 再拆出 `/deadlines`）。35 agents 審查 29 項全數處理：重試條件收窄回「AI 分析失敗」、needs_review 誠實顯示待確認。無 DB 變更。

**W12 登入與身分**（PR #31／#32，08-21）：登入／建立帳戶頁依 mockup 重建，GSN SSO 移除，「保持登入」為真機制（sessionStorage ephemeral session）；註冊角色卡改 radiogroup＋roving tabindex；e2e-real 選擇器同步。`ensure_project_identity_for` 補「掛在 other 的舊 membership 依 `profiles.org_type` 重掛」修復分支＋一次性資料修復（migration `20260821001000`），前端不再謊稱「稍候幾秒」。

**W13 大文件抽取可續跑**（PR #36／#40／#41／#43，08-21～08-22）：69 頁契約單批必逾時被平台砍成殭屍 run 的死路，改為跨 request 續跑——批次 14k 字元（上限 24 批）、單 request 絕對上限 140s 對齊 Supabase API 閘道 150s 真實天花板、進度與計數快照落庫、`awaiting_continue` 由前端共用接力層帶 `continue_run_id` 續跑；partial unique index 保證同版本最多一條 active run（migration `20260822000100`，23505→409，`run_conflict`／`restart_required` 分流）；stale 判定吃進度心跳（`last_progress_at`）；每個 request 各記一筆 `ai_usage_events`；對半切深度與子批完成 label 持久化（`pending_split_batch`／`pending_split_depth`／`pending_split_done`），修掉兩層活鎖。撤掉重新解析前的建議清理（會誤刪人工編修）；前端 502／504 特判為「進度已保留，稍後重試接續」。

**W14 文件治理四件套**（PR #37／#38／#39／#44，08-22）：確定性分類器沒把握時問 `classify-document`（Haiku），信心 ≥0.8 自動歸檔並照常路由抽取（四紅線齊備：伺服器閘門＋計量＋雙註冊表＋migration `20260822000400`，`documents.classify` min_plan=trial；值域單一真相 `_shared/documentTypes.ts`）；任何終態文件可事後改分類（改成可抽取類型先警告會重跑）；`delete_document` RPC 為唯一刪除路徑（migration `20260822000300`；`documents` 不開 RLS DELETE、`requirement_sources` FK RESTRICT 護佐證鏈、未審 AI 建議隨文件走、`document.deleted` 留痕、storage 只准清孤兒檔；pgTAP `document_delete.sql` 20 案）；300MB 前端預檢與 Storage 超限特判。上傳面板誠實化：總數選檔即定錨、「正在解析標單 XML」只在 boqBusy 出現、可切到其他頁處理不中斷。一次性修正跨部署 run 的顯示計數（migration `20260822010200`）。

**體檢 P1 修正批**（PR #33／#34／#35／#42，08-21～08-22，依 2026-08-21 上線前全案體檢）：`requirements.extract` 開放所有方案（migration `20260821000200`；上傳鏈核心不做方案差異化，差異化留給草稿／審查類）。監造／機關預設落地 `/portfolio`（`navConfig.defaultLandingPath()`，後被 PR #54 精修期改為一律今日待辦）；`public/theme-boot.js` 首繪前套主題（CSP `script-src 'self'` 不允 inline）；`review-submittal`／`audit-summary` 升 Sonnet；`usePagination` 穩定簽章不再被輪詢踢回第 1 頁；查驗不合格自動開缺失的 insert 錯誤不再被吞；Schedule／RiskAudit 勾稽改吃核准變更後數量；機關端補 `/audit` 入口。RFI 兩步繞過修補（migration `20260822000200`：離開已回覆／已結案僅監造可執行、待回覆刪除加驗 `answer is null`；pgTAP `rfi_flow.sql` 20 斷言，紅綠對照證明漏洞可重現）。業務日期「今天」統一台北時區（`src/lib/dates.js`，系統時戳維持 UTC）；photos 凍結防護（migration `20260822010000`：已核定估驗涵蓋或契約重點連結的照片擋刪擋洗欄位，pgTAP 41）與 `profiles` select 收斂為自己＋共案成員＋平台管理員、逐欄授權（migration `20260822010100`，pgTAP 19；**部署順序必須先前端後 db push**，舊前端 `select('*')` 會撞 42501）；`friendlyError` 收斂 22 頁約 110 處 raw `error.message`，`errorLeak.scan.test.js` 掃描式防回歸；照片上傳壓縮（長邊 2000px）＋零依賴 EXIF 回填 taken_at／GPS；10 頁 16 個空狀態補 PageHeader；手機語意斷點 640→768。體檢誤報（已由 W10／W11 修）與刻意跳過項列於 ROADMAP 未排入。

**契約重點改版系列**（PR #45～#55，08-24～08-25）：

- PR #45 文件清單「看上傳的檔案」：私有 bucket 一次性簽名 URL 預覽、blob 下載還原中文檔名（storage 對非 ASCII 檔名回百分比編碼）、下載開放所有可讀成員、`runFileLanded` 單一落地訊號、`log_document_access` RPC 讀取留痕（migration `20260824000100`，fail-closed，pgTAP 9；新增 `e2e-real/file-viewing.spec.js`）。
- PR #46 `/requirements` 重建為契約條文檢索頁（搜尋＋狀態快篩＋類型／階段下拉 AND、文件序、每頁 50 條、300 筆上限誠實揭露、sticky 詳情、「開啟原文」走留痕 RPC、`?highlight` 深連結）；檢索範圍只濾待審 AI 建議，已審決內容不受最新 run 限制。期限追蹤獨立為 `/deadlines`（時間軸、已提送＋佐證、罰款試算、基準日與契約總價、列印對照表）。PR #47 契約重點頁移除頁內分頁條（`pageTabs:false`）、檢索加頻率維度（`requirementFrequencyKey`）。
- PR #48 頻率值域擴充 daily／weekly／monthly／quarterly／yearly：抽取逐型 `frequency_config` 驗證（值域外欄位丟棄不整項否決）、`PROMPT_VERSION` v3；`contract_obligations` 加 `recurring_weekday`／`recurring_month`，物化逐型映射（migration `20260824000200`，已套用正式庫，extract-requirements／agent-run／send-reminders 已重佈）；前端／Edge 兩份 `contractDue` 支援新循環（缺必要欄位回 null）；規則文字共用 `formatObligationRule`。
- PR #49 契約分級可見性補完（D-018，migration `20260824000900`）：`contract_obligations` SELECT／UPDATE 依 requirement 可見範圍（AI 走出處鏈、手動走歸包、都無＝全案 legacy）；`requirements.contract_package_id` 手動補登歸包（guard：同專案＋不可歸入無權讀取的包）；`can_read_requirement_scope`／`can_read_requirement_row` 五張表共用；pgTAP `contract_grading_completion.sql` 15。
- PR #50 收編正式庫已由 MCP 直接套用、repo 沒有檔案的 `20260824123253`（行銷站 Demo 申請表 `demo_requests`），解除 db push 阻擋。
- PR #51 D-017 語意改版（待核定→待確認、核定生效→確認無誤、已生效→已確認、駁回→不採用；估驗／變更設計的「核定」是另一業務語意未動）與確定性轉錄分流（migration `20260824130000`：引文 sourceVerify 逐字＋期限數字交叉核對，含中文數字與民國年、「140 不放行 14」錨定防誤配；兩關全過由 DB 函式自動確認並照 D-012 物化，任一疑慮標 `triage_doubts` 進人工；歷史 completed run 一次性回填；pgTAP `transcription_triage.sql`）。PR #52 摘要條「期限追蹤」改展開鈕，逐項列出時效性條文（`buildDueList` 進 `contractDue.js`，急迫度排序）；`/requirements/report` 對照報告依使用者指示退場。
- PR #53 D-019 全自動確認（migration `20260825000100`）：AI 從已核定契約整理出的內容全部自動確認歸檔，確定性核對降為透明度註記（「系統核對無誤・自動確認」或「未逐字核對，以契約原文為準」橫幅）；帶疑慮的期限型也物化進期限追蹤，風險已向使用者揭露；人工補登仍由監造／機關確認；「不影響開啟正式模式」不變量保留。
- PR #54 精修期最小表面：側欄只留四入口，其餘工作面 `hidden:true`（見本節盤點）；落地頁一律今日待辦。
- PR #55 `/requirements` 改版為「契約重點 · 履約時程」三方共用檢視頁：審核流程自本頁退場，只剩標記完成、掛佐證、回報 AI 擷取有誤；規則收在 `src/lib/obligationTimeline.js`——可見範圍看角色（廠商＝[廠商]、監造＝[監造,廠商]、機關＝全部），動作與角色無關只看歸屬（`item.who === viewerParty`），三角色共用同版面零 if-else；`VISIBLE` 表是後端依身分過濾前的前端 shim，**不是安全邊界**。版面四塊：履約執行卡（每責任方一張，五狀態加總＝義務總數的稽核不變量有測試釘住）、五段履約期程條、時間軸清單、sticky 詳情；`?obligation=` 深連結、鍵盤快捷、aria-live；四斷點 RWD。

**D-020 履約時程接入全部類型與開工日入口**（PR #56／#57／#58，09-01）：`contract_obligations` UPDATE 政策由 `can_write` 改為只看歸屬——機關自此可標記自己的義務完成，廠商／監造不能跨方改狀態，改 `responsible` 讓渡被擋，admin_override 照舊；`completed_at`／`completed_by` 由 trigger 蓋伺服器時間與操作人，client 送值作廢、退回清空，歷史完成列不回填（migration `20260825120000`，pgTAP 27）。準時率改「應完成項準時率」：分子＝完成時間 ≤ 到期日、分母＝已完成＋已逾期，遲交補完成永遠留在分母。D-020：D-012 轉接器更名 `materialize_requirement_obligation`，任何已核定 Requirement 都物化一列義務（正式庫實測 106 條核定項只有 15 條期限型進 timeline、91 條卡住）；無時點型別為「未觸發」無到期日義務，期程段照 `lifecycle_phase` 歸位；`apply_transcription_triage` 與 `review_requirement` 不再分型別；既有卡住的核定項一次回填（migration `20260901040000`＋rollback 檔；pgTAP one_way 34、triage 18；前端零邏輯改動）。今日待辦與提醒信只消費推得出到期日且七日內的項目；`/deadlines` 會多出「無期限」列，是否過濾待 UX 決定。PR #58 開工日三入口：履約時程頁「設定基準日」就地展開四個基準日（決標／接獲開工通知／開工／竣工，共用 `AnchorDates`；`anchorGaps` 純函式只算「觸發點映到缺值錨點」的未觸發項，設完必須歸零）、初始化清單擴為五步（第 4 步設定開工日；第 5 步開啟正式模式仍不被任何步驟鎖住，D-014 不動）、建案選填「實際開工日」。不動 DB。

### 6.1 前端資料存取規則

- 跨頁共享、需要同步更新的資料放 Store。
- 目前直接查 Supabase 的頁面有五個：`Contract`、`Requirements`、`RequirementsReview`、`Activity`，以及 `Dashboard`（只為初始化清單第 1／3 步各查一個 `count: 'exact', head: true`，見 `Dashboard.jsx:93`）。這些資料只在各自頁面使用，因此保留有界的頁面查詢。
- 純計算與重複查詢才放 `src/lib` 或 `src/store/db.js`。
- 同一段查詢沒有重複前，不新增 repository、service 或額外 Store slice。

## 7. 已知架構債

以下是現況，不應在沒有測試保護下直接刪除：

1. **雙成員資料仍保留相近名稱**：W5-3 已用單一架構規則、schema comment 與高風險呼叫點註解降低誤用；為維持相容，未改表名、刪相容 helper 或動 RLS。
2. **雙引擎同步**：W5-4 已修正試體不合格缺失的漏開／重複開漂移；其餘 Demo／前端與伺服器 Trigger／Edge 規則仍有人工同步點，詳見 `docs/architecture/dual-engine-sync.md`。
3. **期限相容層仍存在**：W5-2 已把方向收斂為 approved deadline Requirement → obligation，但時間軸、提醒與部分 Agent 查詢仍讀 `contract_obligations`；它是有 rollback 的 runtime 相容層，不是第二份契約權威。正式站已套用 `20260812000500`，舊的 obligation → Requirement triggers 已退役。 D-020 起所有已核定 Requirement 都物化一列義務，`contract_obligations` 現在是履約時程頁的直接資料來源；方向仍是單向，未改變權威。
4. **履約時程可見範圍仍是前端 shim**：PR #55 的 `VISIBLE` 表與逐筆 `canAct` 尚未由後端依身分回傳。PR #56 已把 UPDATE 政策收到歸屬、D-018 提供 SELECT 分級，安全邊界在 RLS；但前端仍自行過濾可見集合，目標契約是後端逐筆回 `canAct` 後整表刪除。
5. **Migration 回復檔現為 7／57**：PR #60 已補 `20260824130000`、`20260825000100`、`20260825120000` 的 down 檔；本次未演練其回復與重升，不能僅由檔案存在推論可安全還原。
6. **五個工作面處於 hidden**：PR #54 起 `/site-log`、`/quality`、`/valuation`、`/payments`、`/portfolio` 等只能深連結或由今日待辦導入；逐項復出是產品決定，不是技術債，但 E2E 對這些頁的守衛仍在跑。
7. **過時部署仍可公開存取**：`pmis.pages.dev`（舊 Cloudflare 部署，bundle 落後）與 `ryanxxhuang.github.io/PMIS`（GitHub Pages 仍啟用，`gh-pages` 分支停在 2026-08-11，舊品牌）都帶正式 anon key。待關閉 GitHub Pages、刪 `gh-pages` 分支、處理舊 Cloudflare 專案（2026-09-02 健檢列為 P1）。
8. **Edge Function 線上版本未逐支核對**：migration tracker 已於 2026-09-02 核對一致（§6），但 17 支 Edge Function 的線上版本與 `main` 是否一致沒有紀錄，最後一次重佈紀錄是 PR #51；下次動 `supabase/functions/` 時順手以 `supabase functions list` 對帳。

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
