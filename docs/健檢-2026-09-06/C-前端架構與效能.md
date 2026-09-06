> 稽核代理原始報告（2026-09-06，唯讀讀碼）。燈號與數字以主報告 `docs/全案健檢-2026-09-06.md` 的「校正」節為準。

# 全案健檢 — 維度 C：前端架構、效能與程式品質

稽核日期：2026-09-06　｜　基準 commit：`ba6ab45`（main）　｜　唯讀稽核，未修改任何檔案
dist/ 產出時間：2026-09-01 21:07（對應 `ba6ab45` 前 7 分鐘，內容可信）

---

## 總評（3 行）

- **🔴 紅燈 2 項**：`plannedNow` 預定進度內插被複製 6 份且其中 1 份用了不同的日期解析（違反紅線二「數字由確定性引擎算」）；5 個頁面元件是 600～990 行的單一函式，`RequirementsReview.jsx` 一個 function 就 986 行。
- **🟡 黃燈 12 項**：主 bundle 279KB gz（含 Sentry Replay 的 rrweb 錄影器）、19/24 導覽路由被 hidden 且其中 6 條在全站零入口、無 eslint／prettier（但程式碼裡有 24 處 `eslint-disable` 註解）、`/requirements/review`（最大頁）不在 375px 溢位掃描、W11「契約義務」舊詞仍有 3 處使用者可見文案。
- **🟢 綠燈 12 項**：路由 fail-closed 守衛、hidden≠鬆綁權限、全頁 lazy、tracked context 精準訂閱、boqCalc 全部 memo、`friendlyError` 幾乎 100% 覆蓋、圖示字型 subset 守門測試、觸控目標與色彩 token 紀律都很扎實。整體工程品質明顯高於一般同規模 SPA，主要債務集中在「頁面元件肥大」與「精修期把表面砍到 4 個入口後的可達性」。

---

## 逐項檢查

### C-01｜路由表面：39 條路由、19 條 hidden、6 條全站零入口｜P1｜🟡

**證據**
- `src/lib/navConfig.js:14-61` — `navGroups` 工作面現況；`:19-22` 四個存活入口＝`/dashboard 今日待辦`、`/contract 專案文件`、`/requirements 契約重點`、`/boq 標單工項`。
- `src/lib/navConfig.js:25,31,36,43,48` — 5 個工作面標記 `hidden: true`（現場與品質／審查與協作／進度與金流／報表與結案／專案），共 **19 條導覽路由**離開側欄。
- `src/lib/navConfig.js:66-87` — 15 條非導覽路由（含 `/agent`、`/alerts`、`/deadlines`、`/requirements/review`、4 條 print、`*`）。
- 實測（node 載入 `navConfig.js`）：`routeRegistry` 共 **39 條**；三個角色 `visibleNavGroups()` 都只回四個入口；平台管理員多一個「平台管理」。
- `src/lib/navConfig.js:116-118` — `defaultLandingPath()` 現在對所有角色回 `/dashboard`（機關原本落在 `/portfolio`，註解已載明是刻意暫時退場）。
- 反向連結掃描（排除 navConfig/App/測試）：**`/cost`、`/schedule`、`/supervisor-report`、`/portfolio`、`/activity` 全站 0 個 `Link`／`navigate` 指向**；`/monthly-report`、`/itp`、`/audit` 各只有 1 個。
- `src/components/Layout.jsx:111-165` — 頁首「搜尋」不是檢索，`submit()` 直接 `navigate('/agent')`（`:128`）。全站沒有任何一個「所有頁面清單」的入口。

**影響**　精修期收斂本身是刻意決策，但目前 5～8 個功能頁**只能靠使用者手打網址**才能到達；`/portfolio` 是機關角色原本的主畫面，現在既不是 landing 也沒有任何連結，等於機關端跨案能力在 UI 上消失。記憶檔已記錄同型事故（「施工日誌藏到連擁有者都找不到」），這次規模更大。

**建議**　(a) 逐項復出時優先處理零入口的 5 條；(b) 在此之前，於 `/dashboard` 或頁首加一個「全部功能」抽屜（讀 `navGroups` 含 hidden 項），成本極低且不動 `routeRegistry`；(c) 機關 landing 恢復 `/portfolio` 或在今日待辦置頂跨案卡。

**工作量**　S（全部功能抽屜）／M（含機關 landing 分流還原）

---

### C-02｜hidden ≠ 移除權限：深連結仍可達且角色限制不變｜P3｜🟢

**證據**
- `src/lib/navConfig.js:103-110` `routeAllowed()` 只看 `routeRegistry`，不看 `hidden`；`:122-135` `visibleNavGroups()` 才過濾 `hidden`。
- 實測：contractor 對 19 條 hidden 路由中 17 條 `routeAllowed === true`，僅 `/supervisor-report`、`/audit` 因 `roles` 被擋（正確）。
- `src/lib/navConfig.js:7-8` 註解明寫「刪掉定義會讓 roles 一起消失（權限靜默鬆綁）」，且 `src/lib/navConfig.test.js` 24 個測試釘住（已實跑通過）。

**影響**　設計正確，`hidden` 純 UX、權限仍由 registry 統一決定。**無需修改。**

---

### C-03｜Lazy loading 涵蓋率：33 個頁面全部 lazy｜P3｜🟢

**證據**
- `src/App.jsx:15-50` — 所有 web 頁面都是 `lazy(() => import(...))`。
- 唯二靜態 import：`src/App.jsx:10` `Login`（首屏必要）、`:11` `ProjectSetup`（守衛 `Web()` 在 `:77` 直接渲染，不能延後）。
- dist 驗證：每個頁面各自一個 chunk（`RequirementsReview-DO2liM7R.js` 37K、`SiteLog-BwrvV8u6.js` 36K …），切分確實生效。

---

### C-04｜App.jsx 守衛複雜度：低，且有 build-time 登記檢查｜P3｜🟢

**證據**
- `src/App.jsx:66-104` — `Web()` 守衛只有 6 個線性早退（authReady → passwordRecovery → currentUser → 專案狀態 → platformAdminChecked → routeAllowed），單一函式 39 行，無巢狀分支。
- `src/App.jsx:172-174` — 模組載入時就檢查每條 `appRoutes` 都在 `routeRegistry`，忘記登記直接 throw（fail-fast 而非 fail-silent）。
- `src/App.jsx:176-180` `guardedElement()` 由 registry 的 `access`／`surface` 決定要不要包 `WebLayout`，print 路由走 `bare`。

