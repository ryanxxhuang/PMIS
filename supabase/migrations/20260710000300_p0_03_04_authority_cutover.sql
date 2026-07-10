-- P0-03 / P0-04 - Contractual authority cutover
--
-- Idempotent migration. Project-scoped identity (project_parties.party_type +
-- project_memberships.project_role) becomes the only source of contractual
-- workflow authority. Technical administration (is_project_admin) authorizes
-- identity/project administration only and never grants business approval
-- authority. profiles.org_type and project_members remain for compatibility
-- and read access, but no longer grant any contractual authority.
--
-- Matching definitions live in supabase/schema.sql ("P0-03/P0-04" section).

-- -- P0-03 §1: project party lifecycle ---------------------------------------
-- Parties are deactivated, never hard-deleted by application users. Approved
-- Requirements keep referencing inactive historical parties for traceability.
alter table public.project_parties
  add column if not exists is_active boolean not null default true;

-- Authority resolution ignores memberships whose party has been deactivated:
-- unresolved or retired identity fails closed.
create or replace function public.my_project_membership(p_project uuid)
returns table (
  membership_id uuid,
  project_id uuid,
  user_id uuid,
  project_party_id uuid,
  party_type text,
  project_role text,
  is_project_admin boolean
) language sql security definer stable set search_path = public as $$
  select m.id, m.project_id, m.user_id, m.project_party_id,
         pp.party_type, m.project_role, m.is_project_admin
  from public.project_memberships m
  join public.project_parties pp on pp.id = m.project_party_id
  where m.project_id = p_project and m.user_id = auth.uid()
    and pp.is_active
  limit 1
$$;

-- -- P0-03 §2: role-party compatibility --------------------------------------
-- A membership may only combine a project role with a party type that can
-- legitimately hold it. Unknown roles fall through to the column CHECK
-- constraint so vocabulary violations keep their 23514 error class.
create or replace function public.role_allowed_for_party(p_party_type text, p_role text)
returns boolean language sql immutable as $$
  select case p_party_type
    when 'agency' then p_role in
      ('agency_pm','agency_engineer','document_controller','viewer')
    when 'contractor' then p_role in
      ('contractor_pm','site_manager','quality_engineer','safety_engineer',
       'document_controller','viewer')
    when 'supervisor' then p_role in
      ('supervisor_manager','supervisor_engineer','document_controller','viewer')
    -- designer / consultant / other hold no contractual workflow authority.
    else p_role in ('document_controller','viewer')
  end
$$;

create or replace function public.is_known_project_role(p_role text)
returns boolean language sql immutable as $$
  select p_role in (
    'agency_pm','agency_engineer',
    'contractor_pm','site_manager','quality_engineer','safety_engineer',
    'supervisor_manager','supervisor_engineer',
    'document_controller','viewer'
  )
$$;

-- Extends the P0-02 same-project rule with party activity and role-party
-- compatibility. These are data-integrity invariants: they hold for every
-- writer, including service-role backends.
create or replace function public.validate_membership_project_party()
returns trigger language plpgsql set search_path = public as $$
declare party record;
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'project membership user identity is immutable';
    end if;
    if auth.uid() = old.user_id and (
      new.project_party_id is distinct from old.project_party_id
      or new.project_role is distinct from old.project_role
    ) then
      raise exception 'project members cannot change their own contractual identity';
    end if;
  end if;
  select pp.project_id, pp.party_type, pp.is_active into party
  from public.project_parties pp where pp.id = new.project_party_id;
  if party.project_id is null or party.project_id <> new.project_id then
    raise exception 'project membership and project party must belong to the same project';
  end if;
  if (tg_op = 'INSERT' or new.project_party_id is distinct from old.project_party_id)
     and not party.is_active then
    raise exception 'project membership requires an active project party';
  end if;
  if public.is_known_project_role(new.project_role)
     and not public.role_allowed_for_party(party.party_type, new.project_role) then
    raise exception 'project role % is not allowed for party type %',
      new.project_role, party.party_type;
  end if;
  return new;
end; $$;

-- -- P0-03 §3: identity administration integrity -----------------------------
-- A project that uses the v2 membership model must never lose its last
-- technical admin through an application-user update or delete. Project-level
-- cascades (deleting the project itself) are exempt.
create or replace function public.guard_last_project_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if not old.is_project_admin then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.is_project_admin then return new; end if;
  -- Serialize admin removal/demotion per project so concurrent transactions
  -- cannot each observe the other admin and jointly leave zero admins.
  perform 1 from public.projects where id = old.project_id for update;
  if not found then
    return coalesce(new, old); -- project row already deleted: cascade in progress
  end if;
  if not exists (
    select 1 from public.project_memberships m
    where m.project_id = old.project_id and m.id <> old.id and m.is_project_admin
  ) then
    raise exception 'a project must keep at least one technical project admin';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists project_memberships_last_admin_guard on public.project_memberships;
create trigger project_memberships_last_admin_guard
  before update or delete on public.project_memberships for each row
  execute function public.guard_last_project_admin();

-- Party lifecycle guard:
-- * party_type changes must keep every attached membership role-compatible;
-- * deactivation requires the party to have no memberships (reassign first);
-- * application users never hard-delete a party. Hard deletion is a
--   service-role operation, and even then a party that still has memberships
--   or is referenced by an authoritative Requirement snapshot is protected
--   for any authenticated actor.
create or replace function public.guard_project_party_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then
      if exists (select 1 from public.project_memberships m
                 where m.project_party_id = old.id) then
        raise exception 'a project party with memberships cannot be deleted; deactivate it instead';
      end if;
      if exists (select 1 from public.requirements r
                 where r.responsible_project_party_id = old.id
                   and r.status in ('approved','superseded')) then
        raise exception 'a project party referenced by an authoritative requirement cannot be deleted; deactivate it instead';
      end if;
    end if;
    return old;
  end if;
  if new.party_type is distinct from old.party_type and exists (
    select 1 from public.project_memberships m
    where m.project_party_id = old.id
      and public.is_known_project_role(m.project_role)
      and not public.role_allowed_for_party(new.party_type, m.project_role)
  ) then
    raise exception 'party type change would leave incompatible membership roles';
  end if;
  if old.is_active and not new.is_active and exists (
    select 1 from public.project_memberships m where m.project_party_id = old.id
  ) then
    raise exception 'a project party with memberships cannot be deactivated; reassign members first';
  end if;
  return new;
end; $$;
drop trigger if exists project_parties_lifecycle_guard on public.project_parties;
create trigger project_parties_lifecycle_guard
  before update or delete on public.project_parties for each row
  execute function public.guard_project_party_lifecycle();

-- Application users deactivate parties; they never delete them.
drop policy if exists "project_parties_delete" on public.project_parties;

