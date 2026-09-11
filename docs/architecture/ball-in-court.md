# 球在誰手上（ball-in-court）：責任語言的判定、聚合與呈現

> 狀態：**CURRENT** ｜ 最後核對：2026-09-11（分支 `refactor/product-wide`。判定規則與今日待辦聚合（W8-2B、W11）已部署；伺服器端 `ballInCourt.ts` 由 B4 commit `eddcf18` 自 `agentTools.ts` 拆出、側欄「球在誰手上」群組與 `?ball=` 由 Apple 改版第二包 commit `2d3068f` 加入——這兩件**已提交、未合併 `main`、未部署**）
> 對應程式：伺服器 `supabase/functions/_shared/ballInCourt.ts`（四支判定＋`collectOpenBallItems`）、`_shared/agentBrief.ts`（早報的分段與收件者過濾）、`_shared/agentRole.ts`（`BallSide`／`SIDE_BY_AGENT_ROLE`）、`_shared/agentQueryTools.ts`（`list_my_open_items`）、`send-reminders/index.ts`；前端 `src/lib/ballInCourt.js`（七支判定＋`collaborationItems`／`myOpenItems`／`tallyBalls`／`valuationRoute`）、`src/lib/todayTasks.js`（`buildTodayTasks`／`dueText`／三個白名單）、`src/lib/useTodayTasks.js`、`src/components/TaskRow.jsx`（`OVERDUE_RE`／`TAG_META`）、`src/lib/navConfig.js`（`BALL_SOURCES`／`resolveBallKey`）、`src/components/Layout.jsx`、`src/pages/web/Dashboard.jsx`、`Alerts.jsx`、`Quality.jsx`（工作佇列共用 `dueText`）、`src/lib/assistantData.js`（`myOpenItems`）
> 測試：`src/lib/ballInCourt.test.js`、`todayTasks.test.js`、`useTodayTasks.test.js`、`src/pages/web/Quality.workQueue.test.js`、`supabase/functions/_shared/agentBrief.test.ts`、`agentToolWhitelist.scan.test.ts`；e2e `contractor.spec.js`、`supervisor.spec.js`、`owner.spec.js`
> 決策依據：[`../DECISIONS.md`](../DECISIONS.md) D-002（只有三方）、D-015（今日待辦是落地面）、D-021（落地點＝收件匣、球權來源進側欄）；兩側規則的同步責任登記在 [`dual-engine-sync.md`](dual-engine-sync.md) #5。本文件寫機制；為什麼這樣定看 DECISIONS。

## 1. 一句話

**球權 ＝ 一筆協作單據「現在等哪一方做下一個動作」**，由單據既有的狀態欄位確定性推導出 `{ who, label }`；不存欄位、不建 task 資料表、不建 workflow engine。`who` 只會是三方之一（`contractor`／`supervisor`／`owner`）或 `done`。全站的「輪到我／等對方」、側欄件數、早報、agent 的 `list_my_open_items` 都從這個判定長出來，所以它是責任語言的單一真相——同一筆送審件不會在首頁說「待監造」、在 agent 說「待廠商」。

## 2. 單筆判定：狀態 → 球在誰手上

判定是純函式，輸入一列、輸出 `{ who, label }`。伺服器與前端各有一份，**前四種逐字等價**，後三種只有前端有（§4）：

| 單據 | 狀態 | `who` | `label` | 兩側 |
|---|---|---|---|---|
| 疑義（RFI） | 待回覆 | supervisor | 待監造/設計回覆 | 兩側 |
|  | 已回覆 | contractor | 待廠商確認結案 |  |
|  | 其他 | done | 已結案 |  |
| 送審 | 已提送／審核中 | supervisor | 待監造審定 | 兩側 |
|  | 退回補正 | contractor | 待廠商補正 |  |
|  | 其他（核准／核備／駁回） | done | 原狀態 |  |
| 估驗 | 草稿 | contractor | 待廠商送審 | 兩側 |
|  | 監造審核 | supervisor | 待監造核定 |  |
|  | 已核定且無 `invoice_date` | contractor | 待廠商請款 |  |
|  | 有 `invoice_date` 無 `paid_date` | owner | 待機關撥款 |  |
|  | 有 `paid_date` | done | 已撥款 |  |
| 缺失 | 已結案 | done | 已結案 | 兩側 |
|  | 待複查 | supervisor | 待監造複查 |  |
|  | 改善中 | contractor | 廠商改善中 |  |
|  | 開立（其他） | contractor | 待廠商改善 |  |
| 變更設計 | 提出 | supervisor | 待監造審查 | 只有前端 |
|  | 審核中 | owner | 待機關核定 |  |
|  | 其他（核准／駁回） | done | 原狀態 |  |
| 查驗 | 待查驗 | supervisor | 待監造查驗 | 只有前端 |
|  | 其他（合格／不合格） | done | 原狀態 |  |
| 觀察 | 待處理 | `assigned_to`（自由文字），缺值 contractor | 待處理 | 只有前端 |
|  | 其他 | done | 原狀態 |  |

