# 測試與規模基線（唯一出處）

> 狀態：**ACTIVE（手動核對快照）**
> 核對日期：2026-09-11 ｜ 分支 `refactor/product-wide` @ `b68bece`（重構最後一個 commit；未合併 `main`、未部署）
> 核對方式：由人在本機執行 §1／§2 的指令得出，**沒有 CI 自動產生這份檔案**（09-06 健檢 E-01 建議由 CI 產出單一 BASELINE，尚未實作；目前是手動快照）。數字會隨 commit 過期：改動測試、migration、Edge Function、頁面檔或架構文件的人，要重跑對應指令並改這一份，同時改檔頭的核對日期與 commit。
> 用途：`CLAUDE.md` §0、`README.md`、`CURRENT.md` §6、`docs/ROADMAP.md` 不再各抄一份數字，一律連到這裡。日期式報告與當日快照裡的數字是當時證據，不回頭改（`DEVELOPMENT.md` §7）。

## 1. 測試（2026-09-11 本機實跑）

| 層 | 結果 | 指令 | 備註 |
|---|---|---|---|
| Vitest | **90 檔 1081 測試**全過 | `npm test` | 含 `src/` 與 `supabase/functions/` 兩個範圍 |
| Demo E2E（Playwright） | **48 tests in 8 files** 全過 | `npm run test:e2e` | 三角色／路由／無障礙／RFI／送審球權／契約流程 |
| pgTAP | **40 檔 1048 條斷言**全過 | 本機 `supabase db reset`（從零套用全部 migration）後照 [`../supabase/SETUP.md`](../supabase/SETUP.md) 跑 `supabase/tests/*.sql`；CI 跑法見 `.github/workflows/pgtap.yml` | 靜態交叉核對：`grep -ho "plan([0-9]*)" supabase/tests/*.sql`（`plan()` 加總應等於實跑斷言數） |
| ESLint | **0 error 0 warning** | `npm run lint`（`eslint . --max-warnings 0`） | 2026-09-11 導入；只開會抓到真 bug 的規則，`supabase/functions/` 排除（Deno，該走 `deno check`） |
| production build | 通過 | `npm run build` | 主 bundle 仍有大於 500 kB chunk 警告（已知，見 ROADMAP 未排入） |
| 真後端 E2E（6 條，`e2e-real/`） | **本輪未跑** | `npm run test:e2e:real`（環境見 [`REAL_BACKEND_E2E.md`](REAL_BACKEND_E2E.md)） | chain3 需有效模型金鑰，目前失效；最近一次成功紀錄 PR #54（6/6，2026-08-25） |
| Deno 型別檢查 | **未做** | `deno check supabase/functions/**/*.ts` | 本機無 deno；重構期間 17 支 Edge Function 只過 esbuild bundle。B6（`c620fd5`）發現舊型別標註錯誤，暗示線上版本從未過 `deno check`（ROADMAP 未排入） |
| `npm audit --omit=dev` | 0 漏洞（2026-09-11 前次核對） | `npm audit --omit=dev` | 含 dev 依賴有 2 個 moderate（`@vitest/mocker`），修復需升 vitest 大版 |

## 2. 規模（2026-09-11，檔案計數）

