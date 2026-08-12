begin;

select plan(44);

select has_table('public', 'documents', 'documents table exists');
select has_table('public', 'document_versions', 'document_versions table exists');
select has_table('public', 'document_pages', 'document_pages table exists');
select has_table('public', 'requirements', 'requirements table exists');
select has_table('public', 'requirement_sources', 'requirement_sources table exists');
select has_table('public', 'requirement_work_items', 'requirement_work_items table exists');

-- Fixed IDs make all migration and relationship assertions deterministic.
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name)
values
  ('10000000-0000-0000-0000-000000000001', 'P0-01 Test Project A'),
  ('10000000-0000-0000-0000-000000000002', 'P0-01 Test Project B');
alter table public.projects enable trigger on_project_created;

insert into public.work_items (id, project_id, description)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Concrete A'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Rebar A'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Concrete B');

insert into public.documents (id, project_id, title, document_type)
values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Project A Contract', 'contract'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Project B Specification', 'specification');

insert into public.document_versions (
  id, document_id, version_label, revision_number, storage_path,
  original_filename, mime_type, file_size, checksum
) values
  (
    '70000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    'Rev.0', 0, 'project-a/contract-rev0.pdf', 'contract.pdf',
    'application/pdf', 1000, 'sha256:rev0'
  ),
  (
    '70000000-0000-0000-0000-000000000003',
    '60000000-0000-0000-0000-000000000002',
    'Rev.0', 0, 'project-b/spec-rev0.pdf', 'spec.pdf',
    'application/pdf', 2000, 'sha256:spec0'
  );

insert into public.document_versions (
  id, document_id, version_label, revision_number, supersedes_version_id
) values (
  '70000000-0000-0000-0000-000000000002',
  '60000000-0000-0000-0000-000000000001',
  'Rev.1', 1, '70000000-0000-0000-0000-000000000001'
);

select is(
  (select supersedes_version_id from public.document_versions
    where id = '70000000-0000-0000-0000-000000000002'),
  '70000000-0000-0000-0000-000000000001'::uuid,
  'a document version may supersede a version of the same document'
);

select throws_ok(
  $$
    insert into public.document_versions (
      id, document_id, version_label, supersedes_version_id
    ) values (
      '70000000-0000-0000-0000-000000000004',
      '60000000-0000-0000-0000-000000000001',
      'Invalid', '70000000-0000-0000-0000-000000000003'
    )
  $$,
  'P0001',
  'superseded version must belong to the same document',
  'cross-document supersedes links are rejected'
);

insert into public.document_pages (
  id, document_version_id, page_number, extracted_text, extraction_method
) values (
  '80000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  1, 'Contract page one', 'pdf_text'
);

select throws_ok(
  $$
    insert into public.document_pages (
      document_version_id, page_number, extracted_text, extraction_method
    ) values (
      '70000000-0000-0000-0000-000000000001', 1, 'Duplicate', 'pdf_text'
    )
  $$,
  '23505', null,
  'document page numbers are unique within a version'
);

select throws_ok(
  $$
    insert into public.document_pages (
      document_version_id, page_number, extracted_text, extraction_method
    ) values (
      '70000000-0000-0000-0000-000000000001', 0, 'Invalid', 'pdf_text'
    )
  $$,
  '23514', null,
  'document page numbers must be positive'
);

insert into public.requirements (
  id, project_id, title, requirement_type, status, origin, reviewed_at
) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Manual review item', 'inspection', 'needs_review', 'manual', null),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'AI draft', 'inspection', 'draft_ai', 'ai', null),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Approved rule', 'inspection', 'approved', 'ai', now()),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Rejected suggestion', 'inspection', 'rejected', 'ai', now()),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Superseded rule', 'inspection', 'superseded', 'ai', now());

select throws_ok(
  $$
    insert into public.requirement_sources (
      requirement_id, source_kind, source_verified
    ) values (
      '30000000-0000-0000-0000-000000000001', 'document', false
    )
  $$,
  '23514', null,
  'document sources require a document version'
);

insert into public.requirement_sources (
  id, requirement_id, source_kind, source_verified, page_number, clause
) values (
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'legacy', false, 42, '1.2.3'
);

