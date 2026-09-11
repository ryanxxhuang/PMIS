> 狀態：**EVIDENCE**（稽核代理原始報告，2026-09-06 唯讀讀碼）。不得作為開發依據。
> 燈號與數字以主報告 [`../全案健檢-2026-09-06.md`](../全案健檢-2026-09-06.md) 的「校正」節為準；本檔保留當日原始判斷，不回頭改寫。

# PMIS 全案健檢 — 維度 E（測試與 CI）＋ 維度 G（營運、上線與合規就緒）

> 稽核日：2026-09-06｜方式：唯讀讀碼／讀文件／`gh api` 查 branch protection｜未執行任何測試、未動任何雲端資源
> 稽核基準 commit：`ba6ab45`（PR #58 合併後）

---

## 總評

- **紅燈 8 項**（P0/P1）：main 無 branch protection、Cloudflare 部署與 CI 完全脫鉤、測試數字文件全面漂移、真後端 E2E 實際上已停跑、無 MFA／帳戶鎖定／帳號停用、AI 成本零上限、無服務條款／隱私權政策、CURRENT/ROADMAP/README 落後 36 個 PR。
- **黃燈 17 項**：17 支 Edge Function 端點零測試、Demo E2E 對真後端零覆蓋、pgTAP 路徑過濾有漏、無 lint/typecheck、Edge 錯誤無集中、cron 失敗無通知、Storage 備份與 restore 演練無證據、資安一覽表 8 項待補（2 項 ❌）。
- **綠燈 5 項**：pgTAP 對 migration 的覆蓋實際上相當完整（33 檔）、零 skip/only/todo、弱斷言極少、採購文案與「SaaS 套裝型」定位一致、平台管理員 bootstrap 有 trigger 防自我升權。

**一句話**：測試本身寫得認真（749 個 vitest、33 檔 pgTAP、零 skip），但**護欄沒有接上出口**——CI 攔不住合併、也攔不住部署，而所有描述測試規模的文件都已經不能用。營運面則是「文件寫得比實作多」：合規對照表列的 8 項待補至今無一項在 repo 內見到落地證據。

---

# 維度 E｜測試與 CI

## E-01｜測試矩陣與文件數字全面漂移｜P1｜🔴

**證據（實測 vs 文件）**

| 項目 | 實際（2026-09-06 實查） | `CURRENT.md:106` | `README.md:152` | 差 |
|---|---|---|---|---|
| Vitest 測試檔 | **71**（`src` 62 ＋ `supabase/functions/_shared` 9） | 63 | 57 | +8 / +14 |
| Vitest 測試數 | **約 749**（src 620 ＋ shared 129） | 607 | 530 | +142 / +219 |
| Demo E2E `test()` | **41**（7 個 spec） | 30 | 14 | +11 / +27 |
| 真後端 E2E spec | **6 檔 6 測**（多了 `file-viewing.spec.js`） | 5 | 5 | +1 |
| pgTAP SQL | **33 檔** | 23 | 23 | +10 |
| migrations | **57 檔** | 36 | — | +21 |
| App 路由 | **38 條**（navRouteRules 24 ＋ nonNav 14） | 36 | — | +2 |

- 實際檔案：`find src -name '*.test.js*'` = 62；`supabase/functions/_shared/*.test.ts` = 9（用 `import { describe, it, expect } from 'vitest'`，被 `vite.config.js:72` 的預設 include 納入 `npm test`）。
- `CURRENT.md:106` 與同檔 W8-6（`CURRENT.md:150` 附近「64 檔 627」）、W8-7（「65 檔 640」）三處數字互相打架，全部都不是現值。
- `docs/REAL_BACKEND_E2E.md:92` 仍寫「14 條 Demo E2E、530 個 Vitest」。

**影響**：`DEVELOPMENT.md:66` 把「數字基線已同步」列為完成定義，這條已經系統性失效。任何新 session 讀 CURRENT.md 決定「要補多少測試」都會用錯基準；對外（機關檢核表、合規對照表引用「18 檔 pgTAP」）給的也是舊數字。

**建議**：把數字從散文抽出來，改成 CI 產生的一行 badge 或 `npm run test -- --reporter=json` 後寫入單一 `docs/BASELINE.md`；CURRENT.md 只引用不重述。**S**

---

## E-02｜頁面層測試覆蓋：34 頁只有 5 頁有測試｜P2｜🟡

**證據**：`src/pages/web/` 共 34 個 `.jsx`，有對應測試檔的只有 5 頁 ＋ 1 支跨頁測試：

| 有測試 | 檔案 |
|---|---|
| Dashboard | `src/pages/web/Dashboard.setupChecklist.test.js` |
| Portfolio | `src/pages/web/Portfolio.exceptions.test.js` |
| Quality | `src/pages/web/Quality.workQueue.test.js` |
| RequirementsReview | `src/pages/web/RequirementsReview.test.js` |
| Valuation | `src/pages/web/Valuation.diff.test.js` |
| （跨頁） | `src/pages/web/pageTabs.earlyReturn.test.js` |

**無任何單元測試的 29 頁**：Acceptance、Activity、Admin、Agent、Alerts、BOQ、ChangeOrders、ChecklistPrint、Contract、Cost、Deadlines、ITP、Members、MonthlyReport、ObligationsPrint、Payments、Progress、ProjectSetup、RFI、Requirements、RiskAudit、Safety、Schedule、SiteLog、SiteLogPrint、Submittals、SupervisorReport、ValuationPackage、ValuationPrint。

**影響**：金流相關的 `Payments.jsx`、`ValuationPackage.jsx`（請款佐證包，W8-6 修過 P0 金額錯誤）與 `Contract.jsx`（改版最頻繁）都只靠 Demo E2E 的少數路徑守著。純函式已抽到 `src/lib`（`payments.js` 等有測試），但頁面層的組裝、早退分支與錯誤處理沒有。

**建議**：不追求逐頁補測；只挑「錢」與「狀態轉移」兩類頁面（Payments、ValuationPackage、Acceptance、ChangeOrders）補頁面層測試，其餘維持由 lib 純函式覆蓋。**M**

---

## E-03｜`src/lib` 引擎覆蓋：51 支中 43 支有測試｜P3｜🟢

**證據**：無測試的 8 支全是 IO/框架 wrapper，非確定性引擎：
`assistantData.js`、`documentFileAccess.js`、`documentIngestion.js`、`exportCsv.js`、`sentry.js`、`supabase.js`、`theme.js`、`useTodayTasks.js`。

`CLAUDE.md` 要求「確定性引擎（金額／期限／判定）一律要有 vitest」——`boqCalc`、`payments`、`penaltyCalc`、`contractDue`、`qc`、`acceptance`、`itp`、`obligationTimeline`、`requirements` 全部有測試檔。**這條紅線守住了。**

**唯一可議**：`documentIngestion.js` 是 W13 續跑抽取的瀏覽器端 driver（跨 request 接力、批次切分），邏輯不平凡卻無測試；`exportCsv.js` 產出對外檔案也無測試。

**建議**：補 `documentIngestion.js` 的批次切分／續跑狀態機測試即可。**S**

---

## E-04｜17 支 Edge Function 端點零測試（`_shared` 有、`index.ts` 全無）｜P1｜🟡