-- -- P0-03 §4: read boundary --------------------------------------------------
-- Row visibility ("who can see this project's rows") accepts either membership
-- model while both exist. Contractual authority below accepts only the v2
-- project-scoped identity and fails closed without it.
create or replace function public.my_project_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select project_id from public.project_members where user_id = auth.uid()
  union
  select project_id from public.project_memberships where user_id = auth.uid()
$$;

create or replace function public.is_project_member(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p and m.user_id = auth.uid()
  ) or exists (
    select 1 from public.project_memberships m
    where m.project_id = p and m.user_id = auth.uid()
  )
$$;

-- -- P0-03 §5: explicit contractual permission functions ----------------------
-- permission = party_type × project_role × workflow_action (× workflow_state,
-- enforced by the transition guards further below). No is_project_admin
-- bypass. No profiles.org_type input. Missing membership => false.
create or replace function public.has_project_authority(
  p_project uuid, p_party_types text[], p_roles text[]
) returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select m.party_type = any(p_party_types) and m.project_role = any(p_roles)
    from public.my_project_membership(p_project) m
  ), false)
$$;
revoke all on function public.has_project_authority(uuid, text[], text[])
  from public, anon, authenticated;

-- Technical identity/project administration (not contractual authority).
create or replace function public.can_manage_project_identity(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_project_admin_v2(p)
$$;

-- Contractor execution -------------------------------------------------------
create or replace function public.can_manage_boq(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'], array['contractor_pm'])
$$;
create or replace function public.can_manage_daily_logs(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'],
    array['contractor_pm','site_manager','quality_engineer'])
$$;
create or replace function public.can_manage_safety_records(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'],
    array['contractor_pm','site_manager','safety_engineer'])
$$;
create or replace function public.can_manage_quality_execution(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'],
    array['contractor_pm','quality_engineer'])
$$;
create or replace function public.can_submit_inspection(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'],
    array['contractor_pm','site_manager','quality_engineer'])
$$;
create or replace function public.can_submit_valuation(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'], array['contractor_pm'])
$$;
create or replace function public.can_manage_contractor_private(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'], array['contractor_pm'])
$$;
create or replace function public.can_create_submittal(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'],
    array['contractor_pm','site_manager','document_controller'])
$$;
create or replace function public.can_create_rfi(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'],
    array['contractor_pm','site_manager'])
$$;
create or replace function public.can_manage_defect_remediation(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'],
    array['contractor_pm','site_manager','quality_engineer'])
$$;
create or replace function public.can_manage_progress_plan(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'],
    array['contractor_pm','site_manager'])
$$;
create or replace function public.can_manage_contract_obligations(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'], array['contractor_pm'])
$$;
create or replace function public.can_manage_change_orders(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'], array['contractor_pm'])
$$;

-- Supervisor assurance ---------------------------------------------------------
create or replace function public.can_decide_inspection(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
$$;
create or replace function public.can_review_valuation(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
$$;
create or replace function public.can_review_submittal(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
$$;
create or replace function public.can_answer_rfi(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
$$;
create or replace function public.can_close_defect(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
$$;
create or replace function public.can_manage_itp(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
$$;
create or replace function public.can_review_change_order(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
$$;

-- Agency governance ------------------------------------------------------------
create or replace function public.can_ratify_change_order(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['agency'], array['agency_pm'])
$$;
-- 請款(廠商 contractor_pm)/撥款(機關 agency_pm)三欄。agency_engineer 依最小
-- 授權原則不含撥款登錄;差異記錄於 contractual-authority-model.md。
create or replace function public.can_update_payment_fields(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['agency'], array['agency_pm'])
      or public.has_project_authority(p, array['contractor'], array['contractor_pm'])
$$;
create or replace function public.can_review_requirement(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['agency'],
    array['agency_pm','agency_engineer'])
      or public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
$$;

-- Shared / mixed ---------------------------------------------------------------
create or replace function public.can_open_defect(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
      or public.has_project_authority(p, array['contractor'],
    array['contractor_pm','quality_engineer'])
$$;
create or replace function public.can_manage_observations(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
      or public.has_project_authority(p, array['contractor'],
    array['contractor_pm','site_manager','quality_engineer'])
$$;
create or replace function public.can_manage_field_media(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_project_authority(p, array['contractor'],
    array['contractor_pm','site_manager','quality_engineer','safety_engineer'])
      or public.has_project_authority(p, array['supervisor'],
    array['supervisor_manager','supervisor_engineer'])
$$;
create or replace function public.can_manage_documents(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select m.project_role = 'document_controller'
        or (m.party_type = 'contractor' and m.project_role = 'contractor_pm')
        or (m.party_type = 'agency' and m.project_role = 'agency_pm')
        or (m.party_type = 'supervisor' and m.project_role = 'supervisor_manager')
    from public.my_project_membership(p) m
  ), false)
$$;

-- Acceptance stage authority (vocabulary from src/lib/acceptance.js):
--   report      竣工申報(報竣)        contractor_pm
--   confirm     竣工確認會勘           agency roles or supervisor roles(機關+監造)
--   initial     初驗                   agency roles
--   fix         缺失改善               contractor_pm / quality_engineer
--   reinspect   複驗                   agency roles
--   final       正式驗收               agency roles
--   certificate 結算驗收證明書         agency roles
--   warranty    保固起算               agency roles(行政登錄)
create or replace function public.can_record_acceptance_stage(p uuid, p_stage text)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select case
      when p_stage = 'report' then
        m.party_type = 'contractor' and m.project_role = 'contractor_pm'
      when p_stage = 'fix' then
        m.party_type = 'contractor'
        and m.project_role in ('contractor_pm','quality_engineer')
      when p_stage = 'confirm' then
        (m.party_type = 'agency'
          and m.project_role in ('agency_pm','agency_engineer'))
        or (m.party_type = 'supervisor'
          and m.project_role in ('supervisor_manager','supervisor_engineer'))
      when p_stage in ('initial','reinspect','final','certificate','warranty') then
        m.party_type = 'agency' and m.project_role in ('agency_pm','agency_engineer')
      else false
    end
    from public.my_project_membership(p) m
  ), false)
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'can_manage_project_identity','can_manage_boq','can_manage_daily_logs',
    'can_manage_safety_records','can_manage_quality_execution',
    'can_submit_inspection','can_submit_valuation','can_manage_contractor_private',
    'can_create_submittal','can_create_rfi','can_manage_defect_remediation',
    'can_manage_progress_plan','can_manage_contract_obligations',
    'can_manage_change_orders','can_decide_inspection','can_review_valuation',
    'can_review_submittal','can_answer_rfi','can_close_defect','can_manage_itp',
    'can_review_change_order','can_ratify_change_order','can_update_payment_fields',
    'can_review_requirement','can_open_defect','can_manage_observations',
    'can_manage_field_media','can_manage_documents'
  ] loop
    execute format('revoke all on function public.%I(uuid) from public, anon', fn);
    execute format('grant execute on function public.%I(uuid) to authenticated', fn);
  end loop;
  revoke all on function public.can_record_acceptance_stage(uuid, text) from public, anon;
  grant execute on function public.can_record_acceptance_stage(uuid, text) to authenticated;
end $$;

-- Legacy helpers are no longer an authority source. can_write() fails closed;
-- can_access_contractor_private() delegates to the project-scoped rule (no
-- admin bypass). my_org_type()/is_project_admin() remain only as legacy reads.
create or replace function public.can_write(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select false -- P0-03: deprecated; use the explicit permission functions.
$$;
create or replace function public.can_access_contractor_private(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_contractor_private(p)
$$;

-- -- P0-03 §6: project identity immutability for workflow rows ----------------
-- Rows that hang off a project cannot migrate between projects; reuse the
-- P0-01 guard on every project-scoped business table.
do $$
declare t text;
begin
  foreach t in array array[
    'valuations','schedule_periods','daily_logs','photos','inspections',
    'defects','contract_obligations','cost_items','change_orders',
    'change_order_items','item_schedules','safety_records',
    'checklist_templates','checklist_records','test_samples','observations',
    'submittals','rfis','inspection_points','acceptance_events'
  ] loop
    execute format('drop trigger if exists %I on public.%I',
      t || '_project_identity_guard', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.guard_project_identity()',
      t || '_project_identity_guard', t);
  end loop;
end $$;

-- -- P0-03 §7: business-table write-policy cutover ----------------------------
-- Shared read stays on my_project_ids(). Every write policy below derives from
-- project-scoped contractual identity. can_write()/org_type no longer appear.

-- projects: technical administration only (insert-self unchanged).
drop policy if exists "projects_update_creator" on public.projects;
drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects for update to authenticated
  using (public.can_manage_project_identity(id))
  with check (public.can_manage_project_identity(id));

-- work_items (BOQ spine): contractor budget custody.
drop policy if exists "work_items_insert" on public.work_items;
create policy "work_items_insert" on public.work_items for insert to authenticated
  with check (public.can_manage_boq(project_id));
drop policy if exists "work_items_update" on public.work_items;
create policy "work_items_update" on public.work_items for update to authenticated
  using (public.can_manage_boq(project_id)) with check (public.can_manage_boq(project_id));
drop policy if exists "work_items_delete" on public.work_items;
create policy "work_items_delete" on public.work_items for delete to authenticated
  using (public.can_manage_boq(project_id));

-- valuations: contractor drafts/submits, supervisor reviews, payment fields
-- by agency_pm/contractor_pm. Transition/field authority in valuations_guard.
drop policy if exists "valuations_insert" on public.valuations;
create policy "valuations_insert" on public.valuations for insert to authenticated
  with check (public.can_submit_valuation(project_id));
drop policy if exists "valuations_update" on public.valuations;
create policy "valuations_update" on public.valuations for update to authenticated
  using (public.can_submit_valuation(project_id)
      or public.can_review_valuation(project_id)
      or public.can_update_payment_fields(project_id))
  with check (public.can_submit_valuation(project_id)
      or public.can_review_valuation(project_id)
      or public.can_update_payment_fields(project_id));
drop policy if exists "valuations_delete" on public.valuations;
create policy "valuations_delete" on public.valuations for delete to authenticated
  using (public.can_submit_valuation(project_id)
      or public.can_review_valuation(project_id));

drop policy if exists "valuation_items_write" on public.valuation_items;
create policy "valuation_items_write" on public.valuation_items for all to authenticated
  using (valuation_id in (
    select id from public.valuations v
    where public.can_submit_valuation(v.project_id)
       or public.can_review_valuation(v.project_id)))
  with check (valuation_id in (
    select id from public.valuations v
    where public.can_submit_valuation(v.project_id)
       or public.can_review_valuation(v.project_id)));

-- schedule / per-item plan: contractor planning.
drop policy if exists "schedule_periods_insert" on public.schedule_periods;
create policy "schedule_periods_insert" on public.schedule_periods for insert to authenticated
  with check (public.can_manage_progress_plan(project_id));
drop policy if exists "schedule_periods_update" on public.schedule_periods;
create policy "schedule_periods_update" on public.schedule_periods for update to authenticated
  using (public.can_manage_progress_plan(project_id))
  with check (public.can_manage_progress_plan(project_id));
drop policy if exists "schedule_periods_delete" on public.schedule_periods;
create policy "schedule_periods_delete" on public.schedule_periods for delete to authenticated
  using (public.can_manage_progress_plan(project_id));

drop policy if exists "item_schedules_insert" on public.item_schedules;
create policy "item_schedules_insert" on public.item_schedules for insert to authenticated
  with check (public.can_manage_progress_plan(project_id));
drop policy if exists "item_schedules_update" on public.item_schedules;
create policy "item_schedules_update" on public.item_schedules for update to authenticated
  using (public.can_manage_progress_plan(project_id))
  with check (public.can_manage_progress_plan(project_id));
drop policy if exists "item_schedules_delete" on public.item_schedules;
create policy "item_schedules_delete" on public.item_schedules for delete to authenticated
  using (public.can_manage_progress_plan(project_id));

-- daily site logs: contractor execution records.
drop policy if exists "daily_logs_insert" on public.daily_logs;
create policy "daily_logs_insert" on public.daily_logs for insert to authenticated
  with check (public.can_manage_daily_logs(project_id));
drop policy if exists "daily_logs_update" on public.daily_logs;
create policy "daily_logs_update" on public.daily_logs for update to authenticated
  using (public.can_manage_daily_logs(project_id))
  with check (public.can_manage_daily_logs(project_id));
drop policy if exists "daily_logs_delete" on public.daily_logs;
create policy "daily_logs_delete" on public.daily_logs for delete to authenticated
  using (public.can_manage_daily_logs(project_id));

drop policy if exists "daily_log_items_write" on public.daily_log_items;
create policy "daily_log_items_write" on public.daily_log_items for all to authenticated
  using (daily_log_id in (
    select id from public.daily_logs d where public.can_manage_daily_logs(d.project_id)))
  with check (daily_log_id in (
    select id from public.daily_logs d where public.can_manage_daily_logs(d.project_id)));

-- photos: site evidence + markups (contractor execution and supervisor field
-- records both attach media).
drop policy if exists "photos_insert" on public.photos;
create policy "photos_insert" on public.photos for insert to authenticated
  with check (public.can_manage_field_media(project_id));
drop policy if exists "photos_update" on public.photos;
create policy "photos_update" on public.photos for update to authenticated
  using (public.can_manage_field_media(project_id))
  with check (public.can_manage_field_media(project_id));
drop policy if exists "photos_delete" on public.photos;
create policy "photos_delete" on public.photos for delete to authenticated
  using (public.can_manage_field_media(project_id));

drop policy if exists "photos_objects_insert" on storage.objects;
create policy "photos_objects_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos'
    and public.can_manage_field_media(((storage.foldername(name))[1])::uuid));
drop policy if exists "photos_objects_delete" on storage.objects;
create policy "photos_objects_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos'
    and public.can_manage_field_media(((storage.foldername(name))[1])::uuid));

-- inspections: contractor requests, supervisor decides.
drop policy if exists "inspections_insert" on public.inspections;
create policy "inspections_insert" on public.inspections for insert to authenticated
  with check (public.can_submit_inspection(project_id));
drop policy if exists "inspections_update" on public.inspections;
create policy "inspections_update" on public.inspections for update to authenticated
  using (public.can_submit_inspection(project_id) or public.can_decide_inspection(project_id))
  with check (public.can_submit_inspection(project_id) or public.can_decide_inspection(project_id));
drop policy if exists "inspections_delete" on public.inspections;
create policy "inspections_delete" on public.inspections for delete to authenticated
  using (public.can_submit_inspection(project_id) or public.can_decide_inspection(project_id));

-- defects: supervision and contractor quality open; contractor remediates;
-- supervisor closes and is the only role that can delete a formal defect.
drop policy if exists "defects_insert" on public.defects;
create policy "defects_insert" on public.defects for insert to authenticated
  with check (public.can_open_defect(project_id));
drop policy if exists "defects_update" on public.defects;
create policy "defects_update" on public.defects for update to authenticated
  using (public.can_manage_defect_remediation(project_id) or public.can_close_defect(project_id))
  with check (public.can_manage_defect_remediation(project_id) or public.can_close_defect(project_id));
drop policy if exists "defects_delete" on public.defects;
create policy "defects_delete" on public.defects for delete to authenticated
  using (public.can_close_defect(project_id));

-- ITP inspection points: supervision assurance tool; contractors may only
-- attach their inspection request (field rule in inspection_points_guard).
drop policy if exists "inspection_points_insert" on public.inspection_points;
create policy "inspection_points_insert" on public.inspection_points for insert to authenticated
  with check (public.can_manage_itp(project_id));
drop policy if exists "inspection_points_update" on public.inspection_points;
create policy "inspection_points_update" on public.inspection_points for update to authenticated
  using (public.can_manage_itp(project_id) or public.can_submit_inspection(project_id))
  with check (public.can_manage_itp(project_id) or public.can_submit_inspection(project_id));
drop policy if exists "inspection_points_delete" on public.inspection_points;
create policy "inspection_points_delete" on public.inspection_points for delete to authenticated
  using (public.can_manage_itp(project_id));

-- QC execution: contractor quality.
drop policy if exists "checklist_templates_insert" on public.checklist_templates;
create policy "checklist_templates_insert" on public.checklist_templates for insert to authenticated
  with check (public.can_manage_quality_execution(project_id));
drop policy if exists "checklist_templates_update" on public.checklist_templates;
create policy "checklist_templates_update" on public.checklist_templates for update to authenticated
  using (public.can_manage_quality_execution(project_id))
  with check (public.can_manage_quality_execution(project_id));
drop policy if exists "checklist_templates_delete" on public.checklist_templates;
create policy "checklist_templates_delete" on public.checklist_templates for delete to authenticated
  using (public.can_manage_quality_execution(project_id));

drop policy if exists "checklist_records_insert" on public.checklist_records;
create policy "checklist_records_insert" on public.checklist_records for insert to authenticated
  with check (public.can_manage_quality_execution(project_id));
drop policy if exists "checklist_records_update" on public.checklist_records;
create policy "checklist_records_update" on public.checklist_records for update to authenticated
  using (public.can_manage_quality_execution(project_id))
  with check (public.can_manage_quality_execution(project_id));
drop policy if exists "checklist_records_delete" on public.checklist_records;
create policy "checklist_records_delete" on public.checklist_records for delete to authenticated
  using (public.can_manage_quality_execution(project_id));

drop policy if exists "test_samples_insert" on public.test_samples;
create policy "test_samples_insert" on public.test_samples for insert to authenticated
  with check (public.can_manage_quality_execution(project_id));
drop policy if exists "test_samples_update" on public.test_samples;
create policy "test_samples_update" on public.test_samples for update to authenticated
  using (public.can_manage_quality_execution(project_id))
  with check (public.can_manage_quality_execution(project_id));
drop policy if exists "test_samples_delete" on public.test_samples;
create policy "test_samples_delete" on public.test_samples for delete to authenticated
  using (public.can_manage_quality_execution(project_id));

-- safety: contractor safety custody.
drop policy if exists "safety_records_insert" on public.safety_records;
create policy "safety_records_insert" on public.safety_records for insert to authenticated
  with check (public.can_manage_safety_records(project_id));
drop policy if exists "safety_records_update" on public.safety_records;
create policy "safety_records_update" on public.safety_records for update to authenticated
  using (public.can_manage_safety_records(project_id))
  with check (public.can_manage_safety_records(project_id));
drop policy if exists "safety_records_delete" on public.safety_records;
create policy "safety_records_delete" on public.safety_records for delete to authenticated
  using (public.can_manage_safety_records(project_id));

-- submittals: contractor submits, supervisor decides (submittals_guard).
drop policy if exists "submittals_insert" on public.submittals;
create policy "submittals_insert" on public.submittals for insert to authenticated
  with check (public.can_create_submittal(project_id));
drop policy if exists "submittals_update" on public.submittals;
create policy "submittals_update" on public.submittals for update to authenticated
  using (public.can_create_submittal(project_id) or public.can_review_submittal(project_id))
  with check (public.can_create_submittal(project_id) or public.can_review_submittal(project_id));
drop policy if exists "submittals_delete" on public.submittals;
create policy "submittals_delete" on public.submittals for delete to authenticated
  using (public.can_create_submittal(project_id) or public.can_review_submittal(project_id));

-- RFIs: contractor asks/closes, supervisor formally answers (rfis_guard).
drop policy if exists "rfis_insert" on public.rfis;
create policy "rfis_insert" on public.rfis for insert to authenticated
  with check (public.can_create_rfi(project_id));
drop policy if exists "rfis_update" on public.rfis;
create policy "rfis_update" on public.rfis for update to authenticated
  using (public.can_create_rfi(project_id) or public.can_answer_rfi(project_id))
  with check (public.can_create_rfi(project_id) or public.can_answer_rfi(project_id));
drop policy if exists "rfis_delete" on public.rfis;
create policy "rfis_delete" on public.rfis for delete to authenticated
  using (public.can_create_rfi(project_id) or public.can_answer_rfi(project_id));

-- observations: shared field collaboration between supervision and contractor.
drop policy if exists "observations_insert" on public.observations;
create policy "observations_insert" on public.observations for insert to authenticated
  with check (public.can_manage_observations(project_id));
drop policy if exists "observations_update" on public.observations;
create policy "observations_update" on public.observations for update to authenticated
  using (public.can_manage_observations(project_id))
  with check (public.can_manage_observations(project_id));
drop policy if exists "observations_delete" on public.observations;
create policy "observations_delete" on public.observations for delete to authenticated
  using (public.can_manage_observations(project_id));

-- contractor-private cost/margin: project contractor identity only. No
-- technical-admin, agency, or supervisor access - not even read.
drop policy if exists "cost_items_contractor_only" on public.cost_items;
create policy "cost_items_contractor_only" on public.cost_items for all to authenticated
  using (public.can_manage_contractor_private(project_id))
  with check (public.can_manage_contractor_private(project_id));

-- change orders: contractor drafts, supervisor pre-reviews status, agency
-- ratifies (change_orders_guard).
drop policy if exists "change_orders_insert" on public.change_orders;
create policy "change_orders_insert" on public.change_orders for insert to authenticated
  with check (public.can_manage_change_orders(project_id));
drop policy if exists "change_orders_update" on public.change_orders;
create policy "change_orders_update" on public.change_orders for update to authenticated
  using (public.can_manage_change_orders(project_id)
      or public.can_review_change_order(project_id)
      or public.can_ratify_change_order(project_id))
  with check (public.can_manage_change_orders(project_id)
      or public.can_review_change_order(project_id)
      or public.can_ratify_change_order(project_id));
drop policy if exists "change_orders_delete" on public.change_orders;
create policy "change_orders_delete" on public.change_orders for delete to authenticated
  using (public.can_manage_change_orders(project_id));

drop policy if exists "change_order_items_insert" on public.change_order_items;
create policy "change_order_items_insert" on public.change_order_items for insert to authenticated
  with check (public.can_manage_change_orders(project_id));
drop policy if exists "change_order_items_update" on public.change_order_items;
create policy "change_order_items_update" on public.change_order_items for update to authenticated
  using (public.can_manage_change_orders(project_id))
  with check (public.can_manage_change_orders(project_id));
drop policy if exists "change_order_items_delete" on public.change_order_items;
create policy "change_order_items_delete" on public.change_order_items for delete to authenticated
  using (public.can_manage_change_orders(project_id));

-- contract obligations (deadline compatibility surface): contractor custody.
drop policy if exists "contract_obligations_insert" on public.contract_obligations;
create policy "contract_obligations_insert" on public.contract_obligations for insert to authenticated
  with check (public.can_manage_contract_obligations(project_id));
drop policy if exists "contract_obligations_update" on public.contract_obligations;
create policy "contract_obligations_update" on public.contract_obligations for update to authenticated
  using (public.can_manage_contract_obligations(project_id))
  with check (public.can_manage_contract_obligations(project_id));
drop policy if exists "contract_obligations_delete" on public.contract_obligations;
create policy "contract_obligations_delete" on public.contract_obligations for delete to authenticated
  using (public.can_manage_contract_obligations(project_id));

-- acceptance: stage-scoped party authority replaces members-all.
drop policy if exists "acceptance_events_members_all" on public.acceptance_events;
drop policy if exists "acceptance_events_select" on public.acceptance_events;
create policy "acceptance_events_select" on public.acceptance_events for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "acceptance_events_insert" on public.acceptance_events;
create policy "acceptance_events_insert" on public.acceptance_events for insert to authenticated
  with check (public.can_record_acceptance_stage(project_id, stage_key));
drop policy if exists "acceptance_events_update" on public.acceptance_events;
create policy "acceptance_events_update" on public.acceptance_events for update to authenticated
  using (public.can_record_acceptance_stage(project_id, stage_key))
  with check (public.can_record_acceptance_stage(project_id, stage_key));
drop policy if exists "acceptance_events_delete" on public.acceptance_events;
create policy "acceptance_events_delete" on public.acceptance_events for delete to authenticated
  using (public.can_record_acceptance_stage(project_id, stage_key));

-- documents (P0-01 domain): explicit document custody.
drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert" on public.documents for insert to authenticated
  with check (public.can_manage_documents(project_id));
drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update to authenticated
  using (public.can_manage_documents(project_id))
  with check (public.can_manage_documents(project_id));

drop policy if exists "document_versions_insert" on public.document_versions;
create policy "document_versions_insert" on public.document_versions for insert to authenticated
  with check (document_id in (
    select id from public.documents where public.can_manage_documents(project_id)));
drop policy if exists "document_versions_update" on public.document_versions;
create policy "document_versions_update" on public.document_versions for update to authenticated
  using (document_id in (
    select id from public.documents where public.can_manage_documents(project_id)))
  with check (document_id in (
    select id from public.documents where public.can_manage_documents(project_id)));

drop policy if exists "document_pages_insert" on public.document_pages;
create policy "document_pages_insert" on public.document_pages for insert to authenticated
  with check (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_manage_documents(d.project_id)));
drop policy if exists "document_pages_update" on public.document_pages;
create policy "document_pages_update" on public.document_pages for update to authenticated
  using (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_manage_documents(d.project_id)))
  with check (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_manage_documents(d.project_id)));
drop policy if exists "document_pages_delete" on public.document_pages;
create policy "document_pages_delete" on public.document_pages for delete to authenticated
  using (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_manage_documents(d.project_id)));

-- requirements: contractual truth. Only Requirement reviewers write directly;
-- the legacy contract_obligations mirror keeps flowing through its
-- SECURITY DEFINER sync trigger. Snapshot immutability in requirements guards.
drop policy if exists "requirements_insert" on public.requirements;
create policy "requirements_insert" on public.requirements for insert to authenticated
  with check (public.can_review_requirement(project_id));
drop policy if exists "requirements_update" on public.requirements;
create policy "requirements_update" on public.requirements for update to authenticated
  using (public.can_review_requirement(project_id))
  with check (public.can_review_requirement(project_id));
drop policy if exists "requirements_delete" on public.requirements;
create policy "requirements_delete" on public.requirements for delete to authenticated
  using (public.can_review_requirement(project_id));

drop policy if exists "requirement_sources_insert" on public.requirement_sources;
create policy "requirement_sources_insert" on public.requirement_sources for insert to authenticated
  with check (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)));
drop policy if exists "requirement_sources_update" on public.requirement_sources;
create policy "requirement_sources_update" on public.requirement_sources for update to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)))
  with check (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)));
drop policy if exists "requirement_sources_delete" on public.requirement_sources;
create policy "requirement_sources_delete" on public.requirement_sources for delete to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)));