**小疵（P3）**　`src/App.jsx:111` `const homeLabel = home === '/portfolio' ? '回到跨案總覽' : '回到今日待辦'` 是**死分支**——`defaultLandingPath()`（navConfig.js:116-118）現在永遠回 `/dashboard`。恢復機關分流時記得一起改回；否則刪掉三元運算。

---

### C-05｜頁面元件肥大：5 個檔案的主 function 超過 570 行｜P1｜🔴

**證據（行數 = `wc -l`；主 function 跨度 = 宣告行 → 檔尾／下一個 top-level 宣告）**

| 檔案 | 總行數 | 主 function 跨度 | 已抽出的子元件 |
|---|---|---|---|
| `src/pages/web/RequirementsReview.jsx` | 1165 | `:179` → 檔尾＝**約 986 行單一函式** | 只有 `ReviewActions`（`:112`） |
| `src/pages/web/Contract.jsx` | 971 | `:79` → `:967`＝**約 888 行** | 只有 `aiProcessingState`（`:63`）、`RUN_META_OK`（`:967`） |
| `src/pages/web/SiteLog.jsx` | 969 | `:24` → `:924`＝**約 900 行** | `FreqChips`（`:924`）、`RowsEditor`（`:940`） |
| `src/pages/web/Requirements.jsx` | 960 | `:71` → 檔尾＝**約 889 行** | `WhoPill`（`:56`）、`StatusDot`（`:66`） |
| `src/pages/web/Valuation.jsx` | 611 | `:39` → 檔尾＝**約 572 行** | 無（僅 `summarizeValuationDiff` 純函式 `:23`） |

對照組（同規模但已拆好）：`src/pages/web/Quality.jsx` 814 行但切成 `ChecklistSection`（`:381`）／`SamplesSection`（`:641`）／`ObservationsSection`（`:748`）＋主頁；`src/pages/web/Admin.jsx` 688 行切成 8 個 Tab 元件（`:220`～`:686`）。**同一個 repo 裡有正確示範。**

**自然拆點（讀碼可辨識的既有區塊註解）**
- `RequirementsReview.jsx`：`:880` 「手動新增 Modal」→ `ManualRequirementModal`；`:1012`／`:1022` 的三個版面分支（demo／loading／正常）→ 各自元件；`:1098` 篩選 chip 列 → `ReviewFilterBar`；右欄詳情面板（`:385` 起的關聯列）→ `RequirementDetailPanel`。
- `Contract.jsx`：`:573` 起無專案分支、`:665` 上傳區、`:712`／`:771`／`:955` 三處處理進度渲染、`:42-44` 已抽出的 `DOC_TH/THR/TD` 對應的文件表 → `DocumentTable`、`UploadPanel`、`ProcessingRunPanel`。
- `SiteLog.jsx`：`:271`～`:345` 照片 AI 批次辨識流程（含 `batchBusy` 狀態機）→ `PhotoBatchRecognizer`；公定格式表已抽在 `src/components/SiteLogOfficialSheet.jsx`，可比照。
- `Requirements.jsx`：`:705`／`:714`／`:724` 基準日設定區 → `AnchorEditor`（`src/components/AnchorDates.jsx` 已存在，可能可直接吃）；`:875`～`:905` 三種空狀態 → `RequirementsEmptyStates`。
- `Valuation.jsx`：`:59`～`:107` 的差異彙總已是純函式（`summarizeValuationDiff`），畫面端 `:337`／`:383` 的樹狀展開列 → `ValuationTreeRow`。

**影響**　審查成本、AI 協作成本與迴歸風險都隨單一函式長度非線性上升；`RequirementsReview.jsx` 又剛好是本輪產品重點（D-017/D-019/D-020 三個決策都落在它身上）。

**建議**　照 `Quality.jsx`／`Admin.jsx` 的既有模式，把上表拆點抽成同檔內的 top-level 元件（不必拆檔，先降單函式長度）。優先序：RequirementsReview > Contract > SiteLog > Requirements > Valuation。

**工作量**　L（五個頁面）／M（只做 RequirementsReview + Contract）

---

### C-06｜`plannedNow` 預定進度內插被複製 6 份，其中 1 份日期解析不同｜P1｜🔴

**證據**
| 位置 | 起始日解析 | 是否 memo |
|---|---|---|
| `src/pages/web/Dashboard.jsx:216-226` | `parseLocalDate` (`:219`) | `useMemo` |
| `src/pages/web/SupervisorReport.jsx:44-53` | `parseLocalDate` (`:47`) | `useMemo` |
| `src/pages/web/RiskAudit.jsx:53-62` | **`new Date(...)`** (`:56`) | `useMemo` |
| `src/pages/web/Progress.jsx:123-134` | `parseLocalDate` (`:124`) | **IIFE，無 memo**（`:129`） |
| `src/pages/web/Portfolio.jsx:50-58` | `parseLocalDate` (`:53`) | `useMemo`（整段內聯，連函式都沒抽） |
| `src/lib/assistantData.js:31-41` | `parseLocalDate` (`:34`) | `useMemo` |

`src/lib/dates.js:3-11` `parseLocalDate()` 會把 `YYYY-MM-DD` 解成**本地午夜**；`new Date('2026-01-01')` 依 ES 規範解成 **UTC 午夜**。兩者在 `getFullYear/getMonth/getDate` 上不等價，跨月／跨年邊界與非 +8 時區會給出不同的「今天落在第幾個月」，進而給出不同的預定進度%。

**影響**　直接踩 CLAUDE.md 紅線二：「數字永遠由確定性引擎算」。**風險稽核頁（`/audit`，機關防弊視角）是那個唯一的異類**——它算出來的「預定進度」可能與首頁／監造報表不一致，而該頁的用途正是抓不一致。同一份數學散在 6 處也意味著任何規則修正（例如把 `/30` 改成實際天數）必然漏改。

**建議**　抽 `src/lib/progressCurve.js` 匯出 `plannedPctAt(progressPlan, today)`（純函式＋vitest，比照 `todayTasks.js`／`payments.js` 的既有做法），6 個呼叫點全部改吃它；`Progress.jsx` 的 IIFE 順手改成 `useMemo`。

**工作量**　S

---

### C-07｜列印頁工具列樣式複製 5 份、硬編 hex｜P2｜🟡

