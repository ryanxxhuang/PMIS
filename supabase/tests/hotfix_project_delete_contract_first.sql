-- Focused production-hotfix pgTAP suite. It exercises whole-project cascade
-- deletion and proves normal protected-row deletion remains closed.
begin;

select plan(22);

create or replace function public.pmis_hotfix_login(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', case when p_uid is null then ''
    else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end; $$;

select public.pmis_hotfix_login(null);

select has_function('public', 'is_project_delete_context', array['uuid'],
  'exact project-delete context helper exists');
select has_function('public', 'delete_project', array['uuid'],
  'controlled project-delete RPC exists');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('f7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@hotfix.test', '', now(), '{}',
   '{"full_name":"Hotfix Admin","org_type":"contractor"}', now(), now()),
  ('f7000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member@hotfix.test', '', now(), '{}',
   '{"full_name":"Hotfix Member","org_type":"contractor"}', now(), now());

alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name) values
  ('f7100000-0000-0000-0000-00000000000a', 'Hotfix disposable A'),
  ('f7100000-0000-0000-0000-00000000000b', 'Hotfix protected B');
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('f7100000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-000000000001', 'admin'),
  ('f7100000-0000-0000-0000-00000000000b', 'f7000000-0000-0000-0000-000000000001', 'admin'),
  ('f7100000-0000-0000-0000-00000000000b', 'f7000000-0000-0000-0000-000000000002', 'member');

