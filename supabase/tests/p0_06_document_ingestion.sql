-- P0-06 focused pgTAP suite: traceable AI document ingestion.
-- Covers run provenance integrity, cross-project isolation, requirement
-- lifecycle safety under reprocessing, and source/work-item persistence.
-- This intentionally does not repeat the P0-04 authorization matrix or the
-- P0-05 audit suite; AI network calls never run in the database.
begin;

select plan(43);

create or replace function public.pmis_p06_login(p_uid uuid)
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

select public.pmis_p06_login(null);

-- Structure contract.
select has_table('public', 'document_ingestion_runs', 'ingestion run table exists');
select has_column('public', 'document_ingestion_runs', 'prompt_version',
  'run records the prompt version that produced its suggestions');
select has_column('public', 'requirements', 'ingestion_run_id',
  'requirements carry extraction-run provenance');
select has_function('public', 'guard_requirement_ingestion_provenance',
  'requirement provenance guard exists');
select has_function('public', 'guard_ingestion_run_write',
  'system-managed run guard exists');

-- Runs are read-only for application users at the privilege level.
select is(has_table_privilege('authenticated', 'public.document_ingestion_runs', 'INSERT'), false,
  'authenticated has no direct run INSERT privilege');
select is(has_table_privilege('authenticated', 'public.document_ingestion_runs', 'UPDATE'), false,
  'authenticated has no run UPDATE privilege');
select is(has_table_privilege('authenticated', 'public.document_ingestion_runs', 'DELETE'), false,
  'authenticated has no run DELETE privilege');

