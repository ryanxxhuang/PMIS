> 稽核代理原始報告（2026-09-06，唯讀讀碼）。燈號與數字以主報告 `docs/全案健檢-2026-09-06.md` 的「校正」節為準。

# 全案健檢 · 維度 F：產品定位、使用流程與商業就緒

> 稽核日期：2026-09-06｜稽核範圍：`main` @ `ba6ab45`（PR #58 合併後）
> 方法：唯讀讀碼與讀文件。所有結論附 file:line 或文件段落；未實測執行的一律標「待驗證」。
> 首要買方定義（依 GTM 2026-08-20 轉向）：**監造／PCM 事務所與工程顧問公司**。

---

## 總評（3 行）

1. **紅燈 9 · 黃燈 9 · 綠燈 4**（共 22 項）。技術骨架與紅線實作品質高，**但產品的「對外承諾」與「使用者實際看得到的東西」已經分家**：對外簡報與營運計畫書仍在賣「AI 建議→人核定才生效／六個工作面／完整品質與金流鏈」，程式已改成「全自動確認」與「側欄只剩四個入口」。
2. **對首要買方（監造事務所）最致命的三件事**：① `/supervisor-report`（監造報表）、`/portfolio`、`/activity`、`/cost`、`/progress`、`/schedule`、`/monthly-report` 七頁**隱藏後在全站找不到任何連結可達**，等同功能消失；② `/members` 在開啟正式模式後**完全無入口**，事務所無法再邀請三方成員；③ 16 個 AI 模組只有 3 個在存活表面觸發得到。
3. **商業就緒最大缺口**：定案價格四級距（12/30/60/120 萬）與資料庫的三方案（trial/standard/pro）**沒有任何對應關係**，簡報賣的「含 AI 次數／年」「超額 NT$1／次」在系統內**零實作**（`ai_monthly_token_quota` 只有欄位、無執行）；`demo_requests` 表有資料進來但 repo 內**沒有任何讀取端或後續動作**。

---

## 一、產品敘事一致性

### F-01｜「AI 不會自己生效」對外承諾 vs D-019 全自動確認｜P0｜🔴

**證據**
- 對外簡報（現行唯一產物 `docs/pitch/PMIS-ai-合作簡報-事務所與顧問公司-2026-08-21.pptx`，產生器 `docs/pitch/pptx/build-2026.cjs:569-570`）：
  > `'AI 不會自己生效'` / `'抽取結果先進待審清單，人核定後才建立提醒與期限追蹤。沒被核定的建議只留在追溯區，不會混進正式工作流。'`
- 同檔 `build-2026.cjs:375`：`['③ 人核定', '核定後才成為本案規則——AI 的結果不會自己生效', 'green']`
- 同檔 `build-2026.cjs:657`（三條紅線頁）：`'AI 只產生草稿'`。
- `docs/青創基地/【附件3】公司營運計畫書-欣宇數位科技.docx`（一(二)【創新與獨特之處】二）：
  > 「(1) AI 只產生草稿：核定、判定、結案、驗收這些動作，在 Agent 的工具白名單中根本不存在；…(3) 每個 AI 動作都寫入稽核表，**由人接受或拒絕**」
- 實作已於 2026-08-25 反向：`docs/DECISIONS.md` D-019：
  > 「AI 從已核定的契約整理出的內容**全部自動確認歸檔**,不留待確認佇列」「**紅線一在此流程放寬**,依據=使用者風險決策+三重揭露」
- `supabase/migrations/20260825000100_full_auto_confirm.sql:6-7`、`src/lib/extractRequirements.js:82-90`（成功訊息改為「已自動整理歸檔」）。

**影響（首要買方）**：這是**最高風險的一條**。監造／PCM 事務所買的是「簽名責任可控」，簡報第 8、12 頁明講「AI 不會自己生效」；實際上 AI 抽出的期限會自動進入履約時程、自動餵提醒信與罰款試算（D-019 結果段自承）。若事務所在導入後才發現，等於銷售時的核心賣點失真——對政府生意而言是信任層級的問題，不是文案層級。

**建議修法**：擇一，不可拖延。
- (a) 產品端：對 AI 來源的期限型義務恢復人工確認門檻（回到 D-017 分流），簡報不動；或
- (b) 文案端：`build-2026.cjs` 第 08 頁與 12 頁改寫為 D-019 的真實敘事（「確定性引擎逐字核對後自動歸檔＋三重揭露＋效力以契約原文為準」），並同步改寫營運計畫書的紅線一措辭與 `docs/北極星-…md` §3 第 1 條的「根本沒有這些工具」絕對句。
**工作量**：(a) M；(b) S（但需重出簡報與計畫書）。

---

### F-02｜CURRENT.md 落後 18 個 commit，已不是「現況權威」｜P0｜🔴

**證據**
- `CURRENT.md:4`：`> 最後核對：2026-08-15`；最後一次 commit 為 `2388695`/`647e981`（2026-08-19，W8-7）。
- 其後已合併但 CURRENT.md 完全未記載的產品級變更（`git log --oneline`）：
  - `4f5c084 品牌改名:PMIS.ai → GovAgent`（CURRENT.md §1 仍寫「介面主品牌已在 W8-1 統一為 `GovAgent｜公共工程`」，未記 PMIS.ai 這一輪）
  - `a0aa3d0 精修期最小表面:側欄只留四個入口`（CURRENT.md 仍寫「側欄固定為…六個工作面」，見 CURRENT.md W8-1 段）
  - `2aa4e94`／`222546d`／`94d6729` 契約重點改版為條文檢索頁＋履約時程＋擷取審核頁（PR #46～#55）
  - `3f37ee3` D-017、`a4708b3` D-019、`2755587` D-020、`9de8ad6` 開工日三入口（PR #58）
  - `24ae0b5` D-018 契約分級可見性、`e5f0aa3` 文件原始檔檢視、W13 續跑抽取（`3fcb424`、`d6890d6`）
- CURRENT.md §6 的數字基線（36 路由／16 AI 功能／36 migrations／607 Vitest）已與現況不符：`supabase/migrations/` 現有 **57** 檔（`ls | wc`），`src/App.jsx:130-169` 為 **39** 條路由。

**影響**：CURRENT.md 是 `docs/README.md` 指定的「開發必讀 #2」與文件權威第 2 順位。任何新協作者（人或 AI）照它施工都會做出錯誤假設（例如以為側欄有六面、以為 Requirement 需人工核定）。對外簡報數字亦引用 CURRENT.md，形成連鎖錯誤。

**建議修法**：見 §九 F-21 的補寫段落清單。**工作量**：M。

---

### F-03｜四份對外文件對「賣給誰」不一致｜P1｜🟡

