-- 自動補齊專案身分(additive):任何 baseline 成員(project_members)開「專案文件」頁時,
-- 若專案缺 parties 或本人缺 P0-02 membership,前端呼叫此 RPC 一鍵補齊——
-- 消滅「此專案尚未設定契約相對人,請先於專案成員維護」死路(該頁根本管不了 parties)。
-- 冪等:已存在的一律跳過。授權:僅限本專案 baseline 成員。
-- 背景:parties/memberships 的 select policy 走 my_project_ids_v2(讀 memberships),
-- 但邀請流程(add_member_by_email)只寫 project_members → 受邀者看得到專案、讀不到 parties。

create or replace function public.ensure_project_identity(p uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  proj record;
  agency_id uuid; contractor_id uuid; supervisor_id uuid;
  my_org text;
  my_party uuid; my_role text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_project_member(p) then
    raise exception '僅本專案成員可初始化專案身分';
  end if;
  select * into proj from public.projects where id = p;
  if not found then raise exception 'project not found'; end if;

  -- 三方 parties:缺哪個補哪個(名稱取專案欄位,空值給通用預設)
  select id into agency_id from public.project_parties
    where project_id = p and party_type = 'agency' limit 1;
  if agency_id is null then
    insert into public.project_parties (project_id, party_type, display_name, migration_key)
    values (p, 'agency', coalesce(nullif(btrim(proj.owner_name), ''), '機關'), 'ensure:' || p || ':agency')
    returning id into agency_id;
  end if;
  select id into contractor_id from public.project_parties
    where project_id = p and party_type = 'contractor' limit 1;
  if contractor_id is null then
    insert into public.project_parties (project_id, party_type, display_name, migration_key)
    values (p, 'contractor', coalesce(nullif(btrim(proj.contractor_name), ''), '施工廠商'), 'ensure:' || p || ':contractor')
    returning id into contractor_id;
  end if;
  select id into supervisor_id from public.project_parties
    where project_id = p and party_type = 'supervisor' limit 1;
  if supervisor_id is null then
    insert into public.project_parties (project_id, party_type, display_name, migration_key)
    values (p, 'supervisor', coalesce(nullif(btrim(proj.supervisor_name), ''), '監造單位'), 'ensure:' || p || ':supervisor')
    returning id into supervisor_id;
  end if;

  -- 本人 membership:依全域 org_type 掛到對應 party(批3已取消,org 模型定案)
  if not exists (select 1 from public.project_memberships
                 where project_id = p and user_id = auth.uid()) then
    my_org := public.my_org_type();
    if my_org = 'owner' then
      my_party := agency_id; my_role := 'agency_pm';
    elsif my_org = 'supervisor' then
      my_party := supervisor_id; my_role := 'supervisor_engineer';
    else
      my_party := contractor_id; my_role := 'contractor_pm';
    end if;
    insert into public.project_memberships
      (project_id, user_id, project_party_id, project_role, is_project_admin)
    values (p, auth.uid(), my_party, my_role, public.is_project_admin(p));
  end if;
end; $$;
revoke all on function public.ensure_project_identity(uuid) from public, anon;
grant execute on function public.ensure_project_identity(uuid) to authenticated;
