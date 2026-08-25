# Handoff: 契約重點 · 履約時程（三方共用檢視頁）

## Overview
PMIS.ai 的「契約重點」頁。單一目的：**AI 讀完契約與規範後，把每一條要遵守的義務排到時程上（開工第一天 → 完工 → 保固期滿），讓三方各自看到該看的執行情形**。

**這一頁不做審核。** 沒有核定、駁回、送審流程——那些在其他頁面。這裡只有兩種操作：標記自己的義務完成、上傳佐證文件。加上任何人都能回報「AI 擷取有誤」。

上游是「專案文件」（上傳契約 → AI 擷取）。下游是期限追蹤、送審文件、估驗計價、驗收結算。

---

## 1. 角色可見範圍（先讀這一節）

這是本頁唯一的權限規則。**整個頁面只有一個元件、一個 `role`，不要為三個角色各做一頁。**

```js
const VISIBLE = {
  廠商: ['廠商'],
  監造: ['監造', '廠商'],
  機關: ['廠商', '監造', '機關'],
}
// 可見義務 = items.filter(r => VISIBLE[role].includes(r.who))
```

| 角色 | 看得到誰的義務 | 履約執行卡 | 責任方篩選 |
|---|---|---|---|
| 廠商 | 只有自己 | 1 張 | 不顯示（無意義） |
| 監造 | 自己 + 廠商 | 2 張 | 顯示 |
| 機關 | 廠商 + 監造 + 自己 | 3 張 | 顯示 |

**動作權限與角色無關，只看歸屬**：

```js
const isMine = item.who === role
// isMine === false → 唯讀，動作列顯示「由〈who〉負責執行，本頁為唯讀檢視。」
```

除此之外，三個角色的版面、時間軸、詳情面板、篩選行為**完全相同**。差異只有：可見義務集合、執行卡張數、責任方篩選是否出現。

### 待確認的設計問題（請你評估後給建議）

1. **監造與機關是否需要區分為兩個角色？** 目前兩者共用同一版面，差別只在可見集合（監造 2 方、機關 3 方）。可能的收斂方式：
   - (a) 保留三個角色，如上表（現況設計）
   - (b) 收斂成兩種模式：`self`（只看自己）與 `oversight`（看多方），可見集合由後端依身分回傳，前端不判斷角色
   - (c) 完全不分角色，前端只渲染後端回傳的義務清單與 `canAct` 旗標
   請就資料層與權限維護成本評估，說明你的建議與理由。
2. **機關是否應該看到自己的義務？** 現況設計為「是」——機關有 3 條自身義務（估驗撥付、初驗、驗收），不顯示會讓履約時程有缺口。但需求描述為「機關要看監造跟廠商」，請確認。
3. **履約準時率的定義**：現況為 `已完成 ÷（已完成 + 已逾期）`，未到期項不計入。請確認是否符合稽核需求，或應改為「應完成項準時率」等其他定義。

---

## About the Design Files
`ContractHighlights.timeline.reference.html` 是**設計參考稿**，不是要搬進產品的程式碼。用瀏覽器直接開啟即可操作：切換身分、搜尋、狀態快篩、期程篩選、責任方篩選、點列換詳情，全部可動。

請在目標專案既有環境重建（React 19 + Tailwind、沿用現有元件庫與資料層）。字體用 Google Fonts CDN 只為方便預覽，產品端請 self-host。

## Fidelity
**High-fidelity。** 顏色、字級、間距、圓角、狀態語意、互動行為都是最終值，請照著做到像素級一致。

---

## 2. 版面

- 頁面底色 `#f8fafd`，內容欄最大寬 1360px，置中，padding 28px 24px 56px
- 由上到下四塊：頁首與身分切換 → 履約執行卡 → 履約期程條 → 主區（時間軸 + 詳情）
- 主區：`grid-template-columns: minmax(0,1fr) 400px; gap: 24px; align-items: start`
- 右欄 `position: sticky; top: 24px`
- 卡片一律 `background:#fff; border:1px solid #e3e6ea; border-radius:12px`
- 本頁不用陰影，靠 1px 框線分層

### 2.1 頁首與身分切換

- H1「契約重點 · 履約時程」26px / weight 400 / `letter-spacing:-.005em`
- 副標 13px `#5f6368` / line-height 1.7 / max-width 740px，**依角色換文案**：
  - 廠商：「AI 已讀完契約與規範，把你要遵守的每一條排到時程上——從開工第一天到保固期滿，什麼時候該做什麼、依據哪一條，都在這裡。」
  - 監造：「AI 已讀完契約與規範，逐條排到時程上。這裡可以看到你自己與廠商的履約執行情形。」
  - 機關：「AI 已讀完契約與規範，逐條排到時程上。這裡可以一次看到廠商與監造的履約執行情形。」
