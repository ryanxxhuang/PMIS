-- PMIS AI — 地基 schema（Increment 1）
-- 在 Supabase 後台 → SQL Editor 貼上整段執行一次即可。
-- 涵蓋：帳號 profile、專案、專案成員、契約文件、契約要求。
-- 權限一律由 Row Level Security（RLS）控管：只有專案成員看得到 / 改得到該專案資料。

-- ── 1. 使用者 profile（延伸 auth.users）─────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company   text,
  org_type  text not null default 'contractor' check (org_type in ('contractor','supervisor','owner')),
  role      text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

create policy "profiles_update_own"
  on public.profiles for update to authenticated using (auth.uid() = id);

-- 註冊時自動建立 profile（從註冊時帶的 metadata 取值）
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ── 2. 專案 ────────────────────────────────────────────────────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
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

-- ── 3. 專案成員（誰能進這個專案、擔任什麼角色）──────────────────────
create table if not exists public.project_members (
  project_id uuid references public.projects(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  role       text,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- 是否為某專案成員（給其他表的 RLS 重用；security definer 避免遞迴）
create or replace function public.is_project_member(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p and m.user_id = auth.uid()
  );
$$;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create policy "projects_select_members"
  on public.projects for select to authenticated using (public.is_project_member(id));

create policy "projects_insert_self"
  on public.projects for insert to authenticated with check (auth.uid() = created_by);

create policy "projects_update_creator"
  on public.projects for update to authenticated using (created_by = auth.uid());

create policy "members_select_own"
  on public.project_members for select to authenticated using (user_id = auth.uid());

create policy "members_manage_by_creator"
  on public.project_members for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()));

-- 建立專案時，自動把建立者加為 admin 成員
create or replace function public.add_creator_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members(project_id, user_id, role)
  values (new.id, new.created_by, 'admin')
  on conflict do nothing;
  return new;
end; $$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects for each row execute function public.add_creator_as_member();

-- ── 4. 契約文件（檔案存 Supabase Storage，這裡存 metadata + 路徑）──
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  type         text,
  version      text default 'v1',
  storage_path text,
  uploaded_by  uuid references auth.users(id),
  ai_processed boolean default false,
  status       text default '已上傳',
  created_at   timestamptz not null default now()
);

alter table public.documents enable row level security;
create policy "documents_members_all"
  on public.documents for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- ── 5. 契約要求（之後接 AI；現階段可手動 / 半自動建立）─────────────
create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  document_id     uuid references public.documents(id) on delete set null,
  title           text not null,
  requirement_type text,
  work_item       text,
  required_role   text,
  reviewer_role   text,
  required_form   text,
  required_photo  boolean default false,
  frequency       text,
  source_page     text,
  source_section  text,
  confidence_score numeric,
  status          text default 'Review',
  created_at      timestamptz not null default now()
);

alter table public.requirements enable row level security;
create policy "requirements_members_all"
  on public.requirements for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- 之後的 increment 會再加：itp / forms / inspections / defects /
-- daily_logs / submittals / rfis / audit / photos（沿用同一套 RLS 模式）
