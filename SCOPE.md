# PMIS — 現況與路線圖

> 更新:2026-07-01。本文件是**唯一的現況/路線圖文件**;功能與架構細節見 [README.md](README.md),
> 長期產品願景(GC↔監造協作、Contract-First)見 [PRD.md](PRD.md)(部分內容屬早期 prototype 規劃,
> 與現行程式不完全對應,見該文件開頭說明)。

---

## 1. 現況:已完成(main 分支,已部署 GitHub Pages)

**定位**:台灣公共工程**施工廠商**的 Web PMIS。PCCES 標單(BOQ)是脊椎,
成本/進度/品質/工安全部掛在同一棵工項樹上。多租戶,Supabase RLS 隔離。

| 線 | 已完成 |
|---|---|
| BOQ 脊椎 | PCCES XML 瀏覽器內解析 → 3,000+ 工項樹入庫(`/boq`) |
| 成本進度 | 施工日誌+AI 白板辨識(`/site-log`)→ 估驗計價自動彙總(`/valuation`)→ 請款收款(`/payments`)→ S 曲線(`/progress`)/ 逐工項排程(`/schedule`)/ 成本毛利(`/cost`)/ 估驗計價單列印(`/valuation/print`) |
| 變更 | 變更設計/追加減帳(`/change-orders`,含明細與變更後契約金額) |
| 品質工安 | 三級品管、查驗不合格自動開缺失(`/quality`);工安四類紀錄(`/safety`) |
| 契約 | AI 解析契約時程義務+罰則(`/contract`);提醒中心彙總逾期(`/alerts`) |
| 報表 | 自動施工月報(`/monthly-report`);各清單 CSV 匯出(UTF-8 BOM) |
| 後端 | 單一份 idempotent schema、全表 RLS、2 個 SECURITY DEFINER RPC、2 個 Edge Functions(gpt-4o) |
| 工程地基 | vitest 測試(boqCalc / contractDue / parsePcces / dates / changeOrders + Edge Function 共用邏輯,37 tests)+ GitHub Actions CI(test+build) |

原「廠商優先」路線 P1–P6(請款收款、提醒中心、成本分包、逐工項排程、報表匯出、工安)**全部落地**。

---

## 2. 已知缺口(依影響排序)

1. ~~**變更設計未回饋下游**~~ — 已做(2026-07-02):`src/lib/changeOrders.js`
   (只認「核准」;連結工項的明細把數量/金額差套回工項樹,未連結的新增項目只進總額),
   估驗/S 曲線/計價單/成本收入的分母改用變更後契約金額。已在 demo 模式驗證。
2. **角色權限未落地** — schema 有 `org_type`/`role`,估驗有送審→監造審核流程,
   但 UI 未依角色限制動作;多人協作前必補。
3. ~~**提醒是被動的**~~ — 已做(2026-07-01):`send-reminders` Edge Function 每日彙整
   逾期/7 日內到期事項寄 email 給專案成員(Resend + pg_cron,見 supabase/SETUP.md §6);
   **待部署**(deploy + secrets + cron.sql)。
4. **月報/估驗缺公定格式輸出** — CSV 交不出去;月報需比照估驗計價單做 print/PDF。
5. **store.jsx 單一 context(1,000+ 行)** — 任何寫入全 app rerender;每加模組都在惡化,
   中期需按領域拆分或 memo 重算。
6. ~~**日期字串解析時區風險**~~ — 已修(2026-07-01,commit `4a1bea8`):共用
   `src/lib/dates.js` 的 `parseLocalDate`,全 UI 統一。

---

## 3. 短期路線(下一步,已定)

1. ✅ **提醒推播** — 已做(2026-07-01):每日 email 彙整(僅在有逾期/即將到期時寄,
   純待處理不打擾)。部署步驟見 supabase/SETUP.md §6。
2. **月報/估驗公定格式輸出** — 對齊公共工程表格的 print/PDF。最直接省時、最好賣的 demo 點。
3. ✅ **變更設計下游連動**(缺口 #1)— 已做(2026-07-02),見上。

做完 1–2 即可拿去給真實廠商試用,以回饋決定第 4 節方向。

---

## 4. 方向選項(未拍板,待真實用戶回饋)

| 方向 | 內容 | 驗證什麼 | 風險 |
|---|---|---|---|
| A. 監造協作 | 查驗申請/監造查驗/送審 Submittal/RFI/ITP 停留點(見附錄) | 「平台」價值 | 要兩邊組織都上車才閉環 |
| B. iOS 現場 App | 原生 SwiftUI、離線優先、白板辨識自動填表 | 現場工程師的日常黏著 | 開發面寬 |
| C. 深化廠商 Web | 角色權限、分包商對帳、試驗管理 | 單邊付費意願 | 差異化較弱 |

---

## 附錄:GC↔監造 協作規劃(方向 A 的設計存檔)

> ⚠️ 本附錄整理自 2026-06 的早期 prototype 規劃。該 prototype(`/m/daily-log`、`/submittals`、
> `/rfi` 等路由)已於 commit `5ae5591` 移出 codebase——**下述內容目前皆未實作**,
> 保留作為方向 A 的設計參考。

### A.1 物件關係鏈(Contract-First)

```
契約 / 規範 (Document)
  └─ AI 解析 → Requirement(人工審核後生效)
       └─ ITP 檢驗停留點(W 見證 / H 停留 / R 文審)
            └─ Form Template(自主檢查表 / 監造查驗表)
                 └─ 自主檢查 → 查驗申請 → 監造查驗
                      └─ 缺失(不合格自動建立)→ 改善 → 複查 → 結案
  ├─ 送審 Submittal(材料 / 施工計畫 / 配比 / 樣品)
  ├─ RFI 工程疑義(正式、編號、可標工期/費用影響)
  └─ 試驗 Test(取樣 → 送驗 → 報告 → 合格判定)
```

**ITP 是結構關鍵**:回答「這個工項什麼時候必須通知監造」;H(停留)點=監造未到場不得續作。

### A.2 權限矩陣(核心規則)

兩個組織、5 個角色。**施工可提送/改善,但不能核准或結案自己的東西;
核准查驗、開立/結案缺失、核准送審只有監造能做。**
(完整矩陣見 PRD §12。)

### A.3 資料物件速寫

- **ITP**:`requirement_id、work_item、point_type(W/H/R)、acceptance_criteria(AI 從規範抽)、frequency、來源條文`
- **Submittal**:`type、revision、review_comments[]、status(Submitted→Under Review→Approved | Approved as Noted | Revise & Resubmit | Rejected)`,採 ball-in-court
- **RFI**:`question/answer、assigned_to、cost_impact、schedule_impact、due_date、status(Open/Answered/Closed)`
- **Test**:`test_type、sample_no、required_frequency、lab、report、acceptance、status(取樣/送驗/報告待回/合格/不合格)`

### A.4 跨模組串接(One Record → Many Outputs)

- 監造查驗不合格 → 自動建缺失 + 入監造日報 + Audit
- ITP 的 H 點 → 觸發「該叫監造」任務
- Submittal 核准 →(可選 gating)解鎖該工項可開查驗
- 報表中心 = 對以上物件做日期區間聚合