- 右上角身分切換：label「檢視身分」11.5px `#5f6368` + pill 群組（外框 `1px solid #dadce0`、圓角 100px、padding 2px、白底），每顆高 30px、padding 0 14px、字 12px/500、icon 16px；選中 `background:#0b57d0; color:#fff`
- 切換器下方註記 10.5px `#80868b`：「示範用切換 · 實際依登入身分自動套用」

> **實作**：切換器只是 mockup 用的。產品端依登入身分自動決定 `role`，不渲染切換器（或僅對具備跨方檢視權限的帳號顯示）。

### 2.2 履約執行卡

每個可見責任方一張，`display:flex; gap:12px`，每張 `flex:1; min-width:260px`，卡片左側 3px 標示色邊（`border-left:3px solid`）。

| 責任方 | 標示色 | icon |
|---|---|---|
| 廠商 | `#0b57d0` | `engineering` |
| 監造 | `#a05a00` | `checklist` |
| 機關 | `#146c2e` | `account_balance` |

卡內（padding 14px 16px）自上而下：
1. 標題列：icon 18px `#5f6368` + 責任方名 13px/500 +（若為自己）「自己」標籤（高 18px、padding 0 7px、圓角 100px、`#ecf3fe`/`#0842a0`、10px/500）+ 右側「N 條義務」11px `#5f6368` tabular-nums
2. 準時率：大數字 27px / weight 400（`—` 表示尚無到期項目）+ 右側說明 11.5px `#5f6368`（「到期 7 項準時完成 6 項」／「尚無到期項目」）
   數字顏色：100% → `#0f5223`；≥80% → `#202124`；<80% → `#8c1d18`；無資料 → `#5f6368`
3. 堆疊條：高 6px、圓角 100px、底 `#e8eaed`，依序疊 已完成 `#146c2e` / 已逾期 `#b3261e` / 即將到期 `#a05a00`，寬度為該狀態佔該方義務總數的百分比
4. 統計列：「圓點 7px + 標籤 11.5px `#5f6368` + 數字 500 `#202124`」，gap 14px —— 逾期 / 即將到期 / 排程中 / 已完成 / 無需處理（最後一項僅在該方有此類義務時顯示）
   統計數字之和必須等於標題列的「N 條義務」——這張卡是稽核數字，不能對不起來

**準時率公式**（現況，見待確認問題 3）：
```js
const settled = done + overdue
const rate = settled ? Math.round(done / settled * 100) : null
```

### 2.3 履約期程條

全寬卡片，padding 15px 18px 17px。
- 標題列：左「履約期程」13px/500；右 11px `#5f6368` tabular-nums「開工 2026-03-01 · 完工 2027-05-30 · 保固期滿 2032-08-30 · 可見 27 條」
- 五段等寬按鈕（`flex:1`，gap 2px，各自 `border:1px solid #e3e6ea; border-radius:10px; padding:9px 11px 10px`）：

| 期程 | 日期範圍 |
|---|---|
| 開工前 | 2026-02-15 – 02-28 |
| 開工後 30 日內 | 2026-03-01 – 03-31 |
| 施工期間 | 2026-04-01 – 2027-05-30 |
| 完工與驗收 | 2027-05-30 – 08-30 |
| 保固期 | 2027-08-30 – 2032-08-30 |

  每段內容：名稱 12.5px/500（+ 若為當前期程，附「今天」pill：高 17px、`#0b57d0` 白字、10px/500）／日期範圍 10.5px `#5f6368`／6px 圓角軌道／摘要 10.5px
  軌道顏色：無義務 `#f1f3f4`；有逾期 `#b3261e`；全部完成 `#81c995`；當前期程 `#0b57d0`；其他 `#e8eaed`
  摘要文字（優先序）：`無義務` → `N 項 · M 項逾期`（字色 `#8c1d18`）→ `N 項 · M 項即將到期`（`#8a4b00`）→ `N 項 · 全部完成` → `N 項 · 排程中`
- 點擊切換該期程的篩選（再點取消）；選中時 `border-color:#0b57d0; background:#ecf3fe`
- 期程統計以**角色可見集合**為母體，不是全案

