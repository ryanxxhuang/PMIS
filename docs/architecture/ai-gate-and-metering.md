# AI 功能閘門與用量計量（第四條紅線的執行機制）

> 狀態：**CURRENT** ｜ 最後核對：2026-09-11（分支 `refactor/product-wide`，以程式與 migration 為證據；線上 `ai_features` 現值未重核）
> 對應程式：`supabase/functions/_shared/aiGate.ts`、`gatePolicy.ts`、`aiHandler.ts`、`aiFeatures.ts` ↔ `src/lib/aiFeatures.js`、`src/store/slices/projects.js`（`aiEnabled`）、`src/store/slices/admin.js`、`src/pages/web/Admin.jsx`
> 對應 migration：`20260728000000_platform_admin.sql`、`20260728000100_ai_platform.sql`、`20260812000300_retire_assistant_chat.sql`、`20260821000200_requirements_extract_open_all_plans.sql`、`20260822000400_ai_classify_document.sql`、`20260822010100_profiles_select_scope.sql`
> 決策依據：[`../DECISIONS.md`](../DECISIONS.md) D-008（唯一對話入口）、D-010（fail-closed）。本文件寫**機制怎麼運作**；為什麼這樣定看 DECISIONS。

## 1. 這層在守什麼

CLAUDE.md §2 第四條紅線：每個 AI 功能都是可獨立開關的模組。這條紅線不是靠前端藏按鈕，而是靠三件事一起成立：

1. **註冊表**：功能有身分（`feature_key`），沒登記的 key 在執行期一律被擋。
2. **伺服器端閘門**：每支 AI Edge Function 進入業務邏輯前先問資料庫「這個專案現在能不能用這個功能」。
3. **用量記帳**：每一次呼叫（成功、失敗、被擋）都落一筆 `ai_usage_events`，讓平台能回答「誰、哪個專案、哪個功能、燒了多少 token 與美金」。

平台管理員（`profiles.is_platform_admin`）是產品營運角色，不是工程專案的第四方；它只管功能開關、方案與用量，對任何專案業務資料沒有額外授權（`/admin` 的路由維度見 [`route-registry-governance.md`](route-registry-governance.md)）。

## 2. 三份註冊表：哪一份說了算、為什麼刻意重複

| 位置 | 角色 | 誰讀 |
|---|---|---|
| DB `public.ai_features` | **執行期唯一真相**（`enabled`、`min_plan`、`sort_order`） | `ai_feature_allowed()`、前端 UX 藏按鈕、後台清單 |
| `supabase/functions/_shared/aiFeatures.ts` | 伺服器端靜態中繼資料（`key ↔ edgeFunction` 對應、記帳時反查 `label`） | 所有 Edge Function |
| `src/lib/aiFeatures.js` | 前端顯示用靜態中繼資料（後台分類、標籤） | `Admin.jsx` |

**為什麼 TS 與 JS 各留一份而不是 import**：Deno Edge Function 部署只打包 `supabase/functions/` 目錄，無法 import 專案其他路徑（與 `_shared/agentRole.ts` 對 `src/lib/agentRole.js` 同一個限制、同一個慣例）。兩份的同步不是靠人記得，而是 `src/lib/aiFeatures.test.js` **直接讀取 TS 原始碼**、用正規表達式逐筆抽出 `key/label/category/edgeFunction/minPlan/isLlm/defaultEnabled` 七個欄位與 JS 版逐欄比對——任何一邊漂移測試就紅。因此：

- TS 檔的物件字面量格式（**一列一筆**）是測試解析的契約，改排版等於讓測試炸掉。
- 該測試同時釘住功能總數、key 順序、`PLAN_RANK` 值、非 LLM 功能的集合（目前只有 `weather.fetch` 與 `reminder.daily`）、`defaultEnabled` 例外（退場功能的集合；見下方 `contract.parse` 狀態），以及每個 `edgeFunction` 目錄確實存在於 `supabase/functions/`。**新增功能時這支測試裡硬編的總數要一起改**（見 §10）。

**靜態註冊表的 `minPlan`／`defaultEnabled` 只是 seed 值，不是執行期真相**。migration 用 `on conflict (key) do nothing` 寫入 `ai_features`，重放時不覆蓋後台調過的值；之後的調整是另開 migration `update`（例：`20260821000200` 把 `requirements.extract` 從 `pro` 改為 `trial`、`20260812000300` 把 `assistant.chat` 的 `enabled` 關掉）或後台 RPC。所以「程式裡寫 pro、DB 裡是 trial」是合法狀態，判斷永遠問 DB。