**證據**
- `src/pages/web/ValuationPrint.jsx:12-14`、`SiteLogPrint.jsx:10-12`、`ObligationsPrint.jsx:11-13`、`ChecklistPrint.jsx:14-16`、`ValuationPackage.jsx:13-15` — 五份**逐字相同**的 `TOOLBAR_BTN`／`TOOLBAR_PRIMARY`／`TOOLBAR_SECONDARY`，含 `#0b57d0`／`#0842a0`／`#dadce0`／`#e8f0fe`。
- `ValuationPrint.jsx:10-11` 註解已自承：「與其餘三支列印頁同一組 class（列印頁不 import ui.jsx，就地複寫）」——且註解說「三支」但實際已長到五支。

**影響**　硬編顏色本身是**刻意且正確**的（列印頁跟紙不跟主題），問題只在複製份數。品牌改色時要記得改五個檔。

**建議**　抽 `src/components/printToolbar.js`（只匯出三個 class 常數，不 import `ui.jsx`，維持列印頁不吃 token 的原則）。

**工作量**　S

---

### C-08｜主 bundle 279KB gz，Sentry Replay 的 rrweb 錄影器進了首屏｜P1｜🟡

**證據（dist/assets 實測，raw / gzip）**

| Chunk | raw | gzip | 何時載入 |
|---|---|---|---|
| `pdf.worker.min-CHFwMXne.mjs` | 1232K | 364K | 動態（worker，僅解析 PDF 時） |
| **`index-rIYVar2D.js`（主）** | **901K** | **279K** | **首屏，render-blocking module** |
| `workItems.compact-BvjL6mJp.js` | 624K | 117K | 動態（`src/lib/boqCalc.js:19` `import('../data/workItems.compact.json')`） |
| `mammoth.browser-BxhEvUaV.js` | 488K | 121K | 動態（`documentExtract.js:121`、`store/db.js:289`） |
| `pdf-C1gUo6dv.js` | 468K | 138K | 動態（`documentExtract.js:127`、`MarkupEditor.jsx:19`、`store/db.js:295`） |
| `index-BcQuZqQX.css` | 175K | 56K | 首屏，render-blocking |
| `RequirementsReview` / `SiteLog` / `Requirements` / `Quality` / `Contract` | 37/36/32/30/30K | 11/11/10/9/10K | 路由 lazy |
| `material-symbols-pmis-*.woff2` | 16K | — | `<link rel=preload>`（`dist/index.html` 已注入） |
| Noto Sans TC | 103 支 woff2，合計 4.2M | — | 依 `unicode-range` 按需，**首屏只抓命中的幾支** |

**pdfjs / mammoth / 字型：全部正確**（見 C-09）。**問題只在主 chunk：**
- `dist/assets/index-rIYVar2D.js` 內 `grep -c rrweb` = **7**，`browserTracing` = 1 → **Sentry Replay 的 rrweb 錄影器被靜態打進首屏**。
- 成因：`src/main.jsx:6` 靜態 `import { initSentry, Sentry } from './lib/sentry.js'`，而 `src/lib/sentry.js:1` 靜態 `import * as Sentry from '@sentry/react'`、`:15` 直接呼叫 `Sentry.replayIntegration(...)`。
- 諷刺點：`src/lib/sentry.js:18` `replaysSessionSampleRate: 0`——**一般 session 根本不錄**，錄影器卻每次首載都下載。
- `node_modules/@sentry/browser` 佔 4.4M（未壓），rrweb 是其中最大的單一模組。

**影響**　工地平板／行動網路的首次進站要多吞數十 KB gz 且是 parse 成本較高的錄影器程式碼。`Sentry.ErrorBoundary`（`main.jsx:45`）需要靜態 import，但 replay 不需要。

**建議**　`initSentry()` 內改用 `Sentry.lazyLoadIntegration('replayIntegration')`（或 `const { replayIntegration } = await import('@sentry/react')` 後 `client.addIntegration()`），把 rrweb 移出首屏 chunk。改完以 `grep -c rrweb dist/assets/index-*.js` 驗證回到 0。次要：可考慮把 `@supabase/supabase-js`（主 chunk 內 31 個 `@supabase` 命中）留在主 chunk（登入即需要，合理），不必動。

**工作量**　S（改 sentry.js 一處＋build 驗證）

---

### C-09｜pdfjs-dist / mammoth / Noto Sans TC 的載入策略｜P3｜🟢

**證據**
- `src/lib/documentExtract.js:121` `await import('mammoth/mammoth.browser')`、`:127` `await import('pdfjs-dist')`；`src/store/db.js:289,295` 同款；`src/components/MarkupEditor.jsx:19` 同款。三者都是**函式內動態 import**，dist 也確實切成獨立 chunk。
- pdf worker 走 `?url`（`documentExtract.js:14`、`store/db.js:8`、`MarkupEditor.jsx:13`），只在建立 worker 時才抓那支 1.2MB。
- `src/main.jsx:13` `import '@fontsource-variable/noto-sans-tc'` 是靜態，但 fontsource 產生的是 103 支帶 `unicode-range` 的 `@font-face`，瀏覽器只抓實際命中的子集；代價是 CSS 被撐到 175K/56K gz（`vite.config.js:8-18` 的註解已把這個取捨與 preload 對策寫清楚）。
- `src/data/workItems.json`（1.38MB）**不進 bundle**：唯一 import 者是 `src/lib/workItemsCompact.test.js:6`（等價性護欄），production 走 `workItems.compact.json` 且是動態 import（`boqCalc.js:19`）。

---

### C-10｜圖示字型 subset 機制有守門測試，且目前全綠｜P3｜🟢

**證據**
- `src/lib/iconFont.test.js:14-19` — 以 `scripts/icon-names.mjs` 的 `collectCandidates(src)` 掃全 src，任何不在 `material-symbols-names.json` 的候選名直接紅燈，錯誤訊息會提示跑 `node scripts/build-icon-font.mjs`。
- **實跑驗證**：`npx vitest run src/lib/iconFont.test.js src/lib/navConfig.test.js` → 26 tests passed。
- 動態圖示名（`Layout.jsx:191,364,384`、`ui.jsx:206,270,286`、`BottomNav.jsx:33`、`confirm.jsx:108`、`Portfolio.jsx:152,219` …）都來自本檔內的字面量 map，靜態掃描抓得到，未發現漏網。
- 產出的 subset 只有 **16KB**（`dist/assets/material-symbols-pmis-DLv5UASK.woff2`），且 `vite.config.js:20-54` 的 `pmis-preload-icon-font` 外掛在 build 期注入帶 hash 的 preload（`dist/index.html` 已確認注入成功）。

