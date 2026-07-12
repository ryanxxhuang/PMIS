-- P0-05 focused pgTAP suite: persistent, server-generated, append-only audit
-- events with project-scoped actor snapshots. This intentionally does not
-- repeat the full P0-04 authorization matrix.
begin;

select plan(46);

create or replace function public.pmis_p05_login(p_uid uuid)
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

select public.pmis_p05_login(null);

-- Structure and privilege contract.
select has_table('public', 'audit_events', 'persistent audit_events table exists');
select has_column('public', 'audit_events', 'actor_project_role',
  'actor project role is snapshotted');
select has_column('public', 'audit_events', 'before_data',
  'before_data evidence snapshot exists');
select has_column('public', 'audit_events', 'correlation_id',
  'optional correlation id exists');
select has_function('public', 'record_audit_event',
  array['uuid','text','text','uuid','text','jsonb','jsonb','jsonb','uuid'],
  'controlled audit insertion helper exists');
select is(has_table_privilege('authenticated', 'public.audit_events', 'INSERT'), false,
  'authenticated has no direct audit INSERT privilege');
select is(has_table_privilege('authenticated', 'public.audit_events', 'UPDATE'), false,
  'authenticated has no audit UPDATE privilege');
select is(has_table_privilege('authenticated', 'public.audit_events', 'DELETE'), false,
  'authenticated has no audit DELETE privilege');

