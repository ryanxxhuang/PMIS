-- RFI 角色狀態機(pgTAP):廠商提問、監造回覆、廠商確認結案的權限矩陣。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
-- 對應 migration 20260711000000_baseline.sql(rfis 表/RLS/rfis_guard)、
--   20260712001300_formal_mode.sql(rfis_guard 現行定義:admin_override)、
--   20260712001600_evidence_guards.sql(rfis_delete_guard)、
--   20260822000100_rfi_answered_state_guard.sql(兩步繞過修補:洗狀態→刪除)。
-- 為什麼獨立成檔:RFI 是唯一「guard 只被 formal_mode 的 admin 例外測過」的業務鏈,
--   核心風險(廠商偽造監造正式回覆)若因 my_org_type()/rfis_guard 改動而失守,
--   既有測試不會發現;此檔把角色矩陣釘住。
-- 專案開 formal_mode:排除 admin_override 干擾,單純測 org_type 的角色規則。
begin;

select plan(20);

-- ── 結構:guard 掛著才有資格談規則 ───────────────────────────────────────────
select has_trigger('public', 'rfis', 'rfis_guard', 'RFI 回覆 guard 掛上');
select has_trigger('public', 'rfis', 'rfis_delete_guard', 'RFI 刪除防護掛上');

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rf-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rf-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rf-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rf-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode)
values ('26000000-0000-0000-0000-000000000001', 'RFI 流程測試案', '機關', '廠商', '監造',
        'cccccccc-cccc-cccc-cccc-ccccccccccc5', true);
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('26000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'member'),
  ('26000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-ccccccccccc2', 'member'),
  ('26000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-ccccccccccc3', 'member'),
  ('26000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-ccccccccccc5', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 廠商提問(guard 只管回覆,不管提問) ───────────────────────────────────────
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc1');
select lives_ok($$ insert into public.rfis (id, project_id, rfi_no, title, question, status) values
  ('36000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000001',
   'RFI-F01', '樑柱接頭套管衝突', '套管與主筋衝突,請釋疑', '待回覆') $$,
  '廠商可提出疑義');
select lives_ok($$ update public.rfis
  set question = '套管與主筋衝突,請釋疑(補充圖號 S-301)', due_date = '2026-09-01'
  where id = '36000000-0000-0000-0000-000000000001' $$,
  '廠商可修改自己的提問內容(非回覆欄位)');

-- ── 偽造回覆:answer 與「→已回覆」兩條路都要擋 ───────────────────────────────
select throws_ok($$ update public.rfis set answer = '自問自答:可調整套管位置'
  where id = '36000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商不可自行填回覆(偽造監造回覆)');
select throws_ok($$ update public.rfis set status = '已回覆'
  where id = '36000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商不可只改狀態為已回覆(空回覆也是偽造)');

-- 機關同樣不是回覆方:guard 層擋(superuser 繞過 RLS,直接驗 trigger)
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc3');
select throws_ok($$ update public.rfis set answer = '機關代答'
  where id = '36000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '機關不可代監造回覆(guard 層)');
-- RLS 層再擋一次:正式模式機關唯讀(can_write),update 0 列生效
set local role authenticated;
update public.rfis set answer = '機關代答(RLS)'
  where id = '36000000-0000-0000-0000-000000000001';
reset role;
select is(
  (select answer from public.rfis where id = '36000000-0000-0000-0000-000000000001'),
  null, '機關在 RLS 層也寫不進回覆(0 列生效)');

-- ── 監造正式回覆 ─────────────────────────────────────────────────────────────
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc2');
select lives_ok($$ update public.rfis
  set answer = '依建築師釋疑,套管可平移 5cm,主筋不得切斷', status = '已回覆', answered_date = '2026-08-21'
  where id = '36000000-0000-0000-0000-000000000001' $$,
  '監造可正式回覆');
select is(
  (select status from public.rfis where id = '36000000-0000-0000-0000-000000000001'),
  '已回覆', '回覆狀態持久化');

-- ── 回覆後:回覆內容只有監造可動,廠商只剩確認結案 ────────────────────────────
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc1');
select throws_ok($$ update public.rfis set answer = '(被竄改)套管可任意調整'
  where id = '36000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商不可竄改監造已送出的回覆');

select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc2');
select lives_ok($$ update public.rfis
  set answer = '依建築師釋疑,套管可平移 5cm,主筋不得切斷(補充:完成面需復原)'
  where id = '36000000-0000-0000-0000-000000000001' $$,
  '監造可補充/更正自己的回覆');

select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc1');
select lives_ok($$ update public.rfis set status = '已結案'
  where id = '36000000-0000-0000-0000-000000000001' $$,
  '廠商可確認結案(已回覆→已結案是廠商的球)');
select throws_ok($$ update public.rfis set status = '已回覆'
  where id = '36000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商不可把已結案改回已回覆(重開=回覆狀態異動,監造的權)');

-- ── 撤回:未回覆可刪;已回覆不可刪已在 evidence_guards 覆蓋,不重測 ─────────────
insert into public.rfis (id, project_id, rfi_no, title, status) values
  ('36000000-0000-0000-0000-000000000002','26000000-0000-0000-0000-000000000001',
   'RFI-F02', '誤發疑義', '待回覆');
select lives_ok($$ delete from public.rfis where id = '36000000-0000-0000-0000-000000000002' $$,
  '廠商可撤回尚未回覆的疑義');

-- ── 兩步繞過刪除防護:洗狀態→刪除,兩步各自都要擋(20260822000100) ─────────────
-- 修補前:rfis_guard 放行「已回覆/已結案→待回覆」(answer 不動),rfis_delete_guard
-- 見待回覆即放行——廠商兩步就能刪掉監造正式回覆。此段把兩步各自釘死,
-- 刻意不把任何一步寫成 lives_ok,避免固化漏洞。
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc1');
select throws_ok($$ update public.rfis set status = '待回覆'
  where id = '36000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商不可把已結案洗回待回覆(繞過刪除防護的第一步)');

insert into public.rfis (id, project_id, rfi_no, title, question, status) values
  ('36000000-0000-0000-0000-000000000003','26000000-0000-0000-0000-000000000001',
   'RFI-F03', '管溝回填級配疑義', '級配料源變更是否需重新送審', '待回覆');
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc2');
update public.rfis set answer = '依施工規範 02320,料源變更應重新送審', status = '已回覆'
  where id = '36000000-0000-0000-0000-000000000003';

select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc1');
select throws_ok($$ update public.rfis set status = '待回覆'
  where id = '36000000-0000-0000-0000-000000000003' $$, 'P0001', null,
  '廠商不可把已回覆洗回待回覆(繞過刪除防護的第一步)');

-- 監造可退回狀態(重新研議);但回覆仍在,狀態洗白也擋不住 answer 判準
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc2');
select lives_ok($$ update public.rfis set status = '待回覆'
  where id = '36000000-0000-0000-0000-000000000003' $$,
  '監造可把已回覆退回待回覆(重新研議是監造的權)');
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc1');
select throws_ok($$ delete from public.rfis where id = '36000000-0000-0000-0000-000000000003' $$,
  'P0001', null,
  '狀態雖是待回覆,監造回覆仍在(answer 非空)就不可刪(第二步也擋)');

-- 監造撤回回覆(answer 清空)後,廠商才回到可撤回的原點——防護不留死路
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc2');
update public.rfis set answer = null
  where id = '36000000-0000-0000-0000-000000000003';
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc1');
select lives_ok($$ delete from public.rfis where id = '36000000-0000-0000-0000-000000000003' $$,
  '監造撤回回覆後,廠商可撤回疑義');

select * from finish();
rollback;
