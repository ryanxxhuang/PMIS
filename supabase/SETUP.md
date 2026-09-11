# Supabase 開發與設定

> ACTIVE RUNBOOK｜2026-09-11。正式操作需另有授權；部署順序集中在 [部署指南](../docs/operations/deploy.md)。

## 本機後端

安裝 Docker 相容 runtime 與 [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)。macOS 可用 Homebrew；不要用不支援的 `npm install -g supabase`。資料庫唯一真相是 [migrations](migrations/)，schema.sql 只作凍結歷史參考。

```bash
supabase start
npm run test:db
```

`test:db` 使用 [共用 pgTAP runner](../scripts/test-pgtap.js)，依 config.toml 的 project_id 找容器，不挑第一台 Supabase；可用 DB_CONTAINER 明確指定。檢查 SQL exit code、TAP 計畫與失敗列，不把半途失敗算通過。它不 reset DB；`supabase db reset` 只對可丟棄環境執行，CI 用它驗全部 migration 從零套用。

colima 需掛載 repo 所在磁碟，否則 Edge 容器看不到 functions；既有本機 service_role grants 由 seed.sql 對齊測試需要，不將 seed 當正式 migration。照片／契約私有 bucket 與政策由 migrations 建立。

## 前端連線與 Auth

複製根目錄 `.env.example` 為 `.env`，填 Project URL 與 publishable／anon key；service_role、模型與寄信金鑰不得放在 VITE_* 或前端。未設定 Supabase 時使用 Demo。

正式 App 網址為 `https://app.gov-agent.ai`。Auth Site URL／允許的 Redirect URLs 應指 App 網域；本機 localhost 另列。實際 Dashboard 值未在本輪核對。信箱驗證、SMTP、MFA／密碼政策依部署任務確認，不因開發文件自動關閉驗證。行銷站 `gov-agent.ai` 不承接 App 登入流程。

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

## 權限與驗收

只有 contractor／supervisor／owner 三方；專案 admin 只由 project_members.role 決定，正式模式關掉業務跨角色 override。變更核准／駁回由機關，監造受理／退回；估驗核定、查驗判定、缺失結案與送審審定由各自 guard 保護。不要將 service_role 的 RLS bypass 誤寫成所有 trigger 都無限制。

執行 [真後端 E2E](../docs/REAL_BACKEND_E2E.md) 驗登入與業務鏈；正式上線需另驗三角色、Auth 回跳、標單匯入、契約收件／原檔／抽取、提醒 dry-run。實跑結果只記 [BASELINE](../docs/BASELINE.md)，正式 migration／Edge 版本記 CURRENT。