**無缺口。** 這一塊的工程完成度高於一般專案。

---

### C-11｜狀態管理：不是單一巨大 context，key 追蹤已解決全站 re-render｜P3｜🟢

**證據**
- `src/store/tracked.jsx:25-32` — Context 只放**永不變的 bridge**，Provider 重渲染不觸發 context 傳播；`:30` 在 `useLayoutEffect` 才通知訂閱者。
- `:47-59` `getSnapshot` 逐一 `Object.is` 比對「該元件實際讀過的 key」，沒變就回舊參考讓 React bail out；`:64-83` Proxy 在 `get`／`has`／`ownKeys`／`getOwnPropertyDescriptor` 四個 trap 都登記追蹤（展開 `...store` 會登記全部 key，寧可多渲染不漏更新）。
- `src/store.jsx:291-325` — `value` 每次 render 都是新物件，但因為上述機制不會造成全站重渲染。
- Slice 的 `useCallback` 依賴的是**解構出來的原始值**（`src/store/slices/billing.js:25` 直接在參數解構 `{ dbMode, currentProject, currentUser, wiMaps, log }`），而不是 `store.jsx:106` 每次新建的 `ctx` 物件 → 沒有依賴 churn。

---

### C-12｜render 內重複大陣列計算：boqCalc 全部 memo，`useTodayTasks` 有 memo｜P3｜🟢

**證據**
- `buildBillableTree`／`buildCumMap`／`totalCumAmount` 的 10 個呼叫點**全部包在 `useMemo`**：`Dashboard.jsx:199,205`、`Valuation.jsx:59,69,70`、`Progress.jsx:34,38,63`、`Payments.jsx:30,33`、`MonthlyReport.jsx:32`、`RiskAudit.jsx:31,38,48`、`Portfolio.jsx:43`、`SupervisorReport.jsx:34,40`、`ValuationPackage.jsx:34,38,39`、`ValuationPrint.jsx:27,31,32`。
- `src/lib/useTodayTasks.js:18-27` — `buildTodayTasks` 包在 `useMemo`，且以 `todayIso`（台北日曆日）而非 `TODAY` 物件當 key（`:16-17` 註解說明「工地平板整週不關分頁，模組層常數會讓日期凍結」）。
- `useTodayTasks()` 的三個呼叫點（`Layout.jsx:273`、`Dashboard.jsx:175`、`Alerts.jsx:21`）各自持有獨立 memo 快取 → 同一畫面最多算 2 次（Layout + 當頁），不是每次 render 重算。
- `src/lib/useTable.js:27-30,52-55` — 排序與分頁都 memo；`:38-43` 特別處理「輪詢重載給新陣列但內容沒換」不得把使用者踢回第 1 頁（用 `total|resetKey` 簽章而非陣列 identity）。

**唯一未 memo 者**已列在 C-06（`Progress.jsx:129` 的 IIFE，計算量極小，隨 C-06 一起修即可）。

---

### C-13｜資料載入邊界：符合 CURRENT.md §6.1，但契約鏈三頁有重複查詢｜P2｜🟡

**證據**
- `CURRENT.md:154-159` §6.1 規定：跨頁共享進 Store；`Contract`／`Requirements`／`Activity` 保留有界頁面查詢；同一查詢沒重複前不抽共用層。
- 頁面直查 Supabase 的檔案只有 5 個：`Activity.jsx`（`audit_events`）、`Dashboard.jsx`（2 支 `count: exact, head: true`）、`Contract.jsx`、`Requirements.jsx`、`RequirementsReview.jsx` — **邊界與 §6.1 一致**。
- **但**同一組查詢已重複到 2～3 頁：
  - `document_ingestion_runs` → `Requirements.jsx`、`RequirementsReview.jsx`、`Contract.jsx`、`Dashboard.jsx`（**4 頁**）
  - `requirements` → `Requirements.jsx`、`RequirementsReview.jsx`、`Contract.jsx`（**3 頁**）
  - `requirement_sources` + `document_versions` → `Requirements.jsx`、`RequirementsReview.jsx`（**2 頁**，且是同一組 join 語意）
- §6.1 自己的規則是「同一段查詢**沒有重複前**不新增共用層」——現在已重複，觸發條件成立。
- 分頁保護正確：`src/lib/pagedQuery.js` 存在且 `RequirementsReview.jsx:32` 明確設 `LIST_LIMIT = 300`（有界查詢，非靜默截斷）。

**建議**　抽 `src/lib/requirementQueries.js`（或 `store/db.js` 新增 loader），把「最新 completed run + requirements + sources + versions」這一組收成一個函式，四個頁面共用。同時可順手解決 C-24 的舊詞散落。

**工作量**　M

---

### C-14｜三態（載入／空／錯誤）：整體良好，`/portfolio` 吞掉錯誤｜P2｜🟡

**證據（逐頁掃 `Skeleton|載入中` / `<Empty|ErrorBanner`）**
- 自行查詢的頁面**三態齊全**：`Admin.jsx`（29/12/4）、`Contract.jsx`（9/5/3）、`Activity.jsx`（9/4/2）、`Members.jsx`（5/9/7）、`Requirements.jsx`（6/9/6，`:881` skeleton、`:885-905` 三種空狀態分流、`:891` ErrorBanner + onRetry）、`RequirementsReview.jsx`（3/7/4）。
- 吃 Store 的頁面沒有各自的 loading 是**正確設計**：`src/store.jsx:196-234,239-265` 統一 catch 成 `domainLoadError`，由 `src/components/Layout.jsx:419,424` 兩條全域重試 banner 呈現（含 `retryDomainLoad`／`retryWorkItems`）。
- **缺口**：`src/pages/web/Portfolio.jsx:78` — `loadPortfolio().then(({ rows }) => {...})` **解構時丟掉 `error`**。`src/store/slices/projects.js:302-305` `loadPortfolio` 明明回 `{ rows, error }`。RPC 失敗時使用者只會看到一張空的跨案總覽，看不出是「沒有專案」還是「載入失敗」——正是 W4-1 對 Members 修掉的那一類問題。
- 同頁 `ErrorBanner` 計數為 0，證實沒有其他補救路徑。

**建議**　`Portfolio.jsx` 補 `error` state + `<ErrorBanner onRetry>`（比照 `Members.jsx:163`）。

**工作量**　S

---

### C-15｜錯誤訊息統一走 `friendlyError`｜P3｜🟢

