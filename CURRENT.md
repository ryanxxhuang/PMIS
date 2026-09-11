# 目前系統現況

> CURRENT｜2026-09-11｜main；全案重構已由 PR #64 合併。
> 包含契約整理、Apple UI、D-022、工安清單／詳情殼，以及全案程式與文件整理；驗證見 [BASELINE](docs/BASELINE.md)。前端已由 main 自動部署；DB／Edge 尚未同步，版本與核對範圍見 §6.3。

## 1. 產品與範圍

GovAgent 讓政府承辦人使用懂業務的 AI Agent；PMIS 是目前公共工程垂直領域的 repo。現階段只做公共工程，不預建其他領域框架。App 在 `app.gov-agent.ai`；`gov-agent.ai` 是另一個 `PMIS.marketing` repo 的行銷站。

## 2. 使用者與授權

專案業務角色只有廠商 `contractor`、監造 `supervisor`、機關 `owner`。現場、品管、工安是廠商內部分工。平台管理員負責營運，不是第四個專案業務角色。

`profiles.org_type` 管三方業務身分；`project_members` 管專案存取與 admin；`project_parties`／`project_memberships` 管契約方身分快照。`project_role` 不作授權。D-022 已將專案管理統一由 `project_members.role='admin'` 決定，`created_by` 僅作稽核／建案用途；migration 尚未套用正式庫。

## 3. 技術層次

React 18、Vite 6、Tailwind 4 SPA；Supabase Postgres／Auth／RLS／Storage／Deno Edge Functions；Cloudflare Workers 靜態資產部署；Sentry 錯誤回報。平台層處理身分、文件、期限、佐證、AI 閘門與稽核；公共工程層處理標單、日誌、品質、估驗與驗收。

## 4. 資料來源

- 工程數量／財務：`work_items` → 日誌數量 → 估驗／請款，品質與佐證以 `work_item_id` 串接。DB 結構以 migrations 為準。
- 文件／履約：`contract_packages` → `documents`／versions／pages → extraction runs → `requirements`／sources → `contract_obligations`。
- 只有 `approved` Requirement 是契約要求權威。所有已確認類型單向物化 obligation，執行狀態、佐證、罰則不反向改寫契約內容；被取代項只將仍待辦的 runtime 標不適用，保留歷史。

## 5. AI 邊界

AI 查詢、彙整、擬稿；業務核定、判定、結案、驗收與凍結由人執行。數字由確定性引擎計算。草稿／動作寫入 `agent_actions` 並由人接受或拒絕。

D-019 的契約轉錄例外：AI-origin 整理全部自動確認，即使有核對疑慮也進履約 runtime；核對是透明度註記，必須揭露原文優先。人工補登仍由監造／機關確認。AI 閘門失敗拒絕服務，用量記帳失敗不阻擋回應。

## 6. 技術與交付狀態

### 6.1 前端

- UI 採 [Apple 規範](docs/UIUX-Apple-設計規範.md)，token 在 `src/index.css`，圖示 `lucide-react`。`listDetail.jsx` 共用清單／詳情殼已供契約兩頁與工安頁使用；列印用 `.paper` 與 `PrintToolbar`。
- `navConfig.js` 是路由／導覽單一真相，未登記拒絕。側欄只露今日待辦、專案文件、契約重點、標單工項；五個 hidden 工作面仍保留角色守衛與深連結。
- 首頁為「現在輪到我／等待對方／今天已完成」單桶收件匣，`?ball=` 選桶；保留最近施工日誌入口。待辦共用 `todayTasks.js`／`useTodayTasks`。
- 預定進度在首頁、進度頁、稽核、監造報告、跨案總覽與 AI 資料共用 `src/lib/progressPlan.js`。沿用月份座標、30 天換算與線性內插；不變更 S 曲線產生或 DB 計算。

### 6.2 驗證

當前結果與指令只見 [BASELINE](docs/BASELINE.md)。單元、Demo E2E、本機真後端 E2E 固定資料模式、pgTAP、17 支 Edge 的 Deno 型別檢查均通過；本輪未動 migration。真模型抽取仍未驗，抽取準確率／召回率未用真契約量測；`completed` 不代表語意正確。真人手機輪與真案三角色實機驗收仍待完成。

### 6.3 正式環境最後核對（不是即時狀態）

