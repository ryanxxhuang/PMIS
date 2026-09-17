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

深連結保證：所有既有 `?inspection=`／`?period=`／`?submittal=`／`?d=`／`?stage=`／`?obligation=` 參數不變；`hidden` 項仍受 `roles` 守衛；提醒信舊連結（`/alerts`、`/deadlines?obligation=`）維持。新增 `/site?intake=<id>`、`/site?doc=<id>` 直達文件。

**P1a 落地結果（2026-09-17，與上表的差異）**：側欄分區為「今日工作（球權三來源）→ 工作（三主入口群組）→ 專案資料 → 平台」。次入口不做扁平的「更多」，而是兩個群組：「文件往來」（送審文件／工程疑義／施工月報／監造月報）與「專案」（專案文件／三方成員／活動紀錄／跨案總覽；風險稽核 hidden）——月報在導覽上放文件往來，同時在 `/site`「本月文件」給入口（§3 的落點仍成立）。`/site` 的第一個子頁標籤為「現場總覽」；P1a 的 `/site` 只列既有現場作業入口、件數、現場待辦與本月文件，照片上傳與文書清單留給 P2c。`/supervisor-log` 待 P3a 建頁後再登記（不預登記無頁面的路由）。`/cost`、`/audit` 已 hidden（唯讀化在 P1b）；`/schedule` 仍可見。手機底欄＝現在輪到我＋三主入口＋更多（`roleWorkLinks` 回傳群組項，子頁也算選取），P1c 只剩文案。

## 2. 退場承接清單【已確認 範圍】

「退場」＝停止作為新作業工具；不刪正式歷史資料、不 drop 表（D-026）。每項列現況使用端、承接、清理順序。

### 2.1 成本管理 `/cost`

- 使用端：`Cost.jsx`、`ledger.js`（`costItems` CRUD）、`db.js loadCostItemsFromDB`、`store.jsx`、`Dashboard.jsx exportAll`（整案匯出含 `cost_items`）、`demoSeed.js`、`e2e/owner.spec.js`（監造進不了 `/cost`）、`e2e/a11y.spec.js`、`ledger.test.js`；DB `cost_items`（RLS `can_access_contractor_private`，監造／機關不可讀）。正式資料 11 列／4 案。
- 承接：頁面改為**唯讀查閱＋CSV 匯出**（移除新增／編輯／刪除控制，store 只保留 load），`hidden: true`、`roles: ['contractor']` 不變；`exportAll` 仍含成本（廠商自己的匯出）。
- 清理順序：P1b 唯讀化→P6b 移除 CRUD、Demo 種子、寫入測試；表與 RLS 保留（歷史可查）。不動標單單價、保留款、估驗與付款。

### 2.2 跨案總覽 `/portfolio`

- 使用端：`Portfolio.jsx`、`projects.js loadPortfolio`（RPC `portfolio_summary`）、`portfolioExceptions.js`、`DEMO_PORTFOLIO`、`e2e/owner.spec.js`／`a11y.spec.js`。
- 承接：縮為「選案清單」（案名、角色、待我處理件數、最近活動），移除統計／例外分析卡；`portfolio_summary` RPC 保留供清單件數（D-024 已知它取最新期，不再擴充）。
- 清理：P1b 縮頁→P6b 移除 `portfolioExceptions.js` 與測試、Demo 姊妹案靜態資料；RPC 不刪。

### 2.3 風險稽核 `/audit`＋`audit.summary`

- 使用端：`RiskAudit.jsx`（`riskAudit.js` 檢核表＋`integrityAudit.js` 勾稽鏈＋`auditSummary` AI）、`Agent.jsx` 連結、`integrityAuditTool.ts`（Agent `run_integrity_audit`，監造／機關）、Edge `audit-summary`、`site.js auditSummary`、AI 註冊三處。正式 `audit.summary` 用量 0 筆。
- 承接【已確認】：估驗所需檢核移入估驗流程——`integrityAudit.js` 的「估驗超前日誌」「澆置無試體」「查驗缺漏」在估驗頁逐工項就地顯示（P4c），送審前列「缺件」；`riskAudit.js` 的契約／變更面向由履約時程承接。Agent `run_integrity_audit` 保留（仍有用途）。
- 退場：`audit.summary` 功能列以 migration 關閉（`enabled=false`，比照 `20260911100100_contract_parse_retire`），Edge 與用量歷史保留；`/audit` `hidden`，頁面改為唯讀提示並導向估驗頁對應項；P6c 後移除頁面與 `auditSummary` store 路徑。`audit_events` 完全不動。

