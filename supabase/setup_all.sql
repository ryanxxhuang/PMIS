-- ============================================================
-- PMIS AI — 一次性建置 SQL（合併 migrations 0001~0004）
-- 在 Supabase 後台 → SQL Editor → New query → 貼上整段 → Run
-- 涵蓋：profiles / projects / members / documents / requirements
--       work_items（標單脊椎）/ valuations（估驗）/ schedule（進度）
-- ============================================================


-- ▼▼▼ migrations/0001_foundation.sql ▼▼▼

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


-- ▼▼▼ migrations/0002_work_items.sql ▼▼▼

-- PMIS AI — 標單工項 work_items（Increment 2）
-- 整個 PMIS 的「脊椎」：從 PCCES 預算書/標單（DetailList）匯入的工項階層。
-- 估驗計價、進度 S 曲線、數量管制、品質檢驗點，全部掛在工項底下。
-- 在 Supabase 後台 → SQL Editor 接著 0001 之後執行。

create table if not exists public.work_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  parent_id    uuid references public.work_items(id) on delete cascade,

  -- ── PCCES 原始欄位 ───────────────────────────────────────────────
  item_key     text,            -- PCCES itemKey（同一份文件內唯一，用於建父子關係）
  item_no      text,            -- 項次，如 壹.一.6.3.28
  ref_item_code text,           -- PCCES 工項代碼（可掛單價分析 / 施工綱要規範章節）
  item_kind    text,            -- mainItem | general | analysis | subtotal | variablePrice | formula
  description  text not null,   -- 工項名稱
  unit         text,            -- 單位（M2、式、t…）
  quantity     numeric,         -- 契約數量
  unit_price   numeric,         -- 單價
  amount       numeric,         -- 複價（數量×單價）

  -- ── 衍生 / 管理欄位 ──────────────────────────────────────────────
  section      text,            -- 所屬頂層分段（壹/貳/參/肆）
  depth        int,             -- 階層深度（頂層=1）
  sort_order   int,             -- 文件原始順序（保留標單排序）
  is_leaf      boolean default false,  -- 末端工項（無子項，才是真正計價單元）
  is_rollup    boolean default false,  -- subtotal/formula 合計列 → 加總時排除避免重複
  is_price_adjustable boolean default false, -- variablePrice 物價調整項
  is_billable  boolean default true,   -- 發包工程費(壹/貳)=true；非發包(參/肆)=false
  weight       numeric,         -- 進度權重 = amount / 發包工程費總額（僅發包末端工項）
  remark       text,

  -- ── 估驗累計（估驗模組會更新；施工日誌之後可回填 qty_completed）─────
  qty_completed numeric default 0,     -- 累計完成數量

  created_at   timestamptz not null default now()
);

create index if not exists work_items_project_idx on public.work_items(project_id);
create index if not exists work_items_parent_idx  on public.work_items(parent_id);

alter table public.work_items enable row level security;

create policy "work_items_members_all"
  on public.work_items for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));


-- ▼▼▼ migrations/0003_valuations.sql ▼▼▼

-- PMIS AI — 估驗計價 valuations（Increment 3）
-- 廠商每月對已完成工項提報估驗 → 計算本期/累計估驗金額、保留款。
-- 掛在 work_items（標單脊椎）之上。完成數量「可手填，也可日後由施工日誌彙總回填」
-- （valuation_items.source 標示來源，為施工日誌模組預留接縫）。
-- 在 Supabase 後台 → SQL Editor 接著 0002 之後執行。

-- ── 估驗期（通常每月一期）─────────────────────────────────────────
create table if not exists public.valuations (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  period_no     int not null,                 -- 第 N 期
  period_start  date,
  period_end    date,
  valuation_date date,
  retention_pct numeric not null default 5,   -- 保留款比例（契約約定，常見 5%）
  status        text not null default '草稿',  -- 草稿|送審|監造審核|已核定|已請款
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (project_id, period_no)
);

-- ── 各工項本期估驗（每期每工項一列）──────────────────────────────
create table if not exists public.valuation_items (
  id            uuid primary key default gen_random_uuid(),
  valuation_id  uuid not null references public.valuations(id) on delete cascade,
  work_item_id  uuid not null references public.work_items(id) on delete cascade,
  cum_qty       numeric default 0,    -- 累計完成數量（至本期）
  cum_pct       numeric,              -- 累計完成百分比（prototype 以此為輸入；與 cum_qty 並存）
  amount_cum    numeric,              -- 累計估驗金額 = unit_price × cum_qty
  amount_period numeric,              -- 本期估驗金額 = 本期 amount_cum − 前期 amount_cum
  source        text not null default 'manual', -- manual | daily_log（Phase 4 回填來源）
  note          text,
  unique (valuation_id, work_item_id)
);

create index if not exists valuations_project_idx on public.valuations(project_id);
create index if not exists valuation_items_val_idx on public.valuation_items(valuation_id);
create index if not exists valuation_items_wi_idx  on public.valuation_items(work_item_id);

alter table public.valuations enable row level security;
alter table public.valuation_items enable row level security;

create policy "valuations_members_all"
  on public.valuations for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- valuation_items 透過所屬 valuation 的專案判斷成員權限
create policy "valuation_items_members_all"
  on public.valuation_items for all to authenticated
  using (exists (
    select 1 from public.valuations v
    where v.id = valuation_id and public.is_project_member(v.project_id)
  ))
  with check (exists (
    select 1 from public.valuations v
    where v.id = valuation_id and public.is_project_member(v.project_id)
  ));


-- ▼▼▼ migrations/0004_schedule.sql ▼▼▼

-- PMIS AI — 預定進度 schedule_periods（Increment 4）
-- 進度 S 曲線的「預定」那條線：專案各月份的計畫累計完成%。
-- 標單只給金額權重、沒給時間分布，故預定進度需另存（廠商提送的施工預定進度表）。
-- 「實際」那條線不另存，由 valuations（累計估驗金額 ÷ 發包工程費）即時推導。
-- 在 Supabase 後台 → SQL Editor 接著 0003 之後執行。

create table if not exists public.schedule_periods (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  period_label  text not null,          -- 月份標籤，如 2026-01
  period_end    date,
  planned_pct   numeric not null default 0,  -- 預定累計完成%（0~100）
  created_at    timestamptz not null default now(),
  unique (project_id, period_label)
);

create index if not exists schedule_periods_project_idx on public.schedule_periods(project_id);

alter table public.schedule_periods enable row level security;

create policy "schedule_periods_members_all"
  on public.schedule_periods for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

