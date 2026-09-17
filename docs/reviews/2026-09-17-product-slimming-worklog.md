# 產品瘦身與 AI 文書：續接工作清單

> 2026-09-17｜唯一續接紀錄。需求依據：[瘦身報告](2026-09-17-product-slimming-report.md)、[實作指令](2026-09-17-claude-product-slimming-prompt.md)；產品邊界 [D-026](../DECISIONS.md)；設計 [現場文書](../architecture/field-documents-lifecycle.md)、[確認量與估驗](../architecture/confirmed-quantity-valuation.md)、[入口與退場](../architecture/slimming-entrypoints-and-retirement.md)。
> 規則：每個工作包五行（問題／目標／不做／影響／驗收≤5）；每單元記相依、指定模型、**實際模型**、範圍、驗收；進度只寫在 §7，不另開報告。CURRENT 只記已上線現況。

## 1. 模型核對結果（2026-09-17）

- 使用者要求：`fable5.1` 主控、簡單低風險用 `opus5.2`；須核對實際模型，不得假稱切換或自行替換。
- 核對：主 session 實際模型為 **Opus 5（`claude-opus-5`）**，無法自行切換，只負責派工與轉述，不做設計或業務判斷；`fable` 子代理實際為 **Fable 5.1（`claude-fable-5-1`）**，本包 P0 由它執行；環境中**沒有 `opus5.2`**，只有 Opus 5。依指令「模型不可用時不擅自替換」，不派任何工作給 opus5.2，也不以 Opus 5 代替；所有工作包（含原可交 opus5.2 的純呈現工作）由 Fable 5.1 執行——P 表寫「fable5.1 主導；純呈現可 opus5.2」，由 fable5.1 做仍在指定範圍內。
- 每單元的「實際模型」欄在該單元完成時填寫；無法驗證時寫「未驗證」。

## 2. 現況核對摘要（基準 `ab4be5f`，詳見三份架構文件 §0）

已存在：照片批次辨識→配工項→上傳（`photos` 落庫）、白板轉錄、Agent 日誌／自檢草稿（`agent_actions`）、自檢修訂鏈與判定、查驗申請／判定／缺失連動、估驗期別與核定／金流 guard、佐證確定性 join、稽核事件、AI 閘門與用量、路由 fail-closed、今日待辦三桶。

真缺：文件版本／雜湊／簽署／提送／回執；辨識結果上傳前不持久；監造日誌整份缺；查驗沒有數量／批次／單位／階段；估驗沒有任何確認量約束且 `fillValuationFromSiteLogs` 是繞過路徑；送審歷次退回原因未列出；前端與 Edge 待辦類型不一致；循環義務無逐期；無 OCR。

## 3. 正式資料唯讀盤點（2026-09-17，專案 `buylyonwoyvqdbvkkkbx`，遠端 60 支 migration 與 repo 對齊至 `20260911110000`；只做 SELECT 聚合，未輸出任何內容或個資）

