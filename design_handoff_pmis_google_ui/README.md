# Handoff：PMIS.ai 介面改版（Google Workspace 風格）

## Overview
把現有 PMIS.ai（React + Vite + Supabase，繁中，三角色：廠商／監造／機關）的視覺與互動改成 Google Workspace 風格：白底藥丸導覽、64px App bar、`#f8fafd` 灰底＋白卡、Material chips、Material Symbols 圖示、Material 3 深色模式。導覽資訊架構（六個工作面 + 平台管理）與路由**不變**，只換外觀與少數互動模式。

## About the Design Files
本包內的 `PMIS Mockups.dc.html` 是**設計參考**，不是要直接搬進產品的程式碼。它是一份用 HTML/inline styles 寫的原型，用來表達最終長相與行為。實作方式：在現有 codebase（React 19 + react-router + Tailwind + `src/components/ui.jsx`）中**重建**這些畫面，沿用既有元件與樣式機制；不要把 HTML 貼進 repo。

原型內含九個畫面與兩個手機畫面，以內部 state（`route`／`role`／`tab`／`dark`）切換，對應到產品既有路由。

## Fidelity
**High-fidelity。** 顏色、字級、圓角、間距、陰影皆為最終值，請照 token 表實作。資料是虛構專案（桃園市立圖書館新建工程），文案可沿用或換成真資料。照片是灰色佔位塊，需要換成真實現場照片。

## Design Tokens

### 顏色（淺色）
| 用途 | 值 |
| --- | --- |
| 主色 accent | `#0b57d0`（hover `#0842a0`，pressed `#062e6f`）— Material 3 藍，小字對比 5.3:1 |
| accent ramp 100–900 | `#ecf3fe` `#d3e3fd` `#a8c7fa` `#7cacf8` `#1b6ef3` `#0b57d0` `#0842a0` `#062e6f` `#041e49` |
| 文字 | `#202124`（次要 `#5f6368`，弱 `#80868b`） |
| neutral ramp 100–900 | `#f8f9fa` `#f1f3f4` `#e8eaed` `#dadce0` `#bdc1c6` `#80868b` `#5f6368` `#3c4043` `#202124` |
| 卡面 / 卡線 / 內容底 | `#ffffff` / `#e3e6ea` / `#f8fafd` |
| chip 底 / 搜尋框底 | `#f1f3f4` / `#ecf3fe`（hover `#dfeafd`） |
| 危險（逾期、高風險） | `#b3261e`，小字 `#8c1d18`，tint `#fceeec` |
| 警告（待確認、低信賴度） | `#a05a00`，小字 `#8a4b00`，tint `#fef7e0` |
| 成功（合格、已啟用） | `#146c2e`，小字 `#0f5223`，tint `#e6f4ea` |

### 顏色（深色 · Material 3）
底 `#202124`、卡面 `#292a2d`、線 `#3c4043`、文字 `#e8eaed`、主色 `#a8c7fa`（accent ramp 100–300 為 `#0d2f5f` `#123f7d` `#1f52a0`）；狀態色 `#f2b8b5` / `#fdd663` / `#81c995`；chip 底 `#35363a`、搜尋框 `#303134`。深色時 primary button = `#a8c7fa` 底 + `#062e6f` 字；secondary = 透明底、`#5f6368` 邊、淺藍字。
實作建議：一組 CSS 變數 + `.dark` class（或 `data-theme`），沿用產品既有 `src/lib/theme.js` 的三態（亮／暗／跟隨系統）。

### 字型
- UI：`"Google Sans Text", "Noto Sans TC", system-ui, sans-serif`
- 大標與大數字：`"Google Sans Display", "Google Sans", "Google Sans Text", "Noto Sans TC"`（未安裝時自動退回）
- 數字一律 `font-variant-numeric: tabular-nums; font-feature-settings:"tnum"`
- 字級：頁面標題 24px/400（letter-spacing −0.005em）；卡片標題 15px/500；正文 13px/1.6；輔助 11.5–12px；大數字 27–30px/400
- 不使用小型大寫或字距放大（先前的襯線版本已移除）

### 圓角 / 陰影 / 間距
- 圓角：卡片 12px、輸入框與 chip 8px、按鈕與導覽項 100px（藥丸）、登入卡 28px、手機外框 40px
- 陰影：`sm 0 1px 2px rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.08)`；`md 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.1)`；`lg 0 2px 6px rgba(60,64,67,.3), 0 8px 24px 6px rgba(60,64,67,.12)`
- 內容區 padding 20px 24px 40px；卡片內距 13–16px 16–18px；卡片間距 20–24px；指標卡 gap 16px