現查方式：

```bash
ls -d supabase/functions/*/                       # Edge Function 目錄
grep -c "key: '" src/lib/aiFeatures.js            # 前端註冊筆數
# 線上真相（需連正式庫）：select key, enabled, min_plan, sort_order from ai_features order by sort_order;
```

**退場功能的做法（只關開關，不刪列、不刪檔）**：`assistant.chat` 由 `20260812000300` 關閉（D-008）；`contract.parse`（`parse-contract`）D-012 起前端已無呼叫者，但 `ai_features.enabled` 一直是 true——任何登入成員仍可直接打 `/functions/v1/parse-contract`，產出繞過 `sourceVerify`／`document_ingestion_runs` 的結果。2026-09-11 重構波次 B5 在工作區以同一手法補關：兩份註冊表 `defaultEnabled: false`、新增 migration `20260911100100_contract_parse_retire.sql`（`update ai_features set enabled = false`）與對應 rollback；伺服器端閘門讀到 `enabled = false` 直接擋並記 `blocked`，不需重佈函式。**狀態：本文件核對時這些改動在工作區尚未提交、未合併 `main`、未套用正式庫**，以該波次落地後的 `ai_features.enabled` 與兩份註冊表為準。退場列一律保留：後台清單與 `ai_usage_events` 歷史要能對到。

## 3. 資料模型（`20260728000100`）

```text
ai_model_pricing      模型 → USD/百萬 token 四價（input/output/cache_read/cache_write），可熱更新
ai_features           功能註冊表：enabled（平台級 kill switch）、min_plan、is_llm、sort_order
projects.ai_plan      trial | standard | pro（既有專案預設 standard）
projects.ai_monthly_token_quota   欄位存在，目前**沒有任何強制邏輯**（migration 註明留待後續批次）
project_ai_overrides  (project_id, feature_key) → enabled：白名單試用或黑名單停用
ai_usage_events       append-only 用量事件；project_id / user_id 皆 on delete set null（帳號或專案刪除後成本仍要留著對帳）
```

方案階序 `trial(0) < standard(1) < pro(2)` 在三處各寫一份：JS `PLAN_RANK`、TS `PLAN_RANK`（測試釘住相等）、DB `ai_feature_allowed` 內的 `case` 表達式（pgTAP `ai_platform.sql` 釘住行為）。

表級權限：四張表都 `enable row level security` 並明確 `revoke insert, update, delete ... from public, anon, authenticated`——原因是基線 migration `20260712001200` 的 `alter default privileges` 會讓**每張新表自動帶寫入授權**，不收回就等於 authenticated 可以偽造用量或改開關。這是本 repo 新增任何表都要重複的動作（CLAUDE.md §5 也提醒）。讀取範圍：`ai_features` 全體 authenticated 可讀（功能名稱與門檻不是機密）；`project_ai_overrides` 專案成員或平台管理員；`ai_model_pricing` 與 `ai_usage_events` **只有平台管理員**（token 用量是跨租戶資料，成員看得到彼此呼叫量會洩漏工作模式）。

## 4. `ai_feature_allowed(p_project, p_feature)`：執行期唯一的「可不可以用」判定

`security definer`、`stable`、grant 給 `authenticated` 與 `service_role`。三段邏輯，順序固定：

1. **平台總開關**：查無 key 或 `enabled = false` → `false`。拼錯 key 也是 `false`，不是 null。
2. `p_project` 為 null（無專案脈絡）→ 只看 `min_plan = 'trial'`（無方案可查，取最保守門檻）。專案不存在 → `false`。
3. **專案覆寫**優先於方案門檻：有覆寫列就回覆寫值。**覆寫翻不過第 1 段的總開關**——kill switch 一關，所有專案含白名單立即停用。
4. 沒覆寫 → 比較 `projects.ai_plan` 與 `ai_features.min_plan` 的階序。

前端 `src/store/slices/projects.js` 的 `aiEnabled(featureKey)` 用同三段邏輯在瀏覽器端重算一次，只為了把已停用功能的入口藏起來；它**不是權限**：未載入或載入失敗一律樂觀顯示，由伺服器最終把關；demo 模式（未設 Supabase）一律 true。

## 5. 閘門的執行流程：`openAiGate`

所有帶使用者 JWT 的 AI Edge Function 都用同一個形狀開閘（`aiGate.ts`）。順序與回應碼：

