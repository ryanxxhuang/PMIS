-- 金流狀態閘門(pgTAP):未核定估驗不得持有請款/收款資料。
-- 執行方式:supabase test db(需本機 Docker runtime)。整份在交易內執行並 rollback。
-- 對應 migration 20260712001100_valuation_payment_gate.sql。
begin;

select plan(16);

-- ── 結構 ─────────────────────────────────────────────────────────────────────
select has_function('public', 'valuations_payment_gate', '閘門函式存在');
select has_trigger('public', 'valuations', 'valuations_payment_gate', '閘門 trigger 掛上');

-- ── 測試資料:三種 org 使用者 + 專案管理者(建立者,contractor org) ──────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'v-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'v-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'v-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'v-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('22000000-0000-0000-0000-000000000001', '金流閘門測試案', '機關', '廠商', '監造',
        'cccccccc-cccc-cccc-cccc-ccccccccccc5');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('22000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'member'),
  ('22000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-ccccccccccc2', 'member'),
  ('22000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-ccccccccccc3', 'member'),
  ('22000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-ccccccccccc5', 'admin');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- ── 未核定:不得登錄金流 ─────────────────────────────────────────────────────
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc1');
select lives_ok($$ insert into public.valuations (id, project_id, period_no, status)
  values ('32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001', 1, '草稿') $$,
  '廠商可建立草稿估驗期');
select throws_ok($$ update public.valuations set paid_amount = 28063
  where id = '32000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '草稿估驗不可填實收金額');
select throws_ok($$ update public.valuations set invoice_date = current_date
  where id = '32000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '草稿估驗不可填請款日');
select throws_ok($$ insert into public.valuations (project_id, period_no, status, paid_amount)
  values ('22000000-0000-0000-0000-000000000001', 9, '草稿', 100) $$, 'P0001', null,
  'INSERT 也擋:草稿帶實收金額直接拒絕');

-- 專案管理者也沒有例外(資料一致性,非權限)
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc5');
select throws_ok($$ update public.valuations set paid_amount = 999
  where id = '32000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '專案管理者同樣不可在未核定期登錄金流');

-- ── 核定後:可登錄金流 ───────────────────────────────────────────────────────
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc2');
select lives_ok($$ update public.valuations set status = '已核定'
  where id = '32000000-0000-0000-0000-000000000001' $$, '監造可核定估驗');

select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc3');
select lives_ok($$ update public.valuations
  set invoice_date = current_date, paid_date = current_date, paid_amount = 28063
  where id = '32000000-0000-0000-0000-000000000001' $$, '核定後機關可登錄請款/收款');

-- ── 退回核定:有金流資料必須先清空 ────────────────────────────────────────────
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc2');
select throws_ok($$ update public.valuations set status = '草稿'
  where id = '32000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '已登錄金流的估驗不可直接退回');
select lives_ok($$ update public.valuations
  set invoice_date = null, paid_date = null, paid_amount = null
  where id = '32000000-0000-0000-0000-000000000001' $$, '清空金流欄位永遠允許');
select lives_ok($$ update public.valuations set status = '草稿'
  where id = '32000000-0000-0000-0000-000000000001' $$, '清空金流後即可退回草稿');

-- ── 回歸:既有 valuations_guard 行為不受影響 ─────────────────────────────────
select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc1');
select throws_ok($$ update public.valuations set status = '已核定'
  where id = '32000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '廠商仍不可自行核定估驗(valuations_guard)');
select lives_ok($$ update public.valuations set status = '監造審核'
  where id = '32000000-0000-0000-0000-000000000001' $$, '廠商仍可送監造審核');

select pg_temp.become('cccccccc-cccc-cccc-cccc-ccccccccccc3');
select throws_ok($$ update public.valuations set note = '機關越權改摘要'
  where id = '32000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '機關仍僅可碰請款/撥款欄位(valuations_guard)');

-- 送審中(非草稿的未核定狀態)一樣不得登錄金流
select throws_ok($$ update public.valuations set paid_amount = 123
  where id = '32000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '監造審核中同樣不可登錄實收');

select * from finish();
rollback;