| 項目 | 數字 | 指令 |
|---|---|---|
| migrations | **60** 支；最新 `20260911110000` | `ls supabase/migrations/*.sql \| wc -l` |
| 其中尚未套用正式庫 | **3** 支：`20260911100000_demo_requests_revoke_grants`、`20260911100100_contract_parse_retire`、`20260911110000_project_admin_single_source`（D-022） | `supabase migration list --linked`（動 DB 前必看） |
| rollbacks（down 檔） | **10** 支（未演練回復） | `ls supabase/rollbacks/*.sql \| wc -l` |
| pgTAP 檔 | **40**（斷言 1048） | `ls supabase/tests/*.sql \| wc -l` |
| Edge Functions | **17** | `ls -d supabase/functions/*/ \| grep -v _shared \| wc -l` |
| `_shared/` 非測試模組 | **29** | `ls supabase/functions/_shared/*.ts \| grep -v '\.test\.' \| wc -l` |
| `src/pages/web/` 非測試 jsx | **34**（另有 `src/pages/Login.jsx`、`Security.jsx`） | `ls src/pages/web/*.jsx \| grep -v '\.test\.' \| wc -l` |
| Store slices | 9 | `ls src/store/slices` |
| 登記路由（`routeRegistry`） | 以程式為準 | `node -e "import('./src/lib/navConfig.js').then(m=>console.log(Object.keys(m.routeRegistry).length))"` |
| AI／整合功能註冊 | 以程式為準 | `node -e "import('./src/lib/aiFeatures.js').then(m=>console.log(m.AI_FEATURES.length))"`；`aiFeatures.test.js` 釘住與 `_shared/aiFeatures.ts` 一致 |
| `docs/architecture/` 文件 | **16** 份 | `ls docs/architecture/*.md \| wc -l` |
| RLS 覆蓋 | **51 張表全部啟用**：49 張有明確 policy 共 143 條，2 張（`demo_requests`、`platform_admin_bootstrap`）刻意零 policy 走 fail-closed | `supabase db reset` 後查 `pg_class.relrowsecurity` 與 `pg_policies`（做法見 [`資安/資通系統防護基準-普通級-符合性對照.md`](資安/資通系統防護基準-普通級-符合性對照.md) 檔頭） |

## 3. 正式環境（本機核不到，只記最後一次核對）

| 項目 | 最後核對 | 狀態 |
|---|---|---|
| 正式庫 migration tracker | 2026-09-02（`supabase migration list --linked`） | 當時本機 57 支＝遠端 57 筆，遠端最新 `20260901040000`。之後新增 §2 的三支**尚未套用**；未重核 |
| Edge Function 線上版本 | 從未逐支核對 | 最後重佈紀錄 PR #48（`extract-requirements`／`agent-run`／`send-reminders`）與 PR #51（`extract-requirements`）；重構的 `_shared/` 改動（B1 錯誤遮罩、B4 agentTools 拆分、B6 extract-requirements 拆檔）**未部署**，正式站仍跑舊行為 |
| 正式站前端 | 2026-09-07 HEAD 檢查 | `app.gov-agent.ai` 首頁 200、七項安全標頭齊全；線上 bundle 為 PR #62 版本 |
| CI 與分支保護 | 2026-09-07 | `main` 有 active ruleset（需 PR、`unit`、`e2e`、`pgtap` —— 2026-09-11 隨 CI 拆 job 同步改名）；pgTAP 自 PR #62 起每個 PR 一律跑；仍允許 RepositoryRole 5 bypass、未要求核准人數與分支先更新 |

## 4. 起點對照（本次重構）

| | 重構起點（`ui/apple-foundation` @ `8b87c9e`，2026-09-11 上午） | 現在（`b68bece`） |
|---|---|---|
| Vitest | 72 檔 818 | 90 檔 1081 |
| Demo E2E | 48（8 檔） | 48（8 檔） |
| pgTAP | 33 檔／`plan()` 加總 927（當時靜態統計） | 40 檔 1048（實跑） |
| migrations／rollbacks | 57／7 | 59／9 |
| 巨型檔 | `agentTools.ts` 1759、`Contract.jsx` 1080、`RequirementsReview.jsx` 1196、`Requirements.jsx` 1032、`Quality.jsx` 813、`SiteLog.jsx` 961、`Valuation.jsx` 610、`extract-requirements/index.ts` 794 | 62／592／1004／842／272／696／437／534 |

更早的歷史數字（PR #58 時 71 檔 767、09-08 兩批 73 檔 820、Apple 四包後 72 檔 818）保留在各自的報告與 `docs/ROADMAP.md` 交付紀錄裡，不在此重述。