drop policy if exists "requirement_work_items_insert" on public.requirement_work_items;
create policy "requirement_work_items_insert" on public.requirement_work_items for insert to authenticated
  with check (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)));
drop policy if exists "requirement_work_items_update" on public.requirement_work_items;
create policy "requirement_work_items_update" on public.requirement_work_items for update to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)))
  with check (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)));
drop policy if exists "requirement_work_items_delete" on public.requirement_work_items;
create policy "requirement_work_items_delete" on public.requirement_work_items for delete to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)));

-- -- P0-03 §8: workflow state-transition guards --------------------------------
-- RLS answers "who may touch this row"; the guards below answer "who may make
-- this state transition / change these fields". auth.uid() is null (service
-- role, SQL editor, migrations) always passes: they protect application users.
-- There is deliberately no is_project_admin bypass anywhere below.

-- 估驗:INSERT 不得直接落在核定後狀態;跨越「已核定」=監造審核角色;
-- 已核定後除請款/撥款欄外凍結;請款/撥款角色(機關/廠商 PM)僅能動付款欄。
create or replace function public.valuations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  content_changed boolean;
  payment_changed boolean;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  pid := coalesce(new.project_id, old.project_id);
  if tg_op = 'INSERT' then
    if new.status <> '草稿' then
      raise exception '估驗不可直接以已核定狀態建立';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('已核定','已請款') then
      raise exception '已核定估驗不可刪除(需監造退回後處理)';
    end if;
    return old;
  end if;
  payment_changed :=
       new.invoice_date is distinct from old.invoice_date
    or new.paid_date    is distinct from old.paid_date
    or new.paid_amount  is distinct from old.paid_amount;
  content_changed :=
       new.period_no      is distinct from old.period_no
    or new.period_start   is distinct from old.period_start
    or new.period_end     is distinct from old.period_end
    or new.valuation_date is distinct from old.valuation_date
    or new.retention_pct  is distinct from old.retention_pct
    or new.note           is distinct from old.note;
  if payment_changed and not public.can_update_payment_fields(pid) then
    raise exception '請款/撥款欄位僅授權機關或廠商專案經理更新';
  end if;
  if payment_changed and old.status not in ('已核定','已請款') then
    raise exception '請款/撥款欄位僅可在已核定估驗上更新';
  end if;
  if new.status is distinct from old.status then
    if old.status = '草稿' and new.status in ('送審','監造審核') then
      if not public.can_submit_valuation(pid) then
        raise exception '估驗送審僅廠商專案經理可執行';
      end if;
    elsif old.status in ('送審','監造審核') and new.status in ('草稿','已核定') then
      if not public.can_review_valuation(pid) then
        raise exception '估驗核定/退回核定僅監造審核角色可執行';
      end if;
    elsif old.status = '已核定' and new.status = '草稿' then
      if not public.can_review_valuation(pid) then
        raise exception '估驗核定/退回核定僅監造審核角色可執行';
      end if;
    elsif old.status = '已核定' and new.status = '已請款' then
      if not public.can_update_payment_fields(pid) then
        raise exception '估驗請款狀態僅請款/撥款角色可更新';
      end if;
    else
      raise exception 'invalid valuation status transition from % to %', old.status, new.status;
    end if;
  end if;
  if content_changed then
    if not (public.can_submit_valuation(pid) or public.can_review_valuation(pid)) then
      raise exception '僅可登錄請款/撥款欄位(invoice_date / paid_date / paid_amount)';
    end if;
    if old.status in ('已核定','已請款') then
      raise exception '已核定估驗內容不可再修改(需監造退回後重編)';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists valuations_guard on public.valuations;
