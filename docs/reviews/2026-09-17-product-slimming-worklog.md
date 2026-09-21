# 產品瘦身與 AI 文書：續接工作清單

> 2026-09-17｜唯一續接紀錄。需求依據：[瘦身報告](2026-09-17-product-slimming-report.md)、[實作指令](2026-09-17-claude-product-slimming-prompt.md)；產品邊界 [D-026](../DECISIONS.md)；設計 [現場文書](../architecture/field-documents-lifecycle.md)、[確認量與估驗](../architecture/confirmed-quantity-valuation.md)、[入口與退場](../architecture/slimming-entrypoints-and-retirement.md)。
> 規則：每個工作包五行（問題／目標／不做／影響／驗收≤5）；每單元記相依、指定模型、**實際模型**、範圍、驗收；進度只寫在 §7，不另開報告。CURRENT 只記已上線現況。

## 1. 模型核對結果（2026-09-17）

- 使用者要求：`fable5.1` 主控、簡單低風險用 `opus5.2`；須核對實際模型，不得假稱切換或自行替換。
- 核對：主 session 實際模型為 **Opus 5（`claude-opus-5`）**，無法自行切換，只負責派工與轉述，不做設計或業務判斷；`fable` 子代理實際為 **Fable 5.1（`claude-fable-5-1`）**，本包 P0 由它執行；環境中**沒有 `opus5.2`**，只有 Opus 5。依指令「模型不可用時不擅自替換」，不派任何工作給 opus5.2，也不以 Opus 5 代替；所有工作包（含原可交 opus5.2 的純呈現工作）由 Fable 5.1 執行——P 表寫「fable5.1 主導；純呈現可 opus5.2」，由 fable5.1 做仍在指定範圍內。
- 每單元的「實際模型」欄在該單元完成時填寫；無法驗證時寫「未驗證」。

## 2. 現況核對摘要（基準 `ab4be5f`，詳見三份架構文件 §0）

已存在：照片批次辨識→配工項→上傳（`photos` 落庫）、白板轉錄、Agent 日誌／自檢草稿（`agent_actions`）、自檢修訂鏈與判定、查驗申請／判定／缺失連動、估驗期別與核定／金流 guard、佐證確定性 join、稽核事件、AI 閘門與用量、路由 fail-closed、今日待辦三桶。

真缺：文件版本／雜湊／簽署／提送／回執；辨識結果上傳前不持久；監造日誌整份缺；查驗沒有數量／批次／單位／階段；估驗沒有任何確認量約束且 `fillValuationFromSiteLogs` 是繞過路徑；送審歷次退回原因未列出；前端與 Edge 待辦類型不一致；循環義務無逐期；無 OCR。

## 3. 正式資料唯讀盤點（2026-09-17，專案 `buylyonwoyvqdbvkkkbx`，遠端 60 支 migration 與 repo 對齊至 `20260911110000`；只做 SELECT 聚合，未輸出任何內容或個資）

| 表 | 計數 |
|---|---|
| `projects` | 13（正式模式 4；已匯標單 7）；`project_members` 23；`work_items` 22,834（可計價末端 20,993） |
| `daily_logs` | 12（7 案）；`daily_log_items` 33（全有數量） |
| `photos` | 2（2 配工項、1 `ai_source`、0 有 `location`、0 無日誌） |
| `inspections` | 11（7 案）：合格 4、不合格 6、待查驗 1；類型 施工查驗 6、停留點查驗 3、材料查驗 1、未填 1；判定 10 筆皆有 `inspected_by`、0 筆缺 `inspected_at`；`checklist_record_id` 0；有 `location` 7；無工項 5 |
| `valuations` | 12（8 案）：草稿 7、監造審核 1、已核定 4、已請款 0；有請款日 2、收款日 2、實收 3（1 筆實收無收款日，屬 trigger 前歷史）、有 `period_end` 3 |
| `valuation_items` | 26（`daily_log` 21、`manual` 5）；有量 26；同工項無合格查驗 22；同工項無任何查驗 17；已核定期有量 5，其中無合格查驗 4；超契約量 0；負值 0；掛非末端／非計價列 1 |
| `checklist_templates` 3；`checklist_records` | 5（合格 3、不合格 2；無工項 5；修訂版 1） |
| `test_samples` 4（待試驗 3、不合格 1）；`defects` 12（品質 開立 5／改善中 1／已結案 4；工安 已結案 2）；`inspection_points` 5；`observations` 1；`safety_records` 5；`acceptance_events` 21；`change_orders` 核准 4；`rfis` 6 | — |
| `submittals` | 7（已提送 3、核准 2、駁回 2）；`review_note` 4；`revision>0` 3、`>1` 1；附件 1；`attachment_note` 補正行 2 |
| `cost_items` 11（4 案）；`item_schedules` 4（4 案）；`schedule_periods` 72（4 案） | — |
| `agent_actions` | 0 |
| `ai_usage_events` | 102：`requirements.extract` ok 39／blocked 10、`documents.classify` 15、`photo.classify` 15、`weather.fetch` 13、`valuation.summary` 4、`agent.run` 2、`contract.parse` 2、`sitelog.whiteboard` 2；**`audit.summary` 0**、`report.monthly` 0、送審／RFI／缺失／工安 AI 0 |
| `audit_events` | 1,290（valuation.* 75、inspection.* 17、submittal.* 25、defect.* 30、requirement.* 794、document.* 245 …） |
| `contract_obligations` | 109（全 待辦；monthly 7）；`requirements` approved 106、needs_review 4；`documents` 3；`contract_packages` ready 2 |

## 4. 工作包（五行）與可獨立 PR 的單元

指定模型欄依實作指令；「實際模型」由執行者填。相依以單元編號表示。所有 DB 單元共用同一套本機 Supabase，**循序執行**（§5）。

### P0 現況核對與資料／流程設計（本包）

問題：主賣點沒有完整流程；估驗無確認量控制；瘦身缺依據。目標：核對現況與正式資料，定資料與流程設計、Decision、續接清單。不做：不改程式、不建 migration。影響：只有文件。驗收：三份架構文件、D-026、本清單、需求依據入庫、`check:docs` 通過。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P0 | — | fable5.1 | Fable 5.1 | `docs/architecture/{field-documents-lifecycle,confirmed-quantity-valuation,slimming-entrypoints-and-retirement}.md`、`docs/architecture/README.md`、`docs/DECISIONS.md` D-026、本檔、`docs/reviews/2026-09-17-*.md` 複製 | `npm run check:docs`；PR 合併 |

### P1 導覽與退場準備

問題：19 子頁＋3 參考分散核心流程。目標：四主入口、次入口、退場頁唯讀化，深連結與權限不變。不做：不刪路由、不刪表、不刪查驗／估驗。影響：`navConfig`、Layout、首頁常用入口、Cost／Portfolio／RiskAudit 頁、E2E。驗收：三角色從四主入口走完既有旅程；退場頁 hidden 仍可直達且無寫入；routes／reachability／a11y E2E 綠；`navConfig.test` 更新；無 `roles` 變更。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P1a 導覽重組 | P0 | fable5.1 | Fable 5.1 | `src/lib/navConfig.js`（三主入口群組＋專案資料兩組、`hidden`、`MAIN_ENTRY_PATHS`／`ROLE_WORK`、`WORK_GUIDANCE`、`short`）、`App.jsx` 新路由 `/site`（現場紀錄總覽：依角色列既有入口＋件數＋現場待辦，非空殼）、`src/lib/taskReturn.js`（待辦返回來源單一定義）、`navConfig.test.js`、`e2e/routes.spec.js`、`reachability.spec.js`、`a11y.spec.js`（角色路由改由 navConfig 推導） | 路由登記完整；hidden 項 `routeAllowed` 仍依角色；E2E 綠 |
| P1b 退場頁唯讀化（含 P1c 移交兩項） | P1a | fable5.1 | Fable 5.1 | migration `20260917210000_cost_items_retire`（收回 `cost_items` 寫入 grant＋select-only policy；rollback 檔；pgTAP `cost_items_retired.sql` 24 條、`p0_05` 改斷言 42501）、`Cost.jsx`（唯讀＋CSV）、`ledger.js`／`store.jsx` 移除成本寫入、`Portfolio.jsx`（選案清單；刪 `portfolioExceptions.js`）、`lib/valuationChecks.js`（新；估驗頁與稽核頁共用組裝）、`Valuation.jsx` 本期勾稽檢核卡、`RiskAudit.jsx`（唯讀查閱＋導向）、`Agent.jsx`／`Members.jsx` 承接位置、`taskReturn.js`／`navConfig.js`／`Dashboard.jsx` 頁名單一來源（今日工作）、E2E owner／routes／contractor／workflow-ux／a11y、設計文件 §2 落地結果 | 三頁無寫入入口且直接 REST 寫入成本表被 DB 拒（pgTAP）；歷史查閱／匯出原權限；跨案只剩清單／待辦；稽核檢核在估驗頁可見、Agent 勾稽仍可用；命名統一；E2E 綠 |
| P1c 首頁／底欄／提醒中心對齊四入口 | P1a | 純呈現（fable5.1 執行） | Fable 5.1 | 底欄已於 P1a 完成；本單元：`navConfig.js` 新增 `WORK_TITLE`／`navLabel`／`navEntryFor`（頁名唯一來源）、`WorkNavigation.jsx` 首頁主入口列改名「工作」、`Alerts.jsx` 副標與指路、`Dashboard.jsx`／`setupChecklist.js`／`ProjectSetup.jsx`／`Deadlines.jsx` 指路頁名改吃 navLabel；另修 P1a 發現的手機抽屜斷點缺陷（`Layout.jsx` 以 `isBelowMd && menuOpen` 推導抽屜狀態，`a11y.spec.js` 釘住） | 手機五格底欄＝四入口＋更多；無邏輯變更；抽屜測試先紅後綠 |
| P1d 文件同步 | P1a–c | 純呈現（fable5.1 執行） | Fable 5.1 | `CURRENT.md` §6.1、`route-registry-governance.md`、`UIUX` 規範 §0／§7／§8／§9.3、`BASELINE.md` | `check:docs` |

### T0 本機 pgTAP 測試隔離（P2a 之前補列）

問題：`npm run test:db` 跑在共用的本機開發資料庫上，其他工作殘留的列讓 `ai_platform`／`p0_02` 的計數斷言本機假失敗、CI 從零套用卻全綠；後續每個 DB 單元都要靠本機判斷 pgTAP 紅綠，這種不一致會讓人誤判或習慣忽略失敗。目標：本機結果與 CI 一致且可重現，不刪、不 reset 共用開發資料庫。不做：不改測試斷言遷就環境、不動 migration、不動正式環境。影響：`scripts/test-pgtap.js`（runner 自己用 `supabase db start` 起獨立 project_id 的一次性資料庫從零套 migrations＋seed，跑完 `supabase stop --no-backup` 刪）、`.github/workflows/pgtap.yml`（改走同一條路徑，不再 `supabase start`／`db reset`）、`supabase/SETUP.md`、`deploy.md`、`BASELINE.md`。驗收：殘留列仍在時本機 41 檔 1,131 通過與 CI 一致；共用資料庫前後列數快照相同；中斷與殘留自動清除；CI 綠。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| T0 本機 pgTAP 隔離 | P4a | fable5.1 | Fable 5.1 | `scripts/test-pgtap.js`／`.test.js`、`.github/workflows/pgtap.yml`、`supabase/SETUP.md`、`docs/operations/deploy.md`、`docs/BASELINE.md` | 本機＝CI 測項數；共用 DB 不變；單元測試 14 項；CI 綠 |
| T1 真後端 E2E 受測 dev server 不監看檔案（2026-09-19 補列；P3b 回報 chain 6「提送」對話框逾時 420 秒） | 無 | Opus 5（簡單低風險） | Opus 5 | 根因：dev server 監看整個 worktree，`@tailwindcss/vite` 把未 gitignore 的檔案（含 spec）登記成 CSS 相依，touch 一支就 full-reload，開著的對話框消失；另修 chain 6 一個會命中 1 或 2 個元素的 `getByText`。`playwright.real.config.js` 改用不監看的 Vite 設定（T2 後為共用的 `vite.e2e.config.js`）、`chain6-supervisor-log.spec.js`、`docs/REAL_BACKEND_E2E.md` | 修正前「簽署落庫即 touch spec」穩定重現同一行；修正後 chain 5→6→7 連跑 3 輪綠（全程每秒 touch spec） |
| T2 Demo E2E 受測 dev server 隔離（2026-09-19 補列；T1 回報的相鄰風險） | T1 | Opus 5（簡單低風險） | Opus 5 | Demo E2E 同樣監看檔案且本機沿用埠上既有 server（可能是別的 worktree）。T1 的設定移到根目錄 `vite.e2e.config.js` 兩套共用並加 `strictPort`；`playwright.config.js` 改用它、`reuseExistingServer: false`、`E2E_DEMO_PORT` 覆寫埠（預設 5188）；README、`docs/REAL_BACKEND_E2E.md` | 邊跑邊 touch 全套綠；別的目錄佔埠時直接失敗不沿用；CI 綠 |

### H 表級權限硬化（P1b 發現補列；P1b 成本退場與 P2a／P2d 不可變保證的根本前提）

問題：P1b 正式庫核對發現 `anon`／`authenticated`（以及 `service_role`）對所有 public 表仍有 Supabase 平台預設的 TRUNCATE／REFERENCES／TRIGGER／MAINTAIN；RLS 不管 TRUNCATE、列級 guard 也不會在 TRUNCATE 觸發，`cost_items` 退場與 `field_document_versions`／簽署／提送列不可變的保證因此有一條沒關的路。來源是 `pg_default_acl` 中 `postgres` 對 `public` 的 `grant all` 預設，逐表 revoke 只能救既有表、每支新 migration 都得記得補，這是技術債。目標：一次收回所有既有表，並修正 default privileges 讓新表不再自動帶；pgTAP 全表迴圈釘住。不做：不動 SELECT／INSERT／UPDATE／DELETE（基線與各表自己的收窄照舊）、不動 policy／trigger／資料列、不碰 `anon` 的表級 DML 與序列／函式 default（另列 H2／H3）。影響：一支 migration（ACL only）、rollback 檔、pgTAP、`seed.sql`（本機 service_role 改只給 DML）、DEVELOPMENT／deploy／SETUP／架構文件。驗收：pgTAP 全表迴圈三角色零殘留且測試內新建表仍無；`authenticated`／`anon`／`service_role` TRUNCATE `cost_items`／`field_document_versions` 皆 42501；既有 pgTAP 全綠；正式庫套用後唯讀核對。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| H1 收回 API 角色的 TRUNCATE／REFERENCES／TRIGGER／MAINTAIN＋修 default privileges | P1b、T0 | fable5.1 | Fable 5.1 | migration `20260917213900_api_roles_table_ddl_privileges`（`revoke … on all tables in schema public from public, anon, authenticated, service_role`＋`alter default privileges for role postgres in schema public revoke …`；rollback 檔同名 `.down.sql`）、pgTAP `api_roles_table_privileges.sql`（每表 × 三角色迴圈＋default ACL 斷言＋測試內新建表＋TRUNCATE 行為）、`supabase/seed.sql`（service_role 表級改 DML）、`DEVELOPMENT.md` §5、`deploy.md` §4、`supabase/SETUP.md`、`audit-events.md`、`field-documents-lifecycle.md` §1、`slimming-entrypoints-and-retirement.md` 過渡表、`ROADMAP.md` | 迴圈零殘留；新建表無四種權限但 DML default 照舊；TRUNCATE 42501；`test:db` 全綠；正式庫唯讀核對 |
| H2＋H3 `anon` 表級／序列權限與 `anon`／PUBLIC 函式 EXECUTE 收回、authenticated 明示允許清單、default privileges 改 fail-closed（**使用者 2026-09-17 於主 session 同意執行**，原文「好 依照你的建議做完」） | H1 | fable5.1 | Fable 5.1 | 先盤點（登入／註冊／MFA／密碼重設走 GoTrue；四條 public 路由靜態；無邀請碼；Edge user client 全帶 JWT，`send-reminders`／行銷站 `demo-request` 用 service role；Storage policy 全 `to authenticated`）⇒ anon 例外清單為空。migration `20260919003000_anon_and_function_execute_privileges`：`revoke all on all tables／sequences … from public, anon`＋per-schema default revoke；`revoke execute on all routines … from public, anon, authenticated` 後逐支 `grant execute … to authenticated`（允許清單 68 支＝前端／Edge user client RPC、policy 與欄位 default 引用、既有明示 grant；50 支 trigger 函式與 8 支內部 helper 收回）；全域 `alter default privileges for role postgres revoke execute on routines from public`（per-schema REVOKE 拿不掉內建 PUBLIC，實測）＋public per-schema revoke anon／authenticated＋`extensions` 補回 PUBLIC；service_role 既有 EXECUTE 明示對齊、default 維持平台預設（P2c 實測：欄位 default 用的函式會被 service client DML 撞到）。rollback 檔同名 `.down.sql`（依正式庫快照逐表／逐函式還原）。pgTAP `anon_and_function_privileges.sql`（全表／全序列／全函式 × anon 迴圈、PUBLIC 零殘留、允許清單精確相等、defacl 內容、測試內新建表／序列／函式、trigger 不需 EXECUTE、行為 42501）；runner 把 pgtap 裝到 `extensions` 並對每個 session 的 `pg_temp_N` 補回 PUBLIC default（helper 在 `set local role` 下可呼叫）；`seed.sql` 註解；DEVELOPMENT §5、deploy §4、SETUP、audit-events、ROADMAP、CURRENT §6.3／§6.5、BASELINE | 迴圈零殘留、允許清單相等、新建物件仍無、trigger 照觸發；既有 pgTAP 全綠；真後端 chain1／chain2／chain5 與 auth-smoke；正式庫套用後唯讀核對 anon ACL／defacl，內建 Preview 開登入頁確認可用 |

### D 部署與邊緣（H2／H3 核對時發現補列）

問題：H2／H3 用內建 Preview 核對登入前四頁時，唯一的 console 錯誤是 CSP 擋下 Cloudflare 邊緣塞進每頁 HTML 的行內載入器（`/cdn-cgi/challenge-platform/scripts/jsd/main.js`）；該腳本不在 repo，`check-prod.sh` 只 grep `cf-beacon`，D-025 被違反卻沒被檢出。目標：查清來源、用 repo 可控的方式讓邊緣不再改寫 HTML、`check:prod` 改成允許清單比對讓任何注入都會紅。不做：不放寬 CSP、不關安全標頭、不動 Cloudflare 帳號設定。影響：`public/_headers`、`scripts/check-prod.js`（取代 `.sh`）、D-025、deploy runbook。驗收：`check:prod` 對處置前的正式站正確報紅、處置後全綠；單元測試；不放寬 CSP。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| D1 正式站 Cloudflare 邊緣注入腳本與 `check:prod` 漏檢 | 無 | fable5.1 | Fable 5.1 | 來源：`gov-agent.ai` zone 的 Bot Fight Mode 自動開啟的 JavaScript Detections（Free 方案不能單獨關、不能依主機／路徑排除、不走 WAF 規則），對 zone 上所有經代理的 HTML 回應注入（app 含 `/login` 等 SPA 路由與 `/demo/`、demo 站；apex 行銷站 DNS-only 不受影響）。處置：`public/_headers` `/*` 的 `Cache-Control` 加 `no-transform`（Cloudflare 文件明載帶此 directive 不注入 JSD／beacon、不壓縮），`/assets/*`、新增 `/demo/assets/*`、`security.txt` 先 `! Cache-Control` 再設值（同名標頭是逗號合併），舊 `/index.html: no-cache` 從未生效（307 到 `/`）併入 `/*`；`scripts/check-prod.js`：每頁 200、`script-src` 恰好 `'self'`、`no-transform`、HTML 每個 `<script>` 都在 repo `index.html` 推導的允許清單（行內一律紅）、入口 chunk immutable／壓縮／無 `no-transform`，預設五頁，本機有 dist 先自檢推導；`check-prod.test.js`＋`tests/fixtures/edge-injected-jsd.html`；D-025 補記、deploy §2／§6／§7、DEVELOPMENT §5、CURRENT §6.3、BASELINE | 處置前 app／demo 五頁全紅（缺 `no-transform`＋行內腳本）；`wrangler dev` 本機核對 `_headers` 拆分；demo 以本分支重佈後三頁 OK、入口 chunk 仍 `br`；合併後 app 五頁 OK；不放寬 CSP |
| CI1 釘住 pgTAP workflow 的 Supabase CLI 版本（D1 回報的 CI 假紅） | T0 | fable5.1 | Fable 5.1 | 根因（PR #136 第一輪 pgTAP log）：`supabase/setup-cli@v1` 配 `version: latest` 會匿名打 `api.github.com/repos/supabase/cli/releases/latest` 解析版號，GitHub 對匿名請求以 runner 共用 IP 計 rate limit（「Failed to resolve latest Supabase CLI release: rate limit exceeded」）；setup-cli 原始碼只有 `latest` 走 API，明確版本直接抓 `releases/download/v<版本>/…`。處置：`pgtap.yml` 釘 `2.113.0`（＝本機 brew `supabase --version`，本機 `test:db` 與 CI 同版，`db start` 的映像 tag 也隨之固定）；`scripts/test-pgtap.js` 輸出第一行印 `Supabase CLI <版本>` 供對照；其餘依賴盤點無同類匿名解析（Deno 已釘 `v2.9.6`＋frozen lock、Node `.nvmrc` 走 toolcache／授權 manifest、Playwright 版本來自 lockfile＋瀏覽器快取、`npm ci` 走 lockfile、actions 用 major tag 無執行期解析）；deploy §3 記釘法與升級步驟、SETUP 指向。不做：不 SHA-pin actions（無 dependabot，維護成本高於收益）、不升 `actions/*` major（Node 20 棄用只是警告、已強制跑 Node 24，另案處理） | 本機 `npm run test:db` 綠且第一行印版本；PR 的 CI／pgTAP 兩個 run 都 success；`check:docs` 綠 |

### P2 照片接收與 AI 草稿基礎

問題：辨識結果不持久、無角色隔離、未匯標單不能收照片。目標：上傳即保存、可恢復、可重試、欄位來源；以施工日誌走通第一條起稿→簽署路徑。不做：不建通用表單平台；不做離線同步。影響：`photos`、新表家族、新 Edge、現場紀錄頁。驗收：切頁／重登入恢復；重試不重複建件；未配對照片保存；廠商照片不能進監造文件；施工日誌可簽署且事實表落庫。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P2a 文件家族 migration | P0 | fable5.1 | Fable 5.1 | migration `20260917201000_field_documents`：`photo_intakes`、`photos` 加欄＋`photos_org_stamp`（`uploader_org`／`uploaded_by` 伺服器決定）、`field_documents`／`_versions`／`_signatures`／`_submissions`、RLS、欄位級 grants、六支 guard、稽核 AFTER trigger、rollback `.down.sql`；`auditEvents.js` 標籤；pgTAP `field_documents.sql` 215 條 | pgTAP：RLS 三角色＋非成員＋跨案；版本不可變；雜湊由 DB 算；簽署／提送列不可直接寫；狀態結構要件；grants |
| P2b Edge 起稿 | P2a | fable5.1 | Fable 5.1 | `supabase/functions/draft-field-documents/`、`_shared/photoMatch.ts`（前端 `src/lib/photoMatch.js` 改為 re-export，單一實作）、`_shared/sitePhotoVision.ts`（classify-site-photo／read-whiteboard／起稿三處共用 schema＋prompt）、`_shared/fieldDocDraft.ts`（純規則）、`_shared/fieldDocDraftRun.ts`（流程，注入介面）、`_shared/fieldDocRepo.ts`（Supabase 存取）、`aiGate.askAiFeature`（函式內再問別的功能開關）、AI 註冊三處＋seed migration `20260917213500_ai_field_docs_draft`（rollback 檔）、pgTAP `ai_field_docs_draft.sql`、`check:edge` | 單元測試：候選推斷、`field_sources` 規則、冪等、部分失敗、角色隔離、未配對；閘門 fail-closed；只起施工日誌，其餘三類列 unsupported |
| P2c 現場紀錄頁（上傳／恢復／施工日誌草稿→審核→簽署→提送→收件／退回） | P2a、P2b、P2d、P5a | fable5.1 | Fable 5.1 | `src/store/slices/fieldDocs.js`（新：批次／照片／起稿／文件／五支 RPC；施工日誌唯一寫入路徑，`fieldDocuments={documents,submissions}` 與 P5a 球權同一份）、`src/lib/fieldDocs.js`（純函式：上傳狀態機、恢復判讀、欄位來源、內容形狀、`client_request_id`、錯誤碼分流）、`src/pages/web/Site.jsx`（拍照／上傳、上傳批次、現場文書清單、`?doc=`→`/site-log?doc=`）、`src/pages/web/SiteLog.jsx`（重寫：文件審核／簽署／提送／收件／退回；既有紀錄過渡）、`src/components/sitelog/{IntakeUploader,IntakeResult,IntakeList,DailyLogFields,DocumentPhotos,DocumentLifecycle,FieldSourceChip}.jsx`（新）、刪 `SitePhotosCard`／`SiteLogReadOnly`／`photoLogDraft`、`site.js` 移除 `saveSiteLog`／`deleteSiteLog`／`uploadSitePhoto`／`classifySitePhoto`／`readWhiteboard`、`agent.js` `acceptDraft` 改走文件、`Account.jsx` `?return=`、Edge `_shared/visionStub.ts`＋`draft-field-documents` 本機 stub、`supabase/config.toml` 本機 TOTP、`e2e-real/chain5-field-docs.spec.js`＋`helpers.js` TOTP、`e2e-real/stub.env` | Vitest：`fieldDocs.test.js` 21、`SiteLog.document.test.jsx` 5、`visionStub.test.ts` 8；Demo E2E contractor／supervisor 改為文件語意；真後端 E2E chain 5 三角色（本機 Edge stub 模型）；手機 375 上傳→審核→簽署→提送、桌機 1024 收件／退回 |
| P2d 施工日誌簽署／提送 RPC | P2a | fable5.1 | Fable 5.1 | migration `20260917205000_field_document_rpcs`：`save_field_document_version`（四類共用；必填鍵／待補由伺服器算並寫回）、`sign_field_document`（只有 daily_log 分支，其他類型 `PD007`；aal2、必填、附件角色、事實表落庫、`agent_actions`）、`submit/receive/return_field_document`（`client_request_id` 冪等）、`daily_logs_guard`／`daily_log_items_guard`（已簽署列只有簽署 RPC 可重寫）、`resolve_agent_action_internal`、`field_documents_target_uidx` 改只算活文件；錯誤代碼 `PD001–PD010`；rollback `.down.sql`；pgTAP `field_document_sign.sql` 140 條 | pgTAP：舊版簽署、雜湊不符、越權、跨案、aal1、待補欄、附件冒充、簽後改文另開版、事實列不可直接改寫、提送重試防重複、退回必填原因且歷次保留、收件方限定、diff 由 DB 算、三角色＋非成員矩陣 |

### P3 四類文書＋簽署提送

問題：只有施工日誌不算主賣點。目標：監造日誌、自主檢查表、監造查驗表單各自由照片起稿、補缺、簽署、提送、回執；跨文件共用補值。不做：不做電子憑證採購；不宣稱符合機關簽章規範。影響：新表 `supervisor_logs`、`checklist_templates.kind`、`inspections` 加欄、四頁面與列印。驗收：四類各走完整流程；監造日誌為每日；查驗表單簽署即判定；退回再送保留版本；列印與簽署版本一致。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P3a 監造日誌（後端；頁面待 P2c 共用審核／簽署元件合併後另接） | P2d | fable5.1 | Fable 5.1 | migration `20260917221000_supervisor_logs`（`supervisor_logs`＋RLS＋`supervisor_logs_guard`；示範範本 `fn_field_document_template('supervisor_log')`＝唯一定義，必填鍵／人填欄由它推導；到場只能人填：AI 版本不得帶入、人工 filled 回 `needs_confirmation`、簽署須 confirmed；事實表 guard 規則抽成 `fn_field_document_fact_guard` 供 daily_logs／daily_log_items／supervisor_logs 共用；`sign_field_document` 改共用前段＋依類型分派到內部函式；`fn_field_document_unmet_fields` 改三參數；`fn_project_ref_exists`；rollback 檔）＋pgTAP `supervisor_logs.sql`；Edge `fieldDocDraft.ts` 監造候選 ready＋`buildSupervisorLogDraft`、`fieldDocDraftRun.ts` 日誌類共用同一段寫入邏輯、`fieldDocRepo.ts` 當日查驗／缺失／施工日誌文件現況；球權待辦由 P5a `ballInCourtRules.ts` 涵蓋 | 到場欄只能人填（AI／service 帶入即拒）；廠商不可寫；每日唯一；廠商照片不能作監造證據；daily_log 分支回歸不變 |
| P3a 前端 監造日誌頁 | P3a 後端、P2c | fable5.1 | Fable 5.1 | `src/pages/web/SupervisorLog.jsx`（新：一天一份文件，`?d=`／`?doc=`；監造 `can.approve` 編／簽／送，機關收件／退回，廠商唯讀；空白草稿全 pending、同日施工日誌任何狀態記收件情形、只有已簽署／提送／收件才引用摘要；到場 `fillHumanField`＝已填待親自確認→「確認到場人員」才 confirmed，`na`＋原因清空；`PD004 needs_confirmation` 高亮；`PD001`／`PD002` 提示重新載入；`PD003` 引導 MFA）、`SupervisorLogPrint.jsx`＋`components/sitelog/SupervisorLogSheet.jsx`（新：印簽署列指向的版本、短碼／版本／雜湊 12 碼／簽署者、示範範本與免責聲明；未簽署整張標草稿）、`components/sitelog/SupervisorLogFields.jsx`（新：範本 sections 驅動、逐欄來源章、到場列帶入本人／本案監造成員、監造事項逐項來源與照片數、當日查驗勾選、通知／追蹤引用名稱）；共用元件擴充而非複製：`DocumentLifecycle`（依 `doc_type` 決定責任方／提送對象與文案、`labels`／`templateMeta`）、`DocumentPhotos`（`ownerOrg`，他方照片只能參考）、`FieldSourceChip`（`humanOnly`）、`RowsEditor.jsx`（從 `DailyLogFields` 抽出，加 `type`／`options`／`extra`）、`WeatherPull.jsx`（從 `SiteLog` 抽出）、`IntakeResult`／`Site.jsx` 改走 `docPageLink`；`lib/fieldDocs.js`（`templateRequiredKeys`／`templateHumanOnlyKeys`／`templateFieldLabels`、`requiredKeysFor` 依類型、`unmetFields` 人填欄 `needs_confirmation`、`docStatusMeta` 依類型、`docPagePath`、監造內容形狀與 `applyFormalDailyLog`、`setFieldNa` 文字欄清 null、`applySuggestion` 逐頂層鍵）；`_shared/fieldDocText.ts`（新：廠商施工情形／收件情形組字單一實作，Edge 起稿與前端同一支，前端 `lib/fieldDocText.js` re-export）；`store/slices/fieldDocs.js`（`getFieldDocumentTemplate` RPC＋示範 fixture、`findActiveFieldDoc`／`createFieldDocDraft` 通用、`getFieldDocumentVersion`、示範模式存版依類型算待補）；`src/data/demoFieldDocTemplates.js`（示範模式範本 fixture，Vitest 釘住與 Edge 鏡像一致）；`navConfig.js`（`/supervisor-log` 子頁、`/supervisor-log/print`）、`App.jsx`；`e2e/supervisor.spec.js`、`e2e/a11y.spec.js`、`e2e-real/chain6-supervisor-log.spec.js`（新） | Vitest：欄位狀態、到場確認閘門、來源標示、錯誤碼處理；Demo E2E 監造頁可達、示範模式不假裝可簽；真後端 chain 6 三角色；375／1024 無溢位 |
| P3b 自主檢查表 | P2d | fable5.1 | Fable 5.1 | migration `20260919141500_self_check_documents`（`fn_field_document_template('self_check')` 示範框架範本；必填／人填／須確認欄由框架＋本案 `checklist_templates` 項目推導，`fn_field_document_human_only_keys(doc_type, content)`／新 `fn_field_document_confirm_required_keys`／`fn_field_document_unmet_fields` 四參數；`sign_field_document` 加 `self_check` 分支 `field_document_sign_self_check_internal`（寫 `checklist_records`：首簽 Rev.0、再簽修訂 Rev.N 取版本 `change_note` 為更正原因）；**根本解**：判定引擎下沉 DB `fn_checklist_judge`（與前端 `judgeChecklist` 同案例釘住）＋`checklist_records_guard` 使用者路徑重算判定、不合格開缺失下沉 AFTER trigger `checklist_records_defect_sync`（前端 `syncDefect` 退場）、已綁簽署文件的紀錄不可刪；rollback `.down.sql`）；Edge：候選 `self_check` ready／blocked（`pickChecklistTemplate` 沿用）、`buildSelfCheckDraft`（每項 pending、實測值只放 hint）、**範本鏡像常數退場**改執行期 `fn_field_document_template`（`repo.getFieldDocumentTemplate`）、範本純規則抽成 `_shared/fieldDocTemplate.ts` 前端 re-export、示範 fixture 由 Vitest 解析 migration 原文釘住；前端 `/self-check`（`SelfCheck.jsx`／`SelfCheckFields.jsx`／`SelfCheckSheet.jsx`／`/self-check/print`，共用 `DocumentLifecycle`／`DocumentPhotos`／`FieldSourceChip`）、`docPagePath` 加一列、`/site` 入口與清單、`/quality?attach=` 預填檢附、檢附下拉與詳情標「已簽署文件 vN」、`ensureChecklistTemplate` 抽出；pgTAP `self_check_documents.sql`、`checklist_revisions.sql` 改 trigger 行為；chain 8 | num 永遠待補；bool 建議附 basis（本輪 Edge 不產生 bool 建議，模型無逐項依據）；簽署後修訂＝Rev.N；`ChecklistSection` 直接寫入路徑保留（判定與缺失改由 DB），改吃文件留待後續單元 |
| P3c 監造查驗表單（判定＋確認量） | P3b、P4b | fable5.1 | Fable 5.1 | migration `20260919222000_inspection_form_documents`（`checklist_templates.kind/stage_key/applies_to/version`；`inspections` 加 `batch_key/stage_key/unit/declared_qty/confirmed_qty/template_id/results/document_id/document_version_no`＋四值狀態 check（含部分合格）；`inspections_guard` 改 BEFORE INSERT OR UPDATE：正規化、簽署專屬欄與部分合格只由簽署路徑、已判定不可改申報、有確認量不可撤銷判定；**不合格／部分合格開缺失下沉 `inspections_defect_sync`**（前端 insert 退場，快速判定與表單同一份）；稽核 decided＝非待查驗；`fn_field_document_template('inspection_form')` 示範範本；規則通用化 `fn_field_document_item_keys`＋`fn_field_document_stage_required`（ITP H 點才要階段）；`field_documents_inspection_uidx`（一查驗一活文件）；**`inspection_confirmations` 唯一鍵改只算 active**（撤銷後才能重簽）；`create_inspection_form_draft` RPC（允許清單 +1）；`field_document_sign_inspection_form_internal`：驗查驗／工項／單位／位置／階段／申報／判定／確認量／項目後更新 `inspections` 並在同交易寫 `inspection_confirmations`（累計＝前次＋本次；同量冪等、改量 `PD008` 先撤銷）；rollback `supabase/rollbacks/…down.sql`）；pgTAP `inspection_form_documents.sql`；Edge `buildInspectionFormDraft`（申請資料帶入待核對、判定與確認量永遠留空；監造批次也讀範本、`findActiveDoc` 以 `target_key` 跨批次、`listRequiredStages`）；提送對象單一來源 `FIELD_DOC_TO_ORGS`（Vitest 對 migration 釘住；多對象各一鈕各自收件）；前端 `/inspection-form`＋`/inspection-form/print`（`usePrintedVersion`＋`DocumentPrintStamp`）、`InspectionFormFields`（確認數量區並列申報／單位／已確認累計／本次／簽署後累計＋一致性預覽 `inspectionFormIssues`）、`ChecklistItemsTable`（自檢表共用抽出）、`DocumentLifecycle` `signNote`／多對象提送、`/site` 入口與清單、`/quality` 詳情入口＋申請表申報量／階段、狀態列舉補部分合格（todayTasks／itp／evidence／報表）；chain 10 | 只有監造能簽；簽署即判定；確認量不超申報、單位一致、部分合格開缺失、同批重簽不累加、多階段 ITP、簽後改量只能撤銷、跨案、三角色＋非成員；簽後 backlog 出現可估驗量、未簽為 0 |
| P3d 提送／退回／回執 UI＋列印 | P2d | 純表單呈現／列印（fable5.1 執行；使用者 2026-09-19 授權簡單低風險改用 Opus 5） | Opus 5 | 四類詳情的提送區、退回歷史列、回執；列印頁印版本與雜湊。**已做（PR #145，純前端）**：`/site-log/print`（沿用已登記路由，`?doc=`／`?d=`）印簽署列指向的版本（`lib/fieldDocs.printSignature`＝版本號最大的簽署），頁首短碼／版本／DB 雜湊前 12 碼／簽署者／伺服器時間，未簽署標「草稿・未簽署」、舊流程既有列標「既有紀錄、無版本與雜湊」、簽署版本讀不到明說失敗不代印；工項名稱取版本快照、累計＝此日之前日誌列＋本張；三個列印頁共用 `lib/usePrintedVersion.js`＋`components/sitelog/DocumentPrint.jsx`（抽掉三份複製）；`DocumentLifecycle` 加「提送與回執」（對象、送出時間與送件人、版本與雜湊、完整 submission_id、收件狀態、下一責任方＝`fieldDocumentBalls`）與「退回歷史」（歷次原因、退回人＝既有 `list_project_members` 對照、時間、補正再送與 DB diff）；伺服器時間一律 `lib/dates.taipeiDateTime`（原 UTC 切字串差 8 小時，現場文書 11 處） | 歷次退回全列；列印雜湊＝DB |
| P3e 共用補值＋角色隔離 | P3a–c | fable5.1 | Opus 5（暫代 Fable 5.1，使用者 2026-09-20 授權） | migration `20260920004000_intake_shared_inputs`：共用鍵目錄 `fn_field_document_shared_keys`（`location:<日期>:<工項>`→施工日誌工項列位置＋自檢表位置、`qty:<日期>:<工項>`→施工日誌當日數量、`weather_am／pm:<日期>`→施工日誌／監造日誌天氣；鍵帶日期因一批可跨日；監造查驗表單位置是確認量批次鍵不共用；出工等清單欄不共用）；`fn_field_document_apply_shared_inputs`（人補一律 `confirmed`／`shared:<鍵>`；人在文件頁親自確認或標不適用的欄不覆蓋）；`set_intake_shared_input`（上傳方成員；對象＝本批建立∪本批候選指向、同專案同一方、活文件；`draft`／`pending_input` 且從未簽署才經 `save_field_document_version` 存人工版本，附件原樣；已簽署／提送／簽後更正 `locked`；同值冪等）；`list_intake_shared_inputs`（每份文件效果 update／applied／human_value／locked 由伺服器判定）；H3 允許清單 80→82；rollback `.down.sql`；pgTAP `intake_shared_inputs.sql` 95 條；前端 `IntakeSharedInputs`（`IntakeResult` 內，上傳當下與上傳批次恢復清單同一份）、store `listIntakeSharedInputs`／`setIntakeSharedInput`、`lib/fieldDocs` 呈現純函式；`IntakeList` 本批文件含候選指向的文件；**Edge 不讀共用補值**（確認只存在人工版本；補值後才起稿的新文件標「尚未套用」由人以同一支 RPC 套上）；簽署附件來源檢查沿用四類 `PD005`，並以補值後仍 `PD005` 釘住；**P4e 交接**（同一條簽署路徑、避免兩支 migration 互蓋）：同支 migration `create or replace` 監造查驗表單簽署分支 6 處數量訊息與 `inspections_defect_sync` 的「申報／確認／差額」改經 `fn_cq_txt`（pgTAP `inspection_form_documents.sql` 146→150 斷言訊息無 `.0000`）；chain 12 | 補一次多文件生效；已簽署不變；他方照片拒絕 |
| P3f 文件草稿捨棄（原列 P3e 的 `discard_field_document`，2026-09-20 P3e 拆出） | P2d | fable5.1 | Opus 5（暫代 Fable 5.1，使用者 2026-09-20 授權） | migration `20260920021000_field_document_discard`：`field_documents` 加 `discard_reason`／`discarded_by`／`discarded_at`／`discard_request_id`＋新 trigger `field_documents_discard_guard`（所有寫入者含 service：轉為 discarded 時原因必填、捨棄者與時間由伺服器蓋、其餘寫入四欄不可變）；`discard_field_document(document_id, reason, client_request_id)`——責任方**成員**（修正原設計「建立者」：AI 起稿的文件沒有人類建立者）、只限未簽署三狀態且沒有任何簽署／提送列（簽後更正的草稿 `PD008`）、原因必填（`PD010`）、冪等（同人同原因回原結果；同請求編號換原因或他人 `PD009`；他人或換原因 `PD008`）、版本與照片保留、指向本文件的待覆核 AI 草稿同交易標 `rejected`（`resolve_agent_action_internal` 加 rejected）、稽核 `field_document.discarded` metadata 帶原因；H3 允許清單 82→83；rollback `.down.sql`；捨棄後同一目標可重新起稿（三個部分唯一索引本來只算活文件，pgTAP 釘住）；P3e 共用補值／P2b 起稿／P5a 球權／`/site` 清單原本已把 discarded 當終態，只補測試；前端共用 `DiscardDraftButton`（確認對話框、原因必填）接 `DocumentLifecycle`（四類文書頁）與 `/site` 清單列，捨棄後回 `/site` 說明原因與重新起稿入口；`loadFieldDocumentsFromDB` 回 `signedDocumentIds`（曾簽署的草稿不給入口）；捨棄處理掉 AI 草稿時重載收件匣 | 未簽署可捨棄、已簽署拒絕、三角色＋非成員、捨棄後可重新起稿 |
| P3g 監造查驗範本建立介面＋兩個流程缺口（2026-09-20 補列：P3c 的 G5、P6b 的兩項留尾） | P3c、P3f、P6b | fable5.1 | Opus 5（暫代 Fable 5.1，使用者 2026-09-20 授權） | migration `20260920050000_checklist_template_authoring`：`fn_checklist_applies_to`（適用條件形狀：只接受 `{work_item_ids,keywords}`、去空白去重排序、全空回 null）、`fn_checklist_items_normalize`（項目形狀：項次必填不重複、檢查內容必填、`kind∈num|bool`、num 至少一個上下限且 min≤max、只留 baseline 九鍵）、`checklist_templates_guard`（BEFORE INSERT/UPDATE：正規化；`stage_key` 只給 `inspection_form`；適用工項限本案；`kind=inspection_form` 的寫入比照 `create_inspection_form_draft` 要監造或 `admin_override`（`CT006`，不新增角色）；`version` 由伺服器編號（同案同用途同標題 +1）；已被 `checklist_records`／`inspections` 引用的範本標題／依據／項目／用途不可改（`CT008`））、`checklist_templates_del_guard`（被引用不可刪——`checklist_records.template_id` 是 `on delete cascade`，刪範本等於刪掉已簽署的檢查紀錄；沿用 `evidence_delete_bypass`）；rollback `.down.sql`；允許清單不變（三支新函式都不授權 authenticated）。Edge：`pickChecklistTemplate` 改為「階段硬篩 → 指名工項（硬條件）→ 關鍵字命中 → 標題相似度」的階梯，作者明示信號分不出來就回 null（不亂猜）；`fieldDocRepo.listChecklistTemplates` 多取 `stage_key, applies_to`；`draftInspection` 同步帶 `workItemId`。前端：`lib/checklistTemplates.js`（表單純函式，鏡像 DB 規則）＋`components/quality/ChecklistTemplatesCard.jsx`（品質頁「檢查表」分段：用途、適用工項／關鍵字、查驗階段（選自 `projectStageKeys` 的 H 點）、檢查項目、已引用時改推「另存為新版本」）＋`store/slices/quality.saveChecklistTemplate`；`InspectionsSection` 對「已判定但沒有簽署文件」的舊快速判定查驗補「以查驗表單更正判定（補確認數量）」入口（沿用 `create_inspection_form_draft`）；`Agent` 收件匣拒絕 AI 起稿草稿時以 P3f `discard_field_document` 一併捨棄該文件（原因「AI 草稿遭拒絕」、確認框、已簽署／已提送則保留並說明；決策純函式 `planDraftRejection`） | 範本 kind／stage／applies_to 的權限與結構約束、三角色＋非成員；候選推斷用到 applies_to；舊快速判定可建更正表單；拒絕草稿的連動 |

