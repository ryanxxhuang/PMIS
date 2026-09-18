-- P5b 循環契約義務逐期追蹤(pgTAP)。
-- 對應 migration 20260917233000_obligation_periods.sql。
-- 釘六件事:1) 期次排程是確定性純函式(月末夾住、閏年 2 月、跨年、季／年／週／日、永遠含下一期、
-- 規則不完整或基準日缺失不產生);2) materialize 冪等、只補缺的期、基準日補上後立即補齊、規則變更
-- 只重建沒動過的待辦期;3) 完成本期不動下期、舊逾期保留、退回待辦解除證據;4) 權限矩陣(自己方／
-- 他方／非成員／責任不明／admin override／正式模式)、證據同案、直接寫表被擋、RLS 可見性沿用義務;
-- 5) 循環義務本身不可再標完成,廢止級聯只動待辦期;6) 回填規則(completed_at 對應期別,推不出標待核對)。
begin;

select plan(99);

-- ── 結構與授權 ──────────────────────────────────────────────────────────────
select has_table('public', 'obligation_periods', '期次表存在');
select has_function('public', 'materialize_obligation_periods', array['uuid'], 'materialize RPC 存在');
select has_function('public', 'transition_obligation_period', array['uuid','text','uuid','uuid'], '期次狀態轉移 RPC 存在');
select has_trigger('public', 'contract_obligations', 'contract_obligations_periods_sync', '義務插入／規則變更／廢止的同步 trigger 掛上');
select has_trigger('public', 'contract_obligations', 'contract_obligations_recurring_guard', '循環義務不可標完成的 guard 掛上');
select has_trigger('public', 'projects', 'projects_anchor_versions_sync', '基準日變更同步 trigger 掛上(P5c 起留版＋重算取代 P5b 的 projects_obligation_periods_sync)');
select is(has_table_privilege('authenticated', 'public.obligation_periods', 'SELECT'), true, 'authenticated 可讀期次');
select is(has_table_privilege('authenticated', 'public.obligation_periods', 'INSERT')
  or has_table_privilege('authenticated', 'public.obligation_periods', 'UPDATE')
  or has_table_privilege('authenticated', 'public.obligation_periods', 'DELETE'), false, 'authenticated 沒有任何寫入 grant(只走 RPC)');
select is((select provolatile from pg_proc where proname = 'fn_obligation_period_schedule' and pronamespace = 'public'::regnamespace), 'i', '期次排程函式 IMMUTABLE(確定性)');
select is((select count(*)::int from cron.job where jobname = 'pmis-obligation-periods'), 1, 'pg_cron 每日推進工作已排程');

-- ── 純函式:規則缺口與基準日欄位 ───────────────────────────────────────────────
select is(public.fn_obligation_recurrence_gap('monthly', null, null, null, null, null), '每月缺幾日', '每月缺日 → 規則缺口');
select is(public.fn_obligation_recurrence_gap('monthly', 5, null, null, null, null), null, '每月 5 日 → 完整');
select is(public.fn_obligation_recurrence_gap('quarterly', 10, null, null, null, null), '每季缺月份或日期', '每季缺月 → 規則缺口');
select is(public.fn_obligation_recurrence_gap('monthly', 5, null, null, 'fixed', null), '指定日期缺起算日', 'fixed 無日期 → 規則缺口');
select is(public.fn_obligation_recurrence_anchor_key(null), 'commencement_date', '無觸發點的循環從開工日起算');
select is(public.fn_obligation_recurrence_anchor_key('award'), 'award_date', 'award → 決標日');
select is(public.fn_obligation_recurrence_anchor_key('completion'), 'end_date', 'completion → 竣工日');
select is(public.fn_obligation_recurrence_anchor_key('fixed'), 'fixed_date', 'fixed → 義務自己的指定日期');

