# 產品瘦身：四主入口、退場承接、契約時程對齊與過渡部署

> 狀態：**PROPOSED（P0 設計）**｜2026-09-17｜依 [D-026](../DECISIONS.md)；需求依據 [瘦身報告](../reviews/2026-09-17-product-slimming-report.md) 與 [實作指令](../reviews/2026-09-17-claude-product-slimming-prompt.md)。進度只看 [續接清單](../reviews/2026-09-17-product-slimming-worklog.md)。
> 標記：【已確認】／【設計】／【待決】同 [現場文書文件](field-documents-lifecycle.md)。

## 0. 範圍

本文件處理：四主入口與路由對照、退場模組的承接與清理順序、融入核心流程的模組、契約時程與提醒對齊、舊資料過渡與回復、DB／Edge／前端相容部署順序。文書與計價的資料設計見另兩份文件。

## 1. 四主入口與路由對照【已確認 入口，設計 對照】

`navConfig.js` 仍是唯一登記表（D-013 fail-closed）；瘦身改 `navGroups` 分組與 `hidden`，**不刪路由定義、不改 `roles`**。

| 主入口 | 群組入口路由 | 子頁（依角色過濾） | 現況來源 |
|---|---|---|---|
| 今日工作 | `/dashboard`（`?ball=` 三桶） | — | 既有收件匣；加入文書待補／待簽／待收件／退回 |
| 現場紀錄 | `/site`（新，上傳與文書清單） | `/site-log` 施工日誌、`/supervisor-log` 監造日誌（監造，新）、`/quality` 品質（查驗／自檢／試體／缺失）、`/safety` 工安、`/itp` 停留點 | 「現場與品質」群組改名擴充 |
| 履約時程 | `/requirements` | `/deadlines` 期限追蹤、`/requirements/review` 擷取審核、`/change-orders` 變更設計、`/progress` 進度、`/acceptance` 驗收、`/schedule` 逐工項排程（承接完成前保留、之後 hidden） | 「契約重點」參考項升為主入口；「審查與協作」的變更設計移入 |
| 估驗請款 | `/valuation` | `/payments` 請款收款（廠商／機關）、`/valuation/package` 佐證包（print）、`/boq` 標單工項 | 「進度與金流」去掉成本／排程 |

次入口（側欄「更多／專案資料」）：`/contract` 專案文件、`/members` 三方成員、`/activity` 活動紀錄、`/submittals` 送審文件、`/rfi` 工程疑義、`/monthly-report` 施工月報、`/supervisor-report`（改名「監造月報」，與監造日誌分開）、`/portfolio`（縮為選案清單）、`/agent`、`/account`、`/admin`（平台）。`/alerts` 保留深連結，入口併入今日工作篩選。

深連結保證：所有既有 `?inspection=`／`?period=`／`?submittal=`／`?d=`／`?stage=`／`?obligation=` 參數不變；`hidden` 項仍受 `roles` 守衛；提醒信舊連結（`/alerts`、`/deadlines?obligation=`）維持。新增 `/site?intake=<id>`、`/site?doc=<id>` 直達文件。**P2c 落地**：`/site?intake=<id>` 展開該上傳批次；`/site?doc=<id>`（今日工作／Agent 的現場文書待辦帶這個）落到 `/site` 後，施工日誌轉到 `/site-log?doc=<id>`、監造日誌轉到 `/supervisor-log?doc=<id>`（P3a；保留 `state` 的返回來源；頁面路由只登記在 `lib/fieldDocs.docPagePath`），自檢表／查驗表單 P3b／P3c 前留在 `/site` 清單並標「頁面尚未支援」；`/site-log` 與 `/supervisor-log` 都接受 `?d=`（日期）與 `?doc=`（文件），`/supervisor-log/print` 為列印路由（`surface: print`）。

**P1a 落地結果（2026-09-17，與上表的差異）**：側欄分區為「今日工作（球權三來源）→ 工作（三主入口群組）→ 專案資料 → 平台」。次入口不做扁平的「更多」，而是兩個群組：「文件往來」（送審文件／工程疑義／施工月報／監造月報）與「專案」（專案文件／三方成員／活動紀錄／跨案總覽；風險稽核 hidden）——月報在導覽上放文件往來，同時在 `/site`「本月文件」給入口（§3 的落點仍成立）。`/site` 的第一個子頁標籤為「現場總覽」；P1a 的 `/site` 只列既有現場作業入口、件數、現場待辦與本月文件，照片上傳與文書清單留給 P2c。`/supervisor-log` 已於 P3a 頁面建好時登記為「現場紀錄」群組子頁（不限角色：監造可寫、專案成員唯讀，伺服器 RLS／RPC 是邊界）。`/cost`、`/audit` 已 hidden（P1b 已唯讀化，見 §2 各節「P1b 落地結果」）；`/schedule` 自 P5d 起 hidden（關鍵工項承接到履約時程後唯讀，見 §2.4「P5d 落地結果」）。手機底欄＝現在輪到我＋三主入口＋更多（`roleWorkLinks` 回傳群組項，子頁也算選取），P1c 只剩文案。

## 2. 退場承接清單【已確認 範圍】

「退場」＝停止作為新作業工具；不刪正式歷史資料、不 drop 表（D-026）。每項列現況使用端、承接、清理順序。

### 2.1 成本管理 `/cost`

