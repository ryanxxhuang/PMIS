# 現場文書：四類文書的資料模型、生命週期與簽署提送

> 狀態：**PROPOSED（P0 設計；P2a 資料層、P2b Edge 起稿、P2d 存版／簽署／提送 RPC 已實作）**｜2026-09-17｜依 [D-026](../DECISIONS.md)。§2.2 的 `photo_intakes`、`photos` 加欄與 `field_documents` 家族已由 migration `20260917201000_field_documents` 建立並有 pgTAP `field_documents.sql`；§3 的 Edge `draft-field-documents`（P2b）已實作，只起施工日誌，其餘三類只列候選（§3.1 以程式為準：[`fieldDocDraft.ts`](../../supabase/functions/_shared/fieldDocDraft.ts) 純規則、[`fieldDocDraftRun.ts`](../../supabase/functions/_shared/fieldDocDraftRun.ts) 流程、[`fieldDocRepo.ts`](../../supabase/functions/_shared/fieldDocRepo.ts) 存取）；§5–§7 的 `save_field_document_version`、`sign_field_document`（只有 `daily_log` 分支）、`submit`／`receive`／`return_field_document`、`daily_logs_guard`／`daily_log_items_guard`、`resolve_agent_action_internal` 已由 migration `20260917205000_field_document_rpcs` 建立並有 pgTAP `field_document_sign.sql`（§8 表列以 migration 為準）；前端（P2c）與 `supervisor_logs`（P3a）尚未動工，實作進度只看 [續接清單](../reviews/2026-09-17-product-slimming-worklog.md)。
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
| `shared_inputs jsonb` | 跨文件共用補值（§2.4）；只由 `set_intake_shared_input` RPC（P3e）寫 |
| `candidates jsonb` | 系統判斷的候選文書清單 `[{doc_type, target_key, reason, excluded}]`；使用者只能切換 `excluded`（guard 去掉 `excluded` 後逐項比對，其餘變更拒絕） |
| `run_started_at`, `last_progress_at`, `attempts int`, `error_summary text` | 可續跑 run 模型（§3.3），比照 [resumable-extraction](resumable-extraction.md)；只有 service 可寫 |

grants：authenticated SELECT；INSERT 只開 `id, project_id, log_date`；UPDATE 只開 `log_date, status, candidates`；DELETE 表級（guard 限制）。RLS：SELECT 專案成員；INSERT `can_write`；UPDATE／DELETE `can_write` 且 `uploader_org = my_org_type()`（`admin_override` 例外）。guard：`project_id`／`created_by`／`uploader_org`／`created_at` 不可變；有照片或已起稿文件的批次任何人都不可刪（照片是證據，改用捨棄）；使用者路徑只能刪 `received` 的空批次。索引：`(project_id, created_at desc)`、`(project_id, status)`、`(created_by, created_at desc) where status <> 'discarded'`（§3.3 恢復清單）。

**`photos` 加欄**：`intake_id uuid`（FK `photo_intakes` on delete set null）、`uploader_org text`（check contractor／supervisor／owner；nullable 只為舊資料）、`ai_status text`（`pending`／`done`／`failed`／`not_site`／`unreadable`／`duplicate`；掛進批次的照片預設 `pending`，非批次照片為 null）、`ai_result jsonb`（`classify-site-photo`／`read-whiteboard` 原始結構化輸出）、`ai_run_at`、`work_item_hint text`（未配對時保存 AI 關鍵詞，匯標單後可再配）、`content_sha256 text`（客戶端算的檔案雜湊，`^[0-9a-f]{64}$`；重複照片偵測用，同一 intake 內相同雜湊由 Edge 標 `duplicate`，仍保存不刪）。`daily_log_id` 本就 nullable；intake 照片的 Storage 路徑為 `<project_id>/intake/<intake_id>/<photo_id>.<ext>`（首段仍是 project_id，既有 Storage policy 不改）。

`photos` 的 grants 改為欄位級：INSERT／UPDATE 只開既有全部欄位＋`intake_id`、`content_sha256`；`uploader_org`、`ai_status`、`ai_result`、`ai_run_at`、`work_item_hint` 只有 service 可寫（客戶端不能自稱「AI 說白板寫 100」）。trigger `photos_org_stamp`：使用者路徑插入一律蓋 `uploaded_by := auth.uid()`、`uploader_org := my_org_type()`（客戶端冒名無效）；service 路徑依 `uploaded_by` 的 profile 推得，推不出留 null（未知，不猜）；使用者路徑不可變更 `uploader_org`／`uploaded_by`，`intake_id`／`content_sha256` 登錄後不可改（比原設計「凍結後不可改掛」更嚴，因此不再改 `photos_update_guard` 白名單）；掛進批次的照片必須與批次同專案、同上傳方，上傳方未知的舊照片不能掛進批次。索引：`(intake_id, created_at)`、`(intake_id, content_sha256)`、`(intake_id, ai_status)`。

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

唯一性：`(project_id, doc_type, doc_date)` 部分唯一（日誌類且 `status not in ('discarded','superseded')`；`owner_org` 由 `doc_type` 決定，不需入鍵）；`(doc_type, target_id)` 部分唯一（P2d 改為只算活文件：對方收件後 superseded 另立的新文件簽署時要接手同一列事實列）；`(intake_id, doc_type, target_key) nulls not distinct` 部分唯一（活文件；起稿冪等，§3.2）。索引：`(project_id, doc_type, doc_date desc)`、`(project_id, status, updated_at desc)`、`(created_by, updated_at desc) where status in ('draft','pending_input','returned')`（§3.3 待處理清單）。