| 表 | 計數 |
|---|---|
| `projects` | 13（正式模式 4；已匯標單 7）；`project_members` 23；`work_items` 22,834（可計價末端 20,993） |
| `daily_logs` | 12（7 案）；`daily_log_items` 33（全有數量） |
| `photos` | 2（2 配工項、1 `ai_source`、0 有 `location`、0 無日誌） |
| `inspections` | 11（7 案）：合格 4、不合格 6、待查驗 1；類型 施工查驗 6、停留點查驗 3、材料查驗 1、未填 1；判定 10 筆皆有 `inspected_by`、0 筆缺 `inspected_at`；`checklist_record_id` 0；有 `location` 7；無工項 5 |
| `valuations` | 12（8 案）：草稿 7、監造審核 1、已核定 4、已請款 0；有請款日 2、收款日 2、實收 3（1 筆實收無收款日，屬 trigger 前歷史）、有 `period_end` 3 |
| `valuation_items` | 26（`daily_log` 21、`manual` 5）；有量 26；同工項無合格查驗 22；同工項無任何查驗 17；已核定期有量 5，其中無合格查驗 4；超契約量 0；負值 0；掛非末端／非計價列 1 |
| `checklist_templates` 3；`checklist_records` | 5（合格 3、不合格 2；無工項 5；修訂版 1） |
| `test_samples` 4（待試驗 3、不合格 1）；`defects` 12（品質 開立 5／改善中 1／已結案 4；工安 已結案 2）；`inspection_points` 5；`observations` 1；`safety_records` 5；`acceptance_events` 21；`change_orders` 核准 4；`rfis` 6 | — |
| `submittals` | 7（已提送 3、核准 2、駁回 2）；`review_note` 4；`revision>0` 3、`>1` 1；附件 1；`attachment_note` 補正行 2 |
| `cost_items` 11（4 案）；`item_schedules` 4（4 案）；`schedule_periods` 72（4 案） | — |
| `agent_actions` | 0 |
| `ai_usage_events` | 102：`requirements.extract` ok 39／blocked 10、`documents.classify` 15、`photo.classify` 15、`weather.fetch` 13、`valuation.summary` 4、`agent.run` 2、`contract.parse` 2、`sitelog.whiteboard` 2；**`audit.summary` 0**、`report.monthly` 0、送審／RFI／缺失／工安 AI 0 |
| `audit_events` | 1,290（valuation.* 75、inspection.* 17、submittal.* 25、defect.* 30、requirement.* 794、document.* 245 …） |
| `contract_obligations` | 109（全 待辦；monthly 7）；`requirements` approved 106、needs_review 4；`documents` 3；`contract_packages` ready 2 |

## 4. 工作包（五行）與可獨立 PR 的單元

指定模型欄依實作指令；「實際模型」由執行者填。相依以單元編號表示。所有 DB 單元共用同一套本機 Supabase，**循序執行**（§5）。

### P0 現況核對與資料／流程設計（本包）

問題：主賣點沒有完整流程；估驗無確認量控制；瘦身缺依據。目標：核對現況與正式資料，定資料與流程設計、Decision、續接清單。不做：不改程式、不建 migration。影響：只有文件。驗收：三份架構文件、D-026、本清單、需求依據入庫、`check:docs` 通過。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P0 | — | fable5.1 | Fable 5.1 | `docs/architecture/{field-documents-lifecycle,confirmed-quantity-valuation,slimming-entrypoints-and-retirement}.md`、`docs/architecture/README.md`、`docs/DECISIONS.md` D-026、本檔、`docs/reviews/2026-09-17-*.md` 複製 | `npm run check:docs`；PR 合併 |

### P1 導覽與退場準備

問題：19 子頁＋3 參考分散核心流程。目標：四主入口、次入口、退場頁唯讀化，深連結與權限不變。不做：不刪路由、不刪表、不刪查驗／估驗。影響：`navConfig`、Layout、首頁常用入口、Cost／Portfolio／RiskAudit 頁、E2E。驗收：三角色從四主入口走完既有旅程；退場頁 hidden 仍可直達且無寫入；routes／reachability／a11y E2E 綠；`navConfig.test` 更新；無 `roles` 變更。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P1a 導覽重組 | P0 | fable5.1 | Fable 5.1 | `src/lib/navConfig.js`（三主入口群組＋專案資料兩組、`hidden`、`MAIN_ENTRY_PATHS`／`ROLE_WORK`、`WORK_GUIDANCE`、`short`）、`App.jsx` 新路由 `/site`（現場紀錄總覽：依角色列既有入口＋件數＋現場待辦，非空殼）、`src/lib/taskReturn.js`（待辦返回來源單一定義）、`navConfig.test.js`、`e2e/routes.spec.js`、`reachability.spec.js`、`a11y.spec.js`（角色路由改由 navConfig 推導） | 路由登記完整；hidden 項 `routeAllowed` 仍依角色；E2E 綠 |
| P1b 退場頁唯讀化 | P1a | fable5.1 | — | `Cost.jsx`（移除寫入控制）、`Portfolio.jsx`（選案清單）、`RiskAudit.jsx`（唯讀導向）、`store.jsx`／`ledger.js` 不再暴露成本寫入、`e2e/owner.spec.js`、`a11y.spec.js` | 三頁無寫入按鈕；RLS 不變；E2E 綠 |
| P1c 首頁／底欄／提醒中心對齊四入口 | P1a | 純呈現（fable5.1 執行） | Fable 5.1 | 底欄已於 P1a 完成；本單元：`navConfig.js` 新增 `WORK_TITLE`／`navLabel`／`navEntryFor`（頁名唯一來源）、`WorkNavigation.jsx` 首頁主入口列改名「工作」、`Alerts.jsx` 副標與指路、`Dashboard.jsx`／`setupChecklist.js`／`ProjectSetup.jsx`／`Deadlines.jsx` 指路頁名改吃 navLabel；另修 P1a 發現的手機抽屜斷點缺陷（`Layout.jsx` 以 `isBelowMd && menuOpen` 推導抽屜狀態，`a11y.spec.js` 釘住） | 手機五格底欄＝四入口＋更多；無邏輯變更；抽屜測試先紅後綠 |
| P1d 文件同步 | P1a–c | 純呈現（fable5.1 執行） | Fable 5.1 | `CURRENT.md` §6.1、`route-registry-governance.md`、`UIUX` 規範 §0／§7／§8／§9.3、`BASELINE.md` | `check:docs` |