- 使用端：`Cost.jsx`、`ledger.js`（`costItems` CRUD）、`db.js loadCostItemsFromDB`、`store.jsx`、`Dashboard.jsx exportAll`（整案匯出含 `cost_items`）、`demoSeed.js`、`e2e/owner.spec.js`（監造進不了 `/cost`）、`e2e/a11y.spec.js`、`ledger.test.js`；DB `cost_items`（RLS `can_access_contractor_private`，監造／機關不可讀）。正式資料 11 列／4 案。
- 承接：頁面改為**唯讀查閱＋CSV 匯出**（移除新增／編輯／刪除控制，store 只保留 load），`hidden: true`、`roles: ['contractor']` 不變；`exportAll` 仍含成本（廠商自己的匯出）。
- 清理順序：P1b 唯讀化→P6b 移除 CRUD、Demo 種子、寫入測試；表與 RLS 保留（歷史可查）。不動標單單價、保留款、估驗與付款。
- **P1b 落地結果（2026-09-17）**：退場由資料庫強制，不只拿掉按鈕——migration `20260917210000_cost_items_retire` 收回 anon／authenticated 對 `cost_items` 的 INSERT／UPDATE／DELETE 表級 grant，並把原 `for all` policy 換成只有 SELECT 的 `cost_items_contractor_read`（讀取條件 `can_access_contractor_private` 一字不改；監造／機關仍讀不到廠商成本；service_role 仍可寫供修復）；rollback 檔 `supabase/rollbacks/20260917210000_cost_items_retire.down.sql`；pgTAP `cost_items_retired.sql` 24 條（grant／policy 形狀、三角色＋專案管理者＋非成員的讀寫矩陣、歷史列無損），`p0_05_audit_events.sql` 的廠商更新改為斷言 42501。前端 `Cost.jsx` 只剩統計、分類、搜尋／快篩與 CSV 匯出（新增欄「備註」），頁首標「歷史查閱」並以 `role=note` 說明退場；`ledger.js`／`store.jsx` 不再暴露 `createCostItem`／`updateCostItem`／`deleteCostItem`（`ledger.test.js` 釘住），CRUD 與其測試已在本單元移除，P6b 不再有成本寫入可刪。Demo 種子的成本歷史保留（唯讀示範）；`Dashboard.exportAll` 仍含成本。

### 2.2 跨案總覽 `/portfolio`

- 使用端：`Portfolio.jsx`、`projects.js loadPortfolio`（RPC `portfolio_summary`）、`portfolioExceptions.js`、`DEMO_PORTFOLIO`、`e2e/owner.spec.js`／`a11y.spec.js`。
- 承接：縮為「選案清單」（案名、角色、待我處理件數、最近活動），移除統計／例外分析卡；`portfolio_summary` RPC 保留供清單件數（D-024 已知它取最新期，不再擴充）。
- 清理：P1b 縮頁→P6b 移除 `portfolioExceptions.js` 與測試、Demo 姊妹案靜態資料；RPC 不刪。
- **P1b 落地結果（2026-09-17）**：`Portfolio.jsx` 改為選案清單（`role=list` 「專案清單」：案名／代碼／狀態／目前專案章、未結缺失／待查驗／待核定變更三個件數、最近估驗期與狀態；整列可點切換到該案的今日工作），進度條、累計估驗金額、預定 vs 實際、驗收階段與例外彙總帶全部移除；`portfolioExceptions.js` 與測試已於本單元刪除（不留無人使用的模組），`DEMO_PORTFOLIO` 只剩清單需要的欄位（`Acceptance.jsx` 仍讀 `[0].name`）。`portfolio_summary` RPC 未改（回傳欄位多於清單所需，D-024 已知取最新期，不擴充）；載入失敗仍顯示橫幅＋重試、卡頭不假稱總數（`Portfolio.error.test.jsx`）。E2E B-02 跨頁一致改以施工月報作第三面。

### 2.3 風險稽核 `/audit`＋`audit.summary`

- 使用端：`RiskAudit.jsx`（`riskAudit.js` 檢核表＋`integrityAudit.js` 勾稽鏈＋`auditSummary` AI）、`Agent.jsx` 連結、`integrityAuditTool.ts`（Agent `run_integrity_audit`，監造／機關）、Edge `audit-summary`、`site.js auditSummary`、AI 註冊三處。正式 `audit.summary` 用量 0 筆。
- 承接【已確認】：估驗所需檢核移入估驗流程——`integrityAudit.js` 的「估驗超前日誌」「澆置無試體」「查驗缺漏」在估驗頁逐工項就地顯示（P4c），送審前列「缺件」；`riskAudit.js` 的契約／變更面向由履約時程承接。Agent `run_integrity_audit` 保留（仍有用途）。
- 退場：`audit.summary` 功能列以 migration 關閉（`enabled=false`，比照 `20260911100100_contract_parse_retire`），Edge 與用量歷史保留；`/audit` `hidden`，頁面改為唯讀提示並導向估驗頁對應項；P6c 後移除頁面與 `auditSummary` store 路徑。`audit_events` 完全不動。
- **P1b 落地結果（2026-09-17）**：估驗所需檢核已接到估驗流程——新增 `src/lib/valuationChecks.js`（`buildValuationChecks`：把 store 的標單／日誌／查驗／試體與「指定期別」的累計量組成 `buildIntegrityFindings` 的六個輸入；單元測試釘組法），`Valuation.jsx` 逐期渲染「本期勾稽檢核」卡（`role=list`；估驗超前日誌、無日誌佐證、查驗不合格仍計價、澆置無試體、試體不合格、接近完成未查驗；品質面向給「前往品質查驗」），`RiskAudit.jsx` 改用同一支組裝檢核最新期（先前兩頁各組一份會分岔）。`/audit` 保持 hidden＋僅機關，頁首改「唯讀查閱」並以 `role=note` 說明退場與導向估驗計價；契約／變更／進度三個檢核表面向暫留該頁唯讀，承接到履約時程後隨頁面移除（P5d／P6b）；AI 稽核意見（`audit.summary`）維持到 P6c。`Agent.jsx` 稽核提示卡的連結改指 `/valuation`（三角色可進，不再限機關），`Members.jsx` 機關權限說明不再列「風險稽核」。決策列的「超計／無佐證」逐列差異（`valuationDiff.js`）與整期勾稽發現口徑尚未合併、也未做金額控制，留 P4c（確認量表上線後才有正式「缺件」定義）。
- **P6c 落地結果（2026-09-19）**：`audit.summary` 以 migration `20260919130400_audit_summary_retire` 關閉平台總開關（只翻 `enabled`；列、用量歷史、專案覆寫不動；rollback 檔同名 `.down.sql`），pgTAP `ai_features_retired.sql` 擴為三支退場功能：關閉、pro 專案閘門拒絕、專案覆寫翻不過、`record_ai_usage` 記下的 `audit.summary` 用量（含 blocked）仍能被 `admin_ai_usage_by_feature` 以原 label 查到。前端／Edge 註冊表 `defaultEnabled=false`（`aiFeatures.test.js` 釘住三支退場鍵）；呼叫端全部移除——`site.js` 的 `auditSummary`（含 demo 模板分支）、store 匯出、`RiskAudit.jsx` 的 AI 稽核意見按鈕／區塊／狀態／錯誤橫幅（頁面其餘唯讀查閱不變，P6b 才刪頁）、`owner.spec.js` 改斷言詳情欄無任何 AI 稽核意見。**與本節原設計的差異**：Edge `audit-summary` 原始碼依原設計保留（閘門讀 DB 即時回 403、不需重佈），但它與 `assistant-chat`／`parse-contract` 三支已無呼叫端的函式原始碼移除、線上函式刪除（`supabase functions delete`，遠端資源操作由使用者執行）改列 P6b 一併處理，不留給日後零散清。`integrityAuditTool.ts`（Agent `run_integrity_audit`）不受影響。

