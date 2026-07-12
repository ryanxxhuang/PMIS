-- acceptance_events 階段×專案角色權限矩陣(pgTAP)。
-- 執行方式:supabase test db(需本機 Docker runtime)。整份在交易內執行並 rollback。
-- 對應 migration 20260712000100_acceptance_events_rbac.sql / schema.sql「驗收事件 RBAC」段。
begin;

select plan(38);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_table('public', 'acceptance_event_audits', 'audit 表存在');
select has_function('public', 'acceptance_stage_allowed', array['text','text'], '階段矩陣函式存在');
select has_trigger('public', 'acceptance_events', 'acceptance_events_guard', 'guard trigger 掛上');
select has_trigger('public', 'acceptance_events', 'acceptance_events_audit', 'audit trigger 掛上');

-- ── 測試資料:三種 org 使用者 + 同方第二人 + 專案管理者(建立者) ────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner2@example.test', '', now(), '{}',
   '{"full_name":"Owner 2","org_type":"owner"}', now(), now()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('20000000-0000-0000-0000-000000000001', '驗收測試案', '機關', '廠商', '監造',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'member'),
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'member'),
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'member'),
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'member'),
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 'admin');

-- 模擬登入者(同時設新舊兩種 claim 形式,相容不同版本的 auth.uid())
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 矩陣:INSERT(每階段一正一反;P0001=guard raise) ──────────────────────────
select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
select lives_ok($$ insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('20000000-0000-0000-0000-000000000001', 'report', current_date) $$, '廠商可登錄 report');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'report') $$, 'P0001', null, '監造不可登錄 report');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'report') $$, 'P0001', null, '機關不可登錄 report');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
select lives_ok($$ insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('20000000-0000-0000-0000-000000000001', 'confirm', current_date) $$, '監造可登錄 confirm');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select lives_ok($$ insert into public.acceptance_events (id, project_id, stage_key, event_date)
  values ('30000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001', 'confirm', current_date) $$, '機關可登錄 confirm');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'confirm') $$, 'P0001', null, '廠商不可登錄 confirm');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select lives_ok($$ insert into public.acceptance_events (id, project_id, stage_key, event_date, result)
  values ('30000000-0000-0000-0000-000000000002',
          '20000000-0000-0000-0000-000000000001', 'initial', current_date, '合格') $$, '機關可登錄 initial');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'initial') $$, 'P0001', null, '監造不可登錄 initial');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'initial') $$, 'P0001', null, '廠商不可登錄 initial');

select lives_ok($$ insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('20000000-0000-0000-0000-000000000001', 'fix', current_date) $$, '廠商可登錄 fix');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'fix') $$, 'P0001', null, '機關不可登錄 fix');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
select lives_ok($$ insert into public.acceptance_events (project_id, stage_key, event_date, result)
  values ('20000000-0000-0000-0000-000000000001', 'reinspect', current_date, '合格') $$, '監造可登錄 reinspect');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select lives_ok($$ insert into public.acceptance_events (project_id, stage_key, event_date, result)
  values ('20000000-0000-0000-0000-000000000001', 'reinspect', current_date, '合格') $$, '機關可登錄 reinspect');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'reinspect') $$, 'P0001', null, '廠商不可登錄 reinspect');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select lives_ok($$ insert into public.acceptance_events (project_id, stage_key, event_date, result)
  values ('20000000-0000-0000-0000-000000000001', 'final', current_date, '合格') $$, '機關可登錄 final');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'final') $$, 'P0001', null, '監造不可登錄 final');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select lives_ok($$ insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('20000000-0000-0000-0000-000000000001', 'certificate', current_date) $$, '機關可登錄 certificate');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'certificate') $$, 'P0001', null, '監造不可登錄 certificate');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select lives_ok($$ insert into public.acceptance_events (id, project_id, stage_key, event_date)
  values ('30000000-0000-0000-0000-000000000003',
          '20000000-0000-0000-0000-000000000001', 'warranty', current_date) $$, '機關可登錄 warranty');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'warranty') $$, 'P0001', null, '廠商不可登錄 warranty');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select throws_ok($$ insert into public.acceptance_events (project_id, stage_key)
  values ('20000000-0000-0000-0000-000000000001', 'bogus_stage') $$, 'P0001', null, '未知階段一律拒絕');

-- 專案管理者(org=contractor)=授權主驗,可登錄 initial
select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5');
select lives_ok($$ insert into public.acceptance_events (project_id, stage_key, event_date, result)
  values ('20000000-0000-0000-0000-000000000001', 'initial', current_date, '合格') $$,
  '專案管理者(授權主驗)可登錄 initial');

-- ── created_by 防冒名 ────────────────────────────────────────────────────────
select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
insert into public.acceptance_events (id, project_id, stage_key, created_by)
values ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001',
        'report', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select is(
  (select created_by from public.acceptance_events where id = '30000000-0000-0000-0000-000000000004'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'::uuid,
  'INSERT 的 created_by 一律強制為登錄者本人(不可冒名)');

-- ── 他方原始事件保護 / 同方更正 ──────────────────────────────────────────────
select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
select throws_ok($$ update public.acceptance_events set note = '監造改機關的'
  where id = '30000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '監造不可覆寫機關建立的 confirm');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4');
select lives_ok($$ update public.acceptance_events set note = '同機關同事更正'
  where id = '30000000-0000-0000-0000-000000000001' $$,
  '同方(機關)非建立者可更正本方事件');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
select throws_ok($$ delete from public.acceptance_events
  where id = '30000000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '廠商不可刪除機關建立的 initial');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5');
select throws_ok($$ update public.acceptance_events set note = '管理者改機關的'
  where id = '30000000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '專案管理者也不可覆寫他方(機關)建立的事件');

select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
select throws_ok($$ update public.acceptance_events set stage_key = 'final'
  where id = '30000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '事件身分欄位(stage_key)不可變更');

-- ── 更正/撤銷稽核 ────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from public.acceptance_event_audits
   where acceptance_event_id = '30000000-0000-0000-0000-000000000001' and action = 'correct'),
  1, '更正留下 correct 稽核列');

select lives_ok($$ delete from public.acceptance_events
  where id = '30000000-0000-0000-0000-000000000003' $$, '建立者可撤銷自己的 warranty');

select is(
  (select count(*)::int from public.acceptance_event_audits
   where acceptance_event_id = '30000000-0000-0000-0000-000000000003' and action = 'delete'),
  1, '撤銷留下 delete 稽核列');

set local role authenticated;
select throws_ok($$ insert into public.acceptance_event_audits
  (project_id, acceptance_event_id, action, stage_key, old_row)
  values ('20000000-0000-0000-0000-000000000001', gen_random_uuid(), 'correct', 'report', '{}'::jsonb) $$,
  '42501', null, '登入者不可直接寫入稽核表(僅 trigger 可寫)');
reset role;

-- ── 回歸:guard 不得害專案刪不掉(cascade 放行;P0 事故教訓) ────────────────────
select pg_temp.become('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5');
select lives_ok($$ select public.delete_project('20000000-0000-0000-0000-000000000001') $$,
  '含跨方驗收事件的專案,管理者仍可整案刪除');
select is(
  (select count(*)::int from public.projects where id = '20000000-0000-0000-0000-000000000001'),
  0, '專案確實刪除(cascade 未被 guard 擋下)');

select * from finish();
rollback;
