# 營運與部署文件索引

> 狀態：**ACTIVE**
> 最後盤點：2026-09-11
> 用途：把「怎麼部署、怎麼跑真後端測試、怎麼設定後端」的 ACTIVE 文件集中一個入口；歷史部署文件只在這裡指路，不搬檔。

## 現行 runbook

| 文件 | 狀態 | 用途 |
|---|---|---|
| [`deploy.md`](deploy.md) | `ACTIVE RUNBOOK` | 前端（Cloudflare Workers）、資料庫 migration、Edge Functions 的部署流程、套用順序判斷、冒煙與寫回 `CURRENT.md` 的規則、本機環境地雷、回滾 |
| [`../REAL_BACKEND_E2E.md`](../REAL_BACKEND_E2E.md) | `ACTIVE` | 手動真 Supabase staging 測試（`npm run test:e2e:real`）：環境變數、colima 掛載、`seed.sql`、live Edge 驗收與清理。**檔案留在 `docs/` 根目錄，這裡只指路。** |
| [`../../supabase/SETUP.md`](../../supabase/SETUP.md) | `ACTIVE RUNBOOK` | 後端從零設定：建專案、`db push`、Auth、Edge secrets、提醒信、正式環境 pre-flight。注意 §7.1 的 Site URL 仍寫 apex 網域，App 已在 `app.` 子網域（見 `deploy.md` §7） |
| [`../上線前-真案-dry-run-檢查清單-2026-07-13.md`](../上線前-真案-dry-run-檢查清單-2026-07-13.md) | `ACTIVE CHECKLIST` | 正式站真案驗收；以執行當日環境為準 |

## 歷史部署文件（只供追溯，不得照表套用）

| 文件 | 狀態 | 為什麼還留著 |
|---|---|---|
| [`../Cloudflare搬家-逐步設定指南.md`](../Cloudflare搬家-逐步設定指南.md) | `HISTORICAL RUNBOOK` | 2026-08-11 從 GitHub Pages 搬到 Cloudflare 的過程；當時的 build command、環境變數清單與 HSTS preload 的取捨仍有參考價值 |
| [`../上線設定指南-2026-07-16.md`](../上線設定指南-2026-07-16.md) | `HISTORICAL` | 舊 GitHub Pages 網址與當時帳號設定；Auth Redirect URL 的 `/**` glob 坑在這裡首次記錄 |

## 相關架構文件

部署會碰到的機制邊界，在 [`../architecture/`](../architecture/README.md)：

- [`ai-gate-and-metering.md`](../architecture/ai-gate-and-metering.md)：關功能開關不需重佈；新增 AI 功能的部署步驟。
- [`resumable-extraction.md`](../architecture/resumable-extraction.md) §8：改抽取批次參數的部署會讓在途 run 作廢。
- [`route-registry-governance.md`](../architecture/route-registry-governance.md)：新增路由忘記登記會在渲染時 throw。

## 維護規則

1. 部署流程改變就改 `deploy.md`，不要再新開日期式部署文件；日期式紀錄寫進 `CURRENT.md` §6。
2. 新的營運 runbook 放本目錄；歷史文件留原位、在這裡加指路。
3. 「未查證現值」的外部設定（Cloudflare 後台、Supabase Auth URL、Resend、Sentry）查過就把結果與日期寫回 `deploy.md` §7。
