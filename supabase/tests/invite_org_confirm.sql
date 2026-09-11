-- 邀請時確認三方身分(pgTAP)——W4-3/D-009,加 D-022 成員管理授權矩陣。
-- 對應 migration 20260812000400_invite_org_confirm.sql、20260911110000_project_admin_single_source.sql。
-- 核心主張:
--   ① 邀請方宣告的受邀方身分與被邀帳號註冊身分不符時,伺服器拒絕入案;未帶宣告(null)
--      維持舊行為相容;舊 3 參數 overload 必須移除(PostgREST 300)。
--   ② D-022:專案授權只有 project_members 一個來源——is_project_admin() 只看
--      role='admin';成員管理(RPC 與 RLS)由 is_project_admin() 守門。建立者「是不是
--      建立者」對授權沒有意義,有沒有 admin 列才有意義。
-- 執行:本地 supabase(colima)+容器內 psql;整份交易內執行並 rollback。
begin;

select plan(41);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_function('public', 'add_member_by_email', array['uuid','text','text','text'], '4 參數版存在');
select hasnt_function('public', 'add_member_by_email', array['uuid','text','text'], '舊 3 參數 overload 已移除(避免 PostgREST ambiguous)');
-- D-022:policy 名稱跟著語意走,舊的 *_creator 名字不得殘留
select policies_are('public', 'project_members',
  array['members_select_own', 'members_manage_by_admin'],
  'project_members 只有 select_own 與 manage_by_admin 兩條 policy(by_creator 已退場)');
select policies_are('public', 'projects',
  array['projects_select_members', 'projects_insert_self', 'projects_update_admin'],
  'projects 的 update policy 改名 projects_update_admin(update_creator 已退場)');

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
-- 001 建立者(P1 有 admin 列;P2 刻意沒有任何成員列)
-- 002 監造,經正常邀請成為 member      003 廠商,經相容路徑成為 member
-- 004 非建立者的 admin(D-022 A 的主角)  005 被 004 邀請/移除的對象
-- 006 局外人(非成員)                    007 被 004 直接寫表加入的對象
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('cc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-creator@example.test', '', now(), '{}',
   '{"full_name":"Creator","org_type":"contractor"}', now(), now()),
  ('cc000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-sup@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('cc000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-con@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('cc000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-admin2@example.test', '', now(), '{}',
   '{"full_name":"Admin (not creator)","org_type":"supervisor"}', now(), now()),
  ('cc000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-target@example.test', '', now(), '{}',
   '{"full_name":"Target","org_type":"contractor"}', now(), now()),
  ('cc000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider","org_type":"contractor"}', now(), now()),
  ('cc000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'inv-direct@example.test', '', now(), '{}',
   '{"full_name":"Direct insert target","org_type":"contractor"}', now(), now());

-- 停用 on_project_created 是刻意的:D-022 之後它是建立者取得 admin 權的唯一路徑,
-- 停用後 P1 手動補 admin 列、P2 什麼都不補,就造出「建立者但無 admin 列」的情境。
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('cc100000-0000-0000-0000-000000000001', '邀請確認測試案', '機關', '廠商', '監造',
   'cc000000-0000-0000-0000-000000000001'),
  ('cc100000-0000-0000-0000-000000000002', '建立者無 admin 列的案', '機關', '廠商', '監造',
   'cc000000-0000-0000-0000-000000000001');
alter table public.projects enable trigger on_project_created;
insert into public.project_members (project_id, user_id, role) values
  ('cc100000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'admin'),
  ('cc100000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000004', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $fn$;

-- ── is_project_admin():只認 admin 列,不認建立者身分(D-022 C 的核心) ─────────
select pg_temp.become('cc000000-0000-0000-0000-000000000001');
select ok(public.is_project_admin('cc100000-0000-0000-0000-000000000001'),
  '建立者且有 admin 列 → is_project_admin = true');
select ok(not public.is_project_admin('cc100000-0000-0000-0000-000000000002'),
  'C 核心:同一人是 P2 建立者但沒有 admin 列 → is_project_admin = false(created_by 不再是授權來源)');
select pg_temp.become('cc000000-0000-0000-0000-000000000004');
select ok(public.is_project_admin('cc100000-0000-0000-0000-000000000001'),
  '被授 admin 但非建立者 → is_project_admin = true');
select pg_temp.become('cc000000-0000-0000-0000-000000000006');
select ok(not public.is_project_admin('cc100000-0000-0000-0000-000000000001'),
  '非成員 → is_project_admin = false');

-- ── 宣告身分相符 → 入案(建立者,有 admin 列) ─────────────────────────────────
select pg_temp.become('cc000000-0000-0000-0000-000000000001');
select is(
  public.add_member_by_email('cc100000-0000-0000-0000-000000000001', 'inv-sup@example.test', 'member', 'supervisor'),
  'ok', '宣告監造+對方註冊監造 → 入案');
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000002'), 1, '監造成員已加入');

-- ── 宣告身分不符 → 拒絕且不入案(驗收核心) ───────────────────────────────────
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000001',
    'inv-con@example.test', 'member', 'supervisor') $$,
  'P0001',
  '身分不符:該帳號的註冊身分是「施工廠商」,不是你要邀請的「監造單位」。請對方確認註冊身分無誤,或依其實際身分重新邀請。',
  '想邀監造但對方註冊成廠商 → 明確錯誤');
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000003'), 0, '錯配未入案');

-- ── 相容與參數驗證 ───────────────────────────────────────────────────────────
select is(
  public.add_member_by_email('cc100000-0000-0000-0000-000000000001', 'inv-con@example.test'),
  'ok', '未帶宣告身分(null)維持舊行為(相容既有呼叫端;前端一律帶值)');
select is(
  public.add_member_by_email('cc100000-0000-0000-0000-000000000001', 'no-such@example.test', 'member', 'supervisor'),
  'not_found', '查無帳號回 not_found(不因宣告身分改變)');
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000001',
    'inv-sup@example.test', 'member', 'boss') $$,
  'P0001', '無效的受邀方身分:boss', '宣告值域外身分被拒');