grants／RLS：authenticated SELECT（專案成員；監造日誌依 Q4 亦成員可讀）；INSERT 只開 `id, project_id, doc_type, doc_date, intake_id, template_id`，policy `can_write` 且 `owner_org = my_org_type()`（`admin_override` 例外；generated column 在 BEFORE trigger 之後、WITH CHECK 之前算好）；**沒有 UPDATE／DELETE grant 與 policy**——狀態、版本指標、必填欄、待補清單、事實列綁定一律經 P2d RPC 或 service（原設計「INSERT／UPDATE `can_write`」收緊為只有 INSERT）。

guard `field_documents_guard`（所有寫入者）：狀態轉移矩陣＝§4；**結構要件**：→`signed` 必須已有目前版本的簽署列、→`submitted`／`received`／`returned` 必須已有目前版本的對應提送／收件／退回列（狀態不能憑空宣稱，RPC 的寫入順序見 §5）；`signed`／`submitted`／`returned` → `draft`／`pending_input` 只在 `current_version_no` 增加時允許（簽後更正＝新版本）；`received` 不可再修訂，只能 → `superseded`；`discarded` 只限沒有任何簽署列的未簽署文件；`discarded`／`superseded` 終態。人為轉移（`auth.uid()` 不為 null）另檢查角色：→in_review／signed／submitted／discarded／superseded／草稿修訂 限責任方（`admin_override` 例外）；→received／returned 必須有該版本由本方執行的收件／退回列。DELETE：已簽署／提送或有簽署列的文件任何人都不可刪（專案刪除 cascade 例外）。

**`field_document_versions`（不可變）**

`id`, `document_id`, `version_no`（trigger 指派或驗證為「下一版」）, `author_kind text check in ('ai','human')`, `created_by uuid`（human 蓋成 `auth.uid()`；ai 為 null）, `content jsonb`（object）, `field_sources jsonb`（§2.3）, `attachments jsonb`（`[{photo_id, storage_path, sha256}]`；每筆 `photo_id` 必須存在且與文件同專案，`storage_path`／`sha256` 若給必須與 `photos` 列相符）, `content_hash text`（**只在 DB 計算**：`fn_field_document_content_hash(content, attachments) = encode(sha256(convert_to(content::text || E'\n' || coalesce(attachments::text, 'null'), 'UTF8')), 'hex')`；`jsonb::text` 鍵序由 jsonb 正規化保證，客戶端傳值一律覆蓋；前端只顯示不重算，避免雙引擎）, `change_note text`, `amended_from_version int`（必須存在且早於本版）, `created_at`（伺服器時間）。`unique(document_id, version_no)`。

規則（所有寫入者）：UPDATE／DELETE 一律拒絕（只放行文件／專案刪除 cascade）；`human` 版本只能在使用者路徑建立（伺服器不得代寫人工版本）、`ai` 版本只能在 service 路徑建立；文件已有 `human` 版本後 `ai` 不得再寫版本（重試不覆蓋人工修正，改走 `suggest_field_update`）；`received`／`discarded`／`superseded` 的文件不可再加版本。authenticated 只有 SELECT（版本一律經 `save_field_document_version` RPC，P2d）。

**`field_document_signatures`（append-only）**

`id`, `document_id`, `version_no`, `content_hash`（簽署者所見版本的雜湊；必須等於該版本雜湊）, `signer_id`, `signer_org`, `signer_name_snapshot`, `signed_at`, `intent text not null`（簽署意願聲明原文，簽署當下畫面顯示的同一段；不可空白）, `method text check in ('platform_account','platform_account_mfa','paper_scan')`, `aal text`, `request_ip inet`, `user_agent text`, `evidence jsonb`（紙本掃描檔的 `{storage_path, sha256}`）, `created_at`。`unique(document_id, version_no, signer_id)`；複合 FK `(document_id, version_no) → field_document_versions`。

規則（所有寫入者）：只能在使用者路徑寫入（伺服器不得代簽）；簽署者必須是專案成員且 `my_org_type() = owner_org`（`admin_override` 例外）；`version_no` 必須等於 `current_version_no`（畫面是舊版即拒絕）；`content_hash` 必須等於該版本雜湊；文件狀態須為 draft／pending_input／in_review／signed；`signer_id`／`signer_org`／`signer_name_snapshot`／`signed_at`／`created_at`／`aal`（JWT）／`request_ip`／`user_agent` 全由伺服器取，客戶端值作廢；`method='platform_account_mfa'` 時 JWT `aal` 必須為 `aal2`（登記不得說謊）；`paper_scan` 必須附 `evidence.storage_path`／`sha256`；UPDATE／DELETE 一律拒絕。authenticated 只有 SELECT；「簽署一律要 MFA」的產品政策由 P2d RPC 執行（§5）。

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