### P4 查驗通過量與估驗聯動

問題：估驗數量無確認來源，`fillValuationFromSiteLogs` 可繞過。目標：確認量表、期別分配、上限、自動同步、撤銷調整、併發與封堵，全部後端強制。不做：不改保留款／金流順序公式；不自動偽造舊資料確認。影響：估驗頁、`billing.js`、三張新表、guards、RPC。驗收：需求 §8「監造確認量與計價」全部情境有 pgTAP；真後端 E2E 走 P3 真實簽署→同步→核定→請款；舊路徑與直接 REST 被擋。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P4a 純計算＋pgTAP | P0 | fable5.1 | Fable 5.1 | migration `20260917120000`（只型別與純函式，不讀表）：`cq_confirmation`／`cq_allocation` 型別、`fn_effective_by_batch`、`fn_effective_confirmed`、`fn_contract_qty`、`fn_cap`、`fn_allocate_fifo`、`fn_batch_allocation_check`、`fn_period_increment`、`fn_valuation_amount`、`fn_pricing_basis_effective`、`fn_cq_*` 正規化／驗證共 14 支；`v_billable_backlog` 順延 P4b（需要 P4b 的表）；pgTAP `confirmed_quantity_calc.sql` 83 條含設計 §3.1 全部案例 | 案例全綠；不依賴 P3 |
| P4b 表、guard、RPC、鎖 | P4a（P3c 未完成：簽署路徑寫確認量留 P3c 接，介面見設計 §16.6） | fable5.1 | Fable 5.1 | migration `20260919140000_confirmed_quantity_enforcement`：四張新表（`inspection_confirmations`、`valuation_item_sources`、`valuation_adjustments`、`work_item_pricing_basis`）＋加欄（`valuations.recheck_required／recheck_note`、`valuation_items.backing`、`inspection_points.stage_key／required_for_billing`）；列級 guard（確認紀錄 append-only 只能撤銷、來源分配每列驗不變量 2 含截止日、調整 append-only 加狀態、明細金額／百分比由 DB 算＋超契約量拒絕＋非草稿期凍結含 service role、工項有效確認不可刪／改單位、ITP 必要階段不可變）；`valuations_guard` 改 BEFORE INSERT＋狀態機＋欄位規則，檢查點另立 AFTER trigger `valuations_checkpoint_guard`（送審／核定／請款日三個檢查點，所有寫入者無 bypass）；十支 RPC（`sync_valuation_from_confirmations`、`set_valuation_item_cum`、`transition_valuation`、`revoke_inspection_confirmation`、`issue_supervisor_certificate`（含補證 `p_covers_valuation_id`）、`void_valuation_adjustment`、`admin_adjust_valuation_item`、`set_work_item_pricing_basis`、`get_valuation_state`、`list_billable_backlog`）；逐工項 advisory lock＋`for update`＋唯一鍵＋`p_from` 冪等＋`client_request_id` 冪等；確認變動 AFTER trigger 收斂＋自動同步草稿期；legacy 回填函式；rollback 檔；pgTAP `confirmed_quantity_enforcement.sql`（§8 全部情境、狀態機、撤銷／調整／作廢、舊資料過渡、總價隔離、三角色＋非成員＋admin_override 正式／非正式、直接寫表／service role／superuser）＋`confirmed_quantity_concurrency.sql`（dblink 真併發）；既有 7 檔 pgTAP fixture 改用合法路徑；runner 交 docker 網路位址給 dblink；真後端 chain 7＋chain 2 補截止日；設計文件 §16 記偏差 | 不變量 1–5；三角色＋非成員＋admin_override 正式／非正式矩陣；重播不重複；兩 session 真併發 |
| P4c 估驗頁 | P4b | fable5.1 | Fable 5.1 | `Valuation.jsx`＋`components/valuation/`（`ValuationRow` 擴充、新 `SourceRow`／`BacklogCard`／`ChecksCard`）：可估驗清單（`list_billable_backlog`，未開期先累積）、期別狀態（`get_valuation_state`）、建期必填計價截止日（`appPrompt` 新增 `inputType='date'`）、同步／設定累計量／狀態轉移全走 RPC（`VQ006` 顯示前期／上限／可用量並把輸入框回到 DB 值；`VQ004.detail` 逐項翻人話）、每工項來源展開（批次／位置／確認量／查驗與文件版本／確認人與時間；legacy 標「歷史遷移，非監造確認，需補證」）、依據標示（缺監造確認來源・申報,不計價／監造確認／管理員調整／計價依據待設定，監造可在列上設定依據）、核定前期別的可請款金額排除有缺件工項；`lib/valuationChecks.js` 合為單一口徑（DB 違反代碼對照表＋勾稽發現＋逐工項標示，`valuationDiff.js` 刪除，`integrityAudit.classifyLogDiff` 一把尺、Edge TS 鏡像同步加 `keys`）；`billing.js` 全改 RPC 並移除 `fillValuationFromSiteLogs`／`valuationItemRow`；`boqCalc.buildCumMap` 改吃 DB `amount_cum`（十個呼叫端改傳期別物件；demo 種子用 `valuationItemAmount` 鏡像）；`db.js`＋新 `lib/valuationPeriods.js` 期別投影往前帶；`navConfig` 估驗說明；設計文件 §17 | 前端不算金額與上限；帶入鈕消失且無客戶端寫 `valuation_items` 路徑；缺件在送審前可見並給處理入口；真後端 chain 2／7 改走新 UI＋chain 9 未確認量不可請款／送審被擋列原因 |
| P4d 撤銷／減量／調整 | P4b | fable5.1 | Fable 5.1 | 撤銷 UI（監造）、調整流程（機關 void）、核定／請款前檢查訊息 | 未核定阻擋、已核定走調整並留痕 |
| P4e 封堵 migration | P4c 上線且觀察一期 | fable5.1 | Opus 5（使用者 2026-09-20 授權暫代 Fable 5.1） | migration `20260920001500_valuation_items_seal`：`valuation_items` 收回 PUBLIC／anon／authenticated 寫入 grant＋刪寫入 policy＋guard 對非重算路徑一律 `VQ010`（service role、DBA 一體適用；cascade 照舊）；估驗鏈訊息數字改經 `fn_cq_txt`；Edge 掃描測試 `_shared/valuationWrites.scan.test.ts`；舊客戶端相容（42501，不白畫面） | 直接 REST 明確失敗；Edge 無估驗寫入 |

### P5 契約時程與提醒

問題：首頁／Agent／早報類型不一致；循環無逐期；期限無版本；掃描契約未揭露。目標：核心類型一致、逐期追蹤、基準日版本、契約覆蓋揭露、關鍵工項日期承接。不做：不重寫新引擎；不買 OCR。影響：`ballInCourt` 兩側、`send-reminders`、新表兩張、履約時程頁。驗收：同一測試資料三處一致；責任不明標待補；本期完成不清下期；基準日變更不破壞歷史；缺頁／無文字有真實狀態；排程承接後才 hidden。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P5a 球權共用 fixture | P0 | fable5.1 | Fable 5.1 | 比設計更進一步：**單一實作** `_shared/ballInCourtRules.ts`（零 import 純 TS；前端 `ballInCourt.js` 與 Edge `ballInCourt.ts` 都 import）＋共用案例 `tests/fixtures/ball-in-court.cases.json`（Vitest 前端路徑 `ballInCourt.cases.test.js`、Vitest Edge 路徑 `ballInCourt.cases.test.ts`、Deno 執行期 `ballInCourtRules.deno.test.ts`＝新 `npm run test:edge`，進 CI）；Edge 補查驗／變更／觀察／現場文書（含目前版本提送列）；責任不明（義務 `responsible`、觀察 `assigned_to`）與基準日缺失兩側都不歸方、改列「待補設定」（首頁一張卡、Agent `setup_pending`、早報一段，三方可見，導擷取審核／期限追蹤）；migration `20260917220737_obligation_party_unassigned`（`obligation_party()` 三方以外回 null，既有 policy 即對三方不放行；rollback 檔）＋pgTAP `obligation_party_unassigned.sql` 16 條、既有 3 條斷言改新語意；前端 `obligationParty` 回「待補設定」；store 於真專案載入未終態現場文書（`loadFieldDocumentsFromDB`） | Vitest 前端／Edge 路徑與 Deno 對同一組案例全綠；pgTAP 綠 |
| P5b 循環期次 | P5a | fable5.1 | Fable 5.1 | migration `20260917233000_obligation_periods`：表（每義務每期一列：期別鍵、期間起訖、到期日、狀態、完成時間／人、送審／現場文書證據、`review_note`、`basis`、`anchor_version_no` 預留）＋純函式期次排程（月末夾住、閏年、跨年、季／年／週／日、永遠含下一期）＋冪等 materialize（義務插入／規則變更／廢止 trigger、基準日變更 trigger、pg_cron 每日、成員 RPC）＋`transition_obligation_period` RPC（歸屬同義務、證據同案、伺服器蓋時間、退回解除證據）＋循環義務不可標義務層完成的 guard＋回填（有 `completed_at` 對應期別，推不出標 `review_note`；正式 7 筆皆待辦、5 筆缺每月幾日→待補設定）；rollback 檔；pgTAP `obligation_periods.sql` 99 條；共用規則 `obligationEntries`／`isObligationStreamOpen`／`recurrenceRuleGap`／`recurrenceAnchorKey`，待補設定新增 `rule`／`review` 兩種；`contractDue.js`／`.ts` 循環改讀期次；`todayTasks`／Edge 收集器／`get_requirements`／Deno 共用案例逐期（fixture 新增 ob12–ob16）；期限追蹤頁逐期標記（`?period=`）、履約時程詳情唯讀列期次；demo 種子三筆 monthly 帶三期 | 本期完成不清下期；舊期保留（pgTAP＋共用案例三側） |
| P5c 基準日版本 | P5b | fable5.1 | Fable 5.1 | migration `20260919021500_project_anchor_versions`（`project_anchor_versions` append-only＋guard；projects 基準日 INSERT／UPDATE trigger 留版＋同交易重算只動沒動過的待辦期、動過的記 kept、單次義務記改期／kept；RPC `update_project_anchors` 附類別／理由／依據／生效日；`contract_obligations` 加 `due_date_snapshot`／`anchor_version_no` 由 trigger 蓋；循環停止條件＝實際竣工日（驗收 confirm／report）優先、否則契約竣工日，保固類不產生，`acceptance_events` trigger 套用界限；回填 v1／期次版號／界限日；rollback 檔）＋pgTAP `project_anchor_versions.sql` 124 條、允許清單加 RPC、P5b／one-way 測試專案補竣工日；共用規則 `recurrenceStopGap`／`completionDateOf`／`periodBasisLabel`／`singleDueSnapshot`、待補設定 `stop`、`contractDue.js`／`.ts` 讀快照、Edge 收集器讀 `acceptance_events`、Agent 帶快照與版號；fixture 加 ob17／ob18／期次版號／`single_due`／`period_basis` 三側同綠；期限追蹤／履約時程「依據」列與逐期依據句、基準日卡類別／依據／生效日＋`AnchorVersions`、store `changeProjectAnchors`／`updateProjectSettings`、demo 種子兩版 | 歷史不變（pgTAP：已提送期保留原到期日與版號、已完成單次快照不隨竣工日再變）；差異可見（`effects` 逐版列出）；停止條件（pgTAP：登錄竣工移除之後的待辦期、清除補回、竣工日缺不產生、已過停在竣工日、展延恢復） |
| P5d 履約時程 UI | P5a–c | fable5.1；純呈現（fable5.1 執行） | Fable 5.1 | 純前端、無 migration：`src/lib/keyWorkItems.js`（新：關鍵工項落後判定自 `Schedule.jsx` 抽出、完成% 取最新估驗累計 ÷ 契約數量；停留點狀態沿用 `lib/itp.js`；兩者各變成時程事項 `wi:<key>`／`itp:<id>`）、`src/lib/obligationLinks.js`（新：待補設定處理入口與期別深連結，`todayTasks.js` 改 import）、`obligationTimeline.js`（`setupGapsOf` 走共用規則 `obligationEntries`、`SETUP_KINDS`、`isRecent`／`byUrgency`、`periodStat`、`partyStat` 對循環義務以期計）、`components/ObligationPeriods.jsx`（新：期次列與缺口說明，期限追蹤與履約時程共用）、`Requirements.jsx`（關鍵工項／停留點併入同一條時間軸、近期／全期 Segmented、待補設定下拉、逐期就地標記完成／退回＋掛佐證、關鍵工項詳情維護計畫起迄／移除、摘要卡加入關鍵工項、`?item=` 直達、佐證直達 `/submittals?submittal=`）、`Deadlines.jsx`（期次區改用共用元件）、`Schedule.jsx`（唯讀歷史查閱＋每列「到履約時程」）、`navConfig.js`（`/schedule` hidden、roles 不變、`/requirements` 指引文案）、`WorkItemPicker` 加 `placeholder`／`inputProps`；Vitest `keyWorkItems.test.js` 6、`obligationTimeline.test.js` ＋9、`Requirements.keyItems.test.jsx` 7、`Schedule.readonly.test.jsx` 3、`navConfig.test.js` 改 hidden 集合；e2e contractor 新增一條、routes 補 `/schedule` 直達與 tablist 斷言縮到子頁導覽 | 承接後才 hidden（e2e 綠）：三角色同一時程看得到關鍵工項／停留點／契約期限；待補設定五種可篩且有導向；逐期準時率以期計；`/schedule` 唯讀可達 |
| P5e 保固類停止條件 | P5c、P5d；使用者 2026-09-20 決定 | fable5.1 | Opus 5（使用者 2026-09-20 授權暫代 Fable 5.1） | migration `20260920040000_warranty_stop_condition`：`projects` 加契約保固期間三欄（數值／單位 year・month・day／引用的契約重點）＋guard（有期間就必須引用本案 approved 且登錄者看得到的條文；直接 REST 同樣受限）、版本表加 `warranty` 快照（沿用 P5c 留版，`changed_keys` 記 `warranty_term`）、保固期滿日唯一日期規則 `fn_warranty_expiry`（民法 §120 II／§121；月底無相當日取月末；純 date 運算）、正式驗收合格日＝`final` 最後一筆且合格、`fn_project_warranty`／RPC `get_project_warranty`（成員或 service）、P5c 物化／界限／重算／留版／RPC 與驗收 trigger 改版（保固類窗口＝合格日起、期滿日止，不看觸發點）、requirements 狀態 trigger（引用條文被取代即停止計算）、義務類別保固／非保固變動視同規則變更；rollback 檔；共用規則 `warrantyGap`／`warrantyNeeds`／`warrantyTermLabel`、`setup.need`、保固類不列基準日待補、`periodBasisLabel` 寫出合格日與期滿日；前端 store 載入保固事實（驗收登錄／撤銷後重載）、`components/WarrantyBasis.jsx`（期程卡常駐依據＋`WarrantyTermEditor`）、待補設定導 `/requirements?obligation=`、期程段保固期以合格日起、編輯列以 `can.admin` 鏡像 RPC；Edge 收集器讀 RPC（Agent 唯讀 RPC 白名單＋1）；pgTAP `warranty_stop_condition.sql` 105 條、P5c 保固斷言改新語意、允許清單＋`get_project_warranty`；共用 fixture `warranty.expiry_cases`／`scenarios`（三側同案例，Vitest 核對 pgTAP 覆蓋同一組日期案例）；真後端 chain 15（新）；chain 3 擷取審核選擇器限定主內容區 | 兩項齊全才計算、缺一列待補並說缺哪項（pgTAP＋三側共用案例）；只產生到期滿日；更正只重算未完成、歷史不變；時區與月底（pgTAP）；真後端：管理者登錄→機關登錄正式驗收合格→期次只到期滿日、監造看到同一份依據 |

### P6 其他文書整合與退場清理

問題：月報仍手抄；退場模組殘留讀寫端。目標：月報／佐證包重用已簽署資料；移除無使用端程式；`audit.summary` 退場。不做：不預建無實案表單；不 drop 表。影響：月報兩頁、store、Demo 種子、測試。驗收：月報數字來自已簽署文件；無殘留入口；Demo E2E 綠；用量歷史保留。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P6a 月報／佐證包重用 | P3、P4c | fable5.1 | Opus 5（使用者 2026-09-20 授權暫代 Fable 5.1） | 純前端、無 migration：已簽署版本索引 `lib/fieldDocs.signedVersionIndex`（事實列＝指向它的文件最晚一次簽署的版本，含已取代的舊文件；`pinAt` 釘住某時點以前的簽署；版本標示與「該版本即列印版本且文件在活文件清單」才給的列印連結；`confirmationDocRef`）；store 唯讀載入 `listSignedVersions`／`listSupervisorLogs`／`getFieldDocumentVersions`／`fetchValuationSubmittedAt`（`valuation.submitted` 稽核時點），確認紀錄帶 `content_hash`，移除只剩佐證包用的 `listPhotosByWorkItems`；`lib/reportSources.js`（兩張月報與佐證包共用：已簽署／未簽署分流、`unsignedDays`、日誌彙整、查驗判定歸月、確認量歸月）；`MonthlyReport.jsx` 工項數量／天數／雨天／出工只算已簽署施工日誌、逐日附版本、未簽署明列不列入、查驗判定只列經簽署表單者；`SupervisorReport.jsx` 頁名取 navConfig「監造月報」、已簽署監造日誌、簽署表單判定與申報／確認量、本月確認與撤銷；`ValuationPackage.jsx`＋`lib/valuationPackage.js` 本期來源＝確認量來源 → 查驗表單版本（雜湊、證據照片、檢附自檢），施工日誌取本期範圍內送審時點以前已簽署版本；`contentToLogShape` 對 na 數量同簽署分支規則 | D-024 口徑不變（`Reports.caliber.test.jsx` 綠）；彙整只取已簽署版本、佐證包來源取確認量（Vitest）；真後端 chain 13 |
| P6b 移除退場程式 | P1b、P5d | 確定無行為影響的整理（fable5.1 執行） | Opus 5（使用者 2026-09-20 授權暫代 Fable 5.1） | **2026-09-20 拆三個 PR 循序**：P6b-1 移除退場頁 `/schedule`、`/audit`（`access: 'retired'` 依原 roles 導向）與三支退場 Edge 原始碼（#154）；P6b-2 Agent `draft_daily_log`／`draft_inspection` 改產生現場文書草稿（`target_table='field_documents'`＋`target_id`）；P6b-3 品質查驗快速判定與 `ChecklistSection` 直接寫入退場、以收緊型 migration 收回直接寫入（先前端後 DB）。原範圍：刪 `Cost.jsx` 寫入、`Schedule.jsx`、`RiskAudit.jsx`、`portfolioExceptions.js`、store／db 寫入、Demo 種子、對應測試；**P6c 補列**：三支已無呼叫端的退場 Edge 函式原始碼 `assistant-chat`／`parse-contract`／`audit-summary` 一併移除（`errorLeak.scan.test.ts` 清單、`check:edge` 支數、註冊表 `edgeFunction` 目錄存在性測試改為「退場鍵可無目錄」同步），線上函式以 `supabase functions delete` 刪除由使用者執行（遠端資源） | lint／test／E2E 綠；表保留 |
| P6c `audit.summary` 退場 | P1b | fable5.1 | Fable 5.1 | migration `20260919130400_audit_summary_retire`（只翻 `enabled=false`；列／用量歷史／覆寫不動；rollback 檔同名 `.down.sql`）；`ai_features_retired.sql` 擴為三支退場功能（關閉、pro 專案閘門拒絕、覆寫翻不過、`audit.summary` 用量含 blocked 仍由 `admin_ai_usage_by_feature` 以原 label 查到）；兩份註冊表 `defaultEnabled=false`＋`aiFeatures.test.js` 釘三支退場鍵；移除 `site.js auditSummary`（含 demo 模板）、store 匯出、`RiskAudit.jsx` AI 按鈕／區塊／狀態／錯誤橫幅；`owner.spec.js` 改斷言無 AI 稽核意見；Edge `audit-summary` 原始碼依設計保留（閘門 403、不需重佈），三支退場函式原始碼與線上函式刪除改列 P6b | 用量歷史保留（pgTAP）；閘門回 403（pgTAP `ai_feature_allowed=false`）；Demo E2E owner／a11y 綠 |

### P7 整體驗收與發布

問題：測試通過不等於可用。目標：三方真後端完整旅程、真照片／契約模型驗證、手機／桌機、過渡與回復證據、文件、D-023 發布。不做：不拿 Demo 當真後端驗收；不宣稱未量測成效。影響：CURRENT／BASELINE／runbook。驗收：`e2e:real` 三方旅程；模型樣本比對；回復演練；`check:prod`；剩餘限制明列。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P7a 真後端旅程 | P1–P6 | fable5.1 | — | `e2e/real/*` 四類文書＋估驗聯動 | 三角色走完 |
| P7b 模型品質樣本 | P2b、P5 | fable5.1 | — | 照片樣本（清晰／模糊／非現場／混合）與契約樣本，有預期答案 | 準確率報告，不以 HTTP 200 代替 |
| P7c 過渡與回復演練＋文件 | P4e | fable5.1 | — | rollback 實跑（staging）、`CURRENT` §6.3、`BASELINE`、runbook | 部署版本與驗證寫回 |
| O1 demo 站重佈＋合併結果同步＋使用者驗收清單（2026-09-19 補列；使用者：「驗收我來驗就好」） | P3c | Opus 5（簡單低風險） | Opus 5 | demo 站以 main 重佈；`CURRENT` §6.3、`BASELINE`、本檔 §7 補 P3c 合併結果；本檔 §8 使用者逐項驗收清單（不另開報告檔） | `check:docs`；`check:prod` 五頁 OK |
| O2 低風險缺口清理＋Demo 示範資料（2026-09-20 補列） | P6a、P6b-2、P3f、P5e | Opus 5（簡單低風險） | Opus 5 | 皆為呈現層：(a) `demoSeed` 補示範用的已簽署文件版本（四類各一份以上，含簽署者／時間／版本／雜湊，全標 is_demo）＋示範監造日誌事實列、監造確認量與期別狀態，讓月報／佐證包在 demo 演得出內容；(b) 佐證包 AI 施工說明失敗改顯示錯誤與重試入口；(c) 收件匣 `draft_field_document`／`suggest_field_update` 補中文標籤（單一 `KIND_LABEL`）；(d) 批次候選的已捨棄草稿改標「已捨棄,可重新起稿」；(e) 期限追蹤頁基準日／契約價金總額改鏡像伺服器（專案管理者）。不動 DB、RPC、RLS、簽署規則 | Vitest 釘住五項；`npm test`／lint／build／`check:docs`；Demo E2E 全套；`check:prod`；demo 站重佈 |

### R 使用者改決（2026-09-19 起補列）

問題：使用者 2026-09-19 在主 session 指示「把簽署需要兩步驟驗證這個功能拔掉；把整個兩步驟驗證這個功能都拔掉」，推翻 §6 Q1 的 2026-09-17 答覆；正式庫 `auth.mfa_factors` 0 列、`field_document_signatures` 0 列，沒有人會被卡住、沒有既有簽署要改語意。目標：整條移除（登入驗證碼步驟、`/account` 啟用頁與頁首入口、store 狀態、簽署 RPC 的 aal2 政策、施工日誌與監造日誌頁的 MFA 引導、e2e TOTP helper、本機 TOTP 設定），不是旗標隱藏、不是把檢查改成永遠通過；簽署身分保證改為「已登入的平台帳號＋伺服器記錄簽署者／組織／姓名快照／伺服器時間／簽署意願／所簽版本與內容雜湊／IP／UA」。不做：不刪 `aal` 證據欄（仍如實記 JWT aal，只是不再是政策）、不動其他 RPC／guard／RLS、不代使用者改正式 Supabase Auth 設定。影響：一支 migration＋rollback、pgTAP 三檔、前端（含 P3a 監造日誌頁）、e2e-real chain 5／6、`config.toml`、D-026／設計／資安對照／CURRENT／BASELINE／ROADMAP／deploy／SETUP／REAL_BACKEND_E2E。驗收：pgTAP 全綠且簽署成功列 `method=platform_account`、`aal=aal1`，`platform_account_mfa` 被 check 拒絕；Demo 與真後端 E2E 不需驗證碼即可登入與簽署；全庫無殘留 MFA／TOTP／aal2 程式路徑。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| R1 全面移除兩步驟驗證（MFA／TOTP） | P2c、P3a（後端＋前端）、H3 | fable5.1 | Fable 5.1 | migration `20260919023220_remove_signing_mfa`（`method` check 改二值＋既有 `platform_account_mfa` 列改標規則、`field_document_signatures_guard` 去 mfa 分支、`sign_field_document` 去 aal2 並寫 `platform_account`；簽名不變、H3 允許清單不變；rollback 檔同名 `.down.sql`）；pgTAP `field_documents`／`field_document_sign`／`supervisor_logs` 改為一般登入（aal1）簽署成功、`platform_account_mfa` 23514；刪 `Account.jsx`／`auth.mfa.test.js`、`/account` 路由與頁首「帳號」連結、Login 驗證碼畫面、auth slice 的 MFA 閘門與五個因子動作、`DocumentLifecycle`／`SiteLog`／`SupervisorLog`／`SupervisorLogSheet` 的 MFA 引導與顯示、`fieldDocErrorGuidance` PD003 分支、意願文字；e2e-real 刪 TOTP helper、`loginReal` 改等落地 URL＋h1（任何視窗寬）、chain 5／6 改一般登入；`config.toml` TOTP 關閉；D-026、§6 Q1、設計文件、資安對照、CURRENT／BASELINE／ROADMAP／deploy／SETUP／REAL_BACKEND_E2E | `test:db` 全綠；Vitest／lint／build／`check:docs`；Demo E2E；真後端 chain 1、5、6 不需驗證碼；`grep` 無殘留 |

## 5. 建議執行順序（單套本機 Supabase，DB 單元循序）

1. P1a → P1b → P1c → P1d（無 DB；可與 P4a 平行）。
2. P4a（純函式 migration＋pgTAP，不依賴 P3）→ T0（本機 pgTAP 隔離；之後每個 DB 單元以 `npm run test:db` 的一次性資料庫結果判紅綠）。
3. P2a → P2b → P2c → P2d（第一條完整路徑）。
4. P3a → P3b → P3c → P3d → P3e → P3f → P3g（P3g 補 P3c 的範本建立介面與 P6b 留下的兩個流程缺口，依賴 P3f 的捨棄 RPC）。
5. P4b → P4c → P4d；觀察一個真案期別 → P4e。
6. P5a → P5b → P5c → P5d（P5a 可在 P2 之後任何時候穿插，無 DB 衝突時）。
7. P6a → P6b → P6c。
8. P7a → P7b → P7c。

DB 單元（P2a、P2d、P3a、P3c、P3e、P3f、P3g、P4a、P4b、P4e、P5a–c、P6c）之間不平行；前端／Edge 單元可在介面定案後穿插。每個單元一個 PR、`codex/` 分支前綴、CI 綠後合併。

## 6. 待使用者決定（2026-09-17 使用者已於主 session 逐題答覆；記入 D-026 第 7 點）

