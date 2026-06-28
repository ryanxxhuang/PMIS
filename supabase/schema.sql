-- ============================================================================
--  PMIS — Supabase schema (single source of truth)
-- ----------------------------------------------------------------------------
--  Idempotent: safe to run on a fresh project or to re-sync an existing one.
--  Paste the whole file into Supabase Studio → SQL Editor → Run.
--
--  Security model: every table has Row Level Security. A user only sees rows
--  for projects they belong to (project_members). is_project_member() is the
--  shared, SECURITY DEFINER predicate reused by every policy.
-- ============================================================================

-- ── Helper: project membership check (reused by all RLS policies) ───────────
create or replace function public.is_project_member(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p and m.user_id = auth.uid()
  );
$$;

-- ── Profiles (extends auth.users) ───────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  company    text,
  org_type   text not null default 'contractor' check (org_type in ('contractor','supervisor','owner')),
  role       text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- Auto-create a profile from sign-up metadata.
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
  ) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ── Projects + membership ───────────────────────────────────────────────────
create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  code            text,
  owner_name      text,
  contractor_name text,
  supervisor_name text,
  location        text,
  start_date      date,
  end_date        date,
  status          text default '施工中',
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid references public.projects(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  role       text,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.projects        enable row level security;
alter table public.project_members enable row level security;

drop policy if exists "projects_select_members" on public.projects;
create policy "projects_select_members" on public.projects
  for select to authenticated using (public.is_project_member(id));
drop policy if exists "projects_insert_self" on public.projects;
create policy "projects_insert_self" on public.projects
  for insert to authenticated with check (auth.uid() = created_by);
drop policy if exists "projects_update_creator" on public.projects;
create policy "projects_update_creator" on public.projects
  for update to authenticated using (created_by = auth.uid());

drop policy if exists "members_select_own" on public.project_members;
create policy "members_select_own" on public.project_members
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "members_manage_by_creator" on public.project_members;
create policy "members_manage_by_creator" on public.project_members for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()));

-- Add the creator as an admin member on project insert.
create or replace function public.add_creator_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members(project_id, user_id, role)
  values (new.id, new.created_by, 'admin') on conflict do nothing;
  return new;
end; $$;
drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects for each row execute function public.add_creator_as_member();

-- ── Work items (BOQ / WBS) — the spine everything hangs off ─────────────────
create table if not exists public.work_items (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  parent_id     uuid references public.work_items(id) on delete cascade,
  item_key      text,                          -- PCCES itemKey (unique within a budget)
  item_no       text,                          -- e.g. 壹.一.6.3.28
  ref_item_code text,                          -- PCCES code → unit-price analysis / spec section
  item_kind     text,                          -- mainItem | general | analysis | subtotal | variablePrice | formula
  description   text not null,
  unit          text,
  quantity      numeric,
  unit_price    numeric,
  amount        numeric,
  section       text,                          -- top division (壹/貳/參/肆)
  depth         int,
  sort_order    int,
  is_leaf       boolean default false,
  is_rollup     boolean default false,         -- subtotal/formula rows excluded from sums
  is_price_adjustable boolean default false,   -- variablePrice (price-adjustment items)
  is_billable   boolean default true,          -- 發包工程費 vs non-billable indirect/owner costs
  weight        numeric,                        -- amount / billable total (progress weighting)
  remark        text,
  qty_completed numeric default 0,
  created_at    timestamptz not null default now()
);
create index if not exists work_items_project_idx on public.work_items(project_id);
create index if not exists work_items_parent_idx  on public.work_items(parent_id);
alter table public.work_items enable row level security;
drop policy if exists "work_items_members_all" on public.work_items;
create policy "work_items_members_all" on public.work_items for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

-- ── Valuations (progress billing) ───────────────────────────────────────────
create table if not exists public.valuations (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  period_no     int not null,
  period_start  date,
  period_end    date,
  valuation_date date,
  retention_pct numeric not null default 5,
  status        text not null default '草稿',   -- 草稿 | 送審 | 監造審核 | 已核定 | 已請款
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (project_id, period_no)
);
create table if not exists public.valuation_items (
  id            uuid primary key default gen_random_uuid(),
  valuation_id  uuid not null references public.valuations(id) on delete cascade,
  work_item_id  uuid not null references public.work_items(id) on delete cascade,
  cum_qty       numeric default 0,             -- cumulative completed quantity (the input)
  cum_pct       numeric,                        -- derived: cum_qty / contract qty
  amount_cum    numeric,                        -- derived: amount × cum_qty / qty
  amount_period numeric,
  source        text not null default 'manual', -- manual | daily_log
  note          text,
  unique (valuation_id, work_item_id)
);
create index if not exists valuations_project_idx on public.valuations(project_id);
create index if not exists valuation_items_val_idx on public.valuation_items(valuation_id);
alter table public.valuations      enable row level security;
alter table public.valuation_items enable row level security;
drop policy if exists "valuations_members_all" on public.valuations;
create policy "valuations_members_all" on public.valuations for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));
drop policy if exists "valuation_items_members_all" on public.valuation_items;
create policy "valuation_items_members_all" on public.valuation_items for all to authenticated
  using (exists (select 1 from public.valuations v where v.id = valuation_id and public.is_project_member(v.project_id)))
  with check (exists (select 1 from public.valuations v where v.id = valuation_id and public.is_project_member(v.project_id)));

