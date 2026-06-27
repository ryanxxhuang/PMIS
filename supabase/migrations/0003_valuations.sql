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
