-- Roll back 20260917201000 (P2a: field document family data layer).
-- Drops the five new tables (field_document_submissions / _signatures / _versions,
-- field_documents, photo_intakes), the photos columns added by P2a, the guard /
-- audit trigger functions and pure helpers, and restores photos' table-level
-- insert/update grants for authenticated (the pre-P2a state from 20260712001200).
-- Data policy: any field document, version, signature or submission created after
-- P2a is removed with the tables — export them first (they are evidence).
-- photos.uploader_org / ai_* / work_item_hint / content_sha256 / intake_id values
-- are dropped with the columns; existing photo rows and other columns are untouched.
-- Caveat: P2b/P2d/P3/P4b objects that depend on these tables must be rolled back
-- first (this file drops without CASCADE on purpose).
-- Also remove supabase/tests/field_documents.sql, otherwise pgTAP goes red.
-- Run through SQL Editor / psql as owner.
begin;

drop trigger if exists field_document_submissions_audit on public.field_document_submissions;
drop trigger if exists field_document_signatures_audit on public.field_document_signatures;
drop trigger if exists field_document_versions_audit on public.field_document_versions;
drop trigger if exists field_documents_audit on public.field_documents;
drop trigger if exists field_document_submissions_guard on public.field_document_submissions;
drop trigger if exists field_document_signatures_guard on public.field_document_signatures;
drop trigger if exists field_document_versions_guard on public.field_document_versions;
drop trigger if exists field_documents_guard on public.field_documents;
drop trigger if exists photo_intakes_guard on public.photo_intakes;
drop trigger if exists photos_org_stamp on public.photos;

drop function if exists public.field_document_submissions_audit();
drop function if exists public.field_document_signatures_audit();
drop function if exists public.field_document_versions_audit();
drop function if exists public.field_documents_audit();
drop function if exists public.field_document_submissions_guard();
drop function if exists public.field_document_signatures_guard();
drop function if exists public.field_document_versions_guard();
drop function if exists public.field_documents_guard();
drop function if exists public.photo_intakes_guard();
drop function if exists public.photos_org_stamp();

drop table if exists public.field_document_submissions;
drop table if exists public.field_document_signatures;
drop table if exists public.field_document_versions;
drop table if exists public.field_documents;

drop function if exists public.can_read_field_document(uuid);

drop index if exists public.photos_intake_ai_status_idx;
drop index if exists public.photos_intake_sha_idx;
drop index if exists public.photos_intake_idx;
alter table public.photos
  drop column if exists content_sha256,
  drop column if exists work_item_hint,
  drop column if exists ai_run_at,
  drop column if exists ai_result,
  drop column if exists ai_status,
  drop column if exists uploader_org,
  drop column if exists intake_id;

drop table if exists public.photo_intakes;

drop function if exists public.current_request_user_agent();
drop function if exists public.current_jwt_aal();
drop function if exists public.fn_field_document_changed_keys(jsonb, jsonb);
drop function if exists public.fn_field_document_to_org_allowed(text, text);
drop function if exists public.fn_field_document_target_table(text);
drop function if exists public.fn_field_document_owner_org(text);
drop function if exists public.fn_field_document_content_hash(jsonb, jsonb);

-- photos grants back to the 20260712001200 baseline (table-level insert/update)
grant insert, update on public.photos to authenticated;

commit;
