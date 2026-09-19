# Supabase 開發與設定

> ACTIVE RUNBOOK｜2026-09-11。正式操作需另有授權；部署順序集中在 [部署指南](../docs/operations/deploy.md)。

## 本機後端

安裝 Docker 相容 runtime 與 [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)。macOS 可用 Homebrew；不要用不支援的 `npm install -g supabase`。CI 的 `pgtap` job 釘死 CLI 版本（[pgtap.yml](../.github/workflows/pgtap.yml) 的 `supabase/setup-cli` `version`，目前 `2.113.0`），本機建議同版，`npm run test:db` 輸出第一行會印出實際版本；升級步驟見 [部署指南 §3](../docs/operations/deploy.md#3-部署前的門檻)。資料庫唯一真相是 [migrations](migrations/)；舊 schema.sql 已移除，歷史可由 Git 追溯。

```bash
npm run test:db
```

`test:db` 使用 [共用 pgTAP runner](../scripts/test-pgtap.js)，本機與 CI 同一條路徑：每次在臨時工作目錄以獨立 project_id（`<project_id>_pgtap_<pid>`、隨機 DB 埠）執行 `supabase db start`，由 CLI 從零建一次性資料庫（含 auth／storage／realtime 服務 migration、全部 [migrations](migrations/) 與 [seed.sql](seed.sql)），容器內 psql 逐檔跑 [tests](tests/)，跑完 `supabase stop --no-backup` 連容器、volume、網路一起刪。它不連 `supabase start` 起的開發資料庫（`supabase_db_PMIS`），那套不必在跑、裡面的資料也不受影響；兩個 worktree 同時跑互不干擾；被中斷留下的一次性資料庫（pid 已不存在）下次執行自動清掉。只需 Docker 與 Supabase CLI。檢查 SQL exit code、TAP 計畫與失敗列，不把半途失敗算通過。`supabase db reset` 仍只對可丟棄環境執行。

colima 需掛載 repo 所在磁碟，否則 Edge 容器看不到 functions；本機 service_role 的表級 DML（SELECT／INSERT／UPDATE／DELETE）與序列權限由 seed.sql 對齊 hosted，不將 seed 當正式 migration。TRUNCATE／REFERENCES／TRIGGER／MAINTAIN 對三個 API 角色一律不給（migration `20260917213900`＋default privileges），seed 不得再 `grant all on tables`。自 `20260919003000` 起 anon 對 public 表／序列／函式零權限、新函式對 anon／authenticated／PUBLIC 不可執行（全域 `alter default privileges for role postgres revoke execute on routines from public`＋public schema per-schema revoke；`extensions` schema 補回 PUBLIC），seed 不得給 anon 任何權限、不得給 authenticated 函式 EXECUTE；service_role 的函式 EXECUTE 由 seed 對齊 hosted 平台預設。pgTAP runner 把 pgtap 裝在 `extensions` schema，並對每個測試 session 的 `pg_temp_N` 補回 PUBLIC EXECUTE default，讓 `pg_temp.*` helper 在 `set local role authenticated／anon` 下仍可呼叫（不碰 public schema）。併發測試（`confirmed_quantity_concurrency.sql`）用 `dblink` 開第二個 session：本機 `postgres` 不是 superuser，dblink 要求連線「用了密碼」，而 loopback 在 pg_hba 是 trust，所以 runner 以 `docker inspect` 查出一次性資料庫容器在 docker 網路上的位址（scram），用 session GUC `pmis.pgtap_db_host` 交給測試檔；該檔不包在交易內（fixture 先提交），跑完自行清場。照片／契約私有 bucket 與政策由 migrations 建立。

## 前端連線與 Auth

複製根目錄 `.env.example` 為 `.env`，填 Project URL 與 publishable／anon key；service_role、模型與寄信金鑰不得放在 VITE_* 或前端。未設定 Supabase 時使用 Demo。

正式 App 網址為 `https://app.gov-agent.ai`。Auth Site URL／允許的 Redirect URLs 應指 App 網域；本機 localhost 另列。實際 Dashboard 值未在本輪核對。信箱驗證、SMTP、密碼政策依部署任務確認，不因開發文件自動關閉驗證；MFA（TOTP）應關閉——產品自 2026-09-19（R1）不提供兩步驟驗證，本機 `config.toml` 的 `[auth.mfa.totp]` 亦為關閉。行銷站 `gov-agent.ai` 不承接 App 登入流程。

## Edge 型別與相依套件

使用 Deno 2.9.6（[安裝說明](https://docs.deno.com/runtime/getting_started/installation/)），從 repo 根目錄執行：

```bash
npm run check:edge
```

[deno.json](functions/deno.json) 隔離 Node 相依解析，[deno.lock](functions/deno.lock) 固定版本；CI 用 [setup-deno](https://github.com/denoland/setup-deno) 安裝同版 runtime 並以 frozen lock 檢查 17 支入口。更新 Edge 相依時先明確修改／重新產生 lock，再重跑型別與測試；不刪 lock 讓 CI 浮動取最新版。

用戶呼叫的函式保留 JWT 驗證；send-reminders 是 cron 例外，驗 x-cron-secret。AI 使用者 client／service client、功能開關與記帳分工見 [AI 閘門](../docs/architecture/ai-gate-and-metering.md)。模型選擇以 functions/_shared/claude.ts 為準。

## 提醒設定

send-reminders 需要 RESEND_API_KEY、CRON_SECRET 與已驗證寄件網域的 REMINDER_FROM；模型功能另需 ANTHROPIC_API_KEY，天氣需 CWA_API_KEY。私密值放平台 secrets／未追蹤環境檔，不寫 repo、命令紀錄或示範輸出。

[cron.sql](cron.sql) 提供台北每日 08:00 的排程模板，設定 project ref 與相同 cron secret 後才套用。`send-reminders?dry=1` 可檢查彙整而不寄信。提醒與網頁待辦範圍有差異，見 [雙引擎](../docs/architecture/dual-engine-sync.md)，不能宣稱兩份清單相同。

另一支 pg_cron 工作 `pmis-obligation-periods`（每日 16:05 UTC＝台北 00:05，純 SQL `select public.materialize_all_obligation_periods()`，不呼叫 Edge、不需 secret）由 migration `20260917233000_obligation_periods` 直接排程，推進循環義務的期次前瞻窗口；執行紀錄 `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'pmis-obligation-periods') order by start_time desc limit 10`。

## 權限與驗收

只有 contractor／supervisor／owner 三方；專案 admin 只由 project_members.role 決定，正式模式關掉業務跨角色 override。變更核准／駁回由機關，監造受理／退回；估驗核定、查驗判定、缺失結案與送審審定由各自 guard 保護。不要將 service_role 的 RLS bypass 誤寫成所有 trigger 都無限制。

執行 [真後端 E2E](../docs/REAL_BACKEND_E2E.md) 驗登入與業務鏈；正式上線需另驗三角色、Auth 回跳、標單匯入、契約收件／原檔／抽取、提醒 dry-run。實跑結果只記 [BASELINE](../docs/BASELINE.md)，正式 migration／Edge 版本記 CURRENT。
