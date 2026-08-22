-- profiles select 收斂(個資最小化)pgTAP 套件。
-- 涵蓋:自己/共案成員可讀、非共案不可讀(跨租戶枚舉關死)、is_platform_admin
-- 欄位對 authenticated 整欄關閉(連自己的都讀不到,管理員名單不可枚舉)、
-- 平台管理員全讀,以及既有動線回歸(成員清單 RPC / my_org_type / admin RPC 判定)。
-- 執行:本地 supabase(colima)+容器內 psql,整份交易內執行並 rollback。
-- 對應 migration 20260822010100_profiles_select_scope.sql。
begin;

select plan(19);

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
select has_function('public', 'shares_project_with', array['uuid'], '共案判定 helper 存在');
select is((select prosecdef from pg_proc where oid = 'public.shares_project_with(uuid)'::regprocedure),
  true, 'helper 為 security definer(查 project_members 不受其 RLS 影響,不遞迴)');
select is((select count(*)::int from pg_policies
  where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_scoped'),
  1, '收斂後的 select policy 已掛上');
select is((select count(*)::int from pg_policies
  where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_authenticated'),
  0, '舊的全平台可讀 policy 已移除');
-- 表級 SELECT 已收回、改逐欄授權——is_platform_admin 刻意不在授權清單內
select is(has_table_privilege('authenticated', 'public.profiles', 'SELECT'), false,
  'authenticated 的 profiles 表級 SELECT 已收回(改逐欄授權)');
select is(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'SELECT'), true,
  '一般欄位(full_name)仍有欄級 SELECT 授權');
select is(has_column_privilege('authenticated', 'public.profiles', 'is_platform_admin', 'SELECT'), false,
  'is_platform_admin 欄位無 SELECT 授權(管理員名單不可枚舉)');
-- profiles_org_type_guard 套件的前提:guard 靠 trigger,不靠收 UPDATE 權限
select is(has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), true,
  '前提未動:authenticated 仍有 profiles 表級 UPDATE(org_type/admin 由 trigger 各守一欄)');

-- ── 固定資料:A/C 共案、B 在另一案、admin 不在任何案 ─────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('dd100000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'a-contractor@selscope.test', '', now(), '{}',
   '{"full_name":"A案廠商","org_type":"contractor"}', now(), now()),
  ('dd100000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'b-supervisor@selscope.test', '', now(), '{}',
   '{"full_name":"B案監造","org_type":"supervisor"}', now(), now()),
  ('dd100000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'c-supervisor@selscope.test', '', now(), '{}',
   '{"full_name":"A案監造","org_type":"supervisor"}', now(), now()),
  ('dd100000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'padmin@selscope.test', '', now(), '{}',
   '{"full_name":"平台管理員","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, created_by) values
  ('dd200000-0000-0000-0000-000000000001', 'A 的案', 'dd100000-0000-0000-0000-00000000000a'),
  ('dd200000-0000-0000-0000-000000000002', 'B 的案', 'dd100000-0000-0000-0000-00000000000b');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('dd200000-0000-0000-0000-000000000001', 'dd100000-0000-0000-0000-00000000000a', 'admin'),
  ('dd200000-0000-0000-0000-000000000001', 'dd100000-0000-0000-0000-00000000000c', 'member'),
  ('dd200000-0000-0000-0000-000000000002', 'dd100000-0000-0000-0000-00000000000b', 'admin');

-- 平台管理員指派(auth.uid() 為 null → 批 A guard 放行,正規指派路徑)
update public.profiles set is_platform_admin = true
 where id = 'dd100000-0000-0000-0000-00000000000d';

-- ── 可讀範圍:自己 + 共案成員 ───────────────────────────────────────────────
select pg_temp.become('dd100000-0000-0000-0000-00000000000a');
set local role authenticated;
select is((select full_name from public.profiles
  where id = 'dd100000-0000-0000-0000-00000000000a'), 'A案廠商',
  '自己的 profile 讀得到(登入載入動線)');
select is((select full_name from public.profiles
  where id = 'dd100000-0000-0000-0000-00000000000c'), 'A案監造',
  '共案成員的 profile 讀得到');

-- ── 跨租戶枚舉關死:非共案者互相不可見 ──────────────────────────────────────
select is((select full_name from public.profiles
  where id = 'dd100000-0000-0000-0000-00000000000b'), null::text,
  'A 案廠商讀不到 B 案監造(跨租戶枚舉關死)');
reset role;
select pg_temp.become('dd100000-0000-0000-0000-00000000000b');
set local role authenticated;
select is((select full_name from public.profiles
  where id = 'dd100000-0000-0000-0000-00000000000a'), null::text,
  '反向同理:B 案監造也讀不到 A 案廠商');
reset role;

-- ── is_platform_admin 欄位整欄關閉(連 select * 一起釘住)────────────────────
select pg_temp.become('dd100000-0000-0000-0000-00000000000a');
set local role authenticated;
select throws_ok($$
  select is_platform_admin from public.profiles
   where id = 'dd100000-0000-0000-0000-00000000000a'
$$, '42501', null,
  'is_platform_admin 連自己那列都讀不到(欄級授權擋在 RLS 之前)');
select throws_ok($$
  select * from public.profiles
   where id = 'dd100000-0000-0000-0000-00000000000a'
$$, '42501', null,
  'select * 因含未授權欄位而 42501(前端一律明列欄位,見 store/slices/auth.js)');

-- ── 既有動線回歸:成員清單 RPC / RBAC 根 / admin 身分 RPC ────────────────────
select is((select count(*)::int from public.list_project_members(
  'dd200000-0000-0000-0000-000000000001')), 2,
  '成員清單 RPC 不受收斂影響(security definer),仍回傳全員');
select is(public.my_org_type(), 'contractor',
  'my_org_type() 不受影響(security definer 讀自己)');
select is(public.is_platform_admin(), false,
  '一般使用者經 is_platform_admin() RPC 判定為 false(前端 /admin 判定路徑活著)');
reset role;

-- ── 平台管理員:全讀 + RPC 判定 ─────────────────────────────────────────────
select pg_temp.become('dd100000-0000-0000-0000-00000000000d');
set local role authenticated;
select is((select full_name from public.profiles
  where id = 'dd100000-0000-0000-0000-00000000000b'), 'B案監造',
  '平台管理員讀得到非共案使用者(營運後台)');
select is(public.is_platform_admin(), true,
  '平台管理員經 RPC 判定為 true(不需直讀欄位)');
reset role;

select * from finish();
rollback;