`status` 值域：`filled`（已帶入，待核對）／`pending`（待補）／`na`（不適用，需 `reason`）／`confirmed`（人已確認或人填）。規則【已確認】：數量、實測值、到場、天氣、合格結論沒有可辨識來源一律 `pending`；白板／量測照片清楚可讀才可 `filled` 並附 `source: whiteboard:<photo_id>`；簽署時 `required_fields` 中任何 `pending` 即拒絕。

### 2.4 跨文件共用補值

同一 `photo_intakes` 生成的多份草稿共用 `shared_inputs`（鍵＝正規化欄位鍵，如 `log_date`、`location:<work_item_id>`、`qty:<work_item_id>:<batch_key>`、`labor`）。人補一次：RPC `set_intake_shared_input(intake_id, key, value)` 寫入 `shared_inputs`，並對同一 intake 內**仍為 `draft`／`pending_input`** 的文件，把對應鍵為 `pending` 的欄位建立一個人工版本（`author_kind='human'`、`source: shared:<key>`）。已簽署／已提送文件不受影響【已確認】；來源後改（例如照片說明更正）只影響尚未簽署的草稿。

## 3. 照片接收、辨識、起稿、保存與恢復

### 3.1 流程（Edge `draft-field-documents`；P2b 已實作，以程式為準）

1. 前端（P2c）：壓縮→`Storage.upload`→`photos` insert（`intake_id`，`daily_log_id` 為 null）。每張成功才算「已保存」；失敗保留本機檔並標「仍在本機」。示範模式一律不接收（不寫 Demo 工項到真案）。
2. 前端呼叫 `draft-field-documents { project_id, intake_id }`（過 `openAiGate('field_docs.draft')`，`project_id` 必帶）。伺服器以 `my_org_type` 決定呼叫者組織，**必須等於批次 `uploader_org`**（否則 403 `org_mismatch`）；`owner` 批次（試用模式管理者）照常辨識但不推任何文件。
3. Edge 以 userClient 讀（RLS：批次、照片、Storage 下載、標單、既有日誌、待查驗、文件與版本），serviceClient 只寫 `photos.ai_*`（另只在原本為空時補 `caption`／`location`／`work_item_id`，不覆蓋人填的；被佐證凍結 guard 擋下改掛時只寫辨識結果並揭露）、`photo_intakes` 進度、AI 版本、`agent_actions`。
4. 逐張辨識（併發 3；每次呼叫時間預算 100 s；處理不完回 `{remaining}`，批次留 `recognizing` 並釋放 run，前端再呼叫一次即續跑）：同批同 `content_sha256` 先標 `duplicate`（最早上傳者為正本，不辨識、不計量）；`ai_status='done'`／`not_site`／`unreadable` 不重跑，`pending`／`failed` 才跑；`photo.classify` → `legible=false`→`unreadable`、`is_construction=false`→`not_site`（不套工項、不入附件、說明標「疑似非工地」）；`has_board=true` 才再跑 `sitelog.whiteboard` 轉錄日期／天氣／位置／工項數量；模型失敗、逾時、輸出不完整→該張 `failed`（記 `ai_result.error` 代碼，可重試）。
5. 工項配對：前端與 Edge 同一支 [`_shared/photoMatch.ts`](../../supabase/functions/_shared/photoMatch.ts)（`src/lib/photoMatch.js` 只 re-export；測試案例在 `photoMatch.test.js`）；比對對象＝可計價末端工項（與 `boqCalc.billableLeaves` 同一把尺）；配不到或未匯標單→`work_item_hint` 保存、照片列「待配對」，匯標單後對同一批重跑只用存下的 hint 再配、不再打模型。
6. 候選文書（[`inferCandidates`](../../supabase/functions/_shared/fieldDocDraft.ts)，確定性規則，不由模型決定；存進 `photo_intakes.candidates`，使用者先前的 `excluded` 沿用）：
   - `contractor`：每個日期一份 `daily_log`（`target_key`＝日期；`state=ready`）；無法判日的照片→一份 `daily_log` `state=blocked`（`blocked_by:['log_date']`，補批次日期後重試）；每個配到的工項→一份 `self_check` `state=unsupported`（P3b；`applies_to` 待 P3c）。
   - `supervisor`：每個日期一份 `supervisor_log` `unsupported`（P3a）；`status='待查驗'` 且日期或工項相符的 `inspections`→一份 `inspection_form` `unsupported`（P3c）。監造批次永遠推不出 `daily_log`／`self_check`，廠商批次永遠推不出監造文件（DB guard 另有一道）。
   - 日期分組：照片日期＝告示板日期 > 使用者指定的批次 `log_date` > 拍攝時間的台北日曆日（`taken_at` 無 EXIF 時是上傳時刻，故排最後）；板日與拍攝日不同時仍依板日但列入 recheck；批次 `log_date` 為 null 且只推出一個日期時由伺服器回填。