**證據**
- 簡報（2026-08-21）：封面 `build-2026.cjs:262` 「讓監造與專管的每一位工程師，配一個讀過本案契約的 Agent。」→ 純事務所視角。P16 價格級距以「貴所年度經手工程總額」計（`build-2026.cjs:836-841`）。
- `docs/青創基地/…營運計畫書.docx` 一(二)(三)：短期（115/9–116/6）工作要點順序為「**2. 以政府採購法未達公告金額十分之一（逕洽廠商）路徑，對機關工程單位提出可直接上簽的採購文件包。3. 對建築師事務所與工程顧問公司推動年度訂閱與共同投標合作。**」；「二、進駐需求」第一項標題為「**機關與工程業客戶媒合（最主要需求）**」。→ 機關仍列第一。
- `docs/採購/中央大學-小額採購簽辦-簽稿範本與法源.md`：整份是**機關（中央大學營繕組）**買方的簽辦包，「本案為既有標準訂閱服務原樣使用，無客製化開發需求」。
- `CURRENT.md §2`「目前服務對象」只列廠商／監造／機關三個**專案角色**，**完全沒有「買方是誰」這一層**——CURRENT.md 對 GTM 轉向零記載。
- `docs/北極星-政府機關-Agent-平台.md` §0：「政府機關的每一個承辦人」→ 買方＝政府。

**影響**：四份文件描述的買方分別是「事務所」「機關＋事務所」「機關」「政府承辦人」。營運計畫書送出去的對象（青創基地）與簡報送出去的對象（事務所）拿到的是兩套故事；若有人交叉看到，會質疑定位不清。

**建議修法**：在 `CURRENT.md` 新增一節「目前買方與銷售路徑」，明寫「**首要付費買方＝監造／PCM 事務所與顧問公司；機關為透過事務所或小額採購進場的次要路徑**」，並由該節作為簡報與計畫書的共同上游。**工作量**：S。

---

### F-04｜「SaaS 套裝型」採購歸類文案紀律 vs 丙案／中期規劃互相拉扯｜P2｜🟡（待驗證）

**證據**
- `docs/pitch/pptx/README.md:106-109`（兩條講話紅線）：「標的名稱一律『雲端訂閱服務（SaaS）』。一旦文件裡出現『開發／客製／建置』，…會從『SaaS 套裝型』掉到『應用軟體或系統開發服務』」。
- `docs/採購/中央大學-小額採購簽辦-簽稿範本與法源.md` §二排除表：「既有 SaaS 客製化需求更版 → 本案為既有標準訂閱服務原樣使用，無客製化開發需求」。
- 但簡報 P15 丙案（`build-2026.cjs:770`）：「**你們出 know-how**…真實案件的作業流程、表單與眉角由貴所提供」；營運計畫書中期工作要點 2：「完成**機關端估驗計價單套版**與查驗單正式列印格式」。

**影響**：丙案與「機關模板套版」本質上就是客製化更版。若同一個機關同時看到採購包（原樣使用）與簡報（依貴所表單客製），歸類主張會被挑戰。目前尚未實際送件，屬潛在風險。

**建議修法**：在簡報 P15 丙案加一句界線——know-how 產出物歸入**標準產品的下一版**（全客戶共用），非本案客製交付物。**工作量**：S。

---

## 二、四入口最小表面 vs 買方核心流程

### 現存表面（實測讀碼）

**側欄工作面（4 個，`src/lib/navConfig.js:16-23`）**：`/dashboard` 今日待辦、`/contract` 專案文件、`/requirements` 契約重點、`/boq` 標單工項。
**側欄平台群（1 個，`navConfig.js:69-72`）**：`/admin`（僅 `is_platform_admin`）。
**頁首／全域（4 個）**：`問 GovAgent`→`/agent`（`src/components/Layout.jsx:325`）、提醒中心→`/alerts`（`Layout.jsx:192`）、專案切換器→`/project/new`（`Layout.jsx:208`）、右下浮動 Copilot（`Layout.jsx:429`）。
**hidden（`navConfig.js:26-66`）**：`/site-log`、`/quality`、`/itp`、`/safety`、`/submittals`、`/rfi`、`/change-orders`、`/valuation`、`/payments`、`/cost`、`/progress`、`/schedule`、`/monthly-report`、`/supervisor-report`、`/acceptance`、`/portfolio`、`/activity`、`/members`、`/audit` 共 19 頁。

### F-05｜買方核心路徑（上傳→AI 整理→履約時程→提醒→佐證→稽核）｜P2｜🟢

**證據**：整條鏈的每一步都在存活入口內或一鍵可達。
- 上傳契約：`/contract`（側欄）；監造可上傳——`src/pages/web/Contract.jsx:122` `const canWriteContract = can.edit || currentUser?.org_type === 'supervisor'`。
- AI 整理：同頁自動觸發（`src/lib/packageUpload.js` → `extract-requirements`），進度面板見 `Contract.jsx:670-712`。
- 履約時程：`/requirements`（側欄，`src/pages/web/Requirements.jsx:637`）。
- 提醒：頁首鈴鐺 `/alerts` ＋ `/dashboard` 今日待辦（同一份 `src/lib/todayTasks.js`）。
- 佐證：`/requirements` 詳情的「掛佐證」（`Requirements.jsx:406-408`，連 `submittals`）。
- 稽核：`/requirements` 詳情的執行紀錄 ＋ `/agent` 的 `run_integrity_audit`（`supabase/functions/_shared/agentTools.ts:207`）。

**結論**：首要買方的主鏈是完整的。**這是本維度唯一結構性的好消息。**

### F-06｜7 頁 hidden 且全站無任何連結可達＝功能實質消失｜P0｜🔴

**證據**：以 `grep -rn "/<path>" src --include=*.jsx --include=*.js` 排除 `navConfig.js`／`App.jsx`／`*.test.*` 後，下列路徑**在整個 `src/` 找不到任何 `to=`／`href`／`navigate()`**：

| 路徑 | 側欄標籤 | 全站唯一參照 | 判定 |
|---|---|---|---|
| `/portfolio` | 跨案總覽 | 無（`Portfolio.jsx` 只有出站連結 `:103,:106`） | 🔴 無入口 |
| `/activity` | 活動紀錄 | 無 | 🔴 無入口 |
| `/monthly-report` | 施工月報 | 無 | 🔴 無入口 |
| `/supervisor-report` | 監造報表 | 無 | 🔴 無入口 |
| `/cost` | 成本管理 | 無 | 🔴 無入口 |
| `/schedule` | 逐工項排程 | 無 | 🔴 無入口 |
| `/progress` | 進度 S 曲線 | 僅 `src/lib/aiInsights.js:27`（風險卡片，需觸發條件）與 `src/lib/assistantQA.js:20`（demo 離線快答） | 🟠 條件式 |