-- Deterministic users and two projects. Ryan represents contractor on A and
-- supervision on B, proving actor resolution is project-scoped.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c5000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'agency@p05.test', '', now(), '{}',
   '{"full_name":"Agency PM","org_type":"owner"}', now(), now()),
  ('c5000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'contractor@p05.test', '', now(), '{}',
   '{"full_name":"Contractor PM","org_type":"contractor"}', now(), now()),
  ('c5000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'supervisor@p05.test', '', now(), '{}',
   '{"full_name":"Supervisor Engineer","org_type":"supervisor"}', now(), now()),
  ('c5000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ryan@p05.test', '', now(), '{}',
   '{"full_name":"Ryan","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('c5100000-0000-0000-0000-00000000000a', 'P0-05 Project A'),
  ('c5100000-0000-0000-0000-00000000000b', 'P0-05 Project B');
alter table public.projects enable trigger on_project_created;

insert into public.project_parties (id, project_id, party_type, display_name) values
  ('c5200000-0000-0000-0000-000000000001', 'c5100000-0000-0000-0000-00000000000a', 'agency', 'P05 Agency A'),
  ('c5200000-0000-0000-0000-000000000002', 'c5100000-0000-0000-0000-00000000000a', 'contractor', 'P05 Builder A'),
  ('c5200000-0000-0000-0000-000000000003', 'c5100000-0000-0000-0000-00000000000a', 'supervisor', 'P05 Supervisor A'),
  ('c5200000-0000-0000-0000-000000000004', 'c5100000-0000-0000-0000-00000000000b', 'supervisor', 'P05 Supervisor B');

insert into public.project_memberships
  (project_id, user_id, project_party_id, project_role, is_project_admin) values
  ('c5100000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000001',
   'c5200000-0000-0000-0000-000000000001', 'agency_pm', true),
  ('c5100000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000002',
   'c5200000-0000-0000-0000-000000000002', 'contractor_pm', true),
  ('c5100000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000003',
   'c5200000-0000-0000-0000-000000000003', 'supervisor_engineer', false),
  ('c5100000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000004',
   'c5200000-0000-0000-0000-000000000002', 'contractor_pm', false),
  ('c5100000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-000000000004',
   'c5200000-0000-0000-0000-000000000004', 'supervisor_engineer', true);

-- baseline 相容:批3(authority cutover)前,RLS 的 my_project_ids()/is_project_admin()
-- 讀 project_members;鏡像 memberships 播種(admin 對映 role='admin')。批3後此表仍在,無害。
insert into public.project_members (project_id, user_id, role) values
  ('c5100000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000001', 'admin'),
  ('c5100000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000002', 'admin'),
  ('c5100000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000003', 'member'),
  ('c5100000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-000000000004', 'member'),
  ('c5100000-0000-0000-0000-00000000000b', 'c5000000-0000-0000-0000-000000000004', 'admin');

insert into public.valuations (id, project_id, period_no, status) values
  ('c5300000-0000-0000-0000-000000000001', 'c5100000-0000-0000-0000-00000000000a', 1, '草稿');
insert into public.inspections (id, project_id, title, status) values
  ('c5400000-0000-0000-0000-000000000001', 'c5100000-0000-0000-0000-00000000000a', 'A案查驗', '待查驗'),
  ('c5400000-0000-0000-0000-000000000002', 'c5100000-0000-0000-0000-00000000000b', 'B案查驗', '待查驗');
insert into public.requirements (id, project_id, title, requirement_type, status, origin) values
  ('c5500000-0000-0000-0000-000000000001', 'c5100000-0000-0000-0000-00000000000a', '材料送審需求', 'submittal', 'needs_review', 'manual');
insert into public.change_orders (id, project_id, title, status) values
  ('c5600000-0000-0000-0000-000000000001', 'c5100000-0000-0000-0000-00000000000a', '追加擋土措施', '提出');
insert into public.cost_items (id, project_id, category, title, budget_amount, actual_amount) values
  ('c5700000-0000-0000-0000-000000000001', 'c5100000-0000-0000-0000-00000000000a',
   '分包', 'Private Cost P05', 9000, 8000);

-- Discard fixture-created system events; assertions below cover user actions.
-- 新語義下 append-only 對 service 路徑也生效;測試清場走明確的 DBA 邊界(disable trigger)。
alter table public.audit_events disable trigger audit_events_immutable;
delete from public.audit_events;
alter table public.audit_events enable trigger audit_events_immutable;

-- Ryan submits on A as contractor PM.
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000004');
set local role authenticated;
select lives_ok($$
  update public.valuations set status = '監造審核'
  where id = 'c5300000-0000-0000-0000-000000000001'
$$, 'contractor submits valuation');
select throws_ok($$
  update public.valuations set status = '已核定'
  where id = 'c5300000-0000-0000-0000-000000000001'
$$, 'P0001', null,
  'failed contractor approval rolls back without an audit event');
reset role;
select public.pmis_p05_login(null);
select is((select count(*)::integer from public.audit_events
  where event_type = 'valuation.submitted'), 1,
  'valuation submission creates exactly one semantic event');
select is((select count(*)::integer from public.audit_events
  where event_type = 'valuation.approved'), 0,
  'failed transition leaves no approval audit event');
select results_eq($$
  select actor_party_type, actor_project_role, actor_is_project_admin
  from public.audit_events where event_type = 'valuation.submitted'
$$, $$ values ('contractor'::text, 'contractor_pm'::text, false) $$,
  'submission snapshots contractor identity and separate admin state');
select is((select before_data->>'status' from public.audit_events
  where event_type = 'valuation.submitted'), '草稿',
  'valuation event preserves authoritative before state');
select is((select after_data->>'status' from public.audit_events
  where event_type = 'valuation.submitted'), '監造審核',
  'valuation event preserves authoritative after state');

-- Supervisor approval and inspection decision.
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$
  update public.valuations set status = '已核定'
  where id = 'c5300000-0000-0000-0000-000000000001'
$$, 'supervisor approves valuation');
select lives_ok($$
  update public.inspections
  set status = '合格', result_note = '符合規範', inspected_at = now()
  where id = 'c5400000-0000-0000-0000-000000000001'
$$, 'supervisor decides inspection');
reset role;
select public.pmis_p05_login(null);
select results_eq($$
  select event_type, actor_party_type, actor_project_role
  from public.audit_events where event_type = 'valuation.approved'
$$, $$ values ('valuation.approved'::text, 'supervisor'::text, 'supervisor_engineer'::text) $$,
  'valuation approval snapshots supervisor identity');
select is((select after_data->>'result_note' from public.audit_events
  where event_type = 'inspection.decided'), '符合規範',
  'inspection decision preserves decision evidence');

-- Contractor creates a fresh request; technical admin is captured separately.
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$
  insert into public.inspections (id, project_id, title, status)
  values ('c5400000-0000-0000-0000-000000000003',
          'c5100000-0000-0000-0000-00000000000a', '新查驗申請', '待查驗')
