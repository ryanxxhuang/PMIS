-- 標單重設/匯入原子化(pgTAP)——W1 P0-01/P0-02 驗收。
-- 對應 migration 20260812000200_boq_atomic_reset_import.sql。
-- 核心主張:
--   1. reset_project_boq / import_work_items 全成或全敗;任一子表被證據 guard
--      擋下時,所有表(特別是沒 guard 的 daily_logs)維持原狀——不再半刪。
--   2. 權限沿用 can_write:機關成員與非成員不可匯入/清空。
--   3. 匯入只進空專案;壞 payload(重複鍵/缺父項)整包拒收,重試可成功。
-- 執行:本地 supabase(colima)+容器內 psql;整份交易內執行並 rollback。
begin;

select plan(48);

-- ── 結構與授權面 ────────────────────────────────────────────────────────────
select has_function('public', 'reset_project_boq', array['uuid'], 'reset RPC 存在');
select has_function('public', 'import_work_items', array['uuid','jsonb'], 'import RPC 存在');
select is(has_function_privilege('anon', 'public.reset_project_boq(uuid)', 'execute'), false, 'anon 不可執行 reset');
select is(has_function_privilege('anon', 'public.import_work_items(uuid, jsonb)', 'execute'), false, 'anon 不可執行 import');
select is(has_function_privilege('authenticated', 'public.reset_project_boq(uuid)', 'execute'), true, 'authenticated 可執行 reset');
select is(has_function_privilege('authenticated', 'public.import_work_items(uuid, jsonb)', 'execute'), true, 'authenticated 可執行 import');

-- ── 測試資料:三方成員 + 管理者(建立者) + 非成員 ─────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('bb000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'boq-con@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('bb000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'boq-sup@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('bb000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'boq-own@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('bb000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'boq-adm@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now()),
  ('bb000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'boq-out@example.test', '', now(), '{}',
   '{"full_name":"Outsider","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by) values
  ('bb100000-0000-0000-0000-000000000001', '標單原子化測試案A', '機關', '廠商', '監造',
   'bb000000-0000-0000-0000-000000000005'),
  ('bb100000-0000-0000-0000-000000000002', '標單原子化測試案B', '機關', '廠商', '監造',
   'bb000000-0000-0000-0000-000000000005');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('bb100000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'member'),
  ('bb100000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000002', 'member'),
  ('bb100000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000003', 'member'),
  ('bb100000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000005', 'admin'),
  ('bb100000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-000000000001', 'member'),
  ('bb100000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-000000000003', 'member'),
  ('bb100000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-000000000005', 'admin');

-- 模擬登入者(同時設新舊兩種 claim 形式,相容不同版本的 auth.uid())
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $fn$;

-- 標單 payload(與前端 importWorkItems 的 p_items 同形狀)
create or replace function pg_temp.good_payload() returns jsonb language sql as $fn$
  select '[
    {"item_key":"1","parent_key":null,"item_no":"壹","description":"第一章","is_rollup":true,"sort_order":1,"depth":1},
    {"item_key":"1.1","parent_key":"1","item_no":"一","description":"假設工程","unit":"式","quantity":1,"unit_price":100,"amount":100,"is_leaf":true,"sort_order":2,"depth":2},
    {"item_key":"1.2","parent_key":"1","item_no":"二","description":"結構工程","unit":"式","quantity":2,"unit_price":50,"amount":100,"is_leaf":true,"is_billable":false,"sort_order":3,"depth":2},
    {"item_key":"2","parent_key":null,"item_no":"貳","description":"第二章","is_rollup":true,"sort_order":4,"depth":1}
  ]'::jsonb
$fn$;
create or replace function pg_temp.small_payload() returns jsonb language sql as $fn$
  select '[
    {"item_key":"1","parent_key":null,"description":"第一章","is_rollup":true,"sort_order":1},
    {"item_key":"1.1","parent_key":"1","description":"假設工程","quantity":1,"is_leaf":true,"sort_order":2}
  ]'::jsonb
$fn$;

-- ── 匯入:成功路徑(廠商成員,案A) ────────────────────────────────────────────
select pg_temp.become('bb000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.import_work_items('bb100000-0000-0000-0000-000000000001', pg_temp.good_payload()) $$,
  '廠商成員可原子匯入標單');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001'), 4,
  '案A 匯入 4 項');
select is(
  (select parent_id from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001' and item_key = '1.1'),
  (select id from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001' and item_key = '1'),
  '父子關係由伺服器依 parent_key 回填');
select ok(
  (select parent_id from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001' and item_key = '1') is null,
  '根節點 parent_id 為 null');
select is(
  (select is_billable from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001' and item_key = '1.1'),
  true, 'payload 缺 is_billable 時吃欄位預設 true(coalesce)');
select is((select count(*)::int from public.audit_events
  where project_id = 'bb100000-0000-0000-0000-000000000001' and event_type = 'boq.imported'), 1,
  '匯入留一筆稽核事件');

-- ── 匯入:重複匯入被擋(兩份標單不可混在一起) ─────────────────────────────────
select throws_ok($$ select public.import_work_items('bb100000-0000-0000-0000-000000000001', pg_temp.good_payload()) $$,
  'P0001', '此專案已有標單工項,請先清空重匯', '非空專案不可再匯入');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001'), 4,
  '被擋後案A 仍是原本 4 項');

-- ── 匯入:權限(案B) ─────────────────────────────────────────────────────────
select pg_temp.become('bb000000-0000-0000-0000-000000000006');
select throws_ok($$ select public.import_work_items('bb100000-0000-0000-0000-000000000002', pg_temp.good_payload()) $$,
  'P0001', '此帳號無權匯入標單工項', '非成員不可匯入');
select pg_temp.become('bb000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.import_work_items('bb100000-0000-0000-0000-000000000002', pg_temp.good_payload()) $$,
  'P0001', '此帳號無權匯入標單工項', '機關成員不可匯入(can_write 對齊 RLS)');
select pg_temp.become(null);
select throws_ok($$ select public.import_work_items('bb100000-0000-0000-0000-000000000002', pg_temp.good_payload()) $$,
  'P0001', 'not authenticated', '未登入不可匯入');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000002'), 0,
  '案B 仍為空');

-- ── 匯入:壞 payload 整包拒收,重試可成功(案B,廠商成員) ───────────────────────
select pg_temp.become('bb000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.import_work_items('bb100000-0000-0000-0000-000000000002',
  '[{"item_key":"8","description":"孤兒測試","sort_order":1},
    {"item_key":"9.1","parent_key":"9","description":"缺父項","sort_order":2}]'::jsonb) $$,
  'P0001', '標單資料的父項不存在:9', '缺父項整包拒收(舊行為是靜默當根節點)');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000002'), 0,
  '缺父項拒收後案B 仍為空(全敗如未匯)');
select throws_ok($$ select public.import_work_items('bb100000-0000-0000-0000-000000000002',
  '[{"item_key":"1","description":"重複一","sort_order":1},
    {"item_key":"1","description":"重複二","sort_order":2}]'::jsonb) $$,
  'P0001', '標單資料的項次鍵重複:1', '重複項次鍵整包拒收(舊行為是撞主鍵半途爆)');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000002'), 0,
  '重複鍵拒收後案B 仍為空');
select throws_ok($$ select public.import_work_items('bb100000-0000-0000-0000-000000000002', '[]'::jsonb) $$,
  'P0001', '匯入內容是空的,請重新選擇標單 XML', '空陣列拒收');
select lives_ok($$ select public.import_work_items('bb100000-0000-0000-0000-000000000002', pg_temp.small_payload()) $$,
  '失敗後重試可成功(P0-02 驗收)');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000002'), 2,
  '案B 重試後 2 項');

