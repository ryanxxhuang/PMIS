-- change_order_items 三方權責(pgTAP):變更設計明細=追加/減帳的數量與金額,
-- 是契約總價變動的底稿。覆蓋:三方都看得到(機關要核對變更金額)、機關只核定不改寫
-- (can_write 排除 owner)、非成員跨案不可見不可寫、已核准變更明細凍結
-- (change_order_items_guard)、正式模式關閉管理者例外、整案刪除不被 guard 卡住。
-- 對應 20260711000000_baseline.sql(policy/guard)、20260712001300_formal_mode.sql。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
begin;

select plan(19);

select has_trigger('public', 'change_order_items', 'change_order_items_guard',
  '已核准變更明細凍結 guard 掛上');

-- ── 測試資料:三方 member + 建立者 admin(廠商 org)+ 只在 B 案的外人 ─────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b5a10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'coi-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('b5a10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'coi-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('b5a10000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'coi-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('b5a10000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'coi-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider (B only)","org_type":"contractor"}', now(), now()),
  ('b5a10000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'coi-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('b5a20000-0000-0000-0000-00000000000a', '變更明細權責測試案 A', '機關', '廠商', '監造',
   'b5a10000-0000-0000-0000-000000000005'),
  ('b5a20000-0000-0000-0000-00000000000b', '變更明細權責測試案 B', '機關', '廠商', '監造',
   'b5a10000-0000-0000-0000-000000000004');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('b5a20000-0000-0000-0000-00000000000a', 'b5a10000-0000-0000-0000-000000000001', 'member'),
  ('b5a20000-0000-0000-0000-00000000000a', 'b5a10000-0000-0000-0000-000000000002', 'member'),
  ('b5a20000-0000-0000-0000-00000000000a', 'b5a10000-0000-0000-0000-000000000003', 'member'),
  ('b5a20000-0000-0000-0000-00000000000a', 'b5a10000-0000-0000-0000-000000000005', 'admin'),
  ('b5a20000-0000-0000-0000-00000000000b', 'b5a10000-0000-0000-0000-000000000004', 'admin');

insert into public.work_items (id, project_id, description, unit, quantity, unit_price, is_leaf) values
  ('b5a30000-0000-0000-0000-000000000001', 'b5a20000-0000-0000-0000-00000000000a', '鋼筋', 'kg', 1000, 30, true);

-- CO-A 提出中(可編),CO-B 已核准(凍結);明細由 superuser 直插(auth.uid() null → guard 放行)
insert into public.change_orders (id, project_id, co_no, title, status) values
  ('b5a40000-0000-0000-0000-000000000001', 'b5a20000-0000-0000-0000-00000000000a', 'CO-A', '提出中', '提出'),
  ('b5a40000-0000-0000-0000-000000000002', 'b5a20000-0000-0000-0000-00000000000a', 'CO-B', '已核准', '核准');
insert into public.change_order_items (id, change_order_id, project_id, work_item_id, description, unit, qty_delta, unit_price, amount_delta) values
  ('b5a50000-0000-0000-0000-000000000001', 'b5a40000-0000-0000-0000-000000000001',
   'b5a20000-0000-0000-0000-00000000000a', 'b5a30000-0000-0000-0000-000000000001', '鋼筋追加', 'kg', 100, 30, 3000),
  ('b5a50000-0000-0000-0000-000000000002', 'b5a40000-0000-0000-0000-000000000002',
   'b5a20000-0000-0000-0000-00000000000a', 'b5a30000-0000-0000-0000-000000000001', '鋼筋減帳(已核准)', 'kg', -50, 30, -1500);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 可見範圍:三方都看得到,非成員看不到 ──────────────────────────────────────
select pg_temp.become('b5a10000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from public.change_order_items
  where project_id = 'b5a20000-0000-0000-0000-00000000000a'), 2, '廠商看得到本案全部變更明細');
reset role;
select pg_temp.become('b5a10000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.change_order_items
  where project_id = 'b5a20000-0000-0000-0000-00000000000a'), 2, '監造看得到本案全部變更明細');
reset role;
select pg_temp.become('b5a10000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.change_order_items
  where project_id = 'b5a20000-0000-0000-0000-00000000000a'), 2,
  '機關看得到本案全部變更明細(核定前要能核對數量與金額)');
reset role;
select pg_temp.become('b5a10000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.change_order_items
  where project_id = 'b5a20000-0000-0000-0000-00000000000a'), 0,
  'B 案成員看不到 A 案變更明細(跨案不洩漏追加減帳金額)');
reset role;

