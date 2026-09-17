-- Roll back 20260917221000 (P3a: supervisor_logs fact table, demo template, generic fact-table guard,
-- supervisor_log sign branch, human-only field rule, 3-arg fn_field_document_unmet_fields).
--
-- Data policy: supervisor_logs rows (materialised by sign_field_document) are DROPPED with the table —
-- export them first. field_documents rows of doc_type='supervisor_log' stay; their target_id will point
-- at a table that no longer exists (field_documents_guard only re-checks target_id on change, and P2a's
-- guard rejects any new binding while the table is missing). daily_logs data and behaviour are untouched.
--
-- Two steps, because this migration replaced P2a/P2d functions with `create or replace`:
--   1. run this file (drops the P3a objects, restores the P2a field_document_versions_guard verbatim);
--   2. re-run supabase/migrations/20260917205000_field_document_rpcs.sql in full (it is idempotent:
--      create or replace / drop-if-exists) to restore P2d's save_field_document_version,
--      sign_field_document (daily_log only, PD007 for the rest), daily_logs_guard / daily_log_items_guard,
--      fn_daily_log_signed / fn_daily_log_sign_bypass, and the 2-arg fn_field_document_unmet_fields /
--      P2d fn_field_document_required_fields.
-- Also remove supabase/tests/supervisor_logs.sql and revert the P3a edits in
-- supabase/tests/field_document_sign.sql (3-arg unmet function, D2 expectations), otherwise pgTAP goes red.
-- Run through SQL Editor / psql as owner.
begin;

-- P3a sign dispatch and branches (P2d's sign_field_document is restored by step 2)
drop function if exists public.sign_field_document(uuid, int, text, text);
drop function if exists public.field_document_sign_supervisor_log_internal(public.field_documents, public.field_document_versions, uuid);
drop function if exists public.field_document_sign_daily_log_internal(public.field_documents, public.field_document_versions, uuid);
drop function if exists public.save_field_document_version(uuid, int, jsonb, jsonb, jsonb, text);

-- supervisor_logs (data dropped — export first)
drop trigger if exists supervisor_logs_guard on public.supervisor_logs;
drop function if exists public.supervisor_logs_guard();
drop table if exists public.supervisor_logs;

-- generic fact-table guard rule (daily_logs_guard / daily_log_items_guard bodies are restored by step 2;
-- until then they reference these functions, so keep step 2 immediately after this file)
drop function if exists public.fn_field_document_fact_guard(text, text, uuid, uuid, date, uuid, uuid, date);
drop function if exists public.fn_field_document_sign_bypass(text, uuid, date);
drop function if exists public.fn_field_document_target_signed(text, uuid);

-- rule helpers introduced by P3a
drop function if exists public.fn_field_document_unmet_fields(text, jsonb, jsonb);
drop function if exists public.fn_field_document_required_fields(text, jsonb, jsonb);
drop function if exists public.fn_project_ref_exists(uuid, text, uuid);
drop function if exists public.fn_field_document_type_label(text);
drop function if exists public.fn_field_document_human_only_keys(text);
drop function if exists public.fn_field_document_template_required_keys(text);
drop function if exists public.fn_field_document_template(text);

-- P2a field_document_versions_guard, verbatim (without the human-only block)
create or replace function public.field_document_versions_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid     uuid := auth.uid();
  v_doc   public.field_documents%rowtype;
  v_next  int;
  v_att   jsonb;
  v_pid   uuid;
  v_photo record;
begin
  if tg_op in ('UPDATE','DELETE') then
    if not exists (select 1 from public.field_documents d where d.id = old.document_id) then
      return coalesce(new, old);  -- 文件／專案刪除 cascade
    end if;
    raise exception '文件版本不可變(UPDATE／DELETE 一律拒絕);更正請建立新版本';
  end if;

  select * into v_doc from public.field_documents d where d.id = new.document_id for update;
  if not found then
    raise exception '文件不存在';
  end if;
  if v_doc.status in ('received','discarded','superseded') then
    raise exception '文件狀態為 %,不可再新增版本', v_doc.status;
  end if;

  select coalesce(max(v.version_no), 0) + 1 into v_next
    from public.field_document_versions v where v.document_id = new.document_id;
  if new.version_no is null then
    new.version_no := v_next;
  elsif new.version_no <> v_next then
    raise exception '版本號必須為下一版(%)', v_next;
  end if;

  if new.author_kind = 'human' then
    if uid is null then
      raise exception '人工版本必須由登入使用者建立(伺服器不得代寫人工版本)';
    end if;
    new.created_by := uid;
  else
    if uid is not null then
      raise exception 'AI 版本只能由伺服器處理程序建立';
    end if;
    new.created_by := null;
    if exists (select 1 from public.field_document_versions v
                where v.document_id = new.document_id and v.author_kind = 'human') then
      raise exception '文件已有人工版本,AI 不得再寫入版本(改以 suggest_field_update 建議)';
    end if;
  end if;

  if new.amended_from_version is not null then
    if new.amended_from_version >= new.version_no
       or not exists (select 1 from public.field_document_versions v
                       where v.document_id = new.document_id and v.version_no = new.amended_from_version) then
      raise exception '更正來源版本不存在或不早於本版';
    end if;
  end if;

  if new.attachments is not null then
    for v_att in select value from jsonb_array_elements(new.attachments) loop
      if jsonb_typeof(v_att) <> 'object' or (v_att ->> 'photo_id') is null then
        raise exception '附件格式錯誤:每筆需為物件並含 photo_id';
      end if;
      begin
        v_pid := (v_att ->> 'photo_id')::uuid;
      exception when others then
        raise exception '附件 photo_id 不是合法 UUID';
      end;
      select p.project_id, p.storage_path, p.content_sha256 into v_photo
        from public.photos p where p.id = v_pid;
      if not found or v_photo.project_id <> v_doc.project_id then
        raise exception '附件照片不存在或不屬於同一專案';
      end if;
      if (v_att ->> 'storage_path') is not null and v_att ->> 'storage_path' <> v_photo.storage_path then
        raise exception '附件檔案路徑與照片紀錄不符';
      end if;
      if (v_att ->> 'sha256') is not null and v_photo.content_sha256 is not null
         and v_att ->> 'sha256' <> v_photo.content_sha256 then
        raise exception '附件雜湊與照片紀錄不符';
      end if;
    end loop;
  end if;

  new.content_hash := public.fn_field_document_content_hash(new.content, new.attachments);
  new.created_at   := now();
  return new;
end; $$;
revoke all on function public.field_document_versions_guard() from public, anon, authenticated;

commit;
-- Step 2 (required): \i supabase/migrations/20260917205000_field_document_rpcs.sql
