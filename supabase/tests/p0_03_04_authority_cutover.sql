-- P0-04 - Production authorization test matrix for the P0-03 contractual
-- authority cutover. Every scenario runs as an authenticated identity against
-- real RLS policies and transition guards (set local role authenticated +
-- request.jwt claims). Superuser blocks (reset role + null jwt) only seed
-- fixtures and verify state.
begin;

select plan(149);

-- Identity switch helper (rolled back with the transaction).
create or replace function public.pmis_test_login(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config(
    'request.jwt.claims',
    case when p_uid is null then ''
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end,
    true);
end; $$;

-- ── Structure ────────────────────────────────────────────────────────────────
select has_column('public', 'project_parties', 'is_active',
  'project parties carry an is_active lifecycle flag');
select has_function('public', 'can_record_acceptance_stage', array['uuid','text'],
  'stage-scoped acceptance authority function exists');

-- ── Fixtures (superuser) ─────────────────────────────────────────────────────
-- Users. profiles.org_type is seeded adversarially: u3 is a contractor PM whose
-- global profile claims "supervisor" - the legacy identity must grant nothing.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'agency-pm@p04.test', '', now(), '{}',
   '{"full_name":"Agency PM","org_type":"owner"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'agency-eng@p04.test', '', now(), '{}',
   '{"full_name":"Agency Engineer","org_type":"owner"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'con-pm@p04.test', '', now(), '{}',
   '{"full_name":"Contractor Admin","org_type":"supervisor"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'con-qe@p04.test', '', now(), '{}',
   '{"full_name":"Contractor QE","org_type":"contractor"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sup-mgr@p04.test', '', now(), '{}',
   '{"full_name":"Supervisor Manager","org_type":"supervisor"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sup-eng-admin@p04.test', '', now(), '{}',
   '{"full_name":"Supervisor Admin","org_type":"supervisor"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'viewer@p04.test', '', now(), '{}',
   '{"full_name":"Viewer","org_type":"contractor"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ryan@p04.test', '', now(), '{}',
   '{"full_name":"Ryan","org_type":"contractor"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'legacy-only@p04.test', '', now(), '{}',
   '{"full_name":"Legacy Only","org_type":"supervisor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('a0000000-0000-0000-0000-00000000000a', 'P0-04 Project A'),
  ('a0000000-0000-0000-0000-00000000000b', 'P0-04 Project B'),
  ('a0000000-0000-0000-0000-00000000000c', 'P0-04 Project C');
alter table public.projects enable trigger on_project_created;

insert into public.project_parties (id, project_id, party_type, display_name) values
  ('aa000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'agency',     'P04 Agency A'),
  ('aa000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'contractor', 'P04 Builder A'),
  ('aa000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'supervisor', 'P04 Supervisor A'),
  ('aa000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'supervisor', 'P04 Retired Supervisor'),
  ('aa000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000b', 'supervisor', 'P04 Supervisor B'),
  ('aa000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000c', 'contractor', 'P04 Builder C');

insert into public.project_memberships
  (project_id, user_id, project_party_id, project_role, is_project_admin) values
  -- Project A
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000001',
   'aa000000-0000-0000-0000-000000000001', 'agency_pm', true),
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000002',
   'aa000000-0000-0000-0000-000000000001', 'agency_engineer', false),
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000003',
   'aa000000-0000-0000-0000-000000000002', 'contractor_pm', true),
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000004',
   'aa000000-0000-0000-0000-000000000002', 'quality_engineer', false),
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000005',
   'aa000000-0000-0000-0000-000000000003', 'supervisor_manager', false),
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000006',
   'aa000000-0000-0000-0000-000000000003', 'supervisor_engineer', true),
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000007',
   'aa000000-0000-0000-0000-000000000002', 'viewer', false),
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000008',
   'aa000000-0000-0000-0000-000000000002', 'contractor_pm', true),
  -- Project B: Ryan is supervision, non-admin
  ('a0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000008',
   'aa000000-0000-0000-0000-000000000005', 'supervisor_engineer', false),
  -- Project C: two technical admins for the last-admin scenarios
  ('a0000000-0000-0000-0000-00000000000c', 'bbbbbbbb-0000-0000-0000-000000000003',
   'aa000000-0000-0000-0000-000000000006', 'contractor_pm', true),
  ('a0000000-0000-0000-0000-00000000000c', 'bbbbbbbb-0000-0000-0000-000000000004',
   'aa000000-0000-0000-0000-000000000006', 'quality_engineer', true);