-- ── Planned schedule (S-curve baseline) ─────────────────────────────────────
create table if not exists public.schedule_periods (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  period_label text not null,                   -- YYYY-MM
  period_end   date,
  planned_pct  numeric not null default 0,
  created_at   timestamptz not null default now(),
  unique (project_id, period_label)
);
create index if not exists schedule_periods_project_idx on public.schedule_periods(project_id);
alter table public.schedule_periods enable row level security;
drop policy if exists "schedule_periods_members_all" on public.schedule_periods;
create policy "schedule_periods_members_all" on public.schedule_periods for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

-- ── Daily site logs (feed valuations) ───────────────────────────────────────
create table if not exists public.daily_logs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  log_date     date not null,
  weather      text,
  work_summary text,
  status       text not null default '草稿',
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (project_id, log_date)
);
create table if not exists public.daily_log_items (
  id           uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references public.daily_logs(id) on delete cascade,
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  qty_today    numeric not null default 0,
  note         text,
  unique (daily_log_id, work_item_id)
);
create index if not exists daily_logs_project_idx on public.daily_logs(project_id);
create index if not exists daily_log_items_log_idx on public.daily_log_items(daily_log_id);
alter table public.daily_logs      enable row level security;
alter table public.daily_log_items enable row level security;
drop policy if exists "daily_logs_members_all" on public.daily_logs;
create policy "daily_logs_members_all" on public.daily_logs for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));
drop policy if exists "daily_log_items_members_all" on public.daily_log_items;
create policy "daily_log_items_members_all" on public.daily_log_items for all to authenticated
  using (exists (select 1 from public.daily_logs d where d.id = daily_log_id and public.is_project_member(d.project_id)))
  with check (exists (select 1 from public.daily_logs d where d.id = daily_log_id and public.is_project_member(d.project_id)));

-- ── Quality: inspections + defects (three-tier QC) ──────────────────────────
create table if not exists public.inspections (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  work_item_id    uuid references public.work_items(id) on delete set null,
  title           text not null,
  location        text,
  inspection_type text,
  requested_date  date,
  requested_by    uuid references auth.users(id),
  status          text not null default '待查驗', -- 待查驗 | 合格 | 不合格
  result_note     text,
  inspected_by    uuid references auth.users(id),
  inspected_at    timestamptz,
  created_at      timestamptz not null default now()
);
create table if not exists public.defects (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  inspection_id    uuid references public.inspections(id) on delete set null,
  work_item_id     uuid references public.work_items(id) on delete set null,
  title            text not null,
  description      text,
  severity         text default '一般',          -- 輕微 | 一般 | 嚴重
  location         text,
  status           text not null default '開立',  -- 開立 | 改善中 | 待複查 | 已結案
  due_date         date,
  improvement_note text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  closed_at        timestamptz
);
create index if not exists inspections_project_idx on public.inspections(project_id);
create index if not exists defects_project_idx on public.defects(project_id);
alter table public.inspections enable row level security;
alter table public.defects     enable row level security;
drop policy if exists "inspections_members_all" on public.inspections;
create policy "inspections_members_all" on public.inspections for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));
drop policy if exists "defects_members_all" on public.defects;
create policy "defects_members_all" on public.defects for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

-- ── RPCs (SECURITY DEFINER) ─────────────────────────────────────────────────
-- Create a project and add the caller as its admin member, atomically.
create or replace function public.create_project(
  p_name text, p_code text default null, p_owner text default null,
  p_contractor text default null, p_supervisor text default null,
  p_location text default null, p_start date default null, p_end date default null
) returns public.projects language plpgsql security definer set search_path = public as $$
declare new_row public.projects;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.projects
    (name, code, owner_name, contractor_name, supervisor_name, location, start_date, end_date, created_by)
  values (p_name, p_code, p_owner, p_contractor, p_supervisor, p_location, p_start, p_end, auth.uid())
  returning * into new_row;
  insert into public.project_members (project_id, user_id, role)
  values (new_row.id, auth.uid(), 'admin') on conflict do nothing;
  return new_row;
end; $$;
grant execute on function public.create_project(text,text,text,text,text,text,date,date) to authenticated;

-- Delete a project (and everything it cascades to). Members only.
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_project_member(p_id) then raise exception 'not a project member'; end if;
  delete from public.projects where id = p_id;
end; $$;
grant execute on function public.delete_project(uuid) to authenticated;
