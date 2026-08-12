-- W5-2 / D-012: Requirement is the only contractual source of truth.
-- A human-approved deadline Requirement materializes one compatibility
-- contract_obligations row for the existing timeline/reminder runtime.
-- Runtime status/evidence/penalty never flow back into Requirement content.

-- Exact, anonymous preflight is emitted before any schema or data change.
-- No project id, title, clause, or document content is logged.
do $$
declare
  obligation_count bigint;
  requirement_count bigint;
  requirement_without_active_obligation_count bigint;
  legacy_requirement_count bigint;
  orphan_legacy_requirement_count bigint;
  approved_deadline_without_obligation_count bigint;
begin
  select count(*) into obligation_count from public.contract_obligations;
  select count(*) into requirement_count from public.requirements;
  select count(*) into requirement_without_active_obligation_count
  from public.requirements r
  left join public.contract_obligations o on o.requirement_id = r.id
  where o.id is null;
  select count(*) into legacy_requirement_count
  from public.requirements where legacy_contract_obligation_id is not null;
  select count(*) into orphan_legacy_requirement_count
  from public.requirements r
  left join public.contract_obligations o
    on o.id = r.legacy_contract_obligation_id
  where r.legacy_contract_obligation_id is not null and o.id is null;
  select count(*) into approved_deadline_without_obligation_count
  from public.requirements r
  left join public.contract_obligations o on o.requirement_id = r.id
  where r.status = 'approved' and r.requirement_type = 'deadline'
    and o.id is null;

  raise notice 'W5-2 preflight obligations=%, requirements=%, requirements_without_active_obligation=%, legacy_requirements=%, orphan_legacy_requirements=%, approved_deadlines_without_obligation=%',
    obligation_count, requirement_count,
    requirement_without_active_obligation_count, legacy_requirement_count,
    orphan_legacy_requirement_count, approved_deadline_without_obligation_count;
end; $$;

-- Retire the old direction. The functions stay in place solely so the
-- documented rollback can reattach them without reconstructing historical
-- logic; with no triggers they have no runtime effect.
drop trigger if exists contract_obligations_sync_requirement
  on public.contract_obligations;
drop trigger if exists contract_obligations_delete_requirement
  on public.contract_obligations;

-- Browser users may operate the compatibility runtime, not author its
-- contractual content. SECURITY DEFINER materialization below runs as owner.
revoke insert, delete, update on table public.contract_obligations
  from authenticated;
grant update (status, evidence_submittal_id)
  on table public.contract_obligations to authenticated;

create or replace function public.materialize_deadline_obligation(
  p_requirement_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  req public.requirements;
  obligation_id uuid;
  next_sort_order integer;
  mapped_offset_days integer;
  mapped_recurring_day integer;
begin
  select * into req
  from public.requirements
  where id = p_requirement_id
    and status = 'approved'
    and requirement_type = 'deadline';

  if not found then
    return null;
  end if;

  mapped_offset_days := case
    when coalesce(req.trigger_config ->> 'offset_days', '') ~ '^-?[0-9]+$'
      then (req.trigger_config ->> 'offset_days')::integer
    else null
  end;
  mapped_recurring_day := case
    when coalesce(req.frequency_config ->> 'day', '') ~ '^[0-9]+$'
      and (req.frequency_config ->> 'day')::integer between 1 and 31
      then (req.frequency_config ->> 'day')::integer
    else null
  end;
  select coalesce(max(sort_order), -1) + 1 into next_sort_order
  from public.contract_obligations where project_id = req.project_id;

  insert into public.contract_obligations (
    id, project_id, title, category, trigger_event,
    offset_days, offset_dir, fixed_date, recurring, recurring_day,
    responsible, note, sort_order, requirement_id
  ) values (
    req.id,
    req.project_id,
    req.title,
    req.lifecycle_phase,
    req.trigger_type,
    mapped_offset_days,
    case when req.trigger_config ->> 'offset_dir' in ('before','after')
      then req.trigger_config ->> 'offset_dir' else 'after' end,
    case when req.trigger_type = 'fixed'
      and coalesce(req.trigger_config ->> 'fixed_date', '') <> ''
      then (req.trigger_config ->> 'fixed_date')::date else null end,
    case when req.frequency_type = 'monthly' then 'monthly' else null end,
    mapped_recurring_day,
    case req.responsible_party_type
      when 'agency' then '機關'
      when 'supervisor' then '監造'
      when 'contractor' then '廠商'
      when 'other' then '其他'
      else null
    end,
    req.description,
    next_sort_order,
    req.id
  )
  on conflict (requirement_id) do update set
    title = excluded.title,
    category = excluded.category,
    trigger_event = excluded.trigger_event,
    offset_days = excluded.offset_days,
    offset_dir = excluded.offset_dir,
    fixed_date = excluded.fixed_date,
    recurring = excluded.recurring,
    recurring_day = excluded.recurring_day,
    responsible = excluded.responsible
  returning id into obligation_id;

  return obligation_id;
end; $$;
revoke all on function public.materialize_deadline_obligation(uuid)
  from public, anon, authenticated;
comment on function public.materialize_deadline_obligation(uuid) is
  'D-012 internal deterministic adapter: approved deadline Requirement -> one obligation runtime row';

-- Keep the existing review boundary and add one deterministic action after
-- the human decision. A materialization error rolls the approval back too.
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

  if p_decision = 'approve' and req.requirement_type = 'deadline' then
    perform public.materialize_deadline_obligation(req.id);
  elsif p_decision = 'supersede' and req.requirement_type = 'deadline' then
    -- Keep the compatibility row and its evidence/history, but retire an open
    -- reminder when its sole contractual source is no longer authoritative.
    update public.contract_obligations
    set status = '不適用'
    where requirement_id = req.id and status = '待辦';
  end if;

  perform set_config('pmis.requirement_review', '', true);
  return req;
end; $$;
revoke all on function public.review_requirement(uuid, text) from public, anon;
grant execute on function public.review_requirement(uuid, text) to authenticated;

-- Existing approved deadlines are brought under the same one-way adapter.
-- Existing obligation rows are updated in place; status/evidence/penalty/note
-- and historical identity are intentionally excluded from the UPDATE list.
do $$
declare requirement_id_to_materialize uuid;
begin
  for requirement_id_to_materialize in
    select id from public.requirements
    where status = 'approved' and requirement_type = 'deadline'
    order by id
  loop
    perform public.materialize_deadline_obligation(requirement_id_to_materialize);
  end loop;
end; $$;