- **P4c 落地結果（2026-09-19，PR #144）**：估驗頁的檢核改為單一口徑——`lib/valuationChecks.js` 同時組裝 DB 檢查點缺件（P4b `get_valuation_state.violations`，每代碼一項、列涉及工項與處理入口，送審前可見）、`integrityAudit.js` 六項勾稽發現（附 `keys`，決策列「超前日誌申報／無日誌申報」與明細列就地提示共用 `classifyLogDiff`）與逐工項標示；原決策列另一套「超計／無佐證」口徑 `valuationDiff.js` 刪除。`RiskAudit.jsx` 仍呼叫同一支（不帶 state，只有勾稽發現）。估驗頁卡片名由「本期勾稽檢核」改為「缺件與檢核」（`role=list` 同名）。

- **P6b 落地結果（2026-09-20，PR 見續接清單 §7 P6b-1）**：頁面、檢核表引擎與退場 Edge 原始碼移除，歷史與權限不動。
  - 移除：`RiskAudit.jsx`、`lib/riskAudit.js`（＋測試；只有這一頁用）；Edge `audit-summary`／`assistant-chat`／`parse-contract` 三支原始碼（全庫無呼叫端、閘門已關）與 `_shared/aiHandler.ts` 只為 `audit-summary` 存在的 `{ reply }` 罐頭回覆分支；`errorLeak.scan.test.ts` 的 aiJsonHandler 函式清單 13→10 支。註冊表兩份的三個退場鍵**保留**（`edgeFunction` 留原名，對齊 DB `ai_features` 列與 `ai_usage_events` 歷史的標籤），`aiFeatures.test.js` 改為「啟用中的功能目錄必須存在、退場鍵的原始碼必須不存在」。
  - 舊連結：`/audit` 改登記在 `navConfig` 非導覽表 `access: 'retired'`（`roles: ['owner']` 不變、`redirectTo: '/valuation'`）——守衛照原權限：機關導到估驗計價（「缺件與檢核」卡）、其他角色維持無權限畫面、不被導走；query 原樣帶過去。
  - 原五個檢核面向的去處（判定規則與資料都不動）：估驗→估驗計價「缺件與檢核」（P4b DB 檢查點＋`integrityAudit.js` 六項勾稽）；品質（逾期未結缺失）→品質查驗缺失分段＋今日工作 AI 觀察（`aiInsights`「N 件缺失逾期未結案」）；契約（逾期義務）→履約時程／期限追蹤＋今日工作；變更（待核定佔比）→變更設計待核定清單＋今日工作「N 件變更設計待核定」（機關／監造）；進度（落後 >5%）→進度 S 曲線＋今日工作「進度落後」。**未承接**：`riskAudit.js` 的「單期估驗金額超過前期平均 2.2 倍」趨勢提示——P4b 起每期數量由監造簽署確認量在 DB 強制，這個事後啟發式提示已被前置控制取代，不另搬；若機關仍要趨勢提示，另開單元加在估驗頁，不復活獨立稽核頁。
  - 歷史：`audit_events`、`ai_features.audit.summary` 列、用量歷史、`project_ai_overrides` 全部不動；線上 `audit-summary` 函式由使用者 2026-09-20 授權下架（`supabase functions delete audit-summary`），`assistant-chat`／`parse-contract` 線上函式尚待使用者授權。

### 2.4 逐工項排程 `/schedule`

- 使用端：`Schedule.jsx`、`ledger.js setItemSchedule/removeItemSchedule`、`db.js loadItemSchedulesFromDB`、`Dashboard.jsx exportAll`、`demoSeed.js`、`draftDailyLog.ts`（註解說明無排程量欄位）、`e2e/a11y.spec.js`；DB `item_schedules`（正式 4 列／4 案）。
- 承接【已確認 順序】：關鍵工項日期進履約時程——`item_schedules` 既有 `planned_start/planned_finish` 直接在 `/requirements` 顯示為「關鍵工項」時間軸列（唯讀＋少量維護），資料不搬表；`schedule_periods`（S 曲線）不屬退場，`/progress` 保留。
- 清理：P5d 承接完成且 E2E 通過後 `hidden`→P6b 移除頁面、store 寫入、Demo 種子；表保留。
- **P5d 落地結果（2026-09-19）**：承接＝關鍵工項與停留點進履約時程的**同一條時間軸**，不是另開一段：`src/lib/keyWorkItems.js`（落後判定 `deriveWorkItemState` 自 `Schedule.jsx` 抽出、完成% 仍取最新一期估驗累計 ÷ 契約數量；停留點狀態沿用 `lib/itp.js`，「施作中未叫驗」H 紅／W 黃與 `/itp` 同一條規則）把 `item_schedules` 的每一項與 `inspection_points` 的每一點各變成一個事項（id `wi:<item_key>`／`itp:<id>`，五色語意鍵與契約義務同一套、Badge 文字仍是各自的領域字：落後／進行中／未申請查驗…），`/requirements` 的清單、狀態快篩、類型下拉、搜尋與詳情都吃同一份。關鍵工項的**少量維護**在事項詳情（廠商或非正式模式管理者：計畫起迄兩個日期欄、移除；摘要卡有「加入關鍵工項」搜尋，桌機），寫入仍走 store 的 `setItemSchedule`／`removeItemSchedule`（ref 累積＋debounce 合併同工項起訖），資料不搬表、不加欄、沒有 migration；監造／機關唯讀。停留點詳情列允收標準／頻率／出處／掛的工項與其計畫起迄／施作事實／查驗，處理入口導 `/itp?point=`（廠商申請查驗）或 `/quality?inspection=`（監造判定）。`/schedule` 改為唯讀歷史查閱（無輸入框、無加入／移除，CSV 仍在，每列「到履約時程」帶 `?item=<key>` 直達該項）並在 `navConfig` `hidden: true`（`roles` 仍只有廠商）；`/requirements?item=<work_item_key>` 由頁面換成殼的 `?obligation=wi:<key>`。指定契約範圍（`?package=`）時只列該契約的義務，不列整案的關鍵工項與停留點。P6b 才移除 `Schedule.jsx`；`item_schedules` 表與 store 寫入保留（履約時程在用）。

