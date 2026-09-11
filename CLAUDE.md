# CLAUDE.md

給 Claude 類 AI 協作者的相容入口。開始前先讀 **`DEVELOPMENT.md`、`CURRENT.md`、`docs/DECISIONS.md`**；本文件只補充 repo 技術地雷，不另立一套開發規則。

---

## 0. 目前續接點（2026-09-11）

- **續接依據只有一份：`docs/ROADMAP.md`**——最上面的工作包格是進行中的事、「健檢排程條目的歸宿」是兩份健檢排程的去向（已完成／候選／未排入）、「未排入」是已知但刻意不順手做的清單。兩份健檢報告（09-06、09-07）的排程節已併入 ROADMAP，報告本身只留證據與燈號；本節只指路，不另列清單。
- **目前不在 `main` 上**：工作分支是 `refactor/product-wide`（從 `ui/apple-foundation` 分出），`main` 最後合併的是 PR #62，正式站 `app.gov-agent.ai` 跑的仍是那一版。分支上 20 個 commit **已提交、未合併、未部署**：09-08 契約兩批（`d047437`）、09-11 Apple UIUX 四包（`c848c59`／`2d3068f`／`7aa94e9`／`8b87c9e`）、全案重構 19 個 commit（`b13f469`…`b68bece`，逐 commit 見 ROADMAP 第一格）；D2 文件整併波次（本次）尚未 commit；死碼清理波次另一 session 進行中。
- **兩支 migration 尚未套用正式庫**：`20260911100000_demo_requests_revoke_grants`、`20260911100100_contract_parse_retire`（B5）。合併後先 `supabase migration list --linked` 再 `db push`，套完把版本號寫回 `CURRENT.md` §6.3（DEVELOPMENT.md 完成定義第 3 條）。重構的 B1／B4／B6 都動了 `supabase/functions/_shared/`，部署那次 17 支 Edge Function 要一併重佈（colima 下必加 `--use-api`）；在此之前正式站 API 仍會回 Claude 與 PostgREST 原文（`docs/architecture/error-masking.md` §11）。
- **數字不在這裡**：測試與規模基線一律看 `docs/BASELINE.md`（手動核對快照，含每個數字的指令與核對日期；沒有 CI 自動產生它）。本輪已實跑 Vitest／Demo E2E／pgTAP／build 全綠；**真後端 E2E 未跑**（chain3 金鑰失效，最近紀錄 PR #54）、**`deno check` 未做**（本機無 deno）、正式庫 migration tracker 與 Edge Function 線上版本**未重核**（最後核對 2026-09-02，見 `CURRENT.md` §6.3）。
- **UIUX 已改 Apple style（D-021，2026-09-11 定案）**：單一真相是 `docs/UIUX-Apple-設計規範.md`，W9 的 Google／Material 3 handoff 已標 `SUPERSEDED`。落地點是收件匣（側欄有「球在誰手上」三個桶，走 `?ball=`）、圖示是 `lucide-react`、字級走七階、列印頁紙面配色集中在 `index.css` 的 `.paper`。寫任何 UI 前先讀那份規範。
- **已定案決策到 D-021**（`docs/DECISIONS.md`）：D-017 契約重點是「確認轉錄」不是「核定生效」；D-019 AI 整理全自動確認歸檔、核對結果只是透明度註記；D-020 任何已核定 Requirement 都物化一列義務（無時點＝「未觸發」）。寫契約重點相關程式前先讀這三條，舊文案「待核定／核定生效」已退場。
- **`/requirements` 是「契約重點 · 履約時程」三方共用檢視頁（PR #55）**，本頁不做審核；規則在 `src/lib/obligationTimeline.js`，可見範圍看角色、動作只看歸屬；`VISIBLE` 表是前端 shim 不是安全邊界。期限管理動作在 `/deadlines`，擷取審核在 `/requirements/review`；契約兩頁共用的清單＋詳情殼在 `src/components/listDetail.jsx` 與 `useListDetailPane`／`useListKeyboardNav`（`8e0fb33`）。
- **側欄仍是精修期最小表面（PR #54）**：工作面只露今日待辦／專案文件／契約重點／標單工項；其餘五個 `hidden: true`（`navConfig.js` 有 5 個定義，`navConfig.test.js` 釘住這個集合；`grep -c` 會數到 6 是因為檔頭註解也含這個字串），定義、角色限制、路由與深連結全部保留。要加回功能＝移除一行 hidden，不要重建導覽。
- **重構後的模組位置**（改到這些地方先讀對應架構文件）：Edge 錯誤遮罩 `_shared/publicError.ts`＋骨架 `_shared/aiHandler.ts`（`error-masking.md`、`ai-gate-and-metering.md`）；agent 工具拆在 `_shared/agentToolDefs`／`agentQueryTools`／`draft*`／`raiseTo`／`ballInCourt`，`agentTools.ts` 只剩分派器（`agent-tool-boundary.md`、`ball-in-court.md`）；`extract-requirements` 的 run 生命週期在 `_shared/ingestionRun.ts`、prompt 與 `PROMPT_VERSION` 同在 `_shared/requirementPrompt.ts`、落庫在 `_shared/requirementPersist.ts`（`resumable-extraction.md`）；契約包讀寫在 `src/lib/packageRuns.js`（`document-processing-pipeline.md`）。
- **部署位置**：App 在 `app.gov-agent.ai`（Cloudflare Workers，push `main` 即部署）；apex `gov-agent.ai` 是 `PMIS.marketing` 的行銷站，App 路由在 apex 會 404，冒煙測試要打 `app.` 子網域。品牌字樣目前是 GovAgent（PR #24 改 PMIS 後於 08-25 改回）。部署流程與地雷見 `docs/operations/deploy.md`。
- 新工作包從最新 `main` 建分支，不沿用已合併分支（遠端仍有 34 條已合併分支未刪）；目前這條重構分支合併前不要再從它分出第二條功能線。