-- ── 成員管理矩陣:建立者(有 admin 列)仍可移除 ────────────────────────────────
select lives_ok($$ select public.remove_member('cc100000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000003') $$, '建立者(有 admin 列)仍可移除成員');
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000003'), 0, '被移除者已不在名單');

-- ── 成員管理矩陣:建立者但無 admin 列 → 不可(C) ─────────────────────────────
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000002',
    'inv-con@example.test', 'member', 'contractor') $$,
  'P0001', '只有專案管理者可以管理成員', 'C:P2 建立者沒有 admin 列 → 不可邀請');
select throws_ok($$ select public.remove_member('cc100000-0000-0000-0000-000000000002',
    'cc000000-0000-0000-0000-000000000002') $$,
  'P0001', '只有專案管理者可以管理成員', 'C:P2 建立者沒有 admin 列 → 不可移除');

-- ── 成員管理矩陣:被授 admin 但非建立者 → 可邀人、可移除(A 的重點,之前不行) ──
select pg_temp.become('cc000000-0000-0000-0000-000000000004');
select is(
  public.add_member_by_email('cc100000-0000-0000-0000-000000000001', 'inv-target@example.test', 'member', 'contractor'),
  'ok', 'A:非建立者 admin 可邀請');
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000005'), 1, 'A:被邀者已入案');
select lives_ok($$ select public.remove_member('cc100000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000005') $$, 'A:非建立者 admin 可移除成員');
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000005'), 0, 'A:被移除者已不在名單');
select throws_ok($$ select public.remove_member('cc100000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000004') $$,
  'P0001', '不能移除自己', 'admin 仍不能移除自己(既有規則不變)');

-- ── 成員管理矩陣:一般 member → 不可 ──────────────────────────────────────────
select pg_temp.become('cc000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000001',
    'inv-con@example.test', 'member', 'contractor') $$,
  'P0001', '只有專案管理者可以管理成員', '一般 member 不可邀請');
select throws_ok($$ select public.remove_member('cc100000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000004') $$,
  'P0001', '只有專案管理者可以管理成員', '一般 member 不可移除');

-- ── 成員管理矩陣:非成員 → 不可;未登入 → 不可 ───────────────────────────────
select pg_temp.become('cc000000-0000-0000-0000-000000000006');
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000001',
    'inv-con@example.test', 'member', 'contractor') $$,
  'P0001', '只有專案管理者可以管理成員', '非成員不可邀請');