- **P6b 落地結果（2026-09-20，PR 見續接清單 §7 P6b-1）**：`Schedule.jsx` 與其唯讀測試移除；`/schedule` 改登記在 `navConfig` 非導覽表 `access: 'retired'`（`roles: ['contractor']` 不變、`redirectTo: '/requirements'`）——廠商導到履約時程，`/schedule?item=<work_item_key>` 由履約時程換成該項關鍵工項的直達（`?obligation=wi:<key>`），監造／機關維持無權限畫面。歷史查閱：`item_schedules` 全部列在履約時程（全期）的關鍵工項事項與摘要卡，CSV 由首頁「整案匯出」（`Dashboard.exportAll` 的 `item_schedules`）取得；`item_schedules`／`schedule_periods` 表、store 的 `setItemSchedule`／`removeItemSchedule`（履約時程在用）與 Demo 種子 `itemSchedules`（履約時程的示範資料）保留。

### 2.5 已停用 AI 路徑

`assistant.chat`、`contract.parse` 維持停用；不在本輪新增動作。P6b 起兩支的 Edge 原始碼與 `audit-summary` 一併移除（見 §2.3 P6b 落地結果），註冊鍵與 DB 列保留供用量歷史對帳。

## 3. 融入核心流程的模組（保留能力、取消常駐入口）

| 模組 | 落點 | 保留 |
|---|---|---|
| 品質（查驗／自檢／試體／缺失）、工安 | 現場紀錄 | 全部業務規則、缺失引擎、試體 trigger；文件化部分改由 [現場文書](field-documents-lifecycle.md) 承載（P6b-3：查驗「合格／不合格」快速判定與檢查表直接登錄退場，判定與自檢紀錄只由文件簽署寫入，DB 收回直接寫入；舊紀錄照常查閱） |
| ITP 停留點 | 履約時程提示＋現場紀錄一鍵申請 | 既有狀態推導；新增 `stage_key` 供多階段計價 |
| 送審文件 | 次入口＋今日工作 | 既有狀態機；**歷次退回原因**改由 `audit_events` 的 `submittal.returned` before／after 在詳情列出（不新增表、不改 `review_note` 語意）【設計】 |
| 工程疑義 | 次入口＋文件／查驗詳情「提出疑義」 | 不變 |
| 變更設計 | 履約時程／估驗「契約變更」 | D-016 不變；`Qc(W)` 計算引用已核准明細 |
| 施工月報／監造月報 | 現場紀錄「本月文件」 | 改為重用已簽署日誌／查驗（P6a）；口徑 D-024 不變 |
| 驗收結算 | 履約時程竣工／驗收階段 | 不變 |
| 進度 S 曲線 | 履約時程次要視圖 | 不變 |

**P6a 落地結果（2026-09-20，PR #153；純前端，與上表的差異與設計沒寫而必須決定的事）**：
- **「已簽署」的定義**與 DB `fn_field_document_target_signed` 相同：事實列（`daily_logs`／`supervisor_logs`／`checklist_records`／`inspections`）有任何文件以 `target_id` 指向它且有簽署列。事實列只由簽署 RPC 以被簽版本內容寫入、簽後只有簽署交易能改，所以**事實列目前的內容＝指向它的文件最晚一次簽署的版本**；月報讀事實列（`siteLogs`、當月 `supervisor_logs`、`inspections`），版本追溯取簽署列（`lib/fieldDocs.signedVersionIndex`，含已被取代的舊文件——新文件簽署前事實列仍是舊文件的版本）。不讀 `daily_logs.status`（舊流程也寫過狀態欄，不是簽署證據）。
- **施工月報**：工項數量（本月／截至月底累計）、施工天數、雨天、出工（工別人・日）只彙整已簽署施工日誌；逐日列摘要、天氣、出工與版本標示（文件短碼、版本、雜湊前 12 碼）；未簽署事實列（舊流程 12 筆屬此類）與同月尚未簽署、也還沒有事實列的草稿明列「未簽署、不列入」（`lib/reportSources.unsignedDays`）。簽署狀態讀不到時日誌類段落顯示讀取失敗、不出數字（讀取失敗不等於全部未簽署）。進度／估驗／收款三段完全沒動（D-024，`Reports.caliber.test.jsx` 原斷言照綠）。
- **監造月報**（原「監造報表」；頁名取 `navLabel('/supervisor-report')`，不另寫字串）：已簽署監造日誌（到場＝`attendance` 非空、監造事項、當日查驗、版本）、經簽署監造查驗表單的判定（`inspections.document_id` 只由簽署路徑寫）與申報／確認量、本月 `inspection_confirmations` 確認與撤銷（依據、表單版本）；未簽署監造日誌、快速判定明列不列入。意見草稿只依已簽署文件，來源未讀完不產生。監造月報不是監造日誌——每日紀錄仍是 `/supervisor-log` 文件。
- **兩張月報共用一條規則**：已簽署／未簽署分流、未簽署日期清單、日誌彙整、查驗「本月申請或本月判定」歸月（原施工月報只看申請日，與監造報表分岔）、確認量歸月都在 `lib/reportSources.js`。
- **連結**：只有「該版本就是文件目前列印的簽署版本、且文件仍在本案活文件清單」才給列印連結（列印頁只找得到活文件、只印 `printSignature`）；其餘只印版本標示，不連到會印出別的版本的頁面。
- 示範模式無法簽署（P2c 起的邊界），demo 的兩張月報如實全列未簽署。

