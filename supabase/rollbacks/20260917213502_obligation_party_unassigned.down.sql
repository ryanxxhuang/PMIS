-- Roll back 20260917213502 (責任不明的契約義務不歸任何一方).
-- Run through SQL Editor / psql as database owner in one transaction.
-- Restores obligation_party() to the 20260825120000 shape: any value outside
-- 廠商／監造／機關 (null, empty, 其他, free text) falls back to 廠商, so the
-- contract_obligations UPDATE policy again lets the contractor side mark such rows.
-- Data policy: no rows are touched by either direction. The policy itself is
-- unchanged by the forward migration, so nothing else needs restoring.
-- Pair with: the frontend/shared rule (ballInCourtRules.obligationSide) will still
-- show "待補設定" until the code is reverted as well; the DB fallback only widens
-- who may write, it does not change what the UI derives.
begin;

create or replace function public.obligation_party(r text)
returns text language sql immutable as $$
  select case when r in ('廠商','監造','機關') then r else '廠商' end;
$$;

comment on function public.obligation_party(text) is null;

commit;
