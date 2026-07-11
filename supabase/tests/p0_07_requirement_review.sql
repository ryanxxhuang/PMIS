-- P0-07 focused pgTAP suite: controlled requirement review, server-stamped
-- review metadata, failed-run approval protection, citation mutation safety,
-- BOQ link decisions, and the approved-requirement artifact boundary.
-- This intentionally does not repeat the P0-04/P0-05/P0-06 matrices.
begin;

select plan(51);

create or replace function public.pmis_p07_login(p_uid uuid)
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

select public.pmis_p07_login(null);

-- Structure contract.
select has_function('public', 'review_requirement', array['uuid','text'],
  'controlled review action exists');
select has_table('public', 'requirement_artifact_links',
  'approved-requirement artifact boundary table exists');
select has_column('public', 'requirement_work_items', 'review_status',
  'BOQ links carry explicit suggested/approved/rejected state');
select has_column('public', 'requirement_artifact_links', 'generation_type',
  'artifact links record how they were generated');

-- Fixtures: u1 = supervisor reviewer on A but contractor PM on B,
-- u2 = contractor PM + technical admin on A, u3 = agency reviewer on A.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'supervisor@p07.test', '', now(), '{}',
   '{"full_name":"Supervisor Reviewer","org_type":"supervisor"}', now(), now()),
  ('e7000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'contractor@p07.test', '', now(), '{}',
   '{"full_name":"Contractor Admin","org_type":"contractor"}', now(), now()),
  ('e7000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'agency@p07.test', '', now(), '{}',
   '{"full_name":"Agency Reviewer","org_type":"owner"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('e7100000-0000-0000-0000-00000000000a', 'P0-07 Project A'),
  ('e7100000-0000-0000-0000-00000000000b', 'P0-07 Project B');
alter table public.projects enable trigger on_project_created;

insert into public.project_parties (id, project_id, party_type, display_name) values
  ('e7200000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-00000000000a', 'supervisor', 'P07 Supervisor A'),
  ('e7200000-0000-0000-0000-000000000002', 'e7100000-0000-0000-0000-00000000000a', 'contractor', 'P07 Builder A'),
  ('e7200000-0000-0000-0000-000000000003', 'e7100000-0000-0000-0000-00000000000a', 'agency', 'P07 Agency A'),
  ('e7200000-0000-0000-0000-000000000004', 'e7100000-0000-0000-0000-00000000000b', 'contractor', 'P07 Builder B');

insert into public.project_memberships
  (project_id, user_id, project_party_id, project_role, is_project_admin) values
  ('e7100000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-000000000001',
   'e7200000-0000-0000-0000-000000000001', 'supervisor_engineer', false),
  ('e7100000-0000-0000-0000-00000000000b', 'e7000000-0000-0000-0000-000000000001',
   'e7200000-0000-0000-0000-000000000004', 'contractor_pm', true),
  ('e7100000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-000000000002',
   'e7200000-0000-0000-0000-000000000002', 'contractor_pm', true),
  ('e7100000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-000000000003',
   'e7200000-0000-0000-0000-000000000003', 'agency_engineer', false);

insert into public.work_items (id, project_id, description, is_leaf) values
  ('e7300000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-00000000000a', '模板組立', true),
  ('e7300000-0000-0000-0000-000000000002', 'e7100000-0000-0000-0000-00000000000a', '混凝土澆置', true),
  ('e7300000-0000-0000-0000-000000000003', 'e7100000-0000-0000-0000-00000000000b', 'B案工項', true);

insert into public.documents (id, project_id, title, document_type) values
  ('e7400000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-00000000000a', 'A案契約.pdf', 'contract');
insert into public.document_versions (id, document_id, version_label, checksum) values
  ('e7500000-0000-0000-0000-000000000001', 'e7400000-0000-0000-0000-000000000001', 'v1', 'sha256:p07');
insert into public.document_pages (document_version_id, page_number, extracted_text, extraction_method) values
  ('e7500000-0000-0000-0000-000000000001', 1, '施工廠商應於開工前14日內檢送施工計畫書', 'pdf_text');

insert into public.document_ingestion_runs
  (id, project_id, document_version_id, status) values
  ('e7600000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-00000000000a',
   'e7500000-0000-0000-0000-000000000001', 'completed'),
  ('e7600000-0000-0000-0000-000000000002', 'e7100000-0000-0000-0000-00000000000a',
   'e7500000-0000-0000-0000-000000000001', 'failed'),
  ('e7600000-0000-0000-0000-000000000003', 'e7100000-0000-0000-0000-00000000000a',
   'e7500000-0000-0000-0000-000000000001', 'processing');

insert into public.requirements
  (id, project_id, title, requirement_type, status, origin, ingestion_run_id) values
  ('e7700000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-00000000000a',
   '完整 run 的 AI 建議', 'submittal', 'draft_ai', 'ai', 'e7600000-0000-0000-0000-000000000001'),
  ('e7700000-0000-0000-0000-000000000002', 'e7100000-0000-0000-0000-00000000000a',
   '失敗 run 的殘留建議', 'inspection', 'needs_review', 'ai', 'e7600000-0000-0000-0000-000000000002'),
  ('e7700000-0000-0000-0000-000000000003', 'e7100000-0000-0000-0000-00000000000a',
   '處理中 run 的建議', 'test', 'draft_ai', 'ai', 'e7600000-0000-0000-0000-000000000003'),
  ('e7700000-0000-0000-0000-000000000004', 'e7100000-0000-0000-0000-00000000000a',
   '人工登錄需求', 'checklist', 'needs_review', 'manual', null),
  ('e7700000-0000-0000-0000-000000000005', 'e7100000-0000-0000-0000-00000000000a',
   '引註安全測試需求', 'evidence', 'needs_review', 'ai', 'e7600000-0000-0000-0000-000000000001'),
  ('e7700000-0000-0000-0000-000000000006', 'e7100000-0000-0000-0000-00000000000b',
   'B案人工需求', 'report', 'needs_review', 'manual', null);

-- System-verified sources (P0-06 ingestion service path: no authenticated JWT).
insert into public.requirement_sources
  (id, requirement_id, document_version_id, source_kind, source_verified,
   page_number, clause, source_text) values
  ('e7800000-0000-0000-0000-000000000001', 'e7700000-0000-0000-0000-000000000005',
   'e7500000-0000-0000-0000-000000000001', 'document', true, 1, '§12.4',
   '施工廠商應於開工前14日內檢送施工計畫書'),
  ('e7800000-0000-0000-0000-000000000002', 'e7700000-0000-0000-0000-000000000001',
   'e7500000-0000-0000-0000-000000000001', 'document', true, 1, '§9.1',
   '施工廠商應於開工前14日內檢送施工計畫書');

-- AI-suggested BOQ links (service insert; review_status defaults to suggested).
insert into public.requirement_work_items
  (requirement_id, work_item_id, match_type, confidence, reviewed) values
  ('e7700000-0000-0000-0000-000000000001', 'e7300000-0000-0000-0000-000000000001', 'ai', 0.9, false),
  ('e7700000-0000-0000-0000-000000000001', 'e7300000-0000-0000-0000-000000000002', 'ai', 0.4, false);

insert into public.inspection_points (id, project_id, point_type, title) values
  ('e7900000-0000-0000-0000-000000000001', 'e7100000-0000-0000-0000-00000000000a', 'H', 'A案基礎查驗停留點'),
  ('e7900000-0000-0000-0000-000000000002', 'e7100000-0000-0000-0000-00000000000b', 'H', 'B案停留點');
insert into public.submittals (id, project_id, title) values
  ('e7900000-0000-0000-0000-000000000003', 'e7100000-0000-0000-0000-00000000000a', 'A案施工計畫送審');

-- ── Review authority ─────────────────────────────────────────────────────────
-- Contractor PM with technical-admin status is still not a reviewer.
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000004', 'approve')
$$, 'P0001', 'requirement review requires a requirement reviewer',
  'contractor + technical admin cannot approve through the review action');
