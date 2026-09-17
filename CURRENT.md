# 目前系統現況

> CURRENT｜2026-09-17｜三方操作流程優化＋D-026 P4a 純計算層＋P2a 現場文書資料層；正式發布狀態見 §6.3。
> 包含契約整理、Apple UI、D-022、工安清單／詳情殼，以及全案程式與文件整理；驗證見 [BASELINE](docs/BASELINE.md)。前端已由 main 自動部署；DB 已同步至 `20260917201000`、Edge 最後重佈 2026-09-11，版本與核對範圍見 §6.3。
> 進行中工作（D-026 產品瘦身與四類文書、監造確認量估驗聯動）見 [續接清單](docs/reviews/2026-09-17-product-slimming-worklog.md)；本檔只記已上線現況：該包目前上線的是 P1a 導覽重組、P1c／P1d 文案對齊與抽屜斷點修正（前端）、P4a 純函式 migration（尚無呼叫端）與 P2a 現場文書資料層 migration（表、RLS、guard、稽核；尚無 Edge／前端／RPC 寫入端），其餘仍是設計文件。

## 1. 產品與範圍

GovAgent 讓政府承辦人使用懂業務的 AI Agent；PMIS 是目前公共工程垂直領域的 repo。現階段只做公共工程，不預建其他領域框架。App 在 `app.gov-agent.ai`；`gov-agent.ai` 是另一個 `PMIS.marketing` repo 的行銷站；線上 demo 站 `demo.gov-agent.ai`（備援 `pmis-demo.ryanxhuang1212.workers.dev`；Supabase 留空建置，三角色選人登入、記憶體種子，需手動重佈）。

## 2. 使用者與授權

專案業務角色只有廠商 `contractor`、監造 `supervisor`、機關 `owner`。現場、品管、工安是廠商內部分工。平台管理員負責營運，不是第四個專案業務角色。

`profiles.org_type` 管三方業務身分；`project_members` 管專案存取與 admin；`project_parties`／`project_memberships` 管契約方身分快照。`project_role` 不作授權。D-022 已將專案管理統一由 `project_members.role='admin'` 決定，`created_by` 僅作稽核／建案用途；migration 已於 2026-09-11 套用正式庫。

## 3. 技術層次

React 18、Vite 6、Tailwind 4 SPA；Supabase Postgres／Auth／RLS／Storage／Deno Edge Functions；Cloudflare Workers 靜態資產部署；Sentry 錯誤回報。平台層處理身分、文件、期限、佐證、AI 閘門與稽核；公共工程層處理標單、日誌、品質、估驗與驗收。

## 4. 資料來源

- 工程數量／財務：`work_items` → 日誌數量 → 估驗／請款，品質與佐證以 `work_item_id` 串接。DB 結構以 migrations 為準。
- 文件／履約：`contract_packages` → `documents`／versions／pages → extraction runs → `requirements`／sources → `contract_obligations`。
- 只有 `approved` Requirement 是契約要求權威。所有已確認類型單向物化 obligation，執行狀態、佐證、罰則不反向改寫契約內容；被取代項只將仍待辦的 runtime 標不適用，保留歷史。

## 5. AI 邊界

AI 查詢、彙整、擬稿；業務核定、判定、結案、驗收與凍結由人執行。數字由確定性引擎計算。草稿／動作寫入 `agent_actions` 並由人接受或拒絕。

D-019 的契約轉錄例外：AI-origin 整理全部自動確認，即使有核對疑慮也進履約 runtime；核對是透明度註記，必須揭露原文優先。人工補登仍由監造／機關確認。AI 閘門失敗拒絕服務，用量記帳失敗不阻擋回應。

## 6. 技術與交付狀態

### 6.1 前端

