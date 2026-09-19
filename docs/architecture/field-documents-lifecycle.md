# 現場文書：四類文書的資料模型、生命週期與簽署提送

> 狀態：**PROPOSED（P0 設計；P2a 資料層、P2b Edge 起稿、P2d 存版／簽署／提送 RPC、P3a 監造日誌後端與頁面、P2c 現場紀錄頁與施工日誌文件頁、P3b 自主檢查表、P3c 監造查驗表單、P3e 共用補值已實作）**｜2026-09-17｜依 [D-026](../DECISIONS.md)。§2.2 的 `photo_intakes`、`photos` 加欄與 `field_documents` 家族已由 migration `20260917201000_field_documents` 建立並有 pgTAP `field_documents.sql`；§3 的 Edge `draft-field-documents`（P2b）已實作，P3a 起施工日誌與監造日誌都真的起稿，P3b 起每個配到工項的照片再起一份自主檢查表（範本由本案 `checklist_templates` 依工項描述確定性挑選；實測值永遠待補），P3c 起監造照片為日期或工項相符的待查驗申請各起一份監造查驗表單（查驗申請資料帶入待核對；判定與確認量永遠留空）（§3.1 以程式為準：[`fieldDocDraft.ts`](../../supabase/functions/_shared/fieldDocDraft.ts) 純規則、[`fieldDocDraftRun.ts`](../../supabase/functions/_shared/fieldDocDraftRun.ts) 流程、[`fieldDocRepo.ts`](../../supabase/functions/_shared/fieldDocRepo.ts) 存取）；§5–§7 的 `save_field_document_version`、`sign_field_document`（`daily_log`＋`supervisor_log` 分支）、`submit`／`receive`／`return_field_document`、事實表 guard、`resolve_agent_action_internal` 已由 migration `20260917205000_field_document_rpcs`（P2d）與 `20260917221000_supervisor_logs`（P3a：`supervisor_logs` 事實表、示範範本、人填欄規則、通用事實表 guard）建立並有 pgTAP `field_document_sign.sql`／`supervisor_logs.sql`（§8 表列以 migration 為準）；**P3b 自主檢查表（migration `20260919141500_self_check_documents`；pgTAP `self_check_documents.sql` 126 條）**：`fn_field_document_template('self_check')` 示範框架範本、必填／人填／須確認欄由框架＋本案檢查表範本項目推導（§2.2、§5）、`sign_field_document` 的 `self_check` 分支寫 `checklist_records`（首簽 Rev.0、再簽修訂 Rev.N）、判定引擎與不合格開缺失下沉 DB（`fn_checklist_judge`、`checklist_records_defect_sync`）、Edge 起稿分支 `buildSelfCheckDraft` 與執行期向 DB 取範本（Edge 不再有範本鏡像常數）、`/self-check` 頁與 `/self-check/print`、查驗申請檢附已簽署版本（§3.3「P3b 落地」）；**P3c 監造查驗表單（migration `20260919222000_inspection_form_documents`；pgTAP `inspection_form_documents.sql` 146 條）**：`checklist_templates.kind／stage_key／applies_to／version`、`inspections` 加 `batch_key／stage_key／unit／declared_qty／confirmed_qty／template_id／results／document_id／document_version_no` 並以 check 釘住四值狀態（含「部分合格」）、`inspections_guard` 改 BEFORE INSERT OR UPDATE（正規化、簽署專屬欄與部分合格只由簽署路徑寫、已判定不可改申報資料、有有效確認量不可撤銷判定）、不合格／部分合格開缺失下沉 `inspections_defect_sync`（前端 `recordInspectionResult` 的 insert 退場，快速判定與表單簽署同一份）、`fn_field_document_template('inspection_form')` 示範範本、規則推導通用化 `fn_field_document_item_keys(doc_type, …)`＋`fn_field_document_stage_required`（工項有 ITP H 點才要 `stage_key`）、`create_inspection_form_draft(p_inspection_id)`、`sign_field_document` 的 `inspection_form` 分支 `field_document_sign_inspection_form_internal`（簽署即判定並在同交易寫 `inspection_confirmations`，見 [確認量文件 §16.6](confirmed-quantity-valuation.md)）、Edge `buildInspectionFormDraft`、`/inspection-form` 頁與 `/inspection-form/print`、提送對象單一來源 `FIELD_DOC_TO_ORGS`（§3.3「P3c 落地」）。**P3e 共用補值（migration `20260920004000_intake_shared_inputs`；pgTAP `intake_shared_inputs.sql` 95 條）**：`set_intake_shared_input`／`list_intake_shared_inputs` 與共用鍵目錄，批次結果頁「一次補齊」（§2.4）。前端 P2c 已接上（`/site` 拍照／上傳＋批次恢復＋文書清單、`/site-log` 施工日誌文件頁：審核／簽署／提送／收件／退回；`src/store/slices/fieldDocs.js` 是施工日誌唯一寫入路徑，舊 `saveSiteLog` 直接 upsert 已移除，見 §3.1 第 1 步與 §3.3「P2c 落地」）；監造日誌頁面（P3a 前端）已接上：`/supervisor-log`（`?d=`／`?doc=`）沿用同一組共用元件（`DocumentLifecycle`／`DocumentPhotos`／`IntakeUploader`／`WeatherPull`／`FieldSourceChip`／`RowsEditor`，依 `doc_type` 決定責任方與提送對象），欄位版面由伺服器範本驅動並標「示範範本」，到場欄由人親自確認（見 §3.3「P3a 落地」）、`/supervisor-log/print` 印簽署版本；P3d（純前端）起 `/site-log/print` 也印簽署版本與雜湊，三個列印頁共用選版本與頁首戳記，文件卡列提送回執與退回歷史（見 §6「P3d 呈現」）。實作進度只看 [續接清單](../reviews/2026-09-17-product-slimming-worklog.md)。
> 標記：**【已確認】**＝使用者已確認的產品邊界（D-026，不需再問）；**【設計】**＝實作者選擇，實作時可調整但須回寫本文件；**【待決】**＝需使用者決定，答覆前依「暫行」做，不阻擋其他工作。

## 0. 現況核對（基準 `ab4be5f`）

| 文書 | 既有事實表／頁面／Edge | 已有 | 真缺 |
|---|---|---|---|
| 施工日誌 | [`daily_logs`](../../supabase/migrations/20260711000000_baseline.sql)（`unique(project_id, log_date)`、公定格式欄位）、`daily_log_items`、`photos`；[`SiteLog.jsx`](../../src/pages/web/SiteLog.jsx)、`SiteLogPrint.jsx`；Edge `classify-site-photo`、`read-whiteboard`；Agent [`draft_daily_log`](../../supabase/functions/_shared/draftDailyLog.ts) | 照片批次辨識→模糊配工項→上傳（`photos.caption/work_item_id/location/ai_source` 落庫）；白板轉錄數量到表單；Agent 草稿進 `agent_actions`（數量一律留空）；列印版 | 辨識結果在上傳前只存頁面 `staging` state，切頁即失；`daily_logs.status` 程式一律寫 `'已送出'`，沒有生命週期；沒有版本／內容雜湊／簽署／提送／回執；`daily_logs` 沒有任何 guard（只有 RLS `can_write`），已存檔內容可被任何廠商成員改寫 |
| 監造日誌 | **無**。[`SupervisorReport.jsx`](../../src/pages/web/SupervisorReport.jsx) 是**月份彙整**（`buildSupervisorReport(data, month)`），不是每日紀錄 | — | 整份缺：事實表、每日範本、監造自己的照片來源、與當日查驗的連結、簽署提送 |
| 自主檢查表 | `checklist_templates.items`（num／bool 項）、`checklist_records`（`results`、`overall`、修訂鏈 `rev/root_id/supersedes_id`，[guard](../../supabase/migrations/20260712001700_checklist_revisions.sql) 禁止就地修改）；`ChecklistPrint.jsx`；Agent [`draft_inspection`](../../supabase/functions/_shared/draftInspection.ts) | 量化自動判定（前端 `qc.js`）、修訂版次、缺失連動、查驗申請檢附（`inspections.checklist_record_id`） | 照片→草稿只有 Agent 對話路徑（`num` 一律留空，`bool` 需 basis）；無簽署／提送；正式資料 5 筆 `work_item_id` 全為 null。**P3b 已補**：照片→自檢表草稿、`/self-check` 文件頁、簽署寫 `checklist_records`（判定與缺失下沉 DB）、檢附已簽署版本 |
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

### 2.2 新增或加欄（最少必要）【設計；P2a 已實作者以 migration `20260917201000_field_documents` 為準】

實作原則（P2a 定案，之後的 RPC／Edge 都建立在這上面）：**「使用者路徑」**＝`auth.uid()` 不為 null 的寫入，含 authenticated 直接寫入與 security definer RPC；**「service 路徑」**＝無 JWT（Edge service client、migration）。客戶端能寫哪些欄位由**欄位級 grant** 決定（PostgREST 只送出客戶端給的鍵，沒授權的欄位一律 `42501`），伺服器事實由 trigger 蓋寫或拒絕變更；結構不變量對所有寫入者一體適用。列級 guard 管不到 TRUNCATE（不觸發 row trigger、不受 RLS 約束），因此 H1（migration `20260917213900`）把 anon／authenticated／service_role 對所有 public 表的 TRUNCATE／REFERENCES／TRIGGER／MAINTAIN 收回並修正 default privileges——版本／簽署／提送列「不可變」才是對三個 API 角色都成立的保證，不只是對 DELETE。

**`photo_intakes`（一次上傳＝一批）**

| 欄位 | 說明 |
|---|---|
| `id`, `project_id`, `created_by`, `created_at`, `updated_at` | `created_by` 使用者路徑蓋成 `auth.uid()` |
| `uploader_org text not null` | 使用者路徑蓋成 `my_org_type()`（contractor／supervisor；試用模式的機關 admin 會得到 `owner`，其照片不能作任何一方的證據）；service 路徑依 `created_by` 的 profile 推得，推不出即拒絕 |
| `log_date date` | 業務日期（台北日曆日）；辨識不到就 null＝待補；使用者可改 |
| `status text` | `received`／`recognizing`／`drafting`／`ready`／`partial`／`failed`／`discarded`；使用者只能改成 `discarded`（終態），其餘由 Edge service 寫 |
| `photo_count`, `recognized_count`, `failed_count int` | 進度與部分失敗揭露；只有 service 可寫 |
| `shared_inputs jsonb` | 跨文件共用補值 `{<鍵>: {value, set_by, set_at}}`（§2.4）；只由 `set_intake_shared_input` RPC（P3e 已實作）寫——authenticated 沒有此欄 UPDATE grant |
| `candidates jsonb` | 系統判斷的候選文書清單 `[{doc_type, target_key, reason, excluded}]`；使用者只能切換 `excluded`（guard 去掉 `excluded` 後逐項比對，其餘變更拒絕） |
| `run_started_at`, `last_progress_at`, `attempts int`, `error_summary text` | 可續跑 run 模型（§3.3），比照 [resumable-extraction](resumable-extraction.md)；只有 service 可寫 |

grants：authenticated SELECT；INSERT 只開 `id, project_id, log_date`；UPDATE 只開 `log_date, status, candidates`；DELETE 表級（guard 限制）。RLS：SELECT 專案成員；INSERT `can_write`；UPDATE／DELETE `can_write` 且 `uploader_org = my_org_type()`（`admin_override` 例外）。guard：`project_id`／`created_by`／`uploader_org`／`created_at` 不可變；有照片或已起稿文件的批次任何人都不可刪（照片是證據，改用捨棄）；使用者路徑只能刪 `received` 的空批次。索引：`(project_id, created_at desc)`、`(project_id, status)`、`(created_by, created_at desc) where status <> 'discarded'`（§3.3 恢復清單）。

**`photos` 加欄**：`intake_id uuid`（FK `photo_intakes` on delete set null）、`uploader_org text`（check contractor／supervisor／owner；nullable 只為舊資料）、`ai_status text`（`pending`／`done`／`failed`／`not_site`／`unreadable`／`duplicate`；掛進批次的照片預設 `pending`，非批次照片為 null）、`ai_result jsonb`（`classify-site-photo`／`read-whiteboard` 原始結構化輸出）、`ai_run_at`、`work_item_hint text`（未配對時保存 AI 關鍵詞，匯標單後可再配）、`content_sha256 text`（客戶端算的檔案雜湊，`^[0-9a-f]{64}$`；重複照片偵測用，同一 intake 內相同雜湊由 Edge 標 `duplicate`，仍保存不刪）。`daily_log_id` 本就 nullable；intake 照片的 Storage 路徑為 `<project_id>/intake/<intake_id>/<photo_id>.<ext>`（首段仍是 project_id，既有 Storage policy 不改）。

`photos` 的 grants 改為欄位級：INSERT／UPDATE 只開既有全部欄位＋`intake_id`、`content_sha256`；`uploader_org`、`ai_status`、`ai_result`、`ai_run_at`、`work_item_hint` 只有 service 可寫（客戶端不能自稱「AI 說白板寫 100」）。trigger `photos_org_stamp`：使用者路徑插入一律蓋 `uploaded_by := auth.uid()`、`uploader_org := my_org_type()`（客戶端冒名無效）；service 路徑依 `uploaded_by` 的 profile 推得，推不出留 null（未知，不猜）；使用者路徑不可變更 `uploader_org`／`uploaded_by`，`intake_id`／`content_sha256` 登錄後不可改（比原設計「凍結後不可改掛」更嚴，因此不再改 `photos_update_guard` 白名單）；掛進批次的照片必須與批次同專案、同上傳方，上傳方未知的舊照片不能掛進批次。索引：`(intake_id, created_at)`、`(intake_id, content_sha256)`、`(intake_id, ai_status)`。

