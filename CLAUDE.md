# CLAUDE.md

給 Claude 類 AI 協作者的相容入口。開始前先讀 **`DEVELOPMENT.md`、`CURRENT.md`、`docs/DECISIONS.md`**；本文件只補充 repo 技術地雷，不另立一套開發規則。

---

## 0. 目前續接點（2026-08-13）

- W0～W5 已合併至 `main` 並部署；W6 工作包在 PR #7。不要重做文件基準、標單原子化、初始化流程、單一 Agent、成員／正式模式或 W5 架構債。
- **W5-1 已完成**：唯讀盤點與 A／B 代價見 `docs/W5-1-Requirement-Obligation-決策書.md`。
- 使用者已選 A（D-012）：`requirements` 是唯一權威，approved deadline Requirement 單向產生 obligation；obligation 執行狀態不反向改寫 Requirement。
- **W5-2～W5-4 已由 PR #6 部署，不要重做**：Requirement 單向 migration／rollback、legacy caller 退場、成員模型防誤用，以及試體缺失 Demo／DB 漂移修正均已完成；PR 審查補上 supersede 不得殘留待辦提醒的回歸，保留資料與歷史但從現行前端／Agent 清單排除。最新基線為 523 Vitest、12 E2E、723 pgTAP；正式資料庫已到 `20260812000600`，引用共用工具的 `agent-run` v9／`send-reminders` v10 也已部署。下一工作包是 W6，開始前仍要依 `docs/ROADMAP.md` 的單格範圍執行。
- **W6-1～W6-5 已在 PR #7 完成真後端測試基建與四條業務鏈**：獨立 `playwright.real.config.js`／`e2e-real/`、staging-only 防呆、環境變數注入、登入與四條鏈均已在一次性本機 Supabase 通過，fixture 與 Storage 殘留 0。W6-4 的人工待審 fixture 會綁定真上傳文件版本，但本機沒有 Edge runtime／Anthropic key，**不包含 `extract-requirements` live AI 成功路徑**；不得把 5/5 說成外部模型串接已驗證。細節見 `docs/REAL_BACKEND_E2E.md`。
- 正式庫 preflight：65 obligations／113 requirements／48 筆差額；差額全是未核定建議，orphan legacy = 0、approved deadline 缺 obligation = 0。
- 每次續接仍以 `docs/ROADMAP.md` 的未排入清單與使用者新核准範圍為準；新工作包從最新 `main` 建立，不沿用已合併分支。

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
- **導覽單一真相**：`src/lib/navConfig.js`（側欄／路由守衛／分頁列共用；`hidden: true` ≠ 移除權限）
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
