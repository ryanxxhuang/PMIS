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


-- 目前使用者所屬專案(RLS 熱路徑:無參數+STABLE → planner 以 initplan 快取一次;
-- SECURITY DEFINER → 不觸發 project_members 自身 policy,避免遞迴)
create or replace function public.my_project_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select project_id from public.project_members where user_id = auth.uid();
$$;

-- ── 伺服器端 RBAC helpers ────────────────────────────────────────────────────
-- 角色模型與前端 store 的 `can` 對齊:org_type 來自 profiles(公司身分,跨專案一致),
-- admin=專案建立者或 member role='admin'(單人/自家團隊不被 org_type 卡死)。
-- 規則:機關(owner)唯讀;核准動作(估驗核定/查驗判定/缺失結案/送審審定)由
-- trigger 保護只有監造能做——RLS 管「誰能碰這列」,trigger 管「誰能做這種狀態轉移」。

-- 目前使用者的組織別(無 profile 時視為 contractor,與前端預設一致)
create or replace function public.my_org_type()
returns text language sql security definer stable set search_path = public as $$
  select coalesce((select org_type from public.profiles where id = auth.uid()), 'contractor');
$$;

-- 專案管理者:建立者,或 project_members.role='admin'
create or replace function public.is_project_admin(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p and m.user_id = auth.uid() and m.role = 'admin'
  ) or exists (
    select 1 from public.projects pr where pr.id = p and pr.created_by = auth.uid()
  );
$$;

-- 日常填報資料的寫入權:專案成員且非機關(機關唯讀);admin 一律可
create or replace function public.can_write(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p in (select public.my_project_ids())
     and (public.is_project_admin(p) or public.my_org_type() <> 'owner');
$$;

-- 廠商內部資料(成本/毛利=商業機密):只有廠商成員或 admin 可讀寫
create or replace function public.can_access_contractor_private(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p in (select public.my_project_ids())
     and (public.is_project_admin(p) or public.my_org_type() = 'contractor');
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
  for select to authenticated using (id in (select public.my_project_ids()));
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
drop policy if exists "work_items_select" on public.work_items;
create policy "work_items_select" on public.work_items for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "work_items_insert" on public.work_items;
create policy "work_items_insert" on public.work_items for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "work_items_update" on public.work_items;
create policy "work_items_update" on public.work_items for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "work_items_delete" on public.work_items;
create policy "work_items_delete" on public.work_items for delete to authenticated
  using (public.can_write(project_id));

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
drop policy if exists "valuations_select" on public.valuations;
create policy "valuations_select" on public.valuations for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "valuations_insert" on public.valuations;
create policy "valuations_insert" on public.valuations for insert to authenticated
  with check (public.can_write(project_id));
-- update 開放給所有成員(機關要登錄請款/撥款欄位);「誰能改哪些欄位/狀態」
-- 由 valuations_guard trigger 強制(核定=監造、機關僅撥款欄)。
drop policy if exists "valuations_update" on public.valuations;
create policy "valuations_update" on public.valuations for update to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));
drop policy if exists "valuations_delete" on public.valuations;
create policy "valuations_delete" on public.valuations for delete to authenticated
  using (public.can_write(project_id));
drop policy if exists "valuation_items_members_all" on public.valuation_items;
drop policy if exists "valuation_items_select" on public.valuation_items;
create policy "valuation_items_select" on public.valuation_items for select to authenticated
  using (valuation_id in (select id from public.valuations));
drop policy if exists "valuation_items_write" on public.valuation_items;
create policy "valuation_items_write" on public.valuation_items for all to authenticated
  using (valuation_id in (select id from public.valuations v where public.can_write(v.project_id)))
  with check (valuation_id in (select id from public.valuations v where public.can_write(v.project_id)));

-- 請款 / 收款追蹤(估驗核定後)
alter table public.valuations
  add column if not exists invoice_date date,    -- 請款日
  add column if not exists paid_date    date,    -- 收款日
  add column if not exists paid_amount  numeric; -- 實收金額

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
drop policy if exists "schedule_periods_select" on public.schedule_periods;
create policy "schedule_periods_select" on public.schedule_periods for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "schedule_periods_insert" on public.schedule_periods;
create policy "schedule_periods_insert" on public.schedule_periods for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "schedule_periods_update" on public.schedule_periods;
create policy "schedule_periods_update" on public.schedule_periods for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "schedule_periods_delete" on public.schedule_periods;
create policy "schedule_periods_delete" on public.schedule_periods for delete to authenticated
  using (public.can_write(project_id));

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
-- 公定格式(工程會「公共工程施工日誌」)欄位:天氣上下午、出工/機具/材料、四~八節
alter table public.daily_logs
  add column if not exists weather_am text,        -- 天氣(上午)
  add column if not exists weather_pm text,        -- 天氣(下午)
  add column if not exists labor      jsonb,       -- [{type,count}] 工別/出工人數
  add column if not exists equipment  jsonb,       -- [{name,count}] 機具/數量
  add column if not exists materials  jsonb,       -- [{name,unit,qty}] 材料使用
  add column if not exists extras     jsonb;       -- {technicians,edu,insured,ppe,safety_other,sampling,notice,important}
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
drop policy if exists "daily_logs_select" on public.daily_logs;
create policy "daily_logs_select" on public.daily_logs for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "daily_logs_insert" on public.daily_logs;
create policy "daily_logs_insert" on public.daily_logs for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "daily_logs_update" on public.daily_logs;
create policy "daily_logs_update" on public.daily_logs for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "daily_logs_delete" on public.daily_logs;
create policy "daily_logs_delete" on public.daily_logs for delete to authenticated
  using (public.can_write(project_id));
drop policy if exists "daily_log_items_members_all" on public.daily_log_items;
drop policy if exists "daily_log_items_select" on public.daily_log_items;
create policy "daily_log_items_select" on public.daily_log_items for select to authenticated
  using (daily_log_id in (select id from public.daily_logs));
