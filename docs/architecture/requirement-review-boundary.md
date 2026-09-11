# P0-07 — Requirement Review and Artifact Link Boundary

> 狀態：**CURRENT（含歷史基礎章節）** ｜ 2026-09-08 補記本機核對例外介面；未部署。

## 現行規則優先（2026-09-07）

以下 P0-07 章節保留人工審查的原始設計脈絡；其中「只有人工核准才會成為 approved」不能再視為完整現況：

- D-019：已完成抽取 run 的 AI-origin 待審項由 `apply_transcription_triage` 自動轉 `approved`，`reviewed_by = null`、伺服器蓋 `reviewed_at`；有疑慮也自動確認，保留 `triage_doubts`，核對結果是透明度註記而非放行門檻。
- 人工補登仍經 `review_requirement`，一般瀏覽器不能直接偽造確認狀態或 reviewer。估驗、變更等正式業務核定不在這項自動確認例外內。
- D-020：全部已確認 Requirement 類型都由 `materialize_requirement_obligation` 單向物化義務，並非僅 deadline；義務執行狀態不反向改寫 Requirement。
- 現行函式以 `supabase/migrations/20260901040000_materialize_all_requirement_types.sql` 及其後續 migration 為準；產品決策見 [`../DECISIONS.md`](../DECISIONS.md) D-019／D-020。
- 2026-09-07 發現的主頁核對誤標，已於 09-08 在本機修正，尚未部署；歷史健檢見 [`../產品健檢與開發方向-2026-09-07.md`](../產品健檢與開發方向-2026-09-07.md)。

## 2026-09-08 介面與完整性補記（本機完成、未部署）

- 同日後續 UI/UX：文件 → 履約重點 → 擷取審核 → 返回的 `?package=` 保留契約範圍；AI 項目由 ingestion run／document version 所屬契約推導，人工項目讀 `requirements.contract_package_id`。這是 RLS 後的展示篩選，不提供跨契約授權。三方視角由登入 `profiles.org_type` 決定，沒有可任意切換身分的產品控制項。
- 重點頁進入時刷新義務，processing／pending ingestion 期間持續刷新，空結果不再誘導使用者逐條確認。無日期項目改顯示「無到期日」，不推論沒有履約責任。審核讀取及詳情請求加上世代防護，舊請求不覆蓋新專案／新選取項目。

- 主頁 `/requirements` 與擷取審核 `/requirements/review` 共用 `requirementVerification`。只有 AI 已確認、具 `reviewed_at` 且 `triage_doubts` 明確為空陣列，才顯示既有「系統核對無誤」標示，並註明僅為引文與適用期限數字核對；缺值與有疑慮分別揭露。
- 「只看需留意項目」集中顯示現行範圍中有核對疑慮、缺核對結果或待確認等資料；不包含已駁回／已取代項目，已有人工確認的項目也不因舊 AI 疑慮再次列入。保留全部瀏覽、歷史範圍與指定條款深連結。這是檢查入口，不改 D-019 的自動確認與下游 runtime。
- 審核 requirements／runs 已改為既有分頁工具載入，不再套 300／100 筆清單上限；主頁 runs 也不再只取 50 筆。此分頁工具沿用目前 PostgREST 1,000 列設定，並非任意 server cap 的通用保證。來源子表仍依 ID 分批載入。
- 每個文件版本的最近一次 completed run 各自顯示覆蓋警示，含無文字頁、被丟棄的無效輸出與截斷。空清單仍會揭露不完整，不能當成契約沒有義務。舊版本的警示仍保留，不推定新版本已處理相同缺漏。

以下為歷史基礎章節；舊頁面路由、筆數上限與只限人工確認等敘述，以上述現況及 D-019／D-020 為準。

## 1. Human review boundary

P0-06 produces traceable AI Requirement suggestions (`draft_ai` /
`needs_review`, linked to a `document_ingestion_run`). P0-07 adds the human
contractual decision on top:

```
AI Requirement Suggestion → Human Review → Approve / Reject
  → Approved Requirement → Authoritative Project Rule
```

Only `status = 'approved'` is authoritative (`is_authoritative` stays a
generated column). The browser cannot manufacture approval: lifecycle
transitions now exist for application users only through the controlled
review action, and every P0-01/P0-03/P0-06 guard remains in force.

## 2. Requirement lifecycle decisions

Three narrow decisions, nothing generic:

| decision | allowed from | result |
|---|---|---|
| `approve` | `draft_ai`, `needs_review` | `approved` |
| `reject` | `draft_ai`, `needs_review` | `rejected` |
| `supersede` | `approved` | `superseded` |

