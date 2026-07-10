begin;

select plan(17);

select has_table('public', 'requirements', 'requirements table exists');
select has_table('public', 'requirement_sources', 'requirement_sources table exists');
select has_table('public', 'requirement_work_items', 'requirement_work_items table exists');

-- Fixed IDs make the trigger/backfill assertions deterministic and rerunnable.
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

insert into public.contract_obligations (
  id, project_id, title, category, trigger_event, offset_days, offset_dir,
  recurring, responsible, source_clause, source_page, status
) values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Submit quality plan', 'before_start', 'commencement', 30, 'after',
  null, 'contractor', '1.2.3', 'p.42', 'pending'
);

select is(
  (select count(*)::integer from public.requirements
    where id = '30000000-0000-0000-0000-000000000001'),
  1,
  'legacy obligation creates exactly one requirement root'
);

select results_eq(
  $$
    select requirement_type, trigger_type,
           trigger_config ->> 'offset_days',
           trigger_config ->> 'offset_dir'
    from public.requirements
    where id = '30000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('deadline'::text, 'commencement'::text, '30'::text, 'after'::text) $$,
  'legacy deadline rule is preserved in the requirement root'
);

select results_eq(
  $$
    select page_number, page_label, clause
    from public.requirement_sources
    where id = '30000000-0000-0000-0000-000000000001'
  $$,
  $$ values (42, 'p.42'::text, '1.2.3'::text) $$,
  'legacy page and clause are preserved as a source'
);

update public.contract_obligations
set status = 'submitted'
where id = '30000000-0000-0000-0000-000000000001';
update public.contract_obligations
set status = 'pending'
where id = '30000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer from public.requirement_sources
    where id = '30000000-0000-0000-0000-000000000001'),
  1,
  'repeated legacy synchronization is idempotent'
);

insert into public.requirement_sources (
  id, requirement_id, document_version_id, page_number, section, clause,
  source_text, source_start_offset, source_end_offset
) values
  (
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    43, 'Quality', '1.2.4', 'First supporting quotation', 10, 37
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    44, 'Quality', '1.2.5', 'Second supporting quotation', 40, 68
  );

select is(
  (select count(*)::integer from public.requirement_sources
    where requirement_id = '30000000-0000-0000-0000-000000000001'),
  3,
  'a requirement supports multiple traceable sources'
);

select results_eq(
  $$
    select document_version_id::text, page_number, section, clause, source_text,
           source_start_offset, source_end_offset
    from public.requirement_sources
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  $$
    values (
      '50000000-0000-0000-0000-000000000001'::text,
      43, 'Quality'::text, '1.2.4'::text, 'First supporting quotation'::text,
      10, 37
    )
  $$,
  'document version, page, clause, quotation, and offsets are preserved'
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
  'cross-project work-item links are rejected'
);

insert into public.requirements (
  id, project_id, title, requirement_type, status, ai_generated
) values (
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'AI inspection suggestion', 'inspection', 'draft_ai', true
);

select is(
  (select is_authoritative from public.requirements
    where id = '30000000-0000-0000-0000-000000000002'),
  false,
  'unreviewed AI requirements are not authoritative'
);

update public.requirements
set status = 'approved', reviewed_at = now()
where id = '30000000-0000-0000-0000-000000000002';

select is(
  (select is_authoritative from public.requirements
    where id = '30000000-0000-0000-0000-000000000002'),
  true,
  'reviewed AI requirements become authoritative'
);

select is(
  (select count(*)::integer from public.authoritative_requirements
    where id = '30000000-0000-0000-0000-000000000002'),
  1,
  'authoritative view exposes the reviewed requirement'
);

delete from public.contract_obligations
where id = '30000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer from public.requirements
    where id = '30000000-0000-0000-0000-000000000001'),
  0,
  'deleting an unreviewed legacy obligation removes its mirrored root'
);

insert into public.contract_obligations (
  id, project_id, title, trigger_event, offset_days, offset_dir, status
) values (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'Reviewed deadline', 'notice', 7, 'after', 'pending'
);
update public.requirements
set reviewed_at = now()
where id = '30000000-0000-0000-0000-000000000003';
delete from public.contract_obligations
where id = '30000000-0000-0000-0000-000000000003';

select is(
  (select count(*)::integer from public.requirements
    where id = '30000000-0000-0000-0000-000000000003'),
  1,
  'legacy parser replacement preserves human-reviewed requirements'
);

select is(
  (select count(*)::integer from public.requirements
    where project_id = '10000000-0000-0000-0000-000000000002'),
  0,
  'test data remains project-scoped'
);

select * from finish();
rollback;
