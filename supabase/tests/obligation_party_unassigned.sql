-- P5a 責任不明的契約義務不歸任何一方(pgTAP)。
-- 對應 migration 20260917220737_obligation_party_unassigned.sql。
-- 釘兩件事:1) obligation_party() 對三方以外一律回 null(去頭尾空白後比對);
-- 2) 責任不明的義務三方都不能標記(update policy 對 null 不成立),自己方的義務照常可標,
--    admin override 仍可跨方、正式模式下失效——與前端「待補設定」同一條規則。
begin;

select plan(16);

-- ── 函式語意 ──────────────────────────────────────────────────────────────────
select has_function('public', 'obligation_party', array['text'], '義務歸屬方函式存在');
select is(public.obligation_party('廠商'), '廠商', '廠商原樣通過');
select is(public.obligation_party('監造'), '監造', '監造原樣通過');
select is(public.obligation_party('機關'), '機關', '機關原樣通過');
select is(public.obligation_party(' 機關 '), '機關', '頭尾空白去除後仍是三方(與共用規則 trim 同口徑)');
select is(public.obligation_party(null), null::text, 'null 責任方不歸任何一方');
select is(public.obligation_party(''), null::text, '空字串不歸任何一方');
select is(public.obligation_party('其他'), null::text, '「其他」(requirement responsible_party_type=other)不歸任何一方');
select is(public.obligation_party('設計單位'), null::text, '未知文字不歸任何一方(不再落回廠商)');

-- ── 測試資料:三種 org 使用者 + 專案管理者(建立者) ──────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c5a00000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5a-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('c5a00000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5a-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('c5a00000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5a-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('c5a00000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5a-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('c5a10000-0000-0000-0000-000000000001', '責任不明義務測試案', '機關', '廠商', '監造',
        'c5a00000-0000-0000-0000-0000000000a5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('c5a10000-0000-0000-0000-000000000001', 'c5a00000-0000-0000-0000-0000000000a1', 'member'),
  ('c5a10000-0000-0000-0000-000000000001', 'c5a00000-0000-0000-0000-0000000000a2', 'member'),
  ('c5a10000-0000-0000-0000-000000000001', 'c5a00000-0000-0000-0000-0000000000a3', 'member'),
  ('c5a10000-0000-0000-0000-000000000001', 'c5a00000-0000-0000-0000-0000000000a5', 'admin');

-- 義務列強制掛 requirement(requirement_id not null + 一對一):先種對應需求列。
insert into public.requirements (id, project_id, title, requirement_type) values
  ('c5a20000-0000-0000-0000-000000000001', 'c5a10000-0000-0000-0000-000000000001', '未標責任方需求', 'deadline'),
  ('c5a20000-0000-0000-0000-000000000002', 'c5a10000-0000-0000-0000-000000000001', '其他單位需求', 'deadline'),
  ('c5a20000-0000-0000-0000-000000000003', 'c5a10000-0000-0000-0000-000000000001', '廠商需求', 'deadline');

insert into public.contract_obligations (id, project_id, requirement_id, title, responsible, status) values
  ('c5a30000-0000-0000-0000-000000000001', 'c5a10000-0000-0000-0000-000000000001', 'c5a20000-0000-0000-0000-000000000001', '未標責任方義務', null, '待辦'),
  ('c5a30000-0000-0000-0000-000000000002', 'c5a10000-0000-0000-0000-000000000001', 'c5a20000-0000-0000-0000-000000000002', '其他單位義務', '其他', '待辦'),
  ('c5a30000-0000-0000-0000-000000000003', 'c5a10000-0000-0000-0000-000000000001', 'c5a20000-0000-0000-0000-000000000003', '廠商義務', '廠商', '待辦');

-- 模擬登入者(同時設新舊兩種 claim 形式,相容不同版本的 auth.uid())
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 責任不明:三方都不能標記(RLS 靜默 0 列) ──────────────────────────────────
select pg_temp.become('c5a00000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.contract_obligations set status = '已提送' where id = 'c5a30000-0000-0000-0000-000000000001';
update public.contract_obligations set status = '已提送' where id = 'c5a30000-0000-0000-0000-000000000002';
update public.contract_obligations set status = '已提送' where id = 'c5a30000-0000-0000-0000-000000000003';
reset role;
select is((select status from public.contract_obligations where id = 'c5a30000-0000-0000-0000-000000000001'),
  '待辦', '未標責任方的義務:廠商不可標記(不再落回廠商)');
select is((select status from public.contract_obligations where id = 'c5a30000-0000-0000-0000-000000000002'),
  '待辦', '責任方「其他」的義務:廠商不可標記');
select is((select status from public.contract_obligations where id = 'c5a30000-0000-0000-0000-000000000003'),
  '已提送', '對照組:廠商仍可標記自己方的義務(policy 本身沒被收緊)');

select pg_temp.become('c5a00000-0000-0000-0000-0000000000a2');
set local role authenticated;
update public.contract_obligations set status = '已提送' where id = 'c5a30000-0000-0000-0000-000000000001';
reset role;
select is((select status from public.contract_obligations where id = 'c5a30000-0000-0000-0000-000000000001'),
  '待辦', '未標責任方的義務:監造不可標記');

select pg_temp.become('c5a00000-0000-0000-0000-0000000000a3');
set local role authenticated;
update public.contract_obligations set status = '已提送' where id = 'c5a30000-0000-0000-0000-000000000001';
reset role;
select is((select status from public.contract_obligations where id = 'c5a30000-0000-0000-0000-000000000001'),
  '待辦', '未標責任方的義務:機關不可標記');

-- admin override:非正式模式的專案管理者仍可跨方處理(待補設定期間的唯一人工出口)
select pg_temp.become('c5a00000-0000-0000-0000-0000000000a5');
set local role authenticated;
update public.contract_obligations set status = '已提送' where id = 'c5a30000-0000-0000-0000-000000000001';
reset role;
select is((select status from public.contract_obligations where id = 'c5a30000-0000-0000-0000-000000000001'),
  '已提送', 'admin override 可標記未標責任方的義務(非正式模式)');

-- 正式模式:admin override 失效,未標責任方的義務任何人都不能動
update public.projects set formal_mode = true where id = 'c5a10000-0000-0000-0000-000000000001';
select pg_temp.become('c5a00000-0000-0000-0000-0000000000a5');
set local role authenticated;
update public.contract_obligations set status = '待辦' where id = 'c5a30000-0000-0000-0000-000000000001';
reset role;
select is((select status from public.contract_obligations where id = 'c5a30000-0000-0000-0000-000000000001'),
  '已提送', '正式模式下 admin override 失效:未標責任方的義務無人可動');

select * from finish();
rollback;
