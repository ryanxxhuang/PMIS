-- P0-02 - Project-scoped party and role foundation
--
-- Idempotent compatibility migration. Legacy project_members, project name
-- fields, profiles.org_type, and existing workflow authorization remain until
-- the P0-03 authority cutover.

-- -- P0-02: project party and role foundation -------------------------------
-- New identity tables use project-scoped memberships. Existing business-table
-- authorization remains on project_members/profiles until the P0-03 cutover.
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_parties (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  party_type      text not null
    check (party_type in ('agency','contractor','supervisor','designer','consultant','other')),
  display_name    text not null,
  -- Explicit, non-fuzzy identity for idempotent legacy seeds.
  migration_key   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, migration_key)
);

create table if not exists public.project_memberships (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  project_party_id uuid not null references public.project_parties(id) on delete cascade,
  project_role     text not null
    check (project_role in (
      'agency_pm','agency_engineer',
      'contractor_pm','site_manager','quality_engineer','safety_engineer',
      'supervisor_manager','supervisor_engineer',
      'document_controller','viewer'
    )),
  is_project_admin boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists organizations_created_by_idx on public.organizations(created_by);
create index if not exists project_parties_project_idx on public.project_parties(project_id);
create index if not exists project_parties_organization_idx on public.project_parties(organization_id);
create index if not exists project_memberships_project_idx on public.project_memberships(project_id);
create index if not exists project_memberships_user_idx on public.project_memberships(user_id);
create index if not exists project_memberships_party_idx on public.project_memberships(project_party_id);

create or replace function public.touch_project_identity_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;
drop trigger if exists organizations_touch_updated_at on public.organizations;
create trigger organizations_touch_updated_at before update on public.organizations
  for each row execute function public.touch_project_identity_updated_at();
drop trigger if exists project_parties_touch_updated_at on public.project_parties;
create trigger project_parties_touch_updated_at before update on public.project_parties
  for each row execute function public.touch_project_identity_updated_at();
drop trigger if exists project_memberships_touch_updated_at on public.project_memberships;
create trigger project_memberships_touch_updated_at before update on public.project_memberships
  for each row execute function public.touch_project_identity_updated_at();

-- Reuse the P0-01 immutable project identity invariant.
drop trigger if exists project_parties_project_identity_guard on public.project_parties;
create trigger project_parties_project_identity_guard before update on public.project_parties
  for each row execute function public.guard_project_identity();
drop trigger if exists project_memberships_project_identity_guard on public.project_memberships;
create trigger project_memberships_project_identity_guard before update on public.project_memberships
  for each row execute function public.guard_project_identity();

create or replace function public.validate_membership_project_party()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1 from public.project_parties pp
    where pp.id = new.project_party_id and pp.project_id = new.project_id
  ) then
    raise exception 'project membership and project party must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists project_memberships_same_project on public.project_memberships;
create trigger project_memberships_same_project
  before insert or update on public.project_memberships for each row
  execute function public.validate_membership_project_party();

-- Project-scoped identity helpers. SECURITY DEFINER avoids recursive RLS on
-- project_memberships while still binding every lookup to auth.uid().
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
  limit 1
$$;

create or replace function public.my_project_ids_v2()
returns setof uuid language sql security definer stable set search_path = public as $$
  select project_id from public.project_memberships where user_id = auth.uid()
$$;

create or replace function public.is_project_member_v2(p_project uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_memberships
    where project_id = p_project and user_id = auth.uid()
  )
$$;

create or replace function public.my_project_party_type(p_project uuid)
returns text language sql security definer stable set search_path = public as $$
  select party_type from public.my_project_membership(p_project)
$$;

create or replace function public.my_project_role(p_project uuid)
returns text language sql security definer stable set search_path = public as $$
  select project_role from public.my_project_membership(p_project)
$$;

create or replace function public.is_project_admin_v2(p_project uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select is_project_admin from public.my_project_membership(p_project)), false)
$$;

revoke all on function public.my_project_membership(uuid) from public;
revoke all on function public.my_project_ids_v2() from public;
revoke all on function public.is_project_member_v2(uuid) from public;
revoke all on function public.my_project_party_type(uuid) from public;
revoke all on function public.my_project_role(uuid) from public;
revoke all on function public.is_project_admin_v2(uuid) from public;
grant execute on function public.my_project_membership(uuid) to authenticated;
grant execute on function public.my_project_ids_v2() to authenticated;
grant execute on function public.is_project_member_v2(uuid) to authenticated;
grant execute on function public.my_project_party_type(uuid) to authenticated;
grant execute on function public.my_project_role(uuid) to authenticated;
grant execute on function public.is_project_admin_v2(uuid) to authenticated;

alter table public.organizations       enable row level security;
alter table public.project_parties     enable row level security;
alter table public.project_memberships enable row level security;

