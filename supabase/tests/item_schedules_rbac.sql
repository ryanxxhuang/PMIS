-- item_schedules 三方權責(pgTAP):工項預定時程(planned_start/finish,每個工項一筆),
-- 前端 ledger 以 upsert(onConflict: work_item_id)寫入。覆蓋:唯一鍵(upsert 依賴)、
-- 三方都看得到(進度對照用)、廠商可編、機關唯讀、非成員跨案不可見不可寫、
-- 刪工項時預定時程不殘留(FK cascade)。對應 20260711000000_baseline.sql。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
begin;

select plan(13);

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b5b10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'is-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('b5b10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'is-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('b5b10000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'is-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('b5b10000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'is-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider (B only)","org_type":"contractor"}', now(), now()),
  ('b5b10000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'is-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('b5b20000-0000-0000-0000-00000000000a', '預定時程權責測試案 A', '機關', '廠商', '監造',
   'b5b10000-0000-0000-0000-000000000005'),
  ('b5b20000-0000-0000-0000-00000000000b', '預定時程權責測試案 B', '機關', '廠商', '監造',
   'b5b10000-0000-0000-0000-000000000004');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('b5b20000-0000-0000-0000-00000000000a', 'b5b10000-0000-0000-0000-000000000001', 'member'),
  ('b5b20000-0000-0000-0000-00000000000a', 'b5b10000-0000-0000-0000-000000000002', 'member'),
  ('b5b20000-0000-0000-0000-00000000000a', 'b5b10000-0000-0000-0000-000000000003', 'member'),
  ('b5b20000-0000-0000-0000-00000000000a', 'b5b10000-0000-0000-0000-000000000005', 'admin'),
  ('b5b20000-0000-0000-0000-00000000000b', 'b5b10000-0000-0000-0000-000000000004', 'admin');

insert into public.work_items (id, project_id, description, unit, quantity, unit_price, is_leaf) values
  ('b5b30000-0000-0000-0000-000000000001', 'b5b20000-0000-0000-0000-00000000000a', '基礎開挖', 'm3', 500, 200, true),
  ('b5b30000-0000-0000-0000-000000000002', 'b5b20000-0000-0000-0000-00000000000a', '基礎鋼筋', 'kg', 8000, 30, true),
  ('b5b30000-0000-0000-0000-000000000003', 'b5b20000-0000-0000-0000-00000000000a', '基礎混凝土', 'm3', 300, 3000, true);

insert into public.item_schedules (id, project_id, work_item_id, planned_start, planned_finish) values
  ('b5b40000-0000-0000-0000-000000000001', 'b5b20000-0000-0000-0000-00000000000a',
   'b5b30000-0000-0000-0000-000000000001', '2026-10-01', '2026-10-15');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 唯一鍵:前端 upsert(onConflict: work_item_id)依賴它,掉了 UI 存檔直接報錯 ──
select throws_ok($$ insert into public.item_schedules (project_id, work_item_id, planned_start)
  values ('b5b20000-0000-0000-0000-00000000000a', 'b5b30000-0000-0000-0000-000000000001', '2026-11-01') $$,
  '23505', null, '每個工項只有一筆預定時程(work_item_id 唯一)');

-- ── 可見範圍 ─────────────────────────────────────────────────────────────────
select pg_temp.become('b5b10000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from public.item_schedules
  where project_id = 'b5b20000-0000-0000-0000-00000000000a'), 1, '廠商看得到本案預定時程');
reset role;
select pg_temp.become('b5b10000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.item_schedules
  where project_id = 'b5b20000-0000-0000-0000-00000000000a'), 1, '監造看得到本案預定時程(進度落後對照)');
reset role;
select pg_temp.become('b5b10000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.item_schedules
  where project_id = 'b5b20000-0000-0000-0000-00000000000a'), 1, '機關看得到本案預定時程');
reset role;
select pg_temp.become('b5b10000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.item_schedules
  where project_id = 'b5b20000-0000-0000-0000-00000000000a'), 0, 'B 案成員看不到 A 案預定時程');
reset role;

-- ── 廠商可編 ─────────────────────────────────────────────────────────────────
select pg_temp.become('b5b10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ insert into public.item_schedules (project_id, work_item_id, planned_start, planned_finish)
  values ('b5b20000-0000-0000-0000-00000000000a', 'b5b30000-0000-0000-0000-000000000002', '2026-10-10', '2026-10-25') $$,
  '廠商可新增工項預定時程');
select lives_ok($$ update public.item_schedules set planned_finish = '2026-10-20'
  where id = 'b5b40000-0000-0000-0000-000000000001' $$, '廠商可調整預定完成日');
reset role;

-- ── 機關唯讀 ─────────────────────────────────────────────────────────────────
select pg_temp.become('b5b10000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ insert into public.item_schedules (project_id, work_item_id, planned_start)
  values ('b5b20000-0000-0000-0000-00000000000a', 'b5b30000-0000-0000-0000-000000000003', '2026-12-01') $$,
  '42501', null, '機關不可新增預定時程(進度承諾是廠商的)');
update public.item_schedules set planned_finish = '2027-12-31' where id = 'b5b40000-0000-0000-0000-000000000001';
select is((select planned_finish from public.item_schedules where id = 'b5b40000-0000-0000-0000-000000000001'),
  '2026-10-20'::date, '機關 UPDATE 命中 0 列:預定完成日未被改寫');
delete from public.item_schedules where id = 'b5b40000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.item_schedules where id = 'b5b40000-0000-0000-0000-000000000001'), 1,
  '機關 DELETE 命中 0 列:預定時程仍在');
reset role;

-- ── 非成員 ───────────────────────────────────────────────────────────────────
select pg_temp.become('b5b10000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ insert into public.item_schedules (project_id, work_item_id, planned_start)
  values ('b5b20000-0000-0000-0000-00000000000a', 'b5b30000-0000-0000-0000-000000000003', '2026-12-01') $$,
  '42501', null, '非成員不可對 A 案寫入預定時程');
update public.item_schedules set planned_finish = '2027-12-31' where id = 'b5b40000-0000-0000-0000-000000000001';
reset role;  -- 非成員本來就看不到該列,讀回驗證要以 superuser 做
select is((select planned_finish from public.item_schedules where id = 'b5b40000-0000-0000-0000-000000000001'),
  '2026-10-20'::date, '非成員 UPDATE 命中 0 列');

-- ── 刪工項:預定時程不殘留(ledger 先刪時程再刪工項,FK cascade 是安全網)────────
select pg_temp.become('b5b10000-0000-0000-0000-000000000001');
set local role authenticated;
delete from public.work_items where id = 'b5b30000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.item_schedules
  where work_item_id = 'b5b30000-0000-0000-0000-000000000002'), 0, '工項刪除後其預定時程隨之清除(不留孤兒列)');
reset role;

select * from finish();
rollback;
