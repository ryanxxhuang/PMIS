# 現場文書：四類文書的資料模型、生命週期與簽署提送

> 狀態：**PROPOSED（P0 設計）**｜2026-09-17｜依 [D-026](../DECISIONS.md)。本文件是實作前的技術設計；migration、Edge 與前端尚未動工，實作進度只看 [續接清單](../reviews/2026-09-17-product-slimming-worklog.md)。
> 標記：**【已確認】**＝使用者已確認的產品邊界（D-026，不需再問）；**【設計】**＝實作者選擇，實作時可調整但須回寫本文件；**【待決】**＝需使用者決定，答覆前依「暫行」做，不阻擋其他工作。

## 0. 現況核對（基準 `ab4be5f`）

| 文書 | 既有事實表／頁面／Edge | 已有 | 真缺 |
|---|---|---|---|
| 施工日誌 | [`daily_logs`](../../supabase/migrations/20260711000000_baseline.sql)（`unique(project_id, log_date)`、公定格式欄位）、`daily_log_items`、`photos`；[`SiteLog.jsx`](../../src/pages/web/SiteLog.jsx)、`SiteLogPrint.jsx`；Edge `classify-site-photo`、`read-whiteboard`；Agent [`draft_daily_log`](../../supabase/functions/_shared/draftDailyLog.ts) | 照片批次辨識→模糊配工項→上傳（`photos.caption/work_item_id/location/ai_source` 落庫）；白板轉錄數量到表單；Agent 草稿進 `agent_actions`（數量一律留空）；列印版 | 辨識結果在上傳前只存頁面 `staging` state，切頁即失；`daily_logs.status` 程式一律寫 `'已送出'`，沒有生命週期；沒有版本／內容雜湊／簽署／提送／回執；`daily_logs` 沒有任何 guard（只有 RLS `can_write`），已存檔內容可被任何廠商成員改寫 |
| 監造日誌 | **無**。[`SupervisorReport.jsx`](../../src/pages/web/SupervisorReport.jsx) 是**月份彙整**（`buildSupervisorReport(data, month)`），不是每日紀錄 | — | 整份缺：事實表、每日範本、監造自己的照片來源、與當日查驗的連結、簽署提送 |
| 自主檢查表 | `checklist_templates.items`（num／bool 項）、`checklist_records`（`results`、`overall`、修訂鏈 `rev/root_id/supersedes_id`，[guard](../../supabase/migrations/20260712001700_checklist_revisions.sql) 禁止就地修改）；`ChecklistPrint.jsx`；Agent [`draft_inspection`](../../supabase/functions/_shared/draftInspection.ts) | 量化自動判定（前端 `qc.js`）、修訂版次、缺失連動、查驗申請檢附（`inspections.checklist_record_id`） | 照片→草稿只有 Agent 對話路徑（`num` 一律留空，`bool` 需 basis）；無簽署／提送；正式資料 5 筆 `work_item_id` 全為 null |
| 監造查驗表單 | `inspections`（一列＝一次查驗：`status` 待查驗／合格／不合格、`result_note`、`inspected_by/at`、`location` 自由文字、`checklist_record_id`）；`inspections_guard`（判定僅監造）、`inspections_delete_guard`；`Quality.jsx` | 申請、判定、不合格同交易開缺失、ITP 停留點連結、稽核事件 `inspection.decided` | 沒有表單項目與實測值、沒有查驗範圍／批次／單位／確認數量、沒有版本與簽署、沒有多階段；「判定」只是一次狀態更新 |

共通缺口：沒有「文件版本＋內容雜湊＋簽署者＋伺服器時間＋簽署意願」的簽署模型；沒有提送／退回歷史／回執（送審 `review_note` 只有最新一則，歷次退回只在 `audit_events` 的 before／after 裡）；`agent_actions` 只收 Agent 對話產生的草稿，照片驅動的「系統主動起稿」沒有留痕路徑。

正式資料（2026-09-17 唯讀盤點，見續接清單 §3）：`daily_logs` 12、`photos` 2、`checklist_records` 5、`inspections` 11、`agent_actions` 0——過渡負擔極小，但所有既有列都沒有簽署與版本，一律視為「未簽署歷史」（§10）。