**證據**

- `supabase/functions/_shared/` 有 9 支 vitest 測試：`agent.test.ts`、`agentBrief.test.ts`、`agentRole.test.ts`、`agentTools.test.ts`、`contractDue.test.ts`、`gatePolicy.test.ts`、`integrityAudit.test.ts`、`requirementExtraction.test.ts`、`sourceVerify.test.ts`（共 129 測，確實會被 `npm test` 跑到）。
- **無測試的 `_shared` 模組**：`aiGate.ts`（伺服器端功能閘門本體）、`aiFeatures.ts`、`claude.ts`、`agentPersona.ts`、`documentTypes.ts`。
- **17 支 function 目錄（`agent-run`…`send-reminders`）各自的 `index.ts` 零測試**：`ls supabase/functions/*/ | grep test` 全部 0。
- 無 `deno.json`、無 `deno test` task、CI 無對應 step。

**影響**：`aiGate.ts` 是第四條紅線（伺服器端閘門 ＋ 用量記帳）的**唯一實作點**，卻沒有直接測試；只有 `gatePolicy.ts` 的純判定邏輯有測試。閘門的 fail-closed 行為（D-010）目前靠 `gatePolicy.test.ts` 間接推定，不是端到端釘住。`send-reminders`（每日對全部專案發信、走 service role 繞過 RLS、靠逐查詢 `.eq('project_id')` 做跨案隔離）也沒有任何自動化測試守住那個隔離。

**建議**：不必為 17 支端點各寫測試；優先把 `aiGate.ts` 的 open/close 兩段抽成可注入 client 的純函式並補 vitest（fail-closed、記帳失敗不影響回應兩條），再補 `collectOpenBallItems` 的跨案隔離斷言。**M**

---

## E-05｜pgTAP 對含 RLS/trigger 的 migration 覆蓋｜P2｜🟢

**證據**：57 支 migration 中含 `create policy` / `create trigger` / `create or replace function` 者，逐一對到 pgTAP：

| migration | 對應 pgTAP |
|---|---|
| `20260822010000_photo_evidence_guard` (7) | `photos_storage.sql` |
| `20260822000200_rfi_answered_state_guard` (2) | `rfi_flow.sql` |
| `20260822000300_document_delete` (2) | `document_delete.sql` |
| `20260822010100_profiles_select_scope` (1) | `profiles_select_scope.sql` |
| `20260824000100_document_access_audit` (1) | `document_access_audit.sql` |
| `20260824000900_contract_grading_completion` (7) | `contract_grading_completion.sql` |
| `20260824130000_transcription_triage` (5) | `transcription_triage.sql` |
| `20260825000100_full_auto_confirm` (1) | `transcription_triage.sql`（同檔 9/1 更新） |
| `20260825120000_obligation_ownership_completed_at` (2) | `obligation_ownership_completed_at.sql` |
| `20260901040000_materialize_all_requirement_types` (3) | `requirement_obligation_one_way.sql` ＋ `p0_01_requirement_domain.sql`（皆 9/1 更新） |
| `20260819111252_change_order_approval_owner_only` | `change_order_approval.sql` |

**唯一缺口**：`20260824123253_create_demo_requests.sql:26` 啟用 RLS 但**零 policy**（設計上 fail-closed，只走 service role 寫入），沒有 pgTAP 釘住「anon/authenticated 讀不到」。這張表存的是行銷站來的姓名／機關／email／電話／IP，未來若有人不小心加一條 policy 就會外洩且無測試會紅。

**建議**：補 3 行 pgTAP（anon select 0 列、authenticated select 0 列、insert 被拒）。**S**

---

## E-06｜Demo E2E 只測 demo 模式：多數功能對真後端零覆蓋｜P1｜🟡

**證據**

- `playwright.config.js:25` 明文清空 `VITE_SUPABASE_URL`／`ANON_KEY` → 7 個 spec 41 個測試全在 demoSeed 記憶體資料上跑，完全不碰 Supabase。
- 真後端只有 6 條（`e2e-real/`）：`auth-smoke`、`chain1-onboarding`、`chain2-valuation`、`chain3-requirements`、`chain4-boq-rollback`、`file-viewing`。

**真後端行為零覆蓋的功能面**（有 demo 測試、有 RLS/trigger，但沒有任何真 DB 驗證）：

施工日誌（含照片上傳與 `photos_delete_guard`）、品質查驗與缺失引擎、ITP 檢驗停留點、工安、送審 `submittals`、RFI（含 `20260822000200` 的兩步繞過修補）、變更設計核定（D-016 機關專屬）、請款收款金流閘門、驗收結算、施工月報／監造報表、跨案總覽、風險稽核、`/deadlines` 期限追蹤、`/requirements/review` 擷取審核、`/admin` 平台後台、全部 17 支 Edge Function 的 HTTP 路徑。

**影響**：`CURRENT.md:107` 的「已知架構債 2：雙引擎同步」正是這個缺口的直接後果——Demo 引擎與 DB trigger 各寫一次規則，而 CI 只驗前者。W5-4、W8-2 都各修過一次已發生的漂移，代表這不是理論風險。

**建議**：不擴大 `e2e-real`（跑起來太貴）；改為對「Demo 引擎 vs DB trigger」的規則對照表（`docs/architecture/dual-engine-sync.md`）逐條補**同輸入雙引擎同輸出**的 pgTAP＋vitest 配對測試。**L**

---

## E-07｜精修期 hidden 掉 20 條路由，E2E 仍以深連結全跑；可發現性零測試｜P2｜🟡

**證據**

- `src/lib/navConfig.js:16-54`：2026-08-25「精修期最小表面」把 `/site-log`、`/submittals`、`/valuation`、`/monthly-report`、`/portfolio` 五個工作面（含子頁共 20 條路由）標 `hidden: true`；側欄只剩 `/dashboard`、`/contract`、`/requirements`、`/boq` 四個入口 ＋ `/admin`。
- `e2e/helpers.js:20` 的 `gotoHash()` 直接改 `window.location.hash` → **`e2e/a11y.spec.js:48-62` 的三角色全路由掃描仍逐頁掃 20+ 條已 hidden 的路由**（`/site-log`、`/quality`、`/itp`、`/safety`、`/submittals`、`/rfi`、`/change-orders`、`/valuation`、`/payments`、`/cost`、`/progress`、`/schedule`、`/monthly-report`、`/supervisor-report`、`/acceptance`、`/portfolio`、`/activity`、`/members`、`/audit`）。
- `e2e/contractor.spec.js`、`supervisor.spec.js`、`owner.spec.js` 的業務斷言同樣全走 `gotoHash`。
- `e2e/routes.spec.js:31-33` 只斷言 hidden 項**不渲染**，沒有任何測試斷言「使用者從可見表面能走到這些功能」。

**兩面評價**

- ✅ 好的一面：隱藏不等於刪除，路由與 roles 都保留，且回歸測試仍在跑——`navConfig.js:23-24` 的註解說得對，測試沒有跟著隱藏一起消失。
- ❌ 壞的一面：**41 個 Demo E2E 沒有一個是從側欄／今日待辦點進去的**。記憶裡「施工日誌藏到連擁有者都找不到」正是這類問題，而目前的 E2E 結構在設計上就抓不到它——測的是 URL，不是使用者路徑。

