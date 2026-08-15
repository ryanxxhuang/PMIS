# GovAgent／PMIS 整理路線

> 狀態：**ACTIVE（W0–W7 已完成既定範圍；W8-1 PR #11、W8-2 PR #12、W8-3A PR #13、W8-1R PR #14、W8-3B PR #15、W8-4A PR #16、W8-4C PR #17；進行中 W8-4B）**
> 最後更新：2026-08-15
> 依《產品全案評估報告 2026-08-12》與已核准的 W8-0 第三版（方向已定案為 D-007～D-015）。
> 每個小任務一個 commit；每個工作包一個 PR。完成就把 `[ ]` 改 `[x]` 並填 PR 編號。

## 續接規則（給任何新 session／新 AI，防止 token 用盡後重來）

1. 先讀本檔，找到**第一個未勾**的小任務，只做那一格；範圍以該格的「不做」為硬邊界。
2. 不重新設計架構、不合併任務、不順手修「未排入」清單裡的東西。
3. 每格完成＝測試綠（vitest／build，動 DB 加 pgTAP）＋ commit ＋ 勾掉本檔那格。
4. 工作包內全部格子勾完 → push ＋ 開 PR（base 見下）→ 更新 `CURRENT.md` 數字基線。
5. W0～W5 已全部合併至 `main`；新的工作包一律從最新 `main` 建分支、PR base 也用 `main`，不要繼續沿用舊 `fable/w1`～`w4` 或 W5 分支。
6. 動手前的五行規格（DEVELOPMENT.md §2）直接寫在該包 PR 描述，不另立文件。

## 進度總覽

- [x] W0 可追蹤基準
- [x] W1 標單資料安全 — PR #2，已部署（migration `20260812000200`）
- [x] W2 單一初始化流程 — PR #3，已部署
- [x] W3 單一 Agent 體驗 — PR #4，已部署（migration `20260812000300`＋16 支 Edge Functions）
- [x] W4 成員與正式模式 — PR #5，已部署（migration `20260812000400`）
- [x] W5 一次一項架構債 — PR #6，已部署（migrations `20260812000500`、`20260812000600`）
- [ ] W6 最小真案驗收 — PR #7 已合併並部署（尚缺 live Edge 成功路徑）
- [x] W7 路由治理 — PR #9，已部署
- [x] W8-0 UI/UX 全產品重新評估與整體改善計畫（第三版）— 使用者已核准
- [x] W8-1 全站框架、品牌與導覽 — PR #11
- [x] W8-1R 常駐階層側欄修正 — PR #14，已部署
- [x] W8-2 今日待辦與 Agent 分工 — PR #12（563 Vitest／19 Demo E2E／build 全綠）
- [x] W8-3A 初始化設定精靈 — PR #13（583 Vitest／19 Demo E2E／build 全綠；真實 staging 專案桌面／375px 目視通過）
- [x] W8-3B 契約重點與具體後續動作 — PR #15，已部署（587 Vitest／19 Demo E2E／build 全綠；真案三角色目視待補）
- [ ] W8-4 三角色核心業務頁 — A（PR #16）／C（PR #17）已部署；B（監造）進行中
- [ ] W8-5 手機、無障礙、視覺一致性與真實使用者驗收 — `ACCEPTED`，最後收尾

D-014 已依核准報告修訂：保留四步專案初始化設定精靈，第 3 步採「AI 整理完成」，不要求清空全部待審。全產品方向見 D-015。

W6 的 5 條本機真後端測試於 2026-08-13 重跑均綠，PR #7 已合併、main CI 與 Cloudflare 部署成功；但 W6-4 以綁定真文件版本的人工待審 fixture 代替 live AI 輸出。`ANTHROPIC_API_KEY` 已可由未追蹤環境檔注入，但 Supabase CLI 2.113.0 的本機 Edge main worker 目前在模型呼叫前即發生 entrypoint boot error；待 CLI 修復或一次性 hosted staging 後才能完整收官，不阻擋 W7。