-- Deterministic fixtures: reviewer + contractor PM on A, contractor PM on B.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'reviewer@p06.test', '', now(), '{}',
   '{"full_name":"Supervisor Reviewer","org_type":"supervisor"}', now(), now()),
  ('d6000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'contractor-a@p06.test', '', now(), '{}',
   '{"full_name":"Contractor PM A","org_type":"contractor"}', now(), now()),
  ('d6000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'contractor-b@p06.test', '', now(), '{}',
   '{"full_name":"Contractor PM B","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('d6100000-0000-0000-0000-00000000000a', 'P0-06 Project A'),
  ('d6100000-0000-0000-0000-00000000000b', 'P0-06 Project B');
alter table public.projects enable trigger on_project_created;

insert into public.project_parties (id, project_id, party_type, display_name) values
  ('d6200000-0000-0000-0000-000000000001', 'd6100000-0000-0000-0000-00000000000a', 'supervisor', 'P06 Supervisor A'),
  ('d6200000-0000-0000-0000-000000000002', 'd6100000-0000-0000-0000-00000000000a', 'contractor', 'P06 Builder A'),
  ('d6200000-0000-0000-0000-000000000003', 'd6100000-0000-0000-0000-00000000000b', 'contractor', 'P06 Builder B');

insert into public.project_memberships
  (project_id, user_id, project_party_id, project_role, is_project_admin) values
  ('d6100000-0000-0000-0000-00000000000a', 'd6000000-0000-0000-0000-000000000001',
   'd6200000-0000-0000-0000-000000000001', 'supervisor_engineer', false),
  ('d6100000-0000-0000-0000-00000000000a', 'd6000000-0000-0000-0000-000000000002',
   'd6200000-0000-0000-0000-000000000002', 'contractor_pm', true),
  ('d6100000-0000-0000-0000-00000000000b', 'd6000000-0000-0000-0000-000000000003',
   'd6200000-0000-0000-0000-000000000003', 'contractor_pm', true);

insert into public.work_items (id, project_id, description, is_leaf) values
  ('d6300000-0000-0000-0000-000000000001', 'd6100000-0000-0000-0000-00000000000a', '模板組立', true),
  ('d6300000-0000-0000-0000-000000000002', 'd6100000-0000-0000-0000-00000000000b', 'B案工項', true);

insert into public.documents (id, project_id, title, document_type) values
  ('d6400000-0000-0000-0000-000000000001', 'd6100000-0000-0000-0000-00000000000a', 'A案契約.pdf', 'contract'),
  ('d6400000-0000-0000-0000-000000000002', 'd6100000-0000-0000-0000-00000000000b', 'B案規範.pdf', 'specification');

insert into public.document_versions (id, document_id, version_label, checksum) values
  ('d6500000-0000-0000-0000-000000000001', 'd6400000-0000-0000-0000-000000000001', 'v1', 'sha256:a1'),
  ('d6500000-0000-0000-0000-000000000002', 'd6400000-0000-0000-0000-000000000002', 'v1', 'sha256:b1');

insert into public.document_pages (document_version_id, page_number, extracted_text, extraction_method) values
  ('d6500000-0000-0000-0000-000000000001', 1, '第一章 總則', 'pdf_text'),
  ('d6500000-0000-0000-0000-000000000001', 2, '施工廠商應於開工前14日內檢送施工計畫書', 'pdf_text'),
  ('d6500000-0000-0000-0000-000000000002', 1, 'B案規範內容', 'pdf_text');

-- Runs are created by the ingestion service (no authenticated JWT).
insert into public.document_ingestion_runs
  (id, project_id, document_version_id, status, model_provider, model_name, prompt_version) values
  ('d6600000-0000-0000-0000-000000000001', 'd6100000-0000-0000-0000-00000000000a',
   'd6500000-0000-0000-0000-000000000001', 'completed', 'anthropic', 'claude-sonnet-5', 'extract-requirements/v1'),
  ('d6600000-0000-0000-0000-000000000002', 'd6100000-0000-0000-0000-00000000000b',
   'd6500000-0000-0000-0000-000000000002', 'completed', 'anthropic', 'claude-sonnet-5', 'extract-requirements/v1');

-- Run vocabulary is constrained.
select throws_ok($$
  insert into public.document_ingestion_runs (project_id, document_version_id, status)
  values ('d6100000-0000-0000-0000-00000000000a', 'd6500000-0000-0000-0000-000000000001', 'done')
$$, '23514', null, 'unknown run status is rejected');
select throws_ok($$
  insert into public.document_ingestion_runs (project_id, document_version_id, run_type)
  values ('d6100000-0000-0000-0000-00000000000a', 'd6500000-0000-0000-0000-000000000001', 'ocr')
$$, '23514', null, 'unknown run type is rejected');

-- A Project A document version can never be ingested as Project B.
select throws_ok($$
  insert into public.document_ingestion_runs (project_id, document_version_id)
  values ('d6100000-0000-0000-0000-00000000000b', 'd6500000-0000-0000-0000-000000000001')
$$, 'P0001', 'ingestion run and document version must belong to the same project',
  'cross-project ingestion run is rejected');
select throws_ok($$
  update public.document_ingestion_runs
  set document_version_id = 'd6500000-0000-0000-0000-000000000002'
  where id = 'd6600000-0000-0000-0000-000000000001'
$$, 'P0001', 'ingestion run document version is immutable',
  'a run cannot be repointed at another document version');
select throws_ok($$
  update public.document_ingestion_runs
  set project_id = 'd6100000-0000-0000-0000-00000000000b'
  where id = 'd6600000-0000-0000-0000-000000000001'
$$, 'P0001', 'project identity is immutable',
  'a run cannot migrate between projects');

-- Even a privileged path carrying an authenticated JWT cannot rewrite runs.
select public.pmis_p06_login('d6000000-0000-0000-0000-000000000002');
select throws_ok($$
  update public.document_ingestion_runs set status = 'failed'
  where id = 'd6600000-0000-0000-0000-000000000001'
$$, 'P0001', 'document ingestion runs are system-managed',
  'authenticated privileged update of a run is rejected');
select throws_ok($$
  delete from public.document_ingestion_runs
  where id = 'd6600000-0000-0000-0000-000000000001'
$$, 'P0001', 'document ingestion runs are system-managed',
  'authenticated privileged delete of a run is rejected');

-- Normal authenticated users have no write path at all.
set local role authenticated;
select throws_ok($$
  insert into public.document_ingestion_runs (project_id, document_version_id)
  values ('d6100000-0000-0000-0000-00000000000a', 'd6500000-0000-0000-0000-000000000001')
$$, '42501', null, 'authenticated user cannot fabricate an ingestion run');
reset role;

-- Run visibility is project-scoped.
select public.pmis_p06_login('d6000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*)::integer from public.document_ingestion_runs
  where project_id = 'd6100000-0000-0000-0000-00000000000a'), 0,
  'Project B member cannot read Project A ingestion runs');
select is((select count(*)::integer from public.document_ingestion_runs
  where project_id = 'd6100000-0000-0000-0000-00000000000b'), 1,
  'Project B member reads own ingestion run status');
reset role;

-- AI output can never be born approved, and application users can never
-- claim AI-run provenance.
select public.pmis_p06_login('d6000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  insert into public.requirements (project_id, title, requirement_type, status, origin)
  values ('d6100000-0000-0000-0000-00000000000a', '偽核定AI需求', 'submittal', 'approved', 'ai')
$$, 'P0001', 'requirements cannot be created directly in a reviewed status',
  'AI requirement cannot be inserted as approved');
select throws_ok($$
  insert into public.requirements (project_id, title, requirement_type, status, origin, ingestion_run_id)
  values ('d6100000-0000-0000-0000-00000000000a', '偽AI出處', 'submittal', 'needs_review', 'manual',
          'd6600000-0000-0000-0000-000000000001')
$$, 'P0001', 'only the ingestion service can attach a requirement to an ingestion run',
  'application users cannot forge extraction-run provenance');
