# 球權與今日工作

> CURRENT｜2026-09-17。從單據狀態推導下一個動作者，不另建 task 資料表或工作流程引擎。P5a 起首頁、Agent 與早報共用同一份判定實作與同一組測試案例。

## 單一實作

判定規則只有一份：[`_shared/ballInCourtRules.ts`](../../supabase/functions/_shared/ballInCourtRules.ts)（零 import 的純 TS）。放在 `supabase/functions/_shared` 是因為 Edge 部署只打包該目錄，而 Vite 可以 import repo 內任何路徑；前端 [ballInCourt.js](../../src/lib/ballInCourt.js) re-export 它並只加路由，Edge [ballInCourt.ts](../../supabase/functions/_shared/ballInCourt.ts) 只負責查表、綁定本案與逾期天數。`agentToolWhitelist.scan.test.ts` 把它列為唯讀模組。

共用案例 [`tests/fixtures/ball-in-court.cases.json`](../../tests/fixtures/ball-in-court.cases.json) 由三支測試同讀：前端路徑 [ballInCourt.cases.test.js](../../src/lib/ballInCourt.cases.test.js)（collaborationItems、buildTodayTasks 三桶＋待補設定）、Edge 路徑 [ballInCourt.cases.test.ts](../../supabase/functions/_shared/ballInCourt.cases.test.ts)（collectOpenBallItems、list_my_open_items、早報分段）、Deno 執行期 [ballInCourtRules.deno.test.ts](../../supabase/functions/_shared/ballInCourtRules.deno.test.ts)（`npm run test:edge`，CI 一併跑）。改規則先改案例，三側同時紅。

## 單據判斷

七支單據判定加現場文書；輸出 who／label，who 為三方、`unassigned`（責任推不出三方→待補設定）或 done。設計不是第四角色。

| 單據 | 未結時下一方 |
|---|---|
| RFI | 待回覆→監造；已回覆→廠商確認結案 |
| 送審 | 已提送／審核中→監造；退回補正→廠商 |
| 估驗 | 草稿→廠商；審核→監造；核定未請款→廠商；已請款未撥款→機關 |
| 缺失 | 開立／改善中→廠商；待複查→監造 |
| 變更 | 提出→監造；審核中→機關 |
| 查驗 | 待查驗→監造 |
| 觀察 | 待處理→assigned_to 為三方值歸該方；缺值→廠商；其他文字→待補設定 |
| 現場文書 | draft 待簽署／pending_input 待補欄位／in_review 待同方核對／signed 待提送／returned 被退回待補正→責任方 `owner_org`；submitted／received→目前版本已提送且尚未收件或退回的 `to_org` 各一顆「待收件」；都收件或 discarded／superseded→done |
| 契約義務 | responsible 精確白名單（去頭尾空白）→該方；null／空／其他／未知→待補設定（責任方）；責任明確但觸發點對應的基準日沒填→待補設定（基準日）；已提送／已完成／不適用→done |

估驗球權還看 invoice_date／paid_date；廠商請款導 `/payments`。核心事項的形狀是兩側交集 `{ id, who, tag, title, status, meta, due }`（coreOpenItems）；前端 collaborationItems 再加 `to`，Edge 再加 `overdue_days`。現場文書直達 `/site?doc=<id>`（P2c 接文件頁後定位）。

## 待補設定

責任推不出三方、或基準日缺失而推不出到期日的事項，不歸任何一方、不算任何人的件數，改列「待補設定」讓三方都看得到並有處理入口：首頁「現在輪到我」下方一張卡、Agent 工具回 `setup_pending`、早報另成一段（不觸發寄信）。責任方缺口導到擷取審核該筆（已確認內容不可改，廢止取代後補登；義務 id 就是 requirement id）；基準日缺口導到期限追蹤的基準日卡。DB 同一條規則：`obligation_party()` 對三方以外回 null（migration `20260917213502`），update policy 因此對三方都不放行，只剩非正式模式的 admin override；前端 `obligationParty` 回「待補設定」，履約時程對三方可見但不可操作。

## 前端三桶

