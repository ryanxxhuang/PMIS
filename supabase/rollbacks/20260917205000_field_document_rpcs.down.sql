-- Roll back 20260917205000 (P2d: field document save / sign / submit / receive / return RPCs,
-- daily_logs / daily_log_items guards, required-field helpers, agent_actions internal resolver).
-- Drops the five public RPCs and the internal helpers, the two fact-table guards, and restores
-- field_documents_target_uidx to its P2a definition (every bound target unique, regardless of status).
-- Data policy: daily_logs / daily_log_items rows materialised by sign_field_document stay (they are
-- ordinary fact rows) but lose their "signed ⇒ immutable" protection; field_documents /
-- field_document_versions / _signatures / _submissions rows are untouched (P2a tables stay).
-- Caveat: if two documents (one superseded, one active) point at the same daily_logs row the
-- P2a index cannot be recreated — supersede-and-rebind data must be resolved first.
-- Also remove supabase/tests/field_document_sign.sql, otherwise pgTAP goes red.
-- Run through SQL Editor / psql as owner.
begin;

drop function if exists public.return_field_document(uuid, int, text, text);
drop function if exists public.receive_field_document(uuid, int, text);
drop function if exists public.field_document_respond_internal(uuid, int, text, text, text);
drop function if exists public.submit_field_document(uuid, int, text, text);
drop function if exists public.fn_field_document_receipt(public.field_document_submissions, text);
drop function if exists public.sign_field_document(uuid, int, text, text);
drop function if exists public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text);
drop function if exists public.resolve_agent_action_internal(uuid, uuid, text);

drop trigger if exists daily_log_items_guard on public.daily_log_items;
drop trigger if exists daily_logs_guard on public.daily_logs;
drop function if exists public.daily_log_items_guard();
drop function if exists public.daily_logs_guard();
drop function if exists public.fn_daily_log_sign_bypass(uuid, date);
drop function if exists public.fn_daily_log_signed(uuid);

drop function if exists public.fn_field_document_attachment_issues(text, uuid, jsonb);
drop function if exists public.fn_field_document_unmet_fields(jsonb, jsonb);
drop function if exists public.fn_field_document_required_fields(text, jsonb, jsonb);

drop index if exists public.field_documents_target_uidx;
create unique index if not exists field_documents_target_uidx
  on public.field_documents(doc_type, target_id) where target_id is not null;

commit;
