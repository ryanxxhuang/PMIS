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
| 成本進度 | 施工日誌+AI 現場辨識自動填單(`/site-log`,含公定格式欄位:天氣上下午/出工/機具/材料/安衛,公定格式列印 `/site-log/print`)→ 估驗計價自動彙總(`/valuation`)→ 請款收款(`/payments`)→ S 曲線(`/progress`)/ 逐工項排程(`/schedule`)/ 成本毛利(`/cost`)/ 估驗計價單列印(`/valuation/print`) |
| 變更 | 變更設計/追加減帳(`/change-orders`,含明細與變更後契約金額);上傳變更後 PCCES XML 自動 diff 產生追加減明細(`src/lib/coDiff.js`,2026-07-03) |
| 品質工安 | 三級品管、查驗不合格自動開缺失(`/quality`,含拍缺失照片 AI 填表 `describe-defect`);**自主檢查表**(範本量化標準→實測值自動判定→不合格自動開缺失→公定式列印 `/quality/checklist-print`,內建 03310 範本,`src/lib/qc.js`);**取樣試驗**(澆置日誌自動帶入試體組→7/28 天齡期到期入提醒中心+email→28 天值依 fc′ 自動判定);工安四類紀錄(`/safety`) |
| 契約 | AI 解析契約時程義務+罰則(`/contract`);提醒中心彙總逾期(`/alerts`) |
| 報表 | 自動施工月報(`/monthly-report`,含本月完成工項數量表+施工紀要+AI 檢討/下月計畫草稿);各清單 CSV 匯出(UTF-8 BOM) |
| 後端 | 單一份 idempotent schema、全表 RLS、2 個 SECURITY DEFINER RPC、2 個 Edge Functions(gpt-4o) |
| 工程地基 | vitest 測試(boqCalc / contractDue / parsePcces / dates / changeOrders + Edge Function 共用邏輯,37 tests)+ GitHub Actions CI(test+build) |

原「廠商優先」路線 P1–P6(請款收款、提醒中心、成本分包、逐工項排程、報表匯出、工安)**全部落地**。

---

## 2. 已知缺口(依影響排序)

1. ~~**變更設計未回饋下游**~~ — 已做(2026-07-02):`src/lib/changeOrders.js`
   (只認「核准」;連結工項的明細把數量/金額差套回工項樹,未連結的新增項目只進總額),
   估驗/S 曲線/計價單/成本收入的分母改用變更後契約金額。已在 demo 模式驗證。
2. ~~**角色權限未落地**~~ — UI 層已做(2026-07-05):store 提供 `can`
   (edit/submit=施工、approve=監造、readonly=機關;缺省=施工不擋單人試用)。
   **伺服器端 RBAC 已做(2026-07-09)**:RLS 按 org_type 分角色(機關唯讀、
   cost_items 連讀都限廠商)+ 8 個狀態轉移 trigger(核定/判定/結案/審定=監造、
   變更核准=機關/監造、已核定估驗與已核准變更明細凍結、org_type 提權防護)、
   delete_project 收緊 admin 限定;已套用線上並以 18 項權限矩陣實測(rollback)。
   **三方可安全共用同一專案了。**
   另補**整案資料匯出**(Dashboard 一鍵打包全模組 JSON,資料隨時拿得走)。
3. ~~**提醒是被動的**~~ — 全通(2026-07-05):RESEND_API_KEY 已設,實發驗證
   `emails_sent:1`;每日台北 08:00 全自動。多用戶前需在 Resend 驗證網域
   (計畫買 pmis.ai)並設 REMINDER_FROM,預設寄件者只能寄到帳號本人信箱。
4. **月報格式** — 查證後:工程會只有施工日誌/監造報表有全國公定格式,
   **施工月報無單一國定格式**(各機關自訂)。已補齊通行月報結構(2026-07-02):
   「本月完成主要工項數量」表(彙整自日誌)+「施工紀要」(施工天數/天氣)。
   剩:拿到目標機關實際範本後對齊欄位。