**`supervisor_logs`（監造日誌事實表；每日一份）【P3a 已實作，migration `20260917221000_supervisor_logs`；pgTAP `supervisor_logs.sql`】**

| 欄位 | 說明 |
|---|---|
| `id`, `project_id`, `log_date`, `unique(project_id, log_date)` | 同 `daily_logs` 慣例 |
| `weather_am`, `weather_pm text` | 沿用同日**已簽署／已提送**的施工日誌文件版本（`field_document:<id>:v<n>`）或 CWA；未簽署的施工日誌不引用 |
| `attendance jsonb` | 監造到場人員與時段 `[{user_id?, name, from?, to?}]`——**只能人填**：AI 版本不得帶入值、來源只能留 `pending`（版本 guard 對所有寫入者擋）；人工版本標 `filled` 也只算「待確認」（`needs_confirmation`）；簽署時須 `confirmed`（或 `na`＋reason 且陣列為空）；`user_id` 若給必須是本案監造方成員 |
| `supervision_items jsonb` | 監造事項 `[{time, item, location, work_item_id, note, source, photo_ids}]`；`work_item_id`／`photo_ids` 必須是本案的 |
| `inspection_ids uuid[]` | 當日查驗（`inspections.id`，本案）由系統帶入 |
| `notices jsonb` | 通知／督導事項 `[{to:'contractor'\|'owner', content, ref_type?, ref_id?}]`；引用經 `fn_project_ref_exists` 驗本案存在 |
| `followups jsonb` | 追蹤事項 `[{ref_type?, ref_id?, content, status:'open'\|'closed'}]`；引用同上 |
| `contractor_summary text` | 廠商施工情形摘要（引用同日已簽署／已提送施工日誌文件時標來源） |
| `daily_log_receipt jsonb` | 同日施工日誌文件的收件情形快照 `{document_id, version_no, status, signed_at, submitted_at, received_at, returned_at}` 或 `{status:'none'}`；`document_id` 必須是本案施工日誌文件 |
| `note`, `template_key`, `template_version` | 簽署當時的範本鍵／版本（示範範本 `supervisor_log_demo` v1） |
| `created_by`, `created_at`, `updated_at` | 使用者路徑 `created_by` 蓋成 `auth.uid()`；`updated_at` 由 guard 維護 |

RLS：SELECT 專案成員（Q4：使用者 2026-09-17 同意暫行「專案成員皆可讀」）；INSERT／UPDATE／DELETE 限 `can_write` 且 `my_org_type()='supervisor'`（`admin_override` 例外，與家族一致）；grants 表級 DML 給 `authenticated`（RLS 收窄）。guard `supervisor_logs_guard`：使用者路徑 INSERT 蓋 `created_by`、建立者／建立時間不可變；UPDATE／DELETE 與 `daily_logs_guard` 走**同一支** `fn_field_document_fact_guard(doc_type, …)`（有該類型文件綁定且有簽署列＝已簽署 → 只有簽署 RPC 交易內 GUC 指向同類同案同日文件的 UPDATE 可過且不得改專案／日期，DELETE 一律擋；未簽署列照舊；專案刪除 cascade 放行）。P2d 的 `fn_daily_log_signed`／`fn_daily_log_sign_bypass` 已由 `fn_field_document_target_signed(doc_type, id)`／`fn_field_document_sign_bypass(doc_type, project, date)` 取代。

**示範範本（Q11）**：`fn_field_document_template('supervisor_log')` 是唯一定義（`key='supervisor_log_demo'`、`version=1`、`is_demo=true`、`demo_label='示範範本'`、`disclaimer` 明寫非機關公定或法定格式、八節欄位含 `required`／`human_only`），`authenticated` 可執行供介面與列印取標記；必填鍵（`fn_field_document_template_required_keys`）與人填欄（`fn_field_document_human_only_keys`）由它推導，`fn_field_document_required_fields` 對 `supervisor_log` 即取範本 required（`log_date`、`weather_am`、`weather_pm`、`attendance`、`supervision_items`、`contractor_summary`）。其他類型回 null（施工日誌是公定格式，固定欄仍在必填函式）。Edge 的 `SUPERVISOR_LOG_REQUIRED_KEYS`／`SUPERVISOR_LOG_TEMPLATE` 是這份範本的鏡像（只影響 AI 草稿的初始狀態；存版與簽署一律由 DB 重算）。**前端（P3a 頁面）**向 `fn_field_document_template` 取範本後才渲染：sections 驅動版面、`required`／`human_only`／`label` 推導存檔前的待補預覽與欄位名（[`lib/fieldDocs.js`](../../src/lib/fieldDocs.js) `templateRequiredKeys`／`templateHumanOnlyKeys`／`templateFieldLabels`），`is_demo`／`demo_label`／`disclaimer` 在頁面與列印標示；示範模式（無 DB）讀 [`src/data/demoFieldDocTemplates.js`](../../src/data/demoFieldDocTemplates.js) 的 fixture，Vitest 釘住它與 Edge 鏡像同鍵、同版本、同必填鍵（三處對 DB 的一致性由 pgTAP `supervisor_logs.sql` 釘 Edge 鏡像那一側）。

**自主檢查表（P3b 已實作；migration `20260919141500_self_check_documents`；pgTAP `self_check_documents.sql`）**：不新增事實表，簽署寫既有 `checklist_records`（`template_id`／`check_date`／`location`／`work_item_id`／`results`／`overall`／`note`／修訂鏈）。`fn_field_document_template('self_check')` 是**示範框架範本**（`key='self_check_demo'`、`version=1`、`is_demo=true`、`demo_label='示範範本'`、免責聲明明寫表頭與判定欄非機關公定或法定格式、檢查項目取自本案檢查表範本；三節：基本資料 `check_date`（required）／`template_id`（required，本案 `checklist_templates`）／`work_item_id`／`location`、檢查項目 `results`（`kind='checklist_items'`，`item_rules={num:{human_only,confirm_required}, bool:{confirm_required}}`）、備註）。規則推導（單一實作）：**必填鍵**＝框架 required ∪ 範本每個項目 `results.<no>`（`fn_field_document_self_check_item_keys(content, null)`，項目鍵永遠由內容的 `template_id` 重算，stored 裡的 `results.*` 忽略）；**人填欄**（AI 版本不得帶入，`fn_field_document_human_only_keys(doc_type, content)`）＝實測值項目（`kind='num'`）；**須確認欄**（`filled` 不算齊備、回 `needs_confirmation`，新函式 `fn_field_document_confirm_required_keys(doc_type, content)`）＝人填欄 ∪ 範本 `confirm_required` 欄 ∪ 自檢表全部項目（系統建議的勾選也要人逐項確認）。`fn_field_document_unmet_fields` 改為四參數（多 `content`）、`fn_field_document_required_fields` 改為 STABLE（要讀本案範本）。`save_field_document_version` 對自檢表檢查內容 `template_id` 是本案範本（`PD010`）並同步到 `field_documents.template_id`。**判定引擎下沉 DB**：`fn_checklist_judge(items, results)` 與前端 `lib/qc.js judgeChecklist` 同一條規則（pgTAP 以同一組案例釘住：num 依 min／max、可轉數字的字串照數值、空白／null／非數字＝未檢、bool 只認 true／false；overall 無已檢＝null、任一不合格＝不合格）；`checklist_records_guard` 在**使用者路徑 INSERT** 一律以範本重算 `results.pass`／`overall`（客戶端送的判定作廢；前端判定只是存檔前預覽），service 路徑（還原／遷移）不重算（範本日後修改不得改判歷史證據）；已綁簽署文件（`fn_field_document_target_signed('self_check', id)`）的紀錄即使未判定也不可刪。**不合格自動開缺失下沉 DB**：AFTER INSERT trigger `checklist_records_defect_sync`（使用者路徑）在同交易開一筆缺失掛鏈根（標題「自主檢查不合格：範本名」、說明列不合格項目與標準、Rev.N 註記、位置、工項、`created_by`＝登錄者），同鏈已有未結案缺失不再開（既有部分唯一索引兜底，並發撞索引視為已關聯）；前端 `quality.js` 的 `syncDefect` 退場，直接寫入路徑只讀回結果。

**`checklist_templates` 加欄**：`kind text not null default 'self_check' check (kind in ('self_check','inspection_form','supervisor_certificate'))`、`stage_key text`（多階段查驗用，對應 [確認量文件 §3.4](confirmed-quantity-valuation.md)）、`applies_to jsonb`（`{work_item_ids:[], keywords:[]}`，候選文書推斷用）、`version int not null default 1`。既有列全部 `self_check`。

**`inspections` 加欄**（只由簽署 RPC 寫入）：`template_id uuid`、`results jsonb`（查驗項目結果，形狀同 `checklist_records.results`）、`stage_key text`、`batch_key text`（施作位置／批次正規化鍵）、`document_id uuid`（簽署的監造查驗表單）、`scope_note text`。既有 `location` 保留為顯示用自由文字。

**`field_documents`（文件本體，四類共用）**

| 欄位 | 說明 |
|---|---|
| `id`, `project_id`, `created_by`, `created_at`, `updated_at` | `created_by` 使用者路徑蓋成 `auth.uid()`；`updated_at` trigger 維護 |
| `doc_type text` | `daily_log`／`supervisor_log`／`self_check`／`inspection_form`；建立後不可變 |
| `owner_org text` | **generated column** `fn_field_document_owner_org(doc_type)`：daily_log／self_check→contractor，supervisor_log／inspection_form→supervisor；任何人都寫不出不一致的值 |
| `target_table text` | **generated column** `fn_field_document_target_table(doc_type)`：daily_logs／checklist_records／supervisor_logs／inspections |
| `target_id uuid` | 事實列；草稿期為 null，簽署時由 RPC 建立或綁定；guard 檢查事實表存在（`supervisor_logs` 在 P3a 之前綁定即拒絕）、列存在且同專案 |
| `target_key text` | 起稿冪等鍵（自檢＝工項＋位置、查驗表單＝查驗 id；**日誌類＝業務日期 `YYYY-MM-DD`**——P2b 修正：一批跨日要生成多份日誌，原設計的 null 會撞 `nulls not distinct` 的冪等索引）；只有 service／RPC 可寫 |
| `intake_id uuid` | 由哪批照片起稿；手動建立為 null；批次必須同專案且 `uploader_org = owner_org`（廠商批次不能起稿監造文件）；登錄後不可變 |
| `doc_date date not null` | 業務日期；有簽署紀錄後不可變 |
| `status text` | `draft`／`pending_input`／`in_review`／`signed`／`submitted`／`received`／`returned`／`discarded`／`superseded`；建立時只能是 draft／pending_input |
| `current_version_no int` | 目前版本；只能前進，且必須等於已存在的最新版本號；建立時 0 |
| `template_id uuid`, `template_version int` | 範本快照；範本必須同專案；`template_version` 待 P3c 的 `checklist_templates.version` 才由 RPC 填 |
| `required_fields jsonb` | 由範本或固定欄位推導的必填鍵（含必要附件）；只有 service／RPC 可寫（客戶端不能把必填清空來裝作可簽） |
| `recheck jsonb` | 系統列出的未通過項（缺附件、待補、角色不符）；只有 service／RPC 可寫 |
| `discard_reason text`, `discarded_by uuid`, `discarded_at timestamptz`, `discard_request_id text` | **P3f** 捨棄紀錄（`20260920021000`）：只在「轉為 `discarded`」那一次寫入，原因去頭尾空白後必填（所有寫入者，含 service；與退回必填原因同一層級），捨棄者＝`auth.uid()`（service 為 null）、時間＝伺服器 `now()`，客戶端值一律覆蓋；其餘任何寫入（含建立）四欄不可變（trigger `field_documents_discard_guard`）。P3f 前已是 `discarded` 的列（只可能由 service 寫入）四欄為 null＝未記錄原因，不回填 |

唯一性：`(project_id, doc_type, doc_date)` 部分唯一（日誌類且 `status not in ('discarded','superseded')`；`owner_org` 由 `doc_type` 決定，不需入鍵）；`(doc_type, target_id)` 部分唯一（P2d 改為只算活文件：對方收件後 superseded 另立的新文件簽署時要接手同一列事實列）；`(intake_id, doc_type, target_key) nulls not distinct` 部分唯一（活文件；起稿冪等，§3.2）。索引：`(project_id, doc_type, doc_date desc)`、`(project_id, status, updated_at desc)`、`(created_by, updated_at desc) where status in ('draft','pending_input','returned')`（§3.3 待處理清單）。

grants／RLS：authenticated SELECT（專案成員；監造日誌依 Q4 亦成員可讀）；INSERT 只開 `id, project_id, doc_type, doc_date, intake_id, template_id`，policy `can_write` 且 `owner_org = my_org_type()`（`admin_override` 例外；generated column 在 BEFORE trigger 之後、WITH CHECK 之前算好）；**沒有 UPDATE／DELETE grant 與 policy**——狀態、版本指標、必填欄、待補清單、事實列綁定一律經 P2d RPC 或 service（原設計「INSERT／UPDATE `can_write`」收緊為只有 INSERT）。

guard `field_documents_guard`（所有寫入者）：狀態轉移矩陣＝§4；**結構要件**：→`signed` 必須已有目前版本的簽署列、→`submitted`／`received`／`returned` 必須已有目前版本的對應提送／收件／退回列（狀態不能憑空宣稱，RPC 的寫入順序見 §5）；`signed`／`submitted`／`returned` → `draft`／`pending_input` 只在 `current_version_no` 增加時允許（簽後更正＝新版本）；`received` 不可再修訂，只能 → `superseded`；`discarded` 只限沒有任何簽署列的未簽署文件（P3f 起另須原因，見上表捨棄紀錄欄）；`discarded`／`superseded` 終態。人為轉移（`auth.uid()` 不為 null）另檢查角色：→in_review／signed／submitted／discarded／superseded／草稿修訂 限責任方（`admin_override` 例外）；→received／returned 必須有該版本由本方執行的收件／退回列。DELETE：已簽署／提送或有簽署列的文件任何人都不可刪（專案刪除 cascade 例外）。