## 4. 契約時程與提醒對齊【已確認 目標，設計 機制】

### 4.1 核心類型與責任

首頁（`todayTasks.js`）、Agent（`collectOpenBallItems`）、早報（`send-reminders`）對齊為同一份**核心類型**：送審、疑義、估驗、缺失、查驗、變更、觀察、契約義務、現場文書（待簽／待補／待核對／待提送／待收件／被退回）。**P5a 已實作**（進度見續接清單 §7），做法比原設計更進一步：

- 不只共用 fixture，而是**單一實作**：判定規則收成零 import 的 `_shared/ballInCourtRules.ts`，前端 `ballInCourt.js` 與 Edge `ballInCourt.ts` 都 import 它（放 `_shared` 是因 Edge 部署只打包該目錄，Vite 則可 import 任何路徑）。共用案例 `tests/fixtures/ball-in-court.cases.json` 仍照原設計建立，由 Vitest 前端路徑、Vitest Edge 路徑與 Deno 執行期（`npm run test:edge`）三側同讀。
- `responsible` 無法辨識：兩側都不歸任何方、列入「待補設定」（首頁一張卡、Agent 工具 `setup_pending`、早報一段，三方可見；責任方缺口導擷取審核廢止取代後補登，基準日缺口導期限追蹤）。`obligation_party()` 對三方以外回 null（migration `20260917220737`），既有 update policy 因此對三方都不放行；前端 `obligationParty` 回「待補設定」。
- 基準日缺失同理明示待補（不再靜默略過）。
- 首頁不新存任務狀態；`/requirements` 與 `/dashboard` 共用同一事項來源，只差時間範圍。現場文書由 store 於真專案載入（`loadFieldDocumentsFromDB`）。

### 4.2 循環期次

新增 `obligation_periods`（`obligation_id`, `period_key`（如 `2026-09`）, `due_date`, `anchor_version_no`, `status` 待辦／已提送／已完成／不適用, `completed_at/by`, `evidence_submittal_id`／`evidence_document_id`），由函式 `materialize_obligation_periods(project, upto)` 依 `recurring*` 規則與基準日**確定性**產生（含月末、29–31 日、跨年規則，pgTAP 釘住）；每期獨立追蹤，完成本期不清除下期，逾期舊期保留。正式資料 7 筆 monthly 義務可回填期次（不回填完成狀態）。

**P5b 已實作**（migration `20260917233000_obligation_periods`，進度見續接清單 §7），與上述設計的差異與補充：

- 期別鍵：daily `YYYY-MM-DD`、weekly ISO `IYYY-Www`、monthly `YYYY-MM`、quarterly `YYYY-Qn`、yearly `YYYY`；期間起訖與到期日由純函式（`fn_period_start/end/key/due`、`fn_obligation_period_schedule`）產生，月末夾住（每月 31 日在 4 月＝4/30、2 月＝28／29）、每季第 n 個月、每年 m 月 d 日、每週 ISO 星期幾。排程列到「今天＋31 日」為止，且永遠含今天之後的一期。
- 起算基準日：觸發點映得到就用它（award／notice／commencement／completion→專案四日期；fixed→義務 `fixed_date`），其餘（null／monthly／other）一律開工日。基準日缺或循環規則不完整（每月缺幾日等）不產生期次，改列「待補設定」（基準日／循環規則）；正式 7 筆 monthly 有 5 筆缺日、皆待補。**沒有**設計中的 `upto` 參數：對外 RPC 不收日期，避免把前瞻窗口推到未來製造假期次。
- 物化時機（不新增雲端資源）：義務插入／規則變更／廢止 trigger（廢止把仍待辦的期次一併標不適用；規則變更只重建沒動過的待辦期）、`projects` 四個基準日變更 trigger、pg_cron 每日 16:05 UTC（台北 00:05）`materialize_all_obligation_periods()`（正式庫 pg_cron 已啟用，現有 `pmis-daily-reminders` 亦走它）、成員／service 可呼叫的冪等 RPC `materialize_obligation_periods(project)`。Agent 工具層只讀。
- 狀態轉移只經 RPC `transition_obligation_period`（歸屬規則＝義務 update policy：自己方或非正式模式 admin override；證據須同案；伺服器蓋完成時間；退回待辦解除證據）；`contract_obligations` 對循環義務加 guard，不可再標已提送／已完成（舊前端／直接 REST 明確失敗）。
- 回填：既有 monthly 全部產生期次；義務層曾標完成者，有 `completed_at` 就對應含該台北日的期別（狀態、時間、人、送審佐證帶過去），推不出的義務原狀不動、已到期的待辦期次帶 `review_note`「待核對」，由三方在待補設定看到並到期限追蹤該期核對後標記。正式 7 筆皆待辦、無需對應。
- `anchor_version_no` 與停止條件自 P5c（`20260919021500`）起落地，見 §4.3：期次蓋產生時的基準日版本、基準日變更重算沒動過的期並記差異；循環只產生到「實際竣工日（驗收 confirm／report）優先、否則契約竣工日 `end_date`」為止，保固類與竣工日缺／已過而未登錄竣工者停止自動產生並列「停止條件待補」。
- 前端：`todayTasks`／Edge 收集器／Deno 共用案例都走 `obligationEntries`（每個未結期次一顆球，鍵 `契約重點:<id>:<期別>`，深連結 `/deadlines?obligation=<id>&period=<期別>`）；`contractDue.js`／`.ts` 對循環義務改讀 `ob.periods` 最早未結一期；期限追蹤頁的一列仍是一條義務，動作作用在「本期」（`?period=` 可指定），詳情列全部期次；履約時程詳情唯讀列期次並導期限追蹤逐期標記（完整 UI 在 P5d，見 §4.6）。demo 種子為三筆 monthly 義務帶上月已完成／本月／下月三期。

### 4.3 期限版本