---

## 1. 北極星（所有開發以此為核心）

> **終極目標：政府機關的每一個承辦人，都配一個懂他業務的 AI Agent。**
> 公共工程專案管理是**第一個垂直領域，不是終點**——因為工程是政府業務裡最複雜的一種，
> 撐得起工程的骨架，其他業務都是它的子集。

完整說明：**`docs/北極星-政府機關-Agent-平台.md`**（做任何架構決定前先看那份）

**命名：GovAgent 是最終產品與平台方向；PMIS 是目前公共工程垂直領域的專案名稱。**
目前產品與實作現況以 **`CURRENT.md`** 為準；開發流程與完成定義以 **`DEVELOPMENT.md`** 為準。

**現階段界線：只做公共工程。** 保持平台層的命名與資料模型業務中立，
但**不要**為了假想的未來業務去寫抽象層、外掛機制或 DSL。過早抽象比重寫更貴。

### 分層紀律（每個功能先問它在哪一層）

| 層 | 內容 | 態度 |
|---|---|---|
| **① 平台層** | 多級權限／文件→義務解析／法定期限引擎／佐證鏈／AI 草稿收件匣／稽核留痕／AI 模組開關與計量 | 當產品做，命名業務中立，值得多花時間 |
| **② 領域層** | PCCES 標單、估驗計價、ITP、三級品管、施工日誌 | 換業務就整組換掉，**大方寫死**，不要抽象 |
| **③ 介面層** | 每個專案方一個 Agent 主控台（廠商／監造／機關） | 加業務＝加 persona ＋ 工具白名單 |

角色紅線：專案授權只有廠商／監造／機關三方。現場、品管與工安是廠商內部分工，不得成為 RLS、導覽、Agent persona 或功能開關的角色來源。

判斷準則：**「換成戶政業務也一樣成立」→ 平台層；「換成戶政就沒意義」→ 領域層。**

---

## 2. 四條紅線（違反就毀掉政府客戶的信任）

1. **AI 只產生「草稿」。** 核定／判定／結案／驗收／凍結——agent 的工具箱裡根本沒有這些工具。
   靠**工具白名單**保證，不是靠 prompt 約束。狀態轉移永遠走 DB trigger ＋ 人簽核。
2. **數字永遠由確定性引擎算。** AI 可複述金額，但金額必須由 `boqCalc.js` 等算出、經工具回傳。
   AI 不准自己乘除，不准自己編法規條號。
3. **每個 agent 動作都留痕。** 一律寫 `agent_actions`（角色／種類／目標／理由／佐證／人的覆核結果）。
4. **每個 AI 功能都是可獨立開關的模組。** 見 §3。

