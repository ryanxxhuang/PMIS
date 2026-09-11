# 部署 Runbook（前端／資料庫／Edge Functions）

> 狀態：**ACTIVE RUNBOOK**
> 最後核對：2026-09-11（分支 `refactor/product-wide`；正式站 `app.gov-agent.ai` 跑的仍是 PR #62 的版本）
> 用途：把散在 `CLAUDE.md`、`CURRENT.md`、`wrangler.jsonc`、`supabase/SETUP.md`、CI workflow 與 PR 描述裡的部署地雷收攏成一份可照做的流程。取代兩份 `HISTORICAL` 文件的「目前怎麼部署」角色：[`../Cloudflare搬家-逐步設定指南.md`（歷史）](https://github.com/ryanxxhuang/PMIS/blob/c39e395fff5608813a8c2fa4c79700e87d607e3b/docs/Cloudflare%E6%90%AC%E5%AE%B6-%E9%80%90%E6%AD%A5%E8%A8%AD%E5%AE%9A%E6%8C%87%E5%8D%97.md)（2026-08-11 搬遷紀錄）與 [`../上線設定指南-2026-07-16.md`（歷史）](https://github.com/ryanxxhuang/PMIS/blob/c39e395fff5608813a8c2fa4c79700e87d607e3b/docs/%E4%B8%8A%E7%B7%9A%E8%A8%AD%E5%AE%9A%E6%8C%87%E5%8D%97-2026-07-16.md)（舊 GitHub Pages 快照）——那兩份只供追溯，不得照表套用。
> 授權邊界：commit、push、部署與正式 migration **只在使用者明確要求後執行**（`DEVELOPMENT.md` §6）。本文件教怎麼做，不授權做。

## 0. 一頁摘要

| 面 | 怎麼部署 | 觸發 | 最容易踩的雷 |
|---|---|---|---|
| 前端（React SPA） | Cloudflare Workers 靜態資產，Cloudflare 從 repo 自動建置 | **push 到 `main` 即部署** | 冒煙要打 `app.gov-agent.ai`，apex 是行銷站會 404 |
| 資料庫 | `supabase db push`（`supabase/migrations/` 是唯一真相） | 人工，需授權 | 動 DB 前先 `supabase migration list --linked`；套完寫回 `CURRENT.md` §6 |
| Edge Functions | `supabase functions deploy <name> --use-api` | 人工，需授權 | colima 環境**必加 `--use-api`**；`_shared/` 改了要重佈所有 import 它的函式 |

三面各自獨立、沒有一鍵串起來的流程；順序由 §4 的判斷準則決定。

## 1. 拓樸與網址

- **App 正式站**：<https://app.gov-agent.ai>，Cloudflare Workers（`wrangler.jsonc`：`name: "pmis"`、`assets.directory: "./dist/"`、`not_found_handling: "single-page-application"`）。
- **apex `gov-agent.ai`**：`PMIS.marketing` repo 的行銷站（GitHub Pages），2026-08-25 起承接；App 路由在 apex 會回 404，行銷站的「開始使用」連到 `app.`。**任何冒煙、curl、E2E 對正式站都要打 `app.` 子網域。**
- **舊部署仍可公開存取**（`CURRENT.md` §6.3）：`pmis.pages.dev`（舊 Cloudflare 部署，bundle 落後）與 `ryanxxhuang.github.io/PMIS`（GitHub Pages 仍啟用，`gh-pages` 分支停在 2026-08-11）都帶正式 anon key。關閉 GitHub Pages、刪 `gh-pages` 分支、處理舊 Cloudflare 專案列在 ROADMAP 未排入。
- Supabase：Postgres＋Auth＋Storage＋Edge Functions（Deno）。project ref 不寫在本文件；`supabase link` 後 CLI 自己知道。

## 2. 前端：push `main` 即部署

**機制**：Cloudflare 的 repository build 流程（`deploy command = wrangler deploy`）監看 `main`，每次 push 自動建置並發布。repo 內沒有部署 workflow——`.github/workflows/` 只有 CI（§3），**部署本身不經 GitHub Actions**。

**Cloudflare 後台的設定不在 repo 內**，本文件核對時無法從程式讀到現值，以下屬「應該在那裡、未查證現值」：

- Build command：搬遷文件當時填 `npm run build && npm run build:demo`（後者把 Supabase 環境變數設空建 `/demo` 銷售簡報站到 `dist/demo`）。**目前 build command 是否仍含 `build:demo` 未查證**；`package.json` 仍保留 `build:demo` script。
- Build output：`dist`。
- 建置環境變數（現查 `grep -rhoE "import\.meta\.env\.VITE_[A-Z_]+" src | sort -u`；2026-09-11 現查為 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_SENTRY_DSN`、`VITE_SENTRY_ENV`、`VITE_SECURITY_CONTACT`、`VITE_APP_VERSION`）。漏設不會報錯，會安靜建出連不上資料庫或沒有錯誤回報的站。`service_role` 金鑰絕不可出現在這裡。
- Node 版本：`.nvmrc` 為 `22`，`package.json` `engines` 釘 `>=22.13.0`；CI 讀同一份 `.nvmrc`。

**repo 內會影響部署產物的檔案**：

- `public/_headers`：安全標頭（X-Frame-Options、nosniff、Referrer-Policy、Permissions-Policy、HSTS 不含 preload、CSP）。改 CSP 前看檔內註解的每一行為什麼。
- `public/_redirects` **已刪除**：Workers 靜態資產會自動去掉網址中的 `/index` 與 `.html`，`/* /index.html 200` 會變成無限迴圈（Cloudflare error 100324 直接拒絕部署）；SPA fallback 改由 `wrangler.jsonc` 的 `not_found_handling` 承擔。
- `public/theme-boot.js`：首繪前套主題（CSP `script-src 'self'` 不允 inline）。
- `npm run deploy` 是已停用的舊 gh-pages 流程，執行會主動失敗（`exit 1`），勿再用。

**部署後驗證**（§6）。

## 3. 部署前的門檻

- `main` 有 active ruleset：要求 PR，且 `test-and-build`（`ci.yml`：`npm test`、`npm run build`、Demo E2E）與 `pgtap`（`pgtap.yml`：起本機 Supabase → `db reset` 套全部 migrations → 容器內 psql 逐檔跑 `supabase/tests/*.sql`）兩個 status check 必須綠。pgTAP 自 2026-09-06 起**每個 PR 一律執行**（不再依路徑觸發）。
- 已知限制（2026-09-07 健檢）：RepositoryRole 5 可 bypass、未要求人工核准人數、未要求分支先更新到 base——**不能宣稱完全不可繞過**。
- 本機至少跑 `npm test`、`npm run build`；動 DB 跑 pgTAP（§8）；動 `supabase/functions/` 時 esbuild bundle 通過**不等於** Deno 實機驗證。
- 真後端 E2E（`npm run test:e2e:real`）不進 CI、只在本機對一次性 staging 手動跑，見 [`../REAL_BACKEND_E2E.md`](../REAL_BACKEND_E2E.md)。

## 4. 資料庫 migration

```bash
supabase link --project-ref <ref>        # 一次性
supabase migration list --linked         # ★ 動 DB 前先看：本機 vs 遠端逐支對齊
supabase db push                         # 依序套用尚未套的 migrations
supabase migration list --linked         # 套完再核一次，版本號寫回 CURRENT.md §6
```

規則：

- `supabase/migrations/` 是唯一真相；`schema.sql` 已凍結，不用來初始化或同步。已套用的 migration 不回頭修改，變更一律新增（`DEVELOPMENT.md` §5）。
- **透過 MCP 或 SQL Editor 直接對正式庫套過的 migration，必須把檔案收編回 repo**，否則 `db push` 會被阻擋（PR #50 的教訓：`20260824123253` 曾在正式庫有、repo 沒有）。
- 新表要檢查 grants：基線的 `alter default privileges` 會讓新表自動帶 authenticated 寫入授權，migration 內要明確 `revoke`（`DEVELOPMENT.md` §5）。
- 回復：`supabase/rollbacks/*.down.sql` 只覆蓋少數 migration（現查 `ls supabase/rollbacks/ | wc -l` 對 `ls supabase/migrations/ | wc -l`），且**僅 W5-2 與 D-020 曾記錄 down→up，其他未演練**（`CURRENT.md` §7）；不能因檔案存在就推論可安全還原。

**前端與 DB 的套用順序——不是固定答案，看變更性質**：

| 變更性質 | 順序 | 既有案例 |
|---|---|---|
| **收緊型**：新 policy／欄位授權會讓「舊前端」撞 42501 或缺欄位 | **先部署前端，再 `db push`** | `20260822010100` profiles select 逐欄授權：舊前端 `select('*')` 會撞 42501（PR #42 明載「部署順序必須先前端後 db push」） |
| **加法型且新前端依賴新欄位／RPC**：舊 DB 會讓「新前端」查不到欄位 | **先 `db push`，再部署前端** | W8-7 `photos.location`、`inspections.checklist_record_id`（PR #22「兩支 migration 先於前端套用正式庫」） |
| 兩者皆是（既收緊又被新前端依賴） | 拆成兩支 migration 分兩次部署，或接受一段短暫的錯誤窗並事先告知 | — |

判斷時問兩個問題：「舊前端撞新 DB 會不會炸？」「新前端撞舊 DB 會不會炸？」哪邊會炸就讓哪邊後上。Edge Function 若也依賴新 RPC／欄位，DB 永遠先於 Edge。

## 5. Edge Functions

```bash
supabase secrets set ANTHROPIC_API_KEY=... CWA_API_KEY=... RESEND_API_KEY=... CRON_SECRET=... REMINDER_FROM='...'
supabase functions deploy <name> --use-api                     # 一般函式（verify_jwt 預設開）
supabase functions deploy send-reminders --no-verify-jwt --use-api   # 唯一例外：cron 呼叫，驗 x-cron-secret
supabase functions list                                        # 對帳線上版本
```

- **colima 環境下 `supabase functions deploy` 必須加 `--use-api`**（`DEVELOPMENT.md` §5 環境地雷；`agent-run/index.ts` 檔頭也寫著）。
- **`_shared/` 改了要重佈所有 import 它的函式**：Deno 部署只打包 `supabase/functions/`，每支函式各自帶一份 `_shared` 的快照。現查誰要重佈：`grep -l "_shared/<檔名>" supabase/functions/*/index.ts`（間接 import 也算：`aiGate.ts` 被 `aiHandler.ts` 與四支自管函式引用，2026-09-11 現查 `grep -l "aiGate\|aiHandler" supabase/functions/*/index.ts | wc -l` 為 17，即全部）。
- 只關功能開關（`ai_features.enabled = false`）**不需要重佈**：伺服器端閘門讀 DB 即時生效（見 [`../architecture/ai-gate-and-metering.md`](../architecture/ai-gate-and-metering.md)）。
- `SUPABASE_URL`／`SUPABASE_ANON_KEY`／`SUPABASE_SERVICE_ROLE_KEY` 由平台注入，不需手動 set；缺 service key 時 AI 功能照常回應但不記帳、agent 草稿工具會回「伺服器未設定」。
- **線上版本未逐支核對**（`CURRENT.md` §6.3）：17 支函式的線上版本與 `main` 是否一致沒有紀錄，最後一次重佈紀錄是 PR #51。下次動 `supabase/functions/` 時順手用 `supabase functions list` 對帳並記進 `CURRENT.md` §6。
- 每日提醒排程：`supabase/cron.sql`（pg_cron ＋ pg_net，每日 00:00 UTC ＝ 台北 08:00 呼叫 `send-reminders`），換 `CRON_SECRET` 或 project ref 要重跑它；乾跑 `curl -X POST ".../functions/v1/send-reminders?dry=1" -H "x-cron-secret: ..."`。

## 6. 部署後：冒煙與寫回

**冒煙（打 `app.` 子網域）**：

```bash
for p in / /login /agent /requirements /security /site-log/print; do
  curl -sI "https://app.gov-agent.ai$p" | head -1
done
curl -sI https://app.gov-agent.ai/ | grep -iE "strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy|cross-origin-opener"
```

2026-09-02 基線：六條路由皆 200（SPA fallback），七項安全標頭齊全（HSTS／CSP／X-Frame-Options／X-Content-Type-Options／Referrer-Policy／Permissions-Policy／COOP）。HTTP 標頭檢查**不代表登入後業務流程驗收**；真案驗收走 [`../上線前-真案-dry-run-檢查清單-2026-07-13.md`](../上線前-真案-dry-run-檢查清單-2026-07-13.md)。

可加驗：線上 bundle 是否含本次新 chunk（例如 PR #58 以 `AnchorDates` chunk 名確認）。

**寫回文件（`DEVELOPMENT.md` §6 完成定義）**：正式庫套用 migration 或重佈 Edge Function 後，把**套用的 migration 版本號、重佈的函式名與日期**寫進 `CURRENT.md` §6；相關待部署事項同步更新 `docs/ROADMAP.md`。2026-08-19～09-01 有 36 個 PR 未同步文件造成續接點失真，是這條被加註的原因。

## 7. 不在 repo 內的外部設定（改網域、換信箱時要一起動）

| 設定 | 在哪 | 現值核對狀態 |
|---|---|---|
| Supabase Auth **Site URL** 與 **Redirect URLs** | Supabase Dashboard → Authentication → URL Configuration | `supabase/SETUP.md` §7.1 仍寫 `https://gov-agent.ai`／`https://gov-agent.ai/**`；App 已於 2026-08-25 搬到 `app.` 子網域，**正式環境是否已改為 `https://app.gov-agent.ai/**` 未查證**。填法一律用 `/**` glob（尾斜線坑，2026-07-16 文件實測）。 |
| 自訂 SMTP／Resend 寄件網域 | Resend Dashboard ＋ Supabase SMTP Settings | `REMINDER_FROM` 需已驗證網域；未驗證前 `onboarding@resend.dev` 只能寄到自己帳號 |
| pg_cron 排程 | Supabase SQL Editor（`cron.sql`） | `select * from cron.job;` 現查 |
| Sentry DSN／環境 | Cloudflare 建置環境變數 | 未查證現值 |
| Anthropic Console 每月支出上限 | console.anthropic.com | 產品內刻意不做成本硬上限（ROADMAP 未排入），這是最後保險；未查證現值 |
| Cloudflare Email Routing（`security@`） | Cloudflare → Email | 未查證現值 |

## 8. 本機環境地雷（部署前的驗證常卡在這裡）

- **全域 `~/.npmrc` 有 `os=linux`**：mac 本機 `npm install` 會缺 darwin native binding 導致 `vite build` 爆。救法 `npm i --os=darwin --cpu=arm64`。
- **colima 要掛載 repo 所在磁碟**：repo 在外接 SSD 時 `colima start --mount "$HOME:w" --mount "/Volumes/GameSSD:w"`，否則 edge-runtime 容器看到的 functions 目錄是空的（`failed to determine entrypoint`）。
- **本機 Supabase 最小服務組**：`supabase start -x analytics,vector,edge-runtime,imgproxy,inbucket,realtime,storage,studio`（pgTAP 用不到那些）；`supabase db reset` 從零套全部 migrations。
- **新版 CLI 本機 stack 對 `service_role` 沒有表級 GRANT**（secure-by-default）：`supabase/seed.sql` 在 `start`／`db reset` 時把本機 service_role 對齊 hosted 預設，**永遠不進正式部署**；已在跑的 stack 可 `docker exec -i supabase_db_PMIS psql -U postgres < supabase/seed.sql` 補。
- **本機跑 pgTAP**（與 `pgtap.yml` 同一套）：容器名由目錄名推導 `supabase_db_<dir>`；`docker exec <db> psql -U postgres -d postgres -c "create extension if not exists pgtap with schema public;"`，再對每個 `supabase/tests/*.sql` 以 `-v ON_ERROR_STOP=1` 餵進 psql，`not ok`／psql 非零／plan 數不符／整檔無 ok 四種都算失敗。
- 真後端 E2E 的殭屍 ssh 佔埠、smoke 帳號重佈建、functions serve 需有效金鑰等坑，見 [`../REAL_BACKEND_E2E.md`](../REAL_BACKEND_E2E.md)。

## 9. 回滾

| 面 | 做法 | 備註 |
|---|---|---|
| 前端 | `git revert` 後 push `main`，Cloudflare 重建 | Cloudflare 後台是否有一鍵 rollback 到前一版未查證 |
| 資料庫 | 對應的 `supabase/rollbacks/<version>.down.sql` 手動執行 | 只有少數 migration 有 down 檔且未演練；沒有 down 檔的變更要另寫 migration 往前修，不回頭改舊檔 |
| Edge Function | checkout 舊 commit 重佈該函式（`--use-api`） | `_shared/` 也會跟著回到舊版，注意連帶影響 |
| AI 功能 | 後台 `/admin` 關閉開關，或 `update ai_features set enabled = false` | 即時生效，不需重佈 |

## 10. 現查指令彙整

```bash
ls supabase/migrations/ | tail -1                   # 本機最新 migration
supabase migration list --linked                    # 本機 vs 遠端
ls supabase/rollbacks/                              # 有 down 檔的 migration
ls -d supabase/functions/*/                         # Edge Function 清單
supabase functions list                             # 線上 Edge Function 版本
grep -l "_shared/aiGate.ts" supabase/functions/*/index.ts   # 改 _shared 後誰要重佈
grep -rhoE "import\.meta\.env\.VITE_[A-Z_]+" src | sort -u  # 建置需要的環境變數
cat .nvmrc; grep -A2 '"engines"' package.json       # Node 版本
```