create trigger valuations_guard before insert or update or delete on public.valuations
  for each row execute function public.valuations_guard();

-- 估驗明細:已核定/已請款後對所有應用角色凍結;整案 cascade 放行。
create or replace function public.valuation_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select project_id, status into v from public.valuations
    where id = coalesce(new.valuation_id, old.valuation_id);
  if v.project_id is null then return coalesce(new, old); end if; -- parent cascade
  if v.status in ('已核定','已請款') then
    raise exception '已核定估驗的明細不可再修改(需監造退回後重編)';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists valuation_items_guard on public.valuation_items;
create trigger valuation_items_guard before insert or update or delete on public.valuation_items
  for each row execute function public.valuation_items_guard();

-- 查驗:判定(合格/不合格)與已判定紀錄的刪除=監造;不得以已判定狀態建立。
create or replace function public.inspections_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  decision_changed boolean;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  pid := coalesce(new.project_id, old.project_id);
  if tg_op = 'INSERT' then
    if (new.status in ('合格','不合格') or new.result_note is not null
        or new.inspected_by is not null or new.inspected_at is not null)
       and not public.can_decide_inspection(pid) then
      raise exception '查驗不可直接以已判定狀態建立';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('合格','不合格') and not public.can_decide_inspection(pid) then
      raise exception '已判定查驗紀錄不可刪除';
    end if;
    return old;
  end if;
  decision_changed :=
       new.status       is distinct from old.status
    or new.result_note  is distinct from old.result_note
    or new.inspected_by is distinct from old.inspected_by
    or new.inspected_at is distinct from old.inspected_at;
  if decision_changed and not public.can_decide_inspection(pid) then
    raise exception '查驗判定(合格/不合格)僅監造查驗角色可執行';
  end if;
  if old.status in ('合格','不合格') and not public.can_decide_inspection(pid) then
    raise exception '已判定查驗紀錄僅監造查驗角色可修改';
  end if;
  return new;