新增 `project_anchor_versions`（`project_id`, `version_no`, `anchors jsonb`（決標／開工／停復工／展延／竣工）, `effective_from`, `reason`, `source_ref`（核准變更或函文）, `created_by/at`）；`projects.*_date` 保持為「現行值」，每次更改由 trigger 產生新版本。到期日計算引用產生期次時的 `anchor_version_no`；基準日更正後只重算尚未完成的期次並記錄差異，不改歷史。

**P5c 已實作**（migration `20260919021500_project_anchor_versions`，進度見續接清單 §7），與上述設計的差異與補充：

- 版本列欄位：`version_no`、`change_kind`（`initial` 初值／`edit` 直接修改／`suspension` 停工／`resumption` 復工／`extension` 展延／`change_order` 核准變更工期）、`anchors`（變更後四日期快照，null 保留）、`changed_keys`、`effective_from`、`reason`、`source_ref`、`source_change_order_id`（須本案）、`effects`（本版重算差異）、`created_by/at`。append-only：`authenticated` 只有 SELECT（可見性沿用專案成員），UPDATE／DELETE 一律被 guard 拒（含 service_role），只放行專案刪除 cascade。四日期仍是 `projects` 欄位的「現行值」；設計的「停復工」不另加欄位——停工／復工／展延／核准變更工期都是一版（附生效日與依據），改了竣工日就改，沒改也留版（工期依據的紀錄）。
- 留版路徑：`projects` 四個基準日的 INSERT／UPDATE trigger 自動留版（直接 REST 改也留、類別 `edit`、無依據），前端只走 RPC `update_project_anchors(project, anchors jsonb, change_kind, reason, source_ref, source_change_order_id, effective_from)`（security definer，第一行以 D-022 的 `is_project_admin()` 把關＝`projects` update policy 同一個函式；以交易內 GUC 把依據帶進 trigger；回新版本列，直接修改且值沒變回 null）。契約價金總額等非基準日設定另走直寫（`updateProjectSettings`，拒絕基準日鍵）。
- 重算只動未完成：留版時對受影響的循環義務（起算欄位或竣工日有變）逐期比對——沒動過的待辦期（無完成時間、無證據、無待核對註記）改期／移除／新增並蓋新版號，已提送／已完成／掛證據／待核對的期一律原樣保留（到期日、`basis`、原版號不變）並在 `effects` 記 `kept`；單次義務未完成的記 `rescheduled`（舊到期→新到期），已完成的記 `kept`。現行排程規則下期次到期日只看每月幾日、不看起算日，所以循環義務的差異實際是移除／新增／保留；`rescheduled` 分支保留給日後排程規則若改變時仍成立。
- 單次義務的歷史：`contract_obligations` 加 `due_date_snapshot`／`anchor_version_no`，進入已提送／已完成時由 trigger 依當時基準日留快照（client 不能寫這兩欄——欄位級 UPDATE grant 只開放 `status`／`evidence_submittal_id`），退回待辦清空；前端 `contractDue.js`／Edge `contractDue.ts` 對已完成單次義務優先讀快照（`singleDueSnapshot`），沒快照的舊資料照現行基準日算並在畫面標「完成時未留版」。
- 循環停止條件（P5b 未定義）：以現行資料可判定者為準——保固類（`category='保固'`）系統沒有保固期滿日欄位，不自動產生期次；其餘以實際竣工日（`acceptance_events` 的 `confirm`，沒有就 `report` 的 `event_date`，同階段取最後登錄）優先、否則契約竣工日 `end_date` 為界限日，只產生「期間起日 ≤ 界限日」的期；登錄／更正／清除竣工（`acceptance_events` trigger）會移除界限日之後沒動過的待辦期並補齊；竣工日缺、或竣工日已過而未登錄竣工／展延 → 停止自動產生並列「停止條件待補」（待補設定第五種 `stop`：首頁一張卡、Agent `setup_pending`、早報一段，導期限追蹤該筆／驗收頁）。界限日判不出時沒動過的待辦期同樣移除（證明不了它們該存在），界限日判得出後由冪等物化補回。DB `fn_obligation_recurrence_bound`／`fn_obligation_recurrence_stop_gap` 與共用規則 `recurrenceStopGap`／`completionDateOf` 同口徑（pgTAP 與共用案例各釘一側）。
- 回填（不偽造歷史依據）：每個已填任一基準日的專案建 version 1（`initial`、reason 註明回填、`created_by`／`effective_from` 為 null）；既有期次只在 `basis` 的起算日等於 v1 快照時才蓋 `anchor_version_no=1`；已完成的單次義務（正式 0 筆）不補快照；套用停止條件（正式庫盤點：兩案已登錄竣工確認，8 期預計移除竣工後的 5 期，實際數字見 CURRENT §6.3）。
- 前端純呈現：期限追蹤與履約時程的詳情加「依據」列（期次：第 N 版基準日＋起算欄位與日期；單次：完成時留版／未留版／現行第 N 版）、期次列逐期標依據；基準日卡加變更類別／依據函文／生效日三欄與 `AnchorVersions`（目前依據哪一版、本版變更與受影響事項、可展開版本紀錄）；`stop` 缺口在期次區說明去哪裡補。demo 種子帶兩版（初值、展延附函文）並在本地鏡像新版本（期次不重算、標示 demo）。

**P5e 保固類循環義務的停止條件已實作**（migration `20260920021500_warranty_stop_condition`，PR #156；使用者 2026-09-20 決定：保固期滿日＝正式驗收合格日＋契約載明的保固期間，兩者都有依據才計算並記錄來源，缺任一項列「待補設定」）。取代上面 P5c「保固類不自動產生」的暫行語意：

