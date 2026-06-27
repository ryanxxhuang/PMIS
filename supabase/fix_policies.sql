-- ============================================================
-- PMIS AI — 權限修復（idempotent）
-- 症狀：建立專案時 "new row violates row-level security policy for table projects"。
-- 原因：setup_all.sql 半套用 → 表已建、RLS 已開，但部分 policy 沒建起來
--       （create policy 不是 idempotent，重跑或中途出錯會中斷）。
-- 本檔可安全重複執行：先 drop if exists 再重建所有 policy / function / trigger。
-- 不動任何資料表與資料。Supabase → SQL Editor → 貼上 → Run。
-- ============================================================

-- ── 確保 RLS 都開著 ──────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.projects          enable row level security;
alter table public.project_members   enable row level security;
alter table public.documents         enable row level security;
alter table public.requirements      enable row level security;
alter table public.work_items        enable row level security;
alter table public.valuations        enable row level security;
alter table public.valuation_items   enable row level security;
alter table public.schedule_periods  enable row level security;

-- ── 輔助函式（create or replace 本身 idempotent）─────────────────
create or replace function public.is_project_member(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p and m.user_id = auth.uid()
  );
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, company, org_type, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'company', ''),
    coalesce(new.raw_user_meta_data->>'org_type', 'contractor'),
    coalesce(new.raw_user_meta_data->>'role', '')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create or replace function public.add_creator_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members(project_id, user_id, role)
  values (new.id, new.created_by, 'admin')
  on conflict do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects for each row execute function public.add_creator_as_member();

-- ── profiles ─────────────────────────────────────────────────────
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- ── projects ─────────────────────────────────────────────────────
drop policy if exists "projects_select_members" on public.projects;
create policy "projects_select_members"
  on public.projects for select to authenticated using (public.is_project_member(id));

drop policy if exists "projects_insert_self" on public.projects;
create policy "projects_insert_self"
  on public.projects for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "projects_update_creator" on public.projects;
create policy "projects_update_creator"
  on public.projects for update to authenticated using (created_by = auth.uid());

-- ── project_members ──────────────────────────────────────────────
drop policy if exists "members_select_own" on public.project_members;
create policy "members_select_own"
  on public.project_members for select to authenticated using (user_id = auth.uid());

drop policy if exists "members_manage_by_creator" on public.project_members;
create policy "members_manage_by_creator"
  on public.project_members for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()));

-- ── documents ────────────────────────────────────────────────────
drop policy if exists "documents_members_all" on public.documents;
create policy "documents_members_all"
  on public.documents for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- ── requirements ─────────────────────────────────────────────────
drop policy if exists "requirements_members_all" on public.requirements;
create policy "requirements_members_all"
  on public.requirements for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- ── work_items ───────────────────────────────────────────────────
drop policy if exists "work_items_members_all" on public.work_items;
create policy "work_items_members_all"
  on public.work_items for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- ── valuations ───────────────────────────────────────────────────
drop policy if exists "valuations_members_all" on public.valuations;
create policy "valuations_members_all"
  on public.valuations for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- ── valuation_items ──────────────────────────────────────────────
drop policy if exists "valuation_items_members_all" on public.valuation_items;
create policy "valuation_items_members_all"
  on public.valuation_items for all to authenticated
  using (exists (select 1 from public.valuations v where v.id = valuation_id and public.is_project_member(v.project_id)))
  with check (exists (select 1 from public.valuations v where v.id = valuation_id and public.is_project_member(v.project_id)));

-- ── schedule_periods ─────────────────────────────────────────────
drop policy if exists "schedule_periods_members_all" on public.schedule_periods;
create policy "schedule_periods_members_all"
  on public.schedule_periods for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));
