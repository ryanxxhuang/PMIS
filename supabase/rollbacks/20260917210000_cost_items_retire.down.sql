-- Roll back 20260917210000 (cost_items write retirement, D-026 P1b): re-grant
-- INSERT/UPDATE/DELETE to authenticated and restore the original `for all`
-- policy from 20260711000000_baseline.sql. Run through SQL Editor / psql as
-- database owner.
-- Data policy: no rows, indexes or columns were touched by the forward
-- migration, so nothing needs restoring beyond privileges and the policy.
-- Caveat: re-opening writes without the frontend CRUD (removed in the same PR)
-- only re-enables direct REST / old-client writes; also revert Cost.jsx and
-- store/slices/ledger.js if the cost workspace itself is to come back.
begin;

grant insert, update, delete on public.cost_items to authenticated;

drop policy if exists "cost_items_contractor_read" on public.cost_items;
create policy "cost_items_contractor_only" on public.cost_items for all to authenticated
  using (public.can_access_contractor_private(project_id))
  with check (public.can_access_contractor_private(project_id));

commit;
