# 真後端 E2E 操作指南

> 狀態：**ACTIVE**
> 最後更新：2026-08-13
> 範圍：W6 的手動 Supabase staging 測試；不取代快速 Demo E2E。

## 原則

- `npm run test:e2e`：既有 Demo 測試，仍是預設 CI 護欄。
- `npm run test:e2e:real`：真 Supabase 測試，只在本機手動執行。
- 測試目標必須是臨時／隔離環境；設定檔會直接拒絕正式 Supabase URL。
- 帳號與金鑰只放環境變數或未追蹤的 `.env.e2e.real`，不得提交。
- 可使用臨時 Supabase 專案，或用完整 migrations 重建的本機 Supabase；測完刪除臨時專案／帳號。

## 準備

1. 對隔離環境套用完整 `supabase/migrations/`。
2. 建立一個已確認 email 的廠商測試帳號；W6-1 不要求帳號先有專案。
3. 複製 `.env.e2e.real.example` 為 `.env.e2e.real`，填入：

```text
E2E_REAL_SUPABASE_URL=
E2E_REAL_SUPABASE_ANON_KEY=
E2E_REAL_SERVICE_ROLE_KEY=
E2E_REAL_EMAIL=
E2E_REAL_PASSWORD=
```

也可在 shell 直接注入同名變數，不必建立檔案。

## 執行與清理

```bash
npm run test:e2e:real
```

W6-1 冒煙只做登入、session 重整還原與登出，不建立業務資料。W6-2 起的鏈測試會建立臨時帳號與專案,由各 spec 的 afterAll 自動清理(見下)。`E2E_REAL_SERVICE_ROLE_KEY` 只用來建立/刪除 staging fixture 帳號。通過後刪除測試帳號；若使用臨時雲端專案，整個專案刪除，不保留常駐 staging。

若缺少環境變數、URL 無效或誤指向正式 Supabase，指令會在啟動瀏覽器前直接失敗。

## 清理原則(W6-2 起)

- 業務資料一律走產品窄門清理:只列出 `created_by` 等於測試建立者的專案，再由建立者帳號呼叫 `delete_project` RPC(cascade 清全案)；不能刪除該帳號僅受邀加入的專案。不用 service role 直刪資料表——**新版 CLI 的本機 stack 對 `service_role` 沒有資料表 GRANT**(secure-by-default),直刪會 `permission denied`;hosted 專案雖有 grant,仍以真路徑為準。
- 帳號用 admin API 刪(先刪其專案,`projects.created_by` FK 會擋 `deleteUser`)。
- 清理失敗一律 throw:staging 殘留必須大聲失敗,不能靜默留資料。
- fixture email 一律帶時間戳唯一化,重跑不互撞。
- **Storage 物件不隨 DB cascade 刪除**:刪專案前先用 storage API(service key)分頁列完並清除該案物件——`contract-documents` 在 `projects/<id>/` 之下、`photos` 直接以 `<id>/` 開頭(helpers 的 `removeProjectStorage`)；列舉或刪除失敗都直接讓測試失敗。

## W6-4 的驗證邊界

`chain3-requirements.spec.js` 有兩種模式。環境沒有 Anthropic API key 時走 deterministic 模式：驗證真實 Storage／documents／document_versions、綁定該文件版本的待審 Requirement、三方 RLS、人工核定與 D-012 obligation 物化，待審列以人工 fixture 代替 live AI 輸出——這個模式**不是** `extract-requirements` 的 live AI／Edge 成功路徑，單跑它不能宣稱外部模型串接已通過。

環境有金鑰且 Edge 已啟動時走 live 模式，才符合原評估報告「真實 Storage 與 Edge」的完整完成條件。live 模式已於 2026-08-15 在一次性 staging 驗證通過（見下）。

### Live Edge 驗收

前置（2026-08-15 起，皆已查明並固定）：