select throws_ok($$ select public.remove_member('cc100000-0000-0000-0000-000000000001',
    'cc000000-0000-0000-0000-000000000004') $$,
  'P0001', '只有專案管理者可以管理成員', '非成員不可移除');
select pg_temp.become(null);
select throws_ok($$ select public.add_member_by_email('cc100000-0000-0000-0000-000000000001',
    'inv-con@example.test', 'member', 'contractor') $$,
  'P0001', 'not authenticated', '未登入不可邀請');

-- ── RLS members_manage_by_admin:直接寫表(PostgREST 路徑)也由 admin 列守門 ───
-- INSERT 違反 with check 會丟 42501;DELETE 被 using 濾掉是靜默 0 列,要用 count 驗。
select pg_temp.become('cc000000-0000-0000-0000-000000000004');
set local role authenticated;
select lives_ok($$ insert into public.project_members (project_id, user_id, role)
  values ('cc100000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000007', 'member') $$,
  'RLS:非建立者 admin 可直接寫入成員列');
reset role;
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000007'), 1, 'RLS:成員列已寫入');

select pg_temp.become('cc000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ insert into public.project_members (project_id, user_id, role)
  values ('cc100000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000002', 'admin') $$,
  '42501', null, 'RLS:一般 member 不能把自己寫成別案 admin');
delete from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000007';
reset role;
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000007'), 1, 'RLS:一般 member 的 delete 被濾成 0 列');

select pg_temp.become('cc000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ insert into public.project_members (project_id, user_id, role)
  values ('cc100000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000001', 'admin') $$,
  '42501', null, 'RLS C:P2 建立者沒有 admin 列,不能靠直接寫表把自己補回 admin');
reset role;

select pg_temp.become('cc000000-0000-0000-0000-000000000004');
set local role authenticated;
delete from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000007';
reset role;
select is((select count(*)::int from public.project_members
  where project_id = 'cc100000-0000-0000-0000-000000000001'
    and user_id = 'cc000000-0000-0000-0000-000000000007'), 0, 'RLS:非建立者 admin 可直接刪除成員列');

-- ── RLS projects_update_admin:admin 可改、member 不可、建立者無 admin 列不可 ──
-- UPDATE 被 using 濾掉是靜默 0 列,一律用讀回的值驗。
select pg_temp.become('cc000000-0000-0000-0000-000000000004');
set local role authenticated;
update public.projects set name = '由非建立者 admin 更名'
  where id = 'cc100000-0000-0000-0000-000000000001';
reset role;
select is((select name from public.projects where id = 'cc100000-0000-0000-0000-000000000001'),
  '由非建立者 admin 更名', 'projects_update_admin:非建立者 admin 可更新專案');

select pg_temp.become('cc000000-0000-0000-0000-000000000002');
set local role authenticated;
update public.projects set name = '由 member 更名'
  where id = 'cc100000-0000-0000-0000-000000000001';
reset role;
select is((select name from public.projects where id = 'cc100000-0000-0000-0000-000000000001'),
  '由非建立者 admin 更名', 'projects_update_admin:一般 member 的 update 被濾成 0 列');

select pg_temp.become('cc000000-0000-0000-0000-000000000001');
set local role authenticated;
update public.projects set name = '由無 admin 列的建立者更名'
  where id = 'cc100000-0000-0000-0000-000000000002';
reset role;
select is((select name from public.projects where id = 'cc100000-0000-0000-0000-000000000002'),
  '建立者無 admin 列的案', 'projects_update_admin C:建立者沒有 admin 列 → update 被濾成 0 列');

-- ── delete_project:錯誤訊息不再提「建立者」;無 admin 列的建立者不可刪 ──────
select throws_ok($$ select public.delete_project('cc100000-0000-0000-0000-000000000002') $$,
  'P0001', '只有專案管理者可以刪除專案', 'delete_project C:建立者沒有 admin 列 → 不可刪除');
select pg_temp.become('cc000000-0000-0000-0000-000000000004');
select lives_ok($$ select public.delete_project('cc100000-0000-0000-0000-000000000001') $$,
  'delete_project:非建立者 admin 可整案刪除(既有行為,現與成員管理對稱)');
select is((select count(*)::int from public.projects where id = 'cc100000-0000-0000-0000-000000000001'),
  0, '專案確實刪除');

select * from finish();
rollback;