---

## W2｜單一初始化流程（D-007）

- [x] **W2-1 建案後導向專案文件**
  範圍：`ProjectSetup.jsx` 建案成功導向 `/contract`；BOQ 空狀態與 Dashboard 的「下一步」文案統一指向專案文件。
  不做：不動建案表單欄位、不動 Contract 頁上傳邏輯。
  驗收：新專案建案後落在專案文件頁；全站對「尚未匯標單」的指引只有一種說法。
- [x] **W2-2 初始化四步清單**
  範圍：Dashboard（真專案）顯示固定四步 checklist：上傳文件（含 PCCES）→ 三方成員 → 檢查 AI 建議 → 開啟正式模式（文件優先，與建案落地頁一致；PR #3 review 修正順序）；每步狀態由既有資料推導（成員數／文件數／workItemsSource／formal_mode），各步連到既有頁面。
  不做：不建 onboarding framework、不加新表、不做逐步精靈。
  驗收：四步各自的完成／未完成狀態正確；點擊直達對應頁。
- [x] **W2-3 解除 Agent 的 BOQ 全頁阻擋（P1-02）**
  範圍：`/agent` 在未匯 BOQ 時仍可用（文件／成員／期限類工具照常）；工項類工具個別回覆「需先匯入標單」並附連結。
  不做：不改 Agent runtime、不加新工具。
  驗收：新專案（無 BOQ）能在 `/agent` 問文件與期限問題；工項類問題得到明確導引而非整頁擋住。
- [x] **W2-4 其他整頁阻擋盤點與統一**
  範圍：盤點所有因「無 BOQ」整頁擋住的頁面，空狀態統一改為「先到專案文件上傳標單」＋連結（沿用 W2-1 的說法）。
  不做：不解除確實依賴工項的功能（估驗／進度本來就要標單）。
  驗收：無 BOQ 時逐頁走查，看不到互相矛盾的指引。

## W3｜單一 Agent 體驗（D-008）

- [x] **W3-1 /assistant 能力盤點＋導向**
  範圍：逐工具比對 `/assistant`（`assistant.chat`）與 `/agent`（`agent.run`）能力；確認無獨有能力後，`/assistant` 路由 302 到 `/agent`（保留路由不刪）。有獨有能力則先停下來回報使用者。
  不做：不刪 `assistant` edge function、不動 DB。
  驗收：直接輸入 `/assistant` 網址會到 `/agent`；能力比對結論寫在 PR。
- [x] **W3-2 浮動 Copilot 收斂為薄入口**
  範圍：浮動按鈕改為開啟同一 Agent（同 session 或明示「新對話」，擇一實作並寫進 PR）；移除「已匯 BOQ 才出現」的限制（對齊 W2-3）。
  不做：不做跨裝置對話歷史、不加聊天資料庫。
  驗收：浮動入口與 `/agent` 行為一致；使用者能分辨這是同一個 Agent。
- [x] **W3-3 assistant.chat 功能退場**
  範圍：前端不再呼叫 `assistant.chat`；`ai_features` 標記停用（不刪列、不刪 edge function 檔案）；用量歷史保留。
  不做：不刪任何 DB 資料與歷史。
  驗收：全站僅剩 `agent.run` 一個對話功能開關；`/admin` 用量頁仍能看歷史。
- [x] **W3-4 AI 閘門 fail-closed（D-010、P1-07）**
  範圍：`_shared/aiGate.ts` 查詢失敗改為拒絕（fail-closed）＋清楚錯誤訊息；用量寫入失敗不擋回應但記 log 告警（既有 log 管道即可）。
  不做：不做補記後台、不改方案模型。
  驗收：模擬 `ai_feature_allowed` 查詢失敗 → 功能拒絕服務；恢復後正常。附對應測試。

## W4｜成員與正式模式（D-009）

