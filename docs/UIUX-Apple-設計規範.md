# UIUX 設計規範 — Apple Style

**這份文件是規範，不是建議。** 2026-09-11 定案：PMIS 全產品（App 與行銷站）的 UI/UX 一律依本文件；本文件取代 `UIUX/design_handoff_pmis_google_ui/README.md`（W9 Google Workspace／Material 3，已退場）。

定調畫布：`UIUX/design_apple_style/`（`pmis-apple-style.html` 為發佈版，`*.dc.html` 為可再編輯的來源）。
來源：Apple HIG《Principles of Great Design》、WWDC《Designing Fluid Interfaces》、《The Details of UI Typography》。兩支 skill 已裝在 `.claude/skills/`（`apple-design`、`emil-design-eng`、`review-animations`），寫 UI 前先讀。

---

## 0. 資訊架構（已核准方向：疊合版）

| 層 | 決定 | 出處 |
|---|---|---|
| **落地點** | 開啟 App 直接落在「待我處理」，**不做 dashboard**。指標卡不常駐主畫面。 | 方向 A |
| **殼** | 全站只有一個殼：**來源欄 → 清單欄 → 詳情欄**。所有工作面都是這個殼的實例，詳情永遠出現在同一個位置。 | 方向 B |
| **詳情** | 選到履約事項時，詳情欄呈現**契約原文＋條文高亮**，不是欄位表格。 | 方向 C |

「工作面」從導覽單位降級為「來源」。`navConfig.js` 的 `routeRegistry` 與角色限制照舊是安全邊界，不因改版鬆綁。

---

## 1. 判準：動手前的六個問題

任何新畫面、新元件、新流程，六題都要能回答；答不出來就是還沒想清楚。

1. **我在哪？能去哪？那裡有什麼？怎麼出去？** 四題任一個答不出來，這個畫面就會困住人。導覽項用內容命名（「履約時程」），不要用空泛的傘（「總覽」）。
2. **這個元素憑什麼佔版面？有人會對它採取行動嗎？** 不會被點、不會改變決定的數字與圖示，一律刪。
3. **從發現到完成走幾步？能不能少一步？** 跳頁算一步、開對話框算一步、回上一頁算一步。能就地處理就不要跳頁。
4. **控制項離它影響的東西夠近嗎？** 如果需要一個標籤來解釋這個控制項在幹嘛，代表擺錯位置。
5. **做錯了能不能撤回？真的需要確認框嗎？** 預設「先做，給 undo」。確認框只留給不可逆：核定、簽章、刪除。濫用確認框＝訓練使用者盲按。
6. **這個數字來自哪裡？點得進去嗎？** 金額、期限、判定都要能追到來源工項、基準事件或契約條文。追不進去的數字，在政府案裡等於沒有。

### 三條不可退讓

與 `CLAUDE.md` 的四條紅線重疊，任何方向都不得違反：

- **AI 只產草稿。** 介面上 AI 產物必須看得出是 AI 產物（固定用 `--ai` 紫色身分），且人覆核前不進任何統計。
- **數字由確定性引擎算。** 介面要能一路追到來源。
- **每個動作留痕。** 稽核軌跡要看得見，不是藏起來。

---

## 2. 色彩

實作在 `src/index.css` 的 `:root` 與 `.dark`。**改任何一個色值都要重算對比度**，算法與驗證腳本見 §7。

### 規則

- **`--blue` / `--primary` 是填色，不是文字色。** `#0071e3` 當小字坐在 `--surface-2` 上只有 4.10，不過 AA；文字一律用 `--blue-text`。
- **文字色必須對三個底色都 ≥ 4.5**：`--surface`（白卡）、`--bg`（視窗底）、`--surface-2`（chip 底）。只驗白卡會漏——W9 初版就是這樣讓頁首副標低於 AA。
- **狀態圓點、圖示、圖表線走 3:1 圖形門檻**（WCAG 1.4.11），用 `--dot-mute` 而不是隨手挑淺灰。
- **顏色不可單獨承載語意**，必須顏色＋文字並存。
- 一律走 `var(--*)`，不准硬編碼色碼，不准用 Tailwind 內建調色盤（`text-gray-500` 這類）。

### 亮色（括號為對 surface / bg / surface-2 的實算值）

| Token | 值 | 對比 |
|---|---|---|
| `--bg` `--surface` `--surface-2` | `#f5f5f7` `#ffffff` `#efeff4` | — |
| `--text` | `#1d1d1f` | 16.83 / 15.46 / 14.68 |
| `--text-2` | `#56565a` | 7.31 / 6.71 / 6.37 |
| `--text-3` | `#68686d` | 5.54 / 5.09 / 4.84 |
| `--blue` `--primary` | `#0071e3` | 白字 4.70（**不可當小字色**） |
| `--blue-text` | `#0058b0` | 6.95 / 6.38 / 6.06 |
| `--red-text` | `#b3000f` | 6.28（對 `--red-tint`） |
| `--amber-text` `--accent-text` | `#a32b00` | 6.47 |
| `--green-text` | `#1b6b2e` | 5.90 |
| `--purple-text` `--ai-text` | `#703a8c` | 6.87 |
| `--success` / `--danger` | `#1b6b2e` / `#d70015` | 白字 6.58 / 5.38 |
| `--dot-mute` | `#7c7c81` | 4.15 / 3.81 / 3.62（圖形門檻 3:1） |