**建議**：加 1–2 條「可發現性」測試：從 `/dashboard` 出發，只用點擊（不許 `gotoHash`）走到施工日誌與估驗計價；走不到就紅。這條測試本身就是「什麼時候該把 hidden 拿掉」的判準。**S**

---

## E-08｜a11y 375px 掃描漏掉新頁面｜P3｜🟡

**證據**：`e2e/a11y.spec.js:17-43` 的 `H1` 對照表有 25 條路由，但 `routeRegistry` 有 38 條。掃描漏掉：

- `/requirements/review`（擷取審核，PR #55 新增，是審核流程的新家）——**改版後最重要的新頁，零 375px 覆蓋**
- `/project/new`（ProjectSetup）
- `/admin`
- 5 條 print 路由（`a11y.spec.js:47` 明文說明 print 不掃，屬有意識的例外）

**建議**：把 `/requirements/review` 與 `/project/new` 加進 `H1` 與三角色路由清單。**S**

---

## E-09｜main 分支無任何保護：CI「只叫不擋」已實測確認｜P0｜🔴

**證據**（`gh api` 實查，2026-09-06）

```
gh api repos/ryanxxhuang/PMIS/branches/main/protection
→ {"message":"Branch not protected","status":"404"}

gh api repos/ryanxxhuang/PMIS/rulesets
→ []
```

`CLAUDE.md` 記憶裡的「pgTAP 已進 CI 但 main 無 branch protection＝只叫不擋」**至今未改，且連 ruleset 也沒有**。

**影響**：`.github/workflows/ci.yml` 與 `pgtap.yml` 是純通知。任何人（含 AI session）都能在 CI 紅燈狀態下合併 PR 或直推 main。搭配 E-12（Cloudflare 直接吃 main），一次紅燈合併 = 一次紅燈上線。

**建議**：開 ruleset，require status checks = `test-and-build` ＋（DB 相關時）`pgtap`，require PR。這是**單一設定、零程式碼、五分鐘**的改動，卻是整份報告投資報酬率最高的一項。**S**

---

## E-10｜pgTAP 只在 DB 路徑變更時觸發，留有兩個漏洞｜P2｜🟡

**證據**：`.github/workflows/pgtap.yml:9-20` 的 `paths` 只含 `supabase/migrations/**`、`supabase/tests/**`、`supabase/config.toml`、workflow 自身。

**漏洞一（題目點名的）**：前端改動改壞 RPC 呼叫參數 → 不觸發 pgTAP。但這其實**不是 pgTAP 該抓的**——pgTAP 測的是 DB 側契約，前端傳錯參數要靠整合測試，而整合測試只存在於手動的 `e2e-real`（見 E-15）。所以真正的缺口是：**「前端 ↔ RPC 的參數契約」在任何自動化流程裡都沒有守衛。**

**漏洞二（未被點名，較嚴重）**：`supabase/functions/**` 不在 paths 內。Edge Function 大量呼叫 RPC 與直接查表（`send-reminders`、`agent-run`、`extract-requirements`），改壞了兩個 workflow 都不會跑 DB 測試。

**建議**：（a）把 `supabase/functions/**` 加進 pgTAP 的 paths；（b）用 `src/store/db.js` ／ Edge function 內的 `.rpc('name', {...})` 呼叫點做一支靜態掃描測試，比對 migration 裡的函式簽章——這是能自動化的最便宜版整合守衛。**M**

---

## E-11｜CI 無 lint、無 typecheck、無 format 檢查｜P2｜🟡

**證據**：`ci.yml:21-45` 的全部步驟＝`npm ci` → `npm test` → `npm run build` → Playwright。`package.json:30-39` 的 devDependencies 內**沒有 eslint、沒有 prettier、沒有 typescript**。

專案內有 `.ts`（`supabase/functions/**`）但沒有 `tsc --noEmit` 這一關；`_shared/*.ts` 的型別錯誤只有在 Deno 部署時才會被發現，而部署是手動的（`--use-api`）。

**影響**：未用變數、拼錯的 import、`.ts` 型別回歸都要靠人眼 review。以這個 repo 的 AI 協作密度（單月 36 個 PR），這是明顯的品質漏斗缺口。

**建議**：先加最便宜的 `tsc --noEmit -p supabase/functions`（Deno 檔可用 `deno check`）；lint 可延後。**S**

---

## E-12｜Cloudflare 部署與 CI 完全脫鉤：CI 紅燈照樣上線｜P0｜🔴

**證據**

- `.github/workflows/` 只有 `ci.yml` 與 `pgtap.yml`，**沒有任何 deploy workflow**、沒有 `wrangler-action`。
- `package.json:15`：`"deploy": "echo \"⚠️ 已改用 Cloudflare Workers 自動部署:push 到 main 即部署(見 wrangler.jsonc)\""`。
- `wrangler.jsonc` 只描述靜態資產目錄，不含任何 gating。

**結論**：部署是 Cloudflare Workers Builds 在 GitHub push webhook 上獨立觸發的，**與 GitHub Actions 的成敗無關**。因此：

1. CI 紅燈 → 仍然部署到正式站 `gov-agent.ai`。
2. E-09（無 branch protection）＋ E-12 疊加 → 從「測試失敗」到「正式站壞掉」之間**一道閘門都沒有**。
3. 亦無回滾 workflow；回滾只能靠 Cloudflare 後台的 rollback 或反向 commit（repo 內無任何文件說明程序）。

**建議**：兩選一——（a）Cloudflare 後台把 build 改為只在 CI 成功的 commit 上跑（Workers Builds 支援 build watch paths / 需搭配 ruleset）；或 (b) 關掉 Cloudflare 自動 build，改由 GitHub Actions 在 `ci.yml` 成功後以 `wrangler deploy` 部署。(b) 較可控，也順便把「回滾＝revert + push」寫死。**M**

---

## E-13｜skip / only / todo 測試｜P3｜🟢

**證據**：`grep -rnE "(it|test|describe)\.(skip|only|todo)|\.fixme|test\.fail" src e2e e2e-real` → **零筆**。

沒有任何被關掉的測試、沒有 `.only` 誤留（`.only` 誤留會讓 CI 只跑一個測試卻仍綠燈，是最危險的一類）。**這一項做得很乾淨。**

---

## E-14｜空洞／弱斷言與 flaky 處理｜P3｜🟢

**證據**

