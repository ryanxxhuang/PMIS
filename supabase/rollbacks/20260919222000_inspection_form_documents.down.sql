-- Roll back 20260919222000 (P3c: inspection-form documents — inspections columns, inspection_form sign branch that
-- writes inspection_confirmations, DB-side defect auto-open for inspections, demo template, generalised rule helpers,
-- create_inspection_form_draft, index changes).
--
-- Data policy: inspections keep their status ('部分合格' rows would violate the restored three-value world: the frontend
-- treats it as decided; export or re-decide them first). inspection_confirmations rows written by signing are KEPT
-- (they are P4b billing evidence; revoke them through revoke_inspection_confirmation if they must not count). The
-- inspections columns added here are DROPPED (batch_key/stage_key/unit/declared_qty/confirmed_qty/template_id/results/
-- document_id/document_version_no) — export first if that matters. checklist_templates.kind/stage_key/applies_to/version
-- are dropped too.
--
-- Steps, because this migration replaced earlier functions with `create or replace`:
--   1. run this file (drops the P3c-only objects, restores the 20260712001300 inspections_guard and the 20260712000500
--      audit_inspection_event verbatim, restores the P4b unique index);
--   2. re-run supabase/migrations/20260919141500_self_check_documents.sql sections 0 (fn_field_document_template without
--      inspection_form), 1.2–1.6 (self_check-only item keys, human_only／confirm_required／required_fields), 6
--      (save_field_document_version) and 8 (sign_field_document without the inspection_form branch) — the file is
--      idempotent (create or replace).
-- Also remove supabase/tests/inspection_form_documents.sql and revert the P3c edits in
-- supabase/tests/anon_and_function_privileges.sql (allow-list), otherwise pgTAP goes red. Run through SQL Editor / psql as owner.
begin;

drop function if exists public.sign_field_document(uuid, int, text, text);
drop function if exists public.field_document_sign_inspection_form_internal(public.field_documents, public.field_document_versions, uuid);
drop function if exists public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text);
drop function if exists public.create_inspection_form_draft(uuid);

drop function if exists public.fn_field_document_required_fields(text, jsonb, jsonb);
drop function if exists public.fn_field_document_confirm_required_keys(text, jsonb);
drop function if exists public.fn_field_document_human_only_keys(text, jsonb);
drop function if exists public.fn_field_document_self_check_item_keys(jsonb, text);
drop function if exists public.fn_field_document_item_keys(text, jsonb, text);
drop function if exists public.fn_field_document_stage_required(text, jsonb);
drop function if exists public.fn_field_document_template(text);
-- (step 2 restores the five P3b definitions above)

drop index if exists public.field_documents_inspection_uidx;
drop index if exists public.inspection_confirmations_inspection_stage_uidx;
create unique index if not exists inspection_confirmations_inspection_stage_uidx
  on public.inspection_confirmations(inspection_id, work_item_id, coalesce(stage_key, ''))
  where inspection_id is not null;

drop trigger if exists inspections_defect_sync on public.inspections;
drop function if exists public.inspections_defect_sync();
drop trigger if exists inspections_guard on public.inspections;
drop function if exists public.fn_inspection_sign_bypass(uuid);

-- 20260712001300_formal_mode.sql verbatim
create or replace function public.inspections_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.admin_override(new.project_id) then return new; end if;
  if new.status is distinct from old.status
     and (new.status in ('合格','不合格') or old.status in ('合格','不合格'))
     and public.my_org_type() <> 'supervisor' then
    raise exception '查驗判定(合格/不合格)僅監造可執行';
  end if;
  return new;
end; $$;
create trigger inspections_guard before update on public.inspections
  for each row execute function public.inspections_guard();

-- 20260712000500_p0_05_audit_events.sql verbatim
create or replace function public.audit_inspection_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'inspection.created',
      'inspection', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'inspection.deleted',
      'inspection', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if old.status in ('合格','不合格') and new.status = '待查驗' then
    perform public.record_audit_event(new.project_id, 'inspection.reopened',
      'inspection', new.id, 'reopened', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif new.status in ('合格','不合格') and (
       new.status is distinct from old.status
    or new.result_note is distinct from old.result_note
    or new.inspected_by is distinct from old.inspected_by
    or new.inspected_at is distinct from old.inspected_at
  ) then
    perform public.record_audit_event(new.project_id, 'inspection.decided',
      'inspection', new.id, 'decided', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;

alter table public.inspections drop constraint if exists inspections_status_check;
alter table public.inspections drop constraint if exists inspections_document_pair_check;
alter table public.inspections drop constraint if exists inspections_document_version_fkey;
drop index if exists public.inspections_document_idx;
drop index if exists public.inspections_template_idx;
alter table public.inspections
  drop column if exists batch_key,
  drop column if exists stage_key,
  drop column if exists unit,
  drop column if exists declared_qty,
  drop column if exists confirmed_qty,
  drop column if exists template_id,
  drop column if exists results,
  drop column if exists document_id,
  drop column if exists document_version_no;

drop index if exists public.checklist_templates_project_kind_idx;
alter table public.checklist_templates
  drop column if exists kind,
  drop column if exists stage_key,
  drop column if exists applies_to,
  drop column if exists version;

commit;