另外 `defaultLandingPath()`（`navConfig.js:113-115`）已改為全角色回 `/dashboard`，機關原本的 `/portfolio` 落地分流也一併消失——`/portfolio` 因此連「登入即到」的路都沒了。

**影響（首要買方）**：`/supervisor-report`（**監造報表**）是監造事務所的核心交付物之一，簡報 P06 也把它算進「文件與結案」工作面。現在它在產品裡不存在。`/portfolio`（跨案總覽）是簡報 P11 對機關端的賣點，也是事務所「同時管十幾案」的價值主張，同樣不可達。

**與使用者已知教訓的直接衝突**：記憶備註「2026-08-12 實測反證：施工日誌藏到連擁有者都找不到」——同一個錯誤在更大範圍重演，且 `navConfig.js:17-19` 的註解只承諾「路由/深連結/角色限制全部保留」，**沒有承諾可發現性**。

**建議修法**：
1. 立即（S）：在 `/dashboard` 或 `/requirements` 頁尾加一個「更多工作面（精修中）」的收合區，列出全部 hidden 路由連結——不是恢復側欄，只是保住可發現性；或恢復側欄的收合「全部功能」項。
2. 中期（M）：把「復出順序」寫進 `docs/ROADMAP.md`，每項附恢復條件，避免精修期無限延長。

### F-07｜`/members` 在開啟正式模式後零入口｜P0｜🔴

**證據**
- `/members` 全站唯二參照均在 `src/pages/web/Dashboard.jsx:51`（步驟 2 確認三方成員）與 `:77`（步驟 5 開啟正式模式）。
- 該卡片的渲染條件：`Dashboard.jsx:266` `{isPersistedProject && !project.formal_mode && <SetupChecklist imported />}`。
- 因此 `formal_mode = true` 之後，`SetupChecklist` 不再渲染 → `/members` 在全站沒有任何連結。
- `navConfig.js:57-64` 中 `/members` 位於 hidden 的「專案」工作面內。

**影響（首要買方）**：事務所導入的標準動作是「開正式模式 → 之後陸續把專案成員（新進工程師、換手的機關承辦、分包廠商窗口）加進來」。現在開了正式模式就再也找不到成員頁，只能手打網址。而正式模式**不可逆**（`docs/W8-5-…-2026-08-15.md` §二之一第 3 點：「開了不能關」）。

**建議修法**：在頁首帳戶區或專案切換器下拉加一個「專案成員」項（不吃 hidden），或在 `/dashboard` 正式模式下常駐一列「專案設定 · 三方成員」。**工作量**：S。

### F-08｜其餘 hidden 頁只有條件式可達，且條件多半在「已經有事發生」之後｜P1｜🟡

**證據**：這些頁的唯一入口是「有待辦時才長出來的那一列」。
- `/site-log`：`src/lib/todayTasks.js:198`（僅當「今天沒日誌」且開工錨點已設）＋ `Dashboard.jsx:320,325`（最近施工日誌卡，`siteLogs.length === 0` 時只顯示空狀態、**卡片標題列的連結仍在**）＋ `Valuation.jsx:234`（估驗頁，本身 hidden）。
- `/quality`：`todayTasks.js:151,225,236`、`ballInCourt.js:91,94,96`、`Agent.jsx`（AI 回答出處）。
- `/submittals`：`ballInCourt.js:86`、`Requirements.jsx:529`（義務關聯列）、`Deadlines.jsx:187`、`Agent.jsx:93`。
- `/valuation`、`/payments`、`/change-orders`、`/rfi`、`/safety`、`/itp`、`/acceptance`：全部只在 `ballInCourt.js` / `todayTasks.js` 產生待辦列時出現。
- `/audit`：唯一入口 `src/pages/web/Agent.jsx:292`（AI 稽核結果卡的連結）。
- `/deadlines`：`Requirements.jsx:535`（義務詳情關聯）＋ `todayTasks.js:138`。
- `/requirements/review`：`Requirements.jsx:641`（頁首「擷取審核」鈕，常駐）🟢。

**影響**：**冷啟動死結**——新導入的專案沒有任何待辦，於是沒有任何入口；使用者必須先在別處產生資料，才看得到通往「產生資料的頁」的連結。廠商第一天登入就會撞到（見 F-11）。

**建議修法**：同 F-06 的「更多工作面」收合區即可一併解決。**工作量**：S。

---

## 三、首次使用流程（time-to-value）

### F-09｜TTV 步數與等待回饋｜P1｜🟡

**實測路徑（讀碼推導，未實跑，標「待驗證」的僅時間量級）**
1. 註冊（選身分）→ 驗證信箱（`src/pages/Login.jsx` SignUpCard，步驟 1/2、2/2）
2. 建案 `/project/new`（`ProjectSetup.jsx:29` 建案成功導向 `/contract`，符合 D-007）
3. `/contract` 拖放上傳契約 → 自動分類（`classify-document`）→ 自動抽取（`extract-requirements`）
4. `/requirements` 看到履約時程

**步數：4 大步、約 8–10 個畫面動作。**（合理）

**等 AI 的部分與回饋**：做得相當好。
- 逐檔真實階段百分比：`src/pages/web/Contract.jsx:48`「逐檔進度 %:持久化 run 的真實階段 → 0/20/40/60/80/100(不是假進度)」
- 大文件分批進度：`Contract.jsx:54-57`／`src/lib/extractRequirements.js:96-100` → 「正在分析契約重點(第 N/M 批)」
- 離開頁面不遺失：進度存 `document_processing_runs`（`Contract.jsx:8-9`、`:144-176`）
- 失敗可原地重試：`Contract.jsx:498-501,547,709-712`（僅 AI 分析失敗可重試；上傳失敗要求重傳，訊息明示）

**唯一硬傷（P1）**：W13 續跑的 driver 在瀏覽器。`Contract.jsx:515-516` 自承：
> 「功能頁做事(處理會繼續,回來看進度),但**關閉/重新整理分頁會中斷**(已完成的部分保留,重試會接續)」

大契約（實測 91–106 條、多批）意味使用者可能要盯著分頁數分鐘至數十分鐘（實際時長**待驗證**）。首要買方的第一次體驗正是「跑一份真契約」（簡報 P14 建議從第②格起手），這一步斷掉＝銷售動作失敗。

**建議修法**：把接力搬到伺服器端（`pg_cron`／Edge 排程續跑），或至少在面板加常駐警語「請勿關閉此分頁」＋離開前 `beforeunload` 確認。**工作量**：警語 S；伺服器續跑 L。

### F-10｜初始化清單已是五步，D-014 與 ROADMAP 仍寫四步｜P2｜🟡