### T0 本機 pgTAP 測試隔離（P2a 之前補列）

問題：`npm run test:db` 跑在共用的本機開發資料庫上，其他工作殘留的列讓 `ai_platform`／`p0_02` 的計數斷言本機假失敗、CI 從零套用卻全綠；後續每個 DB 單元都要靠本機判斷 pgTAP 紅綠，這種不一致會讓人誤判或習慣忽略失敗。目標：本機結果與 CI 一致且可重現，不刪、不 reset 共用開發資料庫。不做：不改測試斷言遷就環境、不動 migration、不動正式環境。影響：`scripts/test-pgtap.js`（runner 自己用 `supabase db start` 起獨立 project_id 的一次性資料庫從零套 migrations＋seed，跑完 `supabase stop --no-backup` 刪）、`.github/workflows/pgtap.yml`（改走同一條路徑，不再 `supabase start`／`db reset`）、`supabase/SETUP.md`、`deploy.md`、`BASELINE.md`。驗收：殘留列仍在時本機 41 檔 1,131 通過與 CI 一致；共用資料庫前後列數快照相同；中斷與殘留自動清除；CI 綠。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| T0 本機 pgTAP 隔離 | P4a | fable5.1 | Fable 5.1 | `scripts/test-pgtap.js`／`.test.js`、`.github/workflows/pgtap.yml`、`supabase/SETUP.md`、`docs/operations/deploy.md`、`docs/BASELINE.md` | 本機＝CI 測項數；共用 DB 不變；單元測試 14 項；CI 綠 |

### P2 照片接收與 AI 草稿基礎