**`field_document_versions`（不可變）**

`id`, `document_id`, `version_no`（trigger 指派或驗證為「下一版」）, `author_kind text check in ('ai','human')`, `created_by uuid`（human 蓋成 `auth.uid()`；ai 為 null）, `content jsonb`（object）, `field_sources jsonb`（§2.3）, `attachments jsonb`（`[{photo_id, storage_path, sha256}]`；每筆 `photo_id` 必須存在且與文件同專案，`storage_path`／`sha256` 若給必須與 `photos` 列相符）, `content_hash text`（**只在 DB 計算**：`fn_field_document_content_hash(content, attachments) = encode(sha256(convert_to(content::text || E'\n' || coalesce(attachments::text, 'null'), 'UTF8')), 'hex')`；`jsonb::text` 鍵序由 jsonb 正規化保證，客戶端傳值一律覆蓋；前端只顯示不重算，避免雙引擎）, `change_note text`, `amended_from_version int`（必須存在且早於本版）, `created_at`（伺服器時間）。`unique(document_id, version_no)`。

規則（所有寫入者）：UPDATE／DELETE 一律拒絕（只放行文件／專案刪除 cascade）；`human` 版本只能在使用者路徑建立（伺服器不得代寫人工版本）、`ai` 版本只能在 service 路徑建立；文件已有 `human` 版本後 `ai` 不得再寫版本（重試不覆蓋人工修正，改走 `suggest_field_update`）；`received`／`discarded`／`superseded` 的文件不可再加版本。authenticated 只有 SELECT（版本一律經 `save_field_document_version` RPC，P2d）。

**`field_document_signatures`（append-only）**

`id`, `document_id`, `version_no`, `content_hash`（簽署者所見版本的雜湊；必須等於該版本雜湊）, `signer_id`, `signer_org`, `signer_name_snapshot`, `signed_at`, `intent text not null`（簽署意願聲明原文，簽署當下畫面顯示的同一段；不可空白）, `method text check in ('platform_account','paper_scan')`（R1 起；`platform_account_mfa` 已於 `20260919023220` 移除）, `aal text`, `request_ip inet`, `user_agent text`, `evidence jsonb`（紙本掃描檔的 `{storage_path, sha256}`）, `created_at`。`unique(document_id, version_no, signer_id)`；複合 FK `(document_id, version_no) → field_document_versions`。

規則（所有寫入者）：只能在使用者路徑寫入（伺服器不得代簽）；簽署者必須是專案成員且 `my_org_type() = owner_org`（`admin_override` 例外）；`version_no` 必須等於 `current_version_no`（畫面是舊版即拒絕）；`content_hash` 必須等於該版本雜湊；文件狀態須為 draft／pending_input／in_review／signed；`signer_id`／`signer_org`／`signer_name_snapshot`／`signed_at`／`created_at`／`aal`（JWT）／`request_ip`／`user_agent` 全由伺服器取，客戶端值作廢；`paper_scan` 必須附 `evidence.storage_path`／`sha256`；UPDATE／DELETE 一律拒絕。authenticated 只有 SELECT。簽署方式為已登入的平台帳號（`platform_account`），不要求兩步驟驗證（R1，使用者 2026-09-19 決定）；`aal` 仍由 JWT 如實記錄，但只是證據欄位、不是政策。

**`field_document_submissions`（提送／收件／退回歷史，append-only）**

`id`, `document_id`, `version_no`, `content_hash`, `action text check in ('submit','receive','return')`, `actor_id`, `actor_org`, `to_org text`, `reason text`（退回必填）, `diff jsonb`（`{against_version_no, changed_keys[]}`；再送時由 DB 比對前次退回時的版本與本版 `content` 的頂層鍵，客戶端值作廢；首次提送為 null）, `client_request_id text`, `created_at`（伺服器時間＝回執）。`unique(document_id, client_request_id) where client_request_id is not null`＝送件重試防重複；複合 FK 到版本。

規則（所有寫入者）：只能在使用者路徑寫入；`version_no` 必須是目前版本、雜湊相符；`submit`：文件 signed（或 submitted，供第二個對象）、該版本已有簽署列、責任方（`admin_override` 例外）、`to_org` 依 `fn_field_document_to_org_allowed(doc_type, to_org)`（§4 矩陣）；`receive`／`return`：該版本必須已提送給本方（`to_org` 由伺服器帶入提送列的對象）、文件 submitted／received、`return` 必填 `reason`；`actor_id`／`actor_org`／`created_at` 由伺服器取；UPDATE／DELETE 一律拒絕。authenticated 只有 SELECT。

**AI 註冊（P2b 已實作）**：功能 `field_docs.draft`（category `draft`、edgeFunction `draft-field-documents`、minPlan `trial`、isLlm true、預設開啟）登記於 [`aiFeatures.js`](../../src/lib/aiFeatures.js)、`_shared/aiFeatures.ts` 與 seed migration `20260917213500_ai_field_docs_draft`（rollback 檔關閉開關不刪列）。逐張辨識沿用 `photo.classify`／`sitelog.whiteboard` 的 prompt 與 schema——三處共用 [`_shared/sitePhotoVision.ts`](../../supabase/functions/_shared/sitePhotoVision.ts) 同一份（P2b 加 `legible`／`has_board` 兩個布林與「板上沒寫數量回 null 不回 0」，並在 prompt 明示照片與板上文字是資料不是指令）；Edge 內對這兩個功能各自再問一次 `ai_feature_allowed`（[`aiGate.askAiFeature`](../../supabase/functions/_shared/aiGate.ts)，fail-closed：分類功能關閉＝整批 `failed` 並回該閘門的 403／503；告示板功能關閉＝照常起稿但不轉錄數量並揭露），用量各記各的 feature_key，`field_docs.draft` 本身每次呼叫記一筆零 token 事件。

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

`status` 值域：`filled`（已帶入，待核對）／`pending`（待補）／`na`（不適用，需 `reason`）／`confirmed`（人已確認或人填）。規則【已確認】：數量、實測值、到場、天氣、合格結論沒有可辨識來源一律 `pending`；白板／量測照片清楚可讀才可 `filled` 並附 `source: whiteboard:<photo_id>`；簽署時 `required_fields` 中任何 `pending` 即拒絕。**自檢表實測值（P3b）永遠 `pending`**：告示板清楚寫出對應項目的讀數只放 `hint:{value, unit, source:'whiteboard:<photo_id>'}` 供人「親自量測後採用」，不填值（人採用即 `confirmed/human`）；多板讀數不一致不給提示。

### 2.4 跨文件共用補值

同一批照片產生的草稿共用現場事實：人補一次，本批仍在草稿／待補的同方文件各建一個人工版本。已簽署／已提送文件不受影響【已確認】；來源後改只影響尚未簽署的草稿【已確認】。**P3e 已實作**（migration `20260920004000_intake_shared_inputs`；pgTAP `intake_shared_inputs.sql` 95 條；真後端 chain 12），以程式為準：

- **共用鍵目錄（單一對照 `fn_field_document_shared_keys(doc_type, doc_date, content)`，DB 一份）**。鍵帶業務日期——P2b 起一批可跨日（每日一份日誌），位置與數量不能跨日沿用；原設計的 `location:<工項>`、`qty:<工項>:<batch_key>` 據此修正：
  | 鍵 | 對應欄位 |
  |---|---|
  | `location:<YYYY-MM-DD>:<work_item_id>` | 施工日誌 `items.<工項>.location`；自主檢查表 `location`（`content.work_item_id`＝該工項） |
  | `qty:<YYYY-MM-DD>:<work_item_id>` | 施工日誌 `items.<工項>.qty_today`（施工日誌的當日數量不分批次，原設計的 `batch_key` 不適用） |
  | `weather_am:<日期>`、`weather_pm:<日期>` | 施工日誌／監造日誌 `weather_am`／`weather_pm` |

  **不共用**：監造查驗表單的位置是確認數量的批次鍵（[確認量文件 §16.6](confirmed-quantity-valuation.md)），同工項不同批次的兩份查驗若共用一個位置會把兩批確認量併成一批，只能逐份確認；出工／機具／材料是清單欄且只有施工日誌一份在用，在日誌頁編；`log_date` 是文件身分（`doc_date`），改日期走批次 `log_date`＋重新起稿，不經補值。值：位置／天氣＝去頭尾空白的非空文字（200／100 字內），數量＝非負 JSON 數字；不合法 `PD010`。
- **對象（`fn_intake_documents`）**：本批建立的文件（`intake_id`）∪ 本批候選 `document_id` 指向的文件（同日施工日誌全案一份，第二批上傳會接手前一批建的那份），且同專案、`owner_org`＝批次上傳方、未捨棄／未被取代。他方文件永遠不在對象內（廠商補值碰不到監造文件，反之亦然；偽造候選指向他方或他案文件也被過濾，pgTAP 釘住）。
- **每份文件的效果（`fn_field_document_shared_effect`，清單與寫入同一條）**：`locked`＝狀態不是 `draft`／`pending_input`，或曾經簽署（簽後更正回草稿也算——更正只在文件頁由人填原因，否則自檢表再簽會把「共用補值」當成修訂原因）；`human_value`＝欄位已由人在文件頁親自確認或標不適用（來源不是這個共用鍵），不覆蓋；`applied`＝值與來源已是這個補值；其餘（`pending`／`filled` 系統帶入待核對／缺鍵，或先前由同一補值寫入而值要更正）＝`update`。
- **寫入（`set_intake_shared_input(p_intake_id, p_key, p_value)`）**：批次上傳方成員（`can_write` 且 `my_org_type()=uploader_org`，`admin_override` 例外；與 `photo_intakes` 更新 policy 同一條）；鎖批次列、逐份鎖文件列；`update` 的文件以 `fn_field_document_apply_shared_inputs` 改內容與來源後**經 `save_field_document_version` 存成人工版本**（責任方、樂觀併發、必填／待補重算、狀態、DB 雜湊全是既有規則；附件原樣帶過，角色隔離不因補值改變；版本說明 `共用補值:<欄位>・<工項>・<日期>`）。人補的欄一律 `{status:'confirmed', source:'shared:<鍵>', confirmed_by, confirmed_at}`。至少要有一份本批文件用到這個鍵，否則 `PD010`；已捨棄批次 `PD008`；非上傳方 `PD006`。冪等：同值重送，已套用的文件不加版本，`shared_inputs` 的時間與確認者不變。回 `{intake_id, key, label, value, updated, documents:[{document_id, doc_type, doc_date, path, result:updated|unchanged|locked|human_value, version_no, content_hash, status}]}`，`content_hash` 就是 DB 版本雜湊。
- **清單（`list_intake_shared_inputs(p_intake_id)`）**：專案成員可讀；回 `can_edit` 與每個鍵的欄位中文、日期、工項（項次／名稱／單位）、值型別、目前補值與設定者，以及每份文件的效果、目前值與來源。前端（`IntakeResult` 內的 [`IntakeSharedInputs`](../../src/components/sitelog/IntakeSharedInputs.jsx)，上傳當下與「上傳批次」恢復清單同一份）只呈現：每欄一個輸入與「套用」、影響的文件逐份標「將寫入／已套用／已個別填寫，不覆蓋／已簽署（已提送…），不受影響」並可直達文件頁、套用後顯示伺服器結果；不可補值或沒有共用欄位時整塊不出現。
- **Edge 起稿不讀共用補值（與原設計「讓後續起稿直接帶入」不同）**：確認是人的動作，只存在人工版本（建立者＝按下補值的人）；AI 版本永遠不帶人的確認。補值之後才起稿的新文件在清單上標「尚未套用」，按鈕變「套用到其餘 N 份」，以同一支 RPC 重送同值套上（已套用的冪等不動）；已有人工版本的文件重跑只留建議，`applySuggestion` 只補 `pending` 欄，不會蓋掉補值。

## 3. 照片接收、辨識、起稿、保存與恢復

### 3.1 流程（Edge `draft-field-documents`；P2b 已實作，以程式為準）

