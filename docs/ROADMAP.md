# GovAgent／PMIS 整理路線

> 狀態：**ACTIVE——唯一的續接依據**（兩份健檢報告的排程節已於 2026-09-11 併入本檔「健檢排程條目的歸宿」一節，報告本身只留證據與燈號；`CLAUDE.md` §0 只指路不另列清單。歷史工作包見下；09-08 契約兩批、09-11 Apple UIUX 四包與全案重構 19 個 commit 都已提交於 `refactor/product-wide`，未合併 `main`、未部署）
> 最後更新：2026-09-11（D2 文件整併波次。測試與規模數字一律見 [`BASELINE.md`](BASELINE.md)，本檔各包的「驗收證據」數字是當時證據不回改；正式環境未重核，最後核對紀錄見 CURRENT.md §6.3）
> 依《產品全案評估報告 2026-08-12》與已核准的 W8-0 第三版（方向已定案為 D-007～D-015）。
> 每個小任務一個 commit；每個工作包一個 PR。完成就把 `[ ]` 改 `[x]` 並填 PR 編號。

## 2026-09-11｜全案重構（使用者已核准；程式波次已提交、D2 文件波次本次、死碼清理波次另一 session 進行中；未合併 `main`、未部署）

問題：Apple 改版與契約整理兩條工作線併進後，前端累積碼債、後端錯誤遮罩與骨架不一致，文件數字與續接點失真。
目標：分四到八個波次收斂——前端碼債、後端錯誤遮罩與骨架收斂、文件事實校正、測試補強——每波獨立可驗證。
不做：不改產品邊界與權限、不動 RLS／migration、不新增功能、不合併 main、不部署；文件波次只改 `.md`，不碰 `src/`、`supabase/` 與設定檔。
影響：`src/`（前端碼債波）、`supabase/functions/`（錯誤遮罩波）、根目錄與 `docs/` 文件（本波）、既有測試。
驗收：①每波後 Vitest／Demo E2E／build 維持全綠；②文件數字與實測一致且未驗證項不升級為已驗證；③歷史報告內容不被竄改；④不新增未經核准的功能或抽象層；⑤波次之間互不回滾對方成果。

分支 `refactor/product-wide` 從 `ui/apple-foundation` 分出；起點 commit `d047437` 先把前一輪未提交的 09-08 契約兩批原樣保存，之後依序：

- [x] 波次 1 前端碼債：圖示字型退場留下的死碼與過期註解（`vite.config.js` 假警報外掛、孤兒 json、過期註解；順手補 `.gitignore`）— `b13f469`
- [x] 波次 1b pgTAP CI 不再寫死 DB 容器名（起 stack 後動態查，查不到印 `docker ps -a`）— `9c9a9bd`
- [x] 波次 3 文件事實校正與 D-021 補登（測試基線、E2E、rollbacks、AI 功能數、頁面數、路由數校正；W9 三份 handoff 標 `SUPERSEDED`；docs/README 補索引 11 份）— `08d9510`
- [x] 波次 2 三組「lib 已有正確實作、頁面各抄一份」收斂：台北日曆日 15 檔改吃 `dates.js`（非 UTC+8 瀏覽器下是真 bug）、新檔 `format.js` 金額格式（null→「—」）、`billableLeaves` 9 處併 5 處（另 4 處尺度不同刻意未併並註解）— `4d2489b`
- [x] 波次 B1 edge function 錯誤遮罩與骨架收斂：`_shared/publicError.ts` 唯一遮罩點、`errorLeak.scan.test.ts` 凍結前提、`aiHandler.ts`／`uuid.ts` 抽骨架（13 支縮到 38–47 行）、`agent-run` 改走 `openAiGate` 並加 message／facts 上限 — `bc2b2ea`
- [x] 波次 B4 `agentTools.ts` 1759→62 行拆 9 模組（純搬移，工具定義 esbuild dump sha 逐位元組相同）＋`raise_to` 補 `handoff_sent` 發起方留痕（紅線三）＋`agentToolWhitelist.scan.test.ts` — `eddcf18`
- [x] 波次 5 補測試缺口 +127 支（`exportCsv` 26、`documentIngestion` 22、`ledger` 24、`quality` 30、`documentFileAccess` 15、`useTodayTasks` 6；`supabaseMock` 收斂 8 支；每組做過變異檢查）— `02754bc`
- [x] 合規數字重查補記（RLS 51/51、pgTAP 實跑）與四項待決登記 — `1f2a43e`
- [x] 波次 4a 契約兩頁「清單＋詳情」殼收斂成一份（`useListDetailPane`／`useListKeyboardNav`／`listDetail.jsx`／`useContractEnrichment`；淨減 382 行；修 useMemo deps 與計時器外洩兩個真錯）— `8e0fb33`
- [x] 波次 6 列印頁 W9 遺留色票收斂到 token（`PrintToolbar` 共用、`.paper` 紙面配色集中、167 個內建調色盤 class 歸零；修深色模式紅字滲進白紙）— `b4d495f`
- [x] 波次 B5 `demo_requests` 表級收權、`contract.parse` 退場、pgTAP 補 6 檔（migrations `20260911100000`／`20260911100100`，**兩支都尚未套用正式庫**）— `d873b07`；待決補登 — `34cd011`
- [x] 架構文件四份（`ai-gate-and-metering`、`agent-tool-boundary`、`route-registry-governance`、`resumable-extraction`）＋第一份 ACTIVE 部署 runbook `operations/deploy.md` — `f170bee`
- [x] AI 閘門收掉潛在 fail-open 分支（`allowed` 非 `true` 一律擋→503，D-010）— `63ce2eb`
- [x] pgTAP 補 W13 併發保證的唯一索引覆蓋 8 條（含變異檢查）— `6f1ccb2`
- [x] 波次 4b `Contract.jsx` 1080→592（`loadPackageRuns` 純讀／`healStaleRuns` 分離、`reclassifyProcessingRun` 狀態機進 lib 並補 14 條測試）＋三頁 `text-[Npx]` 歸零 — `b7a1000`
- [x] 波次 7 `Quality` 813→272、`SiteLog` 961→696、`Valuation` 610→437（`ValuationRow` memo 實測改一格只重畫 4 列；`mapWithConcurrency` 取代手刻併發池；`dueText` 抄本收斂）— `47273ef`
- [x] 波次 B6 `extract-requirements/index.ts` 794→534 純搬移（`_shared/ingestionRun.ts`／`requirementPrompt.ts`／`requirementPersist.ts`＋10 條測試）— `c620fd5`
- [x] 架構文件最後三份（`error-masking`、`ball-in-court`、`document-processing-pipeline`）— `b68bece`
- [x] 波次 D2 文件整併與現況同步（本次，未 commit）：建 `BASELINE.md`；CURRENT §6 改現況快照、檔頭日期式補記併回；§6 逐包敘述搬入本檔；兩份健檢排程併入本檔並在報告加導讀；三份架構文件路徑對齊 B6；`dual-engine-sync` 補兩條差異；未排入補七項。
- [ ] 死碼清理波次（另一 session 同時進行，只動 `src/`）。

**狀態：全部已提交於 `refactor/product-wide`，未合併 `main`、未部署。** 驗證：Vitest／Demo E2E／pgTAP／production build 本機全綠（數字見 [`BASELINE.md`](BASELINE.md) §1、起點對照 §4）；**未跑真後端 E2E**（chain3 金鑰失效）、**未做 `deno check`**（本機無 deno，17 支 Edge Function 只過 esbuild bundle）、正式庫 migration tracker 與 Edge Function 線上版本未重核。合併前後必做：兩支 migration 先 `migration list --linked` 再套並把版本號寫回 CURRENT §6.3；B1／B4／B6 動了 `_shared/`，17 支 Edge Function 一併重佈；真後端 E2E 六條在有效金鑰下重跑。巨型檔前後對照見 BASELINE §4。

## 2026-09-11｜全產品 UIUX 改採 Apple style（已交付，D-021）

問題：W9 的 Google Workspace／Material 3 外觀與 PMIS 的定位不合，且全站累積 13 種任意字級、243 處 `text-[Npx]`，Material Symbols 自架字型是「Google 感」的最大來源。
目標：全產品（App 與行銷站）改 Apple style，落地點改收件匣，色票／字級／材質／圖示走同一份常駐規範。
不做：不動 `routeRegistry`、角色限制、RLS、資料庫與 Edge Function；不解封任何 `hidden` 工作面；不改圓角 class 名（e2e 綁死）；本輪不做三欄殼實作與行銷站套用。
影響：`src/index.css`、`src/components/ui.jsx`、`src/components/icons.jsx`、`src/components/Layout.jsx`、`src/lib/navConfig.js`、`src/pages/`（字級）、`e2e/` 三支、新增 `docs/UIUX-Apple-設計規範.md` 與 `UIUX/design_apple_style/`。
驗收：①色票亮暗雙軌且對比度實算過；②字級全站收斂到七階；③圖示零漏對映、271 個呼叫點零改動；④全路由無水平溢位、`aria-current` 唯一；⑤Vitest／Demo E2E／build 全綠。

- [x] 基礎層 token ＋ primitives ＋ 常駐規範 — commit `c848c59`
- [x] 球權來源進側欄、主畫面改收件匣 — commit `2d3068f`
- [x] 字級全站收斂到 Apple 階梯 — commit `7aa94e9`
- [x] 圖示換 lucide-react、subset 字型退場 — commit `8b87c9e`

**狀態：四包已提交於 `refactor/product-wide`，未合併 `main`、未部署。** 驗證：72 檔 818 Vitest、48 Demo E2E、production build 全綠；未跑 pgTAP（未動 DB 與權限）、未跑真後端 E2E。遺留：三欄殼實作、行銷站套用、登入頁依三欄殼重做、`Contract.jsx`／`Requirements.jsx`／`RequirementsReview.jsx` 共 78 處字級收尾（刻意留待契約線合併後另開一包）；`src/assets/material-symbols-names.json` 也待那條線合併後隨清理刪除。

## 2026-09-08｜契約自動整理可信度（使用者已核准開始優化）

問題：大量契約不適合人工逐條重讀；核對疑慮分散、主頁誤標、頁面漏讀會削弱自動整理可信度。
目標：保留 D-019 自動歸檔，讓使用者集中查看例外，並如實呈現文件處理完整性。
不做：不變更業務核定／三方權限，不新增逐條核准門檻，不宣稱尚未量測的準確率，不部署。
影響：extract-requirements、既有抽取與審核 helpers、契約重點／擷取審核頁、相關測試與文件；無 schema 變更。
驗收：①超過 1,000 頁讀取完整且失敗不回半份；②無文字頁／被丟棄輸出揭露；③核對狀態跨頁一致且缺值不當作通過；④可只看需留意項且保留全覽與深連結；⑤相關回歸與建置通過。