- [x] **W4-1 Members 頁三態分離（P1-05）**
  範圍：`loading`／`empty`／`error` 分開；RPC 錯誤顯示並可重試。
  不做：不動成員資料模型。
  驗收：模擬 RPC 失敗看得到錯誤與重試鈕；空專案顯示空狀態而非永遠載入。
- [x] **W4-2 三方權限文案修正（P1-06）**
  範圍：依三方決策重寫成員頁權限說明（機關＝變更核准／付款／驗收，非唯讀），移除重複句。
  不做：不改 `can`／RLS 本身。
  驗收：文案與 `can` 及 RLS 實際行為一致（對照表寫進 PR）。
- [x] **W4-3 邀請時確認三方身分（D-009 最小實作）**
  範圍：邀請流程顯示被邀帳號的 org_type，邀請方必須確認才加入；不符（例如想邀監造但對方註冊成廠商）給明確錯誤與指引。
  不做：不做邀請先行（未註冊邀請）、不建組織樹、不加新角色。
  驗收：三方身分錯配無法靜默入案；錯誤訊息可理解。
- [x] **W4-4 正式模式前的三方到齊檢查**
  範圍：開啟正式模式的確認畫面顯示三方成員是否到齊（缺哪方列出來）；到齊與否都可開，但要明確確認。
  不做：不改正式模式的單向語意與 RLS。
  驗收：三方不齊時開啟會看到警示並需二次確認。

## W5｜一次一項架構債（依序，每項單獨核准）

- [x] **W5-1 C-001 資料盤點（唯讀，D-011）**
  範圍：盤點 `contract_obligations` ↔ `requirements`：正式庫數量、同步殘料、程式雙寫點清單 → 產出一頁決策文件（單向 vs 解耦的代價比較）交使用者定案。
  不做：不改任何程式與資料。
  驗收：使用者能憑 [`W5-1-Requirement-Obligation-決策書.md`](W5-1-Requirement-Obligation-決策書.md) 直接選邊。
- [x] **W5-2 C-001 單向 Requirement → obligation（D-012；PR #6 已部署）**
  範圍：變更前先以正式庫唯讀 `count(*)` 精確分類 W5-1 的約 48 筆差額並把匿名統計附在 PR；移除 obligation → Requirement 的同步／刪除 trigger；將 approved deadline Requirement → obligation 的冪等轉換放進受控審查交易；停止 `Contract` 前端所有 `parse-contract` 呼叫，保留 Edge Function 檔案作相容／rollback。既有 obligation 原列沿用，不重建。
  欄位：Requirement 管契約內容與期限規則；obligation 只保留提醒 runtime。轉換可更新標題、階段、責任方與期限規則，但不得覆寫既有 `status`、`evidence_submittal_id`、`penalty` 或歷史連結。
  不做：不刪表、不批次刪歷史資料、不自動核定 AI 建議、不處理非 deadline 產物、不順手做 W5-3／W5-4。
  驗收：同一文件只觸發一次 Requirement 抽取；待審／駁回 Requirement 不產生 obligation；核定 deadline 恰好產生一筆，重試不重複；既有 65 筆 obligation 的執行狀態與佐證不變；Vitest、build、相關 E2E 與 pgTAP 全綠，附 migration rollback。
  證據：2026-08-12 正式庫唯讀精確基線為 65 obligations／113 requirements／48 筆未連 obligation；48 筆全為未核定建議，orphan legacy = 0、approved deadline 缺 obligation = 0。519 Vitest、12 E2E、23 檔 715 pgTAP、build 及 rollback 重升演練全綠。PR 審查另補上 supersede 回歸：已取代的 deadline 只將仍待辦的 obligation 標成「不適用」，保留原列、佐證與歷史，並退出前端及 Agent 現行清單。migration `20260812000500` 已於 2026-08-13 部署。
