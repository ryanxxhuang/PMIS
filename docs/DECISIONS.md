# 已定案決策

> ACTIVE｜2026-09-11。保留決策編號與現行約束，實作歷程由 Git／PR 追溯；未完成事項見 [ROADMAP](ROADMAP.md)。D-019／D-020 優先於 D-012／D-017 的舊門檻，D-021 取代舊視覺方向。

## D-001｜產品名稱與範圍

狀態：ACCEPTED。最終產品是 GovAgent；PMIS 是公共工程垂直領域與 repo 名稱。現階段只做公共工程，不預建其他業務框架。

## D-002｜專案角色只有三方

狀態：ACCEPTED。業務角色只有 `contractor`／`supervisor`／`owner`。現場、品管、工安為廠商內部分工，不可成為 RLS、導覽、Agent 或功能開關角色。詳見 [三方模型](architecture/three-party-role-model.md)。

## D-003｜AI 只做草稿

狀態：ACCEPTED。AI 可查詢、彙整、擬稿，不可執行業務核定、判定、結案或驗收；數字由確定性引擎計算，正式狀態由人、RLS、RPC、Guard Trigger 保護。契約轉錄依 D-019 的明示例外。

## D-004｜簡單優先

狀態：ACCEPTED。第二個實際需求出現後才加抽象；一次處理一個清楚問題，不為形式搬動穩定功能。

## D-005｜文件先行

狀態：ACCEPTED。開發前寫清問題、目標、不做、影響與驗收。候選不等於授權，流程依 [DEVELOPMENT](../DEVELOPMENT.md)。

## D-006｜前端資料存取

狀態：ACCEPTED。跨頁共享資料進 Store；單頁有界資料可直接查 Supabase；同一查詢重複後才抽共用層，不新增形式上的 repository。

## D-007｜建案後第一站是專案文件

狀態：ACCEPTED。建案成功後導向專案文件；初始化走文件／標單上傳、三方成員與正式模式，不維護 BOQ-first 的第二條路。

## D-008｜主要 AI 入口是 /agent

狀態：ACCEPTED。`/agent` 是唯一完整 AI 入口；浮動 Copilot 是薄入口，`/assistant` 導向 `/agent`。`assistant.chat` 已停用，舊功能列、Edge 與歷史用量保留。

## D-009｜正式專案角色以邀請方確認為準

狀態：ACCEPTED。公開註冊自選 `org_type` 不作正式專案身分信任依據；邀請方指定三方身分，伺服器與帳戶身分比對，錯配拒絕。`project_members` 管授權，`project_memberships` 管身分快照。

## D-010｜AI 功能開關故障策略是 fail-closed

狀態：ACCEPTED。AI 功能閘門查詢失敗或 `allowed` 非 true 時拒絕服務；查詢不確定回 503，明確停用／禁止才回 403。用量記帳失敗不阻擋回應，但須記 log。

## D-011｜Requirement／obligation 先盤點再定向

狀態：ACCEPTED。已完成 Requirement／obligation 讀寫與正式資料盤點；採 D-012 的單向產生。原盤點由 Git 追溯，不能再把此項當待決。

## D-012｜Requirement 單向產生 obligation

狀態：ACCEPTED。`requirements` 是唯一契約要求權威；approved Requirement 單向產生／更新 obligation runtime，保留執行狀態、佐證、罰則與歷史，不反向改寫。取代已確認項時，只將仍待辦 runtime 標不適用。原「人工核定、僅 deadline」範圍已由 D-019／D-020 擴充。

## D-013｜前端路由預設拒絕

狀態：ACCEPTED。每個前端路由都登記在 `navConfig.js` 的 `routeRegistry`；未登記拒絕。公開、重新導向、列印與 404 須明確標註；列印仍受登入／專案守衛保護。

## D-014｜保留專案初始化設定精靈

狀態：ACCEPTED。保留專案初始化精靈；AI 整理步驟以有 completed run 為完成條件，不要求清空待確認建議，不阻擋合法開啟正式模式。原四步條文待修訂：PR #58 實作已增加「設定開工日」成五步。