end; $$;
drop trigger if exists inspections_guard on public.inspections;
create trigger inspections_guard before insert or update or delete on public.inspections
  for each row execute function public.inspections_guard();

-- 缺失:結案/撤銷結案=監造;不得以已結案狀態開立。
create or replace function public.defects_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  pid := coalesce(new.project_id, old.project_id);
  if tg_op = 'INSERT' then
    if (new.status = '已結案' or new.closed_at is not null)
       and not public.can_close_defect(pid) then
      raise exception '缺失不可直接以已結案狀態建立';
    end if;
    return new;
  end if;
  if (new.status is distinct from old.status
       and (new.status = '已結案' or old.status = '已結案')
      or new.closed_at is distinct from old.closed_at)
     and not public.can_close_defect(pid) then
    raise exception '缺失結案僅監造複查角色可執行';
  end if;
  if old.status = '已結案' and not public.can_close_defect(pid) then
    raise exception '已結案缺失僅監造複查角色可修改';
  end if;
  return new;
end; $$;
drop trigger if exists defects_guard on public.defects;
create trigger defects_guard before insert or update on public.defects
  for each row execute function public.defects_guard();

-- 送審:審定(核准/核備/退回補正/駁回)=監造;退回補正→已提送=廠商修正再送;
-- 不得以審定後狀態建立;核准/核備/駁回後不可由廠商刪除。
create or replace function public.submittals_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  review_fields_changed boolean;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  pid := coalesce(new.project_id, old.project_id);
  if tg_op = 'INSERT' then
    if new.status <> '已提送' or new.review_note is not null
       or new.decided_date is not null then
      raise exception '送審不可直接以審定後狀態建立';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> '已提送' and not public.can_review_submittal(pid) then
      raise exception '已審定送審紀錄不可刪除';
    end if;
    return old;
  end if;
  if old.status = '退回補正' and new.status = '已提送'
     and new.review_note is not distinct from old.review_note
     and public.can_create_submittal(pid) then
    return new; -- 廠商補正後再送(含 revision/submitted_date/清除 decided_date)
  end if;
  review_fields_changed :=
       new.review_note  is distinct from old.review_note
    or new.decided_date is distinct from old.decided_date;
  if review_fields_changed and not public.can_review_submittal(pid) then
    raise exception '送審審定僅監造審查角色可執行';
  end if;
  if new.status is distinct from old.status
     and not public.can_review_submittal(pid) then
    raise exception '送審審定僅監造審查角色可執行';
  end if;
  return new;
