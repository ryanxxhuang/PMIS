# Contractual Authority Model (P0-03 / P0-04)

This document describes the implemented P0-03 authorization cutover and the
P0-04 authorization test matrix. It reflects `supabase/schema.sql`, the
`20260710000300_p0_03_04_authority_cutover.sql` migration, the
`supabase/tests/p0_03_04_authority_cutover.sql` pgTAP suite,
`src/lib/projectPermissions.js`, and the store/navigation wiring. It does not
describe future workflow as if it already exists.

## 1. Technical administration vs contractual authority

The load-bearing rule of this phase:

```text
TECHNICAL ADMINISTRATION  ≠  CONTRACTUAL AUTHORITY
```

`project_memberships.is_project_admin` authorizes only technical
identity/project administration — maintaining project parties, memberships,
and deleting the project where the product already permits it. It never grants
a business approval. A contractor who creates a project is:

```text
party_type = contractor
project_role = contractor_pm
is_project_admin = true
```

and remains a contractor. Admin status does not make that person a supervisor
or an agency approver. Every `is_project_admin` bypass that previously existed
in the workflow triggers has been removed: the guards in the P0-03 section of
`schema.sql` contain no `is_project_admin` branch.

## 2. Party type vs project role

Authority is derived from project-scoped identity, never from
`profiles.org_type` (a legacy signup hint) or `project_members.role`:

```text
permission = party_type × project_role × workflow_action × workflow_state
```

- `project_parties.party_type` — the side of the relationship: `agency`,
  `contractor`, `supervisor`, `designer`, `consultant`, `other`.
- `project_memberships.project_role` — what the person does: `agency_pm`,
  `agency_engineer`, `contractor_pm`, `site_manager`, `quality_engineer`,
  `safety_engineer`, `supervisor_manager`, `supervisor_engineer`,
  `document_controller`, `viewer`.
- `workflow_state` — enforced by transition guards (below), e.g. only a
  supervisor may move a valuation across `已核定`.

`my_project_membership(project_id)` resolves the caller's single membership for
one project, joins the party, and — critically — filters on `pp.is_active`, so
a deactivated party yields no membership and all authority fails closed.

## 3. Role–party compatibility

A membership may only pair a role with a party type that can legitimately hold
it. `role_allowed_for_party(party_type, role)` encodes:

| party_type            | allowed project_role |
|-----------------------|----------------------|
| `agency`              | `agency_pm`, `agency_engineer`, `document_controller`, `viewer` |
| `contractor`          | `contractor_pm`, `site_manager`, `quality_engineer`, `safety_engineer`, `document_controller`, `viewer` |
| `supervisor`          | `supervisor_manager`, `supervisor_engineer`, `document_controller`, `viewer` |
| `designer` / `consultant` / `other` | `document_controller`, `viewer` only |

`validate_membership_project_party()` enforces this on membership INSERT, on any
`project_party_id` change, and on any `project_role` change;
`guard_project_party_lifecycle()` enforces it when a party's `party_type`
changes (it rejects a change that would strand incompatible member roles).
Nonsensical combinations such as *contractor party + supervisor_engineer* or
*agency party + contractor_pm* cannot exist, closing the role/party escalation
path. Designer/consultant/other hold no contractual decision authority in this
phase; a `document_controller` on those parties retains document-control access.

## 4. Explicit permission matrix

Initial matrix (implemented in both the SQL permission functions and
`src/lib/projectPermissions.js`). "—" means no authority.

### Agency

| role | may | may not |
|------|-----|---------|
| `agency_pm` | view shared records; ratify change orders; update payment/disbursement fields; record agency acceptance stages (初驗/複驗/正驗/結算證明/保固) + participate in 竣工確認; review/approve Requirements; manage documents | submit valuation; decide inspection; self-inspect; close defects; review submittals; access contractor-private data |
| `agency_engineer` | view shared records; agency oversight; agency acceptance stages + 竣工確認; review Requirements | change-order **ratification** and **payment** authority (agency_pm only) |