[todayTasks](../../src/lib/todayTasks.js) 的 buildTodayTasks 回 mine／waiting／doneToday／setup：

- 協作項依 who 歸 mine，waiting 只收 WAITING_SCOPE 白名單的對方事項；現場文書另限該類文書的當事方（FIELD_DOC_PARTIES）。
- 契約義務收廠商／監造／機關，責任採共用規則的精確白名單；未結由 isObligationOpen 決定（已提送／完成／不適用以外都算），有到期日且 7 天內才進 mine；待補設定進 setup。
- 試體／ITP／施工已開始但未填的今日日誌屬廠商；驗收期限依 stage 的角色白名單。
- doneToday 只收系統時間戳 closed_at／inspected_at，依完成方過濾，不使用可回填業務日期；現行廠商／機關因此沒有此類完成項。

輸入沒有 agent_actions 或未確認 Requirement，不把 AI 草稿當人工待辦。mine／waiting 依到期升冪、無日期最後；doneToday 依操作時間降冪。先正規化台北日曆日，useTodayTasks 每次 render 取日期，不在模組啟動時凍結今天。現場文書由 store 在真專案載入（`loadFieldDocumentsFromDB`：未終態文件＋目前版本提送列，分頁）；demo 尚無種子。

## 操作入口（2026-09-14）

首頁每次 20 件，可搜尋、類型／期限篩選及原地顯示更多；不再以五筆截斷後跳提醒中心。「今天已完成」仍只用既有可靠時間戳，頁面明示涵蓋範圍並連到活動紀錄。

協作項以原單據 id 深連結：查驗 `?inspection=`、觀察 `?observation=`、試體 `?sample=`、ITP `?point=`；估驗與付款以 `?period=` 選期。既有疑義／送審／缺失／變更／契約連結維持。沒有 id 時退回頁面入口，不產生假 id。日誌／驗收仍為頁面入口。單據狀態及三方權責不變，僅改善定位及返回動線。

## Edge／早報

collectOpenBallItems 依專案查缺失、送審、RFI、估驗、查驗、變更、觀察、現場文書（＋目前版本提送列）、未廢止義務與基準日，全部交給共用規則判定。Agent 用 caller JWT，obligationSoonDays=0、依 my_org_type 篩選後最多 30 筆，另回 `setup_pending`；早報用 service role，obligationSoonDays=7，另加試體齡期並逐成員篩選，待補設定三方都收到但只有逾期／即將到期才寄。

service role 沒有 RLS，每筆查詢的 project_id 是跨案隔離關鍵；提送表沒有 project_id，只以本案文件的 id 清單查。責任不明兩側都不歸任何方（P5a 前 Edge 預設廠商的差異已消除）；剩餘的呼叫端差異（soonDays）見 [雙引擎](dual-engine-sync.md)。早報 pending 是我方無期限項，不是首頁 waiting 的等對方。

## 呈現合約

TaskRow 為首頁／提醒中心共用列；dueText 的逾期句「逾期 N 天（到期 YYYY-MM-DD）」與 TaskRow.OVERDUE_RE、Quality 工作佇列及 E2E 相互依賴，改措辭須同步。履約時程使用「日」、早報另有句型，沒有全站同句的保證。

navConfig 的 BALL_SOURCES 用 `/dashboard`、`?ball=waiting`、`?ball=done`；resolveBallKey 未知值回 mine。Layout／Dashboard 共用 query，單次只顯示一桶。側欄件數、通知紅點與頁面從 useTodayTasks 取得；aria-current 明確選一個來源，不只比 pathname。

## 驗證

共用案例三側（見「單一實作」）、[球權](../../src/lib/ballInCourt.test.js)、[待辦](../../src/lib/todayTasks.test.js)、[hook](../../src/lib/useTodayTasks.test.js)、[早報](../../supabase/functions/_shared/agentBrief.test.ts)、[履約時程規則](../../src/lib/obligationTimeline.test.js)、pgTAP [`obligation_party_unassigned.sql`](../../supabase/tests/obligation_party_unassigned.sql) 與三角色 E2E。