## 1. 設計原則

1. **沿用既有事實表**【設計】：施工日誌、自主檢查、查驗仍寫 `daily_logs`／`checklist_records`／`inspections`；既有 RLS、guard、稽核 trigger、估驗佐證推導（[`evidence.js`](../../src/lib/evidence.js)）與 Agent 工具不重做。新增的是「文件生命週期層」與「監造日誌事實表」。
2. **一層文件生命週期，四類共用**【設計】：草稿／補件／審核／簽署／提送／回執對四類文書是同一個概念，用同一組表（`field_documents` 家族）承載；但**每類文書的狀態允許集合與角色權責不同**（§5 矩陣），不硬套同一套狀態機。文書類型是固定 enum，欄位由既有範本或固定欄位決定——這不是表單設計器，也不是 workflow DSL。
3. **AI 只寫草稿版本**【已確認】：AI 產出落在文件的 `author_kind='ai'` 版本與 `agent_actions`；人簽署的版本必定是人建立或人確認的版本。合格判定、核定、提送由人執行。
4. **後端強制**【已確認】：簽署、提送、判定、確認量全部走 security definer RPC 或 guard trigger；前端 `can` 只是 UX。
5. **誠實揭露**【已確認】：欄位沒有來源就標「待補」，不得填「無」或「合格」；照片能證明「有施作」不能證明「做了多少」；廠商照片不能當監造到場或已查驗的證明。
6. **不另建離線同步產品**【已確認】：「已保存」＝`photos`／`field_documents` 列已寫入伺服器；瀏覽器內尚未上傳的檔案一律標「仍在本機」。

## 2. 資料模型

### 2.1 沿用（不改語意）

`daily_logs`／`daily_log_items`、`photos`（含 `photos_delete_guard`／`photos_update_guard` 凍結）、`checklist_templates`／`checklist_records`、`inspections`／`defects`、`inspection_points`、`agent_actions`、`audit_events`、`ai_features`／`ai_usage_events`。

### 2.2 新增或加欄（最少必要）【設計】

**`photo_intakes`（一次上傳＝一批）**

| 欄位 | 說明 |
|---|---|
| `id`, `project_id`, `created_by`, `created_at` | — |
| `uploader_org text not null` | 上傳時 `my_org_type()` 快照（contractor／supervisor）；角色隔離依據，不可由客戶端指定 |
| `log_date date` | 業務日期（台北日曆日）；辨識不到就 null＝待補 |
| `status text` | `received`／`recognizing`／`drafting`／`ready`／`partial`／`failed`／`discarded` |
| `photo_count`, `recognized_count`, `failed_count int` | 進度與部分失敗揭露 |
| `shared_inputs jsonb` | 跨文件共用補值（§2.4） |
| `candidates jsonb` | 系統判斷的候選文書清單與使用者排除項 `[{doc_type, target_key, reason, excluded}]` |
| `run_started_at`, `last_progress_at`, `attempts int`, `error_summary text` | 可續跑 run 模型（§3.3），比照 [resumable-extraction](resumable-extraction.md) |

RLS：SELECT 專案成員；INSERT／UPDATE `can_write` 且 `uploader_org = my_org_type()`（guard 蓋寫）；DELETE 只允許 `status='received'` 且無照片列。

**`photos` 加欄**：`intake_id uuid`（FK `photo_intakes` on delete set null）、`uploader_org text`（trigger 蓋寫）、`ai_status text`（`pending`／`done`／`failed`／`not_site`／`unreadable`／`duplicate`）、`ai_result jsonb`（`classify-site-photo`／`read-whiteboard` 原始結構化輸出）、`ai_run_at`、`work_item_hint text`（未配對時保存 AI 關鍵詞，匯標單後可再配）、`content_sha256 text`（重複照片偵測；同一 intake 內相同雜湊標 `duplicate`，仍保存不刪）。`daily_log_id` 本就 nullable；intake 照片的 Storage 路徑為 `<project_id>/intake/<intake_id>/<photo_id>.<ext>`（首段仍是 project_id，既有 Storage policy 不改）。`photos_update_guard` 白名單加 `uploader_org`／`content_sha256`／`intake_id`（凍結後不可改掛），`ai_*`／`work_item_hint` 與 `caption` 同屬註記欄不凍結。

