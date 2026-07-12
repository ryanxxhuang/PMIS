# Project deletion and contract-first mode boundary

This hotfix separates two concepts that must not confer authority on each
other:

- `isPersistedProject` means an authenticated user has selected a real
  Supabase project. Contract dates, obligations, documents, ingestion runs,
  and Requirements use this mode even when the project has no BOQ rows.
- `hasDbBoq` / `dbMode` means that project has persisted `work_items`. Existing
  BOQ-dependent workflows keep using this narrower mode, so sample item IDs
  cannot be written into a real project.

Whole-project deletion is also a separate technical-administration action.
`delete_project` authorizes `can_manage_project_identity`, locks the exact
project, and sets a transaction-local `pmis.project_delete_id`. Protected
DELETE triggers skip their normal row-level guard only when that exact project
ID matches. Direct deletion of audit history, reviewed Requirements, approved
commercial records, final-admin membership, or project parties remains
protected, and technical-admin status does not grant contractual authority.
