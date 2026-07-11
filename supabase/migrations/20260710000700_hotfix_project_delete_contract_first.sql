-- Production hotfix: authorized whole-project deletion is a technical action
-- distinct from contractual row authority. Contract-first frontend behavior
-- is shipped in the application; this migration repairs only DB boundaries.

-- -- HOTFIX project delete context ------------------------------------------
create or replace function public.is_project_delete_context(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_project is not null
    and coalesce(current_setting('pmis.project_delete_id', true), '') = p_project::text
$$;
revoke all on function public.is_project_delete_context(uuid)
  from public, anon;
grant execute on function public.is_project_delete_context(uuid) to authenticated;

create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.can_manage_project_identity(p_id) then
    raise exception '只有專案技術管理者可以刪除專案';
  end if;
  perform 1 from public.projects where id = p_id for update;
  if not found then raise exception '找不到要刪除的專案'; end if;
  perform set_config('pmis.project_delete_id', p_id::text, true);
  delete from public.projects where id = p_id;
  perform set_config('pmis.project_delete_id', '', true);
end; $$;
revoke all on function public.delete_project(uuid) from public, anon;
grant execute on function public.delete_project(uuid) to authenticated;

-- Split protected multi-event triggers. INSERT/UPDATE behavior is unchanged;
-- DELETE invokes the existing guard unless the exact project context matches.
drop trigger if exists project_memberships_last_admin_guard on public.project_memberships;
create trigger project_memberships_last_admin_guard
  before update on public.project_memberships for each row
  execute function public.guard_last_project_admin();
drop trigger if exists project_memberships_last_admin_delete_guard on public.project_memberships;
create trigger project_memberships_last_admin_delete_guard
  before delete on public.project_memberships for each row
  when (not public.is_project_delete_context(old.project_id))
  execute function public.guard_last_project_admin();

drop trigger if exists project_parties_lifecycle_guard on public.project_parties;
create trigger project_parties_lifecycle_guard
  before update on public.project_parties for each row
  execute function public.guard_project_party_lifecycle();
drop trigger if exists project_parties_lifecycle_delete_guard on public.project_parties;
create trigger project_parties_lifecycle_delete_guard
  before delete on public.project_parties for each row
  when (not public.is_project_delete_context(old.project_id))
  execute function public.guard_project_party_lifecycle();

drop trigger if exists valuations_guard on public.valuations;
create trigger valuations_guard before insert or update on public.valuations
  for each row execute function public.valuations_guard();
drop trigger if exists valuations_delete_guard on public.valuations;
create trigger valuations_delete_guard before delete on public.valuations
  for each row when (not public.is_project_delete_context(old.project_id))
  execute function public.valuations_guard();

drop trigger if exists inspections_guard on public.inspections;
create trigger inspections_guard before insert or update on public.inspections
  for each row execute function public.inspections_guard();
drop trigger if exists inspections_delete_guard on public.inspections;
create trigger inspections_delete_guard before delete on public.inspections
  for each row when (not public.is_project_delete_context(old.project_id))
  execute function public.inspections_guard();

drop trigger if exists submittals_guard on public.submittals;
create trigger submittals_guard before insert or update on public.submittals
  for each row execute function public.submittals_guard();
drop trigger if exists submittals_delete_guard on public.submittals;
create trigger submittals_delete_guard before delete on public.submittals
  for each row when (not public.is_project_delete_context(old.project_id))
  execute function public.submittals_guard();

drop trigger if exists rfis_guard on public.rfis;
create trigger rfis_guard before insert or update on public.rfis
  for each row execute function public.rfis_guard();
drop trigger if exists rfis_delete_guard on public.rfis;
create trigger rfis_delete_guard before delete on public.rfis
  for each row when (not public.is_project_delete_context(old.project_id))
  execute function public.rfis_guard();

drop trigger if exists change_orders_guard on public.change_orders;
create trigger change_orders_guard before insert or update on public.change_orders
  for each row execute function public.change_orders_guard();
drop trigger if exists change_orders_delete_guard on public.change_orders;
create trigger change_orders_delete_guard before delete on public.change_orders
  for each row when (not public.is_project_delete_context(old.project_id))
  execute function public.change_orders_guard();

drop trigger if exists requirements_snapshot_guard on public.requirements;
create trigger requirements_snapshot_guard before insert or update on public.requirements
  for each row execute function public.requirements_snapshot_guard();
drop trigger if exists requirements_snapshot_delete_guard on public.requirements;
create trigger requirements_snapshot_delete_guard before delete on public.requirements
  for each row when (not public.is_project_delete_context(old.project_id))
  execute function public.requirements_snapshot_guard();

drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable before update on public.audit_events
  for each row execute function public.guard_audit_event_immutability();
drop trigger if exists audit_events_immutable_delete_guard on public.audit_events;
create trigger audit_events_immutable_delete_guard before delete on public.audit_events
  for each row when (not public.is_project_delete_context(old.project_id))
  execute function public.guard_audit_event_immutability();

drop trigger if exists document_ingestion_runs_system_managed on public.document_ingestion_runs;
create trigger document_ingestion_runs_system_managed
  before insert or update on public.document_ingestion_runs
  for each row execute function public.guard_ingestion_run_write();
drop trigger if exists document_ingestion_runs_system_managed_delete_guard on public.document_ingestion_runs;
create trigger document_ingestion_runs_system_managed_delete_guard
  before delete on public.document_ingestion_runs for each row
  when (not public.is_project_delete_context(old.project_id))
  execute function public.guard_ingestion_run_write();

-- Existing valuation-item, change-order-item, and Requirement-source guards
-- already pass parent-originated cascades only after their protected parent is
-- absent. Their direct DELETE protections remain untouched.

-- Repair only deterministically resolvable P0-02 legacy memberships. The
-- unresolved party, viewer role, legacy membership, profile org_type, and
-- matching seeded migration_key must all agree. is_project_admin is preserved.
update public.project_memberships m
set project_party_id = target.id,
    project_role = case profile.org_type
      when 'owner' then 'agency_engineer'
      when 'supervisor' then 'supervisor_engineer'
      when 'contractor' then 'contractor_pm'
    end
from public.project_parties unresolved,
     public.project_members legacy,
     public.profiles profile,
     public.project_parties target
where m.project_party_id = unresolved.id
  and unresolved.project_id = m.project_id
  and unresolved.party_type = 'other'
  and unresolved.migration_key = 'legacy:unresolved'
  and m.project_role = 'viewer'
  and legacy.project_id = m.project_id
  and legacy.user_id = m.user_id
  and profile.id = m.user_id
  and profile.org_type in ('owner','supervisor','contractor')
  and target.project_id = m.project_id
  and target.is_active
  and target.migration_key = case profile.org_type
    when 'owner' then 'legacy:agency'
    when 'supervisor' then 'legacy:supervisor'
    when 'contractor' then 'legacy:contractor'
  end
  and target.party_type = case profile.org_type
    when 'owner' then 'agency'
    when 'supervisor' then 'supervisor'
    when 'contractor' then 'contractor'
  end;
-- -- End HOTFIX project delete context --------------------------------------