**`supervisor_logs`（監造日誌事實表；每日一份）**

| 欄位 | 說明 |
|---|---|
| `id`, `project_id`, `log_date`, `unique(project_id, log_date)` | 同 `daily_logs` 慣例 |
| `weather_am`, `weather_pm text` | 可沿用同日施工日誌已簽署版或 CWA |
| `attendance jsonb` | 監造到場人員與時段 `[{user_id\|name, from, to}]`——**只能人填**，AI 不得從任何照片推定到場 |
| `supervision_items jsonb` | 監造事項 `[{time, item, location, work_item_id, note, source}]` |
| `inspection_ids uuid[]` | 當日查驗（`inspections.id`）由系統帶入 |
| `notices jsonb` | 通知／督導事項 `[{to:'contractor', content, ref_type, ref_id}]` |
| `followups jsonb` | 追蹤事項 `[{ref_type, ref_id, content, status}]` |
| `contractor_summary text` | 廠商施工情形摘要（引用同日已簽署施工日誌時標來源） |
| `note`, `created_by`, `created_at` | — |

RLS：SELECT 專案成員（Q4：使用者 2026-09-17 同意暫行「專案成員皆可讀」）；INSERT／UPDATE 限 `my_org_type()='supervisor'` 且 `can_write`；guard：有已簽署 `field_documents` 指向本列時，內容欄不可就地修改（走 §6 修訂版）。

**`checklist_templates` 加欄**：`kind text not null default 'self_check' check (kind in ('self_check','inspection_form','supervisor_certificate'))`、`stage_key text`（多階段查驗用，對應 [確認量文件 §3.4](confirmed-quantity-valuation.md)）、`applies_to jsonb`（`{work_item_ids:[], keywords:[]}`，候選文書推斷用）、`version int not null default 1`。既有列全部 `self_check`。

**`inspections` 加欄**（只由簽署 RPC 寫入）：`template_id uuid`、`results jsonb`（查驗項目結果，形狀同 `checklist_records.results`）、`stage_key text`、`batch_key text`（施作位置／批次正規化鍵）、`document_id uuid`（簽署的監造查驗表單）、`scope_note text`。既有 `location` 保留為顯示用自由文字。

**`field_documents`（文件本體，四類共用）**

| 欄位 | 說明 |
|---|---|
| `id`, `project_id`, `created_by`, `created_at`, `updated_at` | — |
| `doc_type text` | `daily_log`／`supervisor_log`／`self_check`／`inspection_form` |
| `target_table text`, `target_id uuid` | 事實列；草稿期可為 null，簽署時由 RPC 建立或綁定 |
| `intake_id uuid` | 由哪批照片起稿；手動建立為 null |
| `doc_date date not null` | 業務日期 |
| `owner_org text not null` | 責任方（contractor／supervisor），trigger 依 `doc_type` 固定 |
| `status text` | `draft`／`pending_input`／`in_review`／`signed`／`submitted`／`received`／`returned`／`discarded`／`superseded` |
| `current_version_no int` | 目前版本 |
| `template_id uuid`, `template_version int` | 自檢／查驗表單／監造確認單的範本快照 |
| `required_fields jsonb` | 由範本或固定欄位推導的必填鍵（含必要附件） |
| `recheck jsonb` | 系統列出的未通過項（缺附件、待補、角色不符），供 UI 與 RPC 共用 |

唯一性：`(project_id, doc_type, doc_date, owner_org)` 部分唯一（`doc_type in ('daily_log','supervisor_log')` 且 `status not in ('discarded','superseded')`）；`(doc_type, target_id)` 部分唯一（`target_id not null`）。RLS：SELECT 專案成員（監造日誌依 Q4）；INSERT／UPDATE `can_write` 且 `owner_org = my_org_type()`（`admin_override` 例外）；`status`／`current_version_no` 只由 RPC 改（guard 擋直接改）。