-- ── 重設:成功路徑(案A 有日誌/估驗/查驗/進度/缺失) ───────────────────────────
select pg_temp.become(null); -- 以 service 身分佈置履約資料(繞過 guard)
insert into public.daily_logs (id, project_id, log_date, work_summary)
  values ('bb300000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', current_date, '模板組立');
insert into public.daily_log_items (daily_log_id, work_item_id, qty_today)
  values ('bb300000-0000-0000-0000-000000000001',
    (select id from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001' and item_key = '1.1'), 0.5);
insert into public.schedule_periods (project_id, period_label, planned_pct)
  values ('bb100000-0000-0000-0000-000000000001', '2026-08', 10);
insert into public.valuations (id, project_id, period_no, status)
  values ('bb400000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', 1, '草稿');
insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('bb400000-0000-0000-0000-000000000001',
    (select id from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001' and item_key = '1.1'), 0.5);
insert into public.inspections (project_id, title)
  values ('bb100000-0000-0000-0000-000000000001', '模板查驗');
insert into public.defects (project_id, work_item_id, title)
  values ('bb100000-0000-0000-0000-000000000001',
    (select id from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001' and item_key = '1.1'), '模板汙損');

select pg_temp.become('bb000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.reset_project_boq('bb100000-0000-0000-0000-000000000001') $$,
  '廠商成員可原子清空(草稿估驗/待查驗/日誌/進度)');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001'), 0, '工項清空');
select is((select count(*)::int from public.daily_logs where project_id = 'bb100000-0000-0000-0000-000000000001'), 0, '日誌清空');
select is((select count(*)::int from public.valuations where project_id = 'bb100000-0000-0000-0000-000000000001'), 0, '估驗清空');
select is((select count(*)::int from public.inspections where project_id = 'bb100000-0000-0000-0000-000000000001'), 0, '查驗清空');
select is((select count(*)::int from public.schedule_periods where project_id = 'bb100000-0000-0000-0000-000000000001'), 0, '進度清空');
select is((select count(*)::int from public.defects
  where project_id = 'bb100000-0000-0000-0000-000000000001' and work_item_id is null), 1,
  '缺失不刪,只解除工項連結(FK set null)');
select is((select count(*)::int from public.audit_events
  where project_id = 'bb100000-0000-0000-0000-000000000001' and event_type = 'boq.reset'), 1,
  '重設留一筆稽核事件');

-- ── 重設:原子性——品質證據 guard 擋下時,連沒 guard 的 daily_logs 都不能少 ─────
-- (P0-01 的災難情境:舊前端會把日誌刪光、工項刪不掉、畫面說成功)
select pg_temp.become(null);
insert into public.work_items (id, project_id, item_key, description, sort_order) values
  ('bb200000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', '1', '重佈章節', 1),
  ('bb200000-0000-0000-0000-000000000002', 'bb100000-0000-0000-0000-000000000001', '1.1', '重佈工項', 2);
update public.work_items set parent_id = 'bb200000-0000-0000-0000-000000000001'
  where id = 'bb200000-0000-0000-0000-000000000002';
insert into public.daily_logs (id, project_id, log_date, work_summary)
  values ('bb300000-0000-0000-0000-000000000002', 'bb100000-0000-0000-0000-000000000001', current_date, '重佈日誌');
insert into public.checklist_records (id, project_id, check_date, work_item_id)
  values ('bb500000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001', current_date,
          'bb200000-0000-0000-0000-000000000002');

select pg_temp.become('bb000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.reset_project_boq('bb100000-0000-0000-0000-000000000001') $$,
  'P0001', null, '品質檢查紀錄連著工項時,登入者清空被 guard 擋下');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001'), 2,
  '被擋後工項原封不動');
select is((select count(*)::int from public.daily_logs where project_id = 'bb100000-0000-0000-0000-000000000001'), 1,
  '被擋後日誌原封不動(不再半刪——P0-01 驗收核心)');

select pg_temp.become(null);
delete from public.checklist_records where id = 'bb500000-0000-0000-0000-000000000001';
select pg_temp.become('bb000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.reset_project_boq('bb100000-0000-0000-0000-000000000001') $$,
  '排除品質證據後重試成功');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000001'), 0,
  '重試後工項清空');
select is((select count(*)::int from public.daily_logs where project_id = 'bb100000-0000-0000-0000-000000000001'), 0,
  '重試後日誌清空');

-- ── 重設:原子性——已核定估驗擋一般成員;管理者(非正式模式)可整案重設 ───────────
select pg_temp.become(null);
insert into public.valuations (id, project_id, period_no, status)
  values ('bb400000-0000-0000-0000-000000000002', 'bb100000-0000-0000-0000-000000000002', 1, '已核定');
insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('bb400000-0000-0000-0000-000000000002',
    (select id from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000002' and item_key = '1.1'), 1);

select pg_temp.become('bb000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.reset_project_boq('bb100000-0000-0000-0000-000000000002') $$,
  'P0001', null, '已核定估驗擋一般廠商成員清空');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000002'), 2,
  '被擋後案B 工項原封不動');
select is((select count(*)::int from public.valuations where project_id = 'bb100000-0000-0000-0000-000000000002'), 1,
  '被擋後案B 估驗原封不動');
select pg_temp.become('bb000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.reset_project_boq('bb100000-0000-0000-0000-000000000002') $$,
  '管理者(非正式模式 admin_override)可含已核定估驗整案重設');
select is((select count(*)::int from public.work_items where project_id = 'bb100000-0000-0000-0000-000000000002'), 0,
  '管理者重設後案B 清空');

-- ── 重設:權限 ───────────────────────────────────────────────────────────────
select pg_temp.become('bb000000-0000-0000-0000-000000000006');
select throws_ok($$ select public.reset_project_boq('bb100000-0000-0000-0000-000000000001') $$,
  'P0001', '此帳號無權清空此專案的標單資料', '非成員不可清空');
select pg_temp.become('bb000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.reset_project_boq('bb100000-0000-0000-0000-000000000001') $$,
  'P0001', '此帳號無權清空此專案的標單資料', '機關成員不可清空');

-- ── 迴歸:新 RPC 與 guard 不得害專案刪不掉 ───────────────────────────────────
select pg_temp.become('bb000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.delete_project('bb100000-0000-0000-0000-000000000001') $$,
  '含稽核事件與缺失的專案,管理者仍可整案刪除');
select is((select count(*)::int from public.projects where id = 'bb100000-0000-0000-0000-000000000001'), 0,
  '專案確實刪除');

select * from finish();
rollback;