問題：辨識結果不持久、無角色隔離、未匯標單不能收照片。目標：上傳即保存、可恢復、可重試、欄位來源；以施工日誌走通第一條起稿→簽署路徑。不做：不建通用表單平台；不做離線同步。影響：`photos`、新表家族、新 Edge、現場紀錄頁。驗收：切頁／重登入恢復；重試不重複建件；未配對照片保存；廠商照片不能進監造文件；施工日誌可簽署且事實表落庫。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P2a 文件家族 migration | P0 | fable5.1 | Fable 5.1 | migration `20260917201000_field_documents`：`photo_intakes`、`photos` 加欄＋`photos_org_stamp`（`uploader_org`／`uploaded_by` 伺服器決定）、`field_documents`／`_versions`／`_signatures`／`_submissions`、RLS、欄位級 grants、六支 guard、稽核 AFTER trigger、rollback `.down.sql`；`auditEvents.js` 標籤；pgTAP `field_documents.sql` 215 條 | pgTAP：RLS 三角色＋非成員＋跨案；版本不可變；雜湊由 DB 算；簽署／提送列不可直接寫；狀態結構要件；grants |
| P2b Edge 起稿 | P2a | fable5.1 | — | `supabase/functions/draft-field-documents/`、`_shared/photoMatch.ts`（同前端測試案例）、`_shared/fieldDocDraft.ts`（純函式）、AI 註冊三處＋seed migration、`check:edge` | 單元測試：候選推斷、`field_sources` 規則、冪等、部分失敗；閘門 fail-closed |
| P2c 現場紀錄頁（上傳／恢復／文件清單） | P2a | fable5.1 | — | `src/pages/web/Site.jsx`（新）、`site.js` 新增 intake 上傳／恢復、`SiteLog.jsx` 改吃伺服器草稿、手機形狀 | E2E：上傳→重整→恢復；「仍在本機」與「已保存」區分 |
| P2d 施工日誌簽署／提送 RPC | P2a | fable5.1 | Fable 5.1 | migration `20260917205000_field_document_rpcs`：`save_field_document_version`（四類共用；必填鍵／待補由伺服器算並寫回）、`sign_field_document`（只有 daily_log 分支，其他類型 `PD007`；aal2、必填、附件角色、事實表落庫、`agent_actions`）、`submit/receive/return_field_document`（`client_request_id` 冪等）、`daily_logs_guard`／`daily_log_items_guard`（已簽署列只有簽署 RPC 可重寫）、`resolve_agent_action_internal`、`field_documents_target_uidx` 改只算活文件；錯誤代碼 `PD001–PD010`；rollback `.down.sql`；pgTAP `field_document_sign.sql` 140 條 | pgTAP：舊版簽署、雜湊不符、越權、跨案、aal1、待補欄、附件冒充、簽後改文另開版、事實列不可直接改寫、提送重試防重複、退回必填原因且歷次保留、收件方限定、diff 由 DB 算、三角色＋非成員矩陣 |

### P3 四類文書＋簽署提送

問題：只有施工日誌不算主賣點。目標：監造日誌、自主檢查表、監造查驗表單各自由照片起稿、補缺、簽署、提送、回執；跨文件共用補值。不做：不做電子憑證採購；不宣稱符合機關簽章規範。影響：新表 `supervisor_logs`、`checklist_templates.kind`、`inspections` 加欄、四頁面與列印。驗收：四類各走完整流程；監造日誌為每日；查驗表單簽署即判定；退回再送保留版本；列印與簽署版本一致。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P3a 監造日誌 | P2d | fable5.1 | — | migration `supervisor_logs`＋RLS＋guard＋pgTAP；起稿分支；`/supervisor-log` 頁；`sign_field_document` 分支 | 到場欄只能人填；廠商不可寫；每日唯一 |
| P3b 自主檢查表 | P2d | fable5.1 | — | 起稿分支（沿用 `draftInspection` 規則）；簽署分支寫 `checklist_records`；查驗申請檢附已簽署版；`ChecklistSection` 改吃文件 | num 永遠待補；bool 建議附 basis；簽署後修訂＝Rev.N |
| P3c 監造查驗表單（判定） | P3b | fable5.1 | — | migration：`checklist_templates.kind/stage_key/applies_to`、`inspections` 加欄、簽署分支更新 `inspections`（**不含**確認量寫入，留 P4b 接）；示範範本 | 簽署即判定；不合格開缺失同交易；廠商不能簽 |
| P3d 提送／退回／回執 UI＋列印 | P2d | 純表單呈現／列印（fable5.1 執行） | — | 四類詳情的提送區、退回歷史列、回執；列印頁印版本與雜湊 | 歷次退回全列；列印雜湊＝DB |
| P3e 共用補值＋角色隔離 | P3a–c | fable5.1 | — | `set_intake_shared_input` RPC＋傳播；簽署附件來源檢查；pgTAP | 補一次多文件生效；已簽署不變；他方照片拒絕 |

### P4 查驗通過量與估驗聯動