### 2.4 時間軸清單（左欄）

**檢索區**（padding 14px 18px、下邊框 1px `#e3e6ea`、`flex-direction:column; gap:12px`）
- 搜尋框：高 40px、圓角 100px、`1px solid #dadce0`、`search` icon 20px、input 13px、placeholder「搜尋條文、關鍵字、條款編號或頁碼…」；`:focus-within` → `border-color:#0b57d0`
  搜尋欄位：標題、說明、條款、頁碼、原文、類型、責任方、頻率、推算方式
- 狀態快篩 chip（5 個，高 30px、padding 0 12px、圓角 100px、`1px solid #dadce0`、字 12px/500）：每顆左側 7px 圓點 + 標籤 + 數字（`opacity:.75`）。選中 `border-color:#0b57d0; background:#ecf3fe; color:#0842a0`；再點取消
- 責任方 select（**僅在角色可見多方時顯示**）、類型 select：高 30px、圓角 8px、`1px solid #dadce0`、12px
- 有任何篩選作用中時，出現 text button「清除篩選」12px `#0b57d0`
- 三種條件為 AND，即時生效

**分組**：依期程分組，每組一個 header（padding 13px 18px 11px、底色 `#f8fafd`、下邊框 1px `#e3e6ea`）：期程名 12.5px/500 + 日期範圍 11px `#5f6368` + 1px 填充線 `#e8eaed` + 右側摘要 11px。空的組不渲染。

**義務列**（`<button>`，`grid-template-columns:104px 26px minmax(0,1fr) 96px; gap:12px; align-items:stretch`，下邊框 1px `#e3e6ea`）
1. 日期欄（padding 12px 0 12px 18px）：到期日 12px/500 tabular-nums；下方倒數 10.5px tabular-nums
   倒數文案：`逾期 N 日`／`今天到期`／`還有 N 日`（<60）／`還有 N 個月`（<730）／`還有 N.N 年`／`已完成`／`未觸發`
   倒數字色：已逾期 `#8c1d18`、即將到期 `#8a4b00`、其他 `#5f6368`
2. 軸線欄（26px）：置中 2px 垂直線 `#e8eaed` 貫穿整列 + `top:14px` 的 11px 圓點（白底、2.5px 邊框、顏色為狀態色）
3. 內容欄（padding 12px 0、`flex-direction:column; gap:4px`）：
   - 標籤列：責任方 pill（高 18px、padding 0 7px、圓角 100px、icon 13px + 名稱 10.5px/500；**自己的** `border:1px solid #0b57d0; background:#ecf3fe; color:#0842a0`，**別人的** `border:1px solid #dadce0; background:#fff; color:#3c4043`）＋（若有）頻率標籤（高 18px、圓角 4px、`1px solid #dadce0`、10px/500 `#5f6368`）
   - 標題 13px/500 / line-height 1.5 / `text-wrap:pretty`
   - meta 11.5px `#5f6368` tabular-nums：`契約條款 9.4 · 第 25 頁 · 提送文件`
4. 狀態欄（padding 12px 18px 12px 0、右對齊、`align-items:flex-start`）：狀態色票

- hover：`filter:brightness(0.975)`；選中：`background:#ecf3fe` + `aria-current="true"`

> **注意**：義務列與期程段都是 `<button>`。瀏覽器預設 `color: buttontext`（黑）會蓋掉繼承色，務必顯式設 `color: var(--text)`（#202124），否則同一個詞在組 header 與期程段會呈現兩種黑。

**狀態色票**（高 22px、padding 0 8px、圓角 6px、11px/500、`white-space:nowrap`）

| 狀態 | 底 / 字 | 圓點 | 語意 |
|---|---|---|---|
| 已逾期 | `#fceeec` / `#8c1d18` | `#b3261e` | 過期未完成，需立即處理 |
| 即將到期 | `#fef7e0` / `#8a4b00` | `#a05a00` | 7 日內到期 |
| 排程中 | `#ecf3fe` / `#0842a0` | `#0b57d0` | 未到期，已排入時程 |
| 已完成 | `#e6f4ea` / `#0f5223` | `#146c2e` | 已履行並留存佐證 |
| 無需處理 | `#f1f3f4` / `#5f6368` | `#bdc1c6` | 條件未觸發（如罰則條款） |

**頻率標籤**：`每月循環`、`每季循環`、`每期循環`、`事件觸發`、`數量觸發`、`條件觸發`；單次義務不顯示標籤。