- [x] **W5-3 C-002 成員模型命名防誤用（PR #6 已部署）**
  範圍：補 helper 註解與開發規則（`project_members`=授權、`project_memberships`=身分快照），高風險呼叫點加註。
  不做：不改名、不刪相容表、不動 RLS。
  驗收：兩套模型的用途在程式內有單一說明點可查。
  證據（2026-08-12）：唯一規則固定在 `architecture/three-party-role-model.md`；comment-only migration `20260812000600` 標註兩張表與 11 個 helper，高風險 Store／契約文件／提醒呼叫點已加註。519 Vitest、12 E2E、23 檔 720 pgTAP、build 與 DB lint 全綠；未改 RLS，migration 已於 2026-08-13 部署。
- [x] **W5-4 C-003 已漂移規則抽純函式（PR #6 已部署）**
  範圍：只處理「已經發生 demo／DB 行為不一致」的規則，抽共用純函式＋測試釘住。
  不做：不全面重構雙引擎。
  驗收：列出處理了哪幾條規則，各附一個回歸測試。
  本機證據（2026-08-12）：盤點後只處理一條可重現漂移——試體不合格時 Demo 曾因 React updater 時序漏開缺失，重試又未依 `test_sample_id` 去重；正式 DB trigger 會同交易建立且冪等。已抽 `deriveTestSampleUpdate`／`shouldCreateTestSampleDefect`，並各有純函式測試及一條整合回歸。522 Vitest、12 E2E、23 檔 720 pgTAP、build 與 DB lint 全綠；未新增 migration，其他潛在同步點未重構。

W5 統一收尾（2026-08-13）：W5-1 決策與正式庫匿名基線、W5-2 單向 migration／rollback／pgTAP、W5-3 comment-only migration、W5-4 純函式與回歸測試均逐項符合上述範圍；PR 審查發現並補上 supersede 不得殘留待辦提醒的回歸，沒有新增架構或擴大重構。最新全套結果為 523 Vitest、12 E2E、23 檔 723 pgTAP、build 與 DB lint 全綠；PR #6、正式 migrations、`agent-run`／`send-reminders`、main CI 與 Cloudflare Workers 均已部署驗證。

## W6｜最小真案驗收（不以 demo 通過代替真後端）

- [x] **W6-1 真後端 E2E 基建（本機完成，待 W6 工作包統一 PR）**
  範圍：Playwright 第二個 project（真 Supabase staging；帳號／秘密由環境變數注入），本機手動跑，不進預設 CI。
  不做：不改既有 demo E2E、不建雲端常駐 staging（臨時開→測完刪，見成本紀律）。
  驗收：`npm run test:e2e:real` 能對真後端跑一條冒煙。
  本機證據（2026-08-13）：隔離的 `real-supabase` project 以環境變數啟動，登入／F5 session 還原／登出 1/1 通過；缺 secrets 與正式 Supabase URL 均在瀏覽器啟動前被拒絕。臨時帳號清理後殘留 0；原 12 Demo E2E、523 Vitest 與 build 全綠，CI 未加入真後端測試。
- [x] **W6-2 鏈 1：註冊→登入→建案→邀請→正式模式**
  本機證據（2026-08-13）：`e2e-real/chain1-onboarding.spec.js` 對一次性本機 staging 通過——註冊落地建案頁、建案導向專案文件（D-007）、邀請錯配被擋＋訊息完整（D-009）、三方到齊轉綠（W4-4）、requireText 開啟正式模式、被邀監造登入可見專案（RLS）；afterAll 走 delete_project RPC＋admin API 清理，殘留 0。
- [x] **W6-3 鏈 2：廠商提送→監造審核→機關核准／付款**
  本機證據（2026-08-13）：`e2e-real/chain2-valuation.spec.js` 正式模式下通過——廠商建期送審（無核定鈕）、監造核定、機關登錄請款/收款（待請款→已請款→已收款）；fixture 全走產品 RPC，afterAll 清理殘留 0。
