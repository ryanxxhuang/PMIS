-- ============================================================
-- PMIS — 修權限 + 直接建立專案（以 postgres 身分執行，繞過 RLS，保證成功）
-- 使用者 uid：26e090fd-3f94-4990-bc75-51b7908f2fd2（demo@pmis.dev）
-- Supabase → SQL Editor → 貼上整段 → Run。可重複執行。
-- ============================================================

-- 1) 重建必要 policy（idempotent）─────────────────────────────────
create or replace function public.is_project_member(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.project_members m
    where m.project_id = p and m.user_id = auth.uid());
$$;

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

drop policy if exists "work_items_members_all" on public.work_items;
create policy "work_items_members_all" on public.work_items for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

drop policy if exists "valuations_members_all" on public.valuations;
create policy "valuations_members_all" on public.valuations for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

drop policy if exists "valuation_items_members_all" on public.valuation_items;
create policy "valuation_items_members_all" on public.valuation_items for all to authenticated
  using (exists (select 1 from public.valuations v where v.id = valuation_id and public.is_project_member(v.project_id)))
  with check (exists (select 1 from public.valuations v where v.id = valuation_id and public.is_project_member(v.project_id)));

drop policy if exists "schedule_periods_members_all" on public.schedule_periods;
create policy "schedule_periods_members_all" on public.schedule_periods for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

-- 2) 直接建立專案（postgres 身分繞過 RLS，一定成功）──────────────
insert into public.projects
  (name, code, owner_name, contractor_name, supervisor_name, location, start_date, end_date, created_by)
values
  ('國際原住民族文化創意產業園區新建工程','20200710','桃園市政府','大華營造','',
   '桃園市','2026-01-15','2027-06-30','26e090fd-3f94-4990-bc75-51b7908f2fd2')
on conflict do nothing;

-- 3) 確保你是該專案成員（trigger 通常自動加，這裡保險補上）────────
insert into public.project_members (project_id, user_id, role)
select id, '26e090fd-3f94-4990-bc75-51b7908f2fd2', 'admin'
from public.projects where created_by = '26e090fd-3f94-4990-bc75-51b7908f2fd2'
on conflict do nothing;

-- 讓 PostgREST 立即重載（保險）
notify pgrst, 'reload schema';

-- 4) 證明：回傳你的專案與成員數 ──────────────────────────────────
select p.name, p.id,
  (select count(*) from public.project_members m where m.project_id = p.id) as members
from public.projects p
where p.created_by = '26e090fd-3f94-4990-bc75-51b7908f2fd2';