**空狀態**：padding 48px 18px、置中、12.5px `#5f6368` / line-height 1.8：「沒有符合條件的義務。」換行「試試條款編號（例 5.3）、頁碼，或關鍵字（例 保固、罰則、送審）。」

**卡片底部**：左 11.5px `#5f6368` tabular-nums「顯示 27 / 27 條 · 來源 4 份文件 · AI 最近整理 2026-08-20 14:12」；右連結「重新整理擷取結果」11.5px。

### 2.5 詳情面板（右欄，sticky）

1. **標題列**（padding 13px 16px、下邊框 1px `#dadce0`）：狀態色票 + 責任方 pill（同列樣式）+ 右側連結「開啟原文」11.5px（`title="在原文件中開啟"`，應開啟該文件並跳至該頁）
2. **本文**（padding 16px）：標題 15px/500；說明 12.5px / line-height 1.8 `#3c4043`；key–value 表 `grid-template-columns:70px minmax(0,1fr); gap:7px 12px`、12px，key `#5f6368`、value tabular-nums —— 責任方 / 階段 / 到期日（含倒數）/ 頻率 / 允收標準 / 應留存
3. **執行紀錄**（padding 0 16px 16px）：小標 `history` icon 15px + 「執行紀錄」12.5px/500。下方迷你時間軸：每筆 `grid-template-columns:14px minmax(0,1fr); gap:10px`，左欄 2px 垂直線 + `top:5px` 的 7px 圓點（顏色為該筆事件的狀態色），右欄時間 11px `#5f6368` tabular-nums + 事件描述 12px `#202124`，每筆下方留白 9px
   這是本頁的核心價值：讓機關／監造看得到「實際發生了什麼」，而不只是狀態標籤
4. **AI 擷取依據**（padding 0 16px 16px）：小標 `description` icon + 「AI 擷取依據」12.5px/500 + 來源核對色票（高 20px、10.5px；已核對 `#e6f4ea`/`#0f5223`、待核對 `#fef7e0`/`#8a4b00`）。引述框：`background:#f8fafd; border:1px solid #e3e6ea; border-radius:8px; padding:11px 12px`——第一行來源 11px `#5f6368`（`工程契約書（v1） · 契約條款 9.4 · 第 25 頁`），第二行原文加「」、12px / line-height 1.85。框下方 `function` icon + 「到期日推算：每月 10 日（循環）· 本期應提送 2026-08-10」11.5px `#5f6368`
5. **關聯**（padding 0 16px 16px）：小標 12.5px/500；每項 `<a>`：padding 8px 11px、`1px solid #e3e6ea`、圓角 8px，左 icon 15px + 文字 12px `#3c4043` + 右 `chevron_right` 16px `#80868b`；hover `background:#f8fafd`
6. **動作列**（padding 12px 16px、上邊框 1px `#dadce0`）依 `isMine` 與狀態切換：

| 條件 | 內容 |
|---|---|
| 自己的 · 已逾期／即將到期／排程中 | Primary「標記完成」（`task_alt` FILL 1）＋ Secondary「上傳文件」（`upload_file`） |
| 自己的 · 已完成 | Secondary「取消完成」（`undo`） |
| 自己的 · 無需處理 | 說明文「罰則條款，非待辦事項。完工逾期時自動轉為待處理。」 |
| 別人的（任何狀態） | 說明文「由〈責任方〉負責執行，本頁為唯讀檢視。」 |

  動作列最右側一律有 ghost button「擷取有誤」（`margin-left:auto`、高 36px、`#5f6368`、hover `background:#f1f3f4`）——AI 擷取錯誤任何角色都能回報。

按鈕規格：Primary 高 36px、padding 0 16px、12.5px/500、圓角 100px、`#0b57d0` 白字、hover `#0842a0`、active `#062e6f`；Secondary 白底 `1px solid #dadce0`、`#3c4043`、hover `#f1f3f4`；Ghost 透明底、`#5f6368`、hover `#f1f3f4`。

---

## 3. 互動與行為