**`field_document_versions`（不可變）**

`id`, `document_id`, `version_no`, `author_kind text check in ('ai','human')`, `created_by uuid`（ai 為 null）, `content jsonb`, `field_sources jsonb`（§2.3）, `attachments jsonb`（`[{photo_id, storage_path, sha256}]`）, `content_hash text`（**只在 DB 計算**：`encode(digest(content::text || coalesce(attachments::text,''), 'sha256'), 'hex')`；`jsonb::text` 鍵序穩定，前端只顯示不重算，避免雙引擎）, `change_note text`, `amended_from_version int`, `created_at`。`unique(document_id, version_no)`；authenticated 無 UPDATE／DELETE grant。

**`field_document_signatures`**

`id`, `document_id`, `version_no`, `content_hash`（必須等於該版本雜湊）, `signer_id`, `signer_org`, `signer_name_snapshot`, `signed_at timestamptz default now()`（伺服器時間，client 值作廢）, `intent text not null`（簽署意願聲明原文，簽署當下畫面顯示的同一段）, `method text check in ('platform_account','platform_account_mfa','paper_scan')`, `aal text`（JWT `aal`）, `request_ip inet`, `user_agent text`, `evidence jsonb`（紙本掃描檔的 `{storage_path, sha256}`）, `created_at`。`unique(document_id, version_no, signer_id)`；append-only。

**`field_document_submissions`（提送／收件／退回歷史，append-only）**

`id`, `document_id`, `version_no`, `content_hash`, `action text check in ('submit','receive','return')`, `actor_id`, `actor_org`, `to_org text`, `reason text`（退回必填）, `diff jsonb`（再送時伺服器比對上次退回版本與本版的變更鍵）, `client_request_id text`, `created_at`。`unique(document_id, client_request_id) where client_request_id is not null`＝送件重試防重複。

**AI 註冊**：新增功能 `field_docs.draft`（category `draft`、edgeFunction `draft-field-documents`、minPlan `trial`【設計】、isLlm true）於 [`aiFeatures.js`](../../src/lib/aiFeatures.js)、`_shared/aiFeatures.ts` 與 `ai_features` seed migration 三處；逐張辨識沿用 `photo.classify`／`sitelog.whiteboard` 的 prompt 與 schema（改為 `_shared` 模組直接呼叫，不經 HTTP 跳轉），用量各記各的 feature_key。

### 2.3 欄位來源狀態 `field_sources`

每個版本的 `field_sources` 以欄位鍵為索引：

```json
{ "work_summary": { "status": "filled", "source": "ai:photo", "refs": ["<photo_id>"] },
  "items.<work_item_id>.qty_today": { "status": "pending", "source": null },
  "items.<work_item_id>.location": { "status": "filled", "source": "whiteboard:<photo_id>" },
  "labor": { "status": "filled", "source": "yesterday:<daily_log_id>" },
  "weather_am": { "status": "confirmed", "source": "cwa", "confirmed_by": "<uid>", "confirmed_at": "..." },
  "extras.sampling": { "status": "na", "reason": "本日無取樣" } }
```

`status` 值域：`filled`（已帶入，待核對）／`pending`（待補）／`na`（不適用，需 `reason`）／`confirmed`（人已確認或人填）。規則【已確認】：數量、實測值、到場、天氣、合格結論沒有可辨識來源一律 `pending`；白板／量測照片清楚可讀才可 `filled` 並附 `source: whiteboard:<photo_id>`；簽署時 `required_fields` 中任何 `pending` 即拒絕。

### 2.4 跨文件共用補值

同一 `photo_intakes` 生成的多份草稿共用 `shared_inputs`（鍵＝正規化欄位鍵，如 `log_date`、`location:<work_item_id>`、`qty:<work_item_id>:<batch_key>`、`labor`）。人補一次：RPC `set_intake_shared_input(intake_id, key, value)` 寫入 `shared_inputs`，並對同一 intake 內**仍為 `draft`／`pending_input`** 的文件，把對應鍵為 `pending` 的欄位建立一個人工版本（`author_kind='human'`、`source: shared:<key>`）。已簽署／已提送文件不受影響【已確認】；來源後改（例如照片說明更正）只影響尚未簽署的草稿。