- UI 採 [Apple 規範](docs/UIUX-Apple-設計規範.md)，token 在 `src/index.css`，圖示 `lucide-react`。`listDetail.jsx` 共用清單／詳情殼已供契約重點、擷取審核、工安、疑義、期限、送審、變更設計、停留點、提醒中心、三方成員、活動紀錄、風險稽核、品質三段、專案文件與缺失追蹤（`DefectTracker` 內建殼，/quality 與 /safety 共用）共十五頁使用；手機形狀依規範 §9（iOS 字級一處覆寫、44px 頂欄＋五格底欄、詳情推入、表格頁唯讀摘要、收件匣直達那一筆）。列印用 `.paper` 與 `PrintToolbar`。
- `navConfig.js` 是路由／導覽單一真相，未登記拒絕。側欄依 D-026 四主入口分區（2026-09-17 瘦身 P1a）：今日工作（球權三來源，持有 `/dashboard`）→ 工作（現場紀錄 `/site`／履約時程 `/requirements`／估驗請款 `/valuation` 三組＋子頁，子頁依角色過濾；期限追蹤與擷取審核改為履約時程子頁）→ 專案資料（文件往來：送審／疑義／施工月報／監造月報；專案：專案文件／三方成員／活動紀錄／跨案總覽）→ 平台。`/cost`、`/audit` 為 hidden（不進側欄／分頁列／尋找功能，仍登記且依原 roles 可深連結）且自 2026-09-17 P1b 起唯讀（見下一點）；`/schedule` 待 P5d 承接後才 hidden；`roles` 未變。新頁 `/site`（現場紀錄總覽）依角色列出日誌／查驗／自檢／試驗／停留點／工安入口與件數、現場待辦（與今日工作同一份聚合）與本月文件入口，不含照片上傳或簽署流程（P2c 起）。群組與底欄短標 `short` 與 label 同住 navConfig；待辦「返回來源」（今日工作／提醒中心／現場紀錄）統一在 `src/lib/taskReturn.js`，名字取自 navConfig（`BALL_SOURCES_TITLE`、`/alerts` 的 `label`、`/site` 群組）；`/dashboard` 的 h1 也是 `BALL_SOURCES_TITLE`，全站只有「今日工作」一個名字（2026-09-17 P1b 統一，舊「今日待辦」別名移除）。
- 退場頁唯讀化（2026-09-17 瘦身 P1b，D-026 §4／§5）：**成本管理 `/cost`** 只剩歷史查閱與 CSV 匯出——寫入由資料庫收回（migration `20260917210000_cost_items_retire`：收回 authenticated／anon 的 INSERT／UPDATE／DELETE grant、policy 改 select-only；讀取條件不變，監造／機關仍讀不到廠商成本），store 不再有成本寫入函式，頁面無新增／編輯／刪除控制。**跨案總覽 `/portfolio`** 縮為選案清單（案名／代碼／狀態、未結缺失／待查驗／待核定變更件數、最近估驗期，整列可點切換），統計、進度、驗收階段與例外彙總帶及 `portfolioExceptions.js` 移除；`portfolio_summary` RPC 未改。**風險稽核 `/audit`** 保持 hidden＋僅機關，頁首標「唯讀查閱」並導向估驗計價；估驗所需的勾稽檢核改在 **估驗計價頁** 逐期顯示「本期勾稽檢核」卡（`src/lib/valuationChecks.js` 組裝＋既有 `integrityAudit.js` 引擎，稽核頁共用同一支），Agent 稽核提示卡的連結改指 `/valuation`、三方成員頁的機關權限說明不再列風險稽核；契約／變更／進度檢核表面向暫留 `/audit` 唯讀（P5d／P6b），AI 稽核意見 `audit.summary` 退場屬 P6c；決策列「超計／無佐證」與整期勾稽發現的口徑合併與缺件控制留 P4c。
- 首頁為「現在輪到我／等待對方／今天已完成」單桶收件匣，`?ball=` 選桶；可搜尋、依類型／逾期與今天到期篩選、每次 20 件原地顯示更多。篩選及載入筆數保存在 URL，待辦進入單據後可返回原清單。手機篩選預設收合。待辦共用 `todayTasks.js`／`useTodayTasks`；今天已完成明示僅含有可靠時間戳的缺失與查驗。
- 三方主入口由 `navConfig.MAIN_ENTRY_PATHS`／`roleWorkLinks` 產生，三角色相同＝三個主入口群組（現場紀錄／履約時程／估驗請款），在任一子頁底欄群組仍為選取；桌機首頁的主入口列名稱＝側欄「工作」分區名（`WORK_TITLE`，2026-09-17 P1c 取代「廠商常用」），手機五格底欄＝現在輪到我＋三主入口＋更多。`ROLE_WORK` 只剩角色標籤與摘要。頁面文案指路的頁名取自 `navLabel`／`navEntryFor`（提醒中心指向「履約時程」、初始化清單指向「三方成員」、建案表單與期限追蹤指向「契約重點」），不手抄字串。提醒中心明示與「今日工作」同一份事項、只是依期限分類。側欄「尋找功能」依既有權限搜尋頁面名稱與操作提示，不呼叫 AI。各工作頁頁首說明依角色呈現。
- 手機導覽抽屜（2026-09-17 P1c 缺陷修正）：抽屜只存在於 `<md`，`Layout` 以 `drawerOpen = isBelowMd && menuOpen` 推導，鎖捲動／Esc／遮罩／焦點／`aria-expanded` 全讀它；抽屜開著拉寬到 ≥768 時鎖定隨抽屜消失而解除、捲動位置還原、開啟意圖清除（`a11y.spec.js` 釘住）。
- 查驗／觀察／試體／停留點待辦直達詳情；估驗與付款 `?period=` 指定期別，不存在的期別提供重新選擇入口。共用詳情 sticky 避開頂欄，對話框支援焦點圈限與返回觸發點。
- 入口與待辦（2026-09-15 UIUX 階段 2，部分）：真專案未匯標單時，首頁「現在輪到我」同時顯示專案初始化卡與已可執行的待辦（送審／疑義／履約期限不依賴標單），非專案管理者看到「由專案管理者完成」說明；風險警示與 AI 代辦仍只在有標單時顯示。提醒中心的關鍵字／期限類別篩選保存在 URL，「前往處理」返回時篩選不遺失。桌機 AI 入口：頂欄輸入框可及性名稱改為「問 GovAgent」，側欄「問 GovAgent」由浮起大按鈕降為一般導覽列，Copilot 維持薄入口；「尋找功能」仍為不依賴 AI 的頁面查找。
- 入口方案 B（2026-09-15 採用，階段 2a）：進頁或切換路由時，側欄自動展開目前頁所屬的工作群組並列出同組子頁；使用者仍可手動收合／展開，狀態只保留在本次瀏覽。頁內分頁列 `PageTabs` 只在側欄提供不了同組子頁時渲染（側欄收合成 icon rail、平板 768–1279、手機抽屜、或使用者手動收合該組），由 `SidebarNavContext`（`src/lib/sidebarNav.js`）傳遞；不在 `WebLayout` 底下時一律渲染。路由登記與 roles 未變。
- 工作交接與回找補強包 B（2026-09-16，依 Codex 實測報告 W05／W06／W08／D01）：品質頁切分段與點佇列、共用 `useUrlFilters`、日誌切日期改寫 URL 時都保留 `location.state`，從待辦進來的「返回今日工作」不再消失。返回時除原項 key 另帶 `returnedTo`（剛才那一筆的頁面與選取）；首頁原項已離開清單時不再指向不一定找得到它的「今天已完成」，改給「回到剛才處理的那一筆」連結。送審建立後的提示與文件區只給當下做得到的指示：附件說明只在建立時填（表單加提示，建立後不可修改），外部交件未註明可於補正再送時寫在補正說明；未放寬已提送件的修改權限。示範模式（非真專案）不再顯示會失敗的上傳鈕，改為說明正式專案才可上傳。
- 報表口徑與資訊層級補強包 C（2026-09-16，依 Codex 實測報告 W07／W09）：W07 只做口徑對照與最小修正提案（`docs/reviews/2026-09-16-uiux-w07-progress-caliber.md`），未改任何進度公式；查明施工月報與監造報表的預定值差異來自預定進度表「月份列」被兩處分別解讀為月底與月 1 日（C1），另列未核定估驗一律計入（C3）、月報收款欄不隨月份（C4）等待決。W09 進度頁排行更名「估驗完成率差距（依金額權重）」並說明不是工項排程落後判定，排序公式不變。
- 進度口徑定案 D-024（2026-09-16，補強包 C 第二批）：預定進度表月份列＝月底累計，`plannedPctNow` 改在上一列與本列之間按日內插（今日預定不再高估一個月）；新增 `src/lib/progressAsOf.js`（`reportCutoff`、`latestValuationAt`），施工月報與監造報表同一報告月份取同一截止日（過去月份月底、本月今天）與同一期估驗，八處進度數字共用取期規則（估驗日期不在未來、狀態不論）；月報收款／請款期數截至截止日；三頁都標示截止日、所取期別與是否含未核定。Demo 種子估驗比例下修、第 5 期日期改為 3 天前以保留落後示範。
- 版面與操作感受小包 D（2026-09-16，依 Codex 實測報告 §5 五項）：變更設計詳情去掉與狀態列／決策摘要重複的四格（只留提出日）；送審詳情四格去掉類別與狀態（徽章與球權章已帶）、AI 助手區預設收合（有結果或執行中自動展開），1440×900 下「受理審核」從首屏外進到首屏；送審審定對話框標題與按鈕改用動作名（受理審核）而非狀態值（審核中）；標單工項頁新增「搜尋工項」（項次或名稱，關鍵字存 URL `?q=`，只列符合列與所屬各層並標記符合列、找不到明說、清除回原展開；手機章節摘要不套用）；施工日誌未存檔時明說「先存檔即可直接上傳照片（不辨識）」；品質／工安頁底部「狀態機」改為「改善順序」。不刪任何未儲存、未附檔、AI 暫存或責任方資訊。
- 輸入與資訊可信度補強包 A（2026-09-16，依 Codex 實測報告 W01–W04）：`unsavedEdits` 新增站內離頁保護——有未存檔登記（施工日誌、自主檢查表）時，點任何站內連結先確認，取消留在原頁，確認後清登記並放行原連結（保留 Link state）；同路徑只改 query、外部連結、修飾鍵點擊不攔；瀏覽器返回鍵與程式 `navigate()` 不經此保護，日誌「列印公定格式日誌」自行確認。送審詳情的監造摘要：再送後尚未受理（已提送）才標「上次退回原因」，受理／審定後改標「最新審查意見」並註明歷次退回原因未另行留存（`review_note` 只有最新一則）。自主檢查表在編輯判定旁、存檔訊息、紀錄列、查驗申請檢附選項與查驗詳情都顯示覆蓋程度「已檢 n／總數，m 項未檢」（`qc.js` 的 `checklistCoverage`，不改 `overall` 與提送資格）。監造報表意見草稿改為只寫資料能支持的數量與現況，到場、促請、品質符合等判斷改為「請補充」由人填；Demo 估驗佐證包草稿依 `photo_count` 說明有無照片，零張時寫「尚未檢附現場照片」（正式 Edge 生成未改）。
- 跨角色收尾（2026-09-15 UIUX 階段 6）：送審、疑義、變更設計、提醒中心的關鍵字與分段篩選都存 URL（共用 `src/lib/useUrlFilters.js`），只放可分享的識別；日誌待辦直達 `/site-log?d=`，切日期同步 URL；清單／詳情殼的深連結指到不存在的單據時回報 `missingId`、移除失效參數並改選預設，四頁顯示說明；從單據返回今日待辦而原項已離開清單時顯示說明。機關首頁角色摘要改為「登錄付款紀錄」。驗收矩陣、文案核對與真人測試腳本見 `docs/reviews/2026-09-15-uiux-stage6-acceptance.md`；真人驗收與正式後端未測。
- 驗收當前階段與下一步（2026-09-15 UIUX 階段 5C）：驗收待辦深連結改帶 `?stage=<階段鍵>`；驗收頁新增「目前階段」卡（當前關、法定期限、主辦、可登錄者、前置階段完成日、依據、依角色的下一步與「前往登錄」聚焦），時間軸當前列標 `aria-current="step"` 並在深連結指到當前階段時捲到該列。深連結指到已完成、尚未輪到或不存在的階段只顯示說明（含目前階段），不在別的階段開編輯。登錄前顯示核對句「將登錄：階段 · 日期 · 結果」（結果未選明寫尚未選，不預選合格）；登錄成功後顯示「已登錄 … 下一階段：…（責任方，期限）」。期限演算法、階段順序、可登錄角色與改善／複驗推導未改。
- 機關變更核定的資訊順序（2026-09-15 UIUX 階段 5B）：變更設計詳情依「目前責任與事由 → 已知金額影響 → 明細（相對原契約）→ 本系統未登錄 → 核定動作」排列。摘要區依狀態與角色標「輪到你受理審查／待監造受理審查／待你核定／待機關核定／已核准／已駁回」，列事由、理由（未填寫則明說）、淨額與明細筆數，待核定件由 store 的變更後契約金額加淨額確定推導「核准後變更後契約金額將為」；工期影響、監造審查意見、附件三項固定明寫未登錄／未提供／無（資料模型無此欄位，不由 AI 補）。機關核准／駁回各加共用確認框，內容指向單據編號、淨額與核准後金額，取消不寫入；受理／退回（監造）、編輯與刪除（廠商）、核定順序、金額公式、凍結與撤銷限制未改。清單頁的全案四張金額卡移到清單與詳情之後，標「全案金額（只計已核准變更）」。
- 請款收款逐欄保存回饋（2026-09-15 UIUX 階段 5A）：沿用逐欄 `onBlur` 寫入與既有前置條件（未核定鎖定、收款日需先有請款日、實收需先有收款日）。頁面明示「離開欄位後即儲存該欄，三欄各自寫入」；每次寫入在欄位下方顯示儲存中／已儲存／未儲存（失敗時輸入值留在框內、註明正式值仍是什麼、可「還原」或修正後再離開欄位重試）；日期驗證失敗不打 API、同樣標未儲存；溢收確認取消時輸入框拉回正式值並說「已取消，未儲存」；缺前置日期就近提示。指定期別進入時，表只列該期並以「第 n 期請款／收款登錄」為題，統計卡另標「全案累計（已核定期別，共 n 期）」，匯出鈕標「全案 n 期」；不存在的期別不列任何列並說明未變更紀錄。頁首明示此頁只登錄紀錄、系統不執行付款。金額計算、角色權限、手機唯讀規則未改。
- 監造送審審查順序（2026-09-15 UIUX 階段 4）：送審詳情對可審定者依工作順序排列——狀態列 → 結果提示 → 「待受理／待審定 · Rev.n 首次提送／補正再送」摘要（為何輪到我、上次退回原因取 `review_note`、本次補正說明取 `attachment_note` 最後一行「補正(Rev.n):」，沒有就明寫）→ 編號與 MetaGrid → 文件與提送方式（含 AI 助手：兩項能力各附資料範圍與「結果只保留在本頁」，功能關閉或未上傳文件本體時如實說明，無 AI 仍可審定）→ AI 結果區 → 「審查意見與決定」（受理段：受理審核／退回補正；審定段：核准／核備／退回補正／駁回，附退回與駁回後果說明）。合法轉移、對話框與必填原因不變，頁面另加空白原因不寫入的檢查。決定成功後留下結果與下一責任方，「下一件待審（n）」由人點才換單；回原佇列由頁首「返回今日工作」與左欄清單承擔。疑義與查驗詳情未改，另列下一包。
- 廠商每日填報的資訊層級（2026-09-15 UIUX 階段 3C）：施工日誌可編視角的區塊順序改為「日期＋保存狀態章（本日尚無日誌／未存檔／存檔中／已存檔 HH:MM，時間為本次存檔時刻）＋帶入天氣／複製昨日 → 天氣與摘要 → AI 草稿卡（仍標草稿、須人存檔）→ 本日施作數量 → 現場照片（併入本日日誌卡；唯讀視角維持獨立卡）→ 公定格式欄位（預設收合，摘要列顯示已填列數與『尚未填：出工人數／機具使用／材料使用』的展開入口）→ 貼底存檔列（桌機也 sticky）」。切日期有未存檔輸入先確認，取消留在原日期；未存檔輸入登記到 `unsavedEdits`（切案先問、重新整理由瀏覽器提示）。照片上傳／刪除的結果只顯示在照片區（成功幾張、第幾張失敗），日誌存檔結果只在存檔列。dirty 保護、複製昨日、照片草稿、列印、正式輸出欄位與估驗數量來源未改。
- 廠商品質流程與未存檔保護（2026-09-15 UIUX 階段 3B）：品質頁分段寫進 URL `?seg=`（inspections／defects／observations／checklist／samples），單條參數仍優先決定分段；自主檢查表分段常駐掛載、非當前只隱藏，切分段或點佇列不再卸載編輯中的實測值與更正原因，`key` 綁專案／身分，換案即重置。未存檔輸入（實測值、位置、更正原因、工項）登記到 `src/lib/unsavedEdits.js`（不存內容、不跨頁恢復）：分段 chip 標「未存檔」、表單內提示、取消先確認、重新整理／關閉由瀏覽器 `beforeunload` 提示、頂欄切換／新增專案先確認；側欄換頁與瀏覽器返回仍不攔（HashRouter 無 `useBlocker`）。自主檢查 → 申請查驗維持預填工項與現行版檢附；送出失敗表單與檢附留著；成功顯示「已送出、已檢附 … 、等待監造現場查驗」並選中新查驗（`createInspection` 回傳新 id）。自動判定、缺失建立、修訂證據凍結與權限未改。
- 廠商送審提送與補正（2026-09-15 UIUX 階段 3A）：建立後仍即為「已提送」，無草稿狀態。新建成功自動選中該筆並在詳情顯示「提送紀錄已建立」與附件狀態；詳情的「文件與提送方式」區同時放附件說明、由 `attachment_note` 的「補正(Rev.n):」行拆出的補正紀錄、文件本體與上傳／更換、外部提送說明；表單明示建立紀錄與上傳文件是兩個步驟。退回補正件（廠商）在詳情頂端先看退回原因、目前版次與附件狀態，「修正再送」就在該區塊內（動作列不再重複）。上傳失敗只顯示失敗且附件狀態不變、可重選；上傳成功與再送成功各自只描述完成的部分（再送顯示新版次與等待監造受理）。結果提示只存在本頁 state；`review_note` 只有最新一次退回原因，歷次原因不可分列。
- 操作可信度（2026-09-15 UIUX 階段 1）：驗收需結果的階段必須明選合格／不合格，未選不發寫入並就近提示；新送審／新疑義建立失敗時表單與輸入（含圖面標註）保留、錯誤可重試、送出中不可連點，成功才收表單並選中新紀錄（`createSubmittal`／`createRfi` 回傳新 id）；送審 AI 助手文案明示結果只保留在本頁，離頁需重新執行（無背景任務或結果持久化）；驗收頁首保留專案名稱，疑義與付款的角色提示只描述既有動作。
- 預定進度在首頁、進度頁、稽核、監造報告、跨案總覽與 AI 資料共用 `src/lib/progressPlan.js`。沿用月份座標、30 天換算與線性內插；不變更 S 曲線產生或 DB 計算。
- 公開頁 `/security`、`/terms`、`/privacy`（條款／隱私為 0.9 草稿，待律師審閱）。帳號安全 `/account`：兩步驟驗證（Supabase TOTP）每帳號自選；有已驗證因子時登入頁在 aal1 停在驗證碼畫面（`mfaRequired`），通過後才載入 profile。RLS 未依 aal 分級，這層是 UX 閘門。