-- ── 純函式:期次排程 ───────────────────────────────────────────────────────────
select results_eq(
  $$ select period_key, period_start, period_end, due_date
     from public.fn_obligation_period_schedule('monthly', 31, null, null, '2026-01-15', '2026-04-10', 31) $$,
  $$ values ('2026-01', '2026-01-01'::date, '2026-01-31'::date, '2026-01-31'::date),
            ('2026-02', '2026-02-01'::date, '2026-02-28'::date, '2026-02-28'::date),
            ('2026-03', '2026-03-01'::date, '2026-03-31'::date, '2026-03-31'::date),
            ('2026-04', '2026-04-01'::date, '2026-04-30'::date, '2026-04-30'::date) $$,
  '每月 31 日:2 月夾到 28、4 月夾到 30;到前瞻窗口為止,已含今天之後的一期就停');
select results_eq(
  $$ select period_key, due_date from public.fn_obligation_period_schedule('monthly', 29, null, null, '2028-01-01', '2028-02-01', 31) $$,
  $$ values ('2028-01', '2028-01-29'::date), ('2028-02', '2028-02-29'::date) $$,
  '閏年:每月 29 日在 2028 年 2 月=2/29');
select results_eq(
  $$ select period_key, due_date from public.fn_obligation_period_schedule('monthly', 29, null, null, '2027-02-01', '2027-02-01', 31) $$,
  $$ values ('2027-02', '2027-02-28'::date) $$,
  '平年:每月 29 日在 2027 年 2 月夾到 2/28');
select results_eq(
  $$ select period_key, due_date from public.fn_obligation_period_schedule('monthly', 5, null, null, '2026-11-20', '2026-12-20', 31) $$,
  $$ values ('2026-12', '2026-12-05'::date), ('2027-01', '2027-01-05'::date) $$,
  '跨年:11 月 5 日早於基準日不列;12 月列;翌年 1 月是今天之後的一期');
select results_eq(
  $$ select period_key, due_date from public.fn_obligation_period_schedule('yearly', 15, null, 1, '2026-02-01', '2026-09-17', 31) $$,
  $$ values ('2027', '2027-01-15'::date) $$,
  '每年 1 月 15 日:前瞻窗口內沒有下一期時仍多列一期(永遠看得到下一期)');
select results_eq(
  $$ select period_key, period_start, period_end, due_date
     from public.fn_obligation_period_schedule('quarterly', 10, null, 2, '2026-01-01', '2026-05-01', 31) $$,
  $$ values ('2026-Q1', '2026-01-01'::date, '2026-03-31'::date, '2026-02-10'::date),
            ('2026-Q2', '2026-04-01'::date, '2026-06-30'::date, '2026-05-10'::date) $$,
  '每季第 2 個月 10 日:Q1=2/10、Q2=5/10;期間是整季');
select results_eq(
  $$ select period_key, due_date from public.fn_obligation_period_schedule('quarterly', 31, null, 2, '2026-01-01', '2026-01-01', 31) $$,
  $$ values ('2026-Q1', '2026-02-28'::date) $$,
  '每季第 2 個月 31 日:Q1 的 2 月夾到 2/28');
select results_eq(
  $$ select period_key, period_start, period_end, due_date
     from public.fn_obligation_period_schedule('weekly', null, 3, null, '2026-09-17', '2026-09-17', 7) $$,
  $$ values ('2026-W39', '2026-09-21'::date, '2026-09-27'::date, '2026-09-23'::date) $$,
  '每週三(ISO 3):基準日週四 → 本週三已過不列,下週三列;鍵是 ISO 週、期間週一到週日');
select is((select count(*)::int from public.fn_obligation_period_schedule('daily', null, null, null, '2026-09-15', '2026-09-17', 2)), 5,
  '每日:基準日到今天＋2 日共 5 期');
select results_eq(
  $$ select min(period_key), max(period_key) from public.fn_obligation_period_schedule('daily', null, null, null, '2026-09-15', '2026-09-17', 2) $$,
  $$ values ('2026-09-15', '2026-09-19') $$,
  '每日:鍵是 YYYY-MM-DD,從基準日起');
select is((select count(*)::int from public.fn_obligation_period_schedule('monthly', null, null, null, '2026-01-01', '2026-09-17', 31)), 0,
  '規則不完整(每月缺日)不產生期次,不臆測日期');
