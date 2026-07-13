-- R4 金流流程順序(pgTAP):未請款不得收款 / 實收必有收款日 / 收款日≥請款日。
-- 執行:本地 supabase(colima)+容器內 psql,整份交易內執行並 rollback。
-- 對應 migration 20260712001800_payment_flow.sql。
begin;

select plan(11);

select has_function('public', 'valuations_payment_gate', '金流閘門函式存在');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pf-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pf-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by)
values ('26000000-0000-0000-0000-000000000001', '金流流程測試案', '機關', '廠商', '監造',
        'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4c1');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('26000000-0000-0000-0000-000000000001', 'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4c1', 'member'),
  ('26000000-0000-0000-0000-000000000001', 'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4c3', 'member');

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;

-- 已核定估驗(直接建;valuations_guard 只管 UPDATE 轉移,INSERT 已核定不受限)
select pg_temp.become('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4c1');
insert into public.valuations (id, project_id, period_no, status) values
  ('36000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000001', 1, '已核定');

-- 機關登錄金流
select pg_temp.become('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4c3');

-- (a) 未請款不得收款
select throws_ok($$ update public.valuations set paid_date = '2026-07-10'
  where id = '36000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '未填請款日 → 不可登錄收款日');
-- (b) 實收必有收款日
select throws_ok($$ update public.valuations set paid_amount = 10000
  where id = '36000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '未填收款日 → 不可登錄實收金額');

-- 請款日單獨可填
select lives_ok($$ update public.valuations set invoice_date = '2026-07-10'
  where id = '36000000-0000-0000-0000-000000000001' $$, '請款日可單獨登錄');

-- (c) 收款日不得早於請款日
select throws_ok($$ update public.valuations set paid_date = '2026-07-05'
  where id = '36000000-0000-0000-0000-000000000001' $$, 'P0001', null,
  '收款日早於請款日 → 擋下');

-- 合法序:請款 → 收款(≥請款)→ 實收
select lives_ok($$ update public.valuations set paid_date = '2026-07-12'
  where id = '36000000-0000-0000-0000-000000000001' $$, '收款日 ≥ 請款日 可登錄');
select lives_ok($$ update public.valuations set paid_amount = 10000
  where id = '36000000-0000-0000-0000-000000000001' $$, '有收款日後可登錄實收');

-- 清空永遠允許(退回核定前的正規動線)
select lives_ok($$ update public.valuations
  set invoice_date = null, paid_date = null, paid_amount = null
  where id = '36000000-0000-0000-0000-000000000001' $$, '清空三欄永遠允許');

-- 一次原子填齊(請款+收款+實收)也放行
select lives_ok($$ update public.valuations
  set invoice_date = '2026-07-10', paid_date = '2026-07-12', paid_amount = 10000
  where id = '36000000-0000-0000-0000-000000000001' $$, '一次填齊合法組合放行');

-- ── 回歸:未核定仍不得有任何金流(001100 不變) ────────────────────────────────
select pg_temp.become('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4c1');
insert into public.valuations (id, project_id, period_no, status) values
  ('36000000-0000-0000-0000-000000000002','26000000-0000-0000-0000-000000000001', 2, '草稿');
select pg_temp.become('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4c3');
select throws_ok($$ update public.valuations set invoice_date = '2026-07-10'
  where id = '36000000-0000-0000-0000-000000000002' $$, 'P0001', null,
  '未核定期仍不得登錄請款日(001100 回歸)');

-- service role 放行(支援端清理既有矛盾)
select pg_temp.become(null);
select lives_ok($$ update public.valuations set paid_amount = 5000, paid_date = null, invoice_date = null
  where id = '36000000-0000-0000-0000-000000000001' $$,
  'service role 放行(可清理/修正既有矛盾資料)');

select * from finish();
rollback;
