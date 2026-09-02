-- Roll back 20260825120000 (義務動作只看歸屬 + 完成時間戳).
-- Run through SQL Editor / psql as database owner in one transaction.
-- Restores the contract_obligations UPDATE policy to the 20260824000900 (D-018)
-- shape: can_write + requirement visibility; removes the ownership helpers,
-- the completion-stamp trigger and the two timestamp columns.
-- Data policy: completed_at / completed_by are dropped with the columns —
-- the frontend already treats a missing completed_at as "on time", so the
-- only loss is the audit detail of who marked what and when. Status values
-- themselves are untouched.
-- Pair with: the D-020 down (20260901040000) must run BEFORE this file if
-- both are being rolled back; this file does not touch the materializer.
begin;

drop trigger if exists contract_obligations_stamp_completion on public.contract_obligations;
drop function if exists public.stamp_obligation_completion();

alter table public.contract_obligations
  drop column if exists completed_by,
  drop column if exists completed_at;

drop policy if exists "contract_obligations_update" on public.contract_obligations;
create policy "contract_obligations_update" on public.contract_obligations
  for update to authenticated
  using (public.can_write(project_id)
    and (requirement_id is null or public.can_read_requirement_row(requirement_id)))
  with check (public.can_write(project_id));

-- Helpers were introduced by the same migration and have no other callers
-- (pgTAP obligation_ownership_completed_at.sql is the only reader).
drop function if exists public.obligation_party(text);
drop function if exists public.my_party();

commit;
