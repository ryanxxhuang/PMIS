-- Roll back D-020 to the deadline-only adapter (D-012 as of 20260824000200).
-- Run through SQL Editor / psql as database owner in one transaction.
-- Data policy: non-deadline obligation rows with no runtime traces are
-- deleted; rows users already operated (status/evidence/completion) are
-- retired to 不適用 instead — runtime history is never destroyed.
begin;

-- Restore the deadline-only materializer under its original name.
create or replace function public.materialize_deadline_obligation(
  p_requirement_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  req public.requirements;
  obligation_id uuid;
  next_sort_order integer;
  mapped_offset_days integer;
  mapped_recurring text;
  mapped_recurring_day integer;
  mapped_recurring_weekday integer;
  mapped_recurring_month integer;
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
  mapped_recurring := case
    when req.frequency_type in ('daily','weekly','monthly','quarterly','yearly')
      then req.frequency_type
    else null
  end;
  mapped_recurring_day := case
    when mapped_recurring in ('monthly','quarterly','yearly')
      and coalesce(req.frequency_config ->> 'day', '') ~ '^[0-9]+$'
      and (req.frequency_config ->> 'day')::integer between 1 and 31
      then (req.frequency_config ->> 'day')::integer
    else null
  end;
  mapped_recurring_weekday := case
    when mapped_recurring = 'weekly'
      and coalesce(req.frequency_config ->> 'weekday', '') ~ '^[0-9]+$'
      and (req.frequency_config ->> 'weekday')::integer between 1 and 7
      then (req.frequency_config ->> 'weekday')::integer
    else null
  end;
  mapped_recurring_month := case
    when mapped_recurring = 'quarterly'
      and coalesce(req.frequency_config ->> 'month', '') ~ '^[0-9]+$'
      and (req.frequency_config ->> 'month')::integer between 1 and 3
      then (req.frequency_config ->> 'month')::integer
    when mapped_recurring = 'yearly'
      and coalesce(req.frequency_config ->> 'month', '') ~ '^[0-9]+$'
      and (req.frequency_config ->> 'month')::integer between 1 and 12
      then (req.frequency_config ->> 'month')::integer
    else null
  end;
  select coalesce(max(sort_order), -1) + 1 into next_sort_order
  from public.contract_obligations where project_id = req.project_id;

  insert into public.contract_obligations (
    id, project_id, title, category, trigger_event,
    offset_days, offset_dir, fixed_date,
    recurring, recurring_day, recurring_weekday, recurring_month,
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
    mapped_recurring,
    mapped_recurring_day,
    mapped_recurring_weekday,
    mapped_recurring_month,
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
    recurring_weekday = excluded.recurring_weekday,
    recurring_month = excluded.recurring_month,
    responsible = excluded.responsible
  returning id into obligation_id;

  return obligation_id;
end; $$;
revoke all on function public.materialize_deadline_obligation(uuid)
  from public, anon, authenticated;
comment on function public.materialize_deadline_obligation(uuid) is
  'D-012 internal deterministic adapter: approved deadline Requirement -> one obligation runtime row';

-- Restore the D-019 auto-confirm with its deadline-only materialization guard.
create or replace function public.apply_transcription_triage(p_run uuid)
returns table (auto_confirmed int, flagged int)
language plpgsql security definer set search_path = public as $$
declare
  req record;
  doubts text[];
  n_auto int := 0;
  n_flag int := 0;
begin
  if not exists (
    select 1 from public.document_ingestion_runs r
    where r.id = p_run and r.status = 'completed'
  ) then
    raise exception '轉錄分流只能套用在已完成的抽取 run';
  end if;

  for req in
    select * from public.requirements
    where ingestion_run_id = p_run
      and origin = 'ai'
      and status in ('draft_ai', 'needs_review')
  loop
    doubts := public.transcription_doubts(req.id);
    update public.requirements
       set status = 'approved', reviewed_by = null, reviewed_at = now(),
           triage_doubts = doubts
     where id = req.id;
    if req.requirement_type = 'deadline' then
      perform public.materialize_deadline_obligation(req.id);
    end if;
    n_auto := n_auto + 1;
    if coalesce(array_length(doubts, 1), 0) > 0 then n_flag := n_flag + 1; end if;
  end loop;
  return query select n_auto, n_flag;
end; $$;

-- Restore the W5-2 review action with its deadline-only guards.
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
    update public.contract_obligations
    set status = '不適用'
    where requirement_id = req.id and status = '待辦';
  end if;

  perform set_config('pmis.requirement_review', '', true);
  return req;
end; $$;
revoke all on function public.review_requirement(uuid, text) from public, anon;
grant execute on function public.review_requirement(uuid, text) to authenticated;

drop function if exists public.materialize_requirement_obligation(uuid);

-- Data down: remove pristine non-deadline runtime rows; retire operated ones.
delete from public.contract_obligations o
using public.requirements r
where o.requirement_id = r.id
  and r.requirement_type <> 'deadline'
  and o.status = '待辦'
  and o.evidence_submittal_id is null
  and o.completed_at is null;

update public.contract_obligations o
set status = '不適用'
from public.requirements r
where o.requirement_id = r.id
  and r.requirement_type <> 'deadline'
  and o.status not in ('不適用');

commit;