7. 內容組裝（[`buildDailyLogDraft`](../../supabase/functions/_shared/fieldDocDraft.ts)，全部確定性）：工項列＝照片配到的工項 ∪ 告示板列出的工項；數量只在告示板清楚寫出且各板一致時 `filled`（`whiteboard:<photo_id>`），否則 `pending`（不一致列 recheck）；位置唯一才帶入、多個要人分列；天氣＝告示板 > 當日既有 `daily_logs` > 中央氣象署（`fetch-weather`，過自己的閘門）> `pending`；出工／機具／材料＝當日既有日誌 > 昨日（`yesterday:<id>`，待核對）> `pending`；公定格式各節 `extras.*` 只帶當日既有日誌填過的，其餘 `pending`（不填「無」）；`work_summary`＝當日既有日誌 > 各張照片 AI 說明的確定性拼接（`ai:photo`）> 告示板摘要 > `pending`——**與原設計不同：不再另打一次模型寫敘述欄**，說明本身已是模型輸出，再餵第二個 prompt 只多一條把板上文字當指令的路。`required_fields`＝`log_date`、`weather_am`、`weather_pm`、`work_summary`、`labor`、`equipment`、`materials` 與每個工項的 `qty_today`（與 P2d `fn_field_document_required_fields` 的固定欄一致，簽署時會再算一次並聯集）；任一 `pending` 即 `pending_input`；本日確無機具／進料由人標 `na` 並填原因。
8. 寫入：該日活文件不存在→`field_documents`（`intake_id`、`target_key`＝日期）＋版本 1（`author_kind='ai'`；同日撞唯一索引改走既有文件）；存在且為 `draft`／`pending_input`→附件取本批該日照片 ∪ 既有最新版本的附件（另一批同日上傳的證據不因重跑而掉），內容相同→`unchanged` 不加版本，否則新增 AI 版本並推 `current_version_no`；已有人工版本→不寫版本，只寫 `agent_actions(kind='suggest_field_update')`；`in_review`／`signed`／`submitted`／`received`／`returned`→`locked` 不動。每次建立／新增版本另寫 `agent_actions(kind='draft_field_document', evidence:{intake_id, document_id, doc_type, version_no, content_hash})`，`actor_user`＝觸發者、`agent_role`＝上傳方。`photo_intakes` 收尾：`remaining>0`→`recognizing`；有照片失敗或文件寫入失敗→`partial`（`error_summary` 說明，可重試）；否則 `ready`。

### 3.2 重試冪等【已確認 行為，設計 機制】

- 逐張：`ai_status='done'`／`not_site`／`unreadable` 不重跑；`failed` 可重跑；重複上傳同雜湊標 `duplicate` 不生第二份文件也不重複計量。
- 文件：`(intake_id, doc_type, target_key)` 部分唯一索引＋`(project_id, doc_type, doc_date)` 日誌唯一索引；重跑只對**沒有任何 human 版本**且仍為草稿的文件**在內容有變時新增一個 AI 版本**（內容與附件相同→`unchanged`，不加版本；版本列不可變，不重寫 version 1；`current_version_no` 由 Edge 推到新版）；已有人工版本→Edge 先查到就不送版本、DB guard 也會拒（`field_document_versions_guard`），改在 `agent_actions` 新增 `kind='suggest_field_update'`，**建議內容（content／field_sources／attachments）放在該列 `evidence.suggestion`**——建議沒有版本列可指，這是 §7「evidence 只存指標」的明示例外。這保證重試不覆蓋人工修正，且每次 AI 產出都留痕。
- 送件：`client_request_id` 唯一；簽署以 `(document_id, version_no, signer_id)` 唯一；同一張照片可作多份文件附件，但數量只在確認量表計一次（見 [確認量文件](confirmed-quantity-valuation.md)）。
- 模型輸出不完整／逾時／結果不明：該張 `failed` 並帶 `error_summary`，批次 `partial`；不建立半份文件。

### 3.3 保存與恢復

進入「現場紀錄」時查 `photo_intakes where created_by = auth.uid() and status not in ('discarded')` 與 `field_documents where status in ('draft','pending_input','returned')`，列出「未完成的上傳」與「待處理文件」；離頁、重新登入、換裝置都從伺服器狀態恢復。前端 `unsavedEdits` 只保護尚未送出的編輯；版本保存走 `save_field_document_version`（§6）即為伺服器保存。Run 認領（P2b 實作）：`run_started_at` 不為 null＝有 run 在跑（同批第二個請求 409 `run_conflict`）；正常結束或預算用完暫停都把 `run_started_at` 清回 null；`last_progress_at` 超過 10 分鐘的 run 視為掛掉，可被接手；CAS 以 `attempts` 舊值為條件，**只有失敗／過期後重啟才計一次 `attempts`，預算暫停後的續跑不計**（否則大批次正常續跑三四次就撞上限）；`attempts` 達 5 再重啟→409 `attempts_exhausted` 並標 `failed`，請重新上傳成新批次。

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

**P2d 已實作（migration `20260917205000_field_document_rpcs`；pgTAP `field_document_sign.sql` 140 條）**。所有 RPC 皆 `security definer`、`set search_path = public`、以 `auth.uid()` 取身分，不信任參數中的角色／組織／時間；`revoke all from public, anon`，只 `grant execute to authenticated`。錯誤以 SQLSTATE `PD0xx` 回（`message` 使用者可讀繁中、`detail` 機器可讀 JSON），P2c 依 `error.code` 分流：