問題：估驗數量無確認來源，`fillValuationFromSiteLogs` 可繞過。目標：確認量表、期別分配、上限、自動同步、撤銷調整、併發與封堵，全部後端強制。不做：不改保留款／金流順序公式；不自動偽造舊資料確認。影響：估驗頁、`billing.js`、三張新表、guards、RPC。驗收：需求 §8「監造確認量與計價」全部情境有 pgTAP；真後端 E2E 走 P3 真實簽署→同步→核定→請款；舊路徑與直接 REST 被擋。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P4a 純計算＋pgTAP | P0 | fable5.1 | Fable 5.1 | migration `20260917120000`（只型別與純函式，不讀表）：`cq_confirmation`／`cq_allocation` 型別、`fn_effective_by_batch`、`fn_effective_confirmed`、`fn_contract_qty`、`fn_cap`、`fn_allocate_fifo`、`fn_batch_allocation_check`、`fn_period_increment`、`fn_valuation_amount`、`fn_pricing_basis_effective`、`fn_cq_*` 正規化／驗證共 14 支；`v_billable_backlog` 順延 P4b（需要 P4b 的表）；pgTAP `confirmed_quantity_calc.sql` 83 條含設計 §3.1 全部案例 | 案例全綠；不依賴 P3 |
| P4b 表、guard、RPC、鎖 | P4a、P3c | fable5.1 | — | migration：`inspection_confirmations`、`valuation_item_sources`、`valuation_adjustments`、`work_item_pricing_basis`、`valuations.recheck_required`、`inspection_points.stage_key`；`valuations_guard` 擴充；RPC（`sync_`、`set_valuation_item_cum`、`transition_valuation`、`revoke_`、`issue_supervisor_certificate`、`admin_adjust_valuation_item`）；advisory lock；簽署分支寫確認量＋自動同步 trigger；legacy 來源回填；rollback；pgTAP 權限矩陣＋狀態情境 | 不變量 1–5；三角色＋非成員＋admin_override 正式／非正式矩陣；重播不重複 |
| P4c 估驗頁 | P4b | fable5.1 | — | `Valuation.jsx`：可估驗清單、來源展開、缺件（勾稽移入）、差異比對；`billing.js` 移除 `fillValuationFromSiteLogs`、改 RPC；`valuationDiff.js` | 前端不算金額；帶入鈕消失；缺件在送審前可見 |
| P4d 撤銷／減量／調整 | P4b | fable5.1 | — | 撤銷 UI（監造）、調整流程（機關 void）、核定／請款前檢查訊息 | 未核定阻擋、已核定走調整並留痕 |
| P4e 封堵 migration | P4c 上線且觀察一期 | fable5.1 | — | migration：`revoke` `valuation_items` 寫入；Edge 掃描測試；舊客戶端相容驗證 | 直接 REST 明確失敗；Edge 無估驗寫入 |

### P5 契約時程與提醒

問題：首頁／Agent／早報類型不一致；循環無逐期；期限無版本；掃描契約未揭露。目標：核心類型一致、逐期追蹤、基準日版本、契約覆蓋揭露、關鍵工項日期承接。不做：不重寫新引擎；不買 OCR。影響：`ballInCourt` 兩側、`send-reminders`、新表兩張、履約時程頁。驗收：同一測試資料三處一致；責任不明標待補；本期完成不清下期；基準日變更不破壞歷史；缺頁／無文字有真實狀態；排程承接後才 hidden。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P5a 球權共用 fixture | P0 | fable5.1 | — | `tests/fixtures/ball-in-court.cases.json`；`ballInCourt.js`／`.ts` 補三類＋文書；責任不明兩側不歸方（含 `obligation_party()` 與 policy 調整 migration＋pgTAP） | Vitest 與 Deno 同案例綠 |
| P5b 循環期次 | P5a | fable5.1 | — | migration `obligation_periods`＋`materialize_obligation_periods`＋回填 7 筆；pgTAP 月末／跨年；`todayTasks`／Edge 改讀期次 | 本期完成不清下期；舊期保留 |
| P5c 基準日版本 | P5b | fable5.1 | — | migration `project_anchor_versions`＋trigger；期次帶版本；重算只動未完成 | 歷史不變；差異可見 |
| P5d 履約時程 UI | P5a–c | fable5.1；純呈現（fable5.1 執行） | — | `/requirements` 關鍵工項列（讀 `item_schedules`）、契約覆蓋摘要、循環期次列；`/schedule` hidden | 承接 E2E 綠後才 hidden |

### P6 其他文書整合與退場清理