### 6.2 驗證

當前結果與指令只見 [BASELINE](docs/BASELINE.md)。單元、Demo E2E、本機真後端 E2E 固定資料模式、pgTAP、17 支 Edge 的 Deno 型別檢查均通過；2026-09-17 P4a 新增一支只含純函式的 migration `20260917120000`（已套正式，見 §6.3），其餘未動 migration。真模型抽取仍未驗，抽取準確率／召回率未用真契約量測；`completed` 不代表語意正確。真人手機輪與真案三角色實機驗收仍待完成。

### 6.3 正式環境最後核對（不是即時狀態）

- **2026-09-17 P2a 現場文書家族資料層（D-026）**：PR #109 已合併（merge commit `3f2a00a`，分支 `codex/slimming-p2a-field-docs`）。PR 檢查 CI／pgTAP 皆通過（pgTAP 從零套用 42 檔 1,346 通過，新增 `field_documents.sql` 215 條；單元 120 檔 1,259 項）。同日 `supabase db push` 套用 `20260917201000_field_documents`：新增 `photo_intakes`、`field_documents`／`_versions`／`_signatures`／`_submissions` 五表（RLS＋欄位級 grants＋六支 guard＋四支稽核 trigger）、`photos` 加七欄與 `photos_org_stamp`（上傳方由伺服器決定）、`photos` 的 insert／update 改欄位級 grant（既有欄全保留、AI 欄只有 service 可寫）；`migration list --linked` 核對本地與遠端 62 筆全部對齊。正式庫唯讀核對：5 表、10 支 trigger、9 條 policy 就位；authenticated 對 `field_documents` 無 UPDATE、只有 `doc_type` 等六欄的 INSERT、對版本／簽署／提送表無任何寫入；`photos` 的 `uploader_org`／`ai_status` 客戶端不可寫、`caption` 仍可改；anon 不可讀；既有 2 筆照片的 `uploader_org` 皆由上傳者 profile 回填、0 筆未知。不含 Edge 或前端功能（`auditEvents.js` 只加標籤）；P2b／P2c／P2d 之前這些表沒有任何寫入端，對現有流程零行為影響。
- **2026-09-17 P4a 監造確認量純計算層（D-026）**：PR #103 已合併（merge commit `591570c`，分支 `codex/slimming-p4a-calc`）。PR 檢查 CI／pgTAP 皆通過（pgTAP 從零套用 41 檔 1,131 通過，新增 `confirmed_quantity_calc.sql` 83 條）。同日 `supabase db push` 套用 `20260917120000_confirmed_quantity_calc`（只新增 2 型別＋14 支 IMMUTABLE／security invoker 純函式，不動任何表、trigger、policy 或資料列）；`migration list --linked` 核對本地與遠端 61 筆全部對齊；正式庫唯讀核對 14 支函式皆 IMMUTABLE、security invoker，anon／authenticated 均不可執行。不含 Edge 或前端變更；P4b 之前這些函式沒有任何呼叫端，對現有流程零行為影響。使用者同日對續接清單 §6 的答覆記入 D-026 第 7 點。
- **2026-09-17 瘦身 P1c＋P1d 文案對齊四主入口與手機抽屜斷點缺陷（D-026）**：PR #108 已合併（merge commit `f6ba60c`，分支 `codex/slimming-p1cd`）。PR 檢查與合併後 main 的 CI、pgTAP 皆通過（120 檔 1,263 項單元；Demo E2E 含新增抽屜斷點測試）；前端由 Workers Builds 自動建置，合併後 `npm run check:prod` app／demo 皆 200、CSP `script-src 'self'`、無注入腳本，正式主 chunk 已不含舊「常用工作」文案。純前端文案與 Layout 抽屜狀態推導＋文件，不含 DB migration 或 Edge 部署；demo 站未重佈（待 P1b 後一次重佈）；正式站登入後流程與真人驗收未核對。
- **2026-09-17 瘦身 P1a 導覽重組（D-026 四主入口）**：PR #104 已合併（merge commit `33d0f70`，分支 `codex/slimming-p1a-nav`）。PR 檢查與合併後 main 的 CI、pgTAP 皆通過（120 檔 1,255 項單元、10 支 71 項 Demo E2E）；前端由 Workers Builds 自動建置，合併後 `npm run check:prod` app／demo 皆 200、CSP `script-src 'self'`、無注入腳本，正式站 bundle 已含新導覽（現場總覽／文件往來）。純前端，不含 DB migration 或 Edge 部署；demo 站未重佈（仍為舊導覽）；正式站登入後流程與真人驗收未核對。
- **2026-09-16 補強包 A（Codex 實測 W01–W04）**：PR #88 已合併（merge commit `2fb555a`，分支 `fix/uiux-package-a`）。PR 檢查 unit／e2e／pgtap／Workers Builds 與合併後 main 的 CI、pgTAP 皆通過（116 檔 1,226 項單元、52 項相關 Demo E2E）；前端由 Cloudflare 自動建置，不含 DB migration 或 Edge 部署；正式站登入後流程與真人驗收未核對。Codex 報告已隨 PR #87 入庫。
- **2026-09-16 補強包 B（Codex 實測 W05／W06／W08／D01）**：PR #90 已合併（merge commit `fe0e1bd`，分支 `fix/uiux-package-b`）。PR 檢查 unit／e2e／pgtap／Workers Builds 與合併後 main 的 CI、pgTAP 皆通過（116 檔 1,228 項單元、55 項相關 Demo E2E）；前端由 Cloudflare 自動建置，不含 DB migration 或 Edge 部署；正式站登入後流程與真人驗收未核對。
- **2026-09-16 補強包 C（Codex 實測 W07／W09）**：PR #92 已合併（merge commit `e54d39a`，分支 `fix/uiux-package-c`）。PR 檢查 unit／e2e／pgtap／Workers Builds 與合併後 main 的 CI、pgTAP 皆通過（116 檔 1,228 項單元、45 項相關 Demo E2E）；內容為 W09 文案與 W07 口徑對照文件，不含進度公式、DB migration 或 Edge 部署；W07 標示文案待 C1 決策後另行實作。
- **2026-09-16 補強包 C 第二批（進度口徑 D-024）**：PR #94 已合併（merge commit `11846ca`，分支 `fix/uiux-package-c2`）。PR 檢查 unit／e2e／pgtap／Workers Builds 與合併後 main 的 CI、pgTAP 皆通過（118 檔 1,239 項單元、60 項相關 Demo E2E）；前端由 Cloudflare 自動建置，不含 DB migration 或 Edge 部署（`portfolio_summary` 未改）；正式站登入後流程與真人驗收未核對。
- **2026-09-16 小包 D（Codex §5 版面與操作感受）**：PR #96 已合併（merge commit `0d9cce1`，分支 `fix/uiux-package-d`）。PR 檢查 unit／e2e／pgtap／Workers Builds 與合併後 main 的 CI、pgTAP 皆通過（119 檔 1,241 項單元、59 項相關 Demo E2E）；純前端版面與文案，不含 DB migration 或 Edge 部署；正式站登入後流程與真人驗收未核對。
- **2026-09-16 線上 demo 站**：新增 Cloudflare Worker `pmis-demo`（Free 方案靜態資產，使用者核准），網址 `https://pmis-demo.ryanxhuang1212.workers.dev`，以 main `1d15b42` 用 `VITE_SUPABASE_URL=`、`VITE_SUPABASE_ANON_KEY=`、`VITE_SENTRY_DSN=` 建置後 `wrangler deploy --name pmis-demo`（Version `1678943e`）。已核對：登入頁出現三角色鈕、監造登入落首頁、無 console 錯誤、bundle 不含 Supabase 網址。不隨 main 自動更新，重佈指令見 DEVELOPMENT。同日綁自訂網域 `https://demo.gov-agent.ai`（`wrangler.demo.jsonc` 的 `routes[].custom_domain`，Version `e70fbfdc`），已核對 200、登入頁三角色鈕、無 console 錯誤；workers.dev 網址保留為備援。
- **2026-09-16 Cloudflare Web Analytics 改手動載入（D-025）**：`gov-agent.ai` zone 的站設定由「Enable, excluding EU」改為「Enable with JS Snippet installation」，邊緣不再對任何主機注入 beacon；`npm run check:prod` 核對 app 與 demo 皆 200、CSP `script-src 'self'`、HTML 無 `cf-beacon`。行銷站（`PMIS.marketing`）改由 `Base.astro` 明示載入 beacon 並加 meta CSP，隨 GitHub Pages 部署。
- **2026-09-15 UIUX 階段 1–6（桌機三角色流程）**：PR #85 已合併（merge commit `afdaefb`，分支 `ui/uiux-stages-1-6`）。PR 檢查 unit／e2e／pgtap／Workers Builds 與合併後 main 的 CI、pgTAP 皆通過（114 檔 1,218 項單元、10 檔 70 項 Demo E2E、lint／build／check:docs）；前端由 Cloudflare 自動建置，建置版本以 Cloudflare 後台為準。前端變更，不含 DB migration 或 Edge 部署；正式站登入後流程與真人驗收未核對。
- **2026-09-14 UIUX 工作包**：已隨 PR #83 合併（`7156aef`）。前端變更，不含 DB migration 或 Edge 部署。