select is(
  (select count(*)::integer from public.requirement_sources
    where id = '40000000-0000-0000-0000-000000000001'
      and document_version_id is null and source_kind = 'legacy'),
  1,
  'legacy sources permit a null document version'
);

select throws_ok(
  $$
    insert into public.requirement_sources (
      requirement_id, source_kind, source_verified
    ) values (
      '30000000-0000-0000-0000-000000000001', 'legacy', true
    )
  $$,
  '23514', null,
  'a source cannot be verified without a stored document version'
);

insert into public.requirement_sources (
  id, requirement_id, document_version_id, source_kind, source_verified,
  page_number, source_text
) values (
  '40000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'document', true, 1, 'Contract page one'
);

select results_eq(
  $$
    select source_kind, source_verified, document_version_id::text
    from public.requirement_sources
    where id = '40000000-0000-0000-0000-000000000002'
  $$,
  $$
    values ('document'::text, true, '70000000-0000-0000-0000-000000000001'::text)
  $$,
  'document-backed verified sources are distinguishable'
);

select throws_ok(
  $$
    insert into public.requirement_sources (
      requirement_id, document_version_id, source_kind, source_verified
    ) values (
      '30000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003',
      'document', false
    )
  $$,
  'P0001',
  'requirement and document version must belong to the same project',
  'cross-project requirement/document source links are rejected'
);

insert into public.requirement_work_items (
  requirement_id, work_item_id, match_type, confidence, reviewed
) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'code', 0.98, true),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'manual', null, true);

select is(
  (select count(*)::integer from public.requirement_work_items
    where requirement_id = '30000000-0000-0000-0000-000000000001'),
  2,
  'a requirement supports multiple BOQ work-item links'
);

select throws_ok(
  $$
    insert into public.requirement_work_items (
      requirement_id, work_item_id, match_type, reviewed
    ) values (
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000003',
      'manual', true
    )
  $$,
  'P0001',
  'requirement and work item must belong to the same project',
  'cross-project requirement/work-item links are rejected'
);

select throws_ok(
  $$
    update public.requirements
    set project_id = '10000000-0000-0000-0000-000000000002'
    where id = '30000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'project identity is immutable',
  'a linked requirement cannot be reassigned to another project'
);

select throws_ok(
  $$
    update public.documents
    set project_id = '10000000-0000-0000-0000-000000000002'
    where id = '60000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'project identity is immutable',
  'a cited document cannot be reassigned to another project'
);

select throws_ok(
  $$
    update public.work_items
    set project_id = '10000000-0000-0000-0000-000000000002'
    where id = '20000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'project identity is immutable',
  'a linked work item cannot be reassigned to another project'
);

select is((select is_authoritative from public.requirements where id = '30000000-0000-0000-0000-000000000002'), false, 'draft_ai is not authoritative');
select is((select is_authoritative from public.requirements where id = '30000000-0000-0000-0000-000000000001'), false, 'manual needs_review is not authoritative');
select is((select is_authoritative from public.requirements where id = '30000000-0000-0000-0000-000000000003'), true, 'approved is authoritative');
select is((select is_authoritative from public.requirements where id = '30000000-0000-0000-0000-000000000004'), false, 'reviewed_at does not make rejected authoritative');
select is((select is_authoritative from public.requirements where id = '30000000-0000-0000-0000-000000000005'), false, 'reviewed_at does not make superseded authoritative');

select is((select count(*)::integer from public.authoritative_requirements where id = '30000000-0000-0000-0000-000000000003'), 1, 'approved appears in authoritative_requirements');
select is((select count(*)::integer from public.authoritative_requirements where id = '30000000-0000-0000-0000-000000000002'), 0, 'draft_ai is excluded from authoritative_requirements');
select is((select count(*)::integer from public.authoritative_requirements where id = '30000000-0000-0000-0000-000000000001'), 0, 'needs_review is excluded from authoritative_requirements');
select is((select count(*)::integer from public.authoritative_requirements where id = '30000000-0000-0000-0000-000000000004'), 0, 'rejected is excluded from authoritative_requirements');
select is((select count(*)::integer from public.authoritative_requirements where id = '30000000-0000-0000-0000-000000000005'), 0, 'superseded is excluded from authoritative_requirements');


-- D-012: Requirement owns contractual content. Only an approved deadline is
-- adapted into the obligation runtime, and repeated materialization preserves
-- the runtime fields that users operate.
select has_function('public', 'materialize_deadline_obligation', array['uuid'],
  'approved deadline materialization boundary exists');