幾個不直覺的點：

- 估驗的球權**不只看 `status`**：核定後接著看兩個日期欄位，「請款→撥款」是估驗狀態機之外的接力（前端 `valuationRoute` 因此把「待廠商請款」導到 `/payments` 而不是 `/valuation`——估驗頁沒有請款日欄位，W8-2A §1.4-1）。
- 缺失的「改善中」與「開立」分開標示（第二輪 P2-01：按下「開始改善」後標籤仍寫「待廠商改善」，畫面與狀態對不上）。
- 疑義的 label 寫「監造/設計」，但 `who` 是 `supervisor`：設計不是專案角色（D-002），設計釋疑由監造轉呈。前端 `tallyBalls` 保留 `design` 桶純為相容，`todayTasks` 不會把任何項目歸給它。
- 觀察的 `assigned_to` 是自由文字欄，落不進三方時 `todayTasks` 視為「未指定」不歸任何人——硬塞等於製造別人做不到的待辦。

## 3. 從單筆球權到「我的清單」

### 3.1 前端：`collaborationItems` → `buildTodayTasks`

`ballInCourt.js` 的 `collaborationItems(data)` 是全案未結協作項的**唯一組裝**（排除 `done`；標題怎麼組、`tag` 是什麼、導去哪一頁只有這一個答案）。`myOpenItems(org, data)` 只是它的 `who === org` 過濾，目前只剩 `/agent` 的事實快照（`assistantData.js`）在用。

`todayTasks.js` 的 `buildTodayTasks(input)` 是今日待辦的**唯一聚合**（W8-2B 把 `ballInCourt` 的協作項與 `Alerts.jsx` 內嵌的期限規則併成一支），回 `{ mine, waiting, doneToday }` 三桶：

| 段 | 來源 | 進 `mine` 的條件 | 進 `waiting` 的條件 |
|---|---|---|---|
| ① 協作項 | `collaborationItems` 七類 | `who === org` | `WAITING_SCOPE[org][tag]` 白名單含 `who`（首頁不是全案未結項的傾印場） |
| ② 契約期限 | `obligations`（store 載入時已排除「不適用」） | `org ∈ OBLIGATION_ACTIONABLE_SIDES`（廠商、監造）、`RESPONSIBLE_SIDE[responsible] === org`（精確白名單：廠商／監造／機關；null、空字串、其他文字一律「未指定」）、非已提送／已完成、`computeObligationDue` 推得出日期且 7 日內 | 不進（期限型不會跑進等待對方） |
| ③ 試體齡期 | `sampleAlerts` | 只有廠商 | — |
| ④ 驗收法定期限 | `acceptanceAlerts` | `ACCEPTANCE_STAGE_ORGS[stage]` 含 `org` | — |
| ⑤ ITP 停留點 | `itpAlerts` | 只有廠商 | — |
| ⑥ 今日日誌未填 | `siteLogs`＋開工錨點 | 只有廠商，且「施工已開始」有證據（開工錨點涵蓋今天、或已有任一筆日誌） | — |

三條結構性紅線（檔頭註解，`todayTasks.test.js` 釘住）：AI 草稿（`agent_actions`）與未核定 Requirement **根本不是這支函式的輸入**，所以永遠不會變成人工待辦；只有「登入角色在目的頁真的能完成」的事才進 `mine`（機關責任的期限在 `/deadlines` 動不了，就不製造假待辦）；「今天已完成」只採系統寫入的操作時間戳（缺失 `closed_at`、查驗 `inspected_at`），可回填的業務日期（請款日、日誌日期、審定日）不算。

`doneToday` 的一個後果要知道：目前只有這兩種類型有可靠時間戳，而它們的完成方都是監造（`ball: 'supervisor'`），再經「陣營過濾」——所以**廠商與機關的「今天已完成」桶在現行資料模型下永遠是空的**，這是誠實不顯示，不是 bug（估驗核定、變更核准、疑義結案、觀察處理沒有完成時間欄位；本包不加 migration）。