- **DB**：2026-09-17 `supabase db push` 先後套用 `20260917120000_confirmed_quantity_calc`（P4a 純函式）與 `20260917201000_field_documents`（P2a 現場文書資料層）；`migration list --linked` 核對本地與遠端 62 筆全部對齊，最新 `20260917201000`。前一次 2026-09-11 套用 `20260911100000_demo_requests_revoke_grants`、`20260911100100_contract_parse_retire`、`20260911110000_project_admin_single_source`。
- **Edge**：2026-09-11 以 `--use-api` 從 main（含 `_shared/` 重構）重佈全部 17 支；`functions list` 核對每支版本均 +1（agent-run 14、extract-requirements 13、send-reminders 16、classify-document 3 等）。線上另有 `demo-request` 一支由行銷站 repo 部署，不在本 repo。
- **前端**：main 每次合併由 Cloudflare Workers 自動建置。2026-09-11 PR #64（`8be082a`）建置版本 `fc99c933-32f5-47c6-b0e6-726e50b2956e`，首頁 HEAD 200、七項安全標頭齊全；同日 PR #67／#69／#70／#76／#78 及 2026-09-12 PR #79 陸續合併，各次建置版本未逐一記錄，以 Cloudflare 後台為準。這不代表登入後業務流程或正式後端已驗證。
- **舊站**：2026-09-11 GitHub Pages API 仍回 built，來源為 `gh-pages`；此部署分支保留。`pmis.pages.dev` 最後核對為 2026-09-07，退場待另行處理。
- 部署依 [runbook](docs/operations/deploy.md) 執行；套用後在本節記日期、migration／Edge 版本與驗證。2026-09-11 已完成三面同步：前端由 main 自動部署、DB 三支 migration 套用、17 支 Edge 重佈；登入後業務流程與真模型抽取仍未在正式站實測。

