-- ============================================================
-- PMIS AI — 品質查驗 inspections + 缺失 defects（Increment 6，Phase 5）
-- 三級品管的查驗/缺失流：查驗申請 → 監造查驗(合格/不合格) → 不合格開缺失
--   → 廠商改善 → 監造複查結案。掛回 work_items。
-- Supabase → SQL Editor → 貼上整段 → Run（可重複執行）。
-- ============================================================

-- ── 查驗（查驗申請 + 監造查驗結果）─────────────────────────────────
create table if not exists public.inspections (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  work_item_id    uuid references public.work_items(id) on delete set null,
  title           text not null,
  location        text,
  inspection_type text,                         -- 施工查驗 / 材料查驗 / 隱蔽查驗…
  requested_date  date,
  requested_by    uuid references auth.users(id),
  status          text not null default '待查驗',  -- 待查驗 | 合格 | 不合格
  result_note     text,
  inspected_by    uuid references auth.users(id),
  inspected_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ── 缺失（查驗不合格或巡查開立）────────────────────────────────────
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
