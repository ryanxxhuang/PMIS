-- observations 三方權責(pgTAP):觀察事項=監造/廠商之間的輕量提醒(assigned_to
-- contractor|supervisor,status 待處理|已處理|轉缺失),尚未升級為缺失前的協作紀錄。
-- 覆蓋:三方都看得到、監造可提出、廠商可回應、機關唯讀(can_write 排除 owner)、
-- 非成員跨案不可見不可寫不可刪。對應 20260711000000_baseline.sql。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
begin;

select plan(12);

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b5c10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ob-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('b5c10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ob-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('b5c10000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ob-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('b5c10000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ob-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider (B only)","org_type":"supervisor"}', now(), now()),
  ('b5c10000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ob-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('b5c20000-0000-0000-0000-00000000000a', '觀察事項權責測試案 A', '機關', '廠商', '監造',
   'b5c10000-0000-0000-0000-000000000005'),
  ('b5c20000-0000-0000-0000-00000000000b', '觀察事項權責測試案 B', '機關', '廠商', '監造',
   'b5c10000-0000-0000-0000-000000000004');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('b5c20000-0000-0000-0000-00000000000a', 'b5c10000-0000-0000-0000-000000000001', 'member'),
  ('b5c20000-0000-0000-0000-00000000000a', 'b5c10000-0000-0000-0000-000000000002', 'member'),
  ('b5c20000-0000-0000-0000-00000000000a', 'b5c10000-0000-0000-0000-000000000003', 'member'),
  ('b5c20000-0000-0000-0000-00000000000a', 'b5c10000-0000-0000-0000-000000000005', 'admin'),
  ('b5c20000-0000-0000-0000-00000000000b', 'b5c10000-0000-0000-0000-000000000004', 'admin');

-- A 案一筆監造提出的觀察;B 案一筆(供跨案不可見對照)
insert into public.observations (id, project_id, title, location, assigned_to, status, created_by) values
  ('b5c30000-0000-0000-0000-000000000001', 'b5c20000-0000-0000-0000-00000000000a',
   '基礎鋼筋保護層不足', '基礎 F1', 'contractor', '待處理', 'b5c10000-0000-0000-0000-000000000002'),
  ('b5c30000-0000-0000-0000-000000000002', 'b5c20000-0000-0000-0000-00000000000b',
   'B 案觀察', null, 'contractor', '待處理', 'b5c10000-0000-0000-0000-000000000004');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 可見範圍 ─────────────────────────────────────────────────────────────────
select pg_temp.become('b5c10000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from public.observations), 1,
  '廠商只看得到本案觀察(A 案 1 筆,B 案不可見)');
reset role;
select pg_temp.become('b5c10000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.observations
  where project_id = 'b5c20000-0000-0000-0000-00000000000a'), 1, '監造看得到本案觀察');
reset role;
select pg_temp.become('b5c10000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.observations
  where project_id = 'b5c20000-0000-0000-0000-00000000000a'), 1, '機關看得到本案觀察(監督用)');
reset role;
select pg_temp.become('b5c10000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.observations
  where project_id = 'b5c20000-0000-0000-0000-00000000000a'), 0, 'B 案成員看不到 A 案觀察');
reset role;

-- ── 監造提出、廠商回應 ────────────────────────────────────────────────────────
select pg_temp.become('b5c10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ insert into public.observations (project_id, title, assigned_to, created_by)
  values ('b5c20000-0000-0000-0000-00000000000a', '模板支撐間距過大', 'contractor', 'b5c10000-0000-0000-0000-000000000002') $$,
  '監造可提出觀察事項');
reset role;
select pg_temp.become('b5c10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ update public.observations set status = '已處理'
  where id = 'b5c30000-0000-0000-0000-000000000001' $$, '廠商可把指派給自己的觀察標為已處理');
reset role;

-- ── 機關唯讀 ─────────────────────────────────────────────────────────────────
select pg_temp.become('b5c10000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$ insert into public.observations (project_id, title, assigned_to)
  values ('b5c20000-0000-0000-0000-00000000000a', '機關加的', 'contractor') $$,
  '42501', null, '機關不可直接新增觀察(機關走查驗/缺失正式管道,不參與輕量協作)');
update public.observations set status = '轉缺失' where id = 'b5c30000-0000-0000-0000-000000000001';
select is((select status from public.observations where id = 'b5c30000-0000-0000-0000-000000000001'),
  '已處理', '機關 UPDATE 命中 0 列:狀態未被改寫');
delete from public.observations where id = 'b5c30000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.observations where id = 'b5c30000-0000-0000-0000-000000000001'), 1,
  '機關 DELETE 命中 0 列:觀察仍在');
reset role;

-- ── 非成員 ───────────────────────────────────────────────────────────────────
select pg_temp.become('b5c10000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ insert into public.observations (project_id, title, assigned_to)
  values ('b5c20000-0000-0000-0000-00000000000a', '外人塞的', 'contractor') $$,
  '42501', null, '非成員不可對 A 案寫入觀察');
update public.observations set title = '外人改的' where id = 'b5c30000-0000-0000-0000-000000000001';
delete from public.observations where project_id = 'b5c20000-0000-0000-0000-00000000000a';
reset role;  -- 非成員本來就看不到這些列,讀回驗證要以 superuser 做
select is((select title from public.observations where id = 'b5c30000-0000-0000-0000-000000000001'),
  '基礎鋼筋保護層不足', '非成員 UPDATE 命中 0 列');
select is((select count(*)::int from public.observations where project_id = 'b5c20000-0000-0000-0000-00000000000a'), 2,
  '非成員 DELETE 命中 0 列:A 案兩筆觀察都在');

select * from finish();
rollback;
