-- Roll back W5-2 / D-012 to the previous obligation -> Requirement sync.
-- Run through SQL Editor / psql as database owner in one transaction.
-- Data-preserving: obligations generated while W5-2 was active are retained.
begin;

-- Restore the P0-07 controlled review action without materialization.
create or replace function public.review_requirement(
  p_requirement_id uuid,
  p_decision text
) returns public.requirements
language plpgsql security definer set search_path = public as $$
declare
  req public.requirements;
  run_status text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into req from public.requirements where id = p_requirement_id;
  if not found then
    raise exception 'requirement not found';
  end if;
  if not public.can_review_requirement(req.project_id) then
    raise exception 'requirement review requires a requirement reviewer';
  end if;
  if p_decision not in ('approve','reject','supersede') then
    raise exception 'unknown review decision: %', p_decision;
  end if;
  if (p_decision in ('approve','reject') and req.status not in ('draft_ai','needs_review'))
     or (p_decision = 'supersede' and req.status <> 'approved') then
    raise exception 'invalid requirement lifecycle transition from % via %',
      req.status, p_decision;
  end if;
  if p_decision = 'approve' and req.origin = 'ai' then
    if req.ingestion_run_id is not null then
      select status into run_status from public.document_ingestion_runs
        where id = req.ingestion_run_id;
    end if;
    if run_status is distinct from 'completed' then
      raise exception 'AI requirement approval requires a completed ingestion run';
    end if;
  end if;
  perform set_config('pmis.requirement_review', req.id::text, true);
  update public.requirements
  set status = case p_decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        else 'superseded'
      end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = req.id
  returning * into req;
  perform set_config('pmis.requirement_review', '', true);
  return req;
end; $$;
revoke all on function public.review_requirement(uuid, text) from public, anon;
grant execute on function public.review_requirement(uuid, text) to authenticated;

drop function if exists public.materialize_deadline_obligation(uuid);

-- Restore the former application DML surface and trigger direction.
grant insert, delete, update on table public.contract_obligations
  to authenticated;

drop trigger if exists contract_obligations_sync_requirement
  on public.contract_obligations;
create trigger contract_obligations_sync_requirement
  before insert or update on public.contract_obligations for each row
  execute function public.upsert_contract_obligation_requirement();

drop trigger if exists contract_obligations_delete_requirement
  on public.contract_obligations;
create trigger contract_obligations_delete_requirement
  after delete on public.contract_obligations for each row
  execute function public.delete_legacy_requirement_root();

delete from supabase_migrations.schema_migrations
where version = '20260812000500';

commit;