### 6.4 主要機制

- 建案後進專案文件。Dashboard 初始化為五步（含開工日）；AI 步驟只看存在 completed run，正式模式不因三方未齊而鎖住。D-014 舊四步條文仍待正式修訂。
- 標單匯入／重設走單一交易 RPC；真正專案與已載入 DB 標單是兩種模式，不能將 Demo 工項寫入真專案。
- `/agent` 是完整 AI 入口，Copilot 是薄入口，`/assistant` 導向 `/agent`。DB `ai_features` 為執行期權威，前端／Edge 各有鏡像。
- 文件：上傳 → 確定性分類（AI 第二意見）→ 契約包 → 抽取。原始檔凍結，私有 bucket，讀取留痕失敗時拒絕；刪檔走 `delete_document` RPC。processing／ingestion 分別有 20／10 分鐘過期時鐘。
- 抽取可跨 request 續跑，逐頁檢查 exact count／連續頁序／page_count；缺頁不開始抽取，無文字／無效輸出／截斷揭露部分完成，partial 契約包不算 ready。24 批上限、OCR 與語意漏抽未解。
- `/requirements` 為三方履約時程，`/requirements/review` 為擷取審核，`/deadlines` 管期限／罰則／基準日。D-018 RLS 保護契約分級；可見範圍的前端 `VISIBLE` shim 仍保留，動作依歸屬。
- 照片辨識只回填日誌草稿，仍須人存檔；查驗可檢附自檢表；試體 28 天不合格與開缺失同交易並去重。`audit_events` append-only。