drop policy if exists "daily_log_items_write" on public.daily_log_items;
create policy "daily_log_items_write" on public.daily_log_items for all to authenticated
  using (daily_log_id in (select id from public.daily_logs d where public.can_write(d.project_id)))
  with check (daily_log_id in (select id from public.daily_logs d where public.can_write(d.project_id)));

-- ── Photos (site-log evidence; quality photos reuse this table later) ────────
-- Files live in the 'photos' Storage bucket; this row is the metadata + links.
-- Client generates id + storage_path so the mobile app can save offline first
-- and sync later. inspection_id / defect_id are added when quality ships.
create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  daily_log_id uuid references public.daily_logs(id) on delete cascade,
  work_item_id uuid references public.work_items(id) on delete set null,
  storage_path text not null,                  -- object path inside the 'photos' bucket
  caption      text,
  taken_at     timestamptz,                    -- when it was shot on site (≠ uploaded)
  gps_lat      numeric,
  gps_lng      numeric,
  ai_source    boolean not null default false, -- true if a field was filled via whiteboard OCR
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists photos_project_idx   on public.photos(project_id);
create index if not exists photos_daily_log_idx on public.photos(daily_log_id);
alter table public.photos enable row level security;
drop policy if exists "photos_members_all" on public.photos;
drop policy if exists "photos_select" on public.photos;
create policy "photos_select" on public.photos for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "photos_insert" on public.photos;
create policy "photos_insert" on public.photos for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "photos_update" on public.photos;
create policy "photos_update" on public.photos for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "photos_delete" on public.photos;
create policy "photos_delete" on public.photos for delete to authenticated
  using (public.can_write(project_id));

-- ── Storage bucket for photo files + object-level RLS ────────────────────────
-- Object path convention: <project_id>/<daily_log_id>/<photo_id>.jpg — the first
-- folder segment is the project_id, so we reuse is_project_member() to gate access.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "photos_objects_select" on storage.objects;
create policy "photos_objects_select" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_project_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "photos_objects_insert" on storage.objects;
create policy "photos_objects_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.can_write(((storage.foldername(name))[1])::uuid));
drop policy if exists "photos_objects_delete" on storage.objects;
create policy "photos_objects_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.can_write(((storage.foldername(name))[1])::uuid));

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
  markup_path      text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  closed_at        timestamptz
);
create index if not exists inspections_project_idx on public.inspections(project_id);
create index if not exists defects_project_idx on public.defects(project_id);
alter table public.inspections enable row level security;
alter table public.defects     enable row level security;
drop policy if exists "inspections_members_all" on public.inspections;
drop policy if exists "inspections_select" on public.inspections;
create policy "inspections_select" on public.inspections for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "inspections_insert" on public.inspections;
create policy "inspections_insert" on public.inspections for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "inspections_update" on public.inspections;
create policy "inspections_update" on public.inspections for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "inspections_delete" on public.inspections;
create policy "inspections_delete" on public.inspections for delete to authenticated
  using (public.can_write(project_id));
drop policy if exists "defects_members_all" on public.defects;
drop policy if exists "defects_select" on public.defects;
create policy "defects_select" on public.defects for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "defects_insert" on public.defects;
create policy "defects_insert" on public.defects for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "defects_update" on public.defects;
create policy "defects_update" on public.defects for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "defects_delete" on public.defects;
create policy "defects_delete" on public.defects for delete to authenticated
  using (public.can_write(project_id));

-- ── Contract obligations (AI-extracted deadlines + penalties) ───────────────
-- Each row is a time-based duty pulled from the contract. The deadline is stored
-- as a RULE (trigger event + offset days), not an absolute date — the frontend
-- resolves it against the project's anchor dates below, so one parse works for
-- any schedule and recomputes if a date slips.
alter table public.projects
  add column if not exists award_date       date,   -- 決標日
  add column if not exists notice_date       date,   -- 接獲開工通知日
  add column if not exists commencement_date date;   -- 開工日

create table if not exists public.contract_obligations (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  title         text not null,                 -- 應辦事項
  category      text,                          -- 階段:開工前 | 施工中 | 完工 | 保固
  trigger_event text,                          -- award | notice | commencement | completion | monthly | fixed | other
  offset_days   int,                           -- 期限天數(相對觸發點)
  offset_dir    text default 'after',          -- before | after
  fixed_date    date,                          -- trigger_event='fixed' 時的絕對日期
  recurring     text,                          -- null | monthly …(可重複義務)
  recurring_day int,                           -- 每月幾號(recurring='monthly')
  responsible   text,                          -- 廠商 | 監造 | 機關
  penalty       text,                          -- 罰則描述(逾期/未提送的後果)
  source_clause text,                          -- 出處條款,如 §12.4
  source_page   text,                          -- 頁碼
  status        text not null default '待辦',  -- 待辦 | 已提送 | 已完成 | 不適用(逾期由到期日推算)
  note          text,
  sort_order    int,
  created_at    timestamptz not null default now()
);
create index if not exists contract_obligations_project_idx on public.contract_obligations(project_id);
alter table public.contract_obligations enable row level security;
drop policy if exists "contract_obligations_members_all" on public.contract_obligations;
drop policy if exists "contract_obligations_select" on public.contract_obligations;
create policy "contract_obligations_select" on public.contract_obligations for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "contract_obligations_insert" on public.contract_obligations;
create policy "contract_obligations_insert" on public.contract_obligations for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "contract_obligations_update" on public.contract_obligations;
create policy "contract_obligations_update" on public.contract_obligations for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "contract_obligations_delete" on public.contract_obligations;
create policy "contract_obligations_delete" on public.contract_obligations for delete to authenticated
  using (public.can_write(project_id));