| # | 問題 | 選項與影響 | 使用者答覆／執行做法 |
|---|---|---|---|
| Q1 | 實案簽署方式 | (a) 平台帳號簽署（可要求 TOTP，`method=platform_account_mfa`）：最快，效力依機關認定；(b) 紙本列印簽回綁版本雜湊：符合多數機關現況，多一次掃描；(c) 外部憑證／工商憑證：需採購與整合，本輪不做 | 2026-09-17 使用者決定「簽署先用平台帳號加 MFA」（採 (a)，RPC 要求 `aal2`，`method=platform_account_mfa`）。**2026-09-19 使用者改決：把簽署需要兩步驟驗證與整個兩步驟驗證功能都拔掉**（R1）——簽署以已登入的平台帳號為身分（`method=platform_account`），伺服器記錄簽署者／組織／姓名快照／時間／意願／版本／雜湊；登入無驗證碼步驟；(b)(c) 仍未排除、本輪不做，`method` enum 改為二值（`platform_account`／`paper_scan`） |
| Q2 | 金額精度 | 逐工項四捨五入到元後加總 vs 加總後取整；影響本期金額尾差 | 使用者 2026-09-17 同意照暫行做法：逐工項到元；集中在 `fn_valuation_amount` 一處可改 |
| Q3 | 總價／間接費計價依據 | 利潤及管理費、營業稅、保險、假設工程各用 `supervisor_certificate`／`pro_rata`／`excluded`；影響這些工項能否進估驗 | **使用者 2026-09-17 決定：總價／間接費暫時隔離**——不計價，缺 basis 一律 `cap=0` 並在估驗頁標示（P4a `fn_pricing_basis_effective`＋`fn_cap` 已實作）；這是暫時措施，各工項的計價依據仍待決；`work_item_pricing_basis` 表 P4b 先建 |
| Q4 | 監造日誌廠商可讀否 | 可讀：透明；不可讀：需 RLS 分角色 | 使用者 2026-09-17 同意照暫行做法：專案成員可讀 |
| Q5 | 監造查驗表單的廠商異議 | 加正式狀態 vs 以 RFI 提出 | 使用者 2026-09-17 同意照暫行做法：以 RFI 提出 |
| Q6 | 多階段必要查驗來源 | ITP H 點 vs 實案品質計畫另列 | 使用者 2026-09-17 同意照暫行做法：H 點 |
| Q7 | 期別截止日語意 | 計價截止日 vs 提送日 | 使用者 2026-09-17 同意照暫行做法：計價截止日，送審必填 |
| Q8 | 付費 OCR | 供應商、每頁成本、資料出境；不採用則掃描契約只揭露＋人工補登 | **使用者 2026-09-17 決定：OCR 先不採用**——本輪不採用付費 OCR，掃描／無文字契約只做真實狀態揭露＋人工補登路徑 |
| Q9 | 抽取評測樣本 | 真契約或授權去識別；標註人 | 使用者 2026-09-17 同意照暫行做法：先建比對腳本與樣本格式；樣本來源仍待提供 |
| Q10 | 成本頁唯讀化時點 | P1b 立即 vs P6b 一併 | 使用者 2026-09-17 同意照暫行做法：P1b 即唯讀 |
| Q11 | 實案範本來源 | 監造日誌與監造查驗表單欄位需實案範本 | **使用者 2026-09-17 決定：範本沒有，先用示範範本**——依設計 §2.2 建示範範本，介面與列印明確標「示範範本」，不得宣稱為機關公定格式 |
| Q12 | H2／H3 是否排入（H1 回報的 default privileges 漂移） | 收回 anon 表級 DML／序列與 anon／PUBLIC 函式 EXECUTE、default 改 fail-closed（先盤點登入前路徑、逐支盤點既有函式、審查 security definer）vs 維持逐支 revoke 的慣例 | 主 session 2026-09-17 轉述使用者同意排入並執行；H2＋H3 合為 migration `20260919003000`；service_role 的函式 EXECUTE 維持平台預設（實作時依 P2c 實測調整，理由見 migration 檔頭），其餘照建議 |

## 7. 進度

