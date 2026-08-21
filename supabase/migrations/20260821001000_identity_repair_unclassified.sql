-- W12 修復:掛在「other(未分類/待確認)」party 上的既有 membership 是死路。
-- ---------------------------------------------------------------------------
-- 症狀:availablePackageOptions 只認 agency/supervisor/contractor,party_type=
-- 'other' 的成員永遠算不出可上傳的契約包,專案文件頁顯示「專案身分初始化中,
-- 請稍候幾秒再試一次」且重試無效(實例:平台管理員帳號在三方模型定案前建的
-- 舊快照)。ensure_project_identity_for 只在「沒有 membership」時建身分,
-- 對「已存在但未分類」的快照是 no-op——自癒程式修不了它。
--
-- 修法(冪等):
-- 1. ensure_project_identity_for 補一個修復分支:membership 已存在但掛在
--    other party 上 → 依全域 org_type(profiles,D-009 邀請確認過的權威值)
--    重掛到對應 party。只重掛 project_party_id,不動 project_role 與 admin 旗標。
-- 2. 一次性資料修復:把現存所有「掛在 other、且該專案已有對應 party」的
--    membership 重掛(對應 party 不存在者留給下次開頁的 RPC 自癒,它會先補 party)。
-- 分類為 other 的 party 列本身保留(可能有歷史文件掛著),只是不再被 membership 指著。

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

  target_org := coalesce((select org_type from public.profiles where id = target_uid), 'contractor');
  if target_org = 'owner' then
    my_party := agency_id; my_role := 'agency_pm';
  elsif target_org = 'supervisor' then
    my_party := supervisor_id; my_role := 'supervisor_engineer';
  else
    my_party := contractor_id; my_role := 'contractor_pm';
  end if;

  if not exists (select 1 from public.project_memberships
                 where project_id = p and user_id = target_uid) then
    insert into public.project_memberships
      (project_id, user_id, project_party_id, project_role, is_project_admin)
    values (p, target_uid, my_party, my_role,
            exists (select 1 from public.project_members m
                    where m.project_id = p and m.user_id = target_uid and m.role = 'admin')
            or exists (select 1 from public.projects pr where pr.id = p and pr.created_by = target_uid));
  else
    -- 修復分支:既有快照掛在未分類 party 上 → 依 org_type 重掛(其餘欄位不動)
    update public.project_memberships ms
    set project_party_id = my_party
    where ms.project_id = p and ms.user_id = target_uid
      and exists (select 1 from public.project_parties x
                  where x.id = ms.project_party_id and x.party_type = 'other');
  end if;
end; $$;
revoke all on function public.ensure_project_identity_for(uuid, uuid) from public, anon, authenticated;

-- 一次性資料修復:現存掛在 other 上、且對應 party 已存在的 membership
update public.project_memberships ms
set project_party_id = pp.id
from public.project_parties po, public.profiles pr, public.project_parties pp
where po.id = ms.project_party_id and po.party_type = 'other'
  and pr.id = ms.user_id
  and pp.project_id = ms.project_id
  and pp.party_type = case coalesce(pr.org_type, 'contractor')
    when 'owner' then 'agency'
    when 'supervisor' then 'supervisor'
    else 'contractor' end;