- `not.toThrow()` 只有 2 處，且都是**正當用途**：`src/lib/exifRead.test.js:98`（截斷的 EXIF 不得崩潰）、`src/lib/parsePcces.test.js:118`（BOM 前綴不得崩潰）——兩者都是「不崩潰」本身就是需求。
- `toBeDefined()`／`toBeTruthy()` 全 repo 共 16 處，密度低。
- **未發現只 assert「不 throw」的空測試。**
- flaky 處理是有節制的：`expect.poll` 只出現 3 次，全在 `e2e-real/chain3-requirements.spec.js:100,113,143`（等 AI 抽取非同步完成，**必要**）；`e2e/a11y.spec.js:138` 用 `expect.poll` 等側欄 300ms transition 落定，並在訊息裡寫明原因。
- `playwright.config.js:13`：`retries: process.env.CI ? 2 : 0` — CI 重試 2 次是掩蓋 flaky 的常見手法，但 `ci.yml:24-27` 的註解說明重試是為了 Playwright CDN 下載劣化（2026-08-19 連三次紅燈），並已用版號 cache key 治本。**理由充分且有治本動作，可接受。**
- W8-5 抽屜聚焦：`e2e/a11y.spec.js:228-240` 用的是 `toBeFocused()` 直接斷言，**沒有**有界重試迴圈——記憶中的「有界重試」在現行程式碼裡找不到，已被更乾淨的寫法取代。

---

## E-15｜真後端 E2E 事實上已停跑：文件停在 2026-08-15，金鑰 8/24 起失效｜P1｜🔴

**證據**

- `docs/REAL_BACKEND_E2E.md:3` 標「最後更新 2026-08-13」，內文最後一次成功紀錄是 `:84` 與 `:94` 的 **2026-08-15**（5/5 全綠、chain3 live 模式、`ai_usage_events` 有記帳列）。
- 該文件**完全沒有提到** `e2e-real/file-viewing.spec.js`（2026-08-24 新增，git log `e5f0aa3`）——第 6 條 spec 存在但文件沒收錄，代表 8/15 之後沒有人再依這份文件跑過全套。
- `e2e-real/chain3-requirements.spec.js` 於 2026-08-24（`3f37ee3` D-017 改版）被改過，但沒有任何重跑紀錄。
- 使用者記憶（`pmis-e2e-real-local-stack`）：**「2026-08-24 金鑰仍失效待使用者換」**。
- 本機棧依賴鏈長且脆：`docs/REAL_BACKEND_E2E.md:59-73` 列出三道前置——colima 必須額外掛載 `/Volumes/GameSSD`（repo 在外接 SSD）、本機 `service_role` 要靠 `supabase/seed.sql` 手動補 GRANT、`.env.e2e.real` 要有有效 `ANTHROPIC_API_KEY`（實查該檔確有此鍵，但依記憶已失效）。加上記憶提到的「殭屍 ssh 佔埠」與「smoke 帳號重佈建」。

**影響**：`playwright.real.config.js` 是**唯一**碰真 RLS、真 Storage、真 Edge Function 的測試層。它已經三週沒跑，期間合併了 36 個 PR，其中包含 D-017／D-019／D-020 三次契約重點語意改版、履約時程重構、文件治理四件套、W13 續跑抽取——全部是真後端行為的重大變更。**目前對真後端的信心來源是零。**

**建議**：（1）優先請使用者換 `ANTHROPIC_API_KEY`；（2）把三道前置寫成一支 `scripts/e2e-real-preflight.sh`，跑前自動檢查 colima 掛載、service_role GRANT、金鑰有效性，缺哪一項直接說人話；（3）在 `docs/REAL_BACKEND_E2E.md` 加一行「最後成功執行日」欄位並強制每次更新。**M**

---

# 維度 G｜營運、上線與合規就緒

## G-01｜前端錯誤監控（Sentry）｜P2｜🟡

**證據**：`src/lib/sentry.js:6-25` 實作正確且有隱私意識：

- `:8` `if (!dsn || !import.meta.env.PROD) return` — demo／本機／未設 DSN 皆不送。
- `:15` `replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true })` — 契約／金額／個資不會外流。
- `:18` `replaysSessionSampleRate: 0`、`:19` `replaysOnErrorSampleRate: 1.0` — 只在出錯時錄。
- `public/_headers:33` CSP 的 `connect-src` 已放行 `https://*.ingest.us.sentry.io`。

**缺口**：DSN 是否真的設在 Cloudflare build env、Sentry 是否設了 alert rule、有沒有人在看——**repo 內無證據，待使用者確認**。`docs/上線設定指南-2026-07-16.md:75` 把「Sentry → Alerts 設 email 通知，確認錯誤有人看」列為未打勾的待辦；同檔 `:88` 又說「Sentry DSN 在 build env（部署產物已含）」。

**建議**：確認 alert rule 存在並指向會看的信箱。**S**

---

## G-02｜Edge Function 錯誤無集中｜P1｜🟡

**證據**：`supabase/functions/_shared/aiGate.ts:60,80,82` 的失敗處理一律是 `console.error(...)`；`:42-43` 的註解明說「任何失敗都吞掉並 log，絕不 throw」。全 repo 找不到任何 Edge 端的 Sentry／告警接線。

**影響**：`recordAiUsage` 失敗（＝AI 用量沒記到帳）是**靜默**的。第四條紅線要求「每次呼叫寫 `ai_usage_events`」，但記帳失敗只留在 Supabase function log 裡，沒有人會看到。同理，`send-reminders` 每日跑失敗也只在 log。錯誤要靠人主動去 Supabase Dashboard 翻 log 才看得到。

**建議**：Edge 端接 Sentry（Deno SDK）或最低限度：`recordAiUsage` 失敗時寫一列 `audit_events`，讓失敗留在自己的 DB 裡查得到。**M**

---

## G-03｜send-reminders 排程：只有手動 SQL 範本，失敗無通知｜P1｜🟡

**證據**

- `supabase/cron.sql:19-32`：pg_cron 每日 `0 0 * * *`（UTC）→ 台北 08:00，透過 `net.http_post` 打 `send-reminders`，帶 `x-cron-secret`。
- **這是一份範本，不是已套用的狀態**：`:3-5` 要求使用者手動把 `<PROJECT_REF>`、`<CRON_SECRET>` 換掉再到 SQL Editor 執行。
- `docs/上線設定指南-2026-07-16.md:50` 把「確認 `cron.job` 有 `send-reminders` 排程」列為**未打勾**的待辦。
- 失敗處理：`cron.sql:35` 只留一行註解「執行紀錄：`select * from cron.job_run_details`」——**無任何自動告警**。`send-reminders/index.ts:38-41` 對錯誤的 secret 回 401，但沒人會知道。

**影響**：「你的 agent 早報」是產品對機關／監造承諾的主動提醒能力。排程是否真的在跑、跑失敗幾天了，目前無法在不登入 Supabase Dashboard 的情況下知道。

**建議**：（1）確認正式庫 `cron.job` 實際狀態（本次唯讀稽核不碰雲端，待使用者查）；（2）加一支「昨天有沒有成功寄出」的健康檢查——最便宜做法是 `send-reminders` 成功時寫一列 `audit_events`，再用外部 uptime 服務或第二支 cron 檢查。**M**

---

## G-04｜備份與復原：DB 有、Storage 無證據、restore 演練從未做｜P1｜🟡

**證據**

| 項目 | 狀態 | 證據 |
|---|---|---|
| 原始碼備份 | ✅ | git（repo 為 public，見 G-15） |
| DB 備份 | ✅ Supabase Pro 每日備份、保留 7 天、RPO 24 小時（2026-08-11 升級） | `docs/資安/資通系統防護基準-普通級-符合性對照.md:56` |
| PITR | ❌ 未購（US$100/月），文件已論證附表十不強制 | 同上 `:128` |
| **Storage 物件備份** | **repo 內無證據** | 全 repo grep「備份」無任何 Storage 備份敘述 |
| **restore 演練紀錄** | **repo 內無證據，從未做** | 全 repo 無任何還原演練文件 |
| migration rollback | ⚠️ 部分 | `supabase/rollbacks/` 只有 **4** 支 down.sql，對應 57 支 migration |