Every other transition is rejected by both the RPC and the transition guard.

## 3. Controlled review RPC

`review_requirement(p_requirement_id uuid, p_decision text)`
(migration `20260710000600_p0_07_requirement_review.sql`), SECURITY DEFINER
with `set search_path = public`, granted to `authenticated` only. It:

1. requires `auth.uid()`; 2. loads the Requirement and derives the project
from the row (the caller can pass no project, reviewer, timestamp, or raw
status); 3. checks `can_review_requirement(project_id)`; 4. validates the
lifecycle transition; 5. for AI-origin Requirements enforces the completed-run
rule (§5); 6. updates status + `reviewed_by = auth.uid()` +
`reviewed_at = now()`; 7. returns the updated row so the UI refreshes from the
server.

The RPC marks the transaction with a transaction-local GUC
(`pmis.requirement_review = <requirement id>`, cleared after the update).
PostgREST clients cannot set arbitrary GUCs, so only this function can open
the door that the snapshot guard checks. There is no service-role review path
for normal users.

## 4. Server-stamped review identity/time

The redefined `requirements_snapshot_guard` (P0-07 block; the P0-03 migration
text is untouched — later blocks override earlier function definitions)
rejects any authenticated change to `reviewed_by` / `reviewed_at` outside the
review context: on unreviewed rows with
`review metadata is stamped by the controlled review action`, on reviewed rows
with the original frozen-snapshot error. A reviewer therefore cannot forge
another user's identity or a fake timestamp through direct PATCH.
`origin` and `legacy_contract_obligation_id` are likewise immutable for
application users (the legacy sync trigger never changes their values, so it
is unaffected).

## 5. Failed ingestion-run approval protection

An AI-origin Requirement may become `approved` only when its linked
`document_ingestion_run` has `status = 'completed'`. A run that is `pending`,
`processing`, `failed` — or missing entirely (`ingestion_run_id is null` on an
`origin='ai'` row) — blocks approval with
`AI requirement approval requires a completed ingestion run`. This is enforced
twice: in the RPC (clear pre-check) and in the transition guard, where it
binds **every** writer including the service role. Rejecting a failed-run
suggestion stays allowed. `manual` / `migration` Requirements never need a
run.

## 6. Requirement review UI

Dedicated page `/requirements` (nav 契約重點), separate from the legacy deadline
list; the Contract-page ingestion card links to it after a successful
extraction. The page uses bounded, focused Supabase queries (runs ≤ 100,
requirements ≤ 300, sources for the listed rows only; detail links load per
selection) — nothing enters the global store. A required query failure produces
an explicit retry state and is never presented as an empty contract.

W8-3B changes the default presentation, not the review boundary:

* **已生效的契約重點** includes every approved Requirement in the
  bounded Requirement query,
  including an approved AI row from an older run. Reprocessing cannot make an
  authoritative contract fact disappear from the default view.
* **值得留意的整理結果** shows at most six unreviewed rows.
  Manual/migration rows remain eligible; AI rows must belong to the latest
  completed run per document version. Failed/processing/pending and stale-run
  suggestions stay out of the summary.
* Summary deduplication is display-only and exact across type, responsible
  party, phase, content, timing/frequency rule, acceptance criteria and
  evidence. There is no fuzzy or semantic merge and no database row changes.
* The complete filters, all lifecycle states, historical runs and original
  review list remain under the explicit **查看全部擷取結果** disclosure.
  This is labelled as traceability data, not a queue that users must clear.

The trace view keeps the six filters: scope (current / all history), status,
requirement type, responsible party, source-verification state and ingestion
run. Its current scope and deterministic review ordering remain unchanged:
`needs_review` → `draft_ai` → reviewed states, oldest first, id as tiebreak
(`src/lib/requirementReview.js`).

Review controls (核定 / 駁回 / 廢止取代) render only for
`can.reviewRequirement`, call the RPC, and update state exclusively from the
server response — no optimistic approval. Reviewers may also correct
suggestion content (title, description, type, responsibility, phase,
acceptance criteria, evidence) while the row is `draft_ai`/`needs_review`;
the DB confines such edits to unreviewed rows.

The only summary shortcut that claims to create an operational follow-up is
**核定並加入期限追蹤**. It appears only to a reviewer for an
unreviewed `deadline` with a deterministic trackable rule and, for AI rows, a
verified source. It still calls `review_requirement`; D-012 materializes the
obligation in the same server transaction, and the UI reloads obligations only
after the server returns. Other requirement types can be inspected and may be
approved as contract rules in detail, but the UI does not claim to create a
submittal, inspection, test, checklist or evidence workflow.

## 7. Source presentation