drop policy if exists "organizations_select" on public.organizations;
create policy "organizations_select" on public.organizations for select to authenticated
  using (
    created_by = auth.uid() or exists (
      select 1 from public.project_parties pp
      where pp.organization_id = organizations.id
        and pp.project_id in (select public.my_project_ids_v2())
    )
  );
drop policy if exists "organizations_insert" on public.organizations;
create policy "organizations_insert" on public.organizations for insert to authenticated
  with check (created_by = auth.uid());
drop policy if exists "organizations_update" on public.organizations;
create policy "organizations_update" on public.organizations for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "organizations_delete" on public.organizations;
create policy "organizations_delete" on public.organizations for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "project_parties_select" on public.project_parties;
create policy "project_parties_select" on public.project_parties for select to authenticated
  using (project_id in (select public.my_project_ids_v2()));
drop policy if exists "project_parties_insert" on public.project_parties;
create policy "project_parties_insert" on public.project_parties for insert to authenticated
  with check (public.is_project_admin_v2(project_id));
drop policy if exists "project_parties_update" on public.project_parties;
create policy "project_parties_update" on public.project_parties for update to authenticated
  using (public.is_project_admin_v2(project_id))
  with check (public.is_project_admin_v2(project_id));
drop policy if exists "project_parties_delete" on public.project_parties;
create policy "project_parties_delete" on public.project_parties for delete to authenticated
  using (public.is_project_admin_v2(project_id));

drop policy if exists "project_memberships_select" on public.project_memberships;
create policy "project_memberships_select" on public.project_memberships for select to authenticated
  using (project_id in (select public.my_project_ids_v2()));
drop policy if exists "project_memberships_insert" on public.project_memberships;
create policy "project_memberships_insert" on public.project_memberships for insert to authenticated
  with check (public.is_project_admin_v2(project_id));
drop policy if exists "project_memberships_update" on public.project_memberships;
create policy "project_memberships_update" on public.project_memberships for update to authenticated
  using (public.is_project_admin_v2(project_id))
  with check (public.is_project_admin_v2(project_id));
drop policy if exists "project_memberships_delete" on public.project_memberships;
create policy "project_memberships_delete" on public.project_memberships for delete to authenticated
  using (public.is_project_admin_v2(project_id));