### 2.4 逐工項排程 `/schedule`

- 使用端：`Schedule.jsx`、`ledger.js setItemSchedule/removeItemSchedule`、`db.js loadItemSchedulesFromDB`、`Dashboard.jsx exportAll`、`demoSeed.js`、`draftDailyLog.ts`（註解說明無排程量欄位）、`e2e/a11y.spec.js`；DB `item_schedules`（正式 4 列／4 案）。
- 承接【已確認 順序】：關鍵工項日期進履約時程——`item_schedules` 既有 `planned_start/planned_finish` 直接在 `/requirements` 顯示為「關鍵工項」時間軸列（唯讀＋少量維護），資料不搬表；`schedule_periods`（S 曲線）不屬退場，`/progress` 保留。
- 清理：P5d 承接完成且 E2E 通過後 `hidden`→P6b 移除頁面、store 寫入、Demo 種子；表保留。

### 2.5 已停用 AI 路徑

`assistant.chat`、`contract.parse` 維持停用；不在本輪新增動作。

## 3. 融入核心流程的模組（保留能力、取消常駐入口）

| 模組 | 落點 | 保留 |
|---|---|---|
| 品質（查驗／自檢／試體／缺失）、工安 | 現場紀錄 | 全部業務規則、缺失引擎、試體 trigger；文件化部分改由 [現場文書](field-documents-lifecycle.md) 承載 |
| ITP 停留點 | 履約時程提示＋現場紀錄一鍵申請 | 既有狀態推導；新增 `stage_key` 供多階段計價 |
| 送審文件 | 次入口＋今日工作 | 既有狀態機；**歷次退回原因**改由 `audit_events` 的 `submittal.returned` before／after 在詳情列出（不新增表、不改 `review_note` 語意）【設計】 |
| 工程疑義 | 次入口＋文件／查驗詳情「提出疑義」 | 不變 |
| 變更設計 | 履約時程／估驗「契約變更」 | D-016 不變；`Qc(W)` 計算引用已核准明細 |
| 施工月報／監造月報 | 現場紀錄「本月文件」 | 改為重用已簽署日誌／查驗（P6a）；口徑 D-024 不變 |
| 驗收結算 | 履約時程竣工／驗收階段 | 不變 |
| 進度 S 曲線 | 履約時程次要視圖 | 不變 |

## 4. 契約時程與提醒對齊【已確認 目標，設計 機制】

### 4.1 核心類型與責任

首頁（`todayTasks.js`）、Agent（`collectOpenBallItems`）、早報（`send-reminders`）對齊為同一份**核心類型**：送審、疑義、估驗、缺失、查驗、變更、契約義務、現場文書（待補／待簽／退回／待收件）。做法：

- 把 `ballInCourt.js` 七支判定與 `ballInCourt.ts` 四支對齊為同一組**共用 fixture**（`tests/fixtures/ball-in-court.cases.json`，Vitest 與 Deno 測試同讀），比照 `contractDue` 的模式；Edge 補查驗／變更／觀察三類與現場文書。
- `responsible` 無法辨識：兩側都改為「不歸任何方、列入待補設定」（Edge 現行預設廠商需改，`obligation_party()` DB 函式的 fallback 同步改為 null 並更新 policy 與前端 `obligationParty`——這是 [雙引擎](dual-engine-sync.md) 列明的人工同步項）。
- 首頁不新存任務狀態；`/requirements` 與 `/dashboard` 共用同一事項來源，只差時間範圍。

### 4.2 循環期次

新增 `obligation_periods`（`obligation_id`, `period_key`（如 `2026-09`）, `due_date`, `anchor_version_no`, `status` 待辦／已提送／已完成／不適用, `completed_at/by`, `evidence_submittal_id`／`evidence_document_id`），由函式 `materialize_obligation_periods(project, upto)` 依 `recurring*` 規則與基準日**確定性**產生（含月末、29–31 日、跨年規則，pgTAP 釘住）；每期獨立追蹤，完成本期不清除下期，逾期舊期保留。正式資料 7 筆 monthly 義務可回填期次（不回填完成狀態）。

