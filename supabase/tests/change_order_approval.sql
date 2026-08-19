-- 變更設計三段流程(pgTAP):核准/駁回=機關專屬,監造只做受理審查/退回,
-- 核准前必經審核中(D-016;W8-5 真人驗收 O-3/O-4/ISSUE-8)。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
-- 對應 migration 20260819111252_change_order_approval_owner_only.sql。
begin;

select plan(13);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_trigger('public', 'change_orders', 'change_orders_guard', '變更設計 guard trigger 掛上');

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
-- 建立者(admin)獨立一人:三個角色使用者都是 member,非正式模式下 admin_override
-- 只對建立者成立,角色紅線測試不被管理者例外污染。
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'co-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'co-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'co-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'co-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('41000000-0000-0000-0000-000000000001', '變更設計權責測試案', '機關', '廠商', '監造',
        'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('41000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'member'),
  ('41000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'member'),
  ('41000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3', 'member'),
  ('41000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- 各測試各用一筆,避免一條鏈失敗連鎖污染後面的斷言
insert into public.change_orders (id, project_id, co_no, title, status) values
  ('42000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','CO-A','受理鏈','提出'),
  ('42000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001','CO-B','核准鏈','審核中'),
  ('42000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000001','CO-C','駁回鏈','審核中'),
  ('42000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000001','CO-D','管理者例外','提出');

-- ── 監造:受理審查/退回可,核准不可 ────────────────────────────────────────────
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2');
select lives_ok($$ update public.change_orders set status = '審核中'
  where id = '42000000-0000-0000-0000-000000000001' $$,
  '監造可受理審查(提出→審核中)');
select throws_ok($$ update public.change_orders set status = '核准'
  where id = '42000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '監造不可核准變更設計(核准=機關專屬)');
select lives_ok($$ update public.change_orders set status = '提出'
  where id = '42000000-0000-0000-0000-000000000001' $$,
  '監造可退回(審核中→提出)');

-- ── 廠商:不可自行推進流程 ────────────────────────────────────────────────────
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1');
select throws_ok($$ update public.change_orders set status = '審核中'
  where id = '42000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商不可受理審查(提出→審核中)');

-- ── 機關:核准必經審核中;審核中可核准/駁回 ──────────────────────────────────
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3');
select throws_ok($$ update public.change_orders set status = '核准'
  where id = '42000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '機關不可從提出直接核准(須先經監造受理審查)');
select lives_ok($$ update public.change_orders set status = '核准'
  where id = '42000000-0000-0000-0000-000000000002' $$,
  '機關可核准審核中的變更');

-- ── 撤銷已核准:僅機關 ────────────────────────────────────────────────────────
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2');
select throws_ok($$ update public.change_orders set status = '審核中'
  where id = '42000000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '監造不可撤銷已核准的變更');
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3');
select lives_ok($$ update public.change_orders set status = '審核中'
  where id = '42000000-0000-0000-0000-000000000002' $$,
  '機關可撤銷核准(核准→審核中)');

-- ── 駁回與駁回後 ─────────────────────────────────────────────────────────────
select lives_ok($$ update public.change_orders set status = '駁回'
  where id = '42000000-0000-0000-0000-000000000003' $$,
  '機關可駁回審核中的變更');
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1');
select throws_ok($$ update public.change_orders set status = '提出'
  where id = '42000000-0000-0000-0000-000000000003' $$, 'P0001', null,
  '廠商不可自行把駁回改回提出(離開駁回=機關專屬)');

-- ── 迴歸:非正式模式的管理者例外照舊(試用行為不變)────────────────────────────
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5');
select lives_ok($$ update public.change_orders set status = '核准'
  where id = '42000000-0000-0000-0000-000000000004' $$,
  '非正式模式:專案管理者仍可直接核准(admin_override)');
select is(
  (select status from public.change_orders where id = '42000000-0000-0000-0000-000000000002'),
  '審核中', '撤銷後狀態確實回到審核中');

select * from finish();
rollback;