**證據**
- `src/lib/errorMessage.js:51` `friendlyError()` 是唯一出口；`:84-85` 集中把原始錯誤記進 `console.error`（呼叫端不必各自補），`:69` 另處理舊樣板殘尾。
- 覆蓋率極高：**24 個頁面 / 5 個 components / 3 個 lib** 共 100+ 個呼叫點（`Login`、`Contract`、`SiteLog`、`Quality`、`Valuation`、`Requirements`、`RequirementsReview`、`Admin`、`Members`、`Activity`、`BOQ`、`ITP`、`Safety`、`RFI`、`Submittals`、`Payments`、`Cost`、`Schedule`、`Progress`、`Deadlines`、`Acceptance`、`ChangeOrders`、`MonthlyReport`、`ProjectSetup`、`Agent`、`DefectTracker`、`CopilotChat`、`Layout`、`packageUpload`、`documentFileAccess`）。
- 全 src 搜「直接渲染 `error.message`」只找到 `src/pages/web/Contract.jsx:414`，而那是**寫進 DB 欄位**（`error_message: result.message`）不是渲染，讀取端 `:712,771,955` 都有再過 `friendlyError`。
- 另有 `src/lib/errorLeak.scan.test.js` 這支專門的外洩掃描測試，對應合規基線「錯誤訊息不外洩」。

---

### C-16｜Demo 模式 vs DB 模式：分支集中在 slice，但 4 個入口有 2 個在 demo 幾乎是空的｜P2｜🟡

**證據**
- 分支分佈合理：337 處 `dbMode|demoMode|isPersistedProject` 中，**前 7 名全在 store 層**（`collab.js` 39、`ledger.js` 38、`quality.js` 33、`site.js` 29、`store.jsx` 20、`billing.js` 18、`projects.js` 10）；頁面層最多只有 `Contract.jsx` 10、`Requirements.jsx` 9、`RequirementsReview.jsx` 7。雙引擎同步點被關在 slice 裡，符合 `CURRENT.md:163` 的架構債 #2 描述。
- **但精修期四個入口裡有兩個在 demo 模式是空殼：**
  - `/contract`：`src/pages/web/Contract.jsx:665` 「Demo 模式不支援，請登入並選擇真實專案。」；`:123` `canUploadDocs = isPersistedProject && ...`，整個上傳／AI 分析鏈在 demo 下不可用。
  - `/requirements/review`：`src/pages/web/RequirementsReview.jsx:1012-1019` 非真專案直接回 `<Empty>需真實專案…</Empty>`。
  - `/requirements`：`:113` demo 下不查 DB，只靠 `demoSeed` 的 14 筆 obligations 撐（`src/data/demoSeed.js:153-169`），AI 整理／擷取追溯全部看不到。
- 用詞已跟上 D-017/D-019：`src/lib/requirementReview.js:10-16` `REQUIREMENT_STATUS_LABELS` = 待確認／已確認／不採用／已取代，`:8-9` 有 D-017 語意註解；`RequirementsReview.jsx:90-92,135-136,139-141` 畫面實際文案一致。**demoSeed 沒有 requirement 狀態文案**（demo 只有 obligations），所以不存在「demo 用舊詞」的問題。
- D-020（全型別物化）：`RequirementsReview.jsx:385` 註解「已確認 → D-012/D-020 物化的義務（全型別皆物化）」，程式端已對齊。

**影響**　側欄砍到 4 個之後，銷售用的 demo 動線只剩 `/dashboard` 和 `/boq` 真正有內容；`/contract`、`/requirements` 兩個入口在 demo 下是提示卡。記憶檔記載 demo 模式＝銷售簡報，這條動線目前偏薄。

**建議**　(a) demo 種 3～5 筆假的 `requirements`（含 needs_review／approved 兩態）餵給 `/requirements` 與 `/requirements/review` 的 demo 分支，讓 D-017 的「確認無誤／不採用」在簡報時看得到；(b) `/contract` 的 demo 分支給一張只讀的「已上傳文件」示意清單。若不做，至少在 ROADMAP 標明 demo 動線的已知缺口。

**工作量**　M

---

### C-17｜console 殘留 / TODO-FIXME-HACK｜P3｜🟢

**證據**
- 非測試檔的 `console.*` 只有 **4 處，且全部是刻意的**：`src/lib/errorMessage.js:69,85`（集中記錄被遮蔽的原始錯誤，`:84` 註解說明「呼叫端就不必每處都補一行」）、`src/store/slices/agent.js:135`（`console.warn('AI 草稿收件匣載入失敗:')`）。**零個 `console.log`。**
- 全 src 非測試檔的 `TODO`／`FIXME`／`HACK`／`XXX:` = **0 個**。

---

### C-18｜未使用的 export／檔案：僅 1 個｜P3｜🟡

**證據（逐檔反查 importer）**
- 點名的四支**全部仍有 caller**：
  - `src/lib/assistantQA.js` ← `src/components/CopilotChat.jsx:8`（`answerQuestion`, `SUGGESTED_QUESTIONS`；CopilotChat 由 `CopilotFab.jsx` 使用，`Layout.jsx:429` 渲染 `<CopilotFab />`）
  - `src/lib/assistantData.js` ← `CopilotFab.jsx:9`、`Agent.jsx:13`
  - `src/lib/supervisorReport.js` ← `SupervisorReport.jsx:7`
  - `src/lib/exportCsv.js` ← **9 個檔案**（`DefectTracker`、`Schedule`、`Payments`、`Cost`、`RFI`、`ChangeOrders`、`Submittals`、`SiteLog`、`Safety`）
- **唯一無 production importer：`src/lib/requirements.js`** — 只有 `src/lib/requirements.test.js:11` 引用。它定義 `REQUIREMENT_TYPES`／`REQUIREMENT_STATUSES`／`REQUIREMENT_ORIGINS`／`REQUIREMENT_SOURCE_KINDS`，是 `supabase/functions/_shared/requirementExtraction.ts:14` 註解點名的「前端鏡像」。
- **但**畫面實際用的是另一份：`src/lib/requirementReview.js:10-42` 各自定義了 `REQUIREMENT_STATUS_LABELS`／`REQUIREMENT_TYPE_LABELS`／`ORIGIN_LABELS`。**同一套詞彙有兩個真相來源**，只有其中一個被畫面吃到。
- `src/testUtils/fakePostgrest.js` 無 importer 屬正常（測試工具）。