| 單元 | 分支／PR | commit | migration | 部署 | 已驗證 | 下一步 |
|---|---|---|---|---|---|---|
| P0 | `codex/slimming-p0-design`／PR #102 | `881702a`（merge commit 見 Git） | 無 | 無（純文件） | `npm run check:docs` 55 檔、355 連結、0 錯誤；CI 見 PR | P1a 與 P4a |
| P1a | `codex/slimming-p1a-nav`／PR #104 | `5bb6a1d`；merge `33d0f70` | 無 | 2026-09-17 前端隨 main 由 Workers Builds 自動建置；`check:prod` app／demo 皆 OK，正式 bundle 已含新導覽；demo 站未重佈 | `npm test` 120 檔 1,255 項；lint／build／`check:docs` 55 檔 355 連結 0 錯；Demo E2E 10 支 71 項全綠（reachability 25/24/24 條、a11y 三角色 375＋1024 全路由）；內建 Preview 375px 底欄／抽屜／`/site` 核對 | P1b 退場頁唯讀化（/cost、/audit 已 hidden）；P1c 只剩文案（底欄已＝四入口＋更多）；P1d 同步 route-registry-governance／UIUX §0 |
| P4a | `codex/slimming-p4a-calc`／PR #103 | `eea40b3`＋`24c38cc`；merge commit `591570c` | `20260917120000_confirmed_quantity_calc`（只型別與純函式；rollback 檔同名 `.down.sql`） | 2026-09-17 `supabase db push` 已套正式；`migration list --linked` 61 筆對齊；正式庫唯讀核對 14 支函式 IMMUTABLE／security invoker、anon／authenticated 不可執行 | CI（`24c38cc`）：pgTAP 從零套用 41 檔 1,131 通過、`confirmed_quantity_calc.sql` 83/83；`check:docs` 55 檔 0 錯誤。本機全套 41 檔 1,125 通過，`ai_platform`／`p0_02` 的計數斷言因共用本機 DB 殘留列（1 專案、3 成員）假失敗、與本支無關 | P2a（DB 單元循序）；P4b 依設計 §3.2 介面把表資料餵入純函式，不重寫算法 |
| T0 | `codex/slimming-t0-pgtap-isolation`／PR #107 | `85156e6`＋`0e3dfd6`；merge commit `b5b01ff` | 無 | 無（測試基礎與 CI；無正式環境變更） | 本機 `npm run test:db` 41 檔 1,131 通過＝CI（main `d3b7d35`）；殘留列仍在的共用 DB 執行前後 86 張表列數快照 md5 相同、無 `*_pgtap_*` 殘留；SIGINT 中斷與 pid 已死殘留皆自動清除；`scripts/test-pgtap.test.js` 14 項；lint／`npm test`／`check:docs` 綠；CI `pgtap` 改走同一條路徑後綠 | P2a 起 DB 單元以本機 `test:db` 判紅綠；記憶檔 `pmis-local-pgtap-setup.md` 的舊跑法已過時（由使用者更新） |
| P2a | `codex/slimming-p2a-field-docs`／PR #109 | `f5bad72`＋`f689042`；merge commit `3f2a00a` | `20260917201000_field_documents`（五表／`photos` 七欄／六支 guard／稽核 trigger；rollback 檔同名 `.down.sql`） | 2026-09-17 `supabase db push` 已套正式；`migration list --linked` 62 筆對齊；正式庫唯讀核對 5 表／10 trigger／9 policy 就位、grants 如設計、既有 2 筆照片 `uploader_org` 皆回填、0 筆未知（詳 CURRENT §6.3） | 本機 `npm run test:db` 從零套 62 支：42 檔 1,346 通過、0 失敗（新增 `field_documents.sql` 215/215）；lint 綠；`npm test` 120 檔 1,259 項；build 綠；`check:docs` 55 檔 361 連結 0 錯；CI（`f689042`）CI／pgTAP 皆 success | P2b Edge 起稿（AI 重跑＝新增版本；`ai_*` 只 service 可寫）、P2c 現場紀錄頁（直接 INSERT `photo_intakes`／`photos`／`field_documents` 草稿，其餘走 RPC）、P2d RPC 依設計 §5 的寫入順序（簽署列→狀態→事實表） |
| P1c＋P1d（同一 PR，含手機抽屜斷點缺陷） | `codex/slimming-p1cd`／PR #108 | `2126496`＋`72bbb9a`；merge commit `f6ba60c` | 無 | 2026-09-17 前端隨 main 由 Workers Builds 自動建置；`check:prod` app／demo 皆 OK，正式主 chunk（`index-B7ANsNEt.js`）已無舊「常用工作」文案；demo 站未重佈（待 P1b 後一次重佈） | `npm test` 120 檔 1,259 項；lint／build／`check:docs` 55 檔 357 連結 0 錯；Demo E2E workflow-ux／a11y／reachability／routes 4 支 35 項全綠，新增抽屜斷點測試修前紅修後綠；內建 Preview 375／1024 核對首頁「工作」列、提醒中心文案、底欄、抽屜拉寬解鎖；PR 與合併後 main（`f6ba60c`）的 CI、pgTAP 皆過 | P1b 退場頁唯讀化（/cost、/audit 已 hidden；`Agent.jsx` 的「前往風險稽核」連結與 `Members.jsx` 角色說明中的風險稽核字樣待 P1b／P6c 一併處理）；P1b 完成後重佈 demo |
| P2d | `codex/slimming-p2d-sign-submit`／PR #112 | `4a0ea14`＋`01aa6a8`；merge commit `2f9f68d` | `20260917205000_field_document_rpcs`（五支 RPC／兩支 guard／helper／`field_documents_target_uidx` 只算活文件；rollback 檔同名 `.down.sql`） | 2026-09-17 `supabase db push` 已套正式；`migration list --linked` 63 筆對齊；正式庫唯讀核對（RPC 權限、guard 啟用、索引定義、既有 12 筆日誌 0 簽署）見 CURRENT §6.3；無 Edge／前端部署 | 本機 `npm run test:db` 從零套 63 支：43 檔 1,486 通過、0 失敗（新增 `field_document_sign.sql` 140/140，全走真實 authenticated＋JWT 路徑）；lint 綠；`npm test` 120 檔 1,259 項；build 綠；`check:docs` 55 檔 363 連結 0 錯；CI（`01aa6a8`）CI／pgTAP 皆 success | P2c 前端改接：存檔走 `save_field_document_version`（`content_hash` 原樣送回簽署）、簽署前檢查 `error.code='PD003'` 引導 MFA、`recheck` 顯示待補、提送／收件／退回帶 `client_request_id`；P2b 起稿的 `agent_actions` 用 `target_table='field_documents'`＋`target_id` 才會被簽署處理；P3a／P3b／P3c 各加 `sign_field_document` 分支（目前非 daily_log 回 `PD007`） |
| P1b | `codex/slimming-p1b-retire-readonly`／PR #113 | `f3349c3`＋`2f0c730`；merge commit `96efb56` | `20260917210000_cost_items_retire`（收回 `cost_items` 的 INSERT／UPDATE／DELETE grant、policy 改 select-only；rollback 檔同名 `.down.sql`） | 2026-09-17 合併後依「收緊型先前端後 DB」：Workers Builds 自動建置正式站（主 chunk `index-BPR2IHOP.js`，四頁 chunk 已含新文案）→ `supabase db push` 套 `20260917210000`，`migration list --linked` 64 筆對齊，正式庫唯讀核對 policy 只剩 SELECT、anon／authenticated 無 INSERT／UPDATE／DELETE、11 列／4 案無損 → demo 站重佈 Version `3afb3109`（chunk 含新文案、無舊字串）→ `check:prod` app／demo／workers.dev 皆 OK（詳 CURRENT §6.3） | 本機 `npm run test:db` 從零套 64 支（rebase 到含 P2d 的 main 後重跑）：44 檔 1,510 通過、0 失敗（新增 `cost_items_retired.sql` 24/24；`p0_05` 48/48；rebase 前 43 檔 1,370）；`npm test` 120 檔 1,261 項；lint 零警告；build；`check:docs` 55 檔 363 連結 0 錯；Demo E2E owner／routes／contractor／workflow-ux／reachability 5 支 38 項＋a11y 18 項全綠；內建 Preview 核對 `/valuation` 檢核卡（2 風險 1 注意 50 工項）、`/cost` 唯讀＋CSV、`/portfolio` 三列清單、`/audit` 退場說明；CI 見 PR | P4c：合併決策列「超計／無佐證」（`valuationDiff.js`）與整期勾稽發現（`valuationChecks.js`）的口徑並做正式缺件控制；P5d：契約／變更／進度檢核表面向由履約時程承接；P6b：刪 `RiskAudit.jsx`、Demo 成本種子（成本 CRUD 已於 P1b 移除）；P6c：`audit.summary` 退場後移除 `auditSummary` store 路徑 |
| P2b | `codex/slimming-p2b-draft-edge`／PR #116 | `388b89f`＋`8daebe8`；merge commit `b52cd25` | `20260917213500_ai_field_docs_draft`（只 seed 一列 `ai_features`；rollback 檔關閉開關） | 2026-09-17 `supabase db push` 已套正式；`migration list --linked` 65 筆對齊；正式庫唯讀核對該列七欄如 seed、`ai_features` 18 列 16 開；同日以 `--use-api` 從 main 重佈全部 18 支 Edge（既有 17 支版本 +1、`send-reminders` 維持 `verify_jwt=false`、新增 `draft-field-documents` v1）；`check:prod` app／demo 皆 OK（詳 CURRENT §6.3） | `npm test` 122 檔 1,301 項（新增 `fieldDocDraft.test.ts` 15、`fieldDocDraftRun.test.ts` 22）；`check:edge` 18 支；lint／build 綠；`npm run test:db` 從零套 65 支：45 檔 1,518 通過（新增 `ai_field_docs_draft.sql` 8；時間戳因與 P1b 撞而改為 `20260917213500`）；`check:docs` 55 檔 372 連結 0 錯。**模型品質未驗**（本機無模型金鑰，全部 stub），列 P7b | P2c 前端接 `draft-field-documents`（介面：`POST {project_id, intake_id}`；200 `{ok, intake{status,photo_count,recognized_count,failed_count,log_date,candidates[],error_summary}, photos[{id,ai_status,work_item_id,work_item_hint,caption,location,error}], documents[{doc_type,doc_date,document_id,version_no,status,action,reason,pending_fields[]}], remaining, notes[]}`；`remaining>0` 再呼叫一次即續跑；錯誤碼 400 `invalid_input`、401、403 `feature_disabled`／`org_mismatch`、404 `intake_not_found`、409 `run_conflict`／`intake_discarded`／`attempts_exhausted`、500 `server_not_configured`／`db_error`、503 `gate_unavailable`；`photo.classify` 關閉時回該閘門的 403／503 並附 `intake`）；P2d 簽署 RPC 讀 AI 版本的 `required_fields`／`field_sources` 與 `agent_actions(kind='draft_field_document')`；P3a–c 把 `inferCandidates` 的 `unsupported` 候選接成真的起稿分支 |
| H1 | `codex/slimming-h1-table-privileges`／PR #118 | `5154d0b`＋`f4f2cb0`；merge commit `dfc3953` | `20260917213900_api_roles_table_ddl_privileges`（ACL only：revoke 四種權限 on all tables from public／anon／authenticated／service_role＋`alter default privileges for role postgres in schema public revoke …`；rollback 檔同名 `.down.sql`） | 2026-09-17 合併後 `supabase db push` 已套正式；`migration list --linked` 66 筆對齊；正式庫唯讀核對 57 關聯三角色四種權限殘留 0、DML 計數與套用前相同、default ACL 只剩 `arwd`、資料列數無變（詳 CURRENT §6.3）；無 Edge／前端部署 | 本機 `npm run test:db` 從零套 66 支（rebase 到含 P2b 的 main 後重跑）：46 檔 1,712 通過、0 失敗（新增 `api_roles_table_privileges.sql` 194/194＝57 關聯 × 3 角色迴圈＋23 條；rebase 前 45 檔 1,704）；`npm test` 122 檔 1,301 項；lint 零警告；build；`check:docs` 55 檔 364 連結 0 錯；真後端 `e2e:real` chain1（註冊→建案→邀請→正式模式→被邀方可見，spec 對齊 2026-09-11 成員頁殼後綠）與 chain2（廠商建期送審→監造核定→機關請款）在套用 H1 的本機棧全綠；共用開發 DB 以 `migration up --local` 補到 `20260917210000` 後以 psql 直接套 H1 SQL 核對三角色 57 關聯零殘留 | H2（anon 表級 DML／序列 default 對齊本機 secure-by-default）、H3（新函式 EXECUTE default）為候選，待使用者決定；P2b 之後的 migration 時間戳須晚於 `20260917213900` |
| P5a | `codex/slimming-p5a-ball-in-court`／PR #120 | `5af48af`＋`36028ce`＋`519e280`；merge commit `1edd3c8` | `20260917220737_obligation_party_unassigned`（`obligation_party()` 對三方以外回 null，去頭尾空白比對；policy 不動即對三方都不放行；rollback 檔同名 `.down.sql`；時間戳因 H1 `20260917213900` 先合併而由 `213502` 改為 `220737`） | 2026-09-17 合併後 `supabase db push` 已套正式；`migration list --linked` 67 筆對齊；正式庫唯讀核對：`obligation_party` 對 null／空字串／其他／未知文字回 null、`' 機關 '` 回機關、IMMUTABLE、update policy 條件未變，109 筆義務中 7 筆責任不明（皆待辦，自此三方皆唯讀、列待補設定）；以 `deno info` 確認只有 `agent-run`、`send-reminders` 的模組圖含新模組（`assistant-chat` 不含），兩支以 `--use-api` 重佈：`agent-run` v16、`send-reminders` v18（`verify_jwt=false` 維持）；`check:prod` app／demo 皆 OK（詳 CURRENT §6.3） | 本機 `npm run test:db` 從零套 67 支（rebase 到含 H1 的 main 後重跑）：47 檔 1,728 通過、0 失敗（新增 `obligation_party_unassigned.sql` 16/16；`obligation_ownership_completed_at.sql` 27/27 三條改新語意）；`npm test` 124 檔 1,331 項（新增 `ballInCourt.cases.test.js` 12、`ballInCourt.cases.test.ts` 10、`db.test.js` 現場文書載入、`todayTasks` 待補設定／基準日、`ballInCourt.test.js` 觀察／現場文書、`obligationTimeline.test.js` 待補設定、`agentBrief.test.ts` 待補設定段）；`npm run test:edge` 3 項（Deno 執行期同案例）；`check:edge` 18 支；lint 零警告；build；`check:docs` 55 檔 378 連結 0 錯；Demo E2E contractor／owner／supervisor／workflow-ux／routes／reachability／a11y 7 支 63 項全綠；CI 見 PR。**待驗**：首頁「待補設定」卡與履約時程「待補設定」責任方在真資料的目視（demo 種子沒有責任不明的義務）；`/site?doc=` 直達要等 P2c 文件頁 | P5b 期次改讀 `obligation_periods` 時，`obligationBall` 的 dueIso 改由期次供給、窗口規則不變；P2c 現場文書頁接 `?doc=` 直達並在寫入後重載 `fieldDocuments`；P5d 履約時程列「待補設定」責任方篩選；P6b 若動 `Alerts.jsx` 要保留 `setup` 桶只在首頁 |
| P3a（後端） | `codex/slimming-p3a-supervisor-log-backend`／PR #122 | `673f810`＋`3fe7c35`；merge commit `ba7c596` | `20260917221000_supervisor_logs`（`supervisor_logs` 表＋RLS＋guard；示範範本與規則函式；通用 `fn_field_document_fact_guard`；`sign_field_document` 分派＋`supervisor_log` 分支；`fn_field_document_unmet_fields(doc_type, …)`；rollback 檔同名 `.down.sql`，回復後須重跑 `20260917205000`） | 2026-09-17 合併後 `supabase db push` 已套正式；`migration list --linked` 68 筆對齊；正式庫唯讀核對（表／RLS／四條 policy／唯一鍵／三支 trigger／grants／函式權限／範本／0 列）見 CURRENT §6.3；`draft-field-documents` 以 `--use-api` 重佈 v1→v2（其餘 18 支未動）；`check:prod` app／demo 皆 OK | 本機 `npm run test:db` 從零套 68 支（rebase 到含 P5a 的 main 後重跑）：48 檔 1,859 通過、0 失敗（新增 `supervisor_logs.sql` 128/128；H1 全表迴圈因新表多 3 條；`field_document_sign.sql` 140/140 回歸）；`npm test` 124 檔 1,342 項（新增 11）；`check:edge` 18 支；`test:edge` 3；lint 零警告；build；`check:docs` 55 檔 379 連結 0 錯；CI 見 PR。**模型品質未驗**（stub），列 P7b | 前端（P2c 共用審核／簽署元件合併後）：監造日誌頁讀 `fn_field_document_template('supervisor_log')` 標「示範範本」與免責聲明、到場欄必須由人確認（`field_sources.attendance.status='confirmed'` 或 `na`＋reason）、`recheck` 的 `needs_confirmation` 高亮、廠商照片只能 `role='reference'`、提送對象為機關；P3b／P3c 各加一支 `field_document_sign_<type>_internal`＋`sign_field_document` 一個 case 分支（不重寫前段）並在 `fn_field_document_template` 加範本；P3e `set_intake_shared_input` 對人填欄只能寫 `confirmed`；P6a 監造月報改讀 `supervisor_logs` |
| P2c | `codex/slimming-p2c-site-flow`／PR #124 | `2630ed3`＋`559464a`；merge commit `bb5f34a` | 無（`supabase/config.toml` 本機 TOTP、`seed.sql` 本機 service_role 函式 EXECUTE 鏡像 hosted＋pgTAP `service_role_function_grants.sql`，不進正式庫） | 2026-09-19 合併後：前端隨 main 由 Workers Builds 自動建置（正式主 chunk `index-DpEdh4Nn.js` 含 `photo_intakes`／`draft-field-documents`、無 `saveSiteLog`；`Site-Cj_6zwYR.js` 含「拍照／上傳」）；以 `--use-api` 從 main `bb5f34a` 重佈 `draft-field-documents` v2→v3（`verify_jwt=true`；`functions list` 其餘 18 支版本未動）；`check:prod` app／demo 皆 200、CSP `script-src 'self'`、無注入腳本；demo 站未重佈；合併後 main 的 CI／pgTAP 皆 success | `npm test` 125 檔 1,354；`npm run test:db` 從零套 68 支 49 檔 1,864；`check:edge` 18；`test:edge` 3；lint／build；`check:docs` 55 檔 384 連結 0 錯；Demo E2E 7 支 63 項；真後端 chain 5 三角色通過（第 1–7 次各修一個根因後第 8 次綠、rebase 後第 9 次綠，逐次見 BASELINE；本機 Edge stub 模型）；PR CI／pgTAP／e2e／Workers Builds 於 `2630ed3` 皆 success。**模型品質未驗**（P7b）、iPhone 實機未驗 | P3a 前端：監造日誌頁沿用 `DailyLogFields`／`DocumentLifecycle`／`IntakeUploader`（`fixedDate`＋`uploader_org=supervisor`），`/site` 清單已列 `supervisor_log` 狀態待接頁面；P3d：`/site-log/print` 印版本與雜湊；P3e：`discard_field_document`（P2c 只能捨棄批次）；P6：Edge Agent `draft_daily_log` 工具改建 `field_documents` 草稿（前端接受路徑已改走文件）；工具鏈：repo `deno.lock` v5 與 CLI 2.113 本機 edge-runtime 不相容，本機 `functions serve` 需暫移 lockfile |
| P5b | `codex/slimming-p5b-obligation-periods`／PR #125 | `621ba06`＋`3aad25e`；merge commit `5e47cad` | `20260917233000_obligation_periods`（表＋RLS 沿用義務＋純函式期次排程＋冪等 materialize＋`transition_obligation_period` RPC＋循環義務 guard＋回填＋pg_cron `pmis-obligation-periods`；rollback 檔同名 `.down.sql`；時間戳晚於 P3a `20260917221000`） | 2026-09-19 合併後 `supabase db push` 已套正式（dry-run 只列這一支）；`migration list --linked` 69 筆對齊；正式庫唯讀核對：循環 7 筆中 5 筆規則不完整（待補設定）、2 筆產生 8 期（`2026-07`～`2026-10`，全待辦、0 待核對、各含下一期）、cron 工作與三支 trigger 就位、grants 如設計；`deno info` 核對四支模組圖含新模組並以 `--use-api` 重佈：`agent-run` v17、`send-reminders` v19（`verify_jwt=false` 維持）、`fetch-weather` v16、`draft-field-documents` v4；正式主 chunk `index-BEZXz8WO.js` 含 P5b 字串；`check:prod` app／demo 皆 OK；demo 站未重佈（詳 CURRENT §6.3） | 本機 `npm run test:db` 從零套 70 支（rebase 到含 P2c 的 main `f4e3f32` 後重跑）：50 檔 1,970 通過、0 失敗（新增 `obligation_periods.sql` 99/99：排程純函式月末夾住／閏年／平年／跨年／永遠含下一期／季／週／日／規則不完整／基準日缺；插入即物化、基準日補上即補齊、三層冪等 0 新增；本期完成不動下期、舊逾期保留、已提送→已完成不重蓋、退回清時間戳與證據；權限矩陣自己方／他方／非成員／未登入／未知狀態／別案證據／責任不明三方皆不可／admin override／正式模式失效；RLS 成員可見非成員 0、直接 insert／update 42501、RPC 成員可非成員拒；義務層標已提送 P0001 而單次照舊；廢止級聯只動待辦期；規則變更只重建沒動過的期；回填 mapped／review／none 與標記後解除待核對；`requirement_obligation_one_way.sql` 38/38 改為循環義務逐期語意）；`npm test` 125 檔 1,357 項（rebase 後含 P2c；新增 `contractDue.test.js`／`.ts` 讀期次、`todayTasks.test.js` 逐期＋三種缺口、`obligationTimeline.test.js` 逐期／期次列／缺口、`ledger.test.js` RPC＋demo 鏡像、`persistedWrites.test.js` RPC、共用案例三側 ob12–ob16）；`npm run test:edge` 3 項；`check:edge` 18 支；lint 零警告；build；`check:docs` 55 檔 388 連結 0 錯；Demo E2E contractor／owner／supervisor／contract-flow／routes／reachability／workflow-ux／a11y 8 支 69 項全綠（rebase 後重跑仍 69；demo 種子改為上一期已完成＋下一期待辦，劇本逾期分佈不變）；PR CI／pgTAP 於 `3aad25e` 皆 success。**待驗**：正式 7 筆 monthly 的期次與「循環規則待補」在真資料目視；pg_cron 工作首次執行紀錄（`cron.job_run_details`）；期限追蹤逐期標記在真後端 | P5c：基準日版本＋期次 `anchor_version_no`、基準日變更重算未完成期並記差異；同時決定循環的停止條件（竣工／保固期滿；目前無限循環）；P5d：期次完整 UI（履約時程逐期標記、逐期準時率由 `periodRows.onTime` 算）、待補設定「循環規則」篩選；P2c 若接現場文書證據 `evidence_document_id`，RPC 已收此參數；P6b 若動 `Alerts.jsx` 要保留 `setup` 桶 |
| H2＋H3 | `codex/slimming-h2h3-anon-privileges`／PR #129 | `a347ecd`＋`c6978be`；merge commit `f8c7891` | `20260919003000_anon_and_function_execute_privileges`（ACL only：anon 對 public 表／view／序列 revoke all＋per-schema default revoke；`revoke execute on all routines from public, anon, authenticated` 後逐支 grant 給 authenticated 允許清單 68 支；全域 `alter default privileges for role postgres revoke execute on routines from public`＋public per-schema revoke anon／authenticated＋extensions 補回 PUBLIC；service_role 既有 EXECUTE 明示對齊、default 維持平台預設；rollback 檔同名 `.down.sql` 依正式庫快照逐表／逐函式還原） | 2026-09-19 合併後 `supabase db push` 已套正式（套用前 `migration list --linked` 只列這一支待套；套用後 70 筆對齊）；正式庫唯讀核對：59 關聯＋2 序列 anon 零權限、ACL 無 PUBLIC，227 支函式 anon 0／PUBLIC 0／authenticated 68（允許清單 md5 相同、trigger 0）／service_role 227，defacl 全域 `{postgres=X}`、public functions `{postgres=X,service_role=X}`、tables／sequences 無 anon、extensions `{=X}`，七表列數與套用前相同；安全顧問無 anon 相關新項（64 筆 secdef-authenticated＝允許清單，屬設計）；內建 Preview 開 `#/login`／`#/terms`／`#/privacy`／`#/security` 四頁完整、對 `supabase.co` 零請求，唯一 console 錯誤為 CSP 擋 Cloudflare 邊緣注入 `jsd` 腳本（非本支、另列待辦）；`check:prod` app／demo OK；無 Edge／前端部署（詳 CURRENT §6.3） | 本機 `npm run test:db` 從零套 71 支：51 檔 2,295 通過、0 失敗（新增 `anon_and_function_privileges.sql` 325／325＝58 關聯＋2 序列＋227 函式 × anon 迴圈＋37 條）；`npm test` 125 檔 1,357 項；lint 零警告；build；`check:docs` 55 檔 388 連結 0 錯；真後端 `e2e:real` auth-smoke／chain1／chain2／chain5 在套用本支的本機棧全綠；正式庫唯讀查證與登入前路徑盤點見 BASELINE；CI 見 PR。中途兩次紅皆修根因（service_role 函式 default 與 P2c seed 衝突→改維持平台預設；per-schema REVOKE 拿不掉內建 PUBLIC→改全域＋extensions 補回＋runner 對 pg_temp 補回） | 之後每支新 RPC：migration 明示 `grant execute … to authenticated` 並加進 pgTAP 允許清單，否則 pgTAP 紅、上線 42501；P3b／P3c 的 `field_document_sign_<type>_internal` 不 grant；rollback 檔仍未演練 |
| P3a（前端） | `codex/slimming-p3a-supervisor-log-ui`／PR #130 | `5fb0ccb`（Edge 組字抽共用模組）＋`a8e7bff`（頁面）＋`198ff44`（§7）；merge commit `72c044c` | 無（純前端＋Edge 純重構；`_shared/fieldDocText.ts` 只被 `draft-field-documents` 的模組圖引用，行為不變，不需重佈） | 2026-09-19 合併後：前端隨 main 由 Workers Builds 自動建置（正式主 chunk `index-n1P9w2eA.js` 含 `/supervisor-log`／`/supervisor-log/print`／`fn_field_document_template`／`supervisor_log_demo`、無 `saveSiteLog`；`SupervisorLog-DrOQifZM.js`／`SupervisorLogPrint-DXLF419J.js` 含「示範範本」、`Site-CDd-xWU8.js` 含「監造日誌自動起稿」）；`check:prod` app／demo 皆 200、CSP `script-src 'self'`、無注入腳本；合併後 main 的 CI／pgTAP 皆 success；demo 站未重佈（留給後續一次處理）；無 migration／Edge 部署（詳 CURRENT §6.3） | `npm test` 127 檔 1,372（rebase 到含 H2／H3 的 main `f8c7891` 後重跑）；lint 零警告；build；`check:docs` 55 檔 391 連結 0 錯；`check:edge` 18；`test:edge` 3；Demo E2E 10 支 74 項（`supervisor.spec` 新增監造日誌；a11y 全路由含新頁）；真後端 chain 6 `e2e-real/chain6-supervisor-log.spec.js` 三角色本機通過（Edge stub 模型；第一次紅是 spec 對「版本 3 到場已由 RPC 標 confirmed」的預期錯，產品未改）；內建 Preview 375／1024 目視；CI 見 PR。**模型品質未驗**（P7b）、iPhone 實機未驗。環境事故：三個 worktree 目錄中途從磁碟消失，本單元重建自己的並重做遺失檔案 | P3b／P3c：各自頁面接上時把 `lib/fieldDocs.docPagePath` 加一列即可從 `/site` 直達，`DocumentLifecycle`／`DocumentPhotos` 已依 `doc_type`／`ownerOrg` 通用；P3d：施工日誌列印印版本與雜湊可沿用 `SupervisorLogSheet` 的頁首做法（簽署列指向的版本＋`getFieldDocumentVersion`）；P3e `set_intake_shared_input` 對人填欄只能寫 `confirmed`（前端 `fillHumanField` 同一語意）；P6a 監造月報改讀 `supervisor_logs`；工具鏈：本機 `functions serve` 仍需暫移 `deno.lock` |
| D1 | `codex/slimming-d1-edge-injection`／PR #133 | `e5d8c38`＋`45a0146`；merge commit `5a4b955` | 無 | 2026-09-19 demo 站（`pmis-demo`）以本分支重佈（Version `15c6fad4…`，順帶把 demo 帶到含 P3a 的 main）驗證真實邊緣行為：HTML `Cache-Control` 帶 `no-transform` 後不再有 challenge-platform 注入、入口 chunk 仍 immutable＋`br`；app：Workers Builds 沒有對 `5a4b955` 建置（check-suite 停在 `queued`，app 被同一腳本正確報紅 23 分鐘），`_headers` 隨 P5c merge `ba8f7be` 的建置上線（正式版本 `5378517c`，18:25Z），之後 `npm run check:prod` 五頁全 OK（app HTML 1,618 bytes 帶 `no-transform`、無注入；入口 chunk 與 `/demo/assets/*` immutable＋`br`）；合併後 main 的 CI／pgTAP 皆 success；Cloudflare 後台未動、不需動（詳 CURRENT §6.3） | `npm test` 128 檔 1,385 項（新增 `scripts/check-prod.test.js` 13 條）；lint 零警告；build；`check:docs` 55 檔 391 連結 0 錯；`wrangler dev` 本機：`/`、`/login`、`/theme-boot.js` 為 `public, max-age=0, must-revalidate, no-transform`，`/assets/*` 為 `public, max-age=31536000, immutable`，`security.txt` 為 `public, max-age=86400`；處置前 `node scripts/check-prod.js` app／demo 五頁全紅（缺 `no-transform`＋行內腳本，`/demo/` 資產另缺 immutable）；demo 重佈後 `/`、`/login`、workers.dev 三頁 OK；CI 見 PR | Cloudflare 後台不需操作（Bot Fight Mode 維持開；日後若想真的啟用 JSD 須先改 D-025，不得用 nonce／`unsafe-inline` 換）；改 `_headers` 任何 `Cache-Control` 前看檔內註解；未在瀏覽器 console 逐頁複核（以 HTML 內容為準） |
| P5c | `codex/slimming-p5c-anchor-versions`／PR #134 | `68674b7`＋`614f326`；merge commit `ba8f7be` | `20260919021500_project_anchor_versions`（表＋guard＋trigger 留版重算＋RPC＋兩欄＋停止條件＋回填；rollback 檔同名 `.down.sql`；時間戳晚於 H2／H3 `20260919003000`，且晚於未合併的 R1 `20260919010000`） | 2026-09-19 合併後 `supabase db push` 已套正式（dry-run 只列這一支）；`migration list --linked` 71 筆對齊；正式庫唯讀核對：12 版 v1（initial、建立者／生效日 null）、期次 8→3 列皆蓋版號 1（兩案已登錄竣工，竣工後 5 期移除）、7 筆循環義務無停止條件缺口、快照 0 列、四支新 trigger 就位且 P5b 的 projects trigger 已移除、grants 如設計、cron 仍在；`deno info` 核對四支模組圖後 `--use-api` 重佈：`agent-run` v18、`send-reminders` v20（`verify_jwt=false` 維持）、`fetch-weather` v17、`draft-field-documents` v5；正式主 chunk `index-DMS7lRJl.js` 含 `update_project_anchors`；`check:prod` 五頁 OK；demo 站未重佈（詳 CURRENT §6.3） | 本機 `npm run test:db` 從零套 72 支：52 檔 2,436 通過、0 失敗（新增 `project_anchor_versions.sql` 124/124：結構／授權、純函式、v1 快照與期次版號、重算只動未完成（移除／kept／單次改期／不受影響的義務不動）、展延附依據與變更案、停工不改日期仍留版、值沒變不留版、直接 REST 改仍留版且月末基準日對齊、不可竄改（authenticated 42501、擁有者 P0001）、RPC 權限矩陣（成員／非成員／未登入／未知類別／非四欄／非日期／別案變更）、RLS、單次快照（fixed／竣工前 7 日、client 寫快照欄 42501、竣工日再變快照不動並記 kept、退回清空、再完成重留）、竣工登錄與確認優先、清除補回並蓋現行版本、竣工日缺不產生、已過只到竣工日且 cron 不越界、展延恢復、清空竣工日移除、專案刪除 cascade）；`npm test` 129 檔 1,403 項（rebase 後；rebase 前 126 檔 1,375）（新增 `projects.anchors.test.js` 5、`todayTasks` stop 案例、`obligationTimeline` 版本／依據／stop、`contractDue.js`／`.ts` 快照、`db.test` 版本分頁；共用案例三側加 ob17／ob18）；`npm run test:edge` 4；`check:edge` 18 支；lint 零警告；build；`check:docs` 55 檔 388 連結 0 錯；Demo E2E contractor／a11y／routes／reachability／workflow-ux／owner／supervisor／contract-flow 8 支 70 項（rebase 後；rebase 前 69）；內建 Preview（demo）核對期限追蹤詳情「依據：第 2 版基準日（開工日 …）」、期次逐期依據句、基準日卡類別／依據／生效日、留版後「已留第 3 版」與版本紀錄、履約時程同一份依據；PR CI 見 PR。正式庫唯讀盤點（套用前）：13 案（有竣工日 11、開工日 2、決標 1、無任何基準日 1）；循環 7 筆皆施工中 monthly，6 筆所屬專案缺竣工日但已登錄報竣 8/21＋竣工確認 8/24，另 1 筆專案有竣工日且驗收鏈完整（confirm 7/15）；既有 8 期皆待辦未動過、basis 起算日皆等於現值（可蓋 v1）；義務層完成 0 筆 | P5d：期次 UI 完整化（逐期準時率、待補設定「停止條件」篩選）、保固類循環義務需定義保固期滿日來源（目前不自動產生）；P3d／P6a 若印期限要帶「依據第 N 版」；R1 合併後確認時間戳順序（`20260919010000` < `20260919021500`）；rollback 檔未演練 |
| R1 | `codex/slimming-r1-remove-mfa`／PR #128 | `7b2f2c9`（rebase 到含 H2／H3、P3a 前端、D1、P5c 的 main `af50930`）；merge commit `ad8066e`（使用者親自合併，auto mode 擋子代理 merge） | `20260919023220_remove_signing_mfa`（`method` check 二值＋既有列改標、guard 去 mfa 分支、`sign_field_document` 去 aal2；rollback 檔同名 `.down.sql`；時間戳晚於 P5c `20260919021500`） | 2026-09-19 使用者於自己的終端機 `supabase db push` 套用 `20260919023220`；`migration list --linked` 72 筆對齊、無亂序；正式庫唯讀核對（`auth.mfa_factors` 0、簽署 0、`method` check 二值、兩支函式原始碼無 PD003／aal2／platform_account_mfa、authenticated 可簽而 anon 不可、guard trigger 啟用）見 CURRENT §6.3；Workers Builds 對 `ad8066e` check-suite success（合併後 77 秒），正式主 chunk 無 `/account`／MFA 應用字串，`check:prod` 五頁 OK；無 Edge；demo 站未重佈 | 本機 `npm run test:db` 從零套 73 支：52 檔 2,434 通過、0 失敗（`field_document_sign` 139、`field_documents` 215、`supervisor_logs` 127、H3 允許清單 339 不變）；`npm test` 128 檔 1,398；lint／build 綠；`check:docs` 55 檔 392 連結 0 錯；Demo E2E 全套 10 支 74 項；真後端 chain 1（3.3s）／5（8.3s）／6（8.1s）通過且無驗證碼步驟（本機棧、Edge stub、埠 5190）；正式庫唯讀核對 `auth.mfa_factors` 0、簽署 0；全庫 grep 無殘留 MFA／TOTP／aal2 程式路徑 | **待使用者**：正式 Supabase Dashboard 關閉 Auth → Multi-Factor → TOTP 的 Enroll／Verify（`auth.mfa_factors` 0 列，關閉不影響任何帳號）；本機共用 stack 的 `config.toml` 變更要 `supabase stop && supabase start -x …` 才生效（不影響測試）；後續以 `DocumentLifecycle` 為基底的 P3b／P3c／P3d 以 R1 後 props 為準（無 `mfa`／`onMfaVerify`／`onGoAccount`） |
| CI1 | `codex/slimming-ci1-pin-cli`／PR #139 | `0953cef`＋`17f395b`；merge commit `c221c67` | 無 | 無（只動 CI workflow、runner 輸出與文件；無正式環境變更；Workers Builds 對 PR 的 preview 建置 success） | 本機 `npm run test:db`（一次性資料庫從零套 73 支）52 檔 2,434 通過、0 失敗，第一行印 `Supabase CLI 2.113.0`；`scripts/test-pgtap.test.js` 14 項；eslint 零警告；`check:docs` 55 檔 394 連結 0 錯；PR `17f395b` 的 CI（run 35444633449）／pgTAP（run 35444633552）皆 success，setup-cli 步驟直接下載 release asset、不再有 API 解析 | 升級 CLI 照 deploy §3；`actions/*` major 升版（Node 24 原生）另案；後續 DB 單元若 CI 因映像／CLI 行為紅，先看版本是否被人改回 `latest` |
| P5d | `codex/slimming-p5d-schedule`／PR #140 | `e69b8b3`＋`093f652`；merge commit `0cca888`（rebase 到含 R1／CI1 的 main `c221c67`） | 無（純前端；`item_schedules`／`schedule_periods` 不動） | 2026-09-19 合併後 Workers Builds 對 `0cca888` 建置 success（GitHub check-run「Workers Builds: pmis」completed）；`npm run check:prod` 五頁（app `/`、`/login`、`/demo/`；demo `/`、`/login`）全 OK；正式入口 chunk `index-CGhdBv5p.js` 含 P5d 的 `/requirements` 指引文案，`Requirements-CpOj92g6.js` 含「時程範圍」「加入關鍵工項」「退回 … 期待辦」、`Schedule-BefRMlMA.js` 含「已退出新作業」「到履約時程」；demo 站未重佈 | `npm test` 131 檔 1,424 項（rebase 後；rebase 前 132 檔 1,429，差異為 R1 移除的 MFA 測試）（新增 `keyWorkItems.test.js` 6：落後判定五態、排序／完成% 封頂／分母 0、停留點六態與該動的一方、事項形狀；`obligationTimeline.test.js` ＋9：五種缺口的種類／標籤／導向、同種只列一次、setup 篩選與搜尋、近期判定含最近 7 日完成與循環最近一期、先急後緩順序、`periodStat`、執行卡以期計、檢視模型帶 `periodStat`／本期 id；`Requirements.keyItems.test.jsx` 7：近期列落後工項與該叫驗停留點且預設仍選最逾期義務、廠商詳情改起迄只送單欄與移除、監造唯讀與停留點導 `/itp?point=`、`?item=` 直達、待補設定篩選與擷取審核入口、近期→全期與空時退回全期、逐期掛佐證標記走 RPC 與機關唯讀；`Schedule.readonly.test.jsx` 3；`navConfig.test.js` hidden 集合三條）；lint 零警告；build；`check:docs` 55 檔 394 連結 0 錯；Demo E2E contractor／routes／reachability／contract-flow／supervisor／owner／workflow-ux／a11y 8 支 71 項全綠（contractor 新增：摘要卡件數、近期同一時程、詳情改計畫迄後工項列與掛它的停留點列同步、待補設定篩 0 件、全期分段、逐期掛佐證標記與逐期準時率、`/schedule` hidden 直達唯讀且看得到剛改的日期）；內建 Preview（demo，5190）1024：執行卡「到期 5 項準時完成 4 項（含循環 1 期）」、關鍵工項卡 10 項／停留點 5 個、近期 15／全期 24、關鍵工項詳情兩個日期欄＋掛的停留點；375：無溢位、列點開為「事項詳情」抽屜含兩個日期欄、加入關鍵工項搜尋不渲染、`/schedule` 手機摘要無輸入框。**待驗**：正式站真資料（4 案 4 列 `item_schedules`）在履約時程的目視與 `/requirements?item=` 直達；真後端 `item_schedules` 寫入（RLS `can_write`）由履約時程詳情實跑 | P6b：刪 `Schedule.jsx`、`e2e/a11y.spec.js` 的 `/schedule` H1、Demo 種子 `itemSchedules` 改由履約時程語意保留；保固類循環義務的保固期滿日來源仍待產品決定（介面列停止條件待補）；P3d／P6a 印期限帶「依據第 N 版」不變 |
| P6c | `codex/slimming-p6c-retire-audit-summary`／PR #141 | `b2c3aa4`＋`ca30702`；merge commit `b0571bf` | `20260919130400_audit_summary_retire`（只翻 `ai_features.audit.summary` 的 `enabled=false`；列／用量歷史／覆寫／`audit_events` 不動；rollback 檔同名 `.down.sql`；時間戳晚於 R1 `20260919023220` 與未合併的 P4b `20260919140000`） | 2026-09-19 13:30Z 使用者 `supabase db push` 套用 `20260919130400`，`migration list --linked` 73 筆對齊；正式庫唯讀核對：`ai_features.audit.summary` `enabled=false`、該功能用量 0、`ai_features` 18 列關閉 3、`audit_events` 1,297 筆不動；無 Edge 重佈（閘門讀 DB 即時回 403）；前端隨 main 由 Workers Builds 自動建置 success；`check:prod` 五頁 OK；demo 站未重佈（P4c 同步記入 CURRENT §6.3） | 本機 `npm run test:db` 從零套 74 支（CLI 2.113.0）：52 檔 2,445 通過、0 失敗（`ai_features_retired.sql` 6→17：三支退場關閉、pro 專案閘門拒絕、覆寫翻不過、用量含 blocked 仍以原 label 列於 `admin_ai_usage_by_feature`、後台 RPC 開回即放行）；`npm test` 128 檔 1,398；`check:edge` 18；`test:edge` 4；lint／build 綠；`check:docs` 55 檔 394 連結 0 錯；Demo E2E owner＋a11y 25 項；全庫 grep 無 `auditSummary` 呼叫端 | P6b：連同 `assistant-chat`／`parse-contract` 一併移除三支退場 Edge 原始碼、`errorLeak.scan.test.ts` 清單與註冊表目錄存在性測試同步，線上函式 `supabase functions delete` 由使用者執行；rollback 檔未演練（與 `/admin` 開回同一件事，pgTAP 已證明開回即放行） |
| P4b | `codex/slimming-p4b-confirmed-qty`／PR #138 | `bb17579`＋`79460c9`＋`6ef8adb`（rebase 到含 R1／CI1／P5d／P6c 的 main `b0571bf`）；merge commit `69a1e30`（使用者合併） | `20260919140000_confirmed_quantity_enforcement`（四張新表＋加欄＋列級 guard＋`valuations_guard` 狀態機＋AFTER 檢查點 `valuations_checkpoint_guard`＋十支 RPC＋逐工項 advisory lock＋確認變動收斂／自動同步 trigger＋legacy 回填；rollback 檔同名 `.down.sql`，已在本機共用 stack 實跑回復再重套；時間戳晚於 R1 `20260919023220`） | 2026-09-19 使用者親自 `supabase db push` 套用 `20260919140000`（套用前 `migration list --linked` 只差這一支，套用後 74 筆對齊；輸出「Finished supabase db push.」）；使用者以 `supabase db query --linked -f p4b-verify.sql` 唯讀核對，實際值全部與預期一致：`inspection_confirmations` 0、`valuation_item_sources` 5（legacy 5）、`valuation_adjustments` 0、`work_item_pricing_basis` 0、`valuations` 12、`valuation_items` 26（`backing='legacy'` 26）、`recheck_required` 0、含 legacy 來源的已核定期 4、新 trigger 11、`fn_cq_*` 函式 29、authenticated 可執行 RPC 10（authenticated 函式 EXECUTE 總數 79、anon 0）、四張新表無多餘 grant 0、`applied_valuation_id` FK＝`ON DELETE SET NULL`；無 Edge；前端無改動；demo 站不重佈（P4c 同步記入 CURRENT §6.3） | 本機 `npm run test:db` 從零套 74 支（CLI 2.113.0）：54 檔 2,821 通過、0 失敗（＝P6c 基準 52 檔 2,445＋新增 `confirmed_quantity_enforcement.sql` 294 條＋`confirmed_quantity_concurrency.sql` 22 條 dblink 真併發＋H3 允許清單 339→349（十支 RPC）＋H1 全表迴圈因四張新表自動多 12 條＋`valuation_payment_gate.sql` 16→17；既有 `formal_mode`／`evidence_guards`／`boq_reset_import`／`valuation_items_guard`／`photos_storage`／`p0_05_audit_events`／`payment_flow` 七檔 fixture 改走合法路徑：登入者只能建草稿、送審／核定必填截止日、歷史已核定期以 DBA 邊界 `disable trigger` 建立）；`npm test` 131 檔 1,424 項；lint 零警告；build；`check:docs` 55 檔 395 連結 0 錯；真後端 `e2e:real` chain 7（新：申報 100 送審被擋並顯示原因、REST／RPC 亦 `VQ004`、`get_valuation_state` cap 0、廠商簽單 `VQ001`、監造確認單 60、重播 `applied:false`、同步後 61 回 `VQ006`、送審核定）4.2s＋chain 2（送審前補截止日）5.4s 通過（本機共用 stack、埠 5189）；正式庫唯讀盤點（只取計數）：`valuations` 12（草稿 7／監造審核 1／已核定 4；截止日 1／1／1；請款日 2）、`valuation_items` 26（已核定 5 筆 Δ>0，1 筆掛非計價列、1 筆工項無單位；草稿 21 筆 11 筆 Δ>0）、超契約量 0、負值 0、H 點 3 皆無 `stage_key`、核准變更連工項 3、總價類末端工項 4,914；CI 見 PR | P4c：`Valuation.jsx` 改讀 `get_valuation_state`／`list_billable_backlog`、`billing.js` 改呼叫 `sync_`／`set_valuation_item_cum`／`transition_valuation` 並移除 `fillValuationFromSiteLogs`、建期填 `period_end`（現在直接 REST 送審沒有截止日會被擋）、以 `VQ004.detail` 顯示缺件、總價類標「計價依據待設定」；P4d：撤銷／作廢／補證（`issue_supervisor_certificate` 帶 `p_covers_valuation_id`）UI；P3c：簽署 `inspection_form` 在同交易寫 `inspection_confirmations`（介面與 guard 條件見設計 §16.6，`confirmed_at` 用簽署列 `signed_at`）並補 `photo_frozen_reason` 的附件事由；P4e：收回 `valuation_items` 直接寫入。已知限制：作廢的調整永不產生新可用量（機關接受的量計入已計價，該工項之後的確認須先「補回」才有增量）；`can_write` 允許監造協助填報草稿（既有語意，正式模式亦然）；歷史已核定期無截止日者請款不再要求截止日 |
| P3b | `codex/slimming-p3b-self-check`／PR #143 | `c87bd9f`＋`2c1dc5d`；merge commit `066f247`（P3c 同步：正式 `supabase db push` 已套 `20260919141500`，`migration list --linked` 75 筆對齊；`draft-field-documents` 重佈 v6；Workers Builds success；`check:prod` 五頁 OK） | `20260919141500_self_check_documents`（示範框架範本、規則函式改簽章、`fn_checklist_judge`、`checklist_records_guard` 重算判定＋綁定不可刪、`checklist_records_defect_sync`、版本 guard／save／sign 新版本＋`self_check` 分支；rollback 檔同名 `.down.sql`，回復後須重跑 P3a 範本／規則節與 R1 sign 節） | 合併後 `supabase db push` 套正式、`draft-field-documents` 以 `--use-api` 重佈、`check:prod` 五頁（結果寫在單元回報，由下一單元同步） | 本機 `npm run test:db` 從零套 75 支（rebase 到含 P4b 的 main `69a1e30`，migration 改名 `20260919125656`→`20260919141500`）：55 檔 2,958 通過、0 失敗（新增 `self_check_documents.sql` 126、`checklist_revisions.sql` 35→38、`supervisor_logs.sql` 127→129、H3 迴圈淨 +6；`field_document_sign` 139 不變）；`npm test` 132 檔 1,442（新增 `SelfCheck.document.test.jsx` 5、`demoFieldDocTemplates.test.js` 改為解析 migration 4、`fieldDocs.test.js` +3、Edge `fieldDocDraft.test.ts` 23→27、`fieldDocDraftRun.test.ts` 25→28、`quality.test.js` 改為 DB 判定／trigger 語意）；`check:edge` 18；`test:edge` 4；lint 零警告；build；`check:docs`；Demo E2E 受影響 5 支（contractor／a11y／routes／reachability／supervisor）50 項；真後端 chain 5／6／8 本機（Edge stub、埠 5189）皆通過 | P3c：`sign_field_document` 加 `inspection_form` 分支即可（同日事實列檢查只對日誌類）；查驗表單簽署即寫入確認量由 P4b 後接；`ChecklistSection` 直接寫入路徑仍在（判定／缺失已下沉 DB，無第二份規則），改為只吃文件可列 P6 清理；`fn_field_document_unmet_fields`／`fn_field_document_human_only_keys` 簽章已變，P3c／P3e 依新簽章呼叫；本機共用 stack 以 psql 套 `20260919141500` 並登記版本（其他 worktree 的 `20260919130400`／`140000` 已在該庫，CLI `migration up` 被擋）；`functions serve` 仍需暫移 `deno.lock` |
| P4c | `codex/slimming-p4c-valuation-ui`／PR #144 | `88cdcfe`＋`5ca99c5`＋`b75dc18`；merge commit `8acb9b8`（P3c 同步） | 無（純前端；不動 DB、Edge） | 合併後前端隨 main 由 Workers Builds 自動建置（success）；`check:prod` 五頁 OK（P3c 同步）；demo 站不重佈 | `npm test` 133 檔 1,461 項（rebase 後；新增 `valuationPeriods.test.js` 3、`SourceRow.test.jsx` 5、`billing.test.js` 改為 19 條 RPC 包裝測試、`valuationChecks.test.js` +4、`boqCalc.test.js` 改 DB 金額語意、`db.test.js` 投影欄位；刪 `valuationDiff.test.js`）；lint 零警告；build；Demo E2E contractor／owner／supervisor／workflow-ux／a11y 57 項；真後端 `e2e:real`（本機 stack，5189 被另一 worktree 佔用改臨時設定埠 5192、跑完即刪）chain 2 3.3s、chain 7 3.1s、新 chain 9 2.8s 全過；內建 Preview 375／1024 版面；`check:docs` | P4d：撤銷／補證／作廢 UI（頁面已把 `certificate`／`adjust`／`review` 三類缺件指到 P4d）、順帶把 P4b `VQ006` 訊息的 numeric 格式改掉小數尾（`60.0000`）；P4e：收回 `valuation_items` 直接寫入（chain 9 的 REST 舊路徑屆時改為明確失敗）；P3c：簽署 `inspection_form` 寫確認量後，來源展開的查驗／文件版本連結即生效；P6a：`ValuationPackage`／`Print` 已改讀 DB 金額，可再接確認量來源 |
| P3d | `codex/slimming-p3d-daily-log-print`／PR #145 | `ec9f2ee`＋`7f05ec7`；merge commit `9b06dc3`（P3c 同步） | 無 | 前端隨 main 由 Workers Builds 自動建置；合併後 `check:prod`（結果寫在單元回報）；demo 站未重佈 | `npm test` 134 檔 1,462（main 基準 132 檔 1,442 ＋20：`fieldDocs.test.js` +7 選版本／提送流水排序／退回歷史多筆與再送配對／回執含雙對象／下一責任方／列印內容形狀，`dates.test.js` +2 台北時間，新增 `SiteLogPrint.test.jsx` 6、`DocumentLifecycle.test.jsx` 5）；三頁文件測試的提送 fixture 補 `document_id`（真實列必有）；lint 零警告；build；`check:docs`；Demo E2E 受影響 4 支（contractor／supervisor／routes／a11y）47 項；真後端 chain 5／6／8 本機通過（Edge stub、埠 5189；chain 5 新增：退回歷史含退回人姓名、回執編號＝DB 送件列、列印版本 3 雜湊＝DB）；內建 Preview 375／1024 列印頁無水平溢位（文件卡 375 由 chain 5／6 溢位斷言覆蓋） | P3c：監造查驗表單列印直接用 `usePrintedVersion`＋`DocumentPrintStamp`，文件卡回執／退回歷史已依 `doc_type` 通用（雙對象各一張回執）；`TO_ORG_BY_DOC_TYPE.inspection_form` 只列 `contractor`，與 `FIELD_DOC_PARTIES`（廠商＋機關）不一致，P3c 接頁面時一併對齊；提送列沒有送件人姓名快照，已離開本案的成員只能顯示單位（要保存姓名需 schema 變更，屬 Fable 單元） |
| P4d | `codex/slimming-p4d-adjustments`／PR #147 | `a9bff38`＋`1c42258`；merge commit `f7d247f`（P3c 同步：正式 `db push` 已套 `20260919160000`，`migration list --linked` 76 筆對齊；`check:prod` 五頁 OK） | `20260919160000_vq_message_numeric_format`（新增純函式 `fn_cq_txt`＋`create or replace set_valuation_item_cum`，只改 VQ005／VQ006 訊息數字格式；回復檔 `supabase/rollbacks/` 同名 `.down.sql`；本機共用 stack 以 psql 直接套用驗證，因 CLI `migration up --local` 被 stack 上他人先套的 `20260919222000` 擋下） | 合併後 `supabase db push` 套 `20260919160000`（結果由下一單元或使用者回填）；無 Edge 部署需求（`_shared/ballInCourt.ts` 的兩個唯讀查詢隨下次 `send-reminders`／`agent` 部署生效——**待部署**，早報／Agent 在部署前仍照舊規則）；前端隨 main 由 Workers Builds 建置；demo 站不重佈 | `npm run test:db` 55 檔 2,964 通過（`confirmed_quantity_enforcement.sql` 294→299：`fn_cq_txt` 三值＋授權、`throws_like` VQ006 訊息不帶小數尾）；`npm test` 137 檔 1,493（新增 `CertificateForm.test.jsx` 3、`AdjustmentsCard.test.jsx` 3、`SourceRow.test.jsx` +2、`billing.test.js` +4、`db.test.js` legacy 計數、共用案例 fixture v6／adj1／adj2）；lint 零警告；build；`check:docs` 55 檔 403 連結 0 錯；`check:edge`；`test:edge` 4 通過；真後端 `e2e:real` 新 chain 11 兩條通過（11a 核定→UI 撤銷→請款被 `VQ004` 擋→UI 作廢→請款日登錄；11b 歷史遷移期別以 DBA 邊界建立→監造首頁「待監造補證」→缺件卡→「補證此期」→缺件清空→請款日登錄；本機 stack 5189，等 T1 跑完才跑）；Demo E2E contractor／supervisor／owner／workflow-ux 40 通過（5188 被 `-slimming-4` 佔用，臨時設定埠 5194、跑完即刪）；`check:prod` 五頁 OK（P4c 建置） | P4e：收回 `valuation_items` 直接寫入時，順帶把 `fn_cq_item_state_internal` 逐工項違反 `message`、確認紀錄 guard 減量訊息、批次 guard 訊息改經 `fn_cq_txt`（目前缺件卡括號裡仍會出現「數量 50.0000 來自歷史遷移」）；P3c：查驗確認量的減量走重簽查驗表單（估驗頁只撤銷）、撤銷後照片凍結事由；Edge 部署：`send-reminders`／`agent` 下次部署起早報與 Agent 才列「待監造補證」「待機關處理扣回」；正式庫 4 個歷史遷移期別的補證步驟見設計文件 §18.1（監造：估驗頁選該期→缺件卡「展開 1 列」→來源展開「補證此期」→填批次／依據→「簽發並補證第 N 期」；之後機關在 `/payments` 登錄請款日） |
| T1 | `codex/slimming-t1-chain6-flaky`／PR #146 | `4390360`；merge commit `89fbd2c` | 無 | 無（只動測試設定、chain 6 一個選擇器與文件；無正式環境變更） | 修正前以「監造日誌版本 5 簽署落庫即 touch `e2e/contractor.spec.js`」穩定重現 chain 6 同一行（spec:229）同一簽名（trace：簽署後 0.3 秒 `GET /` 重載、之後無 `submit_field_document`）；修正後真後端 chain 5→6→7 連跑 3 輪全綠（全程每秒 touch spec）、chain 6 單跑綠；lint 零警告；`npm test` 134 檔 1,462；`check:docs` 55 檔 404 連結 0 錯 | T2（Demo E2E 同一機制＋沿用他人 server） |
| T2 | `codex/slimming-t2-demo-e2e-isolation`／PR #149 | `4d4f94f`＋`ec8d6db`；merge commit `bba3c39`（P3c 同步） | 無 | 無（只動測試設定與文件；無正式環境變更） | 修正前 Demo E2E 全套邊跑邊每秒 touch `e2e/rfi.spec.js`：76 項紅 20 項（1.8m）；另一目錄的 Vite 佔埠時被直接沿用（`WebServer is already available`，對它跑測）。修正後同條件 76 項全綠（30.8s）；佔埠時立即 `is already used` 不跑測；以 `vite.e2e.config.js` 起被佔的埠 Vite 直接 `Port … is already in use` 退出；預設埠 5188 單支 6 項綠；真後端 auth-smoke 以共用設定 1 項綠；lint 零警告；`npm test` 137 檔 1,493；`check:docs` 55 檔 404 連結 0 錯 | 並行 worktree 跑 Demo E2E 撞埠時改設 `E2E_DEMO_PORT`（README「驗證」） |
| P3c | `codex/slimming-p3c-inspection-form`／PR #148 | rebase 到含 P3d `9b06dc3`／P4c `8acb9b8`／P4d `f7d247f` 的 main；merge commit `5779d9f`（O1 同步） | `20260919222000_inspection_form_documents`（`checklist_templates` 四欄；`inspections` 九欄＋四值狀態 check；`inspections_guard` 改 BEFORE INSERT OR UPDATE；`inspections_defect_sync`；稽核 decided＝非待查驗；`fn_field_document_template` 加 `inspection_form`；`fn_field_document_item_keys`／`fn_field_document_stage_required`／`fn_inspection_sign_bypass`；`field_documents_inspection_uidx`；`inspection_confirmations_inspection_stage_uidx` 改只算 active；`create_inspection_form_draft`（允許清單 79→80）；`save_field_document_version` 範本檢查含查驗表單；`field_document_sign_inspection_form_internal`＋`sign_field_document` case；rollback `supabase/rollbacks/20260919222000_inspection_form_documents.down.sql`） | O1 同步：main `5779d9f` 的 unit／e2e／pgtap／Workers Builds success；正式 `supabase db push` 已套 `20260919222000`，`migration list --linked` 77 筆對齊；正式庫唯讀核對（新欄／trigger／索引就位、RPC authenticated 可而 anon 不可、既有 `inspections` 11 列 0 列違反四值 check、查驗表單文件與確認紀錄皆 0）；Edge 重佈模組圖含共用規則的四支 `draft-field-documents` v7、`agent-run` v19、`fetch-weather` v18、`send-reminders` v21（`verify_jwt=false`），P4d 的早報／Agent 新事項自此生效；`check:prod` 五頁 OK；demo 站由 O1 重佈 | 本機 `npm run test:db` 從零套 77 支：56 檔 3,116 通過、0 失敗（新增 `inspection_form_documents.sql` 146；H3 允許清單 79→80、全庫迴圈因新欄／新函式自動增加；`self_check_documents` 126、`confirmed_quantity_enforcement` 294、`field_document_sign` 139、`supervisor_logs` 129、`field_documents` 215 回歸不變）；`npm test` 137 檔 1,503（rebase 到含 P4d 的 main 後；本單元新增：`fieldDocs.test.js` +5（提送對象矩陣解析 migration、必要階段、空白表單、判定與確認量一致性、批次累計）、`demoFieldDocTemplates.test.js` 改為三類＋查驗表單斷言、Edge `fieldDocDraft.test.ts` +4、`fieldDocDraftRun.test.ts` 監造批次改為起查驗表單＋冪等＋跨批次同一份、`itp.test.js` +1、`quality.test.js` 改為缺失由 DB 開、`navConfig.test.js` 路由與分頁）；`check:edge` 18；`test:edge` 4；lint 零警告；build；`check:docs`；Demo E2E 受影響 5 支（supervisor 新增監造查驗表單 demo 流程／a11y／routes／reachability／contractor）51 項；真後端（本機 colima 棧、Edge stub、5189 被另一 worktree 佔用改臨時設定埠 5190 跑完即刪；共用開發 DB 以 psql 套 `20260919222000` 並登記版本）新 chain 10 9.3s 通過、chain 5／6／8 回歸通過（chain 6 改斷言新徽章文案「監造日誌／查驗表單自動起稿」） | P4d：撤銷／補證 UI 可直接接 `revoke_inspection_confirmation`（P3c 表單改量流程已依賴它）；P3e：`set_intake_shared_input` 對查驗表單的申報量／位置只能寫 `confirmed`；P6：`/quality` 的「合格／不合格」快速判定與 `ChecklistSection` 直接寫入路徑一併改為只吃文件；**待辦**：`checklist_templates.kind='inspection_form'` 的範本尚無建立介面（範本建立仍預設 `self_check`）、`applies_to` 未參與候選推斷、`photo_frozen_reason` 的確認量附件事由未加；本機 `functions serve` 仍需暫移 `deno.lock` |
| O1 | `codex/slimming-o1-acceptance`／PR #150 | `c13c11f`（基準 main `5779d9f`）；merge commit `aa21d90`（P4e 同步） | 無 | 2026-09-19 demo 站（`pmis-demo`）以 main `5779d9f` demo 模式建置後 `wrangler deploy --config wrangler.demo.jsonc`，Version `e181dc14-75ed-458f-8ac1-aa6db9c25c9a`（前一版 D1 `15c6fad4…`）；無 DB／Edge／正式前端變更 | `node scripts/check-prod.js` 五頁 OK（demo 入口 chunk `index-7YKCAnE1.js` 與建置一致、bundle 無 Supabase 網址）；正式唯讀核對 `migration list --linked` 77 筆對齊、`functions list` 四支版本如 P3c 列；`check:docs` 綠 | 使用者依 §8 逐項驗收；§8.7 未做項照 §5 排程 |
| P4e | `codex/slimming-p4e-seal-writes`／PR #151 | 基準 main `aa21d90`；merge commit `4c45c57`（P3e 同步） | `20260920001500_valuation_items_seal`（`valuation_items` 收回 PUBLIC／anon／authenticated 的 INSERT／UPDATE／DELETE、刪 `valuation_items_write` policy；`valuation_items_guard` 非重算路徑 `VQ010`、移除 legacy 標記與已核定備註相容分支；`fn_cq_item_state_internal`／`inspection_confirmations_guard`／`valuation_item_sources_guard`／`fn_cq_reconcile_internal`／`admin_adjust_valuation_item` 訊息數量改經 `fn_cq_txt`、單階段不再印「缺必要查驗階段 (單階段)」；簽章與 H3 允許清單不變；rollback 檔 `supabase/rollbacks/` 同名，本機一次性棧實跑回復→舊測試全綠→重套） | 合併後正式 `supabase db push`、`check:prod` 由單元回報、下一單元同步；無 Edge 部署（只新增測試）；前端無改動；demo 站不重佈 | 本機 `npm run test:db`（CLI 2.113.0）從零套 78 支：56 檔 3,163 通過、0 失敗（`valuation_items_guard.sql` 11→50 封堵矩陣、`confirmed_quantity_enforcement.sql` 299→307）；`npm test` 138 檔 1,507（新增 Edge 掃描 4 條）；lint 零警告；build；`check:edge` 18；`check:docs`；真後端（隔離本機棧 `PMIS_p4edev`，共用開發棧未動，埠 5189）chain 2／7／9／11a／11b 5 項通過（chain 9 舊 REST 路徑 upsert／update／delete 皆 42501；chain 7 自 P4d 起在 main 已紅的選擇器一併修正） | **緊接（同根因，P3e 並行避免互蓋）**：P3c 的 `field_document_sign_inspection_form_internal` 六處申報／確認量訊息與 `inspections_defect_sync` 缺失說明（「申報／確認／差額」）仍以 `%s` 印 `numeric(18,4)`，由 P3e 或其後第一個動到簽署路徑的 DB 單元改經 `fn_cq_txt`（設計 §19.2）；共用開發棧 `supabase_db_PMIS` **尚未套** `20260920001500`（auto mode 擋共用資源修改），他 worktree 跑 chain 9／11 前需先套（或用隔離棧，見 `docs/REAL_BACKEND_E2E.md`）；P7c：rollback 已在本機演練，staging 演練仍依原計畫 |
| P3e | `codex/slimming-p3e-shared-input`／PR #152 | 見 PR（rebase 到含 P4e 的 main `4c45c57`；migration 由 `20260920001500` 改名 `20260920004000`（與 P4e 同號）；merge commit `c92598e`（P6a 同步）） | `20260920004000_intake_shared_inputs`（只新增函式；rollback 檔同名 `.down.sql`，已寫入的人工版本與 `shared_inputs` 保留） | 合併後 `supabase db push` 套正式、前端隨 main 由 Workers Builds 建置、`check:prod`（結果寫在單元回報，由下一單元同步）；無 Edge 變更 | 本機 `npm run test:db` 從零套 79 支（rebase 到含 P4e 後重跑）：57 檔 3,271 通過、0 失敗（新增 `intake_shared_inputs.sql` 95；`inspection_form_documents.sql` 146→150（P4e 交接：數量訊息無 `.0000`）；H3 允許清單 +2）；`npm test` 139 檔 1,517（`fieldDocs.test.js` +5、新 `IntakeSharedInputs.test.jsx` 5）；lint 零警告；build；`check:docs`；真後端 chain 12 通過、chain 5／6／8／10 回歸通過（Edge stub；共用開發 DB 以 psql 套 `20260920001500` 並登記版本；5189 被 P4e worktree 佔用改臨時埠 5199、跑完即刪） | P3f 文件草稿捨棄；§8.1 A11 使用者驗收；另記：主 session 2026-09-20 查證正式 Auth TOTP 本來就是 Disabled（§8.7 G8 結案，未做任何變更）；補值後才起稿的新文件需人按「套用到其餘」（設計取捨，見設計 §2.4） |
| P6a | `codex/slimming-p6a-report-reuse`／PR #153 | 見 PR（實作＋文件同步＋證據載入鍵修正三個 commit；rebase 到含 P4e `4c45c57`／P3e `c92598e` 的 main）；merge commit 由下一單元同步 | 無（純前端；不動 DB、RPC、路由登記與 roles） | 前端隨 main 由 Workers Builds 自動建置；`check:prod` 結果寫在單元回報、由下一單元同步；demo 站不重佈（示範模式無法簽署，月報如實全列未簽署） | `npm test` 143 檔 1,551 項（rebase 到含 P3e 後）（新增 `reportSources.test.js` 6、`valuationPackage.test.js` 11、`Reports.signed.test.jsx` 4、`ValuationPackage.sources.test.jsx` 3；`fieldDocs.test.js` +6、`supervisorReport.test.js` 改為已簽署語意 12；`Reports.caliber.test.jsx` D-024 四項斷言不變）；lint 零警告；build；`check:docs`；Demo E2E a11y／routes／owner 30 項（標題改「監造月報」）；真後端 chain 13（新，共用本機棧、埠 5189）2.7s 通過；內建 Preview 375／1024 三頁無水平溢位 | 見本列下方「P6a 發現」 |
| P6b-1 | `codex/slimming-p6b-retire-cleanup`／PR #154 | `884cd00`＋`a647994`；merge commit `8001f3a`（P6b-2 同步） | 無 | Workers Builds 對 `8001f3a` success、`check:prod` 五頁 OK（入口 `index-BheiH2jk.js` 含兩條 `redirectTo`、無 Schedule／RiskAudit chunk）；`--use-api` 重佈 11 支（analyze-safety-photo v10、classify-document v5、classify-site-photo v12、describe-defect v12、draft-field-documents v8、draft-monthly-review v13、draft-rfi-reply v8、draft-valuation-summary v8、read-submittal v10、read-whiteboard v16、review-submittal v11，`verify_jwt` 維持）；`supabase functions delete audit-summary` 已執行（使用者授權）。`assistant-chat` v10／`parse-contract` v13 線上函式已於 2026-09-20 依使用者授權下架（P3f 以 `functions list` 核對：正式環境 16 支，已無 `audit-summary`／`assistant-chat`／`parse-contract`） | `npm test` 141 檔 1,540；lint；build；`check:edge` 15；`test:edge` 4；`check:docs` 0 錯；Demo E2E routes／reachability／owner／contractor／a11y 48 項（`/schedule?item=` 落在該項、`/audit` 機關到估驗計價、非原角色維持無權限且不被導走） | P6b-2：Agent 起稿改接文件；P6b-3：品質直接寫入退場＋收緊 migration；`riskAudit.js` 的單期金額 2.2 倍趨勢提示未承接（P4b 前置強制取代；若機關要趨勢提示另開單元加在估驗頁） |
| P6b-2 | `codex/slimming-p6b2-agent-field-docs`／PR #157 | `09e294f`＋`126e758`；merge commit `cf06e2c`（P6b-3 同步） | 無 | `deno info` 查到模組圖含變更模組的 3 支以 `--use-api` 重佈：`agent-run` v20、`draft-field-documents` v9、`send-reminders` v22（`verify_jwt=false` 維持）；Workers Builds 對 `cf06e2c` success、`check:prod` 五頁 OK（入口 `index-Ogdzotst.js`） | `npm test` 142 檔 1,532；lint；build；`check:edge` 15；`test:edge` 4；`check:docs` 0 錯；Demo E2E 全 77 項；本機共用棧一次性真 DB 驗證 12/12 | P6b-3：`ChecklistSection`／快速判定退場＋收緊 migration（`draft_inspection` 接受已不寫 `checklist_records`）；Agent 收件匣對照片起稿的 `draft_field_document`／`suggest_field_update` 仍只顯示原始 kind、接受只標狀態（P2b 起的既有表現，另列）；拒絕 Agent 草稿不會捨棄已建的文件草稿（待 P3f 捨棄入口） |
| P6b-3 | `codex/slimming-p6b3-quality-doc-only`／PR #158 | 見 PR；merge commit `b061d13`（P5e 同步） | `20260920030000_quality_direct_writes_retire`（收回 `checklist_records` INSERT／UPDATE／DELETE 與 `inspections` UPDATE、刪對應 policy；`checklist_records_guard` 只放行同案自檢表簽署交易（新 `fn_checklist_sign_bypass`）；`inspections_guard` 非簽署路徑改判定欄一律拒；rollback 同名 `.down.sql`，本機共用棧實跑回復再重套） | 收緊型：合併後前端隨 main 部署；**正式 `supabase db push` 由使用者執行**——2026-09-20 使用者已套同批的 P4e `20260920001500`、P3e `20260920004000` 與 P3f `20260920021000`，**本支 `20260920030000` 仍待套**（P3f 以 `migration list --linked` 核對） | `npm run test:db` 58 檔 3,325 通過 0 失敗（新增 `quality_direct_writes_retired.sql` 50；7 支既有測試改走簽署路徑模擬或斷言新邊界）；`npm test` 141 檔 1,522；lint；build；`check:docs` 0 錯；Demo E2E supervisor／workflow-ux／a11y／contractor 53 項；本機共用棧套本支後真後端 chain 4／8／10／13 通過（Edge stub） | 舊快速判定的查驗要更正＝由該查驗建立監造查驗表單並簽署（品質頁詳情目前只對待查驗或已有表單者顯示入口，舊判定沒有入口——若要開放另列）；`Alerts.jsx` 未動（`setup` 桶照舊只在首頁） |
| P3f | `codex/slimming-p3f-discard-draft`／PR #155 | 見 PR（實作＋文件同步；rebase 到含 P6b-1 `8001f3a`／P6b-2 `cf06e2c`／P6b-3 `b061d13` 的 main，與 P6b-2 的 `store/slices/fieldDocs.js` 衝突解成兩個函式並存）；merge commit `1ee8f96`（P5e 同步：Workers Builds success、CI 三項 success、`check:prod` 五頁 OK） | `20260920021000_field_document_discard`（加四欄＋`field_documents_discard_guard`＋`discard_field_document`＋`field_documents_audit`／`resolve_agent_action_internal` 兩支 `create or replace`；rollback 檔同名 `.down.sql`，捨棄紀錄欄保留） | **2026-09-20 使用者親自 `supabase db push`**，依序套 `20260920001500`（P4e）→`20260920004000`（P3e）→`20260920021000`（P3f）到正式庫並回報「Finished supabase db push.」；本單元以 `migration list --linked` 核對：遠端最後三支即此三支、只剩 P6b-3 `20260920030000` 待套（由使用者另行執行）。合併後前端隨 main 由 Workers Builds 建置；無 Edge 變更；demo 站不重佈 | 本機 `npm run test:db` 從零套 81 支：59 檔 3,406 通過、0 失敗（新增 `field_document_discard.sql` 78；`field_documents.sql` 215→216、`field_document_sign.sql` 139 的直接捨棄改帶原因；H3 允許清單 +1）；`npm test` 142 檔 1,534（rebase 到含 P6b-3 後）；lint 零警告；build；`check:edge` 15；`check:docs` 0 錯；Demo E2E contractor／supervisor／a11y／routes 49 項（新增文件頁捨棄→回現場紀錄→同日重新起稿、清單列捨棄且 375 寬按鈕 ≥44 無溢位）；真後端新 chain 14 通過（rebase 後重跑 7.3s），rebase 前並跑過 chain 5／6／8／10／12 回歸 | §8.1 A12 使用者驗收；P7a–P7c 依 §5 |
| P3g | `codex/slimming-p3g-template-ui`／PR #161 | 見 PR（實作＋文件同步；rebase 到含 O2 `07d5415` 的 main，與 O2 在 §8.7 G3／G4／G5 的衝突解成「G3 用 O2 的、G4 併入 P3g 兩個留尾、G5 改已做」） | `20260920050000_checklist_template_authoring`（`fn_checklist_applies_to`／`fn_checklist_items_normalize`／`checklist_templates_guard`／`checklist_templates_del_guard`；三支新函式都不授權 authenticated，H3 允許清單不變；rollback 同名 `.down.sql`） | **收緊型，先前端後 DB**：merge commit `36ed0f3`；Workers Builds success，正式入口 chunk `index-B7Dju1uW.js`（Cloudflare 的 `npm ci` 與本機 `node_modules` 解析不同，chunk 雜湊與本機 build 不同，改以內容核對）——`Quality-CltsOpnS.js` 含「檢查表範本」與「以查驗表單更正判定」、`Agent-DDSbLJ80.js` 含「AI 草稿遭拒絕」；`check:prod` 五頁 OK。前端上線後 `supabase db push` 套 `20260920050000`（「Finished supabase db push.」），`migration list --linked` 83 筆全部對齊、最新 `20260920050000`、無待套。Edge：`deno info` 查到模組圖含 `fieldDocDraft.ts`／`fieldDocRepo.ts`／`draftInspection.ts` 的只有 2 支，以 `--use-api` 重佈 `agent-run` v22、`draft-field-documents` v11（`send-reminders` 未受影響、維持 v23／`verify_jwt=false`）；demo 站不重佈 | `npm run test:db` 61 檔 3,585 通過（新增 `checklist_template_authoring.sql` 60）；`npm test` 151 檔 1,645；lint 零警告；build；`check:edge` 15；`test:edge` 5；`check:docs` 0 錯；Demo E2E supervisor／contractor／a11y／workflow-ux 55 項；真後端新 chain 16 通過（本機共用棧已套本支＋Edge stub），回歸 chain 8／10／14 通過 | §8.1 A13／A14、§8.2 B9 使用者驗收；正式 `db push` 與 Edge 重佈 |
| P5e | `codex/slimming-p5e-warranty-stop`／PR #156 | 見 PR（rebase 到含 P6b-2／P6b-3／P3f 的 main `1ee8f96`；migration 時間戳由 `20260920021500` 改為 `20260920040000`，排在 P6b-3 `20260920030000` 之後） | `20260920040000_warranty_stop_condition`（rollback 同名 `.down.sql`，已在一次性 DB 內以暫時探針實跑 6/6：恢復 P5c 停止條件、移除欄位／RPC／trigger） | 2026-09-20 使用者親自在本分支 `supabase db push`，依序套 P6b-3 `20260920030000` 與本支 `20260920040000`（Finished supabase db push.），`migration list --linked` 本地與遠端到 `20260920040000` 全部對齊；merge commit `4d6d77b`，Workers Builds 建置 success、正式入口 chunk `index-But1e0G2.js` 含 `get_project_warranty`；`deno info` 核對後以 `--use-api` 重佈四支——`agent-run` v21、`send-reminders` v23（`verify_jwt=false` 維持）、`fetch-weather` v19、`draft-field-documents` v10；`check:prod` 五頁 OK；正式庫唯讀核對：RPC `authenticated` 可執行／`anon` 不可、三欄與版本表 `warranty` 欄與兩支 trigger 就位、`fn_warranty_expiry('2025-04-30',1,'month')`＝2025-05-31、保固類期次 0 列（套用前後不變）、13 案未登錄保固期間（11 案兩項皆缺、2 案只缺保固期間）。正式庫唯讀盤點（2026-09-20，只取計數）：保固類義務 0 筆（循環 0）、保固類期次 0、正式驗收合格 2 案、approved 契約重點 `lifecycle_phase=保固` 0 筆、文字提及保固 1 筆（approved）、`trigger_config` 只有 offset／fixed 鍵——套用後預期 0 移除 0 新增 | `npm run test:db` 60 檔 3,521 通過 0 失敗（新增 `warranty_stop_condition.sql` 105；`project_anchor_versions.sql` 124、`anon_and_function_privileges.sql` 419；rollback 檔另以暫時探針在一次性 DB 內實跑 6/6）；`npm test` 143 檔 1,560；`npm run test:edge` 5；`check:edge`；lint 零警告；build；`check:docs` 55 檔 422 連結 0 錯；Demo E2E contractor／owner／supervisor／contract-flow／a11y／workflow-ux 66 項；`e2e:real` chain 3、chain 15 通過（共用開發 DB 以 psql 套本支並登記版本）；內建 Preview（demo）1024／375 期程卡無溢位；CI 見 PR | P3d／P6a 若印期限可帶保固期滿日依據；多工種保固年限（結構／一般／植栽）如需分別界定另開單元；履約時程以外的基準日編輯（期限追蹤頁、契約價金總額）仍以 `can.edit` 顯示可編、伺服器以管理者為準，屬既有 UX 鏡像落差，建議併入下一個觸及期限追蹤頁的單元 |
| O2 | `codex/slimming-o2-gaps`／PR #160 | 見 PR（基準 main `47958ce`，含 P5e）；merge commit 由下一單元同步 | 無（純前端／示範資料；不動 DB、RPC、RLS、路由登記與簽署規則） | 前端隨 main 由 Workers Builds 自動建置；`check:prod` 與 demo 站重佈版本寫在單元回報、由下一單元同步 | `npm test` 147 檔 1,589 項（新增 `demoSeed.signed.test.js` 12、`ValuationPackage.summary.test.jsx` 3、`Deadlines.anchors.test.jsx` 3、`IntakeResult.candidates.test.jsx` 4；`fieldDocs.test.js` +5、`agentRole.test.js` +2）；lint 零警告；build；`check:docs` 55 檔 423 連結 0 錯；Demo E2E 全 78 項（`contractor`／`supervisor` 兩處文件件數斷言隨示範已簽署文件更新）；內建 Preview（demo）1024／375：施工月報、監造月報、估驗佐證包皆有內容且無水平溢位 | 見本列下方「O2 發現」 |
| 廠商驗收 A（§9） | `codex/contractor-a-nav`／PR #163、merge `e3e4f65` | 需求來源進版控＋導覽與清單收斂（純前端；無 migration、無 Edge） | 無 | Workers Builds 隨 main 建置；2026-09-20 `check:prod` 五頁 OK、正式入口 chunk `index-CPSmUtum.js` 核對到 `hiddenFor`；demo 站未重佈 | `npm test` 151 檔 1,654 項（新增 navConfig `hiddenFor` 4 項、`fieldDocInWorkList` 5 項）；lint 零警告；build；`check:docs` 57 檔 433 連結 0 錯；Demo E2E 全套 80 項（新增廠商工作面無監造入口一條；routes／owner／PageTabs 斷言隨入口收斂更新）；真後端 chain 10（廠商申請查驗→監造判定簽署→廠商看到確認量與收件）見單元回報 | B–E 包；§9「A 待辦」 |
| 廠商驗收 D（§9） | `codex/contractor-d-pdf`／PR #166、merge `2350f16`；`codex/contractor-d-pdf-mobile`／PR #167（紙不跟裝置） | 列印頁補真正的「下載 PDF」（純前端；無 migration、無 Edge、無新路由；不動四類文書 Sheet 元件與欄位定義） | 無 | 合併後前端隨 main 由 Workers Builds 自動建置；merge commit 與 `check:prod` 見單元回報；demo 站未重佈 | `npm test` 154 檔 1,691 項（新增 `paginate` 8、`docFileName` 6、`SiteLogPrint` 下載接線 2）；lint 零警告；build（主 bundle 1,102.46→1,103.50 kB，新增按下才抓的 chunk 809 kB／gzip 333 kB 與 5.8 MB vendor 字型）；`check:docs` 57 檔 447 連結 0 錯；Demo E2E `routes`／`a11y`／`contractor` 42 項＋新增 `pdf-download` 5 項（實際下載檔案後解析）；本機 poppler 逐頁算圖核對 A4／中文／跨頁表頭 | C 包（文件頁動作列補下載入口、Sheet 改可編輯後回驗量測路徑）、E 包（真照片與已簽版本的整條鏈）；§9「D 待辦」 |
| P7a–P7c | — | — | — | — | — | 依 §5 順序 |

