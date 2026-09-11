-- Roll back 20260911110000 (D-022: project_members as the single authorization
-- source) to the pre-D-022 shape: is_project_admin() regains the created_by
-- branch, member management goes back to creator-only, and the two policies get
-- their original names. Run through SQL Editor / psql as database owner.
-- Data policy: the migration touched no rows, so nothing needs restoring.
-- Caveat: on the production data verified on 2026-09-11 (every creator holds an
-- admin row, no non-creator admin exists) this rollback is behavior-neutral;
-- once a non-creator admin has been granted, rolling back takes away that
-- person's ability to invite/remove members and rename the project.
-- Also revert supabase/tests/invite_org_confirm.sql to its pre-D-022 matrix,
-- otherwise the new assertions (non-creator admin can invite) go red.
begin;

-- 1. is_project_admin: restore the created_by branch (baseline 20260711000000).
create or replace function public.is_project_admin(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p and m.user_id = auth.uid() and m.role = 'admin'
  ) or exists (
    select 1 from public.projects pr where pr.id = p and pr.created_by = auth.uid()
  );
$$;
comment on function public.is_project_admin(uuid) is
  'AUTHORIZATION: project administration through project_members or project creator.';

-- 2. add_member_by_email: creator-only gate (20260812000400 body).
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

-- 3. remove_member: creator-only gate (20260712000400 body).
create or replace function public.remove_member(p_project uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.projects where id = p_project and created_by = auth.uid()) then
    raise exception '只有專案建立者可以管理成員';
  end if;
  if p_user = auth.uid() then raise exception '不能移除自己'; end if;
  delete from public.project_memberships where project_id = p_project and user_id = p_user;
  delete from public.project_members where project_id = p_project and user_id = p_user;
end; $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- 4. project_members policy back to creator-only under its original name.
drop policy if exists "members_manage_by_admin" on public.project_members;
drop policy if exists "members_manage_by_creator" on public.project_members;
create policy "members_manage_by_creator" on public.project_members for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.created_by = auth.uid()));

-- 5. projects update policy back to creator-only under its original name.
drop policy if exists "projects_update_admin" on public.projects;
drop policy if exists "projects_update_creator" on public.projects;
create policy "projects_update_creator" on public.projects
  for update to authenticated using (created_by = auth.uid());

-- 6. delete_project: original message.
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_project_admin(p_id) then raise exception '只有專案建立者/管理者可以刪除專案'; end if;
  delete from public.projects where id = p_id;
end; $$;
grant execute on function public.delete_project(uuid) to authenticated;

commit;