1. 前端（P2c 已實作，[`IntakeUploader`](../../src/components/sitelog/IntakeUploader.jsx)＋[`fieldDocs` slice](../../src/store/slices/fieldDocs.js)）：選檔即 INSERT `photo_intakes`（`id`／`project_id`／選填 `log_date`；施工日誌頁帶當日）→ 每張先算原檔 `sha256`（`crypto.subtle`）→ 本案已有同雜湊照片就引用不重傳（跨批次查重）、同批同雜湊只傳第一張 → 壓縮→`Storage.upload`（`<project>/intake/<intake>/<photo>.<ext>`）→`photos` insert（`intake_id`、`content_sha256`，`daily_log_id` 為 null）。只有 `photos` 列寫成功才是「已保存到伺服器」，其餘狀態（排隊／計算雜湊／傳送中／失敗）一律標「仍在本機」（reducer 在 [`lib/fieldDocs.js`](../../src/lib/fieldDocs.js)，本機不持久化，重新整理就沒有）；失敗可重試且沿用同一批次。至少一張已保存就自動呼叫起稿（第 2 步），`remaining>0` 續呼叫；`field_docs.draft` 未啟用時照片仍保存、不起稿並明說。示範模式一律不接收（不寫 Demo 工項到真案）。
2. 前端呼叫 `draft-field-documents { project_id, intake_id }`（過 `openAiGate('field_docs.draft')`，`project_id` 必帶）。伺服器以 `my_org_type` 決定呼叫者組織，**必須等於批次 `uploader_org`**（否則 403 `org_mismatch`）；`owner` 批次（試用模式管理者）照常辨識但不推任何文件。
3. Edge 以 userClient 讀（RLS：批次、照片、Storage 下載、標單、既有日誌、待查驗、文件與版本），serviceClient 只寫 `photos.ai_*`（另只在原本為空時補 `caption`／`location`／`work_item_id`，不覆蓋人填的；被佐證凍結 guard 擋下改掛時只寫辨識結果並揭露）、`photo_intakes` 進度、AI 版本、`agent_actions`。
4. 逐張辨識（併發 3；每次呼叫時間預算 100 s；處理不完回 `{remaining}`，批次留 `recognizing` 並釋放 run，前端再呼叫一次即續跑）：同批同 `content_sha256` 先標 `duplicate`（最早上傳者為正本，不辨識、不計量）；`ai_status='done'`／`not_site`／`unreadable` 不重跑，`pending`／`failed` 才跑；`photo.classify` → `legible=false`→`unreadable`、`is_construction=false`→`not_site`（不套工項、不入附件、說明標「疑似非工地」）；`has_board=true` 才再跑 `sitelog.whiteboard` 轉錄日期／天氣／位置／工項數量；模型失敗、逾時、輸出不完整→該張 `failed`（記 `ai_result.error` 代碼，可重試）。
5. 工項配對：前端與 Edge 同一支 [`_shared/photoMatch.ts`](../../supabase/functions/_shared/photoMatch.ts)（`src/lib/photoMatch.js` 只 re-export；測試案例在 `photoMatch.test.js`）；比對對象＝可計價末端工項（與 `boqCalc.billableLeaves` 同一把尺）；配不到或未匯標單→`work_item_hint` 保存、照片列「待配對」，匯標單後對同一批重跑只用存下的 hint 再配、不再打模型。
6. 候選文書（[`inferCandidates`](../../supabase/functions/_shared/fieldDocDraft.ts)，確定性規則，不由模型決定；存進 `photo_intakes.candidates`，使用者先前的 `excluded` 沿用）：
   - `contractor`：每個日期一份 `daily_log`（`target_key`＝日期；`state=ready`）；無法判日的照片→一份 `daily_log` `state=blocked`（`blocked_by:['log_date']`，補批次日期後重試）；**每個「配到的工項 × 日期」一份 `self_check`**（P3b；`target_key`＝`<日期>:<work_item_id>`，範本由本案 `checklist_templates` 依工項描述以 [`pickChecklistTemplate`](../../supabase/functions/_shared/draftInspection.ts)（與 Agent `draft_inspection` 同一支）確定性挑選並在 `reason` 寫理由，候選帶 `work_item_id`／`template_id`；本案沒有範本或挑不出→`state=blocked`（`blocked_by:['checklist_template']`，由人在頁面指定範本手動建立，不猜）；範本讀取失敗→不推自檢表並在 notes 揭露，不能寫成「沒有範本」；`applies_to` 規則待 P3c）。
   - `supervisor`：每個日期一份 `supervisor_log`（`target_key`＝日期；`state=ready`，P3a）；無法判日的照片→一份 `supervisor_log` `blocked`；`status='待查驗'` 且申請日或工項相符的 `inspections` 各一份 `inspection_form`（P3c；`target_key`＝查驗 id，**跨批次同一份活文件**——`findActiveDoc` 以 `target_key` 定位，唯一索引 `field_documents_inspection_uidx`；查驗申請沒有工項或工項不是標單末端可計價工項→`blocked`（`blocked_by:['work_item']`，先補查驗申請，不猜）；查驗項目範本取本案 `checklist_templates.kind='inspection_form'` 依工項描述挑選，沒有也能起稿）。監造批次永遠推不出 `daily_log`／`self_check`，廠商批次永遠推不出監造文件（DB guard 另有一道）。`buildInspectionFormDraft`：查驗申請的工項／位置／階段／申報量／檢附自檢帶入並標 `inspection:<id>`（位置、階段、申報量為須確認欄）；單位取自標單工項；工項有 ITP 必要階段時 `stage_key` 進必填、申請的階段不在集合內→`pending` 並列出可選階段；申報量未載明→`pending` 不猜；查驗項目同自檢表一律 `pending`（讀數只放 `hint`）；**`verdict`／`confirmed_qty` 永遠 `null`＋`pending`**（人填欄，DB 版本 guard 拒絕 AI 帶入）。
   - 日期分組：照片日期＝告示板日期 > 使用者指定的批次 `log_date` > 拍攝時間的台北日曆日（`taken_at` 無 EXIF 時是上傳時刻，故排最後）；板日與拍攝日不同時仍依板日但列入 recheck；批次 `log_date` 為 null 且只推出一個日期時由伺服器回填。
7. 內容組裝（[`buildDailyLogDraft`](../../supabase/functions/_shared/fieldDocDraft.ts)，全部確定性）：工項列＝照片配到的工項 ∪ 告示板列出的工項；數量只在告示板清楚寫出且各板一致時 `filled`（`whiteboard:<photo_id>`），否則 `pending`（不一致列 recheck）；位置唯一才帶入、多個要人分列；天氣＝告示板 > 當日既有 `daily_logs` > 中央氣象署（`fetch-weather`，過自己的閘門）> `pending`；出工／機具／材料＝當日既有日誌 > 昨日（`yesterday:<id>`，待核對）> `pending`；公定格式各節 `extras.*` 只帶當日既有日誌填過的，其餘 `pending`（不填「無」）；`work_summary`＝當日既有日誌 > 各張照片 AI 說明的確定性拼接（`ai:photo`）> 告示板摘要 > `pending`——**與原設計不同：不再另打一次模型寫敘述欄**，說明本身已是模型輸出，再餵第二個 prompt 只多一條把板上文字當指令的路。`required_fields`＝`log_date`、`weather_am`、`weather_pm`、`work_summary`、`labor`、`equipment`、`materials` 與每個工項的 `qty_today`（與 P2d `fn_field_document_required_fields` 的固定欄一致，簽署時會再算一次並聯集）；任一 `pending` 即 `pending_input`；本日確無機具／進料由人標 `na` 並填原因。
7b. 監造日誌內容組裝（P3a，[`buildSupervisorLogDraft`](../../supabase/functions/_shared/fieldDocDraft.ts)，全部確定性；只引用有來源的事實並逐項標來源，讀取失敗回錯誤而不是寫成「無紀錄」）：`attendance` 永遠 `[]`＋`pending`（任何照片都不是到場證明）；`supervision_items`＝監造自己的照片（配到工項的併一項、未配對逐張，`source:'ai:photo'`）∪ 當日判定的查驗（`source:'inspection:<id>'`），無則 `pending`；`inspection_ids`＝申請日為當日或當日判定的查驗（`system:inspections`，空也是事實）；`notices`＝當日開立的缺失＋當日不合格且尚無缺失列的查驗（`system:defects`，非必填）；`followups`＝未結案缺失＋全案待查驗（非必填）；`contractor_summary`／天氣只引用同日 `signed`／`submitted`／`received` 的施工日誌文件版本（`field_document:<id>:v<n>`），草稿／退回的只在 `daily_log_receipt` 揭露現況、摘要留 `pending`；天氣次序：已簽署施工日誌 > CWA > `pending`。內容帶 `template:{key:'supervisor_log_demo', version:1}`；`required_fields`＝範本必填；AI 草稿一律 `pending_input`（到場待人填）。
7c. 自主檢查表內容組裝（P3b，[`buildSelfCheckDraft`](../../supabase/functions/_shared/fieldDocDraft.ts)，全部確定性）：`check_date`（日期來源同日誌）、`template_id`（`system:template_match`，reason＝挑選理由）、`work_item_id`（`ai:photo`）、`location`（照片說明／告示板位置唯一才帶入，多個→`pending` 要人確認）；**每個範本項目 `results.<no>` 一律 `pending`**——實測值由人親自量測（告示板讀數只放 `hint`），勾選項沒有逐項依據就不代為勾選（本輪視覺辨識沒有逐項依據，Edge 不產生任何 bool 建議；資料模型允許 `filled`＋`reason`＝依據，簽署前仍須人逐項確認）；`note` 不帶；內容帶 `template:{key:'self_check_demo', version:1}`、`template_title`／`template_source` 快照；`required_fields`＝框架必填＋每項；草稿一律 `pending_input`。範本（監造日誌示範範本、自檢表示範框架）由流程層執行期向 DB `fn_field_document_template` 取（`repo.getFieldDocumentTemplate`，service client，每批快取一次；讀不到→該份 `error` 不建半份），Edge **不再維護範本鏡像常數**；從範本推導必填／人填／須確認的純規則只有 [`_shared/fieldDocTemplate.ts`](../../supabase/functions/_shared/fieldDocTemplate.ts) 一份（前端 `lib/fieldDocs.js` re-export），示範模式 fixture `src/data/demoFieldDocTemplates.js` 由 Vitest 解析 migration 原文逐字釘住。
8. 寫入（三類共用同一段，`doc_type` 只是參數；「找活文件」的鍵：日誌類＝該案該日、自檢表＝`intake_id`＋`target_key`）：活文件不存在→`field_documents`（`intake_id`、`target_key`＝日期）＋版本 1（`author_kind='ai'`；同日撞唯一索引改走既有文件）；存在且為 `draft`／`pending_input`→附件取本批該日照片 ∪ 既有最新版本的附件（另一批同日上傳的證據不因重跑而掉），內容相同→`unchanged` 不加版本，否則新增 AI 版本並推 `current_version_no`；已有人工版本→不寫版本，只寫 `agent_actions(kind='suggest_field_update')`；`in_review`／`signed`／`submitted`／`received`／`returned`→`locked` 不動。每次建立／新增版本另寫 `agent_actions(kind='draft_field_document', evidence:{intake_id, document_id, doc_type, version_no, content_hash})`，`actor_user`＝觸發者、`agent_role`＝上傳方。`photo_intakes` 收尾：`remaining>0`→`recognizing`；有照片失敗或文件寫入失敗→`partial`（`error_summary` 說明，可重試）；否則 `ready`。

### 3.2 重試冪等【已確認 行為，設計 機制】

- 逐張：`ai_status='done'`／`not_site`／`unreadable` 不重跑；`failed` 可重跑；重複上傳同雜湊標 `duplicate` 不生第二份文件也不重複計量。
- 文件：`(intake_id, doc_type, target_key)` 部分唯一索引＋`(project_id, doc_type, doc_date)` 日誌唯一索引；重跑只對**沒有任何 human 版本**且仍為草稿的文件**在內容有變時新增一個 AI 版本**（內容與附件相同→`unchanged`，不加版本；版本列不可變，不重寫 version 1；`current_version_no` 由 Edge 推到新版）；已有人工版本→Edge 先查到就不送版本、DB guard 也會拒（`field_document_versions_guard`），改在 `agent_actions` 新增 `kind='suggest_field_update'`，**建議內容（content／field_sources／attachments）放在該列 `evidence.suggestion`**——建議沒有版本列可指，這是 §7「evidence 只存指標」的明示例外。這保證重試不覆蓋人工修正，且每次 AI 產出都留痕。
- 送件：`client_request_id` 唯一；簽署以 `(document_id, version_no, signer_id)` 唯一；同一張照片可作多份文件附件，但數量只在確認量表計一次（見 [確認量文件](confirmed-quantity-valuation.md)）。
- 模型輸出不完整／逾時／結果不明：該張 `failed` 並帶 `error_summary`，批次 `partial`；不建立半份文件。

### 3.3 保存與恢復

進入「現場紀錄」時查 `photo_intakes where created_by = auth.uid() and status not in ('discarded')` 與 `field_documents where status in ('draft','pending_input','returned')`，列出「未完成的上傳」與「待處理文件」；離頁、重新登入、換裝置都從伺服器狀態恢復。**P2c 落地**：`/site` 的「上傳批次」列我建立、未捨棄的批次（`photos` 依 `ai_status` 計數），下一步由伺服器狀態純函式推得（`intakeNextAction`：`received` 有照片→開始辨識、`recognizing` 無 run→繼續、run 未過期→處理中、`partial`／`failed`→重試、`attempts≥5`→請重新上傳、`ready` 有 `blocked` 候選→補批次日期）；文件清單改讀與今日工作球權同一份 `{documents, submissions}`（`loadFieldDocumentsFromDB`，未終態全部狀態，不只三種），施工日誌開 `/site-log?doc=<id>`、監造日誌開 `/supervisor-log?doc=<id>`（頁面路由只在 `lib/fieldDocs.docPagePath` 一處；P5a 待辦帶的 `/site?doc=<id>` 落到 `/site` 後轉到該頁，保留返回來源），四類文書皆有頁面可直達（自檢表 `/self-check`、監造查驗表單 `/inspection-form`，P3b／P3c）。

**P3b 落地（自主檢查表頁 `/self-check`）**：一份文件＝一次自檢（`?doc=<id>` 直達；沒有 `?doc=` 是「新建」：選檢查日期／本案檢查表範本（預設第一張；內建 03310 首次使用經 `ensureChecklistTemplate` 落 DB，與品質查驗同一條規則）／對應工項／位置後第一次存檔才 INSERT 文件（帶 `template_id`）並存版）。廠商（`can.edit`）可編、簽、送；監造（提送對象）收件／退回；機關可讀——唯讀除日期外沒有 input。版面由框架範本 sections 驅動並標「示範範本」與免責聲明；檢查項目表（項次／項目／標準／實測值或勾選／判定預覽／來源章）由內容 `template_id` 的本案範本帶出：實測值人填即 `confirmed/human`，系統帶入（既有紀錄、建議）的值要逐項按「確認」（`needs_confirmation` 高亮）；「不適用」＝`na`＋原因並清值；告示板讀數以提示呈現、可「親自量測後採用」；判定預覽用前端 `judgeChecklist`，明寫簽署時伺服器重算為準。簽後更正＝按「建立更正版本」並填更正原因（存版 `change_note`；簽署時成為修訂版次的 `revision_reason`，空白即 `PD010`）。簽署後：「提出查驗申請（檢附此表）」→ `/quality?seg=inspections&attach=<record_id>` 預填既有查驗申請表（送出仍由人按，不改權限）；已檢附時顯示查驗名稱與入口；品質查驗的檢附下拉與詳情標「已簽署文件 vN」並下鑽到 `/self-check/print`（印簽署版本、雜湊、簽署者、DB 判定、Rev.N 與更正原因；未簽署整張標草稿）。`/site`：拍照／上傳對廠商標「施工日誌／自主檢查表自動起稿」，現場文書清單直達（自檢表列工項），現場作業「自主檢查表」入口改指文件頁；`/quality` 檢查表分段仍列直接登錄與簽署落下的全部紀錄（簽署落下的標「已簽署文件 vN」連回文件）。簽署成功後 slice 重載 `checklistRecords` 與 `defects`（缺失由 DB trigger 開）。