**證據**
- 實作：`src/pages/web/Dashboard.jsx:19-20` 註解「初始化**五步**清單(W2-2 建立、W8-3A 依 D-014 修訂、D-020 後補「設定開工日」)」；`buildSetupSteps()` 回傳 5 步（`:40-82`）；`Dashboard.jsx:128` `已完成 {doneCount}/5`。
- 文件：`docs/DECISIONS.md` D-014「保留**四步**初始化設定精靈」；`docs/ROADMAP.md:38`「D-014 已依核准報告修訂：保留**四步**專案初始化設定精靈」。

**目的地全部指向存活可達頁**（🟢）：`/contract`（側欄）、`/members`（hidden 但由此卡可達）、`/requirements`（側欄）、`/requirements`（開工日）、`/members`。無死連結。

**建議修法**：D-014 補一則修訂說明（D-020 後新增第 4 步設定開工日）。**工作量**：S。

---

## 四、三方角色價值（四入口表面下）

### F-11｜廠商登入後幾乎是空的——真人驗收已點名最弱的角色，表面收斂後更弱｜P0｜🔴

**證據**
- 四個側欄項無 `roles` 限制（`navConfig.js:20-23`），三方看到同樣四項。
- 廠商在四個入口能做的事：`/dashboard` 看待辦；`/contract` 上傳文件與標單（`can.edit = org === 'contractor'`，`src/store.jsx:72`）；`/requirements` 看履約時程、標記自己的義務完成、掛佐證、回報擷取有誤；`/boq` 看標單。
- **廠商的本業全部在 hidden 頁**：施工日誌、自主檢查表、品質查驗、缺失改善、工安、估驗計價、請款、成本、排程。
- 通往 `/site-log` 的唯一常駐入口是 `Dashboard.jsx:320` 的「最近施工日誌」卡片標題連結；該卡片只在 `imported`（已匯標單）分支渲染（`Dashboard.jsx:264-268` 的 else 分支）。今日待辦的「今天的施工日誌尚未填寫」需要開工錨點已設（`todayTasks.js:198` 附近的防誤報條件）。
- 對照 `docs/W8-5-三角色真實使用者驗收清單-2026-08-15.md` §八：廠商桌機輪「知道下一步 **6/11**、完成任務 **4/11**」，是三角色最低分。

**影響**：那份驗收在**六個工作面都還在側欄**的情況下就只有 4/11。現在把廠商的九個本業頁全部拿掉，廠商角色在產品裡幾乎只剩「上傳文件的人」。對事務所買方而言，三方協作是核心賣點（簡報 P03、P12），廠商端癱掉＝賣點癱掉。

**建議修法**：優先恢復 `/site-log` 與 `/quality` 兩項側欄（這兩項的 agent 替代路徑最完整，見 F-13），其餘走 F-06 的收合區。**工作量**：S。

### F-12｜機關與監造：稽核與跨案價值不可達｜P1｜🔴

**證據**
- 機關（`owner`）：`/portfolio`（跨案總覽）與 `/activity` 無入口（F-06）；`/audit`（風險稽核，`navConfig.js:63` `roles:['owner']`）唯一入口是 `/agent` 的稽核結果卡（`Agent.jsx:292`）——必須先問 agent 才找得到；`/acceptance`（驗收結算）只在有待辦時出現（`todayTasks.js:164`）。機關對 `/contract` 唯讀（`can.edit` 排除 owner）、對 `/boq` 唯讀，因此**機關登入後四個入口有兩個是純看**。
- `defaultLandingPath()` 已把機關的 `/portfolio` 落地分流拿掉（`navConfig.js:107-115` 註解自承「恢復『專案』工作面時,把多案角色(owner/supervisor)的 `/portfolio` 分流還原」）。
- 監造（`supervisor`）：`/supervisor-report`（監造報表）無入口；`/submittals`、`/quality`、`/valuation` 僅條件式。監造的日常五件事（查驗判定、送審審定、缺失複查、估驗覆核、監造報表）**沒有一件在側欄**。

**影響**：首要買方是監造事務所——他們登入後看不到自己的任何一項日常工作入口。

**建議修法**：同 F-06／F-11。**工作量**：S。

---

## 五、Agent 可發現性與替代能力

### F-13｜`問 GovAgent` 全域入口健在｜P3｜🟢

**證據**：`src/components/Layout.jsx:325-332`（側欄頂端浮起鈕，收合時保留 `aria-label`）；右下浮動 Copilot `Layout.jsx:429` → `src/components/CopilotFab.jsx:53-55`（明示「與主控台同一個 Agent」）；`/dashboard` 手機底部 CTA `Dashboard.jsx:345`（吃 `aiEnabled('agent.run')` 閘門，關掉就不渲染）。符合 D-008／D-015「不是第七個模組」。

### F-14｜agent 工具箱只覆蓋 19 個 hidden 頁中的 3 個，其餘「藏了就是沒了」｜P0｜🔴

**證據**：`supabase/functions/_shared/agentTools.ts:327-334` 的角色工具白名單——
- 查詢 7 支（`search_boq`、`list_daily_logs`、`get_valuation`、`get_requirements`、`list_my_open_items`、`find_evidence`、`get_record`，`:84-166`）
- 草稿 4 支：`draft_daily_log`（`:188`）、`draft_inspection`（`:232`）、`draft_submittal_review`（`:272`，僅 supervisor）、`run_integrity_audit`（`:207`，supervisor/owner）
- 交接 1 支：`raise_to`（`:296`）
- `CONTRACTOR_TOOLS` ＝ 7 查詢 ＋ `draft_daily_log` ＋ `draft_inspection` ＋ `raise_to`；`OWNER_TOOLS` **無任何草稿工具**。

**hidden 頁 × agent 替代能力對照**

| hidden 頁 | agent 可替代？ | 判定 |
|---|---|---|
| `/site-log` | `draft_daily_log`（草稿，仍需人到頁面存檔） | 🟠 半 |
| `/quality` | `draft_inspection`（同上） | 🟠 半 |
| `/submittals` | `draft_submittal_review`；但 `Agent.jsx:93` 明講「審定請到送審頁自行操作」，CTA 指向 hidden 的 `/submittals` | 🟠 半 |
| `/audit` | `run_integrity_audit` | 🟢 |
| `/itp`、`/safety`、`/rfi`、`/change-orders`、`/valuation`、`/payments`、`/cost`、`/progress`、`/schedule`、`/monthly-report`、`/supervisor-report`、`/acceptance`、`/portfolio`、`/activity`、`/members` | **無對應工具** | 🔴 功能消失 |

**影響**：記憶原則「藏入口的前提＝agent 替代路徑高度可發現」在 15/19 頁上不成立。且即使是「半替代」的三頁，agent 產出的是草稿，落地動作仍在 hidden 頁——鏈條在最後一步斷掉。

**建議修法**：把「無 agent 替代」的 15 頁列為**必須有可見入口**，只允許有替代工具的 4 頁繼續 hidden。**工作量**：S（若走 F-06 的收合區）。