**P6a 發現（2026-09-20）**：
- 示範模式無法簽署（P2c 起的既定邊界），P6a 後兩張月報在 demo 如實把日誌全列「未簽署、不列入」、佐證包標「未經後端核對」；正式庫 12 筆舊流程日誌同樣標「舊流程紀錄，無簽署版本」不列入。
- 列印頁只找得到本案活文件、且只印該文件目前的簽署版本：來源版本已被更正（撤銷後重簽、送審後重簽）或文件已被取代時，月報／佐證包只印版本標示（文件短碼、版本、雜湊 12 碼）不給連結。若要「連到任一已簽署版本的紙本」，需另開列印頁 `?v=` 單元（四頁的事實列取法也要跟著改，不是只加參數）。
- 快速判定（未經監造查驗表單）的查驗不再計入兩張月報的判定統計，明列「未經簽署查驗表單、不列入」；兩張月報的查驗歸月規則統一為「本月申請或本月判定」（原施工月報只看申請日）。

**O2 發現（2026-09-20）**：
- 示範模式仍然**不能簽署**（使用者按簽署一律回「示範模式無法簽署／提送」，這條邊界沒動）。新增的是種子帶進來的「示範用已簽署版本」：每一列 `is_demo`，版本標示一律印 `【示範資料】`，簽署者是 demo 帳號本人加註「（示範資料）」，佐證包另有一行明示「已簽署文件版本、簽署者、內容雜湊與監造確認量皆為示範值」。
- 示範標單（`workItems.compact.json`）不帶工項 `id`，示範監造確認量只能以 `item_key` 當工項參照；原本估驗佐證包與監造月報各自建 `id → 工項` 的 Map，兩頁都查不到。收斂成 `lib/boqCalc.workItemRefIndex`（先 id 後 item_key）一份，真專案的 uuid 路徑不變。
- `ValuationPackage` 原本在 `!dbMode` 直接早退（整頁標示範、不載任何證據）。改為示範模式一樣跑同一輪載入，`demo` 旗標只用來標示——判定與組裝規則只有一套，示範與正式不再分岔。
- 期限追蹤頁的基準日改吃 `can.admin`（鏡像 `projects` 的 `is_project_admin` update policy），契約價金總額改 `isPersistedProject && can.admin`（示範模式沒有可寫的地方，唯讀）；示範模式的基準日仍可改（只進記憶體）。`/requirements` 本來就是 `can.admin`，兩頁規則自此一致。
- 批次候選的「已捨棄」狀態是以**文件現況**推得（`candidateState`）：slice 只為「候選指向、但不在活文件清單裡」的文件補查一次 `id, status`；查不到就維持原狀態，不把未載入誤判成已捨棄。

歷程規則：每單元合併後更新本表（PR 編號、merge commit、migration 版本、部署日期、驗證指令與結果）；正式環境狀態同時寫回 `CURRENT.md` §6.3。

### 7.1 廠商驗收修正（2026-09-20）各包合併與部署結果

由 O3 一次補齊（各包細節見 §9）。所有 merge commit 均已在 `origin/main` 上核對存在。

| 包 | 分支／PR | merge commit | migration | 正式部署狀態 |
|---|---|---|---|---|
| A | `codex/contractor-a-nav`／PR #163 | `e3e4f65` | 無 | 前端隨 main 自動建置；`check:prod` 五頁 OK |
| B | `codex/contractor-b-vision`／PR #164（文件 PR #165） | `a575bbc`（文件 `cf3b92c`） | `20260920120000_measured_from_record` **已套正式** | Edge 四支已重佈；後由 B2 再推進一版 |
| C | `codex/contractor-c-forms`／PR #168 | `bdbf4ae` | 無 | 純前端，隨 main 自動建置 |
| D | `codex/contractor-d-pdf`／PR #166（手機字級 PR #167） | `2350f16`（＋`ae3b8d6`） | 無 | 純前端，隨 main 自動建置；demo 站下載 PDF 已由 O3 實測 |
| B2 | `codex/contractor-b2-paper-cells`／PR #169 | `ba7a97b` | `20260920160000_ai_paperform_cells` **已套正式** | Edge `draft-field-documents` v13／`agent-run` v24／`classify-site-photo` v14／`read-whiteboard` v18 |
| C2 | `codex/contractor-c2-supervisor-forms`／PR #170 | `d161545` | 無 | 純前端，隨 main 自動建置 |
| E | `codex/contractor-e-acceptance`／PR #171 | `388daa4` | `20260920170000_inspection_sign_confirmation_lock` **已套正式** | 無 Edge 變更；正式站登入後 UI／PDF 仍未測 |
| O3 | `codex/contractor-o3-demo-docs`／PR #172 | `abddf53` | 無 | demo 站 Version `664312c5-d39a-48b6-b221-c246e6620e0f`（前一版 O2 `beb53b7c-ee55-456c-92af-e608fb1dd555`）；`check:prod` 五頁 OK |
| F1 | `codex/contractor-f1-setup-gaps`／PR #173 | `52f53ef` | `20260920214557_obligation_timing_gap`（只新增一支 IMMUTABLE 純函式；rollback 檔 drop）— 正式套用結果見單元回報 | Edge `_shared` 改動：合併後重佈 `agent-run`／`send-reminders`／`draft-field-documents`／`fetch-weather`（`deno info` 引用圖）；前端隨 main 自動建置；demo 站未重佈 |
| F2 | `codex/contractor-f2-coverage`／PR #174 | `0aa7fa6` | `20260920230000_edge_credential_writer_seal`（七支函式換定義、計價依據 trigger 加 DELETE；不動任何一列；rollback 檔同名 `.down.sql`）**已套正式**（2026-09-21 `supabase db push`；`migration list --linked` 88 筆對齊、最新 `20260920230000`、無待套；正式庫唯讀核對：七支函式皆含 F2 檢查、計價依據 trigger 含 delete；確認紀錄 0 列、期別 12 列未動） | Edge `send-reminders` v25（`verify_jwt=false` 維持）、`draft-field-documents` v15 以 `--use-api` 從 `0aa7fa6` 重佈；前端無改動，`check:prod` 五頁 OK；chain 21／22 於 colima 重建後實跑通過（PR #176）；全套 26 項＝25 綠＋chain 3 live 一次 `no_requirements`（模型輸出不完整，判定列於紅燈第一行）重跑即綠 |

O3 對正式環境只做唯讀核對、未做任何變更：遠端 migration **86 筆**＝repo 86 支、最新 `20260920170000`、無待套；Edge 版本如上表且皆 ACTIVE（`send-reminders` 維持 v23／`verify_jwt=false`，已退場的 `audit-summary` 不在線上清單內）。

B2 原列驗證數字（保留）：`npm test` 159 檔 1,775 項；`test:edge` 16 項（新 `imageRaster.deno.test.ts` 7 項）；`check:edge` 18 支（`deno.lock` 新增 `npm:jpeg-js@0.4.4`，`--frozen` 通過）；lint／build 綠；`check:docs` 58 檔 464 連結 0 錯；`test:db` 從零套用 62 檔 3,595 通過 0 失敗（新 `ai_paperform_cells.sql` 9 項）；真實模型回歸四輪見 §9 B2。

## 8. 使用者驗收清單

> 2026-09-19 O1 整理；使用者表示「驗收我來驗」，依 [實作指令](2026-09-17-claude-product-slimming-prompt.md) §8 與各單元回報寫成可逐項操作的清單。每項格式：**誰 → 在哪裡 → 做什麼 → 預期看到什麼**；回報問題請給「編號＋截圖＋大約時間」，對應欄的單元／PR 用來追查。只驗已上線的部分；§8.7 是未做或待決，不是缺陷。自動化測試（pgTAP、單元測試、E2E）只證明程式流程，畫面與真實資料要靠這一輪。

### 8.0 準備

- 正式站 `https://app.gov-agent.ai/`，路由都是 `#/…`（例 `https://app.gov-agent.ai/#/site`）。demo 站 `https://demo.gov-agent.ai/` 免登入選角色、用示範資料，**不能上傳照片、不能簽署**（按下簽署一律回「示範模式無法簽署／提送」），適合看版面、導覽收斂、四份紙本表單版面與「下載 PDF」。
- demo 站最後重佈：2026-09-20，含 A–E／B2／C2 全部前端（O3，Version `664312c5-d39a-48b6-b221-c246e6620e0f`）。demo 不隨 main 自動更新，看到的版面若與正式站不同請先確認重佈日期。
- 用一個**測試專案**（不要用客戶實案）：已匯入標單、至少一個有數量單位的工項（例 m²）、品質查驗頁已有自主檢查表範本；三個分屬廠商／監造／機關的測試帳號都加為成員。成員只放自己的帳號——早報每天台北 08:00 會寄給有逾期或 7 日內到期事項的成員。
- 手機：iPhone 實機，或桌機瀏覽器開發者工具把寬度設 375。
- 起稿出現「起稿服務暫時無法使用」時，先確認平台管理的 AI 功能「現場文書起稿(照片)」是開啟的。

### 8.1 四類文書：上傳 → 自動起稿 → 補缺 → 簽署 → 提送 → 收件／退回 → 補正再送

| 編號 | 誰 → 在哪裡 | 做什麼 | 預期看到 | 對應 |
|---|---|---|---|---|
| A1 | 廠商 → 現場紀錄 `#/site` | 按「拍照」或「選擇照片」上傳 2–3 張今日施工照（其中一張有告示板） | 每張照片標示已保存到伺服器（和「仍在本機」分開）；自動擬好當日施工日誌草稿，分成已帶入／待補，AI 帶入的欄位有來源標記；沒有來源的數量、天氣、到場人員不會被猜；配到工項的照片另擬自主檢查表草稿 | P2b #116、P2c #124 |
| A2 | 廠商 → `#/site` | A1 上傳到一半時切到別頁、登出再登入，回到 `#/site`；再對同一批按重試 | 上傳批次與草稿還在；不會多出第二份同日日誌；已人工改過的欄位不被重試覆蓋 | P2c #124 |
| A3 | 廠商 → 施工日誌 `#/site-log`（從現場文書清單點該份） | 補齊待補欄位並存檔 →「簽署此版本」→ 提送 | 缺必填時不能簽，並指出缺哪一欄；簽署後顯示版本號、雜湊前 12 碼、簽署者、伺服器時間；「提送與回執」顯示提送對象監造、待監造收件；全程不要求兩步驟驗證 | P2c #124、P2d #112、R1 #128 |
| A4 | 監造 → 今日工作 `#/dashboard`「現在輪到我」或 `#/site-log` | 開 A3 那份 →「退回（填原因）」；接著廠商在同一份建更正版本補正 → 再簽署 → 再提送；監造再按「收件」 | 退回原因必填；「退回歷史」逐次列出退回人、時間、原因與補正版本；已簽署的舊版內容不變，補正是新版本；收件後雙方都看到回執 | P2c #124、P3d #145 |
| A5 | 任一方 → 施工日誌「列印」（`#/site-log/print`） | 列印 A4 收件的那份 | 頁首版本號、雜湊前 12 碼、簽署者和 A3／A4 最後簽署的版本一致；未簽署的會標「草稿・未簽署」 | P3d #145 |
| A6 | 廠商 → 自主檢查表 `#/self-check`；監造收件 | 開 A1 擬出的自主檢查表 → 逐項核對實測值（AI 從紙本抄來的要按欄位確認、沒抄到的自己填）→ 簽署 → 提送監造；監造退回一次、廠商補正再送、監造收件；再按列印（`#/self-check/print`） | 沒有紙本佐證的實測值一律空白；有紙本佐證的會標「AI 已帶入・待確認」並附原文與來源照片，**沒有逐項確認就簽不下去**；判定與本次確認數量仍只能人填；簽署時判定由伺服器依範本重算；不合格會自動開缺失（品質查驗頁看得到）；退回歷史與回執同 A4；列印標「示範框架範本」，與簽署版本一致 | P3b #143、P3d #145、B 包 #164、B2 包 |
| A7 | 監造 → `#/site` 上傳今日巡查照 → 監造日誌 `#/supervisor-log` | 補缺 → 按「確認到場人員」→ 簽署 → 提送機關；機關退回一次、監造補正再送、機關收件；再列印（`#/supervisor-log/print`） | 一天一份；到場人員不能由 AI 帶入，沒親自確認就不能簽；同日施工日誌的收件情形列在內；廠商只能唯讀；列印標「示範範本」，與簽署版本一致 | P3a #122／#130、P3d #145 |
| A8 | 廠商 → 品質查驗 `#/quality`；監造 → 監造查驗表單 `#/inspection-form` | 廠商填查驗申請（查驗項目、工項、位置、申請查驗日、申報數量 100）→ 送出查驗申請；監造在 `#/site` 上傳該工項的查驗照（或在品質查驗該筆詳情按「以監造查驗表單判定（填確認數量）」）→ 核對申請資料、判定、填確認數量 → 簽署 → 提送；廠商與機關各自收件（其中一方先退回一次，監造補正再送）；再列印（`#/inspection-form/print`） | 判定與確認數量一律空白、只能監造填；簽署即判定（查驗紀錄狀態更新，不合格／部分合格自動開缺失）；同時提送給廠商和機關，兩方各自收件或退回；列印標「示範範本」，與簽署版本一致 | P3c #148、P3d #145 |
| A9 | 廠商、監造 → 手機 375 寬 | 在手機上重做 A1、A3（拍照 → 補缺 → 簽署 → 提送）與 A7 的上傳和到場確認 | 沒有左右捲動、按鈕點得到、底欄五格（四個主入口＋更多）；桌機的審核與估驗仍正常 | P1c #108、P2c #124 |
| A10 | 廠商 → `#/supervisor-log`、`#/inspection-form`；機關 → `#/site` | 試著編輯或簽署別方的文件 | 廠商對監造日誌只能唯讀、對查驗表單只能收件或退回，都不能編輯或簽署；機關在 `#/site` 沒有上傳鈕，只能查閱 | P2c #124、P3a #130、P3c #148 |
| A11 | 廠商 → 現場紀錄 `#/site` | 上傳今日照片、擬出施工日誌＋自主檢查表後，在上傳結果（或「上傳批次」展開該批）的「一次補齊」填一次某工項的施作位置按「套用」，再填當日完成數量；接著把自主檢查表簽署，回來把位置改成另一個值再套用 | 位置一次寫進兩份文件（各多一個版本，欄位標「共用補值・已確認」）、數量只寫施工日誌；已簽署的自主檢查表標「已簽署，不受影響」且內容不變；你在文件頁親自改過的欄位標「已個別填寫，不覆蓋」；同一個值不會重複產生版本 | P3e #152 |
| A12 | 廠商 → 現場紀錄 `#/site`；監造同樣試自己的監造日誌 | 上傳照片擬出草稿後：在「現場文書」清單某份自主檢查表那一列按「捨棄」並填原因；再開同日施工日誌按「捨棄草稿」填原因；回 `#/site` 重新上傳照片；最後對已簽署的日誌再試一次 | 沒填原因不能按確認；捨棄後回到現場紀錄並顯示「已捨棄…（原因：…）」與重新填寫的連結；清單、今日工作與 AI 草稿收件匣都不再列該份；重新上傳會擬出一份新的同日施工日誌、可補齊並簽署；已簽署或簽後更正中的文件沒有捨棄入口；監造看不到廠商文件的捨棄入口（反之亦然） | P3f #155 |
| A13 | 監造 → 品質查驗 `#/quality`「檢查表」分段 → 現場紀錄 `#/site` | 在「檢查表範本」卡按「新增範本」：用途選「監造查驗表單」、填標題與依據、在「適用工項」加入本案某個末端工項（或填關鍵字）、加一個實測值項目但先不填上下限按「建立範本」→ 補上下限再建立；接著上傳一張該工項的監造照片 | 沒填上下限時當場說「至少要有下限或上限才判定得了」且不會送出；建立後清單列出「監造查驗表單・第 1 版」與「指名工項：…」；起稿的查驗表單用到這張範本（理由寫「範本指名此工項」），查驗項目出現在表單裡；判定與本次確認數量仍然空白待監造親自填；廠商去同一張卡看不到「監造查驗表單」這個用途（只能建自主檢查表）；這張範本被查驗用過之後再編輯，畫面說明標題與項目不可改、只給「另存為新版本」 | P3g #161 |
| A14 | 廠商（或監造）→ 現場紀錄 `#/site` 上傳照片擬出草稿 → AI 主控台 `#/agent` | 在「AI 草稿收件匣」對那筆草稿按「拒絕」；另外把一份草稿先簽署，再回收件匣拒絕它那筆草稿 | 未簽署的那份：先出現確認框說明會一併捨棄哪一份草稿，確認後草稿消失、現場文書清單也不再列該份，畫面說明「已拒絕草稿，並捨棄 … 草稿（原因：AI 草稿遭拒絕）。版本與照片保留，可重新起稿」；已簽署那份：只標草稿已拒絕，文件保留並說明原因；按取消則兩邊都不變 | P3g #161 |

| A15 | 廠商 → 現場紀錄 `#/site` | 上傳一張**把紙本查驗／自主檢查表拍清楚**的照片（整張表在畫面裡、不要只拍半邊），擬出草稿後開對應的自主檢查表 | 紙上「實測值」欄已寫好的數字會出現在格子裡並標「待確認」，點欄位看得到原文與來源照片；紙上「設計值」欄的數字**不會**跑進實測欄；空白格、看不清楚的格子一律留空並標待補；卡尺特寫、黑白板、一般施工照不會觸發這段（也不會因此多花錢）。若平台管理把 AI 功能「紙本查驗表逐格辨識」關掉，起稿照常完成，只是紙上實測值多半留空 | B2 包 |
| A16 | 廠商 → 任一頁（側欄、底欄、頁內「尋找功能」、`#/site` 現場作業卡） | 把整個側欄與分頁列看過一遍，再從 `#/site` 的現場文書清單找監造的文件；最後把 `#/supervisor-log` 與 `#/inspection-form` 直接貼進網址列 | **廠商看不到監造日誌與監造查驗表單入口**，側欄只剩今日工作＋現場紀錄（現場總覽／施工日誌／自主檢查表／品質查驗）／履約時程／估驗請款＋文件往來／專案；工安、S 曲線、月報、跨案總覽都不再與三個主入口並列（停留點併回品質查驗）；現場文書清單只列自己的文件與已提送給自己的；直接貼網址仍按原權限**唯讀**打得開（查驗結果與可估驗依據沒有被關掉），但一格都不能編、也簽不下去。監造與機關的入口一項不少 | A 包 #163 |
| A17 | 廠商 → `#/site-log`、`#/self-check`；監造 → `#/inspection-form`、`#/supervisor-log` | 四頁各開一份自己的草稿，直接在紙上的格子裡打字、存檔；再用另一方的帳號開同一份 | 看到的就是原表本身、可直接在格子裡編輯：施工日誌＝工程會**附表四「公共工程施工日誌」**、自主檢查表＝臺北市新工處「施工自主檢查表」、監造查驗表單＝臺北市**「施工抽查紀錄表」**、監造日誌＝工程會**附表五「公共工程監造報表」（日報，不是監造月報）**；四張都標「示範範本／參考格式・未經機關核定」；不是自己負責的那張紙**一格都不能編**（廠商在監造兩張紙上全唯讀，反之亦然）；判定、本次確認數量、監造到場人員仍只有監造能填 | C 包 #168、C2 包 #170 |
| A18 | 任一方 → 八支列印頁（`#/site-log/print`、`#/self-check/print`、`#/inspection-form/print`、`#/supervisor-log/print`、`#/valuation/print`、`#/valuation/package`、`#/quality/checklist-print`、`#/contract/print`） | 各開一頁按「下載 PDF」；挑一份多頁的長表；再拿一份**已簽署**與一份**草稿**各下載一次；最後用手機 375 寬重做一次 | 按一下直接拿到 PDF 檔（不是開瀏覽器列印視窗）；檔名帶文件名、日期、版次與「已簽署」／「未簽署」；PDF 內文字可選取、不是截圖；多頁自動換頁、表格跨頁重印表頭、每頁印「第 n 頁／共 m 頁」；已簽署的印簽署列指向的那一版與簽署資訊，草稿整張標「草稿・未簽署」；**手機下載到的版面與桌機同一份**（欄名不折行）；字型或附件照片抓不到時會明白說失敗、不會給你一份缺東西的 PDF。「列印」鈕仍在、但不再自稱下載 | D 包 #166／#167 |

**A17 的四份原表要對照時看哪裡**：逐格對照表在 [official-form-mapping](../architecture/official-form-mapping.md)（§1 施工日誌／§2 自主檢查表／§3 監造查驗紀錄表／§4 監造報表／§5 四份共同規則）；原始表單檔在 [assets/2026-09-20-contractor-acceptance](assets/2026-09-20-contractor-acceptance/)——工程會附表四 `pcc-daily-log-1080430.pdf`、附表五 `pcc-supervisor-log-1080430.pdf`、臺北市自主檢查表 `taipei-rebar-self-check-example.odt`、臺北市施工抽查紀錄表 `taipei-rebar-inspection-example.odt`。四張都標「參考格式・未經機關核定」，實案範本提供前一律是示範範本（§6 Q11）。

### 8.2 監造確認量與估驗

| 編號 | 誰 → 在哪裡 | 做什麼 | 預期看到 | 對應 |
|---|---|---|---|---|
| B1 | 廠商 → 估驗請款 `#/valuation` | A8 已申報 100、監造還沒簽署時，按「＋ 新增估驗期」（計價截止日必填，填今天），看該工項 | 該工項可估驗 0；申報 100 只作差異比對，標「缺監造確認來源・申報,不計價」，不進可請款金額 | P4b #138、P4c #144 |
| B2 | 監造 → `#/inspection-form`；廠商 → `#/valuation` | 監造把 A8 判「部分合格」、確認數量 60 並簽署；廠商按「同步確認量」 | 該工項本期可估驗 60，其餘 40 不能請；來源展開看得到批次、位置、確認量 60、查驗與文件版本、確認人與時間；不用另外抄數量 | P3c #148、P4c #144 |
| B3 | 廠商 → `#/valuation` | 把該工項累計量改填 100 | 被拒絕，訊息列出前期累計、上限、可用量（數字沒有 `.0000` 尾巴），輸入框回到 60 | P4b #138、P4c #144、P4d #147 |
| B4 | 監造 → `#/inspection-form`、`#/valuation` | 在已簽署的查驗表單建立更正版本，確認數量改 70 後簽署 → 預期被拒；改走撤銷：`#/valuation` 選該期 → 工項來源展開「撤銷確認」（原因必填）→ 回查驗表單重新簽署 70；廠商再按「同步確認量」 | 沒撤銷就改量會被伺服器拒簽；撤銷後重簽 70，廠商同步後可估驗 70；舊確認紀錄保留並標已撤銷 | P3c #148、P4d #147 |
| B5 | 廠商 → `#/valuation`；監造 → `#/valuation`；機關 → 請款收款 `#/payments` | 廠商「送監造審核」→ 監造「核定估驗」→ 機關在該期填「請款日」 | 有缺件時送審前就在「缺件與檢核」卡列出原因與處理入口；核定前請款日欄位鎖住；核定後才可登錄；核定不等於已付款 | P4b #138、P4c #144 |
| B6 | 監造 → `#/valuation`（已核定期）；機關 → `#/valuation`、`#/payments` | 監造在已核定期的來源展開「撤銷確認」；機關試著登錄請款日 → 在「估驗調整(扣回)」卡按「作廢(接受已計價)」→ 再登錄請款日 | 有待處理扣回時請款日被擋並說明原因；扣回卡三方都看得到、只有機關能作廢；作廢後可登錄（或改由廠商在下一期草稿「同步確認量」併入扣回）；今日工作與早報出現「待機關處理扣回」 | P4d #147 |
| B7 | 監造 → 今日工作 `#/dashboard`「待監造補證」→ `#/valuation`；機關 → `#/payments` | **正式庫 4 個歷史遷移期別**（實案資料，請由實際監造判斷後操作）：選該期 → 缺件卡「展開 1 列」→ 來源展開「補證此期」→ 填批次／位置與依據（累計量預填遷移量）→「簽發並補證第 N 期」；機關再登錄請款日 | 補證前請款日被擋；補證後缺件清空，機關可登錄；早報與 Agent 的「待監造補證」隨之消失 | P4b #138、P4d #147 |
| B8 | 監造 → `#/valuation` 明細 | 看總價／間接費類工項（利潤及管理費、營業稅等） | 缺計價依據時標「計價依據待設定」且不計價（Q3 暫時隔離） | P4b #138、P4c #144 |
| B9 | 監造 → 品質查驗 `#/quality`「查驗」分段；廠商 → `#/valuation` | 找一筆舊流程「快速判定」留下的查驗（本次確認數量欄標「舊流程快速判定，未填確認數量」），按「以查驗表單更正判定（補確認數量）」→ 在表單填申報量、判定與本次確認數量 → 簽署；廠商回估驗頁按「同步確認量」 | 舊查驗補上正式判定與確認量、指向這份簽署文件，舊紀錄本身仍在清單查得到；廠商這才拿得到那一筆的可估驗量；已經有查驗表單的查驗不會出現這個入口（改在該文件建新版本），廠商也看不到這個入口 | P3g #161 |