**建議**　讓 `requirementReview.js` 的 label maps 以 `requirements.js` 的常數陣列為 key 來源（或加一支測試釘住兩邊 key 集合相同，比照 `src/lib/aiFeatures.test.js` 對 edge function 鏡像的做法）。

**工作量**　S

---

### C-19｜完全沒有 eslint / prettier，但程式碼裡有 24 處 `eslint-disable`｜P1｜🟡

**證據**
- repo 根目錄無 `.eslintrc*`／`eslint.config.*`／`.prettierrc*`／`.editorconfig`；`package.json` devDependencies 只有 playwright／tailwind／vite／vitest／jsdom／gh-pages，**沒有任何 linter**。
- `package.json:6-16` scripts 無 `lint`；`.github/workflows/ci.yml` 只跑 `npm ci` → `npm test` → `npm run build` → `npx playwright test`，**CI 無 lint 關卡**。
- 但程式碼假設 linter 存在：`src/store.jsx:179,194,233,264,273,288`、`src/pages/web/Dashboard.jsx:224,233`、`src/pages/web/RiskAudit.jsx:68`、`src/lib/useTodayTasks.js:27` 等共 24 處 `// eslint-disable-line|next-line react-hooks/exhaustive-deps`。

**影響**　那 24 個 disable 標記等於是「這裡的依賴陣列刻意不完整」的宣告，但**沒有任何工具在檢查其他地方的依賴陣列是否正確**。`react-hooks/exhaustive-deps` 沒開，遺漏依賴造成的 stale closure 只能靠人眼與測試抓。政府合規面向也少一個靜態檢查證據。

**建議**　加 `eslint` + `eslint-plugin-react-hooks`（先只開 `react-hooks/rules-of-hooks` error、`exhaustive-deps` warn），CI 加一步 `npm run lint`。先跑一次看有幾個既有 warning 再決定要不要一次修完。prettier 可先不加（此 repo 風格一致度已很高，強制 format 會製造大量 diff）。

**工作量**　S（裝設定＋CI）／M（含清 warning）

---

### C-20｜無 TypeScript、無 PropTypes｜P2｜🟡

**證據**　無 `tsconfig.json`／`jsconfig.json`；`package.json` 無 `prop-types`／`typescript`；全 src 無 `.ts`/`.tsx`（唯一 TS 在 `supabase/functions/`，Deno 端）。

**風險評估（有節制的）**
- **低風險區**：`src/lib/` 的確定性引擎（`boqCalc`、`contractDue`、`payments`、`qc`、`todayTasks`、`penaltyCalc` …）幾乎都有 vitest 單元測試（`src/lib` 下 40+ 支 `.test.js`），型別錯誤會被測試抓到。
- **中風險區**：`src/store/slices/*` 與 Supabase 回傳的 row 形狀之間沒有型別對帳。Postgres `numeric`/`bigint` 經 supabase-js 常回字串——`src/lib/useTable.js:8-10` 的註解正是被這件事咬過留下的。目前靠註解與個案處理。
- **高風險區**：C-05 那五個 600～990 行的元件，props/state 形狀只存在於註解與呼叫端記憶裡。
- 專案有 `supabase mcp generate_typescript_types` 可用，但沒有導入。

**建議**　**不建議整案改 TS**（成本 L、對現階段 GTM 無幫助）。折衷：對 `store/db.js` 的 loader 回傳形狀補 JSDoc `@typedef` + `// @ts-check`（零 build 變更，編輯器就能提示），優先蓋 `work_items`／`valuations`／`requirements` 三組。

**工作量**　M（JSDoc 折衷）／L（全案 TS，不建議）

---

### C-21｜共用 UI 元件涵蓋率高，頁面自造 button 多屬合理｜P3｜🟢

**證據**
- `src/components/ui.jsx` 匯出 24 個元件／常數：`Surface`、`Card`、`PageHeader`、`Badge`、`BallChip`、`StatusBadge`、`Button`(+`buttonClass`)、`Stat`、`Input`／`Textarea`／`Select`／`Field`(+`FIELD_BASE`)、`SourceTag`、`Empty`、`Skeleton`／`SkeletonList`、`ErrorBanner`、`SortableTh`、`FilterChip`、`TablePager`、`PrerequisiteEmptyState`、`THEAD_CLS`。
- 表格語彙共用：`THEAD_CLS` 被 **13 個檔案**使用；`SortableTh`／`TablePager` 被 `Activity`／`Admin`／`Contract`／`SiteLog` 使用（其餘表格是固定欄位小表，不套是合理的）。
- Chip 語彙共用：`CHIP_BASE`／`CHIP_ON`／`CHIP_OFF`（`src/components/PageTabs.jsx:13`）被 `Quality:237`、`Admin:170,183`、`SiteLog:932`、`Contract:631`、`Valuation`、`MarkupEditor:140`、`CopilotChat:155` 共用；`ui.jsx:277-280` 註解明寫「class 字面值與 PageTabs 的 CHIP_BASE/ON/OFF 對齊」。
- 146 個原生 `<button>` 中，大多數是 icon-only 動作鈕（刪除／關閉／展開）與清單列，這些本來就不該套藥丸 `Button`；且抽查的每一顆都有 `aria-label` 與 `max-md:min-h-11`（例：`Quality.jsx:328,733`、`DefectTracker.jsx:245`、`SiteLog.jsx:902`）。
- **唯一小疵（P3）**：`src/pages/web/RequirementsReview.jsx:105` 自造 `chipCls`，沒吃 `CHIP_BASE`/`FilterChip`（其他頁都吃）。

---

### C-22｜顏色 token 紀律：硬編 hex 僅 34 處，全部有正當理由｜P3｜🟢

**證據**
- 全 src 的 6 位 hex 共 34 處，分佈：
  - `src/main.jsx:32,34`（`#5f6368`／`#0b57d0`）— `:24-25` 註解：「崩潰畫面不假設 app CSS/主題已正常載入」。**正確**。
  - 5 支列印頁的 toolbar（見 C-07）— `ValuationPrint.jsx:11` 註解：「工具列跟紙不跟主題」。**正確**（只是複製 5 份）。
  - `src/components/MarkupEditor.jsx:15`（`#e8630c` 安全橘）— 註解：「工地標註慣例色，與 UI 品牌改版無關；歷史照片一致性」。**正確**。
  - `MarkupEditor.jsx:105,128`（`#ffffff` 文字描邊）— canvas 合成，**正確**。
  - 其餘是註解裡的說明文字。
