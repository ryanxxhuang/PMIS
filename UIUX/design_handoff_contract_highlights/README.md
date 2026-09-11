# Handoff: 契約重點 · Contract Highlights（契約條文檢索頁）

> 狀態：**SUPERSEDED（2026-09-11 由 `docs/UIUX-Apple-設計規範.md` 取代）**
> 依據 D-021：全產品 UIUX 改採 Apple style，本包的 **W9 Google Workspace／Material 3 視覺規格（色票、字級、圓角、陰影、Material Symbols 圖示、M3 深色表）一律作廢**，不要照做。
> **資訊架構、角色可見範圍與流程敘述仍可參考**，但要先與現況（`CURRENT.md`、`src/lib/navConfig.js`）對照。
> 本檔只加此檔頭，內文完整保留當時交付原貌，不回頭改寫。

> ⚠️ 內文含 D-017 已退場的「待核定／核定生效／已生效／駁回」文案；現行語意是「待確認／確認無誤／已確認／不採用」，且 D-019 起 AI 整理內容全自動確認。改任何文案前先讀 `docs/DECISIONS.md` D-017／D-019。

## Overview
PMIS.ai 的「契約重點」頁。單一目的：**使用者上傳契約文件後，來這裡看 AI 從契約裡爬出來的重要條文，並能快速檢索**。

頁面結構只有三塊：

1. **期限追蹤摘要條** — 一行四個數字（已逾期／7 日內到期／排程中／已完成）+ 連結，不放時間軸與試算
2. **契約重點清單（左，主角）** — 搜尋框 + 狀態快篩 + 兩個下拉，每列一條條文
3. **條文詳情（右，sticky）** — 點列即換：原文引述、出處頁碼、關聯項目、核定／駁回

**明確不做**（前一版有、已移除）：階段時間軸、罰款試算、基準日與契約總價卡、「已生效」與「值得留意」分開的兩張卡、頁面最底的獨立詳情卡、六個下拉篩選的追溯區、就地展開的手動新增表單。
上游是「文件與結案 → 專案文件」（上傳），下游是「期限追蹤」與各作業頁。

## About the Design Files
本包內的 HTML 是**設計參考稿（design reference）**，不是要直接搬進產品的程式碼。它示範的是「長什麼樣、怎麼動」。請在目標專案既有的環境與慣例中重建（React 19 + Tailwind、沿用現有元件庫與狀態管理）。

`ContractHighlights.reference.html` 是可直接用瀏覽器開啟的自足檔案：搜尋、四個狀態快篩、類型／階段下拉、點列換詳情都能真的動。字體用 Google Fonts CDN 只為方便預覽，**產品端請自行 self-host**（見「Assets」）。

## Fidelity
**High-fidelity。** 顏色、字級、間距、圓角、狀態語意都是最終值，請照著做到像素級一致。互動行為（搜尋、篩選、選取、詳情切換）也是最終設計。

---

## Screen: 契約重點

**Purpose**：AI 讀完契約與規範後，把「要遵守的事」逐條列出，讓廠商／監造／機關能檢索、追到原文出處，並由有權限者核定生效。

**Layout**
- 頁面底色 `#f8fafd`，內容欄最大寬 1320px，置中，左右 padding 24px，上 padding 28px
- 頁首：H1「契約重點」26px / weight 400；副標 13px `#5f6368` / line-height 1.7 / max-width 680px；右側 Outlined 按鈕「手動新增」（`add` 18px）
- 期限追蹤摘要條：全寬卡片，padding 13px 18px，下方留白 24px
- 主區：`display:grid; grid-template-columns:minmax(0,1fr) 392px; gap:24px; align-items:start`
- 右欄 `position:sticky; top:24px`
- 卡片：`background:#fff; border:1px solid #e3e6ea; border-radius:12px`
- 卡片標題列：padding 13px 18px、下邊框 1px `#dadce0`、左右分置、標題 15px / weight 500

### 期限追蹤摘要條

`display:flex; align-items:center; gap:28px; flex-wrap:wrap`
- 左：標籤「期限追蹤」13px / weight 500
- 中：四個統計，彼此 gap 20px。每個 = 8px 圓點 + 標籤 12.5px `#5f6368` + 數字（weight 500、`#202124`、tabular-nums）+「項」
  | 統計 | 圓點色 |
  |---|---|
  | 已逾期 | `#b3261e` |
  | 7 日內到期 | `#a05a00` |
  | 排程中 | `#0b57d0` |
  | 已完成 | `#146c2e` |
- 右（`margin-left:auto`）：連結「開啟期限追蹤」12.5px
- 此條可關（DC prop `showDeadlines`）。關閉時清單直接接在頁首下方。

### 左欄：契約重點清單