| 步驟 | 失敗時 |
|---|---|
| 讀 `SUPABASE_URL`／`SUPABASE_ANON_KEY` | 500 `伺服器未設定 Supabase 環境變數` |
| 以呼叫者 `Authorization` 建 `userClient`，`auth.getUser()` | 401 `未登入` |
| `project_id` 必須是 UUID 格式（`requireProject` 預設 true） | 400 `缺少有效的 project_id` |
| 用 `userClient`（套 RLS）讀 `projects` 一列 | 404 `找不到專案或無權限`（看不到＝不是成員；PostgREST 錯誤走 `dbErrorResponse` 遮罩） |
| `userClient.rpc('ai_feature_allowed')` → `gateVerdict` | 403 或 503（見 §6），並先記一筆 `blocked` 用量 |

過閘後回傳 `{ userClient, serviceClient, userId, projectId, startedAt }`。**`userClient` 是業務查詢唯一該用的 client**（自動套 RLS）；`serviceClient` 只給記帳與寫系統管理表（如 `agent_actions`），缺 `SUPABASE_SERVICE_ROLE_KEY` 時為 null 但不讓整支函式失敗。

骨架分兩種（現查：`grep -L aiJsonHandler supabase/functions/*/index.ts` 列出自管本體的函式）：

- **`aiJsonHandler`**（`aiHandler.ts`）：「純 schema ＋ prompt」的函式共用一個 `Deno.serve` 本體——OPTIONS → 解析 body → `openAiGate` → `build()` → `claudeJson` → `closeAiGate` → 回應。`build()` 直接回 `Response`（輸入驗證 400、權限 403 等早退）時**不記帳**，與重構前行為一致；回 `{ reply }`（確定性結果、不打 LLM）記一筆 `ok`、token 為 0。
- **自管本體**：`agent-run`（多輪 tool use）、`extract-requirements`（分批續跑）、`fetch-weather`（非 LLM）、`send-reminders`（cron、無使用者 JWT）。前三支仍呼叫 `openAiGate`；`send-reminders` 以 service role 掃全部專案，逐專案直接呼叫 `ai_feature_allowed('reminder.daily')` 並套同一個 `gateVerdict`，擋下的專案記 `blocked` 後跳過。

## 6. D-010 fail-closed 的確切語意（`gatePolicy.gateVerdict`）

判定抽成純函式（`gatePolicy.ts`，無 runtime 依賴，vitest 可測）而不是寫在 `aiGate.ts` 裡，是因為 `aiGate.ts` 有 `npm:` import 在 Node 端載不進來；`openAiGate` 與 `send-reminders` 都必須走這一支，不得各自判定（B1 之前 `agent-run` 內嵌過第二份閘門，已收斂）。

| `ai_feature_allowed` 的結果 | 判定 | HTTP | `code` |
|---|---|---|---|
| RPC 呼叫**失敗**（DB 故障、RPC 不存在…） | 擋 | 503 | `gate_unavailable`（「為安全起見先暫停服務，請稍後再試」） |
| 正常回 `false` | 擋 | 403 | `feature_disabled`（「此 AI 功能未啟用，請聯絡系統管理者」） |
| `true` 或 `null`／`undefined` | 放行 | — | — |

「查詢失敗」與「正常回 false」刻意分成兩種擋：前者是閘門本身不可用（暫時的），後者是平台或方案的明確決定。前端對 403／503 如實顯示並可重試，不偽裝成離線快答（CURRENT.md §6 W3）。

**為什麼查詢失敗要拒絕而不是放行**：閘門的存在理由是 kill switch 與方案限制；如果 DB 一故障就放行，等於出事時（成本暴衝、輸出品質事故）最需要關閉的那一刻關不掉。D-010 是使用者 2026-08-12 定案，推翻早期的「保守放行」。

**一個要記錄但目前無已知觸發路徑的分支**：`gatePolicy.ts` 的註解寫「`ai_feature_allowed` 對未登記功能回 null 是既有行為」，但 migration 裡的函式對未註冊 key 是 `return false`（§4 第 1 段），不是 null。因此 `null → 放行` 這一格在現行 DB 函式下沒有已知的觸發路徑；什麼情況下 RPC 會回 null 未查證。它是一條寬鬆分支，這裡只記錄、不背書。

## 7. 記帳：`recordAiUsage`／`closeAiGate`——與 fail-closed 相反方向的紅線

