# CLAUDE.md

給 Claude 類 AI 協作者的相容入口。開始前先讀 **`DEVELOPMENT.md`、`CURRENT.md`、`docs/DECISIONS.md`**；本文件只補充 repo 技術地雷，不另立一套開發規則。

---

## 0. 目前續接點（2026-09-11）

- **目前不在 `main` 上**：工作分支是 `refactor/product-wide`。`main` 最後合併的是 PR #62；之後有三批工作已提交但**未合併、未部署**——09-08 契約兩批（commit `d047437`）、09-11 Apple UIUX 四包（`c848c59`／`2d3068f`／`7aa94e9`／`8b87c9e`）、進行中的全案重構波次（`b13f469` 起）。正式站 `app.gov-agent.ai` 跑的仍是 PR #62 的版本。
- **有進行中的已核准工作**（2026-09-02 那句「沒有進行中的工作包」已不成立）：09-07 健檢、09-08 兩批契約工作、09-11 Apple UIUX 改版、本次全案重構（分四到八波：前端碼債、後端錯誤遮罩與骨架收斂、文件事實校正、測試補強）。範圍與進度見 `docs/ROADMAP.md` 最上面兩格。
- **UIUX 已改 Apple style（D-021，2026-09-11 定案）**：單一真相是 `docs/UIUX-Apple-設計規範.md`，W9 的 Google／Material 3 handoff 已標 `SUPERSEDED`。落地點是收件匣（側欄有「球在誰手上」三個桶，走 `?ball=`）、圖示是 `lucide-react`、字級走七階。寫任何 UI 前先讀那份規範。
- **已定案決策到 D-021**（`docs/DECISIONS.md`）：D-017 契約重點是「確認轉錄」不是「核定生效」；D-019 AI 整理全自動確認歸檔、核對結果只是透明度註記；D-020 任何已核定 Requirement 都物化一列義務（無時點＝「未觸發」）。寫契約重點相關程式前先讀這三條，舊文案「待核定／核定生效」已退場。
- **`/requirements` 現在是「契約重點 · 履約時程」三方共用檢視頁（PR #55）**，本頁不做審核；規則在 `src/lib/obligationTimeline.js`，可見範圍看角色、動作只看歸屬；`VISIBLE` 表是前端 shim 不是安全邊界。期限管理動作在 `/deadlines`。
- **側欄仍是精修期最小表面（PR #54）**：工作面只露今日待辦／專案文件／契約重點／標單工項；其餘五個 `hidden: true`（`navConfig.js` 有 5 個定義，`navConfig.test.js` 釘住這個集合；`grep -c` 會數到 6 是因為檔頭註解也含這個字串），定義、角色限制、路由與深連結全部保留。要加回功能＝移除一行 hidden，不要重建導覽。
- **部署位置**：App 在 `app.gov-agent.ai`（Cloudflare Workers，push `main` 即部署）；apex `gov-agent.ai` 是 `PMIS.marketing` 的行銷站，App 路由在 apex 會 404，冒煙測試要打 `app.` 子網域。品牌字樣目前是 GovAgent（PR #24 改 PMIS 後於 08-25 改回）。
- **正式庫 migration 最後一次核對是 2026-09-02**：當時本機 57 支＝遠端 57 筆，遠端最新 `20260901040000`；之後未重核，Edge Function 線上版本從未逐支核對。每次套 migration 或重佈 Edge Function，版本號要寫回 `CURRENT.md` §6（DEVELOPMENT.md 完成定義第 3 條）；動 DB 前先跑 `supabase migration list --linked` 看一眼。
- **基線（2026-09-11 本機實測）**：72 檔 818 Vitest、48 Demo E2E、production build 全綠，`npm audit --omit=dev` 0 漏洞。**Vitest 由 09-08 的 73 檔 820 降為 72 檔 818，是 `8b87c9e` 刪掉 `src/lib/iconFont.test.js`（2 個測試）隨圖示字型工具一起退場，不是測試遺失。** pgTAP 33 檔、`plan()` 加總 927 條是靜態統計，本輪未實跑；真後端 E2E 最近紀錄仍是 PR #54（6/6）。
- 續接以 `docs/ROADMAP.md` 最上面兩格與未排入清單、加上使用者新核准範圍為準；新工作包從最新 `main` 建分支，不沿用已合併分支（遠端仍有 34 條已合併分支未刪）。

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