-- Adversarial legacy identity: u3 is even a LEGACY ADMIN with a supervisor
-- profile; u9 is a legacy member with no v2 membership at all.
insert into public.project_members (project_id, user_id, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000003', 'admin'),
  ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000009', 'member');

-- Workflow fixtures on Project A (superuser: guards bypass on null auth.uid()).
insert into public.work_items (id, project_id, description) values
  ('e0000000-0000-0000-0000-00000000e901', 'a0000000-0000-0000-0000-00000000000a', 'P04 Concrete');
insert into public.valuations (id, project_id, period_no, status) values
  ('e0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-00000000000a', 1, '送審'),
  ('e0000000-0000-0000-0000-00000000e002', 'a0000000-0000-0000-0000-00000000000a', 2, '已核定');
insert into public.inspections (id, project_id, title, status) values
  ('e0000000-0000-0000-0000-00000000e101', 'a0000000-0000-0000-0000-00000000000a', 'P04 查驗一', '待查驗'),
  ('e0000000-0000-0000-0000-00000000e102', 'a0000000-0000-0000-0000-00000000000a', 'P04 查驗二', '合格'),
  ('e0000000-0000-0000-0000-00000000e103', 'a0000000-0000-0000-0000-00000000000a', 'P04 查驗三', '待查驗'),
  ('e0000000-0000-0000-0000-00000000e1b1', 'a0000000-0000-0000-0000-00000000000b', 'P04 B案查驗', '待查驗');
insert into public.defects (id, project_id, title, status) values
  ('e0000000-0000-0000-0000-00000000e201', 'a0000000-0000-0000-0000-00000000000a', 'P04 缺失一', '待複查');
insert into public.submittals (id, project_id, title, status) values
  ('e0000000-0000-0000-0000-00000000e301', 'a0000000-0000-0000-0000-00000000000a', 'P04 送審一', '已提送'),
  ('e0000000-0000-0000-0000-00000000e302', 'a0000000-0000-0000-0000-00000000000a', 'P04 送審二', '核准'),
  ('e0000000-0000-0000-0000-00000000e303', 'a0000000-0000-0000-0000-00000000000a', 'P04 送審三', '退回補正');
insert into public.rfis (id, project_id, title, status, answer) values
  ('e0000000-0000-0000-0000-00000000e401', 'a0000000-0000-0000-0000-00000000000a', 'P04 疑義一', '待回覆', null),
  ('e0000000-0000-0000-0000-00000000e402', 'a0000000-0000-0000-0000-00000000000a', 'P04 疑義二', '已回覆', '已正式回覆');
insert into public.change_orders (id, project_id, title, status) values
  ('e0000000-0000-0000-0000-00000000e501', 'a0000000-0000-0000-0000-00000000000a', 'P04 變更一', '提出'),
  ('e0000000-0000-0000-0000-00000000e502', 'a0000000-0000-0000-0000-00000000000a', 'P04 變更二', '核准'),
  ('e0000000-0000-0000-0000-00000000e5b1', 'a0000000-0000-0000-0000-00000000000b', 'P04 B案變更', '提出');
insert into public.change_order_items (id, change_order_id, project_id, description, qty_delta, unit_price, amount_delta) values
  ('e0000000-0000-0000-0000-00000000e511', 'e0000000-0000-0000-0000-00000000e502',
   'a0000000-0000-0000-0000-00000000000a', 'P04 追加項', 1, 100, 100);
insert into public.cost_items (id, project_id, category, title, budget_amount, actual_amount) values
  ('e0000000-0000-0000-0000-00000000e601', 'a0000000-0000-0000-0000-00000000000a', '分包', 'P04 成本一', 1000, 900);
insert into public.inspection_points (id, project_id, point_type, title) values
  ('e0000000-0000-0000-0000-00000000e701', 'a0000000-0000-0000-0000-00000000000a', 'H', 'P04 停留點一');
insert into public.requirements (id, project_id, title, requirement_type, status, origin) values
  ('e0000000-0000-0000-0000-00000000e801', 'a0000000-0000-0000-0000-00000000000a', 'P04 需審需求', 'inspection', 'needs_review', 'manual');
insert into public.requirements (id, project_id, title, requirement_type, status, origin, responsible_project_party_id) values
  ('e0000000-0000-0000-0000-00000000e802', 'a0000000-0000-0000-0000-00000000000a', 'P04 已核需求', 'inspection', 'approved', 'manual',
   'aa000000-0000-0000-0000-000000000004');
insert into public.requirement_sources (id, requirement_id, source_kind, source_verified, clause) values
  ('e0000000-0000-0000-0000-00000000e811', 'e0000000-0000-0000-0000-00000000e802', 'manual', false, '9.9');

-- ════ Block A: permission-function matrix (fail closed, project scoped) ═════
-- u3: contractor PM + technical admin whose global profile says "supervisor"
-- and who is even a legacy project admin. None of that grants assurance
-- authority.
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000003');
select is(public.can_submit_valuation('a0000000-0000-0000-0000-00000000000a'), true,
  'contractor PM can submit valuations');
select is(public.can_review_valuation('a0000000-0000-0000-0000-00000000000a'), false,
  'contractor admin cannot review valuations');
select is(public.can_decide_inspection('a0000000-0000-0000-0000-00000000000a'), false,
  'contractor admin with supervisor org_type still cannot decide inspections');
select is(public.can_close_defect('a0000000-0000-0000-0000-00000000000a'), false,
  'contractor admin cannot close defects');
select is(public.can_review_submittal('a0000000-0000-0000-0000-00000000000a'), false,
  'contractor admin cannot review submittals');
select is(public.can_answer_rfi('a0000000-0000-0000-0000-00000000000a'), false,
  'contractor admin cannot formally answer RFIs');
select is(public.can_ratify_change_order('a0000000-0000-0000-0000-00000000000a'), false,
  'contractor admin cannot ratify change orders');
select is(public.can_review_requirement('a0000000-0000-0000-0000-00000000000a'), false,
  'contractor admin cannot review requirements');
select is(public.can_manage_contractor_private('a0000000-0000-0000-0000-00000000000a'), true,
  'contractor PM keeps contractor-private access');
select is(public.can_manage_project_identity('a0000000-0000-0000-0000-00000000000a'), true,
  'technical administration itself is preserved');

-- u1: agency PM + technical admin.
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000001');
select is(public.can_ratify_change_order('a0000000-0000-0000-0000-00000000000a'), true,
  'agency PM ratifies change orders');
select is(public.can_update_payment_fields('a0000000-0000-0000-0000-00000000000a'), true,
  'agency PM updates payment fields');
select is(public.can_record_acceptance_stage('a0000000-0000-0000-0000-00000000000a', 'initial'), true,
  'agency PM records 初驗');
select is(public.can_record_acceptance_stage('a0000000-0000-0000-0000-00000000000a', 'report'), false,
  'agency cannot impersonate contractor 報竣');
select is(public.can_decide_inspection('a0000000-0000-0000-0000-00000000000a'), false,
  'agency admin cannot decide supervisor inspections');
select is(public.can_manage_contractor_private('a0000000-0000-0000-0000-00000000000a'), false,
  'agency admin cannot access contractor-private data');
select is(public.can_review_requirement('a0000000-0000-0000-0000-00000000000a'), true,
  'agency PM is a requirement reviewer');

-- u5: supervisor manager (non-admin).
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000005');
select is(public.can_decide_inspection('a0000000-0000-0000-0000-00000000000a'), true,
  'supervisor manager decides inspections');
select is(public.can_review_valuation('a0000000-0000-0000-0000-00000000000a'), true,
  'supervisor manager reviews valuations');
select is(public.can_review_submittal('a0000000-0000-0000-0000-00000000000a'), true,
  'supervisor manager reviews submittals');
select is(public.can_answer_rfi('a0000000-0000-0000-0000-00000000000a'), true,
  'supervisor manager answers RFIs');
select is(public.can_close_defect('a0000000-0000-0000-0000-00000000000a'), true,
  'supervisor manager closes defects');
select is(public.can_manage_itp('a0000000-0000-0000-0000-00000000000a'), true,
  'supervisor manager manages ITP');
select is(public.can_manage_contractor_private('a0000000-0000-0000-0000-00000000000a'), false,
  'supervisor cannot access contractor-private data');
select is(public.can_ratify_change_order('a0000000-0000-0000-0000-00000000000a'), false,
  'supervisor cannot ratify change orders');
select is(public.can_review_requirement('a0000000-0000-0000-0000-00000000000a'), true,
  'supervisor manager is a requirement reviewer');
select is(public.can_record_acceptance_stage('a0000000-0000-0000-0000-00000000000a', 'certificate'), false,
  'supervisor cannot record agency-only certificate stage');
select is(public.can_record_acceptance_stage('a0000000-0000-0000-0000-00000000000a', 'confirm'), true,
  'supervisor participates in 竣工確認會勘');

-- u6: supervisor engineer who is a technical admin.
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000006');
select is(public.can_manage_contractor_private('a0000000-0000-0000-0000-00000000000a'), false,
  'supervisor project admin still cannot access contractor-private data');
select is(public.can_manage_project_identity('a0000000-0000-0000-0000-00000000000a'), true,
  'supervisor engineer keeps technical administration');

-- u4: contractor quality engineer.
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000004');
select is(public.can_manage_quality_execution('a0000000-0000-0000-0000-00000000000a'), true,
  'quality engineer manages quality execution');
select is(public.can_submit_inspection('a0000000-0000-0000-0000-00000000000a'), true,
  'quality engineer submits inspection requests');
select is(public.can_submit_valuation('a0000000-0000-0000-0000-00000000000a'), false,
  'quality engineer cannot submit valuations');
select is(public.can_manage_contractor_private('a0000000-0000-0000-0000-00000000000a'), false,
  'quality engineer has no cost/margin access (least privilege)');

-- u7: viewer.
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000007');
select is(public.can_manage_daily_logs('a0000000-0000-0000-0000-00000000000a'), false,
  'viewer cannot write daily logs');
select is(public.can_submit_inspection('a0000000-0000-0000-0000-00000000000a'), false,
  'viewer cannot submit inspections');

-- u9: legacy-only member with a supervisor profile: fail closed.
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000009');
select is(public.can_decide_inspection('a0000000-0000-0000-0000-00000000000a'), false,
  'legacy member without v2 membership gets no contractual authority');
select is(
  'a0000000-0000-0000-0000-00000000000a' in (select public.my_project_ids()),
  true, 'legacy member retains read access to the project');
select is(public.is_project_member_v2('a0000000-0000-0000-0000-00000000000a'), false,
  'legacy member is not a v2 member until identity is resolved');

-- u8 Ryan: contractor PM/admin on A, supervisor engineer non-admin on B.
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000008');
select is(public.can_submit_valuation('a0000000-0000-0000-0000-00000000000a'), true,
  'Ryan submits valuations on Project A as contractor');
select is(public.can_decide_inspection('a0000000-0000-0000-0000-00000000000a'), false,
  'Ryan cannot decide inspections on Project A');
select is(public.can_decide_inspection('a0000000-0000-0000-0000-00000000000b'), true,
  'Ryan decides inspections on Project B as supervisor');
select is(public.can_submit_valuation('a0000000-0000-0000-0000-00000000000b'), false,
  'Ryan cannot submit valuations on Project B');
select is(public.is_project_admin_v2('a0000000-0000-0000-0000-00000000000a'), true,
  'Ryan is technical admin on Project A only');
select is(public.is_project_admin_v2('a0000000-0000-0000-0000-00000000000b'), false,
  'Ryan is not technical admin on Project B');
select is(public.can_manage_contractor_private('a0000000-0000-0000-0000-00000000000b'), false,
  'Project A contractor identity does not leak private access into Project B');

-- ════ Block B: contractor admin DML separation (RLS + guards as user) ═══════
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$
  update public.valuations set status = '已核定'
  where id = 'e0000000-0000-0000-0000-00000000e001'
$$, 'P0001', '估驗核定/退回核定僅監造審核角色可執行',
  'contractor admin cannot approve own valuation');