問題：月報仍手抄；退場模組殘留讀寫端。目標：月報／佐證包重用已簽署資料；移除無使用端程式；`audit.summary` 退場。不做：不預建無實案表單；不 drop 表。影響：月報兩頁、store、Demo 種子、測試。驗收：月報數字來自已簽署文件；無殘留入口；Demo E2E 綠；用量歷史保留。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P6a 月報／佐證包重用 | P3、P4c | fable5.1 | — | `MonthlyReport.jsx`、`SupervisorReport.jsx`（改名監造月報）、`ValuationPackage.jsx` 讀已簽署版本與確認量 | D-024 口徑不變 |
| P6b 移除退場程式 | P1b、P5d | 確定無行為影響的整理（fable5.1 執行） | — | 刪 `Cost.jsx` 寫入、`Schedule.jsx`、`RiskAudit.jsx`、`portfolioExceptions.js`、store／db 寫入、Demo 種子、對應測試 | lint／test／E2E 綠；表保留 |
| P6c `audit.summary` 退場 | P1b | fable5.1 | — | migration 關閉功能列＋rollback；`ai_features_retired.sql` pgTAP；註冊表註記 | 用量歷史保留；閘門回 403 |

### P7 整體驗收與發布

問題：測試通過不等於可用。目標：三方真後端完整旅程、真照片／契約模型驗證、手機／桌機、過渡與回復證據、文件、D-023 發布。不做：不拿 Demo 當真後端驗收；不宣稱未量測成效。影響：CURRENT／BASELINE／runbook。驗收：`e2e:real` 三方旅程；模型樣本比對；回復演練；`check:prod`；剩餘限制明列。

| 單元 | 相依 | 指定 | 實際 | 範圍 | 驗收 |
|---|---|---|---|---|---|
| P7a 真後端旅程 | P1–P6 | fable5.1 | — | `e2e/real/*` 四類文書＋估驗聯動 | 三角色走完 |
| P7b 模型品質樣本 | P2b、P5 | fable5.1 | — | 照片樣本（清晰／模糊／非現場／混合）與契約樣本，有預期答案 | 準確率報告，不以 HTTP 200 代替 |
| P7c 過渡與回復演練＋文件 | P4e | fable5.1 | — | rollback 實跑（staging）、`CURRENT` §6.3、`BASELINE`、runbook | 部署版本與驗證寫回 |

## 5. 建議執行順序（單套本機 Supabase，DB 單元循序）

1. P1a → P1b → P1c → P1d（無 DB；可與 P4a 平行）。
2. P4a（純函式 migration＋pgTAP，不依賴 P3）→ T0（本機 pgTAP 隔離；之後每個 DB 單元以 `npm run test:db` 的一次性資料庫結果判紅綠）。
3. P2a → P2b → P2c → P2d（第一條完整路徑）。
4. P3a → P3b → P3c → P3d → P3e。
5. P4b → P4c → P4d；觀察一個真案期別 → P4e。
6. P5a → P5b → P5c → P5d（P5a 可在 P2 之後任何時候穿插，無 DB 衝突時）。
7. P6a → P6b → P6c。
8. P7a → P7b → P7c。

DB 單元（P2a、P2d、P3a、P3c、P3e、P4a、P4b、P4e、P5a–c、P6c）之間不平行；前端／Edge 單元可在介面定案後穿插。每個單元一個 PR、`codex/` 分支前綴、CI 綠後合併。

## 6. 待使用者決定（2026-09-17 使用者已於主 session 逐題答覆；記入 D-026 第 7 點）