### 4.3 期限版本

新增 `project_anchor_versions`（`project_id`, `version_no`, `anchors jsonb`（決標／開工／停復工／展延／竣工）, `effective_from`, `reason`, `source_ref`（核准變更或函文）, `created_by/at`）；`projects.*_date` 保持為「現行值」，每次更改由 trigger 產生新版本。到期日計算引用產生期次時的 `anchor_version_no`；基準日更正後只重算尚未完成的期次並記錄差異，不改歷史。

### 4.4 掃描／無文字契約

現況：`packageFileSupport` 區分可分析與僅保存；抽取遇無文字頁回 422 `no_text` 並標 `coverage_incomplete`（[resumable-extraction](resumable-extraction.md)）。設計：履約時程頁首「契約覆蓋」摘要（總頁、無文字頁、缺頁、失敗批）直接讀 ingestion run 警示；缺頁／無文字／未支援格式一律標「未完整處理」。OCR：使用者 2026-09-17 決定**本輪不採用付費 OCR**（Q8）；只做真實狀態揭露與人工補登路徑，不引入供應商、每頁成本或資料出境。

### 4.5 抽取品質核對

沿用 D-019；建立「有標註答案」的評測樣本（真契約或授權去識別）與比對腳本，量測條款召回、責任方、期限；`completed` 不代表語意正確。樣本來源（Q9）：使用者 2026-09-17 同意先建比對腳本與樣本格式，真契約或授權去識別樣本仍待使用者提供。

## 5. 舊深連結與 fail-closed

- `hidden` 項保留 `roles`；`routeAllowed` 不變；`e2e/routes.spec.js`、`reachability.spec.js`、`a11y.spec.js` 同步更新（退場頁改為「hidden 仍可直達且唯讀」的斷言）。
- 提醒信與 Agent 回答中的路徑：`/audit`→估驗頁對應工項、`/schedule`→`/requirements?item=<work_item>`、`/cost`→維持（唯讀）。
- 退場頁不得重新啟用寫入：頁面移除寫入控制且 store 不再暴露寫入函式；RLS 不變（歷史查閱原權限）。

## 6. 舊資料過渡與回復（整體）

| 資料 | 過渡 | 回復 |
|---|---|---|
| `cost_items`、`item_schedules`、`schedule_periods` | 不動；唯讀查閱 | 無 DB 變更 |
| `ai_features.audit.summary` | `enabled=false` migration | rollback 檔改回 true |
| `contract_obligations` 循環 7 筆 | 產生期次，不回填完成 | drop `obligation_periods` |
| 基準日 | 建立 version 1（現值） | drop `project_anchor_versions`，`projects` 欄不變 |
| 文書與計價 | 見另兩份文件 | 同 |

## 7. DB／Edge／前端相容部署順序（整體）

1. **DB 加法 migration**（新表、加欄、新 RPC、guard 只加檢查不收回權限）＋pgTAP；`supabase migration list --linked` 對齊後 `db push`。
2. **Edge**：新函式（`draft-field-documents`）、`_shared` 更新（ballInCourt、photoMatch、agentTools 改起稿路徑）；`--use-api` 全部重佈受影響函式；`check:edge`。
3. **前端**：四主入口、現場紀錄、估驗聯動 UI；push `main` 自動部署；`check:prod`。
4. **觀察期**：至少一個真案期別走完簽署→確認→同步→送審→核定。
5. **DB 封堵 migration**：收回 `valuation_items` 直接寫入、關閉 `audit.summary`、`daily_logs` 舊路徑 guard 生效。
6. **清理 PR**：hidden→移除頁面／store／Demo 種子／測試（P6b）。

每步套用後寫回 `CURRENT.md` §6.3；任何一步失敗以對應 rollback 檔回復，前端可回退到前一建置。

## 8. 待決題的使用者答覆（2026-09-17，記入 D-026 第 7 點）

- **Q8 付費 OCR**：使用者決定**本輪不採用**；掃描／無文字契約只做揭露與人工補登（§4.4）。
- **Q9 抽取評測樣本**：使用者同意照暫行做法（先建比對腳本與樣本格式）；樣本來源與標註人仍待提供。
- **Q10 成本頁唯讀化時點**：使用者同意照暫行做法：P1b 即唯讀。