### F-15｜16 個 AI 模組只有 3 個在存活表面觸發得到｜P1｜🔴

**證據**（`grep -rl <edge-fn> src`，對照 `src/lib/aiFeatures.js`）

| 可從存活入口觸發（3） | 觸發點 |
|---|---|
| `agent.run` | `Layout.jsx`（問 GovAgent）、`CopilotFab.jsx` |
| `documents.classify` | `src/lib/packageUpload.js`（`/contract` 上傳） |
| `requirements.extract` | `src/lib/packageUpload.js`／`documentIngestion.js`（`/contract` 上傳） |

| 只能從 hidden 頁觸發（11） | 唯一觸發點 |
|---|---|
| `submittal.read`／`submittal.review`／`rfi.draft_reply` | `src/store/slices/collab.js`（`/submittals`、`/rfi`） |
| `report.monthly` | `src/store/slices/site.js`（`/monthly-report`） |
| `valuation.summary` | `site.js`（`/valuation`） |
| `photo.classify` | `src/pages/web/ValuationPackage.jsx`、`site.js`（`/site-log`） |
| `sitelog.whiteboard`／`weather.fetch` | `site.js`（`/site-log`） |
| `defect.describe`／`safety.photo` | `src/components/DefectTracker.jsx`（`/quality`、`/safety`） |
| `audit.summary` | `src/lib/integrityAudit.js`（`/audit`，或 agent 工具） |

其餘 2：`assistant.chat` 已退場（`aiFeatures.js` 註記）、`reminder.daily` 為排程無 UI 入口。

**影響**：簡報 P12 賣「16 個 AI 功能各自註冊、各自開關」（`build-2026.cjs:682`）；買方進站實際摸得到 3 個。這也直接壓低 AI 用量，反過來讓 P16 的「含 AI 次數／年」定價假設失真。

**建議修法**：恢復入口（同 F-06），或在簡報 P12/P13 誠實頁註明「精修期部分模組入口暫關」。**工作量**：S。

---

## 六、文案與語意

### F-16｜D-019 三重揭露在主畫面 `/requirements` 缺兩重，且顯示的話是錯的｜P0｜🔴

**證據**
- D-019 要求：「核對全過顯示『系統核對無誤・自動確認』，**有疑慮照樣確認但保留 `triage_doubts`，詳情標示『未逐字核對,以契約原文為準』，紀錄行改顯『AI 整理・自動確認』**」（`docs/DECISIONS.md` D-019 決策段）。
- `/requirements/review`（擷取審核）**有正確實作**：`src/pages/web/RequirementsReview.jsx:121`
  ```js
  ? `${requirement.triage_doubts?.length ? 'AI 整理・自動確認' : '系統核對無誤・自動確認'} · ${fmtTime(...)}`
  ```
  ＋ `:687-690` 的「未逐字核對:… 內容如有出入,以契約原文為準。」＋ `:653` 頁面級聲明。
- `/requirements`（**契約重點·履約時程，三方每天用的主畫面**）**沒有**：
  - `src/pages/web/Requirements.jsx:421`：
    ```js
    what: req.reviewed_by ? '已確認 AI 轉錄與契約原文一致' : '系統核對無誤・自動確認',
    ```
    → 對**所有**自動確認項一律顯示「系統核對無誤」，**包含 `triage_doubts` 非空（實際未逐字核對）的項目**。
  - `Requirements.jsx:127` 的 requirement 查詢欄位清單：`'id, requirement_type, description, acceptance_criteria, evidence_requirement, origin, created_at, reviewed_at, reviewed_by'`——**根本沒撈 `triage_doubts`**，因此頁面在資料層就無從分辨。
  - 頁面級聲明缺席：`Requirements.jsx:637` 的 `subtitle` 是 `PARTY_BLURB[viewerParty]`（`src/lib/obligationTimeline.js:28-32`），三個角色的文案都**沒有**「內容如有出入，以契約原文為準」。
- 對照：同一句話在 `Dashboard.jsx:64`（初始化第 3 步）、`RequirementsReview.jsx:55-56`、`ObligationsPrint.jsx:157`、`extractRequirements.js:87` 都有——**唯獨主畫面沒有**。

**影響（最嚴重的單點）**：D-019 明寫「風險已向使用者揭露並由其承擔」——這個承擔的正當性完全建立在揭露上。現在主畫面不但沒揭露，還對未核對的條文顯示「**系統核對無誤**」。對一個要拿去給機關看的履約時程頁，這是會出事的錯誤陳述，而且它是**產品自己說的**，不是 AI 說的。

**建議修法**（明確、小改動）：
1. `Requirements.jsx:127` 的 select 加 `triage_doubts`。
2. `Requirements.jsx:421` 改成與 `RequirementsReview.jsx:121` 同一套三分支。
3. 義務詳情加 `RequirementsReview.jsx:687-690` 同款註記列。
4. `PARTY_BLURB` 三句各補「內容如有出入，以契約原文為準。」
**工作量**：S。**建議列為本次健檢最優先修復項。**

### F-17｜同一個領域五個名字，且有一處指向已隱藏的工作面｜P2｜🟡

**證據**

| 名稱 | 出處 |
|---|---|
| 契約重點 | `navConfig.js:22`（側欄）、`Requirements.jsx:637` `title` |
| 履約時程 | `Requirements.jsx:637` `tagline`、`:893` Card title、`:871` skeleton label |
| 履約期程 | `Requirements.jsx:702`（頁內區塊）、`Dashboard.jsx:72-76`（初始化第 4 步文案「到『契約重點』的**履約期程**設定」） |
| 期限追蹤 | `Deadlines.jsx:113` `PageHeader title="期限追蹤"`、`ObligationsPrint.jsx:57,66`「返回期限追蹤」 |
| 擷取審核 | `RequirementsReview.jsx:1016` `title="擷取審核" tagline="AI 轉錄確認"`、`Requirements.jsx:641` 頁首鈕 |
| 義務時程（已死） | `docs/pitch/pptx/README.md:66,122-123`、`build-2026.cjs:508,558` |

**額外錯誤指路（P1 級的小 bug）**：`src/pages/web/Contract.jsx:576` 與 `:584` 的 `subtitle`：
> 「標單進「標單工項」、**契約重點送「審查與協作」**；要看結果就到對應功能頁」

「審查與協作」是 hidden 工作面（`navConfig.js:34`），且契約重點早已是獨立側欄項。使用者照這句話去找，找不到任何叫「審查與協作」的東西。

**另一處**：`Deadlines.jsx:113` subtitle「**新期限請到「契約重點」確認**」——D-019 後 AI 來源的期限已自動確認，人工確認只剩 manual 補登，且動作在「擷取審核」頁不在「契約重點」頁。