排序：`mine`／`waiting` 依到期升冪、無到期日殿後（stable sort）；`doneToday` 依時間戳降冪。日期一律先正規化成台北日曆日（`taipeiISODate`）再算日差（純字串運算，不受執行環境時區影響），否則傍晚開頁 8 個日曆日會被 `Math.round` 壓成 7（W8-2B 邊界回歸）。

`useTodayTasks()` 是唯一 hook 入口：把 store 切片餵進 `buildTodayTasks` 並以 `todayIso` 為 memo key；`TODAY` 每次 render 取（工地平板整週不關分頁，模組層常數會讓日期凍結）。側欄件數、通知紅點、Dashboard、提醒中心都吃它——件數在兩處各算一次遲早分岔。

### 3.2 伺服器：`collectOpenBallItems` → 兩個消費者

`ballInCourt.ts` 的 `collectOpenBallItems(db, projectId, today, { obligationSoonDays })` 是伺服器端唯一實作，回**全陣營**未結項 `OpenBallItem[]`（`side`／`kind`／`id`／`title`／`status`／`meta`／`due_date`／`overdue_days`），依到期升冪、無到期日殿後。查五張表（缺失 ≠ 已結案；送審 in 已提送／審核中／退回補正；疑義 in 待回覆／已回覆；估驗全部；契約義務 `status = '待辦'`）加 `projects` 基準日；契約義務的到期日由 `computeObligationDueUTC` 確定性推算，`responsible` 未填**預設歸廠商**。

**每個查詢都逐一 `.eq('project_id', …)`**：在 `userClient`（RLS）下是縱深防禦，在 service role（無 RLS）下是唯一的跨案隔離保證——A 案的事絕不能進 B 案成員的信。`agentToolWhitelist.scan.test.ts` 把 `ballInCourt.ts` 列為唯讀模組，不得出現任何寫入動詞。

| 消費者 | client | `obligationSoonDays` | 之後做什麼 |
|---|---|---|---|
| `list_my_open_items`（agent 工具） | 呼叫者 JWT 的 `userClient` | 0（只收已逾期義務） | `my_org_type` 決定我方 → 過濾 `side` → 去掉 `side` 欄 → 最多 30 筆 |
| `send-reminders`（每日早報） | service role | 7（另收 7 日內到期） | 併入 `testSampleItems`（試體齡期，廠商）→ 逐成員 `itemsForRecipient`（依 `SIDE_BY_AGENT_ROLE` 過濾）→ `splitBrief` 分逾期／7 日內／無期限 → `shouldSendBrief`（只有逾期或 7 日內到期才寄） |

## 4. 為什麼有兩份實作、同步點在哪

Deno Edge Function 部署只打包 `supabase/functions/`，無法 import `src/lib/`——與 `aiFeatures`、`agentRole`、`contractDue` 同一個限制、同一個慣例（[`ai-gate-and-metering.md`](ai-gate-and-metering.md) §2）。所以判定規則在 `ballInCourt.js` 與 `ballInCourt.ts` 各寫一份；兩檔檔頭互相註明「改動要兩邊同步」。

同步點是 §2 前四支判定函式的**逐字等價**與排序規則。目前**沒有自動保證**：不像 `contractDue` 那樣共用同一組測試案例，`ballInCourt.test.js` 與 `agentBrief.test.ts` 各自釘各自的行為。`dual-engine-sync.md` #5 登記了三處已知差異（涵蓋類型、`responsible` 無法辨識時的預設、機關責任義務），本次核對再補一條：

- 契約義務的「未結」判定實作不同——前端在 `store/db.js` 載入時 `neq('status','不適用')`、`todayTasks` 再跳過已提送／已完成；伺服器直接 `eq('status','待辦')`。`contract_obligations.status` 欄位**沒有 CHECK 約束**（baseline 只有註解列出四個值），在文件寫明的四值域下兩邊等價，但一旦出現第五種值，前端會列出、伺服器不會。
- 觀察、查驗、變更三類只在前端有判定：agent 回答「我現在該處理什麼」時看不到待查驗與待核定的變更。

改任一側前先回到 `dual-engine-sync.md` #5。

## 5. `dueText` 句型是合約，不是文案

到期句只有一個出口——`todayTasks.js` 的 `dueText(days, dueIso)`，三種句型固定：

```text
days < 0   → 逾期 N 天（到期 YYYY-MM-DD）
days === 0 → 今天到期（YYYY-MM-DD）
days > 0   → 還有 N 天（到期 YYYY-MM-DD）
```

三個消費者把逾期句型綁死了，改一個字就斷：