### 8.2.1 月報與估驗佐證包（P6a）

| 編號 | 誰 → 在哪裡 | 做什麼 | 預期看到 | 對應 |
|---|---|---|---|---|
| M1 | 廠商 → 文件往來 → 施工月報 `#/monthly-report`（或 `#/site`「本月文件」） | A3 簽署兩天的日誌後，另存一天不簽署；選本月 | 「本月完成主要工項數量」、施工天數、雨天、出工只算已簽署兩天；每天一列並附「文件 xxxxxxxx vN・雜湊 12 碼」（目前列印版本可點到列印頁）；未簽署那天列在「未簽署、不列入」；進度／估驗／收款三段數字與改版前相同（D-024） | P6a #153 |
| M2 | 監造 → 文件往來 → 監造月報 `#/supervisor-report` | A7 簽署監造日誌、A8／B2 簽署查驗表單後，選本月 | 頁名「監造月報」；列已簽署監造日誌（到場人員、版本）、經簽署查驗表單的判定與「申報／確認」量、本月監造確認紀錄（+60，附表單版本）；未簽署的監造日誌與未經表單的快速判定明列不列入；施工天數與施工月報同月一致；意見草稿只寫已簽署文件的數字 | P6a #153 |
| M3 | 廠商 → `#/valuation` 選 B2 那期 → 「組請款佐證包」 | 看「本期確認來源與簽署文件版本」與照片、施工日誌附件；送監造審核後，再把其中一天日誌更正重簽，重開佐證包 | 每筆數量追到批次、查驗表單版本與雜湊、簽署者與時間、檢附自主檢查；照片只有查驗表單附上的證據照；有缺件的工項標「缺件：…」；送審後的更正不改變佐證包（仍是送審當時的版本，旁註「之後另有 vN」） | P6a #153 |
| M4 | 任何人 → Demo 站 `demo.gov-agent.ai` → 施工月報／監造月報／`#/valuation` 第 5 期「組請款佐證包」 | 不必登入正式專案，直接看三張報表（監造月報要用監造帳號「王建國」） | 三張都有內容：施工月報 7 天已簽署日誌（最新一天列「未簽署、不列入」）、判定 1 合格 1 不合格＋1 件「未經簽署查驗表單、不列入」；監造月報有 3 份已簽署監造日誌與監造確認量；佐證包「依據」欄逐項「監造確認 N」、一筆走查驗表單（附版本、雜湊、簽署者、檢附自主檢查），並夾附本期已簽署施工日誌。**每一個版本標示都冠「【示範資料】」、簽署者標「（示範資料）」、佐證包頁首另有示範資料說明** | O2 |
| M5 | 廠商 → Demo 站 `#/valuation/package?p=…` → 工具列「重新產生施工說明」（若 AI 呼叫失敗） | 觀察失敗時的呈現 | 顯示可理解的錯誤訊息與「可按上方『重新產生施工說明』重試，或直接在下方說明欄自行撰寫」，不再靜默留白 | O2 |

### 8.3 今日工作／履約時程／早報

| 編號 | 誰 → 在哪裡 | 做什麼 | 預期看到 | 對應 |
|---|---|---|---|---|
| C1 | 三方各自 → 今日工作 `#/dashboard`、履約時程 `#/requirements`、Agent `#/agent`，隔天 08:00 後看早報信 | 挑一件逾期或 7 日內到期的事項，比對三處 | 工作內容、責任方、到期日與依據一致；早報只列逾期或 7 日內到期，連結落在 Agent | P5a #120、P5d #140 |
| C2 | 任一方 → `#/requirements`「待補設定」下拉 | 依序選「責任方」「循環規則」，點每筆的處理入口（導到擷取審核 `#/requirements/review`），補上責任方或每月幾日 | 補之前：正式庫**責任不明 7 筆**（三方都不能標記，首頁一張「待補設定」卡）、**循環規則不完整 5 筆**（不產生期次）；補完後該筆離開待補清單、循環義務開始產生期次；責任不明不會被預設丟給廠商 | P5a #120、P5b #125、P5d #140 |
| C3 | 責任方 → `#/requirements` 或期限追蹤 `#/deadlines` 的期次區 | 把循環義務本期標記完成（可掛佐證），再試一次「退回待辦」 | 只有本期變完成，下一期和未結的舊期仍在；舊逾期不因本期完成而消失；完成時間由伺服器記錄 | P5b #125、P5d #140 |
| C4 | 有權者 → `#/requirements` 履約期程的基準日卡 | 改開工日或登錄展延（填類別、依據函文、生效日） | 留下新版本；已處理過的期次不被改寫、未動的待辦期依新基準重算；詳情「依據」列寫出第 N 版基準日 | P5c #134 |
| C5 | 專案管理者 → `#/requirements` 履約期程卡「保固期滿日與依據」；機關 → 驗收 `#/acceptance` | 用測試案：先確認已有一條保固類每月義務與一條寫明保固期間的已確認契約重點；在期程卡「登錄」契約保固期間（數值＋單位、引用那條條文）；機關登錄正式驗收合格；回履約時程看該保固事項 | 兩項齊全前：卡上「保固期滿日待補（缺…）」，保固事項列「停止條件待補」並給入口（驗收頁／履約期程卡）、沒有期次；齊全後：卡上「保固期滿 YYYY-MM-DD」與兩項依據（驗收紀錄、條文），期次從合格日後第一期起、只到期滿日所在期；更正保固期間留新版本、已完成的期不動；監造／廠商（非管理者）看得到同一份依據但沒有登錄按鈕 | P5e #156 |

### 8.4 退場頁

| 編號 | 誰 → 在哪裡 | 做什麼 | 預期看到 | 對應 |
|---|---|---|---|---|
| D1 | 廠商 → 直接開 `#/cost`（側欄已沒有入口）；監造、機關開同一網址 | 瀏覽、按匯出 CSV、找新增／修改鈕 | 唯讀，可匯出 CSV，沒有新增、修改、刪除；監造和機關被擋 | P1b #113 |
| D2 | 任一方 → 專案 → 跨案總覽 `#/portfolio` | 瀏覽 | 只剩選案清單與必要待辦，沒有分析儀表板 | P1b #113 |
| D3 | 機關 → 直接開 `#/audit` | 瀏覽 | 唯讀查閱並指向估驗頁；沒有 AI 稽核意見按鈕；本期勾稽檢核在估驗頁「缺件與檢核」卡 | P1b #113、P6c #141 |
| D4 | 廠商 → 舊連結 `#/schedule` | 開啟舊書籤或舊信件裡的連結 | 頁面仍可開，唯讀歷史查閱與 CSV 匯出，並指向履約時程；關鍵工項的計畫起迄在履約時程時間軸 | P5d #140 |

### 8.5 登入與權限

| 編號 | 誰 → 在哪裡 | 做什麼 | 預期看到 | 對應 |
|---|---|---|---|---|
| E1 | 三方 → `#/login` | 登入，並簽署任一文件 | 全程不要求驗證碼、不要求綁定驗證器 | R1 #128 |
| E2 | 未登入（無痕視窗）→ 直接開 `#/valuation`、`#/site` 等深連結 | 開啟 | 被導到登入頁，看不到任何專案資料（資料庫層訪客零權限由 pgTAP 驗證） | H2／H3 #129 |

### 8.6 模型品質（需使用者提供樣本）

| 編號 | 誰 | 做什麼 | 預期看到 | 對應 |
|---|---|---|---|---|
| F1 | 使用者提供 → 代理建預期答案後比對 | 提供真實現場照片：清晰（含告示板或量測）、模糊、非現場、混合日期／位置／工項各數張 | 清晰量測可轉錄；模糊看不見的量保留空白；非現場照不捏造施工；混合照分開或標待補。**目前只以固定回傳的 stub 驗流程，辨識準確度未驗** | P7b |
| F2 | 使用者提供 → 代理標註後比對 | 提供真實或授權去識別的契約（含掃描頁） | 列出抽取遺漏與錯誤，不以「完成」代表正確；掃描／無文字頁如實揭露並可人工補登（Q8 不採付費 OCR） | P7b、Q9 |

### 8.7 已知未做或待決（不是本輪驗收項目）

| 編號 | 項目 | 現況 | 下一步 |
|---|---|---|---|
| G1 | 文件草稿捨棄（P3f） | **已做（PR #155，`20260920021000`，2026-09-20 使用者已套正式）**：四類文書頁與 `/site` 清單可捨棄從未簽署／未提送的草稿（原因必填、版本保留、AI 草稿退回、稽核帶原因），捨棄後同一目標可重新起稿 | 驗收 A12 |
| G2 | P4e 封鎖估驗明細直接寫入 | **已做（PR #151，`20260920001500`；正式套用見 CURRENT §6.3）**：舊客戶端直接寫 `valuation_items` 一律被拒（42501）；正式庫遺留的 legacy 草稿明細仍標「申報未確認・不計價」、送審被擋，按「同步確認量」即以確認量為準 | 若仍開著 P4c 之前的舊分頁，寫估驗會看到「操作未完成…（代碼 42501）」，重新整理即可 |
| G3 | P6a 施工月報重用 | **已做（PR #153）**：月報與佐證包只彙整已簽署版本與監造確認量；Demo 站另由 O2 補示範用的已簽署版本與確認量，三張報表在 demo 也看得到內容（全標「【示範資料】」） | 驗收 M1–M5 |
| G4 | P6b 退場清理 | **已做（P6b-1 #154、P6b-2 #157、P6b-3 #158；兩個留尾由 P3g #161 補完：舊快速判定查驗的更正入口、拒絕 AI 草稿時一併捨棄草稿文件）**：退場頁 `/schedule`、`/audit` 移除並依原權限導向；三支退場 Edge 原始碼移除、線上 `audit-summary` 已下架；Agent 日誌／自檢草稿改產生現場文書草稿；品質查驗快速判定與檢查表直接登錄退場、DB 收回直接寫入（`20260920030000`，正式套用待使用者 `db push`） | `assistant-chat`／`parse-contract` 線上函式下架待使用者授權 |
| G5 | 監造查驗範本建立介面 | **已做（P3g #161，`20260920050000`）**：品質查驗「檢查表」分段可建立／編輯兩種用途的範本（用途、適用工項／關鍵字、查驗階段、檢查項目），伺服器編版本並擋下已被引用範本的內容變更；適用條件真的參與照片起稿與 Agent 起稿的候選推斷（指名工項是硬條件，分不出來仍標待人指定） | 驗收 A13 |
| G11 | 示範模式的簽署 | **不變（刻意）**：示範模式沒有伺服器，使用者按簽署仍一律回「示範模式無法簽署／提送」。O2 補的是種子帶進來的示範已簽署版本（全部標「【示範資料】」），只為讓月報／佐證包在 Demo 站演得出內容 | 無 |
| G6 | 保固類循環義務 | **待決**：保固期滿日沒有資料來源，保固類不產生期次、列「停止條件待補」 | 使用者決定保固年限在哪裡登錄 |
| G7 | iPhone 實機 | **未驗**：只在瀏覽器 375 寬度驗過 | 使用者做 A9 時用實機 |
| G8 | 關閉 TOTP 設定 | **已查證、結案**：主 session 2026-09-20 在正式 Supabase Dashboard 查證 Auth 的 TOTP 本來就是 Disabled，未做任何變更（正式 `auth.mfa_factors` 0 列） | 無 |
| G9 | 更換 `ANTHROPIC_API_KEY` | **建議**：本機 E2E 用的金鑰曾出現在代理工具輸出（未外傳） | 使用者換新金鑰，並更新所有用到同一把金鑰的位置 |
| G10 | P7a 真後端三方完整旅程自動化、P7c staging 回復演練 | **未做** | 依 §5 |
| G12 | 「完全沒有頻率／完全沒有觸發點」不列待補 | **已做（F1 #173，`20260920214557`）**：第六種待補設定 `timing`（時點待補）——指定日期未填／觸發點每月缺頻率／有期限缺起算事件／期限型無時點四種缺法各說缺什麼，導擷取審核廢止取代後補登；共用規則 `timingGap` 與 DB `fn_obligation_timing_gap` 同口徑（pgTAP 對共用案例逐條同句、Vitest 核對兩邊同一組），今日工作／履約時程／期限追蹤／Agent／早報同一句；非期限型無時點與觸發點「其他」不是缺口，詳情改說「依條件／依事件觸發」。`obligationTimeline.test.js:352` 改釘新行為。真後端 chain19 驗到「補齊後恢復逐期追蹤」 | 正式站登入後目視（§8.7 G18 同批） |
| G13 | 改期／取消／逾期的真後端端到端 | **未測**（功能已完成，只是沒有 e2e）：真後端沒有「改基準日 → rescheduled 文案與新到期日」「廢止取代 → 義務與期次變不適用」「逾期」三條；`transition_obligation_period` 的拒絕路徑與保固「引用條文失效／合格日撤銷 → 回到待補並收回期次」只有 pgTAP；監造「到期前看到契約重點待辦」無 e2e | 未指派，排 P7a |
| G14 | `send-reminders` 零測試 | **未做**：190 行、含角色分流，完全沒有測試（真後端也不跑，因為會寄信） | 未指派；要測須先有不寄信的注入點 |
| G15 | Edge 執行期寫入封堵只有靜態掃描 | **未做**：只有原始碼掃描 `valuationWrites.scan.test.ts`，沒有「Edge 以 service role 實際寫入被 DB 拒絕」的 runtime 測試；「照片日期不得改變契約期限」結構上成立但沒有負向測試或靜態掃描釘住 | **F2（worktree `-slimming-3`）正在處理** |
| G16 | 標單重匯 vs active 確認、併發情境的測試案例 | **未做**：標單重匯與 active 確認的互斥在 `boq_reset_import.sql` 與 chain 4 都沒有案例（只有 `confirmed_quantity_enforcement.sql` 一條）；兩個監造同時 `issue_supervisor_certificate`、「trigger 自動分配 vs 廠商手動 sync」同時發生、多個草稿期並存取 `period_no` 最小者（`fn_cq_target_draft_internal`）都沒有情境 | F2 可能一併涵蓋一部分（以 F2 回報為準），其餘未指派 |
| G17 | 紙本抄錄的端到端未測 | **未測**：B2 只驗共用呼叫函式、切塊與純規則＋真實模型逐張回歸；「上傳紙表照片 → 起稿 → 存檔 → 逐項確認 → 簽署 → 提送」整條真後端鏈本輪沒跑（B2 自己列為屬 E 包，E 包也沒做）。另外抄錄率 7–8/8 不是 100% 穩定、分欄界線偏移值只量自三張真實紙表 | 未指派；使用者可用 A15＋A6 手動驗一次 |
| G18 | 正式站（登入後）的 UI 與下載 PDF | **未測**：A–E／B2／C2 的前端都已隨 main 上線、`check:prod` 五頁 OK，但**登入後的實際畫面與 PDF 只在 demo 站與本機驗過**（O3 在 demo 站實測四份紙本表單、廠商導覽與下載 PDF）。正式 migration 與 Edge 已套用並由 O3 核對 | 使用者依 A16／A17／A18 在正式站逐項驗 |

## 9. 廠商驗收修正（2026-09-20）

依據（本輪由 A 包進版控，內容未改）：[驗收報告](2026-09-20-contractor-acceptance-report.md)、[實作指令](2026-09-20-claude-contractor-fixes-prompt.md)、[公開範本與真實辨識基準](assets/2026-09-20-contractor-acceptance/)。受驗基準 `f99bfee`。五張現場回歸照片（`LI*.JPG`）刻意不進版控（真實現場照、含可識別資訊），回歸測試讀本機路徑、缺檔時 skip。

模型：Fable 5.1 週額度用盡（9/26 台北 00:00 重置），使用者 2026-09-20 授權高風險單元暫由 Opus 5 執行，驗證標準不降。

### 工作包

| 包 | 範圍 | 指定 | 實際 |
|---|---|---|---|
| A | 廠商角色與三個主入口（本節已完成，PR #163、merge `e3e4f65`） | fable5.1 | Opus 5（暫代 Fable 5.1） |
| B | 照片辨識與 AI 填表（Edge `_shared/sitePhotoVision.ts`／`fieldDocDraft.ts`；本節已完成，PR #164、merge `a575bbc`、migration `20260920120000` 已套正式、四支 Edge 已重佈） | fable5.1 | Opus 5（暫代 Fable 5.1） |
| B2 | 紙本查驗表逐格辨識（B 的續作：紙表區域偵測＋逐欄裁切＋逐格兩次辨識；新 AI 功能 `paperform.cells`；本節已完成，PR #169、merge `ba7a97b`、migration `20260920160000` 已套正式、四支 Edge 已重佈） | fable5.1 | Opus 5（暫代 Fable 5.1） |
| C | 真實表單 mapping、直接在紙本版面編輯（施工日誌＋自主檢查表，PR #168、merge `bdbf4ae`） | fable5.1 | Opus 5（暫代 Fable 5.1） |
| C2 | 同上的後半：監造查驗紀錄表＋監造報表（附表五）的 mapping 與可編輯版面（本節已完成，PR #170、merge `d161545`） | fable5.1 | Opus 5（暫代 Fable 5.1） |
| D | PDF 交付（真正的下載，不是 `window.print()`；本節已完成，PR #166、merge `2350f16`；手機字級修正 PR #167、merge `ae3b8d6`） | fable5.1 | Opus 5（暫代 Fable 5.1） |
| E | 三項核心的整條流程驗收（真後端；本節已完成，PR #171、merge `388daa4`、migration `20260920170000` 已套正式） | fable5.1 | Opus 5（暫代 Fable 5.1） |
| O3 | Demo 站重佈＋文件同步＋驗收清單更新（本節已完成，見 §9 O3） | opus5 | Opus 5 |
| F1 | 「完全缺頻率／完全缺觸發點不列待補」（§8.7 G12）＋「照片日期不得改變契約期限」的防回歸掃描（§8.7 G15 的靜態掃描半邊）；本節已完成，PR #173、migration `20260920214557` | fable5.1 | Fable 5.1 |
| F2 | 補完 E 包列為「未測」的真後端與 Edge 驗證：逾期／改期／取消／已完成端到端、`send-reminders` 零測試、Edge 憑證 runtime 封堵、標單重匯 vs active 確認、紙本抄錄→草稿、chain 3 紅燈判讀；查出並封住服務憑證可憑空寫確認量／改期別狀態／寫計價依據的三個守衛缺口（migration `20260920230000`）；本節見 §9 F2 | fable5.1 | Fable 5.1 |
| F2 | Edge 執行期寫入封堵的 runtime 測試（§8.7 G15）；worktree `-slimming-3` | — | 進行中 |

### A 廠商角色與三個主入口

問題：`navConfig.js` 把監造日誌與監造查驗表單列成不限角色的現場紀錄子頁、`Site.jsx` 手抄一份現場作業入口並把三方文書混在同一張「現場文書」清單，`navConfig.test.js` 的廠商斷言還把這兩項當預期功能——廠商看不出哪些是自己要填的；同時工安、試體、停留點、S 曲線、月報、跨案總覽與三個主入口並列。目標：廠商的側欄、分頁列、現場作業卡、尋找功能與現場文書清單都只剩廠商自己的作業；監造端能力一項不縮；查驗結果與可估驗依據仍可唯讀查閱。不做：不動 `roles`、RLS、RPC 與任何 migration；不刪頁面、資料表、提醒與歷史；不改名充數。影響：純前端導覽與清單呈現；`routeAllowed` 與伺服器邊界一字不變。驗收：一般廠商帳號（含專案 admin／`can.override` 情境）的首頁／側欄／分頁／新增選單沒有監造作業入口；仍能提出查驗申請、收到判定結果、開啟計價證據；不能簽署監造文件（既有 pgTAP 已釘住）。

做法（根本解：把「導覽可見性」與「授權」分成兩個維度，不用 `roles` 收、也不在頁面寫第二份清單）：

- `navConfig.js` 新增 `hiddenFor: ['contractor']`（只對列名的 `org_type` 不渲染；`routeAllowed` 完全不讀它）。`/supervisor-log`、`/inspection-form` 用它收起廠商的入口——用 `roles` 收會連廠商該有的唯讀查閱一起關掉，正是驗收明文禁止的「誤刪查驗結果與計價依據」。`hiddenFor` 刻意不吃 `override`：驗收要求專案 admin 情境的廠商也看不到，而 `override` 對 `roles` 一律放行。
- 先收起獨立入口（沿用 `/cost` 的退場做法 `hidden: true`，頁面、資料、提醒與深連結都不動）：`/itp` 檢驗停留點（入口嵌回品質查驗的查驗分段，列本案停留點數與未申請／待查驗件數）、`/safety` 工安管理、`/progress` 進度 S 曲線、`/monthly-report`＋`/supervisor-report` 兩張月報、`/portfolio` 跨案總覽（選案改走頁首既有的專案切換器）。缺失補正與試體本來就在品質查驗的分段內，只是移除與查驗並列的卡片。
- `Site.jsx` 的「現場作業」卡改由 `visibleNavGroups` 的現場紀錄子頁產生（連結、圖示與件數章留在頁面，入口清單不再手抄第二份）；「現場待辦」刻意仍用群組定義＋`routeAllowed` 過濾，入口收起不等於提醒消失。「本月文件」卡隨月報入口一起收起。
- 「現場文書」清單新增純函式 `fieldDocs.fieldDocInWorkList(doc, viewerOrg)`：責任方（`owner_org`）的文件一律列；他方的文件只有 `submitted`／`received` 且自己是 `docToOrgs` 收件方才列。廠商因此看不到監造起稿中的監造日誌與查驗表單，監造一提送查驗表單廠商立刻看得到（查驗結果與可估驗依據不受影響）。

廠商實際看得到的入口（demo `contractor`，已由 e2e 釘住）：今日工作（現在輪到我／等待對方／今天已完成）→ 現場紀錄（現場總覽、施工日誌、自主檢查表、品質查驗）、履約時程（契約重點、期限追蹤、擷取審核、變更設計、驗收結算）、估驗請款（估驗計價、請款收款、標單工項）→ 文件往來（送審文件、工程疑義）、專案（專案文件、三方成員、活動紀錄）。監造維持：現場總覽、施工日誌、**監造日誌**、自主檢查表、**監造查驗表單**、品質查驗，加履約時程與估驗（不經手請款）；機關同監造再加請款收款。

「不能簽署監造文件」不新增 DB 變更，由既有 pgTAP 證明：`supabase/tests/inspection_form_documents.sql`（廠商不能建監造查驗表單 → PD006；廠商簽 → PD006；**正式模式的廠商 admin 也不能簽**）、`supabase/tests/supervisor_logs.sql`（廠商簽／編輯監造日誌 → PD006）。

### A 待辦與對後續包的影響

- 導覽群組名維持「現場紀錄／履約時程／估驗請款」，與實作指令說的「AI 文件／契約期程／估驗請款」三件事 1:1 對應；本輪不改名（名稱在 `navConfig` 單一來源，改名會牽動大量測試與文件，且報告的落差是「並列模組太多」不是群組名）。若使用者要改名，另開單元。
- 收起的入口都只是 `hidden`，資料表、RPC、提醒與深連結全部保留；要恢復只需拿掉一個旗標。
- B 包動 Edge `_shared/sitePhotoVision.ts`／`fieldDocDraft.ts`，與本包無重疊檔案。

### B 真正的照片辨識與 AI 填表

| 項目 | 內容 |
|---|---|
| 問題 | `_shared/sitePhotoVision.ts` 的轉錄只認黑白板、schema 只有「當日完成數量」，承不住設計值／實測值／兩向尺寸；`fieldDocDraft.ts:1083–1113` 把自檢實測值一律清空、只給提示；`fieldDocDraft.ts:519–524,557–565` 數量帶入工項時**完全沒有比對單位**；`fieldDocDraftRun.ts:444` 以 `has_board` 決定要不要轉錄。四條 2026-09-20 以 `f99bfee` 逐一驗證仍成立。真實模型基準另指出三張紙表都出現錯讀（`location="11F"` 由線徑 11 猜出、憑空的公司名、「綁紮完成」這種照片無法判定的斷言）。 |
| 目標 | 分層辨識（場景可辨識 vs 文字／讀數可辨識）；轉錄支援紙本查驗表與黑白板；**設計／規範要求、已記錄實測值、當日施工數量分成不同欄位**，兩向尺寸與單位原樣保留；紙上看得清的日期與實測紀錄直接填進草稿並標待確認；單位檢核走確定性規則；沒有原文證據的結果不得落地。 |
| 不做 | 不換產品呼叫的模型（維持 `claude-haiku-4-5-20251001`）；不加付費 OCR；不做紙本版面編輯（C 包）與 PDF 下載（D 包）；不放寬「判定、確認數量、監造到場只能人填」。 |
| 影響 | Edge `_shared`（`sitePhotoVision`／`fieldDocDraft`／`fieldDocDraftRun`／新 `measureUnits`）、`draft-field-documents`／`read-whiteboard`／`classify-site-photo` 三支函式、migration `20260920120000_measured_from_record`（只改框架範本 `item_rules.num.human_only`）、前端檢查項目表與來源章文案。 |
| 驗收 | 見下方「驗證與真實模型回歸」。紅線由測試釘住：設計值不得變實測、空欄不得變 0、尺寸不得變完成量、單位不相容不得帶入、無原文證據不得落地、重跑不得覆寫人工值或已簽版本。 |

**實際做了什麼（行為層面）**

1. **分類分兩層**：`legible`（場景）與新 `text_legible`（文字／量具讀數可逐字抄錄）分開；看得到鋼筋不等於讀得出卡尺。`text_legible=false` 就不做第二階段轉錄。新增 `record_medium`（紙本表單／黑白板／無），`has_board` 語意擴大為「有可讀的書面紀錄」。
2. **轉錄結構化分離**：新增 `observations[]`（`kind=design|measured`、`entry_no`、`raw_text` 原文、`value`／`value2` 兩向尺寸、`unit`、`comparator`、`location`），`items[]` 仍只放當日完成數量。兩個陣列互不相通，**尺寸永遠變不成完成量**。caption 不再負責抄板上數據（那正是逼模型亂猜的來源）。
3. **確定性後檢**（不是再加一句 prompt 禁令）：帶 `≥`／`≤` 的觀察一律改列設計值；空欄佔位（`*`、`—`）與數值沒出現在 `raw_text` 的整筆丟掉；`caption`／`visible_progress` 出現「完成／合格／就位」等照片無法判定的斷言就清掉並記 `dropped`；`location` 沒有原文出處（`location_text`）或與原文不符就不採用。
4. **第二階段來源核對**：紙本表單再轉錄一次，只留兩次一致的格子（`agreeRecords`），不一致就留空。手寫誤讀時模型連 `raw_text` 一起錯，自證的證據擋不住系統性誤讀——但誤讀不穩定。代價是紙表照片轉錄 token 加倍（黑白板與一般施工照不做）。
5. **實測值可抄錄（改舊設計）**：紙上實測欄已寫好的數字，在**工項、欄位意義、單位三者都唯一對應**時抄進 `results.<no>` 並標 `filled`＋`source:'record:<photo_id>'`＋逐欄 `evidence`（原文、編號、單位、來源照片）。帶不進來的一律 `pending`＋原文提示：兩向尺寸（不截半）、不同編號（不合併）、單位不相容或沒寫單位、多張照片值不一致（列衝突、各自保留來源）。同一份紀錄被拍多張依（編號, 原文, 值）去重，**不累加**。
6. **單位檢核**（新 `measureUnits.ts`）：施工日誌把告示板數量帶進工項前，先與標單單位比對——相同或同量綱（長度／面積／體積／質量／時間）依固定係數換算並把換算過程寫進來源說明；沒寫單位、不相容、認不得的單位一律 `pending`＋列 recheck，**不忽略也不直接採用**。
7. **日期**：民國年由系統確定性換算（`parseRecordDate`，`115.8.4` → `2026-08-04`），不交給模型；模型自己換算的結果不一致時以原文換算為準並記衝突。紙上日期 > 批次指定 > 照片時間的優先序與衝突揭露沿用。
8. **重辨識路徑**：`draft-field-documents` 收 `rerecognize_photo_ids`，使用者明確要求時已辨識的照片才重跑（不自動重跑＝不重複計費），且人填過的說明／位置不覆寫、已有人工版本仍只留建議、已簽署仍 locked。
9. **規則變更配套**（migration `20260920120000_measured_from_record`）：框架範本 `item_rules.num.human_only` true→false，`confirm_required` 維持 true——**只標 `filled` 仍是 `needs_confirmation`，人沒逐項確認就簽不下去**；判定、本次確認數量、監造到場維持只能人填。設計文件 `field-documents-lifecycle.md` §2.2／§2.3／§3.1 已同步。

**驗證與真實模型回歸**

| 驗證 | 結果 |
|---|---|
| `npm test` | 152 檔 1,677 項（rebase 到含 A 包的 main 後重跑；新增 `sitePhotoVision.test.ts` 19 項、`fieldDocDraftRun.test.ts` 重辨識 2 項；`fieldDocDraft`／`fieldDocDraftRun`／`fieldDocs`／`SelfCheck.document` 依新規則改寫斷言） |
| `npm run test:edge` | 9 項（新增 `measureUnits.deno.test.ts` 4 項） |
| `npm run check:edge` | 18 支 |
| `npm run lint`／`npm run build`／`npm run check:docs` | 皆綠；`check:docs` 57 檔 441 連結 0 錯 |
| `npm run test:db` | 從零套用：61 檔 3,586 通過、0 失敗（`self_check_documents` 127、`inspection_form_documents` 153） |
| 真實模型回歸（原圖／前端壓縮兩條件＋三個負例） | 27 次 API 全數成功，模型 `claude-haiku-4-5-20251001`，input 198,115／output 21,334 tokens；分類 2.3–3.5 s、紙表轉錄（兩次）12.3–16.6 s。結果見 [vision-after-b.json](assets/2026-09-20-contractor-acceptance/vision-after-b.json) |
| stub | `visionStub` 只證流程、不證辨識；與上列真實模型結果**分開記**，不可混為一談 |

**真實模型逐張前後對照（同一組五張原圖；基準＝[`vision-baseline.json`](assets/2026-09-20-contractor-acceptance/vision-baseline.json)）**

| 照片 | 修改前（基準） | 修改後 | 判定 |
|---|---|---|---|
| `LI2995~1_0.JPG` | caption 誤讀「#5、#4」「梯號U-36」「D20@20cm」；`visible_progress` 寫「鋼筋綁紮完成」；轉錄只有日期 | caption「以遊標卡尺量測鋼筋直徑，有查驗紀錄表」；無完成斷言；`record_medium=paper_form`、日期 2026-08-04；兩次一致的觀察 0 筆（不一致的 9 筆全部留空） | 錯讀與完成斷言已消除；**實測值未抄到**（留空待人填） |
| `LIFA1C~1_0.JPG` | caption 混讀「D13、D16、D29」「間距13、15 CM」；轉錄只有日期 | 無混讀；日期 2026-08-04；設計觀察 5 筆；**實測 1 筆＝編號 4 網目 15×15 CM（與人工標註相符）** | 唯一抄到正確實測值的一張 |
| `LINE_A~4_0.JPG` | caption 生出「訊光建設」「樓層11F」「2層密集配置」「綁紮完成」；**結構化 `location="11F"`** | 無公司名與樓層；分類仍讀出 `location='4-8-25m'`（誤讀）但**因轉錄讀不到位置欄而未採用**；設計觀察 4 筆（線徑 13×11／11×11 MM、網目 15×15 CM、搭接 ≥27 CM 皆正確歸設計值） | **P0「錯誤位置進入結構化欄位」已修**；實測值未抄到 |
| `LI89DE~1_0.JPG` | 正確辨識卡尺量測、未猜讀值；工項只回「鋼筋」 | 同樣未猜讀值，且 `text_legible=false` 明確標示讀數不可信、不進第二階段 | 維持正確並多一層明示 |
| `LIEE66~1_0.JPG` | 額外聲稱「木樁樁頂面可見」（畫面是木模板） | caption「以遊標卡尺量測鋼筋直徑」，無此描述 | 已修 |
| 負例 `neg-design-column-only`（由 `LINE_A` 裁切出設計值左欄） | — | 實測觀察 0 筆（兩次不一致全砍）；分類猜的 `location='4-4-25m'` 未採用 | 通過（第一版沒有第二階段時此例失敗，是加第二階段的直接原因） |
| 負例 `neg-illegible-caliper`（`LI89DE` 縮到刻度不可讀） | — | `legible=true`／`text_legible=false`，無讀數 | 通過 |
| 負例 `neg-formwork-no-record`（`LI2995` 裁切背景模板區） | — | 無書面紀錄、無位置、未沿用查驗內容 | 通過 |

**仍待人工補的欄位／限制（不得寫成已完成）**

- **紙本手寫實測值的抄錄率仍很低**：三張紙表、人工標註共約 8 個實測值，本輪只穩定抄到 1 個。其餘因兩次辨識不一致而留空。現在的行為是**「錯了會留空，不會填錯」**，不是「AI 幫你填好表」。要提高抄錄率需要更強的模型或紙表區域裁切後再辨識（本輪未做：Edge 沒有影像處理，且紅線是不換模型）。
- 設計值的抄錄本身也不穩定（同一張照片兩次辨識的設計觀察筆數 0–6 不等），只是不再污染實測欄。
- **位置欄仍可能抄錯**：轉錄讀到的位置（如把 `4-4-25M` 讀成 `H4-25m`）兩次一致時就會帶入草稿並標待確認。它有原文、有來源照片、要人確認，但**不是正確值**；簽署前人必須核對。
- 前端壓縮條件與原圖的差異落在單次執行變異之內（同一張在兩次執行中互有高低），**本輪樣本不足以判定壓縮是否影響辨識**；回歸用 `sips` 近似 canvas 的 JPEG 0.82，與瀏覽器實際輸出不完全相同，要下結論須以真實前端壓縮圖再驗。
- 「單位衝突」負例以確定性單元測試涵蓋（`measureUnits.deno.test.ts`），不是模型負例——無法在不造假的前提下拍出一張單位衝突的真實照片。
- 五張 JPG 依約定**不進版控**；回歸腳本只以本機路徑讀取，缺檔即 skip 並印出缺哪幾張。
- 未驗：完整網頁上傳→起稿→存檔→簽署→提送的真後端鏈（屬 E 包）；本輪只驗共用呼叫函式與純規則。

**發布結果（2026-09-20）**

PR #164、merge commit `a575bbc`（rebase 到含 A 包的 main `e3e4f65`；CI 與 pgTAP 兩個 run 皆 success 後才合併）。migration `20260920120000_measured_from_record` 以 `supabase db push` 套正式，`migration list --linked` 84 筆對齊、最新即本支、無待套；正式庫唯讀核對兩類框架範本的 `item_rules.num.human_only` 已為 false，而 `fn_field_document_human_only_keys` 對監造日誌仍回 `attendance`、對監造查驗表單仍回 `confirmed_qty`／`verdict`（安全網未被放寬）。Edge 以 `deno info` 查到模組圖含改動 `_shared` 的四支並以 `--use-api` 從 `a575bbc` 重佈：`agent-run` v23、`classify-site-photo` v13、`draft-field-documents` v12、`read-whiteboard` v17（`send-reminders` 未動、`verify_jwt=false` 維持）。前端隨 main 由 Workers Builds 自動建置，`check:prod` 五頁 OK；demo 站未重佈。

**對後續包的影響**

- C 包（紙本版面編輯）可直接用 `field_sources[key].evidence`（原文、編號、單位、來源照片）做「點欄位回看證據」，不需另建一套來源結構；`hint.raw_text` 是「帶不進來但紙上寫了什麼」的顯示來源。
- E 包（真後端整條鏈）要涵蓋：AI 抄錄的實測值只標 `filled` 時簽署必須被 `PD004 needs_confirmation` 擋下；以及 `rerecognize_photo_ids` 重辨識不得覆寫人工值或動到已簽版本（單元層已有測試，真後端未驗）。
- 若日後要提高手寫抄錄率，方向是紙表區域裁切後再辨識（Edge 目前沒有影像處理能力）或換更強的模型——後者是紅線，需使用者另行決定。

### B2 紙本查驗表逐格辨識（B 的續作）

