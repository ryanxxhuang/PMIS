# Contract-First Foundation

This document describes the implemented P0-01 persistence foundation. It does
not describe future workflow as if it already exists.

## 1. Two structural spines

The financial/progress spine remains unchanged:

```text
PCCES BOQ -> work_items -> daily quantity -> valuation -> payment/progress/cost
```

P0-01 establishes the root of the execution/compliance spine:

```text
documents -> document_versions -> document_pages
                                  |
                                  v
requirements -> requirement_sources
             -> requirement_work_items -> work_items
```

## 2. Document domain

- `documents` is the project-scoped logical document root.
- `document_versions` identifies an exact uploaded file. Application users
  cannot change its document, path, filename, MIME type, size, checksum, uploader,
  or upload time; a replacement file requires a new version row.
- `supersedes_version_id` may only reference a version of the same document.
- `document_pages` stores page-numbered extracted text for one exact version.
  Page numbers are positive and unique within that version.

P0-01 creates persistence and integrity rules only. It does not upload files or
extract page text.

## 3. Requirement domain

- `requirements` is the common project-scoped root for deadlines, submittals,
  inspections, tests, checklists, evidence, photos, reports, and other rules.
- `requirement_sources` stores document, legacy, or manual citations.
- `requirement_work_items` links a requirement to one or more PCCES BOQ items.
  A database trigger rejects cross-project links.
- Project identity is immutable on `requirements`, `documents`, and
  `work_items`, so a valid bridge cannot become cross-project through later
  parent reassignment.
- `responsible_project_party_id` is a nullable P0-02 placeholder. Until the
  project-party model exists, `responsible_party_type` is limited to `agency`,
  `supervisor`, `contractor`, or `other` and is not an authorization source.

## 4. Requirement authority lifecycle

Requirement lifecycle values are:

```text
draft_ai -> needs_review -> approved | rejected
approved -> superseded
```

The database permits these five explicit states: `draft_ai`, `needs_review`,
`approved`, `rejected`, and `superseded`. Review metadata records who/when; it
does not grant authority.

Requirement provenance is independent of lifecycle:

- `ai`: extracted or proposed by AI
- `manual`: created by a person
- `migration`: mirrored from legacy `contract_obligations`

## 5. Authoritative Requirement invariant

Only `status = 'approved'` is authoritative. The generated
`is_authoritative` column and `authoritative_requirements` view both enforce
that invariant. Origin, `reviewed_at`, and legacy execution state do not grant
authority.

## 6. Legacy `contract_obligations` compatibility boundary

The current Contract screen, reminders, alerts, and deadline calculations keep
using `contract_obligations`. Each legacy row has a one-to-one
`requirement_id`, and the mirrored requirement retains the same UUID.

`requirements.legacy_contract_obligation_id` records explicit provenance. It
is unique but deliberately has no foreign key: `contract_obligations` already
references `requirements`, so a reverse FK would create a brittle circular
dependency.

## 7. Legacy migration and reprocessing behavior

Legacy rows are mirrored deterministically as:

```text
origin = migration
status = needs_review
legacy_contract_obligation_id = contract_obligations.id
```

Operational status changes remain on `contract_obligations` and never promote
or demote the Requirement lifecycle. While a Requirement is `draft_ai` or
`needs_review`, repeated synchronization updates the same root/source and
removes the deterministic legacy source when its page/clause metadata is
cleared. Once the Requirement is approved, rejected, or superseded, its content
and citation snapshot are frozen against later legacy changes. Parser
replacement may remove draft/needs-review mirrors, but explicit lifecycle
outcomes survive.

## 8. Source traceability semantics

`requirement_sources.source_kind` distinguishes:

- `document`: requires a real `document_version_id`
- `legacy`: may lack a stored document version
- `manual`: may lack a stored document version

`source_verified` is explicit and defaults to false. Legacy page/clause data is
preserved without fabricating a document version, quotation, or verification.
A trigger rejects citations where the Requirement and document version belong
to different projects.

## 9. Requirement to BOQ work-item linkage

`requirement_work_items` is a many-to-many bridge with match type, confidence,
and review state. It connects the compliance spine to the existing BOQ spine
without changing PCCES import or downstream financial calculations.

## 10. Deliberate P0-01 non-goals

P0-01 does not implement document upload/extraction, embeddings, Requirement
review UI, generated workflow artifacts, document review, submittal versioning,
project-party authorization, audit events, onboarding changes, or AI assistant
tool routing. The existing Contract UI is not moved to the Requirement Graph.

## 11. Deferred dependencies

- P0-02: organizations, project parties, memberships, and the deferred party FK
- P0-03: contractual workflow authority
- P0-06: traceable multi-document AI ingestion and page extraction
- P0-07: Requirement review and downstream artifact generation
- P0-08: document review and submittal integration