## D-015｜W8 全產品 UI/UX 方向

狀態：ACCEPTED。保留階層導覽與全域 Agent 入口；桌面側欄可收合、子頁可展開／收合，手機同一階層，內容區不重複子頁導覽。原六工作面視覺與 Google／Material 方向由 D-021 取代；現行 hidden 集合依 navConfig，不因重構自行復出。

## D-016｜變更設計核定權責

狀態：ACCEPTED。變更設計核准／駁回與撤銷核准為機關專屬；監造受理（提出→審核中）／退回（審核中→提出）。核准必經審核中。`change_orders_guard` 強制，非正式模式 admin_override 例外維持。migration `20260819111252`、pgTAP `change_order_approval.sql`。

## D-017｜契約重點語意:確認轉錄而非核定生效+確定性分流

狀態：ACCEPTED。契約早已生效，人工確認對象是 AI 轉錄；介面使用「待確認／確認無誤／已確認／不採用」。原逐字與期限核對分流門檻已由 D-019 取代；核對引擎保留為透明度註記。

## D-018｜契約分級可見性補完

狀態：ACCEPTED。契約分級：機關全部、監造施工契約與自己的、廠商自己的；文件、來源鏈與 obligation SELECT／UPDATE 都受 RLS 保護。人工補登用 contract_package_id 歸包，guard 檢查同案與可見性；legacy null 維持全案可見。migration `20260824000900`。

## D-019｜AI 整理全自動確認(修訂 D-017 的分流門檻)

狀態：ACCEPTED。AI-origin 整理全部由伺服器自動確認歸檔；逐字／期限核對只是透明度註記，有疑慮仍物化且保存 triage_doubts。頁面與項目明示原文優先，actor=system 留痕。提醒／罰款試算會消費未逐字核對期限，此風險已由使用者接受。manual／migration 人工補登仍需監造／機關確認。migration `20260825000100`。

## D-020｜履約時程接入全部契約重點類型

狀態：ACCEPTED。所有已確認 Requirement 類型均冪等物化一列 obligation（`materialize_requirement_obligation`），不再僅限期限型。無時點者無到期日、不產生到期提醒；保留既有執行狀態與歷史。migration `20260901040000`，附 rollback／pgTAP。

## D-021｜全產品 UIUX 改採 Apple style（取代 W9 的 Google／Material 3 方向）

狀態：ACCEPTED。App 與行銷站依 [Apple 設計規範](UIUX-Apple-設計規範.md)：收件匣落地、來源→清單→詳情、契約原文與條文高亮方向。token／字級／材質集中 index.css，圖示 lucide-react。舊 Google handoff 退場。路由／三方角色／RLS 不變；圓角改 token 值須保留仍被 E2E 使用的 class 名。

落地：token、圖示、字級、球權側欄、收件匣與契約／工安共用清單詳情殼已實作並隨 PR #64 的前端部署上線；清單／詳情殼已於 2026-09-11 推廣到十四頁（見規範 §8），表格型頁（估驗／請款／成本／排程）與施工日誌依規範不套殼；行銷站整合仍待續接；登入頁（登入／註冊／忘記密碼／demo 入口）已於 2026-09-11 依規範 §2～§6 套用 Apple style，流程與 Supabase 呼叫不變。

## D-022｜專案授權只有 `project_members` 一個來源

狀態：ACCEPTED。`is_project_admin()` 只看 `project_members.role='admin'`；成員邀請／移除、members 管理 policy 與 projects 更新 policy 統一用該函式，非建立者 admin 也可管理成員。`created_by` 欄位、建案完整性約束、組織自己的 created_by policy 保留。

建立者依賴 `on_project_created`／create_project RPC 補 admin 列，沒有該列就沒有管理權。2026-09-11 正式庫唯讀盤點：13 案建立者均有 admin、無非建立者 admin，當時套用不改任何人的權限。migration `20260911110000_project_admin_single_source` 與 rollback、pgTAP 角色矩陣已提交，2026-09-11 已套用正式庫。