**建議修法**：定一組唯一命名（建議：頁＝「契約重點」、內容物＝「履約時程」、審核頁＝「擷取審核」、`/deadlines` 併入或改名「到期管理」），修 `Contract.jsx:576,584` 與 `Deadlines.jsx:113`。**工作量**：S。

### F-18｜空狀態一律指向唯一下一步（D-007）｜P3｜🟢

**證據**
- `Requirements.jsx:884-908` 把 0 筆義務分三種：`ingestionDone`→「AI 已完成整理,目前沒有排入時程的履約義務」（不把人繞回上傳原點）；`latestFailed`→指向 `/contract` 重試；未跑過→`PrerequisiteEmptyState need/unlocks/to/cta` 指向 `/contract`。
- `Dashboard.jsx:270-274`（未匯標單的非真專案）→ 指向 `/contract`。
- `Dashboard.jsx:307-309` 待辦空狀態的 `hint`：「上傳契約後，AI 會整理期限並在此提醒。」（且僅在 `obligations.length === 0` 時出現，不亂加噪音）。
- `Requirements.jsx:895` 的錯誤分支也有 `ErrorBanner` + `onRetry`。

**結論**：這一項做得完整且有節制，符合 D-007。

---

## 七、商業就緒

### F-19｜方案模型（3 檔）與定案價格（4 級距）沒有任何對應；AI 額度／超額計價零實作｜P0｜🔴

**證據**
- 系統方案：`src/lib/aiFeatures.js:31` `export const PLAN_RANK = { trial: 0, standard: 1, pro: 2 }`；DB `projects.ai_plan` 三值（`supabase/migrations/20260728000100_ai_platform.sql:101-104`）；閘門 `ai_feature_allowed` 只比 rank（`:206-207`）。
- 定案價格（簡報 P16，`build-2026.cjs:836-841`）：**四**個級距，以「年度經手工程總額」計 → NT$ 12／30／60／120 萬，各含「4／10／20／40 萬次 AI」與「30／80／160／320 份文件解析」，超額 NT$1／次、NT$40／份。
- **對應關係不存在**：`ai_plan` 綁在**專案**（`projects.ai_plan`），價格綁在**事務所年度總額**；系統裡沒有「客戶／訂閱戶」這個實體（下詳）。
- **額度不存在**：`20260728000100_ai_platform.sql:105-109`
  ```sql
  -- ai_monthly_token_quota:每月 token 上限(null=不限)。本批只留欄位不做任何
  add column if not exists ai_monthly_token_quota bigint;
  ```
  `supabase/tests/ai_platform.sql:32` 也只驗「欄位存在(本批只留欄位)」。全 repo 搜尋 `額度`／`超額`／`quota` 在 `src/` 內**零命中**——「用到八成與用滿各通知一次，超額不斷線，按次併入次月帳單」（`build-2026.cjs` P16 額度說明）在系統內完全沒有實作。
- 兩處已知的 min_plan 特例（為了上傳鏈能跑）：`aiFeatures.js` 的 `documents.classify`／`requirements.extract` 已下放到 `trial`（migrations `20260821000200`、`20260822000400`）——證明 plan 階梯目前是被繞開的，而不是被使用的。

**影響**：簽約當天無法履行合約條款（算不出次數、發不出超額帳單、擋不住超用），也無法回答事務所「我這個月用了多少、還剩多少」。

**建議修法**：
1. 短期（S）：把四級距先當**合約層概念**，明寫「額度以每月人工對帳（`/admin` 匯出）計算」，簡報 P16 不再承諾自動通知；
2. 中期（M–L）：加「訂閱戶（customer/subscription）」實體＋期間額度計數，`/admin` 出可對帳報表。
**工作量**：S ＋ M–L。

### F-20｜`/admin` 沒有「每客戶」維度；帳單／發票無任何說明｜P1｜🟡

**證據**
- `src/pages/web/Admin.jsx:40-46` 的分頁：`用量總覽`／`依功能`／`依專案`／`依使用者`／`AI 功能開關`／`專案方案`——**沒有「依客戶／依訂閱戶」**。
- 資料庫沒有客戶實體：`grep "create table.*(organization|tenant|customer|subscription|invoice|billing)"` 僅命中 `supabase/migrations/20260712000400_p0_02_project_party_role.sql:11` 的 `public.organizations`，而該表是**專案契約方**（被 `project_parties.organization_id` 引用），不是計費對象。
- 沒有任何 invoice／billing／subscription 表；`/admin` 也沒有「帳單在系統外開立」之類的說明文字（`Admin.jsx:161` 的 subtitle 只講用量／開關／方案）。

**影響**：一個事務所可能有 10 個專案；要算他這年的用量，只能自己把 10 個專案的數字加起來。`/admin` 的「依專案」不是「依客戶」。

**建議修法**：短期在 `/admin` 加「依使用者所屬公司（`profiles.company`）」聚合作為代理維度（S）；並在頁面加一行「帳單與發票於系統外開立」的說明（S）。

### F-21｜`demo_requests` 有進水口、沒有出水口｜P1｜🟡

**證據**
- 表存在且 fail-closed：`supabase/migrations/20260824123253_create_demo_requests.sql`
  > 「此表由另一個工作階段…直接套用到正式庫…RLS 啟用且【零 policy】=API 角色全部 fail-closed,寫入只走 service role(**行銷站後端**)」
- **repo 內沒有行銷站**：`grep -rn "demo_requests" src supabase` 只命中該 migration 本身；`public/` 只有 `_headers`、`brand/`、`favicon.svg`、`robots.txt`、`theme-boot.js`、`.well-known/security.txt`——沒有 landing page。
- `/admin` 沒有 demo 申請分頁（`Admin.jsx:40-46`）；也沒有 `admin_*` RPC 讀它（`20260728000100_ai_platform.sql` 的 admin RPC 清單無此項）。

**影響**：有人在官網按「申請 Demo」，資料進 DB，但產品營運者在系統內看不到、沒有通知、沒有後續動作。這是首要買方漏斗的**第一個洞**。

**建議修法**：`/admin` 加一個「試用申請」分頁（一支 `admin_list_demo_requests()` RPC ＋ 表格），或至少接一封通知信。**工作量**：S。

### F-22｜品牌名殘留 PMIS.ai｜P2｜🟡

**證據**：`4f5c084 品牌改名:PMIS.ai → GovAgent` 已合併，但
- `docs/pitch/pptx/build-2026.cjs:29` `pres.title = 'PMIS.ai 合作簡報｜建築師事務所與工程顧問公司'`（PPT 檔案屬性）
- 產物檔名 `docs/pitch/PMIS-ai-合作簡報-事務所與顧問公司-2026-08-21.pptx`
- `public/brand/pmis-mark.svg`、`pmis-mark-dark.svg`（`Login.jsx:106-107`、`Layout.jsx:183-184`、`Security.jsx:46-47` 引用）——檔名層級，UI 顯示已是 GovAgent，影響有限。
- 記憶備註「產品名暫維持 PMIS.ai（網址 govagent，以後再改）」已被 `4f5c084` 推翻，記憶與 repo 不一致（**待使用者確認**）。

