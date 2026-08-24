-- 契約分級可見性補完 pgTAP 套件(migration 20260824000200)。
-- 矩陣:機關看全部/監造看施工+自己/廠商只看自己;涵蓋手動歸包 requirement、
-- 其引註、物化義務的 SELECT 與 UPDATE(盲寫)封鎖、歸包防呆 guard、legacy 全案可見。
begin;

select plan(15);

create or replace function pg_temp.become(u uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

select pg_temp.become(null);

-- ── fixtures(以 postgres 身分佈建)──────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c9000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'agency@cg.test', '', now(), '{}',
   '{"full_name":"機關甲","org_type":"owner"}', now(), now()),
  ('c9000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sup@cg.test', '', now(), '{}',
   '{"full_name":"監造乙","org_type":"supervisor"}', now(), now()),
  ('c9000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'con@cg.test', '', now(), '{}',
   '{"full_name":"廠商丙","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('c9100000-0000-0000-0000-000000000001', 'Grading Project'),
  ('c9100000-0000-0000-0000-000000000002', 'Other Project');
alter table public.projects enable trigger on_project_created;

insert into public.project_parties (id, project_id, party_type, display_name) values
  ('c9200000-0000-0000-0000-00000000000a', 'c9100000-0000-0000-0000-000000000001', 'agency', 'CG 機關'),
  ('c9200000-0000-0000-0000-00000000000b', 'c9100000-0000-0000-0000-000000000001', 'supervisor', 'CG 監造'),
  ('c9200000-0000-0000-0000-00000000000c', 'c9100000-0000-0000-0000-000000000001', 'contractor', 'CG 廠商');

insert into public.project_members (project_id, user_id, role) values
  ('c9100000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-00000000000a', 'member'),
  ('c9100000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-00000000000b', 'member'),
  ('c9100000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-00000000000c', 'admin');

insert into public.project_memberships
  (project_id, user_id, project_party_id, project_role, is_project_admin) values
  ('c9100000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-00000000000a',
   'c9200000-0000-0000-0000-00000000000a', 'agency_pm', false),
  ('c9100000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-00000000000b',
   'c9200000-0000-0000-0000-00000000000b', 'supervisor_engineer', false),
  ('c9100000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-00000000000c',
   'c9200000-0000-0000-0000-00000000000c', 'contractor_pm', true);

-- 兩個契約包:施工(counterparty=廠商)/監造(counterparty=監造)
insert into public.contract_packages
  (id, project_id, counterparty_project_party_id, package_type, title) values
  ('c9300000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-000000000001',
   'c9200000-0000-0000-0000-00000000000c', 'construction', '施工契約'),
  ('c9300000-0000-0000-0000-000000000002', 'c9100000-0000-0000-0000-000000000001',
   'c9200000-0000-0000-0000-00000000000b', 'supervision', '監造契約');

-- legacy 全案項(無 run 無包;postgres 身分佈建)
insert into public.requirements (id, project_id, title, requirement_type, status, origin) values
  ('c9400000-0000-0000-0000-000000000013', 'c9100000-0000-0000-0000-000000000001',
   'legacy 全案項', 'other', 'needs_review', 'migration');

-- ── 手動補登(走 RLS:各方歸自己的包)────────────────────────────────────────
set local role authenticated;
select pg_temp.become('c9000000-0000-0000-0000-00000000000c');
insert into public.requirements (id, project_id, title, requirement_type, status, origin,
  trigger_type, trigger_config, contract_package_id) values
  ('c9400000-0000-0000-0000-000000000011', 'c9100000-0000-0000-0000-000000000001',
   '施工契約:開工前投保營造險', 'deadline', 'needs_review', 'manual',
   'fixed', '{"fixed_date":"2026-12-01"}', 'c9300000-0000-0000-0000-000000000001');
insert into public.requirement_sources (id, requirement_id, source_kind, clause, source_text) values
  ('c9500000-0000-0000-0000-000000000011', 'c9400000-0000-0000-0000-000000000011',
   'manual', '6.2', '乙方應於開工前投保營造綜合保險。');

select pg_temp.become('c9000000-0000-0000-0000-00000000000b');
insert into public.requirements (id, project_id, title, requirement_type, status, origin,
  trigger_type, trigger_config, contract_package_id) values
  ('c9400000-0000-0000-0000-000000000012', 'c9100000-0000-0000-0000-000000000001',
   '監造契約:每月提送監造報表', 'deadline', 'needs_review', 'manual',
   'fixed', '{"fixed_date":"2026-11-01"}', 'c9300000-0000-0000-0000-000000000002');

-- 監造核定兩筆期限 → D-012 物化義務
select lives_ok($$ select public.review_requirement('c9400000-0000-0000-0000-000000000011', 'approve') $$,
  '監造可核定施工契約的手動期限');
select lives_ok($$ select public.review_requirement('c9400000-0000-0000-0000-000000000012', 'approve') $$,
  '監造可核定監造契約的手動期限');

-- ── 矩陣:requirements ──────────────────────────────────────────────────────
select pg_temp.become('c9000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.requirements where project_id = 'c9100000-0000-0000-0000-000000000001'),
  3, '機關看全部(施工+監造+legacy)');

select pg_temp.become('c9000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.requirements where project_id = 'c9100000-0000-0000-0000-000000000001'),
  3, '監造看施工+自己+legacy');

select pg_temp.become('c9000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.requirements where project_id = 'c9100000-0000-0000-0000-000000000001'),
  2, '廠商只看施工契約+legacy——監造契約的重點不可見');
select is((select count(*)::int from public.requirements where id = 'c9400000-0000-0000-0000-000000000012'),
  0, '廠商點名查監造契約重點也查不到');

-- ── 矩陣:requirement_sources ──────────────────────────────────────────────
select is((select count(*)::int from public.requirement_sources
  where requirement_id = 'c9400000-0000-0000-0000-000000000011'), 1,
  '廠商看得到施工契約重點的引註');

-- ── 矩陣:contract_obligations ─────────────────────────────────────────────
select pg_temp.become('c9000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.contract_obligations where project_id = 'c9100000-0000-0000-0000-000000000001'),
  2, '機關看全部義務');

select pg_temp.become('c9000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.contract_obligations where project_id = 'c9100000-0000-0000-0000-000000000001'),
  2, '監造看施工+自己的義務');

select pg_temp.become('c9000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.contract_obligations where project_id = 'c9100000-0000-0000-0000-000000000001'),
  1, '廠商只看施工契約的義務——監造契約期限不可見');

-- 盲寫封鎖:廠商 update 看不見的監造義務 → 0 列生效
update public.contract_obligations set status = '已提送'
  where id = 'c9400000-0000-0000-0000-000000000012';
reset role;
select is((select status from public.contract_obligations where id = 'c9400000-0000-0000-0000-000000000012'),
  '待辦', '廠商對監造契約義務的盲寫不生效');

-- 廠商可正常操作自己契約的義務
set local role authenticated;
select pg_temp.become('c9000000-0000-0000-0000-00000000000c');
update public.contract_obligations set status = '已提送'
  where id = 'c9400000-0000-0000-0000-000000000011';
reset role;
select is((select status from public.contract_obligations where id = 'c9400000-0000-0000-0000-000000000011'),
  '已提送', '廠商可標記自己契約義務為已提送');

-- ── 歸包防呆 guard ─────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.become('c9000000-0000-0000-0000-00000000000c');
select throws_ok($$
  insert into public.requirements (project_id, title, requirement_type, status, origin, contract_package_id)
  values ('c9100000-0000-0000-0000-000000000001', '亂歸包', 'other', 'needs_review', 'manual',
    'c9300000-0000-0000-0000-000000000002')
$$, '不可將契約重點歸入無權讀取的契約包',
  '廠商不可把補登內容歸入監造契約包');
reset role;

select pg_temp.become(null);
select throws_ok($$
  insert into public.requirements (project_id, title, requirement_type, status, origin, contract_package_id)
  values ('c9100000-0000-0000-0000-000000000002', '跨案歸包', 'other', 'needs_review', 'manual',
    'c9300000-0000-0000-0000-000000000001')
$$, '契約重點歸包必須屬於同一專案',
  '歸包不可跨專案(service role 也擋)');

-- ── audit 面向:核定事件仍照常寫入 ─────────────────────────────────────────
select is((select count(*)::int from public.audit_events
  where event_type = 'requirement.approved'
    and project_id = 'c9100000-0000-0000-0000-000000000001'),
  2, '兩筆核定各留一筆稽核事件');

select * from finish();
rollback;
