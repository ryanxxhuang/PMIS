# 前端路由登記表治理（D-013 的實作）

> 狀態：**CURRENT** ｜ 最後核對：2026-09-11（分支 `refactor/product-wide`；Apple 改版四包與精修期最小表面均未動 `routeRegistry`／`routeAllowed`）
> 對應程式：`src/lib/navConfig.js`（`navGroups`、`BALL_SOURCES`、`routeRegistry`、`routeAllowed`、`visibleNavGroups`、`defaultLandingPath`）、`src/App.jsx`（路由對應與共同守衛）、`src/components/Layout.jsx`（側欄）
> 測試：`src/lib/navConfig.test.js`（單元）、`e2e/routes.spec.js`（存在；本文件未逐條核對其內容）
> 決策依據：[`../DECISIONS.md`](../DECISIONS.md) D-013（預設拒絕）、D-015／D-021（導覽呈現改版不動路由表）。本文件寫規則怎麼在程式裡成立；為什麼這樣定看 DECISIONS。

## 1. 一句話

**所有前端路由都必須登記在 `routeRegistry`；未登記的路由 `routeAllowed` 回 false。** 側欄要不要顯示、角色能不能進、是不是列印頁、是不是平台後台，全部從同一份資料推導——「導覽隱藏」與「權限」永遠一致，因為它們讀的是同一個物件。

同時要記住 DEVELOPMENT.md §4：前端路由守衛與 `can` 只是 UX，**不是安全邊界**；深連結進到頁面後，資料仍受 RLS 與 RPC 把關。這份治理防的是「忘記登記就放行」與「隱藏入口時順手把權限也弄丟」兩種前端層的失誤。

## 2. 資料結構：一份定義推出兩張表

```text
navGroups                     側欄定義（title → items）
  item: { to, icon, label, hidden?, roles?, platformAdminOnly?, tabs?: [{ to, label, roles?, hidden? }] }
        ↓ 攤平（tabs || item），每條標 access: 'authenticated'
navRouteRules

nonNavRouteRules              不出現在導覽、但必須明確登記的路由
  '/': redirect  '/login': public  '/security': public  '/assistant': redirect
  '/agent' '/alerts' '/deadlines' '/requirements/review' '/project/new': authenticated
  '/site-log/print' '/valuation/print' '/valuation/package' '/quality/checklist-print' '/contract/print': authenticated + surface 'print'
  '*': authenticated + surface 'not-found'

routeRegistry = Object.freeze({ ...navRouteRules, ...nonNavRouteRules })
```

- `access` 只有三種：`public`（不需登入）、`redirect`（純轉址）、`authenticated`（走共同登入與專案守衛）。
- `surface` 只描述版面：`print` 代表不套 `WebLayout`（`<Web bare>`），**不代表公開**——列印頁仍要登入、仍過專案守衛（W7／D-013 明訂）。`not-found` 是 404 的登記，讓 `*` 也走守衛。
- `roles` 是專案角色維度（`contractor`／`supervisor`／`owner`）；缺省＝全角色。
- `platformAdminOnly` 是平台維度，與 `roles` 互相獨立，測試釘住兩者不得同時出現在同一條路由。
- `hidden` 只影響渲染（§4），不影響任何權限判斷。
- 「球在誰手上」三個來源（`BALL_SOURCES`）走 `?ball=` query param 而不是新路由：`routeRegistry` 以 pathname 為鍵，query 不進 `routeAllowed`，三個來源共用 `/dashboard` 的登記與角色判斷，權限零變動（Apple 改版第二包 `2d3068f`）。`resolveBallKey` 對未知值一律落回 `mine`。

## 3. `routeAllowed(pathname, org, override, platformAdmin = false)`

```text
route = routeRegistry[pathname]
未登記                         → false      （fail-closed；override 與平台管理員都繞不過）
access ∈ {public, redirect}   → true
platformAdminOnly              → !!platformAdmin（只看平台維度；override 翻不過）
否則                           → !roles || override || roles.includes(org)
```

`override` 是 `can.override`——非正式模式下專案管理者的跨角色例外（`formal_mode` 開啟後關閉）。它放行帶 `roles` 的路由，但**不放行**未登記路由與 `platformAdminOnly`。`platformAdmin` 缺省 false：舊呼叫點沒傳時平台後台一律擋。

## 4. 三條反直覺規則（目前只活在程式註解裡，這裡寫成文件）

### 4.1 `hidden: true` 不等於移除權限；刪掉定義才會鬆綁權限

`hidden` 只讓 `visibleNavGroups` 不渲染那一項，`routeAllowed` 照樣讀同一條定義套 `roles`。精修期（PR #54，2026-08-25）把五個工作面整組 `hidden`，定義、`roles`、深連結全部原樣保留——今日待辦與初始化清單仍會導向這些隱藏頁。

**反面教訓（批 3／批 4）**：要「藏」一個功能時若直接把定義從 `navGroups` 刪掉，那條路由的 `roles` 會跟著消失；若它還留在 `nonNavRouteRules` 或被其他方式登記，就變成全角色可進——權限**靜默鬆綁**，沒有任何錯誤。反過來，`navConfig.test.js` 的「風險稽核」案例記錄另一種死法：曾因 hidden 收斂讓 `/audit` 變成全站死功能（入口沒了、也沒人能到）。所以規則是：**加回一個功能＝移除一行 `hidden`；藏一個功能＝加一行 `hidden`；不要動定義本身。**

### 4.2 公開與列印路由必須明確標記，且列印不是公開

