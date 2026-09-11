-- D-022:專案授權只剩 project_members 一個來源。
-- projects.created_by 退出 is_project_admin();成員管理改吃 is_project_admin()。
--
-- 為什麼:2026-09-11 重構審計實查(pg_get_functiondef)發現授權有兩個來源且不對稱——
--   is_project_admin(p) = project_members.role='admin' OR projects.created_by = auth.uid()
--   add_member_by_email / remove_member / members_manage_by_creator / projects_update_creator
--     卻只認 projects.created_by。
-- 結果:被授 role='admin' 的成員能 delete_project、能透過 admin_override 覆寫估驗與
-- 變更設計的狀態機,卻不能邀一個人進來;而 created_by 沒有轉移路徑,建立者離職後
-- 成員管理永久卡死。created_by 因此成了 project_members 之外的隱性授權來源,違反
-- docs/architecture/three-party-role-model.md「project_members 管授權」的唯一規則。
--
-- 使用者拍板(D-022,C＋A):
--   C:is_project_admin() 只看 project_members.role='admin',不再看 created_by。
--   A:成員管理(RPC 與 RLS)改用 is_project_admin(),admin 成員也能邀人／移除人。
--
-- 建立者自此完全依賴 on_project_created trigger 取得權限:
--   add_creator_as_member 在 projects AFTER INSERT 把 new.created_by 寫成 admin 列
--   (on conflict do nothing);create_project RPC 另外也顯式插同一列。這是建立者
--   取得 admin 權的唯一路徑——誰停用該 trigger 又不補列,建立者就失去管理權
--   (supabase/tests/invite_org_confirm.sql 正是用這個手法造「建立者但無 admin 列」
--   的情境來釘 C)。
--
-- 為什麼今天是零行為改變(正式庫 2026-09-11 唯讀查證,supabase db query --linked):
--   13 個專案;建立者缺 admin 列 0;created_by 為 null 0;role='admin' 共 13 列;
--   admin 但非建立者 0 人。舊 is_project_admin 的兩個分支在正式資料上完全等價——
--   沒有人失去權限(每個建立者都已有 admin 列),也沒有人多拿到權限(不存在非
--   建立者的 admin)。等真的授出第一個非建立者 admin 之後再改就是實質擴權,所以現在改。
--
-- 明確不動(不是專案角色授權,別順手改):
--   * organizations_select/insert/update/delete 的 created_by = auth.uid():組織不是
--     專案,那是「你擁有自己建立的紀錄」,與專案角色授權是兩個概念。
--   * projects_insert_self 的 with check (auth.uid() = created_by):插入時的完整性
--     約束(只能把自己填成建立者),不是角色授權;on_project_created 也靠它保證
--     new.created_by 就是呼叫者本人。
--   * projects.created_by 欄位保留:稽核用途,且 on_project_created 需要它。
--
-- 資料保留:不動任何資料列。
-- 相容:前端 Members.jsx 的 isAdmin 本來就看 member_role === 'admin',與新語意一致;
--   三則錯誤訊息「建立者」改「管理者」,src/ 與 e2e 沒有比對這些字串。
-- 回復:supabase/rollbacks/20260911110000_project_admin_single_source.down.sql
--   (重建 created_by 分支與舊 policy 名;正式資料兩分支等價,回復同樣零行為改變)。

-- ── 1. is_project_admin:拿掉 created_by 分支 ─────────────────────────────────
create or replace function public.is_project_admin(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;
comment on function public.is_project_admin(uuid) is
  'AUTHORIZATION: project administration through project_members.role = admin only (D-022). projects.created_by is audit metadata, never an authorization source.';

-- ── 2. add_member_by_email:建立者判斷改 is_project_admin ────────────────────
-- 本體照 20260812000400(W4-3 身分確認)原樣,只換第一個守門與錯誤訊息。
create or replace function public.add_member_by_email(
  p_project uuid, p_email text, p_role text default 'member', p_expected_org text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  actual_org text;
  org_label constant jsonb := '{"contractor":"施工廠商","supervisor":"監造單位","owner":"主辦機關"}'::jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_project_admin(p_project) then
    raise exception '只有專案管理者可以管理成員';
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

-- ── 3. remove_member:同上 ─────────────────────────────────────────────────────
-- 本體照 20260712000400(P0-02,連身分快照一起清)原樣,只換守門與錯誤訊息。
create or replace function public.remove_member(p_project uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_project_admin(p_project) then
    raise exception '只有專案管理者可以管理成員';
  end if;
  if p_user = auth.uid() then raise exception '不能移除自己'; end if;
  delete from public.project_memberships where project_id = p_project and user_id = p_user;
  delete from public.project_members where project_id = p_project and user_id = p_user;
end; $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- ── 4. project_members 管理 policy:by_creator → by_admin ─────────────────────
-- 名稱跟著語意改(drop + create);is_project_admin 是 security definer,讀
-- project_members 不會再過本表 RLS,所以放進本表 policy 不會遞迴。
drop policy if exists "members_manage_by_creator" on public.project_members;
drop policy if exists "members_manage_by_admin" on public.project_members;
create policy "members_manage_by_admin" on public.project_members for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

-- ── 5. projects 更新 policy:creator → admin ──────────────────────────────────
-- 留著它吃 created_by,C 就沒有真的做到「授權只有一個來源」。
drop policy if exists "projects_update_creator" on public.projects;
drop policy if exists "projects_update_admin" on public.projects;
create policy "projects_update_admin" on public.projects
  for update to authenticated using (public.is_project_admin(id));

-- ── 6. delete_project:錯誤訊息不再提「建立者」 ───────────────────────────────
create or replace function public.delete_project(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_project_admin(p_id) then raise exception '只有專案管理者可以刪除專案'; end if;
  delete from public.projects where id = p_id;
end; $$;
grant execute on function public.delete_project(uuid) to authenticated;