> Apple 的 accessible systemGreen `#248a3d` 對白底只有 **4.39**，未達小字 AA——只能當圖形色。文字用加深後的 `#1b6b2e`。

### 深色

卡面不是純黑，靠 surface 階層與髮絲線分層。兩個容易錯的地方：

- **`--primary` 在深色是「淺藍底＋深藍字」**（`#2e8fff` + `#00204a` = 4.97）。白字對 `#0a84ff` 只有 3.65，小字不過 AA。寫死 `text-white` 的呼叫端會在深色炸掉，一律走 `--primary-fg`。
- **hover 態比 base 亮，對比一定比 base 低，兩個都要驗。** `--success` `#17693c`(6.73) → hover `#1f7a45`(5.35)；`--danger` `#b3302a`(6.23) → hover `#c7362c`(5.26)。

---

## 3. 字級階梯

實作在 `src/index.css` 的第二個 `@theme` 區塊，命名沿用 Apple 語意名。**禁止再寫 `text-[Npx]` 任意值**——全站曾有 243 處、13 種尺寸含半像素，那是「當下順手」的產物，不是型階。

| Class | 尺寸/行高 | 字距 | 用途 |
|---|---|---|---|
| `text-caption` | 11 / 15 | +0.004em | 佐證、註記、meta |
| `text-footnote` | 12 / 17 | +0.002em | 次要說明、標籤 |
| `text-body` | 13 / 19 | 0 | 內文、表格（資料密集工具的密度不退讓） |
| `text-callout` | 15 / 20 | −0.008em | 卡片標題 |
| `text-title3` | 17 / 22 | −0.012em | 區塊標題 |
| `text-title2` | 22 / 28 | −0.017em | 頁面次標 |
| `text-title1` | 28 / 34 | −0.021em | 頁首 large title |

字距隨字級走：大字負字距、內文近 0。階層用「字重＋字級＋行高」一起建，不要只靠字級。頁首 large title 是 **semibold**，不是 regular。

字體走系統堆疊（`-apple-system` → SF 在 Apple 裝置原生生效），非 Apple 平台落到 Noto Sans TC。**SF Pro 字檔本身授權限 Apple 平台，不可 self-host。**

---

## 4. 形狀與材質

### 圓角

4 微標記 / 6 badge / 7 側欄列與分段內層 / 8 按鈕與輸入 / 10 大按鈕與登入欄位 / 12 卡片 / 16 面板 / 18 登入卡 / 999 只給標籤與正圓。

**藥丸按鈕退場。** capsule 只用在人名與責任方標籤、圖示鈕、狀態圓點。
例外：行銷站沿用 Apple.com 語彙，其 CTA 維持藥丸——**此例外僅限行銷站，不進 App**。

⚠️ Tailwind 的 `rounded-*` **class 名一律不改，只改 `@theme` 的值**。理由見 §7。

### 深度與材質

- 卡：`--shadow-card`（1px 輕影 + 半像素描邊）。Apple 靠描邊，不靠濃陰影。
- 浮起／彈出：`--shadow-md` / `--shadow-overlay`。
- **毛玻璃只給 chrome**（側欄 `.chrome-glass`、工具列 `.chrome-bar`、彈出層）。**內容卡一律實心**——資料表坐在半透明底上會難讀，而且 HIG 明令不可把淺色半透明疊在另一層半透明上。
- 不支援 `backdrop-filter` 時落回 `--chrome-solid`，無破壞。
- chrome 與內容的分界用 **scroll edge effect**（`.chrome-edge[data-scrolled]`），不要常駐 1px 分隔線。

---

## 5. 動效：流動性六條

介面「有生命」的來源不是動畫好看，是它一直在回應你。

1. **回饋在按下，不在放開。** `:active` 就是 pointer-down。等 `click` 才變色＝感覺死掉。順手清掉每一個 debounce 與人為延遲。
2. **1:1 追蹤。** 拖曳時東西要黏在手指上，並尊重「你抓的是哪一點」。抓住就跳到中心，幻覺立刻破。用 Pointer Events + `setPointerCapture`。
3. **可中斷（最重要）。** 動畫飛到一半要能抓住反向，且**從當前呈現值續動，不是從目標值**。過場期間永不鎖輸入。
4. **彈簧，不是時長。** 手勢驅動的用彈簧（damping 1.0 / response 0.3–0.4）；只有甩出去的動作才給 damping 0.8 的回彈。純進出場的浮層用 CSS 過場就夠，不必為了 Apple 味把所有東西都上彈簧。
5. **空間一致。** 從哪裡出來就回哪裡去，並且從觸發它的那個東西長出來（`transform-origin` 對準觸發鈕）。右邊進來、底部出去＝迷路。
6. **邊界是橡皮筋。** 到底了漸進阻尼，不要硬停。硬停讀起來是「當掉」。