end; $$;
drop trigger if exists submittals_guard on public.submittals;
create trigger submittals_guard before insert or update or delete on public.submittals
  for each row execute function public.submittals_guard();

-- RFI:正式回覆=監造;已回覆的疑義不可由廠商刪除(廠商可確認結案)。
create or replace function public.rfis_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  answer_changed boolean;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  pid := coalesce(new.project_id, old.project_id);
  if tg_op = 'INSERT' then
    if new.status <> '待回覆' or new.answer is not null
       or new.answered_date is not null then
      raise exception '工程疑義不可直接以已回覆/已結案狀態建立';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if (old.answer is not null or old.status in ('已回覆','已結案'))
       and not public.can_answer_rfi(pid) then
      raise exception '已回覆的工程疑義不可刪除';
    end if;
    return old;
  end if;
  answer_changed := new.answer is distinct from old.answer
    or new.answered_date is distinct from old.answered_date;
  if answer_changed and not public.can_answer_rfi(pid) then
    raise exception '回覆工程疑義僅監造回覆角色可執行';
  end if;
  if new.status is distinct from old.status then
    if old.status = '待回覆' and new.status = '已回覆' then
      if not public.can_answer_rfi(pid) then
        raise exception '回覆工程疑義僅監造回覆角色可執行';
      end if;
    elsif old.status = '已回覆' and new.status = '已結案' then
      if not (public.can_create_rfi(pid) or public.can_answer_rfi(pid)) then
        raise exception '工程疑義結案僅提問方或監造回覆角色可執行';
      end if;
    else
      raise exception 'invalid RFI status transition from % to %', old.status, new.status;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists rfis_guard on public.rfis;
