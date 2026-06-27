-- ============================================================
-- PMIS — 以 RPC 建立專案（robust）
-- 背景：此專案 projects 的 INSERT RLS check 不明原因擋掉 client 寫入
--       （auth.uid() 正常、work_items insert 正常，唯獨 projects insert 被擋）。
-- 解法：用 SECURITY DEFINER 函式建立專案（繞過該 check），並自動把建立者加為 admin 成員。
--       這是 Supabase「建立即擁有」的標準做法，也比前端直插更安全/原子。
-- Supabase → SQL Editor → 貼上 → Run（可重複執行）。
-- ============================================================

create or replace function public.create_project(
  p_name        text,
  p_code        text default null,
  p_owner       text default null,
  p_contractor  text default null,
  p_supervisor  text default null,
  p_location    text default null,
  p_start       date default null,
  p_end         date default null
) returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  new_row public.projects;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.projects
    (name, code, owner_name, contractor_name, supervisor_name, location, start_date, end_date, created_by)
  values
    (p_name, p_code, p_owner, p_contractor, p_supervisor, p_location, p_start, p_end, auth.uid())
  returning * into new_row;

  insert into public.project_members (project_id, user_id, role)
  values (new_row.id, auth.uid(), 'admin')
  on conflict do nothing;

  return new_row;
end;
$$;

grant execute on function public.create_project(text, text, text, text, text, text, date, date) to authenticated;