-- -- P0-01: first-class requirement domain -----------------------------------
-- Requirements are the shared contractual root. contract_obligations remains
-- as a deadline-specific compatibility extension so the current contract UI,
-- alerts, reminders, and due-date calculations keep their existing shape.
create table if not exists public.requirements (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  title                  text not null,
  description            text,
  requirement_type       text not null default 'other'
    check (requirement_type in ('deadline','submittal','inspection','test','checklist','evidence','photo','report','other')),
  responsible_party_type text,
  lifecycle_phase        text,
  trigger_type           text,
  trigger_config         jsonb not null default '{}'::jsonb
    check (jsonb_typeof(trigger_config) = 'object'),
  frequency_type         text,
  frequency_config       jsonb not null default '{}'::jsonb
    check (jsonb_typeof(frequency_config) = 'object'),
  acceptance_criteria    text,
  evidence_requirement   text,
  status                 text not null default '待辦',
  confidence             numeric check (confidence between 0 and 1),
  ai_generated           boolean not null default false,
  reviewed_by            uuid references auth.users(id) on delete set null,
  reviewed_at            timestamptz,
  is_authoritative       boolean generated always as
    (not ai_generated or reviewed_at is not null) stored,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists requirements_project_idx on public.requirements(project_id);
create index if not exists requirements_project_type_idx on public.requirements(project_id, requirement_type);
create index if not exists requirements_authoritative_idx on public.requirements(project_id)
  where is_authoritative;

create or replace function public.touch_requirement_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;
drop trigger if exists requirements_touch_updated_at on public.requirements;
create trigger requirements_touch_updated_at
  before update on public.requirements for each row
  execute function public.touch_requirement_updated_at();

alter table public.requirements enable row level security;
drop policy if exists "requirements_select" on public.requirements;
create policy "requirements_select" on public.requirements for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "requirements_insert" on public.requirements;
create policy "requirements_insert" on public.requirements for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "requirements_update" on public.requirements;
create policy "requirements_update" on public.requirements for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "requirements_delete" on public.requirements;
create policy "requirements_delete" on public.requirements for delete to authenticated
  using (public.can_write(project_id));

-- Consumers that need approved contractual truth should use this view rather
-- than treating unreviewed model output as authoritative.
create or replace view public.authoritative_requirements
with (security_invoker = true) as
  select * from public.requirements where is_authoritative;

create table if not exists public.requirement_sources (
  id                  uuid primary key default gen_random_uuid(),
  requirement_id      uuid not null references public.requirements(id) on delete cascade,
  -- P0-05 will add the FK when document_versions becomes a first-class table.
  document_version_id uuid,
  page_number         int check (page_number is null or page_number > 0),
  page_label          text,
  section             text,
  clause              text,
  source_text         text,
  source_start_offset int check (source_start_offset is null or source_start_offset >= 0),
  source_end_offset   int,
  created_at          timestamptz not null default now(),
  check (
    source_end_offset is null
    or (source_end_offset >= 0 and source_end_offset >= coalesce(source_start_offset, 0))
  )
);
create index if not exists requirement_sources_requirement_idx on public.requirement_sources(requirement_id);
create index if not exists requirement_sources_document_version_idx on public.requirement_sources(document_version_id);
alter table public.requirement_sources enable row level security;
drop policy if exists "requirement_sources_select" on public.requirement_sources;
create policy "requirement_sources_select" on public.requirement_sources for select to authenticated
  using (requirement_id in (
    select id from public.requirements where project_id in (select public.my_project_ids())
  ));
drop policy if exists "requirement_sources_insert" on public.requirement_sources;
create policy "requirement_sources_insert" on public.requirement_sources for insert to authenticated
  with check (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));
drop policy if exists "requirement_sources_update" on public.requirement_sources;
create policy "requirement_sources_update" on public.requirement_sources for update to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  )) with check (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));
drop policy if exists "requirement_sources_delete" on public.requirement_sources;
create policy "requirement_sources_delete" on public.requirement_sources for delete to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));

create table if not exists public.requirement_work_items (
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  work_item_id   uuid not null references public.work_items(id) on delete cascade,
  match_type     text not null check (match_type in ('ai','code','description','manual')),
  confidence     numeric check (confidence between 0 and 1),
  reviewed       boolean not null default false,
  created_at     timestamptz not null default now(),
  primary key (requirement_id, work_item_id)
);
create index if not exists requirement_work_items_work_item_idx on public.requirement_work_items(work_item_id);

create or replace function public.validate_requirement_work_item_project()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (
    select 1
    from public.requirements r
    join public.work_items w on w.id = new.work_item_id
    where r.id = new.requirement_id and r.project_id = w.project_id
  ) then
    raise exception 'requirement and work item must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists requirement_work_items_same_project on public.requirement_work_items;
create trigger requirement_work_items_same_project
  before insert or update on public.requirement_work_items for each row
  execute function public.validate_requirement_work_item_project();

alter table public.requirement_work_items enable row level security;
drop policy if exists "requirement_work_items_select" on public.requirement_work_items;
create policy "requirement_work_items_select" on public.requirement_work_items for select to authenticated
  using (requirement_id in (
    select id from public.requirements where project_id in (select public.my_project_ids())
  ));
drop policy if exists "requirement_work_items_insert" on public.requirement_work_items;
create policy "requirement_work_items_insert" on public.requirement_work_items for insert to authenticated
  with check (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));
drop policy if exists "requirement_work_items_update" on public.requirement_work_items;
create policy "requirement_work_items_update" on public.requirement_work_items for update to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  )) with check (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));
drop policy if exists "requirement_work_items_delete" on public.requirement_work_items;
create policy "requirement_work_items_delete" on public.requirement_work_items for delete to authenticated
  using (requirement_id in (
    select id from public.requirements where public.can_write(project_id)
  ));

-- Compatibility link: a legacy deadline and its root requirement deliberately
-- share the same UUID. This makes the conversion deterministic and idempotent.
alter table public.contract_obligations
  add column if not exists requirement_id uuid;