**P3c 落地（監造查驗表單頁 `/inspection-form`）**：一份查驗申請一份表單（`?inspection=<id>` 由品質查驗詳情或 `/site` 直達：`create_inspection_form_draft` 建立或取回活文件後改為 `?doc=`；沒有參數時監造可從「待查驗的申請」下拉建立）。監造（`can.approve`）可編、簽、送；廠商與機關（提送對象，`FIELD_DOC_TO_ORGS.inspection_form=['contractor','owner']`，與 DB `fn_field_document_to_org_allowed` 同一來源、Vitest 解析 migration 釘住）各自收件／退回，其餘唯讀——唯讀沒有 input；廠商對判定有異議以 RFI 提出（Q5）。版面由範本 sections 驅動並標「示範範本」與免責聲明：查驗申請帶入的位置／階段／申報量標「取自查驗申請」須逐項按「確認」（`needs_confirmation` 高亮）、單位取自標單工項（不一致頁面即警示、簽署 `PD010`）、階段只在工項有 ITP H 點時可選（`requiredStagesFor` 與 DB `fn_cq_required_stages_internal` 同口徑）、查驗項目表與自檢表共用 `ChecklistItemsTable`（實測值只能監造親自填、讀數只提示）；判定為三選一、本次確認數量區並列申報數量／單位／此批次已確認累計（讀 `inspection_confirmations`，`currentBatchCum` 與 DB 累計語意相同）／本次確認／簽署後累計，並即時列出與 DB 簽署規則相同的一致性問題（`inspectionFormIssues`：不得超申報、合格＝申報、部分合格 0<x<申報、不合格＝0 且須判定說明、項目不合格不得判合格）——前端只是預覽，伺服器簽署仍是邊界。簽署前意願聲明下方與確認框明示「簽署即判定…成為廠商可估驗的依據」（`DocumentLifecycle` 新增 `signNote`）；簽署成功訊息列出判定與已寫入的確認量，並重載查驗與缺失。簽後更正＝按「建立更正版本」並填原因；改確認數量須先在 P4b 撤銷原確認紀錄，否則伺服器 `PD008`。提送：每個尚未提送的對象一顆鈕（`DocumentLifecycle` 依目前版本的 submit 列算 `pendingTargets`），提送／收件／退回後以 tick 重讀文件脈絡（狀態不變但提送列變了）。列印 `/inspection-form/print?doc=`：`usePrintedVersion`＋`DocumentPrintStamp`（P3d 共用），判定／確認量／項目結果取簽署落下的 `inspections` 列；未簽署整張標草稿。`/site`：拍照／上傳對監造標「監造日誌／查驗表單自動起稿」，現場文書清單直達並列查驗名稱，現場作業多一列「監造查驗表單」入口（處理中／待收件／待判定件數）；`/quality` 查驗詳情多「以監造查驗表單判定（填確認數量）」或「監造查驗表單（版本 n）」入口、列申報數量／查驗階段／本次確認數量，查驗申請表單多「申報數量」與（工項有 H 點時）「查驗階段」；既有「合格／不合格」快速判定保留（不計確認量；缺失改由 DB trigger 開），列 P6 清理候選。示範模式：文件只存本次瀏覽，簽署明確回「示範模式無法簽署／提送」。**未做**：`checklist_templates.kind='inspection_form'` 的範本尚無建立介面（品質查驗的範本建立仍預設 `self_check`），監造查驗項目表目前只能由 API／DB 建立範本後使用；`applies_to` 尚未參與候選推斷。

**P3a 落地（監造日誌頁 `/supervisor-log`）**：一天一份活文件；監造（`can.approve`）可編、簽、送，機關（提送對象）收件／退回，廠商可讀（Q4 暫行）——唯讀除日期外沒有 input。沒有文件時是空白草稿：範本每欄 `pending`，同日施工日誌文件任何狀態都記入 `daily_log_receipt`（`system:field_documents`），只有 `signed`／`submitted`／`received` 才引用施工概況與數量到 `contractor_summary`（`field_document:<id>:v<n>`，組字與 Edge 同一支 [`_shared/fieldDocText.ts`](../../supabase/functions/_shared/fieldDocText.ts)，前端 `lib/fieldDocText.js` re-export；頁上「引用同日施工日誌」按鈕也走它），草稿／退回的只揭露現況、摘要留待補。**到場人員**：AI 版本永遠留空；人填（`fillHumanField`）只標 `filled/human`＝「已填・待親自確認」，明確按「確認到場人員」才 `confirmed`，確認後再改回到待確認；「本日未到場」＝`na`＋原因且清空——與 DB `needs_confirmation` 同一條規則，前端只是預覽，簽署仍由 RPC 擋（`PD004` detail 帶 `needs_confirmation`，頁面高亮）。到場列可「帶入本人」或選本案監造成員（`list_project_members` 過濾 `org_type='supervisor'`，帶 `user_id`；DB 簽署再驗）。監造事項逐項顯示來源（`ai:photo`／`inspection:<id>`／人工）、照片張數與工項；當日查驗以系統紀錄列出並可勾選；通知／追蹤引用的缺失／查驗以名稱顯示；來源缺漏一律留待補，不填「無」。附件：`ownerOrg='supervisor'`——廠商照片標「施工廠商提供」、只能 `role='reference'`（不提供「改為監造證據」，伺服器 `PD005` 仍是邊界）。列印 `/supervisor-log/print?doc=`：印簽署列指向的版本（不是畫面上可能更新的草稿）、文件短碼／版本／雜湊前 12 碼／簽署者與伺服器時間、「示範範本」與免責聲明；未簽署只印草稿並整張標「草稿・未簽署（非正式紀錄）」。`/site`：拍照／上傳對監造標「監造日誌自動起稿」，現場文書清單依 `docStatusMeta`（依 `doc_type` 判提送對象）列「輪到我」並可直達，「現場作業」多一列監造日誌入口（今日狀態章）。候選文書的 `excluded` 由使用者在批次結果切換（整份 `candidates` 回寫，guard 逐項比對）。前端 `unsavedEdits` 只保護尚未送出的編輯；版本保存走 `save_field_document_version`（§6）即為伺服器保存。Run 認領（P2b 實作）：`run_started_at` 不為 null＝有 run 在跑（同批第二個請求 409 `run_conflict`）；正常結束或預算用完暫停都把 `run_started_at` 清回 null；`last_progress_at` 超過 10 分鐘的 run 視為掛掉，可被接手；CAS 以 `attempts` 舊值為條件，**只有失敗／過期後重啟才計一次 `attempts`，預算暫停後的續跑不計**（否則大批次正常續跑三四次就撞上限）；`attempts` 達 5 再重啟→409 `attempts_exhausted` 並標 `failed`，請重新上傳成新批次。

### 3.4 角色隔離【已確認】

`photos.uploader_org` 由 trigger 蓋寫。簽署 RPC 依 `doc_type` 檢查附件來源：

| 文書 | 可作為主要證據的照片 | 他方照片 |
|---|---|---|
| 施工日誌／自主檢查表 | `uploader_org='contractor'` | 監造照片可列為「監造提供」註記，不作施作證據 |
| 監造日誌 | `uploader_org='supervisor'`；`attendance` 只能人填 | 廠商照片可引用為「廠商提供之施工照片」，不得作為到場或查驗執行證據 |
| 監造查驗表單 | `uploader_org='supervisor'` 為查驗現場證據；廠商自檢附件標「廠商自主檢查」 | 同上 |

共用補值（§2.4，P3e）不跨角色：只有批次上傳方能補、只寫同一方的文件、附件原樣帶過——補值後仍把監造照片當施作證據的施工日誌，簽署照樣 `PD005`（pgTAP `intake_shared_inputs.sql` 與四類簽署測試共同釘住）。

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
| discarded（P3f `discard_field_document`，原因必填） | 廠商成員（只限從未簽署、從未提送） | 監造成員（同） | 廠商成員（同） | 監造成員（同） |

捨棄的責任方是**成員**而非建立者（P3f 修正原設計「建立者」：AI 起稿的文件沒有人類建立者，同方其他成員也要能收掉擬錯的草稿；與存版／提送同一條授權）。捨棄後指向本文件的待覆核 AI 草稿（`draft_field_document`／`suggest_field_update`）同交易標 `rejected`、版本與照片全數保留；同一日期（日誌類）、同一批次＋目標（自檢表）、同一查驗（查驗表單）可立刻重新起稿——各部分唯一索引本來就只算活文件。

不變量：`signed` 以後的版本不可改；每次簽署綁定一個版本；`submitted` 必須指向已簽署版本；`received`／`returned` 只能由 `to_org` 成員執行；`returned` 後只能以新版本再簽再送，歷次 `return` 列全部保留。「今日工作」（P5a 已實作，首頁／Agent／早報同一引擎）把責任方的 `draft` 待簽署、`pending_input` 待補欄位、`in_review` 待同方核對、`signed` 待提送、`returned` 被退回待補正，以及提送對象的 `submitted`／`received` 待收件（目前版本已提送且該方尚未收件或退回；多對象各一筆）納入待辦，見 [球權](ball-in-court.md)。

## 5. 簽署【已確認 要求，設計 機制】

**P2d 已實作（migration `20260917205000_field_document_rpcs`；pgTAP `field_document_sign.sql` 140 條）**。所有 RPC 皆 `security definer`、`set search_path = public`、以 `auth.uid()` 取身分，不信任參數中的角色／組織／時間；`revoke all from public, anon`，只 `grant execute to authenticated`。錯誤以 SQLSTATE `PD0xx` 回（`message` 使用者可讀繁中、`detail` 機器可讀 JSON），P2c 依 `error.code` 分流：

| 代碼 | 意義 | 前端處置 |
|---|---|---|
| `PD001` | 畫面是舊版（版本號／基準版本不是目前版本） | 重新載入文件 |
| `PD002` | 內容雜湊與伺服器版本不符 | 重新載入 |
| `PD003` | （已廢止，R1 2026-09-19：簽署不再要求兩步驟驗證；代碼保留不重用，沒有任何路徑會拋出） | — |
| `PD004` | 必填欄位待補（`detail=[{key,status}]`，status＝`missing`／`pending`／`na_without_reason`／`needs_confirmation`（人填欄只被標 `filled`，如監造日誌到場；P3a）／`unknown_status`） | 高亮待補欄；同一份清單也在 `field_documents.recheck` |
| `PD005` | 附件不符角色隔離（`detail=[{key:'attachments.<photo_id>',status}]`，status＝`uploader_org:<org>`／`uploader_unknown`／`not_found`／`invalid`／`invalid_role`） | 改為 `role='reference'` 或移除 |
| `PD006` | 無權（未登入／非成員／非責任方／非提送對象） | 顯示訊息 |
| `PD007` | 此文件類型的簽署尚未支援（四類皆已支援：`daily_log` P2d、`supervisor_log` P3a、`self_check` P3b、`inspection_form` P3c；保留給日後新類型） | 顯示訊息 |
| `PD008` | 目前狀態不允許此動作（含已收件不可再存版、退回後原版不可再送、同日事實列已綁其他活文件） | 顯示訊息並重新載入 |
| `PD009` | `client_request_id` 已用於不同請求 | 換新的 request id |
| `PD010` | 輸入不合法（內容形狀、工項不在本案、數量缺值／負值、`log_date` 與 `doc_date` 不符、對象不在矩陣、退回無原因、空白意願） | 顯示訊息 |

P2a 的 trigger 仍是所有路徑的最後防線（`P0001`）；RPC 先以上述代碼拒絕，trigger 是備援。**P2c 前端分流**（[`fieldDocErrorGuidance`](../../src/lib/fieldDocs.js)）：`PD001`／`PD002`→頁面顯示「伺服器版本已前進」並提供「重新載入最新版本」，未存檔輸入留在畫面、不默默覆蓋；`PD004`／`PD005`→重載伺服器 `recheck`，待補欄集中列出並可點到該欄、附件問題逐張標示；`PD009`→清掉該筆 `client_request_id` 換新；其餘顯示訊息。

**`discard_field_document(p_document_id uuid, p_reason text, p_client_request_id text default null) → jsonb`**（P3f，四類共用）：責任方成員（`can_write` 且 `my_org_type()=owner_org`，`admin_override` 例外；他方、機關、非成員、跨案、未登入一律 `PD006`）；原因去頭尾空白後必填（`PD010`）；只限未簽署的三個狀態（`draft`／`pending_input`／`in_review`）且**沒有任何簽署列與提送列**——簽後更正回到草稿的文件曾經簽署，拒絕（`PD008`，已簽署文件的作廢走新版本／superseded）；已簽署／已提送／已收件／已退回／已取代 `PD008`。冪等：已捨棄的文件由同一人以同一原因重送（帶不帶同一 `client_request_id` 皆可）回原結果 `idempotent:true`；同 `client_request_id` 換原因或換人 `PD009`；他人或其他原因 `PD008`。寫入：`status='discarded'`＋原因＋請求編號（捨棄者／時間由 trigger 蓋）→ 指向本文件的待覆核 AI 草稿標 `rejected`；版本、照片、事實列一律不動；稽核 `field_document.discarded` 由既有 AFTER trigger 寫（metadata 帶 `reason`／`client_request_id`）。回 `{document_id, doc_type, doc_date, status, version_no, discard_reason, discarded_by, discarded_at, client_request_id, agent_actions_resolved, idempotent}`。前端入口：四類文書頁的 `DocumentLifecycle` 與 `/site` 現場文書清單列（`DiscardDraftButton`，確認對話框原因必填；責任方、從未簽署才顯示——清單的「曾經簽署」來自 `loadFieldDocumentsFromDB` 對未簽署狀態文件查的簽署列）；捨棄後回 `/site` 說明原因與重新起稿入口。

