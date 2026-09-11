-- Roll back 20260911100000 (demo_requests 表級權限收回) to the state the baseline
-- default privileges (20260712001200) produced at table creation.
-- Run through SQL Editor / psql as database owner in one transaction.
-- Data policy: no rows are touched in either direction.
-- Note: restoring these grants re-opens the second defence layer only; RLS with
-- zero policies still blocks anon/authenticated at row level. Nothing in the
-- product depends on these grants (the only writer is the service-role
-- demo-request Edge Function), so this down file exists purely for exact
-- reversibility, not because any feature needs it.
begin;

grant select, insert, update, delete, references, trigger, truncate
  on public.demo_requests to authenticated;
grant references, trigger, truncate on public.demo_requests to anon;

do $$
declare seq text := pg_get_serial_sequence('public.demo_requests', 'id');
begin
  if seq is not null then
    execute format('grant update on sequence %s to anon, authenticated', seq);
  end if;
end $$;

commit;