**影響**：Storage 存的是照片、契約 PDF、送審文件——**這些是履約證據，比 DB 列更難重建**。Supabase 的 Pro 每日備份是 Postgres 備份，Storage bucket 是否涵蓋需向 Supabase 查證（repo 內查不到）。而「有備份」和「還原得回來」是兩回事，從未演練 = 實質上 RPO/RTO 都是未知數。

**建議**：（1）向 Supabase 確認 Storage 是否在 Pro 每日備份範圍，若否，加一支排程把 `contract-documents` 與 `photos` 同步到 R2/S3；（2）做一次 restore 演練並留紀錄（拉一份備份到臨時專案、驗證資料完整、記下耗時＝實際 RTO）。**M**

---

## G-05｜帳號安全：無 MFA、無帳戶鎖定、無密碼歷史／效期、無帳號停用｜P1｜🔴

**證據**（`docs/資安/資通系統防護基準-普通級-符合性對照.md:66` 逐項）

| 要求 | 現況 | 判定 |
|---|---|---|
| 密碼複雜度 | ✅ 8 碼＋大小寫＋數字＋HIBP 洩漏比對（2026-08-11 經 Management API 查證） | 已達 |
| 不以明文傳輸 | ✅ TLS | 已達 |
| **登入失敗 5 次鎖 15 分鐘** | **無帳戶鎖定機制** | ❌ **明文要求，未達** |
| **密碼效期** | Supabase 無原生，需自建 180 天提醒 | ⚠️ 未達 |
| **密碼不可與前三次相同** | Supabase Auth 無密碼歷史 | ❌ 未達 |
| **帳號停用機制** | 「未找到帳號停用機制」（同檔 `:30`） | ⚠️ 未達 |
| MFA | 全 repo grep `mfa/totp/enroll` **零命中** | 普通級不要求，但為加分項 |

**另外兩項自查發現**

- `docs/上線前-真案-dry-run-檢查清單-2026-07-13.md:29`：正式站 **`mailer_autoconfirm` 目前開著**（註冊免驗證信即生效）。同一份對照表 `:71` 也把這列為查證發現。這代表**任何人用任意 email 字串都能註冊成功並取得已驗證身分**——對「政府機關的承辦人」這個使用者群，這是信任面的硬傷。
- Session：`src/lib/supabase.js:9-29` 有實作「關閉瀏覽器即登出」的 ephemeral 選項（sessionStorage vs localStorage 雙讀），設計得不錯；但**無閒置逾時**（`supabase/config.toml:274-275` 的 `[auth.sessions]` 是註解狀態，且那是本機設定不代表正式站）。`config.toml:168` `jwt_expiry = 3600`。

**影響**：合規對照表結論段列的「真正要補的 8 項」中，帳號安全就佔了 4 項（#1 鎖定、#2 效期、#3 密碼歷史、#8 帳號停用），排程寫「Day 8」。**至今 repo 內看不到任何一項的落地程式碼。**

**建議**：優先序（1）關掉 `mailer_autoconfirm`（設定，5 分鐘）；（2）帳戶鎖定（Supabase Auth Hook 或前端 + `auth.audit_log_entries` 計數，半天）；（3）帳號停用（`profiles.disabled` 欄位 ＋ RLS，半天）；（4）MFA 雖非門檻但便宜，Supabase 原生支援 TOTP，建議一併做掉以擋質疑。**M**

---

## G-06｜Session 逾時｜P2｜🟡

見 G-05 末段。`jwt_expiry = 3600` 但 refresh token 長效；無閒置登出。普通級無明文要求，列為 P2。**S**

---

## G-07｜平台管理員 bootstrap｜P3｜🟢

**證據**：`CLAUDE.md` §3 與 `supabase/migrations/20260728000000_platform_admin.sql`（含 1 個 trigger）：`is_platform_admin` 只能由 service role 或既有平台管理員設定，`profiles` 上有 trigger 擋自我升權，名單走 `platform_admin_bootstrap`。有 pgTAP（`ai_platform.sql`、`profiles_org_type_guard.sql`）。

名單內容為 `ryanxhuang1212@gmail.com`（`docs/上線前-真案-dry-run-檢查清單-2026-07-13.md:26`）。設計正確。

---

## G-08｜AI 成本控制：完全沒有上限，只有事後監看｜P1｜🔴

**證據**

- `grep -n "monthly_limit|budget|cap|spend|quota|上限" supabase/functions/_shared/aiGate.ts _shared/gatePolicy.ts` → **零命中**。
- `src/pages/web/Admin.jsx:40-45` 的六個分頁全是**唯讀報表**：用量總覽、依功能、依專案、依使用者、AI 功能開關、專案方案。`:227-232` 是 Stat 卡（總呼叫數、總成本 USD、不重複使用者／專案），`:251-254` 是每日長條圖。
- 閘門邏輯只有**方案門檻**（`min_plan`），沒有金額或 token 門檻：`aiGate.ts:87` `openAiGate` → `gatePolicy.ts` 的 `gateVerdict`。
- `aiGate.ts:44` `recordAiUsage` 是**純記帳**，且 `:42-43` 明說失敗吞掉不 throw。

**唯一存在的保險**在 repo 外：`docs/上線設定指南-2026-07-16.md:62` 的「Anthropic Console → Settings → Limits 設每月支出上限」——**該項在文件中是未打勾狀態**。

**影響**：一個惡意或失控的迴圈（例如 W13 的續跑抽取在大文件上失控重試）可以無上限燒 Anthropic 額度，系統不會擋，只會在 `/admin` 事後顯示金額。這與記憶中「現階段只監看不擋」的決策一致，但那個決策是在**還沒有付費客戶、還沒有真案大文件**的前提下做的；W13 之後單一文件可能觸發數十次 28k token 的批次呼叫，前提已經變了。

**建議**：（1）立刻在 Anthropic Console 設每月硬上限（5 分鐘，repo 外）；（2）在 `openAiGate` 加一道「本專案本月 `ai_usage_events` 成本 > X 即 blocked」的查詢——閘門位置已經在對的地方，只差一個 SQL 條件。**S–M**

---

## G-09｜法遵文件：無服務條款、無隱私權政策、無 DPA、無 SLA｜P0｜🔴

**證據**

- `grep -rln "隱私|服務條款|使用條款|個資告知|SLA" src/ --include="*.jsx"` → **零命中**。
- `src/App.jsx:132` 只有一條公開頁 `/security`（`pages/Security.jsx`，漏洞回報與應變機制），對應 `public/.well-known/security.txt`（RFC 9116，Contact `security@gov-agent.ai`，Expires 2027-08-11）——**這一項做得好，但它不是隱私政策**。
- `docs/上線設定指南-2026-07-16.md:77`「一頁隱私聲明（存什麼、存哪裡、怎麼刪）」**未打勾**。
- `docs/上線衝刺-課表-2026-08.md:256` 列出「資安與個資說明書——資料儲存位置、加密、備份、**LLM 出境要主動講**、AI 模組可關閉、事故通報」，也未見產出。
- `docs/資安/中央大學-個資委外與境外傳輸-對策.md` 存在（有對策文件），但**沒有轉成產品內的使用者可見頁面或可簽署的 DPA 範本**。
- 已有的書面政策只有一份：`docs/資安/日誌留存政策.md`（v1.0，2026-08-11 生效，ACTIVE POLICY，內容紮實——四類日誌、六個月留存、含 IP）。