reset role;
select public.pmis_p06_login(null);

-- The ingestion service persists suggestions; cross-project provenance is
-- rejected even for the service.
select throws_ok($$
  insert into public.requirements (project_id, title, requirement_type, status, origin, ingestion_run_id)
  values ('d6100000-0000-0000-0000-00000000000a', '跨案run', 'submittal', 'draft_ai', 'ai',
          'd6600000-0000-0000-0000-000000000002')
$$, 'P0001', 'requirement and ingestion run must belong to the same project',
  'requirement cannot cite another project''s ingestion run');

insert into public.requirements
  (id, project_id, title, requirement_type, status, origin, confidence, ingestion_run_id) values
  ('d6700000-0000-0000-0000-000000000001', 'd6100000-0000-0000-0000-00000000000a',
   '開工前提送施工計畫書', 'submittal', 'draft_ai', 'ai', 0.9, 'd6600000-0000-0000-0000-000000000001'),
  ('d6700000-0000-0000-0000-000000000002', 'd6100000-0000-0000-0000-00000000000a',
   '引註未驗證的建議', 'inspection', 'needs_review', 'ai', 0.5, 'd6600000-0000-0000-0000-000000000001'),
  ('d6700000-0000-0000-0000-000000000003', 'd6100000-0000-0000-0000-00000000000a',
   '之後被取代的建議', 'test', 'draft_ai', 'ai', 0.8, 'd6600000-0000-0000-0000-000000000001'),
  ('d6700000-0000-0000-0000-000000000004', 'd6100000-0000-0000-0000-00000000000a',
   '人工登錄需求', 'checklist', 'needs_review', 'manual', null, null);
select is((select count(*)::integer from public.requirements
  where ingestion_run_id = 'd6600000-0000-0000-0000-000000000001'), 3,
  'ingestion service persists AI suggestions linked to their run');

select public.pmis_p06_login('d6000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  update public.requirements set ingestion_run_id = null
  where id = 'd6700000-0000-0000-0000-000000000001'
$$, 'P0001', 'requirement ingestion provenance is immutable for application users',
  'application users cannot detach a suggestion from its run');
reset role;
select public.pmis_p06_login(null);

-- Document sources reference the exact processed version; the system verdict
-- (verified / unverified) persists as written.
insert into public.requirement_sources
  (id, requirement_id, document_version_id, source_kind, source_verified,
   page_number, section, clause, source_text) values
  ('d6800000-0000-0000-0000-000000000001', 'd6700000-0000-0000-0000-000000000001',
   'd6500000-0000-0000-0000-000000000001', 'document', true,
   2, '第五章', '§12.4', '施工廠商應於開工前14日內檢送施工計畫書'),
  ('d6800000-0000-0000-0000-000000000002', 'd6700000-0000-0000-0000-000000000002',
   'd6500000-0000-0000-0000-000000000001', 'document', false,
   null, null, '§9', '文件中找不到的引註');
select is((select document_version_id from public.requirement_sources
  where id = 'd6800000-0000-0000-0000-000000000001'),
  'd6500000-0000-0000-0000-000000000001'::uuid,
  'document source references the exact processed document version');
select throws_ok($$
  insert into public.requirement_sources (requirement_id, document_version_id, source_kind, source_text)
  values ('d6700000-0000-0000-0000-000000000001', 'd6500000-0000-0000-0000-000000000002',
          'document', '跨案引註')
$$, 'P0001', 'requirement and document version must belong to the same project',
  'requirement cannot cite another project''s document version');
select is((select source_verified from public.requirement_sources
  where requirement_id = 'd6700000-0000-0000-0000-000000000001'), true,
  'verified source state persists');
select is((select source_verified from public.requirement_sources
  where requirement_id = 'd6700000-0000-0000-0000-000000000002'), false,
  'unverified source state persists');
select throws_ok($$
  insert into public.requirement_sources (requirement_id, source_kind, source_verified, source_text)
  values ('d6700000-0000-0000-0000-000000000002', 'manual', true, '沒有文件卻宣稱已驗證')
$$, '23514', null, 'a source cannot claim verification without a document version');

-- Candidate BOQ links stay unreviewed suggestions bound to real project rows.
insert into public.requirement_work_items
  (requirement_id, work_item_id, match_type, confidence, reviewed) values
  ('d6700000-0000-0000-0000-000000000001', 'd6300000-0000-0000-0000-000000000001', 'ai', 0.9, false);
select results_eq($$
  select match_type, reviewed from public.requirement_work_items
  where requirement_id = 'd6700000-0000-0000-0000-000000000001'
$$, $$ values ('ai'::text, false) $$,
  'AI work-item suggestion persists as an unreviewed ai match');