select is((select count(*)::int from public.fn_obligation_period_schedule('monthly', 5, null, null, null, '2026-09-17', 31)), 0,
  '基準日缺失不產生期次');

-- ── 測試資料 ──────────────────────────────────────────────────────────────────
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c5b00000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5b-contractor@example.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now()),
  ('c5b00000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5b-supervisor@example.test', '', now(), '{}',
   '{"full_name":"Supervisor","org_type":"supervisor"}', now(), now()),
  ('c5b00000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5b-owner@example.test', '', now(), '{}',
   '{"full_name":"Owner","org_type":"owner"}', now(), now()),
  ('c5b00000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5b-outsider@example.test', '', now(), '{}',
   '{"full_name":"Outsider","org_type":"contractor"}', now(), now()),
  ('c5b00000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p5b-admin@example.test', '', now(), '{}',
   '{"full_name":"Admin (contractor org)","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, owner_name, contractor_name, supervisor_name, created_by,
                             award_date, notice_date, commencement_date, end_date)
values
  -- 竣工日(完工期限)自 P5c 起是循環期次的界限日:沒有它(且未登錄竣工)不產生期次;這裡給遠期日期讓期次照 P5b 規則產生。
  ('c5b10000-0000-0000-0000-000000000001', '循環期次測試案', '機關', '廠商', '監造',
   'c5b00000-0000-0000-0000-0000000000a5', '2026-01-10', '2026-01-20', '2026-02-20', '2028-12-31'),
  ('c5b10000-0000-0000-0000-000000000002', '別案', '機關', '廠商', '監造',
   'c5b00000-0000-0000-0000-0000000000a4', '2026-01-10', '2026-01-20', '2026-02-20', '2028-12-31'),
  ('c5b10000-0000-0000-0000-000000000003', '基準日未設案', '機關', '廠商', '監造',
   'c5b00000-0000-0000-0000-0000000000a5', null, null, null, '2028-12-31');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('c5b10000-0000-0000-0000-000000000001', 'c5b00000-0000-0000-0000-0000000000a1', 'member'),
  ('c5b10000-0000-0000-0000-000000000001', 'c5b00000-0000-0000-0000-0000000000a2', 'member'),
  ('c5b10000-0000-0000-0000-000000000001', 'c5b00000-0000-0000-0000-0000000000a3', 'member'),
  ('c5b10000-0000-0000-0000-000000000001', 'c5b00000-0000-0000-0000-0000000000a5', 'admin'),
  ('c5b10000-0000-0000-0000-000000000002', 'c5b00000-0000-0000-0000-0000000000a4', 'admin'),
  ('c5b10000-0000-0000-0000-000000000003', 'c5b00000-0000-0000-0000-0000000000a3', 'member'),
  ('c5b10000-0000-0000-0000-000000000003', 'c5b00000-0000-0000-0000-0000000000a5', 'admin');

insert into public.submittals (id, project_id, submittal_no, title, status) values
  ('c5b40000-0000-0000-0000-000000000001', 'c5b10000-0000-0000-0000-000000000001', 'SUB-P5B-1', '施工月報 4 月', '已提送'),
  ('c5b40000-0000-0000-0000-000000000002', 'c5b10000-0000-0000-0000-000000000002', 'SUB-P5B-2', '別案送審', '已提送');

-- 義務列強制掛 requirement(requirement_id not null + 一對一):先種對應需求列。
insert into public.requirements (id, project_id, title, requirement_type) values
  ('c5b20000-0000-0000-0000-000000000001', 'c5b10000-0000-0000-0000-000000000001', '每月施工月報', 'deadline'),
  ('c5b20000-0000-0000-0000-000000000002', 'c5b10000-0000-0000-0000-000000000001', '每月監造月報', 'deadline'),
  ('c5b20000-0000-0000-0000-000000000003', 'c5b10000-0000-0000-0000-000000000003', '每月撥付', 'deadline'),
  ('c5b20000-0000-0000-0000-000000000004', 'c5b10000-0000-0000-0000-000000000001', '每月缺日的義務', 'deadline'),
  ('c5b20000-0000-0000-0000-000000000005', 'c5b10000-0000-0000-0000-000000000001', '單次義務', 'deadline'),
  ('c5b20000-0000-0000-0000-000000000006', 'c5b10000-0000-0000-0000-000000000001', '責任不明的循環義務', 'deadline'),
  ('c5b20000-0000-0000-0000-000000000007', 'c5b10000-0000-0000-0000-000000000001', '舊資料:有完成時間', 'deadline'),
  ('c5b20000-0000-0000-0000-000000000008', 'c5b10000-0000-0000-0000-000000000001', '舊資料:無完成時間', 'deadline');