- [ ] **W6-4 鏈 3：文件上傳→Requirement 建議→人工核定**
  已通過部分（2026-08-13）：`e2e-real/chain3-requirements.spec.js` 上傳契約 txt（Storage＋documents＋document_versions），並在真文件版本建立後插入帶 document source 的人工待審 Requirement；廠商看得到但無核定鈕，監造經 `review_requirement` 核定後，D-012 義務物化出現同標題與固定到期日。清理含 Storage 物件，殘留 0。
  尚缺：Supabase CLI 2.113.0 的本機 Edge main worker 目前在模型呼叫前即發生 entrypoint boot error，尚未驗證 `extract-requirements` live AI 成功產生 `document_ingestion_runs`、AI-origin Requirement 與 citation；待 CLI 修復或一次性 hosted staging 再驗，不能以人工 fixture 代替。
- [x] **W6-5 鏈 4：標單匯入失敗／重設失敗 rollback（真後端重演 W1 pgTAP 情境）**
  本機證據（2026-08-13）：`e2e-real/chain4-boq-rollback.spec.js` 通過——缺父項匯入整包拒收（全敗如未匯）、重試成功、重複匯入被擋；品質檢查紀錄連工項時 UI 清空重匯被 guard 擋下並顯示「清空未執行，所有資料維持原狀」紅色橫幅，標單與日誌原封不動（舊版災難點：日誌被靜默刪光）；移除品質證據後重試清空成功、回到 onboarding。
  （W6-2、W6-3、W6-5 已達成；W6-4 的 RLS／Storage／審查／物化已綠，live Edge 成功路徑待補。）

---

## W7｜路由治理（D-013、P1-08）

- [x] **W7-1 單一路由表與預設拒絕**
  範圍：`src/lib/navConfig.js` 建立涵蓋 36 條 App 路由的 `routeRegistry`；導覽內路由沿用既有角色規則，登入、公開頁、重新導向、建案、列印與 404 明確登記；App 由路由表統一決定是否套共同守衛。
  不做：不改三方角色、既有頁面權限、導覽 IA、RLS、資料庫或頁面 UI。
  驗收證據（2026-08-13）：未登記路由對三角色、override 與平台管理員皆拒絕；四條列印路由明確標為 authenticated print 並通過共同登入／專案守衛；公開漏洞頁仍可匿名讀。530 Vitest、14 Demo E2E、5 真 Supabase E2E 與 production build 全綠。PR #9 已合併，main CI 與 Cloudflare Workers build 成功，正式站首頁、業務、公開與列印深連結均回 HTTP 200。

---

## W8｜全產品 UI/UX 改善（D-014、D-015）

- [x] **W8-1 全站框架、品牌與導覽（PR #11）**
  範圍：主品牌改為 `GovAgent｜公共工程`；側欄收斂為六個工作面；`問 GovAgent` 移至全域頁首；Dashboard 顯示名稱改為「今日待辦」；機關根路徑與 404 返回跨案總覽，其他角色返回今日待辦；手機抽屜有明確關閉鈕，工作面內頁改用目前頁面選單；共用 PageHeader 不再截斷說明。
  不做：未改業務資料、路由數、頁面權限、RLS、資料庫、今日待辦聚合、Agent 內容、初始化完成條件或 Requirement 流程。
  驗收證據（2026-08-13）：531 Vitest、16 Demo E2E 與 production build 全綠；三角色導覽仍只有六個業務工作面，36 條路由與原角色限制完整；Codex 瀏覽器目視桌面 Dashboard、機關 Portfolio、375px Dashboard／抽屜／品質頁，皆無文件級水平溢位。

- [x] **W8-1R 常駐階層側欄修正（PR #14，已部署）**
  問題：W8-1 已收斂六個工作面，但子頁仍被藏在內容區橫向 `WorkbenchTabs` 與手機下拉選單，使用者無法從側欄直接理解整體功能結構。
  目標：桌面側欄預設常駐且可收合；工作面子頁選單預設收合，展開後直接排在所屬工作面下方，目前所在工作面也可再次收合。手機維持抽屜並使用同一套階層。視覺採中性圓角選取區塊、安靜縮排與清楚父子層級。
  不做：不改路由、角色限制、RLS、資料庫或業務頁；不做 hover 飛出選單，不新增第二份導覽資料。
  影響：最小修改 `Layout.jsx`、`App.jsx`、`navConfig.js` 的呈現 helper 與相關測試；`navConfig.js` 仍是單一真相來源。
  驗收：60 個 Vitest 檔／576 個測試、19 個 Demo E2E 與 production build 全綠；桌面側欄收合偏好、子頁預設收合、目前工作面可再次收合與 375px 同源抽屜均由 E2E 固定。