## D-023｜commit／push／部署的常設授權

狀態：ACCEPTED。2026-07-11 授權、2026-09-11 重申：相關驗證通過（lint、test、build、check:docs；動 DB 含 pgTAP；動 Edge 含 check:edge）後，AI 協作者可直接 commit、push、開 PR 並在 CI 綠後合併、套用正式 migration、重佈 Edge，不逐次詢問；完成後附驗收清單，部署版本寫回 CURRENT §6.3。仍須先問的例外：會產生新雲端費用的資源、刪除正式資料或遠端資源、沒有回復路徑的破壞性操作。

## D-024｜進度數字的單一口徑（月底累計、截止日、估驗狀態）

狀態：ACCEPTED（2026-09-16，依 Codex 實測 W07 對照後定案，見 `docs/reviews/2026-09-16-uiux-w07-progress-caliber.md`）。(1) 預定進度表每列＝該月「月底」累計 %，今日／任一日的預定值在上一列（開工月為 0）與本列之間按當月日數內插（`src/lib/progressPlan.js`）。(2) 報表統計截止日＝所選月份月底，本月尚未結束取今天；施工月報與監造報表同一報告月份用同一截止日、同一期估驗（`src/lib/progressAsOf.js`）。(3) 累計實際取估驗日期在截止日（含）以前、期數最大的一期，草稿／監造審核／已核定都計入，畫面必須標示所取期別與狀態；未填日期的期別一律納入。(4) 月報的累計已收款、已請款期數同樣截至截止日。前端八處進度數字（月報、監造報表、進度頁、首頁、跨案本案、AI 快照、風險稽核）共用同一支取期函式；DB `portfolio_summary` 仍取最新期，未同步。

## D-025｜第三方腳本只能由 repo 明示引入，邊緣層不得自動注入

狀態：ACCEPTED（2026-09-16）。起因：Cloudflare 對 `gov-agent.ai` zone 開著 Web Analytics 自動注入，app 與 demo 的 CSP（`script-src 'self'`，弱點掃描後補的硬約束）把它擋掉，三個站都收不到數據卻每頁留兩條 console 錯誤。決定：(1) 任何第三方腳本（分析、監控、字型以外的載入）都必須在 repo 的 HTML／layout 明示引入，Cloudflare 或其他邊緣層的自動注入一律關閉；Web Analytics 站設定固定為「Enable with JS Snippet installation」。(2) app（`app.gov-agent.ai`）與 demo 站不載任何分析腳本，`script-src 'self'` 不因分析需求放寬；使用者行為要量，在產品內用自己的後端事件。(3) 訪客分析只放行銷站（`PMIS.marketing` repo，GitHub Pages），由 `Base.astro` 手動載入 beacon，並以 `<meta http-equiv>` CSP 白名單 `static.cloudflareinsights.com`／`cloudflareinsights.com`；Astro 設定強制樣式與腳本輸出成檔案，不開 `unsafe-inline`。(4) 部署後以 `npm run check:prod` 核對 app／demo：200、CSP 標頭含 `script-src 'self'`、HTML 無 `cf-beacon`。

