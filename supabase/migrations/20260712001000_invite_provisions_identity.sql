-- 邀請成員時主動補齊受邀者的專案身分(additive):
-- ensure_legacy_project_identity 只在專案名稱欄位非空時建 party(空白欄位=缺口,
-- 受邀者要等自己打開「專案文件」頁才被 ensure_project_identity 自癒)。
-- 這裡抽出「帶預設值」的 worker,邀請當下就替受邀者跑一次,消滅時間差。

create or replace function public.ensure_project_identity_for(p uuid, target_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  proj record;
  agency_id uuid; contractor_id uuid; supervisor_id uuid;
  target_org text;
  my_party uuid; my_role text;
begin
  select * into proj from public.projects where id = p;
  if not found then return; end if;

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

  if not exists (select 1 from public.project_memberships
                 where project_id = p and user_id = target_uid) then
    target_org := coalesce((select org_type from public.profiles where id = target_uid), 'contractor');
    if target_org = 'owner' then
      my_party := agency_id; my_role := 'agency_pm';
    elsif target_org = 'supervisor' then
      my_party := supervisor_id; my_role := 'supervisor_engineer';
    else
      my_party := contractor_id; my_role := 'contractor_pm';
    end if;
    insert into public.project_memberships
      (project_id, user_id, project_party_id, project_role, is_project_admin)
    values (p, target_uid, my_party, my_role,
            exists (select 1 from public.project_members m
                    where m.project_id = p and m.user_id = target_uid and m.role = 'admin')
            or exists (select 1 from public.projects pr where pr.id = p and pr.created_by = target_uid));
  end if;
end; $$;
revoke all on function public.ensure_project_identity_for(uuid, uuid) from public, anon, authenticated;

-- 公開 RPC 改為薄包裝(行為不變:成員限定、補自己)
create or replace function public.ensure_project_identity(p uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_project_member(p) then
    raise exception '僅本專案成員可初始化專案身分';
  end if;
  perform public.ensure_project_identity_for(p, auth.uid());
end; $$;
revoke all on function public.ensure_project_identity(uuid) from public, anon;
grant execute on function public.ensure_project_identity(uuid) to authenticated;

-- 邀請時替受邀者補齊(取代 legacy 呼叫;其餘行為原樣)
create or replace function public.add_member_by_email(
  p_project uuid, p_email text, p_role text default 'member'
) returns text language plpgsql security definer set search_path = public as $$
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
  perform public.ensure_project_identity_for(p_project, uid);
  return 'ok';
end; $$;
revoke all on function public.add_member_by_email(uuid, text, text) from public, anon;
grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;
