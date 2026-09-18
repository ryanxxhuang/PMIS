-- Roll back 20260917233000 (P5b: obligation_periods 循環義務逐期追蹤).
-- Run through SQL Editor / psql as database owner in one transaction.
-- Drops the daily pg_cron job, the two sync triggers on contract_obligations / projects,
-- the recurring-status guard, the RPCs (materialize / transition), the pure helpers and
-- the obligation_periods table. contract_obligations rows are untouched by both directions.
-- Data policy: every period row (status, completed_at/by, evidence links, review_note) is
-- removed with the table — export them first; they are the per-period execution record.
-- After rollback, recurring obligations fall back to the pre-P5b single status and the
-- frontend / Edge (which read ob.periods) show recurring items as 無到期日 until the code
-- is reverted as well. The pg_cron extension itself is left installed (pmis-daily-reminders uses it).
-- Also remove supabase/tests/obligation_periods.sql, otherwise pgTAP goes red.
begin;

do $$
begin
  perform cron.unschedule('pmis-obligation-periods');
exception when others then null;
end $$;

drop trigger if exists projects_obligation_periods_sync on public.projects;
drop function if exists public.projects_obligation_periods_sync();
drop trigger if exists contract_obligations_periods_sync on public.contract_obligations;
drop function if exists public.obligation_periods_sync();
drop trigger if exists contract_obligations_recurring_guard on public.contract_obligations;
drop function if exists public.obligation_recurring_status_guard();

drop function if exists public.fn_backfill_obligation_period_completion(uuid, date);
drop function if exists public.transition_obligation_period(uuid, text, uuid, uuid);
drop function if exists public.materialize_all_obligation_periods(date);
drop function if exists public.materialize_obligation_periods(uuid);
drop function if exists public.fn_materialize_obligation_periods(uuid, date, integer);
drop function if exists public.fn_materialize_obligation_periods_for(uuid, date, integer);

drop table if exists public.obligation_periods;

drop function if exists public.fn_taipei_today();
drop function if exists public.fn_obligation_period_schedule(text, integer, integer, integer, date, date, integer);
drop function if exists public.fn_period_due(text, integer, integer, integer, date);
drop function if exists public.fn_clamped_day_of_month(date, integer);
drop function if exists public.fn_period_key(text, date);
drop function if exists public.fn_next_period_start(text, date);
drop function if exists public.fn_period_end(text, date);
drop function if exists public.fn_period_start(text, date);
drop function if exists public.fn_obligation_recurrence_anchor_key(text);
drop function if exists public.fn_obligation_recurrence_gap(text, integer, integer, integer, text, date);

commit;
