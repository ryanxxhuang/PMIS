-- Roll back 20260919021500 (P5c: project_anchor_versions 基準日版本、期次界限日、單次義務到期快照).
-- Run through SQL Editor / psql as database owner in one transaction.
-- Drops the acceptance/projects/obligation triggers and helpers added by P5c, the RPC
-- update_project_anchors, the two snapshot columns on contract_obligations, and the
-- project_anchor_versions table; restores the P5b materialize function (unbounded, no
-- version stamp) and the P5b projects trigger (materialize-only on anchor change).
-- Data policy: every version row (who changed which anchor when, reason/source_ref, effects)
-- is removed with the table — export it first; obligation_periods.anchor_version_no is set
-- back to null; due_date_snapshot/anchor_version_no on contract_obligations are dropped
-- (completed single obligations fall back to live computation from current anchors).
-- Periods removed by the recurrence bound are NOT restored here; the restored P5b
-- materialize re-creates untouched future periods on the next trigger / pg_cron run.
-- Also remove supabase/tests/project_anchor_versions.sql and take update_project_anchors
-- out of the allow list in supabase/tests/anon_and_function_privileges.sql, otherwise pgTAP goes red.
begin;

drop trigger if exists acceptance_events_obligation_periods_sync on public.acceptance_events;
drop function if exists public.acceptance_events_obligation_periods_sync();

drop trigger if exists contract_obligations_due_snapshot on public.contract_obligations;
drop function if exists public.stamp_obligation_due_snapshot();
alter table public.contract_obligations
  drop column if exists due_date_snapshot,
  drop column if exists anchor_version_no;

drop function if exists public.update_project_anchors(uuid, jsonb, text, text, text, uuid, date);

drop trigger if exists projects_anchor_versions_sync on public.projects;
drop function if exists public.projects_anchor_versions_sync();
drop function if exists public.fn_record_project_anchor_version(uuid, jsonb, jsonb, text, text, text, uuid, date, date);
drop function if exists public.fn_recompute_obligations_for_anchor_version(uuid, integer, jsonb, jsonb, date);
drop function if exists public.fn_apply_obligation_recurrence_bound(uuid);

-- P5b materialize (20260917233000) restored verbatim: no bound, no version stamp.
create or replace function public.fn_materialize_obligation_periods_for(
  p_obligation uuid, p_today date default null, p_lookahead_days integer default 31
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ob record;
  anchor_key text;
  anchor date;
  today date := coalesce(p_today, public.fn_taipei_today());
  inserted integer := 0;
begin
  select o.id, o.project_id, o.status, o.recurring, o.recurring_day, o.recurring_weekday, o.recurring_month,
         o.trigger_event, o.fixed_date,
         p.award_date, p.notice_date, p.commencement_date, p.end_date
    into ob
  from public.contract_obligations o
  join public.projects p on p.id = o.project_id
  where o.id = p_obligation;
  if not found or ob.status = '不適用'
     or ob.recurring is null or ob.recurring not in ('daily','weekly','monthly','quarterly','yearly')
     or public.fn_obligation_recurrence_gap(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, ob.trigger_event, ob.fixed_date) is not null then
    return 0;
  end if;
  anchor_key := public.fn_obligation_recurrence_anchor_key(ob.trigger_event);
  anchor := case anchor_key
    when 'award_date' then ob.award_date
    when 'notice_date' then ob.notice_date
    when 'commencement_date' then ob.commencement_date
    when 'end_date' then ob.end_date
    when 'fixed_date' then ob.fixed_date
    else null end;
  if anchor is null then
    return 0;
  end if;
  insert into public.obligation_periods (project_id, obligation_id, period_key, period_start, period_end, due_date, basis)
  select ob.project_id, ob.id, s.period_key, s.period_start, s.period_end, s.due_date,
         jsonb_build_object(
           'version', 1, 'recurring', ob.recurring, 'recurring_day', ob.recurring_day,
           'recurring_weekday', ob.recurring_weekday, 'recurring_month', ob.recurring_month,
           'anchor_key', anchor_key, 'anchor_date', anchor, 'materialized_on', today, 'lookahead_days', p_lookahead_days)
  from public.fn_obligation_period_schedule(ob.recurring, ob.recurring_day, ob.recurring_weekday, ob.recurring_month, anchor, today, p_lookahead_days) s
  on conflict (obligation_id, period_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end; $$;
revoke all on function public.fn_materialize_obligation_periods_for(uuid, date, integer) from public, anon, authenticated;

-- P5b projects trigger restored verbatim.
create or replace function public.projects_obligation_periods_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if row(old.award_date, old.notice_date, old.commencement_date, old.end_date)
     is distinct from row(new.award_date, new.notice_date, new.commencement_date, new.end_date) then
    perform public.fn_materialize_obligation_periods(new.id);
  end if;
  return null;
end $$;
revoke all on function public.projects_obligation_periods_sync() from public, anon, authenticated;
drop trigger if exists projects_obligation_periods_sync on public.projects;
create trigger projects_obligation_periods_sync
  after update of award_date, notice_date, commencement_date, end_date on public.projects
  for each row execute function public.projects_obligation_periods_sync();

update public.obligation_periods set anchor_version_no = null where anchor_version_no is not null;

drop function if exists public.fn_obligation_recurrence_stop_gap(text, date, date, date);
drop function if exists public.fn_obligation_recurrence_bound(text, date, date);
drop function if exists public.fn_project_completion_date(uuid);
drop function if exists public.fn_obligation_single_anchor_key(text);
drop function if exists public.fn_obligation_single_due(text, integer, text, date, date, date, date, date);
drop function if exists public.fn_anchors_json(date, date, date, date);

drop trigger if exists project_anchor_versions_guard on public.project_anchor_versions;
drop function if exists public.project_anchor_versions_guard();
drop table if exists public.project_anchor_versions;

commit;
