-- W5-2/D-020 focused pgTAP suite: Requirement is the contractual source of
-- truth; any approved Requirement becomes one compatibility obligation
-- runtime row (D-020 widened the adapter beyond requirement_type='deadline').
begin;

select plan(34);

create or replace function public.pmis_w52_login(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config(
    'request.jwt.claims',
    case when p_uid is null then ''
      else json_build_object('sub', p_uid, 'role', 'authenticated')::text end,
    true
  );
end; $$;

select public.pmis_w52_login(null);

select has_function('public', 'materialize_requirement_obligation', array['uuid'],
  'internal approved-Requirement adapter exists');
select hasnt_function('public', 'materialize_deadline_obligation', array['uuid'],
  'deadline-only adapter name is retired (D-020)');
select is((select count(*)::integer from pg_trigger
  where tgrelid = 'public.contract_obligations'::regclass
    and tgname = 'contract_obligations_sync_requirement' and not tgisinternal), 0,
  'old obligation-to-Requirement sync trigger is absent');
select is((select count(*)::integer from pg_trigger
  where tgrelid = 'public.contract_obligations'::regclass
    and tgname = 'contract_obligations_delete_requirement' and not tgisinternal), 0,
  'old obligation-delete trigger is absent');
select is(has_table_privilege('authenticated', 'public.contract_obligations', 'INSERT'), false,
  'authenticated users cannot insert compatibility obligations');
select is(has_table_privilege('authenticated', 'public.contract_obligations', 'DELETE'), false,
  'authenticated users cannot delete compatibility obligations');
select is(has_column_privilege('authenticated', 'public.contract_obligations', 'title', 'UPDATE'), false,
  'authenticated users cannot change contractual obligation content');
select is(has_column_privilege('authenticated', 'public.contract_obligations', 'status', 'UPDATE'), true,
  'authenticated users can update runtime status');
select is(has_column_privilege('authenticated', 'public.contract_obligations', 'evidence_submittal_id', 'UPDATE'), true,
  'authenticated users can update runtime evidence');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('52000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reviewer@w52.test', '', now(), '{}',
   '{"full_name":"W52 Reviewer","org_type":"supervisor"}', now(), now()),
  ('52000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'contractor@w52.test', '', now(), '{}',
   '{"full_name":"W52 Contractor","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name)
values ('52100000-0000-0000-0000-000000000001', 'W5-2 One-way Project');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('52100000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', 'member'),
  ('52100000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000002', 'admin');

insert into public.submittals (id, project_id, title) values
  ('52200000-0000-0000-0000-000000000001',
   '52100000-0000-0000-0000-000000000001', '品質計畫送審');

insert into public.requirements (
  id, project_id, title, description, requirement_type,
  responsible_party_type, lifecycle_phase, trigger_type, trigger_config,
  frequency_type, frequency_config, status, origin
) values
  ('52300000-0000-0000-0000-000000000001',
   '52100000-0000-0000-0000-000000000001', '非時程履約要求', null, 'inspection',
   'supervisor', '施工中', null, '{}', null, '{}', 'needs_review', 'manual'),
  ('52300000-0000-0000-0000-000000000002',
   '52100000-0000-0000-0000-000000000001', '被退回的期限', null, 'deadline',
   'contractor', '開工前', 'notice', '{"offset_days":7}', null, '{}', 'needs_review', 'manual'),
  ('52300000-0000-0000-0000-000000000003',
   '52100000-0000-0000-0000-000000000001', '開工後提送品質計畫', '契約原始說明', 'deadline',
   'contractor', '開工前', 'commencement', '{"offset_days":15,"offset_dir":"after"}',
   'monthly', '{"day":5}', 'needs_review', 'manual');

select public.pmis_w52_login('52000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  select public.review_requirement('52300000-0000-0000-0000-000000000001', 'approve')
$$, 'non-deadline Requirement can still be approved');
select results_eq(
  $$
    select title, category, trigger_event, offset_days, recurring,
           responsible, status, requirement_id::text
    from public.contract_obligations
    where requirement_id = '52300000-0000-0000-0000-000000000001'
  $$,
  $$ values (
    '非時程履約要求'::text, '施工中'::text, null::text,
    null::int, null::text, '監造'::text, '待辦'::text,
    '52300000-0000-0000-0000-000000000001'::text
  ) $$,
  'approved non-deadline Requirement materializes an undated obligation (D-020)'
);
select lives_ok($$
  select public.review_requirement('52300000-0000-0000-0000-000000000002', 'reject')
$$, 'deadline Requirement can be rejected');
select is((select count(*)::integer from public.contract_obligations
  where requirement_id = '52300000-0000-0000-0000-000000000002'), 0,
  'rejected deadline creates no obligation');
select lives_ok($$
  select public.review_requirement('52300000-0000-0000-0000-000000000003', 'approve')
$$, 'approved deadline materializes inside the controlled review transaction');
reset role;
select public.pmis_w52_login(null);

select results_eq(
  $$
    select title, category, trigger_event, offset_days, offset_dir,
           recurring, recurring_day, responsible, status, requirement_id::text
    from public.contract_obligations
    where requirement_id = '52300000-0000-0000-0000-000000000003'
  $$,
  $$ values (
    '開工後提送品質計畫'::text, '開工前'::text, 'commencement'::text,
    15, 'after'::text, 'monthly'::text, 5, '廠商'::text, '待辦'::text,
    '52300000-0000-0000-0000-000000000003'::text
  ) $$,
  'approved deadline fields map deterministically to the runtime row'
);

select public.pmis_w52_login('52000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$
  insert into public.contract_obligations
    (project_id, title, requirement_id)
  values ('52100000-0000-0000-0000-000000000001', '繞過 Requirement',
          '52300000-0000-0000-0000-000000000003')
$$, '42501', null, 'contractor cannot bypass Requirement with a direct insert');
select throws_ok($$
  update public.contract_obligations set title = '竄改契約內容'
  where requirement_id = '52300000-0000-0000-0000-000000000003'
$$, '42501', null, 'contractor cannot edit contractual content on the runtime row');
select lives_ok($$
  update public.contract_obligations
  set status = '已提送', evidence_submittal_id = '52200000-0000-0000-0000-000000000001'
  where requirement_id = '52300000-0000-0000-0000-000000000003'
$$, 'contractor can operate status and attach evidence');
reset role;
select public.pmis_w52_login(null);

update public.contract_obligations
set penalty = '逾期每日千分之一', note = '現場執行備註'
where requirement_id = '52300000-0000-0000-0000-000000000003';
update public.requirements
set title = '品質計畫修正版', trigger_config = '{"offset_days":20,"offset_dir":"before"}'
where id = '52300000-0000-0000-0000-000000000003';

select is(public.materialize_requirement_obligation(
  '52300000-0000-0000-0000-000000000003'),
  '52300000-0000-0000-0000-000000000003'::uuid,
  'materialization retry reuses the existing obligation identity');
select is((select count(*)::integer from public.contract_obligations
  where requirement_id = '52300000-0000-0000-0000-000000000003'), 1,
  'materialization retry creates no duplicate');
select results_eq(
  $$
    select title, offset_days, offset_dir, status, evidence_submittal_id::text,
           penalty, note
    from public.contract_obligations
    where requirement_id = '52300000-0000-0000-0000-000000000003'
  $$,
  $$ values (
    '品質計畫修正版'::text, 20, 'before'::text, '已提送'::text,
    '52200000-0000-0000-0000-000000000001'::text,
    '逾期每日千分之一'::text, '現場執行備註'::text
  ) $$,
  'retry refreshes contractual fields and preserves runtime status, evidence, penalty, and note'
);

update public.contract_obligations set status = '待辦'
where requirement_id = '52300000-0000-0000-0000-000000000003';
select public.pmis_w52_login('52000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  select public.review_requirement('52300000-0000-0000-0000-000000000003', 'supersede')
$$, 'superseding an approved deadline retires its open reminder runtime');
reset role;
select public.pmis_w52_login(null);

select results_eq(
  $$
    select r.status, o.status, o.evidence_submittal_id::text, o.penalty, o.note
    from public.requirements r
    join public.contract_obligations o on o.requirement_id = r.id
    where r.id = '52300000-0000-0000-0000-000000000003'
  $$,
  $$ values (
    'superseded'::text, '不適用'::text,
    '52200000-0000-0000-0000-000000000001'::text,
    '逾期每日千分之一'::text, '現場執行備註'::text
  ) $$,
  'supersede marks only the runtime state not applicable and preserves evidence/history'
);
select is((select count(*)::integer from public.contract_obligations
  where requirement_id = '52300000-0000-0000-0000-000000000003'), 1,
  'supersede preserves the compatibility row for audit history');

-- D-020:取代非期限型時,其義務列同樣退場(不再分型別)。
select public.pmis_w52_login('52000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  select public.review_requirement('52300000-0000-0000-0000-000000000001', 'supersede')
$$, 'superseding an approved non-deadline Requirement is a valid transition');
reset role;
select public.pmis_w52_login(null);
select is((select status from public.contract_obligations
  where requirement_id = '52300000-0000-0000-0000-000000000001'), '不適用',
  'superseding a non-deadline Requirement retires its obligation runtime');

-- 頻率值域擴充:daily/weekly/quarterly/yearly 的 frequency_config 逐型映射到
-- 義務列的循環欄位;值域外的 config 映成 null(義務保留、推不出到期日)。
insert into public.requirements (
  id, project_id, title, requirement_type, responsible_party_type,
  lifecycle_phase, trigger_type, trigger_config,
  frequency_type, frequency_config, status, origin
) values
  ('52300000-0000-0000-0000-000000000011',
   '52100000-0000-0000-0000-000000000001', '每週工安會議', 'deadline',
   'contractor', '施工中', null, '{}', 'weekly', '{"weekday":3}', 'needs_review', 'manual'),
  ('52300000-0000-0000-0000-000000000012',
   '52100000-0000-0000-0000-000000000001', '每季設備保養紀錄', 'deadline',
   'contractor', '施工中', null, '{}', 'quarterly', '{"month":2,"day":10}', 'needs_review', 'manual'),
  ('52300000-0000-0000-0000-000000000013',
   '52100000-0000-0000-0000-000000000001', '每年防災演練', 'deadline',
   'contractor', '施工中', null, '{}', 'yearly', '{"month":3,"day":31}', 'needs_review', 'manual'),
  ('52300000-0000-0000-0000-000000000014',
   '52100000-0000-0000-0000-000000000001', '每日施工日誌(壞 config)', 'deadline',
   'contractor', '施工中', null, '{}', 'daily', '{"weekday":9,"month":15,"day":40}', 'needs_review', 'manual');

select public.pmis_w52_login('52000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  select public.review_requirement('52300000-0000-0000-0000-000000000011', 'approve')
$$, 'weekly deadline can be approved and materialized');
select lives_ok($$
  select public.review_requirement('52300000-0000-0000-0000-000000000012', 'approve')
$$, 'quarterly deadline can be approved and materialized');
select lives_ok($$
  select public.review_requirement('52300000-0000-0000-0000-000000000013', 'approve')
$$, 'yearly deadline can be approved and materialized');
select lives_ok($$
  select public.review_requirement('52300000-0000-0000-0000-000000000014', 'approve')
$$, 'daily deadline can be approved and materialized');
reset role;
select public.pmis_w52_login(null);

select results_eq(
  $$
    select recurring, recurring_day, recurring_weekday, recurring_month
    from public.contract_obligations
    where requirement_id = '52300000-0000-0000-0000-000000000011'
  $$,
  $$ values ('weekly'::text, null::int, 3, null::int) $$,
  'weekly frequency maps weekday only'
);
select results_eq(
  $$
    select recurring, recurring_day, recurring_weekday, recurring_month
    from public.contract_obligations
    where requirement_id = '52300000-0000-0000-0000-000000000012'
  $$,
  $$ values ('quarterly'::text, 10, null::int, 2) $$,
  'quarterly frequency maps month-in-quarter and day'
);
select results_eq(
  $$
    select recurring, recurring_day, recurring_weekday, recurring_month
    from public.contract_obligations
    where requirement_id = '52300000-0000-0000-0000-000000000013'
  $$,
  $$ values ('yearly'::text, 31, null::int, 3) $$,
  'yearly frequency maps month and day'
);
select results_eq(
  $$
    select recurring, recurring_day, recurring_weekday, recurring_month
    from public.contract_obligations
    where requirement_id = '52300000-0000-0000-0000-000000000014'
  $$,
  $$ values ('daily'::text, null::int, null::int, null::int) $$,
  'daily frequency keeps the recurrence and drops out-of-domain config fields'
);

select * from finish();
rollback;