閘門是「有疑慮就擋」，記帳是「**任何失敗都不能影響回應**」。兩條方向相反的規則出自同一個理由：閘門守的是失控成本，記帳守的是營運資料——掉一筆用量事件可惜，但因為記帳失敗而擋掉使用者的 AI 回應不可原諒。

機制：

- `recordAiUsage` 內部 `try/catch` 吞掉一切：缺 `serviceClient`（未設 service key）→ `console.error` 後略過；RPC 回錯 → `console.error`；例外 → `console.error`。**絕不 throw**，呼叫端不需要也不應該 `try/catch` 它。`closeAiGate` 外面再包一層 catch 當最後保險。
- 寫入唯一路徑是 `record_ai_usage()` RPC：`security definer`、**只 grant 給 `service_role`**（`authenticated` 若能呼叫＝任何人可偽造或灌爆用量）。函式內以呼叫當下的 `ai_model_pricing` 即時計價，改價即生效不需重部署；查無 model 以 0 成本記錄、不失敗（用量事件的完整性優先於成本精確性——成本可事後重算，事件掉了就沒了）。
- 每筆事件帶 `feature_key`、`edge_function`（由 `featureByKey` 反查，查不到就用 feature 字串）、`project_id`、`user_id`、`actor`（`user`／`system`）、`model`、四種 token、`cost_usd`、`duration_ms`、`status`（`ok`／`error`／`blocked`）、`error_code`。
- Anthropic 欄位對應：`cache_creation_input_tokens → p_cache_write`、`cache_read_input_tokens → p_cache_read`。
- 被閘門擋下也記（`status = 'blocked'`，`error_code` 為 `gate_unavailable` 或 `feature_disabled`），這是濫用偵測與「方案門檻擋掉多少人」的原始資料。
- 分批續跑的 `extract-requirements` **每個 request 各記一筆**（暫停待續跑時也先落帳），因為 token 已經花掉；被平台砍掉時最多掉一批在途量。詳見 [`resumable-extraction.md`](resumable-extraction.md)。
- `agent-run` 由 `claudeAgent` 彙總多輪 usage 後記一筆；`send-reminders` 的 `?dry=1` 不記帳。

D-010 的「結果」段同時寫下這條：用量記錄失敗不阻擋 AI 回應，但會寫既有 log 告警；補記後台不在目前範圍。

## 8. 平台管理員：自我升權防護與 bootstrap 名單

- `profiles.is_platform_admin boolean not null default false`；判定函式 `is_platform_admin()` 為 `security definer stable` 無參數（policy 內呼叫不觸發 `profiles` 自身 policy 避免遞迴；planner 以 initplan 快取一次）。
- **自我升權的漏洞在哪**：既有 policy `profiles_update_own` 允許使用者更新自己整列 profile，而表級 UPDATE 是整表授權——沒有額外防護，任何登入者都能把自己的 `is_platform_admin` 改成 true。RLS 管「誰能碰這列」，本 repo 慣例用 trigger 管「誰能做這種欄位變更」：`profiles_guard_platform_admin`（BEFORE UPDATE）在 `is_platform_admin` 有變動、且 `auth.uid()` 不為 null、且呼叫者不是既有平台管理員時 `raise exception '不可自行變更平台管理員身分'`。
- 合法路徑只有兩條：`auth.uid() is null`（service role／migration／SQL console，這是指派管理員的正規路徑）、或既有平台管理員互相指派／卸任。**卸任自己是單向門**——卸下後不能再把自己加回來。
- `platform_admin_bootstrap(email)`：一張名單表，`enable row level security` 且**刻意不建任何 policy**、`revoke all` 表級權限——對 `authenticated` 而言這張表等於不存在（管理員名單本身不該被枚舉）。只有 `security definer` 的 `handle_new_user` 與 service role 讀得到。名單存小寫，比對兩邊 `lower()`。
- 為什麼要名單表而不是直接 `update`：名單內的 email 可能**之後才註冊**。`handle_new_user` 建 profile 時查這張表，晚註冊也自動成為平台管理員。**安全關鍵**：`is_platform_admin` 絕對不從 `raw_user_meta_data` 取值——那是註冊者自己送上來的。
- `20260822010100` 把 `profiles` 的 SELECT 收斂為「自己＋共案成員＋平台管理員」並逐欄授權，`is_platform_admin` 欄位一併收掉（就算是共案成員也不該看到誰是管理員）；前端改問 `is_platform_admin()` RPC（`store/slices/admin.js`），不直讀欄位。
- 後台 RPC（`admin_ai_usage_*`、`admin_set_feature_enabled`、`admin_set_feature_min_plan`、`admin_set_project_plan`、`admin_set_project_override`、`admin_list_projects_for_ai`）共同模式：`security definer` ＋ **第一行 `is_platform_admin()` 守門 raise**，`grant execute` 給 `authenticated`（守門在函式內，不在 grant 層），與 `resolve_agent_action` 同一種「窄門」慣例。時間區間半開 `[p_from, p_to)`；逐日彙總以 `Asia/Taipei` 切日。
- 留痕取捨：平台級變更**不寫** `record_audit_event`——`audit_events` 綁 `project_id`，平台設定不屬於任一專案；改以 `ai_features.updated_at`、`project_ai_overrides.updated_by/updated_at` 留痕，用量真相另有 append-only 的 `ai_usage_events`。