- [x] **W8-2 今日待辦與 Agent 分工（PR #12）**
  範圍：W8-2A 先盤點（[`W8-2A-今日待辦與-Agent-資料來源盤點-2026-08-13.md`](W8-2A-今日待辦與-Agent-資料來源盤點-2026-08-13.md)），W8-2B 依該文件 §5～§7 實作 B1～B7：新增單一聚合 `src/lib/todayTasks.js`；`Alerts.jsx` 內嵌的第二套規則搬進去並補球權；補上契約義務、試體齡期、驗收法定期限與 ITP 停留點；Dashboard 改三段（每段 5 筆、溢位連 `/alerts`）；Agent 移除重複待辦只留無件數連結；修正估驗待請款導向與 demo 的 `inspected_at`。
  不做：不新增 task 表或 workflow engine、不改三角色、不動 RLS／migration／Edge Function、不改 `Contract` 的義務操作、不動初始化四步清單與 `/requirements`（W8-3）。
  驗收證據（2026-08-13，本機）：563 Vitest、19 Demo E2E、production build 全綠；`todayTasks.test.js` 釘住三分類與球權、互斥性、到期排序、責任白名單、AI 產物不得成為待辦、「今天已完成」只吃可靠時間戳、以及兩個日期邊界回歸（台北日曆日門檻、每月義務不讀系統時鐘）；三角色 demo 目視與 375px 無水平溢位。前後端待辦集合差異登記於 [`architecture/dual-engine-sync.md`](architecture/dual-engine-sync.md)，不在本包對齊。