create or replace function public.upsert_contract_obligation_requirement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.requirement_id = new.id;

  insert into public.requirements (
    id, project_id, title, description, requirement_type,
    responsible_party_type, lifecycle_phase, trigger_type, trigger_config,
    frequency_type, frequency_config, status, ai_generated, created_at
  ) values (
    new.id,
    new.project_id,
    new.title,
    new.note,
    'deadline',
    new.responsible,
    new.category,
    new.trigger_event,
    jsonb_strip_nulls(jsonb_build_object(
      'offset_days', new.offset_days,
      'offset_dir', new.offset_dir,
      'fixed_date', new.fixed_date
    )),
    new.recurring,
    case when new.recurring_day is null then '{}'::jsonb
      else jsonb_build_object('day', new.recurring_day) end,
    new.status,
    true,
    coalesce(new.created_at, now())
  )
  on conflict (id) do update set
    project_id = excluded.project_id,
    title = excluded.title,
    description = excluded.description,
    requirement_type = 'deadline',
    responsible_party_type = excluded.responsible_party_type,
    lifecycle_phase = excluded.lifecycle_phase,
    trigger_type = excluded.trigger_type,
    trigger_config = excluded.trigger_config,
    frequency_type = excluded.frequency_type,
    frequency_config = excluded.frequency_config,
    status = excluded.status;

  if new.source_clause is not null or new.source_page is not null then
    insert into public.requirement_sources (
      id, requirement_id, page_number, page_label, clause
    ) values (
      new.id,
      new.id,
      nullif(substring(new.source_page from '([0-9]+)'), '')::int,
      new.source_page,
      new.source_clause
    )
    on conflict (id) do update set
      requirement_id = excluded.requirement_id,
      page_number = excluded.page_number,
      page_label = excluded.page_label,
      clause = excluded.clause;
  end if;

  return new;
end; $$;
drop trigger if exists contract_obligations_sync_requirement on public.contract_obligations;
create trigger contract_obligations_sync_requirement
  before insert or update on public.contract_obligations for each row
  execute function public.upsert_contract_obligation_requirement();

-- Existing rows are converted once. Re-running this schema does not duplicate
-- requirements because both the root and initial source use deterministic IDs.
update public.contract_obligations o
set requirement_id = o.id
where o.requirement_id is distinct from o.id
   or not exists (select 1 from public.requirements r where r.id = o.id);

create unique index if not exists contract_obligations_requirement_uidx
  on public.contract_obligations(requirement_id);
alter table public.contract_obligations alter column requirement_id set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contract_obligations_requirement_fk'
      and conrelid = 'public.contract_obligations'::regclass
  ) then
    alter table public.contract_obligations
      add constraint contract_obligations_requirement_fk
      foreign key (requirement_id) references public.requirements(id) on delete cascade;
  end if;
end; $$;

-- Deleting through the legacy extension also removes its unreviewed deadline
-- root. Human-reviewed requirements survive legacy parser replacement so AI
-- reprocessing cannot silently destroy reviewed contractual data. During a
-- root-originated cascade the parent is already invisible, so no second delete
-- is attempted.
create or replace function public.delete_legacy_requirement_root()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.requirement_id is not null and exists (
    select 1 from public.requirements
    where id = old.requirement_id and reviewed_at is null
  ) then
    delete from public.requirements where id = old.requirement_id;
  end if;
  return old;
end; $$;
drop trigger if exists contract_obligations_delete_requirement on public.contract_obligations;
create trigger contract_obligations_delete_requirement
  after delete on public.contract_obligations for each row
  execute function public.delete_legacy_requirement_root();

-- ── Cost management (budget vs actual, subcontracting, gross margin) ─────────
-- A contractor's profit ledger. Revenue = the billable BOQ total (發包工程費);
-- this table holds the COST side. Each row is a budgeted vs actual cost line,
-- categorised; a 分包 (subcontract) is just a row with category='分包' + vendor.
-- 毛利 = 合約收入 − Σ 成本; the page derives budget/actual margin from these rows.
create table if not exists public.cost_items (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  category      text not null default '其他',   -- 材料 | 人工 | 機具 | 分包 | 管理費 | 其他
  title         text not null,                  -- 成本項目 / 分包工程名稱
  vendor        text,                           -- 供應商 / 分包商
  budget_amount numeric default 0,              -- 預算成本(發包前估算)
  actual_amount numeric default 0,              -- 實際成本(已發生 / 已付)
  status        text not null default '進行中',  -- 進行中 | 已結算
  note          text,
  sort_order    int,
  created_at    timestamptz not null default now()
);
create index if not exists cost_items_project_idx on public.cost_items(project_id);
alter table public.cost_items enable row level security;
-- 成本/毛利=廠商商業機密:監造/機關連「讀」都不行(側欄本來就不給看,這裡是伺服器端落實)
drop policy if exists "cost_items_members_all" on public.cost_items;
drop policy if exists "cost_items_contractor_only" on public.cost_items;
create policy "cost_items_contractor_only" on public.cost_items for all to authenticated
  using (public.can_access_contractor_private(project_id))
  with check (public.can_access_contractor_private(project_id));

-- ── Change orders (變更設計 / 追加減帳) ──────────────────────────────────────
-- A formal contract amendment and its added/reduced work-item lines. Only 核准
-- change orders count toward the revised contract sum. Line amounts are stored
-- denormalised (item_no/desc/unit/qty_delta/unit_price/amount_delta) so a CO
-- survives a BOQ re-import even though work_item_id is set null on delete.
create table if not exists public.change_orders (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  co_no      text,                            -- 變更編號 (第1次變更…)
  title      text not null,                   -- 事由 / 名稱
  co_date    date,
  status     text not null default '提出',    -- 提出 | 審核中 | 核准 | 駁回
  reason     text,
  sort_order int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.change_order_items (
  id              uuid primary key default gen_random_uuid(),
  change_order_id uuid not null references public.change_orders(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  work_item_id    uuid references public.work_items(id) on delete set null, -- 連既有工項(選填)
  item_no         text,
  description     text not null,
  unit            text,
  qty_delta       numeric default 0,          -- 追加為正、減帳為負
  unit_price      numeric default 0,
  amount_delta    numeric default 0,          -- = qty_delta × unit_price
  note            text,
  sort_order      int,
  created_at      timestamptz not null default now()
);
create index if not exists change_orders_project_idx on public.change_orders(project_id);
create index if not exists change_order_items_co_idx on public.change_order_items(change_order_id);
alter table public.change_orders      enable row level security;
alter table public.change_order_items enable row level security;
drop policy if exists "change_orders_members_all" on public.change_orders;
drop policy if exists "change_orders_select" on public.change_orders;
create policy "change_orders_select" on public.change_orders for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "change_orders_insert" on public.change_orders;
create policy "change_orders_insert" on public.change_orders for insert to authenticated
  with check (public.can_write(project_id));
-- update 開放給所有成員(機關要做契約級核定:核准/駁回);欄位與狀態轉移
-- 由 change_orders_guard trigger 強制(核准/駁回=監造/機關;機關僅能改狀態)。
drop policy if exists "change_orders_update" on public.change_orders;
create policy "change_orders_update" on public.change_orders for update to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));
drop policy if exists "change_orders_delete" on public.change_orders;
create policy "change_orders_delete" on public.change_orders for delete to authenticated
  using (public.can_write(project_id));
