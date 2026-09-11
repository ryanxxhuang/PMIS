# 驗證與規模基線

> ACTIVE｜2026-09-11｜`refactor/product-wide`，全專案程式、文件與驗證工具整理。
> 手動實跑快照，不是 CI 自動產物。前一版驗證紀錄可從 Git 追溯；正式環境狀態只見 [CURRENT §6.3](../CURRENT.md#63-正式環境最後核對不是即時狀態)。

## 1. 本輪驗證

| 項目 | 結果 | 指令／範圍 |
|---|---|---|
| Vitest | 95 檔、1128 測試通過 | `npm test`；含新人工期限、管理頁競態、Requirement runtime 更新、Agent 查詢與檢查腳本回歸 |
| 預定進度時區回歸 | 同日第一輪：14 測試在 UTC 與 America/Los_Angeles 各通過；此輪未再改公式 | `TZ=UTC node node_modules/vitest/vitest.mjs run src/lib/progressPlan.test.js`，另改 TZ 重跑 |
| Demo E2E | 8 檔、48 測試通過 | `npm run test:e2e`，本機 Vite／Chromium，未連真 DB |
| ESLint | 0 error／0 warning | `npm run lint` |
| production build | 通過；仍有 >500 kB chunk 警告 | `npm run build` |
| 文件檢查 | 45 份 Markdown 的本機檔案／標題連結通過 | `npm run check:docs`；不連網驗外部網址 |
| pgTAP | 40 檔、1048 通過、0 失敗 | `npm run test:db`；既有本機 Supabase DB，未 reset、未改 migration。跑法見 [SETUP](../supabase/SETUP.md) |
| 真後端 E2E | 6 測試通過；本機真 DB／Auth／Storage，固定契約資料模式 | `ANTHROPIC_API_KEY= npm run test:e2e:real`；測試自行建立／清理登入帳號。未呼叫真模型，見 [指南](REAL_BACKEND_E2E.md) |
| Deno 型別檢查 | 17 支入口及其共用依賴通過 | Deno 2.9.6，`npm run check:edge`；依賴鎖定於 functions/deno.lock，已納 CI。未部署或驗證線上 Edge |
| 腳本／設定語法 | 8 份 Python、7 份 JSON 通過 | AST／JSON parse；不代表外部素材匯入或簡報渲染已實跑 |
| 依賴 audit | production 0、dev 2 moderate | `npm audit --json`；Vitest／@vitest/mocker 同一 advisory，修補需大版升級，列 ROADMAP 獨立處理 |

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

## 3. 覆蓋與文件精簡

盤點前端、Store、Edge 的 291 個 JS／JSX／TS 模組之匯入／匯出使用點；移除無生產使用端的舊 requirement wrapper、摘要 helper 與空 logger。測試工具及前後端註冊鏡像保留，不按「只有測試 import」機械刪除。DB 以 migrations／pgTAP 核對，既有 migration 不回改。

第一輪已刪 50 個過期文件／handoff 資產；本輪再刪 7 個重複掃描報告、過時簡報產生器與 v1 設計稿。相對本輪起點 `6987ef7`，全部版控 Markdown 字元量由約 38.2 萬降至約 20.5 萬，減少約 46%；必讀入口相對原始 37,066 字元減少約 70%。這是字元量，不是 tokenizer 實測。

15 份架構文件與操作指南已對齊現行程式；歷史資安／採購證據、驗收原句、仍有效設計／簡報來源及選用設計 skills 保留。過期檔可用 Git 追溯。未完成產品能力集中 ROADMAP，正式版本集中 CURRENT，不在各文件複製交付計數。

尚未驗證真模型語意準確率、真人手機／真案三角色、正式部署與備份還原。所有通過結果只支持上述測試範圍，不代表零缺陷或正式驗收完成。
