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

-- -- P0-01: document + requirement foundation -------------------------------
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  document_number text,
  title           text not null,
  document_type   text not null
    check (document_type in ('contract','specification','quality_plan','itp','form_package','submittal_document','drawing','report','other')),
  discipline      text,
  status          text not null default 'active',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists documents_project_idx on public.documents(project_id);
create index if not exists documents_project_type_idx on public.documents(project_id, document_type);

create or replace function public.touch_document_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end; $$;
drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
  before update on public.documents for each row
  execute function public.touch_document_updated_at();

alter table public.documents enable row level security;
drop policy if exists "documents_select" on public.documents;
create policy "documents_select" on public.documents for select to authenticated
  using (project_id in (select public.my_project_ids()));
drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert" on public.documents for insert to authenticated
  with check (public.can_write(project_id));
drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update to authenticated
  using (public.can_write(project_id)) with check (public.can_write(project_id));
-- No application DELETE policy: archive the document and retain version history.

create table if not exists public.document_versions (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references public.documents(id) on delete cascade,
  version_label         text not null,
  revision_number       int check (revision_number is null or revision_number >= 0),
  storage_path          text,
  original_filename     text,
  mime_type             text,
  file_size             bigint check (file_size is null or file_size >= 0),
  checksum              text,
  uploaded_by           uuid references auth.users(id) on delete set null,
  uploaded_at           timestamptz not null default now(),
  supersedes_version_id uuid references public.document_versions(id),
  unique (document_id, version_label)
);
create index if not exists document_versions_document_idx on public.document_versions(document_id);
create index if not exists document_versions_supersedes_idx on public.document_versions(supersedes_version_id);

create or replace function public.validate_superseded_document_version()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.supersedes_version_id is null then return new; end if;
  if new.supersedes_version_id = new.id or not exists (
    select 1 from public.document_versions previous
    where previous.id = new.supersedes_version_id
      and previous.document_id = new.document_id
  ) then
    raise exception 'superseded version must belong to the same document';
  end if;
  return new;
end; $$;
drop trigger if exists document_versions_same_document on public.document_versions;
create trigger document_versions_same_document
  before insert or update on public.document_versions for each row
  execute function public.validate_superseded_document_version();

-- Application users may correct labels/revision metadata, but changing the
-- immutable file identity always requires a new document_versions row.
create or replace function public.guard_document_version_file_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and (
       new.document_id       is distinct from old.document_id
    or new.storage_path      is distinct from old.storage_path
    or new.original_filename is distinct from old.original_filename
    or new.mime_type         is distinct from old.mime_type
    or new.file_size         is distinct from old.file_size
    or new.checksum          is distinct from old.checksum
    or new.uploaded_by       is distinct from old.uploaded_by
    or new.uploaded_at       is distinct from old.uploaded_at
  ) then
    raise exception 'document version file identity is immutable; create a new version';
  end if;
  return new;
end; $$;
drop trigger if exists document_versions_file_identity_guard on public.document_versions;
create trigger document_versions_file_identity_guard
  before update on public.document_versions for each row
  execute function public.guard_document_version_file_identity();

alter table public.document_versions enable row level security;
drop policy if exists "document_versions_select" on public.document_versions;
create policy "document_versions_select" on public.document_versions for select to authenticated
  using (document_id in (
    select id from public.documents where project_id in (select public.my_project_ids())
  ));
drop policy if exists "document_versions_insert" on public.document_versions;
create policy "document_versions_insert" on public.document_versions for insert to authenticated
  with check (document_id in (
    select id from public.documents where public.can_write(project_id)
  ));
drop policy if exists "document_versions_update" on public.document_versions;
create policy "document_versions_update" on public.document_versions for update to authenticated
  using (document_id in (
    select id from public.documents where public.can_write(project_id)
  )) with check (document_id in (
    select id from public.documents where public.can_write(project_id)
  ));
-- No application DELETE policy: immutable version history is retained.

create table if not exists public.document_pages (
  id                  uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  page_number         int not null check (page_number > 0),
  extracted_text      text not null default '',
  extraction_method   text not null default 'unknown',
  created_at          timestamptz not null default now(),
  unique (document_version_id, page_number)
);
create index if not exists document_pages_version_idx on public.document_pages(document_version_id);
alter table public.document_pages enable row level security;
drop policy if exists "document_pages_select" on public.document_pages;
create policy "document_pages_select" on public.document_pages for select to authenticated
  using (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where d.project_id in (select public.my_project_ids())
  ));
drop policy if exists "document_pages_insert" on public.document_pages;
create policy "document_pages_insert" on public.document_pages for insert to authenticated
  with check (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_write(d.project_id)
  ));
drop policy if exists "document_pages_update" on public.document_pages;
create policy "document_pages_update" on public.document_pages for update to authenticated
  using (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_write(d.project_id)
  )) with check (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_write(d.project_id)
  ));
drop policy if exists "document_pages_delete" on public.document_pages;
create policy "document_pages_delete" on public.document_pages for delete to authenticated
  using (document_version_id in (
    select v.id from public.document_versions v
    join public.documents d on d.id = v.document_id
    where public.can_write(d.project_id)
  ));

-- Requirement domain ---------------------------------------------------------
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
  responsible_party_type text
    check (responsible_party_type is null or responsible_party_type in ('agency','supervisor','contractor','other')),
  -- P0-02 adds project_parties and the deferred FK for this placeholder.
  responsible_project_party_id uuid,
  lifecycle_phase        text,
  trigger_type           text,
  trigger_config         jsonb not null default '{}'::jsonb
    check (jsonb_typeof(trigger_config) = 'object'),
  frequency_type         text,
  frequency_config       jsonb not null default '{}'::jsonb
    check (jsonb_typeof(frequency_config) = 'object'),
  acceptance_criteria    text,
  evidence_requirement   text,
  status                 text not null default 'needs_review'
    check (status in ('draft_ai','needs_review','approved','rejected','superseded')),
  origin                 text not null default 'manual'
    check (origin in ('ai','manual','migration')),
  -- Explicit provenance without a circular FK to contract_obligations, which
  -- already points back through requirement_id. Same UUID identity is retained.
  legacy_contract_obligation_id uuid,
  confidence             numeric check (confidence between 0 and 1),
  reviewed_by            uuid references auth.users(id) on delete set null,
  reviewed_at            timestamptz,
  is_authoritative       boolean generated always as
    (status = 'approved') stored,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists requirements_project_idx on public.requirements(project_id);
create index if not exists requirements_project_type_idx on public.requirements(project_id, requirement_type);
create unique index if not exists requirements_legacy_obligation_uidx
  on public.requirements(legacy_contract_obligation_id)
  where legacy_contract_obligation_id is not null;
create index if not exists requirements_authoritative_idx on public.requirements(project_id)
  where is_authoritative;

-- Project-scoped roots cannot be reassigned. This keeps existing Requirement
-- source/work-item bridges valid even when a user can write to both projects.
create or replace function public.guard_project_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id then
    raise exception 'project identity is immutable';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_project_identity_guard on public.requirements;
create trigger requirements_project_identity_guard
  before update on public.requirements for each row
  execute function public.guard_project_identity();
drop trigger if exists documents_project_identity_guard on public.documents;
create trigger documents_project_identity_guard
  before update on public.documents for each row
  execute function public.guard_project_identity();
drop trigger if exists work_items_project_identity_guard on public.work_items;
create trigger work_items_project_identity_guard
  before update on public.work_items for each row
  execute function public.guard_project_identity();

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
  document_version_id uuid references public.document_versions(id),
  source_kind         text not null default 'manual'
    check (source_kind in ('document','legacy','manual')),
  source_verified     boolean not null default false,
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
  ),
  check (source_kind <> 'document' or document_version_id is not null),
  check (not source_verified or document_version_id is not null)
);
create index if not exists requirement_sources_requirement_idx on public.requirement_sources(requirement_id);
create index if not exists requirement_sources_document_version_idx on public.requirement_sources(document_version_id);

create or replace function public.validate_requirement_source_project()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.document_version_id is not null and not exists (
    select 1
    from public.requirements r
    join public.document_versions v on v.id = new.document_version_id
    join public.documents d on d.id = v.document_id
    where r.id = new.requirement_id and r.project_id = d.project_id
  ) then
    raise exception 'requirement and document version must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists requirement_sources_same_project on public.requirement_sources;