只有 `/login` 與 `/security` 是 `public`；`/` 與 `/assistant` 是 `redirect`。五條列印路由標 `surface: 'print'` 但 `access: 'authenticated'`——`App.jsx` 對它們用 `<Web bare>` 去掉工作台外框，登入與專案守衛照走。`navConfig.test.js` 釘住這五種登記的精確形狀（`toEqual`），改動任何一條都要動測試。

### 4.3 `platformAdminOnly` 是獨立維度，前端只藏入口

`/admin` 是唯一帶 `platformAdminOnly` 的路由（測試釘死清單）。它在 `navGroups` 的「平台」群組，所以 `access` 也是 `authenticated`；非平台管理員連群組標題都不渲染。真正的把關在資料庫——每支 `admin_*` RPC 第一行檢查 `is_platform_admin()` 並 raise（見 [`ai-gate-and-metering.md`](ai-gate-and-metering.md) §8）。專案角色與 `can.override` 對這個維度沒有任何影響。

## 5. `App.jsx` 的接線

- 每條 `<Route>` 經同一個包裝：先查 `routeRegistry[path]`，**查不到直接 `throw new Error('前端路由尚未登記：' + path)`**——新增路由忘記登記時開發期就炸，不會等到使用者撞守衛。
- `access` 為 `public`／`redirect` → 直接渲染元素；否則 `<Web bare={surface === 'print'} registryPath={path}>` 進共同守衛。
- 共同守衛呼叫 `routeAllowed(registryPath || pathname, currentUser.org_type || 'contractor', can.override, isPlatformAdmin)`；拒絕時顯示說明並連回 `defaultLandingPath`。`registryPath` 讓帶參數的路由用登記鍵而不是實際 pathname 查表。
- `*` 走 `not-found` 版面，也在守衛之後（未登入者看不到 404 頁面內容）。
- `Layout.jsx` 用 `visibleNavGroups(org, can.override, isPlatformAdmin)` 產側欄；`isPlatformAdmin` 來自 `is_platform_admin()` RPC，不是直讀 `profiles` 欄位。

## 6. `visibleNavGroups` 與 `defaultLandingPath`

- `visibleNavGroups`：`hidden` 項不渲染；有 `tabs` 的項先過濾 tabs（`!hidden && tabAllowed`），入口 `to` 改為第一個可見 tab，整組 tabs 都不可見則整項藏；沒有可見項的群組整組藏（所以非平台管理員看不到「平台」群組）。
- `defaultLandingPath(_orgType)`：精修期一律 `/dashboard`。原本多案角色（owner／supervisor）分流到 `/portfolio`（管十幾案的監造事務所落單案儀表板等於一進門先叫他選案），因「專案」工作面暫別側欄而收起；恢復時要還原分流。測試釘住「落地頁必須是登記過且該角色進得去的路由」，否則一登入就撞守衛。

## 7. 現況怎麼查（不抄表）

數字會腐爛，一律以 `routeRegistry` 為準：

```bash
# 登記路由總數、群組數、逐條 access / surface / roles / hidden / platformAdminOnly
node -e "import('./src/lib/navConfig.js').then(m=>{const r=m.routeRegistry;console.log(Object.keys(r).length, m.navGroups.length);for(const [k,v] of Object.entries(r))console.log(k,v.access,v.surface||'',v.roles||'',v.hidden?'hidden':'',v.platformAdminOnly?'platformAdminOnly':'')})"

# hidden 定義（注意：檔頭註解也含這個字串，grep -c 會多算 1）
grep -n "hidden: true" src/lib/navConfig.js
```

2026-09-11 現查參考值：39 條登記路由、2 個 nav 群組（工作面／平台）、5 個 `hidden: true` 的工作面組定義（`/site-log`、`/submittals`、`/valuation`、`/monthly-report`、`/portfolio`）、5 條帶 `roles` 的路由、1 條 `platformAdminOnly`。**CLAUDE.md 與 CURRENT.md 寫的「6 處 `hidden: true`」是 `grep -c` 含檔頭註解的計數；定義本身是 5 個，由 `navConfig.test.js` 的 hidden 集合斷言釘住。** 對不上時以測試與現查為準。

## 8. 改動路由時的最小流程

1. 新增頁面：`App.jsx` 加 `<Route>`＋`navConfig.js` 登記（進側欄放 `navGroups`；不進側欄放 `nonNavRouteRules`，並決定 `access`／`surface`）；漏登記會在渲染時 throw。
2. 改 `roles`：這是權限變更（DEVELOPMENT.md §4），前端只是 UX——同步確認對應 RLS／RPC 已有伺服器端限制；更新 `navConfig.test.js` 的 `rolesMap` 斷言。
3. 藏／露入口：只動 `hidden` 一行；更新測試的 hidden 集合與側欄入口清單斷言。
4. 加 `platformAdminOnly` 路由：不得同時帶 `roles`；資料庫端要有對應的守門 RPC。
5. 跑 `npm test`（`navConfig.test.js`）與 `npm run test:e2e`（`routes.spec.js`）。

## 9. 邊界聲明

- 本治理只管前端路由表面；RLS、RPC、guard trigger 才是安全邊界。
- 不管理 Edge Function 或 Storage 路徑。
- 導覽資訊架構（工作面、球權來源、三欄殼）的視覺與呈現由 D-021 與 `UIUX-Apple-設計規範.md` 管，改版不得動本文件描述的判斷函式（D-021「不變的邊界」）。