**建議修法**：重出簡報時一併改 `pres.title` 與檔名。**工作量**：S。

---

## 八、差異化：文件說有 vs 程式有

### F-23｜對照表｜P1｜🟡

**「程式有、文件沒說」**（好東西沒被拿去賣）
| 能力 | 證據 | 未見於 |
|---|---|---|
| 大文件跨 request 續跑抽取（分批、對半切、進度持久化） | `src/lib/extractRequirements.js`、`Contract.jsx:377-393`、migrations `20260822000100` | 簡報全篇未提；CURRENT.md 未載（只在營運計畫書 115/8 記事帶一句「大型契約文件續跑式抽取」） |
| 確定性轉錄分流（引文逐字核對＋期限數字交叉比對，含中文數字與民國年） | D-017、`supabase/functions/_shared/sourceVerify.ts`、`20260824130000` | 簡報未提——這其實是**比「人核定」更強的賣點**，可直接補上 F-01 的敘事缺口 |
| 契約分級可見性（機關全看／監造看施工契約＋自己的／廠商只看自己的） | D-018、`20260824000900`、pgTAP `contract_grading_completion.sql` 15 項 | 簡報未提；對事務所「同案不同契約」很有說服力 |
| 文件原始檔檢視＋中文檔名還原＋讀取留痕 | `e5f0aa3`、`src/lib/documentFileAccess.js`、`20260824000100_document_access_audit.sql` | 簡報未提 |
| 整案資料匯出 JSON（資料可攜） | `Dashboard.jsx:296-317` | 簡報 P15「兩件先講清楚」只講「契約可寫明期滿刪除與資料可攜」——其實已經做好了，可以直接秀 |
| 義務準時率統計（`completed_at` 驅動） | `20260825120000`、`Requirements.jsx:672-684` `partyStat` | 簡報未提 |

**「文件說有、程式沒有／已不成立」**
| 文件敘述 | 出處 | 現況 |
|---|---|---|
| 「AI 不會自己生效…先進待審清單」 | `build-2026.cjs:569-570` | D-019 全自動確認（F-01） |
| 「六個工作面」＋側欄截圖 | `build-2026.cjs:496,504-509`；README.md:65 | 側欄只剩 4 項（`navConfig.js:16-23`） |
| 工作面名稱「文件與結案」 | `build-2026.cjs:508`；`DECISIONS.md` D-015；`CURRENT.md` W8-1 段 | 程式是「**報表與結案**」（`navConfig.js:52`） |
| 「AI 模組 16 個…機關問 AI 用在哪、能不能關掉」 | `build-2026.cjs:682,698` | 模組數對，但只有 3 個在存活表面觸發得到（F-15） |
| P07–P11 五個亮點畫面（今日待辦／義務時程／草稿收件匣／品質查驗鏈／估驗金流） | README.md:66 | 其中 `/quality`、`/valuation` 已 hidden；「義務時程」名稱已死 |
| 「額度年度制…用到八成與用滿各通知一次，超額不斷線」 | `build-2026.cjs` P16 額度說明 | 零實作（F-19） |
| 「`/requirements` 在 demo 模式是空的，會顯示『需真實專案』」 | `docs/pitch/pptx/README.md:120` | 改版後 demo 有義務可看（`Requirements.jsx:884` 的空狀態分支只在 `isPersistedProject` 下觸發）——README 已過期 |

### F-24｜簡報產線 `shots.js` 已不能重跑｜P2｜🟡

**證據**
- `docs/pitch/pptx/shots.js:31` `{ id: 'sv-contract', role: 'supervisor', path: '/contract', scrollTo: '義務時程' }`——`/contract` 已無「義務時程」區塊（`grep -rn "義務時程" src` **零命中**），`page.getByText('義務時程')` 會逾時。
- `shots.js:34` `{ id: 'sv-nav', …, expandNav: true }` 依賴「展開<工作面>子頁」按鈕與六面側欄（`shots.js:98`），現況只有 4 項且多數無子頁。
- `shots.js:29`（`sv-report` → `/supervisor-report`）等仍指向 hidden 頁——深連結仍可達，**截出來的畫面卻是產品裡找不到的頁**。

**影響**：簡報無法照 README 重建；且截圖會賣一個買方進站後看不到的產品。**工作量**：S（改 shots 清單）。

---

## 九、文件體系

### F-25｜`docs/README.md` 索引已過期，且與 CURRENT.md 互相矛盾｜P1｜🟡

**證據**
- `docs/README.md:4` `> 最後盤點：2026-08-13`。
- **索引裡宣告未完成、實際已部署**：`docs/README.md`「現行架構」上一段：「W8-3B 目前依…規格進入真案目視收尾，**尚未合併／部署**」——但 `CURRENT.md` W8-3B 段明寫「由 PR #15 交付並部署」。
- **索引完全沒有的文件**（實際存在於 `docs/`）：`W8-5-三角色真實使用者驗收清單-2026-08-15.md`、`W8-2A-今日待辦與-Agent-資料來源盤點-2026-08-13.md`、`W8-3B-契約重點與後續動作規格-2026-08-14.md`（只在正文提及，未進表）、`青創基地/`、`pitch/pptx/README-青創進駐.md`、`pitch/brand/`、`pitch/shots-crop/`、`pitch/_to_delete/`。
- **W9 之後完全沒有文件**：D-017～D-020 只有 `DECISIONS.md` 條目；W9（Google UI 改版）、W10／W11（契約鏈精修）、W13（續跑抽取）、W14（文件治理）在 `docs/` 沒有任何規格或收官文件——`git log` 是唯一記錄。
- `docs/ROADMAP.md:3` `> 最後更新：2026-08-19`；`:32` W8-4 仍是 `[ ]`「B（監造）進行中」，但 `CURRENT.md` 已記「W8-4B 由 PR #18 交付並部署」；`:38` 仍寫「四步」初始化（見 F-10）。
- `docs/README.md` 的「未標狀態」問題：`docs/產品全案評估報告-2026-08-12.md` 在正文被引用為現行評估依據，但未列入任何狀態表格；`docs/上線衝刺-課表-2026-08.md` 標 `PLANNING SNAPSHOT`（記憶亦註「課表待辦狀態已過期」）。

**建議修法**：重跑一次盤點，把 W9–W14 補進索引（哪怕只是一行「無獨立文件，見 DECISIONS D-0xx 與 PR #nn」），並修掉 W8-3B／W8-4 的狀態矛盾。**工作量**：M。

### F-26｜CURRENT.md 需補寫的段落標題清單（只列標題，不寫內容）｜P1｜🔴