| # | 問題 | 選項與影響 | 使用者答覆／執行做法 |
|---|---|---|---|
| Q1 | 實案簽署方式 | (a) 平台帳號簽署（可要求 TOTP，`method=platform_account_mfa`）：最快，效力依機關認定；(b) 紙本列印簽回綁版本雜湊：符合多數機關現況，多一次掃描；(c) 外部憑證／工商憑證：需採購與整合，本輪不做 | **使用者 2026-09-17 決定：簽署先用平台帳號加 MFA**——採 (a)，簽署 RPC 要求 JWT `aal2`，`method=platform_account_mfa`；(b)(c) 未排除但本輪不做，`method` enum 保留三值 |
| Q2 | 金額精度 | 逐工項四捨五入到元後加總 vs 加總後取整；影響本期金額尾差 | 使用者 2026-09-17 同意照暫行做法：逐工項到元；集中在 `fn_valuation_amount` 一處可改 |
| Q3 | 總價／間接費計價依據 | 利潤及管理費、營業稅、保險、假設工程各用 `supervisor_certificate`／`pro_rata`／`excluded`；影響這些工項能否進估驗 | **使用者 2026-09-17 決定：總價／間接費暫時隔離**——不計價，缺 basis 一律 `cap=0` 並在估驗頁標示（P4a `fn_pricing_basis_effective`＋`fn_cap` 已實作）；這是暫時措施，各工項的計價依據仍待決；`work_item_pricing_basis` 表 P4b 先建 |
| Q4 | 監造日誌廠商可讀否 | 可讀：透明；不可讀：需 RLS 分角色 | 使用者 2026-09-17 同意照暫行做法：專案成員可讀 |
| Q5 | 監造查驗表單的廠商異議 | 加正式狀態 vs 以 RFI 提出 | 使用者 2026-09-17 同意照暫行做法：以 RFI 提出 |
| Q6 | 多階段必要查驗來源 | ITP H 點 vs 實案品質計畫另列 | 使用者 2026-09-17 同意照暫行做法：H 點 |
| Q7 | 期別截止日語意 | 計價截止日 vs 提送日 | 使用者 2026-09-17 同意照暫行做法：計價截止日，送審必填 |
| Q8 | 付費 OCR | 供應商、每頁成本、資料出境；不採用則掃描契約只揭露＋人工補登 | **使用者 2026-09-17 決定：OCR 先不採用**——本輪不採用付費 OCR，掃描／無文字契約只做真實狀態揭露＋人工補登路徑 |
| Q9 | 抽取評測樣本 | 真契約或授權去識別；標註人 | 使用者 2026-09-17 同意照暫行做法：先建比對腳本與樣本格式；樣本來源仍待提供 |
| Q10 | 成本頁唯讀化時點 | P1b 立即 vs P6b 一併 | 使用者 2026-09-17 同意照暫行做法：P1b 即唯讀 |
| Q11 | 實案範本來源 | 監造日誌與監造查驗表單欄位需實案範本 | **使用者 2026-09-17 決定：範本沒有，先用示範範本**——依設計 §2.2 建示範範本，介面與列印明確標「示範範本」，不得宣稱為機關公定格式 |

## 7. 進度

