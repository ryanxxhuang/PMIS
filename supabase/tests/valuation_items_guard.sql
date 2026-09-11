-- valuation_items 核定凍結與三方權責(pgTAP):估驗明細=本期/累計數量與金額,是請款的
-- 底稿。valuation_items_guard(baseline + 20260712001300)在估驗「已核定」後凍結明細
-- (監造例外:核定後可修正;非正式模式管理者例外),此前沒有任何測試釘住——guard 壞掉
-- =核定後的請款金額可被改寫。另釘 RLS:機關唯讀、非成員不可見。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
begin;

select plan(11);

select has_trigger('public', 'valuation_items', 'valuation_items_guard', '已核定估驗明細凍結 guard 掛上');

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b5d10000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('b5d10000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('b5d10000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('b5d10000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider (no project)","org_type":"contractor"}', now(), now()),
  ('b5d10000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vi-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('b5d20000-0000-0000-0000-00000000000a', '估驗明細凍結測試案', '機關', '廠商', '監造',
        'b5d10000-0000-0000-0000-000000000005');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('b5d20000-0000-0000-0000-00000000000a', 'b5d10000-0000-0000-0000-000000000001', 'member'),
  ('b5d20000-0000-0000-0000-00000000000a', 'b5d10000-0000-0000-0000-000000000002', 'member'),
  ('b5d20000-0000-0000-0000-00000000000a', 'b5d10000-0000-0000-0000-000000000003', 'member'),
  ('b5d20000-0000-0000-0000-00000000000a', 'b5d10000-0000-0000-0000-000000000005', 'admin');

insert into public.work_items (id, project_id, description, unit, quantity, unit_price, is_leaf) values
  ('b5d30000-0000-0000-0000-000000000001', 'b5d20000-0000-0000-0000-00000000000a', '鋼筋', 'kg', 10000, 30, true),
  ('b5d30000-0000-0000-0000-000000000002', 'b5d20000-0000-0000-0000-00000000000a', '混凝土', 'm3', 500, 3000, true);

-- 第 1 期草稿(可編)、第 2 期已核定(凍結);明細由 superuser 直插(auth.uid() null → guard 放行)
insert into public.valuations (id, project_id, period_no, status) values
  ('b5d40000-0000-0000-0000-000000000001', 'b5d20000-0000-0000-0000-00000000000a', 1, '草稿'),
  ('b5d40000-0000-0000-0000-000000000002', 'b5d20000-0000-0000-0000-00000000000a', 2, '已核定');
insert into public.valuation_items (id, valuation_id, work_item_id, cum_qty, amount_cum) values
  ('b5d50000-0000-0000-0000-000000000001', 'b5d40000-0000-0000-0000-000000000001',
   'b5d30000-0000-0000-0000-000000000001', 2000, 60000),
  ('b5d50000-0000-0000-0000-000000000002', 'b5d40000-0000-0000-0000-000000000002',
   'b5d30000-0000-0000-0000-000000000001', 5000, 150000);

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 可見範圍 ─────────────────────────────────────────────────────────────────
select pg_temp.become('b5d10000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.valuation_items), 2,
  '機關看得到兩期估驗明細(撥款前要核對數量與金額)');
reset role;
select pg_temp.become('b5d10000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.valuation_items), 0, '非成員看不到任何估驗明細');
reset role;

-- ── 草稿可編;已核定凍結 ────────────────────────────────────────────────────
select pg_temp.become('b5d10000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ update public.valuation_items set cum_qty = 2500, amount_cum = 75000
  where id = 'b5d50000-0000-0000-0000-000000000001' $$, '廠商可修改草稿估驗的明細');
select throws_ok($$ update public.valuation_items set cum_qty = 9000, amount_cum = 270000
  where id = 'b5d50000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '已核定估驗的明細不可再改數量(改了=請款金額失真)');
select throws_ok($$ insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('b5d40000-0000-0000-0000-000000000002', 'b5d30000-0000-0000-0000-000000000002', 100) $$,
  'P0001', null, '已核定估驗不可事後追加明細');
select throws_ok($$ delete from public.valuation_items where id = 'b5d50000-0000-0000-0000-000000000002' $$,
  'P0001', null, '已核定估驗的明細不可刪除');
reset role;

-- 監造例外:核定後仍可修正明細(guard 明文放行;退回重編的替代路徑)
select pg_temp.become('b5d10000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$ update public.valuation_items set note = '監造核定後更正'
  where id = 'b5d50000-0000-0000-0000-000000000002' $$, '監造可在核定後修正明細(guard 的監造例外)');
reset role;

-- ── 機關唯讀:連草稿期的也不能改 ──────────────────────────────────────────────
select pg_temp.become('b5d10000-0000-0000-0000-000000000003');
set local role authenticated;
update public.valuation_items set cum_qty = 1 where id = 'b5d50000-0000-0000-0000-000000000001';
select is((select cum_qty from public.valuation_items where id = 'b5d50000-0000-0000-0000-000000000001'),
  2500::numeric, '機關 UPDATE 命中 0 列:估驗數量不可由機關改寫');
reset role;

-- ── 管理者例外只在非正式模式 ──────────────────────────────────────────────
select pg_temp.become('b5d10000-0000-0000-0000-000000000005');
set local role authenticated;
select lives_ok($$ update public.valuation_items set note = '試用期管理者修正'
  where id = 'b5d50000-0000-0000-0000-000000000002' $$,
  '非正式模式:專案管理者仍可修正已核定明細(admin_override,試用行為不變)');
reset role;

select pg_temp.become(null);
update public.projects set formal_mode = true where id = 'b5d20000-0000-0000-0000-00000000000a';

select pg_temp.become('b5d10000-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$ update public.valuation_items set note = '正式模式偷改'
  where id = 'b5d50000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '正式模式:已核定明細對專案管理者也凍結');
reset role;

select * from finish();
rollback;