**影響**：這是**收第一筆錢之前的硬門檻**，不是 nice-to-have。賣給公務機關必然要附個資委外的安全維護措施說明與資料處理約定；而 LLM 出境（Anthropic API 在境外）在機關的雲端服務評估一定會被問到，目前沒有任何對外可用的書面說明。同時 `docs/資安/中央大學-雲端SaaS採購資安要求-查證結果.md:47` 已查明「資料存取、備份及備援之實體所在地**不得**位於大陸地區，且不得跨境內傳輸」——這條要在文件裡主動證明。

**建議**：三份文件，各一頁：（1）隱私權政策（產品內 `/privacy` 公開路由，比照 `/security` 的做法）；（2）服務條款；（3）個資委外處理約定（DPA）範本 ＋ LLM 出境揭露。第 (3) 份的技術論據已經有了（第四條紅線：AI 功能可獨立關閉），只差寫成對機關的話。**M**

---

## G-10｜採購文案與「SaaS 套裝型」定位一致｜P3｜🟢

**證據**：`docs/採購/中央大學-小額採購簽辦-簽稿範本與法源.md` 的簽稿正文用詞正確：

- `:44`「本案為既有標準訂閱服務**原樣使用**，無客製化開發需求」
- `:46`「**機關不委託開發、不取得原始碼、不驗收程式**，僅按期訂閱使用既有服務」
- `:111-112` 簽稿本文：「機關不委託開發、不取得原始碼、不進行程式驗收…爰不適用『應用軟體或系統開發服務』」
- `:50` 明確標註「這一段一定要寫進簽裡」並說明歸類錯誤的後果

文件內出現的「開發／客製／建置」全部是**否定句**或**在說明為什麼不適用**，沒有一處把自家服務描述成開發案。**與記憶中的採購歸類階梯完全一致。**

**唯一提醒**：文件頭標「DATED TEMPLATE，金額、法源、採購程序與機關格式在送件前都要重查」，且該文件寫於 2026-08-11、對象是中央大學；GTM 已於 2026-08-20 轉向事務所／顧問公司（記憶 `pmis-gtm-pivot-partners`），這份簽稿對新買方不適用，但它自己有標明是 DATED，不算漂移。

---

## G-11｜資安一覽表自評：8 項待補，其中 2 項為明文 ❌｜P1｜🟡

**證據**：`docs/資安/資通系統防護基準-普通級-符合性對照.md` 結論段「真正要補的 8 項」：

| # | 項目 | 對照表狀態 | repo 內落地證據 |
|---|---|---|---|
| 1 | 帳戶鎖定（失敗 5 次鎖 15 分） | ❌ | **無** |
| 2 | 密碼複雜度 | ✅ 2026-08-11 已設；**效期仍未設** ⚠️ | 設定側已做 |
| 3 | 密碼不可與前三次相同 | ❌ | **無** |
| 4 | 弱點掃描 ＋ 修掃出的問題 | ✅ 已做 | `docs/資安/弱點掃描-2026-08-11/` 有兩輪 ZAP 報告（搬遷前 GitHub Pages ＋ 正式站 gov-agent.ai）＋處置對照表；`public/_headers` 已補 CSP/HSTS/XFO/Permissions-Policy/COOP |
| 5 | 系統備份 ＋ RPO | ✅ 2026-08-11 完成 | 見 G-04（Storage 與演練仍缺） |
| 6 | 日誌保留六個月政策 | ✅ | `docs/資安/日誌留存政策.md` v1.0 |
| 7 | 入侵跡象通報程序與窗口 | ❌（結論段列為待補） | **部分**：`/security` 頁 ＋ `security.txt` 有回報窗口，但那是**對外收報**，不是**對機關通報**的程序 |
| 8 | 帳號停用機制 ＋ 帳號管理程序書面化 | ⚠️ | **無** |

**另有 4 項 ⚠️「補文件」**：遠端存取授權文件化與後臺連線監控（`:32`）、日誌處理失效之回應（`:46`）、需求階段安全需求確認（`:85`）、漏洞修復書面流程（`:114`）。

**還有一項機制未收斂**：`:87` 錯誤訊息不外洩——`src/lib/errorMessage.js` 的 `friendlyError()` 機制已建立且有 9 項單元測試（實查 `src/lib/errorMessage.test.js` 存在，另有 `errorLeak.scan.test.js` 做全域掃描），但對照表寫「已套用於登入／註冊／密碼重設（5 處）；**其餘頁面 87 處待收斂**」。`errorLeak.scan.test.js` 的存在暗示後來有補，但對照表未更新——**待驗證**實際收斂比例。

**判定**：8 項中真正完成 3 項（#4 #5 #6），4 項零落地（#1 #3 #7 #8），1 項部分（#2）。**對照表本身標 DATED ASSESSMENT（核對日 2026-08-08），已經一個月沒更新。**

**建議**：把這 8 項變成 repo 內的 checklist 檔並在每次相關 PR 更新；優先做 #1 #8（程式，各半天）與 #7（文件，1 小時）。**M**

---

## G-12｜環境與部署｜P1｜🟡

**證據**

| 項目 | 現況 |
|---|---|
| 部署設定 | `wrangler.jsonc`（Workers static assets，`not_found_handling: single-page-application`）；註解說明得很清楚（`:17-23` 記錄了 `_redirects` 無限迴圈的坑） |
| 環境變數清單 | `.env.example`（2 行）、`.env.e2e.real.example`（5 項＋ANTHROPIC 註解行）；**正式站 build env 的完整清單無單一文件**（`VITE_SENTRY_DSN`、`VITE_SENTRY_ENV`、`VITE_APP_VERSION` 散在 `src/lib/sentry.js`） |
| 常駐 staging | **不存在**。`docs/REAL_BACKEND_E2E.md:37`「若使用臨時雲端專案，整個專案刪除，**不保留常駐 staging**」。改動只有「本機一次性 staging」與「正式站」兩檔 |
| 部署回滾 | **repo 內無任何文件**。無 deploy workflow（見 E-12），回滾只能靠 Cloudflare 後台或 revert commit |
| migration 套用流程 | `supabase/SETUP.md:20-22` 只有 `supabase link` + `supabase db push`；**無 dry-run 步驟、無誰可執行的規範**。`CLAUDE.md` 有「正式 migration 只在使用者明確要求後執行」的口頭規範 |
| migration 漂移前科 | **已發生過**：`supabase/migrations/20260824123253_create_demo_requests.sql:2-5` 記載「此表由另一個工作階段以 MCP `apply_migration` **直接套用到正式庫**，repo 內原本沒有對應檔案，造成 tracker 與檔案目錄漂移、`db push` 被擋」。另有兩次撞號事故（`c148537`、`ecf4db9` 的 commit 訊息） |
| rollback 覆蓋 | `supabase/rollbacks/` 僅 4 支 down.sql / 57 支 migration |

