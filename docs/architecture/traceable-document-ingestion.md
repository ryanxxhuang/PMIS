# P0-06 — Traceable AI Document Ingestion

> 狀態：**CURRENT（含歷史基礎章節）** ｜ 2026-09-08 補記本機完整性修正；未部署。

## 現行補記（2026-09-08，本機完成、未部署）

- 同日後續流程優化：`Contract` 的 packages／runs／documents 與下游版本、抽取結果使用分頁查詢，錯誤提供重試；舊案請求遲到不覆蓋新案。結果入口以 `?package=` 延續到重點與審核頁，已歸檔數量以 approved Requirement 計數。上傳／重試後呼叫既有 `reloadObligations`，結果頁進入時重讀並在 ingestion 進行中輪詢。
- `document_processing_runs.metadata.requirement_extraction_warning` 保存完成結果的覆蓋警示字串；舊列可在讀取時從最近 completed ingestion 的 metadata 還原，僅作 UI 揭露。部分整理與待分類皆提示需留意；`packageStatusFromRuns` 將 partial／覆蓋不完整列為 needs_attention，既有自動確認規則不變。
- 手機文件列在同一表格元件中改為直向排列，直接呈現檔名、分類、版本、AI 狀態、原因及動作；格式說明清楚區分 PDF／DOCX／TXT 文字分析與圖片／掃描／試算表等能力限制。具體驗證見 [`../契約整理流程-UIUX-2026-09-08.md`（歷史）](https://github.com/ryanxxhuang/PMIS/blob/c39e395fff5608813a8c2fa4c79700e87d607e3b/docs/%E5%A5%91%E7%B4%84%E6%95%B4%E7%90%86%E6%B5%81%E7%A8%8B-UIUX-2026-09-08.md)。

- D-019 已將完成抽取的 AI-origin Requirement 自動確認，包括帶 `triage_doubts` 的項目；D-020 已讓所有 approved 類型進入義務 runtime。下方 P0-06 的「僅產生待人工確認建議」是歷史基礎，不是現行放行規則。決策見 [`../DECISIONS.md`](../DECISIONS.md)。
- `extract-requirements` 透過使用者 RLS client 分批讀取全部 `document_pages`，每批要求 exact count，核對總數穩定與從 1 開始連續頁序；即使伺服器每次只回 500 列，也會依實收筆數續讀。中途錯誤不會把半份資料送模型。
- 同時讀取 `document_processing_runs.metadata.page_count`。有此上傳紀錄時，儲存頁數必須相符；缺頁、重複、總數變動或不符均停止並回報。舊流程沒有這個欄位時維持可用，但只能驗證已儲存文字的讀取完整性，無法證明原檔沒有遺失尾頁。
- 模型未回傳 `requirements` 陣列視為該批失敗；合法空陣列仍可成功。無文字頁、被格式驗證拒收的項目、模型輸出截斷、失敗批次或既有批次上限，都使 `coverage_incomplete` 為 true，並在完成 metadata／回應保留細節。
- 前端契約重點與擷取審核逐文件版本顯示最近一次 completed run 的完整性警示，成功處理另一份文件不會清掉舊警示。部分產出的既有 completed 語意與 D-019 自動確認維持不變；`completed` 不等同內容全對。
- 本次沒有新增 OCR、獨立語意覆核、漏項偵測、真實契約評測或解除 24 批上限；處理完整性與語意準確率必須分開衡量。交付詳見 [`../契約自動整理品質優化-2026-09-08.md`（歷史）](https://github.com/ryanxxhuang/PMIS/blob/c39e395fff5608813a8c2fa4c79700e87d607e3b/docs/%E5%A5%91%E7%B4%84%E8%87%AA%E5%8B%95%E6%95%B4%E7%90%86%E5%93%81%E8%B3%AA%E5%84%AA%E5%8C%96-2026-09-08.md)。

以下保留 P0-06 基礎流程背景；涉及放行與後續工作流程的敘述，以上述補記及較新 Decision 為準。

## 1. Purpose

Before P0-06, the only AI document flow was `parse-contract`: a flat-text
deadline extractor whose output replaced `contract_obligations` wholesale, with
model-asserted free-text page references. P0-06 adds the pipeline the Product
North Star actually needs:

```
Project Document
  → immutable Document Version
    → page-aware stored text (document_pages)
      → traceable AI extraction run (document_ingestion_runs)
        → AI Requirement suggestions (draft_ai / needs_review)
          → deterministically verified Requirement Sources
            → candidate BOQ work-item links (requirement_work_items)
```

The result is **not** an approved project rule. It is a set of traceable,
human-reviewable suggestions. The review UI and downstream artifact generation
belong to P0-07.

## 2. End-to-end pipeline

Browser (`src/lib/documentIngestion.js`, exposed via the ledger store slice and
the Contract page):

1. `extractDocumentPages(file)` produces page records (see §3/§4).
2. If no page carries verifiable text, ingestion aborts before any DB write
   (honest scanned-file failure, §5).
3. `documents` row is created or reused: same project + `document_type` +
   title (filename) → same document. Deliberately explicit and minimal; a
   richer revision UI belongs to later document workflow work.
4. `document_versions` row: identical content (sha256 checksum matches an
   existing version) reuses that immutable version; changed content creates a
   new version (`v1`, `v2`, …) superseding the latest. A version row is never
   mutated (P0-01 file-identity guard). The original binary is not persisted
   in Storage in P0-06 — the checksum plus the stored page text carry identity
   and traceability; binary retention belongs to document workflow work.
5. `document_pages` rows are inserted in batches **before** any AI call.
6. The browser invokes the `extract-requirements` Edge Function with only
   `document_version_id` (+ `project_id` for cross-checking).

Edge Function (`supabase/functions/extract-requirements/index.ts`):

7. Authenticates the caller and authorizes the project/document permission
   (§13), then creates a `document_ingestion_runs` row (`processing`) with the
   service role.
8. Reads the stored pages (caller-scoped client, so RLS re-proves access),
   assembles a page-structured prompt, and calls Claude through the shared
   `_shared/claude.ts` tool-output layer.
9. Validates every returned item against the fixed Requirement vocabulary and
   deterministically verifies every citation against the stored page text.
10. Persists `requirements` + `requirement_sources` + candidate
    `requirement_work_items` with run-scoped deterministic IDs, then marks the
    run `completed` with counts, or `failed` with an honest `error_message`.

## 3. Page-aware PDF extraction

`src/lib/documentExtract.js` extracts one record per rendered PDF page using
the existing `pdfjs-dist` dependency:

```js
{ page_number: 12, extracted_text: '…', extraction_method: 'pdf_text' }
```

pdf.js end-of-line markers are preserved as line breaks; only whitespace runs
are tidied, so section/clause numbering survives. Pages are stored individually
in `document_pages` — never concatenated first. W5-2 removed the Contract
frontend's flat `parse-contract` deadline flow; contractual ingestion now uses
this page-aware Requirement pipeline only.

## 4. DOCX limitation (unpaginated)

Mammoth raw-text extraction has **no reliable rendered page numbers**. P0-06
does not fabricate them:

* DOCX text is stored as segments in `document_pages` where `page_number` is a
  **storage index only** and `extraction_method = 'docx_text_unpaginated'`.
* Source verification for unpaginated documents matches the quotation against
  the whole stored text, and the persisted Requirement source keeps
  `page_number = null` — a DOCX citation is grounded in quotation +
  section/clause, never in an invented page.

## 5. Scanned PDF / OCR non-goal

OCR is out of scope. Pages whose normalized text is shorter than a threshold
are treated as empty. If every page is empty the browser aborts before writing
anything; if empty pages slip through to the Edge Function, the ingestion run
is marked `failed` with an explicit error message (and partial emptiness is
recorded in run `metadata.empty_page_numbers`). A scanned document is never
reported as successfully parsed.

## 6. Ingestion run provenance

`document_ingestion_runs` (migration `20260710000500_p0_06_document_ingestion.sql`)
answers: which document version was processed, by which model/prompt
(`model_provider`, `model_name`, `prompt_version`), when, triggered by whom
(`started_by`), did it succeed, and how many suggestions/verified citations it
produced. Guarantees:

* a run is pinned to one document version of its own project, forever
  (trigger-enforced for every writer, including the service role);
* project members can **read** run status (project-scoped RLS select); there
  is no authenticated write path — privileges are revoked and a
  defense-in-depth trigger (`document ingestion runs are system-managed`)
  rejects even privileged JWT-carrying writes, mirroring `audit_events`;
* `requirements.ingestion_run_id` links each AI suggestion to the run that
  produced it. Application users can neither set nor change this field
  (`guard_requirement_ingestion_provenance`), and it must reference a run of
  the same project. Manual and migration Requirements keep it null. Authority
  is **never** derived from this field.

## 7. AI extraction schema

The Edge Function forces tool output with a stable schema. Each suggestion
carries: `title`, `description`, `requirement_type` (P0-01 vocabulary:
deadline/submittal/inspection/test/checklist/evidence/photo/report/other),
`responsible_party_type` (agency/supervisor/contractor/other),
`lifecycle_phase` (開工前/施工中/完工/保固), `trigger_type` +
`trigger_config`, `frequency_type` + `frequency_config`,
`acceptance_criteria`, `evidence_requirement`, a `source`
(page_number/section/clause/quotation), `confidence`, and
`candidate_work_items` (W-refs into a bounded catalog, §10).

`_shared/requirementExtraction.ts` validates every item **before**
persistence: an unrepresentable `requirement_type` or missing title rejects
that item only (counted in run `metadata.rejected_item_count`); invented
values in optional enums are nulled with recorded warnings. The model can
never add vocabulary. The prompt targets executable obligations (must
submit/inspect/test/notify/witness/hold point/retain evidence/deadlines/
acceptance criteria/sampling frequency), excludes background text and
definitions, and uses neutral language — extraction never asserts illegality,
fraud, negligence, or breach.

## 8. Source verification algorithm

Deterministic, in `_shared/sourceVerify.ts` (shared verbatim by the Edge
Function and the web client; no LLM verifies another LLM):

1. `normalizeSourceText`: NFKC fold (full-width → half-width, compatibility
   forms), strip zero-width characters and soft hyphens, remove **all**
   Unicode whitespace (PDF extraction inserts arbitrary breaks between CJK
   glyph runs; both comparison sides are normalized identically, so matching
   stays exact character-sequence containment).
2. Primary rule: normalized quotation contained in normalized page text.
3. Bounded secondary rule: the same containment after stripping a fixed
   punctuation list from both sides — forgives punctuation drift only, never a
   fuzzy similarity score.
4. Quotations shorter than 6 normalized characters are never verifiable.

Outcomes:

| case | source_verified | persisted page_number |
|---|---|---|
| quotation found on the cited stored page (PDF) | true | cited page |
| quotation exists but cited page is wrong | false | cited page (grounded claim, unverified) |
| cited page does not exist in `document_pages` | false | null (fabricated pages are never persisted) |
| quotation missing / not found | false | grounded page or null |
| DOCX (unpaginated) quotation matches stored text | true | null |

Any unverified source demotes the suggestion to `needs_review`. A quotation
spanning a PDF page boundary is conservatively unverified. The system — never
the model, never the browser — decides `source_verified`; `requirement_sources`
also DB-enforces that a verified source must reference a document version.
(Human Requirement reviewers can technically write sources under their own
RLS authority — the same trusted role that approves Requirements.)

## 9. Requirement lifecycle boundary

AI output is persisted with `origin = 'ai'` and `status = 'draft_ai'`
(verified source) or `needs_review` (missing/unverified traceability). It is
never authoritative: `is_authoritative` remains derived solely from
`status = 'approved'`, insertion in a reviewed status is blocked by the P0-03
snapshot guard, lifecycle transitions still require a Requirement reviewer,
and reviewed snapshots stay immutable and undeletable. AI cannot approve a
Requirement, create an active ITP hold point, submit an inspection, approve a
document, or make any contractual decision.

## 10. Candidate BOQ mapping

The Edge Function hands the model a bounded catalog of real BOQ leaves
(`W1 item_no description`, identity fields only — never unit prices, amounts,
or contractor-private cost data). The model returns W-refs; `mapWorkItemRefs`
resolves them to real `work_items.id`, dropping anything unknown — the LLM
never emits UUIDs, so it cannot invent them. Links persist in the existing
`requirement_work_items` domain as `match_type = 'ai'`, `reviewed = false`
(this repository's representation of "suggested"; there is no separate
`review_status` column). The P0-01 cross-project guard applies unchanged, and
AI can never mark a link reviewed.

## 11. Reprocessing behavior

* Suggestion identity is run-scoped and deterministic
  (`sha256(runId:requirement:index)` as UUID) and persistence uses
  ignore-duplicates upserts, so retrying a persistence step **inside the same
  run** cannot insert duplicates. LLM wording is deliberately not a global
  identity.
* Intentional reprocessing of the same document version creates a **new run**.
  Nothing is deleted: previous suggestions stay associated with their run, and
  the current state of a version is simply its newest successful run
  (`started_at` ordering) — the P0-07 review surface prioritizes it.
  `superseded` is a reviewed lifecycle state requiring a reviewer and is never
  misused for automatic AI cleanup.
* Approved / rejected / superseded / manual Requirements survive reprocessing
  by construction (no destructive step exists), and DB guards independently
  prevent deleting or mutating reviewed snapshots.

## 12. W5-2 `contract_obligations` compatibility

This section describes the repository and production implementation. Migration
`20260812000500` was deployed on 2026-08-13.

```
requirements         = sole contractual source of truth
contract_obligations = approved-deadline reminder/runtime compatibility
```

Migration `20260812000500` removes the obligation → Requirement sync/delete
triggers. A controlled human approval of a deadline Requirement calls one
internal idempotent adapter in the same transaction. It updates the runtime
title, phase, responsibility, and deadline rule while preserving status,
evidence, penalty, note, identity, and history. Pending, rejected, and
non-deadline Requirements create no obligation.

If a human later supersedes an approved deadline, the same review transaction
marks only a still-pending compatibility obligation as `不適用`. The row,
evidence, penalty, note, identity, and audit history remain in the database,
while current frontend and Agent readers exclude it so obsolete reminders do
not remain operational. Already-submitted or otherwise progressed runtime is
left untouched as history.

The Contract frontend no longer invokes `parse-contract` or rereads stored
contract text for a second AI pass. The Edge Function directory and feature
registration remain for compatibility, historical usage accounting, and the
documented rollback. The deadline list, due-date calculation, alerts,
reminders, and demo data continue to consume the compatibility runtime.

## 13. Edge Function authentication

`extract-requirements` is deployed with Supabase's default `verify_jwt`
enabled (same as `read-whiteboard`/`parse-contract`; only `send-reminders`
opts out, see `supabase/SETUP.md`), so anonymous calls never reach the
handler. Platform JWT verification only proves *a* valid user, so the
function additionally enforces, in order:

1. `auth.getUser()` on a caller-scoped client (anon key + forwarded
   `Authorization` header) — 401 without a valid user;
2. an RLS-scoped read of the requested `document_versions` row — a version the
   caller cannot see (wrong project) 404s, and the project id is derived from
   the database, never trusted from the body (a mismatched body `project_id`
   is rejected);
3. `can_manage_documents(project)` RPC under the caller's JWT — 403 without
   document custody (contractor PM / agency PM / supervisor manager /
   document controller);
4. only then does the service-role client write runs and suggestions. The
   Anthropic key and the service-role key exist only in Edge Function
   secrets/environment — the browser never sees them, and the runtime AI
   provider remains the existing shared Claude layer.

## 14. Deliberate non-goals (P0-06)

* No Requirement review UI, approve/reject controls, or artifact generation
  (P0-07); no document review cycles (P0-08); no Contract-First onboarding
  cutover (P0-09); no AI project intelligence tooling (P0-10).
* No OCR for scanned documents; no DOCX page-number fabrication.
* No semantic/vector citation verification and no LLM-verifies-LLM.
* No generic AI job framework — one narrow run type
  (`requirement_extraction`).
* No original-binary Storage persistence and no revision-upload UI beyond the
  explicit checksum/title strategy in §2.
* No deletion or supersession of historical AI suggestions during
  reprocessing; no P0-05 audit expansion beyond the two optional
  `document.ingestion_completed` / `document.ingestion_failed` trigger events.