## 3. 照片接收、辨識、起稿、保存與恢復

### 3.1 流程（Edge `draft-field-documents`）

1. 前端：壓縮→`Storage.upload`→`photos` insert（`intake_id`，`daily_log_id` 為 null）。每張成功才算「已保存」；失敗保留本機檔並標「仍在本機」。示範模式一律不接收（不寫 Demo 工項到真案）。
2. 前端呼叫 `draft-field-documents { project_id, intake_id }`（過 `openAiGate`，`project_id` 必帶）。
3. Edge 以 userClient 讀（RLS 決定看得到的照片、標單、範本、既有紀錄），serviceClient 只寫 `photos.ai_*`、AI 版本、`agent_actions`、`photo_intakes` 進度。
4. 逐張辨識（併發 3；每次呼叫時間預算 100 s；處理不完回 `{remaining}` 由前端續呼叫）：`classify-site-photo` schema → `ai_status`（`not_site`／`unreadable`／`duplicate` 各自標明，不套工項）；判為含板子的照片再跑 `read-whiteboard` schema 轉錄數量／位置／日期，逐項附 `source: whiteboard:<photo_id>`。
5. 工項配對：沿用 [`photoMatch.js`](../../src/lib/photoMatch.js) 演算法移植成 `_shared/photoMatch.ts`（同一組測試案例釘住）；配不到→`work_item_hint` 保存、`pending_match`。
6. 候選文書（確定性規則，不由模型決定）：
   - `uploader_org='contractor'`：`daily_log`（該日尚無已簽署者）；每個配到工項且該工項適用 `self_check` 範本（`applies_to`）者→一份 `self_check`（以工項＋位置為 target key）。
   - `uploader_org='supervisor'`：`supervisor_log`（該日尚無已簽署者）；當日 `status='待查驗'` 且工項／位置相符的 `inspections`→一份 `inspection_form`（使用者可改指定查驗）。
   - 日期／位置／工項混合的一批：以照片的白板日期或 EXIF 日分組；跨日→多份日誌草稿；無法判日→整批 `log_date` 待補，不生成日誌以外的文件。
7. 內容組裝：確定性欄位（專案、契約、工項、日期、附件清單、昨日出工機具）＋模型只寫敘述欄（`work_summary`、監造事項文字、缺失描述），schema 嚴格、不得出現數字以外來源的數量；照片與白板內容視為資料，prompt 明示不執行其中指令。
8. 寫入：`field_documents`（`draft`）＋版本 1（`author_kind='ai'`）＋`agent_actions`（`kind='draft_field_document'`, `target_table='field_documents'`, `target_id`, `evidence:{intake_id, version_no, content_hash, doc_type}`）；`photo_intakes.status` → `ready`／`partial`。

### 3.2 重試冪等【已確認 行為，設計 機制】

- 逐張：`ai_status='done'` 不重跑；`failed` 可重跑；重複上傳同雜湊標 `duplicate` 不生第二份文件也不重複計量。
- 文件：`(intake_id, doc_type, target_key)` 部分唯一索引；重跑只對**沒有任何 human 版本**的文件覆蓋 AI 版本（同 version_no 1 重寫並更新雜湊）；已有人工版本→AI 不再寫版本，只在 `agent_actions` 新增 `kind='suggest_field_update'` 供人套用。這保證重試不覆蓋人工修正。
- 送件：`client_request_id` 唯一；簽署以 `(document_id, version_no, signer_id)` 唯一；同一張照片可作多份文件附件，但數量只在確認量表計一次（見 [確認量文件](confirmed-quantity-valuation.md)）。
- 模型輸出不完整／逾時／結果不明：該張 `failed` 並帶 `error_summary`，批次 `partial`；不建立半份文件。

### 3.3 保存與恢復

