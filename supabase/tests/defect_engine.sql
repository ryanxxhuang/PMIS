-- 統一缺失引擎(pgTAP):品質/工安缺失共用一套狀態機+改善流程+稽核。
-- 對應 migration 20260712001400_unified_defect_engine.sql。
-- 規則:狀態機 開立→改善中→待複查→已結案;跨越「已結案」=監造(admin_override 放行);
-- 已結案不可刪、更正必附原因(管理者也不例外);UPDATE/DELETE 留 defect_audits;
-- created_by 防冒名;domain/專案/建立者不可變更。
begin;

select plan(35);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_column('public', 'defects', 'domain', '缺失分類欄位存在(quality|safety)');
select has_column('public', 'defects', 'record_date', '發現日期欄位存在');
select has_column('public', 'defects', 'correction_reason', '更正原因欄位存在');
select has_table('public', 'defect_audits', '缺失稽核表存在');
select has_trigger('public', 'defects', 'defects_guard', 'guard trigger 掛上');
select has_trigger('public', 'defects', 'defects_audit', 'audit trigger 掛上');

-- ── 測試資料:三種 org 使用者 + 專案管理者(建立者,contractor org) ──────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('dddddddd-dddd-dddd-dddd-ddddddddddd1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'd-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'd-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'd-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'd-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('41000000-0000-0000-0000-000000000001', '缺失引擎測試案', '機關', '廠商', '監造',
        'dddddddd-dddd-dddd-dddd-ddddddddddd5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('41000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'member'),
  ('41000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'member'),
  ('41000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-ddddddddddd3', 'member'),
  ('41000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-ddddddddddd5', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 開立:兩個 domain、預設分類、防冒名、字彙 ─────────────────────────────────
select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd1');
select lives_ok($$ insert into public.defects (id, project_id, title, status)
  values ('51000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
          '鋼筋保護層不足','開立') $$, '廠商可開立品質缺失(未指定 domain)');
select is(
  (select domain from public.defects where id = '51000000-0000-0000-0000-000000000001'),
  'quality', '未指定 domain 預設為 quality');

insert into public.defects (id, project_id, title, status, created_by)
values ('51000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001',
        '模板支撐間距過大','開立','dddddddd-dddd-dddd-dddd-ddddddddddd3');
select is(
  (select created_by from public.defects where id = '51000000-0000-0000-0000-000000000002'),
  'dddddddd-dddd-dddd-dddd-ddddddddddd1'::uuid,
  'INSERT 的 created_by 一律強制為登錄者本人(不可冒名)');

select lives_ok($$ insert into public.defects
  (id, project_id, title, status, domain, severity, record_date, due_date)
  values ('51000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000001',
          '施工架未掛安全網','開立','safety','嚴重', current_date, current_date + 3) $$,
  '廠商可開立工安缺失(domain=safety,同一引擎)');

select throws_ok($$ insert into public.defects (project_id, title, status, domain)
  values ('41000000-0000-0000-0000-000000000001','分類錯誤','開立','finance') $$, '23514', null,
  'domain 僅限 quality|safety(check constraint)');
select throws_ok($$ insert into public.defects (project_id, title, status)
  values ('41000000-0000-0000-0000-000000000001','舊字彙','待改善') $$, 'P0001', null,
  '舊工安字彙(待改善)被統一狀態機拒絕');
select throws_ok($$ update public.defects set domain = 'safety'
  where id = '51000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '缺失分類(domain)不可變更');

-- ── 品質缺失流程:改善鏈=廠商,結案=監造 ─────────────────────────────────────
select lives_ok($$ update public.defects set status = '改善中'
  where id = '51000000-0000-0000-0000-000000000001' $$, '廠商可開始改善(開立→改善中)');
select lives_ok($$ update public.defects
  set status = '待複查', improvement_note = '已依規範補強保護層'
  where id = '51000000-0000-0000-0000-000000000001' $$, '廠商可提送複查(改善中→待複查)');
select throws_ok($$ update public.defects set status = '已結案'
  where id = '51000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商不可自行結案(結案僅監造)');

select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd2');
select lives_ok($$ update public.defects set status = '已結案', closed_at = now()
  where id = '51000000-0000-0000-0000-000000000001' $$, '監造可複查結案(待複查→已結案)');

-- ── 已結案保護:不可刪、更正必附原因、撤銷結案僅監造 ──────────────────────────
select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd1');
select throws_ok($$ update public.defects set description = '偷偷改'
  where id = '51000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '更正已結案缺失未附原因 → 拒絕');
select throws_ok($$ update public.defects
  set status = '改善中', correction_reason = '想撤銷結案'
  where id = '51000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商附原因也不可撤銷結案(跨越已結案=監造)');

select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd2');
select throws_ok($$ delete from public.defects
  where id = '51000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '已結案缺失不可刪除(監造也不行)');
select lives_ok($$ update public.defects
  set description = '補充結案依據', correction_reason = '結案說明補充'
  where id = '51000000-0000-0000-0000-000000000001' $$, '監造附原因可更正已結案缺失');
select is(
  (select count(*)::int from public.defect_audits
   where defect_id = '51000000-0000-0000-0000-000000000001' and action = 'correct'
     and reason = '結案說明補充'),
  1, '更正留下 correct 稽核列且含原因');

-- ── 工安缺失同一狀態機:改善鏈=廠商,結案=監造 ────────────────────────────────
select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd1');
select lives_ok($$ update public.defects
  set status = '待複查', improvement_note = '已補掛安全網'
  where id = '51000000-0000-0000-0000-000000000003' $$, '工安缺失同引擎:廠商改善後提送複查');
select throws_ok($$ update public.defects set status = '已結案'
  where id = '51000000-0000-0000-0000-000000000003' $$, 'P0001', null,
  '工安缺失也不可由廠商自行結案(統一狀態機)');

select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd2');
select lives_ok($$ update public.defects set status = '已結案', closed_at = now()
  where id = '51000000-0000-0000-0000-000000000003' $$, '工安缺失由監造複查結案');

select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd1');
select throws_ok($$ delete from public.defects
  where id = '51000000-0000-0000-0000-000000000003' $$, 'P0001', null,
  '已結案工安缺失不可刪除');

-- ── 未結案可刪(留 delete 稽核) ───────────────────────────────────────────────
select lives_ok($$ delete from public.defects
  where id = '51000000-0000-0000-0000-000000000002' $$, '未結案缺失可由本人刪除');
select is(
  (select count(*)::int from public.defect_audits
   where defect_id = '51000000-0000-0000-0000-000000000002' and action = 'delete'),
  1, '刪除留下 delete 稽核列');

-- ── 稽核表不可直寫 ───────────────────────────────────────────────────────────
set local role authenticated;
select throws_ok($$ insert into public.defect_audits
  (project_id, defect_id, action, domain, old_row)
  values ('41000000-0000-0000-0000-000000000001', gen_random_uuid(), 'correct', 'quality', '{}'::jsonb) $$,
  '42501', null, '登入者不可直接寫入缺失稽核表(僅 trigger 可寫)');
reset role;

-- ── 管理者放行(非正式模式):單人試用可全流程 ─────────────────────────────────
select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd5');
select lives_ok($$ insert into public.defects (id, project_id, title, status, domain)
  values ('51000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000001',
          '管理者開立','開立','safety') $$, '管理者可開立缺失');
select lives_ok($$ update public.defects set status = '已結案', closed_at = now()
  where id = '51000000-0000-0000-0000-000000000004' $$,
  '非正式模式的專案管理者可結案(admin_override)');

-- ── 回歸:guard 不得害專案刪不掉(cascade 放行) ────────────────────────────────
select lives_ok($$ select public.delete_project('41000000-0000-0000-0000-000000000001') $$,
  '含已結案缺失(兩個 domain)的專案,管理者仍可整案刪除');
select is(
  (select count(*)::int from public.projects where id = '41000000-0000-0000-0000-000000000001'),
  0, '專案確實刪除(cascade 未被 guard 擋下)');
select is(
  (select count(*)::int from public.defects where project_id = '41000000-0000-0000-0000-000000000001'),
  0, '缺失隨專案 cascade 清除');
select is(
  (select count(*)::int from public.defect_audits where project_id = '41000000-0000-0000-0000-000000000001'),
  0, '缺失稽核列隨專案 cascade 清除');

select * from finish();
rollback;
