-- profiles.org_type 自我提權防護 pgTAP 套件。
-- 涵蓋:三條原本可繞過的攻擊路徑(未入案先提權 / created_by 為 NULL / 退出再加回)、
-- 正當管道仍暢通(註冊帶入、service role、平台管理員)、非特權欄位不受影響、
-- 以及提權被擋後 RBAC helper(my_org_type / can_write)維持原判。
-- 執行:本地 supabase(colima)+容器內 psql,整份交易內執行並 rollback。
-- 對應 migration 20260728000200_profiles_org_type_guard.sql。
begin;

select plan(26);

-- login helper(同 p0_05 慣例:兩種 claim 寫法都設,涵蓋不同 auth.uid() 實作)
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

select pg_temp.become(null);

-- ── 結構與權限契約 ──────────────────────────────────────────────────────────
select has_trigger('public', 'profiles', 'profiles_guard',
  'org_type guard trigger 掛在 profiles 上');
select has_function('public', 'profiles_guard', 'guard 函式存在');
select is((select prosecdef from pg_proc where oid = 'public.profiles_guard()'::regprocedure),
  true, 'guard 為 security definer(policy/呼叫者權限不影響判定)');
select is(has_function_privilege('authenticated', 'public.profiles_guard()', 'EXECUTE'),
  false, 'authenticated 不可直接呼叫 guard 函式');
-- 前提回歸:漏洞的成因是「表級 UPDATE + 無欄位限制的 policy」,兩者仍在,
-- 代表這次修補確實是靠 trigger 擋下,而不是靠權限被順手收掉。
select is(has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), true,
  '前提仍在:authenticated 有 profiles 表級 UPDATE 權限');
select is((select count(*)::int from pg_policies
  where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_own'),
  1, '前提仍在:profiles_update_own policy 未被更動');

-- ── 固定資料:確定性 UUID 使用者與兩個專案 ──────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('cc100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'fresh@orgguard.test', '', now(), '{}',
   '{"full_name":"尚未加入專案者","org_type":"contractor"}', now(), now()),
  ('cc100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nullowner@orgguard.test', '', now(), '{}',
   '{"full_name":"created_by 為 NULL 專案的成員","org_type":"contractor"}', now(), now()),
  ('cc100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member@orgguard.test', '', now(), '{}',
   '{"full_name":"他人專案成員","org_type":"contractor"}', now(), now()),
  ('cc100000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'padmin@orgguard.test', '', now(), '{}',
   '{"full_name":"平台管理員","org_type":"contractor"}', now(), now()),
  ('cc100000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'creator@orgguard.test', '', now(), '{}',
   '{"full_name":"專案建立者","org_type":"owner"}', now(), now());

-- 註冊當下由 metadata 帶入身分別(handle_new_user):這條正當管道必須維持
select is((select org_type from public.profiles
  where id = 'cc100000-0000-0000-0000-000000000009'), 'owner',
  '正當管道1:註冊時 handle_new_user 仍能從 metadata 帶入 org_type');

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, created_by) values
  ('cc200000-0000-0000-0000-00000000000a', 'created_by 為 NULL 的案', null),
  ('cc200000-0000-0000-0000-00000000000b', '他人建立的案',
   'cc100000-0000-0000-0000-000000000009');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('cc200000-0000-0000-0000-00000000000a', 'cc100000-0000-0000-0000-000000000002', 'member'),
  ('cc200000-0000-0000-0000-00000000000b', 'cc100000-0000-0000-0000-000000000003', 'member');

-- ── 攻擊路徑 1:尚未加入任何專案就先提權(舊 guard 的最大破口) ───────────────
select pg_temp.become('cc100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  update public.profiles set org_type = 'owner'
   where id = 'cc100000-0000-0000-0000-000000000001'
$$, 'P0001', '不可自行變更組織別(org_type),請聯絡平台管理者',
  '攻擊1:尚未加入專案者不可自行改成 owner');
select throws_ok($$
  update public.profiles set org_type = 'supervisor'
   where id = 'cc100000-0000-0000-0000-000000000001'
$$, 'P0001', '不可自行變更組織別(org_type),請聯絡平台管理者',
  '攻擊1:廠商也不可自稱監造');
reset role;
select is((select org_type from public.profiles
  where id = 'cc100000-0000-0000-0000-000000000001'), 'contractor',
  '攻擊1:org_type 未被改動');
select is(public.my_org_type(), 'contractor',
  '攻擊1:my_org_type() 維持廠商(RBAC 根未被污染)');