select throws_ok($$
  update public.valuations set status = '已請款'
  where id = 'e0000000-0000-0000-0000-00000000e001'
$$, 'P0001', 'invalid valuation status transition from 送審 to 已請款',
  'contractor cannot skip valuation review and jump directly to payment');
select throws_ok($$
  insert into public.valuations (project_id, period_no, status)
  values ('a0000000-0000-0000-0000-00000000000a', 91, '已核定')
$$, 'P0001', '估驗不可直接以已核定狀態建立',
  'contractor admin cannot insert a pre-approved valuation');
select throws_ok($$
  delete from public.valuations where id = 'e0000000-0000-0000-0000-00000000e002'
$$, 'P0001', '已核定估驗不可刪除(需監造退回後處理)',
  'contractor admin cannot delete an approved valuation');
select throws_ok($$
  update public.valuations set note = '塗改'
  where id = 'e0000000-0000-0000-0000-00000000e002'
$$, 'P0001', '已核定估驗內容不可再修改(需監造退回後重編)',
  'approved valuation header is frozen for the contractor');
select lives_ok($$
  update public.valuations set invoice_date = current_date
  where id = 'e0000000-0000-0000-0000-00000000e002'
$$, 'contractor PM may record the invoice date on an approved valuation');
select throws_ok($$
  update public.inspections set status = '合格'
  where id = 'e0000000-0000-0000-0000-00000000e101'
$$, 'P0001', '查驗判定(合格/不合格)僅監造查驗角色可執行',
  'contractor admin cannot decide own inspection');