-- Direct PostgREST-style mutation is RLS-filtered to a silent no-op.
update public.requirements set status = 'approved'
where id = 'e7700000-0000-0000-0000-000000000004';
reset role;
select public.pmis_p07_login(null);
select is((select status from public.requirements
  where id = 'e7700000-0000-0000-0000-000000000004'), 'needs_review',
  'contractor direct PostgREST update leaves no trace');

-- ── Server-stamped review metadata; direct lifecycle path is closed ─────────
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  update public.requirements set status = 'approved'
  where id = 'e7700000-0000-0000-0000-000000000004'
$$, 'P0001', 'requirement lifecycle transitions require the controlled review action',
  'even a reviewer cannot approve through direct PATCH');
select throws_ok($$
  update public.requirements
  set reviewed_by = 'e7000000-0000-0000-0000-000000000002'
  where id = 'e7700000-0000-0000-0000-000000000004'
$$, 'P0001', 'review metadata is stamped by the controlled review action',
  'reviewer identity cannot be forged by the browser');
select throws_ok($$
  update public.requirements set reviewed_at = now() - interval '30 days'
  where id = 'e7700000-0000-0000-0000-000000000004'
$$, 'P0001', 'review metadata is stamped by the controlled review action',
  'review timestamp cannot be forged by the browser');