| 單元 | 分支／PR | commit | migration | 部署 | 已驗證 | 下一步 |
|---|---|---|---|---|---|---|
| P0 | `codex/slimming-p0-design`／PR #102 | `881702a`（merge commit 見 Git） | 無 | 無（純文件） | `npm run check:docs` 55 檔、355 連結、0 錯誤；CI 見 PR | P1a 與 P4a |
| P1a | `codex/slimming-p1a-nav`／PR #104 | `5bb6a1d`；merge `33d0f70` | 無 | 2026-09-17 前端隨 main 由 Workers Builds 自動建置；`check:prod` app／demo 皆 OK，正式 bundle 已含新導覽；demo 站未重佈 | `npm test` 120 檔 1,255 項；lint／build／`check:docs` 55 檔 355 連結 0 錯；Demo E2E 10 支 71 項全綠（reachability 25/24/24 條、a11y 三角色 375＋1024 全路由）；內建 Preview 375px 底欄／抽屜／`/site` 核對 | P1b 退場頁唯讀化（/cost、/audit 已 hidden）；P1c 只剩文案（底欄已＝四入口＋更多）；P1d 同步 route-registry-governance／UIUX §0 |
| P4a | `codex/slimming-p4a-calc`／PR #103 | `eea40b3`＋`24c38cc`；merge commit `591570c` | `20260917120000_confirmed_quantity_calc`（只型別與純函式；rollback 檔同名 `.down.sql`） | 2026-09-17 `supabase db push` 已套正式；`migration list --linked` 61 筆對齊；正式庫唯讀核對 14 支函式 IMMUTABLE／security invoker、anon／authenticated 不可執行 | CI（`24c38cc`）：pgTAP 從零套用 41 檔 1,131 通過、`confirmed_quantity_calc.sql` 83/83；`check:docs` 55 檔 0 錯誤。本機全套 41 檔 1,125 通過，`ai_platform`／`p0_02` 的計數斷言因共用本機 DB 殘留列（1 專案、3 成員）假失敗、與本支無關 | P2a（DB 單元循序）；P4b 依設計 §3.2 介面把表資料餵入純函式，不重寫算法 |
| T0 | `codex/slimming-t0-pgtap-isolation`／PR #107 | `85156e6`＋`0e3dfd6`；merge commit `b5b01ff` | 無 | 無（測試基礎與 CI；無正式環境變更） | 本機 `npm run test:db` 41 檔 1,131 通過＝CI（main `d3b7d35`）；殘留列仍在的共用 DB 執行前後 86 張表列數快照 md5 相同、無 `*_pgtap_*` 殘留；SIGINT 中斷與 pid 已死殘留皆自動清除；`scripts/test-pgtap.test.js` 14 項；lint／`npm test`／`check:docs` 綠；CI `pgtap` 改走同一條路徑後綠 | P2a 起 DB 單元以本機 `test:db` 判紅綠；記憶檔 `pmis-local-pgtap-setup.md` 的舊跑法已過時（由使用者更新） |
| P2a | `codex/slimming-p2a-field-docs`／PR #109 | `f5bad72`＋`f689042`；merge commit `3f2a00a` | `20260917201000_field_documents`（五表／`photos` 七欄／六支 guard／稽核 trigger；rollback 檔同名 `.down.sql`） | 2026-09-17 `supabase db push` 已套正式；`migration list --linked` 62 筆對齊；正式庫唯讀核對 5 表／10 trigger／9 policy 就位、grants 如設計、既有 2 筆照片 `uploader_org` 皆回填、0 筆未知（詳 CURRENT §6.3） | 本機 `npm run test:db` 從零套 62 支：42 檔 1,346 通過、0 失敗（新增 `field_documents.sql` 215/215）；lint 綠；`npm test` 120 檔 1,259 項；build 綠；`check:docs` 55 檔 361 連結 0 錯；CI（`f689042`）CI／pgTAP 皆 success | P2b Edge 起稿（AI 重跑＝新增版本；`ai_*` 只 service 可寫）、P2c 現場紀錄頁（直接 INSERT `photo_intakes`／`photos`／`field_documents` 草稿，其餘走 RPC）、P2d RPC 依設計 §5 的寫入順序（簽署列→狀態→事實表） |
| P1c＋P1d（同一 PR，含手機抽屜斷點缺陷） | `codex/slimming-p1cd`／PR #108 | `2126496`＋`72bbb9a`；merge commit `f6ba60c` | 無 | 2026-09-17 前端隨 main 由 Workers Builds 自動建置；`check:prod` app／demo 皆 OK，正式主 chunk（`index-B7ANsNEt.js`）已無舊「常用工作」文案；demo 站未重佈（待 P1b 後一次重佈） | `npm test` 120 檔 1,259 項；lint／build／`check:docs` 55 檔 357 連結 0 錯；Demo E2E workflow-ux／a11y／reachability／routes 4 支 35 項全綠，新增抽屜斷點測試修前紅修後綠；內建 Preview 375／1024 核對首頁「工作」列、提醒中心文案、底欄、抽屜拉寬解鎖；PR 與合併後 main（`f6ba60c`）的 CI、pgTAP 皆過 | P1b 退場頁唯讀化（/cost、/audit 已 hidden；`Agent.jsx` 的「前往風險稽核」連結與 `Members.jsx` 角色說明中的風險稽核字樣待 P1b／P6c 一併處理）；P1b 完成後重佈 demo |
| P1b、P2b–P3、P4b–P7c | — | — | — | — | — | 依 §5 順序 |

歷程規則：每單元合併後更新本表（PR 編號、merge commit、migration 版本、部署日期、驗證指令與結果）；正式環境狀態同時寫回 `CURRENT.md` §6.3。