**`save_field_document_version(p_document_id uuid, p_base_version_no int, p_content jsonb, p_field_sources jsonb default '{}', p_attachments jsonb default null, p_change_note text default null) → jsonb`**（四類共用）：責任方成員（`can_write` 且 `my_org_type()=owner_org`，`admin_override` 例外）；`p_base_version_no` 必須等於 `current_version_no`（樂觀併發，否則 `PD001`）；`received`／`discarded`／`superseded` 拒絕（`PD008`）。建立 `human` 版本 n+1；原狀態為 `signed`／`submitted`／`returned` 時帶 `amended_from_version=n`。同交易重算並寫回 `required_fields`（見下）與 `recheck`（待補欄＋附件問題），狀態依 `recheck` 是否為空自動落 `draft`／`pending_input`。回 `{document_id, version_no, content_hash, status, required_fields, recheck, amended_from_version}`；`content_hash` 就是 DB 算的值，前端簽署時原樣送回，不重算。

**必填鍵與待補（單一實作 `fn_field_document_required_fields`／`fn_field_document_unmet_fields(doc_type, required, field_sources, content)`，存版與簽署共用；P3b 起四參數）**：有效必填鍵＝`field_documents.required_fields`（service／Edge／範本推導）∪ 類型固定欄（施工日誌六欄；其他類型取 `fn_field_document_template` 的 required）∪ 本版內容 `items.<work_item_id>.qty_today`（施工日誌）∪ 本版內容 `template_id` 範本的每個項目 `results.<no>`（自檢表）。施工日誌固定欄：`weather_am`、`weather_pm`、`work_summary`、`labor`、`equipment`、`materials`（「本日無」用 `na`＋`reason`，不得留空）。工項數量鍵永遠只從本版內容推導（stored 裡的工項鍵忽略），已從內容移除的工項不會永遠卡住簽署。`field_sources[key].status` 為 `filled`／`confirmed`，或 `na` 且有 `reason` 才算齊備；缺鍵、`pending`、`na` 無 reason、未知狀態一律待補；**須確認欄**（`fn_field_document_confirm_required_keys(doc_type, content)`＝人填欄 `human_only`（監造日誌 `attendance`、自檢表實測值）∪ 範本 `confirm_required` 欄 ∪ 自檢表全部項目）的 `filled` 回 `needs_confirmation`，只有 `confirmed` 或 `na`＋reason 才算齊備（P3a／P3b）。客戶端不能寫 `required_fields`，把它清空也裝不出可簽。

**`sign_field_document(p_document_id uuid, p_version_no int, p_content_hash text, p_intent text) → jsonb`**（共用前段＋依 `doc_type` 分派到內部函式 `field_document_sign_daily_log_internal`／`field_document_sign_supervisor_log_internal`／`field_document_sign_self_check_internal`（P3b）／`field_document_sign_inspection_form_internal`（P3c）；前段不重寫）：

1. `select ... for update` 鎖文件列；成員與責任方（`PD006`）；`current_version_no = p_version_no`（`PD001`）；版本雜湊等於 `p_content_hash`（`PD002`）。
2. 冪等：同人同版本已簽（狀態 `signed`）→ 回原簽署（`idempotent:true`），不重複；他人已簽該版本 → `PD008`。以 `(document_id, version_no, signer_id)` 自然鍵冪等，不另設 `client_request_id`（原設計參數移除）。
3. 簽署意願：`p_intent` 不可空白（`PD010`）。R1（2026-09-19）起沒有 `aal2` 政策：一般登入的平台帳號即可簽署（2026-09-17 的 MFA 決定已被使用者推翻，見 §11 Q1）。
4. 完整性：有效必填鍵全部齊備（`PD004`）；附件角色隔離（§3.4，`PD005`）：`attachments[].role` 預設 `evidence`，施作證據的 `photos.uploader_org` 必須等於 `owner_org`（施工日誌＝`contractor`），監造照片只能以 `role='reference'`（「監造提供」註記）附上，上傳方未知的舊照片不能當證據。
5. 內容形狀（`PD010`；日誌類共用「內容若帶 `log_date` 必須等於 `doc_date`」）。`daily_log`：`labor`／`equipment`／`materials` 陣列、`extras` 物件、天氣與 `work_summary` 文字、`items` 物件；`items` 的鍵必須是本案 `work_items.id`；來源非 `na` 的工項 `qty_today` 必須是非負數字。`supervisor_log`（P3a）：天氣／摘要／備註文字，到場／監造事項／查驗／通知／追蹤陣列，收件情形與範本物件；`template.key` 若給必須是目前範本；到場來源非 `na` 時陣列必須非空且每筆有 `name` 或本案監造方成員 `user_id`（`from`／`to` 為 `HH:MM`），`na` 時必須為空；監造事項 `item` 文字、`work_item_id`／`photo_ids` 本案；`inspection_ids` 本案查驗；通知 `to` 為 `contractor`／`owner`、`content` 文字、`ref_type`／`ref_id` 成對且經 `fn_project_ref_exists` 驗本案存在；追蹤 `status` 為 `open`／`closed`、引用同上；`daily_log_receipt.document_id` 必須是本案施工日誌文件。`self_check`（P3b）：`check_date` 必須等於 `doc_date`；`template_id` 必須是本案 `checklist_templates` 且至少一個項目；`work_item_id` 若給必須本案；`results` 物件的每個鍵必須是範本項次，值依 kind（num→數字、bool→布林），來源 `na` 時值必須空、非 `na` 時值不得空（未檢請標不適用）；框架 `template.key` 若給必須是目前框架；已綁事實列（再簽）必須沿用前次範本且簽署版本 `change_note` 非空（成為 `revision_reason`）。`inspection_form`（P3c）：`inspection_date` 必須等於 `doc_date`；`inspection_id` 本案且與文件 `target_key`／`target_id` 一致、未由另一份表單判定（`PD008`）；`work_item_id` 本案末端可計價且有單位、與查驗申請一致；`unit` 正規化後等於工項單位；`location` 非空（＝批次鍵）；`stage_key` 依工項 ITP 必要階段（無階段不可帶、有階段須在集合內）；`declared_qty` 非負且查驗申請已載明時必須相同；`verdict` 三值、`confirmed_qty` 非負且 ≤ 申報，合格＝申報、部分合格 0<x<申報、不合格＝0，不合格／部分合格須 `result_note`；`template_id` 若給須本案 `kind='inspection_form'`，`results` 逐項驗型別並以 `fn_checklist_judge` 判定，任一項不合格不得判合格；同查驗已有 active 確認：同工項同階段同量＝冪等不重複累加，否則 `PD008`（先 `revoke_inspection_confirmation`）。
6. 寫入順序（同交易）：`insert field_document_signatures`（trigger 驗版本／雜湊／角色／成員，簽署者資料、時間、aal、IP、UA 由伺服器取；`method='platform_account'`）→ 事實列（交易內 GUC `pmis.field_document_sign=<document_id>` 放行該類型的事實表 guard）：`daily_log`→`daily_logs` 依 `(project_id, log_date)` upsert（`status='已簽署'`，`created_by` 沿用既有列）＋`daily_log_items` 整組重寫（來源為 `na` 的工項不落列）；`supervisor_log`→`supervisor_logs` 依 `(project_id, log_date)` upsert（全部內容欄、`inspection_ids` 轉 `uuid[]`、`template_key`／`template_version`）；`self_check`→以 `fn_checklist_judge` 判定後 **INSERT** 一列 `checklist_records`（首簽 `supersedes_id` null＝Rev.0；已綁事實列再簽＝`supersedes_id`＝前次列、`revision_reason`＝簽署版本 `change_note`，guard 依鏈算 `rev`／`root_id`；不合格由 AFTER trigger 同交易開缺失；每次簽署都是新列，不需 GUC 放行）；`inspection_form`（P3c）→ 交易內 GUC 放行 `inspections_guard` 的簽署專屬欄：`update inspections set status=判定, result_note, inspected_by, inspected_at=簽署時間, work_item_id, location, stage_key, declared_qty, confirmed_qty, template_id, results(判定後), document_id, document_version_no, checklist_record_id`（不合格／部分合格由 AFTER trigger `inspections_defect_sync` 同交易開缺失，說明含申報／確認／差額），再依判定 INSERT `inspection_confirmations`（`qty_cum`＝此工項此批次此階段前次有效累計＋本次確認；`confirmed_at`＝簽署時間；P4b guard 驗其餘不變量並自動同步草稿期）→ `update field_documents set status='signed', target_id=<事實列 id>, recheck='[]'`（guard：簽署列已存在、事實列存在且同案；事實列必須先於綁定）→ `resolve_agent_action_internal`。
7. 日誌類：同日事實列已被另一份**活**文件綁定 → `PD008`（依 `target_table` 以專案＋日期查事實列，兩類日誌共用；自檢表沒有每日唯一，不做此檢查）；`superseded`／`discarded` 的舊文件仍保留 `target_id`，新文件接手同一列（`field_documents_target_uidx` 已改為只算活文件）。

回 `{document_id, version_no, content_hash, signature_id, signed_at, signer_id, status:'signed', target_table:'daily_logs'|'supervisor_logs'|'checklist_records'|'inspections', target_id, agent_actions_resolved, idempotent}`。稽核 `field_document.signed` 由簽署列的 AFTER trigger 寫，RPC 不另記。

**事實表 guard（`daily_logs_guard` BEFORE UPDATE／DELETE、`supervisor_logs_guard` BEFORE INSERT／UPDATE／DELETE、`daily_log_items_guard` BEFORE INSERT／UPDATE／DELETE，所有寫入者含 service；規則單一實作 `fn_field_document_fact_guard(doc_type, op, …)`，P3a）**：「已簽署」＝有該類型文件綁定該列且該文件有任何簽署列（`fn_field_document_target_signed`；簽後更正回草稿期間事實列仍是舊簽署內容，同樣受保護）。已簽署列只放行：專案刪除 cascade；或 GUC 指向「同類同案同日」文件的 UPDATE（`fn_field_document_sign_bypass`；用專案＋日期而非 `target_id` 比對，因接手的新文件首次簽署時尚未綁定）且不得改專案／日期。DELETE 一律不放行（含 `reset_project_boq`：與該 RPC「有簽核證據時整包 rollback」的既定行為一致；`work_items` 刪除 cascade 到已簽署列的明細也被擋）。未簽署的既有日誌（正式 12 筆）維持舊路徑可直接寫，這是 P2c 改接前的相容範圍；舊 `saveSiteLog` 對已簽署日期的 upsert 會收到 `P0001` 明確訊息，不會靜默改寫；`supervisor_logs` 沒有舊路徑，未簽署列同樣開放監造直接寫（與家族一致），簽署後只有簽署 RPC 可重寫。

簽署後更正：`save_field_document_version` 對 `signed`／`submitted`／`returned` 文件建立版本 n+1（`amended_from_version`），`status` 回 `draft`／`pending_input`，原簽署列與原版本不動、原提送列仍指向舊版、事實列等重簽才更新；必須重簽重送。列印版印出 `文件短碼＋版本號＋雜湊前 12 碼`；紙本簽回（`method='paper_scan'`，綁定同一版本雜湊、掃描檔 `sha256` 入 `evidence`）是保留的日後方式，本輪不啟用。本設計不宣稱符合任何機關的電子簽章規範；簽署方式依使用者 2026-09-19 改決為已登入的平台帳號、不要求兩步驟驗證（§11 Q1）。

## 6. 提送、退回歷史、回執

**P2d 已實作（四類共用；對象矩陣、`to_org` 伺服器帶入、`diff` 由 P2a trigger 決定）**。三支都回同一形狀的回執 `{submission_id, document_id, version_no, content_hash, action, actor_id, actor_org, to_org, reason, diff, client_request_id, created_at, status, idempotent}`，`created_at` 為伺服器時間＝送件／收件／退回回執。

- `submit_field_document(p_document_id uuid, p_version_no int, p_to_org text, p_client_request_id text default null)`：責任方成員（`PD006`）；版本＝目前版本（`PD001`）；狀態 `signed`（或 `submitted`，供第二個對象）否則 `PD008`；`to_org` 依 §4 矩陣（`PD010`）。冪等：同 `client_request_id` 且同版本／同對象／同人 → 回原回執（`idempotent:true`）；同 id 不同請求 → `PD009`；同版本已提送給同一對象（無 request id）→ 自然鍵冪等回原回執。首次提送 `diff` 為 null；退回後再送的 `diff={against_version_no, changed_keys[]}` 由 trigger 比對前次退回版本計算。
- `receive_field_document(p_document_id uuid, p_version_no int, p_client_request_id text default null)`：只有該版本 `submit` 列的 `to_org` 成員（`PD006`；機關在正式模式雖唯讀，仍可收件監造日誌）；狀態 `submitted`／`received`（`PD008`）；本方已收過同版本 → 自然鍵冪等。
- `return_field_document(p_document_id uuid, p_version_no int, p_reason text, p_client_request_id text default null)`：同上對象檢查；`reason` 必填（`PD010`）；狀態 `submitted`／`received`（`PD008`）；退回後 `status='returned'`，原版不可再送（`PD008`），只能 `save_field_document_version` 建新版本→重簽→再送；歷次 `return` 列（含原因）全部保留。