**標題列**：左「契約重點清單」；右 `共 14 條 · 來源 4 份文件 · 最近整理 2026-08-20`（11px `#5f6368`、tabular-nums）。

**檢索區**（padding 14px 18px、下邊框 1px `#e3e6ea`、`flex-direction:column; gap:12px`）
- 搜尋框：高 40px、`border:1px solid #dadce0`、圓角 100px、左側 `search` icon 20px `#5f6368`、input 13px、placeholder「搜尋條文、關鍵字、條款編號或頁碼…」。`:focus-within` 時 `border-color:#0b57d0`
- 搜尋範圍：標題、說明、條款編號、頁碼、原文引述、類型、階段、責任方（大小寫不敏感、子字串比對）
- 狀態快篩 chip（一排 4 個，gap 8px）：高 30px、padding 0 13px、圓角 100px、`border:1px solid #dadce0`、字 12px / weight 500 `#3c4043`，數字 `opacity:.7` + tabular-nums。選中：`border-color:#0b57d0; background:#ecf3fe; color:#062e6f`
  `全部 14`｜`待核定 5`｜`已生效 8`｜`已駁回 1`
- 分隔：1×20px `#e3e6ea`，左右 margin 2px
- 兩個 `select`（高 30px、圓角 8px、`border:1px solid #dadce0`、字 12px）：類型（全部類型／期限／罰則／品質標準／保固／保險／人員／提送文件／付款／其他）、階段（全部階段／開工前／施工中／完工／保固）
- 三種條件為 **AND**；篩選即時生效、不需按鈕

**清單列**（每列 `<button>`，`padding:12px 18px 12px 15px`、下邊框 1px `#e3e6ea`、左邊框 3px transparent）
`display:grid; grid-template-columns:76px minmax(0,1fr) 150px; gap:14px; align-items:start`
- 第 1 欄：狀態色票（見下）
- 第 2 欄：標題 13px / weight 500 / line-height 1.5 / `text-wrap:pretty`；下方 meta 11.5px `#5f6368`、上距 3px、tabular-nums，格式固定為
  `契約條款 5.3 · 第 12 頁 · 期限 · 廠商 · 開工前`（條款 · 頁碼 · 類型 · 責任方 · 階段）
- 第 3 欄：時點／門檻，右對齊、11.5px `#5f6368`、tabular-nums（例「開工通知後 14 日內」「上限 20%」「每月 5 日前」）
- hover：`background:#f8fafd`
- 選中：`background:#ecf3fe; border-left-color:#0b57d0`

**狀態色票**（`display:inline-flex; height:22px; padding:0 8px; border-radius:6px; font-size:11px; font-weight:500; white-space:nowrap`）

| 狀態 | 底／字 | 語意 |
|---|---|---|
| 已生效 | `#e6f4ea` / `#0f5223` | 已核定，為現行有效義務 |
| 待核定 | `#fef7e0` / `#8a4b00` | AI 已擷取、待人工確認 |
| 已駁回 | `#f1f3f4` / `#5f6368` | 不成立／已被取代，不計入義務 |

**空狀態**（搜尋無結果）：padding 44px 18px、置中、12.5px `#5f6368` / line-height 1.8
「找不到符合「〈關鍵字〉」的條文。」換行「試試條款編號（例 5.3）、頁碼或關鍵字（例 保固、罰則）。」

**卡片底部列**（padding 12px 18px、左右分置）：左 `顯示 14 / 14 條`（11.5px `#5f6368`、tabular-nums）；右連結「載入更多」11.5px。實作以分頁或無限捲動皆可，預設每頁 50 條。

### 右欄：條文詳情（sticky）

同卡片樣式，`position:sticky; top:24px`。內容分五段：