### 6.5 資料存取

跨頁資料由 `store.jsx`／slices 管理；單頁有界資料可直接查 Supabase。目前直接查詢頁為 Contract、Requirements、RequirementsReview、Activity、Dashboard。契約共用查詢配方在 `useContractEnrichment`，不是共用狀態。重複計算／查詢放 lib；業務日期用 `dates.js`，金額格式用 `format.js`。

## 7. 仍存在的限制

- 前端／Edge 的待辦涵蓋類型與期限條件有差異（機關責任期限已進首頁，Edge 早報仍缺變更／查驗／觀察）。循環履約沒有逐期資料。詳見 [雙引擎](docs/architecture/dual-engine-sync.md)。
- 正式且已匯標單的專案是否缺一般成員頁入口，待實測確認。
- obligation runtime、雙成員相容欄位與 `VISIBLE` shim 仍有使用端，不可直接刪除。
- rollback 檔僅覆蓋少數，存在檔案不代表回復演練通過。部分領域狀態欄無 CHECK，processing run 無轉移 guard。
- 唯讀 Agent 呼叫軌跡不落庫。其餘已知缺口與待決事項集中 [ROADMAP](docs/ROADMAP.md)。

## 8. 文件權威

流程看 DEVELOPMENT；現況看本檔與程式／migration；目標看 DECISIONS／ACTIVE 架構；續接看 ROADMAP；測試看 BASELINE。UI 規範與長期北極星按任務讀。過期報告／handoff 已移除，原文可用 `git show c39e395:<路徑>` 追溯；不再當現行規格。