create trigger requirement_sources_same_project
  before insert or update on public.requirement_sources for each row
  execute function public.validate_requirement_source_project();

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
declare requirement_status text;
begin
  new.requirement_id = new.id;

  insert into public.requirements (
    id, project_id, title, description, requirement_type,
    responsible_party_type, lifecycle_phase, trigger_type, trigger_config,
    frequency_type, frequency_config, status, origin,
    legacy_contract_obligation_id, created_at
  ) values (
    new.id,
    new.project_id,
    new.title,
    new.note,
    'deadline',
    case
      when nullif(trim(new.responsible), '') is null then null
      when new.responsible in ('機關','agency') then 'agency'
      when new.responsible in ('監造','supervisor') then 'supervisor'
      when new.responsible in ('廠商','contractor') then 'contractor'
      else 'other'
    end,
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
    'needs_review',
    'migration',
    new.id,
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
    origin = 'migration',
    legacy_contract_obligation_id = excluded.legacy_contract_obligation_id
  where requirements.status in ('draft_ai','needs_review');

  select status into requirement_status
  from public.requirements where id = new.id;

  if requirement_status in ('draft_ai','needs_review') then
    if new.source_clause is not null or new.source_page is not null then
      insert into public.requirement_sources (
        id, requirement_id, document_version_id, source_kind, source_verified,
        page_number, page_label, clause
      ) values (
        new.id,
        new.id,
        null,
        'legacy',
        false,
        nullif(substring(new.source_page from '([0-9]+)'), '')::int,
        new.source_page,
        new.source_clause
      )
      on conflict (id) do update set
        requirement_id = excluded.requirement_id,
        document_version_id = null,
        source_kind = 'legacy',
        source_verified = false,
        page_number = excluded.page_number,
        page_label = excluded.page_label,
        clause = excluded.clause
      where requirement_sources.source_kind = 'legacy';
    else
      delete from public.requirement_sources
      where id = new.id and requirement_id = new.id and source_kind = 'legacy';
    end if;
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

-- Legacy parser replacement removes only draft/needs-review mirrors. Explicit
-- lifecycle outcomes (approved, rejected, superseded) survive reprocessing.
-- During a root-originated cascade the parent is already invisible, so no
-- second delete is attempted.
create or replace function public.delete_legacy_requirement_root()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.requirement_id is not null and exists (
    select 1 from public.requirements
    where id = old.requirement_id
      and status in ('draft_ai','needs_review')
  ) then
    delete from public.requirements where id = old.requirement_id;
  end if;
  return old;
end; $$;
drop trigger if exists contract_obligations_delete_requirement on public.contract_obligations;
create trigger contract_obligations_delete_requirement
  after delete on public.contract_obligations for each row
  execute function public.delete_legacy_requirement_root();

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

-- Delete a project (and everything it cascades to). P0-03: project deletion is
-- technical administration under the v2 identity model (can_manage_project_identity,
-- defined in the P0-03 section below; plpgsql resolves it at call time).
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_project_identity(p_id) then
    raise exception '只有專案技術管理者可以刪除專案';
  end if;
  delete from public.projects where id = p_id;
end; $$;
grant execute on function public.delete_project(uuid) to authenticated;

-- ── P0-03 / P0-04:契約權限 cutover(contractual authority) ─────────────────
--  自此以下是唯一的業務寫入授權來源。原則:
--  * 契約授權 = project_parties.party_type × project_memberships.project_role
--    × workflow action × workflow state。
--  * is_project_admin 只授權技術性身分/專案管理,絕不 bypass 業務審核。
--  * profiles.org_type / project_members 不再授與任何契約權限(僅保留讀取相容)。
--  * 無 v2 membership 或 party 已停用 → 契約授權 fail closed。
--  * auth.uid() is null(service role、SQL Editor、遷移)一律放行 guard:
--    guard 只防登入使用者越權。
-- ============================================================================

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

-- -- P0-05 §1: append-only event domain -------------------------------------
create table if not exists public.audit_events (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,
  actor_user_id          uuid,
  actor_project_party_id uuid,
  actor_party_type       text,
  actor_project_role     text,
  actor_is_project_admin boolean,
  event_type             text not null check (btrim(event_type) <> ''),
  entity_type            text not null check (btrim(entity_type) <> ''),
  entity_id              uuid,
  action                 text not null check (btrim(action) <> ''),
  before_data            jsonb,
  after_data             jsonb,
  metadata               jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  correlation_id         uuid,
  occurred_at            timestamptz not null default now()
);

create index if not exists audit_events_project_time_idx
  on public.audit_events(project_id, occurred_at desc);
create index if not exists audit_events_entity_time_idx
  on public.audit_events(project_id, entity_type, entity_id, occurred_at desc);
create index if not exists audit_events_actor_time_idx
  on public.audit_events(project_id, actor_user_id, occurred_at desc);
create index if not exists audit_events_type_time_idx
  on public.audit_events(project_id, event_type, occurred_at desc);
create index if not exists audit_events_correlation_idx
  on public.audit_events(correlation_id) where correlation_id is not null;

alter table public.audit_events enable row level security;
drop policy if exists "audit_events_select" on public.audit_events;
create policy "audit_events_select" on public.audit_events for select to authenticated
  using (project_id in (select public.my_project_ids()));

-- There are deliberately no INSERT / UPDATE / DELETE policies. Revoke the
-- table privileges too; SECURITY DEFINER trigger functions remain the only
-- application path that can append an event.
revoke insert, update, delete on public.audit_events from public, anon, authenticated;
grant select on public.audit_events to authenticated;

-- Defense in depth if a future privileged RPC accidentally exposes mutation.
-- Privileged maintenance with no authenticated JWT remains an explicit DBA
-- boundary; normal application actors can never rewrite history.
create or replace function public.guard_audit_event_immutability()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    raise exception 'audit events are append-only';
  end if;
  return old;
end; $$;
drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function public.guard_audit_event_immutability();
revoke all on function public.guard_audit_event_immutability()
  from public, anon, authenticated;

-- -- P0-05 §2: controlled insertion + actor-at-time snapshot ----------------
create or replace function public.record_audit_event(
  p_project uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_metadata jsonb,
  p_correlation uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  actor_uid uuid := auth.uid();
  actor_project_party_id uuid;
  actor_party_type text;
  actor_project_role text;
  actor_is_admin boolean;
  event_id uuid;
  event_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  -- During project deletion, child cascades must not create transient audit
  -- rows against a parent that is already disappearing.
  if p_project is null or not exists (
    select 1 from public.projects p where p.id = p_project
  ) then
    return null;
  end if;

  if actor_uid is null then
    event_metadata := event_metadata || jsonb_build_object('actor_kind', 'system');
  else
    select m.project_party_id, pp.party_type, m.project_role,
           m.is_project_admin
      into actor_project_party_id, actor_party_type, actor_project_role,
           actor_is_admin
    from public.project_memberships m
    join public.project_parties pp on pp.id = m.project_party_id
    where m.project_id = p_project
      and m.user_id = actor_uid
      and pp.is_active
    limit 1;

    event_metadata := event_metadata || jsonb_build_object(
      'actor_kind',
      case when actor_project_party_id is null
        then 'authenticated_unresolved' else 'project_member' end
    );
  end if;

  insert into public.audit_events (
    project_id, actor_user_id, actor_project_party_id, actor_party_type,
    actor_project_role, actor_is_project_admin, event_type, entity_type,
    entity_id, action, before_data, after_data, metadata, correlation_id
  ) values (
    p_project, actor_uid, actor_project_party_id, actor_party_type,
    actor_project_role, actor_is_admin, p_event_type, p_entity_type,
    p_entity_id, p_action, p_before, p_after, event_metadata, p_correlation
  ) returning id into event_id;

  return event_id;
end; $$;
revoke all on function public.record_audit_event(
  uuid, text, text, uuid, text, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated;

-- -- P0-05 §3: focused semantic workflow triggers ---------------------------
create or replace function public.audit_valuation_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  event_name text;
  event_action text;
  payment_fields text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'valuation.created',
      'valuation', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'valuation.deleted',
      'valuation', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;

  if new.status is distinct from old.status then
    if old.status = '草稿' and new.status in ('送審','監造審核') then
      event_name := 'valuation.submitted'; event_action := 'submitted';
    elsif old.status in ('送審','監造審核','已核定') and new.status = '草稿' then
      event_name := 'valuation.returned'; event_action := 'returned';
    elsif new.status = '已核定' then
      event_name := 'valuation.approved'; event_action := 'approved';
    elsif old.status = '已核定' and new.status = '已請款' then
      event_name := 'valuation.claimed'; event_action := 'claimed';
    end if;
    if event_name is not null then
      perform public.record_audit_event(new.project_id, event_name,
        'valuation', new.id, event_action, to_jsonb(old), to_jsonb(new),
        '{}'::jsonb, null);
    end if;
  end if;

  if new.invoice_date is distinct from old.invoice_date then
    payment_fields := array_append(payment_fields, 'invoice_date');
  end if;
  if new.paid_date is distinct from old.paid_date then
    payment_fields := array_append(payment_fields, 'paid_date');
  end if;
  if new.paid_amount is distinct from old.paid_amount then
    payment_fields := array_append(payment_fields, 'paid_amount');
  end if;
  if cardinality(payment_fields) > 0 then
    perform public.record_audit_event(new.project_id, 'valuation.payment_updated',
      'valuation', new.id, 'payment_updated', to_jsonb(old), to_jsonb(new),
      jsonb_build_object('changed_fields', payment_fields), null);
  end if;
  return new;
end; $$;
drop trigger if exists valuations_audit_event on public.valuations;
create trigger valuations_audit_event after insert or update or delete on public.valuations
  for each row execute function public.audit_valuation_event();

create or replace function public.audit_inspection_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'inspection.created',
      'inspection', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'inspection.deleted',
      'inspection', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if old.status in ('合格','不合格') and new.status = '待查驗' then
    perform public.record_audit_event(new.project_id, 'inspection.reopened',
      'inspection', new.id, 'reopened', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif new.status in ('合格','不合格') and (
       new.status is distinct from old.status
    or new.result_note is distinct from old.result_note
    or new.inspected_by is distinct from old.inspected_by
    or new.inspected_at is distinct from old.inspected_at
  ) then
    perform public.record_audit_event(new.project_id, 'inspection.decided',
      'inspection', new.id, 'decided', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists inspections_audit_event on public.inspections;
create trigger inspections_audit_event after insert or update or delete on public.inspections
  for each row execute function public.audit_inspection_event();

create or replace function public.audit_defect_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'defect.created',
      'defect', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'defect.deleted',
      'defect', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if old.status <> '已結案' and new.status = '已結案' then
    perform public.record_audit_event(new.project_id, 'defect.closed',
      'defect', new.id, 'closed', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif old.status = '已結案' and new.status <> '已結案' then
    perform public.record_audit_event(new.project_id, 'defect.reopened',
      'defect', new.id, 'reopened', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif new.status is distinct from old.status
     or new.improvement_note is distinct from old.improvement_note then
    perform public.record_audit_event(new.project_id, 'defect.remediation_updated',
      'defect', new.id, 'remediation_updated', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists defects_audit_event on public.defects;
create trigger defects_audit_event after insert or update or delete on public.defects
  for each row execute function public.audit_defect_event();

create or replace function public.audit_submittal_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'submittal.created',
      'submittal', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'submittal.deleted',
      'submittal', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if new.status is distinct from old.status then
    if old.status = '退回補正' and new.status = '已提送' then
      event_name := 'submittal.resubmitted'; event_action := 'resubmitted';
    elsif new.status = '核准' then
      event_name := 'submittal.approved'; event_action := 'approved';
    elsif new.status = '核備' then
      event_name := 'submittal.approved_as_noted'; event_action := 'approved_as_noted';
    elsif new.status = '退回補正' then
      event_name := 'submittal.returned'; event_action := 'returned';
    elsif new.status = '駁回' then
      event_name := 'submittal.rejected'; event_action := 'rejected';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name, 'submittal',
      new.id, event_action, to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists submittals_audit_event on public.submittals;
create trigger submittals_audit_event after insert or update or delete on public.submittals
  for each row execute function public.audit_submittal_event();

create or replace function public.audit_rfi_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'rfi.created', 'rfi',
      new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'rfi.deleted', 'rfi',
      old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if old.status <> '已結案' and new.status = '已結案' then
    perform public.record_audit_event(new.project_id, 'rfi.closed', 'rfi',
      new.id, 'closed', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif (old.status <> '已回覆' and new.status = '已回覆')
     or new.answer is distinct from old.answer
     or new.answered_date is distinct from old.answered_date then
    perform public.record_audit_event(new.project_id, 'rfi.answered', 'rfi',
      new.id, 'answered', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists rfis_audit_event on public.rfis;
create trigger rfis_audit_event after insert or update or delete on public.rfis
  for each row execute function public.audit_rfi_event();

create or replace function public.audit_change_order_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'change_order.created',
      'change_order', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'change_order.deleted',
      'change_order', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if new.status is distinct from old.status then
    if old.status = '提出' and new.status = '審核中' then
      event_name := 'change_order.review_started'; event_action := 'review_started';
    elsif old.status = '審核中' and new.status = '提出' then
      event_name := 'change_order.returned'; event_action := 'returned';
    elsif old.status = '審核中' and new.status = '核准' then
      event_name := 'change_order.approved'; event_action := 'approved';
    elsif old.status = '審核中' and new.status = '駁回' then
      event_name := 'change_order.rejected'; event_action := 'rejected';
    elsif old.status = '核准' and new.status = '審核中' then
      event_name := 'change_order.ratification_reopened'; event_action := 'ratification_reopened';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name,
      'change_order', new.id, event_action, to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists change_orders_audit_event on public.change_orders;
create trigger change_orders_audit_event after insert or update or delete on public.change_orders
  for each row execute function public.audit_change_order_event();

create or replace function public.audit_requirement_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'requirement.created',
      'requirement', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'requirement.deleted',
      'requirement', old.id, 'deleted', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      event_name := 'requirement.approved'; event_action := 'approved';
    elsif new.status = 'rejected' then
      event_name := 'requirement.rejected'; event_action := 'rejected';
    elsif new.status = 'superseded' then
      event_name := 'requirement.superseded'; event_action := 'superseded';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name,
      'requirement', new.id, event_action, to_jsonb(old), to_jsonb(new),
      jsonb_build_object('responsible_project_party_id', new.responsible_project_party_id), null);
  end if;
  return new;
end; $$;
drop trigger if exists requirements_audit_event on public.requirements;
create trigger requirements_audit_event after insert or update or delete on public.requirements
  for each row execute function public.audit_requirement_event();

create or replace function public.audit_document_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit_event(new.project_id, 'document.created',
    'document', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
  return new;
end; $$;
drop trigger if exists documents_audit_event on public.documents;
create trigger documents_audit_event after insert on public.documents
  for each row execute function public.audit_document_event();

create or replace function public.audit_document_version_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select d.project_id into pid from public.documents d where d.id = new.document_id;
  perform public.record_audit_event(pid, 'document.version_created',
    'document_version', new.id, 'version_created', null, to_jsonb(new),
    jsonb_build_object(
      'document_id', new.document_id,
      'version_label', new.version_label,
      'revision_number', new.revision_number,
      'original_filename', new.original_filename,
      'checksum', new.checksum
    ), null);
  return new;
end; $$;
drop trigger if exists document_versions_audit_event on public.document_versions;
create trigger document_versions_audit_event after insert on public.document_versions
  for each row execute function public.audit_document_version_event();

create or replace function public.audit_project_party_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'project_party.created',
      'project_party', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
  elsif old.is_active and not new.is_active then
    perform public.record_audit_event(new.project_id, 'project_party.deactivated',
      'project_party', new.id, 'deactivated', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  elsif new.party_type is distinct from old.party_type
     or new.display_name is distinct from old.display_name
     or new.organization_id is distinct from old.organization_id
     or new.is_active is distinct from old.is_active then
    perform public.record_audit_event(new.project_id, 'project_party.updated',
      'project_party', new.id, 'updated', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists project_parties_audit_event on public.project_parties;
create trigger project_parties_audit_event after insert or update on public.project_parties
  for each row execute function public.audit_project_party_event();

create or replace function public.audit_project_membership_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'project_membership.created',
      'project_membership', new.id, 'created', null, to_jsonb(new), '{}'::jsonb, null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'project_membership.removed',
      'project_membership', old.id, 'removed', to_jsonb(old), null, '{}'::jsonb, null);
    return old;
  end if;
  if new.project_role is distinct from old.project_role
     or new.project_party_id is distinct from old.project_party_id then
    perform public.record_audit_event(new.project_id, 'project_membership.role_changed',
      'project_membership', new.id, 'role_changed', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  if new.is_project_admin is distinct from old.is_project_admin then
    perform public.record_audit_event(new.project_id, 'project_membership.admin_changed',
      'project_membership', new.id, 'admin_changed', to_jsonb(old), to_jsonb(new), '{}'::jsonb, null);
  end if;
  return new;
end; $$;
drop trigger if exists project_memberships_audit_event on public.project_memberships;
-- BEFORE preserves the actor's pre-change membership when an admin demotes or
-- removes themselves. Any later guard failure rolls the event back atomically.
create trigger project_memberships_audit_event before insert or update or delete on public.project_memberships
  for each row execute function public.audit_project_membership_event();

create or replace function public.audit_acceptance_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(new.project_id, 'acceptance.stage_recorded',
      'acceptance_event', new.id, 'stage_recorded', null, to_jsonb(new),
      jsonb_build_object('stage_key', new.stage_key), null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(old.project_id, 'acceptance.stage_removed',
      'acceptance_event', old.id, 'stage_removed', to_jsonb(old), null,
      jsonb_build_object('stage_key', old.stage_key), null);
    return old;
  end if;
  if to_jsonb(new) is distinct from to_jsonb(old) then
    perform public.record_audit_event(new.project_id, 'acceptance.stage_updated',
      'acceptance_event', new.id, 'stage_updated', to_jsonb(old), to_jsonb(new),
      jsonb_build_object('stage_key', new.stage_key), null);
  end if;
  return new;
end; $$;
drop trigger if exists acceptance_events_audit_event on public.acceptance_events;
create trigger acceptance_events_audit_event after insert or update or delete on public.acceptance_events
  for each row execute function public.audit_acceptance_event();

do $$
declare fn text;
begin
  foreach fn in array array[
    'audit_valuation_event','audit_inspection_event','audit_defect_event',
    'audit_submittal_event','audit_rfi_event','audit_change_order_event',
    'audit_requirement_event','audit_document_event',
    'audit_document_version_event','audit_project_party_event',
    'audit_project_membership_event','audit_acceptance_event'
  ] loop
    execute format('revoke all on function public.%I() from public, anon, authenticated', fn);
  end loop;
end $$;

-- No trigger is installed on cost_items. Contractor cost, margin, and
-- subcontract values are intentionally excluded from the shared audit stream.
-- Correlation IDs remain null until a controlled request context exists.
-- -- End P0-05 audit events -------------------------------------------------

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

-- -- P0-06 §1: traceable document ingestion runs -----------------------------
-- One row per AI extraction attempt over an immutable document version. The
-- run answers: which version, which model/prompt, when, did it succeed, how
-- many suggestions, how many verified citations. Runs are system-managed:
-- project members read status; only the extract-requirements Edge Function
-- (service role, after verifying the caller's document permission) writes.
-- A run is provenance metadata, never contractual authority.
create table if not exists public.document_ingestion_runs (
  id                          uuid primary key default gen_random_uuid(),
  project_id                  uuid not null references public.projects(id) on delete cascade,
  document_version_id         uuid not null references public.document_versions(id) on delete cascade,
  run_type                    text not null default 'requirement_extraction'
    check (run_type in ('requirement_extraction')),
  status                      text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  model_provider              text,
  model_name                  text,
  prompt_version              text,
  started_by                  uuid references auth.users(id) on delete set null,
  started_at                  timestamptz not null default now(),
  completed_at                timestamptz,
  input_page_count            integer
    check (input_page_count is null or input_page_count >= 0),
  extracted_requirement_count integer
    check (extracted_requirement_count is null or extracted_requirement_count >= 0),
  verified_source_count       integer
    check (verified_source_count is null or verified_source_count >= 0),
  unverified_source_count     integer
    check (unverified_source_count is null or unverified_source_count >= 0),
  error_message               text,
  metadata                    jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object')
);
create index if not exists document_ingestion_runs_project_idx
  on public.document_ingestion_runs(project_id, started_at desc);
create index if not exists document_ingestion_runs_version_idx
  on public.document_ingestion_runs(document_version_id, started_at desc);

-- Data integrity for every writer (service role included): a run is pinned to
-- one document version of its own project, forever.
create or replace function public.validate_ingestion_run_document_version()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.document_version_id is distinct from old.document_version_id then
    raise exception 'ingestion run document version is immutable';
  end if;
  if not exists (
    select 1
    from public.document_versions v
    join public.documents d on d.id = v.document_id
    where v.id = new.document_version_id and d.project_id = new.project_id
  ) then
    raise exception 'ingestion run and document version must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists document_ingestion_runs_same_project on public.document_ingestion_runs;
create trigger document_ingestion_runs_same_project
  before insert or update on public.document_ingestion_runs for each row
  execute function public.validate_ingestion_run_document_version();

drop trigger if exists document_ingestion_runs_project_identity_guard on public.document_ingestion_runs;
create trigger document_ingestion_runs_project_identity_guard
  before update on public.document_ingestion_runs for each row
  execute function public.guard_project_identity();

-- Members read run status; nobody writes from the browser. There are
-- deliberately no INSERT / UPDATE / DELETE policies, and the table privileges
-- are revoked as well - the Edge Function's service-role client is the only
-- application path that manages run lifecycle.
alter table public.document_ingestion_runs enable row level security;
drop policy if exists "document_ingestion_runs_select" on public.document_ingestion_runs;
create policy "document_ingestion_runs_select" on public.document_ingestion_runs
  for select to authenticated using (project_id in (select public.my_project_ids()));
revoke insert, update, delete on public.document_ingestion_runs from public, anon, authenticated;
grant select on public.document_ingestion_runs to authenticated;

-- Defense in depth mirroring audit_events: even a privileged path carrying an
-- authenticated JWT cannot manufacture or rewrite run provenance.
create or replace function public.guard_ingestion_run_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    raise exception 'document ingestion runs are system-managed';
  end if;
  return coalesce(new, old);
end; $$;
drop trigger if exists document_ingestion_runs_system_managed on public.document_ingestion_runs;
create trigger document_ingestion_runs_system_managed
  before insert or update or delete on public.document_ingestion_runs
  for each row execute function public.guard_ingestion_run_write();
revoke all on function public.guard_ingestion_run_write() from public, anon, authenticated;

-- -- P0-06 §2: requirement -> extraction-run provenance -----------------------
alter table public.requirements
  add column if not exists ingestion_run_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirements_ingestion_run_fk'
      and conrelid = 'public.requirements'::regclass
  ) then
    alter table public.requirements
      add constraint requirements_ingestion_run_fk
      foreign key (ingestion_run_id)
      references public.document_ingestion_runs(id) on delete set null;
  end if;
end; $$;
create index if not exists requirements_ingestion_run_idx
  on public.requirements(ingestion_run_id) where ingestion_run_id is not null;

-- Provenance is written only by the ingestion service. Application users can
-- neither claim AI-run provenance for a manual Requirement nor detach an AI
-- suggestion from the run that produced it. The same-project rule holds for
-- every writer. Requirement authority is never derived from this field.
create or replace function public.guard_requirement_ingestion_provenance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' and new.ingestion_run_id is not null then
      raise exception 'only the ingestion service can attach a requirement to an ingestion run';
    end if;
    if tg_op = 'UPDATE' and new.ingestion_run_id is distinct from old.ingestion_run_id then
      raise exception 'requirement ingestion provenance is immutable for application users';
    end if;
  end if;
  if new.ingestion_run_id is not null and not exists (
    select 1 from public.document_ingestion_runs r
    where r.id = new.ingestion_run_id and r.project_id = new.project_id
  ) then
    raise exception 'requirement and ingestion run must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_ingestion_provenance_guard on public.requirements;
create trigger requirements_ingestion_provenance_guard
  before insert or update on public.requirements for each row
  execute function public.guard_requirement_ingestion_provenance();

-- select * views freeze their column list at creation; refresh so approved
-- consumers also see the appended provenance column.
create or replace view public.authoritative_requirements
with (security_invoker = true) as
  select * from public.requirements where is_authoritative;

-- -- P0-06 §3: ingestion lifecycle audit events -------------------------------
-- Reuses the P0-05 transactional trigger architecture. No frontend inserts;
-- document.created / document.version_created / requirement.created already
-- flow from their own P0-05 triggers and are not duplicated here.
create or replace function public.audit_document_ingestion_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    if new.status in ('completed','failed') then
      event_name := 'document.ingestion_' || new.status;
      event_action := 'ingestion_' || new.status;
    end if;
  elsif new.status is distinct from old.status and new.status in ('completed','failed') then
    event_name := 'document.ingestion_' || new.status;
    event_action := 'ingestion_' || new.status;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name,
      'document_ingestion_run', new.id, event_action,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new),
      jsonb_build_object('document_version_id', new.document_version_id), null);
  end if;
  return new;
end; $$;
drop trigger if exists document_ingestion_runs_audit_event on public.document_ingestion_runs;
create trigger document_ingestion_runs_audit_event
  after insert or update on public.document_ingestion_runs
  for each row execute function public.audit_document_ingestion_event();
revoke all on function public.audit_document_ingestion_event() from public, anon, authenticated;
-- -- End P0-06 document ingestion ---------------------------------------------

-- -- P0-07 §1: BOQ candidate link review state --------------------------------
-- review_status is the canonical review state of a requirement -> work-item
-- link. The P0-01 `reviewed` boolean is kept as a derived compatibility field
-- (reviewed = review_status = 'approved') so older writers and readers cannot
-- drift from the new model; a writer that only sets the legacy boolean still
-- resolves to the right state. Decision authority stays with Requirement
-- reviewers (P0-03 RLS on requirement_work_items), and an application user
-- can never insert an AI suggestion that is already approved.
alter table public.requirement_work_items
  add column if not exists review_status text not null default 'suggested'
    check (review_status in ('suggested','approved','rejected'));

create or replace function public.sync_requirement_work_item_review_state()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.reviewed and new.review_status = 'suggested' then
      new.review_status := 'approved'; -- legacy boolean-only writer
    end if;
    if auth.uid() is not null and new.match_type = 'ai'
       and new.review_status <> 'suggested' then
      raise exception 'AI work-item suggestions must start as suggested';
    end if;
  else
    if new.review_status is not distinct from old.review_status
       and new.reviewed is distinct from old.reviewed then
      new.review_status := case when new.reviewed then 'approved' else 'suggested' end;
    end if;
  end if;
  new.reviewed := (new.review_status = 'approved');
  return new;
end; $$;
drop trigger if exists requirement_work_items_review_state on public.requirement_work_items;
create trigger requirement_work_items_review_state
  before insert or update on public.requirement_work_items for each row
  execute function public.sync_requirement_work_item_review_state();

-- One-time backfill for rows created before review_status existed.
update public.requirement_work_items
  set review_status = 'approved'
  where reviewed and review_status = 'suggested';

create or replace function public.audit_requirement_work_item_link_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid; event_name text; event_action text;
begin
  select project_id into pid from public.requirements where id = new.requirement_id;
  if pid is null then return new; end if; -- parent cascade in flight
  if tg_op = 'INSERT' then
    if new.match_type <> 'ai' then
      event_name := 'requirement.work_item_link_added';
      event_action := 'work_item_link_added';
    end if;
  elsif new.review_status is distinct from old.review_status then
    if new.review_status = 'approved' then
      event_name := 'requirement.work_item_link_approved';
      event_action := 'work_item_link_approved';
    elsif new.review_status = 'rejected' then
      event_name := 'requirement.work_item_link_rejected';
      event_action := 'work_item_link_rejected';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(pid, event_name, 'requirement_work_item',
      new.requirement_id, event_action,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new),
      jsonb_build_object('work_item_id', new.work_item_id, 'match_type', new.match_type),
      null);
  end if;
  return new;
end; $$;
drop trigger if exists requirement_work_items_audit_event on public.requirement_work_items;
create trigger requirement_work_items_audit_event
  after insert or update on public.requirement_work_items
  for each row execute function public.audit_requirement_work_item_link_event();
revoke all on function public.audit_requirement_work_item_link_event()
  from public, anon, authenticated;

-- -- P0-07 §2: citation mutation safety ---------------------------------------
-- source_verified is a system verdict (P0-06 deterministic verification runs
-- with no authenticated JWT). An application user can never grant it, and any
-- human edit to a citation conservatively resets it to false - a stale
-- verified flag cannot survive a changed quotation. Service-role ingestion
-- writes are untouched. The P0-03 snapshot guard fires first (alphabetical
-- trigger order), so citations of reviewed Requirements stay frozen with
-- their original error message.
create or replace function public.guard_requirement_source_verification()
returns trigger language plpgsql security definer set search_path = public as $$
declare citation_changed boolean;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.source_verified then
      raise exception 'source verification is determined by the system';
    end if;
    return new;
  end if;
  citation_changed :=
       new.document_version_id is distinct from old.document_version_id
    or new.page_number         is distinct from old.page_number
    or new.page_label          is distinct from old.page_label
    or new.section             is distinct from old.section
    or new.clause              is distinct from old.clause
    or new.source_text         is distinct from old.source_text
    or new.source_start_offset is distinct from old.source_start_offset
    or new.source_end_offset   is distinct from old.source_end_offset;
  if citation_changed then
    new.source_verified := false;
  elsif new.source_verified and not old.source_verified then
    raise exception 'source verification is determined by the system';
  end if;
  return new;
end; $$;
drop trigger if exists requirement_sources_verification_guard on public.requirement_sources;
create trigger requirement_sources_verification_guard
  before insert or update on public.requirement_sources for each row
  execute function public.guard_requirement_source_verification();
revoke all on function public.guard_requirement_source_verification()
  from public, anon, authenticated;

-- -- P0-07 §3: controlled requirement review ----------------------------------
-- Lifecycle decisions (approve / reject / supersede) exist for application
-- users only as the review_requirement action below. It stamps
-- reviewed_by/reviewed_at from the server context and marks the transaction
-- with a review context that only this SECURITY DEFINER function can set
-- (PostgREST clients cannot write arbitrary GUCs), so a direct browser PATCH
-- can neither change status nor forge review metadata. Writers without an
-- authenticated JWT (service role, migrations, legacy sync fixtures) keep
-- their P0-03 behavior - except that an AI-origin Requirement can never
-- become approved without a completed ingestion run, for any writer.
create or replace function public.requirements_snapshot_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  content_changed boolean;
  metadata_changed boolean;
  review_context boolean;
  run_status text;
begin
  if tg_op = 'UPDATE'
     and new.status = 'approved' and old.status is distinct from 'approved'
     and new.origin = 'ai' then
    if new.ingestion_run_id is not null then
      select status into run_status from public.document_ingestion_runs
        where id = new.ingestion_run_id;
    end if;
    if run_status is distinct from 'completed' then
      raise exception 'AI requirement approval requires a completed ingestion run';
    end if;
  end if;

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

  review_context :=
    coalesce(current_setting('pmis.requirement_review', true), '') = old.id::text;

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
    if not review_context then
      raise exception 'requirement lifecycle transitions require the controlled review action';
    end if;
  end if;

  metadata_changed :=
       new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at;
  if metadata_changed and not review_context
     and old.status in ('draft_ai','needs_review') then
    raise exception 'review metadata is stamped by the controlled review action';
  end if;

  if new.origin is distinct from old.origin
     or new.legacy_contract_obligation_id is distinct from old.legacy_contract_obligation_id then
    raise exception 'requirement origin provenance is immutable for application users';
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
    or new.confidence             is distinct from old.confidence
    or (metadata_changed and not review_context);
  if content_changed and old.status not in ('draft_ai','needs_review') then
    raise exception 'reviewed requirement content is immutable; supersede and create a new requirement';
  end if;
  return new;
end; $$;
drop trigger if exists requirements_snapshot_guard on public.requirements;
create trigger requirements_snapshot_guard before insert or update or delete on public.requirements
  for each row execute function public.requirements_snapshot_guard();

-- The one controlled review action. Narrow decisions, server-derived project,
-- server-stamped actor/time; the caller supplies nothing but the requirement
-- and the decision. Returns the updated row so the UI refreshes from the
-- server instead of optimistically displaying approval.
create or replace function public.review_requirement(
  p_requirement_id uuid,
  p_decision text
) returns public.requirements
language plpgsql security definer set search_path = public as $$
declare
  req public.requirements;
  run_status text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into req from public.requirements where id = p_requirement_id;
  if not found then
    raise exception 'requirement not found';
  end if;
  if not public.can_review_requirement(req.project_id) then
    raise exception 'requirement review requires a requirement reviewer';
  end if;
  if p_decision not in ('approve','reject','supersede') then
    raise exception 'unknown review decision: %', p_decision;
  end if;
  if (p_decision in ('approve','reject') and req.status not in ('draft_ai','needs_review'))
     or (p_decision = 'supersede' and req.status <> 'approved') then
    raise exception 'invalid requirement lifecycle transition from % via %',
      req.status, p_decision;
  end if;
  if p_decision = 'approve' and req.origin = 'ai' then
    if req.ingestion_run_id is not null then
      select status into run_status from public.document_ingestion_runs
        where id = req.ingestion_run_id;
    end if;
    if run_status is distinct from 'completed' then
      raise exception 'AI requirement approval requires a completed ingestion run';
    end if;
  end if;
  perform set_config('pmis.requirement_review', req.id::text, true);
  update public.requirements
  set status = case p_decision
        when 'approve' then 'approved'
        when 'reject' then 'rejected'
        else 'superseded'
      end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = req.id
  returning * into req;
  perform set_config('pmis.requirement_review', '', true);
  return req;
end; $$;
revoke all on function public.review_requirement(uuid, text) from public, anon;
grant execute on function public.review_requirement(uuid, text) to authenticated;

-- -- P0-07 §4: approved requirement -> artifact link boundary ------------------
-- The explicit relationship between an approved Requirement and downstream
-- workflow artifacts. P0-07 creates and protects the boundary only: nothing
-- here generates inspection points, checklists, tests, or submittals, and raw
-- AI output can never activate a field workflow. 'report' has no durable
-- artifact table yet and is intentionally outside the initial vocabulary.
create table if not exists public.requirement_artifact_links (
  id              uuid primary key default gen_random_uuid(),
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  artifact_type   text not null check (artifact_type in
    ('inspection_point','checklist','test','submittal','evidence','deadline')),
  artifact_id     uuid not null,
  generation_type text not null default 'manual'
    check (generation_type in ('manual','ai_draft','migration')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (requirement_id, artifact_type, artifact_id)
);
create index if not exists requirement_artifact_links_requirement_idx
  on public.requirement_artifact_links(requirement_id);
create index if not exists requirement_artifact_links_artifact_idx
  on public.requirement_artifact_links(artifact_type, artifact_id);

create or replace function public.validate_requirement_artifact_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  req record;
  artifact_project uuid;
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  select project_id, status into req
  from public.requirements where id = new.requirement_id;
  if req.status is distinct from 'approved' then
    raise exception 'artifact links require an approved requirement';
  end if;
  artifact_project := case new.artifact_type
    when 'inspection_point' then
      (select project_id from public.inspection_points where id = new.artifact_id)
    when 'checklist' then
      (select project_id from public.checklist_templates where id = new.artifact_id)
    when 'test' then
      (select project_id from public.test_samples where id = new.artifact_id)
    when 'submittal' then
      (select project_id from public.submittals where id = new.artifact_id)
    when 'evidence' then
      (select project_id from public.photos where id = new.artifact_id)
    when 'deadline' then
      (select project_id from public.contract_obligations where id = new.artifact_id)
  end;
  if artifact_project is null then
    raise exception 'artifact does not exist for type %', new.artifact_type;
  end if;
  if artifact_project <> req.project_id then
    raise exception 'requirement and artifact must belong to the same project';
  end if;
  return new;
end; $$;
drop trigger if exists requirement_artifact_links_validate on public.requirement_artifact_links;
create trigger requirement_artifact_links_validate
  before insert or update on public.requirement_artifact_links for each row
  execute function public.validate_requirement_artifact_link();
revoke all on function public.validate_requirement_artifact_link()
  from public, anon, authenticated;

-- Project members read links; creating/removing a Requirement -> artifact
-- relationship is a Requirement-reviewer decision (P0-07 authorization rule).
-- No UPDATE policy: a link is a point-in-time decision - delete and recreate.
alter table public.requirement_artifact_links enable row level security;
drop policy if exists "requirement_artifact_links_select" on public.requirement_artifact_links;
create policy "requirement_artifact_links_select" on public.requirement_artifact_links
  for select to authenticated using (requirement_id in (
    select id from public.requirements where project_id in (select public.my_project_ids())
  ));
drop policy if exists "requirement_artifact_links_insert" on public.requirement_artifact_links;
create policy "requirement_artifact_links_insert" on public.requirement_artifact_links
  for insert to authenticated with check (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)
  ));
drop policy if exists "requirement_artifact_links_delete" on public.requirement_artifact_links;
create policy "requirement_artifact_links_delete" on public.requirement_artifact_links
  for delete to authenticated using (requirement_id in (
    select id from public.requirements where public.can_review_requirement(project_id)
  ));

create or replace function public.audit_requirement_artifact_link_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from public.requirements where id = new.requirement_id;
  if pid is null then return new; end if;
  perform public.record_audit_event(pid, 'requirement.artifact_link_created',
    'requirement_artifact_link', new.id, 'artifact_link_created', null, to_jsonb(new),
    jsonb_build_object(
      'requirement_id', new.requirement_id,
      'artifact_type', new.artifact_type,
      'artifact_id', new.artifact_id,
      'generation_type', new.generation_type
    ), null);
  return new;
end; $$;
drop trigger if exists requirement_artifact_links_audit_event on public.requirement_artifact_links;
create trigger requirement_artifact_links_audit_event
  after insert on public.requirement_artifact_links
  for each row execute function public.audit_requirement_artifact_link_event();
revoke all on function public.audit_requirement_artifact_link_event()
  from public, anon, authenticated;
-- -- End P0-07 requirement review ----------------------------------------------

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

-- -- P0-07.5 §1: contract package domain --------------------------------------
create table if not exists public.contract_packages (
  id                            uuid primary key default gen_random_uuid(),
  project_id                    uuid not null references public.projects(id) on delete cascade,
  owner_project_party_id        uuid references public.project_parties(id) on delete set null,
  counterparty_project_party_id uuid not null references public.project_parties(id) on delete cascade,
  package_type                  text not null default 'other'
    check (package_type in ('construction','supervision','other')),
  title                         text not null,
  status                        text not null default 'draft'
    check (status in ('draft','processing','ready','needs_attention','archived')),
  created_by                    uuid references auth.users(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index if not exists contract_packages_project_idx
  on public.contract_packages(project_id);
-- One package per (project, type, counterparty): lazy get-or-create from the
-- upload flow stays deterministic and re-uploads never fork a second package.
create unique index if not exists contract_packages_identity_uidx
  on public.contract_packages(project_id, package_type, counterparty_project_party_id);

create or replace function public.validate_contract_package_parties()
returns trigger language plpgsql set search_path = public as $$
declare counterparty record; owner_party record;
begin
  if tg_op = 'UPDATE' and (
       new.package_type is distinct from old.package_type
    or new.counterparty_project_party_id is distinct from old.counterparty_project_party_id
  ) then
    raise exception 'contract package identity is immutable';
  end if;
  select project_id, party_type into counterparty
  from public.project_parties where id = new.counterparty_project_party_id;
  if counterparty.project_id is distinct from new.project_id then
    raise exception 'contract package and counterparty must belong to the same project';
  end if;
  if new.package_type = 'construction' and counterparty.party_type <> 'contractor' then
    raise exception 'construction package counterparty must be a contractor party';
  end if;
  if new.package_type = 'supervision' and counterparty.party_type <> 'supervisor' then
    raise exception 'supervision package counterparty must be a supervisor party';
  end if;
  if new.owner_project_party_id is not null then
    select project_id, party_type into owner_party
    from public.project_parties where id = new.owner_project_party_id;
    if owner_party.project_id is distinct from new.project_id
       or owner_party.party_type <> 'agency' then
      raise exception 'contract package owner must be an agency party of the same project';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists contract_packages_validate on public.contract_packages;
create trigger contract_packages_validate
  before insert or update on public.contract_packages for each row
  execute function public.validate_contract_package_parties();

drop trigger if exists contract_packages_project_identity_guard on public.contract_packages;
create trigger contract_packages_project_identity_guard
  before update on public.contract_packages for each row
  execute function public.guard_project_identity();

drop trigger if exists contract_packages_touch_updated_at on public.contract_packages;
create trigger contract_packages_touch_updated_at
  before update on public.contract_packages for each row
  execute function public.touch_document_updated_at();

-- -- P0-07.5 §2: party-scoped package visibility -------------------------------
-- Visibility baseline (never technical-admin based, never org_type based):
--   agency party     -> every package in the project
--   supervisor party -> construction packages + packages where it is the
--                       counterparty (its own supervision contract)
--   any other party  -> only packages where it is the counterparty
create or replace function public.can_access_contract_package(
  p_project uuid, p_type text, p_counterparty uuid
) returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.my_project_membership(p_project) m
    where m.party_type = 'agency'
       or (m.party_type = 'supervisor'
           and (p_type = 'construction' or p_counterparty = m.project_party_id))
       or p_counterparty = m.project_party_id
  )
$$;

create or replace function public.can_read_contract_package(p_package uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.contract_packages cp
    where cp.id = p_package
      and public.can_access_contract_package(
        cp.project_id, cp.package_type, cp.counterparty_project_party_id)
  )
$$;

-- Writing into a package = document custody + package visibility. A
-- contractor can therefore never create or fill the supervision package.
create or replace function public.can_upload_contract_package(p_package uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.contract_packages cp
    where cp.id = p_package
      and public.can_manage_documents(cp.project_id)
      and public.can_access_contract_package(
        cp.project_id, cp.package_type, cp.counterparty_project_party_id)
  )
$$;

revoke all on function public.can_access_contract_package(uuid, text, uuid) from public, anon;
revoke all on function public.can_read_contract_package(uuid) from public, anon;
revoke all on function public.can_upload_contract_package(uuid) from public, anon;
grant execute on function public.can_access_contract_package(uuid, text, uuid) to authenticated;
grant execute on function public.can_read_contract_package(uuid) to authenticated;
grant execute on function public.can_upload_contract_package(uuid) to authenticated;

alter table public.contract_packages enable row level security;
drop policy if exists "contract_packages_select" on public.contract_packages;
create policy "contract_packages_select" on public.contract_packages
  for select to authenticated
  using (public.can_access_contract_package(
    project_id, package_type, counterparty_project_party_id));
drop policy if exists "contract_packages_insert" on public.contract_packages;
create policy "contract_packages_insert" on public.contract_packages
  for insert to authenticated
  with check (public.can_manage_documents(project_id)
    and public.can_access_contract_package(
      project_id, package_type, counterparty_project_party_id));
drop policy if exists "contract_packages_update" on public.contract_packages;
create policy "contract_packages_update" on public.contract_packages
  for update to authenticated
  using (public.can_upload_contract_package(id))
  with check (public.can_upload_contract_package(id));
-- No DELETE policy: packages are archived via status, never removed by users.

-- -- P0-07.5 §3: package -> document relationship ------------------------------
alter table public.documents
  add column if not exists contract_package_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_contract_package_fk'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_contract_package_fk
      foreign key (contract_package_id)
      references public.contract_packages(id) on delete set null;
  end if;
end; $$;
create index if not exists documents_contract_package_idx
  on public.documents(contract_package_id) where contract_package_id is not null;

create or replace function public.validate_document_contract_package()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contract_package_id is not null and not exists (
    select 1 from public.contract_packages cp
    where cp.id = new.contract_package_id and cp.project_id = new.project_id
  ) then
    raise exception 'document and contract package must belong to the same project';
  end if;
  -- Filing a document INTO a package needs package upload authority, not just
  -- generic document custody - a contractor can never populate the
  -- supervision package.
  if new.contract_package_id is not null
     and auth.uid() is not null
     and (tg_op = 'INSERT' or new.contract_package_id is distinct from old.contract_package_id)
     and not public.can_upload_contract_package(new.contract_package_id) then
    raise exception 'no authority to file documents into this contract package';
  end if;
  return new;
end; $$;
drop trigger if exists documents_contract_package_same_project on public.documents;
create trigger documents_contract_package_same_project
  before insert or update on public.documents for each row
  execute function public.validate_document_contract_package();

-- -- P0-07.5 §4: package-aware read boundary -----------------------------------
-- Documents filed in a package inherit its visibility; unfiled documents keep
-- their P0-01 project-member visibility. One SECURITY DEFINER resolver keeps
-- the version/page/run/requirement policies cheap and consistent.
create or replace function public.can_read_project_document(
  p_project uuid, p_package uuid
) returns boolean language sql security definer stable set search_path = public as $$
  select p_project in (select public.my_project_ids())
     and (p_package is null or public.can_read_contract_package(p_package))
$$;

create or replace function public.can_read_document_version(p_version uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.document_versions v
    join public.documents d on d.id = v.document_id
    where v.id = p_version
      and public.can_read_project_document(d.project_id, d.contract_package_id)
  )
$$;

-- Package-aware write boundary. Existing unfiled documents retain the P0-06
-- document-custody rule; filed documents additionally require upload authority
-- for that exact visible package. Guessed supervision-package UUIDs therefore
-- cannot be used to mutate documents, versions, or extracted pages.
create or replace function public.can_write_project_document(
  p_project uuid, p_package uuid
) returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_documents(p_project)
     and (p_package is null or public.can_upload_contract_package(p_package))
$$;

create or replace function public.can_write_document(p_document uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.documents d where d.id = p_document
      and public.can_write_project_document(d.project_id, d.contract_package_id)
  )
$$;

create or replace function public.can_write_document_version(p_version uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.document_versions v where v.id = p_version
      and public.can_write_document(v.document_id)
  )
$$;

-- AI provenance chain: requirements from a run over a package-restricted
-- document are only visible where the package is; manual/migration
-- requirements (no run) keep project visibility.
create or replace function public.can_read_requirement_provenance(p_run uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_run is null or exists (
    select 1 from public.document_ingestion_runs r
    where r.id = p_run
      and public.can_read_document_version(r.document_version_id)
  )
$$;

revoke all on function public.can_read_project_document(uuid, uuid) from public, anon;
revoke all on function public.can_read_document_version(uuid) from public, anon;
revoke all on function public.can_read_requirement_provenance(uuid) from public, anon;
revoke all on function public.can_write_project_document(uuid, uuid) from public, anon;
revoke all on function public.can_write_document(uuid) from public, anon;
revoke all on function public.can_write_document_version(uuid) from public, anon;
grant execute on function public.can_read_project_document(uuid, uuid) to authenticated;
grant execute on function public.can_read_document_version(uuid) to authenticated;
grant execute on function public.can_read_requirement_provenance(uuid) to authenticated;
grant execute on function public.can_write_project_document(uuid, uuid) to authenticated;
grant execute on function public.can_write_document(uuid) to authenticated;
grant execute on function public.can_write_document_version(uuid) to authenticated;

drop policy if exists "documents_select" on public.documents;
create policy "documents_select" on public.documents for select to authenticated
  using (public.can_read_project_document(project_id, contract_package_id));

drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert" on public.documents for insert to authenticated
  with check (public.can_write_project_document(project_id, contract_package_id));
drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update to authenticated
  using (public.can_write_project_document(project_id, contract_package_id))
  with check (public.can_write_project_document(project_id, contract_package_id));

drop policy if exists "document_versions_select" on public.document_versions;
create policy "document_versions_select" on public.document_versions
  for select to authenticated using (public.can_read_document_version(id));

drop policy if exists "document_versions_insert" on public.document_versions;
create policy "document_versions_insert" on public.document_versions
  for insert to authenticated with check (public.can_write_document(document_id));
drop policy if exists "document_versions_update" on public.document_versions;
create policy "document_versions_update" on public.document_versions
  for update to authenticated
  using (public.can_write_document(document_id))
  with check (public.can_write_document(document_id));

drop policy if exists "document_pages_select" on public.document_pages;
create policy "document_pages_select" on public.document_pages
  for select to authenticated
  using (public.can_read_document_version(document_version_id));

drop policy if exists "document_pages_insert" on public.document_pages;
create policy "document_pages_insert" on public.document_pages
  for insert to authenticated
  with check (public.can_write_document_version(document_version_id));
drop policy if exists "document_pages_update" on public.document_pages;
create policy "document_pages_update" on public.document_pages
  for update to authenticated
  using (public.can_write_document_version(document_version_id))
  with check (public.can_write_document_version(document_version_id));
drop policy if exists "document_pages_delete" on public.document_pages;
create policy "document_pages_delete" on public.document_pages
  for delete to authenticated
  using (public.can_write_document_version(document_version_id));

drop policy if exists "document_ingestion_runs_select" on public.document_ingestion_runs;
create policy "document_ingestion_runs_select" on public.document_ingestion_runs
  for select to authenticated
  using (project_id in (select public.my_project_ids())
    and public.can_read_document_version(document_version_id));

drop policy if exists "requirements_select" on public.requirements;
create policy "requirements_select" on public.requirements for select to authenticated
  using (project_id in (select public.my_project_ids())
    and public.can_read_requirement_provenance(ingestion_run_id));

drop policy if exists "requirement_sources_select" on public.requirement_sources;
create policy "requirement_sources_select" on public.requirement_sources
  for select to authenticated
  using (
    requirement_id in (
      select r.id from public.requirements r
      where r.project_id in (select public.my_project_ids())
        and public.can_read_requirement_provenance(r.ingestion_run_id)
    )
    and (document_version_id is null
      or public.can_read_document_version(document_version_id))
  );

drop policy if exists "requirement_work_items_select" on public.requirement_work_items;
create policy "requirement_work_items_select" on public.requirement_work_items
  for select to authenticated
  using (requirement_id in (
    select r.id from public.requirements r
    where r.project_id in (select public.my_project_ids())
      and public.can_read_requirement_provenance(r.ingestion_run_id)
  ));

drop policy if exists "requirement_artifact_links_select" on public.requirement_artifact_links;
create policy "requirement_artifact_links_select" on public.requirement_artifact_links
  for select to authenticated
  using (requirement_id in (
    select r.id from public.requirements r
    where r.project_id in (select public.my_project_ids())
      and public.can_read_requirement_provenance(r.ingestion_run_id)
  ));

-- Shared audit stream must not leak restricted package details. Events whose
-- entity still resolves to a package-restricted row follow package
-- visibility; events for deleted entities stay project-readable (their
-- payloads never include more than the actor could already see at the time).
create or replace function public.can_read_audit_entity(
  p_entity_type text, p_entity uuid
) returns boolean language plpgsql security definer stable set search_path = public as $$
declare package_id uuid; run_id uuid;
begin
  if p_entity is null then return true; end if;
  if p_entity_type = 'contract_package' then
    if not exists (select 1 from public.contract_packages where id = p_entity) then
      return true;
    end if;
    return public.can_read_contract_package(p_entity);
  elsif p_entity_type = 'document' then
    select contract_package_id into package_id from public.documents where id = p_entity;
    if not found then return true; end if;
    return package_id is null or public.can_read_contract_package(package_id);
  elsif p_entity_type = 'document_version' then
    if not exists (select 1 from public.document_versions where id = p_entity) then
      return true;
    end if;
    return public.can_read_document_version(p_entity);
  elsif p_entity_type = 'document_ingestion_run' then
    select id into run_id from public.document_ingestion_runs where id = p_entity;
    if not found then return true; end if;
    return public.can_read_requirement_provenance(p_entity);
  elsif p_entity_type = 'document_processing_run' then
    select contract_package_id into package_id
    from public.document_processing_runs where id = p_entity;
    if not found then return true; end if;
    return public.can_read_contract_package(package_id);
  elsif p_entity_type in ('requirement','requirement_work_item') then
    select ingestion_run_id into run_id from public.requirements where id = p_entity;
    if not found then return true; end if;
    return public.can_read_requirement_provenance(run_id);
  end if;
  return true;
end; $$;
revoke all on function public.can_read_audit_entity(text, uuid) from public, anon;
grant execute on function public.can_read_audit_entity(text, uuid) to authenticated;

drop policy if exists "audit_events_select" on public.audit_events;
create policy "audit_events_select" on public.audit_events for select to authenticated
  using (project_id in (select public.my_project_ids())
    and public.can_read_audit_entity(entity_type, entity_id));

-- -- P0-07.5 §5: per-file processing state -------------------------------------
-- One row per document version per package: honest stage-based progress that
-- survives a browser refresh. This is UX state written by the uploading
-- document manager - it is NOT contractual authority and never bypasses the
-- P0-06 system-managed ingestion runs or the P0-07 review boundary.
create table if not exists public.document_processing_runs (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references public.projects(id) on delete cascade,
  contract_package_id       uuid not null references public.contract_packages(id) on delete cascade,
  document_version_id       uuid not null references public.document_versions(id) on delete cascade,
  status                    text not null default 'pending'
    check (status in ('pending','processing','completed','partial','failed','unsupported')),
  stage                     text not null default 'received'
    check (stage in ('received','uploaded','extracting_text','classifying',
                     'extracting_requirements','completed','failed','unsupported')),
  parser_type               text,
  classification_status     text
    check (classification_status is null
      or classification_status in ('auto_accepted','needs_review','confirmed')),
  suggested_document_type   text
    check (suggested_document_type is null or suggested_document_type in
      ('contract','specification','quality_plan','itp','form_package',
       'submittal_document','drawing','report','other')),
  classification_confidence numeric
    check (classification_confidence is null
      or (classification_confidence >= 0 and classification_confidence <= 1)),
  started_by                uuid references auth.users(id) on delete set null,
  started_at                timestamptz not null default now(),
  completed_at              timestamptz,
  error_message             text,
  metadata                  jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  check (parser_type is null or parser_type in ('pdf','docx','txt','none')),
  check (
    (status in ('pending','processing') and completed_at is null)
    or (status in ('completed','partial','failed','unsupported') and completed_at is not null)
  ),
  check (status <> 'completed' or stage = 'completed'),
  check (stage <> 'completed' or status = 'completed'),
  check (
    status <> 'unsupported'
    or (stage = 'unsupported' and parser_type = 'none'
      and coalesce(metadata->>'requirement_extraction', 'skipped') <> 'completed')
  ),
  check (stage <> 'unsupported' or status = 'unsupported'),
  -- retry updates the same row: no duplicate processing state per file content
  unique (document_version_id)
);
create index if not exists document_processing_runs_package_idx
  on public.document_processing_runs(contract_package_id, started_at desc);
create index if not exists document_processing_runs_project_idx
  on public.document_processing_runs(project_id, started_at desc);

create or replace function public.validate_document_processing_run()
returns trigger language plpgsql set search_path = public as $$
declare doc record;
begin
  if not exists (
    select 1 from public.contract_packages cp
    where cp.id = new.contract_package_id and cp.project_id = new.project_id
  ) then
    raise exception 'processing run and contract package must belong to the same project';
  end if;
  select d.project_id, d.contract_package_id into doc
  from public.document_versions v
  join public.documents d on d.id = v.document_id
  where v.id = new.document_version_id;
  if doc.project_id is distinct from new.project_id then
    raise exception 'processing run and document version must belong to the same project';
  end if;
  if doc.contract_package_id is distinct from new.contract_package_id then
    raise exception 'processing run must match the document''s contract package';
  end if;
  return new;
end; $$;
drop trigger if exists document_processing_runs_same_project on public.document_processing_runs;
create trigger document_processing_runs_same_project
  before insert or update on public.document_processing_runs for each row
  execute function public.validate_document_processing_run();

drop trigger if exists document_processing_runs_project_identity_guard on public.document_processing_runs;
create trigger document_processing_runs_project_identity_guard
  before update on public.document_processing_runs for each row
  execute function public.guard_project_identity();

alter table public.document_processing_runs enable row level security;
drop policy if exists "document_processing_runs_select" on public.document_processing_runs;
create policy "document_processing_runs_select" on public.document_processing_runs
  for select to authenticated
  using (public.can_read_contract_package(contract_package_id));
drop policy if exists "document_processing_runs_insert" on public.document_processing_runs;
create policy "document_processing_runs_insert" on public.document_processing_runs
  for insert to authenticated
  with check (public.can_upload_contract_package(contract_package_id));
drop policy if exists "document_processing_runs_update" on public.document_processing_runs;
create policy "document_processing_runs_update" on public.document_processing_runs
  for update to authenticated
  using (public.can_upload_contract_package(contract_package_id))
  with check (public.can_upload_contract_package(contract_package_id));
-- No DELETE policy: processing history is retained.

-- -- P0-07.5 §6: private contract binary storage --------------------------------
-- Path: projects/{project}/contract-packages/{package}/{document}/{version}/{filename}
-- Folder segment 4 is the package id, so object access follows package
-- visibility exactly. The bucket is private; no public URLs exist.
insert into storage.buckets (id, name, public)
values ('contract-documents', 'contract-documents', false)
on conflict (id) do nothing;

drop policy if exists "contract_documents_select" on storage.objects;
create policy "contract_documents_select" on storage.objects for select to authenticated
  using (bucket_id = 'contract-documents'
    and public.can_read_contract_package(((storage.foldername(name))[4])::uuid));
drop policy if exists "contract_documents_insert" on storage.objects;
create policy "contract_documents_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'contract-documents'
    and public.can_upload_contract_package(((storage.foldername(name))[4])::uuid));
-- No UPDATE/DELETE policies: uploaded contract binaries are immutable evidence.

-- -- P0-07.5 §7: focused audit events -------------------------------------------
create or replace function public.audit_contract_package_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_name text; event_action text;
begin
  if tg_op = 'INSERT' then
    event_name := 'contract_package.created'; event_action := 'created';
  elsif new.status is distinct from old.status then
    if new.status = 'processing' then
      event_name := 'contract_package.processing_started'; event_action := 'processing_started';
    elsif new.status = 'ready' then
      event_name := 'contract_package.ready'; event_action := 'ready';
    end if;
  end if;
  if event_name is not null then
    perform public.record_audit_event(new.project_id, event_name,
      'contract_package', new.id, event_action,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new),
      jsonb_build_object('package_type', new.package_type), null);
  end if;
  return new;
end; $$;
drop trigger if exists contract_packages_audit_event on public.contract_packages;
create trigger contract_packages_audit_event
  after insert or update on public.contract_packages
  for each row execute function public.audit_contract_package_event();
revoke all on function public.audit_contract_package_event()
  from public, anon, authenticated;

-- Classification decisions are audited once per file, never per stage tick.
-- Metadata carries ids and types only - no filenames.
create or replace function public.audit_document_classified_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.suggested_document_type is not null
     and old.suggested_document_type is null then
    perform public.record_audit_event(new.project_id, 'document.classified',
      'document_processing_run', new.id, 'classified', null, null,
      jsonb_build_object(
        'document_version_id', new.document_version_id,
        'suggested_document_type', new.suggested_document_type,
        'classification_status', new.classification_status,
        'classification_confidence', new.classification_confidence
      ), null);
  end if;
  return new;
end; $$;
drop trigger if exists document_processing_runs_audit_event on public.document_processing_runs;
create trigger document_processing_runs_audit_event
  after update on public.document_processing_runs
  for each row execute function public.audit_document_classified_event();
revoke all on function public.audit_document_classified_event()
  from public, anon, authenticated;

create or replace function public.audit_document_type_corrected_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.document_type is distinct from old.document_type then
    perform public.record_audit_event(new.project_id, 'document.classification_corrected',
      'document', new.id, 'classification_corrected', null, null,
      jsonb_build_object(
        'previous_document_type', old.document_type,
        'document_type', new.document_type
      ), null);
  end if;
  return new;
end; $$;
drop trigger if exists documents_type_corrected_audit_event on public.documents;
create trigger documents_type_corrected_audit_event
  after update on public.documents
  for each row execute function public.audit_document_type_corrected_event();
revoke all on function public.audit_document_type_corrected_event()
  from public, anon, authenticated;
-- -- End P0-07.5 contract packages ----------------------------------------------