drop policy if exists "change_order_items_members_all" on public.change_order_items;
drop policy if exists "change_order_items_select" on public.change_order_items;
create policy "change_order_items_select" on public.change_order_items for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "change_order_items_insert" on public.change_order_items;
create policy "change_order_items_insert" on public.change_order_items for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "change_order_items_update" on public.change_order_items;
create policy "change_order_items_update" on public.change_order_items for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "change_order_items_delete" on public.change_order_items;
create policy "change_order_items_delete" on public.change_order_items for delete to authenticated
  using (public.can_write(project_id));

-- ── Per-item schedule (逐工項計畫起迄 → per-item 落後) ───────────────────────
-- Kept in its own table (not columns on work_items) so re-importing the BOQ
-- doesn't wipe the schedule. One row per scheduled work item.
create table if not exists public.item_schedules (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  work_item_id   uuid not null references public.work_items(id) on delete cascade,
  planned_start  date,
  planned_finish date,
  created_at     timestamptz not null default now(),
  unique (work_item_id)
);
create index if not exists item_schedules_project_idx on public.item_schedules(project_id);
alter table public.item_schedules enable row level security;
drop policy if exists "item_schedules_members_all" on public.item_schedules;
drop policy if exists "item_schedules_select" on public.item_schedules;
create policy "item_schedules_select" on public.item_schedules for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "item_schedules_insert" on public.item_schedules;
create policy "item_schedules_insert" on public.item_schedules for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "item_schedules_update" on public.item_schedules;
create policy "item_schedules_update" on public.item_schedules for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "item_schedules_delete" on public.item_schedules;
create policy "item_schedules_delete" on public.item_schedules for delete to authenticated
  using (public.can_write(project_id));

