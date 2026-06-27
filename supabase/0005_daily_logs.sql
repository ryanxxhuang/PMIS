-- ============================================================
-- PMIS AI — 施工日誌 daily_logs（Increment 5，Phase 4）
-- 每日記錄各工項「當日完成數量」→ 累進到估驗的「累計完成數量」（閉環）。
-- daily_log_items.qty_today 各日加總 = 估驗 cum_qty 的來源。
-- Supabase → SQL Editor → 貼上整段 → Run（可重複執行）。
-- ============================================================

create table if not exists public.daily_logs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  log_date     date not null,
  weather      text,
  work_summary text,
  status       text not null default '草稿',   -- 草稿 | 已送出
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (project_id, log_date)                -- 一天一筆施工日誌
);

create table if not exists public.daily_log_items (
  id            uuid primary key default gen_random_uuid(),
  daily_log_id  uuid not null references public.daily_logs(id) on delete cascade,
  work_item_id  uuid not null references public.work_items(id) on delete cascade,
  qty_today     numeric not null default 0,    -- 當日完成數量
  note          text,
  unique (daily_log_id, work_item_id)
);

create index if not exists daily_logs_project_idx on public.daily_logs(project_id);
create index if not exists daily_log_items_log_idx on public.daily_log_items(daily_log_id);
create index if not exists daily_log_items_wi_idx  on public.daily_log_items(work_item_id);

alter table public.daily_logs      enable row level security;
alter table public.daily_log_items enable row level security;

drop policy if exists "daily_logs_members_all" on public.daily_logs;
create policy "daily_logs_members_all"
  on public.daily_logs for all to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

drop policy if exists "daily_log_items_members_all" on public.daily_log_items;
create policy "daily_log_items_members_all"
  on public.daily_log_items for all to authenticated
  using (exists (select 1 from public.daily_logs d where d.id = daily_log_id and public.is_project_member(d.project_id)))
  with check (exists (select 1 from public.daily_logs d where d.id = daily_log_id and public.is_project_member(d.project_id)));