- 正式驗收合格日：`acceptance_events` 的 `final`（正式驗收）最後登錄一筆（`created_at` 最大，與竣工日同取法）且結果「合格」的 `event_date`；最後一筆不合格或沒登錄＝缺。「保固起算」（`warranty`）階段不參與計算。
- 契約保固期間的來源：正式庫唯讀盤點（2026-09-20）`requirements` 沒有可辨識的保固期間欄位（approved 中 `lifecycle_phase='保固'` 0 筆、`trigger_config` 只有 `offset_days／offset_dir／fixed_date`、保固類義務 0 筆），抽取層也只有文字——不得由 AI 推測數值，故新增最少必要的 `projects.warranty_term_value／warranty_term_unit（year／month／day）／warranty_source_requirement_id`。由專案管理者（`is_project_admin`，與基準日同一支 RPC `update_project_anchors`）在履約時程的履約期程卡登錄；guard `projects_warranty_term_guard` 強制「有期間就必須引用本案已確認（approved）且登錄者看得到（契約分級）的契約重點」，直接 REST 同樣受限——契約要求的權威仍是 requirement（D-012），數值由人讀條文填寫。
- 日期規則只有一處 `fn_warranty_expiry`：民法 §120 II 始日不算入（次日起算）、§121 II 以最後之月與起算日相當日之前一日為末日、最後之月無相當日取該月末日；以日定者為第 N 日。純 `date`／`make_date` 運算，不受 session 時區影響。例：合格 2025-04-30＋1 個月＝2025-05-31（單純日期加月會得 05-30）、2023-02-28＋1 年＝2024-02-29、2025-01-30＋1 個月＝2025-02-28。前端與 Edge 不重算，讀 RPC `get_project_warranty`（security definer、成員或 service；三方看到同一份事實含引用條文是否仍為已確認，條文內容仍由前端依契約分級 RLS 讀取）；Agent 唯讀 RPC 白名單因此多這一支（唯讀、stable）。
- 保固類期次窗口＝保固期間：起算＝正式驗收合格日（期次到期日 ≥ 合格日）、界限＝保固期滿日（期間起日 ≤ 期滿日，與竣工界限同語意），不看觸發點——否則觸發點是開工或未指定的保固義務會在施工期間產生整串假逾期期次。缺合格日或缺（有效的）保固期間 → 不產生；`stop` 缺口說缺哪一項（共用規則 `warrantyGap`／`warrantyNeeds`，`setup.need`＝acceptance／term），處理入口是履約時程該筆（合格日 → 驗收頁正式驗收；保固期間 → 同頁履約期程卡）。期次 `basis` 記合格日、期滿日、保固期間與引用條文，依據句寫「正式驗收合格日 X 起、保固期滿 Y 止」。
- 更正沿用 P5c：保固期間變更留一版（`changed_keys` 'warranty_term'、版本列新欄 `warranty` 快照、`effects`），同交易只重算沒動過的待辦期；驗收事件 `final` 登錄／更正／改不合格／清除、引用條文被取代（requirements 狀態 trigger）或刪除（FK set null 也留一版）、義務類別在保固／非保固之間變動（視同規則變更），都只移除／補回沒動過的待辦期；已提送／已完成／掛證據／待核對的期保留原到期日與依據（歷史不變）。
- 前端：履約期程卡常駐「保固期滿日與依據」（`components/WarrantyBasis.jsx`：期滿日或缺口、正式驗收合格的驗收紀錄、契約保固期間與引用條文），管理者在同卡編輯列登錄／更正（`WarrantyTermEditor`，候選為本頁看得到的已確認契約重點、保固相關排前）；期程段「保固期」以合格日起、期滿日止；不再拿保固段義務的最遠到期日推估保固期滿。編輯列（含基準日）改以 `can.admin` 鏡像 RPC 授權。
- 限制：一案一個契約保固期間（結構／一般／植栽等不同工種的保固年限不另建模，以管理者引用的那一條界定保固類循環義務）；單次的保固義務（如「一般工項保固期滿（1 年）」以竣工日＋天數）仍照 P5c 單次規則，不改。

### 4.6 履約時程頁完整化（P5d 已實作）

- **每則事項**（契約義務、關鍵工項、停留點）在同一條時間軸：列上有責任方、種類（頻率／關鍵工項／H 停留點）、待補設定標示、期限與倒數、狀態；詳情有工作內容、責任方、期限與依據（P5c 的第 N 版基準日、P5b 的本期）、原文來源（引述＋條文高亮）、相關單據（佐證送審直達 `/submittals?submittal=`、期次各自的佐證、期限追蹤該筆）與立即處理入口（單次：標記完成／掛佐證；循環：**逐期就地標記完成／退回待辦**，掛佐證隨完成一起走 `transition_obligation_period`；關鍵工項：計畫起迄；停留點：申請查驗／判定）。
- **近期／全期**：預設「近期」一份清單先急後緩（逾期最久在前 → 7 日內 → 待補設定／無到期 → 30 日內排程 → 最近 7 日完成），每列標期程；「全期」依五段期程分組。近期沒有東西時自動退回全期（不給一張空清單）；點期程條即切到全期。共用規則 `isRecent`／`byUrgency` 在 `obligationTimeline.js`。
- **待補設定可篩選**：下拉列五種缺口（責任方／基準日／循環規則／停止條件／回填待核對）各自件數，判定來源是共用規則 `obligationEntries`（`setupGapsOf`，與今日工作／Agent／早報同一份），處理入口與 `todayTasks` 同一張對照 `lib/obligationLinks.js`；基準日與停止條件在本頁就能補（打開履約期程卡的基準日編輯列），責任方／循環規則導擷取審核，回填待核對在期次區標記即解除。
- **逐期準時率**：`periodStat`（分母＝已完成＋已逾期的期、分子＝準時完成的期）；執行卡的準時率對循環義務以「期」計入（`partyStat.periodsSettled`），五狀態件數仍以「條」計。期次區與說明（缺口原因、去哪裡補）是 `components/ObligationPeriods.jsx`，期限追蹤與履約時程同一個元件（期限追蹤只多「點列切期」）。
- 保固類循環義務的停止條件：P5e 起見 §4.3（履約期程卡顯示保固期滿日與兩項依據；缺項列「停止條件待補」並導對應入口）。

### 4.4 掃描／無文字契約

現況：`packageFileSupport` 區分可分析與僅保存；抽取遇無文字頁回 422 `no_text` 並標 `coverage_incomplete`（[resumable-extraction](resumable-extraction.md)）。設計：履約時程頁首「契約覆蓋」摘要（總頁、無文字頁、缺頁、失敗批）直接讀 ingestion run 警示；缺頁／無文字／未支援格式一律標「未完整處理」。OCR：使用者 2026-09-17 決定**本輪不採用付費 OCR**（Q8）；只做真實狀態揭露與人工補登路徑，不引入供應商、每頁成本或資料出境。

