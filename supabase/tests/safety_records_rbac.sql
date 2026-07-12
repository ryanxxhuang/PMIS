-- safety_records 三方資料權責矩陣(pgTAP)。
-- 執行方式:本地 supabase(colima)+psql,整份在交易內執行並 rollback。
-- 對應 migration 20260712000200_safety_records_rbac.sql / schema.sql「工安紀錄 RBAC」段。
begin;

select plan(33);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_table('public', 'safety_record_audits', 'audit 表存在');
select has_column('public', 'safety_records', 'correction_reason', '更正原因欄位存在');
select has_trigger('public', 'safety_records', 'safety_records_guard', 'guard trigger 掛上');
select has_trigger('public', 'safety_records', 'safety_records_audit', 'audit trigger 掛上');

-- ── 測試資料:三種 org 使用者 + 專案管理者(建立者,contractor org) ──────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('21000000-0000-0000-0000-000000000001', '工安測試案', '機關', '廠商', '監造',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('21000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'member'),
  ('21000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'member'),
  ('21000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', 'member'),
  ('21000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 矩陣:INSERT ──────────────────────────────────────────────────────────────
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
select lives_ok($$ insert into public.safety_records (id, project_id, record_type, title, status)
  values ('31000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',
          '自主檢查','用電設備自主檢查','待改善') $$, '廠商可建立自主檢查');
select lives_ok($$ insert into public.safety_records (id, project_id, record_type, title, status)
  values ('31000000-0000-0000-0000-000000000002','21000000-0000-0000-0000-000000000001',
          '工安缺失','施工架未掛安全網','待改善') $$, '廠商可建立工安缺失(改善紀錄)');
select throws_ok($$ insert into public.safety_records (project_id, record_type, title)
  values ('21000000-0000-0000-0000-000000000001','監造觀察','越權觀察') $$, 'P0001', null,
  '廠商不可建立監造事件');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2');
select lives_ok($$ insert into public.safety_records (id, project_id, record_type, title, status)
  values ('31000000-0000-0000-0000-000000000003','21000000-0000-0000-0000-000000000001',
          '監造觀察','高處作業未繫安全帶','已完成') $$, '監造可新增監造觀察');
select lives_ok($$ insert into public.safety_records (project_id, record_type, title, status)
  values ('21000000-0000-0000-0000-000000000001','監造查驗','施工架查驗','已完成') $$, '監造可新增監造查驗');
select lives_ok($$ insert into public.safety_records (project_id, record_type, title, status)
  values ('21000000-0000-0000-0000-000000000001','監造複查','安全網複查合格','已完成') $$, '監造可新增監造複查');
select throws_ok($$ insert into public.safety_records (project_id, record_type, title)
  values ('21000000-0000-0000-0000-000000000001','自主檢查','越權檢查') $$, 'P0001', null,
  '監造不可建立廠商的自主檢查');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3');
select throws_ok($$ insert into public.safety_records (project_id, record_type, title)
  values ('21000000-0000-0000-0000-000000000001','監造觀察','機關越權') $$, 'P0001', null,
  '機關唯讀:不可建立任何工安紀錄(監造類)');
select throws_ok($$ insert into public.safety_records (project_id, record_type, title)
  values ('21000000-0000-0000-0000-000000000001','教育訓練','機關越權') $$, 'P0001', null,
  '機關唯讀:不可建立任何工安紀錄(廠商類)');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
select throws_ok($$ insert into public.safety_records (project_id, record_type, title)
  values ('21000000-0000-0000-0000-000000000001','奇怪類型','x') $$, 'P0001', null,
  '未知類型一律拒絕');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5');
select lives_ok($$ insert into public.safety_records (project_id, record_type, title, status)
  values ('21000000-0000-0000-0000-000000000001','監造觀察','管理者代登','已完成') $$,
  '專案管理者放行類型矩陣(單人試用)');

-- ── created_by 防冒名 ────────────────────────────────────────────────────────
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
insert into public.safety_records (id, project_id, record_type, title, created_by)
values ('31000000-0000-0000-0000-000000000004','21000000-0000-0000-0000-000000000001',
        '危害告知','開挖區告知','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3');
select is(
  (select created_by from public.safety_records where id = '31000000-0000-0000-0000-000000000004'),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid,
  'INSERT 的 created_by 一律強制為登錄者本人(不可冒名)');

-- ── 他方原始紀錄保護 ─────────────────────────────────────────────────────────
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2');
select throws_ok($$ update public.safety_records set note = '監造改廠商的'
  where id = '31000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '監造不可改寫廠商原始紀錄');
select throws_ok($$ delete from public.safety_records
  where id = '31000000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '監造不可刪除廠商原始紀錄');
select lives_ok($$ update public.safety_records
  set note = '補充觀察細節', correction_reason = '補充現場細節說明'
  where id = '31000000-0000-0000-0000-000000000003' $$,
  '監造可附原因更正自己的已完成觀察(同方更正)');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
select throws_ok($$ update public.safety_records set note = '廠商改監造的'
  where id = '31000000-0000-0000-0000-000000000003' $$, 'P0001', null,
  '廠商不可改寫監造事件');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5');
select throws_ok($$ update public.safety_records set note = '管理者改監造的'
  where id = '31000000-0000-0000-0000-000000000003' $$, 'P0001', null,
  '專案管理者也不可改寫他方(監造)原始紀錄');

-- ── 身分欄位不可變更 ─────────────────────────────────────────────────────────
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
select throws_ok($$ update public.safety_records set record_type = '教育訓練'
  where id = '31000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '紀錄類型不可變更');

-- ── 已完成保護:不可刪、更正必附原因 ──────────────────────────────────────────
select lives_ok($$ update public.safety_records set status = '已完成'
  where id = '31000000-0000-0000-0000-000000000001' $$, '廠商可推進自己的狀態流程(→已完成)');
select throws_ok($$ delete from public.safety_records
  where id = '31000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '已完成紀錄不可刪除(建立者本人也不行)');
select throws_ok($$ update public.safety_records set note = '偷偷改'
  where id = '31000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '更正已完成紀錄未附原因 → 拒絕');
select lives_ok($$ update public.safety_records
  set note = '誤標完成,退回改善', status = '改善中', correction_reason = '誤標完成'
  where id = '31000000-0000-0000-0000-000000000001' $$, '附原因的更正成功(退回改善中)');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5');
select throws_ok($$ delete from public.safety_records
  where id = '31000000-0000-0000-0000-000000000003' $$, 'P0001', null,
  '已完成的監造事件連管理者也不可刪除');

-- ── 稽核 ─────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from public.safety_record_audits
   where safety_record_id = '31000000-0000-0000-0000-000000000001' and action = 'correct'
     and reason = '誤標完成'),
  1, '更正留下 correct 稽核列且含原因');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
select lives_ok($$ delete from public.safety_records
  where id = '31000000-0000-0000-0000-000000000002' $$, '未完成紀錄可由本方刪除');
select is(
  (select count(*)::int from public.safety_record_audits
   where safety_record_id = '31000000-0000-0000-0000-000000000002' and action = 'delete'),
  1, '刪除留下 delete 稽核列');

set local role authenticated;
select throws_ok($$ insert into public.safety_record_audits
  (project_id, safety_record_id, action, record_type, old_row)
  values ('21000000-0000-0000-0000-000000000001', gen_random_uuid(), 'correct', '自主檢查', '{}'::jsonb) $$,
  '42501', null, '登入者不可直接寫入稽核表(僅 trigger 可寫)');
reset role;

-- ── 回歸:guard 不得害專案刪不掉(cascade 放行) ────────────────────────────────
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5');
select lives_ok($$ select public.delete_project('21000000-0000-0000-0000-000000000001') $$,
  '含三方工安紀錄(含已完成)的專案,管理者仍可整案刪除');
select is(
  (select count(*)::int from public.projects where id = '21000000-0000-0000-0000-000000000001'),
  0, '專案確實刪除(cascade 未被 guard 擋下)');

select * from finish();
rollback;