1. `TaskRow.jsx` 的 `OVERDUE_RE = /逾期 \d+ 天（到期 \d{4}-\d{2}-\d{2}）/`：`TaskMeta` 在 `overdue` 時用它從 `meta` 裡把那段**原地**換成紅色 `Badge`，前後文字一字不動；比對不到就整句退回紅字（寧可不美也不丟資訊）。
2. e2e `contractor.spec.js` 以同一個正規表達式對「第 5 期估驗計價送審」那一列斷言逾期（天數不寫死——demoSeed 用機器本地時鐘、`todayTasks` 用台北日曆日，UTC 機器在台北隔天會差一天）。
3. `Quality.jsx` 的工作佇列（試驗段）直接 import `dueText`，`Quality.workQueue.test.js` 斷言完整字串 `逾期 5 天（到期 2026-08-10）`。

`todayTasks.test.js` 的「dueText（到期句的單一真相）」案例同時斷言三種句型與「逾期句必須符合 TaskRow 的 OVERDUE_RE」。要改措辭，四處（`dueText`、`OVERDUE_RE`、兩支測試）同時動。

兩個**不在**這條合約裡的句型，避免誤以為全站統一：早報信件（`agentBrief.ts`）用「已逾期 N 天（到期 …） · meta」，不經 `TaskRow`；`/requirements` 履約時程列用「逾期 N 日」，由 `obligationTimeline.js` 產、`contractor.spec.js` 另一條斷言 `/逾期 \d+ 日/`。「天」與「日」兩種措辭並存是既成事實，各綁各的 e2e。

## 6. `?ball=` 三桶：為什麼走 query param 不開新路由

`navConfig.js` 的 `BALL_SOURCES` 三個來源 1:1 對上 `buildTodayTasks` 的三桶：

| key | label | `to` |
|---|---|---|
| `mine` | 現在輪到我 | `/dashboard` |
| `waiting` | 等待對方 | `/dashboard?ball=waiting` |
| `done` | 今天已完成 | `/dashboard?ball=done` |

`resolveBallKey(searchParams)` 缺省或未知值一律落回 `mine`（fail-safe：亂打參數看到的是待我處理，不是空白頁）。Layout 的選取態與 Dashboard 的聚焦都吃這一支，兩邊各解析一次遲早分岔。

走 query param 的理由是 [`route-registry-governance.md`](route-registry-governance.md) §2 那條：`routeRegistry` 以 pathname 為鍵，query 不進 `routeAllowed`，三個來源共用 `/dashboard` 的登記與角色判斷——**權限零變動**，`navGroups`／`routeRegistry`／`routeAllowed`／`defaultLandingPath` 一行未動，也不解封任何 `hidden` 工作面。label 沿用頁內區塊既有用語（現在輪到我／等待對方／今天已完成），不另造「待我處理／等對方」——同一件事兩套詞會讓側欄與頁內對不起來、也讓既有 e2e 與使用者記憶失效。

接線細節：

- `Layout.jsx`：群組放在 `nav[aria-label="主要功能"]` 內、工作面之上；`ballKey` 只在 `pathname === '/dashboard'` 時解析；件數 `{ mine, waiting, done }` 取自同一次 `useTodayTasks()`；rail 收合時只有 `mine` 的小數字用紅色（等對方與已完成不是警訊，顏色不可單獨承載語意）；件數一律 `aria-hidden`——e2e 用 exact accessible name 抓連結。用 `Link` 而非 `NavLink`：`NavLink.isActive` 只比 pathname，三個來源會同時亮；`aria-current="page"` 自己掛在被選中的那一個。工作面的「今日待辦」項因此也改 `Link`，避免報讀器讀到兩個「目前頁面」。
- `Dashboard.jsx`：`resolveBallKey` 決定只渲染哪一桶；頁首下方 `Segmented`（`aria-label="球在誰手上"`，`onChange` → `navigate(sourceTo(key))`）讓人不必回側欄就能切，選取態同一份 `?ball=`。初始化清單、風險警示、AI 今日已代辦、「最近施工日誌」卡只跟著 `mine` 走（它們是「現在該做什麼」的脈絡）。h1 維持「今日待辦」——`/agent` 的「前往今日待辦」、`/alerts` 的「回到今日待辦」都指這裡，改叫來源名會變成同一個地方兩個名字。空狀態說球不在誰手上、要去哪裡看，並帶對面桶的件數。
- `TopBar` 的通知紅點吃 `dueMine.length`；`BottomNav`（手機）不放球權來源，仍走漢堡抽屜。

