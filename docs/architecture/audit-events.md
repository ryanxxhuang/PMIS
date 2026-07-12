# Persistent Audit Events (P0-05)

## Purpose and product boundary

`audit_events` is the persistent evidence history for high-value project
workflow and identity changes. It answers who acted, which project party and
role they represented at that time, which row changed, the before/after state,
and when the change committed.

This is separate from `/audit` **Risk Audit**. Risk Audit computes anomaly and
governance warnings from current project data. `/activity` reads immutable
historical events. P0-05 does not rename, replace, or feed the Risk Audit.

## Schema

Each `audit_events` row contains:

- immutable event identity: `id`, `project_id`, `event_type`, `entity_type`,
  `entity_id`, `action`, `occurred_at`;
- actor-at-time snapshot: `actor_user_id`, `actor_project_party_id`,
  `actor_party_type`, `actor_project_role`, `actor_is_project_admin`;
- optional evidence: `before_data`, `after_data`, and object `metadata`;
- optional `correlation_id` for a future controlled request context.

Indexes support project/time pagination plus entity, actor, event-type, and
non-null correlation lookups. There is no broad analytics index set.

## Append-only invariant

Authenticated application roles have SELECT only. INSERT, UPDATE, and DELETE
privileges are revoked, and RLS defines only `audit_events_select`. There is no
project-admin exception. `guard_audit_event_immutability()` additionally rejects
UPDATE/DELETE whenever an authenticated JWT is present, protecting against a
future overly privileged RPC.

Privileged database maintenance with `auth.uid() is null` is an explicit DBA
boundary. P0-05 provides no application retention, archive, or deletion API.

## Server-generated insertion and transactions

`record_audit_event(...)` is an internal `SECURITY DEFINER` helper. Execution is
revoked from `PUBLIC`, `anon`, and `authenticated`; focused AFTER triggers call
it only after the authoritative row has passed RLS and transition guards.

The business change and audit insert are in the same PostgreSQL transaction:
both commit or both roll back. There is no frontend audit INSERT, async queue,
external logging call, or trigger on `audit_events` itself. Child cascades during
project deletion are ignored once the project root is disappearing, preventing
pathological transient event creation.

## Actor identity snapshot

For authenticated changes, the helper resolves:

```text
auth.uid()
→ project_memberships for event.project_id
→ active project_parties row
```

The five actor fields are copied into the event. Later membership or party
changes do not rewrite history. `actor_is_project_admin` remains a separate
technical flag and never changes `actor_party_type` or `actor_project_role`.

If no active project identity resolves, the user ID is retained and
`metadata.actor_kind = authenticated_unresolved`. When `auth.uid()` is null,
all actor identity fields are null and `metadata.actor_kind = system`; the
system never fabricates a user.

## Audited workflows and vocabulary

Stable machine event types are mapped from actual database transitions:

- valuations: `created`, `submitted`, `returned`, `approved`, `claimed`,
  `payment_updated`, `deleted`;
- inspections: `created`, `decided`, `reopened`, `deleted`;
- defects: `created`, meaningful `remediation_updated`, `closed`, `reopened`,
  `deleted`;
- submittals: `created`, `resubmitted`, `approved`, `approved_as_noted`,
  `returned`, `rejected`, `deleted`;
- RFIs: `created`, `answered`, `closed`, `deleted`;
- change orders: `created`, `review_started`, `returned`, `approved`,
  `rejected`, `ratification_reopened`, `deleted`;
- Requirements: `created`, `approved`, `rejected`, `superseded`, `deleted`;
- documents: `document.created`, `document.version_created` only—document
  review remains P0-08;
- project identity: party creation/update/deactivation and membership
  creation/role/admin/removal;
- acceptance: `stage_recorded`, `stage_updated`, `stage_removed`, with
  `stage_key` in metadata.

The frontend uses a deterministic label map. It never asks an LLM to interpret
event identifiers or fabricate actor names.

## Before/after evidence policy

Creation events normally have only `after_data`; deletion events only
`before_data`; transitions carry both authoritative row images. No generic
`*.updated` event is emitted for harmless edits. Domain triggers emit semantic
events only for meaningful workflow or evidence-field changes. Payment events
also identify changed payment fields in metadata.

Document-version metadata explicitly includes document ID, version label,
revision number, original filename, and checksum when present. Requirement
transition snapshots preserve title, type, responsibility, status, and review
fields as part of the row image.

## Contractor-private exclusion

There is deliberately no `cost_items` audit trigger. Shared audit JSON never
contains contractor budget, actual cost, subcontract cost, margin, or profit.
This preserves the P0-03 contractor-private boundary while `/activity` remains
readable to every project member. A future private audit scope would require an
explicit architecture decision; P0-05 does not create one.

## Visibility and activity UI

SELECT uses the compatibility project read boundary:

```sql
project_id in (select public.my_project_ids())
```

Audit visibility grants no business authority. `/activity` queries the selected
project directly, orders by `occurred_at desc`, and loads at most 50 rows per
page. Actor, event type, entity type, and date filters are applied to the server
query. The global React store does not load audit history during project load.

## Correlation IDs

The insertion helper accepts a correlation ID, but current row triggers pass
null because the application has no controlled request-correlation context.
P0-05 does not fabricate one random ID per row and does not build distributed
tracing.

## Legacy in-memory compatibility decision

The previous React `audit` state had no reader and was not persistent. It has
been removed. Existing domain slices still call the internal `log()` callback;
that callback is temporarily a no-op so P0-05 does not expand into unrelated
slice refactoring. No UI or documentation treats those calls as authoritative.

## Deliberate non-goals

P0-05 does not implement SIEM, telemetry, behavioral analytics, AI audit
scoring/summarization, PDF export, legal certification, cryptographic chaining,
signatures, blockchain, retention/archive policy, document review, Requirement
review UI, AI ingestion, onboarding, or any P0-06+ feature.