select throws_ok($$
  update public.inspections set result_note = '偽造判定'
  where id = 'e0000000-0000-0000-0000-00000000e101'
$$, 'P0001', '查驗判定(合格/不合格)僅監造查驗角色可執行',
  'contractor cannot alter inspection decision fields without changing status');
select throws_ok($$
  insert into public.inspections (project_id, title, status)
  values ('a0000000-0000-0000-0000-00000000000a', '直接合格', '合格')
$$, 'P0001', '查驗不可直接以已判定狀態建立',
  'contractor admin cannot insert a pre-decided inspection');
select throws_ok($$
  delete from public.inspections where id = 'e0000000-0000-0000-0000-00000000e102'
$$, 'P0001', '已判定查驗紀錄不可刪除',
  'contractor admin cannot delete a decided inspection');
select throws_ok($$
  update public.defects set status = '已結案'
  where id = 'e0000000-0000-0000-0000-00000000e201'
$$, 'P0001', '缺失結案僅監造複查角色可執行',
  'contractor admin cannot close own defect');
select throws_ok($$
  insert into public.defects (project_id, title, status)
  values ('a0000000-0000-0000-0000-00000000000a', '直接結案', '已結案')
$$, 'P0001', '缺失不可直接以已結案狀態建立',
  'contractor admin cannot open a pre-closed defect');
select throws_ok($$
  update public.submittals set status = '核准'
  where id = 'e0000000-0000-0000-0000-00000000e301'
$$, 'P0001', '送審審定僅監造審查角色可執行',
  'contractor admin cannot approve own submittal');
select throws_ok($$
  update public.submittals set review_note = '自行審定'
  where id = 'e0000000-0000-0000-0000-00000000e301'
$$, 'P0001', '送審審定僅監造審查角色可執行',
  'contractor cannot alter submittal review fields without changing status');
select throws_ok($$
  insert into public.submittals (project_id, title, status)
  values ('a0000000-0000-0000-0000-00000000000a', '直接核准', '核准')
$$, 'P0001', '送審不可直接以審定後狀態建立',
  'contractor admin cannot insert a pre-approved submittal');
select throws_ok($$
  delete from public.submittals where id = 'e0000000-0000-0000-0000-00000000e302'
$$, 'P0001', '已審定送審紀錄不可刪除',
  'contractor admin cannot delete an approved submittal');
select throws_ok($$
  update public.rfis set answer = '自問自答'
  where id = 'e0000000-0000-0000-0000-00000000e401'
$$, 'P0001', '回覆工程疑義僅監造回覆角色可執行',
  'contractor admin cannot answer own RFI');
select throws_ok($$
  insert into public.rfis (project_id, title, status, answer)
  values ('a0000000-0000-0000-0000-00000000000a', '自問自答新增', '已回覆', '偽回覆')
$$, 'P0001', '工程疑義不可直接以已回覆/已結案狀態建立',
  'contractor cannot create a pre-answered RFI');
select throws_ok($$
  update public.rfis set status = '已結案'
  where id = 'e0000000-0000-0000-0000-00000000e401'
$$, 'P0001', 'invalid RFI status transition from 待回覆 to 已結案',
  'contractor cannot close an unanswered RFI');
select throws_ok($$
  delete from public.rfis where id = 'e0000000-0000-0000-0000-00000000e402'
$$, 'P0001', '已回覆的工程疑義不可刪除',
  'contractor admin cannot delete an answered RFI');