進入「現場紀錄」時查 `photo_intakes where created_by = auth.uid() and status not in ('discarded')` 與 `field_documents where status in ('draft','pending_input','returned')`，列出「未完成的上傳」與「待處理文件」；離頁、重新登入、換裝置都從伺服器狀態恢復。前端 `unsavedEdits` 只保護尚未送出的編輯；版本保存走 `save_field_document_version`（§6）即為伺服器保存。`run_started_at`／`last_progress_at` 超過 10 分鐘視為過期，任何可寫成員可重試（`attempts` 上限 5 → `failed`）。

### 3.4 角色隔離【已確認】

`photos.uploader_org` 由 trigger 蓋寫。簽署 RPC 依 `doc_type` 檢查附件來源：

| 文書 | 可作為主要證據的照片 | 他方照片 |
|---|---|---|
| 施工日誌／自主檢查表 | `uploader_org='contractor'` | 監造照片可列為「監造提供」註記，不作施作證據 |
| 監造日誌 | `uploader_org='supervisor'`；`attendance` 只能人填 | 廠商照片可引用為「廠商提供之施工照片」，不得作為到場或查驗執行證據 |
| 監造查驗表單 | `uploader_org='supervisor'` 為查驗現場證據；廠商自檢附件標「廠商自主檢查」 | 同上 |

### 3.5 未匯標單

`isPersistedProject` 即可接收照片（不要求 `dbMode`）；工項相關文件只對配到工項的照片生成；未配對照片列「待配對」，匯標單後可對同一 intake 重跑配對。計價資格見確認量文件——沒有 `work_item_id` 的任何紀錄都不能產生確認量。

## 4. 生命週期與角色／狀態矩陣

狀態集合（§2.2 `field_documents.status`）；各類文書允許的轉移與執行者：

| 轉移 | 施工日誌 | 監造日誌 | 自主檢查表 | 監造查驗表單 |
|---|---|---|---|---|
| 建立草稿（AI 或人） | 系統／廠商 | 系統／監造 | 系統／廠商 | 系統／監造 |
| draft ↔ pending_input（系統依 `required_fields` 推導） | 自動 | 自動 | 自動 | 自動 |
| 補件（新增人工版本） | 廠商 | 監造 | 廠商 | 監造；廠商可補「申請方資料」（僅限查驗申請欄位） |
| → in_review（送同方主管核對，選用） | 廠商 | 監造 | — | — |
| → signed | 廠商成員 | 監造成員 | 廠商成員 | **監造成員；簽署即為判定**（合格／不合格／部分通過＋確認量） |
| → submitted | 廠商→監造 | 監造→機關 | 廠商→監造（可隨查驗申請檢附） | 監造→廠商＋機關 |
| → received | 監造 | 機關 | 監造 | 廠商／機關各自收件 |
| → returned（附原因） | 監造 | 機關 | 監造 | 廠商可以 RFI 提「異議」但不是退回（Q5：使用者 2026-09-17 同意暫行） |
| 修訂（signed 後改內容→新版本，回 draft） | 廠商 | 監造 | 廠商（對應 `checklist_records` 修訂鏈 Rev.N） | 監造（重簽即重新判定；原確認量走撤銷／改量流程） |
| discarded | 建立者（只限未簽署） | 同 | 同 | 同 |

不變量：`signed` 以後的版本不可改；每次簽署綁定一個版本；`submitted` 必須指向已簽署版本；`received`／`returned` 只能由 `to_org` 成員執行；`returned` 後只能以新版本再簽再送，歷次 `return` 列全部保留。「今日工作」把 `pending_input`（我方）、`returned`（我方）、`submitted`（對方待收）納入待辦，與 [球權](ball-in-court.md) 同一引擎。

## 5. 簽署【已確認 要求，設計 機制】

RPC `sign_field_document(p_document_id, p_version_no, p_content_hash, p_intent, p_client_request_id)`：

