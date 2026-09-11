# 路由與導覽治理

> CURRENT｜2026-09-11。D-013 預設拒絕；前端守衛只管體驗，資料安全由 RLS／RPC／trigger 保護。

[navConfig](../../src/lib/navConfig.js) 是入口：`navGroups` 展開成 navRouteRules，加上 nonNavRouteRules 組成 routeRegistry。[App](../../src/App.jsx) 每條 Route 必須有登記，缺登記即 throw；[Layout](../../src/components/Layout.jsx) 用同一份定義產生側欄。

## 判斷規則

| 條件 | routeAllowed 結果 |
|---|---|
| 未登記 | false，任何 override 都不能繞過 |
| public／redirect | true |
| platformAdminOnly | 只看平台 admin，不看專案 override |
| 其他 authenticated | 無 roles，或角色命中，或非正式模式的 can.override |

`hidden` 只隱藏入口，仍保留登記、角色守衛與深連結；不能以刪掉定義代替隱藏。`roles` 僅三方，platformAdminOnly 不同時帶 roles。`surface: print` 只去掉工作台外框，仍經登入與專案守衛。公開頁為 login／security，redirect 為根路徑／assistant；精確路由清單由程式與測試維護。

`visibleNavGroups` 過濾角色與 hidden tabs，入口指向第一個可見 tab，無可見項則藏整組。defaultLandingPath 現行全部到 `/dashboard`；五個工作面仍 hidden，不能因整理程式自行復出。

球權來源使用 `?ball=`，不新增路由；resolveBallKey 未知值回 mine。query 不改權限，側欄與頁面讀同一個參數；選取態不要只比 pathname，否則三個來源會一起亮。

## 維護與驗證

新增頁面同時改 App 與登記表；新增列印、公開或平台管理頁須明示 access／surface。改角色先核伺服器護欄；藏／露只改 hidden。驗證 [navConfig 單元測試](../../src/lib/navConfig.test.js)、[路由 E2E](../../e2e/routes.spec.js) 與三角色 E2E。
