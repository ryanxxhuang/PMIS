# 球權與今日待辦

> CURRENT｜2026-09-11。從單據狀態推導下一個動作者，不另建 task 資料表或工作流程引擎。

## 單據判斷

[前端 ballInCourt](../../src/lib/ballInCourt.js) 有 RFI、送審、估驗、缺失、變更、查驗、觀察七支純函式；[Edge](../../supabase/functions/_shared/ballInCourt.ts) 有前四支。輸出 who／label，完成為 done。觀察 assigned_to 是自由文字，非三方值不納入某一方待辦；設計不是第四角色。

| 單據 | 未結時下一方 |
|---|---|
| RFI | 待回覆→監造；已回覆→廠商確認結案 |
| 送審 | 已提送／審核中→監造；退回補正→廠商 |
| 估驗 | 草稿→廠商；審核→監造；核定未請款→廠商；已請款未撥款→機關 |
| 缺失 | 開立／改善中→廠商；待複查→監造 |
| 變更 | 提出→監造；審核中→機關 |
| 查驗 | 待查驗→監造 |
| 觀察 | 待處理→assigned_to，缺值→廠商 |

估驗球權還看 invoice_date／paid_date；廠商請款導 `/payments`。collaborationItems 唯一組裝全案未結協作項；myOpenItems 只做角色篩選供 AI facts。無使用者的 tallyBalls／design 桶已移除。

## 前端三桶

[todayTasks](../../src/lib/todayTasks.js) 的 buildTodayTasks 回 mine／waiting／doneToday：

- 協作項依 who 歸 mine，waiting 只收 WAITING_SCOPE 白名單的對方事項。
- 契約義務目前只收廠商／監造，責任採精確白名單；排除已提送／完成／不適用，有到期日且 7 天內才進 mine。
- 試體／ITP／施工已開始但未填的今日日誌屬廠商；驗收期限依 stage 的角色白名單。
- doneToday 只收系統時間戳 closed_at／inspected_at，依完成方過濾，不使用可回填業務日期；現行廠商／機關因此沒有此類完成項。

輸入沒有 agent_actions 或未確認 Requirement，不把 AI 草稿當人工待辦。mine／waiting 依到期升冪、無日期最後；doneToday 依操作時間降冪。先正規化台北日曆日，useTodayTasks 每次 render 取日期，不在模組啟動時凍結今天。

## Edge／早報

collectOpenBallItems 依專案查缺失、送審、RFI、估驗、待辦義務與基準日。Agent 用 caller JWT，obligationSoonDays=0、依 my_org_type 篩選後最多 30 筆；早報用 service role，obligationSoonDays=7，另加試體齡期並逐成員篩選，只有逾期／即將到期才寄。

service role 沒有 RLS，每筆查詢的 project_id 是跨案隔離關鍵。無法辨識 responsible 時 Edge 預設廠商，前端不歸任何方；全部差異集中 [雙引擎](dual-engine-sync.md)。早報 pending 是我方無期限項，不是首頁 waiting 的等對方。

## 呈現合約

TaskRow 為首頁／提醒中心共用列；dueText 的逾期句「逾期 N 天（到期 YYYY-MM-DD）」與 TaskRow.OVERDUE_RE、Quality 工作佇列及 E2E 相互依賴，改措辭須同步。履約時程使用「日」、早報另有句型，沒有全站同句的保證。

navConfig 的 BALL_SOURCES 用 `/dashboard`、`?ball=waiting`、`?ball=done`；resolveBallKey 未知值回 mine。Layout／Dashboard 共用 query，單次只顯示一桶。側欄件數、通知紅點與頁面從 useTodayTasks 取得；aria-current 明確選一個來源，不只比 pathname。

## 驗證

[球權](../../src/lib/ballInCourt.test.js)、[待辦](../../src/lib/todayTasks.test.js)、[hook](../../src/lib/useTodayTasks.test.js)、[早報](../../supabase/functions/_shared/agentBrief.test.ts) 與三角色 E2E。此層沒有修改 DB 授權；尚無兩端球權的共用 fixture，改規則需對照雙引擎表。
