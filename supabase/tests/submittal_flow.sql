-- 送審狀態機(pgTAP):修正再送放行 + 審定權限迴歸。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
-- 對應 migration 20260712001500_submittal_resubmit.sql。
begin;

select plan(8);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sf-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sf-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sf-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by, formal_mode)
values ('24000000-0000-0000-0000-000000000001', '送審流程測試案', '機關', '廠商', '監造',
        'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', true);
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('24000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'member'),
  ('24000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'member'),
  ('24000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- 廠商提送 → 監造退回 → 廠商修正再送 → 監造核准(完整鏈)
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1');
insert into public.submittals (id, project_id, submittal_no, title, category, status) values
  ('34000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001',
   'SUB-F01', '施工計畫', '施工計畫', '已提送');

select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2');
select lives_ok($$ update public.submittals set status = '退回補正', review_note = '缺出廠證明'
  where id = '34000000-0000-0000-0000-000000000001' $$, '監造可退回補正');

select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1');
select lives_ok($$ update public.submittals
  set status = '已提送', revision = 1, decided_date = null
  where id = '34000000-0000-0000-0000-000000000001' $$,
  'P0-01:廠商可修正再送(退回補正→已提送)');
select is(
  (select revision from public.submittals where id = '34000000-0000-0000-0000-000000000001'),
  1, '再送版次 +1 持久化');

-- 迴歸:廠商仍不可做其他審定轉移
select throws_ok($$ update public.submittals set status = '核准'
  where id = '34000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商仍不可自行核准');
select throws_ok($$ update public.submittals set status = '退回補正'
  where id = '34000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商不可自行退回(製造假審定)');

select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2');
select lives_ok($$ update public.submittals set status = '核准', review_note = '同意辦理'
  where id = '34000000-0000-0000-0000-000000000001' $$, '監造可核准再送版');

-- 駁回=終局:廠商不可從駁回再送
select lives_ok($$ update public.submittals set status = '駁回'
  where id = '34000000-0000-0000-0000-000000000001' $$, '監造可駁回(撤銷核准改駁回)');
select pg_temp.become('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1');
select throws_ok($$ update public.submittals set status = '已提送'
  where id = '34000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '駁回為終局,廠商不可再送');

select * from finish();
rollback;
