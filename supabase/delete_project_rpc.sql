-- ============================================================
-- PMIS — 刪除專案 RPC（SECURITY DEFINER）
-- projects 沒有 delete policy（刪除是破壞性操作），故用 definer 函式：
-- 只有專案成員能刪，刪 projects 會 cascade 掉 work_items / valuations /
-- schedule / daily_logs / inspections / defects / members / documents / requirements。
-- Supabase → SQL Editor → Run（可重複執行）。
-- ============================================================

create or replace function public.delete_project(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_project_member(p_id) then
    raise exception 'not a project member';
  end if;
  delete from public.projects where id = p_id;
end;
$$;

grant execute on function public.delete_project(uuid) to authenticated;
