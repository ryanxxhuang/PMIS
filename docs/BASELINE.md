# 驗證與規模基線

> ACTIVE｜2026-09-11｜`refactor/product-wide`，本輪進度共用化與文件精簡。
> 手動實跑快照，不是 CI 自動產物。前一版驗證紀錄可從 Git 追溯；正式環境狀態只見 [CURRENT §6.3](../CURRENT.md#63-正式環境最後核對不是即時狀態)。

## 1. 本輪驗證

| 項目 | 結果 | 指令／範圍 |
|---|---|---|
| Vitest | 91 檔、1095 測試通過 | `npm test` |
| 預定進度時區回歸 | 14 測試在 UTC 與 America/Los_Angeles 各通過 | `TZ=UTC node node_modules/vitest/vitest.mjs run src/lib/progressPlan.test.js`，另改 TZ 重跑 |
| Demo E2E | 8 檔、48 測試通過 | `npm run test:e2e`，本機 Vite／Chromium，未連真 DB |
| ESLint | 0 error／0 warning | `npm run lint` |
| production build | 通過；仍有 >500 kB chunk 警告 | `npm run build` |
| 文件檢查 | 本輪刪除路徑的本地 Markdown 引用已修復，保留文件無失效的本地檔案連結 | 檔案存在檢查；歷史引用固定至 `c39e395` |
| pgTAP | 本輪未重跑；前次同日紀錄 40 檔／1048 通過 | 本輪未改 migration、DB 或權限。跑法見 [SETUP](../supabase/SETUP.md)／`.github/workflows/pgtap.yml` |
| 真後端 E2E | 本輪未跑 | 先前 chain3 模型金鑰失效；最近成功紀錄 PR #54（2026-08-25），見 [指南](REAL_BACKEND_E2E.md) |
| Deno 型別檢查 | 未完成 | 本輪未改 Edge；前次僅做 esbuild bundle，不等同 deno check |
| 依賴 audit | 本輪未重跑 | 前次 2026-09-11 紀錄 production 0、dev 2 moderate；非即時結果 |

## 2. 檔案規模

| 項目 | 本輪核對 | 現查方式 |
|---|---|---|
| migrations／rollbacks | 60／10 | `rg --files supabase/migrations supabase/rollbacks` |
| 待套正式 migration | 3 支，版本與最後核對日期見 CURRENT §6.3 | 部署前 `supabase migration list --linked`，本輪未查正式庫 |
| pgTAP | 40 檔、plan 加總 1048 | `rg 'plan\(' supabase/tests`；加總不等同實跑 |
| Edge／shared 非測試模組 | 17／29 | `rg --files supabase/functions` |
| web 非測試頁面／Store slices | 34／9 | `rg --files src/pages/web src/store/slices` |
| 架構文件（含索引） | 15 | `rg --files docs/architecture -g '*.md'` |

路由數與 AI 功能數直接查 `src/lib/navConfig.js`、`src/lib/aiFeatures.js`；不另維護重複計數。

## 3. 文件精簡

本輪刪除 33 份過期 Markdown 與 17 個舊 handoff HTML／圖像資產，共 50 檔；原文仍在 Git。必讀入口（AGENTS、DEVELOPMENT、CURRENT、DECISIONS、CLAUDE）由 37,066 降至 10,875 字元，減少約 71%。這是字元量比較，不是模型 tokenizer 的 token 實測。

保留 ACTIVE 架構、部署、資安／採購證據、簡報來源與尚需執行的真人驗收。ROADMAP 只留未完成事項，交付歷程查 Git／PR。