- Tailwind 調色盤 class（`bg-red-500` 之流）共 167 處，**全部集中在 6 個檔案**且全是紙本輸出：`ValuationPackage.jsx` 65、`ValuationPrint.jsx` 34、`ChecklistPrint.jsx` 29、`SiteLogOfficialSheet.jsx` 21、`ObligationsPrint.jsx` 16、`SiteLogPrint.jsx` 2。**業務畫面 0 處。**
- 業務畫面一律 `text-[var(--text-2)]`／`bg-[var(--surface-2)]`／`text-[var(--blue-text)]` 這類 token 語法。

---

### C-23｜觸控目標：一致，但約定是 `max-md:min-h-11` 不是 `max-sm:`｜P3｜🟢

**證據**
- 全 src：`max-sm:min-h-11` = **0 處**；`max-md:min-h-11` = **91 處**；含裸 `min-h-11` 共 117 處。
- 這是**刻意的**：`src/components/ui.jsx:113-116` 註解「斷點必須跟『手機層』一致」；`e2e/a11y.spec.js:8-10` 註解說明 640–767 的縫——`BottomNav` 是 `md:hidden`（<768）所以那一段已是手機版面，「觸控目標若寫成 max-sm(<640) 就會塌回桌機尺寸」，並用 744px（iPad mini 直式）專門測這條（`a11y.spec.js:186-196`）。
- 一次式解決點：`ui.jsx:117-119`（Button 三尺寸）、`ui.jsx:167`（`FIELD_BASE`）、`PageTabs.jsx:13`（`CHIP_BASE`）、`ui.jsx:268,283,302,309`（SortableTh／FilterChip／TablePager）、`BottomNav.jsx:31`。
- **稽核任務描述裡的 `max-sm:min-h-11` 與實際約定不符**，後續文件請以 `max-md:` 為準。

---

### C-24｜W11 改名：「契約義務」仍有 3 處使用者可見文案｜P2｜🟡

**證據**
- **使用者可見（需修）**：
  - `src/pages/web/Dashboard.jsx:73` — `${waitingOnCommencement} 條契約義務等待開工日才能排入時程;到「契約重點」的履約期程設定` ← 同一句話裡新舊詞並存。
  - `src/pages/web/Requirements.jsx:768` — `aria-label="搜尋契約義務"`（報讀器與 e2e 的 accessible name）。
  - `src/pages/web/Requirements.jsx:904` — `unlocks="AI 把契約義務逐條排上時程,三方各自追蹤執行情形"`（`PrerequisiteEmptyState` 的可見文字）。
- **僅註解／變數／DB 表名（可不動）**：`store.jsx:11,236`、`contractDue.js:1`、`pagedQuery.js:5`、`todayTasks.js:24`、`riskAudit.js:60`、`aiInsights.js:58`、`demoSeed.js:4,145`、`db.js:171`、`ledger.js:16,230`、`projects.js:184`、`RequirementsReview.jsx:160` — 這些指的是 `contract_obligations` 這張相容層表（`CURRENT.md:165` 架構債 #3），沿用舊名反而正確。
- **D-017/D-019 改名已完成**：`src/lib/requirementReview.js:12-14` 待確認／已確認／不採用；`RequirementsReview.jsx:90-92,117,135-136,141,1098-1099` 全站一致；「核定生效」全 src **0 命中**。`Requirements.jsx:8-9` 的「待核定/已生效/已駁回」是**描述舊版已移除功能的註解**，非現行文案。
- 其他 `待核定`／`駁回` 命中全屬**變更設計**領域（`ChangeOrders.jsx:13,56,279`、`riskAudit.js:39-48`、`aiInsights.js:87-94`、`ui.jsx:99`、`auditEvents.js:23,33`），那是採購法用語，D-017 不涵蓋，**不應改**。
- **唯一模糊地帶（P3）**：`src/lib/requirementReview.js:32` `WORK_ITEM_LINK_STATE_LABELS = { suggested: 'AI 建議', approved: '已核可', rejected: '已駁回' }` — 同一支檔案上方（`:12-14`）用「已確認／不採用」，下方工項連結卻用「已核可／已駁回」。建議統一。

**工作量**　S

---

### C-25｜a11y／375px E2E：覆蓋扎實，但漏了最大的那一頁｜P2｜🟡

**證據**
- `e2e/a11y.spec.js:17-43` `H1` 對照表涵蓋 **25 條路由**，`:48-62` 依角色分 CONTRACTOR(24)／SUPERVISOR(22)／OWNER(23) 三份清單，`:92-107` **每個角色都在 375px 與 1024px 各掃一次**「`scrollWidth <= clientWidth`」（含全部 hidden 路由，證明藏起來的頁仍受版面護欄保護）。
- `:145-198` 44px 觸控目標抽查 4 條（存檔鈕／品質分段 5 顆／今日待辦列／744px 不塌回）；`:200-232` 貼底元素不得被 BottomNav 蓋住（幾何 + `elementFromPoint` 命中測試，兩個尺寸）；`:234-257` 鍵盤（抽屜 Esc 還焦點給選單鈕、appPrompt Esc 取消且狀態不變）。
- `:109-143` 1024px icon rail 版面另有兩條（短標可見／全名 accessible name 保留／不得同時出現 BottomNav／平板收合不污染桌機偏好）。
- `e2e/routes.spec.js:23-43,45-58` 已更新到精修期：桌機與 375px 都斷言「只有四個扁平入口、無展開鈕、被藏的工作面 `toHaveCount(0)`」——**與 `a0aa3d0` 同步，沒有過期測試**。

**缺口**
1. `H1` 表與三份角色路由清單**都沒有 `/requirements/review`** —— 而它是全 repo 最大的頁面（1165 行）、契約鏈的審核入口，且 `:1098` 有一排篩選 chip、右欄有 392px sticky 詳情面板，正是最容易在 375px 溢位的結構。
2. 同樣未掃：`/valuation/package`（371 行，佐證包）、`/deadlines`（243 行）。前兩者是 `surface: 'print'`／非導覽路由，`:47` 註解說「print 路由不掃」，但 `/valuation/package` 與 `/requirements/review` 是**互動頁**不是純列印頁。
3. 觸控目標是「抽查代表點」而非全掃（`:146-147` 明講），可接受。

**建議**　把 `/requirements/review`（h1「擷取審核」，見 `RequirementsReview.jsx:1016`）與 `/deadlines`（h1「期限追蹤」，`Deadlines.jsx:113`）加進 `H1` 與三份角色清單。

**工作量**　S

---