| 代碼 | 意義 | 前端處置 |
|---|---|---|
| `PD001` | 畫面是舊版（版本號／基準版本不是目前版本） | 重新載入文件 |
| `PD002` | 內容雜湊與伺服器版本不符 | 重新載入 |
| `PD003` | 需要兩步驟驗證（JWT `aal` 非 `aal2`；`admin_override` 也不放行） | 引導到「帳號」啟用／完成 TOTP 後重試 |
| `PD004` | 必填欄位待補（`detail=[{key,status}]`，status＝`missing`／`pending`／`na_without_reason`／`unknown_status`） | 高亮待補欄；同一份清單也在 `field_documents.recheck` |
| `PD005` | 附件不符角色隔離（`detail=[{key:'attachments.<photo_id>',status}]`，status＝`uploader_org:<org>`／`uploader_unknown`／`not_found`／`invalid`／`invalid_role`） | 改為 `role='reference'` 或移除 |
| `PD006` | 無權（未登入／非成員／非責任方／非提送對象） | 顯示訊息 |
| `PD007` | 此文件類型的簽署尚未支援（本輪只有 `daily_log`） | 顯示訊息 |
| `PD008` | 目前狀態不允許此動作（含已收件不可再存版、退回後原版不可再送、同日事實列已綁其他活文件） | 顯示訊息並重新載入 |
| `PD009` | `client_request_id` 已用於不同請求 | 換新的 request id |
| `PD010` | 輸入不合法（內容形狀、工項不在本案、數量缺值／負值、`log_date` 與 `doc_date` 不符、對象不在矩陣、退回無原因、空白意願） | 顯示訊息 |

P2a 的 trigger 仍是所有路徑的最後防線（`P0001`）；RPC 先以上述代碼拒絕，trigger 是備援。

**`save_field_document_version(p_document_id uuid, p_base_version_no int, p_content jsonb, p_field_sources jsonb default '{}', p_attachments jsonb default null, p_change_note text default null) → jsonb`**（四類共用）：責任方成員（`can_write` 且 `my_org_type()=owner_org`，`admin_override` 例外）；`p_base_version_no` 必須等於 `current_version_no`（樂觀併發，否則 `PD001`）；`received`／`discarded`／`superseded` 拒絕（`PD008`）。建立 `human` 版本 n+1；原狀態為 `signed`／`submitted`／`returned` 時帶 `amended_from_version=n`。同交易重算並寫回 `required_fields`（見下）與 `recheck`（待補欄＋附件問題），狀態依 `recheck` 是否為空自動落 `draft`／`pending_input`。回 `{document_id, version_no, content_hash, status, required_fields, recheck, amended_from_version}`；`content_hash` 就是 DB 算的值，前端簽署時原樣送回，不重算。

**必填鍵與待補（單一實作 `fn_field_document_required_fields`／`fn_field_document_unmet_fields`，存版與簽署共用）**：有效必填鍵＝`field_documents.required_fields`（service／Edge／範本推導）∪ 類型固定欄 ∪ 本版內容 `items.<work_item_id>.qty_today`。施工日誌固定欄：`weather_am`、`weather_pm`、`work_summary`、`labor`、`equipment`、`materials`（「本日無」用 `na`＋`reason`，不得留空）。工項數量鍵永遠只從本版內容推導（stored 裡的工項鍵忽略），已從內容移除的工項不會永遠卡住簽署。`field_sources[key].status` 為 `filled`／`confirmed`，或 `na` 且有 `reason` 才算齊備；缺鍵、`pending`、`na` 無 reason、未知狀態一律待補。客戶端不能寫 `required_fields`，把它清空也裝不出可簽。

**`sign_field_document(p_document_id uuid, p_version_no int, p_content_hash text, p_intent text) → jsonb`**（本輪只有 `daily_log` 分支；其他類型 `PD007`）：

1. `select ... for update` 鎖文件列；成員與責任方（`PD006`）；`current_version_no = p_version_no`（`PD001`）；版本雜湊等於 `p_content_hash`（`PD002`）。
2. 冪等：同人同版本已簽（狀態 `signed`）→ 回原簽署（`idempotent:true`），不重複；他人已簽該版本 → `PD008`。以 `(document_id, version_no, signer_id)` 自然鍵冪等，不另設 `client_request_id`（原設計參數移除）。
3. `aal2` 政策（使用者 2026-09-17 決定：平台帳號＋MFA）：JWT `aal` 必須為 `aal2`，否則 `PD003`（`admin_override` 也不放行）；`p_intent` 不可空白（`PD010`）。
4. 完整性：有效必填鍵全部齊備（`PD004`）；附件角色隔離（§3.4，`PD005`）：`attachments[].role` 預設 `evidence`，施作證據的 `photos.uploader_org` 必須等於 `owner_org`（施工日誌＝`contractor`），監造照片只能以 `role='reference'`（「監造提供」註記）附上，上傳方未知的舊照片不能當證據。
5. 內容形狀（`PD010`）：`labor`／`equipment`／`materials` 陣列、`extras` 物件、天氣與 `work_summary` 文字、`items` 物件；`items` 的鍵必須是本案 `work_items.id`；來源非 `na` 的工項 `qty_today` 必須是非負數字；內容若帶 `log_date` 必須等於 `doc_date`。
6. 寫入順序（同交易）：`insert field_document_signatures`（trigger 驗版本／雜湊／角色／成員／aal，簽署者資料、時間、IP、UA 由伺服器取）→ 事實列（交易內 GUC `pmis.field_document_sign=<document_id>` 放行 `daily_logs_guard`／`daily_log_items_guard`）：`daily_logs` 依 `(project_id, log_date)` upsert（`status='已簽署'`，`created_by` 沿用既有列），`daily_log_items` 整組重寫（來源為 `na` 的工項不落列）→ `update field_documents set status='signed', target_id=<daily_logs.id>, recheck='[]'`（guard：簽署列已存在、事實列存在且同案；事實列必須先於綁定，P2a 交接時寫的「status→事實表」順序據此調整）→ `resolve_agent_action_internal`。
7. 同日事實列已被另一份**活**文件綁定 → `PD008`；`superseded`／`discarded` 的舊文件仍保留 `target_id`，新文件接手同一列（`field_documents_target_uidx` 已改為只算活文件）。