**影響**：沒有 staging ＋ 沒有部署 gating（E-12）＋ 沒有回滾程序 ＝ 每次 push 到 main 都是**直接對正式站與正式庫做未演練的變更**。migration 漂移已經真實發生過一次（且是 AI session 用 MCP 直接寫正式庫造成的），現有防護只有人的自律。

**建議**：（1）migration 套用改為固定流程：先 `supabase db diff --linked` 確認無漂移 → `db push --dry-run` → 才 push；寫進 `supabase/SETUP.md`；（2）把 Cloudflare 的 preview deployment 當輕量 staging（Workers Builds 對 PR 分支可產 preview URL，零額外成本）；（3）寫一頁回滾 runbook。**M**

---

## G-13｜`~/.npmrc os=linux` 地雷未在 repo 內留檔｜P3｜🟡

**證據**

- `ls .npmrc` → **不存在**（repo 內沒有專案級 `.npmrc` 覆蓋全域設定）。
- 唯一記載處是 `CLAUDE.md:103-104`：「全域 `~/.npmrc` 有 `os=linux`，mac 本機 `npm install` 會缺 darwin native binding 導致 `vite build` 爆掉。救法：`npm i --os=darwin --cpu=arm64`」。
- `README.md`、`DEVELOPMENT.md`、`docs/` 皆無此說明。

**影響**：只有讀 CLAUDE.md 的 AI 協作者知道；人類新進者或不同工具鏈會直接撞牆。這是可以用一個檔案永久解決的問題。

**建議**：在 repo 根目錄放 `.npmrc` 明確覆寫（或至少把這段搬進 `README.md` 的環境需求）。**S**

---

## G-14｜文件漂移：CURRENT.md／ROADMAP.md／CLAUDE.md §0／README.md 落後 36 個 PR｜P0｜🔴

**證據**：三份「權威文件」的最後更新點 vs 實際 git 歷史

| 文件 | 自稱最後更新 | 最後記載的 PR | 實際 HEAD |
|---|---|---|---|
| `CLAUDE.md:9` §0 | 2026-08-13 | PR #9（W7 路由治理） | PR #58 |
| `CURRENT.md:97` | 2026-08-14（§6 自稱） | PR #22（W8-7） | PR #58 |
| `docs/ROADMAP.md:3` | 2026-08-19 | PR #22 | PR #58 |
| `README.md:152` | — | PR #9 | PR #58 |

**逐條明顯不符的段落**

1. **路由數**：三份文件都寫「36 條路由」（`CURRENT.md:102`、`:135`、`CLAUDE.md` §0）。實際 `src/lib/navConfig.js` 的 `routeRegistry` = **38 條**（navRouteRules 24 ＋ nonNavRouteRules 14），且新增了 `/deadlines`（`navConfig.js:76`）與 `/requirements/review`（`:79`）兩條 nonNav 路由。

2. **hidden 表面（最嚴重）**：`CURRENT.md:135`（W8-1）仍寫「側欄固定為今日待辦、現場與品質、審查與協作、進度與金流、文件與結案、專案**六個工作面**」。實際 `navConfig.js:16-54` 自 2026-08-25（`a0aa3d0` 精修期最小表面）起**只剩四個扁平入口**（今日待辦／專案文件／契約重點／標單工項），其餘五個工作面 20 條路由全部 `hidden: true`。**這是使用者實際看到的產品表面，文件描述的是三週前的產品。**

3. **預設落地頁**：`CURRENT.md` 描述「機關仍落在跨案總覽」；實際 `navConfig.js:116-118` `defaultLandingPath()` **忽略 orgType，一律回 `/dashboard`**（註解明說跨案總覽暫別側欄）。

4. **D-016～D-020 全數缺席於 CLAUDE.md §0**：`docs/DECISIONS.md` 已有 D-016（變更設計核定權責）、D-017（契約重點語意：確認轉錄而非核定生效）、D-018（契約分級可見性）、D-019（AI 整理全自動確認，**修訂 D-017 的分流門檻**）、D-020（履約時程接入全部契約重點類型）。`CLAUDE.md` §0 只講到 D-013。**一個新 session 讀 CLAUDE.md 會完全不知道契約重點已經改版三次。**

5. **契約重點改版**：`CURRENT.md:149`（W8-3B）描述的 `/requirements` 是「已生效的契約重點 ＋ 值得留意的整理結果 ＋ 可收合完整追溯」。實際 `src/pages/web/Requirements.jsx:637` 的 PageHeader 已是 `title="契約重點" tagline="履約時程"`，審核流程整組遷出到新頁 `/requirements/review`（`RequirementsReview.jsx:1016` `title="擷取審核"`），期限追蹤獨立成 `/deadlines`（`Deadlines.jsx:113` `title="期限追蹤"`）。三頁結構，文件寫的是一頁。

6. **開工日入口**：PR #58（`9de8ad6`「開工日設定三入口：履約期程就地設定＋初始化清單＋建案選填」）在任何文件裡都找不到。

7. **品牌**：`4f5c084`「品牌改名：PMIS.ai → GovAgent」已合併，`e992a59` 把 `send-reminders` 的 `APP_URL` fallback 改為 `app.gov-agent.ai`（實查 `send-reminders/index.ts:50` 確認）。`CURRENT.md:101` 仍寫正式站為 `https://gov-agent.ai`（根網域，非 app 子網域）——**待驗證**何者為現行。

8. **ROADMAP 進度表自相矛盾**：`docs/ROADMAP.md:32` W8-4 仍是 `[ ]` 未勾（「B（監造）進行中」），但 `CURRENT.md:157` 已寫「W8-4B 由 PR #18 交付並部署」。

9. **`supabase/SETUP.md:32`** 寫「50 tables」、「16 Edge Functions」；實際 functions 目錄 **17 支**。

**影響**：`DEVELOPMENT.md:74` 明文規定「遇到文件與程式不一致時，以程式為證據，**立即修正 CURRENT.md**」——這條規則已經連續 36 個 PR 沒有被執行。而 `CURRENT.md:87` 又把自己列為「目前產品定位與現況」的權威來源。**目前這份權威來源是錯的**，而整個開發流程（`DEVELOPMENT.md:11`「開發前依序讀 CURRENT.md」）建立在它之上。這是所有 AI 協作 session 的共同輸入，錯誤會被放大。

**建議**：把 CURRENT.md §6 的敘事式流水帳（W8-1 一路寫到 W8-7，每包一段）**砍掉重寫**——那個格式注定會漂移，因為它要求每個 PR 都追加一段而沒人會回頭改前面的。改成「現況快照」：路由表由 `navConfig.js` 產生、數字由測試產生、決策只列 D-xxx 編號連到 DECISIONS.md。**M（一次性重寫）＋ S（之後維護）**

---

## G-15｜repo 為 public，內含 GTM／定價／客戶名／簽稿範本｜P2｜🟡

**證據**