-- ── 攻擊路徑 2:created_by 為 NULL 的專案(舊 guard 的 NULL 比較破口) ────────
select pg_temp.become('cc100000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$
  update public.profiles set org_type = 'supervisor'
   where id = 'cc100000-0000-0000-0000-000000000002'
$$, 'P0001', '不可自行變更組織別(org_type),請聯絡平台管理者',
  '攻擊2:專案 created_by 為 NULL 也擋得住(不再依賴會變 NULL 的比較)');
reset role;
select is((select org_type from public.profiles
  where id = 'cc100000-0000-0000-0000-000000000002'), 'contractor',
  '攻擊2:org_type 未被改動');

-- ── 攻擊路徑 3:退出專案 → 改身分別 → 再加回來 ──────────────────────────────
select pg_temp.become('cc100000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$
  update public.profiles set org_type = 'owner'
   where id = 'cc100000-0000-0000-0000-000000000003'
$$, 'P0001', null, '攻擊3(對照):在他人專案內時擋下');
reset role;
delete from public.project_members
 where user_id = 'cc100000-0000-0000-0000-000000000003';
select pg_temp.become('cc100000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$
  update public.profiles set org_type = 'owner'
   where id = 'cc100000-0000-0000-0000-000000000003'
$$, 'P0001', '不可自行變更組織別(org_type),請聯絡平台管理者',
  '攻擊3:退出所有專案後仍然擋得住');
reset role;
select is((select org_type from public.profiles
  where id = 'cc100000-0000-0000-0000-000000000003'), 'contractor',
  '攻擊3:org_type 未被改動');

-- ── 非特權欄位不受影響:個資欄位仍可自助維護 ────────────────────────────────
select pg_temp.become('cc100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  update public.profiles set full_name = '改過的姓名', company = '改過的公司', role = '工地主任'
   where id = 'cc100000-0000-0000-0000-000000000001'
$$, '非特權欄位(姓名/公司/職稱)仍可自行修改');
-- 同一句 UPDATE 內夾帶 org_type 也要被擋(避免用合法欄位夾帶提權)
select throws_ok($$
  update public.profiles set full_name = '再改一次', org_type = 'owner'
   where id = 'cc100000-0000-0000-0000-000000000001'
$$, 'P0001', '不可自行變更組織別(org_type),請聯絡平台管理者',
  '合法欄位夾帶 org_type 一併寫入時仍被擋下');
reset role;
select is((select full_name from public.profiles
  where id = 'cc100000-0000-0000-0000-000000000001'), '改過的姓名',
  '被擋下的那一句整句 rollback,姓名停在前一次合法值');

-- org_type 寫入「相同值」不算變更,不應誤擋(避免整列 upsert 型寫入被卡死)
select pg_temp.become('cc100000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  update public.profiles set org_type = 'contractor', full_name = '同值寫入'
   where id = 'cc100000-0000-0000-0000-000000000001'
$$, 'org_type 寫入相同值不算變更,不誤擋');
reset role;

-- ── 正當管道 2:service role / migration(auth.uid() 為 null)可改 ────────────
select pg_temp.become(null);
select lives_ok($$
  update public.profiles set org_type = 'supervisor'
   where id = 'cc100000-0000-0000-0000-000000000002'
$$, '正當管道2:無 JWT 情境(service role / SQL console)可調整組織別');
select is((select org_type from public.profiles
  where id = 'cc100000-0000-0000-0000-000000000002'), 'supervisor',
  '正當管道2:寫入確實生效');

-- ── 正當管道 3:平台管理員可改 ───────────────────────────────────────────────
update public.profiles set is_platform_admin = true
 where id = 'cc100000-0000-0000-0000-000000000008';
select pg_temp.become('cc100000-0000-0000-0000-000000000008');
select is(public.is_platform_admin(), true, '前提:第 8 號使用者已是平台管理員');
set local role authenticated;
select lives_ok($$
  update public.profiles set org_type = 'owner'
   where id = 'cc100000-0000-0000-0000-000000000008'
$$, '正當管道3:平台管理員不被自己的 guard 鎖死');
reset role;

-- ── 回歸:批 A 的 is_platform_admin guard 未被這次修補影響 ────────────────────
select pg_temp.become('cc100000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  update public.profiles set is_platform_admin = true
   where id = 'cc100000-0000-0000-0000-000000000001'
$$, 'P0001', '不可自行變更平台管理員身分',
  '回歸:一般使用者仍不可自封平台管理員(批 A trigger 未受影響)');
reset role;
select has_trigger('public', 'profiles', 'profiles_guard_platform_admin',
  '回歸:批 A 的 profiles_guard_platform_admin trigger 仍在(兩支各守一欄)');

select * from finish();
rollback;