- **DB**：2026-09-02 核對遠端 57 筆 migration，最新 `20260901040000`。其後本地新增三支：`20260911100000_demo_requests_revoke_grants`、`20260911100100_contract_parse_retire`、`20260911110000_project_admin_single_source`；依既有紀錄均未套用正式庫，本輪未重核。
- **Edge**：未逐支核對線上版本；最後重佈紀錄是 PR #48／#51。`_shared/` 重構尚未部署；部署時需將 17 支 Edge 一併重佈與核對版本。
- **前端**：2026-09-11 PR #64 合併提交 `8be082a` 的 Cloudflare Workers 建置成功，版本 `fc99c933-32f5-47c6-b0e6-726e50b2956e`。正式首頁已切換新版 JS／CSS，首頁 HEAD 200、七項安全標頭齊全；這不代表登入後業務流程或正式後端已驗證。後續純文件提交可能觸發同功能版本重建。
- **舊站**：2026-09-11 GitHub Pages API 仍回 built，來源為 `gh-pages`；此部署分支保留。`pmis.pages.dev` 最後核對為 2026-09-07，退場待另行處理。
- 部署依 [runbook](docs/operations/deploy.md) 執行；套用後在本節記日期、migration／Edge 版本與驗證。本輪已完成 Git 整併、歷史開發分支清理及前端自動部署；未套正式 migration、未重佈 Edge。

### 6.4 已整併成果

契約整理補頁面完整性、核對例外篩選、載入錯誤與切案防護；Apple token／圖示／字級與收件匣已落地；巨型頁面與 Edge 拆分、錯誤遮罩／AI 骨架共用、日期／金額共用化、lint／測試補強、D-022 及工安清單／詳情殼已提交。後續整理拆開 Admin 的用量／設定面板與人工 Requirement 表單，移除未使用匯出及 Store 空 logger；修正管理設定切案競態與所有類型 Requirement 審核後的 runtime 更新。Edge 型別、文件連結與共用 pgTAP runner 已納 CI。細節從 Git commit／PR 追溯。

### 6.5 主要機制

- 建案後進專案文件。Dashboard 初始化為五步（含開工日）；AI 步驟只看存在 completed run，正式模式不因三方未齊而鎖住。D-014 舊四步條文仍待正式修訂。
- 標單匯入／重設走單一交易 RPC；真正專案與已載入 DB 標單是兩種模式，不能將 Demo 工項寫入真專案。
- `/agent` 是完整 AI 入口，Copilot 是薄入口，`/assistant` 導向 `/agent`。DB `ai_features` 為執行期權威，前端／Edge 各有鏡像。
- 文件：上傳 → 確定性分類（AI 第二意見）→ 契約包 → 抽取。原始檔凍結，私有 bucket，讀取留痕失敗時拒絕；刪檔走 `delete_document` RPC。processing／ingestion 分別有 20／10 分鐘過期時鐘。
- 抽取可跨 request 續跑，逐頁檢查 exact count／連續頁序／page_count；缺頁不開始抽取，無文字／無效輸出／截斷揭露部分完成，partial 契約包不算 ready。24 批上限、OCR 與語意漏抽未解。
- `/requirements` 為三方履約時程，`/requirements/review` 為擷取審核，`/deadlines` 管期限／罰則／基準日。D-018 RLS 保護契約分級；可見範圍的前端 `VISIBLE` shim 仍保留，動作依歸屬。
- 照片辨識只回填日誌草稿，仍須人存檔；查驗可檢附自檢表；試體 28 天不合格與開缺失同交易並去重。`audit_events` append-only。

### 6.6 資料存取

跨頁資料由 `store.jsx`／slices 管理；單頁有界資料可直接查 Supabase。目前直接查詢頁為 Contract、Requirements、RequirementsReview、Activity、Dashboard。契約共用查詢配方在 `useContractEnrichment`，不是共用狀態。重複計算／查詢放 lib；業務日期用 `dates.js`，金額格式用 `format.js`。

## 7. 仍存在的限制

- 前端／Edge 的待辦涵蓋類型與期限條件有差異；機關自有期限未進首頁。循環履約沒有逐期資料。詳見 [雙引擎](docs/architecture/dual-engine-sync.md)。
- 正式且已匯標單的專案缺一般成員頁入口；hidden 工作面要依產品決策復出。
- obligation runtime、雙成員相容欄位與 `VISIBLE` shim 仍有使用端，不可直接刪除。
- rollback 檔僅覆蓋少數，存在檔案不代表回復演練通過。部分領域狀態欄無 CHECK，processing run 無轉移 guard。
- Edge 新遮罩未部署；唯讀 Agent 呼叫軌跡不落庫。其餘已知缺口與待決事項集中 [ROADMAP](docs/ROADMAP.md)。

## 8. 文件權威

流程看 DEVELOPMENT；現況看本檔與程式／migration；目標看 DECISIONS／ACTIVE 架構；續接看 ROADMAP；測試看 BASELINE。UI 規範與長期北極星按任務讀。過期報告／handoff 已移除，原文可用 `git show c39e395:<路徑>` 追溯；不再當現行規格。
