-- Roll back 20260917120000 (P4a: pure calculation layer for supervisor-confirmed
-- quantities and valuation caps). The migration only added 14 functions and 2
-- composite types; it touched no table, trigger, policy or row, so this rollback
-- drops those objects and nothing else. Run through SQL Editor / psql as owner.
-- Data policy: nothing to restore.
-- Caveat: once P4b lands (tables, guards and RPCs that call these functions),
-- rolling this back must happen after P4b's own rollback, otherwise the drops
-- fail on dependencies (this file drops without CASCADE on purpose).
-- Also remove supabase/tests/confirmed_quantity_calc.sql, otherwise pgTAP goes red.
begin;

drop function if exists public.fn_pricing_basis_effective(text, numeric, text);
drop function if exists public.fn_allocate_fifo(public.cq_confirmation[], text[], text, timestamptz, public.cq_allocation[], numeric);
drop function if exists public.fn_batch_allocation_check(public.cq_confirmation[], text[], text, public.cq_allocation[]);
drop function if exists public.fn_valuation_amount(numeric, numeric);
drop function if exists public.fn_period_increment(numeric, numeric, numeric);
drop function if exists public.fn_cap(numeric, numeric, numeric, text);
drop function if exists public.fn_effective_confirmed(public.cq_confirmation[], text[], text, timestamptz, numeric);
drop function if exists public.fn_effective_by_batch(public.cq_confirmation[], text[], text, timestamptz);
drop function if exists public.fn_contract_qty(numeric, numeric[]);
drop function if exists public.fn_cq_as_of(date);
drop function if exists public.fn_cq_qty(numeric, text, boolean);
drop function if exists public.fn_cq_check_unit(text, text);
drop function if exists public.fn_cq_batch_key(text);
drop function if exists public.fn_cq_normalize_text(text);

drop type if exists public.cq_allocation;
drop type if exists public.cq_confirmation;

commit;