select is((select count(*)::integer from pg_trigger
  where tgrelid = 'public.contract_obligations'::regclass
    and tgname = 'contract_obligations_sync_requirement' and not tgisinternal), 0,
  'obligation-to-Requirement synchronization trigger is retired');
select is((select count(*)::integer from pg_trigger
  where tgrelid = 'public.contract_obligations'::regclass
    and tgname = 'contract_obligations_delete_requirement' and not tgisinternal), 0,
  'obligation deletion no longer mutates Requirement');
select is(has_table_privilege('authenticated', 'public.contract_obligations', 'INSERT'), false,
  'browser users cannot author compatibility obligations directly');
select is(has_table_privilege('authenticated', 'public.contract_obligations', 'DELETE'), false,
  'browser users cannot delete compatibility obligations directly');
select is(has_column_privilege('authenticated', 'public.contract_obligations', 'status', 'UPDATE'), true,
  'browser users may operate obligation status');
select is(has_column_privilege('authenticated', 'public.contract_obligations', 'evidence_submittal_id', 'UPDATE'), true,
  'browser users may attach obligation evidence');

insert into public.requirements (
  id, project_id, title, description, requirement_type,
  responsible_party_type, lifecycle_phase, trigger_type, trigger_config,
  frequency_type, frequency_config, status, origin
) values (
  '90000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Submit quality plan', '契約說明', 'deadline',
  'contractor', '開工前', 'commencement',
  '{"offset_days":30,"offset_dir":"after"}',
  null, '{}', 'needs_review', 'manual'
);

select is(public.materialize_deadline_obligation(
  '90000000-0000-0000-0000-000000000001'), null::uuid,
  'unapproved deadline does not create an obligation');
select is((select count(*)::integer from public.contract_obligations
  where requirement_id = '90000000-0000-0000-0000-000000000001'), 0,
  'unapproved deadline leaves no compatibility row');

update public.requirements set status = 'approved', reviewed_at = now()
where id = '90000000-0000-0000-0000-000000000001';
select lives_ok($$
  select public.materialize_deadline_obligation('90000000-0000-0000-0000-000000000001')
$$, 'approved deadline materializes successfully');
select results_eq(
  $$
    select title, category, trigger_event, offset_days, offset_dir,
           responsible, status, requirement_id::text
    from public.contract_obligations
    where requirement_id = '90000000-0000-0000-0000-000000000001'
  $$,
  $$ values (
    'Submit quality plan'::text, '開工前'::text, 'commencement'::text,
    30, 'after'::text, '廠商'::text, '待辦'::text,
    '90000000-0000-0000-0000-000000000001'::text
  ) $$,
  'approved Requirement content maps to one obligation runtime row'
);

update public.contract_obligations
set status = '已完成', penalty = '每日千分之一', note = '現場備註'
where requirement_id = '90000000-0000-0000-0000-000000000001';
update public.requirements
set title = 'Updated quality plan', trigger_config = '{"offset_days":45,"offset_dir":"before"}'
where id = '90000000-0000-0000-0000-000000000001';
select is(public.materialize_deadline_obligation(
  '90000000-0000-0000-0000-000000000001'),
  '90000000-0000-0000-0000-000000000001'::uuid,
  'materialization retry returns the existing obligation identity');
select results_eq(
  $$
    select count(*)::integer, min(title), min(offset_days), min(offset_dir),
           min(status), min(penalty), min(note)
    from public.contract_obligations
    where requirement_id = '90000000-0000-0000-0000-000000000001'
  $$,
  $$ values (
    1, 'Updated quality plan'::text, 45, 'before'::text,
    '已完成'::text, '每日千分之一'::text, '現場備註'::text
  ) $$,
  'retry updates contractual fields once and preserves runtime state'
);

-- auth.uid() is non-null here, exercising the application-user guard.
do $setup$
begin
  perform set_config(
    'request.jwt.claim.sub',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    true
  );
end;
$setup$;
select throws_ok(
  $$
    update public.document_versions
    set storage_path = 'project-a/replaced.pdf'
    where id = '70000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'document version file identity is immutable; create a new version',
  'application users cannot replace document version file identity'
);

select * from finish();
rollback;
