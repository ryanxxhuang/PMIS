# UIUX 設計規範 — Apple Style

> 狀態：**ACTIVE ｜ 生效：2026-09-11**
> 決策依據：[`DECISIONS.md`](DECISIONS.md) D-021。`DEVELOPMENT.md` §1 指定本檔為全產品 UIUX 單一真相。
> 取代：`UIUX/design_handoff_pmis_google_ui/`、`UIUX/design_handoff_contract_highlights/`、`UIUX/design_handoff_contract_highlights_timeline/`（已取代並於文件精簡時刪除，原檔見 Git `c39e395`）。

**這份文件是規範，不是建議。** 2026-09-11 定案：PMIS 全產品（App 與行銷站）的 UI/UX 一律依本文件；本文件取代 `UIUX/design_handoff_pmis_google_ui/README.md`（W9 Google Workspace／Material 3，已退場）。

定調畫布：`UIUX/design_apple_style/`（`pmis-apple-style.html` 為發佈版，`*.dc.html` 為可再編輯的來源）。
來源：Apple HIG《Principles of Great Design》、WWDC《Designing Fluid Interfaces》、《The Details of UI Typography》。三支 skill 已裝在 `.claude/skills/`（`apple-design`、`emil-design-eng`、`review-animations`），寫 UI 前先讀。

---

## 0. 資訊架構（已核准方向：疊合版）

| 層 | 決定 | 出處 |
|---|---|---|
| **落地點** | 開啟 App 直接落在「待我處理」，**不做 dashboard**。指標卡不常駐主畫面。 | 方向 A |
| **殼** | 全站只有一個殼：**來源欄 → 清單欄 → 詳情欄**。所有工作面都是這個殼的實例，詳情永遠出現在同一個位置。 | 方向 B |
| **詳情** | 選到履約事項時，詳情欄呈現**契約原文＋條文高亮**，不是欄位表格。 | 方向 C |

「工作面」從導覽單位降級為「來源」。`navConfig.js` 的 `routeRegistry` 與角色限制照舊提供前端守衛，真正安全邊界為 RLS／RPC／trigger，不因改版鬆綁。

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

與 `DEVELOPMENT.md` §4 的產品邊界重疊，任何方向都不得違反：

- **AI 草稿須可辨識。** 業務草稿以 `--ai` 紫色身分呈現，人覆核前不進正式統計；契約轉錄依 D-019／D-020 自動確認與物化，仍揭露原文優先及核對疑慮。
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

`src/**/*.test.*` **零視覺耦合**（全部用 `aria-label`／`role`／文字內容定位），不會被改版打壞。地雷全在 e2e。

> 本節刻意不寫死數量——寫死的數字只會過期（這份文件就出現過「64 支測試／15 條選擇器」對不上實際的情況）。用指令查當下的真實值：
> ```bash
> grep -rn 'contains(@class' e2e/ | wc -l
> ```


### 不可改的 class 名（e2e 選擇器靠它定位）

| Class | 在哪 | 狀態 |
|---|---|---|
| ~~`rounded-2xl`~~ | `ui.jsx` 的 `SURFACE` 卡殼 | 已解除（`Card` 有 `title` 即 `role="group"` + `aria-labelledby`，改用 `getByRole('group', { name })`） |
| ~~`justify-between`~~ | `DefectTracker` 缺失列、`Quality` 查驗列 | 已解除（兩處改成 `<ul role="list">`/`<li>`，改用 `getByRole('listitem')`） |
| ~~`rounded-lg`~~ | 送審列、RFI 列 | 已解除（兩頁轉殼時改成語意定位） |
| ~~`rounded-xl`~~ | `/deadlines` 期限卡 | 已解除（同上） |
| ~~`space-y-2`~~ | 送審球權分群容器 | 已解除（分群改快篩 chip） |

**class 定位器已歸零**（上面那道 grep 應為 0）。最後兩組的解法都是補語意、不是改 e2e：`Card` 有 `title` 就掛 `role="group"` + `aria-labelledby`（用 `group` 不用 `region`——有名稱的 `section` 是 landmark，每張卡都掛會把報讀器的地標清單灌爆；沒有 `title` 的卡維持純 div）；缺失列與查驗列改成真正的 `<ul>`/`<li>`，`<ul>` 明寫 `role="list"`，因為 Tailwind preflight 的 `list-style: none` 會讓 Safari 拿掉清單語意。`/quality` 的「現在要處理」佇列刻意維持 button 不當 `<li>`，否則 `getByRole('listitem')` 會雙重命中。

**`@theme` 只改值不改名**仍是圓角的做法（`src/index.css` 的 `@theme { --radius-2xl: 12px }`），但 `rounded-2xl` 這個名已不再是測試合約。

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

