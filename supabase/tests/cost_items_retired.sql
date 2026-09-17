-- cost_items 退場（pgTAP）：D-026 P1b 成本／毛利／分包記帳退出新作業。對應 migration
-- 20260917210000_cost_items_retire.sql。釘住三件事：
--   1. 寫入被資料庫拒絕（表級 grant 收回 → 42501），三角色、專案管理者、非成員一律不能
--      INSERT／UPDATE／DELETE——不是只有前端沒按鈕；
--   2. RLS 只剩 SELECT policy（日後廣域 grant 也擋不回寫入）；
--   3. 歷史讀取維持原權限：廠商成員與專案管理者可讀，監造／機關讀不到廠商成本，非成員跨案不可見。
-- 執行方式：npm run test:db（一次性資料庫），整份在交易內執行並 rollback。
begin;

select plan(24);

-- ── 表級 grant 與 policy 形狀 ────────────────────────────────────────────────
select is(has_table_privilege('authenticated', 'public.cost_items', 'SELECT'), true, 'authenticated 仍有 SELECT（歷史查閱）');
select is(has_table_privilege('authenticated', 'public.cost_items', 'INSERT'), false, 'authenticated 無 INSERT');
select is(has_table_privilege('authenticated', 'public.cost_items', 'UPDATE'), false, 'authenticated 無 UPDATE');
select is(has_table_privilege('authenticated', 'public.cost_items', 'DELETE'), false, 'authenticated 無 DELETE');
select is(
  has_table_privilege('anon', 'public.cost_items', 'INSERT')
    or has_table_privilege('anon', 'public.cost_items', 'UPDATE')
    or has_table_privilege('anon', 'public.cost_items', 'DELETE'),
  false, 'anon 沒有任何寫入權限');
select is(
  (select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies
    where schemaname = 'public' and tablename = 'cost_items'),
  'cost_items_contractor_read:SELECT',
  'cost_items 只剩一條 SELECT policy（原 for all policy 已移除）');

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c0510000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cr-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('c0510000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cr-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('c0510000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cr-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('c0510000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cr-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider (B only)","org_type":"contractor"}', now(), now()),
  ('c0510000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cr-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (supervisor org)","org_type":"supervisor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('c0520000-0000-0000-0000-00000000000a', '成本退場測試案 A', '機關', '廠商', '監造',
   'c0510000-0000-0000-0000-000000000005'),
  ('c0520000-0000-0000-0000-00000000000b', '成本退場測試案 B', '機關', '廠商', '監造',
   'c0510000-0000-0000-0000-000000000004');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('c0520000-0000-0000-0000-00000000000a', 'c0510000-0000-0000-0000-000000000001', 'member'),
  ('c0520000-0000-0000-0000-00000000000a', 'c0510000-0000-0000-0000-000000000002', 'member'),
  ('c0520000-0000-0000-0000-00000000000a', 'c0510000-0000-0000-0000-000000000003', 'member'),
  ('c0520000-0000-0000-0000-00000000000a', 'c0510000-0000-0000-0000-000000000005', 'admin'),
  ('c0520000-0000-0000-0000-00000000000b', 'c0510000-0000-0000-0000-000000000004', 'admin');

-- 歷史列以 superuser 建立（模擬退場前既有資料）
insert into public.cost_items (id, project_id, category, title, vendor, budget_amount, actual_amount) values
  ('c0530000-0000-0000-0000-000000000001', 'c0520000-0000-0000-0000-00000000000a',
   '分包', '鋼筋工程（歷史）', '正大鋼鐵行', 52000000, 24800000);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 廠商成員：可讀歷史，不可寫 ───────────────────────────────────────────────
select pg_temp.become('c0510000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from public.cost_items
  where project_id = 'c0520000-0000-0000-0000-00000000000a'), 1, '廠商成員仍讀得到本案歷史成本');
select throws_ok($$ insert into public.cost_items (project_id, category, title, budget_amount)
  values ('c0520000-0000-0000-0000-00000000000a', '材料', '新成本項', 100) $$,
  '42501', null, '廠商成員不可新增成本項（表級 INSERT 已收回）');