### 圖示
Material Symbols Outlined（可變字軸 `FILL 0→1`；選取態用 FILL 1）。導覽：`checklist` `engineering` `rate_review` `payments` `folder` `grid_view` `admin_panel_settings`；App bar：`menu` `folder_open` `search` `tune` `dark_mode`/`light_mode` `smartphone` `notifications` `help`；AI 入口 `auto_awesome`；狀態 `verified_user` `shield` `location_on` `history` `fact_check` `badge` `architecture`。
**現有 codebase 用的是 lucide-react**，二選一：(a) 換成 Material Symbols 字型／`@material-symbols` SVG，(b) 保留 lucide 但改用等義圖示（`ClipboardCheck` `HardHat` `FileSearch` `Wallet` `Folder` `LayoutGrid` `Sparkles`）。建議 (a)，Google 感主要來自圖示與藥丸選取態。

## 版面骨架（桌機 1440px）
`grid-template-columns: 256px 1fr`；左側 aside 白底、無右邊界線；右側 main 底色 `#f8fafd`。

### 1. 導覽（左側 256px）
- 頂端 56px：`menu` 圓形圖示鈕（40px，hover `#f1f3f4`）＋ `PMIS`（20px/500）`.ai`（accent）
- 「問 PMIS」浮起按鈕：高 44px、圓角 22px、白底 + shadow-sm（hover shadow-md）、左側 `auto_awesome`（accent），佔 Gemini 在 Workspace 的位置
- 群組標題「工作面」11px/500 `#5f6368`
- 導覽項：高 40px、`border-radius: 0 100px 100px 0`、icon 20px + 文字 14px、右側未處理件數（tabular）
  - 選取態：底 `#e8f0fe`、字 `#174ea6`、圖示 FILL 1、字重 500；未選取 hover 底 `#f1f3f4`
- 分隔線後為「平台管理」（僅機關／平台管理員可見）
- 底部：`verified_user`（綠）＋「正式模式 · 稽核中」

### 2. App bar（64px，白底，無邊界線）
專案切換 chip（44px 高、圓角 22px、底 `#f1f3f4`、`folder_open` + 專案名 + `arrow_drop_down`）→ Gmail 式搜尋框（flex，max 560px、44px 高、圓角 22px、底 `#edf2fc`、`search` + placeholder「搜尋工項、送審、缺失、契約條文……」+ `tune`）→ 右側 40px 圓形圖示鈕群（深色切換／手機版／通知（右上 7px 紅點）／說明）＋ 32px 圓形頭像（accent 底、白字、單字）。

### 3. 登入者身分（不是切換器）
產品**沒有**角色切換 UI。身分在註冊時選定（見註冊頁），登入後只呈現本人：App bar 右側為「32px 圓形頭像 + 姓名 12.5px/500 + 機構·角色 11px `#5f6368`」的兩行帳戶區，整塊 20px 圓角、hover `#f1f3f4`，點擊開帳戶選單。
原型為了讓你比較三個角色，把切換器放在**畫面框外**的灰底列，並標示「原型檢視（不屬於產品介面）」——實作時整條不要移植。同一列的「我是平台營運者」也只是模擬 `profiles.is_platform_admin`。

### 4. 頁首
標題 24px/400 + 說明 13px `#5f6368`（max 660px）+ 右側動作鈕（36px 高，primary 實心藍 / secondary 白底藍字）。分頁改為 Material chips（32px、圓角 8px、選取態淺藍底深藍字）——取代原本的底線 tabs。

## Screens
每個畫面對應現有路由，內容區塊如下（欄寬為 1440px 下的實測值）。