- [x] **W8-3A 保留並改善初始化設定精靈（D-014，PR #13）**
  問題：四步方向正確，但第 3 步目前以「待審清零且至少核定一筆」判定完成，會把大量 AI 建議誤包裝成人工初始化門檻；第 4 步文案又錯稱三方到齊後才能開啟，與 W4 已定案行為不一致。
  目標：保留 Dashboard 原有四步清單，讓使用者一眼看懂誰負責、系統何時算完成、現在唯一建議的下一步，以及哪些事項只是建議準備而非阻擋正式模式。
  不做：不新增 onboarding／wizard framework、路由、資料表、migration、Edge Function、角色或 Store slice；不改正式模式的 DB/RLS/單向語意；不在本包重做 `/requirements` 清單、批次核定或契約重點資訊架構（屬 W8-3B）。
  影響：只允許最小修改 `Dashboard.jsx` 的 `SetupChecklist`，以及 `Contract.jsx`、`Requirements.jsx`、`Members.jsx` 與相關測試中的必要銜接文案；沒有明確需要時不新增共用模組。
  驗收：第 3 步不再讀 Requirement 待審／核定數決定完成；AI 整理完成但仍有 106 筆待審時仍顯示完成；四步各有責任方與唯一目的地；前面步驟未完成仍可由建立者開啟正式模式；桌面與 375px 無水平溢位且沒有第二套初始化狀態。

  **四步唯一判定（不得自行改寫）**

  | 步驟 | 責任 | 完成條件（只用既有資料） | 唯一目的地 |
  |---|---|---|---|
  | 1. 上傳專案文件與標單 | 施工廠商／專案建立者 | `documents` 至少 1 件，且 `workItemsSource === 'db'` | `/contract` |
  | 2. 確認三方成員 | 專案建立者 | `project_members` 的 `org_type` 同時涵蓋 `contractor`、`supervisor`、`owner` | `/members` |
  | 3. AI 整理契約重點 | 系統自動 | `document_ingestion_runs` 至少 1 筆 `status = 'completed'`；即使擷取結果為 0 筆或仍有任意數量待審 Requirement，也算整理完成 | 未完成到 `/contract`；完成後查看結果到 `/requirements` |
  | 4. 開啟正式模式 | 專案建立者 | 清單顯示期間固定未完成；`formal_mode = true` 後整張清單依既有行為消失 | `/members` |

  **UI 與錯誤規則**

  1. 保留一張卡片與四列清單，不新增獨立精靈頁；卡片顯示「已完成 N/4」與一個醒目的「下一步：…」入口，取前 3 步第一個未完成項，前三步皆完成時指向第 4 步。
  2. 每列顯示責任方、完成／未完成狀態與一個目的地；不得出現逐筆打勾、略過、批次核定或「清空待審」操作。
  3. 第 3 步只查 completed ingestion run。文件或 ingestion 查詢失敗要如實顯示「狀態載入失敗，前往專案文件查看」，不得當成 0 筆；沒有 completed run 時一律回 `/contract` 查看處理或重試。
  4. 第 3 步完成文案必須明講「AI 已完成整理；只有要成為契約規則的內容才需人工核定，不影響開啟正式模式」，不得再顯示待審數量製造清空壓力。
  5. 第 4 步永不因第 1～3 步或三方未到齊而 disabled；`Members.jsx` 保留既有缺方警告與二次確認，只補「初始化是準備指引，不要求清空 AI 建議」的說明。
  6. `Contract.jsx`／`Requirements.jsx` 只補同一語意的短說明，不改列表、篩選、核定 RPC、權限或資料查詢；完整契約重點改版留給 W8-3B。

  **最低測試**

  1. completed ingestion run + 106 筆待審 + 0 筆核定，步驟 3 仍完成。
  2. 沒有 completed run，即使已有 approved Requirement，步驟 3 仍未完成並導向 `/contract`。
  3. completed run 擷取 0 筆 Requirement，步驟 3 仍完成；這代表 AI 已整理但沒有找到建議，不是假失敗。
  4. ingestion 查詢失敗不偽裝成「尚未開始」；正式模式入口不被前三步鎖住。
  5. 維持完整 Vitest、Demo E2E、production build；本包不動 DB／Edge，因此不新增 pgTAP／真後端 E2E。

  **驗證（2026-08-14，PR #13）**：四步判定、責任方、單一下一步、查詢失敗與正式模式不鎖定均已由 13 個 `Dashboard.setupChecklist` 測試固定；另以 7 個 `Requirements.intro` 測試固定 completed run + 0 筆的有效空結果，以及「沒有 completed run 不得宣稱 AI 已完成」。完整結果為 60 個 Vitest 檔、583 個測試與 19 個 Demo E2E 全綠，production build 成功，`git diff --check` clean；沒有變更 DB／Edge／路由／角色／Store。另以既有 staging 測試帳號建立未開正式模式的真實專案，完成 Dashboard 初始化卡片桌面與 375px 目視，以及 `/contract`、`/requirements`、`/members` 三個銜接頁的 375px 無水平溢位驗收；臨時專案已刪除。

- [x] **W8-3B 契約重點與具體後續動作（PR #15，已部署）**
  範圍與實作契約見 [`W8-3B-契約重點與後續動作規格-2026-08-14.md`](W8-3B-契約重點與後續動作規格-2026-08-14.md)。`/requirements` 預設只呈現已生效重點與最多 6 筆值得留意的整理結果；原始列、完整引註、歷史 run 與原審查動作保留在可收合追溯區。只有規則可追蹤的 deadline 顯示真實「核定並加入期限追蹤」捷徑，仍走 `review_requirement` 與 D-012；其他類型不假裝已有工作流建立器。

  **交付（2026-08-15，PR #15 已合併部署）**：F1～F4 依規格 §11 完成——375px 動作鈕與六個追溯篩選補 44px 觸控高度（`max-sm:min-h-11`，桌面不變、不動共用 `ui.jsx`）、廠商唯一「查看」動作補中性邊框、無核定權提示改淡底提示列；Codex 的追溯收合清除歷史詳情修正保留。587 Vitest、19 Demo E2E、build 與 `git diff --check` 全綠；main CI 與 Cloudflare Workers build 成功，正式站四條冒煙 200，且已確認部署 CSS 含 44px utility、Requirements chunk 含期限捷徑。**真案三角色桌面／375px 實機目視仍未執行**（無可用帳號，AI 不得代登入），列為 W8-5 前的待補驗收。