Agency-PM-vs-engineer difference: `agency_engineer` deliberately does **not**
get `can_ratify_change_order` or `can_update_payment_fields`. Ratification of
the contract sum and disbursement recording are reserved to `agency_pm`
(least privilege); both share requirement review and acceptance authority.

### Contractor

| role | may | may not |
|------|-----|---------|
| `contractor_pm` | daily logs; submit valuation; create submittal/RFI; submit inspection request; manage BOQ, obligations, change-order drafts, progress plan; defect remediation; **contractor-private cost/margin**; record 報竣/缺失改善 | approve valuation; decide inspection; close defect; review submittal; answer RFI; ratify CO; approve Requirement |
| `site_manager` | daily logs; submit inspection request; create execution RFI/submittal; defect remediation; progress plan | contractor-private cost/margin; decide/approve anything |
| `quality_engineer` | quality execution (checklists/samples); daily logs; submit inspection request; defect remediation; record 缺失改善 | contractor-private cost/margin; decide inspection; close defect; approve |
| `safety_engineer` | safety records | quality, valuation, or any approval right |
| `document_controller` | manage documents; create submittal records | approve submitted documents |
| `viewer` | read only | any write |

### Supervisor

| role | may | may not |
|------|-----|---------|
| `supervisor_manager` | decide inspection; review valuation; review submittal; answer RFI; close defect after verification; manage ITP; review Requirements; participate 竣工確認; manage documents | submit contractor valuation; self-inspect as contractor; contractor-private data; agency ratification/payment |
| `supervisor_engineer` | decide inspection; review valuation; review submittal; answer RFI; verify+close defect; manage ITP; review Requirements; participate 竣工確認 | agency-only CO ratification / payment; contractor-private data |
| `document_controller` | document-control only | approvals |
| `viewer` | read only | any write |

## 5. Server permission functions

All are `SECURITY DEFINER … SET search_path = public`, execute revoked from
`public`/`anon` and granted to `authenticated`, and read only project-scoped
identity via `has_project_authority(project, party_types[], roles[])` (which
itself uses `my_project_membership`). None reads `profiles.org_type`; none has
an `is_project_admin` bypass.

- Technical admin: `can_manage_project_identity` (= `is_project_admin_v2`).
- Contractor execution: `can_manage_boq`, `can_manage_daily_logs`,
  `can_manage_safety_records`, `can_manage_quality_execution`,
  `can_submit_inspection`, `can_submit_valuation`,
  `can_manage_contractor_private`, `can_create_submittal`, `can_create_rfi`,
  `can_manage_defect_remediation`, `can_manage_progress_plan`,
  `can_manage_contract_obligations`, `can_manage_change_orders`.
- Supervisor assurance: `can_decide_inspection`, `can_review_valuation`,
  `can_review_submittal`, `can_answer_rfi`, `can_close_defect`,
  `can_manage_itp`, `can_review_change_order`.
- Agency governance: `can_ratify_change_order`, `can_update_payment_fields`
  (agency_pm or contractor_pm — the two sides that record 請款/撥款),
  `can_review_requirement` (agency or supervisor reviewer).
- Mixed/shared: `can_open_defect` (supervision or contractor quality),
  `can_manage_observations`, `can_manage_field_media`, `can_manage_documents`,
  `can_record_acceptance_stage(project, stage)`.

`can_write()` is retained only as a deprecated shim that now returns `false`
(so any missed legacy reference fails closed). `can_access_contractor_private()`
delegates to `can_manage_contractor_private()` with no admin bypass.

## 6. Workflow state-transition protection

RLS decides who may touch a row; the transition guards decide who may make a
sensitive state change or edit a frozen field. Every guard passes when
`auth.uid()` is null (service role / SQL editor / migrations) and has no
`is_project_admin` bypass. Guards were migrated off `my_org_type()`/
`is_project_admin()` onto the explicit permission functions and were extended
to cover INSERT and DELETE, not just UPDATE:

- `valuations_guard` — new rows start at `草稿`; explicit transitions prevent
  skipping review; crossing to/from `已核定` requires `can_review_valuation`,
  while `已核定 → 已請款` and payment columns
  (`invoice_date`/`paid_date`/`paid_amount`) require
  `can_update_payment_fields`. Approved valuations cannot be deleted and all
  non-payment content is frozen until a reviewer returns the valuation to draft.