select throws_ok($$
  insert into public.requirement_work_items (requirement_id, work_item_id, match_type)
  values ('d6700000-0000-0000-0000-000000000001', 'd6300000-0000-0000-0000-000000000002', 'ai')
$$, 'P0001', 'requirement and work item must belong to the same project',
  'AI work-item suggestion cannot cross projects');

-- Human review happens (P0-03 lifecycle), then the document is reprocessed.
select public.pmis_p06_login('d6000000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$
  update public.requirements set status = 'approved', reviewed_at = now()
  where id = 'd6700000-0000-0000-0000-000000000001'
$$, 'reviewer approves a verified AI suggestion');
select lives_ok($$
  update public.requirements set status = 'rejected', reviewed_at = now()
  where id = 'd6700000-0000-0000-0000-000000000002'
$$, 'reviewer rejects an unverified AI suggestion');
select lives_ok($$
  update public.requirements set status = 'approved', reviewed_at = now()
  where id = 'd6700000-0000-0000-0000-000000000003'
$$, 'reviewer approves the suggestion that will be superseded');
select lives_ok($$
  update public.requirements set status = 'superseded'
  where id = 'd6700000-0000-0000-0000-000000000003'
$$, 'reviewer supersedes an approved requirement');
reset role;
select public.pmis_p06_login(null);

-- Reprocessing = a NEW run for the same version. Nothing reviewed or manual
-- is deleted or mutated; historical suggestions stay bound to their run.
insert into public.document_ingestion_runs (id, project_id, document_version_id, status) values
  ('d6600000-0000-0000-0000-000000000003', 'd6100000-0000-0000-0000-00000000000a',
   'd6500000-0000-0000-0000-000000000001', 'completed');
insert into public.requirements
  (id, project_id, title, requirement_type, status, origin, ingestion_run_id) values
  ('d6700000-0000-0000-0000-000000000005', 'd6100000-0000-0000-0000-00000000000a',
   '重跑後的新建議', 'submittal', 'draft_ai', 'ai', 'd6600000-0000-0000-0000-000000000003');

select is((select count(*)::integer from public.document_ingestion_runs
  where document_version_id = 'd6500000-0000-0000-0000-000000000001'), 2,
  'a new run coexists with the older successful run for the same version');
select is((select status from public.requirements
  where id = 'd6700000-0000-0000-0000-000000000001'), 'approved',
  'approved requirement survives document reprocessing');
select is((select status from public.requirements
  where id = 'd6700000-0000-0000-0000-000000000002'), 'rejected',
  'rejected requirement survives document reprocessing');
select is((select status from public.requirements
  where id = 'd6700000-0000-0000-0000-000000000003'), 'superseded',
  'superseded requirement survives document reprocessing');
select is((select status from public.requirements
  where id = 'd6700000-0000-0000-0000-000000000004'), 'needs_review',
  'manual requirement survives document reprocessing');
select results_eq($$
  select r.ingestion_run_id, run.document_version_id
  from public.requirements r
  join public.document_ingestion_runs run on run.id = r.ingestion_run_id
  where r.id = 'd6700000-0000-0000-0000-000000000005'
$$, $$ values ('d6600000-0000-0000-0000-000000000003'::uuid,
               'd6500000-0000-0000-0000-000000000001'::uuid) $$,
  'requirement ingestion-run provenance remains traceable to the exact version');

-- Reviewed snapshots stay undeletable for application users (P0-01 recheck).
select public.pmis_p06_login('d6000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$
  delete from public.requirements where id = 'd6700000-0000-0000-0000-000000000001'
$$, 'P0001', 'reviewed requirements cannot be deleted; supersede them instead',
  'reprocessing cleanup cannot delete an approved requirement');
reset role;
select public.pmis_p06_login(null);

-- Run lifecycle audit events flow from the P0-05 trigger architecture.
select is((select count(*)::integer from public.audit_events
  where event_type = 'document.ingestion_completed'
    and entity_id = 'd6600000-0000-0000-0000-000000000003'), 1,
  'completed ingestion emits one transactional audit event');
insert into public.document_ingestion_runs (id, project_id, document_version_id, status) values
  ('d6600000-0000-0000-0000-000000000004', 'd6100000-0000-0000-0000-00000000000a',
   'd6500000-0000-0000-0000-000000000001', 'processing');
update public.document_ingestion_runs
  set status = 'failed', error_message = '文件沒有可用的已抽取文字'
  where id = 'd6600000-0000-0000-0000-000000000004';
select is((select count(*)::integer from public.audit_events
  where event_type = 'document.ingestion_failed'
    and entity_id = 'd6600000-0000-0000-0000-000000000004'), 1,
  'failed ingestion emits one transactional audit event');

select * from finish();
rollback;