回 `{document_id, version_no, content_hash, signature_id, signed_at, signer_id, status:'signed', target_table:'daily_logs', target_id, agent_actions_resolved, idempotent}`。稽核 `field_document.signed` 由簽署列的 AFTER trigger 寫，RPC 不另記。

**事實表 guard（`daily_logs_guard` BEFORE UPDATE／DELETE、`daily_log_items_guard` BEFORE INSERT／UPDATE／DELETE，所有寫入者含 service）**：「已簽署」＝有 `daily_log` 文件綁定該列且該文件有任何簽署列（簽後更正回草稿期間事實列仍是舊簽署內容，同樣受保護）。已簽署列只放行：專案刪除 cascade；或 GUC 指向「同案同日」的 `daily_log` 文件的 UPDATE（用專案＋日期而非 `target_id` 比對，因接手的新文件首次簽署時尚未綁定）。DELETE 一律不放行（含 `reset_project_boq`：與該 RPC「有簽核證據時整包 rollback」的既定行為一致；`work_items` 刪除 cascade 到已簽署列的明細也被擋）。未簽署的既有日誌（正式 12 筆）維持舊路徑可直接寫，這是 P2c 改接前的相容範圍；舊 `saveSiteLog` 對已簽署日期的 upsert 會收到 `P0001` 明確訊息，不會靜默改寫。

簽署後更正：`save_field_document_version` 對 `signed`／`submitted`／`returned` 文件建立版本 n+1（`amended_from_version`），`status` 回 `draft`／`pending_input`，原簽署列與原版本不動、原提送列仍指向舊版、事實列等重簽才更新；必須重簽重送。列印版印出 `文件短碼＋版本號＋雜湊前 12 碼`；紙本簽回（`method='paper_scan'`，綁定同一版本雜湊、掃描檔 `sha256` 入 `evidence`）是保留的日後方式，本輪不啟用。本設計不宣稱符合任何機關的電子簽章規範；簽署方式依使用者 2026-09-17 決定先採平台帳號＋MFA（§11 Q1）。

## 6. 提送、退回歷史、回執

**P2d 已實作（四類共用；對象矩陣、`to_org` 伺服器帶入、`diff` 由 P2a trigger 決定）**。三支都回同一形狀的回執 `{submission_id, document_id, version_no, content_hash, action, actor_id, actor_org, to_org, reason, diff, client_request_id, created_at, status, idempotent}`，`created_at` 為伺服器時間＝送件／收件／退回回執。

- `submit_field_document(p_document_id uuid, p_version_no int, p_to_org text, p_client_request_id text default null)`：責任方成員（`PD006`）；版本＝目前版本（`PD001`）；狀態 `signed`（或 `submitted`，供第二個對象）否則 `PD008`；`to_org` 依 §4 矩陣（`PD010`）。冪等：同 `client_request_id` 且同版本／同對象／同人 → 回原回執（`idempotent:true`）；同 id 不同請求 → `PD009`；同版本已提送給同一對象（無 request id）→ 自然鍵冪等回原回執。首次提送 `diff` 為 null；退回後再送的 `diff={against_version_no, changed_keys[]}` 由 trigger 比對前次退回版本計算。
- `receive_field_document(p_document_id uuid, p_version_no int, p_client_request_id text default null)`：只有該版本 `submit` 列的 `to_org` 成員（`PD006`；機關在正式模式雖唯讀，仍可收件監造日誌）；狀態 `submitted`／`received`（`PD008`）；本方已收過同版本 → 自然鍵冪等。
- `return_field_document(p_document_id uuid, p_version_no int, p_reason text, p_client_request_id text default null)`：同上對象檢查；`reason` 必填（`PD010`）；狀態 `submitted`／`received`（`PD008`）；退回後 `status='returned'`，原版不可再送（`PD008`），只能 `save_field_document_version` 建新版本→重簽→再送；歷次 `return` 列（含原因）全部保留。

不會把 `submittals.review_note` 當歷史；送審文件的歷次退回原因另列 [瘦身文件 §4](slimming-entrypoints-and-retirement.md)。不對真實成員寄信；通知只進「今日工作」與既有早報路徑。

## 7. AI 草稿與 `agent_actions` 邊界