2026-09-19 補記（D1，H2／H3 核對時發現）：app 與 demo 每頁 HTML 在 `</body>` 前另有一段 Cloudflare 塞入的行內載入器（建 1×1 iframe 載 `/cdn-cgi/challenge-platform/scripts/jsd/main.js`），來源是 `gov-agent.ai` zone 的 Bot Fight Mode 自動開啟的 JavaScript Detections——Free 方案無法單獨關閉、不能依主機或路徑排除、不走 WAF 規則，對 zone 上所有經 Cloudflare 代理的 HTML 回應都注入（app 含全部 SPA 路由與 `/demo/`、demo 站兩個 Workers 自訂網域；apex 行銷站是 GitHub Pages DNS-only，不經代理故無此注入）。CSP 擋下它，等於每頁一條 console 錯誤，而 (4) 的 `check:prod` 只 grep `cf-beacon`，漏檢。處置：(5) 「邊緣不得改寫」改由 repo 宣告——`public/_headers` 對所有 HTML 回應加 `Cache-Control: no-transform`（HTTP 標準的「中介層不得改寫本回應」；Cloudflare 文件明載帶此 directive 的回應不注入 JavaScript Detections、不注入 Web Analytics beacon、也不壓縮），雜湊資產用 `! Cache-Control` 拆掉後另設，維持 immutable 與壓縮。不放寬 CSP（nonce 或 `unsafe-inline` 都等於讓任何邊緣注入可執行）、不關 Bot Fight Mode（它本來就沒拿到 JSD 訊號，行為不變）、不需在 Cloudflare 後台改任何設定；日後若真要啟用 JSD，必須先修訂本條。(6) `check:prod` 改為允許清單：HTML 內每個 `<script>` 必須是 repo `index.html` 明示引入者在 build 後的形狀（`./theme-boot.js`、Vite 入口 `./assets/index-<hash>.js`），行內腳本一律不允許；另驗 `script-src` 恰好 `'self'`、HTML 帶 `no-transform`、入口 chunk immutable 且壓縮；預設檢 app `/`、`/login`、`/demo/` 與 demo `/`、`/login`。任何邊緣注入（已知的 cf-beacon、jsd、Rocket Loader、email-decode 或未來的）都會被抓到，不再逐一列黑名單。

## D-026｜產品收斂為四核心，四類現場文書必做，監造確認通過才可估驗且由後端強制

狀態：ACCEPTED（2026-09-17，使用者確認的產品邊界；需求依據 `docs/reviews/2026-09-17-product-slimming-report.md` 與 `docs/reviews/2026-09-17-claude-product-slimming-prompt.md`）。本條只記錄使用者已確認的邊界；資料模型、表名、鎖與 RPC 等技術方案是實作者選擇，寫在 `docs/architecture/` 三份 PROPOSED 文件並隨實作回寫，不視為使用者定案。