1. **今日待辦 `/dashboard`** — 四張指標卡（1fr×4，gap 16）：實際進度／契約金額／已計價／剩餘工期（隨角色不同）；下方 `1.35fr 1fr`：左「今日待辦」列表（每列 `74px 1fr auto`：期限、標題＋說明、案號；逾期用 `#d93025`），右上「風險警示」（卡頭 `#fce8e6` 底、標題 `#a50e0e`、每則含等級／分類／依據／兩顆動作鈕）、右下「AI 今日已代辦」（項目＋數量，accent 色數字）。
2. **現場與品質 `/site-log`（tabs：品質查驗／檢驗停留點／工安）** — 左：AI 草稿提示卡（accent-100 底）、施工日誌表格（施作項目／位置／人力／機具／查驗）、現場照片 4 格（1px 邊、8px 圓角、`aspect-ratio 4/3`，異常字色 accent/danger）；右：缺失追蹤、檢驗停留點＋「申請查驗」全寬鈕。
3. **審查與協作 `/requirements`（tabs：送審文件／工程疑義／變更設計）** — 左：契約重點表格（條號／履約要求＋來源頁碼／責任方／期限／信賴度／核定・退回）；右：送審文件佇列、AI 審查助理卡（accent-100）、RFI 列表。
4. **進度與金流 `/boq`（tabs：估驗計價／請款收款／S 曲線）** — 四張金額卡；左：工項明細表（項次縮排 16px 表階層、數字右對齊）＋底部 AI 差異提示與兩顆動作鈕；右：S 曲線（inline SVG，計畫虛線 `#80868b`、實際實線 accent、端點圓點＋標註）、請款與保留款列表。
5. **文件與結案 `/contract`（tabs：施工月報／監造報表／驗收結算）** — 左：文件表格（文件＋上傳者／分類／版本／AI 處理狀態／上傳日）；右：驗收結算時序（7px 方點，已完成填 accent）、施工月報 AI 草稿卡。
6. **跨案總覽 `/portfolio`（tabs：活動紀錄／三方成員）** — 全寬跨案表格（專案＋階段／廠商／契約金額／計畫／實際／已計價／風險，落後與風險用 danger）；下方兩欄：跨案例外事項、活動紀錄（時間 + 事件）。
7. **問 PMIS `/agent`** — 左：對話（使用者泡泡靠右、白底 1px 邊；回覆含編號清單與來源連結；底部「取用資料 · Tool trace」灰卡；輸入列 = 輸入框 + 送出鈕）；右：常問清單（可點的整列按鈕）、代理權限開關三則。
8. **登入 `/login`** — `#f8fafd` 底、置中 920px 白卡（圓角 28px、1px 邊、shadow-sm）、兩欄：左為品牌＋「登入」32px/400＋說明＋三條資安說明（綠色圖示）；右為浮動標籤輸入框（52px 高、focus 時邊框與標籤轉 accent）、保持登入 30 天、忘記密碼、「建立帳戶」連結 + 「下一步」實心鈕、分隔線、GSN SSO 次要鈕；卡外底部語言與說明／隱私權／條款列。
9. **平台管理 `/admin`（僅平台管理員）** — 四張用量卡；左：專案方案與 AI 用量表；右：功能開關列表（狀態色）、資安與留存摘要。

### 手機（390×800，Material）
- **現場**：頂部日期與天氣、AI 草稿卡（accent-100，兩顆 44px 高鈕）、照片 3 格、AI 異常偵測卡、人力／機具／項目摘要；底部 Material bottom navigation（4 項，選取態 56×30 藥丸底 `#e8f0fe` + FILL 1 圖示 + 11px/500 標籤）。
- **今日待辦**：專案名 + 標題、待辦列表（逾期為實心方點）、底部全寬「問 PMIS：今天最該處理什麼？」鈕。
- 所有可點目標 ≥ 44px。

## Interactions & Behavior
- 導覽切換工作面 → 分頁重設為第一頁（原型行為 `setState({route, tab: 0})`）；產品應維持深連結。
- 分頁 chips 只切換視圖，不變更路由層級以外的狀態。
- 深色切換：立即套用，建議持久化（沿用 `pmis-theme`／既有 theme.js）。
- hover：導覽項與圖示鈕 `#f1f3f4`；表格列 hover `#f8fafd`；primary 鈕 `#1b66c9`。
- focus-visible：`2px solid #1a73e8`，offset 2px（深色為 `#8ab4f8`）。
- 原型未實作的狀態，仍需在產品補上：載入骨架、空狀態、錯誤（沿用 `errorMessage.js` 文案）、送出中禁用。

## State Management
原型層級：`route`（畫面）、`role`（預覽角色）、`tab`（分頁索引）、`dark`（主題）。產品端不需新增 store：角色來自 `currentUser.org_type`、資料來自現有 slices，主題沿用 `theme.js`。

## 補齊項目（第二版新增）

### 平板（768–1279px）：icon rail
原型的 `tablet_mac` 按鈕（App bar）。1024×768：導覽收合成 80px rail — 48px `menu` 圓鈕、56×44 浮起 AI 鈕、六個項目為「56×32 藥丸圖示 + 10.5px 標籤」直排（選取態底 `#e8f0fe`、圖示 FILL 1、右上角紅色數字），App bar 降為 60px 且搜尋框收成圖示鈕，內容改兩欄指標卡。斷點建議：≥1280px 完整 256px 導覽、768–1279px rail、<768px 手機（bottom navigation）。