1. **colima 必須掛載 repo 所在磁碟**。repo 在外接 SSD（`/Volumes/GameSSD`）而 colima 預設只掛 `$HOME`——edge-runtime 容器 bind-mount 到的 functions 目錄在 VM 裡是空的，main worker 因此回報 `failed to determine entrypoint`。2026-08-13 記載的「CLI 2.113.0 boot error」是誤診：同版 CLI 在正確掛載下可正常服務 16 支函式（2026-08-15 實測，edge-runtime 1.74.3）。設定方式：

   ```bash
   colima stop && colima start --mount "$HOME:w" --mount "/Volumes/GameSSD:w"
   ```

2. **本機 service_role 表級權限由 `supabase/seed.sql` 對齊 hosted 平台預設**。hosted 的 service_role 對 public schema 有完整權限；新版 CLI 本機 stack secure-by-default 什麼都沒給，函式的 service client（與其觸發的 trigger）會 permission denied。seed 只在 `supabase start`／`db reset` 執行，不進正式部署。已在跑的 stack 可直接補：

   ```bash
   docker exec -i supabase_db_PMIS psql -U postgres < supabase/seed.sql
   ```

3. 把有效的 `ANTHROPIC_API_KEY` 放進未追蹤的 `.env.e2e.real`（`.env.e2e.real.example` 有註解行）。

4. chain 3 在 live 模式會自動處理 `requirements.extract` 的 `min_plan='pro'` 門檻：以 `platform_admin_bootstrap` 名單 email 在拋棄式 staging 建立平台管理員帳號並呼叫 `admin_set_project_plan`——全程走產品窄門；正式庫上該 email 已註冊、建帳號會大聲失敗，本身就是「別對正式庫跑」的第二道閘。

執行：一個 terminal 啟動函式，另一個跑單條：

```bash
supabase functions serve --env-file .env.e2e.real
npm run test:e2e:real -- e2e-real/chain3-requirements.spec.js
```

只要環境內存在 `ANTHROPIC_API_KEY`，chain 3 就不會建立人工替代資料，而會要求同一文件版本的 `document_ingestion_runs.status = completed`、`origin = 'ai'` 的固定期限 Requirement，以及指回該文件版本的 citation（以 `sourceVerify` 同義的正規化比對，防捏造也不製造假紅燈）；Edge 未啟動、模型失敗或沒有抽出契約明載期限都會讓測試失敗。失敗時錯誤訊息會附上伺服器端 `ingestion_runs.error_message`。成功後仍由 `afterAll` 清除專案、帳號與 Storage。

**目前狀態（2026-08-15）：live 驗收已通過。** 上述前置全部落地並換上有效金鑰後，本機一次性 staging 上真後端 E2E 全套 5/5 通過，且 chain 3 為 live 模式：上傳契約 txt → `extract-requirements` 真呼叫 Anthropic API → `document_ingestion_runs` completed → AI-origin deadline Requirement（trigger fixed、fixed_date 2026-10-31）→ citation 以 `sourceVerify` 同義正規化驗證為契約原文 → 廠商無核定鈕 → 監造以「核定並加入期限追蹤」（`review_requirement` RPC）核定 → D-012 物化 obligation 於 `/contract` 顯示同標題與 2026-10-31。

硬證據：`ai_usage_events` 有 `feature_key='requirements.extract'`、`model='claude-sonnet-5'`、input/output token 非 0（如 2382/575）、`cost_usd` 有值、`status='ok'` 的記帳列。

模型行為記錄：帶期限的「品質計畫送審」條款被模型歸類為 submittal（合理分類），因此 live 斷言錨定在無歧義的純期限條款（工程期限 2026-10-31）。staging 殘留 0（僅冒煙帳號）。上述環境修復已由 PR #20 合併。

## W6-1 基線

2026-08-13 已以完整 migrations 重建的本機 Supabase 作一次性 staging；W7 收尾時重跑 auth 冒煙與四條業務鏈共 5/5 通過，臨時帳號、專案與 Storage 清理後殘留 0。同次 14 條 Demo E2E、530 個 Vitest 與 production build 亦全數通過。

2026-08-15 於本機一次性 staging 再跑一次全套：auth 冒煙與四條業務鏈 5/5 通過，且 chain 3 為 live 模式（真呼叫 Anthropic API，見上）；殘留 0（僅冒煙帳號）。