---

### W8-4｜三角色核心業務頁（A／C 已交付）

- [x] **W8-4A 廠商核心頁（PR #16，已部署）**
  範圍：/quality 重大重整——「現在要處理」工作佇列（`buildQualityQueue` 純函式，只組合既有 `collaborationItems`＋`sampleAlerts`，AI 產物結構上進不了佇列）＋查驗/缺失/觀察/檢查表/試驗五段分段控制（預設查驗、44px、非當前分段 unmount）＋判不合格原地回饋與「查看缺失」切段；/site-log 手機存檔列 `max-sm` sticky 貼底（只在 `can.edit`，唯讀分支零改動留給 W8-4B）。
  不做：未改 store slice、lib 引擎、寫入參數、權限條件、RLS、路由、角色。
  驗收證據（2026-08-15）：595 Vitest（+8）、20 Demo E2E（+廠商缺失改善鏈）、build 全綠；對抗式紅線審查 PASS；375px /quality、/site-log 無溢位；PR CI 與合併後 main CI／Cloudflare build 成功。
- [x] **W8-4C 機關核心頁（PR #17，已部署）**
  範圍：/portfolio 例外數字帶（`portfolioExceptions` 純函式，0 不渲染）；/payments 手機唯讀期別時間線（桌面表格 `max-sm:hidden`，措辭避開 待請款/已請款/已收款 子字串以保真後端 e2e strict mode）；/change-orders 分「待核定／已核定／已結」兩群、已定案明細收 `<details>`、核定 select 位置不變。
  不做：未改金額計算來源（adjustedItems/B-02）、日期 gate、非受控輸入、寫入參數。
  驗收證據（2026-08-15）：592 Vitest（+5）、19 Demo E2E（含 B-02 回歸）、build 全綠；紅線審查 PASS；三頁 375px 無溢位；PR CI 與合併後 main CI／Cloudflare build 成功。
- [ ] **W8-4B 監造核心頁**（進行中）
  範圍：/valuation 先狀態・責任方・差異・可做動作再明細；/submittals 依球權分組；監造日誌摘要式唯讀檢視（不以大量 disabled 欄位假裝可編）。查驗與缺失複查已由 W8-4A 分段涵蓋。
  邊界：不可破壞 `e2e-real/chain2-valuation.spec.js` 既有 locator（該檔不可改，改了要真後端重跑才能驗）。

## 未排入（已知、刻意不順手做；要做需回報告或另立決策）

- ~~P1-08 路由治理（route registry 預設拒絕）~~ — W7 完成，見 D-013
- P1-09 以外的 P2 全部（品牌統一、載入效能、列印、OCR 支援矩陣…見報告 §6.3）
- `(project_id, item_key)` 部分唯一索引（待正式資料盤點：`select project_id, item_key, count(*) from work_items where item_key is not null group by 1,2 having count(*) > 1;` 回空＝可加索引）
- ~~pgTAP 進 CI（P2-08）~~ — 2026-08-13 完成：`.github/workflows/pgtap.yml`，動到 `supabase/migrations|tests|config` 的 push/PR 觸發，全套失敗偵測含 not-ok／SQL 中斷／plan 數不符／整檔壞掉
- 已核定估驗／檢查紀錄擋重設的 UX 磨光（guard 訊息措辭）
- agent-run 回答補出處連結（sources）——/assistant 唯一獨有的輸出格式，導向後暫以 steps 摘要代替