---

## 3. 新增 AI 功能的必經流程

1. 在 **`src/lib/aiFeatures.js`** 與 **`supabase/functions/_shared/aiFeatures.ts`** 兩邊註冊
   （值域必須一致，有測試釘住；edge function 部署只打包 `functions/`，所以刻意重複一份）。
2. 在 migration 把該功能加進 `ai_features` 表，設定 `min_plan`。
3. Edge function **在伺服器端**過閘門（`_shared/aiGate.ts`）——只把前端按鈕藏起來不算數。
4. 每次呼叫寫 `ai_usage_events`（功能／使用者／專案／token／成本／狀態）。
5. 前端呼叫一律帶 `project_id`（用量要能歸戶）。

平台管理員在 `/admin` 看用量與開關；`is_platform_admin` 只能由 service role 或既有平台管理員設定
（`profiles` 上有 trigger 擋自我升權，名單走 `platform_admin_bootstrap`）。

---

## 4. 專案速覽

- **Stack**：React 18 + Vite + Tailwind 4 ／ Supabase（Postgres + RLS + Edge Functions on Deno）
- **資料脊椎**：PCCES 標單 → `work_items` 樹；日誌數量 → 估驗 → 請款，全線靠 `work_item_id` 串
- **權限**：伺服器端 RBAC（RLS ＋ 狀態轉移 trigger），前端 `can` 只是 UX，不是安全邊界
- **成員模型**：`project_members`＝授權；`project_memberships`＝契約方身分快照。唯一規則見 `docs/architecture/three-party-role-model.md`
- **路由與導覽單一真相**：`src/lib/navConfig.js` 的 `routeRegistry`／`navGroups`（未登記路由 fail-closed；公開與列印路由必須明確標記；`hidden: true` ≠ 移除權限）
- **UIUX 單一真相**：**`docs/UIUX-Apple-設計規範.md`**（2026-09-11 起全產品 Apple style，取代 W9 Google handoff）。顏色／字級／圓角／材質一律走 `src/index.css` 的 token，不得硬編碼色碼或用 Tailwind 內建調色盤；禁止 `text-[Npx]` 任意字級；改色值要重算對比度並把數字寫回註解。e2e 有 15 條選擇器綁死視覺 class 名（`grep -rn 'contains(@class' e2e/`），其中 **10 條綁圓角**（`rounded-2xl` 7、`rounded-lg` 2、`rounded-xl` 1），另 5 條綁版面 class（`justify-between` 4、`space-y-2` 1）——改圓角只改 `@theme` 的值、不改 class 名
- **Store**：`src/store.jsx` 組合根 ＋ `src/store/slices/*`
- **資料存取**：跨頁共享資料才進 Store；單頁專屬資料可直接查 Supabase；同一查詢重複兩次以上才抽共用層

### 常用指令

```bash
npm test
```

```bash
npm run build
```

```bash
npm run test:e2e
```

```bash
npm run test:e2e:real
```

### 環境地雷

- 全域 `~/.npmrc` 有 `os=linux`，mac 本機 `npm install` 會缺 darwin native binding 導致 `vite build` 爆掉。
  救法：`npm i --os=darwin --cpu=arm64`
- colima 環境下部署 edge function 必須加 `--use-api`：`supabase functions deploy <name> --use-api`
- PostgREST 預設 1000 列上限：所有「載入全部」的查詢都要走 `src/lib/pagedQuery.js` 分頁，否則靜默截斷

### 測試紀律

- 確定性引擎（金額／期限／判定）一律要有 vitest 單元測試
- 權限與狀態轉移一律要有 pgTAP 測試（`supabase/tests/`）——RLS 的漏洞前端測不出來
- commit、push、部署與正式 migration 只在使用者明確要求後執行

---

## 5. 寫程式的風格

- 註解寫**為什麼**，不是做什麼；密度對齊既有檔案（這個 repo 的註解密度偏高，是刻意的）
- 繁體中文、台灣工程用語（估驗、監造、標單、查驗、缺失、送審）
- 已套用 migration 不回頭修改；資料庫變更新增 migration，並清楚處理資料保留、相容與回復
  （新表記得檢查 grants；baseline 的 `alter default privileges` 可能自動授權）