create trigger rfis_guard before insert or update or delete on public.rfis
  for each row execute function public.rfis_guard();

-- 變更設計:核准/駁回(含撤銷)=機關核定角色;監造/機關僅可改狀態欄;
-- 已核准變更內容凍結、不可刪除(先撤銷核定)。
create or replace function public.change_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  content_changed boolean;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  pid := coalesce(new.project_id, old.project_id);
  if tg_op = 'INSERT' then
    if new.status <> '提出' then
      raise exception '變更設計不可直接以核定後狀態建立';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status = '核准' then
      raise exception '已核准變更設計不可刪除(需先撤銷核定)';
    end if;
    if old.status not in ('提出','駁回') then
      raise exception '審核中變更設計不可刪除(需先退回)';
    end if;
    return old;
  end if;
  if new.status is distinct from old.status then
    if new.status in ('核准','駁回')
       and not public.can_ratify_change_order(pid) then
      raise exception '變更設計核准/駁回僅機關核定角色可執行';
    end if;
    if old.status = '提出' and new.status = '審核中' then
      if not public.can_review_change_order(pid) then
        raise exception '變更設計送審僅監造審查角色可執行';
      end if;
    elsif old.status = '審核中' and new.status = '提出' then
      if not public.can_review_change_order(pid) then
        raise exception '變更設計退回僅監造審查角色可執行';
      end if;
    elsif old.status = '審核中' and new.status in ('核准','駁回') then
      if not public.can_ratify_change_order(pid) then
        raise exception '變更設計核准/駁回僅機關核定角色可執行';
      end if;
    elsif old.status = '駁回' and new.status = '提出' then
      if not public.can_manage_change_orders(pid) then
        raise exception '變更設計重新提出僅廠商專案經理可執行';
      end if;
    elsif old.status = '核准' and new.status = '審核中' then
      if not public.can_ratify_change_order(pid) then
        raise exception '變更設計撤銷核定僅機關核定角色可執行';
      end if;
    else
      raise exception 'invalid change-order status transition from % to %', old.status, new.status;
    end if;
  end if;
  content_changed :=
       new.co_no      is distinct from old.co_no
    or new.title      is distinct from old.title
    or new.co_date    is distinct from old.co_date
    or new.reason     is distinct from old.reason
    or new.sort_order is distinct from old.sort_order;
  if content_changed then
    if not public.can_manage_change_orders(pid) then
      raise exception '機關/監造僅可核定變更設計狀態,不可修改內容';
    end if;
    if old.status = '核准' and new.status = '核准' then
      raise exception '已核准變更設計的內容不可再修改';
    end if;
    if old.status not in ('提出','駁回') then
      raise exception '變更設計進入審核後內容不可再修改';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists change_orders_guard on public.change_orders;
create trigger change_orders_guard before insert or update or delete on public.change_orders
  for each row execute function public.change_orders_guard();

-- 變更明細:已核准的變更凍結(任何應用使用者;整批 cascade 放行)。
create or replace function public.change_order_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare co record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select project_id, status into co from public.change_orders
    where id = coalesce(new.change_order_id, old.change_order_id);
  if co.project_id is null then return coalesce(new, old); end if; -- parent cascade
  if tg_op <> 'DELETE' and new.project_id <> co.project_id then
    raise exception 'change order item and parent change order must belong to the same project';
  end if;
  if tg_op <> 'DELETE' and new.work_item_id is not null and not exists (
    select 1 from public.work_items w
    where w.id = new.work_item_id and w.project_id = co.project_id
  ) then
    raise exception 'change order item and linked work item must belong to the same project';
  end if;
  if co.status = '核准' then
    raise exception '已核准變更設計的明細不可再修改(需先撤銷核定)';
  end if;
  if co.status not in ('提出','駁回') then
    raise exception '變更設計進入審核後明細不可再修改';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists change_order_items_guard on public.change_order_items;