e2e 綁住的行為：`contractor.spec.js` 用 `getByRole('tablist', { name: '球在誰手上' })` 斷言預設 `mine` 的 tab `aria-selected`、只出現一個桶的 heading、切到等待對方後 SUB-003 可見；`supervisor.spec.js` 直接 `gotoHash('/dashboard?ball=done')` 斷言今天判定的查驗與結案的缺失出現在「今天已完成」、退回的缺失不出現；`owner.spec.js` 斷言機關的 `mine` 有「初驗期限將至」、沒有廠商責任的估驗送審。

## 7. 呈現層

- `TaskRow.jsx` 是待辦列的**唯一渲染**（Dashboard 與提醒中心共用，W9c 之前 Alerts 自寫一套導致兩頁分岔）；`TAG_META` 是 tag → 圖示＋語意色的單一真相，`buildTodayTasks` 新增 tag 時只補這裡；色票走 class 對照表不用 inline style（深色模式與 token 才會跟上）。
- 單據頁（`RFI.jsx`、`Submittals.jsx`、`Valuation.jsx`、`DefectTracker.jsx`）在列上用 `BallChip` 直接渲染 §2 的判定結果；`Submittals.jsx` 明寫「球權一律取自 `submittalBall`，這裡不自己判狀態」。

## 8. 現查方式

```bash
grep -n "^export function .*Ball\|^function .*Ball" src/lib/ballInCourt.js supabase/functions/_shared/ballInCourt.ts   # 兩側判定函式清單
node -e "import('./src/lib/navConfig.js').then(m=>console.log(m.BALL_SOURCES))"
node -e "import('./src/lib/todayTasks.js').then(m=>console.log(m.WAITING_SCOPE, m.RESPONSIBLE_SIDE, m.OBLIGATION_ACTIONABLE_SIDES))"
npx vitest run src/lib/ballInCourt.test.js src/lib/todayTasks.test.js src/lib/useTodayTasks.test.js supabase/functions/_shared/agentBrief.test.ts
```

## 9. 測試釘住

| 測試 | 釘什麼 |
|---|---|
| `src/lib/ballInCourt.test.js` | 七支判定逐狀態、`tallyBalls` 排除 done、`myOpenItems` 三方各只看到自己的 |
| `src/lib/todayTasks.test.js` | 三分類與互斥、`WAITING_SCOPE` 就是宣告的那一份、觀察自由文字不歸任何人、`RESPONSIBLE_SIDE` 只接受三個精確值、機關／未指定不製造假待辦、逾期天數與罰則寫進說明並導向 `/deadlines`、試體／驗收／停留點的角色歸屬、台北日曆日邊界、每月義務吃傳入 today、日誌未填六種邊界、排序、AI 產物永不進來、今天已完成只認可靠時間戳與陣營過濾、demo 形狀韌性、相同輸入兩次結果一致、`dueText` 三句型 |
| `src/lib/useTodayTasks.test.js` | `mineCountForNavItem` 對 tabs 的計數與不重複、前綴相同不誤算 |
| `src/pages/web/Quality.workQueue.test.js` | 試驗只給廠商、`dueText` 完整字串 |
| `_shared/agentBrief.test.ts` | `collectOpenBallItems` 各模組陣營、`overdue_days`、`responsible` 未填歸廠商、`obligationSoonDays` 0／7 行為、排序；`testSampleItems`／`splitBrief`／`shouldSendBrief` |
| `_shared/agentToolWhitelist.scan.test.ts` | `ballInCourt.ts` 屬唯讀模組、`list_my_open_items` 在唯讀七支之列 |
| e2e 三支 | §6 末段 |

## 10. 已知缺口與未查證

- 兩側規則無自動同步保證，已知差異見 `dual-engine-sync.md` #5 與本文件 §4 補記；伺服器缺觀察／查驗／變更三類。
- `contract_obligations.status` 無 CHECK 約束（§4）。
- 「今天已完成」對廠商與機關永遠為空（§3.1），要補得先有完成時間欄位（migration），屬產品決策。
- `who: 'design'` 仍存在於前端型別註解與 `tallyBalls` 桶，但沒有任何判定會產生它；是否清掉屬清理項，本波未動。
- 前端 `WAITING_SCOPE` 與早報的 `pending`（無期限未結項）語意不同：早報把「球在你手上但無到期日」列進信裡搭便車，首頁的 `waiting` 是「球在對方」——兩者不是同一個桶，不要互相對照數字。
- 沒有 pgTAP：球權是純前端／Edge 邏輯，不碰 DB 規則。
- `list_my_open_items` 的上限 30 筆與 `agentBrief` 的 `SOON_DAYS = 7` 與前端 `SOON_DAYS = 7` 各自硬編，未以共用常數釘住。
