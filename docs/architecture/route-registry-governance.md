# 路由與導覽治理

> CURRENT｜2026-09-17（D-026 四主入口，瘦身 P1a／P1c）。D-013 預設拒絕；前端守衛只管體驗，資料安全由 RLS／RPC／trigger 保護。

[navConfig](../../src/lib/navConfig.js) 是入口：`navGroups` 展開成 navRouteRules，加上 nonNavRouteRules 組成 routeRegistry。[App](../../src/App.jsx) 每條 Route 必須有登記，缺登記即 throw；[Layout](../../src/components/Layout.jsx) 用同一份定義產生側欄。

## 判斷規則

| 條件 | routeAllowed 結果 |
|---|---|
| 未登記 | false，任何 override 都不能繞過 |
| public／redirect | true |
| platformAdminOnly | 只看平台 admin，不看專案 override |
| 其他 authenticated | 無 roles，或角色命中，或非正式模式的 can.override |

`hidden` 只隱藏入口，仍保留登記、角色守衛與深連結；不能以刪掉定義代替隱藏。`roles` 僅三方，platformAdminOnly 不同時帶 roles。`surface: print` 只去掉工作台外框，仍經登入與專案守衛。公開頁為 login／security，redirect 為根路徑／assistant；精確路由清單由程式與測試維護。

`visibleNavGroups` 過濾角色與 hidden tabs，入口指向第一個可見 tab，無可見項則藏整組。defaultLandingPath 現行全部到 `/dashboard`。側欄分區依 D-026 四主入口（2026-09-17）：「今日工作」（`BALL_SOURCES` 三個球權來源，持有 `/dashboard`，不是 `navGroups` 項目）→「工作」（`WORK_TITLE`；三個主入口群組現場紀錄 `/site`／履約時程 `/requirements`／估驗請款 `/valuation`，各含子頁）→「專案資料」（文件往來 `/submittals`、專案 `/contract` 兩組）→「平台」（僅 platformAdminOnly）。群組對三角色都可見，子頁依角色過濾；`/cost`、`/audit` 為 hidden 退場頁（仍登記、仍受原 roles 守衛；P1b 起兩頁皆唯讀——成本寫入由資料庫收回，稽核檢核已移入估驗頁），`/schedule` 待 P5d 承接後才 hidden。

球權來源使用 `?ball=`，不新增路由；resolveBallKey 未知值回 mine。query 不改權限，側欄與頁面讀同一個參數；選取態不要只比 pathname，否則三個來源會一起亮。

`MAIN_ENTRY_PATHS`／`roleWorkLinks` 從可見群組取三個主入口群組項（含 tabs），三角色相同，供桌機首頁的主入口列（`CommonWork`，名稱＝`WORK_TITLE`）與手機底欄（現在輪到我＋三主入口＋更多）使用，在任一子頁都算選取；不新增權限。`ROLE_WORK` 只剩角色標籤與摘要。`WORK_GUIDANCE` 是角色操作提示，供頁首與「尋找功能」搜尋結果共用；不是狀態機。`FindWork` 對 `visibleNavGroups` 的結果做本機文字搜尋，不依賴 AI，不包含未授權頁面。

頁面文案提到「到某一頁」時，名稱取自 `navLabel(path)`（該路由的子頁名）或 `navEntryFor(path)`（所屬主／次入口群組項），不手抄字串；兩支只讀登記表、不做權限判斷，非導覽或未登記路由回 null。使用點：首頁主入口列、提醒中心指路、專案初始化清單、建案表單與期限追蹤的指路句。

今日工作連結的 router state 帶返回來源（`taskReturn.js` 單一定義：`/dashboard`、`/alerts`、`/site`，名字取自 navConfig：`BALL_SOURCES_TITLE`、`/alerts` 的 `label`、`/site` 所屬群組；`/dashboard` 的 h1 同樣是 `BALL_SOURCES_TITLE`，全站只有「今日工作」一個名字）；`useListDetailPane` 更新 query 時保留 state。Dashboard 的搜尋、類型、到期篩選與載入筆數在 query；回來可還原原篩選並聚焦原筆（已完成則移到搜尋）。

手機導覽抽屜只存在於 `<md`：`Layout` 以 `drawerOpen = isBelowMd && menuOpen` 推導抽屜是否真的開著，鎖背景捲動、Esc、遮罩、焦點進出、`aria-expanded` 一律讀它，斷點跨到 `≥md` 時抽屜與鎖定在同一次 render 一起消失、開啟意圖清除（`a11y.spec.js` 釘住）。

## 維護與驗證

新增頁面同時改 App 與登記表；新增列印、公開或平台管理頁須明示 access／surface。改角色先核伺服器護欄；藏／露只改 hidden。驗證 [navConfig 單元測試](../../src/lib/navConfig.test.js)、[路由 E2E](../../e2e/routes.spec.js) 與三角色 E2E。