$$, 'contractor creates inspection request');
reset role;
select public.pmis_p05_login(null);
select results_eq($$
  select actor_party_type, actor_project_role, actor_is_project_admin
  from public.audit_events
  where event_type = 'inspection.created'
    and entity_id = 'c5400000-0000-0000-0000-000000000003'
$$, $$ values ('contractor'::text, 'contractor_pm'::text, true) $$,
  'inspection creation snapshots contractor PM plus technical-admin flag');

-- Requirement review and change-order governance.
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000001');
set local role authenticated;
-- [批4後啟用] review_requirement RPC 屬 P0-07(requirement review boundary),批4恢復後解開:
-- select lives_ok($$
--   select public.review_requirement(
--     'c5500000-0000-0000-0000-000000000001', 'approve')
-- $$, 'agency reviewer approves requirement');
reset role;
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$
  update public.change_orders set status = '審核中'
  where id = 'c5600000-0000-0000-0000-000000000001'
$$, 'supervisor starts change-order review');
reset role;
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  update public.change_orders set status = '核准'
  where id = 'c5600000-0000-0000-0000-000000000001'
$$, 'agency ratifies change order');
reset role;
select public.pmis_p05_login(null);
-- [批4後啟用] 依賴上方 review_requirement 的核准事件:
-- select is((select entity_id from public.audit_events
--   where event_type = 'requirement.approved'),
--   'c5500000-0000-0000-0000-000000000001'::uuid,
--   'requirement approval references the authoritative Requirement');
select is((select count(*)::integer from public.audit_events
  where event_type = 'change_order.review_started'), 1,
  'review start creates one semantic change-order event');
select is((select count(*)::integer from public.audit_events
  where event_type = 'change_order.approved'), 1,
  'agency approval creates one semantic change-order event');

-- Same user, different project identity.
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000004');
set local role authenticated;
select lives_ok($$
  update public.inspections set status = '合格', inspected_at = now()
  where id = 'c5400000-0000-0000-0000-000000000002'
$$, 'Ryan decides Project B inspection as supervisor');
reset role;
select public.pmis_p05_login(null);
select results_eq($$
  select project_id, actor_party_type, actor_project_role
  from public.audit_events
  where actor_user_id = 'c5000000-0000-0000-0000-000000000004'
    and event_type in ('valuation.submitted','inspection.decided')
  order by project_id
$$, $$ values
  ('c5100000-0000-0000-0000-00000000000a'::uuid, 'contractor'::text, 'contractor_pm'::text),
  ('c5100000-0000-0000-0000-00000000000b'::uuid, 'supervisor'::text, 'supervisor_engineer'::text)
$$, 'actor snapshot follows project identity without cross-project leakage');

-- A later role change must not rewrite historical events.
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$
  update public.project_memberships set project_role = 'site_manager'
  where project_id = 'c5100000-0000-0000-0000-00000000000a'
    and user_id = 'c5000000-0000-0000-0000-000000000004'
$$, 'technical admin changes another member role');
reset role;
select public.pmis_p05_login(null);
select is((select project_role from public.project_memberships
  where project_id = 'c5100000-0000-0000-0000-00000000000a'
    and user_id = 'c5000000-0000-0000-0000-000000000004'),
  'site_manager', 'current membership reflects later role change');
select is((select actor_project_role from public.audit_events
  where event_type = 'valuation.submitted'),
  'contractor_pm', 'historical event retains original contractor PM role');

-- Self-demotion captures the identity that authorized the action, not the
-- post-change admin flag.
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$
  update public.project_memberships set is_project_admin = false
  where project_id = 'c5100000-0000-0000-0000-00000000000a'
    and user_id = 'c5000000-0000-0000-0000-000000000002'
$$, 'admin may demote self while another technical admin remains');
reset role;
select public.pmis_p05_login(null);
select results_eq($$
  select actor_is_project_admin, (after_data->>'is_project_admin')::boolean
  from public.audit_events
  where event_type = 'project_membership.admin_changed'
    and entity_id = (select id from public.project_memberships
      where project_id = 'c5100000-0000-0000-0000-00000000000a'
        and user_id = 'c5000000-0000-0000-0000-000000000002')
$$, $$ values (true, false) $$,
  'self-demotion preserves pre-action technical-admin actor snapshot');

