# 雙引擎同步清單(demo 本地判定 ↔ 伺服器權威判定)

> 狀態：**ACTIVE CHECKLIST** ｜ 建立：2026-07-16。demo 模式(未設 Supabase)所有判定跑前端本地引擎;
> 真專案的同一判定下沉到 DB trigger / Edge Function。**兩邊規則改版必須同步**,
> 否則銷售 demo 展示的行為會與正式版不符。改任何一側前先對照此表。

## 成對清單

| # | 判定 | demo/前端引擎 | 伺服器權威 | 同步保證 |
|---|------|--------------|-----------|---------|
| 1 | 自主檢查表量化判定 | Demo 與真實前端都呼叫 `src/lib/qc.js` `judgeChecklist` | DB 保存前端送入的 `results/overall`；`checklist_records_guard` 只保護修訂鏈，不重算判定 | ✅ 前端共用同一純函式；伺服器沒有第二份判定實作 |
| 2 | 試體 28 天抗壓判定+自動開缺失 | `src/lib/qc.js` `deriveTestSampleUpdate`／`shouldCreateTestSampleDefect` + `quality.js` demo 分支 | `judge_test_sample`／`test_sample_defect` trigger(`20260712001600_evidence_guards.sql`) | W5-4 已用 Vitest＋整合回歸釘住「同步判定、保存 `test_sample_id`、不重複開」；0.85fc′／平均門檻仍人工同步 |
| 3 | 檢查表修訂鏈 rev/root_id | `quality.js createChecklistRecord` demo 分支本地計算 | DB guard 依鏈計算(前端真專案不算,寫入後 reload 取回) | 無自動保證,**人工同步** |
| 4 | 契約義務到期日計算 | `src/lib/contractDue.js` | `supabase/functions/_shared/contractDue.ts`(send-reminders 用) | ✅ `contractDue.test.ts` 與前端**同一組測試案例**對齊 |
| 5 | 今日待辦／提醒彙整規則 | `src/lib/todayTasks.js`(W8-2B 起;Dashboard 與 `Alerts.jsx` 共用同一支,前端只有這一份) | `_shared/agentTools.ts` 的 `collectOpenBallItems`(`list_my_open_items` 工具與 `send-reminders` 早報共用) | 無自動保證,**人工同步**;前端規則有 `todayTasks.test.js` 釘住,兩側**已知差異**見下方 |
| 6 | 預定進度 smoothstep S 曲線 | `billing.js generateSchedule` | —(demoSeed.js 複製同公式產 demo 資料) | 無自動保證,**人工同步** |
| 7 | 角色權限矩陣(can) | `store.jsx` 的 `can` useMemo | RLS 分角色 policy + guard triggers + `admin_override()`(formal_mode) | E2E 蓋部分(路由守衛/核定流);矩陣全表靠 pgTAP |
| 8 | 金流三欄順序(請款→收款→實收) | `Payments.jsx` 欄位鎖定邏輯 | `valuations_payment_gate` trigger(`20260712001800_payment_flow.sql`) | pgTAP 蓋 trigger;UI 鎖僅體驗,權威在 DB |
| 9 | 估驗狀態轉移權限 | `Valuation.jsx` 按鈕顯示(can.approve 等) | `valuations_guard` trigger | 同上 |

## 原則

- **權威永遠在伺服器**:前端/demo 引擎只是體驗(即時回饋、銷售展示);真專案的寫入
  一律由 DB trigger 做最終判定,前端寫入後 reload 取回權威結果(見 quality.js 註解)。
- **改規則的流程**:改 trigger → 跑 pgTAP → 對照此表改前端對應引擎 → 跑 vitest
  (qc.test.js 等)→ demo 站人工過一次該情境。
- 第 4 項(contractDue)的「共用測試案例」模式是理想型:改動另外幾對時,
  優先考慮把案例抽成兩邊共用的 fixture。

## W5-4 已處理的實際漂移

只修正一條已能重現的差異：正式 DB 在試體 28 天值寫入時同步判定，且同一 `test_sample_id` 最多建立一筆缺失；Demo 原本把判定結果暫存在 React state updater 內再立刻讀取，可能漏開缺失，後續重試又沒有試體連結可去重。現在判定改由同步純函式回傳，Demo 缺失保存 `test_sample_id` 並以純函式原子去重。

其餘清單項目目前沒有已重現漂移，因此 W5-4 不重構。未來只有在測試或真案驗收證明兩側結果不同時，才針對該條補純函式或共用案例。

## W8-2B 已處理與仍存在的第 5 項差異

已處理（前端側）：

- 前端原本有**兩套**待辦規則——`ballInCourt.js` 的協作項與 `Alerts.jsx` 內嵌的期限彙整，且後者完全不看球權。W8-2B 併成 `src/lib/todayTasks.js` 一支純函式，Dashboard 與提醒中心共用；協作項的組裝也收斂為 `ballInCourt.js` 的 `collaborationItems()`。
- `recordInspectionResult` 的 demo 分支補寫 `inspected_at`，與 DB 分支同欄位；否則「今天已完成」只在真後端看得到。
- 期限判斷一律先正規化成**台北日曆日的午夜**再交給 `sampleAlerts`／`acceptanceAlerts`／`computeObligationDue`；傳含時間的「現在」會讓 8 個日曆日被 `Math.round` 壓成 7（台北傍晚後開頁即重現）。`computeObligationDue` 因此新增可注入的 `today` 參數，每月重複義務不再讀系統時鐘。

**仍存在、需要人工留意的兩側差異**（W8-2B 邊界內不改 Edge Function，要對齊需另行核准）：

| 差異 | 前端 `todayTasks.js` | 伺服器 `collectOpenBallItems` |
|---|---|---|
| 涵蓋類型 | 疑義、送審、估驗、查驗、缺失、觀察、變更、契約義務、試體、驗收、ITP | 缺失、送審、疑義、估驗、契約義務（無查驗／觀察／變更／試體／驗收／ITP） |
| `responsible` 無法辨識時 | 視為未指定，**不歸任何角色** | 預設歸廠商 |
| 監造／機關責任的契約義務 | 不列為待辦（目的頁對該角色沒有完成動作） | 一律列入該方 |

因此網頁的今日待辦與每日提醒信目前不是同一份清單。改任一側前先回到這張表。

## 相關設計決策:切案清空與載入的 effect 順序(W-03)

`store.jsx` 的「切專案清空 state」與「載入新專案資料」是**刻意分開的三個 effect**:

1. 清空 effect(依 `currentProjectId`)註冊在最前 → React 依定義順序執行,保證清空先於載入;
2. `dbMode` 載入 effect 依賴 `wiMaps`(標單載完才 flip true),與 projectId 變更**不同時發生**——
   若合併成單一 effect,dbMode flip 會再觸發一次「清空」,把已載入的驗收/工安資料誤清;
3. 載入中切案由各 effect 的 `active` flag 取消,不會把前案資料寫進後案畫面。

結論:現行結構是正確解,**不要**為了「看起來乾淨」合併它們。
