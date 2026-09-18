# 驗證與規模基線

> ACTIVE｜2026-09-19｜P5c 基準日版本（pgTAP＋Vitest 前端／Edge 路徑＋Deno 執行期＋Demo E2E＋內建 Preview）、D1 正式站邊緣注入與 `check:prod` 漏檢（Vitest＋`wrangler dev`＋demo 重佈實測）、P3a 監造日誌頁面（Vitest＋Demo E2E＋真後端 chain 6）、H2／H3 anon 與函式 EXECUTE 權限硬化（pgTAP 全庫迴圈＋真後端 E2E 四鏈）、P5b 循環義務逐期追蹤（pgTAP＋Vitest 前端／Edge 路徑＋Deno 執行期＋Demo E2E）、P3a 監造日誌後端（pgTAP＋Vitest＋Deno）、P5a 球權單一實作與共用案例（Vitest 前端／Edge 路徑＋Deno 執行期＋pgTAP）、H1 表級權限硬化（pgTAP 全表迴圈＋真後端 E2E）、P2b Edge 起稿（Vitest＋pgTAP＋Deno）、瘦身 P1b 退場頁唯讀化（成本寫入 DB 收回 pgTAP）、P2d 施工日誌存版／簽署／提送 RPC pgTAP、瘦身 P1c／P1d 文案對齊與手機抽屜斷點缺陷、P2a 現場文書資料層 pgTAP、T0 本機 pgTAP 隔離、P4a 純計算層 pgTAP；保留 2026-09-14 三方 UIUX 與 2026-09-12 的既有後端與全案驗證快照。
> 手動實跑快照，不是 CI 自動產物。前一版驗證紀錄可從 Git 追溯；正式環境狀態只見 [CURRENT §6.3](../CURRENT.md#63-正式環境最後核對不是即時狀態)。

## 1. 本輪驗證

### 2026-09-19 P5c：基準日版本、重算只動未完成、單次義務完成快照、循環停止條件（`codex/slimming-p5c-anchor-versions`，PR #134，migration `20260919021500_project_anchor_versions`）

- `npm run test:db`（一次性資料庫從零套 72 支 migration＋seed，基於含 D1 的 main `5a4b955`）：52 檔、2,436 通過、0 失敗（＝H2／H3 基準 2,295＋新增 `project_anchor_versions.sql` 124 條＋H1／H2 全表／全函式迴圈因新表與新函式自動增加；`obligation_periods.sql` 99 條與 `requirement_obligation_one_way.sql` 38 條在測試專案補竣工日後不變）。新增套件覆蓋：結構與授權（表、RPC、projects 留版 trigger 取代 P5b 的補期 trigger、guard、obligations 快照 trigger、acceptance 同步 trigger、兩欄、authenticated 只 SELECT、RPC 允許 authenticated 不允許 anon、內部函式不可直接呼叫、RPC 為 security definer）；純函式（單次到期日六案、界限日四案、停止條件五案、快照 jsonb）；version 1（插入即留、initial、changed_keys＝已填四欄、effects 空、快照＝插入值、生效日＝台北今天、全空專案無版本）；期次蓋版號與 basis 界限日、保固類與缺開工日不產生；重算只動未完成（廠商先標 2026-04 已提送 → 管理者改開工日 → v2：沒動過的 2026-03 移除、已提送的 2026-04 保留原到期日／狀態／版號並記 kept、不受影響的 2026-05 維持版本 1、單次「開工後 15 日」記改期 3/7→4/25、接獲開工通知起算與竣工類義務不受影響）；展延附函文與變更案（v3：竣工前 7 日改期 12/24→3/24、窗口內無新期）；停工不改日期仍留版（v4）、值沒變回 null 不留版；管理者直接 REST 改接獲開工通知日為月末（v5：edit、無依據、建立者、2／3 月期移除、4/15 不動）；不可竄改（authenticated UPDATE／DELETE／INSERT 42501，擁有者 UPDATE／DELETE P0001，內容原封）；RPC 權限矩陣（廠商／機關成員與非成員同一句拒絕、未登入、未知類別、非四欄、非日期 22007、別案變更設計；被拒不留版；RLS 非成員 0、自己案可見、建立者欄位如實）；單次快照（機關完成 fixed 義務快照＝指定日期、版號 5；client 寫快照欄 42501；監造標已提送由伺服器依當時竣工日算 3/24；核准變更工期 v6 後快照不變並記 kept；退回清空；再完成依現行竣工日重留、版號 6；循環義務永遠無義務層快照）；停止條件（報竣 6/20 → 7 月以後沒動過的待辦期移除、含報竣日的 6 月期保留、已提送期不動；竣工確認 5/28 優先於報竣；`fn_project_completion_date`；清除竣工登錄 → 依契約竣工日補回並蓋現行版本 6；基準日未設案補開工日 → v1 edit 但缺竣工日不產生；補已過的竣工日 → 只產生到 6 月、effects 記新增三期、`materialize_all` 0 新增；展延 → 7 月起恢復並記新增；清空竣工日 → 全部沒動過的待辦期移除並記 removed）；專案刪除 cascade 版本隨之消失。
- `npm test`：129 檔、1,403 項（rebase 到含 D1／P3a 前端的 main 後重跑；rebase 前 126 檔 1,375）（新增 `src/store/slices/projects.anchors.test.js` 5 條：只送四個基準日鍵與依據、不直寫 projects、現行值＝版本快照、空字串送 null、RPC 回 null 不動、RPC 拒絕本地不動、沒有基準日鍵直接拒、停工不改日期仍打 RPC、契約價金總額直寫但拒絕基準日鍵；`todayTasks.test.js` 停止條件五種情境；`obligationTimeline.test.js` stop 缺口優先序、期次依據句、單次依據四種、版本列；`contractDue.test.js`／`contractDue.test.ts` 快照優先與不適用情境；`db.test.js` 版本分頁；共用案例 `ballInCourt.cases.test.js`／`.test.ts` 加 `single_due`／`period_basis`、ob17 已完成快照不列、ob18 保固類 stop 導期限追蹤與 Agent `fix_at`）；`npm run test:edge` 4 項（Deno 執行期加基準日版本案例）；`npm run check:edge` 18 支；`npm run lint` 零警告；`npm run build`；`npm run check:docs` 55 檔、388 連結、0 錯誤。
- Demo E2E（`npx playwright test` contractor／a11y／routes／reachability／workflow-ux／owner／supervisor／contract-flow）：70 項通過（rebase 到含 P3a 前端的 main 後重跑，rebase 前 69；既有期限追蹤「標為已提送可掛送審佐證」在期次逐期依據句加入後不變）。
- 內建 Preview（本 worktree 的 demo 模式 dev server；`.claude/launch.json` 的 `pmis-demo` 會從主目錄起服務，故改以 Bash 起 5190 再 attach）：期限追蹤詳情「依據：第 2 版基準日（開工日 2026-04-15）」、期次列「第 2 版／第 1 版基準日」、基準日卡類別／依據／生效日三欄、`AnchorVersions` 目前依據第 2 版（展延・生效・府工字第 1130004567 號）與本版變更三個事項改期；選展延＋填函文＋改竣工日 → 「示範模式：已記錄第 3 版（期次不重算）」、版本紀錄（3）、履約時程同步顯示新竣工日與同一份依據列。
- 正式庫唯讀盤點（套用前，只取計數）：13 案（有竣工日 11、開工日 2、接獲開工通知 2、決標 1、無任何基準日 1、竣工日已過 0）；循環義務 7 筆皆施工中 monthly：6 筆所屬專案缺竣工日但已登錄報竣 2026-08-21＋竣工確認 2026-08-24（其中 1 筆已有 4 期 07–10 月、5 筆循環規則待補），1 筆所屬專案有竣工日且驗收鏈完整（竣工確認 2026-07-15）且已有 4 期 07–10 月；既有 8 期皆待辦、未動過、basis 起算日皆等於現值（回填可蓋 v1）；義務層完成 0 筆（無需補快照）；預計套用時移除竣工後的 5 期（實際數字見 CURRENT §6.3）。
- 未做／待驗：正式 `db push`、正式庫唯讀核對、Edge 重佈與 `check:prod` 於合併後執行；保固類循環義務的保固期滿日沒有欄位可判定（列停止條件待補，需產品決定來源）；rollback 檔未演練；真後端 E2E 未跑（本單元無簽署／文件流程變更，義務期限走 pgTAP 與 Demo E2E）。

### 2026-09-19 D1：正式站 Cloudflare 邊緣注入與 `check:prod` 漏檢（`codex/slimming-d1-edge-injection`，PR #133）

- 來源查證（唯讀 `curl`）：app `/`、`/login`、`/agent`、`/demo/` 與 demo `/`、`/login` 的 HTML 都在 `</body>` 前多一段行內載入器（建 1×1 iframe 載 `/cdn-cgi/challenge-platform/scripts/jsd/main.js`，帶當次 `cf-ray`），不分 UA；apex `gov-agent.ai` 回 `server: GitHub.com`、無 `cf-ray`（DNS-only），只有行銷站自己手動載的 beacon。對照 Cloudflare 文件：這是 Bot Fight Mode 自動開啟的 JavaScript Detections，Free 方案「automatically enabled and cannot be disabled」、不能依主機／路徑排除、不走 WAF 規則；文件同時明載回應帶 `Cache-Control: no-transform` 時不注入。
- `npm test`：128 檔、1,385 項通過（新增 `scripts/check-prod.test.js` 13 條：允許清單由 `index.html` 推導、Vite 雜湊、正式站實抓 jsd 樣本、cf-beacon、Rocket Loader、email-decode、任意行內腳本、單／無引號 src、CSP `script-src` 精確比對三種放寬變形、缺 `no-transform`、資產規則、`/demo/` 相對路徑）；`npm run lint` 零警告；`npm run build`；`npm run check:docs` 55 檔、391 連結、0 錯誤。
- `wrangler dev`（本機，`wrangler.demo.jsonc`＋新 `_headers`）：`/`、`/login`（SPA fallback）、`/theme-boot.js` 為 `public, max-age=0, must-revalidate, no-transform`；`/index.html` 307 到 `/`；`/assets/index-*.js` 為 `public, max-age=31536000, immutable`；`/.well-known/security.txt` 為 `public, max-age=86400`——證實「`! Cache-Control` 再設值」可拆掉 `/*` 的逗號合併。
- 處置前 `node scripts/check-prod.js`（正式站現況）：app `/`、`/login`、`/demo/` 與 demo `/`、`/login` 五頁全 FAIL（缺 `no-transform`＋行內腳本；`/demo/` 入口 chunk 另缺 immutable），先紅成立。
- demo 站以本分支重佈（demo 模式建置＋`wrangler deploy --config wrangler.demo.jsonc`）後：`node scripts/check-prod.js` demo `/`、`/login`、`pmis-demo.ryanxhuang1212.workers.dev/` 三頁 OK；原始 `curl`：HTML `cache-control: public, max-age=0, must-revalidate, no-transform`、1,618 bytes 無 `content-encoding`（預期）、`<script>` 只剩 `./theme-boot.js` 與 `./assets/index-HbO4ebwG.js`、`challenge-platform` 0 次；入口 chunk `public, max-age=31536000, immutable`＋`content-encoding: br`。
- 未做：app 站要等 PR 合併、Workers Builds 建置後再跑 `npm run check:prod`（結果記 CURRENT §6.3）；未在瀏覽器 console 逐頁複核（`check:prod` 以 HTML 內容為準，注入不存在即無錯誤可報）。

### 2026-09-19 P3a 前端：監造日誌頁（`codex/slimming-p3a-supervisor-log-ui`）

- `npm test`：127 檔、1,372 項通過（rebase 到含 P5b 的 main `81a8471` 後跑）。新增 `src/pages/web/SupervisorLog.document.test.jsx` 6 條（AI 草稿標示範範本與免責聲明、逐欄來源「照片 AI 說明／同日施工日誌文件／系統查驗紀錄」、引用的查驗與缺失以名稱顯示、到場待補不給簽、廠商照片標「施工廠商提供」且沒有「改為監造證據」；帶入本人→「已填・待親自確認」仍在待補→「確認到場人員」後清空、存檔遇 PD001 明確提示且輸入留著；伺服器 recheck `needs_confirmation` 高亮並擋簽、有「本日未到場」；可簽草稿意願文字含「監造日誌」、PD003 引導兩步驟驗證、已簽署要先「建立更正版本」且有「提送給機關」；廠商唯讀除日期無 input／無存檔／無收件並標「查閱視角；提送對象是機關」、機關在已提送時有收件／退回；沒有文件時全部待補、任何欄位不會被填成「無」、同日已簽署施工日誌自動引用摘要並標來源與版本）、`src/data/demoFieldDocTemplates.test.js` 2 條（示範模式範本 fixture 與 Edge 鏡像同鍵／版本／必填鍵、人填欄只有到場、其他類型無範本）、`src/lib/fieldDocs.test.js` 新增 6 條（範本推導 required／human_only／labels、必填鍵依類型、到場閘門 filled→needs_confirmation→confirmed→再改回待確認→na 清空、一般欄改值即 confirmed、文字欄不適用清 null、到場列預檢鏡像 PD010；引用同日施工日誌只在已簽署／提送／收件時帶入且組字與 Edge 同一支、草稿只更新收件情形、無文件＝none；來源短句與引用名稱；AI 建議對監造日誌逐頂層鍵只補 pending、到場永不帶入、附件問題依上傳方標示）並把 `docStatusMeta` 案例改為依文書類型（施工日誌送監造、監造日誌送機關、`docPagePath`／`docPageLink`）；`navConfig.test.js` 登記表與側欄 fixture 加 `/supervisor-log`、`/supervisor-log/print`；Edge `fieldDocDraft.test.ts` 23／`fieldDocDraftRun.test.ts` 25 在抽出 `_shared/fieldDocText.ts` 後不變。
- `npm run check:edge` 18 支；`npm run test:edge` 3 項；`npm run lint` 零警告；`npm run build`；`npm run check:docs` 55 檔、391 連結、0 錯誤。無 migration，`npm run test:db` 未跑（DB 未動）。
- Demo E2E（`npx playwright test` 全套 10 支）：74 項通過。`supervisor.spec` 新增「監造日誌：示範範本標示、到場人員親自確認後才可簽；示範模式不假裝可簽署」（監造進 `/supervisor-log`：卡上「示範範本」與 `role=note` 免責聲明、保存狀態「本日尚無監造日誌」、待補 N 項且無簽署鈕→帶入本人→「已填・待親自確認」與待補「（待親自確認）」→確認後離開待補→補天氣／監造事項／施工情形摘要→存檔「版本 1，可簽署」＋「示範模式：草稿只存在本次瀏覽」→簽署意願含「監造日誌(版本 1」→按簽署回「示範模式無法簽署／提送」且沒有「已由 … 簽署」→375 無水平溢位（側欄 300 ms 收合過場，用 `expect.poll` 等落定；第一次跑量到過場中間值假紅，不是版面問題））；`a11y.spec` 的 H1 對照表加 `/supervisor-log`（三角色 375／1024 全路由掃描含新頁）；`reachability` 三角色自動涵蓋新子頁。內建 Preview 目視 375／1024：示範範本章與免責聲明、待補集中列、到場區「帶入本人／加一位」、監造事項／通知／追蹤空狀態、備註（非必填的自由文字空白時原本掛「待補」章會誤導成必填，改為有值才顯示來源章）。
- 真後端 E2E `npm run test:e2e:real -- e2e-real/chain6-supervisor-log.spec.js`（本機 colima 棧：共用開發 DB 已含 `20260919003000`；另開 `supabase functions serve --env-file e2e-real/stub.env`，本機 edge-runtime 1.74.3 讀不了 repo 的 v5 `deno.lock`，跑時暫移、跑完還原、未提交）：1 條通過（9.6 s；第一次跑在「回頁面後再按確認到場人員」假紅——版本 3 的到場已在 RPC 步驟標 confirmed 以免 PD004 先於 PD005，頁面正確顯示已確認、沒有確認鈕，spec 改為斷言該狀態，產品未改）。走完：廠商先以 API 存一張自己的照片→監造（TOTP 登入 aal2）在 `/site`「拍照／上傳」標「監造日誌自動起稿」、選兩張→「已保存到伺服器 2／2」→候選監造日誌「已起稿」、監造查驗表單列出但尚未支援→DB：一份 `supervisor_log` `pending_input`、AI 版本到場 `[]` 且 `pending`→現場文書清單直達 `/supervisor-log?doc=`：示範範本＋免責聲明、「已存檔・版本 1」、監造事項來源「照片 AI 說明」、無簽署鈕→帶入本人＋到場 09:00–12:00、天氣、施工情形「廠商未施工」＋原因→存檔「版本 2，尚有 1 項待補或待確認」且到場「（待親自確認）」→以 aal2 直打 `sign_field_document` 回 `PD004` 且 detail 含 `{attendance, needs_confirmation}`→以 RPC 存版本 3（到場 confirmed＋廠商照片 `role=evidence`）：`recheck` 列 `attachments.<id>: uploader_org:contractor`、簽署回 `PD005`→頁面重新整理到版本 3：「施工廠商上傳的照片,只能以「參考」附上」「施工廠商提供」、改為參考、到場已確認無確認鈕→存檔「版本 4，可簽署」→簽署卡「版本 4・雜湊 12 碼」＋「示範範本」＋意願文字→簽署成功「已由 … 簽署（aal2）」→DB `supervisor_logs`：到場含 `user_id`＋時段、天氣「晴」、摘要 `null`（不適用不寫「無」）、`template_key='supervisor_log_demo'`→列印頁「【示範範本】範本 supervisor_log_demo v1」、內容雜湊＝版本 4 雜湊前 12 碼、「簽署 鏈六監造・」、無「草稿・未簽署」→返回→提送機關→廠商登入：唯讀（除日期無 input、無存檔、無收件）、「施工廠商為查閱視角；提送對象是機關」→機關（1024）在 `/site` 見「已提送・待收件」、開頁唯讀、退回填原因→監造（375）看到「機關退回（版本 4」與原因、補備註存檔「版本 5」、「版本 4 的簽署仍綁在該版本」、重簽、再送、無水平溢位→機關歷次提送紀錄含「原因：…」與「相對退回版本 4 的差異：備註」、收件「（版本 5）」→DB：提送列 `submit:4, return:4, submit:5, receive:5`、diff 由 DB 算、文件 `received` 版本 5 綁同一 `supervisor_logs` 列且 `note` 已更新。fixture 帳號與專案 afterAll 清除（`auth.users`／`projects` 殘留 0）。**模型輸出為 stub**，只證明流程不證明辨識正確。
- 環境事故（非本單元引入）：實作中途 `/Volumes/GameSSD/Projects/PMIS-slimming`、`-2`、`-3` 三個 worktree 目錄一度從磁碟消失（`git worktree list` 皆 prunable），本單元以 `git worktree add -f` 重建自己的 worktree、`npm ci --os=darwin --cpu=arm64` 重裝並重做遺失的兩個檔案；其他兩個 worktree 未動。
- 未做：真模型辨識品質（P7b）；iPhone 實機；施工日誌列印版本與雜湊（P3d）；`discard_field_document`（P3e）；正式站登入後對 `/supervisor-log` 的真人走一遍；監造月報改讀 `supervisor_logs`（P6a）。

### 2026-09-19 H2／H3：anon 表級／序列權限與函式 EXECUTE 收回、default privileges 改 fail-closed（`codex/slimming-h2h3-anon-privileges`，migration `20260919003000_anon_and_function_execute_privileges`）

- `npm run test:db`（一次性資料庫從零套 71 支 migration＋seed，基於含 P5b 的 main `81a8471`）：51 檔、2,295 通過、0 失敗（＝P5b 基準 1,970＋新增 `anon_and_function_privileges.sql` 325 條；`api_roles_table_privileges.sql` 因 P5b 新表為 200）。新增套件覆蓋：public 58 個關聯、2 個序列、227 支函式（排除 extension 物件，全部由 `postgres` 擁有）× `anon` 逐一斷言零權限；表／序列／函式 ACL 沒有 PUBLIC 偽角色；`authenticated` 可執行集合精確等於 68 支允許清單、trigger 函式全部不在清單、Edge service client 用的五支 RPC `service_role` 保留；`pg_default_acl`：public tables／sequences 無 anon／PUBLIC，全域 functions 有一列且不含 PUBLIC（內建 PUBLIC EXECUTE 已覆蓋）、public functions 無 anon／authenticated／PUBLIC 但保留 service_role、extensions functions 補回 PUBLIC；測試內以 `postgres` 新建表／序列／函式：anon 皆無、authenticated 與 service_role 的表級 DML default 照舊、新函式 anon／authenticated／PUBLIC 不可執行而 service_role 可、extensions 新函式 PUBLIC 可執行；新建 trigger 函式在 authenticated 無 EXECUTE 下 INSERT 仍觸發；行為：anon 讀表／view、寫 profiles、`nextval`、呼叫 `my_project_ids`／`is_project_member` 皆 42501，authenticated 走 policy 讀 projects 與允許清單 RPC 照常、直接呼叫 trigger 函式／`transcription_doubts`／`evidence_delete_bypass` 皆 42501，service_role 的 `ai_feature_allowed` 照常。
- 中途兩次紅、每次修根因：①第一版 pgTAP 把 `service_role` 的函式 default 也收掉——P2c 的 `seed.sql` 已因實測（Edge service client INSERT `field_documents` 會撞到欄位 default 用的 `fn_field_document_owner_org`）補回 service_role 的函式 EXECUTE default，seed 在 migration 之後執行，本機與正式因此不一致；改為 migration 明示對齊既有函式的 service_role EXECUTE、default 維持平台預設（理由見 migration 檔頭），pgTAP 斷言改為 service_role 保留。②per-schema `ALTER DEFAULT PRIVILEGES … IN SCHEMA public REVOKE … FROM PUBLIC` 在共用開發 DB 的 rollback 交易內實測拿不掉內建 PUBLIC EXECUTE（PostgreSQL 文件：per-schema REVOKE 對全域授的權無效），改用全域形式並對 `extensions` 補回；全域形式同時拿掉 `pg_temp` helper 的 PUBLIC（33 個測試檔在 `set local role` 下呼叫 92 次），runner 改為每個 session 對 `pg_temp_N` 補回 PUBLIC default、pgtap 改裝 `extensions`。
- 查證（正式庫唯讀 SELECT，未輸出資料）：`pg_default_acl` `postgres`／`public`：tables `anon=arwd,authenticated=arwd,service_role=arwd`、sequences 三角色 `rwU`、functions 三角色 `X`，無全域列、無 extensions 列；57 表＋1 view 中 anon 對 48 表 SELECT、38 INSERT／UPDATE、39 DELETE，view `authoritative_requirements` rawd，`ai_usage_events_id_seq` rUw；227 支函式（含 P5b）anon 可執行 72、authenticated 126、service_role 227、PUBLIC 66；56／57 表 RLS 開（`obligation_periods` 亦開）、無 anon／public policy；Storage 六條 policy 全 `to authenticated`；SECURITY DEFINER 154 支（P5b 前）`search_path` 全部固定、擁有者全 `postgres`。登入前路徑盤點：GoTrue（signUp／signInWithPassword／resetPasswordForEmail／MFA）、四條靜態公開路由、profile 只在 session 後讀、無邀請碼、Edge user client 全帶 JWT、`send-reminders` 與行銷站 `demo-request` 用 service role ⇒ anon 例外清單為空。
- 真後端 `npm run test:e2e:real`（本機 colima 棧；共用開發 DB `supabase migration up --local` 補到 `20260919003000`，核對 anon 對 60 個關聯／序列零權限、227 支函式 anon 0／authenticated 68／service_role 227／PUBLIC 0；chain5 另開 `supabase functions serve --env-file e2e-real/stub.env`，跑時暫移 `deno.lock`、跑完還原未提交）：auth-smoke、chain1「註冊→建案→邀請(含錯配拒絕)→三方到齊→正式模式→被邀方可見」、chain2「廠商建期送審→監造核定→機關請款」3 測試通過；chain5「廠商上傳→起稿→補缺→MFA 簽署→提送→監造退回→更正再送→監造收件；恢復、重傳不重建、簽舊版被拒」1 測試通過（等 P2c 的 5189 dev server 結束後跑）。註冊走 `handle_new_user` trigger（authenticated／PUBLIC 皆無 EXECUTE）照常建 profile。
- `npm test`：125 檔、1,357 項；`npm run lint` 零警告；`npm run build`；`npm run check:docs` 55 檔、388 連結、0 錯誤。
- 未做：正式 `db push` 與正式庫唯讀核對、內建 Preview 開正式站登入頁，於合併後執行（結果記 CURRENT §6.3）；rollback 檔未演練；`pg_net` 屬 `supabase_admin`、其函式不在本支範圍。

### 2026-09-19 P5b：循環義務逐期追蹤（PR #125，migration `20260917233000_obligation_periods`）

- `npm run test:db`（一次性資料庫從零套 69 支 migration＋seed，rebase 到含 P3a 的 main 後重跑）：49 檔、1,965 通過、0 失敗（＝P3a 基準 1,859＋新增 `obligation_periods.sql` 99 條＋`requirement_obligation_one_way.sql` 34→38 條＋H1 全表迴圈因新表自動多 3 條）。新增套件覆蓋：結構／授權（`authenticated` 只 SELECT、排程函式 IMMUTABLE、pg_cron 工作已排程）；純函式（規則缺口四種、基準日欄位四種；每月 31 日在 2／4 月夾住、閏年 2/29、平年 2/28、跨年、每年前瞻外仍列下一期、每季第 n 月與夾住、ISO 週、每日 5 期與鍵、規則不完整／基準日缺 0 期）；materialize（插入即物化、2 月期早於開工日不列、期間整月、基準日缺與規則不完整不產生、責任不明照樣產生、永遠含今天之後一期、三層冪等 0 新增、開工日補上即補齊且早於基準日的期不列）；RLS 與直接寫表（成員可見、非成員案 0、insert／update 42501、RPC 成員可／非成員拒）；狀態轉移（自己方可標並掛佐證、完成人與時間由伺服器蓋、下期不動、舊逾期保留、已提送→已完成不重蓋、退回清時間戳與證據）；權限矩陣（監造／機關不可標廠商期、可標自己方；非成員 not found；未登入；未知狀態；別案送審文件；責任不明廠商／監造皆不可；admin override 可；正式模式失效但自己方仍可）；義務層 guard（循環標已提送 P0001、單次照舊）；廢止級聯（待辦期→不適用、已完成期保留、不適用義務的期不可再動）；規則變更（沒動過的期重建、動過的原樣保留）；回填（有 `completed_at` 對應期別含證據與 basis、其他期不動；無 `completed_at` → 已到期待辦期標待核對、未到期不標、義務原狀；單次不回填；標記後註記解除）。
- `npm test`：124 檔、1,345 項（新增 `contractDue.test.js`／`contractDue.test.ts` 循環讀期次同一組案例、`todayTasks.test.js` 逐期＋三種缺口入口、`obligationTimeline.test.js` 逐期狀態／期次列／缺口、`ledger.test.js` RPC 成功／拒絕／demo 鏡像、`persistedWrites.test.js` RPC 不直寫表；共用案例 `ballInCourt.cases.test.js` 13 條／`.test.ts` 10 條對 fixture 新增 ob12（已完成期＋逾期舊期＋下期）、ob13（缺開工日）、ob14（規則不完整）、ob15（回填待核對）、ob16（已廢止）三側一致）；`npm run test:edge` 3 項（Deno 執行期同案例）；`npm run check:edge` 18 支；lint 零警告；build；`check:docs` 55 檔 383 連結 0 錯。
- Demo E2E：contractor／owner／supervisor／contract-flow／routes／reachability／workflow-ux／a11y 8 支 69 項全綠（demo 種子的循環義務改帶「上一期已完成＋下一期待辦」，到期日與 P5b 前的「下次到期」同一天，劇本逾期分佈不變；期限追蹤標為已提送走 RPC 鏡像後 `已提送 ✓` 仍在該期）。
- 正式庫唯讀盤點（套用前）：`contract_obligations` 109 筆，循環 7 筆皆 monthly／施工中／待辦、無 `completed_at`，其中 5 筆 `recurring_day` 為空、3 筆 `trigger_event` 為空、4 筆為 `monthly`；所屬專案皆有開工日；pg_cron 1.6.4 已啟用且有 `pmis-daily-reminders` 一支工作。
- rebase 到含 P2c 的 main（`f4e3f32`）後重跑：`npm run test:db` 從零套 70 支 50 檔 1,970 通過（＋P2c `service_role_function_grants.sql` 5 條）；`npm test` 125 檔 1,357 項；lint／build／`check:edge` 18／`test:edge` 3／`check:docs` 55 檔 388 連結 0 錯；Demo E2E 8 支 69 項仍全綠；PR CI／pgTAP 於 `3aad25e` 皆 success。正式 `db push`、Edge 四支重佈與正式庫唯讀計數見 CURRENT §6.3。
- 未做／待驗：真資料目視（7 筆 monthly：5 筆循環規則待補、2 筆期次共 8 期）；pg_cron 首次執行紀錄；停止產生期次的條件（竣工／保固期滿）未定義（P5c）；rollback 檔未演練。

### 2026-09-17 P2c：現場紀錄頁（上傳／恢復／施工日誌草稿→審核→簽署→提送→收件／退回）（`codex/slimming-p2c-site-flow`）

- `npm test`：125 檔、1,354 項通過（rebase 到含 H1／P5a／P3a 的 main `4410cee` 後重跑；rebase 前 1,343）。新增 `src/lib/fieldDocs.test.js` 21 條（上傳狀態機：選檔全部「仍在本機」、逐張 hashing→uploading→saved 才算已保存、失敗保留可重試且已保存的不動、跨批次同內容引用不算本機、階段與 reset；恢復判讀 `intakeNextAction` 八種伺服器狀態；候選 `excluded` 只改該項；必填鍵與待補判定鏡像 DB；欄位與來源中文；新文件全 pending、既有未簽署日誌帶入全標 `legacy` 待核對且不出現 confirmed、Agent 草稿人填數量 confirmed／沒填 pending；改值＝confirmed/human、核對只改狀態、不適用要原因、工項加減同步來源鍵；AI 建議只補 pending 不覆蓋人填；附件問題逐張；狀態文案依觀看者；簽署意願文字；`client_request_id` 同一件事同 id、清掉才換；PD001–PD010 分流）、`src/pages/web/SiteLog.document.test.jsx` 5 條（`?d=` 直達；尚無日誌→未存檔→存檔遇 PD001 明確提示重新載入且輸入留著→成功建草稿＋版本並列待補；既有未簽署日誌帶入來源「既有紀錄」且可列印、存檔前不建文件；可簽草稿顯示版本／雜湊／意願，PD003 → 引導兩步驟驗證（無因子 → 前往帳號安全）；已簽署要先「建立更正版本」、監造唯讀除日期無 input、已提送有收件／退回）、`supabase/functions/_shared/visionStub.test.ts` 8 條（正式預設關閉；旗標＋https／非本機主機仍關閉；只有旗標＋本機 http 才啟用；輸出固定無告示板）；`agent.test.js` 移除 `draftPayloadToSiteLog`（路徑已退場）；刪 `SiteLog.dailyLog.test.jsx`、`photoLogDraft.test.js`。
- `npm run test:db`（一次性資料庫從零套 68 支 migration＋seed，rebase 到含 P3a 的 main 後重跑）：49 檔、1,864 通過、0 失敗（＝P3a 基準 1,859＋新增 `service_role_function_grants.sql` 5 條；rebase 前 48 檔 1,733：seed 補齊本機 `service_role` 對 public 函式的 EXECUTE 與 default privileges，鏡像 hosted 平台預設——Edge service INSERT `field_documents` 會經 generated column 呼叫 `fn_field_document_owner_org`，本機沒補就 42501 假紅；hosted 以唯讀 SELECT 核對 `postgres` 的 default ACL 本就給 anon／authenticated／service_role、該函式 ACL 含 `service_role=X`）。
- `npm run check:edge` 18 支；`npm run test:edge` 3 項；`npm run lint` 零警告；`npm run build`；`npm run check:docs` 55 檔、384 連結、0 錯誤（rebase 後）。
- Demo E2E（`npx playwright test` contractor／supervisor／a11y／routes／workflow-ux／owner／reachability）：63 項通過（rebase 後重跑仍 63）。`contractor.spec` 施工日誌改為文件語意（尚無日誌→複製昨日→存檔成版本 1 並列待補 6 項→不給簽署、示範模式明說無法上傳、今天無可印的落庫紀錄→切到昨天既有紀錄可列印）；`supervisor.spec` 唯讀改斷言無「簽署此版本」與「選擇照片上傳」。
- 真後端 E2E `npm run test:e2e:real -- e2e-real/chain5-field-docs.spec.js`（本機 colima 棧：共用開發 DB 先 `supabase migration up --local` 補到 `20260917220737`，rebase 後再補 P3a 的 `20260917221000` 重跑一次仍通過；依 seed 補 service_role 函式 EXECUTE；`supabase/config.toml` 開本機 TOTP 後 `supabase stop`／`start` 套用；另開 `supabase functions serve --env-file e2e-real/stub.env`）：1 條通過。走完：廠商（TOTP 登入 aal2）在 `/site` 選兩張照片→「已保存到伺服器 2／2」、無「仍在本機」→伺服器起稿、候選施工日誌「已起稿」、`notes` 明標「模型輸出為本機 stub」→重新整理後「上傳批次」列（辨識完成、已保存 2 張）與「現場文書」（施工日誌 今日 待補 6 版本 1）從伺服器恢復→重傳同一張：「本案已有相同照片,未重複上傳」、不建第二個批次、`field_documents` 仍 1 份、`photos` 仍 2 列→開文件：來源「已帶入・待核對・照片 AI 說明」、待補未齊無簽署鈕→填 `結構工程 當日完成數量` 12.5、天氣、出工、機具／材料「本日無」＋原因→存檔「版本 2，可簽署」→簽署卡顯示「版本 2・雜湊 12 碼」與意願文字→簽署成功「已由 … 簽署」「aal2」、`daily_logs.status='已簽署'`、`daily_log_items.qty_today=12.5`、以版本 1 雜湊呼叫 `sign_field_document` 回 `PD001`→提送監造→監造（1024）在 `/site` 看到「已提送・待收件」、開文件唯讀（除日期無 input、無存檔）、退回填原因→廠商（375）看到退回橫幅與原因、改摘要存檔「版本 3」、卡上「版本 2 的簽署仍綁在該版本」、重簽、再送，375 無水平溢位→監造歷次提送紀錄含「原因：…」與「相對退回版本 2 的差異：工作摘要」、收件「（版本 3）」→機關唯讀→DB：提送列 `submit:2, return:2, submit:3, receive:3`、diff 由 DB 算、文件 `received` 版本 3 綁同一 `daily_logs` 列。fixture 帳號與專案 afterAll 清除。**模型輸出為 stub**（`PMIS_VISION_STUB=1` 只在本機 http 位址生效），只證明流程不證明辨識正確。
- chain 5 逐次紀錄（第 1–7 次紅、第 8 次綠、rebase 後第 9 次綠；每次都修根因，沒有放寬斷言或重跑碰運氣）：①環境——本機 edge-runtime 1.74.3 讀不了 repo 的 v5 `deno.lock`，worker 起不來（跑測時暫移 lockfile，跑完還原，未提交）；②環境——本機 `service_role` 對 `fn_field_document_owner_org` 無 EXECUTE，Edge 寫 `field_documents` 42501（seed 補齊鏡像 hosted＋pgTAP 釘住）；③產品——恢復清單的批次列收合時看不到狀態與計數（`IntakeStatusLine` 常駐在列上）；④產品——全部是既有照片的重傳會先建一個空批次、被 Edge 標 failed（改為先查重再建批次，全部既有就不建批次不起稿並說明）；⑤測試——「本日無」原因是站內 `appPrompt` 對話框不是原生 dialog，spec 改填對話框 textarea；⑥測試——TOTP 登入 helper 等「登出」鈕，手機 375 該鈕在抽屜裡，改等落地 URL＋h1、登出前回桌機寬；⑦測試——退回原因同時出現在橫幅與歷史清單，定位改 `exact`；⑧產品——有工項列時 `/site-log` 在 375 水平溢位，grid item 補 `min-w-0`（舊頁在 demo 沒有工項列所以 a11y 掃描沒踩到），spec 溢位斷言改為列出撐出視窗的元素。
- 環境限制（非本單元引入）：repo `supabase/functions/deno.lock` 為 v5（Deno 2.9 寫出），CLI 2.113 內建 edge-runtime 1.74.3（Deno 2.1.4）讀不了 → 本機 `functions serve` 的 worker 無法啟動（`check:edge` 與 hosted 部署不受影響）。本次跑 chain 5 時把 lockfile 暫時移開、跑完還原（未提交任何 lockfile 變更）；列為後續工具鏈待辦。
- 未做：真模型辨識品質（P7b）；正式站對 `draft-field-documents` 的請求（合併後重佈該函式並 `check:prod`）；iPhone 實機；`/site-log/print` 印版本與雜湊（P3d）；`discard_field_document`（P3e）——P2c 只能捨棄批次、不能捨棄文件草稿；Edge Agent 工具 `draft_daily_log` 仍寫 `agent_actions(target_table='daily_logs')`（前端 acceptDraft 已改走文件），工具端改建 `field_documents` 草稿留 P3／P6。

### 2026-09-17 P3a：監造日誌後端（PR #122，migration `20260917221000_supervisor_logs`）

- `npm run test:db`（一次性資料庫從零套 68 支 migration＋seed，rebase 到含 P5a 的 main 後重跑）：48 檔、1,859 通過、0 失敗（＝P5a 基準 1,728＋新增 `supervisor_logs.sql` 128 條＋H1 `api_roles_table_privileges.sql` 全表迴圈因新表 `supervisor_logs` 自動多 3 條）。新增套件覆蓋：結構與通用 guard 函式存在、P2d 專用 `fn_daily_log_signed`／`fn_daily_log_sign_bypass` 與二參數 `fn_field_document_unmet_fields` 已移除、`authenticated` 可取範本但不可執行人填欄推導／簽署分支內部函式／通用 guard、anon 全無；示範範本 `is_demo`／`demo_label`／免責聲明／八節、施工日誌無範本、人填欄＝到場、監造日誌必填鍵由範本推導且施工日誌必填鍵不變、人填欄 filled→`needs_confirmation` 而 confirmed／na＋reason 齊備、施工日誌 filled 照舊；`fn_project_ref_exists` 本案／外案／未知類型；事實表直接寫入：監造可建（建立者由伺服器蓋）、同日第二列 23505、未簽署列可改、建立者不可改、跨案 42501、廠商／機關（正式模式）42501、廠商 UPDATE／DELETE 不生效、成員（廠商／機關）可讀、非成員讀 0 且不可寫、anon 42501、非正式案廠商 admin 可代建；版本 guard：AI 版本帶入到場內容／標 filled／confirmed／na 一律 P0001、留空＋pending 允許、施工日誌不受影響；存版與簽署：到場只被標 filled → recheck `needs_confirmation` 且簽署 PD004、廠商照片當監造證據 → recheck 且 PD005、未知上傳方 PD005、齊備 draft、aal1 PD003、廠商／機關／非成員簽署與廠商編輯 PD006、外案查驗／外案工項／廠商成員冒充到場／到場已確認但為空／到場 na 但有人員／外案缺失／追蹤狀態／範本鍵／收件情形引用非施工日誌／日期不符／到場非陣列各 PD010、舊版 PD001、雜湊 PD002；成功簽署回 `target_table='supervisor_logs'`、簽署列由伺服器取資料、事實列（天氣、到場、查驗 uuid[]、通知、追蹤、摘要、收件情形、示範範本鍵）落庫、`target_id` 綁定、草稿標 edited、`field_document.signed(supervisor_log, aal2)` 稽核、同人重試冪等、他人再簽 PD008；已簽署列直接 UPDATE／到場改寫／DELETE／upsert／service／GUC 指向同日施工日誌文件全部 P0001 而未簽署列照舊；簽後更正 v18 回 draft、事實列等重簽才更新、兩筆簽署列；提送給機關成功、提送給廠商 PD010、機關可收件；superseded 後 D2 接手同一事實列；專案刪除 cascade 通過 guard。`field_document_sign.sql` 改用三參數待補函式、D2 監造日誌期望由 PD007 改為 pending_input／PD004，其餘 140 條回歸不變。
- `npm test`：124 檔、1,342 項通過（新增 `fieldDocDraft.test.ts` 8 條：台北時刻／日範圍、監造候選 ready／blocked＋查驗表單仍 unsupported、共同草稿形狀、到場永遠空且 pending／範本鍵／必填鍵鏡像／附件、監造事項來源與查驗清單、無來源不捏造、通知去重與追蹤、施工日誌只引用正式版本（草稿／退回不引用）與收件情形、天氣次序與未匯標單；`fieldDocDraftRun.test.ts` 3 條＋改 1 條：監造批次起監造日誌且查驗表單仍 unsupported、建立文件＋AI 版本＋agent_role=supervisor、冪等／建議／鎖定與施工日誌同一段、來源讀取失敗不建半份）；`npm run check:edge` 18 支；`npm run test:edge` 3 項；`npm run lint` 零警告；`npm run build`；`npm run check:docs` 55 檔、379 連結、0 錯誤。
- 未做：正式 `db push` 與 Edge `draft-field-documents` 重佈於合併後執行（結果記 CURRENT §6.3）；真後端 E2E 未跑（本單元無前端呼叫端，監造日誌流程由 pgTAP 以真實 `authenticated`＋JWT 路徑證明）；模型品質仍未驗（本機無模型金鑰，Edge 全部 stub，列 P7b）；監造日誌頁面待 P2c 共用元件合併後另接。

### 2026-09-17 P5a：球權單一實作、共用案例與待補設定（PR #120，migration `20260917220737_obligation_party_unassigned`）

- 共用案例 `tests/fixtures/ball-in-court.cases.json`（today 2026-07-26；開工日留空以產生基準日缺口；26 筆協作項＋11 筆義務＋10 份現場文書含多對象提送）三側同讀：`src/lib/ballInCourt.cases.test.js` 12 條（collaborationItems 核心事項含順序；三方 mine／waiting／setup；每筆責任、期限、逾期天數；責任不明與基準日缺口的標籤與入口）、`_shared/ballInCourt.cases.test.ts` 10 條（collectOpenBallItems 核心事項、義務窗口、逾期天數、三方球；`list_my_open_items` 三角色 items＋`setup_pending`；早報 `itemsForRecipient`／`splitBrief` 三角色）、`npm run test:edge`（Deno 2.9.6）3 條（核心事項含順序、義務責任／基準日／期限、三方球與待補設定 soon 7／0）。
- `npm test`：124 檔、1,331 項通過（rebase 到含 H1 的 main 後重跑）；`npm run check:edge` 18 支；`npm run lint` 零警告；`npm run build`；`npm run check:docs` 55 檔、378 連結、0 錯誤。
- `npm run test:db`（一次性資料庫從零套 67 支 migration＋seed）：47 檔、1,728 通過、0 失敗（＝H1 基準 1,712＋新增 `obligation_party_unassigned.sql` 16 條：函式對三方原樣通過、去頭尾空白、null／空字串／其他／未知文字回 null；責任不明的義務三方都不能標記、自己方對照組仍可、非正式模式 admin override 可、正式模式下無人可動；`obligation_ownership_completed_at.sql` 三條「落回廠商」斷言改為新語意，仍 27 條）。
- Demo E2E（`npx playwright test` contractor／owner／supervisor／workflow-ux／routes／reachability／a11y）：63 項通過。
- 未做：真資料目視「待補設定」卡與履約時程責任方（demo 種子沒有責任不明的義務、也沒有現場文書）；`/site?doc=` 直達要等 P2c 文件頁；正式 `db push`、Edge 重佈與 `check:prod` 於合併後執行（結果記 CURRENT §6.3）；不寄真實早報。

### 2026-09-17 H1：收回 API 角色的表級 DDL／維護類權限（PR #118，migration `20260917213900_api_roles_table_ddl_privileges`）

- `npm run test:db`（一次性資料庫從零套 66 支 migration＋seed，rebase 到含 P2b 的 main 後重跑）：46 檔、1,712 通過、0 失敗（＝P2b 基準 1,518＋新增 `api_roles_table_privileges.sql` 194 條；rebase 前 45 檔 1,704）。新增套件覆蓋：public 57 個關聯（含 view，排除一次性資料庫裡 pgtap 的 extension view）全部由 `postgres` 擁有；每個關聯 × `anon`／`authenticated`／`service_role` 一條斷言，任一角色殘留 TRUNCATE／REFERENCES／TRIGGER／MAINTAIN 就列出名稱；`postgres` 對 `public` 的 default ACL 對三角色與 PUBLIC 都沒有這四種；測試內以 `postgres` 新建一張表後三角色仍沒有四種權限、而 `authenticated`／`service_role` 的 SELECT／INSERT／UPDATE／DELETE default 照舊（基線與 seed 對齊未被動到）；既有表 DML 不變（`cost_items` authenticated SELECT、`daily_logs` INSERT／UPDATE、`field_document_versions`／`cost_items` service_role DML）；`authenticated`／`anon`／`service_role` 實際 TRUNCATE `cost_items`／`field_document_versions`／`audit_events` 皆 42501（表級權限擋，不是 RLS 或 guard），service_role SELECT 照常。
- 查證（正式庫唯讀 SELECT，未輸出資料）：57 個 public 關聯全部 owner `postgres`；`anon`／`authenticated` 各在 50 個上有 TRUNCATE／REFERENCES／TRIGGER（例外只有既有 `revoke all` 的 7 表），`service_role` 57／57；`pg_default_acl` 的 `postgres`／`public`／tables 為 `anon=arwdDxtm,authenticated=arwdDxtm,service_role=arwdDxtm`；事件觸發器全屬 `supabase_admin`、`postgres` 非 superuser；三角色對 `public` schema 無 CREATE；56 表 RLS 全開、無 `anon`／`public` policy。本機從零建庫的 default ACL 為 `anon=Dxtm`、`authenticated=arwdDxtm`、`service_role=arwdDxtm`（CLI secure-by-default 只拿掉 anon 的 DML）。
- 真後端 `npm run test:e2e:real`（本機 colima 棧；共用開發 DB 先 `supabase migration up --local` 補到 `20260917210000`，再以 psql 直接套 H1 SQL，核對三角色 57 關聯零殘留、default ACL 只剩 `authenticated=arwd,service_role=arwd`）：chain1「註冊→建案→邀請(含錯配拒絕)→三方到齊→正式模式→被邀方可見」與 chain2「廠商建期送審→監造核定→機關請款/收款登錄」2 測試通過。chain1 首次失敗是 spec 與 2026-09-11 成員頁清單／詳情殼脫節（邀請表單改由「邀請成員」展開、送出鈕改「加入專案」；PostgREST／DB 日誌無 42501），spec 對齊後綠；與本支無關。
- `npm test`：122 檔、1,301 項；`npm run lint` 零警告；`npm run build`；`npm run check:docs` 55 檔、364 連結、0 錯誤。
- 未做：正式 `db push` 與正式庫唯讀核對於合併後執行（結果記 CURRENT §6.3）；`anon` 表級 DML／序列與新函式 EXECUTE 的 default 漂移（H2／H3 候選）未動；rollback 檔未演練。

### 2026-09-17 P2b：Edge 起稿 `draft-field-documents`（`codex/slimming-p2b-draft-edge`）

- `npm test`：122 檔、1,301 項通過（rebase 到含 P1b／P2d 的 main 後重跑）。新增 `_shared/fieldDocDraft.test.ts` 15 條（日期回轉與台北日曆日；告示板日期 > 批次日期 > 照片時間與衝突標記；同雜湊最早者為正本；候選推斷——廠商每日一份施工日誌、無法判日 blocked、自檢表 unsupported、絕無監造文件，監造只列 unsupported 的監造日誌／相符待查驗表單，機關無候選，使用者排除沿用；欄位來源——沒來源的數量／天氣／出工全 pending 且不出現「無」「合格」，告示板清楚才 filled 並附來源照片、板上沒寫數量是 null 不是 0，多板不一致與多位置都 pending 並列 recheck，昨日沿用標 yesterday、當日既有日誌優先且人填摘要不被取代，未匯標單不寫任何工項；內容相同判定不受鍵序影響）與 `_shared/fieldDocDraftRun.test.ts` 22 條（記憶體 repo＋stub 模型：呼叫者≠上傳方 403 且零寫入、監造／機關批次不起施工日誌；建立文件＋AI 版本 1＋`agent_actions`＋照片補說明與工項＋批次 ready 並回填 `log_date`；重跑不再打模型、內容相同 unchanged、新增照片才加版本 2；有人工版本只留 `suggest_field_update`；已簽署 locked 零寫入；另一批同日在既有文件加版本並保留前批附件；同日並發撞唯一索引改走既有文件；使用者排除不起稿；非工地／不可辨／重複各有狀態且不入附件；有板子才轉錄、板上日期分兩天兩份日誌、數量附 `whiteboard:<id>`；未匯標單存 hint、匯入後重跑不打模型即配對；模型失敗與下載失敗逐張 failed／批次 partial、重跑只處理失敗張並補進既有文件、attempts 只在重啟時計；輸出不完整不建半份；佐證凍結 P0001 只寫辨識結果並揭露；文件寫入失敗不留半筆 agent_actions 且可重跑；預算用完回 remaining、批次留 recognizing 並釋放 run、續跑不計 attempts；run 認領衝突 409、過期可接手、attempts 用盡 409 並標 failed、已捨棄 409；空批次 failed 並說明；`photo.classify` 關閉／閘門不可用整批 failed 並回 403／503；`sitelog.whiteboard` 關閉照常起稿但不轉錄）。`aiFeatures.test.js` 改 18 個功能並釘 `field_docs.draft` 七欄；`photoMatch.test.js` 釘前端與 Edge 是同一支 `matchLeaf`；`errorLeak.scan.test.ts` 釘新函式走 `openAiGate`＋`askAiFeature`、三支入口共用 `sitePhotoVision.ts`。
- `npm run check:edge`（Deno 2.9.6，本機安裝）：18 支入口通過。`npm run lint` 零警告；`npm run build` 通過；`npm run check:docs` 見 PR。
- `npm run test:db`（一次性資料庫從零套 65 支 migration＋seed，rebase 後重跑）：45 檔、1,518 通過、0 失敗（＝P1b 基準 1,510＋新增 `ai_field_docs_draft.sql` 8 條：功能列七欄、trial 專案可用、平台總開關關閉後專案覆寫翻不過）；`ai_platform.sql` 計數改 18。seed migration 因與 P1b 的 `20260917210000` 同時間戳，改為 `20260917213500_ai_field_docs_draft`。
- 未做：**模型品質未驗**——本單元全部以 stub 證明流程，未以真模型金鑰對測試照片實跑（本機無 `ANTHROPIC_API_KEY`），清晰／模糊／非現場／混合照片的辨識與轉錄正確率列 P7b；未在真後端對 `draft-field-documents` 發 HTTP 請求（P2c 接上前端後以 `e2e:real` 驗）；正式 Edge 部署與 seed migration 套用於合併後執行並記 CURRENT §6.3。
### 2026-09-17 P1b：退場頁唯讀化（PR #113，migration `20260917210000_cost_items_retire`）

- `npm run test:db`（一次性資料庫從零套 64 支 migration＋seed，rebase 到含 P2d 的 main 後重跑）：44 檔、1,510 通過、0 失敗（＝P2d 基準 1,486＋新增 `cost_items_retired.sql` 24 條；rebase 前 43 檔 1,370）。新增套件覆蓋：`authenticated` 對 `cost_items` 只剩 SELECT、`anon` 無任何寫入；只剩一條 SELECT policy；廠商成員可讀歷史但 INSERT／UPDATE／DELETE 皆 42501；監造／機關讀 0 列且不可寫；非成員跨案讀 0 列、對 A 案與自己管理的 B 案都不可新增；監造組織的專案管理者可讀（`can_access_contractor_private` 原條件）但不可改刪；全部嘗試後歷史列數與數值無損。`p0_05_audit_events.sql` 的廠商更新改斷言 42501，稽核流無成本事件的斷言不變。
- `npm test`：120 檔、1,261 項（新增 `valuationChecks.test.js` 5 條、`ledger.test.js` 改為「無成本寫入函式」、`Portfolio.error.test.jsx` 改為選案清單合約 4 條；刪 `portfolioExceptions.test.js`）；`npm run lint` 零警告；`npm run build`；`npm run check:docs` 55 檔、363 連結、0 錯誤。
- `npx playwright test` owner／routes／contractor／workflow-ux／reachability 五檔 38 項＋a11y 18 項全綠：`/cost` 廠商直達後只有搜尋框、無 spinbutton／新增／刪除鈕、有 CSV 鈕與退場 `note`；`/portfolio`「專案清單」三列（本案標目前專案、B 區）、無「累計估驗／各案均無未結例外」；`/valuation`「本期勾稽檢核」清單至少一項、Agent 稽核提示卡連結「前往估驗計價查看勾稽檢核」可達估驗頁；`/audit` 機關可達且帶退場 `note`、廠商仍被守衛擋；B-02 跨頁一致第三面改施工月報 `NT$ 724,388,067`；h1 與返回連結皆為「今日工作」；a11y 三角色 375＋1024 全路由（含 hidden 的 `/cost`、`/audit`）無水平溢位。
- 內建 Preview（示範模式）：監造 `/valuation` 本期勾稽檢核卡 2 項風險／1 項注意／已勾稽 50 項；`/portfolio` 三列清單；廠商 `/cost` 統計卡＋分類表＋唯讀明細（備註欄）＋CSV（8）；機關 `/audit` 退場說明＋「前往估驗計價」連結、清單 3 風險 3 注意。
- 未做：正式 `db push`、demo 重佈與 `check:prod` 於合併後執行（結果記 CURRENT §6.3）；真後端（e2e:real）未跑——本單元無 RPC／Edge 變更，成本寫入拒絕由 pgTAP 證明；真人驗收。

### 2026-09-17 P2d：施工日誌存版／簽署／提送 RPC（migration `20260917205000_field_document_rpcs`）

- `npm run test:db`（一次性資料庫從零套 63 支 migration＋seed）：43 檔、1,486 通過、0 失敗（＝P2a 基準 1,346＋新增 `field_document_sign.sql` 140 條）。新增套件全部以真實 `authenticated` 角色＋JWT claims 呼叫 RPC，覆蓋：五支 RPC 與兩支 guard 存在、`authenticated` 可執行五支公開 RPC 而內部函式／helper 不可、anon 全無、事實列綁定索引只算活文件；純函式（必填鍵＝固定六欄＋內容各工項數量、stored 聯集但工項鍵只由內容重算、非日誌類型只回 stored；待補判定 missing／pending／na 無 reason／未知狀態）；存版（樂觀併發 `PD001`、內容形狀 `PD010`、監造／機關／非成員 `PD006`、同方第二人可接手、待補自動 `pending_input`／齊備 `draft`、`required_fields`／`recheck` 寫回、雜湊由 DB 算、人工版本建立者＝登錄者）；簽署（aal1 `PD003`、舊版 `PD001`、雜湊 `PD002`、空白意願 `PD010`、監造／機關／非成員 `PD006`、監造日誌 `PD007`、待補 `PD004`、監造照片／未知上傳方冒充施工證據 `PD005`、外案工項／負數／缺值／日期不符／labor 非陣列 `PD010`；成功：簽署列由伺服器取簽署者／aal／IP／UA／意願、文件 signed＋`target_id`、`daily_logs` 以簽署內容落庫且 `status='已簽署'`、`daily_log_items` 只落有數量工項、指向文件的 AI 草稿標 edited 且 `resolved_by`＝簽署者、舊 `draft_daily_log` 不受影響、`agent_action_resolved`／`field_document.signed` 稽核；同人重試冪等不重複、他人再簽 `PD008`）；事實表 guard（已簽署日誌的直接 UPDATE／舊 upsert／DELETE／明細 INSERT／UPDATE／DELETE、service 路徑、偽造 GUC 指向別日文件全部被擋；未簽署日誌 UPDATE／明細 INSERT／DELETE 照舊）；簽後更正（新版本 `amended_from_version`、回 draft、事實列仍是舊簽署內容且受保護、舊簽署綁舊版、重簽後事實列更新、`field_document.amended`）；提送（對象矩陣 `PD010`、舊版 `PD001`、監造／非成員 `PD006`、首次無 diff、同 `client_request_id` 回同回執、同 id 換對象 `PD009`、同版本同對象自然鍵冪等、提送方不可自收）；收件／退回（舊版 `PD001`、非對象 `PD006`、收件冪等、退回無原因 `PD010`、退回回執與原因保留、退回重試冪等、退回後再退／收件 `PD008`、原版再送 `PD008`、新版本重簽再送 diff 由 DB 算、歷次 4 筆保留、已收件不可再存版 `PD008`）；superseded 後新文件簽署接手同一事實列；非正式案 admin_override 可代編輯但 aal1 仍 `PD003`、aal2 可簽且如實記簽署者組織；捨棄不可存版；專案刪除 cascade 通過 guard。
- `npm run lint`、`npm test`（120 檔 1,259 項）、`npm run build`、`npm run check:docs` 見 PR。
- 未做：Edge／前端無新功能（P2b／P2c 尚未接 RPC，前端仍走 `saveSiteLog` 直接寫未簽署日誌）；`sign_field_document` 只有 `daily_log` 分支（其他類型 `PD007`）；正式 `db push` 於合併後執行並記 CURRENT §6.3。

### 2026-09-17 P2a：現場文書家族資料層（migration `20260917201000_field_documents`）

- `npm run test:db`（一次性資料庫從零套 62 支 migration＋seed）：42 檔、1,346 通過、0 失敗（＝T0 基準 1,131＋新增 `field_documents.sql` 215 條）。新增套件覆蓋：結構與索引；欄位級 grants（`field_documents` 只有 INSERT 六欄、無 UPDATE／DELETE；版本／簽署／提送表只讀；`photo_intakes` INSERT 三欄／UPDATE 三欄；`photos` 的 `uploader_org`／`ai_*`／`work_item_hint` 客戶端不可寫、既有欄不變；anon 全無）；`photo_intakes` 三角色＋非成員＋跨案、身分 stamp、狀態只能捨棄、候選只能切換 excluded、有照片不可刪；`photos` 上傳方由伺服器決定（冒名無效、特權路徑也不可改）、批次同案同方、登錄後不可改掛、舊資料依 profile 回填／推不出留 null；`field_documents` 三角色＋機關唯讀＋非成員、責任方由類型產生、同日唯一、範本同案、廠商批次不能起稿監造文件、監造日誌成員可讀；版本不可變（service 也不能 UPDATE／DELETE）、雜湊由 DB 算且客戶端值被覆蓋、版本號連續、human／ai 版本情境、有人工版本後 AI 不得寫、附件同案；狀態結構要件（無簽署列不能 signed、版本指標不可回退／必須指向最新版）；簽署（使用者不可直插、伺服器不可代簽、越權、非成員、舊版本、雜湊不符、aal1 冒 MFA、空白意願、紙本缺證據、伺服器取簽署者／IP／UA／時間、重複簽署冪等鍵、不可改刪）；提送／收件／退回（對象矩陣、未簽不可送、`client_request_id` 防重複、提送方不可自收、非對象不可收、`to_org` 伺服器帶入、退回必填原因、退回後原版不可再送、再送 diff 由 DB 算、歷次全部保留、不可改刪）；稽核事件十類；捨棄／取代終態；專案刪除 cascade 通過所有不可變 guard。
- `npm run lint`、`npm test`（120 檔 1,259 項）、`npm run build`、`npm run check:docs` 見 PR。
- 未做：Edge／前端無新功能（P2b／P2c）；簽署／提送 RPC（P2d）尚未建，pgTAP 以「有 JWT 的特權路徑」模擬 RPC；`supervisor_logs` 事實表（P3a）未建，綁定即拒絕；正式 `db push` 於合併後執行並記 CURRENT §6.3。

### 2026-09-17 T0：本機 pgTAP 測試隔離（PR #107）

- `npm run test:db`（新 runner：`supabase db start` 起一次性資料庫 `PMIS_pgtap_<pid>` 從零套 61 支 migration＋seed，跑完刪）：41 檔、1,131 通過、0 失敗，與 CI `pgtap`（main `d3b7d35`）的 41 檔 1,131 完全一致；一次性資料庫建置約 25 秒、整趟約 40 秒。共用開發資料庫 `supabase_db_PMIS` 在殘留列（1 專案、3 成員）仍在的情況下，執行前後 public／auth／storage／supabase_migrations 共 86 張表的列數快照 md5 相同；執行後無 `*_pgtap_*` 容器、volume、網路殘留。
- 中斷與殘留：`db start` 進行中送 SIGINT，一次性資料庫仍被清掉；預先塞入 pid 已死的 `PMIS_pgtap_999998` 容器與 `..._999999` volume，下次執行自動清除。
- `npx vitest run scripts/test-pgtap.test.js` 14 項；`npm run lint`、`npm test`、`npm run check:docs` 見 PR。
- 未做：無正式環境變更、無 migration；`ai_platform.sql`／`p0_02_project_party_role.sql` 的全庫計數斷言未改——在從零建的資料庫上它們同時驗「沒有多出別的列」，語意正確。

### 2026-09-17 瘦身 P1c＋P1d＋手機抽屜斷點缺陷（本機 diff，`codex/slimming-p1cd`）

- `npm test`：120 檔、1,259 項通過；`navConfig.test.js` 新增 4 條（`WORK_TITLE` 與側欄第一分區同名、`navLabel`／`navEntryFor` 對子頁／群組／hidden／非導覽路由的回答、每條登記路由都有非空 label）。
- `npx playwright test` workflow-ux／a11y／reachability／routes 四檔：35 項通過。新增 `a11y.spec.js`「375px 抽屜開著拉寬到 1024」：修正前紅（拉寬後 `body` 仍 `position:fixed`、內容鎖在畫面外），修正後綠（鎖定隨抽屜消失解除、`scrollY` 還原 300、縮回 375 「更多」`aria-expanded=false` 且不鎖）。`workflow-ux.spec.js` 首頁主入口列改以 `WORK_TITLE` 定位。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs`（55 檔、357 連結、0 錯誤）通過。
- 內建 Preview（示範模式、廠商）：1024 首頁操作列為「工作 · 現場紀錄／履約時程／估驗請款」；提醒中心副標「與「今日工作」同一份事項…」、頁尾指路「履約時程」；375 底欄＝輪到我／現場／履約／估驗／更多；抽屜開著（`body` 固定於 `-300px`）拉寬到 1024 後 `body` 樣式清空、`scrollY` 回 300、內容與 icon rail 可見，縮回 375 抽屜未彈開。
- 未做：真專案的初始化清單文案（`navLabel('/members')`＝三方成員）只由單元測試覆蓋，未在真後端目視；真人驗收、iPhone 實機。

### 2026-09-17 P4a：監造確認量與估驗上限的純計算層（PR #103）

- `npm run test:db`（本機 colima Supabase，`supabase migration up --local` 套到 `20260917120000` 後，未 reset）：41 檔、1,125 通過；新增 `confirmed_quantity_calc.sql` 83/83——申報未通過→0、通過 60 已計價 20→40、同批多次查驗／複查／多階段不累加、不同位置分計、改善後只增 40、兩期占用超額為負、FIFO 分配、跨期增量、超契約量／錯單位／負值／NaN／無限大／截止日後／狀態不明／缺批次鍵一律拒絕、總價缺 basis→cap 0、14 支函式皆 IMMUTABLE 且 anon／authenticated 不可執行。`ai_platform.sql` 1 條與 `p0_02_project_party_role.sql` 4 條計數斷言因共用本機 DB 殘留列（1 專案、3 成員）失敗，與本支 migration 無關；CI `pgtap` 從零套用為準。
- `npm run check:docs`：55 檔、355 連結、0 錯誤。
- 未做：前端／Edge 無改動，未跑 Vitest／E2E；正式 `db push` 於合併後執行並記 CURRENT §6.3。

### 2026-09-16 小包 D：Codex §5 版面與操作感受（五項；本機 diff，未發布）

- `npm test`：119 檔、1,241 項通過；新增 `BOQ.search.test.jsx`（預設只展開第一層；名稱／項次關鍵字只列符合列與所屬各層、符合列 `aria-current`、`role="status"` 報件數；找不到明說；清除回原展開）；`Submittals.review.test.jsx` 改為 AI 助手預設收合、展開後才列能力與「未啟用」說明，收合時決定鈕照樣在。
- `npm run test:e2e` 送審／監造／機關／廠商／a11y／routes／workflow-ux 七檔：59 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440×900：機關開 CO-002，「核准」鈕頂端由 y=844 → 754，詳情不再重複列狀態／淨額／明細筆數；監造開 SUB-003，「受理審核」由 y=941（首屏外）→ 770（AI 助手收合）／888（展開），點「受理審核」對話框標題「受理審核：SUB-003」、按鈕「取消／受理審核」；標單頁搜「鋼筋」找到 14 項、列 29 列（含祖先章節）並標記符合列、URL `#/boq?q=鋼筋`，搜「窯燒磚」明說沒有符合，清除回 37 列；廠商日誌未存檔時照片區寫「先按下方「存檔」建立本日日誌，存檔後這裡會出現「上傳照片(不辨識)」」；工安頁與品質缺失頁底部不再出現「狀態機」。
- 未做：提早顯示「上傳照片(不辨識)」；手機章節摘要不套搜尋；真專案、真人驗收、手機／平板。

### 2026-09-16 補強包 C 第二批：進度口徑 D-024（C1–C4 實作；本機 diff，未發布）

- `npm test`：118 檔、1,239 項通過；`progressPlan.test.js` 依月底累計語意重寫（月初低於月底、月底等於該列、跨年閏日、單月計畫）；新增 `progressAsOf.test.js`（過去月份取月底、本月取今天、未來月份不落在未來；未來日期的估驗期不算、未填日期一律納入、狀態不論）、`Reports.caliber.test.jsx`（施工月報與監造報表同月份同一天同一期；本月截至今天、過去月份截至月底；收款／請款截至截止日；意見草稿寫明截至何日）。
- `npm run test:e2e` 監造／廠商／機關／a11y／routes／workflow-ux／reachability 七檔：60 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（監造，2026-09-16）：施工月報 09 月＝監造報表 09 月＝進度頁＝首頁風險＝跨案本案：預定 22.6%／實際 13.0%／落後 9.6%，三頁都標「統計截止日 2026-09-16（本月尚未結束，以今天為準）」與「第 5 期（監造審核）」；08 月兩份報表同為預定 18.9%／實際 10.5%／落後 8.4%、截止日 2026-08-31、第 4 期（已核定）；月報收款與請款期數標「（截至 …）」。改前 09 月是月報 25.9%／落後 6.0% 對監造報表 29.8%／落後 9.8%。
- 未做：DB `portfolio_summary`（跨案其他案）仍取最新期；真專案、真人驗收、手機／平板。

### 2026-09-16 補強包 C：報表口徑與資訊層級（W07 對照／W09 更名；本機 diff，未發布）

- `npm test`：116 檔、1,228 項通過（純文案與文件，無新測試）。
- `npm run test:e2e` 監造／廠商／a11y／routes／reachability 五檔：45 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（監造，2026-09-16）：W07 逐條核對——施工月報 09 月預定 25.9%／實際 19.9%／落後 6.0%，08 月 18.9%／16.0%／2.9%；監造報表 09 月與 08 月同為預定 29.8%／實際 19.9%／落後 9.8%；進度頁今日預定 29.8%；月報累計已收款兩個月都是 NT$ 82,963,685、已請款 4 期。W09 改後 `/progress` 卡片標題為「估驗完成率差距（依金額權重）」、說明句明寫不是工項排程落後判定，排行內容與順序不變（前三列仍為利潤／管理費、營業稅、保險費）。
- 未做：W07 標示文案與任何公式修正（待 `docs/reviews/2026-09-16-uiux-w07-progress-caliber.md` §5 決策）；真專案、真人驗收、手機／平板。

### 2026-09-16 補強包 B：工作交接與回找（W05／W06／W08／D01；本機 diff，未發布）

- `npm test`：116 檔、1,228 項通過；擴充 `useUrlFilters.test.jsx`（改寫篩選保住 `location.state`）、`Quality.journey.test.jsx`（從待辦進來切分段後 `taskReturn` 仍在）、`Dashboard.setup.test.jsx`（原項離開清單時不指向今天已完成、給「回到剛才處理的那一筆」連結）、`Submittals.create.test.jsx`（不再要求建立後註明附件說明；示範模式無上傳鈕）；`Submittals.correction.test.jsx` 的 store 標為真專案以保留上傳測試。
- `npm run test:e2e` 監造／廠商／送審／機關／workflow-ux／a11y 六檔：55 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：監造從首頁查驗待辦進 `/quality?inspection=INSP-DEMO-4`，切到「缺失」分段（URL `seg=defects`）後「返回今日待辦」仍在；機關核准 CO-002 後返回，首頁顯示「剛才處理的事項已不在「現在輪到我」」與「回到剛才處理的那一筆」（連到 `/change-orders?co=CO-DEMO-2`，點擊後詳情為已核准的 CO-002）；廠商在示範模式開送審詳情看到「示範模式不支援上傳文件本體」且無檔案輸入框，文件區提示改為「附件說明只在建立時填寫」。未測：真人驗收、正式上傳。

### 2026-09-16 補強包 A：輸入與資訊可信度（W01–W04；本機 diff，未發布）

- `npm test`：116 檔、1,226 項通過；新增 `unsavedEdits.guard.test.jsx`（無登記不攔、有登記換路徑先問且取消不放行、確認後清登記並重觸發同一連結、同路徑／外部連結／修飾鍵不攔）、`qc.coverage.test.js`（只填一項 1／15 與 14 項未檢、全填、含不合格、未填、範本已刪除）；擴充 `Submittals.review.test.jsx`（受理後標「最新審查意見」不再標「上次退回原因」）、`supervisorReport.test.js`（無「按日到場／已促請／尚符合契約／均符合設計圖說／督導情形良好／追蹤改善」，含「請補充」）、`ChecklistSection.unsaved.test.jsx` 與 `Quality.journey.test.jsx`（編輯判定旁、存檔訊息、紀錄列、檢附選項的覆蓋程度）。
- `npm run test:e2e` 監造／廠商／送審／a11y／workflow-ux／reachability 六檔：52 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：廠商在日誌填摘要後點側欄「品質查驗」出現「離開將遺失未存檔內容」確認框，取消留在原頁且摘要仍在，確認後到 `/quality`；檢查表只填一項時判定旁顯示「已檢 1／15，14 項未檢；判定僅依已檢項」，紀錄列亦標覆蓋程度（Demo 種子紀錄顯示「已檢 9／15，6 項未檢」）；監造受理 SUB-003 後摘要改標「最新審查意見」；監造報表意見不含「按日到場／已促請／尚符合契約」。未測：瀏覽器返回鍵、正式 Edge 生成的佐證包文案、真人驗收。

### 2026-09-15 UIUX 階段 6：跨角色旅程驗收與收尾（本機 diff，未發布）

- `npm test`：114 檔、1,218 項通過；新增 `useUrlFilters.test.jsx`（寫入／函式型更新／等於預設即刪／由 URL 回填）、`useListDetailPane.missing.test.jsx`（失效深連結回報並清參數、有效深連結不回報）；擴充 `SiteLog.dailyLog.test.jsx`（`?d=` 直達）、`Dashboard.setup.test.jsx`（返回但原項已離開清單的說明）、`todayTasks.test.js`（日誌待辦帶 `?d=`）。
- `npm run test:e2e` 全部 10 檔：70 項通過（三角色側欄可達、深連結、篩選返回、375／1024 無溢位皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。先前各階段整批偶發的 `Requirements.integrity.test.jsx` unhandled error（深連結 60 ms 捲動計時器呼叫 jsdom 沒有的 `scrollIntoView`）已在 `useListDetailPane.js` 以可選呼叫修正（PR #86），本機連跑兩次無 Errors。
- Demo 預覽 1440 px 三組旅程實測：機關 CO-002 待辦→詳情摘要→確認框→核准→返回今日待辦顯示原項已離開；機關初驗待辦→`?stage=initial` 當前列；`/submittals?submittal=NOPE` 顯示找不到並清參數；提醒中心 `?bucket=overdue` 前往處理再返回篩選保留；廠商日誌待辦→`/site-log?d=今天`；監造 SUB-003 待辦→待受理摘要→受理→返回今日待辦原項取得焦點。矩陣見 `docs/reviews/2026-09-15-uiux-stage6-acceptance.md`。**真人驗收未完成；正式後端未測。**

### 2026-09-15 UIUX 階段 5C：驗收當前階段與下一步（本機 diff，未發布）

- `npm test`：112 檔、1,212 項通過；新增 `Acceptance.stage.test.jsx`（目前階段卡的可登錄者／前置／下一步、`?stage=` 指到當前階段定位且未到階段無輸入框、深連結到已完成／未輪到／不存在階段只說明實際狀態、監造等待機關而廠商報竣可登錄、核對句與登錄成功後的下一階段、不合格展開缺失改善）；`todayTasks.test.js` 的驗收待辦連結改斷言帶 `?stage=`。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` a11y／機關／廠商／監造／workflow-ux 五檔：53 項通過（機關待辦可見驗收法定期限、驗收頁 375／1024 無溢位不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（機關）：`/acceptance?stage=initial` 顯示「目前階段」卡與下一步，初驗列為當前列；`?stage=report` 顯示「已於 2026-08-18 登錄完成；目前階段是「初驗」」的說明且不開編輯。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 5B：機關變更核定的資訊順序（本機 diff，未發布）

- `npm test`：111 檔、1,208 項通過；新增 `ChangeOrderDetail.decision.test.jsx`（機關待你核定摘要、事由理由、核准後契約金額、未登錄三行、核准／駁回確認框指向單據與金額且取消不寫入；監造只有受理／退回；廠商只有刪除；已核准顯示已計入）。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` 機關／a11y／監造／廠商／workflow-ux 五檔：53 項通過；`owner.spec.js` 核准流程改為先取消確認框（列狀態仍為審核中）再確認核准，變更後契約金額跨頁一致的斷言不變。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（機關）：CO-002 詳情頂端「待你核定 · CO-002」、事由與理由、「核准後變更後契約金額將為 NT$ 724,388,067（+0.24%）」、本系統未登錄三行、核准／駁回鈕附「兩者都會再確認」；全案金額卡位於清單之後。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 5A：請款收款逐欄保存回饋（本機 diff，未發布）

- `npm test`：110 檔、1,205 項通過；新增 `Payments.cells.test.jsx`（請款日成功「已儲存」、失敗留輸入值並標「未儲存＋正式值」且可還原、晚於今日不打 API、缺前置日期鎖定並就近提示、溢收取消拉回正式值並說已取消、指定期別只列該期且統計標全案累計與匯出標全案 n 期、不存在期別不列任何列）。
- `npm run test:e2e` workflow-ux／機關／a11y／監造／廠商五檔：53 項通過（指定付款期返回、不存在期別、監造進不了請款收款皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px（機關）：頁首明示不執行付款、表上方保存語意提示、匯出「全案 5 期」；把第 1 期請款日改成 2999-01-01 離開欄位後，欄位下方顯示「未儲存：請款日不可晚於今日…正式值仍是 2026-06-05」與「還原」。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 4：監造送審審查順序（本機 diff，未發布）

- `npm test`：109 檔、1,200 項通過；新增 `Submittals.review.test.jsx`（補正再送件的待受理摘要與上次退回／本次補正對照、受理後才出現審定鈕、退回補正空白原因不寫入、取消不寫入、核准失敗狀態不變、核准後留結果與「下一件待審」由人點才換單、AI 開啟時兩項能力說明與未上傳文件本體讀不了）。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` 送審／監造／廠商／a11y 四檔：40 項通過（監造核准後 SUB-002 移入已完成、廠商無審定鈕皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：監造開 SUB-003 詳情，頂端摘要「待受理 · Rev.1 補正再送」與上次退回原因，文件區有 AI 助手說明，「審查意見與決定」只列受理段按鈕。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 3C：廠商每日填報的資訊層級（本機 diff，未發布）

- `npm test`：108 檔、1,197 項通過；新增 `SiteLog.dailyLog.test.jsx`（保存狀態章四態與未存檔登記、存檔失敗留值／成功「已存檔 ✓」、切日期先確認且拒絕不換日、公定欄位預設收合與「填寫」展開、照片區併入本日日誌且訊息不混入存檔列）。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` a11y／監造／廠商／路由四檔：42 項通過（存檔鈕 ≥44px、375／744 貼底存檔列不被底欄遮蔽、監造日誌唯讀且無存檔鈕、列印頁標題皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：施工日誌卡頭顯示「本日尚無日誌」狀態章與帶入天氣／複製昨日；本日施作數量在照片與公定欄位之前；照片為本日日誌內一節；公定欄位收合並列出「尚未填：出工人數／機具使用／材料使用」；存檔列 `position: sticky`。存檔失敗與切日期確認以 jsdom 驗證；未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 3B：廠商品質流程與未存檔保護（本機 diff，未發布）

- `npm test`：107 檔、1,194 項通過；新增 `ChecklistSection.unsaved.test.jsx`（填值登記未存檔、取消先確認、存檔失敗留值／成功解除）、`Quality.journey.test.jsx`（填一半→切查驗（URL `?seg=`、chip 標未存檔）→切回值仍在→存檔→提出查驗申請預填現行版檢附→送出→已送出／已檢附／等待監造並選中新查驗；送出失敗表單與檢附留著；切換專案未存檔表單不沿用）。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動）。
- `npm run test:e2e` 廠商／監造／workflow-ux／a11y 四檔：47 項通過（缺失分段深連結、判定開缺失、分段 44px、直達試體分段皆不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：廠商在檢查表填實測值後切到查驗分段，chip 顯示「未存檔」、URL 帶 `seg=inspections`；切回檢查表輸入仍在。切換專案的確認框需多專案真後端，未在 Demo 重現；未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 3A：廠商提送、附件與補正（本機 diff，未發布）

- `npm test`：105 檔、1,189 項通過；新增 `Submittals.correction.test.jsx`（退回補正件先看退回原因／版次／附件、修正再送只出現一次；上傳失敗附件狀態不變且可重選、成功只講文件已更換仍需再送；再送成功顯示 Rev.1 與等待監造、補正紀錄分列且原附件說明不被覆蓋；取消不寫入、失敗可重試），`Submittals.create.test.jsx` 加「提送紀錄已建立」與附件狀態斷言。整批仍偶發既有 `Requirements.integrity.test.jsx` 的 `scrollIntoView` 時序 unhandled error（未動的檔案）；新測試已自行 stub。
- `npm run test:e2e` 送審／廠商／監造／a11y 四檔：40 項通過（監造與機關看同件的動作與資料不變）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：廠商提送「5F 模板施工計畫」後表單收起、詳情為 SUB-004 並顯示「提送紀錄已建立（SUB-004，Rev.0，狀態：已提送）。尚未上傳文件本體…」；「文件與提送方式」區含上傳鈕與外部提送說明。退回補正與上傳失敗情境 Demo 種子沒有，以 jsdom 驗證；未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 2a：入口方案 B（側欄自動展開、PageTabs 條件渲染；本機 diff，未發布）

- `npm test`：104 檔、1,185 項通過；新增 `PageTabs.sidebar.test.jsx`（側欄列出同組時不畫分頁列；null 或別組時照畫且同組子頁皆為連結、`aria-current` 正確）。同次執行偶發 1 筆 unhandled error 來自既有 `Requirements.integrity.test.jsx` 的 60 ms 捲動計時器在 jsdom 缺 `scrollIntoView`（未動的檔案，單獨連跑三次皆無此錯誤），屬既有時序 flake，未修。
- `npm run test:e2e` 全部 10 檔：70 項通過。`reachability.spec.js` 改為：點群組列進第一子頁後自動展開、內容區無同組分頁列、逐一點到每個子頁、手動收合後分頁列出現、鍵盤 Enter 再展開又收掉；`routes.spec.js` 深連結段改為自動展開、收合後分頁列 `aria-current` 落在目前頁、同組換頁保持展開。三角色可達路由數：廠商 23、監造 21、機關 22（自 navConfig 推導）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- Demo 預覽 1440 px：進 `/submittals` 側欄自動列出送審文件／工程疑義／變更設計、內容區無分頁列；按「收合審查與協作子頁」後側欄子頁隱藏、分頁列回到頁首且目前頁高亮。未改 DB／Edge，未真人驗收。

### 2026-09-15 UIUX 階段 2（部分）：初始化與待辦並存、提醒篩選進 URL、AI 入口名稱（本機 diff，未發布）

- `npm test`：103 檔、1,182 項通過；新增 `Dashboard.setup.test.jsx`（無標單真專案首頁同時有初始化卡與可點待辦、非管理者說明、等待對方不帶初始化卡）、`Alerts.filters.test.jsx`（篩選寫進 `?q=`／`?bucket=`、清除一起刪、由 URL 回填）。
- `npm run test:e2e` 全部 10 檔：70 項通過（含三角色側欄可達性、1024／375 全路由無溢位、功能搜尋鍵盤焦點）。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過。
- 未動 `PageTabs`、側欄展開行為與路由授權；入口方案 A／B 待採用。未改 DB／Edge；U05 的真案（無標單、有送審）以 jsdom 模擬 store 驗證，未在正式後端重現；未真人驗收。

### 2026-09-15 UIUX 階段 1：操作可信度（本機 diff，未發布）

- `npm test`：101 檔、1,177 項通過；新增 `Acceptance.stageRow.test.jsx`（未選結果不寫入、明選不合格照送、失敗保留輸入）、`Submittals.create.test.jsx` 與 `RFI.create.test.jsx`（建立失敗保留表單與同一份輸入物件、連點只建一筆、非預期例外收尾 busy、重試成功選中新紀錄）。
- `npm run test:e2e` 相關六檔（submittals／rfi／owner／contractor／supervisor／workflow-ux）：40 項通過。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs` 通過；build 仍有既有 >500 kB chunk 警告。
- 未改 DB／Edge；未跑真後端、未真人驗收。失敗情境以 jsdom 模擬 store 回傳錯誤與例外重現，不代表正式環境已重現。

### 2026-09-14 三方 UIUX 操作流程

- `npm test`：98 檔、1,169 項通過；待辦深連結涵蓋查驗、觀察、試體、ITP、估驗與請款。
- `npm run test:e2e`：10 檔、70 項通過，包括新增 9 條三方旅程、375／1024px 全路由無溢位、手機第一筆待辦在 400px 之前、指定期別及不存在期別、判定後返回清單、搜尋角色隔離與鍵盤焦點。
- `npm run lint`（零警告）、`npm run build`、`npm run check:docs`（43 份 Markdown、217 個本機連結）通過。build 仍有既有 >500 kB chunk 警告。
- 已透過本機示範站檢查機關付款定位／返回、廠商手機首頁的實際畫面。此輪未改 DB／Edge，未執行正式資料寫入或真人手機驗收；不以 Demo 通過代表正式三方驗收。

### 2026-09-12 既有驗證快照

| 項目 | 結果 | 指令／範圍 |
|---|---|---|
| Vitest | 98 檔、1158 測試通過 | `npm test`；含機關責任期限進待辦、Portfolio error state、Requirement 表單可及名稱、兩步驟驗證閘門（`auth.mfa.test.js`）。worktree 內 node_modules 為 symlink 時需以 `server.fs.allow` 覆寫設定執行 |
| 預定進度時區回歸 | 同日第一輪：14 測試在 UTC 與 America/Los_Angeles 各通過；此輪未再改公式 | `TZ=UTC node node_modules/vitest/vitest.mjs run src/lib/progressPlan.test.js`，另改 TZ 重跑 |
| Demo E2E | 9 檔、56 測試通過（含 `reachability.spec.js` 三角色側欄可達性、三頁 375px a11y） | `npm run test:e2e`，本機 Vite／Chromium，未連真 DB。5188 被其他 checkout 的 dev server 佔用時 `reuseExistingServer` 會打到別人的程式碼，改用獨立埠設定跑 |
| GitHub 合併檢查 | PR #67、#69、#70、#76、#78（整合 #71–#75、#77）的 unit／e2e／pgtap 全過後合併；#79 見 PR | 正常 merge commit 合併，未 bypass；Cloudflare main 建置由 push 觸發，正式版本見 CURRENT §6.3 |
| ESLint | 0 error／0 warning | `npm run lint` |
| production build | 通過；仍有 >500 kB chunk 警告 | `npm run build` |
| 文件檢查 | 47 份 Markdown 的本機檔案／標題連結通過 | `npm run check:docs`；不連網驗外部網址 |
| pgTAP | 40 檔、1048 通過、0 失敗 | `npm run test:db`；既有本機 Supabase DB，未 reset、未改 migration。跑法見 [SETUP](../supabase/SETUP.md) |
| 真後端 E2E | 6 測試通過；本機真 DB／Auth／Storage，固定契約資料模式 | `ANTHROPIC_API_KEY= npm run test:e2e:real`；測試自行建立／清理登入帳號。未呼叫真模型，見 [指南](REAL_BACKEND_E2E.md) |
| Deno 型別檢查 | 18 支入口及其共用依賴通過（2026-09-17 P2b 加 `draft-field-documents`） | Deno 2.9.6，`npm run check:edge`；依賴鎖定於 functions/deno.lock，已納 CI。未部署或驗證線上 Edge |
| 腳本／設定語法 | 8 份 Python、7 份 JSON 通過 | AST／JSON parse；不代表外部素材匯入或簡報渲染已實跑 |
| 依賴 audit | production 0、dev 2 moderate | `npm audit --json`；Vitest／@vitest/mocker 同一 advisory，修補需大版升級，列 ROADMAP 獨立處理 |

## 2. 檔案規模

| 項目 | 本輪核對 | 現查方式 |
|---|---|---|
| migrations／rollbacks | 60／10 | `rg --files supabase/migrations supabase/rollbacks` |
| 待套正式 migration | 0 支（2026-09-11 `migration list --linked` 60／60 對齊） | 部署前 `supabase migration list --linked` |
| pgTAP | 40 檔、plan 加總 1048 | `rg 'plan\(' supabase/tests`；加總不等同實跑 |
| Edge／shared 非測試模組 | 17／29 | `rg --files supabase/functions` |
| web 非測試頁面／Store slices | 34／9 | `rg --files src/pages/web src/store/slices` |
| 架構文件（含索引） | 15 | `rg --files docs/architecture -g '*.md'` |

路由數與 AI 功能數直接查 `src/lib/navConfig.js`、`src/lib/aiFeatures.js`；不另維護重複計數。

## 3. 覆蓋與文件精簡

盤點前端、Store、Edge 的 291 個 JS／JSX／TS 模組之匯入／匯出使用點；移除無生產使用端的舊 requirement wrapper、摘要 helper 與空 logger。測試工具及前後端註冊鏡像保留，不按「只有測試 import」機械刪除。DB 以 migrations／pgTAP 核對，既有 migration 不回改。

第一輪已刪 50 個過期文件／handoff 資產；本輪再刪 7 個重複掃描報告、過時簡報產生器與 v1 設計稿。相對本輪起點 `6987ef7`，全部版控 Markdown 字元量由約 38.2 萬降至約 20.5 萬，減少約 46%；必讀入口相對原始 37,066 字元減少約 70%。這是字元量，不是 tokenizer 實測。

15 份架構文件與操作指南已對齊現行程式；歷史資安／採購證據、驗收原句、仍有效設計／簡報來源及選用設計 skills 保留。過期檔可用 Git 追溯。未完成產品能力集中 ROADMAP，正式版本集中 CURRENT，不在各文件複製交付計數。

尚未驗證真模型語意準確率、真人手機／真案三角色、正式後端部署與備份還原。所有通過結果只支持上述測試範圍，不代表零缺陷或正式驗收完成。