- `valuation_items_guard` — details of an approved/claimed valuation are frozen
  for every application role; parent-cascade deletes pass.
- `inspections_guard` — `status`, `result_note`, `inspected_by`, and
  `inspected_at` are decision fields requiring `can_decide_inspection`;
  pre-decided inserts and unauthorized decided-row edits/deletes are blocked.
- `defects_guard` — closing/reopening and pre-closed insert require
  `can_close_defect`.
- `submittals_guard` — `status`, `review_note`, and `decided_date` review fields
  require `can_review_submittal`; new rows start at `已提送`, and
  `退回補正 → 已提送` re-submit is allowed for `can_create_submittal` without
  rewriting the review note.
- `rfis_guard` — `answer`/`answered_date` and `待回覆 → 已回覆` require
  `can_answer_rfi`; new rows must be unanswered at `待回覆`, only
  `已回覆 → 已結案` may be closed by the questioner or supervisor, and answered
  RFIs cannot be deleted by the contractor.
- `change_orders_guard` — `核准`/`駁回` and pre-ratified inserts require
  `can_ratify_change_order`; only supervision may move `提出 ↔ 審核中`, only
  agency PM may ratify or reopen an approval, and only the contractor PM may
  resubmit a rejection. Content and lines freeze once review begins; rejected
  drafts may be corrected and resubmitted.
- `change_order_items_guard` — enforces same-project parent/work-item links and
  freezes lines once review begins; parent-cascade passes.
- `inspection_points_guard` — non-supervisor writers (the contractor submitting
  a request) may only set `inspection_id`; the ITP definition is supervisor-only.
- `requirements_snapshot_guard` — see §9.
- `requirement_sources_snapshot_guard` — citations of a reviewed requirement
  are immutable.

## 7. Contractor-private data rule

`cost_items` (budget/actual cost, subcontracts, margin) is contractor business
secret. The single FOR-ALL policy uses `can_manage_contractor_private`, which
is `party_type = contractor AND project_role = contractor_pm`. By least
privilege, `site_manager`, `quality_engineer`, `safety_engineer`, and
`document_controller` have **no** cost/margin access in this phase. Agency and
supervisor — including an agency or supervisor **project admin** — cannot even
`SELECT` these rows. Tested directly against the database in P0-04 (§15.4), not
just via hidden UI.

## 8. Acceptance stage authority

Stage vocabulary comes from `src/lib/acceptance.js` (`ACCEPTANCE_STAGES`).
`can_record_acceptance_stage(project, stage)` maps each stage to the party that
owns it (mirrored in `ACCEPTANCE_STAGE_AUTHORITY` on the frontend):

| stage | label | authorized |
|-------|-------|-----------|
| `report` | 竣工申報（報竣） | contractor `contractor_pm` |
| `confirm` | 竣工確認會勘 | agency (pm/engineer) **or** supervisor (manager/engineer) |
| `fix` | 缺失改善 | contractor `contractor_pm` / `quality_engineer` |
| `initial` | 初驗 | agency (pm/engineer) |
| `reinspect` | 複驗 | agency (pm/engineer) |
| `final` | 正式驗收 | agency (pm/engineer) |
| `certificate` | 結算驗收證明書 | agency (pm/engineer) |
| `warranty` | 保固起算 | agency (pm/engineer) |

`acceptance_events` moved from an all-members FOR-ALL policy to select =
project member, and insert/update/delete = `can_record_acceptance_stage`. A
contractor cannot record 初驗/正驗/結算證明; a supervisor cannot record the
agency-only certificate; agency cannot impersonate the contractor 報竣.

## 9. Requirement review authority

Requirement lifecycle transitions are protected by
`requirements_snapshot_guard`:

```text
draft_ai / needs_review → approved | rejected      (reviewer only)
approved → superseded                              (reviewer only)
```

Only `can_review_requirement` (an agency `agency_pm`/`agency_engineer` or a
supervisor `supervisor_manager`/`supervisor_engineer`) may transition status.
Contractors may read requirement suggestions and approved requirements
(RLS select = project member) but cannot approve them. Beyond transitions:

- Content of a reviewed requirement (`approved`/`rejected`/`superseded`) is
  immutable — editing it raises rather than silently mutating authoritative
  truth; supersede-and-recreate is the path (P0-07 owns that UI).
- Authenticated application writers must create Requirements as `draft_ai` or
  `needs_review`; even a reviewer cannot bypass the lifecycle with a direct
  authoritative INSERT. Review actor/time metadata freezes with the content.
- Reviewed requirements cannot be deleted by application users.
- Requirement citations (`requirement_sources`) of a reviewed requirement are
  frozen. The legacy `contract_obligations → requirements` sync trigger keeps
  flowing for `draft_ai`/`needs_review` rows exactly as in P0-01; once reviewed,
  the snapshot guard rejects any attempted rewrite by an authenticated
  application caller.

The RLS write policies on `requirements`, `requirement_sources`, and
`requirement_work_items` also require `can_review_requirement`, so a contractor
cannot insert an already-`approved` requirement.

### Approved requirement responsibility is protected

`requirements.responsible_project_party_id` (FK `ON DELETE SET NULL`) points at
the accountable party. Because project parties are **deactivated, not deleted**
by application users (§10), an approved requirement keeps referencing an
inactive historical party — identity stays traceable and the lifecycle state is
never changed by party administration. `guard_project_party_lifecycle()`
additionally rejects any hard delete (even service-role via an authenticated
session) of a party referenced by an `approved`/`superseded` requirement, so the
`SET NULL` cascade can never silently blank authoritative responsibility.

## 10. Identity administration integrity (no lockout)

- `project_parties.is_active` added; application DELETE policy removed. Normal
  users deactivate parties.
- `guard_project_party_lifecycle()` forbids deactivating or hard-deleting a
  party that still has memberships (reassign first), and forbids hard-deleting a
  party referenced by an authoritative requirement.
- `guard_last_project_admin()` forbids an application user from removing or
  demoting (`is_project_admin true → false`) the **last** technical admin of a
  project; it locks the project row before counting remaining admins so two
  concurrent demotions cannot both pass. Project-level cascade (deleting the
  project row) is exempt.
- Membership `user_id` is immutable, and an authenticated member cannot change
  their own `project_party_id` or `project_role`, including when they are a
  technical admin. Another technical admin must perform that reassignment.

Chosen invariant, stated exactly: *a project that uses `project_memberships`
always retains at least one `is_project_admin = true` member and never strands
memberships on an inactive or type-changed party.*

## 11. Frontend permission alignment

`src/lib/projectPermissions.js` is a pure module. `derivePermissions(membership)`
takes `{ party_type, project_role, is_project_admin, party_is_active }` and
returns the explicit permission map used by the store's `can`. It mirrors the
server matrix one-for-one; the server is always the final arbiter (RLS +
guards). Business permissions are **not** derived from `currentUser.org_type`
after P0-03, and `is_project_admin` is never an "approve everything" override —
it only sets `manageProjectIdentity`/`admin`. Sensitive screens were migrated to
explicit keys (`decideInspection`, `reviewSubmittal`, `answerRfi`, `closeDefect`,
`reviewValuation`, `submitValuation`, `ratifyChangeOrder`, `manageItp`,
`accessContractorPrivate`, `manageChangeOrders`, `editDailyLog`,
`manageQualityExecution`, `submitInspection`, `openDefect`,
`manageDefectRemediation`, `manageObservations`, `manageSafety`, `manageBoq`,
`manageProgressPlan`, `manageObligations`, `manageProjectIdentity`,
`updatePayment`, and per-stage `recordAcceptance`). Coarse aliases
(`edit`/`submit`/`oversee`/`readonly`) remain only for non-sensitive UI and are
computed from the explicit permissions, never the reverse.

## 12. Navigation project-role behavior