select throws_ok($$
  update public.change_orders set status = '核准'
  where id = 'e0000000-0000-0000-0000-00000000e501'
$$, 'P0001', '變更設計核准/駁回僅機關核定角色可執行',
  'contractor admin cannot ratify agency-only change order');
select throws_ok($$
  update public.change_orders set status = '審核中'
  where id = 'e0000000-0000-0000-0000-00000000e501'
$$, 'P0001', '變更設計送審僅監造審查角色可執行',
  'contractor cannot impersonate supervisor change-order review');
select throws_ok($$
  insert into public.change_order_items
    (change_order_id, project_id, description, qty_delta, unit_price, amount_delta)
  values ('e0000000-0000-0000-0000-00000000e5b1',
          'a0000000-0000-0000-0000-00000000000a', '跨案明細', 1, 1, 1)
$$, 'P0001', 'change order item and parent change order must belong to the same project',
  'direct API calls cannot attach an authorized project item to another project parent');
select throws_ok($$
  insert into public.change_orders (project_id, title, status)
  values ('a0000000-0000-0000-0000-00000000000a', '直接核准變更', '核准')
$$, 'P0001', '變更設計不可直接以核定後狀態建立',
  'contractor admin cannot insert a pre-ratified change order');
select throws_ok($$
  update public.change_order_items set qty_delta = 999
  where id = 'e0000000-0000-0000-0000-00000000e511'
$$, 'P0001', '已核准變更設計的明細不可再修改(需先撤銷核定)',
  'ratified change-order details are frozen');
select throws_ok($$
  delete from public.change_orders where id = 'e0000000-0000-0000-0000-00000000e502'
$$, 'P0001', '已核准變更設計不可刪除(需先撤銷核定)',
  'ratified change orders cannot be deleted by the contractor');
select throws_ok($$
  update public.change_orders set title = '塗改已核准變更'
  where id = 'e0000000-0000-0000-0000-00000000e502'
$$, 'P0001', '已核准變更設計的內容不可再修改',
  'ratified change-order content is frozen');

-- Requirement approval attempt is filtered by RLS (silent no-op).
update public.requirements set status = 'approved'
where id = 'e0000000-0000-0000-0000-00000000e801';
-- Defect delete attempt is filtered by RLS (silent no-op).
delete from public.defects where id = 'e0000000-0000-0000-0000-00000000e201';
reset role;
select public.pmis_test_login(null);
select is(
  (select status from public.requirements where id = 'e0000000-0000-0000-0000-00000000e801'),
  'needs_review', 'contractor admin cannot approve a requirement');
select is(
  (select count(*)::integer from public.defects where id = 'e0000000-0000-0000-0000-00000000e201'),
  1, 'contractor admin cannot delete a supervisor-owned defect');

select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$
  insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('a0000000-0000-0000-0000-00000000000a', 'final', current_date)
$$, '42501', null,
  'contractor cannot record formal agency-only acceptance stage');
select lives_ok($$
  insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('a0000000-0000-0000-0000-00000000000a', 'report', current_date)
$$, 'contractor PM records 報竣');
select is(
  (select count(*)::integer from public.cost_items
    where project_id = 'a0000000-0000-0000-0000-00000000000a'),
  1, 'contractor PM reads contractor-private cost rows');
select lives_ok($$
  insert into public.cost_items (project_id, category, title)
  values ('a0000000-0000-0000-0000-00000000000a', '材料', 'P04 成本二')
$$, 'contractor PM writes contractor-private cost rows');
select throws_ok($$
  update public.inspection_points set title = '塗改停留點'
  where id = 'e0000000-0000-0000-0000-00000000e701'
$$, 'P0001', '停留點定義僅監造可修改;施工角色僅能連結查驗申請',
  'contractor cannot rewrite ITP definitions');
select lives_ok($$
  update public.inspection_points
  set inspection_id = 'e0000000-0000-0000-0000-00000000e101'
  where id = 'e0000000-0000-0000-0000-00000000e701'
$$, 'contractor may attach an inspection request to an ITP point');

-- ════ Block C: agency separation + payment/acceptance authority ═════════════
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000001');
set local role authenticated;
select is(
  (select count(*)::integer from public.cost_items
    where project_id = 'a0000000-0000-0000-0000-00000000000a'),
  0, 'agency project admin cannot SELECT contractor-private cost rows');
select throws_ok($$
  insert into public.cost_items (project_id, category, title)
  values ('a0000000-0000-0000-0000-00000000000a', '其他', '機關偷寫成本')
$$, '42501', null,
  'agency project admin cannot INSERT contractor-private cost rows');
update public.inspections set status = '合格'
where id = 'e0000000-0000-0000-0000-00000000e101';
reset role;
select public.pmis_test_login(null);
select is(
  (select status from public.inspections where id = 'e0000000-0000-0000-0000-00000000e101'),
  '待查驗', 'agency admin cannot decide supervisor inspection');

select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  update public.valuations set paid_date = current_date, paid_amount = 12345
  where id = 'e0000000-0000-0000-0000-00000000e002'
$$, 'agency PM records disbursement fields on an approved valuation');
select throws_ok($$
  update public.valuations set note = '機關塗改'
  where id = 'e0000000-0000-0000-0000-00000000e002'
$$, 'P0001', '僅可登錄請款/撥款欄位(invoice_date / paid_date / paid_amount)',
  'agency PM cannot touch valuation content fields');