select throws_ok($$ update public.cost_items set actual_amount = 99
  where id = 'c0530000-0000-0000-0000-000000000001' $$,
  '42501', null, '廠商成員不可修改歷史成本（表級 UPDATE 已收回）');
select throws_ok($$ delete from public.cost_items where id = 'c0530000-0000-0000-0000-000000000001' $$,
  '42501', null, '廠商成員不可刪除歷史成本（表級 DELETE 已收回）');
reset role;

-- ── 監造成員：讀不到廠商成本，也不能寫 ───────────────────────────────────────
select pg_temp.become('c0510000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.cost_items
  where project_id = 'c0520000-0000-0000-0000-00000000000a'), 0, '監造看不到廠商成本（RLS 原條件不變）');
select throws_ok($$ insert into public.cost_items (project_id, category, title, budget_amount)
  values ('c0520000-0000-0000-0000-00000000000a', '材料', '監造試寫', 100) $$,
  '42501', null, '監造不可新增成本項');
select throws_ok($$ update public.cost_items set actual_amount = 99
  where id = 'c0530000-0000-0000-0000-000000000001' $$,
  '42501', null, '監造不可修改成本項');
reset role;

-- ── 機關成員：讀不到廠商成本，也不能寫 ───────────────────────────────────────
select pg_temp.become('c0510000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.cost_items
  where project_id = 'c0520000-0000-0000-0000-00000000000a'), 0, '機關看不到廠商成本（RLS 原條件不變）');
select throws_ok($$ insert into public.cost_items (project_id, category, title, budget_amount)
  values ('c0520000-0000-0000-0000-00000000000a', '材料', '機關試寫', 100) $$,
  '42501', null, '機關不可新增成本項');
select throws_ok($$ delete from public.cost_items where id = 'c0530000-0000-0000-0000-000000000001' $$,
  '42501', null, '機關不可刪除成本項');
reset role;

-- ── 非成員（只在 B 案）：跨案不可見、不可寫 ──────────────────────────────────
select pg_temp.become('c0510000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.cost_items
  where project_id = 'c0520000-0000-0000-0000-00000000000a'), 0, 'B 案成員看不到 A 案成本');
select throws_ok($$ insert into public.cost_items (project_id, category, title, budget_amount)
  values ('c0520000-0000-0000-0000-00000000000a', '材料', '跨案試寫', 100) $$,
  '42501', null, '非成員不可對 A 案寫入成本');
select throws_ok($$ insert into public.cost_items (project_id, category, title, budget_amount)
  values ('c0520000-0000-0000-0000-00000000000b', '材料', '自案試寫', 100) $$,
  '42501', null, '即使是自己管理的 B 案也不可新增成本（退場對所有專案生效）');
reset role;

-- ── 專案管理者（監造組織、role=admin）：歷史查閱原權限可讀，仍不可寫 ───────────
select pg_temp.become('c0510000-0000-0000-0000-000000000005');
set local role authenticated;
select is((select count(*)::int from public.cost_items
  where project_id = 'c0520000-0000-0000-0000-00000000000a'), 1, '專案管理者可讀歷史成本（can_access_contractor_private 原條件）');
select throws_ok($$ update public.cost_items set status = '已結算'
  where id = 'c0530000-0000-0000-0000-000000000001' $$,
  '42501', null, '專案管理者不可修改成本項（管理者也翻不過退場）');
select throws_ok($$ delete from public.cost_items where id = 'c0530000-0000-0000-0000-000000000001' $$,
  '42501', null, '專案管理者不可刪除成本項');
reset role;

-- ── 歷史列完整無損 ───────────────────────────────────────────────────────────
select is((select count(*)::int from public.cost_items), 1, '全部寫入嘗試後仍只有原歷史列（無新增）');
select is((select actual_amount from public.cost_items where id = 'c0530000-0000-0000-0000-000000000001'),
  24800000::numeric, '歷史列數值未被改寫');

select * from finish();
rollback;
