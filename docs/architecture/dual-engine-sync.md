# 雙引擎同步清單(demo 本地判定 ↔ 伺服器權威判定)

> ACTIVE｜2026-09-11。改任一側前查本表，Demo 不等於伺服器驗收。

## 成對清單

| # | 判定 | demo/前端引擎 | 伺服器權威 | 同步保證 |
|---|------|--------------|-----------|---------|
| 1 | 自主檢查表量化判定 | Demo 與真實前端都呼叫 `src/lib/qc.js` `judgeChecklist` | DB 保存前端送入的 `results/overall`；`checklist_records_guard` 只保護修訂鏈，不重算判定 | ✅ 前端共用同一純函式；伺服器沒有第二份判定實作 |
| 2 | 試體 28 天抗壓判定+自動開缺失 | `src/lib/qc.js` `deriveTestSampleUpdate`／`shouldCreateTestSampleDefect` + `quality.js` demo 分支 | `judge_test_sample`／`test_sample_defect` trigger(`20260712001600_evidence_guards.sql`) | W5-4 已用 Vitest＋整合回歸釘住「同步判定、保存 `test_sample_id`、不重複開」；0.85fc′／平均門檻仍人工同步 |
| 3 | 檢查表修訂鏈 rev/root_id | `quality.js createChecklistRecord` demo 分支本地計算 | DB guard 依鏈計算(前端真專案不算,寫入後 reload 取回) | 無自動保證,**人工同步** |
| 4 | 契約義務到期日計算 | `src/lib/contractDue.js`(單次:基準日＋偏移;已完成單次:讀 DB 留的 `due_date_snapshot`;循環:讀 `ob.periods` 最早未結一期) | `supabase/functions/_shared/contractDue.ts`(同);DB 端 `fn_obligation_single_due` 同一條規則供完成時留快照(P5c,`20260919021500`);循環期次本身由 DB `fn_obligation_period_schedule`＋materialize 確定性產生(P5b,`20260917233000`),兩側都不再從「今天」推算下一期 | ✅ `contractDue.test.ts` 與前端**同一組測試案例**對齊;快照優先與期次依據句由共用案例三側釘住;期次規則(月末夾住／閏年／跨年／季／年／週／日)、單次到期規則與停止條件由 pgTAP `obligation_periods.sql`／`project_anchor_versions.sql` 釘住,前端／Edge 只讀 |
| 5 | 今日工作／提醒彙整規則 | `src/lib/todayTasks.js`(W8-2B 起;Dashboard 與 `Alerts.jsx` 共用同一支,前端只有這一份);單筆球權判定 P5a 起直接 import `_shared/ballInCourtRules.ts` | `_shared/ballInCourt.ts` 的 `collectOpenBallItems`(`list_my_open_items` 工具與 `send-reminders` 早報共用),判定同樣 import `ballInCourtRules.ts` | ✅ **單一實作**＋共用案例 `tests/fixtures/ball-in-court.cases.json`(Vitest 前端路徑／Edge 路徑與 Deno 三側同讀);剩餘呼叫端差異只有 `obligationSoonDays`(首頁／早報 7、Agent 工具 0),見下方 |
| 6 | 預定進度 smoothstep S 曲線 | `billing.js generateSchedule` | —(demoSeed.js 複製同公式產 demo 資料) | 無自動保證,**人工同步** |
| 7 | 角色權限矩陣(can) | `store.jsx` 的 `can` useMemo | RLS 分角色 policy + guard triggers + `admin_override()`(formal_mode) | E2E 蓋部分(路由守衛/核定流);矩陣全表靠 pgTAP |
| 8 | 金流三欄順序(請款→收款→實收) | `Payments.jsx` 欄位鎖定邏輯 | `valuations_payment_gate` trigger(`20260712001800_payment_flow.sql`) | pgTAP 蓋 trigger;UI 鎖僅體驗,權威在 DB |
| 9 | 估驗狀態轉移權限 | `Valuation.jsx` 按鈕顯示(can.approve 等) | `valuations_guard` trigger | 同上 |

## 原則

- **權威永遠在伺服器**:前端/demo 引擎只是體驗(即時回饋、銷售展示);真專案的授權／狀態轉移由 DB 守護；表中第 1 項的數值判定仍在前端，不能宣稱 DB 全部重算,前端寫入後 reload 取回權威結果(見 quality.js 註解)。
- **改規則的流程**:改 trigger → 跑 pgTAP → 對照此表改前端對應引擎 → 跑 vitest
  (qc.test.js 等)→ demo 站人工過一次該情境。
- 第 4 項(contractDue)的「共用測試案例」模式是理想型:改動另外幾對時,
  優先考慮把案例抽成兩邊共用的 fixture。

## 第 5 項的剩餘差異（2026-09-17 P5a 後）