-- OB1 每月 5 日(廠商;無觸發點 → 開工日 2026-02-20 起算);OB2 每月 31 日(監造;接獲開工通知 2026-01-20 起算);
-- OB3 每月 10 日(機關;開工觸發但專案沒開工日);OB4 每月缺日;OB5 單次 fixed;OB6 責任不明的每月 5 日(決標起算)。
insert into public.contract_obligations (id, project_id, requirement_id, title, responsible, status, trigger_event, recurring, recurring_day, fixed_date) values
  ('c5b30000-0000-0000-0000-000000000001', 'c5b10000-0000-0000-0000-000000000001', 'c5b20000-0000-0000-0000-000000000001', '每月施工月報', '廠商', '待辦', null, 'monthly', 5, null),
  ('c5b30000-0000-0000-0000-000000000002', 'c5b10000-0000-0000-0000-000000000001', 'c5b20000-0000-0000-0000-000000000002', '每月監造月報', '監造', '待辦', 'notice', 'monthly', 31, null),
  ('c5b30000-0000-0000-0000-000000000003', 'c5b10000-0000-0000-0000-000000000003', 'c5b20000-0000-0000-0000-000000000003', '每月撥付', '機關', '待辦', 'commencement', 'monthly', 10, null),
  ('c5b30000-0000-0000-0000-000000000004', 'c5b10000-0000-0000-0000-000000000001', 'c5b20000-0000-0000-0000-000000000004', '每月缺日的義務', '廠商', '待辦', null, 'monthly', null, null),
  ('c5b30000-0000-0000-0000-000000000005', 'c5b10000-0000-0000-0000-000000000001', 'c5b20000-0000-0000-0000-000000000005', '單次義務', '廠商', '待辦', 'fixed', null, null, '2026-06-30'),
  ('c5b30000-0000-0000-0000-000000000006', 'c5b10000-0000-0000-0000-000000000001', 'c5b20000-0000-0000-0000-000000000006', '責任不明的循環義務', null, '待辦', 'award', 'monthly', 5, null);

-- ── materialize:插入即物化、基準日缺失／規則不完整不產生、冪等 ──────────────────
select is((select due_date from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000001' and period_key = '2026-03'),
  '2026-03-05'::date, 'OB1 插入即由 trigger 物化:2026-03 期到期 3/5');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000001' and period_key = '2026-02'), 0,
  'OB1 的 2 月期(2/5)早於開工日 2/20 → 不產生');
select is((select period_start || '/' || period_end from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000001' and period_key = '2026-03'),
  '2026-03-01/2026-03-31', '期間是整個月');
select is((select due_date from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000002' and period_key = '2026-02'),
  '2026-02-28'::date, 'OB2 每月 31 日:2 月期夾到 2/28(接獲開工通知 1/20 起算)');
select is((select due_date from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000002' and period_key = '2026-04'),
  '2026-04-30'::date, 'OB2 每月 31 日:4 月期夾到 4/30');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000003'), 0,
  'OB3 觸發點對應的開工日沒填 → 不產生期次(基準日待補)');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000004'), 0,
  'OB4 每月缺日 → 不產生期次(循環規則待補)');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000005'), 0,
  'OB5 單次義務沒有期次');