| 項目 | 內容 |
|---|---|
| 問題 | B 包做完設計／實測分離、單位檢核、兩次一致才採用、無證據不落地之後，三張紙表、人工標註共 8 個手寫實測值**只穩定抄到 1 個**（[vision-after-b.json](assets/2026-09-20-contractor-acceptance/vision-after-b.json)）。根因不是模型不夠強，是**整張照片一次讀**：鋼筋背景＋左右併排的密集手寫表格，同一格連讀兩次會漂，而且左右欄混在一起——數字讀對了 `kind` 卻全掛在 design。2026-09-20 以現行程式重驗仍成立（`--no-cells` 對照組 3/8）。 |
| 目標 | 偵測紙表區域 → 依欄切成小塊 → **以原圖解析度**逐塊辨識；每塊只問一件事；`kind` 由該塊印刷的欄位標題決定而非幾何猜測；沿用 B 的兩次一致、量綱單位檢核、`≥` 歸設計值、空欄不填、無原文不落地。 |
| 不做 | 不換場景分類的模型（維持 `claude-haiku-4-5-20251001`）；不做紙本版面編輯（C 包）與 PDF（D 包）；不放寬「判定、確認數量、到場只能人填」；不加付費 OCR。 |
| 影響 | 新增 Edge `_shared/imageRaster.ts`（唯一 import npm 的影像層，`npm:jpeg-js@0.4.4`）、`paperFormLayout.ts`（確定性版面）、`paperFormCells.ts`（逐格 schema／prompt／後檢／流程）、`paperFormImaging.ts`（黏合）；改 `sitePhotoVision.ts`、`fieldDocDraftRun.ts`、`draft-field-documents/index.ts`、`visionStub.ts`、`scripts/vision-regression.ts`；新 AI 功能 `paperform.cells` 與 migration `20260920160000_ai_paperform_cells`。 |
| 驗收 | 同一組五張原圖逐欄比對，手寫實測值抄錄率須顯著提升且**不得**把設計值當實測；見下方對照表與 [vision-after-b2.json](assets/2026-09-20-contractor-acceptance/vision-after-b2.json)、[vision-b2-model-compare.json](assets/2026-09-20-contractor-acceptance/vision-b2-model-compare.json)。 |

**實際做了什麼（行為層面）**

1. **確定性紙表偵測**：`detectPaperRegion` 用「亮 + 低紋理 + 最大連通區」找紙張（工地背景再亮也有高頻紋理，紙面只有細格線與字）。三張真實紙表 IoU 0.72–0.82、覆蓋真實表單 94–99%、約 20 ms。面積佔畫面不到一成或連通區填不滿外框就回 `null` —— **偵測不到就不做逐格**，退回 B 的整張路徑。
2. **確定性切塊**：界線＝紙寬中點**往左偏 3%**（不是調參數：右欄的欄名「實測值:」緊貼分欄線右側，切在正中點會把它切掉；左欄的欄名貼在整張表最左邊，永遠切不到）。左右兩塊**互不重疊**，同一個畫素不可能同時被當成設計值與實測值。切塊全部是純算術、同一輸入永遠同一結果，每塊帶**原圖畫素座標**與整數倍放大倍率。
3. **kind 由印刷的欄位標題決定，不由幾何決定**：每塊要模型照抄它看到的欄名；固定對照表把「設計值／規範值／計值」判為 design、「實測值／查驗值／測值」判為 measured。看到兩個欄名（裁切跨欄）、看不到、不在表內 → **整塊作廢並記原因**；兩塊的 kind 相同 → 整張放棄逐格。所以切歪的代價是「讀不到、留空待人填」，不是「把設計值填進實測欄」。
4. **一次有界重試**：剛好只有一側讀不到自己的欄名時，把界線再左移到 7% 並**只重讀那一側一次**；仍讀不到就留空，不再往左試。三張裡有一張（`LI2995`，分欄線比中點左約 6%）靠這一步才讀到。
5. **兩條只在逐格路徑成立的後檢**：實測欄出現 `≥`／`≦` 一律**整筆丟掉**（不改列設計值——設計值的權威來源是設計欄那一塊）；設計欄的容許範圍列，數值一律由原文確定性解析「符號後面那個數」，不採用模型填的 `value`／`value2`（同一格兩次可能一次回 11 一次回 27，那是格式不穩不是讀不到）。另補一條：原文只寫一個數字卻回報兩向尺寸（「11 MM」膨脹成 11×11）整筆丟掉。
6. **來源可回溯**：每筆觀察帶 `source`＝{ 塊、欄名原文、原圖矩形、放大倍率、比對次數 }，點欄位回得到「這個數字是從照片哪個位置讀來的」。
7. **模型維持 haiku**：實測 `claude-sonnet-5` 在同一批裁切上**更差且更貴**（6/8 對 8/8、$0.085 對 $0.067 每張紙表），所以不換。使用者授權的「這一段可用更強模型」用不上——問題是切法不是模型。
8. **只在紙表觸發**：`record_medium='paper_form'` 且 `has_board` 才走；一般施工照、黑白板、量具特寫都不觸發。刻意**不**要求 `text_legible`：那是對整張照片的判斷，整張看起來字太小的紙表切成單欄放大後常常讀得清楚（回歸就有一張如此），拿被 B2 推翻的前提來否決切塊後的結果不合理。
9. **整張轉錄仍讀兩次**：曾試「逐格成功就整張只讀一次」省一次呼叫，實測打回票——整張那一支仍負責表頭，而表頭日期是手寫民國年，單讀一次出現過把 115 讀成 114、日期落成 2025-08-04。兩者各守各的欄位，不互相取代。

**成本與治理**

- 新 AI 功能 `paperform.cells`（vision 類、trial 起、預設開啟、`edge_function=draft-field-documents`），三處註冊鏡像＋`ai_features` seed（migration `20260920160000`，rollback 關開關不刪列）＋ pgTAP `ai_paperform_cells.sql` 9 項。Edge 內經 `askAiFeature` 問同一個 `ai_feature_allowed`、fail-closed，用量以自己的 `feature_key` 記；**關掉就退回 B 的整張兩次讀**，其他照片與其他 AI 功能完全不受影響，不會整批失敗。
- 用量上限（程式側，非約定）：每張照片最多 `MAX_TILES=4` 塊 × 2 次＝8 次呼叫，加最多一次重試 2 次；單次輸出上限 `CELL_MAX_TOKENS=900`；單塊放大後畫素上限 `TILE_MAX_PIXELS`；解碼畫素上限 `MAX_DECODE_PIXELS`。超過就停並回原因，不無上限展開。
- 實測成本（定價來源：Anthropic 官方定價表，claude-api skill「Current Models」，cached 2026-06-24；haiku $1.00/$5.00 per MTok、sonnet-5 $2.00/$10.00 per MTok）：

| 設定 | 8 個手寫實測值抄到幾個（原圖） | 每張紙表照片成本 | 每張紙表呼叫次數 | 每張紙表延遲 |
|---|---|---|---|---|
| B 包（已上線，基準 `vision-after-b.json`） | **1** | 未量 | 3 | 15–20 s |
| B2 `--no-cells` 對照組（＝B 行為，今日重跑） | 3 | $0.036 | 3 | 15–18 s |
| **B2 正式設定（逐格＝haiku）run 1** | **7** | $0.055 | 7 | 19–36 s |
| **B2 正式設定（逐格＝haiku）run 2** | **8** | $0.067 | 7–9 | 26–36 s |
| B2 逐格改用 `claude-sonnet-5` | 6 | $0.085 | 7–9 | 33–39 s |

  非紙表照片（卡尺特寫、無紙表）維持每張 1 次呼叫、$0.009，不受本包影響。

**真實模型逐張對照（同一組五張；原圖條件；人工標註 8 個手寫實測值）**

| 照片 | 人工標註的實測值 | B 包（修改前） | B2（修改後） | 判定 |
|---|---|---|---|---|
| `LINE_A~4_0.JPG` | 編號1 線徑 13×11 mm、網目 15×15 cm；編號4 線徑 11×11 mm、網目 15×15 cm | 實測 0 筆（設計 4 筆） | **實測 4 筆全對**，編號正確；設計欄另 4–6 筆；日期 2026-08-04 | 4/4 |
| `LI2995~1_0.JPG` | 編號4 線徑 11×11 mm、網目 15×15 cm | 實測 0 筆 | **實測 2 筆全對**（靠界線左移重試才讀到欄名） | 2/2 |
| `LIFA1C~1_0.JPG` | 編號4 線徑 11×11 mm、網目 15×15 cm | 實測 1 筆（網目） | run 1 實測 1 筆、run 2 實測 2 筆 | 1–2/2，**未達穩定** |
| `LI89DE~1_0.JPG`（卡尺特寫） | 無 | 無讀數 | 無紙表 → 不觸發逐格，維持無讀數 | 通過 |
| `LIEE66~1_0.JPG`（卡尺特寫） | 無 | 無讀數 | 同上 | 通過 |
| 負例 `neg-design-column-only` | 不得有任何實測 | 實測 0 筆 | 偵測不到紙張 → 不走逐格；整張路徑實測 0 筆 | 通過 |
| 負例 `neg-illegible-caliper` | 不得有讀數 | 通過 | `text_legible=false`、不觸發逐格、無讀數 | 通過 |
| 負例 `neg-formwork-no-record` | 不得有書面紀錄 | 通過 | 同上 | 通過 |

前端壓縮條件（`--mode=upload`，以 `sips` 近似）在 run 1 為 **8/8**；該條件下 `sips -Z 2000` 會把 1477 px 的原圖**放大**到 2000 px（前端 `imageCompress` 只縮不放），所以它不是忠實的「前端壓縮圖」，只能當作「同一張圖放大後」的另一組樣本看，不可拿來宣稱壓縮無害。

**驗證**

| 驗證 | 結果 |
|---|---|
| `npm test` | rebase 到含 C 包（PR #168）／D 包（PR #166）的 main 後重跑：159 檔 1,775 項（新增 `paperFormLayout.test.ts` 17 項、`paperFormCells.test.ts` 28 項；`fieldDocDraftRun.test.ts` 加 10 項逐格情境；`aiFeatures.test.js` 19 個功能） |
| `npm run test:edge` | 16 項（新增 `imageRaster.deno.test.ts` 7 項：解碼、夾邊界、裁切可重現、畫素上限、切塊互不重疊、無紙／非 JPEG／壞位元組回原因） |
| `npm run check:edge` | 18 支（`deno.lock` 新增 `npm:jpeg-js@0.4.4`，`--frozen` 通過） |
| `npm run lint`／`npm run build`／`npm run check:docs` | 皆綠；`check:docs` 58 檔 464 連結 0 錯（`npm install` 補上 D 包新增的 `pdf-lib` 後 build 才綠，與本包無關） |
| `npm run test:db` | 從零套用：62 檔 3,595 通過、0 失敗（新增 `ai_paperform_cells.sql` 9 項） |
| 真實模型回歸 | 四輪：正式設定 mode=both＋負例（51 次呼叫、$0.434）、正式設定 mode=original、`--no-cells` 對照、`--cells-model=claude-sonnet-5` 對照。結果檔見上。 |
| stub | `visionStub.stubPaperCells` 回空欄名＝整塊作廢，**stub 永遠不會生出實測值**；stub 與真實模型結果分開記。 |

**仍待人工補的欄位／限制（不得寫成已完成）**

- **抄錄率 1/8 → 7–8/8，但不是 100% 穩定**：`LIFA1C` 的編號4 線徑在兩輪中一輪讀到、一輪因兩次不一致而留空。留空是設計上的安全行為（不確定就不填），但要如實說：**AI 仍不保證把表抄完**。
- **界線偏移 3%／7% 是以三張真實紙表量出來的**，不是通則。換一種版面（分欄線離中點更遠、欄名不在欄位左上角）可能兩塊都讀不到欄名而整張退回 B 路徑——行為安全（留空）但抄錄率會掉回去。要更穩需要更多真實紙表樣本，本輪只有三張。
- **位置欄仍可能抄錯**（B 包既有限制未改）：轉錄讀到的位置兩次一致就會帶入草稿並標待確認，簽署前人必須核對。本輪逐格辨識不讀位置欄（它在表頭不在欄內）。
- **日期在部分執行會留空**：整張轉錄兩次不一致時日期就空白（`LI2995` run 1、`LIFA1C` run 2 都出現），寧可空白也不要錯年份。
- 未驗：完整網頁上傳→起稿→存檔→簽署→提送的真後端鏈（屬 E 包）；本輪只驗共用呼叫函式、切塊與純規則。
- 五張 JPG 依約定**不進版控**；回歸腳本只以本機路徑讀取，缺檔即 skip。

**對後續包的影響**

- C 包（紙本版面編輯）除了 `field_sources[key].evidence`，現在還可以用 `observations[].source`（原圖矩形）做「點欄位把原照片對應區域放大給人看」。
- 若日後要再提高抄錄率，下一步不是換模型（已實測更貴更差），而是**把表頭也切成一塊來讀**（日期與位置目前仍靠整張兩次核對），以及蒐集更多真實紙表來驗證界線偏移的通則性。

### C 真實表單 mapping、直接在紙本版面編輯

| 項目 | 內容 |
|---|---|
| 問題 | 2026-09-20 以 `f99bfee` 逐條驗證仍成立：`SiteLog.jsx:383–393` 把紙本 `SiteLogOfficialSheet` 只當唯讀／列印用，廠商編輯的是另一份精簡表 `DailyLogFields`，要按「公定格式檢視」才看得到真表；`SelfCheckFields.jsx` 與 `SelfCheckSheet.jsx` 同樣是兩份各自定義欄位的元件。兩份定義各走各的，紙上有而畫面沒有的欄位（表報編號、工期、進度、備註、契約數量、技術士簽章表）就永遠填不到。 |
| 目標 | 廠商**預設就看到可編輯的真實表單**；畫面與列印／PDF 共用同一份欄位 mapping、同一份資料來源與同一個版面；AI 帶入的值直接在格子裡，來源與待確認輕量呈現、點欄位回看原文與原照片；專案資料自動帶入、工期與進度沿用既有確定性規則；範本來源誠實；簽署版本保存當時的欄位／範本語意。 |
| 不做 | 不做泛用表單設計器（版面仍逐格照原表寫）；不動 schema、RLS、RPC、簽署規則與計價（**本包零 migration**）；不改 AI 模型與 prompt（B 包的事）；不做 PDF 下載（D 包）；**本輪未做監造查驗紀錄表與監造報表（原指令第 3、4 份）**。 |
| 影響 | 新 `src/lib/officialForms.js`（mapping 單一定義）、`src/lib/useDailyLogFacts.js`（工期／進度確定性事實）、`src/components/sitelog/PaperCell.jsx`（格內可編輯原語）；`SiteLogOfficialSheet.jsx`／`SelfCheckSheet.jsx` 改成「同一張紙、給 edit context 就可編」；`DailyLogFields.jsx`／`SelfCheckFields.jsx` **刪除**；`SiteLog.jsx`／`SelfCheck.jsx`／兩支列印頁改接新介面；`fieldAnchorId` 移到 `lib/fieldDocs.js`（原本住在被刪的元件裡）。 |
| 驗收 | 見下方「驗證」。紅線由測試釘住：唯讀／列印視角不得長出任何 input、監造在廠商表上不得可編、判定與累計量不得變成可填欄位、範本標示不得出現「機關核定」、簽署版本印它自己當時的範本版本。 |

**實際做了什麼（行為層面）**

1. **一份 mapping**：`src/lib/officialForms.js` 收「原表欄名 → 儲存欄位 → 來源／計算 → 可編角色 → 必填／不適用條件 → 紙本位置」；人可讀版本在 [official-form-mapping](../architecture/official-form-mapping.md)，由 `officialForms.test.js` 逐列釘住（程式與文件不一致就紅）。哪一格在誰的視角可編**只由 mapping 決定**（fail-closed：不在 mapping 的鍵一律不可編）；伺服器 RLS／RPC 仍是安全邊界。
2. **一張紙**：紙本元件同時是編輯畫面——給 `edit` context 就在原表的格子裡長出輸入框，沒給就是純文字。列印頁、唯讀視角（監造／機關）與廠商編輯視角因此是同一個元件、同一份資料，不會再分岔。「公定格式檢視」切換鈕拿掉（已經就是公定格式）。
3. **補齊原表**：施工日誌補上表報編號、本日天氣上下午、填表日期（民國年＋星期）、核定／累計／剩餘工期、工期展延天數、開工／完工日期、預定／實際進度、§一 備註欄與營造業專業工程特定施工項目 A／B、§二 材料契約數量與備註、§四 技術士簽章表（原表 p.3 附表，勾「有」才展開）、簽章欄改回原表的【工地主任】（註 3）。自主檢查表補上編號、分項工程名稱、協力廠商、檢查時機、檢查結果符號說明、備註欄、缺失複查結果／日期／複查人員職稱，欄名改用臺北市格式原文（實際檢查情形（載明檢查數值及單位）、檢查結果）。**全部是內容 JSONB 的新鍵，不需要 migration**。
4. **確定性數字不由 AI 產生**：`useDailyLogFacts` 算核定工期（契約竣工日−開工基準日+1）、累計工期、剩餘工期、預定進度（`progressPlan` 月底累計內插，D-024）、實際進度（截至該日最近一期估驗累計金額÷契約總額）；算不出來紙上印「待補」，不補 0、不猜。累計完成數量沿用原本「本日以前已落庫日誌＋本張」的規則。
5. **來源與證據**：AI／紙本抄錄的值本來就在格子裡，旁邊一枚輕量狀態章（待補／已帶入・待核對／已確認／不適用＋來源短句），抄錄值旁直接顯示「紙上原文：…」，點「原文」展開原文明細與**原照片縮圖**（用 B 包已寫進 `field_sources[].evidence` 的那一份，不另建一套）。列印時這些標記一律不印（`print:hidden`）。
6. **範本來源誠實**：畫面與紙本都印「參考工程會格式／參考臺北市格式・(範本 `<key>` v`<n>`・未經機關核定)」與免責聲明；臺北市 ODT 的示例數值（保護層 4cm／4.5cm）、良好與不良填寫示例、假公司名與示例判定**一律不入產品**，檢查項目與檢查標準只取本案核定的檢查表範本，沒有範本就待補、不可簽署。
7. **簽署版本記得自己的範本**：存檔時把 `content.form_template = { key, version }` 寫進內容；版本內容與雜湊本來就不可變，加上戳記後舊文件印的是它當時的範本版本，日後改範本不會改變舊簽署版本的內容或判定。
8. **版面**：桌面 ≥1280 左表單、右「待補／AI 建議／現場照片／日誌清單」；1024 讓 A4 表單佔滿寬度、提示與照片落到下方（A4 擠在 2/3 欄會橫向捲動）。手機表單在卡片內橫向捲動，上傳、檢視、審核與待補跳格都可用。待補清單點一項會捲到紙上那一格並對焦。

**驗證**

| 項目 | 結果 |
|---|---|
| `npm test` | 155 檔 1,703 項通過（新增 `officialForms.test.js` 16 項、`SiteLogOfficialSheet.test.jsx` 6 項、`SelfCheckSheet.test.jsx` 4 項） |
| `npm run lint`／`npm run build`／`npm run check:docs` | 通過（build 仍有既有 bundle 大小警告；check:docs 58 檔 451 連結 0 錯誤） |
| Demo E2E | `E2E_DEMO_PORT=5297 npx playwright test e2e/ --workers=3` 80 項全通過（`contractor.spec.js`、`routes.spec.js` 的欄名斷言改成原表欄名） |
| 真後端 E2E（本機棧） | 新增 `e2e-real/chain17-paper-form.spec.js`（廠商在原表格子逐欄輸入 → 存檔 → 版本內容逐欄核對 → 簽署落 `daily_logs` → 提送 → 監造同一張紙唯讀、收件）通過；受影響的 `chain5`／`chain8`／`chain14` 一併重跑通過 |
| pgTAP | **未跑：本包零 migration、零 DB 變更** |
| 內建 Preview 目視 | 桌面 1024 與手機 375 各兩頁（施工日誌、自主檢查表），截圖見回報 |

**C 待辦與對後續包的影響**

- ~~**第 3、4 份未做**~~：**已由 C2 包（PR #170）補齊**，四份表單的 mapping 與格內可編輯都到齊，見下方「C2」一節與 [official-form-mapping §3～5](../architecture/official-form-mapping.md)。
- 施工日誌原表 p.4 的「工地職業安全衛生施工前檢查紀錄表」是獨立一張表，本輪未實作，畫面與紙本都明寫需要時以紙本另附。
- D 包（PDF 下載）與本包無檔案衝突：D 動 `PrintToolbar` 與列印路徑，本包動欄位定義與 Sheet；但 D 的下載要取的就是這兩張 Sheet 的輸出，合併後請以本包的新 props（`content`／`sources`／`facts`／`titleAs`）取用。

### C2 監造查驗紀錄表與監造報表（附表五）

問題（動工前已用當時的 main 證明仍成立）：C 包只完成四份裡的前兩份。監造查驗表單與監造日誌仍是
`InspectionFormFields`＋`InspectionFormSheet`／`SupervisorLogFields`＋`SupervisorLogSheet` 兩份各自定義欄位——
監造在精簡表裡填、紙本另外排一次；監造日誌的紙本也還不是工程會附表五。目標：兩份都完成 mapping 並讓監造
**直接在真實表單的格子裡**編輯。不做：不放寬任何伺服器驗證、不新增 migration、不由 AI 產生確定性數字、
不把臺北市範例檔的示例內容帶進產品、不把附表五當成監造月報。影響：純前端，零 DB 變更。

1. **mapping 補到四份**：`src/lib/officialForms.js` 新增 `INSPECTION_FORM_MAPPING` 與 `SUPERVISOR_LOG_MAPPING`，
   人可讀版本在 [official-form-mapping §3～5](../architecture/official-form-mapping.md)，由 `officialForms.test.js`
   逐列釘住。這兩份的可編角色是**監造**不是廠商（`isEditableBy` fail-closed：廠商與機關在這兩張紙上一格都不可編，
   反過來監造也不能編廠商的兩份）。原表沒有、本系統為了接回標單與計價而加的格（查驗申請、工項、單位、階段、
   申報量、判定、本次確認數量；附表五的到場人員）一律在 mapping 與紙上標「本系統欄位」，不冒充原表內容。
2. **一張紙**：`InspectionFormSheet`／`SupervisorLogSheet` 改成「紙本同時是編輯畫面」，`InspectionFormFields`／
   `SupervisorLogFields` 刪除；只服務那兩份精簡表的 `ChecklistItemsTable`／`FieldSourceChip`／`RowsEditor` 一併退場
   （同一份欄位定義不再有第二處實作）。列印頁、唯讀視角與監造編輯視角是同一個元件、同一份資料。
3. **格內編輯不放寬伺服器規則**：判定與本次確認數量仍只有監造能填；簽署時
   `field_document_sign_inspection_form_internal` 照舊驗單位一致、階段在該工項 ITP 必要階段內、申報量與查驗申請相同、
   確認量不超申報、判定與數量一致、同查驗已有有效確認量須先撤銷（`PD008`）；紙本實測欄抄錄進來的值只標 `filled`、
   沒有人親自確認就簽署一樣被 `PD004` 擋。畫面上的 `inspectionFormIssues` 只是同一條規則的即時預覽。
4. **附表五是日報不是監造月報**（原表註 2）：紙上、標示與測試都釘住，提到「月報」只能是否定句。五節（工程進行情況／
   監督按圖施工含檢驗停留點與施工抽查／查核材料規格及品質／督導工地職業安全衛生／其他約定監造事項）與監造單位簽章
   都照原表；原表註 1 的「參詳施工日誌」依據＝同日施工日誌收件情形，印在第一節。
5. **表頭的確定性數字**：`useDailyLogFacts.js` 改名 `useFormHeaderFacts.js`，多一個 `useSupervisorReportFacts`——
   契約工期、預定／實際進度與施工日誌**同一支算式**，不另寫一份；契約變更次數改為確定性計算（截至本日已核准的
   變更設計件數，沒有變更日期的已核准件仍計入並在來源註明），資料未載入時印「待補」不印 0。
6. **契約金額兩格不自動帶入**：本系統的標單合計是「發包末端工項合計」口徑（不含稅與總價項目，且總價／間接費
   目前 `cap=0` 隔離不計價），**不等於契約金額**——帶進去就是印錯的官方表。所以由監造依契約自行填，未填印「待補」，
   畫面另說明為什麼不帶標單合計。
7. **到場人員**：附表五沒有這一格，但原表註 3 明寫各機關得依契約約定自行增訂，所以保留並在紙上標「本系統欄位」；
   規則不變——只能監造親自填寫並按「確認到場人員」才算數，任何照片都不是到場證明。
8. **順手解掉的相鄰根因**：`PaperCell` 的 `image_search` 與 `DocumentLifecycle` 的 `receipt_long` 沒有 lucide 對映
   （C 包與更早留下，圖示不顯示只印 console 警告）；「沒有來源列」不再一律當成「待補」——待補章只在待補清單說它待補、
   或來源自己是 `pending` 時才出現，原表有但本系統列為非必填的格（表報編號、展延天數、契約金額…）不再長出誤導的待補章。
9. **零 migration**：新增的原表欄位全部是內容 JSONB 的新鍵（查驗：`doc_no`／`subproject_name`／`check_timing`／
   `recheck_*`；附表五：`doc_no`／`actual_completion_date`／`extended_days`／`contract_amount_original`／
   `contract_amount_revised`／`material_quality`／`safety_precheck`／`safety_other`）。事實表是衍生的報表列，
   權威內容永遠是被簽署的那個版本。

**驗證**

| 項目 | 結果 |
|---|---|
| `npm test` | 161 檔 1,802 項通過（新增 `InspectionFormSheet.test.jsx` 8 項、`SupervisorLogSheet.test.jsx` 7 項、`officialForms.test.js` 16 → 28 項） |
| `npm run lint`／`npm run build`／`npm run check:docs` | 通過（build 仍有既有 bundle 大小警告；check:docs 58 檔 469 連結 0 錯誤） |
| Demo E2E | `E2E_DEMO_PORT=5388 npx playwright test` 86 項全通過（`supervisor.spec.js` 天氣欄名、`pdf-download.spec.js` 兩份紙本標題改成原表名稱） |
| 真後端 E2E（本機棧） | 新增 `e2e-real/chain18-supervisor-paper-forms.spec.js`（監造在抽查紀錄表格子輸入本次確認數量 → 存檔 → 抄錄值未確認簽署被 `PD004` 擋 → 人按「確認」→ 簽署 → `inspections` 合格 80／`inspection_confirmations` 80 落庫 → 列印印簽署版本 → 廠商 backlog 80、估驗頁同步 80、設 81 被 `VQ006` 擋）通過；`chain6`／`chain10`／`chain16` 一併重跑通過 |
| pgTAP | **未跑：本包零 migration、零 DB 變更** |
| 內建 Preview 目視 | 桌面 1024 與手機 375 各兩頁（監造報表、監造查驗紀錄表），375 頁面無水平溢位（紙本在卡片內自己橫向捲動，與 C 包相同） |

### C2 待辦與對後續包的影響

- **監造主管簽名（臺北市抽查紀錄表）本輪未實作第二簽署人**：平台簽署只涵蓋「監造單位派駐現場人員」，監造主管維持紙本手簽欄；
  要做需要一份文件兩個簽署角色，屬簽署模型的變更，不在本包範圍。
- **附表五 §三 不自動引用試體／檢（試）驗紀錄**：`material_quality` 由監造自行敘述；品質模組的試體與試驗紀錄要帶進這一節，
  需要決定引用口徑（哪些紀錄算「本日」），留待後續。
- **契約金額沒有系統欄位**：目前由監造每份報表自己填。若要免去重複輸入，得在專案或契約層新增「契約金額（原／變更後）」欄位
  並決定與標單合計的關係（含稅、總價項目、Q3 `cap=0` 的隔離），那是 schema 變更，本包刻意不做。
- **`note` 的欄名在兩處不同**：框架範本（伺服器）標「備註」，附表五紙上標「重要事項紀錄」（原表第五節的欄名）。
  `note` 非必填，不會出現在待補清單，所以目前沒有使用者看得到的落差；之後若把 `note` 改成必填，要一併把範本標籤改成原表欄名。
- **E 包（整條流程驗收）**：監造兩份的 UI 入口與欄位定位子（aria-label）已改成原表欄名，寫新的真後端鏈時請以
  `chain18` 的選擇器為準，不要沿用舊的精簡表欄名。

### D PDF 交付

問題（動工前已用 `f99bfee` 起算的 main 證明仍成立）：`src/components/PrintToolbar.jsx` 只有 `onClick={() => window.print()}`，鈕上寫「列印 / 存 PDF」，估驗兩支還傳 `printLabel="列印 / 另存 PDF"`——開的是瀏覽器列印視窗，要使用者自己在對話框裡選「另存 PDF」，八支列印路由沒有任何下載入口。目標：按一下直接拿到 `.pdf`；A4、多頁自動換頁、長表跨頁重印表頭、中文內嵌字型、簽章與表格不截斷、照片帶說明與對應工項；草稿標未簽署、正式取不可變的已簽版本；失敗清楚提示，不下載空白或半份。不做：不改四類文書 Sheet 元件的欄位定義與資料來源（C 包要改那些元件）、不改挑版本的規則、不新增付費服務、沒有 migration／Edge／路由／`roles`／RLS／RPC 變更。影響：純前端；新增 `src/lib/pdf/*`、一段 `.pdf-export` CSS、一支 vendor 字型與兩個 npm 相依（dynamic import，主 bundle 幾乎不動）。驗收：實際下載檔案後解析與算圖核對一般、長表、多照片、改版後重印四種案例。

做法（根本解：欄位對應只留一份）：

- **從 DOM 抄，不照資料再排一次。** `paperSnapshot.js` 把畫面上的 `.paper` 複製到畫面外的固定寬容器，逐字用 `Range.getClientRects()` 量瀏覽器已經算好的位置，連同 computed style 的字級、字重、顏色、框線、背景與 `<img>` 一起轉成繪圖指令。四份紙本的 mapping 仍只寫在 `SiteLogOfficialSheet`／`SelfCheckSheet`／`InspectionFormSheet`／`SupervisorLogSheet`，Sheet 一行都沒改——若照 `log`／`version` 再排一次，同一份欄位定義就會有兩套實作，B 包改草稿欄位結構、C 包把格子改成可編輯之後會靜默走鐘。表單控件（佐證包的施工說明 textarea）在複本裡換成等效 div，才量得到字；`print:hidden` 的 chrome（工具圖示、僅螢幕用的提示）在複本裡一併隱藏。
- **量測字型＝內嵌字型。** `.pdf-export` 把複本的字型釘成 PDF 要內嵌的那一支並關掉 kerning／連字／等寬數字（vendor 時已丟掉 GSUB/GPOS），兩邊都走純 advance width；畫面上的紙在 macOS 走 PingFang，寬度與 Noto 不同，不釘住會逐字累積誤差、字擠出格線。基線用一顆 `vertical-align:baseline` 的零尺寸 inline-block 探針量（同字級＋同 line-height 才準），不猜字型度量。
- **分頁自己做**（`paginate.js`，純函式、8 條單元測）：紙本是一張連續長紙，分頁本來由列印引擎負責。分頁點只取「原子」邊界——表格列、單行文字、照片、`break-inside-avoid`——且不得被任何原子橫跨（以 top 排序＋前綴最大 bottom 做二分搜，長表兩三千個原子不會卡住畫面）。表身跨頁時下一頁重印該表 `thead` 並讓出等高空間；真的切不動（單一原子高過整頁）才硬切並回報次數，不假裝沒事。每頁印「第 n 頁／共 m 頁」。
- **輸出**（`renderPaperPdf.js`）：紙本自己的 padding 就是頁邊，整張紙等比縮到 A4 寬，所以 210mm 的四份文書與 820px 的佐證包共用同一套換算。文字優先整段畫；字級階梯本來就帶 letter-spacing、標題還有 `tracking-widest`，這種等距偏移用 PDF 的 `Tc` 表示（仍是一段連續文字，複製貼上與全文檢索還原得回原文），只有不規則位移才逐字定位。粗體以 `Tr 2`＋描邊做（vendor 字型只有 Regular 一個字重）。照片各自內嵌，`object-fit: cover` 用裁切路徑處理。
- **印哪一版沿用既有規則**：`usePrintedVersion` 有簽署列就印簽署列指向的不可變版本與簽署資訊、沒有就印最新存檔版並整張標「草稿・未簽署」、有簽署列卻讀不到該版本就明說失敗不代印——PDF 抄的是同一棵 DOM，所以不是另做一套判斷。檔名同步標 `v<版次>` 與「已簽署／草稿未簽署／既有紀錄未簽署」：檔案離開系統後，收件的人也分得出手上這份簽了沒。

中文字型（新增資產，OFL 免費開源）：

- `src/assets/fonts/NotoSansTC-Regular-pmis.ttf`（5.8 MB，`/assets/*` 是 immutable 且邊緣會壓縮，實際傳輸約 2.9 MB），`scripts/vendor-pdf-font.sh` 一次產出：Noto Sans TC 可變字型 → 實例化 wght=400 → 子集到實用字集（ASCII、常用標點與符號、全形、注音、假名、單位符號、CJK 統一表意文字全區＋擴充 A＋相容表意文字）→ 改名。**刻意不縮到 Big5 常用字**：人名地名的罕用字印成豆腐格，對送審文件是硬傷。
- 為什麼不用畫面在用的 `@fontsource-variable/noto-sans-tc`：那是 WOFF2 切片，fontkit 讀得到輪廓但 `createSubset()` 編出的 glyf 是空的（實測子集後 path 長度 0），PDF 開起來整頁空白；WOFF2 的 glyf 是 transform 過的，子集器拿原始位元組重組會壞。OTF/CFF 走 pdf-lib 的 CFF 子集化則被 poppler 判「Embedded font file may be invalid」。可變字型的預設實例是 Thin(100)，不實例化會印出髮絲字。
- 相依：pdf-lib（MIT）＋ fontkit（MIT）。**不用 pdf-lib 自帶的 `@pdf-lib/fontkit`**——它的 TTF 子集器會把 glyf 編壞，實測 B/D/P/X/x/× 等字整個印不出來（中文多半正常，所以很容易漏看）。上游 fontkit 2.0.4 正確，但它呼叫 `new EncodeStream(size)` 而 `restructure@3.0.2` 改成收 buffer，所以在 `overrides` 釘 `restructure@3.0.1`；fontkit 升版後可重測解除。pdf-lib 的子集介面是 `encodeStream()`、fontkit 2 是 `encode()`，以一層薄轉接補差，不改子集化行為。

紙不跟裝置（PR #167）：離畫面複本把字級階梯釘回桌機值。手機層（`max-width: 767.98px`）把 `--text-body` 從 13 推到 17 是給工地看螢幕用的，但 PDF 是固定印刷品——不釘住的話同一份施工日誌在手機按下載會欄名折行、版面鬆開、頁數可能改變，交到機關手上對不起來。值刻意複製而非 `var()` 引用，理由與 `.paper` 釘回亮色 token 相同。e2e 以 375px 視窗釘住「手機下載到的與桌面同一份」。

失敗與缺字：字型抓不到、量不到內容、附件照片載不回來或格式不支援、內嵌字型缺字，一律中止下載並在工具列顯示 `role="alert"`（走 `friendlyError`，不把原始錯誤或照片簽名網址帶上畫面）。缺字訊息帶字碼——實測示範資料真的有 CJK 相容表意文字（冷 U+F92E、流 U+F9CA），已用 NFC 正規化還原成統一表意文字（順便讓 PDF 文字層能用一般的字搜尋得到）；Noto Sans TC 有 ✓(U+2713) 卻沒有 ✕/✗/✘，而自主檢查表與查驗表單的判定欄兩個都用，這幾個以同形的 ×(U+00D7) 代替（字型層替代，判定語意不變），表以外的缺字一律報錯不默默印成豆腐格。

驗證：`npm test` 154 檔 1,691 通過（新增 `paginate` 8 條、`docFileName` 6 條、`SiteLogPrint` 下載接線 2 條）、`lint`／`build`／`check:docs` 綠；Demo E2E `routes`／`a11y`／`contractor` 42 條通過。新增 `e2e/pdf-download.spec.js` 五案**實際下載檔案後解析 PDF**（`e2e/pdfText.js` 依 ToUnicode CMap 把內容流還原成文字，同時證明有文字層、字型有內嵌、沒有無法對應 Unicode 的字——截圖沒有 `Tj` 也沒有 ToUnicode）：一般（施工日誌）、長表（契約期限對照表，2 頁且每頁都有表頭）、多照片（佐證包注入 12 張，每張各自是 `/Subtype /Image`）、改版後重印（換一份文件重新量產、日期與檔名都換掉）、四類文書。本機另以 poppler 逐頁算圖核對：全部 595.276×841.89（A4）、中文不亂碼、表格線與簽章列完整、跨頁表頭確實重印、頁尾頁碼與實際頁數一致。