- **IA 殼**：**三個方向都已落地**。落地點（方向 A）——側欄第一區「球在誰手上」（現在輪到我／等待對方／今天已完成）持有 `/dashboard`，主畫面依 `?ball=` 一次聚焦一段，四張指標卡已依判準第 2 條移除。**導覽已完成從「工作面」到來源模型的遷移（2026-09-11）**：側欄分區＝球在誰手上 → 工作（現場與品質／審查與協作／進度與金流／報表與結案／專案，群組＋子頁，子頁依角色過濾、整組不可見就不渲染）→ 參考（契約重點／專案文件／標單工項，扁平項）→ 平台（僅平台管理員）。「今日待辦」工作項退場，`/dashboard` 只剩球權來源一個入口，`aria-current` 天然只落一處；五個群組解封，Dashboard 的「最近施工日誌」卡隨之移除（它的存在理由只是可發現性）。手機 BottomNav＝主畫面槽（現在輪到我）＋前三個工作項。**清單／詳情殼已推廣到九頁**（方向 B）：契約重點、擷取審核、工安管理、工程疑義、期限追蹤、送審文件、變更設計、三方成員、活動紀錄。桌機常駐右欄、`<lg` 走抽屜。**原文高亮（方向 C）已完成**：`f4fbfca` 原文定位器（引述比對回原文位置）、`0c0b4f8` 契約重點詳情欄顯示契約原文＋條文高亮。
  - **版面一律走 `ListDetailLayout`**，不要逐頁手抄兩欄 grid。欄寬只有兩個登記值：`LIST_DETAIL_GRID`（400px，預設）與 `LIST_DETAIL_GRID_WIDE`（640px，`width="wide"`，只給詳情含表格或巢狀編輯器的頁面）。**刻意不開放任意寬度**——開放就會回到每頁自己填一個數字的老路，最初 `/requirements` 400 與 `/requirements/review` 392 那 8px 就是這樣漂出來的。
  - **分群一律改快篩 chip，不在清單內保留區段標題**。四頁原本各自分群（工安按型別、期限按期程、送審與疑義按球權），統一成 `StatusChip` + 件數。兩套分群語彙並存會讓人搞不清誰是主軸。
  - **動作移進詳情欄**是這個殼的核心。連帶的測試代價要一起付：`e2e` 原本大量靠「在那一列裡面找按鈕」定位，改版後必然失效，本輪把 `rfi` / `submittals` / `contractor`(期限追蹤) / `owner`(B-02) 四支改成 `getByRole('listitem')` + `getByRole('region', { name: '… 詳情' })`，class 定位器歸零。
  - ⚠️ **改寫 e2e 時的兩個坑**（都實際踩過）：① 按鈕名一律 `exact: true`，否則快篩 chip 的文字（例如「待廠商確認結案 0」）會被子字串比對吃成按鈕名。② 動作改成只在詳情欄渲染之後，**不選中任何一筆就斷言「某顆鈕不存在」會變成空洞測試**——本來就沒渲染，當然是 0。要先選中讓詳情欄渲染，再加一條正向斷言證明面板有內容，然後才斷言 `toHaveCount(0)`。那類斷言多半是權限測試，失效了不會有人發現。
  - **不套殼的三頁**：`/quality`（只是路由器，清單在子元件）、`/valuation`（1040px 標單樹）、`/payments`（10 欄就地編輯表，每格本來就可編）。它們沿用殼的零件即可，不要硬套版面。
  - 導覽的地雷：`navConfig.js` 同時是路由與權限的單一真相，重劃分區只能動 `title` 與 `hidden`，每個 item／tab 的 `roles` 一字不改（`navConfig.test.js` 直接對定義做結構斷言，`routeRegistry` 的鍵集合也釘死）。`/dashboard` 登記在非導覽表，由球權來源持有——不要再把它加回工作或參考分區，那會回到兩個入口指向同一頁的老路。
- **字級收斂**：**已完成**。`@theme` 把 Tailwind 內建 `text-xs/sm/base/lg` 對映到階梯（460+ 處零編輯生效），另逐處改寫 158 個任意值。`Contract.jsx` / `Requirements.jsx` / `RequirementsReview.jsx` 的其餘字級已由 `b7a1000` 收尾；本輪核對三頁無任意 px 字級。
- **圖示**：**已換成 lucide-react**（98 個對映）。做法是改寫 `MSym` 的實作而不動 271 個呼叫點——元件名、`name`/`size`/`fill`/`className` props 全部不變，名字沿用 Material Symbols 的 ligature 名（那些名字散在 `navConfig`／`agentRole`／`aiInsights` 等資料層，改名等於同時改資料與呼叫端）。subset 字型、`build-icon-font.mjs`、`icon-names.mjs`、`iconFont.test.js` 一併退場。
  - `fill`（Material 的 FILL 軸）lucide 沒有對應，退化成描邊加重一階。Apple 的選取態本來就是「淺色底＋主色圖示」而不是填滿字形。
  - 新增圖示＝在 `src/components/icons.jsx` 的 `ICONS` 加一行。漏對映會畫中性圓圈並在 dev console 警告——**刻意不用長得像真圖示的東西當退路**，實測就發生過 `shield` 漏對映卻剛好畫出盾牌，只有警告抓得到。
  - 驗證方式：走過 35 條路由收 console 警告，比正則掃描可靠（正則抓不到 `<Section icon="…">` 與 `toolBtn('rect', 'crop_square', …)` 這類寫法）。
- **品牌資產**：**已完成**（`0c7570c`）——`public/` 的品牌標記換成 Apple 色票，三個點對應契約三方。
- **手機**：不是桌機縮小版。現場戴手套、單手、太陽下與辦公室審查是兩種工作，要另做形狀。
- **行銷站**：`PMIS_site`（repo `PMIS.marketing`）尚未套用；三支 skill 已複製到該 repo 的 `.claude/skills/`。
