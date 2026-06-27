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