select ok((select count(*) from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000006') > 0,
  'OB6 責任不明的循環義務照樣產生期次(物化不看責任方,誰可標記由 RPC 決定)');
select ok((select max(due_date) from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000001') > public.fn_taipei_today(),
  '永遠含今天之後的一期');
select is(public.fn_materialize_obligation_periods_for('c5b30000-0000-0000-0000-000000000001'), 0, '再物化同一義務:0 筆新增(冪等)');
select is(public.fn_materialize_obligation_periods('c5b10000-0000-0000-0000-000000000001'), 0, '再物化整案:0 筆新增(冪等)');
select is(public.materialize_all_obligation_periods(), 0, '全案每日推進再跑一次:0 筆新增(冪等)');

-- 基準日補上 → trigger 立即補齊
update public.projects set commencement_date = '2026-03-15' where id = 'c5b10000-0000-0000-0000-000000000003';
select is((select due_date from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000003' and period_key = '2026-04'),
  '2026-04-10'::date, '開工日補上後,OB3 的 4 月期立即出現');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000003' and period_key = '2026-03'), 0,
  'OB3 的 3 月期(3/10)早於開工日 3/15 → 不產生');

-- 模擬登入者(同時設新舊兩種 claim 形式,相容不同版本的 auth.uid())
create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims',
    case when u is null then ''
         else json_build_object('sub', u::text, 'role', 'authenticated')::text end, true);
end $$;
create or replace function pg_temp.period_id(ob uuid, k text) returns uuid language sql as $$
  select id from public.obligation_periods where obligation_id = ob and period_key = k
$$;

-- ── RLS 可見性沿用義務 ───────────────────────────────────────────────────────────
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select ok((select count(*) from public.obligation_periods where project_id = 'c5b10000-0000-0000-0000-000000000001') > 0,
  '成員看得到本案期次');
select is((select count(*)::int from public.obligation_periods where project_id = 'c5b10000-0000-0000-0000-000000000003'), 0,
  '非成員案的期次看不到(policy 經義務 RLS 過濾)');
select throws_ok($$ insert into public.obligation_periods (project_id, obligation_id, period_key, period_start, period_end, due_date)
  values ('c5b10000-0000-0000-0000-000000000001', 'c5b30000-0000-0000-0000-000000000001', '2099-01', '2099-01-01', '2099-01-31', '2099-01-05') $$,
  '42501', null, 'authenticated 直接 insert 期次被擋');
select throws_ok($$ update public.obligation_periods set status = '已完成' where obligation_id = 'c5b30000-0000-0000-0000-000000000001' $$,
  '42501', null, 'authenticated 直接 update 期次被擋(只能走 RPC)');
select lives_ok($$ select public.materialize_obligation_periods('c5b10000-0000-0000-0000-000000000001') $$, '成員可呼叫 materialize RPC(冪等補齊)');
select throws_ok($$ select public.materialize_obligation_periods('c5b10000-0000-0000-0000-000000000003') $$,
  'P0001', 'project not found or not a member', '非成員呼叫 materialize RPC 被拒');
reset role;

-- ── 狀態轉移:自己方可標;本期完成不動下期、舊逾期保留;退回解除證據 ──────────────
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04'), '已提送', 'c5b40000-0000-0000-0000-000000000001', null) $$,
  '廠商標記自己方義務的 2026-04 期已提送並掛送審佐證');
