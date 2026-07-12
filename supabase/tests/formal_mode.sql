-- 正式模式(pgTAP):關閉專案管理者跨角色簽核例外。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
-- 對應 migration 20260712001300_formal_mode.sql。
begin;

select plan(25);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_column('public', 'projects', 'formal_mode', 'formal_mode 欄位存在');
select has_function('public', 'admin_override', array['uuid'], 'admin_override 函式存在');
select has_trigger('public', 'projects', 'projects_formal_mode_guard', '單向開關 guard 掛上');

-- ── 測試資料 ─────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('dddddddd-dddd-dddd-dddd-ddddddddddd1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('dddddddd-dddd-dddd-dddd-ddddddddddd5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'f-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('23000000-0000-0000-0000-000000000001', '正式模式測試案', '機關', '廠商', '監造',
        'dddddddd-dddd-dddd-dddd-ddddddddddd5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('23000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-ddddddddddd1', 'member'),
  ('23000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-ddddddddddd2', 'member'),
  ('23000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-ddddddddddd3', 'member'),
  ('23000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-ddddddddddd5', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- 待簽核素材(由廠商建立)
select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd1');
insert into public.valuations (id, project_id, period_no, status) values
  ('33000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001', 1, '監造審核'),
  ('33000000-0000-0000-0000-000000000002','23000000-0000-0000-0000-000000000001', 2, '監造審核');
insert into public.inspections (id, project_id, title, status) values
  ('33000000-0000-0000-0000-000000000011','23000000-0000-0000-0000-000000000001', '鋼筋查驗A', '待查驗'),
  ('33000000-0000-0000-0000-000000000012','23000000-0000-0000-0000-000000000001', '鋼筋查驗B', '待查驗');
insert into public.submittals (id, project_id, submittal_no, title, category, status) values
  ('33000000-0000-0000-0000-000000000021','23000000-0000-0000-0000-000000000001', 'SUB-T01', '施工計畫', '施工計畫', '已提送');
insert into public.rfis (id, project_id, rfi_no, title, status) values
  ('33000000-0000-0000-0000-000000000031','23000000-0000-0000-0000-000000000001', 'RFI-T01', '圖說釋疑', '待回覆');
insert into public.change_orders (id, project_id, co_no, title, status) values
  ('33000000-0000-0000-0000-000000000041','23000000-0000-0000-0000-000000000001', 'CO-T01', '追加工項', '送審');

-- ── 非正式模式:管理者例外照舊(迴歸)──────────────────────────────────────────
select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd5');
select lives_ok($$ update public.valuations set status = '已核定'
  where id = '33000000-0000-0000-0000-000000000001' $$,
  '非正式模式:管理者可核定估驗(試用行為不變)');
select lives_ok($$ insert into public.safety_records (project_id, record_type, title, status)
  values ('23000000-0000-0000-0000-000000000001','監造觀察','管理者代登','已完成') $$,
  '非正式模式:管理者可建立監造事件');

-- ── 開關本身 ─────────────────────────────────────────────────────────────────
-- 非建立者:RLS 擋 update(0 列生效),formal_mode 不變
select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd2');
set local role authenticated;
update public.projects set formal_mode = true where id = '23000000-0000-0000-0000-000000000001';
reset role;
select is(
  (select formal_mode from public.projects where id = '23000000-0000-0000-0000-000000000001'),
  false, '非建立者無法開啟正式模式(RLS)');

select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd5');
select lives_ok($$ update public.projects set formal_mode = true
  where id = '23000000-0000-0000-0000-000000000001' $$, '建立者可開啟正式模式');
select is(
  (select formal_mode from public.projects where id = '23000000-0000-0000-0000-000000000001'),
  true, 'formal_mode 已開啟');
select throws_ok($$ update public.projects set formal_mode = false
  where id = '23000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '正式模式單向:開啟後登入使用者不可關閉');
select ok(not public.admin_override('23000000-0000-0000-0000-000000000001'),
  '正式模式下 admin_override 對管理者為 false');

-- ── 正式模式:管理者(廠商身分)失去跨角色簽核 ─────────────────────────────────
select throws_ok($$ update public.valuations set status = '已核定'
  where id = '33000000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '正式模式:管理者不可核定估驗');
select throws_ok($$ update public.inspections set status = '合格'
  where id = '33000000-0000-0000-0000-000000000011' $$, 'P0001', null,
  '正式模式:管理者不可判定查驗');
select throws_ok($$ insert into public.safety_records (project_id, record_type, title)
  values ('23000000-0000-0000-0000-000000000001','監造觀察','越權觀察') $$, 'P0001', null,
  '正式模式:管理者不可建立監造工安事件');
select throws_ok($$ update public.submittals set status = '核准'
  where id = '33000000-0000-0000-0000-000000000021' $$, 'P0001', null,
  '正式模式:管理者不可審定送審');
select throws_ok($$ update public.rfis set answer = '照圖施工', status = '已回覆'
  where id = '33000000-0000-0000-0000-000000000031' $$, 'P0001', null,
  '正式模式:管理者不可回覆 RFI');
select throws_ok($$ update public.change_orders set status = '核准'
  where id = '33000000-0000-0000-0000-000000000041' $$, 'P0001', null,
  '正式模式:管理者不可核准變更設計');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('23000000-0000-0000-0000-000000000001','confirm') $$, 'P0001', null,
  '正式模式:管理者不可登錄監造/機關的驗收階段');

-- ── 正式模式:各角色照常運作 ──────────────────────────────────────────────────
select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd2');
select lives_ok($$ update public.valuations set status = '已核定'
  where id = '33000000-0000-0000-0000-000000000002' $$, '正式模式:監造照常核定估驗');
select lives_ok($$ update public.inspections set status = '合格'
  where id = '33000000-0000-0000-0000-000000000011' $$, '正式模式:監造照常判定查驗');
select lives_ok($$ insert into public.safety_records (project_id, record_type, title, status)
  values ('23000000-0000-0000-0000-000000000001','監造觀察','高處作業提醒','已完成') $$,
  '正式模式:監造照常建立監造事件');

select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd3');
select lives_ok($$ update public.change_orders set status = '核准'
  where id = '33000000-0000-0000-0000-000000000041' $$, '正式模式:機關照常核准變更設計');

-- 管理者(廠商身分)仍可做廠商本分與專案管理
select pg_temp.become('dddddddd-dddd-dddd-dddd-ddddddddddd5');
select lives_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('23000000-0000-0000-0000-000000000001','report') $$,
  '正式模式:管理者(廠商)仍可登錄廠商階段(報竣)');
select lives_ok($$ update public.projects set name = '正式模式測試案(更名)'
  where id = '23000000-0000-0000-0000-000000000001' $$,
  '正式模式:管理者仍可管理專案(更名)');

-- ── 回歸:正式模式不害專案刪不掉 ──────────────────────────────────────────────
select lives_ok($$ select public.delete_project('23000000-0000-0000-0000-000000000001') $$,
  '正式模式專案仍可由管理者整案刪除');
select is(
  (select count(*)::int from public.projects where id = '23000000-0000-0000-0000-000000000001'),
  0, '專案確實刪除');

select * from finish();
rollback;