select lives_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000001', 'approve')
$$, 'authorized supervisor approves an AI requirement from a completed run');
reset role;
select public.pmis_p07_login(null);
select results_eq($$
  select status, is_authoritative, reviewed_by from public.requirements
  where id = 'e7700000-0000-0000-0000-000000000001'
$$, $$ values ('approved'::text, true,
  'e7000000-0000-0000-0000-000000000001'::uuid) $$,
  'approval is authoritative and reviewed_by = actual auth.uid()');
select is((select reviewed_at is not null and reviewed_at <= now()
  from public.requirements where id = 'e7700000-0000-0000-0000-000000000001'),
  true, 'reviewed_at is stamped with server time');

-- ── Failed / processing ingestion runs cannot produce approval ──────────────
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000002', 'approve')
$$, 'P0001', 'AI requirement approval requires a completed ingestion run',
  'failed-run AI requirement cannot be approved');
select throws_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000003', 'approve')
$$, 'P0001', 'AI requirement approval requires a completed ingestion run',
  'processing-run AI requirement cannot be approved');
select lives_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000002', 'reject')
$$, 'failed-run AI suggestion can still be explicitly rejected');
reset role;
select public.pmis_p07_login(null);
select throws_ok($$
  update public.requirements set status = 'approved'
  where id = 'e7700000-0000-0000-0000-000000000003'
$$, 'P0001', 'AI requirement approval requires a completed ingestion run',
  'the completed-run rule binds every writer, service role included');

-- ── Lifecycle mapping is narrow and deterministic ────────────────────────────
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000004', 'reject')
$$, 'authorized agency reviewer rejects a manual requirement');
select throws_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000004', 'approve')
$$, 'P0001', 'invalid requirement lifecycle transition from rejected via approve',
  'rejected requirements cannot be approved');
select throws_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000004', 'supersede')
$$, 'P0001', 'invalid requirement lifecycle transition from rejected via supersede',
  'only approved requirements can be superseded');
select throws_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000005', 'promote')
$$, 'P0001', 'unknown review decision: promote',
  'the review action accepts no generic status input');
reset role;
select public.pmis_p07_login(null);

-- ── Citation mutation safety ─────────────────────────────────────────────────
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  update public.requirement_sources set clause = '§9.9'
  where id = 'e7800000-0000-0000-0000-000000000001'
$$, 'reviewer corrects a citation on an unreviewed requirement');
select is((select source_verified from public.requirement_sources
  where id = 'e7800000-0000-0000-0000-000000000001'), false,
  'human citation edit resets the system verification verdict');
select throws_ok($$
  update public.requirement_sources set source_verified = true
  where id = 'e7800000-0000-0000-0000-000000000001'
$$, 'P0001', 'source verification is determined by the system',
  'the browser cannot grant source_verified');
select throws_ok($$
  insert into public.requirement_sources
    (requirement_id, document_version_id, source_kind, source_verified, source_text)
  values ('e7700000-0000-0000-0000-000000000005',
          'e7500000-0000-0000-0000-000000000001', 'document', true, '偽造已驗證引註')
$$, 'P0001', 'source verification is determined by the system',
  'the browser cannot insert a pre-verified source');
select throws_ok($$
  update public.requirement_sources set clause = '§1.1'
  where id = 'e7800000-0000-0000-0000-000000000002'
$$, 'P0001', 'citations of a reviewed requirement are immutable',
  'approved requirement citations stay frozen');