### C-26｜CURRENT.md 的路由數與測試數已過期｜P3｜🟡

**證據**
- `CURRENT.md:103` 「**36 條** React 路由、33 個頁面檔、9 個 Store slices」；實測 `routeRegistry` = **39 條**，`src/pages/web/*.jsx` = 34 個頁面檔（另 `src/pages/Login.jsx`、`Security.jsx`），`src/store/slices/*.js` 非測試檔 = **9 個**（正確）。
- `CURRENT.md:103,145,148` 多處「36 條路由」與 W7 的 530／W8-7 的 640 Vitest 等基線數字混用。
- `CURRENT.md:154-159` §6.1 的「`Contract`、`Requirements`、`Activity` 的資料只在各自頁面使用」已不精確——`RequirementsReview` 與 `Dashboard` 也直查（見 C-13）。

**建議**　下一個工作包收尾時一併更新 §6 的三個計數與 §6.1 的頁面名單。

**工作量**　S

---

## 本維度所有檢查項清單

| 編號 | 標題 | 等級 | 狀態 | 一句話結論 |
|---|---|---|---|---|
| C-01 | 路由表面：39 條 / 19 hidden / 4 入口 | P1 | 🟡 | 6 條 hidden 路由全站零入口，`/portfolio` 連機關 landing 都撤了 |
| C-02 | hidden ≠ 移除權限 | P3 | 🟢 | `routeAllowed` 不看 hidden，24 個測試釘住 |
| C-03 | Lazy loading 涵蓋率 | P3 | 🟢 | 33 頁全 lazy，僅 Login／ProjectSetup 靜態（必要） |
| C-04 | App.jsx 守衛複雜度 | P3 | 🟢 | 6 個線性早退 + build-time 登記檢查；`:111` 有一條死分支 |
| C-05 | 頁面元件肥大 | P1 | 🔴 | 5 頁主 function 572～986 行；`Quality`/`Admin` 已有正確示範可抄 |
| C-06 | `plannedNow` 複製 6 份、1 份日期解析不同 | P1 | 🔴 | `RiskAudit.jsx:56` 用 `new Date` 而非 `parseLocalDate`，踩紅線二 |
| C-07 | 列印頁 toolbar 複製 5 份 | P2 | 🟡 | 硬編 hex 正確，只是份數失控 |
| C-08 | 主 bundle 279KB gz 含 rrweb | P1 | 🟡 | Replay 錄影器進首屏，但 `replaysSessionSampleRate: 0` |
| C-09 | pdfjs / mammoth / 字型載入策略 | P3 | 🟢 | 三者皆動態 import，字型走 unicode-range 按需 |
| C-10 | 圖示字型 subset 守門 | P3 | 🟢 | `iconFont.test.js` 實跑通過，subset 僅 16KB 且已 preload |
| C-11 | 狀態管理 re-render | P3 | 🟢 | tracked context 逐 key 訂閱，slice 無依賴 churn |
| C-12 | render 內重複大計算 | P3 | 🟢 | boqCalc 10 個呼叫點全 memo；`useTodayTasks` 以 `todayIso` 為 key |
| C-13 | 頁面直查 vs Store 邊界 | P2 | 🟡 | 符合 §6.1，但契約鏈查詢已重複 2～4 頁，抽層條件成立 |
| C-14 | 載入／空／錯誤三態 | P2 | 🟡 | 整體齊全；`Portfolio.jsx:78` 解構時丟掉 `error` |
| C-15 | 錯誤訊息統一 | P3 | 🟢 | `friendlyError` 100+ 呼叫點，另有外洩掃描測試 |
| C-16 | Demo vs DB 模式 | P2 | 🟡 | 分支關在 slice（好）；但 4 個入口有 2 個在 demo 是空殼 |
| C-17 | console / TODO 殘留 | P3 | 🟢 | 0 個 `console.log`、0 個 TODO/FIXME/HACK |
| C-18 | 未使用 export／檔案 | P3 | 🟡 | 點名四支都有 caller；`src/lib/requirements.js` 是唯一孤兒且與 `requirementReview.js` 詞彙重複 |
| C-19 | eslint / prettier 缺席 | P1 | 🟡 | 完全沒有 linter，卻有 24 處 `eslint-disable`；CI 也無 lint |
| C-20 | TypeScript / PropTypes 缺席 | P2 | 🟡 | lib 有測試保護；store↔DB row 形狀與巨大元件 props 無型別對帳 |
| C-21 | 共用 UI 元件涵蓋率 | P3 | 🟢 | 24 個共用元件，`THEAD_CLS` 13 檔、`CHIP_BASE` 7 檔共用 |
| C-22 | 顏色 token 紀律 | P3 | 🟢 | 硬編 hex 34 處全有理由；調色盤 class 只出現在 6 支紙本頁 |
| C-23 | 觸控目標一致性 | P3 | 🟢 | 91 處 `max-md:min-h-11`（非 `max-sm:`），共用元件一次式解決 |
| C-24 | i18n／改名一致性 | P2 | 🟡 | D-017/D-019 已完成；W11「契約義務」殘留 3 處可見文案 |
| C-25 | a11y／375px E2E | P2 | 🟡 | 25 條路由 × 2 尺寸掃描扎實，但漏掉最大頁 `/requirements/review` |
| C-26 | CURRENT.md 計數過期 | P3 | 🟡 | 文件寫 36 條路由，實測 39 條 |

**統計：🔴 2　🟡 12　🟢 12（共 26 項）**
**依等級：P1 5 項（C-01, C-05, C-06, C-08, C-19）／P2 7 項／P3 14 項**

---

## 建議的動工順序（成本 vs 風險）

1. **C-06**（S，紅燈，動到金額/進度數字的正確性）→ 抽 `progressCurve.js`。
2. **C-14 + C-25 + C-24**（各 S，合起來一個小 PR）→ Portfolio 錯誤態、a11y 補兩條路由、三處舊詞。
3. **C-08**（S）→ Sentry Replay lazy load，build 後 grep 驗證。
4. **C-01**（S）→ 「全部功能」抽屜，把 6 條零入口路由救回來（不動 routeRegistry）。
5. **C-19**（S）→ 裝 eslint + react-hooks，CI 加關卡。
6. **C-05**（M～L）→ 先拆 `RequirementsReview.jsx` 與 `Contract.jsx`，照 `Quality.jsx` 的模式。
7. **C-13 / C-16 / C-20**（M）→ 契約鏈查詢抽層、demo 動線補資料、db.js JSDoc。