-- Contractor-private cost updates produce no shared audit value event.
select public.pmis_p05_login('c5000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$
  update public.cost_items set actual_amount = 8100
  where id = 'c5700000-0000-0000-0000-000000000001'
$$, 'contractor updates private cost');
select is((select count(*)::integer from public.audit_events
  where entity_type = 'cost_item'), 0,
  'shared audit stream has no contractor-private cost events');
select is((select count(*)::integer from public.audit_events
  where coalesce(before_data::text, '') like '%Private Cost P05%'
     or coalesce(after_data::text, '') like '%Private Cost P05%'), 0,
  'shared before/after JSON contains no private cost values');

-- Direct manufacture or mutation is impossible for authenticated users.
select throws_ok($$
  insert into public.audit_events (project_id, event_type, entity_type, action)
  values ('c5100000-0000-0000-0000-00000000000a',
          'valuation.approved', 'valuation', 'fake')
$$, '42501', null, 'authenticated user cannot insert a fake audit event');
select throws_ok($$
  update public.audit_events set action = 'tampered'
  where project_id = 'c5100000-0000-0000-0000-00000000000a'
$$, '42501', null, 'authenticated user cannot update audit events');
select throws_ok($$
  delete from public.audit_events
  where project_id = 'c5100000-0000-0000-0000-00000000000a'
$$, '42501', null, 'authenticated user cannot delete audit events');
select throws_ok($$
  select public.record_audit_event(
    'c5100000-0000-0000-0000-00000000000a', 'valuation.approved',
    'valuation', null, 'fake', null, null, '{}'::jsonb, null)
$$, '42501', null, 'authenticated user cannot call the internal audit helper');
reset role;

-- Trigger defense remains effective even if a future privileged path bypasses
-- table grants/RLS but carries an authenticated JWT.
select throws_ok($$
  update public.audit_events set action = 'tampered'
  where id = (select id from public.audit_events limit 1)
$$, 'P0001', 'audit events are append-only',
  'immutability trigger rejects authenticated privileged update');
select throws_ok($$
  delete from public.audit_events
  where id = (select id from public.audit_events limit 1)
$$, 'P0001', 'audit events are append-only',
  'immutability trigger rejects authenticated privileged delete');

-- Project A-only contractor cannot read B history through RLS.
set local role authenticated;
select is((select count(*)::integer from public.audit_events
  where project_id = 'c5100000-0000-0000-0000-00000000000b'), 0,
  'Project A-only member cannot read Project B audit events');
reset role;
select public.pmis_p05_login(null);

-- System operation is represented explicitly with no fabricated user.
insert into public.documents (id, project_id, title, document_type)
values ('c5800000-0000-0000-0000-000000000001',
        'c5100000-0000-0000-0000-00000000000a', 'System Seed Document', 'other');
select results_eq($$
  select actor_user_id, metadata->>'actor_kind'
  from public.audit_events
  where event_type = 'document.created'
    and entity_id = 'c5800000-0000-0000-0000-000000000001'
$$, $$ values (null::uuid, 'system'::text) $$,
  'system event has null actor identity and explicit actor_kind');


-- 強化語義(相對 f739f32 原版):service role(uid null)走一般 API 也不得改寫歷史。
select throws_ok($$
  update public.audit_events set action = 'tampered-by-service'
  where id = (select id from public.audit_events limit 1)
$$, 'P0001', 'audit events are append-only',
  'service path (null uid) cannot update audit history');
select throws_ok($$
  delete from public.audit_events
  where id = (select id from public.audit_events limit 1)
$$, 'P0001', 'audit events are append-only',
  'service path (null uid) cannot delete audit history');

-- 專案刪除 cascade 必須放行(父列已刪→稽核列隨案刪除),勿重演「專案刪不掉」。
select lives_ok($$
  delete from public.projects where id = 'c5100000-0000-0000-0000-00000000000a'
$$, 'project deletion cascades through append-only audit rows');

select * from finish();
rollback;