1. **標題列**（padding 13px 16px、下邊框 1px `#dadce0`、`gap:10px`）：狀態色票 + 類型 11.5px `#5f6368` + 右側連結「開啟原文」11.5px（帶 `title="在原文件中開啟"`，點擊應開啟該文件並跳到該頁）
2. **本文**（padding 16px）：標題 15px / weight 500；說明 12.5px / line-height 1.8 `#3c4043`、上距 8px；下方 key–value 表 `grid-template-columns:64px minmax(0,1fr); gap:7px 12px`、字 12px，key `#5f6368`、value tabular-nums —— 責任方／階段／時點／允收標準／應留存
3. **原文出處**（padding 0 16px 16px）：小標列 = `description` icon 15px + 「原文出處」12.5px / weight 500 + 來源核對色票（高 20px、padding 0 7px、10.5px；已核對 `#e6f4ea`/`#0f5223`，待核對 `#fef7e0`/`#8a4b00`）。下方引述框：`background:#f8fafd; border:1px solid #e3e6ea; border-radius:8px; padding:11px 12px`，第一行來源 11px `#5f6368` tabular-nums（`工程契約書（v1） · 契約條款 5.3 · 第 12 頁`），第二行原文加「」引號、12px / line-height 1.85
4. **關聯**（padding 0 16px 16px）：小標 12.5px / weight 500；每項一列 `<a>`：`padding:8px 11px; border:1px solid #e3e6ea; border-radius:8px`，左 icon 15px `#5f6368` + 文字 12px `#3c4043` + 右 `chevron_right` 16px `#80868b`；hover `background:#f8fafd`。連到期限追蹤、送審文件、計價、標單工項、三方成員等
5. **動作列**（padding 12px 16px、上邊框 1px `#dadce0`）依狀態切換：
   - **待核定**：Primary「核定生效」（`check_circle` FILL 1）＋ Secondary「修正內容」＋ Text-danger「駁回」（色 `#8c1d18`、hover 底 `#fceeec`）
   - **已生效／已駁回**：左側 11.5px `#5f6368` 顯示核定紀錄（`桃園市工務局 林淑芬 核定 · 2026-08-19 14:20`），右側 Secondary「廢止取代」（高 32px、12px）

按鈕規格：Primary 高 36px、padding 0 16px、12.5px / weight 500、圓角 100px、`#0b57d0` 白字，hover `#0842a0`、active `#062e6f`；Secondary 白底 `1px solid #dadce0`、字 `#3c4043`、hover `#f1f3f4`；Outlined（頁首「手動新增」）白底 `1px solid #dadce0`、字 `#0b57d0`、hover `#ecf3fe`。

---

## Interactions & Behavior

- 初次載入預設選中第一條（實作建議：優先選中第一條「待核定」，讓使用者直接進入待辦）
- 搜尋為前端即時篩選（資料量大時改後端全文檢索，debounce 250ms）
- 篩選變動後若當前選中項被篩掉，**保留右欄內容不清空**，只是清單中沒有高亮列
- 點列 → 更新右欄，同時更新 URL（`?highlight=r1`）以便分享單條連結；深連結進站時要自動捲到該列
- 「手動新增」開 Modal（標題、類型、階段、責任方、時點、允收標準、原文出處頁碼），送出後狀態為「待核定」，來源標記為「人工新增」
- 「核定生效」→ 樂觀更新該列狀態為已生效並寫入核定人／時間；失敗時回滾並顯示 inline 錯誤
- 「駁回」需填理由（Modal，必填），駁回後列變灰、不計入義務統計
- 「廢止取代」→ 進入版本流程：舊條文標記 superseded，新版本進「待核定」
- 鍵盤：`↑`/`↓` 移動選取、`Enter` 開啟原文、`/` 聚焦搜尋框

**Loading / Empty / Error**
- 清單載入中：8 列骨架（同列高，灰塊）；右欄同時顯示骨架
- 專案尚無擷取結果：卡內置中訊息「這個專案還沒有擷取結果」+ 連結「前往專案文件上傳契約」
- 載入失敗：紅色 inline 訊息 +「重試」，不要整頁換成錯誤頁

**Responsive**
- ≥1024px：兩欄如上（右欄固定 392px、sticky）
- 768–1023px：改單欄；詳情改為**右側抽屜**（寬 min(420px, 92vw)、右側滑入、backdrop `rgba(32,33,36,.4)`），點列開啟
- <768px：清單列改單欄堆疊（色票與標題一行、meta 一行、時點一行）；詳情改**全螢幕頁**，左上返回；按鈕最小高 44px；檢索區的兩個 select 改滿寬各佔一行

**Accessibility**
- 清單為 `role="list"`，每列 `<button role="listitem">` + `aria-current="true"` 標示選中
- 右欄容器 `aria-live="polite"`，切換條文時播報標題與狀態
- 狀態不可只靠顏色：色票一律帶文字（已生效／待核定／已駁回）
- 焦點環：`outline:2px solid #0b57d0; outline-offset:2px`
- 原文引述用 `<blockquote>` 或 `<q>` 標記語意；出處用 `<cite>`

## State Management
```
filters : { q:string, status:'all'|'pending'|'approved'|'rejected', type:string, phase:string }
items   : [{ id, status, type, phase, who, verified,
             title, rule, desc,
             clause, page, doc, quote,
             criteria, evidence,
             reviewedBy?, links:[{icon,text,href}] }]
selectedId : string
```
衍生值（不另存 state）：`visibleItems = items.filter(matchFilters)`、`counts[status]`、`selected = items.find(byId)`、`shown/total`。