create trigger change_order_items_guard before insert or update or delete on public.change_order_items
  for each row execute function public.change_order_items_guard();

-- ITP 停留點:非監造(申請查驗的施工角色)僅能連結 inspection_id。
create or replace function public.inspection_points_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.can_manage_itp(new.project_id) then return new; end if;
  if new.point_type           is distinct from old.point_type
     or new.title               is distinct from old.title
     or new.acceptance_criteria is distinct from old.acceptance_criteria
     or new.frequency           is distinct from old.frequency
     or new.source_clause       is distinct from old.source_clause
     or new.work_item_id        is distinct from old.work_item_id
     or new.sort_order          is distinct from old.sort_order
     or new.created_by          is distinct from old.created_by then
    raise exception '停留點定義僅監造可修改;施工角色僅能連結查驗申請';
  end if;
  return new;
end; $$;
drop trigger if exists inspection_points_guard on public.inspection_points;
create trigger inspection_points_guard before update on public.inspection_points
  for each row execute function public.inspection_points_guard();

-- -- P0-03 §9: Requirement lifecycle + snapshot guards -------------------------
-- Lifecycle:draft_ai/needs_review → approved|rejected;approved → superseded。
-- 審查轉移=Requirement 審查角色(機關/監造)。已審查(approved/rejected/
-- superseded)內容凍結;引註快照凍結;approved/rejected/superseded 不可刪除。
-- 名稱以 requirements_s* 排序,確保 P0-01 project-identity guard 先行。
create or replace function public.requirements_snapshot_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare content_changed boolean;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if new.status not in ('draft_ai','needs_review') then
      raise exception 'requirements cannot be created directly in a reviewed status';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status not in ('draft_ai','needs_review') then
      raise exception 'reviewed requirements cannot be deleted; supersede them instead';
    end if;
    return old;
  end if;
  if new.status is distinct from old.status then
    if not public.can_review_requirement(old.project_id) then
      raise exception 'requirement lifecycle transitions require a requirement reviewer';
    end if;
    if not ((old.status in ('draft_ai','needs_review')
              and new.status in ('draft_ai','needs_review','approved','rejected'))
         or (old.status = 'approved' and new.status = 'superseded')) then
      raise exception 'invalid requirement lifecycle transition from % to %',
        old.status, new.status;
    end if;
  end if;
  content_changed :=
       new.title                  is distinct from old.title
    or new.description            is distinct from old.description
    or new.requirement_type       is distinct from old.requirement_type
    or new.responsible_party_type is distinct from old.responsible_party_type
    or new.responsible_project_party_id is distinct from old.responsible_project_party_id
    or new.lifecycle_phase        is distinct from old.lifecycle_phase
    or new.trigger_type           is distinct from old.trigger_type
    or new.trigger_config         is distinct from old.trigger_config
    or new.frequency_type         is distinct from old.frequency_type
    or new.frequency_config       is distinct from old.frequency_config
    or new.acceptance_criteria    is distinct from old.acceptance_criteria
    or new.evidence_requirement   is distinct from old.evidence_requirement
    or new.origin                 is distinct from old.origin
    or new.legacy_contract_obligation_id is distinct from old.legacy_contract_obligation_id
    or new.confidence             is distinct from old.confidence
    or new.reviewed_by            is distinct from old.reviewed_by
    or new.reviewed_at            is distinct from old.reviewed_at;
  if content_changed and old.status not in ('draft_ai','needs_review') then
    raise exception 'reviewed requirement content is immutable; supersede and create a new requirement';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_snapshot_guard on public.requirements;
create trigger requirements_snapshot_guard before insert or update or delete on public.requirements
  for each row execute function public.requirements_snapshot_guard();

-- 引註快照:已審查 Requirement 的 sources 凍結(僅 draft/needs_review 可同步)。
create or replace function public.requirement_sources_snapshot_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare req record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select status into req from public.requirements
    where id = coalesce(new.requirement_id, old.requirement_id);
  if req.status is null then return coalesce(new, old); end if; -- parent cascade
  if req.status not in ('draft_ai','needs_review') then
    raise exception 'citations of a reviewed requirement are immutable';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists requirement_sources_snapshot_guard on public.requirement_sources;
create trigger requirement_sources_snapshot_guard
  before insert or update or delete on public.requirement_sources
  for each row execute function public.requirement_sources_snapshot_guard();

-- -- P0-03 §10: technical administration RPC cutover ---------------------------
-- Compatibility RPCs still dual-write both membership models, but the caller
-- is now authorized by v2 technical administration rather than creator status.
create or replace function public.add_member_by_email(
  p_project uuid, p_email text, p_role text default 'member'
) returns text language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.can_manage_project_identity(p_project) then
    raise exception '只有專案技術管理者可以管理成員';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then return 'not_found'; end if;
  insert into public.project_members (project_id, user_id, role)
  values (p_project, uid, p_role) on conflict do nothing;
  perform public.ensure_legacy_project_identity(p_project, uid);
  return 'ok';
end; $$;
grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;

create or replace function public.list_project_members(p_project uuid)
returns table (
  user_id uuid,
  full_name text,
  company text,
  org_type text,
  member_role text,
  project_party_id uuid,
  party_type text,
  project_role text,
  is_project_admin boolean,
  party_display_name text
) language sql security definer stable set search_path = public as $$
  select legacy.user_id, profile.full_name, profile.company, profile.org_type,
         legacy.role, membership.project_party_id, party.party_type,
         membership.project_role, membership.is_project_admin, party.display_name
  from public.project_members legacy
  join public.profiles profile on profile.id = legacy.user_id
  left join public.project_memberships membership
    on membership.project_id = legacy.project_id
   and membership.user_id = legacy.user_id
  left join public.project_parties party on party.id = membership.project_party_id
  where legacy.project_id = p_project
    and public.is_project_member(p_project)
  order by legacy.created_at
$$;
grant execute on function public.list_project_members(uuid) to authenticated;

create or replace function public.remove_member(p_project uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_project_identity(p_project) then
    raise exception '只有專案技術管理者可以管理成員';
  end if;
  if p_user = auth.uid() then raise exception '不能移除自己'; end if;
  delete from public.project_memberships where project_id = p_project and user_id = p_user;
  delete from public.project_members where project_id = p_project and user_id = p_user;
end; $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- Project deletion is technical administration under the v2 identity model.
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_project_identity(p_id) then
    raise exception '只有專案技術管理者可以刪除專案';
  end if;
  delete from public.projects where id = p_id;
end; $$;
grant execute on function public.delete_project(uuid) to authenticated;
-- -- End P0-03/P0-04 authority cutover --------------------------------------