### 載入／空／錯誤／送出中
原型的 `widgets` 按鈕（App bar，「元件與狀態」頁）。
- **骨架**：`#e8eaed` 色塊、圓角 4px、`opacity .45→1→.45`、1.4s ease-in-out infinite。列高與欄位位置必須等於載入後，避免位移。
- **空狀態**：置中 40px 圖示（`inbox`，`#bdc1c6`）＋14px/500 標題＋12px 說明（max 240px）＋一顆 secondary 動作鈕。
- **錯誤**：`#fce8e6` 底、8px 圓角、`error` 圖示 `#d93025`、13px/500 標題 + 12px 說明，動作為「重試」(primary) 與導向頁 (secondary)。文案沿用既有 `errorMessage.js`：查詢失敗要說失敗，不可靜默當成 0 筆。
- **送出中**：primary 鈕 disabled + `progress_activity` 圖示 0.9s linear 旋轉；停用態 opacity 依 Material 用 38%（原型沿用 DS 的 45%）。

### Dialog / Snackbar / Menu
- **Dialog**：白卡、圓角 28px、shadow-lg、內距 24px；標題 19px/400 配 24px 圖示；正文 13px/1.75；動作靠右（ghost「取消」＋ 危險動作為 `#d93025` 實心白字）。危險動作要求輸入專案名稱確認（沿用既有 `appConfirm` 的 `requireText`）。
- **Snackbar**：`#3c4043` 底、`#e8eaed` 字、8px 圓角、14/16px 內距、shadow-md；行為 13px/500 `#8ab4f8`；左下角出現，4 秒消失，含破壞性動作時附「復原」並延長至 8 秒。
- **Menu**：288px 寬、8px 圓角、shadow-md、上下 8px 內距；列高 40px、內距 0 14px、hover `#f1f3f4`；目前項為 `#e8f0fe` 底 + `check`；破壞性項 `#d93025` 字、hover `#fce8e6`。

### 表格：排序、篩選、分頁
- 篩選列在卡頭：已套用的篩選是 accent chip + `close`；未套用是白底 chip + 前置圖示（`filter_list`／`calendar_month`）。
- 排序欄位標題轉 accent 並附 `arrow_upward`／`arrow_downward`。
- 分頁在卡底靠右：「每頁列數 25 ▾ · 1–25 / 106 · ‹ ›」，數字 tabular，不可用的箭頭降為 `#bdc1c6`。

## 第三版修訂（狀態顏色、註冊角色、平台維度、表格對齊）

### 狀態色一律「色票（tinted chip）」而非純文字色
每個狀態都用 6px 圓角、22px 高、內距 0 8px、11px/500 的色票呈現，五個語意固定：

| 語意 | 用在哪 | 底色 | 字色（淺／深） |
| --- | --- | --- | --- |
| danger 需立刻處理 | 高風險、逾期、不符規範 | `#fce8e6` | `#a50e0e` / `#f28b82` |
| warn 待確認、接近期限 | 中風險、今日到期、低信賴度、限定啟用 | `#fef7e0` | `#b06000` / `#fdd663` |
| ok 正常 | 低風險、已核可、已排定、啟用 | `#e6f4ea` | `#137333` / `#81c995` |
| info 進行中 | 審查中、AI 處理中、待複驗 | `#e8f0fe` | `#174ea6` / `#d2e3fc` |
| mute 已結束 | 已結案、停用、無需處理 | `#f1f3f4` | `#5f6368` / `#bdc1c6` |

- **風險分級**：高＝danger、中＝warn、低＝ok，色票文字為「風險 高／中／低」。風險警示卡頭為中性白底，只有標題左側 20px `warning` 圖示上 `#d93025`；不要讓整張卡或卡頭鋪紅底，顏色只出現在分級色票與動作鈕上。
- **今日待辦期限**：逾期 danger、今日 warn、其餘 mute；手機版用同色系實心圓點。
- **跨案總覽**：實際進度數字依落後幅度取 danger／warn／ok 文字色，風險欄為色票。
- 色票一律「顏色 + 文字」並存，不可只靠顏色傳達（色弱與報讀器）。

### 註冊時就選角色（新畫面）
登入頁「建立帳戶」→ 註冊頁（960px 卡片、步驟 1/2）。三張角色卡（施工廠商／監造單位／機關業主）並排：選取態為 2px accent 邊框 + `#e8f0fe` 底 + 右上 `check_circle` + 圖示轉 FILL 1；每張說明「做什麼」與「看不到什麼」（廠商可見成本、監造不經手請款、機關不可見廠商毛利）。下方為姓名、機構名稱（label 與預填值隨角色變）、公務信箱、專案邀請碼（選填），再加一條隨角色變的藍色提示。角色寫入 `profiles.org_type`，之後僅專案建立者可調整。