Token：`--dur-press`(100) `--dur-fast`(180) `--dur-menu`(200) `--dur-modal`(250) `--dur-sheet`(350)；曲線 `--ease-out` `--ease-in-out` `--ease-drawer`。

### 無障礙三訊號（各自獨立處理）

- `prefers-reduced-motion` → 換成淡入淡出，不是拿掉回饋。
- `prefers-reduced-transparency` → 材質**實心化**，不是只降 blur。
- `prefers-contrast: more` → 實心化並補明確邊界。

---

## 6. 元件規則

- primitives 一律從 `src/components/ui.jsx` 取，不要各頁自抄 class 字串——散裝複本正是深色對比漏修的來源。
- 一個情境只有一顆實心主鈕。
- 手機觸控目標 ≥ 44px，斷點用 `max-md`（<768）對齊 BottomNav 的 `md:hidden`。用 `max-sm` 會讓 640–767px 的 iPad mini 直式拿到手機版面卻是桌機觸控目標。
- 焦點環用 `outline` 不要用 `ring`：`ring-offset` 寫死底色會在非 `--surface` 背景露白缺口，`ring` 是 box-shadow 會被 `overflow-hidden` 父層裁切。
- 狀態必須顏色＋文字並存。
- 空狀態不要只說「沒有資料」，要說**缺什麼、輪到誰、完成後解鎖什麼**。

---

## 7. 測試合約（改版時的地雷）

`src/**/*.test.*` 的 64 支測試**零視覺耦合**（全部用 `aria-label`／`role`／文字內容定位），不會被改版打壞。地雷全在 e2e：

### 不可改的 class 名（15 條 e2e 選擇器靠它定位）

| Class | 條數 | 在哪 |
|---|---|---|
| `rounded-2xl` | 7 | `ui.jsx` 的 `SURFACE` 卡殼 |
| `justify-between` | 4 | 查驗列、`DefectTracker`、`Quality` 判定列 |
| `rounded-lg` | 2 | 送審列、RFI 列 |
| `rounded-xl` | 1 | `/deadlines` 期限卡 |
| `space-y-2` | 1 | 送審球權分群容器 |

**繞法：`@theme` 只改值不改名。** `src/index.css` 的 `@theme { --radius-2xl: 12px }` 就是這招，Apple 圓角沿用同一手法即可零成本保住。反之，把 `SURFACE` 改寫成 `rounded-[14px]` 或新 class，7 條測試同時掛掉。

### 幾何斷言

- **全路由 `scrollWidth <= clientWidth`（375/1024px）** — `a11y.spec.js`、`routes.spec.js`、`contract-flow.spec.js`。**字級或間距一放大整片會紅**，這是改版最容易踩的一條。
- 側欄 1024px 收成 <120px、1280px 展回 >120px。
- 存檔鈕底緣 ≤ BottomNav 頂緣（綁 `--bottom-nav-h`）。
- 按鈕高度 ≥ 44px 抽查。
- `nav` 收合時顯示短標（`NAV_SHORT`）。

### 其他

`src/pages/web/Admin.jsx` 的 `<button role="switch">` 不得換成 `input[type=checkbox]`（監造唯讀 e2e 斷言依賴）。

### 對比度驗證

改色值後跑對比度腳本重算，不要憑感覺。算法：WCAG 2.x relative luminance，`(L_lighter + 0.05) / (L_darker + 0.05)`；小字門檻 4.5、圖形門檻 3.0。每個值的實算結果要寫回 `src/index.css` 的註解。

---

## 8. 尚未完成

本規範的 token 層（`src/index.css`）與 primitives（`src/components/ui.jsx`）已落地。以下待後續工作包：

- **IA 殼**：三欄（來源 → 清單 → 詳情）尚未實作，目前仍是 W9 的側欄＋單頁版面。
- **字級收斂**：全站 243 處 `text-[Npx]` 尚未換成新階梯。
- **圖示**：仍是 Material Symbols subset 字型（96 個相異圖示 / 320 呼叫點 / 29 處動態名）。目標換 lucide-react，`build-icon-font.mjs` 退場（它本來就沒接進 `package.json`）。`MSym` 的 FILL 選取態軸 lucide 沒有對應，導覽選取態要重新設計。
- **手機**：不是桌機縮小版。現場戴手套、單手、太陽下與辦公室審查是兩種工作，要另做形狀。
- **行銷站**：`PMIS_site`（repo `PMIS.marketing`）尚未套用；三支 skill 已複製到該 repo 的 `.claude/skills/`。