P5a 已消除的差異：單筆球權涵蓋類型（兩側同一支 `ballInCourtRules.ts`：疑義、送審、估驗、缺失、變更、查驗、觀察、現場文書）、`responsible` 無法辨識時的歸屬（兩側都是待補設定，DB `obligation_party()` 同步回 null）、義務「未結」的判定（兩側同用 `isObligationOpen`：已提送／已完成／不適用以外都算，第五種值兩側同樣列入）。以下是刻意保留、由呼叫端決定的差異：

| 差異 | 前端 `todayTasks.js` | 伺服器 `collectOpenBallItems` |
|---|---|---|
| 契約義務的到期窗口 | `SOON_DAYS=7`：逾期或 7 日內 | 呼叫端 `obligationSoonDays`：早報 7（同前端）、Agent 工具 0（只列逾期）——同一支 `obligationInWindow`，只差參數 |
| 前端獨有的期限型項目 | 試體、驗收、ITP 停留點、今日日誌 | 早報另加試體齡期（`testSampleItems`）；驗收／ITP／日誌不進 Agent 與早報 |
| 「等待對方」 | WAITING_SCOPE 白名單＋現場文書當事方 | 無此概念（早報 pending 是我方無期限項） |

首頁、Agent 工具與早報對同一測試資料產出相同核心事項、責任與期限（共用案例三側斷言）。改任一側前先改案例。

2026-09-17 P5b 起循環義務逐期：期次實例在 DB `obligation_periods`（依規則＋基準日確定性物化，冪等、只補不改；觸發＝義務插入／規則變更／廢止 trigger、`projects` 基準日變更 trigger、每日 pg_cron `pmis-obligation-periods`＋成員／service 可呼叫的冪等 RPC），前端與 Edge 以 embed 讀 `ob.periods`，共用規則 `obligationEntries` 對每個未結期次各出一顆球（舊逾期保留、完成本期不動下期），期次狀態只經 RPC `transition_obligation_period`（歸屬規則同義務；退回待辦解除證據）。義務本身自此不可再標已提送／已完成（guard），期次才是完成的單位；逐期準時率可由 `periodRows` 的每期 `onTime` 算（P5d 呈現）。

2026-09-19 P5c 起基準日版本：`projects` 基準日變更由 trigger 留版（`project_anchor_versions`，append-only）並在同交易重算受影響的循環義務——只動沒動過的待辦期（移除／新增／蓋新版號），已提送／已完成／掛證據的期保留原到期日與依據，差異寫進該版 `effects`；單次義務完成時留 `due_date_snapshot`，前端／Edge 的 `contractDue` 優先讀它。循環停止條件由 DB 決定產生到哪一期（實際竣工日 confirm／report 優先、否則契約竣工日；保固類不產生），前端／Edge 只以共用 `recurrenceStopGap`＋`completionDateOf`（`anchors.completion_date` 由驗收事件推得）把缺口說出來，不各自決定期次。前端改基準日只走 RPC `update_project_anchors`（附類別／依據／生效日）。

## 相關設計決策:切案清空與載入的 effect 順序(W-03)

`store.jsx` 的「切專案清空 state」與「載入新專案資料」是**刻意分開的三個 effect**:

1. 清空 effect(依 `currentProjectId`)註冊在最前 → React 依定義順序執行,保證清空先於載入;
2. `dbMode` 載入 effect 依賴 `wiMaps`(標單載完才 flip true),與 projectId 變更**不同時發生**——
   若合併成單一 effect,dbMode flip 會再觸發一次「清空」,把已載入的驗收/工安資料誤清;
3. 載入中切案由各 effect 的 `active` flag 取消,不會把前案資料寫進後案畫面。

結論:現行結構是正確解,**不要**為了「看起來乾淨」合併它們。

## 前端預定進度內插

`src/lib/progressPlan.js` 的 `plannedPctNow` 共用於 Dashboard、Progress、SupervisorReport、MonthlyReport 與 assistantData（Portfolio 自 P1b 縮為選案清單後不再計算進度；RiskAudit 頁於 P6b 移除）；`progressMonthIndex` 同時供圖表今日游標使用。月份起點為整數，日數按 30 天換算，超出範圍取 0／最後累計值；未設定或空月份回 null。呼叫端每次 render 傳入日期，不在模組內快取今天。此處保留既有瀏覽器當地日曆語意；當時 RiskAudit 的 start 改與其他五處同用 parseLocalDate，避免 UTC 以西掉回前月。S 曲線產生、台北日曆日的其他業務規則與伺服器 portfolio 計算均未改動。

驗證：`src/lib/progressPlan.test.js` 涵蓋插值、月界、跨年、閏日、空／單月與日期重算；可用不同 `TZ` 重跑。
