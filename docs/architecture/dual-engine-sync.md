# 雙引擎同步清單(demo 本地判定 ↔ 伺服器權威判定)

> W-04(2026-07-16)。demo 模式(未設 Supabase)所有判定跑前端本地引擎;
> 真專案的同一判定下沉到 DB trigger / Edge Function。**兩邊規則改版必須同步**,
> 否則銷售 demo 展示的行為會與正式版不符。改任何一側前先對照此表。

## 成對清單

| # | 判定 | demo/前端引擎 | 伺服器權威 | 同步保證 |
|---|------|--------------|-----------|---------|
| 1 | 自主檢查表量化判定 | `src/lib/qc.js` `judgeChecklist` | `checklist_records` trigger(`20260712001700_checklist_revisions.sql`) | 無自動保證,**人工同步** |
| 2 | 試體 28 天抗壓判定+自動開缺失 | `src/lib/qc.js` `judgeConcrete` + `quality.js` demo 分支 | `test_samples` trigger(`20260712001400_unified_defect_engine.sql`) | 無自動保證,**人工同步** |
| 3 | 檢查表修訂鏈 rev/root_id | `quality.js createChecklistRecord` demo 分支本地計算 | DB guard 依鏈計算(前端真專案不算,寫入後 reload 取回) | 無自動保證,**人工同步** |
| 4 | 契約義務到期日計算 | `src/lib/contractDue.js` | `supabase/functions/_shared/contractDue.ts`(send-reminders 用) | ✅ `contractDue.test.ts` 與前端**同一組測試案例**對齊 |
| 5 | 提醒中心彙整規則 | `src/pages/web/Alerts.jsx` | `send-reminders` 的 `collectAlerts`(伺服器版) | 無自動保證,**人工同步**(兩處都有互相指涉的註解) |
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

## 相關設計決策:切案清空與載入的 effect 順序(W-03)

`store.jsx` 的「切專案清空 state」與「載入新專案資料」是**刻意分開的三個 effect**:

1. 清空 effect(依 `currentProjectId`)註冊在最前 → React 依定義順序執行,保證清空先於載入;
2. `dbMode` 載入 effect 依賴 `wiMaps`(標單載完才 flip true),與 projectId 變更**不同時發生**——
   若合併成單一 effect,dbMode flip 會再觸發一次「清空」,把已載入的驗收/工安資料誤清;
3. 載入中切案由各 effect 的 `active` flag 取消,不會把前案資料寫進後案畫面。

結論:現行結構是正確解,**不要**為了「看起來乾淨」合併它們。