- 照片起稿與 Agent 對話起稿都落 `agent_actions`（新 kind `draft_field_document`／`suggest_field_update`；P2b 起由 Edge service 寫，`actor_user`＝觸發起稿的使用者、`agent_role`＝批次上傳方），`draft_field_document` 的 `evidence` 只存指標（文件、版本、雜湊、intake），不重複存 payload；`suggest_field_update` 沒有版本列可指，`evidence.suggestion` 帶建議內容（§3.2）。
- `agent_actions` SELECT 仍限本人；文件本體對同方成員可見可編（`field_documents` RLS）。簽署者非草稿收件人時，由 RPC 內部函式標處理狀態並記 `resolved_by`——這是對 [Agent 邊界](agent-tool-boundary.md) 的明示延伸（P2d 已實作並更新該文件）：`resolve_agent_action_internal(p_document_id, p_project_id, p_status)` 只由 `sign_field_document` 呼叫（authenticated 不可執行），把同案、`target_table='field_documents'`、`target_id=文件`、`pending` 的草稿全部標 `accepted`（文件無人工版本）或 `edited`（有人工版本），`resolved_by=簽署者`，每筆留 `agent_action_resolved` 稽核（`metadata.resolved_via='sign_field_document'`）；舊 `draft_daily_log`（`target_table='daily_logs'`、`target_id` null）不受影響。
- 既有 `draft_daily_log`／`draft_inspection` 工具改為產生 `field_documents` 草稿（保留工具名與回傳形狀），接受路徑統一走簽署 RPC；`acceptDraft` 的直接 `saveSiteLog` 路徑退場。

## 8. RLS／guard／RPC 清單（實作對照）

| 物件 | 類型 | 責任 |
|---|---|---|
| `photo_intakes`、`photos` 新欄、`field_documents`、`field_document_versions`、`field_document_signatures`、`field_document_submissions`：表＋RLS＋欄位級 grants（§2.2） | 表 | **P2a 已實作**（`20260917201000_field_documents`；rollback `supabase/rollbacks/20260917201000_field_documents.down.sql`） |
| `supervisor_logs` | 表＋RLS＋收回 grants | P3a |
| `photos_org_stamp`、`photo_intakes_guard`、`field_documents_guard`（狀態矩陣＋結構要件＋角色）、`field_document_versions_guard`（不可變、雜湊、版本號、作者情境、附件）、`field_document_signatures_guard`、`field_document_submissions_guard` | trigger | **P2a 已實作** |
| `daily_logs_guard`、`daily_log_items_guard`（已簽署列只有簽署 RPC 的交易內 GUC 可重寫；DELETE 一律擋；未簽署列照舊） | trigger | **P2d 已實作**（`20260917205000_field_document_rpcs`；rollback `supabase/rollbacks/20260917205000_field_document_rpcs.down.sql`） |
| `supervisor_logs_guard`、`inspections` 新欄只允許 RPC 寫 | trigger | P3a／P3c |
| 純 helper `fn_field_document_content_hash`、`fn_field_document_owner_org`／`fn_field_document_target_table`（generated column 用，authenticated 可執行）、`fn_field_document_to_org_allowed`、`fn_field_document_changed_keys`、`current_jwt_aal`、`current_request_user_agent`、`can_read_field_document` | 函式 | **P2a 已實作** |
| `save_field_document_version`、`sign_field_document`（只有 `daily_log` 分支，其他類型 `PD007`）、`submit_/receive_/return_field_document`、內部 `resolve_agent_action_internal`／`field_document_respond_internal`；純 helper `fn_field_document_required_fields`／`fn_field_document_unmet_fields`／`fn_field_document_attachment_issues`／`fn_field_document_receipt`／`fn_daily_log_signed`／`fn_daily_log_sign_bypass` | security definer RPC，`revoke all from public, anon`、僅 `authenticated`；內部與 helper 連 authenticated 都不可執行；錯誤代碼與寫入順序見 §5 | **P2d 已實作** |
| `sign_field_document` 的 `supervisor_log`／`self_check`／`inspection_form` 分支、`create_field_document_draft`（service；P2b 起稿改由 Edge service 直接 INSERT，本 RPC 未建）、`set_intake_shared_input`、`discard_field_document` | security definer RPC | P3a／P3b／P3c／P3e |
| `field_docs.draft` 註冊三處＋seed migration `20260917213500_ai_field_docs_draft`（rollback 檔關閉開關）；Edge `draft-field-documents`＋`_shared/{sitePhotoVision,photoMatch,fieldDocDraft,fieldDocDraftRun,fieldDocRepo}.ts`；`aiGate.askAiFeature` 供函式內再問別的功能開關 | AI 閘門／Edge | **P2b 已實作**（Vitest：`fieldDocDraft.test.ts` 15 條、`fieldDocDraftRun.test.ts` 22 條；pgTAP `ai_field_docs_draft.sql` 8 條） |
| 稽核事件 `field_document.{created,version_saved,signed,submitted,received,returned,amended,discarded,superseded,status_changed}`（AFTER trigger；標籤在 [`auditEvents.js`](../../src/lib/auditEvents.js)） | `record_audit_event` | **P2a 已實作** |

## 9. 舊資料過渡與回復