資料需求：
- `GET /projects/:id/highlights?status=&type=&phase=&q=&cursor=` → `{ items, total, counts }`
- `GET /highlights/:id` → 單條完整內容（含 quote、page、links）
- `POST /highlights/:id/approve`、`POST /highlights/:id/reject`（body: reason）、`POST /highlights/:id/supersede`
- `POST /projects/:id/highlights`（手動新增）
- 期限摘要：`GET /projects/:id/deadlines/summary` → `{ overdue, dueSoon, scheduled, done }`
- 原文定位：`GET /documents/:docId/view?page=12&highlight=:id`

## Design Tokens

**Color**
| Token | Hex | 用途 |
|---|---|---|
| text | `#202124` | 主文字 |
| text-secondary | `#3c4043` | 說明文、Secondary 按鈕字 |
| ground | `#f8fafd` | 頁面底色、列 hover、引述框底 |
| card | `#ffffff` | 卡片底 |
| line | `#e3e6ea` | 卡片、列、引述框框線 |
| divider | `#dadce0` | 卡內分隔線、輸入框與按鈕框線 |
| accent | `#0b57d0` | 主色／進行中／選中邊 |
| accent-100 | `#ecf3fe` | 選中列底、chip 選中底、Outlined hover |
| accent-700 / 800 | `#0842a0` / `#062e6f` | hover / active、chip 選中字 |
| neutral 200/300/500/600/700 | `#f1f3f4` / `#e8eaed` / `#bdc1c6` / `#80868b` / `#5f6368` | 灰色票底、骨架、虛線框、次要 icon、次要文字 |
| ok / ok-text / ok-tint | `#146c2e` / `#0f5223` / `#e6f4ea` | 已生效、來源已核對 |
| warn / warn-text / warn-tint | `#a05a00` / `#8a4b00` / `#fef7e0` | 待核定、來源待核對、接近期限 |
| danger / danger-text / danger-tint | `#b3261e` / `#8c1d18` / `#fceeec` | 已逾期、駁回動作 |

**五色語意規則（全系統一致，勿混用）**：紅 = 需立刻處理／逾期；黃 = 待確認／待核定／接近期限；綠 = 正常、已完成、已生效；藍 = 進行中／選取；灰 = 已結束、不適用、已駁回。
本頁常見誤用：「待核定」用紅（應為黃，它不是異常，是正常待辦）、「已駁回」用紅（應為灰，它已不成立）、選中列用綠或灰（應為藍）。

**Type**：`"Google Sans Text","Noto Sans TC",system-ui,sans-serif`。字級 26 / 15 / 13 / 12.5 / 12 / 11.5 / 11 / 10.5 px；weight 只用 400 與 500。所有數字與條號、頁碼、日期加 `font-variant-numeric:tabular-nums`。原文引述行高放到 1.85，說明文 1.8。

**Spacing**：主區 gap 24；卡內容 padding 16–18；檢索區元素間距 8 / 12；列內 gap 14；key–value gap 7/12。

**Radius**：卡片 12px；引述框與關聯列 8px；色票 6px；按鈕與 chip 100px（pill）。

**Elevation**：本頁不用陰影，靠 1px 框線分層（抽屜例外，用 `box-shadow:-2px 0 16px rgba(32,33,36,.16)`）。

**Dark mode**（同系統既有 Material 3 對照）：底 `#202124`、卡 `#292a2d`、框線 `#3c4043`、主色 `#a8c7fa`、綠 `#81c995`、紅 `#f2b8b5`、黃 `#fdd663`，色票底改用深色 tint（`#1f2d24` / `#3a3020` / `#3d2724` / `#0d2f5f`），選中列底 `#0d2f5f`。

## Assets
- **字體**：Google Sans Text（或 Roboto 替代）+ Noto Sans TC。參考稿用 Google Fonts CDN，**產品端請 self-host**（woff2、`font-display:swap`）。
- **圖示**：Material Symbols Outlined。本頁用到 `add`、`search`、`description`、`chevron_right`、`check_circle`、`schedule`、`upload_file`、`payments`、`balance`、`fact_check`、`list_alt`、`verified_user`、`group`、`health_and_safety`、`edit_document`。`check_circle` 用 FILL 1，其餘 FILL 0。請 self-host 或子集化。
- 無圖片資產。

## Files
- `ContractHighlights.reference.html` — 本頁自足設計參考稿（可直接開啟，搜尋／篩選／選取皆可操作）
- `README.md` — 本文件
- 專案根目錄 `ContractHighlights.dc.html` — 同一設計的元件版（含 `showDeadlines` 開關）
- 上游頁「專案文件」的規格見 `design_handoff_project_documents/README.md`；整體系統 token 與元件規範見 `design_handoff_pmis_google_ui/README.md`
- 現行實作在 `PMIS/src/pages/web/Requirements.jsx`（本設計為其改版；請對照上方「明確不做」清單移除舊區塊）