`WebLayout` filters navigation by `partyOrgKey` — derived from
`currentProjectMembership.party_type` (`agency→owner`, `contractor`,
`supervisor`; unresolved `other`/inactive → `null`, shared tools only). When a
real user switches projects, the visible tools and the dashboard/assistant
role view change with the project (Project A contractor vs Project B supervisor)
without ever rewriting `currentUser.org_type`. The former "admin sees every
tool" override is gone. `/cost` additionally requires the
`accessContractorPrivate` permission. Demo mode keeps its three sales-storyline
roles, mapped to representative memberships via `deriveDemoPermissions`.

## 13. Legacy identity compatibility boundary

`profiles.org_type` and `project_members` are retained but grant no contractual
authority. Row **visibility** (`my_project_ids()`, `is_project_member()`) now
accepts either the legacy or v2 membership so existing invited users keep read
access while their v2 identity is resolved. The compatibility member RPCs
(`add_member_by_email`, `remove_member`, `add_creator_as_member`) keep
dual-writing both models. `profiles_guard` (legacy org_type lock) is left in
place; it is now only a legacy read-consistency guard, not an authority source.

## 14. Fail-closed unresolved identity

Contractual authority is `false` whenever the v2 membership is unresolved: no
membership, an inactive party, or a `viewer` role. An
`other`/`designer`/`consultant` party has no business workflow authority; only
its explicitly compatible `document_controller` role may manage documents.
There is no fallback to `profiles.org_type`. A legacy member with a `supervisor`
profile but no v2 membership gets read access only and no decision authority
(proved in P0-04). Unresolved/viewer identity is read-only until an admin
resolves it through identity administration.

## 15. P0-04 authorization test matrix

`supabase/tests/p0_03_04_authority_cutover.sql` (pgTAP, 149 assertions) runs as
authenticated identities against real RLS and guards. Fixtures: 3 projects, 6
parties, 9 users covering contractor admin, contractor quality engineer,
supervisor engineer, supervisor manager, agency PM/engineer, viewer, a
legacy-only member, and Ryan (contractor_pm+admin on A, supervisor_engineer
non-admin on B). Coverage:

- **Admin separation** — contractor admin cannot approve own valuation, decide
  own inspection, close own defect, approve own submittal, answer own RFI,
  approve a requirement, or ratify an agency change order; agency admin cannot
  decide a supervisor inspection or read contractor costs; supervisor admin
  cannot read contractor costs. Decision-field-only tampering and illegal
  workflow jumps are also rejected.
- **Positive** — authorized supervisor decides inspection / reviews submittal /
  answers RFI / closes defect / manages ITP / reviews valuation; agency ratifies
  and records agency acceptance stages; agency/supervisor reviewer approves a
  requirement; contractor PM submits valuation; quality engineer performs
  quality execution; contractor submits inspection request.
- **Cross-project** — Ryan has contractor authority on A and supervisor
  authority on B, with no leak either way from org_type, admin status, or the
  other project's party/role.
- **Contractor-private** — contractor PM reads/writes cost rows; agency,
  supervisor, and agency/supervisor project admins cannot SELECT them
  (direct DB, not UI).
- **Identity integrity** — last admin cannot be removed or self-demote; invalid
  party/role combinations rejected on insert, role change, and party-type
  change; membership user identity cannot be reassigned and a technical admin
  cannot change their own contractual role; a party with memberships or
  referenced by an approved requirement cannot be deactivated or hard-deleted;
  approved requirement responsibility survives party deactivation with
  lifecycle untouched.
- **Acceptance authority** — contractor cannot record agency-only stages;
  supervisor cannot record the certificate stage; agency cannot impersonate the
  contractor 報竣; valid actor/stage pairs succeed.

## 16. Known deferred items

- Requirement review UI and downstream generation (P0-07); this phase protects
  only the database transitions and snapshot.
- Document review / submittal integration (P0-08).
- Traceable multi-document AI ingestion (P0-06).
- `profiles.org_type` and `project_members` are intentionally **not** removed;
  a later phase may retire them once every project has resolved v2 identity.
- Designer/consultant/other parties intentionally hold no workflow authority
  yet; roles beyond document_controller/viewer for them are out of scope.
- No organization-management UI was built (this phase is DB integrity +
  authorization only), per the non-goals.
