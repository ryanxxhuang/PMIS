-- 契約義務「動作只看歸屬」政策 + 完成時間戳(pgTAP)。
-- 對應 migration 20260825120000_obligation_ownership_completed_at.sql。
-- 釘三件事:1) update 只有自己方(+admin override)能做,機關自此能標自己的義務;
-- 2) completed_at/by 由 trigger 蓋,client 竄改無效、退回清空、已提送→已完成不重蓋;
-- 3) insert 政策未鬆動(機關仍不可直接建義務列)。
begin;

select plan(27);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_column('public', 'contract_obligations', 'completed_at', 'completed_at 欄位存在');
select has_column('public', 'contract_obligations', 'completed_by', 'completed_by 欄位存在');
select has_trigger('public', 'contract_obligations', 'contract_obligations_stamp_completion', '完成時間戳 trigger 掛上');
select has_function('public', 'my_party', '呼叫者契約方函式存在');
select has_function('public', 'obligation_party', array['text'], '義務歸屬方函式存在');
select is(public.obligation_party('機關'), '機關', '三方值原樣通過');
select is(public.obligation_party('設計單位'), '廠商', '未知責任方落回廠商(與前端 obligationParty 同步)');
select is(public.obligation_party(null), '廠商', 'null 責任方落回廠商');

-- ── 測試資料:三種 org 使用者 + 專案管理者(建立者) ──────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ob-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ob-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ob-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ob-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('21000000-0000-0000-0000-000000000001', '義務歸屬測試案', '機關', '廠商', '監造',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('21000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'member'),
  ('21000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'member'),
  ('21000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', 'member'),
  ('21000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', 'admin');

-- 義務列強制掛 requirement(requirement_id not null + 一對一):先種對應需求列。
-- 直接以超級使用者種,status 走預設 needs_review,不碰審核 guard。
insert into public.requirements (id, project_id, title, requirement_type) values
  ('21200000-0000-0000-0000-00000000000c', '21000000-0000-0000-0000-000000000001', '廠商義務需求', 'deadline'),
  ('21200000-0000-0000-0000-00000000000d', '21000000-0000-0000-0000-000000000001', '監造義務需求', 'deadline'),
  ('21200000-0000-0000-0000-00000000000e', '21000000-0000-0000-0000-000000000001', '機關義務需求', 'deadline'),
  ('21200000-0000-0000-0000-00000000000f', '21000000-0000-0000-0000-000000000001', '未標責任方需求', 'deadline'),
  ('21200000-0000-0000-0000-000000000010', '21000000-0000-0000-0000-000000000001', '機關偷渡需求', 'deadline');

insert into public.contract_obligations (id, project_id, requirement_id, title, responsible, status) values
  ('21100000-0000-0000-0000-00000000000c', '21000000-0000-0000-0000-000000000001', '21200000-0000-0000-0000-00000000000c', '廠商義務', '廠商', '待辦'),
  ('21100000-0000-0000-0000-00000000000d', '21000000-0000-0000-0000-000000000001', '21200000-0000-0000-0000-00000000000d', '監造義務', '監造', '待辦'),
  ('21100000-0000-0000-0000-00000000000e', '21000000-0000-0000-0000-000000000001', '21200000-0000-0000-0000-00000000000e', '機關義務', '機關', '待辦'),
  ('21100000-0000-0000-0000-00000000000f', '21000000-0000-0000-0000-000000000001', '21200000-0000-0000-0000-00000000000f', '未標責任方義務', null, '待辦');

-- 模擬登入者(同時設新舊兩種 claim 形式,相容不同版本的 auth.uid())
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 歸屬矩陣:自己方可改,別方 0 列(RLS 靜默擋下) ───────────────────────────
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
set local role authenticated;
update public.contract_obligations set status = '已完成' where id = '21100000-0000-0000-0000-00000000000c';
update public.contract_obligations set status = '已完成' where id = '21100000-0000-0000-0000-00000000000d';
reset role;
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000c'),
  '已完成', '廠商可標記自己方義務完成');
select ok((select completed_at is not null from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000c'),
  '進入完成態即蓋 completed_at');
select is((select completed_by from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000c'),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'::uuid, 'completed_by 蓋操作人');
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000d'),
  '待辦', '廠商不可改監造方義務(RLS 0 列)');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3');
set local role authenticated;
update public.contract_obligations set status = '已完成' where id = '21100000-0000-0000-0000-00000000000e';
update public.contract_obligations set status = '待辦' where id = '21100000-0000-0000-0000-00000000000c';
reset role;
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000e'),
  '已完成', '機關自此可標記自己方義務完成(本次開放的核心)');
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000c'),
  '已完成', '機關不可改廠商方義務(RLS 0 列)');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2');
set local role authenticated;
update public.contract_obligations set status = '已提送' where id = '21100000-0000-0000-0000-00000000000d';
update public.contract_obligations set status = '待辦' where id = '21100000-0000-0000-0000-00000000000e';
reset role;
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000d'),
  '已提送', '監造可標記自己方義務');
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000e'),
  '已完成', '監造不可改機關方義務(RLS 0 列)');