7. ~~**Supabase 服務受限(exceed_egress_quota)**~~ — 已解(2026-07-05):升級 Pro,
   服務全恢復;臨時測試帳號實測 RLS 隔離/註冊觸發器/提醒信 dry-run 全通過;
   HIBP 外洩密碼保護已開(Pro 限定)、每日備份運作中。egress 根因(auth 連鎖重抓)
   前端已修+快取,不會重演。
8. ~~**OpenAI API 額度用完**~~ — 已解(2026-07-05):四個 AI 函式全數遷移到
   **Claude API**(共用層 `functions/_shared/claude.ts`:強制 tool use=保證 JSON schema;
   Haiku 4.5 做視覺/短文、Sonnet 5 做長文件抽取),已部署+逐一實測通過:
   AI 現場辨識(合成告示板圖全欄位正確)、缺失照片(正確辨識非缺失照)、
   月報草稿(數據 grounded)、契約解析(節錄 8 條義務全中,含罰則/條款/保固年→天換算)。
5. **store.jsx 單一 context(1,000+ 行)** — 任何寫入全 app rerender;每加模組都在惡化,
   中期需按領域拆分或 memo 重算。
6. ~~**日期字串解析時區風險**~~ — 已修(2026-07-01,commit `4a1bea8`):共用
   `src/lib/dates.js` 的 `parseLocalDate`,全 UI 統一。

---

## 3. 短期路線(下一步,已定)

1. ✅ **提醒推播** — 已做+已部署(2026-07-02);剩 RESEND_API_KEY(見缺口 #3)。
2. ✅ **月報通行格式** — 已做(2026-07-02):工項數量表+施工紀要(見缺口 #4);
   機關範本到手後再對齊。
3. ✅ **變更設計下游連動**(缺口 #1)— 已做(2026-07-02),見上。

第二輪(2026-07-03,接續完成):
- ✅ **施工日誌公定格式** — 依工程會 101.10.17 格式:daily_logs 加
  weather_am/pm + labor/equipment/materials/extras(jsonb,已套用到線上 DB),
  日誌頁公定格式欄位區塊(出工/機具/材料/技術士/安衛/取樣/通知/重要事項),
  公定格式列印頁 `/site-log/print`(民國日期、開工後第 X 日曆天、累計自動彙計、簽章欄)。
- ✅ **缺失照片 AI 填表** — `/quality` 開立缺失可拍照 → `describe-defect`
  Edge Function(已部署)→ 自動填標題/說明/嚴重度/改善建議;demo 模式顯示友善提示。

AI 自動化第一輪(2026-07-03,三項皆落地):
- ✅ **變更 diff** — 變更設計頁上傳變更後 PCCES XML → `coDiff.js` 確定性比對
  (item_key 優先、名稱+單位後備;單價變更拆「減原量@原價+加新量@新價」兩筆)→
  預覽差異 → 一鍵套用明細。10 個 vitest、demo 端到端驗證(6.9MB XML 即時解析)。
- ✅ **AI 月報草稿** — 月報「檢討/下月計畫」一鍵起草:demo 模式本地模板、
  真專案走 `draft-monthly-review` Edge Function(已部署,gpt-4o,金鑰不進前端)。
- ✅ **規範→自主檢查表實驗** — 見 `docs/實驗-規範轉自主檢查表-03310.md`:
  從 03310 結構用混凝土章抽出 30+ 條量化檢查項(含標準/允許誤差/出處條文),
  可行性確認;產品化 = parse-contract 模式 + 工程師審核 + 掛回工項樹(refItemCode 前綴)。

下一步:解除 Supabase egress 限制(缺口 #7)+ 設 RESEND_API_KEY → 即可拿去給
真實廠商試用,以回饋決定第 4 節方向。

---

## 4. 方向選項(未拍板,待真實用戶回饋)

| 方向 | 內容 | 驗證什麼 | 風險 |
|---|---|---|---|
| A. 監造協作 | 查驗申請/監造查驗/送審 Submittal/RFI/ITP 停留點(見附錄) | 「平台」價值 | 要兩邊組織都上車才閉環 |
| B. iOS 現場 App | 原生 SwiftUI、離線優先、AI 現場辨識自動填表 | 現場工程師的日常黏著 | 開發面寬 |
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