reset role;
select is((select status from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04')), '已提送', '2026-04 期狀態=已提送');
select is((select completed_by from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04')),
  'c5b00000-0000-0000-0000-0000000000a1'::uuid, '完成人由伺服器蓋(auth.uid())');
select isnt((select completed_at from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04')), null, '完成時間由伺服器蓋');
select is((select evidence_submittal_id from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04')),
  'c5b40000-0000-0000-0000-000000000001'::uuid, '證據掛上');
select is((select status from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-05')), '待辦', '完成本期不動下期(2026-05 仍待辦)');
select is((select status from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-03')), '待辦', '舊逾期保留(2026-03 仍待辦,不因下期出現而消失)');

-- 已提送 → 已完成:同一次履行的升級,不重蓋時間戳
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a1');
set local role authenticated;
create temp table p5b_stamp as select completed_at from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04');
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04'), '已完成') $$, '已提送 → 已完成');
reset role;
select is((select completed_at from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04')),
  (select completed_at from p5b_stamp), '已提送→已完成不重蓋完成時間(準時率不失真)');

-- 退回待辦:清時間戳、解除證據(W-01)
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04'), '待辦') $$, '退回待辦');
reset role;
select is((select completed_at from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04')), null, '退回後完成時間清空');
select is((select evidence_submittal_id from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04')), null, '退回後證據解除(證據是那次提送的證據)');

-- 再標一次(後面規則變更要驗「動過的期保留」)
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04'), '已提送') $$, '再標 2026-04 已提送');
reset role;

-- ── 權限矩陣 ────────────────────────────────────────────────────────────────────
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-05'), '已提送') $$,
  'P0001', '只有責任方可標記此期次', '監造不能標廠商的期次');
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000002', '2026-03'), '已完成') $$,
  '監造可標自己方(監造)義務的期次');
reset role;
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a3');
set local role authenticated;
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-05'), '已提送') $$,
  'P0001', '只有責任方可標記此期次', '機關不能標廠商的期次');
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000003', '2026-04'), '已完成') $$,
  '機關可標自己方(機關)義務的期次(基準日補上後產生的期)');
reset role;
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a4');
set local role authenticated;
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-05'), '已提送') $$,
  'P0001', 'obligation period not found', '非成員看不到也標不到(不洩漏存在)');
reset role;
select pg_temp.become(null);
set local role authenticated;
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-05'), '已提送') $$,
  'P0001', 'not authenticated', '未登入不可標記');
reset role;
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-05'), '完成了') $$,
  'P0001', 'unknown obligation period status: 完成了', '未知狀態值被拒');
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-05'), '已提送', 'c5b40000-0000-0000-0000-000000000002', null) $$,
  'P0001', '佐證送審文件不屬於本案', '別案的送審文件不能當佐證');
-- 責任不明:三方都不能標
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000006', '2026-03'), '已提送') $$,
  'P0001', '只有責任方可標記此期次', '責任不明的循環義務:廠商不能標(不再落回廠商)');
reset role;
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000006', '2026-03'), '已提送') $$,
  'P0001', '只有責任方可標記此期次', '責任不明的循環義務:監造不能標');
reset role;
-- admin override(非正式模式)可跨方(正式模式失效的斷言在檔尾:正式模式開啟後不可關閉)
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000006', '2026-03'), '已提送') $$,
  'admin override(非正式模式)可標責任不明的期次');
reset role;
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-05'), '已提送') $$,
  '廠商再標 2026-05 已提送(後面驗規則變更保留動過的期)');
reset role;

-- ── 義務本身不可再標完成;廢止級聯只動待辦期 ──────────────────────────────────────
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$ update public.contract_obligations set status = '已提送' where id = 'c5b30000-0000-0000-0000-000000000001' $$,
  'P0001', null, '循環義務本身不可標已提送(舊前端／直接 REST 明確失敗)');
select lives_ok($$ update public.contract_obligations set status = '已提送' where id = 'c5b30000-0000-0000-0000-000000000005' $$,
  '單次義務照舊可標已提送');
reset role;
select is((select status from public.contract_obligations where id = 'c5b30000-0000-0000-0000-000000000005'), '已提送', '單次義務狀態已寫入');

update public.contract_obligations set status = '不適用' where id = 'c5b30000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000002' and status = '待辦'), 0,
  '義務廢止(不適用)→ 仍待辦的期次全部不適用');
select is((select status from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000002', '2026-03')), '已完成',
  '廢止不動已完成的期(歷史保留)');
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000002', '2026-04'), '待辦') $$,
  'P0001', '義務已不適用,期次不可再變更', '不適用義務的期次不可再動');
reset role;