### D 待辦與對後續包的影響

- **「正式文件取已簽版本」在 Demo 驗不到**：示範模式的 `getFieldDocument` 固定回 `signatures: []`（`src/store/slices/fieldDocs.js`），所以 demo 的四類文書列印頁一律顯示「草稿・未簽署」，E2E 只能驗到草稿分支。已簽分支由 `SiteLogPrint.test.jsx` 的單元測釘住（簽署列指向 v2 → 檔名 `施工日誌_2026-09-18_v2_已簽署`、紙面不出現「草稿・未簽署」）；真後端未驗，留給 E 包的整條鏈。
- **照片來源只驗到注入的合成 JPEG**：示範模式不支援照片上傳，佐證包在 demo 沒有真照片。E2E 是往紙上注入 12 張合成 JPEG（走產品同一條 `<img>` → 內嵌影像路徑）；真 Supabase Storage 簽名網址的 `fetch` 與 CORS 未在本單元驗，留給 E 包。
- **下載入口目前在列印頁**：文件頁（`/self-check`、`/inspection-form`、`/supervisor-log`）的「列印」鈕會帶到列印頁，下載鈕在那裡。實作指令 C 節要求文件編輯畫面的常用動作直接包含「下載 PDF」，屬 C 包範圍；本單元沒有動那些頁面的動作列。
- **C 包把格子改成 `<input>` 之後**：`paperSnapshot` 已經會把 `input`／`textarea`／`select` 在離畫面複本裡換成等效 div 再量，所以值會照樣進 PDF；但 C 包若改用 `contenteditable` 或自訂編輯器，要回來確認這條路徑仍量得到文字。
- **`restructure` 的 `overrides` 是上游 semver 破壞的止血**：fontkit 發出相容版本後應該拿掉並重跑 `e2e/pdf-download.spec.js`（子集壞掉的症狀是「某些字整個不見」，不會丟例外，只能靠算圖或這支測試抓）。

### E 三項核心的整條流程驗收（真後端）

問題（動工前逐條以 `ba7a97b` 的 main 重驗）：整套真後端鏈在**單一指令下從來沒有全綠過**——`supabase functions serve` 只吃一個 `--env-file`，視覺 stub 在 `e2e-real/stub.env`、模型金鑰在 `.env.e2e.real`，兩者互斥，所以 chain 3 的 live 抽取一定回「AI 服務尚未完成設定（代碼 config）」。另外查出一個**產品併發漏洞**：查驗表單簽署分支寫確認量時是「讀此 (工項, 批次, 階段) 最新 active 的 `qty_cum`，再插入 `prev_cum + 本次確認`」，但這段 read-then-insert **沒有取** `fn_cq_lock_internal`——同樣寫確認量的 `issue_supervisor_certificate` 有。目標：把三項核心的整條流程在**隔離真後端**跑到全綠，缺口補到通過，並補驗 D 包留下的兩項。不做：不重做確認量分配引擎、不重新加入 MFA、不解 `cap=0`、不新增付費 OCR、不放寬任何守衛。影響：一支新 migration（只換函式定義）、pgTAP 併發情境、兩條既有鏈補 PDF 斷言、真後端 harness 與 runbook。

**產品修正（根本解）——查驗表單簽署的確認量併發**

`20260920170000_inspection_sign_confirmation_lock.sql`：在工項與位置都驗過之後、任何一次讀 `inspection_confirmations` 之前，補上 `lock_timeout 5s` 與 `fn_cq_lock_internal(project, work_item)`（與 `issue_supervisor_certificate` 同一把鎖、同樣的取鎖順序）。函式其餘部分逐字沿用 `20260920004000`。

為什麼是 root cause 而不是前端擋：`inspection_confirmations_guard` 自己也是「讀最新 active 再算 `qty_delta`」，兩段都在同一個 READ COMMITTED 快照之外，**鎖只能由呼叫端取，guard 救不了自己**。沒有鎖時的實際後果（`confirmed_quantity_concurrency.sql` 情境 4 逐項印出來）：A 先確認累計 30 還沒提交、B 同時簽一張確認 60 的查驗表單 → B 讀到的 `prev_cum` 是 0，落庫成 `qty_cum = 60`（**應為 90**），而且兩筆的 `supersedes_id` 都是 null ——本來該是線性的累計鏈**分岔成兩個鏈頭**，此後「有效量＝Σ `qty_delta`」與「最新一筆的 `qty_cum`」永遠對不起來。AFTER trigger 仍會擋在鎖上，所以**只看「有沒有被鎖住」分辨不出有沒有修**，測試斷言的是最後落庫的數字與鏈頭數。移除該兩行重跑，情境 4 的兩條斷言如預期轉紅（`have: (60.0000,60.0000)` / 鏈頭 2）；補回即綠。

**真後端 harness（讓整套鏈能一次跑完）**

- 模型金鑰與視覺 stub 併到同一個 `.env.e2e.real`（`.env.e2e.real.example` 與 runbook 同步說明為什麼），一次 `functions serve` 就涵蓋 stub 鏈與 live 鏈。stub 仍只在本機 http 位址生效，正式 Edge 不受影響。
- `playwright.real.config.js` 加 `E2E_REAL_PORT`（與 Demo 端 `E2E_DEMO_PORT` 同一個做法）：5189 被別的 worktree 佔用時不必乾等，也**不放寬** `reuseExistingServer: false`。
- `chain3-requirements.spec.js` 的最後一段改成明確切到「全期」再斷言。這不是放寬期望值：到期日 `2026-10-31` 離執行當天超過 30 日，履約時程的「近期」視圖本來就不該列它；以前會過是因為近期在「一件都沒有」時會退回全期（`Requirements.jsx:297`），而 live 模式的 AI 另外抽到 9/30 的品質計畫，退回機制就不觸發。改完之後執行日期不再影響結果。

**補驗 D 包留下的兩項（都在既有鏈裡，沒有另開鏈）**

- **已簽版本的 PDF**（Demo 驗不到）：chain 5 在列印頁**實際下載檔案並解析**——檔名 `施工日誌_<日期>_v3_已簽署.pdf`、文字層是版本 3 的更正摘要與 `content_hash` 前 12 碼、整份沒有「草稿・未簽署」、中文字型有內嵌。
- **真 Storage 簽名網址的照片抓取／CORS**：chain 13 下載估驗佐證包的 PDF。那張照片是本鏈真的上傳到 `photos` bucket 的，`<img src>` 是真簽名網址；`renderPaperPdf` 的 `embedImages` 抓不回照片時會**中止下載並丟錯**，所以「檔案下載成功且含 1 個 `/Subtype /Image`」就是簽名網址 fetch 成功、CORS 沒擋的證據。

**驗證**：`npm run test:db` 62 檔 3,604 項通過（新增併發情境 4 共 9 條）；`npm run test:e2e:real` **21 項一次全綠**（含 chain 3 live 真模型抽取）；`npm test` 159 檔 1,775 項、`lint`／`build`／`check:docs`（58 檔 469 連結 0 錯）皆綠。沒有 Edge 原始碼改動，故不跑 `check:edge`／`test:edge`。

### E 未通過與未測（如實）

- **正式部署未測**：本節只在**本機隔離棧**驗證。正式 `db push`、正式 Edge、正式站的 UI 與 PDF 下載**本輪未跑**，不引用舊報告宣稱通過。
- **live 契約抽取是非決定性的**：同一份契約三次 live 執行中有一次回「AI 回傳缺少契約重點清單」而整條失敗（模型輸出不完整，不是程式錯）。chain 3 目前沒有重試或降級，偶發紅燈要看 `document_ingestion_runs.metadata` 分辨是抽取品質還是斷言過嚴。
- **E4 仍缺的測試**（查證後列出，本節未做）：真後端沒有「改期（改基準日 → rescheduled 文案與新到期日）」「取消（廢止取代 → 義務與期次變不適用）」「逾期」三條端到端；`transition_obligation_period` 的拒絕路徑只有 pgTAP；保固的「引用條文失效／合格日撤銷 → 回到待補並收回期次」只有 pgTAP；`send-reminders`（190 行，含角色分流）**零測試**；監造角色「到期前看到契約重點待辦」無 e2e。
- **「完全沒有頻率／完全沒有觸發點」不列待補**：只顯示「無到期日」，使用者不知道要補什麼（`ballInCourtRules.ts:293-297`、`contractDue.js:21-23`，且被 `obligationTimeline.test.js:352` 當成正確行為釘住）。實作指令 E-4 要求「缺基準日／頻率顯示待補」——**缺基準日**已有五類待補設定涵蓋，**完全缺頻率／缺觸發點**這兩種沒有。要改要同步改前端、Edge 與 DB 三處同口徑判定，不在本節範圍。
- **「照片日期不得改變契約期限」結構上成立但無測試釘住**：照片日期只落現場文書草稿；期限只能來自 `update_project_anchors`（`is_project_admin`）、`acceptance_events` 與義務規則欄位，Edge 對 `projects`／`acceptance_events` 全是唯讀、`obligation_periods` 對 `authenticated` 已 revoke。但**沒有負向測試或靜態掃描**，未來新增一支寫 `projects.commencement_date` 的 Edge 不會被 CI 擋下。
- **E3 仍缺的封堵測試**：標單重匯與 active 確認的互斥在 `boq_reset_import.sql` 與 chain 4 都沒有案例（只有 `confirmed_quantity_enforcement.sql` 一條）；Edge 只有原始碼靜態掃描（`valuationWrites.scan.test.ts`），沒有「Edge 以 service role 實際寫入被 DB 拒絕」的 runtime 測試；兩個監造同時 `issue_supervisor_certificate`、以及「trigger 自動分配 vs 廠商手動 sync」同時發生，都還沒有測試。
- **多個符合截止日的草稿期並存時取 `period_no` 最小者**（`fn_cq_target_draft_internal`）沒有測試情境。
- **既有限制維持不變**：總價／間接費缺依據仍 `cap=0`（試用專案若要請這類款，這就是該案完整請款的阻擋項）；掃描／無文字契約仍不採付費 OCR，只能顯示抽不出來並人工補登；未重新加入 MFA。舊資料、簽章、確認量與計價稽核一列未刪。

### O3 Demo 站重佈、文件同步與驗收清單更新

**不改任何產品程式**（本節只動 `CURRENT.md` 與本檔）。PR #172，分支 `codex/contractor-o3-demo-docs`，基準 main `388daa4`（含 A、B、B2、C、C2、D、E 全部）。

**Demo 站重佈**（依 DEVELOPMENT §「線上 demo 站」）：`VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_SENTRY_DSN= npm run build` → `npx wrangler deploy --config wrangler.demo.jsonc`。

| 項目 | 結果 |
|---|---|
| Version ID | `664312c5-d39a-48b6-b221-c246e6620e0f`（前一版 O2 `beb53b7c-ee55-456c-92af-e608fb1dd555`） |
| 入口 chunk | 本機建置 `assets/index-BEIURVua.js`＝線上 `demo.gov-agent.ai` 引用的同一支 |
| demo 模式 | `dist/` 內 **0 處**正式 Supabase 專案網址（只有 `_headers` 的 CSP 萬用字元 `https://*.supabase.co`，與歷次基準相同） |
| `node scripts/check-prod.js` | 五頁全 OK（app `/`、`/login`、`/demo/`；demo `/`、`/login`） |
| `npm run check:docs` | 0 錯 |

**內建 Preview 逐項覆核**（桌面 1280×900；逐條文字證據見回報所附 scratchpad 檔）：

| 驗的是什麼 | 實際看到 | 判定 |
|---|---|---|
| 廠商導覽收斂（A） | 「陳怡君（施工廠商）」側欄只剩今日工作＋現場紀錄（現場總覽／施工日誌／自主檢查表／品質查驗）／履約時程／估驗請款＋文件往來／專案；**沒有監造日誌與監造查驗表單**。「王建國（監造）」六個現場紀錄子頁一項不少 | 通過 |
| 四份紙本表單格內可編輯（C／C2） | `#/site-log` 附表四「公共工程施工日誌」、`#/self-check`「施工自主檢查表」、`#/inspection-form`「施工抽查紀錄表」、`#/supervisor-log` 附表五「公共工程監造報表」，四張都直接在格子裡編輯、都標【示範範本】與原表出處 | 通過 |
| 紙表抄錄值帶入並標待確認（B2／C／E） | 由查驗申請建立表單後出現「待補 4 項（補齊並存檔後才能簽署）」與「施作位置／批次（待親自確認）」，每個帶入欄位旁有「原文」與「確認」；未逐項確認前沒有簽署鈕 | 通過 |
| 下載 PDF（D） | `#/site-log/print` 工具列有「列印」與「下載 PDF」；按下後實際產出 `application/pdf` **95,738 bytes**、檔名 `施工日誌_2026-09-19_既有紀錄未簽署.pdf`（草稿如實標未簽署）。`#/supervisor-log/print` 同樣有該鈕、附表五紙面渲染正常。量測用 `URL.createObjectURL` 攔截，**未實際落檔** | 通過 |
| **紅線：示範模式仍不得能簽署** | 監造查驗表單補齊待補並存檔到「版本 1・雜湊 `55c1242f8b6d`・草稿・可簽署」後按「簽署此版本」→ 確認 →「示範模式無法簽署／提送：正式專案以登入的平台帳號簽署,才會有可核對的版本雜湊與簽署紀錄。」，狀態維持未簽署、無任何簽署列 | 通過 |
| Console | 產品端零錯誤；只有 4 筆由本次量測腳本自己觸發的 CSP `connect-src` 錯誤（`fetch(blob:…)`），真正的下載路徑走 `<a download>` 導覽、不受影響 | 通過 |

**正式環境唯讀核對**（未做任何變更）：遠端 migration **86 筆**＝repo 86 支、最新 `20260920170000`、無待套（E 的 `20260920170000` 與 B2 的 `20260920160000` 都已在正式）；Edge `draft-field-documents` v13／`agent-run` v24／`classify-site-photo` v14／`read-whiteboard` v18 皆 ACTIVE 且 `verify_jwt=true`，`send-reminders` 維持 v23／`verify_jwt=false`，已退場的 `audit-summary` 不在線上清單內。

**文件同步清單**：`CURRENT.md` 頁首與 §6.3 補 E merge `388daa4`＋`20260920170000` 已套正式、C2 merge `d161545`、C merge `bdbf4ae`、D merge `2350f16`＋`ae3b8d6`，並新增 O3 一列；本檔新增 §7.1（A–E／B2／C2／O3 的 merge commit、migration 與部署狀態一覽）、§8.0 補 demo 重佈日期與能力、§8.1 新增 A16（廠商導覽收斂）／A17（四份紙本表單與原表對照）／A18（下載 PDF）、§8.7 新增 G12–G18（E 包未通過與未測逐條，標明 F1／F2 處理範圍）、§9 工作包表補 merge commit 與 F1／F2 列。

**未做（如實）**：正式站登入後的 UI 與 PDF 本節沒有測（只在 demo 站驗），列為 §8.7 G18；demo 站不隨 main 自動部署，之後若再有前端變更要再重佈一次。內建 Preview 的截圖只能回到對話裡、工具沒有存檔參數，故本節以逐項文字證據留存而非 PNG。

### F1 契約義務「時點待補」：缺頻率／缺觸發點三處同口徑列為待補設定＋契約期限防回歸掃描

問題（動工前以 `388daa4` 的 main 重驗，仍成立）：單次契約義務推不出到期日時，共用規則 `obligationBall` 回 `label:'待辦'、setup:null`，前端／Edge／DB 都只知道「到期日 null」，畫面只寫「無到期日」（履約時程詳情寫「依條件觸發」、期限追蹤寫「無期限」），五種情況全部一樣：觸發點 null、觸發點 null 但有天數、觸發點 `other`、觸發點 `monthly` 卻沒有循環規則（抽取器仍會給的舊值）、`fixed` 沒有日期——使用者分不出「本來沒有時點」與「設定沒填」，也沒有處理入口。`obligationTimeline.test.js:352` 把「fixed 缺日期、無觸發點 → 不列待補」當正確行為釘住。另一項：Edge／AI 不得改變契約期限只是「目前沒人寫」，沒有測試擋回歸。目標：缺口判定與文案由單一來源推導，三處同口徑；每種缺口說缺什麼、由誰補、點得到入口；補上靜態掃描。不做：不改 D-019 自動確認、不在 DB 擋人工補登（pgTAP fixture 大量依賴無時點的 deadline 需求列，且產品立場是揭露＋人工補登，不是擋在入口）、不新增 RPC／頁面、不動 RLS 與任何資料列。

**根本解（單一來源）**：共用規則 `_shared/ballInCourtRules.ts` 新增 `timingGap(ob)`（只看義務列自己的欄位＋隨列 embed 的契約重點類型），`obligationBall` 在基準日缺口之後、停止條件之前多判一次，第六種 `SetupGap.kind='timing'`：

| 缺法 | 句子（前端／Agent／早報／DB 同一句） | 為什麼是缺口 |
|---|---|---|
| `fixed` 沒有 `fixed_date` | 指定日期未填 | 規則說有指定日期卻沒有日期 |
| 觸發點 `monthly` 且 `recurring` 空 | 觸發點為每月，循環規則未設定 | 觸發點自己說是每月（缺頻率） |
| 觸發點空但 `offset_days>0` | 有 N 日期限，起算事件未設定 | 有期限長度沒有起點 |
| 觸發點空、`requirement_type='deadline'` | 期限型契約重點未設定觸發點或頻率 | 期限型沒有時點物化不出到期日；人工補登表單本來就擋（`lib/manualRequirement.js`），AI 抽取與舊資料沒這道關 |

不是缺口（維持無到期日，但詳情要說得出原因）：非期限型沒有時點＝依條件觸發（檢查表／佐證等）；觸發點 `other`＝事件發生才起算，系統不追蹤該事件，事件發生後到擷取審核廢止取代並補登指定日期。`obligationTimeline.js` 新增 `singleNoDueReason`／`noDueReason`：履約時程詳情的到期日欄與 na 說明、期限追蹤詳情多的一行，都從同一份缺口推導，不再有「清單標待補設定、詳情寫依條件觸發」的兩張嘴。

- 契約重點類型隨義務列 embed：前端 `loadObligationsFromDB` 與 Edge 收集器的 select 都加 `requirement:requirements(requirement_type)`，共用規則從 `ob.requirement.requirement_type` 讀；demo／舊資料沒有就只判前三種。Agent `SETUP_FIX_AT.timing`、`list_my_open_items` 說明、首頁待補設定卡文案一併更正（不再只寫「責任方或基準日」）。
- 處理入口與責任方／循環規則同一個：`lib/obligationLinks.js` 的 `timing` → `/requirements/review?highlight=<id>`；履約時程詳情「到擷取審核廢止取代後補登」。
- DB 同口徑：migration `20260920214557_obligation_timing_gap` 只新增 `fn_obligation_timing_gap(requirement_type, trigger_event, offset_days, fixed_date, recurring)`（IMMUTABLE、不對 authenticated／anon 開放；rollback 檔 `drop function`；匿名 preflight 只記四種缺法的筆數）。pgTAP `obligation_timing_gap.sql` 21 條：對共用案例 `expected.timing_gaps.cases` 逐條同句；用觸發點值域 × 三種類型 × 有無日期／天數的矩陣釘「單次義務 `fn_obligation_single_due` 回 null 時，一定落在時點缺口／基準日缺口／依條件觸發三者之一，沒有靜默的第四種」；時點缺口與基準日缺口互斥、有缺口的組合一定推不出日期；循環 `fixed` 缺起算日仍由 `fn_obligation_recurrence_gap` 接住不重疊。`ballInCourt.cases.test.js` 核對 pgTAP 檔含案例表每一條呼叫與期望值（改一邊另一邊紅，與 P5e 保固期滿日案例同一做法）。
- 共用案例 `tests/fixtures/ball-in-court.cases.json` 加 ob19（期限型無觸發點）、ob20（觸發點每月缺頻率、責任監造）、ob21（fixed 缺日期）→ 待補設定 `timing`；ob22（非期限型無時點）與既有 ob7（觸發點其他）不是缺口；`expected.timing_gaps` 純函式案例表 11 條。Vitest（前端路徑、Edge 路徑）與 Deno 對同一組斷言。
- **修錯的測試**：`obligationTimeline.test.js:352` 改成「不算基準日缺口（設基準日補不了它們，數字不虛報），但 `setup` 帶 `timing` 缺口與入口」。這不是放寬期望值——原斷言只釘「anchorGaps 為 0」，把「不列任何待補」當成正確行為，正是驗收未通過的那個行為。
- **防回歸「照片日期不得改變契約期限」**：`anchorWrites.scan.test.ts` 靜態掃描全部 Edge 原始碼（含 `_shared`），`projects`／`acceptance_events`／`project_anchor_versions`／`contract_obligations`／`obligation_periods` 不得出現 insert／update／upsert／delete 或原始 REST，`update_project_anchors`／`transition_obligation_period`／`materialize_*`／`review_requirement`／`materialize_requirement_obligation`／留版與重算內部函式不得被呼叫；`.from()`／`.rpc()` 的目標必須是字串常值。掃描器與 P4e 估驗掃描抽成同一份 `tests/lib/edgeWriteScan.ts`（放 `tests/lib`：Edge 打包碰不到、兩支掃描也不會把它當受掃原始碼），`valuationWrites.scan.test.ts` 改 import 它、合成片段測試原樣保留。允許的 AI → 契約重點路徑只有 `requirements` 三張表的 persist upsert 與 D-019 `apply_transcription_triage`，刻意不在禁單。
- 與設計文件的差異：`docs/architecture/ball-in-court.md` 待補設定一節與「契約義務」列補第六種；`slimming-entrypoints-and-retirement.md` §待補設定可篩選改「六種」。沒有設計上的矛盾，只是原設計只列到五種。

**驗證**：`npm test` 162 檔 1,830 項（新增 `anchorWrites.scan.test.ts` 3、`obligationTimeline.test.js` ＋1 並改寫 2、共用案例前端 ＋12／Edge ＋12 條）；`test:edge` 17 項（新 1）；`check:edge` 18 支；`lint` 零警告；`build`；`check:docs` 58 檔 480 連結 0 錯；`test:db` 63 檔 3,626 項（新 `obligation_timing_gap.sql` 21）；真後端本機隔離棧：新 `e2e-real/chain19-timing-gap.spec.js` 通過（廠商今日工作待補設定卡列「時點待補（觸發點為每月，循環規則未設定）」並連到擷取審核該筆、不進「現在輪到我」；履約時程「時點待補（1）」可篩到、詳情到期日欄與待補設定區同一句、入口同一個；期限追蹤詳情同一句；廠商在擷取審核沒有廢止按鈕；監造從入口進去廢止取代、手動新增每月 10 日、確認 → DB 物化循環義務並依開工日產生期次；舊義務不適用、時點待補 0 件、待補設定卡不再列它），受影響的 chain3／chain15 重跑通過（`ANTHROPIC_API_KEY=` deterministic）。

**未做／待驗（如實）**：正式 `db push` 與四支 Edge 重佈在合併後執行，結果見單元回報；正式站登入後目視同 G18 一批；`get_requirements` Agent 工具回的 `due_date:null` 仍不附原因（Agent 由 `list_my_open_items` 的 `setup_pending` 得知缺口，未在這支工具再算一次）；G15 的「Edge 以 service role 實際寫入被 DB 拒絕」runtime 測試屬 F2；觸發點 `other` 的義務事件發生後仍要走廢止取代補指定日期，沒有「登錄觸發事件日期」的輕量入口（產品面待決，不是本單元範圍）。

### F2 補完 E 包列為「未測」的真後端與 Edge 驗證；查出並封住服務憑證的三個守衛缺口

問題（動工前逐條以 `388daa4`／`52f53ef` 的 main 重驗）：E 包「未通過與未測」列了五項缺口：(a) 逾期／改期／取消／已完成只有 pgTAP 與 demo，真後端沒有端到端；(b) `send-reminders` 190 行含角色分流零測試；(c) Edge 只有原始碼靜態掃描，沒有「以 Edge 憑證實際寫入被 DB 拒絕」的執行期證明；(d) 標單重匯 vs active 確認只有一條 pgTAP、chain 4 無案例；(e) 真後端鏈的視覺是 stub，「紙本抄錄值 → 草稿」整段沒走過；另加 chain 3 live 抽取非決定性造成的紅燈難分辨。**做 (c) 時以本機隔離棧用 `set local role service_role`（`auth.uid()` 為 null，即 Edge service client 的實際條件）探針，查出三個真缺口**（不是已發生的事故——Edge 目前沒有任何一支寫這些表，靜態掃描釘著；但 D-026／設計 §9 的前提是 DB 才是安全邊界）：

1. `inspection_confirmations_guard` 的 INSERT 只驗內容（工項可計價、單位、確認人是本案監造成員、查驗已判定、文件已簽…），**不驗是誰在寫**：服務憑證湊一筆內容合法的列（`confirmed_by` 填任一位監造）就能憑空落一筆 active 確認量——實測 INSERT 成功、`qty_delta=60`，監造本人從頭到尾沒簽任何東西；active→revoked 也只驗有沒有填原因，服務憑證能替監造撤銷。
2. `valuations_guard` 的角色與狀態機檢查全掛在 `is_user` 之下：非登入者不受狀態機約束——實測可直接 insert 一筆 `status='已核定'` 再 update 成 `已請款`；`valuations_checkpoint_guard` 只驗數量不變量（AFTER UPDATE；INSERT 不驗），所以沒有明細的期別可被服務憑證直接核定、請款，有明細的期別在廠商備妥時可被服務憑證代替監造核定。
3. `work_item_pricing_basis_guard` 只驗工項屬本案：服務憑證可直接把工項標 `excluded` 或改 `pro_rata` 規則，而計價依據決定可估驗上限的算法。

**根本解（migration `20260920230000_edge_credential_writer_seal`，比照 P4e 的做法：所有寫入者一體適用、只認交易內 GUC `pmis.cq_internal`）**：確認量 guard 的 INSERT 一進來就要 `fn_cq_internal()`（放在所有內容檢查之前——不是簽發路徑就一律拒絕，不看內容是否「看起來合法」）、active→revoked 也要；三個合法寫入者（`issue_supervisor_certificate`、`revoke_inspection_confirmation`、`field_document_sign_inspection_form_internal`）各自只在「那一句 insert／update」前後開關旗標（與它們後半段同步草稿期的做法相同，異常時隨子交易回滾不外洩）；`valuations_guard` 對非登入者且無旗標：INSERT 不得帶非草稿狀態，UPDATE 不得改 `status`／`invoice_date`／`paid_date`／`paid_amount`，非草稿期不得改期別欄位；`work_item_pricing_basis_guard` INSERT／UPDATE／DELETE 都要旗標（DELETE 只放行工項／專案 cascade）、`set_work_item_pricing_basis` 在 upsert 前後開關旗標。登入者的既有規則逐字不變；歷史遷移與 pgTAP fixture 以 DBA 邊界（交易內 `set local pmis.cq_internal='1'`）重現——`confirmed_quantity_enforcement`／`confirmed_quantity_concurrency` 的直寫 fixture、七個直接建非草稿期別的 fixture、e2e-real chain 11b 的 DBA 區塊同步改在旗標內；`payment_flow` 原本「service role 放行清理矛盾資料」改為「不開旗標 `VQ010`、旗標內放行」，`confirmed_quantity_enforcement` 的「superuser 可補歷史期截止日」同樣改成旗標內才可。服務憑證拿不到旗標：`fn_cq_set_internal` 雖可被 service_role 執行，但 PostgREST 每個 request 一個交易、`set_config(…, true)` 只活在該交易，chain 20 以真 PostgREST 釘住「先開旗標再另一請求寫入仍 `VQ010`」。**設計文件差異**：`confirmed-quantity-valuation.md` §9 原寫 `valuations.status` 直接 REST「保留可寫（相容）」與確認量「service role 也經 guard（不變量檢查不看 `auth.uid()`）」——後者對「誰在寫」沒有檢查，前者對非登入者沒有狀態機；§9 兩列與新 §21 已改寫。

**測試補完（逐條對應 E 包缺口）**
- (a) chain 22（新）：逾期（列「逾期 3 日」、首頁「現在輪到我」）、改期（改開工日留第 2 版、`effects` 記 `rescheduled` 舊→新到期、時程列新到期日；監造改基準日被 RPC 拒）、已完成（完成時間與到期日快照、取消完成清空）、廢止（`superseded` → 義務不適用、所有待辦期次不適用、時程不列）。
- (b) `send-reminders` 流程本體純搬移到 `_shared/sendRemindersRun.ts`（全部外部效應以 `SendRemindersDeps` 注入；閘門判定仍與 RPC 呼叫同在真實 deps `_shared/sendRemindersDeps.ts`，`gatePolicy.test.ts`／`errorLeak.scan` 的釘子跟著搬）；Deno 單元測試 10 條：角色分流、跨案隔離（同一位廠商在 A、B 兩案各收各的）、dry 不寄不記、非 dry 只寄給有事的人且 payload（from／to／主旨／HTML）逐字、沒金鑰不寄、Resend 失敗不計入、閘門 false／查詢失敗／null 三種擋法與記帳、收集失敗只影響該案、`listProjects` 失敗回 500 遮罩碼、試體齡期、`x-cron-secret`、`sendViaResend` 的 HTTP 形狀。真後端 chain 22 以 `?dry=1` 對隔離棧驗三方角色分流與完成／廢止後消失。**送信本身未在真後端驗**：`send-reminders` 走 Resend HTTP API 不走 SMTP，本機 inbucket 收不到；真寄需要真金鑰與真收件人（禁止），dry-run 與單元測試已涵蓋除「Resend 實際收到」以外的每一步。
- (c) chain 20（新）＋pgTAP `edge_credential_writes.sql` 50 條：service_role／superuser 直寫矩陣（明細、來源、調整、確認量 insert／revoke／delete、期別狀態 insert／update、請款／撥款、計價依據）、十四支寫入 RPC 以服務憑證呼叫、旗標跨請求無效、合法路徑照常且旗標用完即還原、旗標不放寬內容檢查。另補 `edgeWriteAllowlist.scan.test.ts`：Edge 寫得到的表與可呼叫的 RPC 改成**允許清單**（草稿／辨識結果／批次進度／建議／run 記錄九張表、八支查詢與記帳類 RPC），判定、簽署、提送、事實表這些沒被任何禁單列到的表一律越界；掃描器與 P4e／F1 共用 `tests/lib/edgeWriteScan.ts`（新增 `listWriteTargets`）。
- (d) chain 4 第二段：有效確認量擋「清空重匯」（橫幅指明工項與「請先撤銷確認」、RPC 直打 `VQ010`、資料原封不動）→ 監造撤銷後才可清空（撤銷後不再擋、隨工項 cascade，稽核三筆留痕）。
- (e) chain 21（新）：本機 stub 多一個情境，回傳值逐字取自真實模型對 `LINE_A~4_0.JPG` 的實際輸出（`visionStub.test.ts` 與 `vision-after-b2.json` 逐字比對釘住；只挑這張的理由見 `visionStub.ts` 檔頭），以 `tinyJpeg` 尾巴標記選情境。驗到的是產品在真實資料下的正確行為：紙上日期進文件日期、分類猜的位置沒有原文佐證不落地、兩向尺寸＋兩個編號 → `pending`＋兩筆證據＋不給提示值、`PD004`、頁面證據面板、人填後簽署落庫且 `check_date` 是紙上日期。**stub 與真實模型分開報**：stub 只證明流程接得起來；真實抄錄率仍是 B2 那張表。
- chain 3：失敗訊息第一行寫判定（`classifyExtractionFailure` 讀 `metadata.error_code`／`failed_batch.code`），runbook 新增「chain 3 紅燈判讀」表；不重試、不放寬斷言。

**驗證**：`npm test` 163 檔 1,837 項（新增 `sendRemindersRun`／`visionStub` 情境／`edgeWriteAllowlist` 掃描；`gatePolicy`／`errorLeak` 釘子改對應新檔）；`test:edge` 27 項（新 10）；`check:edge` 18 支；`lint`／`build`／`check:docs`（58 檔 484 連結 0 錯）綠。`test:db` 本機最後一次全綠 **63 檔 3,657 項**（rebase 到含 F1 的 main 之前；新增 `edge_credential_writes.sql` 50、`confirmed_quantity_enforcement` 307→309、`payment_flow` 11→12），rebase 後由 PR CI 重跑。真後端（本機隔離棧，rebase 前）：chain 20 通過、chain 4 兩段通過；chain 21／22 首跑各紅一處（fixture：`requirements.frequency_config` NOT NULL；stub 情境精簡前的第二張）已修正、**尚未重跑**——本機 colima 資料目錄在主機重開後消失（`~/.colima → /Volumes/GameSSD/MacStorage/ryanxhuang/.colima`，該目錄不存在、容器無法啟動），重建 VM 屬使用者環境決定，留待環境恢復後重跑 chain 21／22／11／3 與全套。

**合併與部署（2026-09-21，使用者決定先合併再重建 colima）**：PR #174 merge commit `0aa7fa6`（CI／pgTAP 皆綠：pgTAP 64 檔 3,679 通過，含 F1）；正式 `supabase db push` 套 `20260920230000`（`migration list --linked` 88 筆對齊、無待套）；正式庫唯讀核對七支函式皆含 F2 檢查、`work_item_pricing_basis_guard` trigger 含 delete，確認紀錄 0 列、期別 12 列（已核定 4／監造審核 1／草稿 7）未動；Edge `send-reminders` v25（`verify_jwt=false`）、`draft-field-documents` v15 以 `--use-api` 重佈；`check:prod` 五頁 OK。**三個服務憑證守衛缺口已修並上線。真後端 chain 21／22 狀態是「已寫、未驗」**（修正後尚未重跑；本機 colima 重建後依 runbook 補跑 chain 20／21／22／4／11／3 與全套，再把實跑結果補回這裡），不得當作通過。

**環境恢復後實跑（2026-09-21，colima 以 `--mount /Volumes/GameSSD:w` 重建、全新本機 DB 88 支 migration；PR #176）**：六條鏈 chain 20／21／22／4／11／3 全綠後跑全套 `E2E_REAL_PORT=5389 npm run test:e2e:real`：**26 項＝25 通過＋1 紅**（chain 3 live：紅燈第一行即判定 `[模型輸出不完整][error_code=no_requirements]`，`failed_batch b0`、`batches_total 1`——正是 E 包記錄的非決定性；依 runbook 只手動重跑一次，7.9 s 綠，全套其餘 25 項一次通過）。chain 21／22 從「已寫、未驗」改為**通過**。這一輪修的都是測試本身、沒有動產品：chain 22 多列 insert 時 supabase-js 會把缺鍵的列補成 `null`（`trigger_config` NOT NULL）→ fixture 補 `trigger_config: {}`；chain 22 預設選中的是**最逾期**的那一條（每月 10 日循環的本月期次），不是 3 天前的固定期限——斷言改釘產品規則「預設選第一條已逾期」；chain 22 已確認的契約重點不在擷取審核預設快篩，改走 `?highlight=<id>` 深連結（與 chain 19 同）；chain 21 表頭日期以民國年呈現（`115 年 8 月 4 日`）、日期來源綁照片（`whiteboard:<photo_id>`）、「原文」按鈕要點 A1 那一列的；chain 3 主內容區有兩個「擷取審核」連結（頁首動作與子頁分頁條）偶發 strict mode 撞，改明確點「Link 包 Button」的頁首動作；`file-viewing` 進頁立刻 `setInputFiles` 會在 `packagesLoading` 期間被上傳 handler 靜默丟掉（`Contract.jsx:368`，trace 裡零請求），在較慢的 VM 上每次都中——改成與 chain 3 同一組就緒守門並先斷言列出現，live 模式的終態等待對齊產品預算（`REQUEST_ABS_CAP_MS` 140 s）。

**未做／待驗（如實）**：`send-reminders` 的 Resend 實際投遞未驗（上述）；chain 21 只涵蓋 `pending`＋證據路徑，`filled`／hint 路徑只有單元與 pgTAP；「多個符合截止日的草稿期取 `period_no` 最小」與「兩個監造同時簽發／trigger 自動分配 vs 手動 sync 併發」仍無測試（E 包列，本包未做）。
