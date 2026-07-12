-- P0-07.5 focused pgTAP suite: party-scoped package visibility, provenance
-- visibility, package-aware writes, integrity, honest unsupported state,
-- controlled Requirement review, and project-delete compatibility.
begin;

select plan(37);

create or replace function public.pmis_p075_login(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', case when p_uid is null then ''
    else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end; $$;

select public.pmis_p075_login(null);

select has_table('public', 'contract_packages', 'contract package domain exists');
select has_table('public', 'document_processing_runs', 'persistent processing state exists');
select has_column('public', 'documents', 'contract_package_id', 'documents belong to packages');
select is((select public from storage.buckets where id = 'contract-documents'), false,
  'contract binary bucket is private');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a7500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'agency@p075.test', '', now(), '{}',
   '{"full_name":"Agency","org_type":"owner"}', now(), now()),
  ('a7500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'supervisor-a@p075.test', '', now(), '{}',
   '{"full_name":"Supervisor A","org_type":"supervisor"}', now(), now()),
  ('a7500000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'supervisor-b@p075.test', '', now(), '{}',
   '{"full_name":"Supervisor B","org_type":"supervisor"}', now(), now()),
  ('a7500000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'contractor@p075.test', '', now(), '{}',
   '{"full_name":"Contractor","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('a7510000-0000-0000-0000-00000000000a', 'P0-07.5 Project A'),
  ('a7510000-0000-0000-0000-00000000000b', 'P0-07.5 Project B'),
  ('a7510000-0000-0000-0000-00000000000d', 'P0-07.5 Delete Project');
alter table public.projects enable trigger on_project_created;

insert into public.project_parties
  (id, project_id, party_type, display_name, migration_key) values
  ('a7520000-0000-0000-0000-000000000001', 'a7510000-0000-0000-0000-00000000000a', 'agency', 'Agency A', 'p075:agency'),
  ('a7520000-0000-0000-0000-000000000002', 'a7510000-0000-0000-0000-00000000000a', 'contractor', 'Contractor A', 'p075:contractor'),
  ('a7520000-0000-0000-0000-000000000003', 'a7510000-0000-0000-0000-00000000000a', 'supervisor', 'Supervisor A', 'p075:supervisor-a'),
  ('a7520000-0000-0000-0000-000000000004', 'a7510000-0000-0000-0000-00000000000a', 'supervisor', 'Supervisor B', 'p075:supervisor-b'),
  ('a7520000-0000-0000-0000-000000000005', 'a7510000-0000-0000-0000-00000000000b', 'contractor', 'Contractor B', 'p075:b'),
  ('a7520000-0000-0000-0000-000000000006', 'a7510000-0000-0000-0000-00000000000d', 'contractor', 'Delete Contractor', 'p075:delete');

insert into public.project_memberships
  (id, project_id, user_id, project_party_id, project_role, is_project_admin) values
  ('a7530000-0000-0000-0000-000000000001', 'a7510000-0000-0000-0000-00000000000a', 'a7500000-0000-0000-0000-000000000001', 'a7520000-0000-0000-0000-000000000001', 'agency_pm', false),
  ('a7530000-0000-0000-0000-000000000002', 'a7510000-0000-0000-0000-00000000000a', 'a7500000-0000-0000-0000-000000000002', 'a7520000-0000-0000-0000-000000000003', 'supervisor_manager', false),
  ('a7530000-0000-0000-0000-000000000003', 'a7510000-0000-0000-0000-00000000000a', 'a7500000-0000-0000-0000-000000000003', 'a7520000-0000-0000-0000-000000000004', 'supervisor_manager', false),
  ('a7530000-0000-0000-0000-000000000004', 'a7510000-0000-0000-0000-00000000000a', 'a7500000-0000-0000-0000-000000000004', 'a7520000-0000-0000-0000-000000000002', 'contractor_pm', true),
  ('a7530000-0000-0000-0000-000000000006', 'a7510000-0000-0000-0000-00000000000d', 'a7500000-0000-0000-0000-000000000004', 'a7520000-0000-0000-0000-000000000006', 'contractor_pm', true);

-- baseline 相容(批3已取消):RLS 的 my_project_ids()/is_project_admin() 讀 project_members。
insert into public.project_members (project_id, user_id, role) values
  ('a7510000-0000-0000-0000-00000000000a', 'a7500000-0000-0000-0000-000000000001', 'member'),
  ('a7510000-0000-0000-0000-00000000000a', 'a7500000-0000-0000-0000-000000000002', 'member'),
  ('a7510000-0000-0000-0000-00000000000a', 'a7500000-0000-0000-0000-000000000003', 'member'),
  ('a7510000-0000-0000-0000-00000000000a', 'a7500000-0000-0000-0000-000000000004', 'admin'),
  ('a7510000-0000-0000-0000-00000000000d', 'a7500000-0000-0000-0000-000000000004', 'admin');

insert into public.contract_packages
  (id, project_id, owner_project_party_id, counterparty_project_party_id, package_type, title, status) values
  ('a7540000-0000-0000-0000-000000000001', 'a7510000-0000-0000-0000-00000000000a', 'a7520000-0000-0000-0000-000000000001', 'a7520000-0000-0000-0000-000000000002', 'construction', 'Construction A', 'ready'),
  ('a7540000-0000-0000-0000-000000000002', 'a7510000-0000-0000-0000-00000000000a', 'a7520000-0000-0000-0000-000000000001', 'a7520000-0000-0000-0000-000000000003', 'supervision', 'Supervision A', 'ready'),
  ('a7540000-0000-0000-0000-000000000003', 'a7510000-0000-0000-0000-00000000000a', 'a7520000-0000-0000-0000-000000000001', 'a7520000-0000-0000-0000-000000000004', 'supervision', 'Supervision B', 'ready'),
  ('a7540000-0000-0000-0000-000000000004', 'a7510000-0000-0000-0000-00000000000d', null, 'a7520000-0000-0000-0000-000000000006', 'construction', 'Delete Package', 'ready');

insert into public.documents (id, project_id, title, document_type, contract_package_id) values
  ('a7550000-0000-0000-0000-000000000001', 'a7510000-0000-0000-0000-00000000000a', 'Construction.pdf', 'contract', 'a7540000-0000-0000-0000-000000000001'),
  ('a7550000-0000-0000-0000-000000000002', 'a7510000-0000-0000-0000-00000000000a', 'Supervision.pdf', 'contract', 'a7540000-0000-0000-0000-000000000002'),
  ('a7550000-0000-0000-0000-000000000004', 'a7510000-0000-0000-0000-00000000000d', 'Delete.xlsx', 'other', 'a7540000-0000-0000-0000-000000000004');
insert into public.document_versions (id, document_id, version_label, checksum, storage_path) values
  ('a7560000-0000-0000-0000-000000000001', 'a7550000-0000-0000-0000-000000000001', 'v1', 'sha256:construction', 'projects/a/contract-packages/construction/v1.pdf'),
  ('a7560000-0000-0000-0000-000000000002', 'a7550000-0000-0000-0000-000000000002', 'v1', 'sha256:supervision', 'projects/a/contract-packages/supervision/v1.pdf'),
  ('a7560000-0000-0000-0000-000000000004', 'a7550000-0000-0000-0000-000000000004', 'v1', 'sha256:delete', 'projects/d/contract-packages/delete/v1.xlsx');
insert into public.document_pages
  (id, document_version_id, page_number, extracted_text, extraction_method) values
  ('a7570000-0000-0000-0000-000000000001', 'a7560000-0000-0000-0000-000000000001', 1, 'Construction requirement evidence', 'pdf_text'),
  ('a7570000-0000-0000-0000-000000000002', 'a7560000-0000-0000-0000-000000000002', 1, 'Supervision requirement evidence', 'pdf_text');
insert into public.document_ingestion_runs
  (id, project_id, document_version_id, status) values
  ('a7580000-0000-0000-0000-000000000001', 'a7510000-0000-0000-0000-00000000000a', 'a7560000-0000-0000-0000-000000000001', 'completed'),
  ('a7580000-0000-0000-0000-000000000002', 'a7510000-0000-0000-0000-00000000000a', 'a7560000-0000-0000-0000-000000000002', 'completed');
insert into public.requirements
  (id, project_id, title, requirement_type, status, origin, ingestion_run_id) values
  ('a7590000-0000-0000-0000-000000000001', 'a7510000-0000-0000-0000-00000000000a', 'Construction requirement', 'submittal', 'needs_review', 'ai', 'a7580000-0000-0000-0000-000000000001'),
  ('a7590000-0000-0000-0000-000000000002', 'a7510000-0000-0000-0000-00000000000a', 'Supervision requirement', 'report', 'needs_review', 'ai', 'a7580000-0000-0000-0000-000000000002');
insert into public.requirement_sources
  (id, requirement_id, document_version_id, source_kind, source_verified, page_number, source_text) values
  ('a7591000-0000-0000-0000-000000000001', 'a7590000-0000-0000-0000-000000000001', 'a7560000-0000-0000-0000-000000000001', 'document', true, 1, 'Construction requirement evidence'),
  ('a7591000-0000-0000-0000-000000000002', 'a7590000-0000-0000-0000-000000000002', 'a7560000-0000-0000-0000-000000000002', 'document', true, 1, 'Supervision requirement evidence');
insert into public.document_processing_runs
  (id, project_id, contract_package_id, document_version_id, status, stage,
   parser_type, classification_status, suggested_document_type, completed_at, metadata) values
  ('a7592000-0000-0000-0000-000000000001', 'a7510000-0000-0000-0000-00000000000a', 'a7540000-0000-0000-0000-000000000001', 'a7560000-0000-0000-0000-000000000001', 'completed', 'completed', 'pdf', 'auto_accepted', 'contract', now(), '{"requirement_extraction":"completed"}'),
  ('a7592000-0000-0000-0000-000000000002', 'a7510000-0000-0000-0000-00000000000a', 'a7540000-0000-0000-0000-000000000002', 'a7560000-0000-0000-0000-000000000002', 'completed', 'completed', 'pdf', 'auto_accepted', 'contract', now(), '{"requirement_extraction":"completed"}'),
  ('a7592000-0000-0000-0000-000000000004', 'a7510000-0000-0000-0000-00000000000d', 'a7540000-0000-0000-0000-000000000004', 'a7560000-0000-0000-0000-000000000004', 'unsupported', 'unsupported', 'none', 'auto_accepted', 'other', now(), '{"limitation":"尚未支援內容分析"}');

-- Agency sees all packages.
select public.pmis_p075_login('a7500000-0000-0000-0000-000000000001');
set local role authenticated;
select results_eq($$ select title from public.contract_packages
  where project_id = 'a7510000-0000-0000-0000-00000000000a' order by title $$,
  $$ values ('Construction A'::text), ('Supervision A'::text), ('Supervision B'::text) $$,
  'agency reads construction and every supervision package');
reset role;

-- Supervisor sees construction plus only its own supervision package.
select public.pmis_p075_login('a7500000-0000-0000-0000-000000000002');
set local role authenticated;
select results_eq($$ select title from public.contract_packages
  where project_id = 'a7510000-0000-0000-0000-00000000000a' order by title $$,
  $$ values ('Construction A'::text), ('Supervision A'::text) $$,
  'supervisor reads construction and own supervision package');
reset role;

-- Contractor sees its construction chain, never supervision provenance.
select public.pmis_p075_login('a7500000-0000-0000-0000-000000000004');
set local role authenticated;
select results_eq($$ select title from public.contract_packages
  where project_id = 'a7510000-0000-0000-0000-00000000000a' order by title $$,
  $$ values ('Construction A'::text) $$, 'contractor reads own construction package only');
select is((select count(*) from public.contract_packages where id = 'a7540000-0000-0000-0000-000000000002'), 0::bigint, 'contractor cannot read supervision package metadata');
select is((select count(*) from public.documents where id = 'a7550000-0000-0000-0000-000000000002'), 0::bigint, 'contractor cannot read supervision document filename');
select is((select count(*) from public.document_versions where id = 'a7560000-0000-0000-0000-000000000002'), 0::bigint, 'contractor cannot read supervision version');
select is((select count(*) from public.document_pages where id = 'a7570000-0000-0000-0000-000000000002'), 0::bigint, 'contractor cannot read supervision pages');
select is((select count(*) from public.document_ingestion_runs where id = 'a7580000-0000-0000-0000-000000000002'), 0::bigint, 'contractor cannot read supervision ingestion runs');
select is((select count(*) from public.requirements where id = 'a7590000-0000-0000-0000-000000000002'), 0::bigint, 'contractor cannot read supervision Requirements');
select is((select count(*) from public.requirement_sources where id = 'a7591000-0000-0000-0000-000000000002'), 0::bigint, 'contractor cannot read supervision Requirement sources');
select is(public.can_upload_contract_package('a7540000-0000-0000-0000-000000000002'), false, 'contractor cannot upload into supervision package');
update public.documents set document_type = 'report' where id = 'a7550000-0000-0000-0000-000000000002';
update public.document_pages set extracted_text = 'tampered' where id = 'a7570000-0000-0000-0000-000000000002';
reset role;
select public.pmis_p075_login(null);
select is((select document_type from public.documents where id = 'a7550000-0000-0000-0000-000000000002'), 'contract', 'guessed UUID cannot update supervision document');
select is((select extracted_text from public.document_pages where id = 'a7570000-0000-0000-0000-000000000002'), 'Supervision requirement evidence', 'guessed UUID cannot update supervision pages');

-- Agency sees both Requirement provenance chains.
select public.pmis_p075_login('a7500000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*) from public.requirements where project_id = 'a7510000-0000-0000-0000-00000000000a'), 2::bigint, 'agency reads Requirements from both package types');
reset role;
select public.pmis_p075_login(null);

-- Same-project and processing integrity hold for every writer.
select throws_ok($$ insert into public.contract_packages
  (project_id, counterparty_project_party_id, package_type, title)
  values ('a7510000-0000-0000-0000-00000000000a', 'a7520000-0000-0000-0000-000000000005', 'construction', 'Cross-project') $$,
  'P0001', 'contract package and counterparty must belong to the same project', 'package counterparty must share project');
select throws_ok($$ insert into public.documents
  (project_id, title, document_type, contract_package_id)
  values ('a7510000-0000-0000-0000-00000000000b', 'Cross-project.pdf', 'contract', 'a7540000-0000-0000-0000-000000000001') $$,
  'P0001', 'document and contract package must belong to the same project', 'document package must share project');
select throws_ok($$ insert into public.document_processing_runs
  (project_id, contract_package_id, document_version_id, status, stage)
  values ('a7510000-0000-0000-0000-00000000000a', 'a7540000-0000-0000-0000-000000000001', 'a7560000-0000-0000-0000-000000000002', 'processing', 'received') $$,
  'P0001', 'processing run must match the document''s contract package', 'processing run package must match version package');
select throws_ok($$ update public.document_processing_runs
  set status = 'unsupported', stage = 'unsupported', parser_type = 'none',
      completed_at = now(), metadata = '{"requirement_extraction":"completed"}'
  where id = 'a7592000-0000-0000-0000-000000000001' $$,
  '23514', null, 'unsupported file cannot claim successful Requirement analysis');

-- Existing controlled review authority remains unchanged.
select public.pmis_p075_login('a7500000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$ select public.review_requirement('a7590000-0000-0000-0000-000000000001', 'approve') $$,
  'P0001', 'requirement review requires a requirement reviewer', 'technical contractor admin cannot approve Requirement');
reset role;
select public.pmis_p075_login('a7500000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok($$ select public.review_requirement('a7590000-0000-0000-0000-000000000002', 'approve') $$,
  'agency reviewer can approve visible completed-run Requirement');
reset role;
select is((select status from public.requirements where id = 'a7590000-0000-0000-0000-000000000002'), 'approved', 'review RPC commits approved state');
select throws_ok($$ delete from public.requirements where id = 'a7590000-0000-0000-0000-000000000002' $$,
  'P0001', 'reviewed requirements cannot be deleted; supersede them instead', 'direct approved Requirement deletion remains blocked');
select throws_ok($$ delete from public.audit_events where project_id = 'a7510000-0000-0000-0000-00000000000a' $$,
  'P0001', 'audit events are append-only', 'direct audit deletion remains blocked');
select throws_ok($$ delete from public.project_memberships where id = 'a7530000-0000-0000-0000-000000000004' $$,
  'P0001', 'a project must keep at least one technical project admin', 'direct final-admin deletion remains blocked');

-- Whole-project deletion still cascades package/document/processing/audit state.
select public.pmis_p075_login('a7500000-0000-0000-0000-000000000004');
set local role authenticated;
select lives_ok($$ select public.delete_project('a7510000-0000-0000-0000-00000000000d') $$,
  'authorized technical admin deletes project containing package state');
reset role;
select public.pmis_p075_login(null);
select is((select count(*) from public.projects where id = 'a7510000-0000-0000-0000-00000000000d'), 0::bigint, 'delete project is gone');
select is((select count(*) from public.contract_packages where project_id = 'a7510000-0000-0000-0000-00000000000d'), 0::bigint, 'contract packages cascade');
select is((select count(*) from public.documents where project_id = 'a7510000-0000-0000-0000-00000000000d'), 0::bigint, 'package documents cascade');
select is((select count(*) from public.document_processing_runs where project_id = 'a7510000-0000-0000-0000-00000000000d'), 0::bigint, 'processing runs cascade');
select is((select count(*) from public.audit_events where project_id = 'a7510000-0000-0000-0000-00000000000d'), 0::bigint, 'package audit events cascade');


-- [批5根因回歸] 2026-07-11 事故:document_versions 的 select policy 自我回查 ×
-- supabase-js .insert().select()(=INSERT..RETURNING)→ 100% 假 RLS 違規。修復後必須全綠。
select public.pmis_p075_login('a7500000-0000-0000-0000-000000000004');
set local role authenticated;
select lives_ok($$
  insert into public.documents (id, project_id, title, document_type, contract_package_id, created_by)
  values ('a7550000-0000-0000-0000-000000000099', 'a7510000-0000-0000-0000-00000000000a',
          'Regression.pdf', 'other', 'a7540000-0000-0000-0000-000000000001',
          'a7500000-0000-0000-0000-000000000004')
$$, 'package document insert by authorized contractor');
select lives_ok($$
  insert into public.document_versions (id, document_id, version_label, checksum, storage_path)
  values ('a7560000-0000-0000-0000-000000000099', 'a7550000-0000-0000-0000-000000000099',
          'v1', 'sha256:regression', 'a7510000-0000-0000-0000-00000000000a/pkg/doc/v/regression.pdf')
  returning id
$$, 'INSERT..RETURNING on document_versions passes the fixed select policy (incident root-cause regression)');
select is((select count(*)::int from public.document_versions
  where id = 'a7560000-0000-0000-0000-000000000099'), 1,
  'the returned version row is visible to its uploader');
reset role;
select public.pmis_p075_login(null);

select * from finish();
rollback;