-- ── BOQ candidate link decisions ─────────────────────────────────────────────
reset role;
select public.pmis_p07_login(null);
select results_eq($$
  select review_status, reviewed from public.requirement_work_items
  where requirement_id = 'e7700000-0000-0000-0000-000000000001'
    and work_item_id = 'e7300000-0000-0000-0000-000000000001'
$$, $$ values ('suggested'::text, false) $$,
  'AI-suggested link starts suggested (legacy boolean derived false)');
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  update public.requirement_work_items set review_status = 'approved'
  where requirement_id = 'e7700000-0000-0000-0000-000000000001'
    and work_item_id = 'e7300000-0000-0000-0000-000000000001'
$$, 'reviewer approves an AI-suggested BOQ link');
select lives_ok($$
  update public.requirement_work_items set review_status = 'rejected'
  where requirement_id = 'e7700000-0000-0000-0000-000000000001'
    and work_item_id = 'e7300000-0000-0000-0000-000000000002'
$$, 'reviewer rejects another AI-suggested BOQ link');
reset role;
select public.pmis_p07_login(null);
select results_eq($$
  select work_item_id, review_status, reviewed
  from public.requirement_work_items
  where requirement_id = 'e7700000-0000-0000-0000-000000000001'
  order by work_item_id
$$, $$ values
  ('e7300000-0000-0000-0000-000000000001'::uuid, 'approved'::text, true),
  ('e7300000-0000-0000-0000-000000000002'::uuid, 'rejected'::text, false)
$$, 'link decisions persist and the legacy boolean stays derived');
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  insert into public.requirement_work_items
    (requirement_id, work_item_id, match_type, review_status)
  values ('e7700000-0000-0000-0000-000000000005',
          'e7300000-0000-0000-0000-000000000002', 'manual', 'approved')
$$, 'reviewer manually links a real same-project work item');
select throws_ok($$
  insert into public.requirement_work_items
    (requirement_id, work_item_id, match_type, review_status)
  values ('e7700000-0000-0000-0000-000000000005',
          'e7300000-0000-0000-0000-000000000001', 'ai', 'approved')
$$, 'P0001', 'AI work-item suggestions must start as suggested',
  'an application user cannot insert a pre-approved AI suggestion');
select throws_ok($$
  insert into public.requirement_work_items
    (requirement_id, work_item_id, match_type, review_status)
  values ('e7700000-0000-0000-0000-000000000005',
          'e7300000-0000-0000-0000-000000000003', 'manual', 'approved')
$$, 'P0001', 'requirement and work item must belong to the same project',
  'cross-project BOQ links stay rejected');

-- ── Approved requirement is the artifact boundary ───────────────────────────
select throws_ok($$
  insert into public.requirement_artifact_links (requirement_id, artifact_type, artifact_id)
  values ('e7700000-0000-0000-0000-000000000003', 'inspection_point',
          'e7900000-0000-0000-0000-000000000001')
$$, 'P0001', 'artifact links require an approved requirement',
  'draft_ai requirement cannot create an artifact link');
select throws_ok($$
  insert into public.requirement_artifact_links (requirement_id, artifact_type, artifact_id)
  values ('e7700000-0000-0000-0000-000000000005', 'inspection_point',
          'e7900000-0000-0000-0000-000000000001')
$$, 'P0001', 'artifact links require an approved requirement',
  'needs_review requirement cannot create an artifact link');
select throws_ok($$
  insert into public.requirement_artifact_links (requirement_id, artifact_type, artifact_id)
  values ('e7700000-0000-0000-0000-000000000004', 'inspection_point',
          'e7900000-0000-0000-0000-000000000001')
$$, 'P0001', 'artifact links require an approved requirement',
  'rejected requirement cannot create an artifact link');