- 預設選中第一條「已逾期」義務；若無，選第一條「即將到期」；再無，選清單第一條
- 切換身分時重置所有篩選，並重新挑選預設選中項（原選中項可能已不可見）
- 篩選後若選中項被篩掉，**保留右欄內容不清空**，清單中無高亮列
- 點列 → 更新右欄 + 更新 URL（`?obligation=c1`）；深連結進站時自動捲到該列並展開所屬期程
- 「標記完成」→ 樂觀更新為已完成、寫入執行紀錄一筆；失敗回滾並顯示 inline 錯誤
- 「上傳文件」→ 開檔案選擇，上傳後掛為該義務的佐證並寫入執行紀錄；不自動標記完成
- 「擷取有誤」→ 開 Modal（錯誤類型：條文誤判／日期算錯／責任方錯誤／重複／其他 + 說明），送出後該條標記為「待複查」並通知專案管理員
- 「重新整理擷取結果」→ 觸發重新擷取；期間清單顯示 inline 進行中提示，不阻斷閱讀
- 鍵盤：`↑`/`↓` 移動選取、`Enter` 開啟原文、`/` 聚焦搜尋

**Loading / Empty / Error**
- 載入中：執行卡 2 張骨架 + 清單 8 列骨架 + 右欄骨架
- 專案尚無擷取結果：卡內置中訊息「這個專案還沒有擷取結果」+ 連結「前往專案文件上傳契約」
- 載入失敗：紅色 inline 訊息 +「重試」，不換整頁錯誤頁

**Responsive**
- ≥1200px：兩欄如上（右欄 400px、sticky）
- 1024–1199px：執行卡改 2 欄換行；期程條 5 段可橫向捲動（最小段寬 160px）
- 768–1023px：主區改單欄；詳情改右側抽屜（寬 `min(440px, 92vw)`、backdrop `rgba(32,33,36,.4)`、`box-shadow:-2px 0 16px rgba(32,33,36,.16)`）
- <768px：義務列改單欄堆疊（責任方＋頻率一行、標題一行、meta 一行、日期＋狀態一行）；軸線欄隱藏；期程條改水平捲動；詳情改全螢幕頁；按鈕最小高 44px；身分切換收進頁首選單

**Accessibility**
- 清單 `role="list"`，每列 `<button role="listitem">` + `aria-current`
- 右欄容器 `aria-live="polite"`，切換時播報標題與狀態
- 狀態與責任方不可只靠顏色：狀態色票一律帶文字，責任方 pill 帶文字與 icon
- 焦點環 `outline:2px solid #0b57d0; outline-offset:2px`
- 原文引述用 `<blockquote>`／`<q>`，出處用 `<cite>`
- 執行紀錄時間軸每筆事件的狀態要有文字或 `aria-label`，不能只靠圓點顏色

---

## 4. 狀態與資料

```
role       : '廠商' | '監造' | '機關'          // 由登入身分決定
filters    : { q, status, type, who, phase }    // status/phase: 'all' | 具體值
selectedId : string

obligation : {
  id, who,                                       // who = 責任方，決定可見性與 isMine
  phase: 'pre'|'start'|'build'|'finish'|'warranty',
  status: 'overdue'|'due'|'scheduled'|'done'|'na',
  type,                                          // 期限/罰則/品質標準/保固/保險/人員/提送文件/付款/其他
  kind,                                          // 頻率標籤，單次為空字串
  date,                                          // 到期日 YYYY-MM-DD，條件觸發為 '—'
  title, desc,
  clause, page, doc, quote, verified,             // AI 擷取依據
  calc,                                           // 到期日推算說明
  criteria, evidence,                             // 允收標準、應留存
  log: [{ when, what, s }],                       // 執行紀錄，s 為狀態色
  links: [{ icon, text, href }],
}
```

衍生值（不另存 state）：`pool = items.filter(byVisible)`、`visible = pool.filter(byFilters)`、`groups`（依 phase）、`counts`、`partyStats`、`isMine`、`shown/total`。

**API**
- `GET /projects/:id/obligations` → `{ items, counts, partyStats, milestones }`
  後端**依登入身分回傳已過濾的集合**，前端不做權限判斷（前端的 `VISIBLE` 表只用於 mockup 的身分切換）
- 每筆 item 附 `canAct: boolean`（= `who === 登入身分`），前端據此決定動作列，不自行比對字串
- `POST /obligations/:id/complete`、`DELETE /obligations/:id/complete`
- `POST /obligations/:id/evidence`（multipart，上傳佐證）
- `POST /obligations/:id/report-issue`（body: type, note）
- `POST /projects/:id/obligations/re-extract`
- `GET /documents/:docId/view?page=25&highlight=:id`（原文定位）
- 里程碑（期程條用）：`milestones = { start, completion, warrantyEnd }`

---

## 5. Design Tokens

**Color**

