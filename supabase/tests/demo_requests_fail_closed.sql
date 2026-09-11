-- demo_requests 縱深防禦(pgTAP):行銷站 Demo 申請表存個資(姓名/Email/電話/IP/UA),
-- 對 API 角色必須「兩層都關」——RLS 零 policy(第一層,20260824123253)+ 表級權限收回
-- (第二層,20260911100000)。任一層日後被鬆開(誤加 policy、grant 回去、RLS 關掉),
-- 這裡都要紅。唯一寫入者是 Edge Function demo-request 的 service role,不在 revoke 名單。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
begin;

select plan(22);

-- ── 第一層:RLS 啟用且刻意零 policy ──────────────────────────────────────────
select has_table('public', 'demo_requests', 'demo_requests 存在');
select is((select relrowsecurity from pg_class where oid = 'public.demo_requests'::regclass), true,
  'RLS 啟用');
select is((select count(*)::int from pg_policies
  where schemaname = 'public' and tablename = 'demo_requests'), 0,
  '刻意零 policy:個資表不得有任何 API 角色讀寫路徑,要加 policy 得先改這條斷言');

-- ── 第二層:表級權限(縱深:policy 鬆掉或 RLS 關掉時仍擋得住)────────────────
select is(has_table_privilege('authenticated', 'public.demo_requests', 'SELECT'), false,
  'authenticated 無 SELECT 表級權限(申請人個資不對登入者敞開)');
select is(has_table_privilege('authenticated', 'public.demo_requests', 'INSERT'), false,
  'authenticated 無 INSERT 表級權限');
select is(has_table_privilege('authenticated', 'public.demo_requests', 'UPDATE'), false,
  'authenticated 無 UPDATE 表級權限');
select is(has_table_privilege('authenticated', 'public.demo_requests', 'DELETE'), false,
  'authenticated 無 DELETE 表級權限');
select is(has_table_privilege('anon', 'public.demo_requests', 'SELECT'), false,
  'anon 無 SELECT(行銷站前端只拿得到 anon key,直連必須撞牆)');
select is(has_table_privilege('anon', 'public.demo_requests', 'INSERT'), false,
  'anon 無 INSERT(寫入只能經 demo-request function 的蜜罐/限流檢查)');
select is(has_table_privilege('anon', 'public.demo_requests', 'TRUNCATE'), false,
  'anon 連 default privileges 帶進來的 TRUNCATE 也收掉(TRUNCATE 不受 RLS 約束)');
select is(has_sequence_privilege('authenticated', 'public.demo_requests_id_seq', 'UPDATE'), false,
  'identity 序列的 nextval 權限一併收回');
select is(has_table_privilege('service_role', 'public.demo_requests', 'INSERT'), true,
  'service_role 保有 INSERT(demo-request function 的寫入路徑不受收權影響)');
select is(has_table_privilege('service_role', 'public.demo_requests', 'SELECT'), true,
  'service_role 保有 SELECT(限流/稽核查詢)');

-- ── 行為:實際切角色 ──────────────────────────────────────────────────────────
-- 種一列(superuser 直插=模擬 service role 寫入路徑)
insert into public.demo_requests (role, name, org, email, phone, ip, user_agent)
values ('supervisor', '測試申請人', '測試事務所', 'demo@example.test', '0912-000-000',
        '203.0.113.9', 'pgTAP');

set local role authenticated;
select throws_ok($$ select count(*) from public.demo_requests $$, '42501', null,
  '登入者 SELECT 被表級權限擋下(42501),不是靠 RLS 回空集合');
select throws_ok($$ insert into public.demo_requests (role, name, org, email)
  values ('owner', 'x', 'y', 'x@y.z') $$, '42501', null, '登入者 INSERT 被擋');
select throws_ok($$ update public.demo_requests set note = 'x' $$, '42501', null,
  '登入者 UPDATE 被擋');
select throws_ok($$ delete from public.demo_requests $$, '42501', null,
  '登入者 DELETE 被擋');
reset role;

set local role anon;
select throws_ok($$ select count(*) from public.demo_requests $$, '42501', null,
  'anon SELECT 被擋');
select throws_ok($$ insert into public.demo_requests (role, name, org, email)
  values ('owner', 'x', 'y', 'x@y.z') $$, '42501', null, 'anon INSERT 被擋');
reset role;

-- service_role 寫入路徑:序列權限已從 anon/authenticated 收回,identity 欄位的
-- nextval 由 PG 內部呼叫不檢查權限,service role 插入必須照常成功
set local role service_role;
select lives_ok($$ insert into public.demo_requests (role, name, org, email)
  values ('contractor', '服務角色寫入', '營造廠', 'svc@example.test') $$,
  'service_role 可寫入(demo-request function 路徑不受收權影響,identity 序列照常)');
select is((select count(*)::int from public.demo_requests), 2,
  'service_role 可讀全部申請');
reset role;

-- ── 縱深:第一層被關掉時第二層仍擋得住(這就是補第二層的理由)──────────────
alter table public.demo_requests disable row level security;
set local role authenticated;
select throws_ok($$ select count(*) from public.demo_requests $$, '42501', null,
  'RLS 被關掉的情境下,表級權限仍擋住登入者');
reset role;
alter table public.demo_requests enable row level security;

select * from finish();
rollback;