1. `select ... for update` 鎖文件列；`current_version_no = p_version_no` 否則拒絕（「畫面是舊版」）；版本雜湊等於 `p_content_hash` 否則拒絕（內容完整性）。
2. 角色：`my_org_type() = owner_org`（`admin_override` 例外，正式模式失效）；跨案取件由 RLS 與 `project_id` 雙重擋。
3. 完整性：`required_fields` 全部 `filled`／`confirmed`／`na`（`na` 需 reason）；附件的 `photos` 列存在且 `sha256` 相符；角色隔離（§3.4）。
4. 簽署方式（使用者 2026-09-17 決定：先用平台帳號加 MFA）：JWT `aal` 必須為 `aal2`，否則拒絕並提示先完成兩步驟驗證（`admin_override` 也不放行）；寫入 `field_document_signatures`（`signed_at=now()`、`aal` 取 JWT、`method='platform_account_mfa'`）；`status='signed'`。`method` enum 保留 `platform_account`／`paper_scan` 供日後方式，本輪不啟用。
5. 同交易落事實表：`daily_log`→upsert `daily_logs`＋`daily_log_items`；`supervisor_log`→upsert `supervisor_logs`；`self_check`→insert `checklist_records`（`results/overall` 取版本內容；判定仍由前端 `judgeChecklist` 計算，DB 不重算，與 [雙引擎 #1](dual-engine-sync.md) 一致）；`inspection_form`→更新 `inspections`（判定、`results`、`template_id`、`batch_key`、`document_id`）＋寫確認量（[確認量文件 §2](confirmed-quantity-valuation.md)）。事實表 guard（`daily_logs_guard`、`supervisor_logs_guard`）在有已簽署文件指向該列時擋直接修改。
6. `agent_actions` 對應列由內部函式 `resolve_agent_action_internal` 標 `accepted`（無人工版本）或 `edited`（有人工版本），`resolved_by` 為簽署者；`record_audit_event('field_document.signed')`。

簽署後更正：`save_field_document_version` 對 `signed`／`submitted`／`returned` 文件建立版本 n+1（`amended_from_version`），`status` 回 `draft`，原簽署列與原版本不動、原提送列仍指向舊版；必須重簽重送。列印版印出 `文件短碼＋版本號＋雜湊前 12 碼`；紙本簽回（`method='paper_scan'`，綁定同一版本雜湊、掃描檔 `sha256` 入 `evidence`）是保留的日後方式，本輪不啟用。本設計不宣稱符合任何機關的電子簽章規範；簽署方式依使用者 2026-09-17 決定先採平台帳號＋MFA（§11 Q1）。

## 6. 提送、退回歷史、回執

RPC `submit_field_document(p_document_id, p_version_no, p_to_org, p_client_request_id)`：文件須 `signed`；寫 `submit` 列（伺服器時間＝送件回執）；`status='submitted'`；`to_org` 依 `doc_type` 規則檢查（§4）。`receive_field_document`：`to_org` 成員執行，`status='received'`＝對方已收件。`return_field_document(reason)`：`to_org` 成員，`reason` 必填，`status='returned'`；再送時 RPC 自動計算 `diff`（本版與被退回版本的變更鍵）。不會把 `submittals.review_note` 當歷史；送審文件的歷次退回原因另列 [瘦身文件 §4](slimming-entrypoints-and-retirement.md)。不對真實成員寄信；通知只進「今日工作」與既有早報路徑。

## 7. AI 草稿與 `agent_actions` 邊界

- 照片起稿與 Agent 對話起稿都落 `agent_actions`（新 kind `draft_field_document`／`suggest_field_update`），`evidence` 只存指標（文件、版本、雜湊、intake），不重複存 payload。
- `agent_actions` SELECT 仍限本人；文件本體對同方成員可見可編（`field_documents` RLS）。簽署者非草稿收件人時，由 RPC 內部函式標處理狀態並記 `resolved_by`——這是對 [Agent 邊界](agent-tool-boundary.md) 的明示延伸，需同步更新該文件與 pgTAP。
- 既有 `draft_daily_log`／`draft_inspection` 工具改為產生 `field_documents` 草稿（保留工具名與回傳形狀），接受路徑統一走簽署 RPC；`acceptDraft` 的直接 `saveSiteLog` 路徑退場。

## 8. RLS／guard／RPC 清單（實作對照）

| 物件 | 類型 | 責任 |
|---|---|---|
| `photo_intakes`、`photos` 新欄、`supervisor_logs`、`field_documents`、`field_document_versions`、`field_document_signatures`、`field_document_submissions` | 表＋RLS＋明確收回 default grants | P2a／P3a |
| `photos_org_stamp`、`field_documents_status_guard`、`field_document_versions_immutable`、`daily_logs_guard`、`supervisor_logs_guard`、`inspections` 新欄只允許 RPC 寫 | trigger | P2a／P2d／P3a／P3c |
| `create_field_document_draft`（service）、`save_field_document_version`、`set_intake_shared_input`、`sign_field_document`、`submit_/receive_/return_field_document`、`discard_field_document`、`resolve_agent_action_internal` | security definer RPC，`revoke all from public, anon`、僅 `authenticated` 或 service | P2d／P3 |
| `field_docs.draft` 註冊三處＋seed migration | AI 閘門 | P2b |
| 稽核事件 `field_document.{created,version_saved,signed,submitted,received,returned,discarded}` | `record_audit_event` | P2a |

## 9. 舊資料過渡與回復

- 既有 `daily_logs`（12）、`checklist_records`（5）、`inspections`（11）不自動包裝成已簽署文件；使用者開啟時可「建立文件草稿（沿用既有內容）」再走簽署，`field_sources` 全標 `filled/source: legacy`。
- 既有 `daily_logs.status='已送出'` 不改值；新 guard 只看是否有已簽署文件指向該列。
- 回復：所有新表可整組 drop（rollback 檔），`photos` 新欄可 drop，`inspections` 新欄可 drop；`daily_logs_guard`／`supervisor_logs_guard` 可 drop 恢復舊行為；已產生的簽署與提送資料隨表移除（rollback 前先匯出）。
- 相容順序：DB（加法）→ Edge（新函式；舊 `draft_daily_log` 工具仍可用）→ 前端 → 第二支 migration 才把 `acceptDraft` 舊路徑用到的直接寫入關閉。

## 10. 驗證對應（實作時逐項補）

| 情境（依需求 §8） | 驗證 |
|---|---|
| 四類各走照片→自動生成→補缺→簽署→提送；監造日誌確為每日 | 真後端 E2E 四條；pgTAP 唯一性 `(project, doc_type, doc_date, owner_org)` |
| 清晰量測照可轉錄、模糊照留缺、非現場照不捏造、廠商證據不冒充監造 | 模型樣本測試（有預期答案）；pgTAP 角色隔離拒絕 |
| 切頁／重登入可恢復；部分失敗、重試、重複上傳、逾時不丟人工修正、不重複建件 | pgTAP 冪等鍵；Edge 單元測試（stub）；E2E 重整頁 |
| 簽舊版、簽後改文／附件、越權簽署、跨案取件受阻；退回再送保留版本與理由 | pgTAP `sign_field_document` 六種拒絕；submissions append-only |
| 手機可完成現場旅程；桌機審核；列印與簽署版本一致 | 手機形狀 E2E；列印頁顯示版本與雜湊 |

## 11. 待決題的使用者答覆（2026-09-17，記入 D-026 第 7 點）

- **Q1 實案簽署方式**：使用者決定**先用平台帳號加 MFA**——簽署 RPC 要求 `aal2`、`method='platform_account_mfa'`（§5 第 4 步）；紙本簽回與外部憑證未排除，本輪不做，`method` enum 保留三值。
- **Q4 監造日誌可見範圍**：使用者同意照暫行做法：專案成員皆可讀（與其他事實表一致），RLS 一行可改。
- **Q5 監造查驗表單的廠商異議**：使用者同意照暫行做法：廠商只能收件並以工程疑義（RFI）提出，不加狀態。
- **Q11 實案範本來源**：使用者決定**範本沒有，先用示範範本**——施工日誌沿用公定格式；自檢沿用既有範本；監造日誌與監造查驗表單依本文件 §2.2 欄位與現有 03310 範本形狀建立示範範本，介面與列印必須明確標「示範範本」，不得宣稱為機關公定格式。