1. **四個產品核心**：契約解析結合工程時程並提醒何時由誰做什麼；估驗計價與請款智慧化；照片上傳後 AI 自主填妥文書、人員審核簽署後提送；廠商、監造、機關在同一平台完成清楚的專案流程。最高優先的完整流程：照片 → AI 文書 → 人員審核簽署 → 監造查驗確認通過 → 自動更新可估驗範圍與數量 → 估驗核定 → 請款。
2. **四類文書全部必做**：施工日誌、監造日誌（每日監造紀錄，現有月份彙整的監造報表不能代替）、自主檢查表、監造查驗表單。系統在上傳後主動辨識、選用適用範本、生成完整草稿並列出待補；沒有可靠來源的數量、實測值、到場、天氣、合格不得捏造；人補一次適用文件共用；廠商證據不能冒充監造行為；AI 只寫草稿，簽署、合格判定、核定與提送由人執行；AI 草稿與接受／編修／拒絕紀錄遵守 `agent_actions` 邊界並經現有 AI 閘門。簽署必須綁定可核對的文件版本、簽署者、伺服器時間與簽署意願；簽後更正另開版本；提送防重複並保留歷次退回與回執。
3. **監造確認通過才有可估驗資格，且由後端強制**：計價來源須追到專案＋標單工項＋施作位置／批次＋計量單位＋有效確認數量＋查驗／文件版本＋確認人與時間；自主檢查合格、日誌數量、AI 判斷或同工項曾有任一合格查驗都不足以解鎖整個工項；監造正式確認後自動更新可估驗明細，無期別先累積、草稿期依截止日同步、已送審／核定期不自動改寫；有效確認量按實際施作批次去重並處理部分通過、複查與多階段；本期可新增量不得超過截至截止日的有效確認量扣除前期已計價與其他未結束期別占用量，再受核准契約量約束；併發與重播、直接 REST、RPC、Edge、匯入、管理員、service role、客戶端數量都不能繞過；舊 `fillValuationFromSiteLogs` 不得保留為不受確認量限制的請款路徑；總價／間接費等非實體工項須有監造確認的契約計價依據，規則不明時隔離不放行；撤銷或減量對未核定期重新檢查阻擋、對已核定／已請款走有稽核的調整流程；估驗核定、保留款與請收款的既有角色順序不變。
4. **瘦身範圍與四主入口**：主入口只有「今日工作、現場紀錄、履約時程、估驗請款」，次入口保留專案資料、設定、文件來源與歷史查閱。成本／毛利／分包記帳、獨立跨案分析儀表板、獨立風險稽核工作區、泛用 `audit.summary`、逐工項排程獨立頁退出新作業；估驗所需檢核移入估驗流程，必要工項日期承接到履約時程後才退場舊排程頁；品質、工安、送審、疑義、變更、月報、驗收融入核心流程。路由仍由 `navConfig.js` 登記並 fail-closed，舊深連結受原權限保護。
5. **退場不刪正式歷史資料**：退場模組保留原授權下的歷史查閱與匯出，不 drop 正式表、不刪 `audit_events` 與歷史用量；不得為讓舊資料過關而自動偽造監造確認、簽署或數量，新請款缺依據者明示並走人工補證流程。
6. **不變的既有邊界**：角色只有三方（D-002）、`project_members` 是授權來源（D-022）、AI 只做草稿（D-003）、D-019 契約轉錄自動確認、D-024 進度口徑、D-025 CSP、D-023 常設授權；新增雲端費用、刪除正式資料或遠端資源仍須先問。
7. **2026-09-17 使用者對續接清單 §6 待決題的答覆**（主 session 對話中親自答覆；只有本點列出的是使用者定案，其餘技術方案仍是實作者選擇）：
   - Q1 簽署方式：2026-09-17 原答覆為「先用平台帳號加 MFA」（`method=platform_account_mfa`，簽署 RPC 要求 JWT `aal2`）。**2026-09-19 使用者改決：全面移除兩步驟驗證**——主 session 原文要旨「把簽署需要兩步驟驗證這個功能拔掉；把整個兩步驟驗證這個功能都拔掉」。自此簽署以**已登入的平台帳號**為身分（`method=platform_account`），伺服器記錄簽署者、組織、姓名快照、伺服器時間、簽署意願原文、所簽版本與內容雜湊、IP／UA（`aal` 欄保留只作證據）；登入沒有驗證碼步驟、`/account` 兩步驟驗證頁移除、Supabase Auth 的 TOTP 應關閉（R1，migration `20260919023220`）。紙本簽回與外部憑證仍未排除、本輪不做。
   - Q3 總價／間接費：**暫時隔離、不計價**——缺計價依據一律 `cap=0` 並在估驗頁標示；這是暫時措施，各類工項的計價依據仍待後續決定。
   - Q8 付費 OCR：**本輪不採用**；掃描／無文字契約只做真實狀態揭露與人工補登路徑。
   - Q11 實案範本：**先用示範範本**（監造日誌、監造查驗表單等），介面與列印必須明確標「示範範本」，不得宣稱為機關公定格式。
   - Q2、Q4、Q5、Q6、Q7、Q9、Q10：同意照續接清單的暫行做法（逐工項到元、監造日誌專案成員可讀、廠商異議走 RFI、多階段以 ITP H 點、截止日＝計價截止日且送審必填、先建比對腳本與樣本格式、成本頁 P1b 即唯讀）；Q9 的評測樣本來源仍待使用者提供。
   - **2026-09-20 使用者決定（續接清單 P5c／P5d 留下的新題）**：保固類循環義務的停止條件——**保固期滿日＝正式驗收合格日＋契約載明的保固期間**；兩者都有依據才計算並記錄來源，缺任一項列「待補設定」。P5e 實作（migration `20260920040000`）；保固期間的存放與引用條文、期滿日採民法期間計算（始日不算入、月底無相當日取月末）、RPC 與窗口等技術方案是實作者選擇，見 [入口與退場設計 §4.3](architecture/slimming-entrypoints-and-retirement.md#43-期限版本)。