insert into public.project_parties
  (id, project_id, party_type, display_name, migration_key) values
  ('f7200000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 'contractor', 'Builder A', 'hotfix:a'),
  ('f7200000-0000-0000-0000-00000000000b', 'f7100000-0000-0000-0000-00000000000b', 'contractor', 'Builder B', 'hotfix:b');
insert into public.project_memberships
  (id, project_id, user_id, project_party_id, project_role, is_project_admin) values
  ('f7250000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a',
   'f7000000-0000-0000-0000-000000000001', 'f7200000-0000-0000-0000-00000000000a', 'contractor_pm', true),
  ('f7250000-0000-0000-0000-00000000000b', 'f7100000-0000-0000-0000-00000000000b',
   'f7000000-0000-0000-0000-000000000001', 'f7200000-0000-0000-0000-00000000000b', 'contractor_pm', true),
  ('f7250000-0000-0000-0000-00000000000c', 'f7100000-0000-0000-0000-00000000000b',
   'f7000000-0000-0000-0000-000000000002', 'f7200000-0000-0000-0000-00000000000b', 'viewer', false);

insert into public.work_items (id, project_id, description, is_leaf) values
  ('f7300000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 'A item', true),
  ('f7300000-0000-0000-0000-00000000000b', 'f7100000-0000-0000-0000-00000000000b', 'B item', true);
insert into public.valuations (id, project_id, period_no, status) values
  ('f7400000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 1, '已核定'),
  ('f7400000-0000-0000-0000-00000000000b', 'f7100000-0000-0000-0000-00000000000b', 1, '已核定');
insert into public.valuation_items (id, valuation_id, work_item_id, cum_qty) values
  ('f7450000-0000-0000-0000-00000000000a', 'f7400000-0000-0000-0000-00000000000a', 'f7300000-0000-0000-0000-00000000000a', 1);
insert into public.inspections (id, project_id, title, status) values
  ('f7500000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 'Decided inspection', '合格');
insert into public.submittals (id, project_id, title, status) values
  ('f7600000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 'Reviewed submittal', '核准');
insert into public.rfis (id, project_id, title, answer, status) values
  ('f7700000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 'Answered RFI', 'Answer', '已結案');
insert into public.change_orders (id, project_id, title, status) values
  ('f7800000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 'Approved CO A', '核准'),
  ('f7800000-0000-0000-0000-00000000000b', 'f7100000-0000-0000-0000-00000000000b', 'Approved CO B', '核准');
insert into public.change_order_items
  (id, change_order_id, project_id, description, amount_delta) values
  ('f7850000-0000-0000-0000-00000000000a', 'f7800000-0000-0000-0000-00000000000a',
   'f7100000-0000-0000-0000-00000000000a', 'CO line', 100);

insert into public.documents (id, project_id, title, document_type) values
  ('f7900000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 'Contract.pdf', 'contract');
insert into public.document_versions (id, document_id, version_label, checksum) values
  ('f7910000-0000-0000-0000-00000000000a', 'f7900000-0000-0000-0000-00000000000a', 'v1', 'sha256:hotfix');
insert into public.document_ingestion_runs
  (id, project_id, document_version_id, status) values
  ('f7920000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a',
   'f7910000-0000-0000-0000-00000000000a', 'completed');
insert into public.requirements
  (id, project_id, title, requirement_type, status, origin, ingestion_run_id) values
  ('f7930000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a',
   'Approved A requirement', 'submittal', 'approved', 'ai', 'f7920000-0000-0000-0000-00000000000a'),
  ('f7930000-0000-0000-0000-00000000000b', 'f7100000-0000-0000-0000-00000000000b',
   'Approved B requirement', 'submittal', 'approved', 'manual', null);
insert into public.requirement_sources
  (id, requirement_id, document_version_id, source_kind, source_verified, page_number, source_text) values
  ('f7940000-0000-0000-0000-00000000000a', 'f7930000-0000-0000-0000-00000000000a',
   'f7910000-0000-0000-0000-00000000000a', 'document', true, 1, 'Hotfix source');
insert into public.audit_events
  (id, project_id, event_type, entity_type, action) values
  ('f7950000-0000-0000-0000-00000000000a', 'f7100000-0000-0000-0000-00000000000a', 'hotfix.fixture', 'project', 'created'),
  ('f7950000-0000-0000-0000-00000000000b', 'f7100000-0000-0000-0000-00000000000b', 'hotfix.fixture', 'project', 'created');

select public.pmis_hotfix_login('f7000000-0000-0000-0000-000000000002');
select throws_ok($$select public.delete_project('f7100000-0000-0000-0000-00000000000b')$$,
  'P0001', '只有專案技術管理者可以刪除專案', 'non-admin cannot delete own project');
select throws_ok($$select public.delete_project('f7100000-0000-0000-0000-00000000000a')$$,
  'P0001', '只有專案技術管理者可以刪除專案', 'Project B member cannot delete Project A');

select public.pmis_hotfix_login('f7000000-0000-0000-0000-000000000001');
select throws_ok($$delete from public.audit_events where id = 'f7950000-0000-0000-0000-00000000000b'$$,
  'P0001', 'audit events are append-only', 'direct audit delete remains rejected');
select throws_ok($$delete from public.requirements where id = 'f7930000-0000-0000-0000-00000000000b'$$,
  'P0001', 'reviewed requirements cannot be deleted; supersede them instead', 'direct approved Requirement delete remains rejected');
select throws_ok($$delete from public.project_memberships where id = 'f7250000-0000-0000-0000-00000000000b'$$,
  'P0001', 'a project must keep at least one technical project admin', 'direct final-admin delete remains rejected');
select throws_ok($$delete from public.project_parties where id = 'f7200000-0000-0000-0000-00000000000b'$$,
  'P0001', 'a project party with memberships cannot be deleted; deactivate it instead', 'direct party hard-delete remains rejected');
select throws_ok($$delete from public.valuations where id = 'f7400000-0000-0000-0000-00000000000b'$$,
  'P0001', '已核定估驗不可刪除(需監造退回後處理)', 'direct approved valuation delete remains rejected');
select throws_ok($$delete from public.change_orders where id = 'f7800000-0000-0000-0000-00000000000b'$$,
  'P0001', '已核准變更設計不可刪除(需先撤銷核定)', 'direct approved change-order delete remains rejected');

select lives_ok($$select public.delete_project('f7100000-0000-0000-0000-00000000000a')$$,
  'authorized technical admin deletes protected whole project');
select is((select count(*) from public.projects where id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'project is gone');
select is((select count(*) from public.project_parties where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'parties cascade');
select is((select count(*) from public.project_memberships where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'memberships cascade');
select is((select count(*) from public.audit_events where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'audit events cascade');
select is((select count(*) from public.requirements where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'Requirements cascade');
select is((select count(*) from public.valuations where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'valuations cascade');
select is((select count(*) from public.inspections where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'inspections cascade');
select is((select count(*) from public.submittals where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'submittals cascade');
select is((select count(*) from public.rfis where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'RFIs cascade');
select is((select count(*) from public.change_orders where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'change orders cascade');
select is((select count(*) from public.document_ingestion_runs where project_id = 'f7100000-0000-0000-0000-00000000000a'), 0::bigint, 'ingestion runs cascade');

select * from finish();
rollback;