-- Internal compatibility helper: seed named parties, then mirror one legacy
-- member. Missing/ambiguous party identity becomes an explicit unresolved
-- `other` party with viewer role; creator status never selects a party.
create or replace function public.ensure_legacy_project_identity(
  p_project uuid,
  p_user uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  project_row public.projects%rowtype;
  legacy_org_type text;
  legacy_member_role text;
  desired_key text;
  scoped_role text;
  party_id uuid;
begin
  select * into project_row from public.projects where id = p_project;
  if not found then return; end if;

  if nullif(trim(project_row.owner_name), '') is not null then
    insert into public.project_parties
      (project_id, party_type, display_name, migration_key)
    values (p_project, 'agency', trim(project_row.owner_name), 'legacy:agency')
    on conflict (project_id, migration_key) do nothing;
  end if;
  if nullif(trim(project_row.contractor_name), '') is not null then
    insert into public.project_parties
      (project_id, party_type, display_name, migration_key)
    values (p_project, 'contractor', trim(project_row.contractor_name), 'legacy:contractor')
    on conflict (project_id, migration_key) do nothing;
  end if;
  if nullif(trim(project_row.supervisor_name), '') is not null then
    insert into public.project_parties
      (project_id, party_type, display_name, migration_key)
    values (p_project, 'supervisor', trim(project_row.supervisor_name), 'legacy:supervisor')
    on conflict (project_id, migration_key) do nothing;
  end if;

  select pm.role, pr.org_type
  into legacy_member_role, legacy_org_type
  from public.project_members pm
  left join public.profiles pr on pr.id = pm.user_id
  where pm.project_id = p_project and pm.user_id = p_user;
  if not found then return; end if;

  desired_key := case legacy_org_type
    when 'owner' then 'legacy:agency'
    when 'supervisor' then 'legacy:supervisor'
    when 'contractor' then 'legacy:contractor'
    else null
  end;

  select id into party_id from public.project_parties
  where project_id = p_project and migration_key = desired_key;

  if party_id is null then
    insert into public.project_parties
      (project_id, party_type, display_name, migration_key)
    values (p_project, 'other', '未分類（待確認）', 'legacy:unresolved')
    on conflict (project_id, migration_key) do nothing;
    select id into party_id from public.project_parties
    where project_id = p_project and migration_key = 'legacy:unresolved';
    scoped_role := 'viewer';
  else
    scoped_role := case legacy_org_type
      when 'owner' then 'agency_engineer'
      when 'supervisor' then 'supervisor_engineer'
      else 'contractor_pm'
    end;
  end if;

  insert into public.project_memberships
    (project_id, user_id, project_party_id, project_role, is_project_admin)
  values (
    p_project, p_user, party_id, scoped_role,
    coalesce(legacy_member_role = 'admin', false)
  )
  on conflict (project_id, user_id) do nothing;
end; $$;
revoke all on function public.ensure_legacy_project_identity(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.migrate_legacy_project_identities()
returns void language plpgsql security definer set search_path = public as $$
declare
  legacy_project record;
  legacy record;
begin
  -- Seed named parties even for an anomalous legacy project with no members.
  for legacy_project in
    select id, owner_name, contractor_name, supervisor_name from public.projects
  loop
    if nullif(trim(legacy_project.owner_name), '') is not null then
      insert into public.project_parties
        (project_id, party_type, display_name, migration_key)
      values (legacy_project.id, 'agency', trim(legacy_project.owner_name), 'legacy:agency')
      on conflict (project_id, migration_key) do nothing;
    end if;
    if nullif(trim(legacy_project.contractor_name), '') is not null then
      insert into public.project_parties
        (project_id, party_type, display_name, migration_key)
      values (legacy_project.id, 'contractor', trim(legacy_project.contractor_name), 'legacy:contractor')
      on conflict (project_id, migration_key) do nothing;
    end if;
    if nullif(trim(legacy_project.supervisor_name), '') is not null then
      insert into public.project_parties
        (project_id, party_type, display_name, migration_key)
      values (legacy_project.id, 'supervisor', trim(legacy_project.supervisor_name), 'legacy:supervisor')
      on conflict (project_id, migration_key) do nothing;
    end if;
  end loop;

  for legacy in select project_id, user_id from public.project_members loop
    perform public.ensure_legacy_project_identity(legacy.project_id, legacy.user_id);
  end loop;
end; $$;
revoke all on function public.migrate_legacy_project_identities()
  from public, anon, authenticated;

select public.migrate_legacy_project_identities();

-- Keep project creation dual-writing both membership models during P0-02.
create or replace function public.add_creator_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then return new; end if;
  insert into public.project_members(project_id, user_id, role)
  values (new.id, new.created_by, 'admin') on conflict do nothing;
  perform public.ensure_legacy_project_identity(new.id, new.created_by);
  return new;
end; $$;

-- Complete the P0-01 deferred Requirement responsibility relationship.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirements_responsible_project_party_fk'
      and conrelid = 'public.requirements'::regclass
  ) then
    alter table public.requirements
      add constraint requirements_responsible_project_party_fk
      foreign key (responsible_project_party_id)
      references public.project_parties(id) on delete set null;
  end if;
end; $$;

create or replace function public.validate_requirement_project_party()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.responsible_project_party_id is not null and not exists (
    select 1 from public.project_parties pp
    where pp.id = new.responsible_project_party_id
      and pp.project_id = new.project_id
  ) then
    raise exception 'requirement and responsible project party must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_responsible_party_same_project on public.requirements;
create trigger requirements_responsible_party_same_project
  before insert or update on public.requirements for each row
  execute function public.validate_requirement_project_party();
-- -- End P0-02 core ----------------------------------------------------------

-- Compatibility RPCs below dual-write/list both membership models. Their
-- matching definitions also live in supabase/schema.sql.

-- -- P0-02 compatibility member RPCs ----------------------------------------
create or replace function public.add_member_by_email(p_project uuid, p_email text, p_role text default 'member')
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.projects where id = p_project and created_by = auth.uid()) then
    raise exception '只有專案建立者可以管理成員';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then return 'not_found'; end if;
  insert into public.project_members (project_id, user_id, role)
  values (p_project, uid, p_role) on conflict do nothing;
  perform public.ensure_legacy_project_identity(p_project, uid);
  return 'ok';
end; $$;
grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;

-- 專案成員清單(名字+組織)——一般成員也看得到團隊名單(僅此專案)。
drop function if exists public.list_project_members(uuid);
create function public.list_project_members(p_project uuid)
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
    and exists (select 1 from public.project_members me
                where me.project_id = p_project and me.user_id = auth.uid())
  order by legacy.created_at
$$;
grant execute on function public.list_project_members(uuid) to authenticated;

-- 建立者移除成員(不能移除自己)
create or replace function public.remove_member(p_project uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.projects where id = p_project and created_by = auth.uid()) then
    raise exception '只有專案建立者可以管理成員';
  end if;
  if p_user = auth.uid() then raise exception '不能移除自己'; end if;
  delete from public.project_memberships where project_id = p_project and user_id = p_user;
  delete from public.project_members where project_id = p_project and user_id = p_user;
end; $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
-- -- End P0-02 compatibility member RPCs ------------------------------------