- [x] 文件完整性與核對例外修正、測試、現況同步。當日 72 檔／807 Vitest、42 Demo E2E、build 通過；**已由 commit `d047437` 提交於 `refactor/product-wide`，未合併 `main`、未部署**。詳見 [`契約自動整理品質優化-2026-09-08.md`](契約自動整理品質優化-2026-09-08.md)。

## 2026-09-08｜契約上傳到三方重點的完整體驗（使用者已核准）

問題：文件上傳、AI 處理與重點結果的入口斷裂，狀態與角色範圍不夠清楚，載入錯誤可能偽裝成空清單。
目標：同一條操作路徑完成上傳、自動整理、按契約查重點與依登入角色閱讀，桌面及手機都可用。
不做：不改 D-018／D-019 的可見性與自動確認決策，不新增角色、不部署、不加入未驗證的準確率或 OCR 承諾。
影響：專案文件、契約重點及共用流程提示，既有上傳結果 metadata、載入與跨頁更新、回歸測試及文件；優先沿用現有資料與 RLS。
驗收：①上傳入口與格式能力清楚且鍵盤可用；②進行中／部分完成／失敗各有真實狀態與下一步；③結果入口保留契約範圍且自動更新；④三角色與切換案件不混資料；⑤回歸、建置、桌面／手機檢查通過。

- [x] 完整流程與 UI/UX 修正、測試及文件同步；當日 73 檔／820 Vitest、48 Demo E2E、build 通過，另完成桌面／手機元件目視。**已由 commit `d047437` 提交於 `refactor/product-wide`，未合併 `main`、未部署**。詳見 [`契約整理流程-UIUX-2026-09-08.md`](契約整理流程-UIUX-2026-09-08.md)。

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
- [x] W6 最小真案驗收 — PR #7 已合併並部署；live Edge 成功路徑已於 2026-08-15 由 PR #20 環境修復後驗證通過
- [x] W7 路由治理 — PR #9，已部署
- [x] W8-0 UI/UX 全產品重新評估與整體改善計畫（第三版）— 使用者已核准
- [x] W8-1 全站框架、品牌與導覽 — PR #11
- [x] W8-1R 常駐階層側欄修正 — PR #14，已部署
- [x] W8-2 今日待辦與 Agent 分工 — PR #12（563 Vitest／19 Demo E2E／build 全綠）
- [x] W8-3A 初始化設定精靈 — PR #13（583 Vitest／19 Demo E2E／build 全綠；真實 staging 專案桌面／375px 目視通過）
- [x] W8-3B 契約重點與具體後續動作 — PR #15，已部署（587 Vitest／19 Demo E2E／build 全綠；真案三角色目視待補）
- [x] W8-4 三角色核心業務頁 — A（PR #16）／B（PR #18）／C（PR #17），已部署
- [x] W8-5 手機、無障礙、視覺一致性與真實使用者驗收 — PR #19，已部署（桌機輪真人驗收已於 2026-08-19 完成，手機輪暫緩）
- [x] W8-6 真人驗收修正包 — PR #21，已部署（D-016；migration `20260819111252`）
- [x] W8-7 照片先行 AI 日誌＋查驗↔自主檢查表縫合 — PR #22，已部署（migrations `20260819120000`／`20260819120100`）
- [x] CI Playwright Chromium 快取 — PR #23
- [x] W8-8 品牌字樣 — PR #24 改 PMIS；2026-08-25 隨 PR #52 改回 GovAgent
- [x] W9 Google Workspace 風格改版 — PR #25（主體）、#26（handoff 收尾）、#27（修正批）、#28（一致性統掃）
- [x] W10 契約期限追蹤鏈精修 — PR #29（migration `20260821000100`）
- [x] W11 文件管理員獨立＋期限追蹤併入契約重點 — PR #30
- [x] W12 登入頁改版與身分修復 — PR #31、#32（migration `20260821001000`）
- [x] 體檢 P1 修正批 — PR #33（migration `20260821000200`）、#34、#35（migration `20260822000200`）、#42（migrations `20260822010000`／`20260822010100`）
- [x] W13 大文件抽取可續跑 — PR #36（migration `20260822000100`）、#40、#41、#43
- [x] W14 文件治理四件套 — PR #37（migrations `20260822000300`／`20260822000400`）、#38、#39、#44（migration `20260822010200`）
- [x] 契約重點改版系列 — PR #45（`20260824000100`）、#46、#47、#48（`20260824000200`）、#49（D-018，`20260824000900`）、#50（收編 `20260824123253`）、#51（D-017，`20260824130000`）、#52、#53（D-019，`20260825000100`）、#54、#55
- [x] D-020 履約時程全型別＋開工日入口 — PR #56（`20260825120000`）、#57（D-020，`20260901040000`＋rollback）、#58
- [x] 09-08 契約兩批（自動整理可信度、上傳到三方重點完整體驗）— commit `d047437`；**已提交於 `refactor/product-wide`，未合併 `main`、未部署**
- [x] 全產品 UIUX 改採 Apple style — commits `c848c59`／`2d3068f`／`7aa94e9`／`8b87c9e`（D-021）；**已提交於 `refactor/product-wide`，未合併 `main`、未部署**
- [ ] 全案重構 — 程式波次 `b13f469`…`b68bece` 已提交、D2 文件波次本次、死碼清理波次進行中；**未合併未部署，migrations `20260911100000`／`20260911100100` 未套用正式庫**（逐 commit 見最上面的工作包格）

D-014 已依核准報告修訂：保留四步專案初始化設定精靈，第 3 步採「AI 整理完成」，不要求清空全部待審。全產品方向見 D-015。

W6 的 5 條本機真後端測試於 2026-08-13 重跑均綠，PR #7 已合併、main CI 與 Cloudflare 部署成功；W6-4 的 live Edge 成功路徑則於 2026-08-15 由 PR #20 的環境修復後補齊：同一次性 staging 上 5/5 全綠且 chain 3 為 live 模式（真呼叫 Anthropic API、`ai_usage_events` 有記帳列），W6 至此完整收官。細節見 `docs/REAL_BACKEND_E2E.md`。

---

## W1～W8-7 交付敘述（2026-09-11 自 CURRENT.md §6 搬入）

以下各段原為 CURRENT.md §6 的逐包敘述，D2 波次逐字搬到本檔（只改了末段指向 §6.2 的一句，以及三個原以 repo 根目錄為基準的相對連結路徑）；當時的測試數字是當時證據，不回改。現況以 CURRENT.md §6 為準；各包的五行規格與驗收證據仍在下方 W2～W8 各節。

標單重設與匯入自 W1 起走單一交易 RPC（`reset_project_boq`／`import_work_items`，migration `20260812000200`）：全成或全敗，權限沿用 `can_write`，證據 guard 擋下時整包 rollback 並留 `audit_events`；前端不再逐表刪除或分批寫入。

初始化自 W2 起只有一條路（D-007）：建案 → 專案文件一次上傳 → 三方成員 → 正式模式。Dashboard 對未開正式模式的真專案顯示四步初始化清單（狀態由既有資料推導）；`/agent` 不再因未匯標單整頁封鎖，僅提示工項類問題需先匯入；所有「無標單」空狀態統一指向專案文件。

AI 入口自 W3 起收斂為單一 Agent（D-008、D-010）：`/assistant` 導向 `/agent`，浮動 Copilot 是同一 Agent 的明示新對話入口；前端不再呼叫 `assistant.chat`，但功能列、Edge Function 與歷史用量保留。所有 AI 功能閘門查詢失敗時 fail-closed；403／503 錯誤會在 UI 如實顯示並可重試，不會偽裝成離線快答。

成員與正式模式自 W4 起採三方確認流程（D-009）：成員頁明確區分載入中、空名單、載入失敗與正常名單；邀請方必須指定廠商／監造／機關，伺服器會與受邀帳號的註冊身分比對，錯配即拒絕。開啟正式模式前會列出缺少哪一方並要求二次確認；三方未到齊仍可由專案建立者決定是否開啟。

W5-2 的正式庫變更前唯讀基線：65 筆 obligation、113 筆 Requirement，差額 48 筆全是未核定建議（24 筆 `draft_ai/ai`、23 筆 `needs_review/ai`、1 筆 `needs_review/manual`）；0 筆 orphan legacy，0 筆已核准 deadline 缺 obligation。65 筆 obligation 全為待辦、0 筆有佐證、21 筆有罰則，且 65 筆都有唯一 Requirement 連結。盤點只讀匿名數量，未匯出業務內容。

