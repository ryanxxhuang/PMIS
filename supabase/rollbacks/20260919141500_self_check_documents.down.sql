-- Roll back 20260919141500 (P3b: self-check documents — demo frame template, template-derived rules,
-- DB-side checklist judgement, defect auto-open trigger, self_check sign branch).
--
-- Data policy: checklist_records rows materialised by sign_field_document (and their defects) are KEPT — they are
-- ordinary quality evidence under the P1-07 revision chain. field_documents of doc_type='self_check' keep their
-- target_id; after rollback sign_field_document answers PD007 for them again and checklist_records_guard no longer
-- refuses to delete a bound (unjudged) record — export first if that matters.
--
-- Three steps, because this migration replaced earlier functions with `create or replace`:
--   1. run this file (drops the P3b-only objects, restores the P1-07 checklist_records_guard verbatim);
--   2. re-run supabase/migrations/20260917221000_supervisor_logs.sql sections 0–1 and 4–5 (fn_field_document_template
--      with only supervisor_log, 1-arg fn_field_document_human_only_keys, 3-arg fn_field_document_unmet_fields,
--      P3a fn_field_document_required_fields, field_document_versions_guard, save_field_document_version) — the file
--      is idempotent (create or replace); its section 2/3/6/7 re-runs are harmless;
--   3. re-run supabase/migrations/20260919023220_remove_signing_mfa.sql section 3 (R1 sign_field_document without the
--      self_check branch).
-- Also remove supabase/tests/self_check_documents.sql and revert the P3b edits in supabase/tests/supervisor_logs.sql,
-- field_document_sign.sql and checklist_revisions.sql, otherwise pgTAP goes red. Run through SQL Editor / psql as owner.
begin;

drop function if exists public.sign_field_document(uuid, int, text, text);
drop function if exists public.field_document_sign_self_check_internal(public.field_documents, public.field_document_versions, uuid);
drop function if exists public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text);
-- field_document_versions_guard(): body restored by step 2 (create or replace), trigger stays

drop trigger if exists checklist_records_defect_sync on public.checklist_records;
drop function if exists public.checklist_records_defect_sync();
drop function if exists public.fn_checklist_judge(jsonb, jsonb);

drop function if exists public.fn_field_document_unmet_fields(text, jsonb, jsonb, jsonb);
drop function if exists public.fn_field_document_required_fields(text, jsonb, jsonb);
drop function if exists public.fn_field_document_confirm_required_keys(text, jsonb);
drop function if exists public.fn_field_document_human_only_keys(text, jsonb);
drop function if exists public.fn_field_document_self_check_item_keys(jsonb, text);
drop function if exists public.fn_field_document_checklist_items(jsonb);
drop function if exists public.fn_field_document_template(text);

-- P1-07 checklist_records_guard, verbatim (no DB judgement, no signed-document delete rule)
create or replace function public.checklist_records_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  base public.checklist_records%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.supersedes_id is not null then
      select * into base from public.checklist_records where id = new.supersedes_id;
      if not found then
        raise exception '被修訂的檢查紀錄不存在';
      end if;
      if base.project_id <> new.project_id then
        raise exception '修訂版必須與原檢查紀錄同一專案';
      end if;
      if base.template_id is distinct from new.template_id then
        raise exception '修訂版必須沿用原檢查表範本;換範本請另立新檢查';
      end if;
      if new.revision_reason is null or btrim(new.revision_reason) = '' then
        raise exception '建立修訂版次必須填寫更正原因';
      end if;
      new.rev     := base.rev + 1;
      new.root_id := coalesce(base.root_id, base.id);
    elsif uid is null then
      new.rev     := coalesce(new.rev, 0);
      new.root_id := coalesce(new.root_id, new.id);
    else
      new.rev := 0; new.root_id := new.id;
    end if;
  end if;

  if uid is null then return coalesce(new, old); end if;
  if tg_op in ('UPDATE','DELETE')
     and not exists (select 1 from public.projects pr where pr.id = old.project_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    new.created_by := uid;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception '檢查紀錄為品質證據,不可就地修改;請以「修訂」建立 Rev.N 更正';
  end if;

  if old.overall in ('合格','不合格') then
    raise exception '已判定的檢查紀錄不可刪除;如需更正請建立修訂版次';
  end if;
  if exists (select 1 from public.checklist_records c where c.supersedes_id = old.id) then
    raise exception '此檢查紀錄已被修訂版次引用,不可刪除';
  end if;
  return old;
end; $$;

commit;