Every `requirement_sources` row is shown with document title, version label,
page (`第 N 頁` only when a grounded page number exists; otherwise
`無可靠頁碼` — a DOCX storage segment index is never displayed as a page),
section, clause, and the exact quotation. Verification state is always
visible with neutral labels — 來源已核對 / 來源待人工確認 — and unverified
sources are never hidden; they are reviewable by an authorized human with the
limitation made obvious. AI provenance (run, document, version, model, prompt
version, completion time) is shown with an explicit note that provenance is
traceability, not authority.

## 8. Citation mutation safety

`guard_requirement_source_verification` (BEFORE INSERT/UPDATE on
`requirement_sources`, authenticated writers only):

* INSERT with `source_verified = true` → rejected
  (`source verification is determined by the system`).
* UPDATE changing any citation field (`document_version_id`, `page_number`,
  `page_label`, `section`, `clause`, `source_text`, offsets) → the verdict is
  conservatively reset to `false`, even if the writer claims `true`.
* UPDATE flipping `false → true` without a citation change → rejected.

No LLM re-verification is performed. The P0-06 ingestion service (no
authenticated JWT) is exempt and keeps writing deterministic verified
sources. The P0-03 snapshot guard fires first (alphabetical trigger order),
so citations of reviewed Requirements stay frozen with their original error.

## 9. BOQ candidate link review

`requirement_work_items.review_status` (`suggested` / `approved` /
`rejected`) is the canonical decision state. The legacy `reviewed` boolean is
retained as a **derived** compatibility field — a sync trigger enforces
`reviewed = (review_status = 'approved')` on every write, and a writer that
only sets the boolean is folded into the equivalent `review_status`, so the
two can never drift. Existing rows were migrated (`false → suggested`,
`true → approved`). An application user cannot insert an AI link that is
already approved (`AI work-item suggestions must start as suggested`); the
P0-06 service inserts stay `suggested`. Reviewers (RLS:
`can_review_requirement`) approve/reject suggestions or manually add links —
manual links reference a real `work_items.id` resolved from the BOQ by exact
item number (never fuzzy titles), and the P0-01 same-project trigger applies
to every link.

## 10–11. Approved Requirement artifact boundary — `requirement_artifact_links`

```
requirement_artifact_links (
  id, requirement_id → requirements, artifact_type, artifact_id,
  generation_type (manual | ai_draft | migration),
  created_by (server-stamped for authenticated writers), created_at,
  unique (requirement_id, artifact_type, artifact_id))
```

DB-enforced invariants (`validate_requirement_artifact_link`):

* the Requirement must be `approved` — `draft_ai`, `needs_review`, `rejected`
  (and cascaded missing rows) cannot create links;
* the polymorphic target must exist and belong to the same project. Explicit
  per-type mapping to real durable tables only: `inspection_point →
  inspection_points`, `checklist → checklist_templates`, `test →
  test_samples`, `submittal → submittals`, `evidence → photos`, `deadline →
  contract_obligations` (compatibility). `report` has no durable target table
  yet and is deliberately outside the initial CHECK vocabulary — no fake FK
  target was invented.

RLS: project members read; creation/deletion requires
`can_review_requirement`; no UPDATE policy (a link is a point-in-time
decision — delete and recreate). The UI shows 已連結流程項目 (or the neutral
尚未建立流程項目) in the approved-Requirement detail; P0-07 ships no link
creation wizard and no generators.

## 12. No automatic active workflow generation

P0-07 never turns AI output into an active H hold point, a submitted
inspection, or an approved checklist. The protected chain is: AI suggestion →
human-approved Requirement → (future) draft artifact generation → authorized
domain workflow. Generators belong to later chapters.

## 13. Authorization

* Requirement lifecycle + BOQ link decisions + artifact-link creation:
  `can_review_requirement(project)` (agency PM/engineer, supervisor
  manager/engineer) — per project, fail-closed.
* `is_project_admin` and `profiles.org_type` grant nothing here (verified by
  pgTAP: a contractor PM with technical-admin status cannot review, and the
  same user has different review authority on different projects).
* Contractors/document managers who ingest documents get no linking or review
  authority from that fact.

## 14. Deliberate non-goals

No P0-08 document review cycles, P0-09 onboarding, P0-10 intelligence layer,
AI copilot, ITP/checklist/test generators, or automatic workflow activation.
No artifact-creation wizard, no `report` artifact target, no LLM
re-verification of edited citations, no demo-mode seed data for the review
page (demo shows an explanatory empty state), and no changes to the P0-06
Edge Function — service-role ingestion writes are exercised unchanged by the
P0-07 pgTAP suite.