### 4.5 抽取品質核對

沿用 D-019；建立「有標註答案」的評測樣本（真契約或授權去識別）與比對腳本，量測條款召回、責任方、期限；`completed` 不代表語意正確。樣本來源（Q9）：使用者 2026-09-17 同意先建比對腳本與樣本格式，真契約或授權去識別樣本仍待使用者提供。

## 5. 舊深連結與 fail-closed

- `hidden` 項保留 `roles`；`routeAllowed` 不變；`e2e/routes.spec.js`、`reachability.spec.js`、`a11y.spec.js` 同步更新（退場頁改為「hidden 仍可直達且唯讀」的斷言）。
- 提醒信與 Agent 回答中的路徑：`/audit`→估驗頁對應工項、`/schedule`→`/requirements?item=<work_item>`、`/cost`→維持（唯讀）。**P6b 落地**：頁面已移除的 `/schedule`、`/audit` 登記為 `access: 'retired'`（保留原 `roles`，Web 守衛照常擋；通過後 `RetiredRedirect` 導到 `redirectTo` 並帶原 query 與返回來源）——不改成不經守衛的 `redirect`，也不刪登記（舊連結會變 404）；`/cost` 仍是 hidden 頁面。
- 退場頁不得重新啟用寫入：頁面移除寫入控制且 store 不再暴露寫入函式；成本表更由資料庫收回寫入（P1b migration，直接 REST 也被拒），讀取 RLS 條件不變（歷史查閱原權限）。
- 頁名單一來源（P1b 統一 P1c 移交項）：`/dashboard` 的 h1、側欄分區、待辦返回連結（`taskReturn.js`）、各頁指路文案都取 `navConfig.BALL_SOURCES_TITLE`（今日工作），不再有「今日待辦」別名；`/alerts` 在登記表帶 `label`，返回連結名同樣取自登記表。

## 6. 舊資料過渡與回復（整體）

| 資料 | 過渡 | 回復 |
|---|---|---|
| `cost_items` | 列與欄不動；P1b 以 migration 收回 authenticated／anon 寫入 grant、policy 改 select-only；H1（`20260917213900`）再收回三個 API 角色對所有 public 表的 TRUNCATE／REFERENCES／TRIGGER／MAINTAIN 並修 default privileges，退場才不留 TRUNCATE 這條不受 RLS 的路 | `supabase/rollbacks/20260917210000_cost_items_retire.down.sql`（重授權＋回復 for all policy）；`supabase/rollbacks/20260917213900_api_roles_table_ddl_privileges.down.sql`（四種權限與 default 還原） |
| `item_schedules`、`schedule_periods` | 不動；唯讀查閱 | 無 DB 變更 |
| `ai_features.audit.summary` | P6c（`20260919130400`）：只翻 `enabled=false`；列、`ai_usage_events` 歷史（正式 0 筆）、`project_ai_overrides` 不動；`audit_events` 無關不動 | `supabase/rollbacks/20260919130400_audit_summary_retire.down.sql`（開關改回 true；前端呼叫端已移除，要重新提供功能須連前端一起還原） |
| `contract_obligations` 循環 7 筆 | P5b（`20260917233000`）：義務列不動；產生期次（5 筆缺「每月幾日」不產生、列待補設定），不回填完成（正式皆待辦）；循環義務自此不可再標義務層完成（guard） | `supabase/rollbacks/20260917233000_obligation_periods.down.sql`（解除 cron、trigger、guard、RPC，drop `obligation_periods`；期次列隨表移除，回復前先匯出） |
| 基準日 | P5c（`20260919021500`）：每個已填基準日的專案建 version 1（現值，標回填）；既有期次對得上 v1 的蓋版號；已登錄竣工／竣工日已定的專案移除界限日之後沒動過的待辦期（正式庫預計 8 期移除 5 期）；`contract_obligations` 加兩欄皆 null | `supabase/rollbacks/20260919021500_project_anchor_versions.down.sql`（drop 表與兩欄、還原 P5b 的 materialize 與 projects trigger；版本列與快照隨之移除，回復前先匯出；被界限日移除的期由 P5b 物化補回） |
| 文書與計價 | 見另兩份文件 | 同 |

## 7. DB／Edge／前端相容部署順序（整體）

1. **DB 加法 migration**（新表、加欄、新 RPC、guard 只加檢查不收回權限）＋pgTAP；`supabase migration list --linked` 對齊後 `db push`。
2. **Edge**：新函式（`draft-field-documents`）、`_shared` 更新（ballInCourt、photoMatch、agentTools 改起稿路徑）；`--use-api` 全部重佈受影響函式；`check:edge`。
3. **前端**：四主入口、現場紀錄、估驗聯動 UI；push `main` 自動部署；`check:prod`。
4. **觀察期**：至少一個真案期別走完簽署→確認→同步→送審→核定。
5. **DB 封堵 migration**：收回 `valuation_items` 直接寫入、關閉 `audit.summary`、`daily_logs` 舊路徑 guard 生效；收回 `checklist_records` 直接寫入與 `inspections` 直接判定（P6b-3 `20260920030000`，收緊型先前端後 DB）。
6. **清理 PR**：hidden→移除頁面／store／Demo 種子／測試（P6b）。P6b-1 已移除 `/schedule`、`/audit` 頁面與退場 Edge 原始碼（純前端＋Edge 刪檔，無 migration；`_shared/aiHandler.ts` 變更後重佈其模組圖內的函式）。

每步套用後寫回 `CURRENT.md` §6.3；任何一步失敗以對應 rollback 檔回復，前端可回退到前一建置。

## 8. 待決題的使用者答覆（2026-09-17，記入 D-026 第 7 點）

- **Q8 付費 OCR**：使用者決定**本輪不採用**；掃描／無文字契約只做揭露與人工補登（§4.4）。
- **Q9 抽取評測樣本**：使用者同意照暫行做法（先建比對腳本與樣本格式）；樣本來源與標註人仍待提供。
- **Q10 成本頁唯讀化時點**：使用者同意照暫行做法：P1b 即唯讀。
