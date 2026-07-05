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
create policy "work_items_members_all" on public.work_items for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));
drop policy if exists "valuation_items_members_all" on public.valuation_items;
create policy "valuation_items_members_all" on public.valuation_items for all to authenticated
  using (valuation_id in (select id from public.valuations))
  with check (valuation_id in (select id from public.valuations));

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
create policy "schedule_periods_members_all" on public.schedule_periods for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
create policy "daily_logs_members_all" on public.daily_logs for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));
drop policy if exists "daily_log_items_members_all" on public.daily_log_items;
create policy "daily_log_items_members_all" on public.daily_log_items for all to authenticated
  using (daily_log_id in (select id from public.daily_logs))
  with check (daily_log_id in (select id from public.daily_logs));

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
create policy "photos_members_all" on public.photos for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
  with check (bucket_id = 'photos' and public.is_project_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "photos_objects_delete" on storage.objects;
create policy "photos_objects_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_project_member(((storage.foldername(name))[1])::uuid));

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
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));
drop policy if exists "defects_members_all" on public.defects;
create policy "defects_members_all" on public.defects for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
create policy "contract_obligations_members_all" on public.contract_obligations for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
drop policy if exists "cost_items_members_all" on public.cost_items;
create policy "cost_items_members_all" on public.cost_items for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
create policy "change_orders_members_all" on public.change_orders for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));
drop policy if exists "change_order_items_members_all" on public.change_order_items;
create policy "change_order_items_members_all" on public.change_order_items for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
create policy "item_schedules_members_all" on public.item_schedules for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
create policy "safety_records_members_all" on public.safety_records for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
create policy "checklist_templates_members_all" on public.checklist_templates for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));
drop policy if exists "checklist_records_members_all" on public.checklist_records;
create policy "checklist_records_members_all" on public.checklist_records for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));
drop policy if exists "test_samples_members_all" on public.test_samples;
create policy "test_samples_members_all" on public.test_samples for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

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
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
create index if not exists submittals_project_idx on public.submittals(project_id);
create index if not exists submittals_wi_idx      on public.submittals(work_item_id);
create index if not exists rfis_project_idx       on public.rfis(project_id);
alter table public.submittals enable row level security;
alter table public.rfis       enable row level security;
drop policy if exists "submittals_members_all" on public.submittals;
create policy "submittals_members_all" on public.submittals for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));
drop policy if exists "rfis_members_all" on public.rfis;
create policy "rfis_members_all" on public.rfis for all to authenticated
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

-- ── RPCs (SECURITY DEFINER) ─────────────────────────────────────────────────
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

-- Delete a project (and everything it cascades to). Members only.
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_project_member(p_id) then raise exception 'not a project member'; end if;
  delete from public.projects where id = p_id;
end; $$;
grant execute on function public.delete_project(uuid) to authenticated;

-- ── RLS 熱路徑與外鍵索引(缺這些會逐列全表掃描) ──────────────────────────────
create index if not exists project_members_user_idx      on public.project_members(user_id);
create index if not exists change_order_items_project_idx on public.change_order_items(project_id);
create index if not exists change_order_items_wi_idx     on public.change_order_items(work_item_id);
create index if not exists defects_inspection_idx        on public.defects(inspection_id);
create index if not exists defects_wi_idx                on public.defects(work_item_id);
create index if not exists inspections_wi_idx            on public.inspections(work_item_id);
create index if not exists photos_wi_idx                 on public.photos(work_item_id);