-- ── Safety (工安) — self-checks, deficiencies, training, hazard notices ──────
-- One flexible table for the contractor's site-safety log (public-works required).
-- record_type splits the four kinds; 缺失/自主檢查 carry a status flow + due date,
-- 教育訓練/危害告知 are point-in-time records.
create table if not exists public.safety_records (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  record_type text not null default '工安缺失',  -- 自主檢查 | 工安缺失 | 教育訓練 | 危害告知
  title       text not null,
  location    text,
  record_date date,
  severity    text default '一般',              -- 缺失用:輕微 | 一般 | 嚴重
  status      text not null default '待改善',    -- 待改善 | 改善中 | 已完成
  due_date    date,
  note        text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists safety_records_project_idx on public.safety_records(project_id);
alter table public.safety_records enable row level security;
drop policy if exists "safety_records_members_all" on public.safety_records;
drop policy if exists "safety_records_select" on public.safety_records;
create policy "safety_records_select" on public.safety_records for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "safety_records_insert" on public.safety_records;
create policy "safety_records_insert" on public.safety_records for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "safety_records_update" on public.safety_records;
create policy "safety_records_update" on public.safety_records for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "safety_records_delete" on public.safety_records;
create policy "safety_records_delete" on public.safety_records for delete to authenticated
  using (public.can_write(project_id));

-- ── QC: 自主檢查表(範本+紀錄,實測值自動判定)與取樣試驗(試體齡期追蹤) ─────────
create table if not exists public.checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null,
  source      text,                        -- 依據(規範章節)
  items       jsonb not null default '[]', -- [{no,group,item,kind:'num'|'bool',min,max,unit,standard,source}]
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create table if not exists public.checklist_records (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  template_id  uuid references public.checklist_templates(id) on delete cascade,
  check_date   date not null,
  location     text,
  work_item_id uuid references public.work_items(id) on delete set null,
  results      jsonb not null default '{}', -- {no:{value,pass}}
  overall      text,                        -- 合格|不合格(依量化標準自動判定)
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create table if not exists public.test_samples (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  sample_no    text,
  test_item    text not null default '混凝土抗壓',
  fc           numeric,                     -- 設計強度 kgf/cm²
  sampled_date date not null,               -- 取樣(澆置)日
  location     text,
  cylinders    int default 6,
  d7_due       date, d28_due date,          -- 齡期到期日(取樣日 +7/+28)
  d7_value     numeric,                     -- 7天參考值
  d28_values   jsonb,                       -- [28天各試體值] → 依 fc′ 自動判定
  status       text not null default '待試驗', -- 待試驗|合格|不合格
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists checklist_templates_project_idx on public.checklist_templates(project_id);
create index if not exists checklist_records_project_idx   on public.checklist_records(project_id);
create index if not exists checklist_records_template_idx  on public.checklist_records(template_id);
create index if not exists checklist_records_wi_idx        on public.checklist_records(work_item_id);
create index if not exists test_samples_project_idx        on public.test_samples(project_id);
alter table public.checklist_templates enable row level security;
alter table public.checklist_records   enable row level security;
alter table public.test_samples        enable row level security;
drop policy if exists "checklist_templates_members_all" on public.checklist_templates;
drop policy if exists "checklist_templates_select" on public.checklist_templates;
create policy "checklist_templates_select" on public.checklist_templates for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "checklist_templates_insert" on public.checklist_templates;
create policy "checklist_templates_insert" on public.checklist_templates for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "checklist_templates_update" on public.checklist_templates;
create policy "checklist_templates_update" on public.checklist_templates for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "checklist_templates_delete" on public.checklist_templates;
create policy "checklist_templates_delete" on public.checklist_templates for delete to authenticated
  using (public.can_write(project_id));
drop policy if exists "checklist_records_members_all" on public.checklist_records;
drop policy if exists "checklist_records_select" on public.checklist_records;
create policy "checklist_records_select" on public.checklist_records for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "checklist_records_insert" on public.checklist_records;
create policy "checklist_records_insert" on public.checklist_records for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "checklist_records_update" on public.checklist_records;
create policy "checklist_records_update" on public.checklist_records for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "checklist_records_delete" on public.checklist_records;
create policy "checklist_records_delete" on public.checklist_records for delete to authenticated
  using (public.can_write(project_id));
drop policy if exists "test_samples_members_all" on public.test_samples;
drop policy if exists "test_samples_select" on public.test_samples;
create policy "test_samples_select" on public.test_samples for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "test_samples_insert" on public.test_samples;
create policy "test_samples_insert" on public.test_samples for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "test_samples_update" on public.test_samples;
create policy "test_samples_update" on public.test_samples for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "test_samples_delete" on public.test_samples;
create policy "test_samples_delete" on public.test_samples for delete to authenticated
  using (public.can_write(project_id));

-- ── 觀察事項(Observation):比缺失輕的現場提醒,可升級成正式缺失 ─────────────
create table if not exists public.observations (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  title        text not null,
  description  text,
  location     text,
  assigned_to  text not null default 'contractor', -- 待哪方處理:contractor|supervisor
  status       text not null default '待處理',       -- 待處理|已處理|轉缺失
  markup_path  text,                                 -- 圖面/照片標註
  work_item_id uuid references public.work_items(id) on delete set null,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists observations_project_idx on public.observations(project_id);
alter table public.observations enable row level security;
drop policy if exists "observations_members_all" on public.observations;
drop policy if exists "observations_select" on public.observations;
create policy "observations_select" on public.observations for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "observations_insert" on public.observations;
create policy "observations_insert" on public.observations for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "observations_update" on public.observations;
create policy "observations_update" on public.observations for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "observations_delete" on public.observations;
create policy "observations_delete" on public.observations for delete to authenticated
  using (public.can_write(project_id));

-- ── 監造協作:送審(Submittal)與工程疑義(RFI) ─────────────────────────────────
create table if not exists public.submittals (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  submittal_no   text,
  title          text not null,
  category       text not null default '施工計畫',  -- 施工計畫|品質計畫|材料設備|樣品|配比|其他
  revision       int not null default 0,           -- 修正次數(退回補正後再送 +1)
  status         text not null default '已提送',    -- 已提送|審核中|核准|核備|退回補正|駁回
  submitted_date date,
  due_date       date,                              -- 監造應審回期限
  decided_date   date,
  review_note    text,                              -- 審查意見
  attachment_note text,                             -- 附件說明/文件連結(v1 不做檔案上傳)
  work_item_id   uuid references public.work_items(id) on delete set null,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
create table if not exists public.rfis (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  rfi_no         text,
  title          text not null,
  question       text,
  answer         text,
  status         text not null default '待回覆',    -- 待回覆|已回覆|已結案
  asked_date     date,
  due_date       date,
  answered_date  date,
  cost_impact    boolean not null default false,
  schedule_impact boolean not null default false,
  markup_path    text,                              -- 圖面標註(storage path;demo 為 dataURL)
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
create index if not exists submittals_project_idx on public.submittals(project_id);
create index if not exists submittals_wi_idx      on public.submittals(work_item_id);
create index if not exists rfis_project_idx       on public.rfis(project_id);
alter table public.submittals enable row level security;
alter table public.rfis       enable row level security;
drop policy if exists "submittals_members_all" on public.submittals;
drop policy if exists "submittals_select" on public.submittals;
create policy "submittals_select" on public.submittals for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "submittals_insert" on public.submittals;
create policy "submittals_insert" on public.submittals for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "submittals_update" on public.submittals;
create policy "submittals_update" on public.submittals for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "submittals_delete" on public.submittals;
create policy "submittals_delete" on public.submittals for delete to authenticated
  using (public.can_write(project_id));
drop policy if exists "rfis_members_all" on public.rfis;
drop policy if exists "rfis_select" on public.rfis;
create policy "rfis_select" on public.rfis for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "rfis_insert" on public.rfis;
create policy "rfis_insert" on public.rfis for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "rfis_update" on public.rfis;
create policy "rfis_update" on public.rfis for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "rfis_delete" on public.rfis;
create policy "rfis_delete" on public.rfis for delete to authenticated
  using (public.can_write(project_id));

-- ── ITP 檢驗停留點(監造協作的結構關鍵) ─────────────────────────────────────
-- 回答「這個工項什麼時候必須通知監造」:W=見證點(通知監造到場見證)、
-- H=停留點(監造未查驗不得續作)、R=文審點(文件審查)。
-- 掛在工項上;申請查驗後以 inspection_id 連結,狀態由查驗結果推導(前端 lib/itp.js)。
create table if not exists public.inspection_points (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  work_item_id        uuid references public.work_items(id) on delete set null,
  point_type          text not null default 'H' check (point_type in ('W','H','R')),
  title               text not null,
  acceptance_criteria text,   -- 允收標準(可由 AI 從規範抽,人工審核)
  frequency           text,   -- 頻率(每層/每批/每次澆置前…)
  source_clause       text,   -- 出處(品質計畫/規範章節)
  inspection_id       uuid references public.inspections(id) on delete set null,
  sort_order          int,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);
create index if not exists inspection_points_project_idx on public.inspection_points(project_id);
create index if not exists inspection_points_wi_idx      on public.inspection_points(work_item_id);
alter table public.inspection_points enable row level security;
drop policy if exists "inspection_points_select" on public.inspection_points;
create policy "inspection_points_select" on public.inspection_points for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "inspection_points_insert" on public.inspection_points;
create policy "inspection_points_insert" on public.inspection_points for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "inspection_points_update" on public.inspection_points;
create policy "inspection_points_update" on public.inspection_points for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
drop policy if exists "inspection_points_delete" on public.inspection_points;
create policy "inspection_points_delete" on public.inspection_points for delete to authenticated
  using (public.can_write(project_id));

-- ── 驗收/結算(機關主導):報竣→竣工確認→初驗→(改善→複驗)→正驗→結算證明→保固 ──
-- 一階段一筆事件(後蓋前);法定期限(細則§92/93/94、採購法§73)由前端 lib 推算。
-- 三方都要寫(廠商報竣、機關驗收、監造陪驗)→ 唯一「機關也可寫」的業務表。
create table if not exists public.acceptance_events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_key  text not null,   -- report|confirm|initial|fix|reinspect|final|certificate|warranty
  event_date date,            -- 實際辦理日
  result     text,            -- 初驗/複驗/正驗:合格|不合格
  note       text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists acceptance_events_project_idx on public.acceptance_events(project_id);
alter table public.acceptance_events enable row level security;
drop policy if exists "acceptance_events_members_all" on public.acceptance_events;
create policy "acceptance_events_members_all" on public.acceptance_events for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

-- ── RPCs (SECURITY DEFINER) ─────────────────────────────────────────────────
-- 跨案總覽:一次撈回目前使用者所有專案的彙總數字(逐案打查詢會拖垮 portfolio 頁)。
-- SECURITY DEFINER + 明確以 my_project_ids() 過濾,不多給一列。
create or replace function public.portfolio_summary()
returns table (
  project_id uuid,
  billable_total numeric,      -- 發包工程費(可計價末端項加總)
  latest_period int,           -- 最新估驗期
  latest_status text,
  latest_cum numeric,          -- 最新一期累計估驗金額
  open_defects int,
  pending_inspections int,
  pending_change_orders int,   -- 提出/審核中
  acceptance_events jsonb      -- 驗收事件(前端推算階段/期限)
) language sql security definer stable set search_path = public as $$
  select
    p.id,
    (select coalesce(sum(w.amount), 0) from public.work_items w
      where w.project_id = p.id and w.is_billable and w.is_leaf and not w.is_rollup),
    lv.period_no,
    lv.status,
    (select coalesce(sum(vi.amount_cum), 0) from public.valuation_items vi where vi.valuation_id = lv.id),
    (select count(*)::int from public.defects d where d.project_id = p.id and d.status <> '已結案'),
    (select count(*)::int from public.inspections i where i.project_id = p.id and i.status = '待查驗'),
    (select count(*)::int from public.change_orders c where c.project_id = p.id and c.status in ('提出','審核中')),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'stage_key', a.stage_key, 'event_date', a.event_date, 'result', a.result) order by a.created_at), '[]'::jsonb)
      from public.acceptance_events a where a.project_id = p.id)
  from public.projects p
  left join lateral (
    select v.id, v.period_no, v.status from public.valuations v
    where v.project_id = p.id order by v.period_no desc limit 1
  ) lv on true
  where p.id in (select public.my_project_ids())
  order by p.created_at
$$;
grant execute on function public.portfolio_summary() to authenticated;

-- 用 email 邀請成員加入專案(監造/機關/其他廠商帳號)。只有專案建立者可執行;
-- email 對照 auth.users(前端讀不到別人的 email,必須走 SECURITY DEFINER)。
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
  return 'ok';
end; $$;
grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;

-- 專案成員清單(名字+組織)——一般成員也看得到團隊名單(僅此專案)。
create or replace function public.list_project_members(p_project uuid)
returns table (user_id uuid, full_name text, company text, org_type text, member_role text)
language sql security definer stable set search_path = public as $$
  select m.user_id, p.full_name, p.company, p.org_type, m.role
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = p_project
    and exists (select 1 from public.project_members me
                where me.project_id = p_project and me.user_id = auth.uid())
  order by m.created_at
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
  delete from public.project_members where project_id = p_project and user_id = p_user;
end; $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

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

-- Delete a project (and everything it cascades to). Admin/creator only —
-- 受邀的監造/機關/他家廠商成員不可刪除整案。
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_project_admin(p_id) then raise exception '只有專案建立者/管理者可以刪除專案'; end if;
  delete from public.projects where id = p_id;
end; $$;
grant execute on function public.delete_project(uuid) to authenticated;

-- ============================================================================
-- ── 伺服器端 RBAC:狀態轉移 trigger 防護 ─────────────────────────────────────
--  RLS 決定「誰能碰這列」,這裡決定「誰能做這種狀態轉移 / 改哪些欄位」。
--  對應前端 can:approve(核定/判定/結案/審定)=監造、ratify(變更核准)=機關/監造、
--  機關其餘唯讀。admin(建立者/管理者)一律放行;auth.uid() is null
--  (service role、SQL Editor、遷移腳本)一律放行——只防登入使用者越權。
-- ============================================================================

-- 估驗:跨越「已核定」的狀態轉移=監造;機關只能碰請款/撥款三欄
create or replace function public.valuations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if auth.uid() is null or public.is_project_admin(new.project_id) then return new; end if;
  org := public.my_org_type();
  if new.status is distinct from old.status
     and (new.status = '已核定' or old.status = '已核定')
     and org <> 'supervisor' then
    raise exception '估驗核定/退回核定僅監造或專案管理者可執行';
  end if;
  if org = 'owner' and (
       new.period_no      is distinct from old.period_no
    or new.period_start   is distinct from old.period_start
    or new.period_end     is distinct from old.period_end
    or new.valuation_date is distinct from old.valuation_date
    or new.retention_pct  is distinct from old.retention_pct
    or new.status         is distinct from old.status
    or new.note           is distinct from old.note
  ) then
    raise exception '機關僅可登錄請款/撥款欄位(invoice_date / paid_date / paid_amount)';
  end if;
  return new;
end; $$;
drop trigger if exists valuations_guard on public.valuations;
create trigger valuations_guard before update on public.valuations
  for each row execute function public.valuations_guard();

-- 估驗明細:已核定的估驗凍結(監造/管理者才可再動——退回重審用)
create or replace function public.valuation_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select project_id, status into v from public.valuations
    where id = coalesce(new.valuation_id, old.valuation_id);
  if v.status = '已核定'
     and not public.is_project_admin(v.project_id)
     and public.my_org_type() <> 'supervisor' then
    raise exception '已核定估驗的明細不可再修改(需監造退回後重編)';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists valuation_items_guard on public.valuation_items;
create trigger valuation_items_guard before insert or update or delete on public.valuation_items
  for each row execute function public.valuation_items_guard();

-- 查驗:合格/不合格判定(含撤銷判定)=監造
create or replace function public.inspections_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_project_admin(new.project_id) then return new; end if;
  if new.status is distinct from old.status
     and (new.status in ('合格','不合格') or old.status in ('合格','不合格'))
     and public.my_org_type() <> 'supervisor' then
    raise exception '查驗判定(合格/不合格)僅監造或專案管理者可執行';
  end if;
  return new;
end; $$;
drop trigger if exists inspections_guard on public.inspections;
create trigger inspections_guard before update on public.inspections
  for each row execute function public.inspections_guard();

-- 缺失:結案/撤銷結案=監造(施工只能改善、提送複查)
create or replace function public.defects_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_project_admin(new.project_id) then return new; end if;
  if new.status is distinct from old.status
     and (new.status = '已結案' or old.status = '已結案')
     and public.my_org_type() <> 'supervisor' then
    raise exception '缺失結案僅監造或專案管理者可執行';
  end if;
  return new;
end; $$;
drop trigger if exists defects_guard on public.defects;
create trigger defects_guard before update on public.defects
  for each row execute function public.defects_guard();

-- 送審:審定結果(核准/核備/退回補正/駁回)=監造
create or replace function public.submittals_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_project_admin(new.project_id) then return new; end if;
  if new.status is distinct from old.status
     and (new.status in ('核准','核備','退回補正','駁回')
       or old.status in ('核准','核備','退回補正','駁回'))
     and public.my_org_type() <> 'supervisor' then
    raise exception '送審審定僅監造或專案管理者可執行';
  end if;
  return new;
end; $$;
drop trigger if exists submittals_guard on public.submittals;
create trigger submittals_guard before update on public.submittals
  for each row execute function public.submittals_guard();

-- RFI:正式回覆=監造(廠商提問、確認結案)
create or replace function public.rfis_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if auth.uid() is null or public.is_project_admin(new.project_id) then return new; end if;
  org := public.my_org_type();
  if (new.answer is distinct from old.answer
      or (new.status is distinct from old.status and new.status = '已回覆'))
     and org <> 'supervisor' then
    raise exception '回覆工程疑義僅監造或專案管理者可執行';
  end if;
  return new;
end; $$;
drop trigger if exists rfis_guard on public.rfis;
create trigger rfis_guard before update on public.rfis
  for each row execute function public.rfis_guard();

-- 變更設計:核准/駁回(含撤銷)=機關或監造(契約級核定);機關僅能改狀態欄
create or replace function public.change_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if auth.uid() is null or public.is_project_admin(new.project_id) then return new; end if;
  org := public.my_org_type();
  if new.status is distinct from old.status
     and (new.status in ('核准','駁回') or old.status in ('核准','駁回'))
     and org not in ('supervisor','owner') then
    raise exception '變更設計核准/駁回僅機關、監造或專案管理者可執行';
  end if;
  if org = 'owner' and (
       new.co_no      is distinct from old.co_no
    or new.title      is distinct from old.title
    or new.co_date    is distinct from old.co_date
    or new.reason     is distinct from old.reason
    or new.sort_order is distinct from old.sort_order
  ) then
    raise exception '機關僅可核定變更設計狀態,不可修改內容';
  end if;
  return new;
end; $$;
drop trigger if exists change_orders_guard on public.change_orders;
create trigger change_orders_guard before update on public.change_orders
  for each row execute function public.change_orders_guard();

-- 變更明細:已核准的變更凍結(管理者才可再動)
create or replace function public.change_order_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare co record;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select project_id, status into co from public.change_orders
    where id = coalesce(new.change_order_id, old.change_order_id);
  if co.status = '核准' and not public.is_project_admin(co.project_id) then
    raise exception '已核准變更設計的明細不可再修改';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists change_order_items_guard on public.change_order_items;
create trigger change_order_items_guard before insert or update or delete on public.change_order_items
  for each row execute function public.change_order_items_guard();

-- 身分別(org_type)提權防護:加入「他人建立的專案」後不可自改 org_type
-- (否則廠商成員可自改為監造,自己核定自己的估驗)。單人/自家專案可自由修正。
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.org_type is distinct from old.org_type and exists (
    select 1 from public.project_members m
    join public.projects p on p.id = m.project_id
    where m.user_id = old.id and p.created_by <> old.id
  ) then
    raise exception '已加入他人專案後不可變更身分別,請聯絡專案管理者';
  end if;
  return new;
end; $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ── RLS 熱路徑與外鍵索引(缺這些會逐列全表掃描) ──────────────────────────────
create index if not exists project_members_user_idx      on public.project_members(user_id);
create index if not exists change_order_items_project_idx on public.change_order_items(project_id);
create index if not exists change_order_items_wi_idx     on public.change_order_items(work_item_id);
create index if not exists defects_inspection_idx        on public.defects(inspection_id);
create index if not exists defects_wi_idx                on public.defects(work_item_id);
create index if not exists inspections_wi_idx            on public.inspections(work_item_id);
create index if not exists photos_wi_idx                 on public.photos(work_item_id);