-- ── 寫入矩陣(CO-A 提出中)─────────────────────────────────────────────────
select pg_temp.become('b5a10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.change_order_items (change_order_id, project_id, description, unit, qty_delta, unit_price, amount_delta)
  values ('b5a40000-0000-0000-0000-000000000001', 'b5a20000-0000-0000-0000-00000000000a', '模板追加', 'm2', 20, 500, 10000) $$,
  '廠商可新增提出中變更的明細');
reset role;
select pg_temp.become('b5a10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ update public.change_order_items set qty_delta = 90, amount_delta = 2700
  where id = 'b5a50000-0000-0000-0000-000000000001' $$,
  '監造受理審查期間可修正明細數量');
reset role;

select pg_temp.become('b5a10000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ insert into public.change_order_items (change_order_id, project_id, description, qty_delta, unit_price, amount_delta)
  values ('b5a40000-0000-0000-0000-000000000001', 'b5a20000-0000-0000-0000-00000000000a', '機關加的', 1, 1, 1) $$,
  '42501', null, '機關不可新增變更明細(機關只核定,不改寫內容)');
update public.change_order_items set amount_delta = 999999 where id = 'b5a50000-0000-0000-0000-000000000001';
select is((select amount_delta from public.change_order_items where id = 'b5a50000-0000-0000-0000-000000000001'),
  2700::numeric, '機關 UPDATE 命中 0 列:金額未被改寫(RLS using 濾掉,不是靜默成功)');
delete from public.change_order_items where id = 'b5a50000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.change_order_items where id = 'b5a50000-0000-0000-0000-000000000001'), 1,
  '機關 DELETE 命中 0 列:明細仍在');
reset role;

select pg_temp.become('b5a10000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ insert into public.change_order_items (change_order_id, project_id, description, qty_delta, unit_price, amount_delta)
  values ('b5a40000-0000-0000-0000-000000000001', 'b5a20000-0000-0000-0000-00000000000a', '外人塞的', 1, 1, 1) $$,
  '42501', null, '非成員不可對 A 案塞入變更明細(猜到 change_order_id 也沒用)');
update public.change_order_items set amount_delta = 999999 where id = 'b5a50000-0000-0000-0000-000000000001';
reset role;  -- 非成員本來就看不到該列,讀回驗證要以 superuser 做
select is((select amount_delta from public.change_order_items where id = 'b5a50000-0000-0000-0000-000000000001'),
  2700::numeric, '非成員 UPDATE 命中 0 列:金額未被改寫');

-- ── 已核准變更凍結(CO-B)──────────────────────────────────────────────────
select pg_temp.become('b5a10000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$ update public.change_order_items set qty_delta = -500, amount_delta = -15000
  where id = 'b5a50000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '已核准變更的明細不可再改數量(改了=核定金額失真)');
select throws_ok($$ insert into public.change_order_items (change_order_id, project_id, description, qty_delta, unit_price, amount_delta)
  values ('b5a40000-0000-0000-0000-000000000002', 'b5a20000-0000-0000-0000-00000000000a', '核准後偷加', 1, 1, 1) $$,
  'P0001', null, '已核准變更不可事後追加明細');
reset role;
select pg_temp.become('b5a10000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$ delete from public.change_order_items where id = 'b5a50000-0000-0000-0000-000000000002' $$,
  'P0001', null, '監造也不可刪除已核准變更的明細');
reset role;

-- ── 管理者例外只在非正式模式 ──────────────────────────────────────────────
select pg_temp.become('b5a10000-0000-0000-0000-000000000005');
set local role authenticated;
select lives_ok($$ update public.change_order_items set note = '試用期管理者修正'
  where id = 'b5a50000-0000-0000-0000-000000000002' $$,
  '非正式模式:專案管理者仍可修正已核准明細(admin_override,試用行為不變)');
reset role;

select pg_temp.become(null);
update public.projects set formal_mode = true where id = 'b5a20000-0000-0000-0000-00000000000a';

select pg_temp.become('b5a10000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ update public.change_order_items set note = '正式模式偷改'
  where id = 'b5a50000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '正式模式:已核准明細對專案管理者也凍結(履約證據完整性)');
reset role;

-- ── 迴歸:凍結 guard 不得害整案刪不掉 ────────────────────────────────────────
select pg_temp.become('b5a10000-0000-0000-0000-000000000005');
select lives_ok($$ select public.delete_project('b5a20000-0000-0000-0000-00000000000a') $$,
  '正式模式下含已核准變更明細的專案,管理者仍可整案刪除(cascade 不被 guard 擋)');
select is((select count(*)::int from public.change_order_items
  where project_id = 'b5a20000-0000-0000-0000-00000000000a'), 0, '變更明細隨專案 cascade 清除');

select * from finish();
rollback;