不會把 `submittals.review_note` 當歷史；送審文件的歷次退回原因另列 [瘦身文件 §4](slimming-entrypoints-and-retirement.md)。不對真實成員寄信；通知只進「今日工作」與既有早報路徑。

**P3d 呈現（純前端；只挑選／排列伺服器列，不重算雜湊、差異或狀態）**：
- 列印（施工日誌 `/site-log/print`、監造日誌、自主檢查表共用 [`usePrintedVersion`](../../src/lib/usePrintedVersion.js)＋[`DocumentPrint`](../../src/components/sitelog/DocumentPrint.jsx)）：印「簽署列指向的版本」＝版本號最大的簽署列（`lib/fieldDocs.printSignature`；一個版本只會有一位簽署者，簽後更正在較新版本上重簽），頁首印文件短碼、版本、`content_hash` 前 12 碼、簽署者與伺服器簽署時間；沒有簽署列印最新存檔版本並整張標「草稿・未簽署」；有簽署列卻讀不到該版本即顯示讀取失敗，**不以最新版本代印**。施工日誌內容取該版本（工項項次／名稱／單位取版本快照，契約數量與排序查工項表），累計＝此日之前的 `daily_logs` 列＋本張紙本；沒有文件、只有舊流程既有列時印該列並標「既有紀錄、無版本與雜湊」。只讀既有表（`field_documents`／`field_document_versions`／`field_document_signatures`），沒有新增 RPC。
- 文件卡（[`DocumentLifecycle`](../../src/components/sitelog/DocumentLifecycle.jsx)，四類共用）：「提送與回執」＝最近一輪送件（最新 submit 列的版本）每一筆 submit 列（監造查驗表單同版本送兩個對象各一張）：對象、送出時間與送件人、送件版本與雜湊、完整回執編號（`submission_id`＝提送列 id）、收件狀態（該對象方對同版本最後一次 receive／return）、下一責任方（與今日工作球權同一支 `fieldDocumentBalls`）。「退回歷史」＝全部 return 列依時間由舊到新：原因、退回人、時間，配上其後第一筆 `diff.against_version_no` 指向該退回版本的再送列與 DB 算的 `changed_keys`；尚未再送標「尚未補正再送」。完整流水仍在「歷次提送紀錄」。提送列只存 `actor_id`（沒有姓名快照），姓名以既有 `list_project_members` 對照，已離開本案的成員只顯示單位；要保存姓名快照需 schema 變更，未做。
- 伺服器時間（簽署、提送、收件、退回、上傳批次）一律以台北時間顯示（`lib/dates.taipeiDateTime`）；PostgREST／RPC 回 UTC，原本直接切字串會差 8 小時。

## 7. AI 草稿與 `agent_actions` 邊界

- 照片起稿與 Agent 對話起稿都落 `agent_actions`（新 kind `draft_field_document`／`suggest_field_update`；P2b 起由 Edge service 寫，`actor_user`＝觸發起稿的使用者、`agent_role`＝批次上傳方），`draft_field_document` 的 `evidence` 只存指標（文件、版本、雜湊、intake），不重複存 payload；`suggest_field_update` 沒有版本列可指，`evidence.suggestion` 帶建議內容（§3.2）。
- `agent_actions` SELECT 仍限本人；文件本體對同方成員可見可編（`field_documents` RLS）。簽署者非草稿收件人時，由 RPC 內部函式標處理狀態並記 `resolved_by`——這是對 [Agent 邊界](agent-tool-boundary.md) 的明示延伸（P2d 已實作並更新該文件）：`resolve_agent_action_internal(p_document_id, p_project_id, p_status)` 只由 `sign_field_document` 呼叫（authenticated 不可執行），把同案、`target_table='field_documents'`、`target_id=文件`、`pending` 的草稿全部標 `accepted`（文件無人工版本）或 `edited`（有人工版本），`resolved_by=簽署者`，每筆留 `agent_action_resolved` 稽核（`metadata.resolved_via='sign_field_document'`）；舊 `draft_daily_log`（`target_table='daily_logs'`、`target_id` null）不受影響。
- 既有 `draft_daily_log`／`draft_inspection` 工具改為產生 `field_documents` 草稿（保留工具名與回傳形狀），接受路徑統一走簽署 RPC；`acceptDraft` 的直接 `saveSiteLog` 路徑退場。**P2c 落地（前端側）**：`acceptDraft` 對 `draft_daily_log` 改為 `applyDailyLogDraft`——找／建該日文件草稿，把 payload（含收件匣卡片人填的數量）以 `contentFromAgentDraft` 轉成內容與來源（人填數量 `confirmed`、沒填 `pending`、天氣依 `cwa` 標來源）存成人工版本，再標 `accepted`；正式紀錄仍要到施工日誌頁簽署。Edge 端 `draft_daily_log` 工具本身仍寫 `agent_actions(target_table='daily_logs')`（未改為直接建 `field_documents`），列 P3／P6 待辦。

## 8. RLS／guard／RPC 清單（實作對照）

| 物件 | 類型 | 責任 |
|---|---|---|
| `photo_intakes`、`photos` 新欄、`field_documents`、`field_document_versions`、`field_document_signatures`、`field_document_submissions`：表＋RLS＋欄位級 grants（§2.2） | 表 | **P2a 已實作**（`20260917201000_field_documents`；rollback `supabase/rollbacks/20260917201000_field_documents.down.sql`） |
| `supervisor_logs`（表＋RLS＋表級 DML grants）、示範範本 `fn_field_document_template`／`fn_field_document_template_required_keys`／`fn_field_document_human_only_keys`、`fn_field_document_type_label`、`fn_project_ref_exists` | 表／函式 | **P3a 已實作**（`20260917221000_supervisor_logs`；rollback `supabase/rollbacks/20260917221000_supervisor_logs.down.sql`） |
| `photos_org_stamp`、`photo_intakes_guard`、`field_documents_guard`（狀態矩陣＋結構要件＋角色）、`field_document_versions_guard`（不可變、雜湊、版本號、作者情境、附件；P3a 加「人填欄 AI 版本不得帶入」）、`field_document_signatures_guard`、`field_document_submissions_guard` | trigger | **P2a 已實作**（版本 guard 由 P3a `create or replace`） |
| `daily_logs_guard`、`daily_log_items_guard`、`supervisor_logs_guard`（已簽署列只有簽署 RPC 的交易內 GUC 可重寫；DELETE 一律擋；未簽署列照舊）＝單一實作 `fn_field_document_fact_guard`＋`fn_field_document_target_signed`／`fn_field_document_sign_bypass` | trigger | **P2d 已實作、P3a 抽成通用實作**（P2d 的 `fn_daily_log_signed`／`fn_daily_log_sign_bypass` 已移除） |
| `fn_field_document_template('self_check')` 示範框架範本、`fn_field_document_checklist_items`／`fn_field_document_self_check_item_keys`、`fn_field_document_human_only_keys(text, jsonb)`／`fn_field_document_confirm_required_keys(text, jsonb)`、`fn_field_document_required_fields`（STABLE）／`fn_field_document_unmet_fields(text, jsonb, jsonb, jsonb)`、`fn_checklist_judge`、`checklist_records_guard`（使用者路徑重算判定、已綁簽署文件不可刪）、`checklist_records_defect_sync`（AFTER INSERT 開缺失）、`field_document_versions_guard`／`save_field_document_version`／`sign_field_document`（自檢表分支 `field_document_sign_self_check_internal`） | 函式／trigger／RPC | **P3b 已實作**（`20260919141500_self_check_documents`；rollback `supabase/rollbacks/20260919141500_self_check_documents.down.sql`；無新 authenticated grant，H3 允許清單不變） |
| `inspections` 新欄只允許 RPC 寫 | trigger `inspections_guard`（BEFORE INSERT OR UPDATE：`confirmed_qty／results／document_id／document_version_no／template_id` 與「部分合格」只由簽署路徑寫；建立只能待查驗；已判定不可改申報資料；有有效確認量不可撤銷判定）＋`inspections_defect_sync`（AFTER UPDATE 開缺失） | **P3c 已實作**（`20260919222000`） |
| 純 helper `fn_field_document_content_hash`、`fn_field_document_owner_org`／`fn_field_document_target_table`（generated column 用，authenticated 可執行）、`fn_field_document_to_org_allowed`、`fn_field_document_changed_keys`、`current_jwt_aal`、`current_request_user_agent`、`can_read_field_document` | 函式 | **P2a 已實作** |
| `save_field_document_version`、`sign_field_document`（共用前段＋`daily_log`／`supervisor_log` 分支內部函式 `field_document_sign_daily_log_internal`／`field_document_sign_supervisor_log_internal`；`self_check`／`inspection_form` `PD007`）、`submit_/receive_/return_field_document`、內部 `resolve_agent_action_internal`／`field_document_respond_internal`；純 helper `fn_field_document_required_fields`／`fn_field_document_unmet_fields(doc_type, …)`／`fn_field_document_attachment_issues`／`fn_field_document_receipt` | security definer RPC，`revoke all from public, anon`、僅 `authenticated`；內部與 helper 連 authenticated 都不可執行；錯誤代碼與寫入順序見 §5 | **P2d 已實作、P3a 重構分派並加分支**（save／sign 由 `20260917221000` `create or replace`） |
| `sign_field_document` 的 `inspection_form` 分支、`create_inspection_form_draft(p_inspection_id)`（監造由查驗申請建立或取回草稿；`grant execute to authenticated`，pgTAP 允許清單同步） | security definer RPC | **P3c 已實作**（`20260919222000`） |
| `set_intake_shared_input`、`list_intake_shared_inputs`（authenticated，H3 允許清單 80→82）；內部 `fn_intake_shared_key_parts`／`fn_intake_shared_field_label`／`fn_intake_shared_value`／`fn_field_document_shared_keys`／`fn_field_document_shared_effect`／`fn_field_document_apply_shared_inputs`／`fn_intake_documents`（API 角色皆不可執行） | security definer RPC／helper | **P3e 已實作**（`20260920004000`；同支第 6 節接 P4e 交接：`field_document_sign_inspection_form_internal` 與 `inspections_defect_sync` 的數量文字經 `fn_cq_txt`；rollback `supabase/rollbacks/20260920004000_intake_shared_inputs.down.sql`） |
| `create_field_document_draft`（service；P2b 起稿改由 Edge service 直接 INSERT，本 RPC 未建） | security definer RPC | 未建（不需要） |
| `discard_field_document(p_document_id, p_reason, p_client_request_id)`（authenticated，H3 允許清單 82→83）；trigger `field_documents_discard_guard`；`field_documents_audit` 的 discarded 事件 metadata 帶原因與請求編號；`resolve_agent_action_internal` 加 `rejected`（`resolved_via=discard_field_document`） | security definer RPC／trigger | **P3f 已實作**（`20260920021000`；rollback `supabase/rollbacks/20260920021000_field_document_discard.down.sql`；錯誤碼 §5） |
| `field_docs.draft` 註冊三處＋seed migration `20260917213500_ai_field_docs_draft`（rollback 檔關閉開關）；Edge `draft-field-documents`＋`_shared/{sitePhotoVision,photoMatch,fieldDocDraft,fieldDocDraftRun,fieldDocRepo,fieldDocTemplate}.ts`；`aiGate.askAiFeature` 供函式內再問別的功能開關；P3a 加 `buildSupervisorLogDraft` 與 repo 的 `listInspectionsOn`／`listDefectsForDay`／`getDailyLogDocument`，流程層改為日誌類共用同一段寫入邏輯；P3b 加 `buildSelfCheckDraft`、候選 `self_check`、repo 的 `getFieldDocumentTemplate`（執行期取 DB 範本）／`listChecklistTemplates`／`findActiveDoc(docType, locator)`，範本鏡像常數退場 | AI 閘門／Edge | **P2b 已實作、P3a／P3b 擴充**（Vitest：`fieldDocDraft.test.ts` 27 條、`fieldDocDraftRun.test.ts` 28 條；pgTAP `ai_field_docs_draft.sql` 8 條） |
| 稽核事件 `field_document.{created,version_saved,signed,submitted,received,returned,amended,discarded,superseded,status_changed}`（AFTER trigger；標籤在 [`auditEvents.js`](../../src/lib/auditEvents.js)） | `record_audit_event` | **P2a 已實作** |

## 9. 舊資料過渡與回復

