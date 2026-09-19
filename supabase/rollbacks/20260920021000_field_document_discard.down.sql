-- Roll back 20260920021000 (P3f: discard_field_document — discard a never-signed field document draft).
--
-- Drops the public RPC and the discard-record guard trigger, and restores field_documents_audit (P2a 20260917201000)
-- and resolve_agent_action_internal (P2d 20260917205000) to their previous definitions below.
-- Data policy: nothing is deleted. Documents already discarded stay discarded (P2a guard keeps discarded terminal);
-- their versions were never touched. The four discard-record columns (discard_reason, discarded_by, discarded_at,
-- discard_request_id) are KEPT so the recorded reasons survive; without the guard and the RPC nothing writes them
-- (authenticated has no UPDATE grant on field_documents). To drop them too, export first, then run the commented
-- statement at the end. agent_actions already marked rejected by a discard stay rejected (audit trail intact).
-- Revert the frontend together with this rollback (the four document pages and /site call discard_field_document).
-- Also remove supabase/tests/field_document_discard.sql, revert the P3f edits in
-- supabase/tests/anon_and_function_privileges.sql (allow-list), supabase/tests/field_documents.sql and
-- supabase/tests/field_document_sign.sql (discards there now carry a reason), otherwise pgTAP goes red.
-- Run through SQL Editor / psql as owner.
begin;

drop function if exists public.discard_field_document(uuid, text, text);

drop trigger if exists field_documents_discard_guard on public.field_documents;
drop function if exists public.field_documents_discard_guard();

create or replace function public.field_documents_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_event text;
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'field_document.created', 'field_document', new.id,
      'created', null, to_jsonb(new), jsonb_build_object('doc_type', new.doc_type), null);
    return new;
  end if;
  if new.status is distinct from old.status then
    v_event := case
      when new.status = 'discarded' then 'field_document.discarded'
      when new.status = 'superseded' then 'field_document.superseded'
      when new.status in ('draft','pending_input') and old.status in ('signed','submitted','returned')
        then 'field_document.amended'
      when new.status in ('signed','submitted','received','returned') then null
      else 'field_document.status_changed'
    end;
    if v_event is not null then
      perform public.record_audit_event(new.project_id, v_event, 'field_document', new.id,
        new.status, to_jsonb(old), to_jsonb(new),
        jsonb_build_object('doc_type', new.doc_type, 'version_no', new.current_version_no), null);
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.field_documents_audit() from public, anon, authenticated;

create or replace function public.resolve_agent_action_internal(p_document_id uuid, p_project_id uuid, p_status text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_before public.agent_actions;
  v_after  public.agent_actions;
  v_n      int := 0;
begin
  if auth.uid() is null then
    raise exception '草稿處理必須由登入使用者執行';
  end if;
  if p_status not in ('accepted', 'edited') then
    raise exception '不合法的處理狀態,僅接受 accepted/edited';
  end if;
  for v_before in
    select * from public.agent_actions a
    where a.project_id = p_project_id and a.target_table = 'field_documents'
      and a.target_id = p_document_id and a.status = 'pending'
    order by a.created_at
    for update
  loop
    update public.agent_actions
       set status = p_status, resolved_by = auth.uid(), resolved_at = now()
     where id = v_before.id
     returning * into v_after;
    perform public.record_audit_event(
      v_after.project_id, 'agent_action_resolved', 'agent_action', v_after.id, p_status,
      to_jsonb(v_before), to_jsonb(v_after),
      jsonb_build_object('kind', v_after.kind, 'agent_role', v_after.agent_role,
                         'resolved_via', 'sign_field_document', 'document_id', p_document_id),
      null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke all on function public.resolve_agent_action_internal(uuid, uuid, text) from public, anon, authenticated;

-- Optional, only after exporting the recorded reasons:
-- alter table public.field_documents
--   drop column if exists discard_request_id, drop column if exists discarded_at,
--   drop column if exists discarded_by, drop column if exists discard_reason;

commit;