- 既有 `daily_logs`（12）、`checklist_records`（5）、`inspections`（11）不自動包裝成已簽署文件；使用者開啟時可「建立文件草稿（沿用既有內容）」再走簽署，`field_sources` 全標 `filled/source: legacy`。
- 既有 `daily_logs.status='已送出'` 不改值；新 guard 只看是否有已簽署文件指向該列。
- 既有 `photos`（正式 2 筆）：P2a 只依 `uploaded_by` 的 profile 回填 `uploader_org`（`profiles.org_type` 自 20260728000200 起使用者不可自改，是最可靠的既有證據）；推不出的維持 null＝未知，不猜；`uploader_org` 為 null 的舊照片不能掛進上傳批次。`ai_status` 等新欄舊列一律 null。
- 回復：P2d 整組（五支 RPC、內部函式與 helper、`daily_logs_guard`／`daily_log_items_guard`、`field_documents_target_uidx` 還原為 P2a 定義）由 `supabase/rollbacks/20260917205000_field_document_rpcs.down.sql` 移除，簽署落下的 `daily_logs` 列保留但失去保護；須先於 P2a 回復。P2a 整組（五表、`photos` 七欄、函式、trigger、`photos` 欄位級 grant 還原表級）由 `supabase/rollbacks/20260917201000_field_documents.down.sql` 移除；`inspections` 新欄可 drop；`supervisor_logs_guard` 可 drop 恢復舊行為；已產生的簽署與提送資料隨表移除（rollback 前先匯出）。
- 相容順序：DB（加法）→ Edge（新函式；舊 `draft_daily_log` 工具仍可用）→ 前端 → 第二支 migration 才把 `acceptDraft` 舊路徑用到的直接寫入關閉。

## 10. 驗證對應（實作時逐項補）

| 情境（依需求 §8） | 驗證 |
|---|---|
| 四類各走照片→自動生成→補缺→簽署→提送；監造日誌確為每日 | 真後端 E2E 四條；pgTAP 唯一性 `(project, doc_type, doc_date)`（P2a `field_documents.sql` 已釘） |
| 清晰量測照可轉錄、模糊照留缺、非現場照不捏造、廠商證據不冒充監造 | 模型樣本測試（有預期答案）；pgTAP 角色隔離拒絕（P2a：`uploader_org` 伺服器決定、廠商批次不能起稿監造文件、`ai_*` 客戶端不可寫） |
| 切頁／重登入可恢復；部分失敗、重試、重複上傳、逾時不丟人工修正、不重複建件 | pgTAP 冪等鍵（P2a：起稿唯一索引、有人工版本後 AI 不得寫版本、送件 `client_request_id`）；Edge 單元測試（P2b `fieldDocDraftRun.test.ts`，記憶體 repo＋stub 模型：重跑不重複建件、內容相同不加版本、有人工版本只留建議、已簽署不動、同日並發撞索引改走既有文件、逐張失敗可重試、預算切斷續跑、run 認領、逐功能閘門 fail-closed；stub 只證明流程不證明辨識正確）；E2E 重整頁（P2c） |
| 簽舊版、簽後改文／附件、越權簽署、跨案取件受阻；退回再送保留版本與理由 | P2a `field_documents.sql`（215 條）：舊版本、雜湊不符、非責任方、非成員、伺服器代簽、aal 不符、簽後改日期／捨棄／刪除、退回無原因、原版再送、diff 由 DB 算、歷次紀錄不可改。P2d `field_document_sign.sql`（140 條，走真實 `authenticated`＋JWT 路徑）：存版樂觀併發與越權；aal1 簽 `PD003`（非正式案 admin_override 也不放行）；舊版 `PD001`、雜湊 `PD002`、三角色＋非成員矩陣 `PD006`、監造日誌簽署 `PD007`、待補 `PD004`、監造／未知照片冒充施工證據 `PD005`、外案工項／負數／缺值／日期不符／形狀錯 `PD010`；簽署成功落 `daily_logs`／`daily_log_items`、綁 `target_id`、草稿標 `edited`、簽署列由伺服器取資料、稽核；同人重試冪等；已簽署列的直接 UPDATE／DELETE／明細寫入／舊 upsert／service／偽造 GUC 全部被擋而未簽署列照舊；簽後更正另開版回草稿、事實列等重簽、舊簽署綁舊版；提送對象矩陣、`client_request_id` 冪等與衝突、自然鍵冪等、收件／退回只限提送對象、退回必填原因、退回後原版不可再送、再送 diff 由 DB 算、歷次全保留、已收件不可再存版；superseded 後新文件接手同一事實列；捨棄不可存版；專案刪除 cascade 通過 guard |
| 手機可完成現場旅程；桌機審核；列印與簽署版本一致 | 手機形狀 E2E；列印頁顯示版本與雜湊 |

## 11. 待決題的使用者答覆（2026-09-17，記入 D-026 第 7 點）

- **Q1 實案簽署方式**：使用者決定**先用平台帳號加 MFA**——簽署 RPC 要求 `aal2`、`method='platform_account_mfa'`（§5 第 4 步）；紙本簽回與外部憑證未排除，本輪不做，`method` enum 保留三值。
- **Q4 監造日誌可見範圍**：使用者同意照暫行做法：專案成員皆可讀（與其他事實表一致），RLS 一行可改。
- **Q5 監造查驗表單的廠商異議**：使用者同意照暫行做法：廠商只能收件並以工程疑義（RFI）提出，不加狀態。
- **Q11 實案範本來源**：使用者決定**範本沒有，先用示範範本**——施工日誌沿用公定格式；自檢沿用既有範本；監造日誌與監造查驗表單依本文件 §2.2 欄位與現有 03310 範本形狀建立示範範本，介面與列印必須明確標「示範範本」，不得宣稱為機關公定格式。