- 既有 `checklist_records`（5）不包裝成文件、也不重算判定（P3b 的伺服器重算只在新的使用者路徑 INSERT 生效；既有直接登錄路徑照舊可用，只是判定改由伺服器算、缺失改由 trigger 開）。既有 `daily_logs`（12）、`checklist_records`（5）、`inspections`（11）不自動包裝成已簽署文件；使用者開啟時可「建立文件草稿（沿用既有內容）」再走簽署，`field_sources` 全標 `filled/source: legacy`。**P2c 落地**：`/site-log` 開到「有 `daily_logs` 列、沒有活文件」的日期時，以該列內容帶入表單（[`contentFromLegacyLog`](../../src/lib/fieldDocs.js)：有值的欄 `filled/legacy:<id>` 並標「既有紀錄、待核對」，空欄 `pending`；工項鍵由 `item_key` 換成 uuid，換不到的保留原鍵由簽署 `PD010` 擋下），第一次存檔才 INSERT 文件並存版本；狀態章寫「既有紀錄・未簽署、待核對」，列印仍只印已落庫的列。前端不再有直接寫 `daily_logs` 的路徑（`saveSiteLog`／`deleteSiteLog` 已移除；未簽署舊列要更正只能走文件→簽署覆寫）。
- 既有 `daily_logs.status='已送出'` 不改值；新 guard 只看是否有已簽署文件指向該列。
- 既有 `photos`（正式 2 筆）：P2a 只依 `uploaded_by` 的 profile 回填 `uploader_org`（`profiles.org_type` 自 20260728000200 起使用者不可自改，是最可靠的既有證據）；推不出的維持 null＝未知，不猜；`uploader_org` 為 null 的舊照片不能掛進上傳批次。`ai_status` 等新欄舊列一律 null。
- 回復：P3b 整組（示範框架範本、規則函式、判定引擎、缺失 trigger、自檢表簽署分支、guard／save／sign／版本 guard 的新版本）由 `supabase/rollbacks/20260919141500_self_check_documents.down.sql` 移除並還原 P1-07 的 `checklist_records_guard`，之後**必須重跑** `20260917221000` 的範本／規則／guard／save 節與 `20260919023220` 的 sign 節（皆冪等）；簽署落下的 `checklist_records` 列與缺失保留（一般品質證據）。P3a 整組（`supervisor_logs` 表與資料、示範範本與規則函式、通用事實表 guard、簽署分派與分支）由 `supabase/rollbacks/20260917221000_supervisor_logs.down.sql` 移除並還原 P2a 版本 guard，之後**必須重跑** `20260917205000_field_document_rpcs.sql`（冪等）還原 P2d 的 save／sign／guard／helper；須先於 P2d 回復。P2d 整組（五支 RPC、內部函式與 helper、`daily_logs_guard`／`daily_log_items_guard`、`field_documents_target_uidx` 還原為 P2a 定義）由 `supabase/rollbacks/20260917205000_field_document_rpcs.down.sql` 移除，簽署落下的 `daily_logs` 列保留但失去保護；須先於 P2a 回復。P2a 整組（五表、`photos` 七欄、函式、trigger、`photos` 欄位級 grant 還原表級）由 `supabase/rollbacks/20260917201000_field_documents.down.sql` 移除；`inspections` 新欄可 drop；已產生的簽署與提送資料隨表移除（rollback 前先匯出）。
- 相容順序：DB（加法）→ Edge（新函式；舊 `draft_daily_log` 工具仍可用）→ 前端 → 第二支 migration 才把 `acceptDraft` 舊路徑用到的直接寫入關閉。

## 10. 驗證對應（實作時逐項補）

| 情境（依需求 §8） | 驗證 |
|---|---|
| 四類各走照片→自動生成→補缺→簽署→提送；監造日誌確為每日 | 真後端 E2E 四條；pgTAP 唯一性 `(project, doc_type, doc_date)`（P2a `field_documents.sql` 已釘）；P3a `supervisor_logs.sql`（127 條）：事實表每案每日唯一、監造寫／廠商與機關不可寫／成員可讀／非成員與跨案不可／anon 無、示範範本標記與必填推導、人填欄 `needs_confirmation`、AI／service 版本帶入到場（值或 filled／confirmed／na）一律拒絕、存版 recheck 與簽署 `PD004`／`PD005`（廠商照片與未知上傳方不能作監造證據）／`PD006` 三角色＋非成員／`PD010`（外案查驗／工項／缺失、廠商成員冒充到場、到場空或矛盾、追蹤狀態、範本鍵、收件情形引用、日期不符、形狀）／`PD001`／`PD002`；成功落 `supervisor_logs`、綁 `target_id`、簽署列由伺服器取、草稿標 edited、稽核；冪等與他人再簽 `PD008`；已簽署列直接 UPDATE／到場改寫／DELETE／upsert／service／偽造 GUC 全擋而未簽署列照舊；簽後更正回草稿、重簽更新事實列；提送對象矩陣（機關可收件）；superseded 後接手同一列；非正式案 admin_override；專案刪除 cascade。Edge Vitest：監造候選 ready／blocked、到場永遠空且 pending、監造事項來源、通知去重、追蹤、施工日誌只引用正式版本、天氣次序、未匯標單；流程層監造起稿／冪等／建議／鎖定與施工日誌同一段、來源讀取失敗不建半份 |
| 清晰量測照可轉錄、模糊照留缺、非現場照不捏造、廠商證據不冒充監造 | 模型樣本測試（有預期答案）；pgTAP 角色隔離拒絕（P2a：`uploader_org` 伺服器決定、廠商批次不能起稿監造文件、`ai_*` 客戶端不可寫） |
| 切頁／重登入可恢復；部分失敗、重試、重複上傳、逾時不丟人工修正、不重複建件 | pgTAP 冪等鍵（P2a：起稿唯一索引、有人工版本後 AI 不得寫版本、送件 `client_request_id`）；Edge 單元測試（P2b `fieldDocDraftRun.test.ts`，記憶體 repo＋stub 模型：重跑不重複建件、內容相同不加版本、有人工版本只留建議、已簽署不動、同日並發撞索引改走既有文件、逐張失敗可重試、預算切斷續跑、run 認領、逐功能閘門 fail-closed；stub 只證明流程不證明辨識正確）；P2c Vitest `fieldDocs.test.js`（上傳狀態機、恢復判讀、`client_request_id` 冪等、錯誤碼分流）與 `SiteLog.document.test.jsx`（PD001 提示重新載入且輸入留著、既有紀錄帶入、一般登入直接簽署（成功訊息／PD006 訊息）、唯讀視角）；真後端 E2E `e2e-real/chain5-field-docs.spec.js`（重新整理後批次與文件從伺服器恢復、同一張照片重傳不重建、簽舊版本 `PD001`；本機 Edge stub 模型） |
| 擬錯的草稿可捨棄、捨棄後可重新起稿（P3f） | pgTAP `field_document_discard.sql`（78 條）：結構、grants 與允許清單；未登入／他方（監造捨廠商文件、廠商捨監造日誌與查驗表單）／機關／非成員／跨案 `PD006`；原因空白或 null `PD010`；同方第二人捨棄 AI 起稿的文件（原因去空白、捨棄者＝本人、請求編號、時間由伺服器蓋）；版本與附件保留；指向本文件的起稿與建議草稿標 `rejected`、別份不動、留稽核；`field_document.discarded` 一筆且 metadata 帶原因；同一請求重送冪等、同人同原因無請求編號冪等、同請求編號換原因或他人 `PD009`、他人或換原因 `PD008`、冪等與被拒都不增加稽核；捨棄紀錄 service 也不能改寫、建立時不能帶；service 捨棄無原因被 trigger 拒、帶原因可捨且捨棄者／時間由伺服器蓋；已簽署／已提送／簽後更正草稿 `PD008`（guard 同樣擋）；P3e 共用補值清單與寫入都不再以捨棄的文件為對象；同日同批次重新起稿、同日第二份活文件仍 23505、新草稿補齊後可簽署並落 `daily_logs`；監造日誌與監造查驗表單捨棄後可重建（新文件、查驗申請仍待查驗）；自檢表同批次同目標可再起稿、`in_review` 可捨；空白版本 0 草稿可捨；每份捨棄文件都有原因。`field_documents.sql` 另釘「無原因捨棄被拒」。Vitest：`fieldDocs.test.js`（入口條件）、`DiscardDraftButton.test.jsx`（顯示條件、原因必填對話框、取消不送、伺服器拒絕如實顯示、文件頁捨棄後回 `/site`）、`db.test.js`（只替未簽署狀態文件查簽署列）、Edge `fieldDocDraftRun.test.ts`（捨棄的同日文件不動、重新上傳另起一份）；Demo E2E `contractor.spec`（清單列捨棄、文件頁捨棄→回現場紀錄→同日重新起稿）；真後端 chain 14 `e2e-real/chain14-discard-draft.spec.js` |
| 簽舊版、簽後改文／附件、越權簽署、跨案取件受阻；退回再送保留版本與理由 | P2a `field_documents.sql`（216 條）：舊版本、雜湊不符、非責任方、非成員、伺服器代簽、已移除的 `platform_account_mfa` 被 check 拒絕、簽後改日期／捨棄／刪除、退回無原因、原版再送、diff 由 DB 算、歷次紀錄不可改。P2d `field_document_sign.sql`（139 條，走真實 `authenticated`＋JWT 路徑）：存版樂觀併發與越權；一般登入（aal1）簽署成功且 `method=platform_account`（非正式案 admin_override 亦可代簽並如實記簽署者組織）；舊版 `PD001`、雜湊 `PD002`、三角色＋非成員矩陣 `PD006`、監造日誌簽署 `PD007`、待補 `PD004`、監造／未知照片冒充施工證據 `PD005`、外案工項／負數／缺值／日期不符／形狀錯 `PD010`；簽署成功落 `daily_logs`／`daily_log_items`、綁 `target_id`、草稿標 `edited`、簽署列由伺服器取資料、稽核；同人重試冪等；已簽署列的直接 UPDATE／DELETE／明細寫入／舊 upsert／service／偽造 GUC 全部被擋而未簽署列照舊；簽後更正另開版回草稿、事實列等重簽、舊簽署綁舊版；提送對象矩陣、`client_request_id` 冪等與衝突、自然鍵冪等、收件／退回只限提送對象、退回必填原因、退回後原版不可再送、再送 diff 由 DB 算、歷次全保留、已收件不可再存版；superseded 後新文件接手同一事實列；捨棄不可存版；專案刪除 cascade 通過 guard |
| 自主檢查表：照片→草稿→補實測值→簽署→檢附查驗申請；判定由 DB；修訂鏈；廠商外不可簽 | pgTAP `self_check_documents.sql`（126 條）：示範框架範本與 item_rules；判定引擎與前端同案例（num 範圍／只有 min／只有 max／空白／null／缺鍵／可轉數字字串／非數字、bool、overall、範本外鍵丟掉）；必填／人填／須確認由本案範本推導（stored 項目鍵忽略、空範本、非法 uuid）；既有直接寫入路徑伺服器重算判定＋自動開缺失（service 路徑不重算不開）；文件掛別案範本、監造建自檢表被擋；AI 版本帶入實測值或標 filled 拒絕、勾選建議附依據允許；存版別案範本 `PD010`、勾選只被建議 `PD004 needs_confirmation`、實測值待補 `PD004`、監造／未知照片 `PD005`、監造／機關／外案 `PD006`；`PD010`（範本外項次、值型別、已確認無值、不適用有值、日期不符、外案工項、框架鍵、空範本）；`PD001`／`PD002`；簽署成功落 `checklist_records` Rev.0（DB 判定、綁 `target_id`、簽署列、稽核、草稿 edited、冪等、他人再簽 `PD008`）；已簽署與已綁定未判定紀錄不可改刪；簽後更正無原因 `PD010`、填原因重簽 Rev.1（supersedes／root／reason、改判不合格同交易開缺失、再改回合格不重開）；提送對象矩陣（只能送監造）與監造收件；專案刪除 cascade。`checklist_revisions.sql` 改為 trigger 自動開缺失＋伺服器重算判定（38 條）。Vitest：`fieldDocDraft.test.ts`（自檢表候選 blocked／ready／範本挑選、每項 pending、hint、位置、空範本）、`fieldDocDraftRun.test.ts`（自檢表文件建立與定位鍵、冪等／建議／鎖定同一套、範本讀取失敗不建半份）、`demoFieldDocTemplates.test.js`（fixture 對 migration 原文逐字釘住）、`fieldDocs.test.js`（推導、內容形狀、逐項確認、建議不帶入結果）、`SelfCheck.document.test.jsx`（示範範本、逐項確認閘門、新建先落範本、簽署與更正、唯讀視角）；Demo E2E `contractor.spec`（新建→判定預覽→存檔列待補、示範模式不假裝可簽）；真後端 chain 8 `e2e-real/chain8-self-check.spec.js` |
| 手機可完成現場旅程；桌機審核；列印與簽署版本一致 | 真後端 E2E chain 5：廠商 375 寬走退回後更正→重簽→再送，監造 1024 收件／退回；chain 6（P3a 頁面，`e2e-real/chain6-supervisor-log.spec.js`）：監造上傳→起稿（到場留空）→到場親自確認→簽署（`supervisor_logs` 落庫）→列印頁印簽署版本／雜湊／示範範本→提送機關→廠商唯讀→機關 1024 退回→監造 375 更正重簽再送（無溢位）→機關收件；另以 RPC 直打證明到場只 `filled` 簽署 `PD004 needs_confirmation`、廠商照片當監造證據 `PD005`。Vitest `SupervisorLog.document.test.jsx`（範本標記、到場閘門、`needs_confirmation` 高亮、來源、PD001／PD003、三角色視角、示範模式）；Demo E2E `supervisor.spec`（示範範本、到場確認後才可簽、示範模式不假裝可簽、375 無溢位）。施工日誌列印印版本與雜湊仍留 P3d |

## 11. 待決題的使用者答覆（2026-09-17，記入 D-026 第 7 點）

- **Q1 實案簽署方式**：2026-09-17 使用者決定「先用平台帳號加 MFA」（RPC 要求 `aal2`、`method='platform_account_mfa'`）。**2026-09-19 使用者改決：整個移除兩步驟驗證**（R1）——簽署以已登入的平台帳號為身分（`method='platform_account'`），伺服器記錄簽署者／組織／姓名快照／時間／意願／版本／雜湊／IP／UA；紙本簽回與外部憑證仍未排除、本輪不做，`method` enum 改為二值。
- **Q4 監造日誌可見範圍**：使用者同意照暫行做法：專案成員皆可讀（與其他事實表一致），RLS 一行可改。
- **Q5 監造查驗表單的廠商異議**：使用者同意照暫行做法：廠商只能收件並以工程疑義（RFI）提出，不加狀態。
- **Q11 實案範本來源**：使用者決定**範本沒有，先用示範範本**——施工日誌沿用公定格式；自檢沿用既有範本；監造日誌與監造查驗表單依本文件 §2.2 欄位與現有 03310 範本形狀建立示範範本，介面與列印必須明確標「示範範本」，不得宣稱為機關公定格式。