select throws_ok($$
  insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('a0000000-0000-0000-0000-00000000000a', 'report', current_date)
$$, '42501', null,
  'agency cannot impersonate contractor 報竣');
select lives_ok($$
  insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('a0000000-0000-0000-0000-00000000000a', 'initial', current_date)
$$, 'agency PM records 初驗');
select lives_ok($$
  insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('a0000000-0000-0000-0000-00000000000a', 'certificate', current_date)
$$, 'agency PM records 結算驗收證明書');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$
  insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('a0000000-0000-0000-0000-00000000000a', 'certificate', current_date)
$$, '42501', null,
  'supervisor cannot record agency-only certificate stage');
select lives_ok($$
  insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('a0000000-0000-0000-0000-00000000000a', 'confirm', current_date)
$$, 'supervisor records 竣工確認會勘');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000007');
set local role authenticated;
select throws_ok($$
  insert into public.acceptance_events (project_id, stage_key, event_date)
  values ('a0000000-0000-0000-0000-00000000000a', 'final', current_date)
$$, '42501', null,
  'viewer cannot record acceptance stages');

-- ════ Block D: requirement review authority + snapshot immutability ═════════
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  insert into public.requirements
    (project_id, title, requirement_type, status, origin)
  values ('a0000000-0000-0000-0000-00000000000a', '直接核定規範', 'inspection', 'approved', 'manual')
$$, 'P0001', 'requirements cannot be created directly in a reviewed status',
  'reviewers must use the Requirement lifecycle instead of inserting authoritative truth');
select lives_ok($$
  select public.review_requirement(
    'e0000000-0000-0000-0000-00000000e801', 'approve')
$$, 'agency reviewer approves a requirement');
reset role;
select public.pmis_test_login(null);
select is(
  (select is_authoritative from public.requirements
    where id = 'e0000000-0000-0000-0000-00000000e801'),
  true, 'the approved requirement became authoritative');
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  update public.requirements set title = '塗改已核需求'
  where id = 'e0000000-0000-0000-0000-00000000e801'
$$, 'P0001', 'reviewed requirement content is immutable; supersede and create a new requirement',
  'approved requirement content cannot be edited in place');
select throws_ok($$
  update public.requirements set reviewed_at = reviewed_at + interval '1 minute'
  where id = 'e0000000-0000-0000-0000-00000000e801'
$$, 'P0001', 'reviewed requirement content is immutable; supersede and create a new requirement',
  'approved Requirement review metadata is part of the frozen snapshot');
select throws_ok($$
  update public.requirements set status = 'rejected'
  where id = 'e0000000-0000-0000-0000-00000000e801'
$$, 'P0001', 'invalid requirement lifecycle transition from approved to rejected',
  'approved requirements cannot be demoted to rejected');
select throws_ok($$
  insert into public.requirement_sources (requirement_id, source_kind, clause)
  values ('e0000000-0000-0000-0000-00000000e802', 'manual', '10.1')
$$, 'P0001', 'citations of a reviewed requirement are immutable',
  'approved requirement citations are frozen');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000005');
set local role authenticated;
select lives_ok($$
  select public.review_requirement(
    'e0000000-0000-0000-0000-00000000e801', 'supersede')
$$, 'supervisor reviewer supersedes an approved requirement');
select throws_ok($$
  update public.requirements set status = 'approved'
  where id = 'e0000000-0000-0000-0000-00000000e801'
$$, 'P0001', 'invalid requirement lifecycle transition from superseded to approved',
  'superseded requirements cannot silently return to approved');
select throws_ok($$
  delete from public.requirements where id = 'e0000000-0000-0000-0000-00000000e802'
$$, 'P0001', 'reviewed requirements cannot be deleted; supersede them instead',
  'reviewed requirements cannot be deleted by application users');

-- ════ Block E: supervisor assurance positives ═══════════════════════════════
select lives_ok($$
  update public.inspections
  set status = '合格', inspected_at = now()
  where id = 'e0000000-0000-0000-0000-00000000e101'
$$, 'supervisor decides an inspection');
reset role;
select public.pmis_test_login(null);
select is(
  (select status from public.inspections where id = 'e0000000-0000-0000-0000-00000000e101'),
  '合格', 'inspection decision was persisted');
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000005');
set local role authenticated;
select lives_ok($$
  update public.defects set status = '已結案', closed_at = now()
  where id = 'e0000000-0000-0000-0000-00000000e201'
$$, 'supervisor closes a defect after verification');
select lives_ok($$
  update public.submittals set status = '核准', decided_date = current_date
  where id = 'e0000000-0000-0000-0000-00000000e301'
$$, 'supervisor reviews a submittal');
select lives_ok($$
  update public.rfis set answer = '正式回覆', status = '已回覆', answered_date = current_date
  where id = 'e0000000-0000-0000-0000-00000000e401'
$$, 'supervisor formally answers an RFI');
select lives_ok($$
  insert into public.inspection_points (project_id, point_type, title)
  values ('a0000000-0000-0000-0000-00000000000a', 'W', 'P04 新停留點')
$$, 'supervisor manages ITP points');
select lives_ok($$
  update public.valuations set status = '已核定'
  where id = 'e0000000-0000-0000-0000-00000000e001'
$$, 'supervisor reviews and approves a valuation');
select throws_ok($$
  update public.valuations set paid_amount = 9876
  where id = 'e0000000-0000-0000-0000-00000000e001'
$$, 'P0001', '請款/撥款欄位僅授權機關或廠商專案經理更新',
  'supervisor cannot alter payment fields while reviewing valuations');