| Token | Hex | 用途 |
|---|---|---|
| text | `#202124` | 主文字 |
| text-secondary | `#3c4043` | 說明文、Secondary 按鈕字 |
| ground | `#f8fafd` | 頁面底、組 header、引述框 |
| card | `#ffffff` | 卡片底 |
| line | `#e3e6ea` | 卡片、列、引述框框線 |
| divider | `#dadce0` | 卡內分隔線、輸入框與按鈕框線 |
| accent | `#0b57d0` | 主色／排程中／選中／自己 |
| accent-100 | `#ecf3fe` | 選中列底、chip 選中底、「自己」標籤 |
| accent-700 / 800 | `#0842a0` / `#062e6f` | hover / active、chip 選中字 |
| neutral 200/300/500/600 | `#f1f3f4` / `#e8eaed` / `#bdc1c6` / `#80868b` | 灰色票、軸線與軌道、灰圓點、次要 icon |
| neutral 700 | `#5f6368` | 次要文字 |
| ok / ok-text / ok-tint / ok-bar | `#146c2e` / `#0f5223` / `#e6f4ea` / `#81c995` | 已完成、來源已核對、完成段軌道 |
| warn / warn-text / warn-tint | `#a05a00` / `#8a4b00` / `#fef7e0` | 即將到期、來源待核對、監造標示色 |
| danger / danger-text / danger-tint | `#b3261e` / `#8c1d18` / `#fceeec` | 已逾期 |

**五色語意規則（全系統一致）**：紅 = 需立即處理／逾期；黃 = 接近期限／待確認；綠 = 已完成／正常；藍 = 排程中／選取／自己；灰 = 未觸發／不適用。
本頁常見誤用：「排程中」用灰（應為藍）；「無需處理」用黃（應為灰——它不是待辦）；別人的責任方 pill 用顏色填滿（應為線框，顏色留給狀態）。

**Type**：`"Google Sans Text","Noto Sans TC",system-ui,sans-serif`。字級 27 / 26 / 15 / 13 / 12.5 / 12 / 11.5 / 11 / 10.5 / 10 px；weight 只用 400 與 500（不用 bold）。所有數字、條號、頁碼、日期加 `font-variant-numeric:tabular-nums`。原文引述 line-height 1.85，說明文 1.8，副標 1.7。

**Spacing**：主區 gap 24；執行卡 gap 12；卡內 padding 14–18；檢索區元素 8 / 12；列內 gap 12；key–value gap 7/12。

**Radius**：卡片 12px；期程段 10px；引述框與關聯列 8px；狀態色票 6px；頻率標籤 4px；按鈕／chip／pill 100px。

**Dark mode**：底 `#202124`、卡 `#292a2d`、框線 `#3c4043`、主色 `#a8c7fa`、綠 `#81c995`、紅 `#f2b8b5`、黃 `#fdd663`；色票底改深色 tint（`#1f2d24` / `#3a3020` / `#3d2724` / `#0d2f5f`）；選中列底 `#0d2f5f`。

## 6. Assets
- **字體**：Google Sans Text（或 Roboto 替代）+ Noto Sans TC。參考稿用 CDN，產品端 self-host（woff2、`font-display:swap`）
- **圖示**：Material Symbols Outlined。本頁用到 `engineering`、`checklist`、`account_balance`、`search`、`description`、`history`、`function`、`chevron_right`、`task_alt`（FILL 1）、`upload_file`、`undo`、`warning`、`schedule`、`payments`、`balance`、`fact_check`、`list_alt`、`verified_user`、`group`、`health_and_safety`。除 `task_alt` 外皆 FILL 0。請 self-host 或子集化
- 無圖片資產

## 7. Files
- `ContractHighlights.timeline.reference.html` — 自足設計參考稿（身分切換、搜尋、篩選、選取皆可操作）
- `README.md` — 本文件
- 專案根目錄 `ContractHighlights v3.dc.html` — 同一設計的元件版
- 上游頁「專案文件」規格：`design_handoff_project_documents/README.md`
- 系統整體 token 與元件規範：`design_handoff_pmis_google_ui/README.md`
- 現行實作：`PMIS/src/pages/web/Requirements.jsx`（本設計為其改版）

**現行實作需移除的區塊**（舊版有、本設計已無）：AI 建議 → 人工審查 → 核定／駁回 的整套審查流程、待核定／已生效／已駁回三種狀態、追溯區的六個下拉篩選、階段時間軸與罰款試算、基準日與契約總價卡、頁面最底的獨立詳情卡、就地展開的手動新增表單。審核流程移至其他頁面，本頁不再承擔。