### 平台管理是獨立維度，不是專案角色
`platformAdmin` 與 `org_type` 完全獨立：機關角色也看不到「平台管理」。原型在身分列右側以分隔線後的「平台管理員（你）」色票模擬 `profiles.is_platform_admin`；關掉時側欄不渲染該項，且若正停在 `/admin` 會被踢回 `/dashboard`。實作沿用既有 `platformAdminOnly` 與資料庫端 `is_platform_admin()` 檢查，前端隱藏只是 UX。

### 估驗計價表格對齊
`table-layout: fixed` + `colgroup`：項次 88px、工項 auto、契約數量 104px、本期 88px、累計 % 78px、本期金額 118px。所有數字欄右對齊、`tabular-nums`、`white-space: nowrap`；工項階層改用「18px 空白 span + 文字 span」的 flex 結構，縮排不會推移其他欄位；父層工項 500 字重並加 `#f8f9fa` 列底色；表尾固定一列合計（`#f1f3f4` 底）。長工項名以 `text-overflow: ellipsis` 截斷，不換行造成列高不一。

## 產品標誌（assets/brand/）
三個點＝機關（藍 `#1a73e8`）、監造（紅 `#ea4335`）、廠商（黃 `#fbbc04`），以中性灰 `#dadce0` 的正三角連線代表同一份契約事實（深色版連線 `#5f6368`，點 `#8ab4f8`／`#f28b82`／`#fdd663`）。

- 檔案：`pmis-mark.svg`（全彩）、`pmis-mark-mono.svg`（單色藍）、`pmis-mark-black.svg`、`pmis-mark-white.svg`（反白）、`pmis-mark-dark.svg`、`pmis-lockup.svg`、`favicon.svg`（16px 加粗調校版）、`app-icon.svg`（白底全彩）、`app-icon-blue.svg`（藍底反白）。
- 尺寸：24px 以下改用 `favicon.svg` 的加粗版本；最小 16px（印刷 5 mm）。
- Lockup：標誌高＝大寫高 ×1.35，標誌與字距＝標誌寬 ×0.28；四周留白至少一個點直徑。
- 品牌四色**只用於標誌與行銷素材**，不進入元件（介面的紅／黃已有狀態語意）。
- 不要旋轉、加漸層陰影外框、改動三方顏色對應、非等比拉伸。

## Assets
- Google Fonts：`Google Sans Text`、`Noto Sans TC`、`Material Symbols Outlined`（可變字軸）。
- **Self-host（機關禁外連 CDN 時）**：下載 `Noto Sans TC`（建議 subset 300/400/500/700）與 `Material Symbols Outlined` 可變字型的 woff2，放 `public/fonts/`，以 `@font-face`（`font-display: swap`；圖示字型用 `font-display: block`）自行宣告；`Google Sans` 系列非公開授權，退回 `system-ui`／`Noto Sans TC` 即可，視覺差異極小。圖示也可改用 `@material-symbols/svg-400` 的 SVG 以避免字型檔（約 3.5 MB 可變檔）。CSP 需允許 `font-src 'self'`。
- 現場照片：`assets/photos/` 共五張真實查驗照片（鋼線網 BAU-36 線徑與搭接量測、查驗告示牌），已用於「現場與品質」的照片牆與手機版照片格。實作時走既有 Supabase storage，並保留 EXIF 時間與工項對應。

## Files
- `PMIS Mockups.dc.html` — 全部九個桌機畫面 + 兩個手機畫面 + 深色模式的單檔原型。直接在瀏覽器開啟；左側導覽切換工作面，App bar 的月亮鈕切深色、手機圖示看手機版、問號鈕看登入頁。

## 實作順序建議
1. 建立 token 層（CSS 變數 + 深色）與字型、圖示方案。
2. 改 `src/components/Layout.jsx`：導覽藥丸態、App bar、搜尋框、頭像。
3. 建共用外殼元件：頁首（標題／說明／動作／chips 分頁）、卡片、表格樣式。
4. 逐頁換殼：Dashboard → SiteLog → Requirements → BOQ/Valuation → Contract/Acceptance → Portfolio → Agent → Admin → Login。
5. 補深色模式細節與 a11y（對比、focus ring、44px 觸控目標），跑既有 `e2e/a11y.spec.js`。