select throws_ok($$
  update public.valuations set note = '核定後塗改'
  where id = 'e0000000-0000-0000-0000-00000000e001'
$$, 'P0001', '已核定估驗內容不可再修改(需監造退回後重編)',
  'approved valuation header is frozen even for the reviewer');
select throws_ok($$
  insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('e0000000-0000-0000-0000-00000000e001',
          'e0000000-0000-0000-0000-00000000e901', 6)
$$, 'P0001', '已核定估驗的明細不可再修改(需監造退回後重編)',
  'approved valuation details are frozen even for the reviewer');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$
  insert into public.valuation_items (valuation_id, work_item_id, cum_qty)
  values ('e0000000-0000-0000-0000-00000000e001',
          'e0000000-0000-0000-0000-00000000e901', 5)
$$, 'P0001', '已核定估驗的明細不可再修改(需監造退回後重編)',
  'approved valuation details are frozen against contractor edits');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000005');
set local role authenticated;
select lives_ok($$
  update public.change_orders set status = '審核中'
  where id = 'e0000000-0000-0000-0000-00000000e501'
$$, 'supervisor moves a change order into review (初審)');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$
  update public.change_orders set title = '廠商審核中塗改'
  where id = 'e0000000-0000-0000-0000-00000000e501'
$$, 'P0001', '變更設計進入審核後內容不可再修改',
  'contractor cannot rewrite change-order content after review begins');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000005');
set local role authenticated;
select throws_ok($$
  update public.change_orders set status = '核准'
  where id = 'e0000000-0000-0000-0000-00000000e501'
$$, 'P0001', '變更設計核准/駁回僅機關核定角色可執行',
  'supervisor cannot perform the agency ratification');
select throws_ok($$
  update public.change_orders set title = '監造塗改變更'
  where id = 'e0000000-0000-0000-0000-00000000e501'
$$, 'P0001', '機關/監造僅可核定變更設計狀態,不可修改內容',
  'supervisor cannot edit change-order content');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  update public.change_orders set status = '核准'
  where id = 'e0000000-0000-0000-0000-00000000e501'
$$, 'agency PM ratifies the reviewed change order');
select throws_ok($$
  update public.change_orders set title = '機關塗改變更'
  where id = 'e0000000-0000-0000-0000-00000000e501'
$$, 'P0001', '機關/監造僅可核定變更設計狀態,不可修改內容',
  'agency PM cannot edit change-order content either');

-- ════ Block F: contractor execution positives + fail-closed writes ══════════
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$
  insert into public.valuations (project_id, period_no, status)
  values ('a0000000-0000-0000-0000-00000000000a', 3, '草稿')
$$, 'contractor PM creates a draft valuation');
select lives_ok($$
  update public.submittals set status = '已提送', revision = 1
  where id = 'e0000000-0000-0000-0000-00000000e303'
$$, 'contractor resubmits a returned submittal (退回補正→已提送)');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000004');
set local role authenticated;
select lives_ok($$
  insert into public.test_samples (project_id, test_item, sampled_date)
  values ('a0000000-0000-0000-0000-00000000000a', '混凝土抗壓', current_date)
$$, 'quality engineer performs quality execution');
select lives_ok($$
  insert into public.inspections (project_id, title, status)
  values ('a0000000-0000-0000-0000-00000000000a', 'QE 查驗申請', '待查驗')
$$, 'quality engineer submits an inspection request');
select throws_ok($$
  insert into public.valuations (project_id, period_no, status)
  values ('a0000000-0000-0000-0000-00000000000a', 92, '草稿')
$$, '42501', null,
  'quality engineer cannot create valuations');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000007');
set local role authenticated;
select throws_ok($$
  insert into public.test_samples (project_id, test_item, sampled_date)
  values ('a0000000-0000-0000-0000-00000000000a', '越權取樣', current_date)
$$, '42501', null,
  'viewer stays read-only');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000009');
set local role authenticated;
select is(
  (select count(*)::integer from public.projects
    where id = 'a0000000-0000-0000-0000-00000000000a'),
  1, 'legacy-only member still sees the project');
update public.inspections set status = '合格'
where id = 'e0000000-0000-0000-0000-00000000e103';
reset role;
select public.pmis_test_login(null);
select is(
  (select status from public.inspections where id = 'e0000000-0000-0000-0000-00000000e103'),
  '待查驗', 'legacy supervisor profile grants no decision authority (fail closed)');

-- ════ Block G: cross-project identity (Ryan) ════════════════════════════════
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000008');
set local role authenticated;
select lives_ok($$
  update public.inspections set status = '合格'
  where id = 'e0000000-0000-0000-0000-00000000e1b1'
$$, 'Ryan decides inspections on Project B (supervisor identity)');
select throws_ok($$
  update public.inspections set status = '合格'
  where id = 'e0000000-0000-0000-0000-00000000e103'
$$, 'P0001', '查驗判定(合格/不合格)僅監造查驗角色可執行',
  'Ryan cannot decide inspections on Project A (contractor identity)');
select throws_ok($$
  insert into public.valuations (project_id, period_no, status)
  values ('a0000000-0000-0000-0000-00000000000b', 1, '草稿')
$$, '42501', null,
  'Ryan cannot submit valuations on Project B');