1. `§1 一句話定義` — 品牌改名 PMIS.ai → GovAgent 的收束說明
2. **（新增）`§2.0 目前買方與銷售路徑`** — GTM 2026-08-20 轉向：首要買方＝監造／PCM 事務所與顧問公司
3. **（新增）`§2.1 定價級距與方案模型的對應現況`** — 四級距 vs `ai_plan` 三檔、額度未實作
4. `§3 三層產品邊界` — 介面層改為「精修期最小表面（四入口）」的現況描述
5. **（新增）`§3.1 精修期最小表面與復出條件`** — 存活 4＋全域 4、hidden 19、無入口 7 頁的清單與復出判準
6. `§4.2 文件與履約要求脊椎` — D-017／D-019／D-020 之後的權威語意（自動確認、全型別物化）
7. `§5 AI 的不可跨越邊界` — 第 1 條需依 D-019 加註「本流程已由使用者風險決策放寬，依據＝三重揭露」
8. **（新增）`§5.1 三重揭露的實作位置`** — 頁面聲明／逐條註記／稽核事件 actor
9. `§6 目前技術現況` — 全部數字重數（路由 39／migrations 57／Vitest／E2E／pgTAP／AI 模組）
10. **（新增）`§6.2 W9 全站 UI 改版（Google 風格）`** — token、圖示字型、e2e 合約
11. **（新增）`§6.3 W10／W11 契約鏈精修與唯一命名`** — 「契約重點」定名、文件管理員獨立、`contract_total`
12. **（新增）`§6.4 W13 大文件續跑抽取`** — 跨 request 續跑、driver 在瀏覽器、批次參數與在途 run 作廢
13. **（新增）`§6.5 W14 文件治理`** — 分類修正、刪除、原始檔檢視與讀取留痕
14. **（新增）`§6.6 契約重點改版：條文檢索頁＋履約時程＋擷取審核`** — 三頁分工與審核流程新家
15. `§7 已知架構債` — 新增「最小表面造成的可發現性債」「額度計價未實作」兩條
16. `§8 文件權威順序` — 補 `docs/README.md` 過期狀態、`ROADMAP.md` 與現況的矛盾處置
17. `§9 已定案的角色與成員責任` — D-016／D-018 之後的權責與可見性補述

---

## 本維度所有檢查項清單

| 編號 | 標題 | 等級 | 狀態 |
|---|---|---|---|
| F-01 | 「AI 不會自己生效」對外承諾 vs D-019 全自動確認 | P0 | 🔴 |
| F-02 | CURRENT.md 落後 18 個 commit，已不是現況權威 | P0 | 🔴 |
| F-03 | 四份對外文件對「賣給誰」不一致 | P1 | 🟡 |
| F-04 | SaaS 套裝型歸類紀律 vs 丙案／機關模板套版 | P2 | 🟡（待驗證） |
| F-05 | 買方核心路徑六步全在存活入口內 | P2 | 🟢 |
| F-06 | 7 頁 hidden 且全站無連結可達＝功能消失 | P0 | 🔴 |
| F-07 | `/members` 開啟正式模式後零入口 | P0 | 🔴 |
| F-08 | 其餘 hidden 頁只有條件式可達（冷啟動死結） | P1 | 🟡 |
| F-09 | TTV 四大步、回饋完整；W13 續跑綁瀏覽器分頁 | P1 | 🟡 |
| F-10 | 初始化實為五步，D-014／ROADMAP 仍寫四步 | P2 | 🟡 |
| F-11 | 廠商登入後幾乎空（真人驗收最弱角色再被削） | P0 | 🔴 |
| F-12 | 機關／監造的稽核與跨案價值不可達 | P1 | 🔴 |
| F-13 | `問 GovAgent` 全域入口健在（頁首＋FAB＋手機 CTA） | P3 | 🟢 |
| F-14 | agent 只覆蓋 19 個 hidden 頁中的 4 個 | P0 | 🔴 |
| F-15 | 16 個 AI 模組只有 3 個在存活表面觸發得到 | P1 | 🔴 |
| F-16 | D-019 三重揭露在 `/requirements` 缺席且顯示不實 | P0 | 🔴 |
| F-17 | 同領域五個名字＋`/contract` 指向已隱藏工作面 | P2 | 🟡 |
| F-18 | 空狀態一律指向唯一下一步（D-007） | P3 | 🟢 |
| F-19 | 四級價格 vs 三檔 plan 無對應；額度／超額零實作 | P0 | 🔴 |
| F-20 | `/admin` 無「每客戶」維度；帳單發票無說明 | P1 | 🟡 |
| F-21 | `demo_requests` 有進水口沒出水口 | P1 | 🟡 |
| F-22 | 品牌名 PMIS.ai 殘留（簡報 title／檔名／資產檔名） | P2 | 🟡 |
| F-23 | 差異化對照：程式有文件沒說 6 項／文件說有程式沒有 7 項 | P1 | 🟡 |
| F-24 | 簡報產線 `shots.js` 已不能重跑 | P2 | 🟡 |
| F-25 | `docs/README.md` 索引過期且與 CURRENT.md 矛盾 | P1 | 🟡 |
| F-26 | CURRENT.md 待補段落標題清單（17 條） | P1 | 🔴 |

**統計：🔴 9（F-01、F-02、F-06、F-07、F-11、F-12、F-14、F-15、F-16、F-19、F-26 中取 P0/P1 紅燈 → 實際紅燈 11 項）｜🟡 12｜🟢 3｜共 26 項**

> 修正統計：🔴 **11**（F-01、F-02、F-06、F-07、F-11、F-12、F-14、F-15、F-16、F-19、F-26）｜🟡 **12**（F-03、F-04、F-08、F-09、F-10、F-17、F-20、F-21、F-22、F-23、F-24、F-25）｜🟢 **3**（F-05、F-13、F-18）｜合計 **26** 項。

---

## 建議處理順序（給使用者的一頁）

1. **F-16**（S）——主畫面對未核對條文顯示「系統核對無誤」。這是唯一一條「產品在對機關說謊」的 bug，先修。
2. **F-07**（S）——正式模式後 `/members` 無入口。導入即撞。
3. **F-06 ＋ F-11 ＋ F-14 ＋ F-15**（S，同一個改動）——加「更多工作面」收合區或恢復 `/site-log`、`/quality`、`/supervisor-report`、`/portfolio` 四項側欄。
4. **F-01**（S 或 M）——決定是改產品還是改簡報，不能兩邊都放著。
5. **F-19 ＋ F-21**（S 起步）——簽約前必須能對帳、Demo 申請必須有人看得到。
6. **F-02 ＋ F-26 ＋ F-25**（M）——文件回到可信狀態，否則下一輪任何協作者都會做錯假設。
