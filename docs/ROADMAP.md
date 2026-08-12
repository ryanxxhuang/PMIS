# GovAgent／PMIS 整理路線

> 狀態：**ACTIVE（W0–W4 已完成並部署；W5–W6 已獲准依序執行）**
> 最後更新：2026-08-12
> 依《產品全案評估報告 2026-08-12》§9 工作包與 §10 決策（已定案為 D-007～D-011）。
> 每個小任務一個 commit；每個工作包一個 PR。完成就把 `[ ]` 改 `[x]` 並填 PR 編號。

## 續接規則（給任何新 session／新 AI，防止 token 用盡後重來）

1. 先讀本檔，找到**第一個未勾**的小任務，只做那一格；範圍以該格的「不做」為硬邊界。
2. 不重新設計架構、不合併任務、不順手修「未排入」清單裡的東西。
3. 每格完成＝測試綠（vitest／build，動 DB 加 pgTAP）＋ commit ＋ 勾掉本檔那格。
4. 工作包內全部格子勾完 → push ＋ 開 PR（base 見下）→ 更新 `CURRENT.md` 數字基線。
5. W0～W4 已全部合併至 `main`；新的工作包一律從最新 `main` 建分支、PR base 也用 `main`，不要繼續沿用舊 `fable/w1`～`w4` 分支。
6. 動手前的五行規格（DEVELOPMENT.md §2）直接寫在該包 PR 描述，不另立文件。

## 進度總覽

- [x] W0 可追蹤基準
- [x] W1 標單資料安全 — PR #2，已部署（migration `20260812000200`）
- [x] W2 單一初始化流程 — PR #3，已部署
- [x] W3 單一 Agent 體驗 — PR #4，已部署（migration `20260812000300`＋16 支 Edge Functions）
- [x] W4 成員與正式模式 — PR #5，已部署（migration `20260812000400`）
- [ ] W5 一次一項架構債（本機收尾核對完成，待 commit／PR／部署）
- [ ] W6 最小真案驗收

**目前續接點：提交 W5。** W5-2～W5-4 的本機實作與統一收尾核對已完成；正式庫匿名 preflight、Vitest、build、E2E、全套 pgTAP、資料庫 lint 與 W5-2 rollback 演練均已通過。依 `DEVELOPMENT.md`，下一步須由使用者明確授權後才 commit／PR／部署；此前不要重做 W5 或開始 W6。

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
- [ ] **W5-2 C-001 單向 Requirement → obligation（D-012；本機完成，待 commit／PR／部署）**
  範圍：變更前先以正式庫唯讀 `count(*)` 精確分類 W5-1 的約 48 筆差額並把匿名統計附在 PR；移除 obligation → Requirement 的同步／刪除 trigger；將 approved deadline Requirement → obligation 的冪等轉換放進受控審查交易；停止 `Contract` 前端所有 `parse-contract` 呼叫，保留 Edge Function 檔案作相容／rollback。既有 obligation 原列沿用，不重建。
  欄位：Requirement 管契約內容與期限規則；obligation 只保留提醒 runtime。轉換可更新標題、階段、責任方與期限規則，但不得覆寫既有 `status`、`evidence_submittal_id`、`penalty` 或歷史連結。
  不做：不刪表、不批次刪歷史資料、不自動核定 AI 建議、不處理非 deadline 產物、不順手做 W5-3／W5-4。
  驗收：同一文件只觸發一次 Requirement 抽取；待審／駁回 Requirement 不產生 obligation；核定 deadline 恰好產生一筆，重試不重複；既有 65 筆 obligation 的執行狀態與佐證不變；Vitest、build、相關 E2E 與 pgTAP 全綠，附 migration rollback。
  本機證據（2026-08-12）：正式庫唯讀精確基線為 65 obligations／113 requirements／48 筆未連 obligation；48 筆全為未核定建議，orphan legacy = 0、approved deadline 缺 obligation = 0。519 Vitest、12 E2E、23 檔 715 pgTAP、build 及 rollback 重升演練全綠。未部署正式 migration。
- [ ] **W5-3 C-002 成員模型命名防誤用（本機完成，待 commit／PR／部署）**
  範圍：補 helper 註解與開發規則（`project_members`=授權、`project_memberships`=身分快照），高風險呼叫點加註。
  不做：不改名、不刪相容表、不動 RLS。
  驗收：兩套模型的用途在程式內有單一說明點可查。
  本機證據（2026-08-12）：唯一規則固定在 `architecture/three-party-role-model.md`；comment-only migration `20260812000600` 標註兩張表與 11 個 helper，高風險 Store／契約文件／提醒呼叫點已加註。519 Vitest、12 E2E、23 檔 720 pgTAP、build 與 DB lint 全綠；未改 RLS，未部署正式 migration。
- [ ] **W5-4 C-003 已漂移規則抽純函式（本機完成，待 commit／PR／部署）**
  範圍：只處理「已經發生 demo／DB 行為不一致」的規則，抽共用純函式＋測試釘住。
  不做：不全面重構雙引擎。
  驗收：列出處理了哪幾條規則，各附一個回歸測試。
  本機證據（2026-08-12）：盤點後只處理一條可重現漂移——試體不合格時 Demo 曾因 React updater 時序漏開缺失，重試又未依 `test_sample_id` 去重；正式 DB trigger 會同交易建立且冪等。已抽 `deriveTestSampleUpdate`／`shouldCreateTestSampleDefect`，並各有純函式測試及一條整合回歸。522 Vitest、12 E2E、23 檔 720 pgTAP、build 與 DB lint 全綠；未新增 migration，其他潛在同步點未重構。

W5 統一收尾核對（2026-08-12）：W5-1 決策與正式庫匿名基線、W5-2 單向 migration／rollback／pgTAP、W5-3 comment-only migration、W5-4 純函式與回歸測試均逐項符合上述範圍；沒有新增架構或擴大重構。工作樹尚未 commit、開 PR 或部署。

## W6｜最小真案驗收（不以 demo 通過代替真後端）

- [ ] **W6-1 真後端 E2E 基建**
  範圍：Playwright 第二個 project（真 Supabase staging；帳號／秘密由環境變數注入），本機手動跑，不進預設 CI。
  不做：不改既有 demo E2E、不建雲端常駐 staging（臨時開→測完刪，見成本紀律）。
  驗收：`npm run test:e2e:real` 能對真後端跑一條冒煙。
- [ ] **W6-2 鏈 1：註冊→登入→建案→邀請→正式模式**
- [ ] **W6-3 鏈 2：廠商提送→監造審核→機關核准／付款**
- [ ] **W6-4 鏈 3：文件上傳→Requirement 建議→人工核定**
- [ ] **W6-5 鏈 4：標單匯入失敗／重設失敗 rollback（真後端重演 W1 pgTAP 情境）**
  （W6-2～W6-5 驗收：各鏈在真後端綠；失敗畫面有明確錯誤）

---

## 未排入（已知、刻意不順手做；要做需回報告或另立決策）

- P1-08 路由治理（route registry 預設拒絕）
- P1-09 以外的 P2 全部（品牌統一、載入效能、列印、OCR 支援矩陣…見報告 §6.3）
- `(project_id, item_key)` 部分唯一索引（待正式資料盤點）
- pgTAP 進 CI（P2-08）
- 已核定估驗／檢查紀錄擋重設的 UX 磨光（guard 訊息措辭）
- agent-run 回答補出處連結（sources）——/assistant 唯一獨有的輸出格式，導向後暫以 steps 摘要代替