W5-3 已把雙成員模型的防誤用規則固定：[`docs/architecture/three-party-role-model.md`](architecture/three-party-role-model.md#成員模型的唯一判斷規則) 是唯一說明點；已部署的 migration `20260812000600` 只替兩張表與 helper 加 schema comment，關鍵前端／提醒呼叫點也有短註解。沒有改名、刪表或變更 RLS。

W5-4 只修正一條可重現的 Demo／DB 漂移：同一組 28 天試體判定不合格時，正式 DB 會在同一交易建立並以 `test_sample_id` 去重缺失，但 Demo 曾因 React state updater 時序漏開缺失，重試時又可能重複開。現在 Demo 以 `deriveTestSampleUpdate` 同步推導判定，並以 `shouldCreateTestSampleDefect` 保持一組試體一筆缺失；其他尚未發生漂移的雙引擎規則沒有重構。

W6 PR #7 已合併並部署，5 條本機真後端測試於 2026-08-13 重跑全綠：`npm run test:e2e:real`（環境變數注入、拒絕正式 Supabase、不進預設 CI）對一次性本機 staging 跑 auth 冒煙、鏈 1 初始化（含邀請錯配拒絕與正式模式）、鏈 2 估驗三方簽核與請款收款、鏈 3 文件上傳＋綁定真文件版本的人工待審 Requirement→核定→D-012 義務物化、鏈 4 匯入/重設 rollback（含 UI 錯誤橫幅與「日誌不半刪」）。fixture 走產品窄門 RPC，清理含 Storage 物件，跑後殘留 0。

W6-4 已於 2026-08-15 收官：先前的「CLI boot error」查明為誤診，真因是 colima 未掛載 repo 所在的外接 SSD（連同本機 service_role 權限、pro 方案閘門與 W8 UI 漂移一併修復，已由 PR #20 合併）。同日本機一次性 staging 上全套 5/5 通過且鏈 3 為 live 模式——`extract-requirements` 真呼叫 Anthropic API、`document_ingestion_runs` completed、AI-origin 固定期限 Requirement 與經正規化比對的契約原文 citation，監造核定後 D-012 義務物化；`ai_usage_events` 留有 `requirements.extract`、token 非 0、`status='ok'` 的記帳列。細節見 `docs/REAL_BACKEND_E2E.md`。

W7 已由 PR #9 部署並依 D-013 收口前端路由：`src/lib/navConfig.js` 的 `routeRegistry` 明確登記全部 36 條 App 路由，未登記業務路由 fail-closed；登入、公開、重新導向、列印與 404 各自標註。`src/App.jsx` 由這份路由表統一決定共同守衛與版面，四條列印路由現在也會先驗證登入與專案狀態，但仍保留無工作台外框的列印版面。既有三方頁面權限、導覽、RLS 與資料庫均未改動。

W8-1 由 PR #11 完成：主品牌統一為 `GovAgent｜公共工程`；側欄固定為今日待辦、現場與品質、審查與協作、進度與金流、文件與結案、專案六個工作面；`問 GovAgent` 是頁首全域入口；機關仍落在跨案總覽。36 條路由與原角色限制不變。2026-08-14 使用者核准 W8-0 第三版後，W8-1R 由 PR #14 完成並部署：桌面側欄預設常駐展開、可收合成圖示列並記住同一瀏覽器偏好；工作面的子頁選單預設收合，包含目前所在工作面也可自由展開與再次收合；手機抽屜使用同一階層；內容區原 `WorkbenchTabs` 與手機子頁下拉已移除。側欄視覺採 Codex 式安靜層級：工作面用圖示與較強文字，子頁縮排；目前頁與 hover 使用完整中性圓角底，不再使用藍色左線與子頁分隔線。`navConfig.js` 仍是導覽與路由守衛的單一真相來源，36 條路由、角色限制、RLS、資料庫與業務頁均未改。

W8-2 由 PR #12 交付：今日待辦的聚合收斂為單一純函式 [`src/lib/todayTasks.js`](../src/lib/todayTasks.js)，`/dashboard` 與 `/alerts` 吃同一份，`/agent` 不再重複待辦清單（只留無件數的「前往今日待辦」連結）。`/dashboard` 改為「現在輪到我／等待對方／今天已完成」三段，每段最多 5 筆、溢位連 `/alerts`；統計帶、球權統計與未結案缺失卡移除，AI 主動觀察降為一行風險摘要。待辦一律由既有業務狀態推導：協作項沿用 `ballInCourt.js`（新增共用的 `collaborationItems()`），期限型沿用 `contractDue`／`qc`／`acceptance`／`itp` 既有引擎，`Alerts.jsx` 內嵌的第二套規則已刪除。

W8-2 的三條硬規則寫在函式與測試裡：AI 草稿與未核定 Requirement 不是 `buildTodayTasks` 的輸入，結構上進不了待辦；契約義務只接受 `廠商／監造／機關` 三個精確 `responsible` 值，且只有廠商責任者列為待辦（`/contract` 的完成鈕吃 `can.edit`，監造／機關按不到，不製造做不到的假待辦）；「今天已完成」只採可靠操作時間戳 `defects.closed_at` 與 `inspections.inspected_at`（依 `Asia/Taipei` 判日），可回填的業務日期與沒有完成時間欄位的估驗核定／變更核准一律不列。驗收階段的角色白名單移到 [`src/lib/acceptance.js`](../src/lib/acceptance.js) 的 `ACCEPTANCE_STAGE_ORGS`，驗收頁與待辦聚合共用。

W8-2 未動路由數、頁面權限、RLS、資料庫與 Edge Function。同批修正三個既有缺陷：估驗「待廠商請款」導向改為 `/payments`（請款日欄位在該頁）、`recordInspectionResult` 的 demo 分支補寫 `inspected_at`（原本只有 DB 分支寫，造成雙引擎漂移）、`computeObligationDue` 新增可注入的 `today`（每月重複義務不再讀系統時鐘）；期限判斷一律先正規化為台北日曆日午夜，避免傍晚開頁時第 8 天被誤列進「7 日內」。本機基線為 563 Vitest、19 Demo E2E 與 production build 全綠。初始化第 3 步語意與契約重點改版仍屬 W8-3，不得寫成已完成。

W8-3A 由 PR #13 交付：未開正式模式的真專案仍保留一張四步初始化卡片；每步顯示責任方、完成狀態與單一目的地，卡片另顯示完成數與唯一下一步。第 3 步只以本案是否存在 `status = 'completed'` 的 `document_ingestion_runs` 判定 AI 是否整理完成，不再讀 Requirement 待審／核定數；即使仍有 106 筆待審或擷取結果為 0 筆也算完成。完成但 0 筆時 `/requirements` 會顯示「沒有找到建議」的有效空結果，不會把使用者導回重新上傳；人工核定只決定內容是否成為契約規則，不是開啟正式模式的門檻。第 4 步維持可由專案建立者直接前往 `/members` 開啟，前三步或三方未齊只提供提醒，不會鎖住按鈕。

W8-3A 驗證（2026-08-14）：60 個 Vitest 檔、583 個測試與 19 個 Demo E2E 全綠，production build 與 PR CI 成功，`git diff --check` clean；沒有變更路由、角色、RLS、資料庫、migration、Edge Function 或 Store slice。另以既有 staging 測試帳號建立未開正式模式的真實專案，完成 Dashboard 初始化卡片桌面與 375px 目視，以及 `/contract`、`/requirements`、`/members` 三個銜接頁的 375px 無水平溢位驗收；臨時專案已刪除。

W8-1R 驗證（2026-08-14）：60 個 Vitest 檔、576 個測試與 19 個 Demo E2E 全綠，production build 成功，`git diff --check` clean。測試數由 main 的 583 降為 576，是因移除 7 個只驗證已刪除 `workbenchFor()`／`WorkbenchTabs` 的過時測試；桌面側欄展開／收合／偏好保留、工作面子頁預設收合且目前工作面也可再次收合，以及 375px 同源抽屜均由 `e2e/routes.spec.js` 驗證。PR #14 的 main CI 與 Cloudflare Workers build 成功，正式站 bundle 已確認包含 `pmis-sidebar-collapsed` 與側欄展開／收合程式碼。

W8-3B 由 PR #15 交付並部署：`/requirements` 一般畫面改為「已生效的契約重點」、最多 6 筆「值得留意的整理結果」與可收合完整追溯；舊 run 的 approved 在 300 筆有界查詢內仍保留，舊 run 未核定 AI 建議只在追溯區顯示。預設去重只合併呈現內容完全相同的列，不改 DB；只有可追蹤 deadline 能透過原 `review_requirement` 捷徑「核定並加入期限追蹤」並由 D-012 物化 obligation，其他類型不假裝建立尚不存在的工作流。收合追溯時同時關閉歷史詳情，rejected／superseded 不殘留在一般畫面。側欄分頁標籤同步改為「契約重點」。手機磨光依規格 §11 完成：375px 動作鈕與六個追溯篩選至少 44px（`max-sm:min-h-11`，桌面與共用 `ui.jsx` 不動）、廠商唯一查看動作補中性邊框、無核定權提示改淡底提示列。587 Vitest、19 Demo E2E、production build 全綠；main CI 與 Cloudflare Workers build 成功，正式站冒煙 200。**真案三角色桌面／375px 實機目視尚未執行**（無可用帳號），不得寫成已完成，列為 W8-5 前待補。

W8-4A 由 PR #16、W8-4B 由 PR #18、W8-4C 由 PR #17 交付並部署：/quality 首屏改「現在要處理」工作佇列＋五段分段控制，佇列只來自既有球權與試體齡期引擎，判不合格後原地回饋並可一鍵切到缺失分段；/site-log 手機存檔列貼底（唯讀分支未動）。/portfolio 新增跨案例外數字帶；/payments 手機改唯讀期別時間線（桌面表格與登錄欄位不變）；/change-orders 待核定群排前、已定案明細收合。W8-4B 補上監造視角：/valuation 首屏決策列（狀態＋BallChip 責任方＋「超計 N 項／無佐證 M 項」確定性差異彙總，動作按鈕整段搬移非複製、`e2e-real` 四檔零改動）；監造／機關日誌改摘要式唯讀檢視（假可編欄位歸零，廠商視角 DOM 零改動）；/submittals 依 `submittalBall` 分「待我處理／等待對方／已完成」。三包均未改 store 寫入、金額／期限確定性計算、權限條件、RLS 與路由；最新基線 607 Vitest、22 Demo E2E、build 全綠，各包合併後 main CI、Cloudflare build 與正式站冒煙均成功。

W8-5 由 PR #19 交付並部署，W8（W8-1～W8-5）全數完成：手機觸控目標由共用元件一點式解決（`max-sm:min-h-11`，桌機不變；表格內行內輸入為 38px 已知例外）；全站鍵盤焦點可見（`@layer base` 的 `:focus-visible` outline）；修復三個鍵盤陷阱（關閉的抽屜可被 Tab 進入、對話框焦點外流後 Esc 失效、專案切換器同款）與手機照片刪除鈕永不可點的 bug；icon-only 控件補可及名稱、狀態色點補文字語意；`--text-3` 調至 AA 對比（亮 `#636f7b`／深 `#8b97a4`）。

真人驗收（桌機輪）於 2026-08-19 由使用者本人單人自測完成並回填 `docs/W8-5-三角色真實使用者驗收清單-2026-08-15.md` §八（手機輪暫緩）；26 項發現經 11 組唯讀讀碼 triage（P0 交叉驗證）後由 **W8-6（PR #21）交付並部署**：變更設計核定收斂為機關專屬（migration `20260819111252` 重寫 `change_orders_guard`：核准/駁回含撤銷僅機關、核准必經審核中、提出↔審核中＝監造/機關；新 pgTAP `change_order_approval.sql` 13 項角色×轉移矩陣，決策 D-016）；施工日誌 dirty 防護修掉「帶入天氣清空表單」P0 資料遺失、複製昨日補種工項列骨架、公定格式欄位預設展開、唯讀分支預設紙本公定格式（抽 `SiteLogOfficialSheet` 共用，列印頁輸出不變）；請款收款「已收款」需收款日＋實收皆登錄且統計卡只計已核定期別（`src/lib/payments.js` 純函式）；「AI 估驗草擬」正名「帶入日誌累計」（該按鈕本為純確定性引擎，對齊紅線二敘事）；今日待辦補「今天的施工日誌尚未填寫」（開工錨點或既有日誌防誤報，W8-2A 文件同步翻案）；品質缺失手動開立收斂為監造（工安不變、RLS 不動）；另含查驗申請日必填預設今日、查驗履歷篩選、桌機側欄 `md:z-30` 修專案下拉被蓋、驗收期限紅/琥珀分級、佐證包空狀態與非正式計價單常駐警語、建案表單必填＊與「預計開工日」語意、契約基準日補竣工日、標單匯入進度回饋、成員邀請列對齊。基線：64 檔 627 Vitest、30 Demo E2E、production build 全綠；PR 與 main 的 CI＋pgTAP 全綠，migration 已套用至正式庫（remote `20260819111252`），Cloudflare 部署與正式站冒煙成功。驗收中點名但 W8-6 未做的大功能列於 ROADMAP 未排入清單待另立案。

**W8-7（PR #22）交付並部署**：照片先行→AI 填日誌——未存檔即可批次「選照片 AI 辨識後上傳」，確認上傳時自動 upsert 建空白草稿日誌再掛照片（人觸發，紅線一不破）；辨識結果只回填表單（配到的工項自動加列、數量留空，caption 彙整成「AI 草稿:」摘要僅空時預填），落庫仍由人按存檔，與 W8-6 dirty 防護相容。`photos.location`（migration `20260819120000`）＋ classify-site-photo schema/prompt 結構化白板施作區域（只准照抄、嚴禁推測、辨識不到=null、required 保證鍵存在），覆核區可清除 chip、佐證包照片說明前綴區域（`photoEvidenceLine`）。查驗↔自主檢查表縫合：`inspections.checklist_record_id` FK（migration `20260819120100`，on delete set null；pgTAP `inspection_checklist_link.sql` plan 11）；查驗申請可檢附已判定現行版檢查紀錄並在查驗列顯示 chip；檢查表分段對自檢合格的紀錄提供「提出查驗申請」一鍵預填（工項／項目／位置／檢附／申請日，送出仍由人），整鏈任一版已被檢附則顯示「已附查驗」不再給入口。基線：65 檔 640 Vitest、30 Demo E2E、build 全綠；PR 與 main CI＋pgTAP 全綠；兩支 migration 先於前端套用正式庫（remote `20260819120100`），classify-site-photo 以 `--use-api` 重新部署。仍未做：機關模板估驗計價單套版、進度網圖驅動提醒、查驗單正式列印格式（見 ROADMAP 未排入）。

> 以上 W8-1～W8-7 段落中關於側欄六工作面、`/requirements` 畫面、「核定生效」語意與品牌字樣的描述，已被 2026-08-20 之後的改版取代；現況以 CURRENT.md §6 為準，舊段落保留作為決策脈絡。

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
- [x] **W6-4 鏈 3：文件上傳→Requirement 建議→人工核定**
  已通過部分（2026-08-13）：`e2e-real/chain3-requirements.spec.js` 上傳契約 txt（Storage＋documents＋document_versions），並在真文件版本建立後插入帶 document source 的人工待審 Requirement；廠商看得到但無核定鈕，監造經 `review_requirement` 核定後，D-012 義務物化出現同標題與固定到期日。清理含 Storage 物件，殘留 0。
  已完成（2026-08-15，環境修復由 PR #20 合併）：原「CLI boot error」已查明為誤診——真因是 colima 未掛載 repo 所在外接 SSD，掛載修正後原版 CLI 即可服務全部函式；另修正三個會擋在模型前的問題（本機 service_role 無表級權限→`supabase/seed.sql` 對齊 hosted 預設、chain3 未過 `min_plan='pro'` 閘門→bootstrap 平台管理員升級方案、W8 改版造成的 chain3/auth-smoke locator 漂移）。
  live 驗收證據：同日本機一次性 staging 上真後端 E2E 全套 5/5 通過**且 chain 3 為 live 模式**——上傳契約 txt → `extract-requirements` 真呼叫 Anthropic API → `document_ingestion_runs` completed → AI-origin deadline Requirement（trigger fixed、fixed_date 2026-10-31）→ citation 以 `sourceVerify` 同義正規化驗證為契約原文 → 廠商無核定鈕 → 監造以「核定並加入期限追蹤」（`review_requirement` RPC）核定 → D-012 物化 obligation 於 `/contract` 顯示同標題與 2026-10-31。硬證據為 `ai_usage_events` 內 `feature_key='requirements.extract'`、`model='claude-sonnet-5'`、input/output token 非 0（如 2382/575）、`cost_usd` 有值、`status='ok'` 的記帳列。模型行為記錄：帶期限的「品質計畫送審」條款被模型歸類為 submittal（合理分類），因此 live 斷言錨定在無歧義的純期限條款（工程期限 2026-10-31）。staging 殘留 0（僅冒煙帳號）。細節見 `docs/REAL_BACKEND_E2E.md` Live Edge 驗收。
- [x] **W6-5 鏈 4：標單匯入失敗／重設失敗 rollback（真後端重演 W1 pgTAP 情境）**
  本機證據（2026-08-13）：`e2e-real/chain4-boq-rollback.spec.js` 通過——缺父項匯入整包拒收（全敗如未匯）、重試成功、重複匯入被擋；品質檢查紀錄連工項時 UI 清空重匯被 guard 擋下並顯示「清空未執行，所有資料維持原狀」紅色橫幅，標單與日誌原封不動（舊版災難點：日誌被靜默刪光）；移除品質證據後重試清空成功、回到 onboarding。
  （W6-2、W6-3、W6-5 已達成；W6-4 的 RLS／Storage／審查／物化與 live Edge 成功路徑均已於 2026-08-15 驗證通過。）

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
- [x] **W8-4B 監造核心頁（PR #18，已部署）**
  範圍：/valuation 在 Stat 與明細之間插入本期決策列（狀態 Badge＋BallChip 責任方＋`summarizeValuationDiff` 差異彙總「超計 N 項／無佐證 M 項」可點展開；既有送審／核定／退回／刪除按鈕整段搬移非複製）；監造／機關日誌改摘要式唯讀（純文字天氣／摘要／工項、公定格式只列有資料的節，假可編欄位歸零；`can.edit` 視角 DOM 零改動）；/submittals 依 `submittalBall` 分「待我處理／等待對方／已完成」三群。
  驗收證據（2026-08-15）：607 Vitest（+12 `Valuation.diff.test.js` 等）、22 Demo E2E（+2 送審分群；監造唯讀測試改寫）、build 全綠；`e2e-real/` 四檔零改動（chain2 按鈕名嚴格單一命中逐項核對）；對抗式紅線審查 PASS；合併後 main CI、Cloudflare build 與正式站冒煙成功。查驗與缺失複查已由 W8-4A 分段涵蓋。

- [x] **W8-5 手機、無障礙與真實使用者驗收（PR #19，已部署）**
  範圍：共用元件一點式觸控目標（`BTN_SIZES`／`FIELD_BASE` 加 `max-sm:min-h-11`，桌機不變）；`@layer base` 全域 `:focus-visible` outline 與 Button 焦點改 outline 方案；三個鍵盤陷阱修復（手機抽屜關閉時 `max-md:invisible`＋Esc＋焦點進出、appConfirm/appPrompt window 層 Esc＋focus trap＋焦點還原、ProjectSwitcher 同款）；icon-only 鈕 aria-label／照片 alt／`aria-expanded`／狀態色點補文字語意；`--text-3` 亮 `#636f7b`／深 `#8b97a4` 過 AA；重要說明 truncate 改 line-clamp＋title；修手機照片刪除鈕 `opacity-0` hover-only 永不可點的 bug。表格內行內輸入依 W8-0「不重寫表格」明文例外只提到 38px（`max-sm:py-2`）＋`inputMode`。
  驗收證據（2026-08-15）：607 Vitest（63 檔）、30 Demo E2E（22 基線＋8 條新 `e2e/a11y.spec.js`：三角色 375px 全路由無溢位掃描、44px 抽查、抽屜／對話框 Esc 鍵盤合約）、build 全綠；e2e 凍結契約逐項核對；合併後 main CI、Cloudflare build 成功，正式站冒煙 200 且部署 CSS 實測含 `:focus-visible` 規則與新 token。抽屜開啟聚焦曾因 `visibility` transition 在 CI 慢機 frame 節奏下不可聚焦而紅，改有界重試（25ms×20）後綠。
  尚未完成：`docs/W8-5-三角色真實使用者驗收清單-2026-08-15.md` 為 DRAFT——「三角色測試者能理解下一步且完成任務」必須由真人依清單執行後回填，AI 不得代測；W8-3B 遺留的真案三角色實機目視同樣待真人執行。

## W9～W14 與精修期系列（2026-08-20～09-01，全數合併部署）

這一段是 2026-09-02 依 PR 描述回填的紀錄，不是預先核准的規格；各包的「為什麼／改了什麼／驗證」以 PR 描述為準；原 CURRENT.md §6.2 的交付敘述已於 2026-09-11 逐包併入下方各條（「交付內容」段），現況以 CURRENT.md §6 為準。自 W9 起工作包由使用者逐項裁示啟動，沒有事前寫進本檔。

- [x] **CI Playwright Chromium 快取與品牌字樣（PR #23／#24）**
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：CI 以 lockfile 的 Playwright 版號快取 Chromium，CDN 劣化不再撞 timeout。品牌字樣改 PMIS 後於 08-25 改回 GovAgent（見 CURRENT.md §1）；網址與 repo 名不變。
- [x] **W9 Google Workspace 風格改版（PR #25／#26／#27／#28）**
  範圍：依 `UIUX/design_handoff_pmis_google_ui` 純視覺與互動層換殼；字型與圖示 self-host 零 CDN；底部導覽／icon rail／完整側欄三斷點；side badge 與表格排序篩選分頁共用元件；P0 手機存檔列被 BottomNav 蓋住修正；觸控目標斷點 `max-sm`→`max-md`；一致性統掃約 160 項。
  不做：`routeRegistry`、roles、slices、RPC、RLS、既有測試一字未改。
  驗收證據：631 Vitest、33 Demo E2E、build 全綠；e2e-real chain1／2／4 live 通過、chain3 deterministic 模式（live 金鑰已撤銷）。
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：純視覺與互動層換殼——token 換值不換名、Noto Sans TC 與 Material Symbols 全面 self-host（零 CDN，CSP `font-src 'self' data:`）、lucide 退場；App bar 搜尋藥丸鈕導 `/agent` 代問；<768 底部導覽、768–1279 icon rail、≥1280 完整側欄；M3 深色全表。W9b 補側欄件數 badge（`useTodayTasks` 為聚合唯一入口，Layout 與 Dashboard 同一份）、`SortableTh`／`FilterChip`／`TablePager`＋`useTable.js`、「AI 今日已代辦」純統計卡、信賴度門檻上色。W9 修正批修掉 P0「手機存檔列被 BottomNav 蓋住」（`--bottom-nav-h`）、71 處觸控目標 `max-sm`→`max-md` 對齊手機層定義、對比 token 過 AA、圖示字型 subset 103KB→15KB。W9c 依統一規範修約 160 項：CHIP／FilterChip 為唯一切換語言、`TaskRow` 待辦列單一渲染、按鈕三級制、表格與輸入回共用元件。四包均未動 `routeRegistry`、roles、slices、RPC、RLS。
- [x] **W10 契約期限追蹤鏈精修（PR #29）**
  範圍：抽取強韌化（`stop_reason`、逾時、退避、分批、涵蓋率、run 卡死補償）；監造可上傳契約與勾已提送；`projects.contract_total`；手動新增契約重點；`/contract/print` 對照表。
  驗收證據：639 Vitest、33 Demo E2E、build 綠；e2e-real 待部署後重跑。
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：`_shared/claude.ts` 補 `stop_reason` 檢查（max_tokens 視為失敗）、單次 120s 逾時與 429／5xx 指數退避；`extract-requirements` 分批抽取、逐批落庫、涵蓋率（truncated／stopped_early／clipped／failed_batch）進 metadata、`PROMPT_VERSION` v2；啟動時自動標記逾時 run 失敗，同版本進行中 run 擋重複啟動。監造可上傳契約與勾已提送；`projects.contract_total` 手填契約總價（migration `20260821000100`），罰款試算優先吃手填；手動新增契約重點（manual→needs_review→核定→物化，零 schema 變更）。命名收斂：上游「契約重點」、下游「契約義務」。
- [x] **W11 文件管理員獨立（PR #30）**
  範圍：側欄「專案文件」獨立；`/contract` 依 mockup 重建；期限追蹤併入 `/requirements`。無 DB 變更。
  驗收證據：639 Vitest、33 Demo E2E、build 綠；35 agents 審查 29 項全數處理。
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：側欄「專案文件」抽出為獨立項；`/contract` 依 mockup 重建為上傳＋回饋面板與文件清單（AI 處理四狀態），上傳後自動分類自動歸檔分流；期限追蹤整組併入 `/requirements`，「契約義務」一詞自 UI 退場（PR #46 再拆出 `/deadlines`）。35 agents 審查 29 項全數處理：重試條件收窄回「AI 分析失敗」、needs_review 誠實顯示待確認。無 DB 變更。
- [x] **W12 登入頁改版與身分修復（PR #31／#32）**
  範圍：登入／建立帳戶頁依 mockup 重建、去 SSO、真保持登入；`ensure_project_identity_for` 修復分支＋一次性資料修復。
  驗收證據：639 Vitest、33 Demo E2E、build 綠。
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：登入／建立帳戶頁依 mockup 重建，GSN SSO 移除，「保持登入」為真機制（sessionStorage ephemeral session）；註冊角色卡改 radiogroup＋roving tabindex；e2e-real 選擇器同步。`ensure_project_identity_for` 補「掛在 other 的舊 membership 依 `profiles.org_type` 重掛」修復分支＋一次性資料修復（migration `20260821001000`），前端不再謊稱「稍候幾秒」。
- [x] **體檢 P1 修正批（PR #33／#34／#35／#42）**
  範圍：依 2026-08-21 上線前全案體檢篩出的 P1×S 與 P1×M 項目；含 `requirements.extract` 開放所有方案、RFI 兩步繞過修補、台北時區、photos 凍結防護、`profiles` select 收斂、`friendlyError` 全站收斂、照片壓縮與 EXIF。
  不做（有理由，列入未排入）：AI 成本硬上限、帳戶鎖定、契約脊椎 IA 重整、App bar 真搜尋、字型首屏下載。
  驗收證據：747 Vitest、39 Demo E2E、build 綠；pgTAP 本機 767／767；**PR #42 兩支 migration 必須先部署前端再 db push**。
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：`requirements.extract` 開放所有方案（migration `20260821000200`；上傳鏈核心不做方案差異化，差異化留給草稿／審查類）。監造／機關預設落地 `/portfolio`（`navConfig.defaultLandingPath()`，後被 PR #54 精修期改為一律今日待辦）；`public/theme-boot.js` 首繪前套主題（CSP `script-src 'self'` 不允 inline）；`review-submittal`／`audit-summary` 升 Sonnet；`usePagination` 穩定簽章不再被輪詢踢回第 1 頁；查驗不合格自動開缺失的 insert 錯誤不再被吞；Schedule／RiskAudit 勾稽改吃核准變更後數量；機關端補 `/audit` 入口。RFI 兩步繞過修補（migration `20260822000200`：離開已回覆／已結案僅監造可執行、待回覆刪除加驗 `answer is null`；pgTAP `rfi_flow.sql` 20 斷言，紅綠對照證明漏洞可重現）。業務日期「今天」統一台北時區（`src/lib/dates.js`，系統時戳維持 UTC）；photos 凍結防護（migration `20260822010000`：已核定估驗涵蓋或契約重點連結的照片擋刪擋洗欄位，pgTAP 41）與 `profiles` select 收斂為自己＋共案成員＋平台管理員、逐欄授權（migration `20260822010100`，pgTAP 19；**部署順序必須先前端後 db push**，舊前端 `select('*')` 會撞 42501）；`friendlyError` 收斂 22 頁約 110 處 raw `error.message`，`errorLeak.scan.test.js` 掃描式防回歸；照片上傳壓縮（長邊 2000px）＋零依賴 EXIF 回填 taken_at／GPS；10 頁 16 個空狀態補 PageHeader；手機語意斷點 640→768。體檢誤報（已由 W10／W11 修）與刻意跳過項列於 ROADMAP 未排入。
- [x] **W13 大文件抽取可續跑（PR #36／#40／#41／#43）**
  範圍：跨 request 續跑、批次縮小對齊 API 閘道 150s、active run 唯一索引、409 語意分流、進度心跳、對半切與子批進度持久化。
  驗收證據：668～670 Vitest、build 綠；#40／#41／#43 函式先行部署止血。
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：69 頁契約單批必逾時被平台砍成殭屍 run 的死路，改為跨 request 續跑——批次 14k 字元（上限 24 批）、單 request 絕對上限 140s 對齊 Supabase API 閘道 150s 真實天花板、進度與計數快照落庫、`awaiting_continue` 由前端共用接力層帶 `continue_run_id` 續跑；partial unique index 保證同版本最多一條 active run（migration `20260822000100`，23505→409，`run_conflict`／`restart_required` 分流）；stale 判定吃進度心跳（`last_progress_at`）；每個 request 各記一筆 `ai_usage_events`；對半切深度與子批完成 label 持久化（`pending_split_batch`／`pending_split_depth`／`pending_split_done`），修掉兩層活鎖。撤掉重新解析前的建議清理（會誤刪人工編修）；前端 502／504 特判為「進度已保留，稍後重試接續」。
- [x] **W14 文件治理四件套（PR #37／#38／#39／#44）**
  範圍：AI 文件分類（`classify-document`，四紅線齊備）、事後改分類、`delete_document` 守門刪除（pgTAP 20 案）、300MB 上限；上傳面板誠實化；跨部署 run 計數一次性修正。
  驗收證據：668 Vitest、build 綠；兩輪對抗式審查 13 項缺陷全修。
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：確定性分類器沒把握時問 `classify-document`（Haiku），信心 ≥0.8 自動歸檔並照常路由抽取（四紅線齊備：伺服器閘門＋計量＋雙註冊表＋migration `20260822000400`，`documents.classify` min_plan=trial；值域單一真相 `_shared/documentTypes.ts`）；任何終態文件可事後改分類（改成可抽取類型先警告會重跑）；`delete_document` RPC 為唯一刪除路徑（migration `20260822000300`；`documents` 不開 RLS DELETE、`requirement_sources` FK RESTRICT 護佐證鏈、未審 AI 建議隨文件走、`document.deleted` 留痕、storage 只准清孤兒檔；pgTAP `document_delete.sql` 20 案）；300MB 前端預檢與 Storage 超限特判。上傳面板誠實化：總數選檔即定錨、「正在解析標單 XML」只在 boqBusy 出現、可切到其他頁處理不中斷。一次性修正跨部署 run 的顯示計數（migration `20260822010200`）。
- [x] **契約重點改版系列（PR #45～#55）**
  範圍：看上傳的檔案＋讀取留痕（#45）；`/requirements` 條文檢索頁＋`/deadlines` 獨立（#46／#47）；頻率值域擴充（#48）；契約分級補完 D-018（#49）；收編 `demo_requests`（#50）；D-017 確認轉錄語意＋確定性分流（#51）；時效性條文一覽＋對照報告退場（#52）；D-019 全自動確認（#53）；精修期最小表面（#54）；履約時程三方共用檢視頁（#55）。
  驗收證據：739～763 Vitest、39～41 Demo E2E、e2e-real 6／6、pgTAP 全套零失敗（#48 記 864、#51 起 triage 套件）；#48 記錄 migration 已套用正式庫並重佈三支 Edge Function。
  遺留（PR #55 已知後端缺口）：依身分過濾查詢＋逐筆 `canAct`、`report-issue`／`re-extract` 端點——`can_write` 與 `completed_at` 兩項已由 PR #56 補上。
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：
  - PR #45 文件清單「看上傳的檔案」：私有 bucket 一次性簽名 URL 預覽、blob 下載還原中文檔名（storage 對非 ASCII 檔名回百分比編碼）、下載開放所有可讀成員、`runFileLanded` 單一落地訊號、`log_document_access` RPC 讀取留痕（migration `20260824000100`，fail-closed，pgTAP 9；新增 `e2e-real/file-viewing.spec.js`）。
  - PR #46 `/requirements` 重建為契約條文檢索頁（搜尋＋狀態快篩＋類型／階段下拉 AND、文件序、每頁 50 條、300 筆上限誠實揭露、sticky 詳情、「開啟原文」走留痕 RPC、`?highlight` 深連結）；檢索範圍只濾待審 AI 建議，已審決內容不受最新 run 限制。期限追蹤獨立為 `/deadlines`（時間軸、已提送＋佐證、罰款試算、基準日與契約總價、列印對照表）。PR #47 契約重點頁移除頁內分頁條（`pageTabs:false`）、檢索加頻率維度（`requirementFrequencyKey`）。
  - PR #48 頻率值域擴充 daily／weekly／monthly／quarterly／yearly：抽取逐型 `frequency_config` 驗證（值域外欄位丟棄不整項否決）、`PROMPT_VERSION` v3；`contract_obligations` 加 `recurring_weekday`／`recurring_month`，物化逐型映射（migration `20260824000200`，已套用正式庫，extract-requirements／agent-run／send-reminders 已重佈）；前端／Edge 兩份 `contractDue` 支援新循環（缺必要欄位回 null）；規則文字共用 `formatObligationRule`。
  - PR #49 契約分級可見性補完（D-018，migration `20260824000900`）：`contract_obligations` SELECT／UPDATE 依 requirement 可見範圍（AI 走出處鏈、手動走歸包、都無＝全案 legacy）；`requirements.contract_package_id` 手動補登歸包（guard：同專案＋不可歸入無權讀取的包）；`can_read_requirement_scope`／`can_read_requirement_row` 五張表共用；pgTAP `contract_grading_completion.sql` 15。
  - PR #50 收編正式庫已由 MCP 直接套用、repo 沒有檔案的 `20260824123253`（行銷站 Demo 申請表 `demo_requests`），解除 db push 阻擋。
  - PR #51 D-017 語意改版（待核定→待確認、核定生效→確認無誤、已生效→已確認、駁回→不採用；估驗／變更設計的「核定」是另一業務語意未動）與確定性轉錄分流（migration `20260824130000`：引文 sourceVerify 逐字＋期限數字交叉核對，含中文數字與民國年、「140 不放行 14」錨定防誤配；兩關全過由 DB 函式自動確認並照 D-012 物化，任一疑慮標 `triage_doubts` 進人工；歷史 completed run 一次性回填；pgTAP `transcription_triage.sql`）。PR #52 摘要條「期限追蹤」改展開鈕，逐項列出時效性條文（`buildDueList` 進 `contractDue.js`，急迫度排序）；`/requirements/report` 對照報告依使用者指示退場。
  - PR #53 D-019 全自動確認（migration `20260825000100`）：AI 從已核定契約整理出的內容全部自動確認歸檔，確定性核對降為透明度註記（「系統核對無誤・自動確認」或「未逐字核對，以契約原文為準」橫幅）；帶疑慮的期限型也物化進期限追蹤，風險已向使用者揭露；人工補登仍由監造／機關確認；「不影響開啟正式模式」不變量保留。
  - PR #54 精修期最小表面：側欄只留四入口，其餘工作面 `hidden:true`（現況見 CURRENT.md §6.1）；落地頁一律今日待辦。
  - PR #55 `/requirements` 改版為「契約重點 · 履約時程」三方共用檢視頁：審核流程自本頁退場，只剩標記完成、掛佐證、回報 AI 擷取有誤；規則收在 `src/lib/obligationTimeline.js`——可見範圍看角色（廠商＝[廠商]、監造＝[監造,廠商]、機關＝全部），動作與角色無關只看歸屬（`item.who === viewerParty`），三角色共用同版面零 if-else；`VISIBLE` 表是後端依身分過濾前的前端 shim，**不是安全邊界**。版面四塊：履約執行卡（每責任方一張，五狀態加總＝義務總數的稽核不變量有測試釘住）、五段履約期程條、時間軸清單、sticky 詳情；`?obligation=` 深連結、鍵盤快捷、aria-live；四斷點 RWD。
- [x] **D-020 履約時程全型別＋開工日入口（PR #56／#57／#58）**
  範圍：義務 UPDATE 政策只看歸屬＋伺服器完成時間戳（#56）；任何已核定 Requirement 都物化義務（#57，D-020）；開工日三入口（#58）。
  驗收證據：767 Vitest、42 Demo E2E、build 綠；#57 本機全套 pgTAP 927 項、rollback down→up 循環通過。#56／#57 註明 merge 不會自動套 migration；2026-09-02 以 `supabase migration list --linked` 核對，`20260825120000` 與 `20260901040000` 都已在正式庫。
  交付內容（原 CURRENT.md §6.2，2026-09-11 併入）：`contract_obligations` UPDATE 政策由 `can_write` 改為只看歸屬——機關自此可標記自己的義務完成，廠商／監造不能跨方改狀態，改 `responsible` 讓渡被擋，admin_override 照舊；`completed_at`／`completed_by` 由 trigger 蓋伺服器時間與操作人，client 送值作廢、退回清空，歷史完成列不回填（migration `20260825120000`，pgTAP 27）。準時率改「應完成項準時率」：分子＝完成時間 ≤ 到期日、分母＝已完成＋已逾期，遲交補完成永遠留在分母。D-020：D-012 轉接器更名 `materialize_requirement_obligation`，任何已核定 Requirement 都物化一列義務（正式庫實測 106 條核定項只有 15 條期限型進 timeline、91 條卡住）；無時點型別為「未觸發」無到期日義務，期程段照 `lifecycle_phase` 歸位；`apply_transcription_triage` 與 `review_requirement` 不再分型別；既有卡住的核定項一次回填（migration `20260901040000`＋rollback 檔；pgTAP one_way 34、triage 18；前端零邏輯改動）。今日待辦與提醒信只消費推得出到期日且七日內的項目；`/deadlines` 會多出「無期限」列，是否過濾待 UX 決定。PR #58 開工日三入口：履約時程頁「設定基準日」就地展開四個基準日（決標／接獲開工通知／開工／竣工，共用 `AnchorDates`；`anchorGaps` 純函式只算「觸發點映到缺值錨點」的未觸發項，設完必須歸零）、初始化清單擴為五步（第 4 步設定開工日；第 5 步開啟正式模式仍不被任何步驟鎖住，D-014 不動）、建案選填「實際開工日」。不動 DB。

---

## 健檢排程條目的歸宿（2026-09-11 併入；本檔是唯一續接依據）

兩份健檢——[`全案健檢-2026-09-06.md`](全案健檢-2026-09-06.md) §4 六波排程、[`產品健檢與開發方向-2026-09-07.md`](產品健檢與開發方向-2026-09-07.md) §6 九十天順序與 §8 建議首包——原本各自自稱續接依據，與 `CLAUDE.md` §0 形成四份平行清單。D2 波次把兩份的排程條目**複製**到這裡逐條定歸宿；報告內文不改（DEVELOPMENT.md §7），只在該節加一行導讀指回本檔。編號沿用報告（F-16、H-01…），證據回報告查。狀態只有三種：**已完成**（寫明哪個 commit／PR）、**部分**、**未做**（列為候選或未排入；候選＝仍需使用者核准，報告的建議不是授權）。

### A. 已由本次重構、09-08 兩批或 PR #59～#62 完成

| 報告條目 | 內容 | 完成於 |
|---|---|---|
| 09-06 0-1／E-09／A-13 | main ruleset：需 PR、`test-and-build`＋`pgtap` 綠 | 使用者設定；09-07 核對 active（仍允許 RepositoryRole 5 bypass，見 CURRENT.md §6.3） |
| 09-06 0-4／G-14／B-04 | 合併 PR #59（文件回填）、#60（三支 rollback＋依賴） | 09-07 核對已在 HEAD 歷史 |
| 09-06 E-10（前半） | pgTAP workflow 涵蓋 `supabase/functions/**` | PR #62 改為每個 PR 一律跑，涵蓋範圍超過原建議 |
| 09-06 F-16／09-07 H-01 | 契約重點主畫面對帶疑慮條文誤標「系統核對無誤」、select 沒撈 `triage_doubts` | `d047437`（09-08 品質批：明確空陣列才顯示核對通過；有疑慮與未取得核對結果分別揭露；原文優先聲明進主要詳情） |
| 09-06 B-12／09-07 H-04 | `document_pages` 讀取 1,000 列靜默截斷 | `d047437`（`loadDocumentPages` exact count＋頁序連續＋上傳 `page_count` 比對；缺頁、頁數不符不開始模型抽取） |
| 09-06 D-09 | `contract.parse` 仍 `enabled=true` | `d873b07`（migration `20260911100100`，兩份註冊表 `defaultEnabled=false`；**未套用正式庫**） |
| 09-06 A-04 | Edge 錯誤回應統一、原始訊息只進 log | `bc2b2ea`（`publicError.ts`／`errorResponse`／`dbErrorResponse`／`exceptionResponse`；**未部署**，正式站仍舊行為） |
| 09-06 C-05 | 5 個頁面主函式 572–986 行 | `8e0fb33`（契約兩頁共用殼）、`b7a1000`（`Contract.jsx` 1080→592）、`47273ef`（`Quality`／`SiteLog`／`Valuation`）、`eddcf18`（`agentTools.ts` 1759→62）、`c620fd5`（`extract-requirements` 794→534）；`RequirementsReview.jsx` 1196→1004 仍是最大檔，未再拆 |
| 09-06 C-13 | 契約鏈三頁重複查詢抽單一 loader | `8e0fb33`（`useContractEnrichment` hook；刻意不進 store，理由見檔頭） |
| 09-06 C-07 | 列印工具列常數抽共用 | `b4d495f`（`PrintToolbar`＋`.paper` 紙面配色集中） |
| 09-06 E-04（部分） | `aiGate` 可注入測試、fail-closed 釘住 | `bc2b2ea` 抽 `gatePolicy.ts` 純函式、`63ce2eb` 釘「`allowed` 非 `true` 一律擋→503」；「記帳失敗不影響回應」的專屬測試未查證 |
| 09-06 D-07（部分） | agent 動作留痕 | `eddcf18` 補 `raise_to` 發起方 `handoff_sent`；唯讀工具軌跡粒度仍待決（未排入） |
| 09-06 D-11／A-01（部分） | 輸入尺寸上限 | `bc2b2ea`：`agent-run` message 4,000／facts 100k 字元；成本上限與速率限制未做（候選 4） |
| 09-06 第 5 波第 1 條／G-14 建議 | CURRENT.md §6 由流水帳改現況快照、數字引用單一 BASELINE | 本次 D2（`BASELINE.md` 為手動快照，「由 CI 產出」未實作） |
| 09-06 第 5 波第 2 條／F-25 | docs/README 索引補齊、W8-3B 狀態矛盾 | `08d9510`（補索引 11 份、W8-3B 改為已部署）；W9～W14 在本檔、D-017～D-021 在 DECISIONS |
| 09-06 E-01 | 測試數字三處互相打架 | `08d9510` 校正＋本次 `BASELINE.md` 集中；「由 CI 產出」未實作 |
| 09-06 B-14a（部分）／B-14b-d | 雙引擎差異登記 | `dual-engine-sync.md` #5 於 D2 補兩條（球權 `status` 判定、伺服器缺三類單據）；`requirements.js` 死碼**仍在**（候選 3） |

### B. 未做——候選工作包（需使用者核准）

依報告原排序，只列條目與歸類，工作量沿用報告的 S／M／L；每包動工前照 DEVELOPMENT.md §2 補五行規格。「現查」＝2026-09-11 D2 波次以 grep 確認仍未做。

**需使用者先拍板的決策（09-06 §4 第 0 波）**：F-01 簡報 vs 產品哪邊改（自動確認語意）；表面恢復策略（側欄「更多功能」收合區 vs 直接恢復 `/site-log`、`/quality`、`/supervisor-report`、`/portfolio` 四頁）；AI 上限超額行為（擋 vs 通知）；條款／隱私／DPA 內容；D-014 修訂為五步（PR #58 已五步，Decision 未補）。另有 0-2 Anthropic Console 月上限、0-3 Auth leaked-password 防護與 `mailer_autoconfirm`、0-5 repo 可見性、0-6 正式庫 7 個殘留專案與 8 個 Storage 孤兒檔、0-7 換 `ANTHROPIC_API_KEY`（chain3 仍失效）——都是後台或使用者決策，本機查不到現值。

**候選 1｜履約主流程可信修正**（09-07 §8 建議首包；H-01 已由 `d047437` 完成，剩兩項）
問題：機關自有期限不進今日待辦（H-02，`todayTasks.js` 的 `OBLIGATION_ACTIONABLE_SIDES` 只有廠商／監造，`dual-engine-sync.md` #5）；正式且已匯標單的專案初始化卡消失後，成員頁無一般介面入口（H-05／F-07）。
目標：三方都能從首頁找到自己的期限與成員管理。
不做：不推翻 D-019、不新增授權角色、不全面恢復工作面、不更改循環資料模型。
影響：`todayTasks.js`、`navConfig.js`／`Layout.jsx` 的成員入口、相關測試與 CURRENT.md §6.5。
驗收：三方自己的到期項均出現且別方不混入；點擊可完成並更新清單；正式案成員頁可達；補「從首頁只靠可見控制走到成員頁」的 e2e。

**候選 2｜可達性與文案（09-06 第 1 波其餘）**：F-06／F-11／F-12／F-14／F-15 依決策恢復入口（含 `App.jsx` 死分支、機關 `defaultLandingPath` 分流）；E-07 可發現性 e2e（從 `/dashboard` 只准點擊走到施工日誌、估驗計價、成員頁）；C-24／F-17「契約義務」殘留 3 處與五個同領域名字統一（已在未排入）；C-25／E-08 a11y 375px 掃描補 `/requirements/review`、`/deadlines`、`/project/new`；C-14 `/portfolio` 補 error state。

**候選 3｜正式資料與資料防線（09-06 第 2 波其餘）**：B-18／09-07 H-07 `delete_project` 串 Storage 清理（先蒐集路徑再刪列再刪物件，寫進 `project_deletion_records`，補 pgTAP）＋一次性孤兒清理（需 0-6 決策）；B-11 `work_items(project_id, item_key)` partial unique index（盤點已回空；已在未排入）；B-10＋顧問掃描一支 migration（四個熱點索引、38 個 FK 索引挑大表、11 條 `auth_rls_initplan`、3 張表重複 permissive policy、7 支函式 `search_path`、53 支 security definer 對 anon revoke、`pg_net` 移出 public）；B-15 11 張領域表狀態欄 CHECK（含 `contract_obligations.status`，先盤點正式庫值域外資料；已在未排入）；B-14a 刪 `src/lib/requirements.js` 的 `deadlineRuleFromRequirement`／`computeRequirementDue` 死碼與對應測試（現查仍在）；B-17 `defects` 雙 effect 收斂；D-16／D-10 `agent.ts` 加 `AbortSignal.timeout(90s)`＋一次重試（現查仍無）；G-03 `cron.sql` 加 `timeout_milliseconds`＋`send-reminders` 成功寫 `audit_events`（現查仍無）。

**候選 4｜收錢前的硬門檻（09-06 第 3 波；09-07 H-06／H-08／H-09）**：AI 成本上限（`ai_feature_allowed` 讀 `ai_monthly_token_quota` 對當月加總、平台級每日 USD 上限、每使用者滑動窗、前端 403／429 文案、`/admin` 剩餘額度、pgTAP 釘超額→false；並行請求要原子預留，不能只查歷史總和）；F-19／F-20 定價四級距 vs 三檔 plan 對應、`/admin` 依公司聚合與月度對帳表；F-21 `/admin` 試用申請分頁＋A-09 `demo_requests` 保存期與清理 cron（保存期待決已在未排入）；G-09 `/terms`、`/privacy` 公開路由與 DPA／LLM 出境揭露範本；G-05／A-02 帳戶鎖定（5 次／15 分）、`/settings/security` MFA enroll 頁、`profiles.disabled` 帳號停用、關 autoconfirm（先接 SMTP）；A-03 `agent_actions`／`ai_usage_events` append-only trigger＋pgTAP；D-07 agent 對話與唯讀工具留痕（粒度待決）；D-18 `_shared/redactPii`（身分證、手機、市話送模型前遮罩；`raise_to` 不帶成員姓名）；G-02／G-04 `recordAiUsage` 失敗寫 `audit_events`、Storage 是否在備份範圍（H-09：DB 備份不含 Storage 物件已由供應商文件確認，未知的是本專案有沒有另備份）與 restore 演練留 RTO；H-08 刪除留痕 vs 原事件保存的責任決策書（未決前不改 FK）。

**候選 5｜工程體質（09-06 第 4 波其餘）**：E-12 關 Cloudflare 自動 build 改 CI 綠後 `wrangler deploy`＋回滾 SOP；C-19／E-11 `eslint`＋`eslint-plugin-react-hooks`（rules-of-hooks error、exhaustive-deps warn）與 `deno check supabase/functions` 進 CI（B6 再次證實需要，見未排入）；C-06 `plannedNow` 抽 `src/lib/progressPlan.js` 純函式（現查仍 5 處）；C-08 Sentry Replay 改 `lazyLoadIntegration`（現查未改）；C-16 demo 種 3～5 筆 `requirements`；E-15 `scripts/e2e-real-preflight.sh`（colima 掛載、service_role grant、金鑰有效）＋`REAL_BACKEND_E2E.md` 加「最後成功日期」欄；E-02 `Payments`／`ValuationPackage`／`Acceptance`／`ChangeOrders` 頁面層測試（波次 5 補的是 lib 層）；E-10 後半：前端 `.rpc()` 呼叫點對 migration 函式簽章的靜態比對測試；B-03／B-04／B-05／G-13 `docs/architecture/db-objects.md`、DEVELOPMENT.md §5 補 rollback 判準與 `repair_` 命名、repo 根目錄 `.npmrc` 固定 darwin（現查三者都不存在）；C-18／B-22／A-08 `requirementReview.js` label 常數釘測試、`+08:00` 字面量收斂、cron secret 常數時間比對。

**候選 6｜文件與敘事（09-06 第 5 波其餘）**：B-19 `project-delete-contract-first-hotfix.md` 改述實際的 parent-row-gone 模式；B-07 CURRENT.md §4.1 圖把 `cost_items` 移到專案層（先核 schema）；F-10 D-014 五步修訂（需 Decision）；敘事對齊——依 F-01 決策改簡報 `build-2026.cjs` 第 8、12 頁，把 F-23 六項「程式有、文件沒說」（跨 request 續跑、確定性轉錄分流、契約分級可見性、原始檔檢視留痕、整案 JSON 匯出、準時率）寫進簡報，`shots.js` 截圖清單改存活入口（F-24），品牌殘留 `PMIS.ai` 清掉（F-22），新增「目前買方與銷售路徑」一節（F-03）。

**候選 7｜09-07 九十天順序的第 3～12 週**：最常用循環頻率的逐期履約紀錄（H-03，需決策書＋migration＋pgTAP；驗收含月末、跨年、29～31 日、基準日更正不重複產期）；接一條送審／佐證流程；契約評測集（掃描件、表格、附件、補充條款、中文數字、民國年、跨頁引用、衝突條款；分別量測來源定位、條款召回、責任方、期限規則、重複率、人工修正時間；模型或 prompt 更新前跑固定回歸集）；還原與提醒送達三層演練；之後依實際瓶頸選監造報表、現場手機填報或機關跨案異常其一。09-07 §6 第 1～2 週的「循環限制先揭露」與「補當前版本真後端 E2E」也未做。試點量測口徑見該報告 §7，尚非既有 KPI。

---

## 未排入（已知、刻意不順手做；要做需回報告或另立決策）

- （2026-09-11 B5 波次實查發現，需你決定要不要加 trigger）`item_schedules` 沒有 `guard_project_identity`：A 案廠商理論上可把排程掛到猜中 UUID 的 B 案 `work_item`（`project_id` 仍填 A）。RLS 擋不住這種跨表不一致，要 trigger 才擋得住。尚未寫測試（寫了會紅）。
- （同上，只記錄）本機所有 public 表的 `anon` 都帶 `TRUNCATE`（Supabase 本身的 default ACL `anon=Dxtm`）。PostgREST 不暴露 TRUNCATE，實務風險低，但 TRUNCATE **不受 RLS 約束**。

- （2026-09-11 重構審計點名，需你決定）`demo_requests` 的個資留存與清除：該表存 email／phone／ip／user_agent，但 `docs/資安/日誌留存政策.md` 與個資委外文件都沒列到它，也沒有清除排程。保存多久是政策決定，不是工程決定，所以只登記不自行訂定。
- **（2026-09-11 重構審計，Decision 草案待使用者拍板）成員管理權限的不對稱**。實查（本機 `supabase db reset` 後查 `pg_get_functiondef`）：

  | | `is_project_admin(p)` | 只認 `created_by` |
  |---|---|---|
  | 定義 | `project_members.role='admin'` **或** `projects.created_by = auth.uid()` | `projects.created_by = auth.uid()` |
  | 使用處 | `delete_project`、`valuations_guard`、`change_orders_guard`、`acceptance_events_rbac`、`safety_records_rbac` | `add_member_by_email`、`remove_member`（錯誤訊息寫死「只有專案建立者可以管理成員」）、`organizations_*` policies、`members_manage_by_creator`、`projects_update_creator` |

  結果：**被授 `role='admin'` 的成員可以刪掉整個專案、覆寫估驗與變更的狀態機，卻不能邀一個人進來。** 且 `created_by` 沒有轉移路徑——建立者離職，成員管理永久卡死。`created_by` 因此成為 `project_members` 之外的隱性授權來源，與 [`architecture/three-party-role-model.md`](architecture/three-party-role-model.md) 的「`project_members` 管授權」唯一規則相違。

  三個選項（都動安全邊界，要 pgTAP 擴充 `invite_org_confirm.sql` 的矩陣）：

  - **A｜成員管理改用 `is_project_admin()`**：admin 成員也能邀人／移除人。建立者不失能力（`is_project_admin` 已含 `created_by`）。是擴權，要確認這是想要的。轉移問題自然消失（建立者離職後其他 admin 仍能管理）。
  - **B｜維持「只有建立者能管成員」，另補 `transfer_project_ownership` RPC**：權限邊界不變，只補上離職的路。最小風險，但「能刪專案卻不能邀人」的不對稱仍在。
  - **C｜把 `created_by` 從 `is_project_admin()` 拿掉，純看 `project_members.role='admin'`（並同時做 A）**：最貼近唯一授權模型。建立者由 `on_project_created` trigger 自動成為 admin member（實查：`insert … values (new.id, new.created_by, 'admin') on conflict do nothing`），所以不失能力。
    **前置條件已於 2026-09-11 在正式庫查證（`supabase db query --linked`，唯讀）**：13 個專案、建立者缺 `admin` 成員列 **0** 個、`created_by` 為 null **0** 個、`role='admin'` 共 13 列、**admin 但非建立者 0 人**。

    因此 `is_project_admin()` 的兩個分支在正式資料上**目前完全等價**，C＋A **今天是零行為改變**：沒有人會失去權限（每個建立者都已有 admin 列），也沒有人會多拿到權限（不存在非建立者的 admin）。這是關掉這個不一致的最低成本時點——等到真的授出第一個非建立者 admin 之後再改，就會變成實質擴權，要重新評估。

  建議 **C**（配 A 一起做）：它讓授權只有一個來源，其餘兩個選項都是把不一致留著。但它是三者中風險最高的，且卡在上面那筆正式庫查詢。拍板後才寫 D-022 進 `DECISIONS.md`（該檔依其檔頭只收已確認的決策）。
- （同上）紅線三缺口：agent 唯讀工具的呼叫軌跡不落庫。`agent-run` 只把 steps 的 tool／ok／ms 回前端，`ai_usage_events` 沒有欄位可放。一旦有爭議（agent 講了錯誤金額），無法重建它查了哪些表、帶什麼參數。最小改法是 `ai_usage_events` 加 `metadata jsonb`，完整作法是 append-only `agent_runs` 表——但「記錄每一次查詢與參數」牽涉個資最小化，要先決定記到什麼粒度。
- （同上）`exportCsv.js` 的 formula injection 防護有三處已知邊界：前置空白／tab 可繞過 `/^[=+\-@]/`、`\r` 不觸發 quote、科學記號字串誤判。已寫成「現行邊界行為（記錄用，非背書）」的測試釘住；收緊會連帶影響加前綴後的 quote 判斷，不是一行改完的事。

- （2026-09-11 重構後續波次發現，D2 補登）`ai_usage_events.error_code` 一律記 `claude_error`／`exception`，細分類碼（`http_429`／`timeout`／`max_tokens`…）只在 HTTP 回應與 log；用量表分不出逾時與限流。最小改法是把 `claudeJson` 回的 `code` 帶進 `closeAiGate`（`docs/architecture/error-masking.md` §5）。
- （同上）契約包 `contract_packages.status` 只在上傳後由前端重算寫回；`healStaleRuns` 修復或 `reclassifyProcessingRun` 重試後要等下次上傳才更新，且轉成 `needs_attention` 不留痕（`document-processing-pipeline.md` §2、§8）。
- （同上）`contract_obligations.status` 無 CHECK 約束，前端（`neq('不適用')`＋跳過已提送／已完成）與伺服器（`eq('待辦')`）只在現行四值域下等價，出現第五種值就分岔（`dual-engine-sync.md` #5）；與 09-06 B-15 的 11 張表狀態欄 CHECK 同一包處理。
- （同上）`extract-requirements` 某批 upsert 失敗但先前批次成功時，run 仍走 `completed`，`verified_source_count` 會含失敗批已計、實際未落庫的驗證數；B6 純搬移未改、單測釘住現況（`resumable-extraction.md` §14），要不要改成「失敗批不計」是另一個決定。
- （同上）舊 `persistBatchItems` 的回傳型別標註（`Promise<string | null>`）與 B1 之後實際回傳的 `PublicError` 不符，暗示線上 edge function 從未過型別檢查 → 支持把 `deno check supabase/functions` 加進 CI（09-06 C-19／E-11 已列候選 5，本項是新增證據）。
- （同上）`maskDbError` 把 PostgREST `details`／`hint` 寫進伺服器 log，而 `details` 可能含「Failing row contains (…)」的列內容；刻意保留（除錯需要），但 Edge log 的存取範圍與留存期要對得上 `docs/資安/日誌留存政策.md`，該政策目前沒把 Edge log 的列內容列進去。
- （同上）「逾期 N 天」（`todayTasks.dueText`，綁 `TaskRow.OVERDUE_RE`＋`contractor.spec.js`＋`Quality.workQueue.test.js`）與「逾期 N 日」（`obligationTimeline.js`，綁 `contractor.spec.js` 另一條斷言）兩種措辭並存、各綁各的 e2e；早報信另用「已逾期 N 天」。要統一得四處同動（`ball-in-court.md` §5），屬文案決策。

- ~~P1-08 路由治理（route registry 預設拒絕）~~ — W7 完成，見 D-013
- P1-09 以外的 P2 全部（品牌統一、載入效能、列印、OCR 支援矩陣…見報告 §6.3）
- `(project_id, item_key)` 部分唯一索引（待正式資料盤點：`select project_id, item_key, count(*) from work_items where item_key is not null group by 1,2 having count(*) > 1;` 回空＝可加索引）
- ~~pgTAP 進 CI（P2-08）~~ — 2026-08-13 完成：`.github/workflows/pgtap.yml`，動到 `supabase/migrations|tests|config` 的 push/PR 觸發，全套失敗偵測含 not-ok／SQL 中斷／plan 數不符／整檔壞掉
- 已核定估驗／檢查紀錄擋重設的 UX 磨光（guard 訊息措辭）
- agent-run 回答補出處連結（sources）——/assistant 唯一獨有的輸出格式，導向後暫以 steps 摘要代替
- ~~照片先行→AI 自動填施工日誌~~ — W8-7（PR #22）完成：未存檔可批次辨識、確認上傳自動建草稿日誌、工項/摘要草稿回填表單、`photos.location` 白板區域結構化
- （2026-08-19 真人驗收點名、尚未做，需另立決策書）機關模板估驗計價單套版輸出——確定性套版引擎＋一次性 AI 欄位對應（見 pmis-agency-format-export 構想；ValuationPrint 另需「全標單列」模式）
- （同上）進度網圖／預定進度表驅動「本週應施作工項」提醒（L；墊腳石:既有 item_schedules 餵入 buildTodayTasks 為 S-M）
- ~~查驗申請檢附自主檢查表~~ — W8-7（PR #22）完成：`inspections.checklist_record_id` FK＋查驗表單檢附＋檢查表分段「提出查驗申請」一鍵預填與「已附查驗」反向標記；查驗單正式列印格式仍未做
- （同上）請款收款頁資訊層級重整（統計卡收斂為現金流摘要條、金流四欄合併）；估驗列印/佐證包單一入口收斂
- （W8-6 附帶發現）UI 端無「撤銷已核准變更」入口（DB 允許機關撤銷、pgTAP 已釘）；契約義務預警窗 7 天是否放寬到 14 天待定
- ~~契約重點對照報告~~ — PR #42 交付 `/requirements/report`，PR #52 依使用者指示退場；`/deadlines` 的列印對照表仍在
- （體檢 P1 刻意跳過，PR #42）AI 成本硬上限／rate limit（先前定案只監看不擋，要翻案另議）；帳戶鎖定／停用（體檢已降級）；契約脊椎 IA 重整與 App bar 真搜尋（設計決策）；字型 947KB 首屏下載（需 subset 或去自架，L 工作包）
- （PR #54）五個 hidden 工作面逐項復出——加回一個功能＝移除一行 hidden；跨案總覽回側欄時還原多案角色分流
- （PR #55 後端缺口）依身分過濾的義務查詢＋逐筆 `canAct` 旗標（屆時刪除前端 `VISIBLE` shim）；`report-issue`／`re-extract` 專用端點
- （PR #57）`/deadlines` 無時點的「無期限」列是否過濾（目前排序在最後）
- （2026-09-11 文件校正波發現）W11 決議「契約義務」一詞自 UI 退場，但程式仍有三處使用者可見字串未改：`src/pages/web/Dashboard.jsx:72`（「N 條契約義務等待開工日…」）、`src/pages/web/Requirements.jsx:838`（`aria-label="搜尋契約義務"`，報讀器會唸到）、`src/pages/web/Requirements.jsx:976`（`unlocks` 文案）。其餘 `src/` 內的「契約義務」都是註解或內部資料層命名，不在此列。改文案要順便確認 e2e 沒有綁這些字串。
- （2026-09-02 健檢）~~補 `20260824130000`／`20260825000100`／`20260825120000` 三支 rollback~~（PR #60 已補，09-07 核對）；~~以 `supabase migration list` 核對正式庫~~（2026-09-02 已核對一致）；關閉 GitHub Pages＋刪 `gh-pages` 分支、處理 `pmis.pages.dev` 舊部署（09-07 仍回 200）；刪 34 條已合併分支；確認 `claude/trusting-heyrovsky-203d6c`（PostgREST 分頁）是否已由他路徑進 main；`npm audit fix`＋移除 `gh-pages` 套件；React 19／Vite 8／Vitest 4 大版升級另立工作包；~~CLAUDE.md 與 DEVELOPMENT.md 續接點同步~~（`08d9510` 與 D2 波次已同步，CLAUDE.md §0 只指路）