-- 未標責任方 → 落回廠商:廠商可改、監造不可
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
set local role authenticated;
update public.contract_obligations set status = '已提送' where id = '21100000-0000-0000-0000-00000000000f';
reset role;
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000f'),
  '已提送', '未標責任方的義務落回廠商:廠商可操作');
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2');
set local role authenticated;
update public.contract_obligations set status = '待辦' where id = '21100000-0000-0000-0000-00000000000f';
reset role;
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000f'),
  '已提送', '未標責任方的義務:監造不可操作');

-- 讓渡擋下:把自己的義務改掛別方,with check 直接炸(不是靜默 0 列)
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
set local role authenticated;
select throws_ok(
  $$ update public.contract_obligations set responsible = '監造'
     where id = '21100000-0000-0000-0000-00000000000c' $$,
  '42501', null, '改 responsible 讓渡義務被 with check 擋下');
reset role;

-- admin override:非正式模式的專案管理者可跨方(退回機關義務並驗清空)
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5');
set local role authenticated;
update public.contract_obligations set status = '待辦' where id = '21100000-0000-0000-0000-00000000000e';
reset role;
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000e'),
  '待辦', 'admin override 可跨方操作(正式模式下自動失效)');
select ok((select completed_at is null from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000e'),
  '退回未完成態清空 completed_at');
select ok((select completed_by is null from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000e'),
  '退回未完成態清空 completed_by');

-- ── 時間戳不可竄改 ───────────────────────────────────────────────────────────
-- 種已知時間戳需暫停 trigger(它會還原 client 值——這正是要測的行為)
alter table public.contract_obligations disable trigger contract_obligations_stamp_completion;
update public.contract_obligations set completed_at = '2026-01-01T00:00:00Z'
  where id = '21100000-0000-0000-0000-00000000000c';
update public.contract_obligations set completed_at = '2026-02-02T00:00:00Z'
  where id = '21100000-0000-0000-0000-00000000000d';
alter table public.contract_obligations enable trigger contract_obligations_stamp_completion;

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1');
set local role authenticated;
update public.contract_obligations
  set completed_at = '2020-12-31T00:00:00Z', note = '狀態不變,試圖竄改時間戳'
  where id = '21100000-0000-0000-0000-00000000000c';
reset role;
select is((select completed_at from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000c'),
  '2026-01-01T00:00:00Z'::timestamptz, '狀態不變時 client 送的 completed_at 一律作廢');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2');
set local role authenticated;
update public.contract_obligations set status = '已完成' where id = '21100000-0000-0000-0000-00000000000d';
reset role;
select is((select status from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000d'),
  '已完成', '已提送可升級為已完成');
select is((select completed_at from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000d'),
  '2026-02-02T00:00:00Z'::timestamptz, '已提送 → 已完成不重蓋(保留首次完成時間)');

select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2');
set local role authenticated;
update public.contract_obligations set status = '待辦' where id = '21100000-0000-0000-0000-00000000000d';
reset role;
select ok((select completed_at is null from public.contract_obligations where id = '21100000-0000-0000-0000-00000000000d'),
  '一般成員退回待辦同樣清空時間戳');

-- ── insert 政策未鬆動:機關仍不可直接建義務列(義務是 system-managed) ─────────
select pg_temp.become('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3');
set local role authenticated;
select throws_ok(
  $$ insert into public.contract_obligations (project_id, requirement_id, title, responsible, status)
     values ('21000000-0000-0000-0000-000000000001', '21200000-0000-0000-0000-000000000010',
             '機關偷渡義務', '機關', '待辦') $$,
  '42501', null, '機關 insert 仍被 can_write 擋下(本次只開 update 歸屬)');
reset role;

select * from finish();
rollback;
