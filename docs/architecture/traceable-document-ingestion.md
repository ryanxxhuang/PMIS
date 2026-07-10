# P0-06 — Traceable AI Document Ingestion

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
are tidied, so section/clause numbering survives. Pages are stored
individually in `document_pages` — never concatenated first. The legacy flat
`extractContractText()` in `store/db.js` remains only for the `parse-contract`
deadline flow and is not a P0-06 traceability source.

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

## 12. Legacy `contract_obligations` compatibility

```
contract_obligations = legacy Contract page / deadline runtime
requirements         = Contract-First shared Requirement foundation
```

`parse-contract`, the Contract page deadline list, due-date calculation,
acceptance, alerts, reminders, and demo mode are untouched. The two pipelines
run side by side; P0-06 does not make `contract_obligations` authoritative
over reviewed Requirements (the P0-01 sync trigger still only touches
draft/needs_review mirrors). The long-term direction is Requirements, but the
Contract-First onboarding/UI cutover belongs to P0-09.

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