- `gh repo view --json visibility` → **`"PUBLIC"`**。
- 已追蹤且公開的內部文件包含：`docs/上線衝刺-課表-2026-08.md`（含公司設立進度、資本額討論、`:463` 旋轉門條款風險）、`docs/採購/中央大學-小額採購簽辦-簽稿範本與法源.md`（點名特定機關與承辦層級）、`docs/會議小抄-中央大學營繕組-2026-08-12.md`、`docs/資安/中央大學-雲端SaaS採購資安要求-查證結果.md`、多份全案優化／驗收報告、`docs/pitch/` 全部簡報與截圖。
- `docs/資安/弱點掃描-2026-08-11/` 內含**兩份完整 ZAP 掃描報告**（含正式站 `gov-agent.ai` 的掃描結果）。
- ✅ 秘密本身有守好：`.gitignore` 涵蓋 `.env`、`.env.local`、`.env.e2e.real`、`.env*.save`；`git ls-files | grep env` 只回 `.env.example` 與 `.env.e2e.real.example`（兩份都是範本）。
- `docs/上線設定指南-2026-07-16.md:59` 早已點出這個問題：「Repo 可見性：目前 public——原始碼＋內部策略文件（GTM 盤點、優化報告）全公開」，**未打勾**（該項的解法「搬 Cloudflare」倒是已經做了，但可見性沒改）。

**影響**：金鑰沒外洩（做得對），但商業策略、定價級距、目標客戶名單、承辦人層級分析、以及正式站的弱點掃描報告全部公開可讀。弱點掃描報告尤其敏感——那等於把攻擊面盤點結果送給對手。

**建議**：轉 private（Cloudflare Workers Builds 支援 private repo，當初擋著這件事的 GitHub Pages 已經不用了，`package.json:15` 也證實 gh-pages 流程已停用），或至少把 `docs/資安/弱點掃描-*/` 與 `docs/採購/`、`docs/上線衝刺-*` 移出版控。**S**

---

# 本維度所有檢查項清單

## 維度 E｜測試與 CI

| 編號 | 標題 | 等級 | 狀態 |
|---|---|---|---|
| E-01 | 測試矩陣與文件數字全面漂移（71 檔 749 測 vs 文件 63/607） | P1 | 🔴 |
| E-02 | 頁面層測試覆蓋：34 頁只有 5 頁有測試 | P2 | 🟡 |
| E-03 | `src/lib` 引擎覆蓋：51 支中 43 支有測試，確定性引擎全覆蓋 | P3 | 🟢 |
| E-04 | 17 支 Edge Function 端點零測試；`aiGate.ts` 無直接測試 | P1 | 🟡 |
| E-05 | pgTAP 對含 RLS/trigger 的 migration 覆蓋完整（唯 `demo_requests` 缺） | P2 | 🟢 |
| E-06 | Demo E2E 只測 demo 模式，15+ 功能面對真後端零覆蓋 | P1 | 🟡 |
| E-07 | 20 條 hidden 路由 E2E 仍以深連結全跑；可發現性零測試 | P2 | 🟡 |
| E-08 | a11y 375px 掃描漏 `/requirements/review`、`/project/new` | P3 | 🟡 |
| E-09 | main 無 branch protection、無 ruleset（實測確認） | P0 | 🔴 |
| E-10 | pgTAP paths 過濾漏 `supabase/functions/**`；前端↔RPC 契約無守衛 | P2 | 🟡 |
| E-11 | CI 無 lint、無 typecheck、無 format | P2 | 🟡 |
| E-12 | Cloudflare 部署與 CI 脫鉤，CI 紅燈照樣上線 | P0 | 🔴 |
| E-13 | skip / only / todo 測試：零筆 | P3 | 🟢 |
| E-14 | 弱斷言與 flaky 處理：`not.toThrow` 僅 2 處且正當；重試有治本 | P3 | 🟢 |
| E-15 | 真後端 E2E 事實上停跑（最後成功 2026-08-15，金鑰 8/24 失效） | P1 | 🔴 |

## 維度 G｜營運、上線與合規就緒

| 編號 | 標題 | 等級 | 狀態 |
|---|---|---|---|
| G-01 | Sentry 已接且隱私設定正確；alert rule 無證據 | P2 | 🟡 |
| G-02 | Edge Function 錯誤只 `console.error`，無集中、無告警 | P1 | 🟡 |
| G-03 | send-reminders cron 只有手動 SQL 範本，失敗無通知 | P1 | 🟡 |
| G-04 | DB 有 Pro 每日備份（RPO 24h）；Storage 備份與 restore 演練無證據 | P1 | 🟡 |
| G-05 | 無 MFA、無帳戶鎖定、無密碼歷史／效期、無帳號停用；`mailer_autoconfirm` 開著 | P1 | 🔴 |
| G-06 | Session 有 ephemeral 選項，無閒置逾時 | P2 | 🟡 |
| G-07 | 平台管理員 bootstrap 有 trigger 防自我升權，有 pgTAP | P3 | 🟢 |
| G-08 | AI 成本零上限，`/admin` 只監看不擋；Anthropic Console 上限未設 | P1 | 🔴 |
| G-09 | 無服務條款、無隱私權政策、無 DPA、無 SLA（只有 `/security`） | P0 | 🔴 |
| G-10 | 採購文案與「SaaS 套裝型」定位一致，無開發／客製／建置用語 | P3 | 🟢 |
| G-11 | 資安一覽表 8 項待補，4 項零落地、2 項為明文 ❌ | P1 | 🟡 |
| G-12 | 無常駐 staging、無回滾文件、migration 流程無 dry-run（已有漂移前科） | P1 | 🟡 |
| G-13 | `~/.npmrc os=linux` 地雷只寫在 CLAUDE.md，repo 內無 `.npmrc` | P3 | 🟡 |
| G-14 | CURRENT.md／ROADMAP.md／CLAUDE.md §0／README.md 落後 36 個 PR | P0 | 🔴 |
| G-15 | repo 為 PUBLIC，含 GTM／定價／客戶名／弱點掃描報告（金鑰未外洩） | P2 | 🟡 |

**統計：紅燈 8｜黃燈 17｜綠燈 5｜合計 30 項**

---

## 修法優先序（若只做五件事）

1. **E-09 開 branch protection**（5 分鐘，S）— 讓已經寫好的 CI 真的擋得住。
2. **G-08 在 Anthropic Console 設每月硬上限**（5 分鐘，repo 外）— 唯一能立刻止血的成本防線。
3. **E-12 部署接上 CI**（M）— 與 1. 合起來才是完整的「紅燈不上線」。
4. **G-14 重寫 CURRENT.md §6 為現況快照**（M）— 所有 AI session 的共同輸入，錯了會被放大 36 倍。
5. **G-09 三份法遵文件**（M）— 收第一筆錢之前的硬門檻，不是技術債。

**待驗證項**（本次唯讀稽核無法確認，需使用者提供）：Sentry alert rule 是否存在、正式庫 `cron.job` 是否有 `send-reminders`、Supabase Storage 是否在 Pro 每日備份範圍、`mailer_autoconfirm` 目前是否仍開著、正式站根網域 vs `app.` 子網域何者為現行、`errorMessage.friendlyError()` 實際收斂比例。