select lives_ok($$
  insert into public.requirement_artifact_links (requirement_id, artifact_type, artifact_id)
  values ('e7700000-0000-0000-0000-000000000001', 'inspection_point',
          'e7900000-0000-0000-0000-000000000001')
$$, 'approved requirement links to a real same-project inspection point');
reset role;
select public.pmis_p07_login(null);
select results_eq($$
  select created_by, generation_type from public.requirement_artifact_links
  where requirement_id = 'e7700000-0000-0000-0000-000000000001'
$$, $$ values ('e7000000-0000-0000-0000-000000000001'::uuid, 'manual'::text) $$,
  'artifact link creator is server-stamped');
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  insert into public.requirement_artifact_links (requirement_id, artifact_type, artifact_id)
  values ('e7700000-0000-0000-0000-000000000001', 'inspection_point',
          'e7900000-0000-0000-0000-000000000002')
$$, 'P0001', 'requirement and artifact must belong to the same project',
  'approved Project A requirement cannot link a Project B artifact');
select throws_ok($$
  insert into public.requirement_artifact_links (requirement_id, artifact_type, artifact_id)
  values ('e7700000-0000-0000-0000-000000000001', 'inspection_point',
          '00000000-0000-0000-0000-00000000dead')
$$, 'P0001', 'artifact does not exist for type inspection_point',
  'a fake artifact UUID cannot be linked');
select throws_ok($$
  insert into public.requirement_artifact_links (requirement_id, artifact_type, artifact_id)
  values ('e7700000-0000-0000-0000-000000000001', 'inspection_point',
          'e7900000-0000-0000-0000-000000000001')
$$, '23505', null, 'duplicate exact artifact links are rejected');
reset role;
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$
  insert into public.requirement_artifact_links (requirement_id, artifact_type, artifact_id)
  values ('e7700000-0000-0000-0000-000000000001', 'submittal',
          'e7900000-0000-0000-0000-000000000003')
$$, '42501', null, 'non-reviewer cannot create artifact links');
reset role;

-- ── Project-scoped review authority ──────────────────────────────────────────
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000006', 'approve')
$$, 'P0001', 'requirement review requires a requirement reviewer',
  'reviewer on Project A has no review authority as contractor on Project B');

-- ── Supersession still flows through the controlled action ──────────────────
select lives_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000001', 'supersede')
$$, 'approved requirement is superseded through the review action');
select throws_ok($$
  select public.review_requirement('e7700000-0000-0000-0000-000000000001', 'approve')
$$, 'P0001', 'invalid requirement lifecycle transition from superseded via approve',
  'superseded requirements cannot return to approved');
reset role;
select public.pmis_p07_login(null);

-- ── Focused audit events ─────────────────────────────────────────────────────
select is((select count(*)::integer from public.audit_events
  where event_type = 'requirement.work_item_link_approved'
    and entity_id = 'e7700000-0000-0000-0000-000000000001'), 1,
  'BOQ link approval emits one audit event');
select is((select count(*)::integer from public.audit_events
  where event_type = 'requirement.work_item_link_rejected'
    and entity_id = 'e7700000-0000-0000-0000-000000000001'), 1,
  'BOQ link rejection emits one audit event');
select is((select count(*)::integer from public.audit_events
  where event_type = 'requirement.artifact_link_created'), 1,
  'artifact link creation emits one audit event');
select is((select count(*)::integer from public.audit_events
  where event_type = 'requirement.approved'
    and entity_id = 'e7700000-0000-0000-0000-000000000001'), 1,
  'the review action still flows through the P0-05 lifecycle audit trigger');

-- ── Legacy contract_obligations synchronization keeps working ────────────────
select public.pmis_p07_login('e7000000-0000-0000-0000-000000000002');
set local role authenticated;
select lives_ok($$
  insert into public.contract_obligations
    (id, project_id, title, trigger_event, offset_days, offset_dir)
  values ('e7a00000-0000-0000-0000-000000000001',
          'e7100000-0000-0000-0000-00000000000a', '開工後15日提送品質計畫',
          'commencement', 15, 'after')
$$, 'contractor still creates legacy deadline obligations');
select lives_ok($$
  update public.contract_obligations set status = '已提送'
  where id = 'e7a00000-0000-0000-0000-000000000001'
$$, 'legacy obligation status updates keep flowing through the sync trigger');
reset role;
select public.pmis_p07_login(null);
select is((select status from public.requirements
  where id = 'e7a00000-0000-0000-0000-000000000001'), 'needs_review',
  'legacy sync still creates the unreviewed requirement mirror');

select * from finish();
rollback;