-- ════ Block H: identity integrity ═══════════════════════════════════════════
reset role;
select public.pmis_test_login(null);
select throws_ok($$
  insert into public.project_memberships (project_id, user_id, project_party_id, project_role)
  values ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000009',
          'aa000000-0000-0000-0000-000000000002', 'supervisor_engineer')
$$, 'P0001', 'project role supervisor_engineer is not allowed for party type contractor',
  'contractor party + supervisor_engineer is rejected');
select throws_ok($$
  insert into public.project_memberships (project_id, user_id, project_party_id, project_role)
  values ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000009',
          'aa000000-0000-0000-0000-000000000001', 'contractor_pm')
$$, 'P0001', 'project role contractor_pm is not allowed for party type agency',
  'agency party + contractor_pm is rejected');
select throws_ok($$
  update public.project_memberships set project_role = 'agency_pm'
  where project_id = 'a0000000-0000-0000-0000-00000000000a'
    and user_id = 'bbbbbbbb-0000-0000-0000-000000000004'
$$, 'P0001', 'project role agency_pm is not allowed for party type contractor',
  'role changes are validated against the party');
select throws_ok($$
  update public.project_memberships
  set user_id = 'bbbbbbbb-0000-0000-0000-000000000009'
  where project_id = 'a0000000-0000-0000-0000-00000000000a'
    and user_id = 'bbbbbbbb-0000-0000-0000-000000000004'
$$, 'P0001', 'project membership user identity is immutable',
  'membership rows cannot be reassigned to another user');
select throws_ok($$
  update public.project_parties set party_type = 'supervisor'
  where id = 'aa000000-0000-0000-0000-000000000002'
$$, 'P0001', 'party type change would leave incompatible membership roles',
  'party type changes are validated against attached memberships');
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$
  update public.project_memberships set project_role = 'site_manager'
  where project_id = 'a0000000-0000-0000-0000-00000000000a'
    and user_id = 'bbbbbbbb-0000-0000-0000-000000000003'
$$, 'P0001', 'project members cannot change their own contractual identity',
  'technical admin cannot change their own contractual role');
reset role;

-- Party deactivation keeps approved responsibility traceable.
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  update public.project_parties set is_active = false
  where id = 'aa000000-0000-0000-0000-000000000004'
$$, 'a technical admin deactivates a memberless historical party');
reset role;
select public.pmis_test_login(null);
select is(
  (select r.responsible_project_party_id from public.requirements r
    where r.id = 'e0000000-0000-0000-0000-00000000e802'),
  'aa000000-0000-0000-0000-000000000004'::uuid,
  'approved requirement responsibility survives party deactivation');
select is(
  (select r.status from public.requirements r
    where r.id = 'e0000000-0000-0000-0000-00000000e802'),
  'approved',
  'approved requirement lifecycle is untouched by party deactivation');
select throws_ok($$
  insert into public.project_memberships (project_id, user_id, project_party_id, project_role)
  values ('a0000000-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-000000000009',
          'aa000000-0000-0000-0000-000000000004', 'viewer')
$$, 'P0001', 'project membership requires an active project party',
  'inactive parties accept no new memberships');

-- Hard deletion of parties: RLS removes the capability for app users...
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000001');
set local role authenticated;
delete from public.project_parties where id = 'aa000000-0000-0000-0000-000000000003';
reset role;
select public.pmis_test_login(null);
select is(
  (select count(*)::integer from public.project_parties
    where id = 'aa000000-0000-0000-0000-000000000003'),
  1, 'application users cannot hard-delete a project party (no RLS delete path)');
-- ...and the trigger blocks any authenticated hard delete in depth.
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000001');
select throws_ok($$
  delete from public.project_parties where id = 'aa000000-0000-0000-0000-000000000004'
$$, 'P0001', 'a project party referenced by an authoritative requirement cannot be deleted; deactivate it instead',
  'a party referenced by approved requirements cannot be hard-deleted');
select throws_ok($$
  delete from public.project_parties where id = 'aa000000-0000-0000-0000-000000000002'
$$, 'P0001', 'a project party with memberships cannot be deleted; deactivate it instead',
  'a party carrying memberships cannot be hard-deleted');
select throws_ok($$
  update public.project_parties set is_active = false
  where id = 'aa000000-0000-0000-0000-000000000002'
$$, 'P0001', 'a project party with memberships cannot be deactivated; reassign members first',
  'a party carrying memberships cannot be deactivated');

-- Last technical admin protection (Project C has two admins: u3 and u4).
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$
  update public.project_memberships set is_project_admin = false
  where project_id = 'a0000000-0000-0000-0000-00000000000c'
    and user_id = 'bbbbbbbb-0000-0000-0000-000000000003'
$$, 'an admin may step down while another admin remains');
reset role;
select public.pmis_test_login('bbbbbbbb-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$
  update public.project_memberships set is_project_admin = false
  where project_id = 'a0000000-0000-0000-0000-00000000000c'
    and user_id = 'bbbbbbbb-0000-0000-0000-000000000004'
$$, 'P0001', 'a project must keep at least one technical project admin',
  'the last project admin cannot self-demote');
select throws_ok($$
  delete from public.project_memberships
  where project_id = 'a0000000-0000-0000-0000-00000000000c'
    and user_id = 'bbbbbbbb-0000-0000-0000-000000000004'
$$, 'P0001', 'a project must keep at least one technical project admin',
  'the last project admin cannot be removed');

reset role;
select * from finish();
rollback;