## 9. 測試釘住

| 測試 | 釘什麼 |
|---|---|
| `src/lib/aiFeatures.test.js` | 兩份註冊表逐欄一致、總數、順序、`PLAN_RANK`、非 LLM 集合、`defaultEnabled` 例外、`edgeFunction` 目錄存在、key／目錄不重複 |
| `supabase/functions/_shared/gatePolicy.test.ts` | `gateVerdict` 三種結果與 HTTP／code |
| `supabase/tests/ai_platform.sql` | 結構與表級權限契約、bootstrap 升級與自我升權被擋、`record_ai_usage` 計價與唯一寫入路徑、`ai_feature_allowed` 三段邏輯（含 kill switch 蓋過覆寫）、`admin_*` 守門與行為 |
| `supabase/tests/ai_features_retired.sql`（B5 工作區新增，本文件核對時未提交） | 退場功能在 DB 側 `enabled = false` |
| `supabase/functions/_shared/errorLeak.scan.test.ts` | 錯誤回應不外洩 PostgREST／Claude 原文（閘門與記帳的錯誤路徑也在掃描範圍） |

## 10. 新增一個 AI 功能的完整路徑

以 W14 的 `documents.classify`（`20260822000400`）為既有範例。

1. **兩份註冊表各加一列**（`src/lib/aiFeatures.js`、`_shared/aiFeatures.ts`），七個欄位逐字相同，**保持一列一筆的排版**；`edgeFunction` 必須是 `supabase/functions/` 底下真實存在的目錄名。
2. **改 `src/lib/aiFeatures.test.js` 裡硬編的總數**（`toHaveLength(N)` 與 `new Set(...).size`），否則測試紅。
3. **新增 migration** 把該功能 `insert into public.ai_features (...) on conflict (key) do nothing`，決定 `min_plan`、`is_llm`、`sort_order`；若日後要調門檻，另開 migration `update`，不回頭改舊檔。
4. **Edge Function 在伺服器端過閘**：純 schema＋prompt 的用 `aiJsonHandler({ feature, build, finish })`；形狀特殊的自己呼叫 `openAiGate` → 業務 → `closeAiGate`／`recordAiUsage`。只把前端按鈕藏起來不算數。
5. **前端呼叫一律帶 `project_id`**（用量要能歸戶；`requireProject` 預設 true，缺就 400）；入口用 `aiEnabled(featureKey)` 藏已停用功能。
6. **部署**：`supabase functions deploy <name> --use-api`（colima 環境必加）＋ `supabase db push`；順序與寫回 `CURRENT.md` §6 的規則見 [`../operations/deploy.md`](../operations/deploy.md)。
7. pgTAP 若新增 RPC 或 policy 才需要；閘門本身已由 `ai_platform.sql` 覆蓋。

## 11. 已知缺口與未查證

- `projects.ai_monthly_token_quota` 只有欄位，沒有任何強制（超量降級／擋呼叫）；AI 成本硬上限與 rate limit 在 ROADMAP「未排入」清單，先前定案只監看不擋。
- `gateVerdict` 的 `null → 放行` 分支目前無已知觸發路徑（§6）。
- `ai_usage_events` 沒有 `metadata` 欄位，agent 唯讀工具的呼叫軌跡無處可放（紅線三缺口，見 [`agent-tool-boundary.md`](agent-tool-boundary.md) §9）。
- 用量記錄失敗只進 log，沒有補記或告警後台（D-010 結果段已聲明不在範圍）。
- 線上 `ai_features` 的 `enabled`／`min_plan` 現值本次未連正式庫核對。