-- ── 規則變更:只重建沒動過的待辦期,動過的保留 ───────────────────────────────────
update public.contract_obligations set recurring_day = 20 where id = 'c5b30000-0000-0000-0000-000000000001';
select is((select due_date from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-03')),
  '2026-03-20'::date, '規則改為每月 20 日:沒動過的 2026-03 期重建為 3/20');
select is((select due_date || '/' || status from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-04')),
  '2026-04-05/已提送', '已提送的 2026-04 期原樣保留(到期日仍是舊規則的 4/5)');
select is((select due_date || '/' || status from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-05')),
  '2026-05-05/已提送', '標過的 2026-05 期原樣保留');

-- ── 回填:舊資料的義務層完成狀態對應到期別 ─────────────────────────────────────────
-- OB7 已完成且 completed_at=台北 2026-04-03 → 對應 2026-04 期;OB8 已完成但無 completed_at → 待核對。
insert into public.contract_obligations (id, project_id, requirement_id, title, responsible, status, trigger_event, recurring, recurring_day, completed_at, completed_by, evidence_submittal_id) values
  ('c5b30000-0000-0000-0000-000000000007', 'c5b10000-0000-0000-0000-000000000001', 'c5b20000-0000-0000-0000-000000000007', '舊資料:有完成時間', '廠商', '已完成', 'award', 'monthly', 5,
   '2026-04-02T18:00:00Z', 'c5b00000-0000-0000-0000-0000000000a1', 'c5b40000-0000-0000-0000-000000000001'),
  ('c5b30000-0000-0000-0000-000000000008', 'c5b10000-0000-0000-0000-000000000001', 'c5b20000-0000-0000-0000-000000000008', '舊資料:無完成時間', '廠商', '已完成', 'award', 'monthly', 5, null, null, null);
select is(public.fn_backfill_obligation_period_completion('c5b30000-0000-0000-0000-000000000007'), 'mapped', '有 completed_at → 對應到期別');
select is((select status || '/' || completed_at::text from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000007', '2026-04')),
  '已完成/' || ('2026-04-02T18:00:00Z'::timestamptz)::text, '2026-04 期承接義務的狀態與完成時間(UTC 4/2 18:00=台北 4/3)');
select is((select evidence_submittal_id from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000007', '2026-04')),
  'c5b40000-0000-0000-0000-000000000001'::uuid, '義務層的送審佐證一併帶到該期');
select is((select status from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000007', '2026-03')), '待辦',
  '其他期不受影響(2026-03 仍待辦)');
select is((select basis ->> 'backfill' from public.obligation_periods where id = pg_temp.period_id('c5b30000-0000-0000-0000-000000000007', '2026-04')), 'completed_at',
  '回填依據寫進 basis');
select is(public.fn_backfill_obligation_period_completion('c5b30000-0000-0000-0000-000000000008'), 'review', '無 completed_at → 推不出期別,標待核對');
select ok((select count(*) from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000008' and review_note is not null and due_date <= public.fn_taipei_today()) > 0,
  '已到期的待辦期次帶待核對註記');
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000008' and review_note is not null and due_date > public.fn_taipei_today()), 0,
  '未到期的期次不標待核對');
select is((select status from public.contract_obligations where id = 'c5b30000-0000-0000-0000-000000000008'), '已完成', '推不出期別時義務原狀不動');
select is(public.fn_backfill_obligation_period_completion('c5b30000-0000-0000-0000-000000000005'), 'none', '單次義務不回填');
-- 人核對後標記該期 → 待核對註記解除
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$ select public.transition_obligation_period(
  (select id from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000008' and review_note is not null order by due_date limit 1), '已完成') $$,
  '廠商核對後標記待核對的期次');
reset role;
select is((select count(*)::int from public.obligation_periods where obligation_id = 'c5b30000-0000-0000-0000-000000000008' and status = '已完成' and review_note is not null), 0,
  '標記後待核對註記解除');

-- ── 正式模式:admin override 失效(放最後:正式模式開啟後不可關閉)─────────────────
update public.projects set formal_mode = true where id = 'c5b10000-0000-0000-0000-000000000001';
select pg_temp.become('c5b00000-0000-0000-0000-0000000000a5');
set local role authenticated;
select throws_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000006', '2026-04'), '已提送') $$,
  'P0001', '只有責任方可標記此期次', '正式模式下 admin override 失效:責任不明的期次無人可動');
select lives_ok($$ select public.transition_obligation_period(pg_temp.period_id('c5b30000-0000-0000-0000-000000000001', '2026-06'), '已提送') $$,
  '正式模式下 admin(廠商身分)仍可標廠商自己方的期次');
reset role;

select * from finish();
rollback;
