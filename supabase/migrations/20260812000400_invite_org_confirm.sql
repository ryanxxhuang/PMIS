-- W4-3(D-009):邀請時確認三方身分。
-- 公開註冊自選的 org_type 不能靜默成為正式專案身分:邀請方必須宣告要邀的是
-- 哪一方(廠商/監造/機關),與被邀帳號的註冊身分不符就拒絕,錯誤訊息說明
-- 對方實際身分與處理方式——錯配無法靜默入案。
--
-- 作法:add_member_by_email 加第 4 參數 p_expected_org(null=不檢查,相容
-- 既有呼叫端;前端一律傳值)。必須先 drop 舊 3 參數版——否則 create 出新
-- overload 後,PostgREST 對帶預設值的同名函式會回 300 ambiguous。
-- 資料保留/回復:不動任何資料;回復=重建 20260712001000 的 3 參數版。

drop function if exists public.add_member_by_email(uuid, text, text);

create or replace function public.add_member_by_email(
  p_project uuid, p_email text, p_role text default 'member', p_expected_org text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  actual_org text;
  org_label constant jsonb := '{"contractor":"施工廠商","supervisor":"監造單位","owner":"主辦機關"}'::jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.projects where id = p_project and created_by = auth.uid()) then
    raise exception '只有專案建立者可以管理成員';
  end if;
  if p_expected_org is not null
     and p_expected_org not in ('contractor', 'supervisor', 'owner') then
    raise exception '無效的受邀方身分:%', p_expected_org;
  end if;

  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then return 'not_found'; end if;

  if p_expected_org is not null then
    select org_type into actual_org from public.profiles where id = uid;
    if actual_org is distinct from p_expected_org then
      raise exception '身分不符:該帳號的註冊身分是「%」,不是你要邀請的「%」。請對方確認註冊身分無誤,或依其實際身分重新邀請。',
        coalesce(org_label ->> actual_org, coalesce(actual_org, '未設定')),
        org_label ->> p_expected_org;
    end if;
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project, uid, p_role) on conflict do nothing;
  perform public.ensure_project_identity_for(p_project, uid);
  return 'ok';
end; $$;
revoke all on function public.add_member_by_email(uuid, text, text, text) from public, anon;
grant execute on function public.add_member_by_email(uuid, text, text, text) to authenticated;
