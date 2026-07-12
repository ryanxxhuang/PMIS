begin;

select plan(38);

select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'project_parties', 'project_parties table exists');
select has_table('public', 'project_memberships', 'project_memberships table exists');
select has_column(
  'public', 'requirements', 'responsible_project_party_id',
  'requirements can point to a responsible project party'
);

-- Fixed users and projects make legacy conversion assertions deterministic.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'agency@example.test', '', now(), '{}',
    '{"full_name":"Agency User","org_type":"owner"}', now(), now()
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'contractor@example.test', '', now(), '{}',
    '{"full_name":"Contractor User","org_type":"contractor"}', now(), now()
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'supervisor@example.test', '', now(), '{}',
    '{"full_name":"Supervisor User","org_type":"supervisor"}', now(), now()
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'unresolved@example.test', '', now(), '{}',
    '{"full_name":"Unresolved User","org_type":"contractor"}', now(), now()
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'ryan@example.test', '', now(), '{}',
    '{"full_name":"Ryan","org_type":"contractor"}', now(), now()
  );

alter table public.projects disable trigger on_project_created;
insert into public.projects (
  id, name, owner_name, contractor_name, supervisor_name
) values
  (
    '10000000-0000-0000-0000-000000000001', 'Project A',
    'Agency A', 'Builder A', 'Supervisor A'
  ),
  (
    '10000000-0000-0000-0000-000000000002', 'Project B',
    'Agency B', 'Builder B', 'Supervisor B'
  ),
  (
    '10000000-0000-0000-0000-000000000003', 'Project C',
    null, null, null
  );
alter table public.projects enable trigger on_project_created;

insert into public.project_members (project_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'admin'),
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'member'),
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'member'),
  ('10000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'member');

select public.migrate_legacy_project_identities();

select is(
  (select count(*)::integer from public.project_parties
    where project_id = '10000000-0000-0000-0000-000000000001'),
  3,
  'all three named parties are seeded for a legacy project'
);
select is(
  (select count(*)::integer from public.project_parties
    where project_id = '10000000-0000-0000-0000-000000000003'
      and party_type = 'other' and migration_key = 'legacy:unresolved'),
  1,
  'missing identity becomes one explicit unresolved party'
);
select is(
  (select count(*)::integer from public.project_memberships),
  4,
  'every legacy membership is mirrored once'
);

-- Re-running conversion must neither duplicate nor overwrite migrated identity.
select public.migrate_legacy_project_identities();
select is(
  (select count(*)::integer from public.project_parties),
  7,
  'legacy party conversion is idempotent'
);
select is(
  (select count(*)::integer from public.project_memberships),
  4,
  'legacy membership conversion is idempotent'
);

select results_eq(
  $$
    select pp.party_type, m.project_role
    from public.project_memberships m
    join public.project_parties pp on pp.id = m.project_party_id
    where m.project_id = '10000000-0000-0000-0000-000000000001'
      and m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  $$,
  $$ values ('agency'::text, 'agency_engineer'::text) $$,
  'legacy owner identity maps to the project agency'
);
select results_eq(
  $$
    select pp.party_type, m.project_role
    from public.project_memberships m
    join public.project_parties pp on pp.id = m.project_party_id
    where m.project_id = '10000000-0000-0000-0000-000000000001'
      and m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
  $$,
  $$ values ('contractor'::text, 'contractor_pm'::text) $$,
  'legacy contractor identity maps to the project contractor'
);
select results_eq(
  $$
    select pp.party_type, m.project_role
    from public.project_memberships m
    join public.project_parties pp on pp.id = m.project_party_id
    where m.project_id = '10000000-0000-0000-0000-000000000001'
      and m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
  $$,
  $$ values ('supervisor'::text, 'supervisor_engineer'::text) $$,
  'legacy supervisor identity maps to the project supervisor'
);
select results_eq(
  $$
    select pp.party_type, m.project_role, m.is_project_admin
    from public.project_memberships m
    join public.project_parties pp on pp.id = m.project_party_id
    where m.project_id = '10000000-0000-0000-0000-000000000001'
      and m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  $$,
  $$ values ('agency'::text, 'agency_engineer'::text, true) $$,
  'technical admin is copied without redefining party or project role'
);
select results_eq(
  $$
    select pp.party_type, pp.display_name, m.project_role, m.is_project_admin
    from public.project_memberships m
    join public.project_parties pp on pp.id = m.project_party_id
    where m.project_id = '10000000-0000-0000-0000-000000000003'
  $$,
  $$ values ('other'::text, '未分類（待確認）'::text, 'viewer'::text, false) $$,
  'unresolved identity is conservative and explicit'
);
select is(
  (select count(*)::integer from public.organizations),
  0,
  'legacy conversion does not fabricate organizations'
);
select is(
  (select count(*)::integer from public.project_members),
  4,
  'legacy project membership rows remain untouched'
);
select results_eq(
  $$
    select owner_name, contractor_name, supervisor_name
    from public.projects where id = '10000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('Agency A'::text, 'Builder A'::text, 'Supervisor A'::text) $$,
  'legacy project party-name fields remain untouched'
);

select throws_ok(
  $$
    insert into public.project_memberships (
      project_id, user_id, project_party_id, project_role
    ) select
      '10000000-0000-0000-0000-000000000001',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', id, 'viewer'
    from public.project_parties
    where project_id = '10000000-0000-0000-0000-000000000001'
      and migration_key = 'legacy:agency'
  $$,
  '23505', null,
  'one user has at most one membership per project'
);
select throws_ok(
  $$
    insert into public.project_parties (
      project_id, party_type, display_name, migration_key
    ) values (
      '10000000-0000-0000-0000-000000000001',
      'agency', 'Duplicate Agency', 'legacy:agency'
    )
  $$,
  '23505', null,
  'legacy party keys are unique within a project'
);

-- Ryan represents different parties and roles on two projects.
insert into public.project_memberships (
  id, project_id, user_id, project_party_id, project_role, is_project_admin
) select
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', id, 'contractor_pm', true
from public.project_parties
where project_id = '10000000-0000-0000-0000-000000000001'
  and migration_key = 'legacy:contractor';
insert into public.project_memberships (
  id, project_id, user_id, project_party_id, project_role, is_project_admin
) select
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5',
  id, 'supervisor_engineer', false
from public.project_parties
where project_id = '10000000-0000-0000-0000-000000000002'
  and migration_key = 'legacy:supervisor';

do $setup$
begin
  perform set_config(
    'request.jwt.claim.sub',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5',
    true
  );
end;
$setup$;

select is(
  public.my_project_party_type('10000000-0000-0000-0000-000000000001'),
  'contractor',
  'Ryan represents the contractor on Project A'
);
select is(
  public.my_project_role('10000000-0000-0000-0000-000000000001'),
  'contractor_pm',
  'Ryan is contractor PM on Project A'
);
select is(
  public.is_project_admin_v2('10000000-0000-0000-0000-000000000001'),
  true,
  'Ryan may separately be a technical admin on Project A'
);
select is(
  public.my_project_party_type('10000000-0000-0000-0000-000000000002'),
  'supervisor',
  'Ryan represents the supervisor on Project B'
);
select is(
  public.my_project_role('10000000-0000-0000-0000-000000000002'),
  'supervisor_engineer',
  'Ryan is supervisor engineer on Project B'
);
select is(
  public.is_project_admin_v2('10000000-0000-0000-0000-000000000002'),
  false,
  'Ryan is not a technical admin on Project B'
);
select is(
  public.is_project_member_v2('10000000-0000-0000-0000-000000000001'),
  true,
  'new membership recognizes Ryan on Project A'
);
select is(
  public.is_project_member_v2('10000000-0000-0000-0000-000000000002'),
  true,
  'new membership recognizes Ryan on Project B'
);
select is(
  (select count(*)::integer from public.my_project_ids_v2()),
  2,
  'new project boundary returns Ryan two independent projects'
);

select throws_ok(
  $$
    insert into public.project_memberships (
      project_id, user_id, project_party_id, project_role
    ) select
      '10000000-0000-0000-0000-000000000001',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', id, 'viewer'
    from public.project_parties
    where project_id = '10000000-0000-0000-0000-000000000002'
      and migration_key = 'legacy:supervisor'
  $$,
  'P0001',
  'project membership and project party must belong to the same project',
  'cross-project membership-to-party links are rejected'
);
select throws_ok(
  $$
    update public.project_memberships
    set project_id = '10000000-0000-0000-0000-000000000002'
    where id = '30000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'project identity is immutable',
  'a project membership cannot be reassigned to another project'
);
select throws_ok(
  $$
    update public.project_parties
    set project_id = '10000000-0000-0000-0000-000000000001'
    where project_id = '10000000-0000-0000-0000-000000000002'
      and migration_key = 'legacy:supervisor'
  $$,
  'P0001',
  'project identity is immutable',
  'a project party cannot be reassigned to another project'
);

select throws_ok(
  $$
    insert into public.requirements (
      id, project_id, title, responsible_project_party_id
    ) select
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'Cross-project responsibility', id
    from public.project_parties
    where project_id = '10000000-0000-0000-0000-000000000002'
      and migration_key = 'legacy:supervisor'
  $$,
  'P0001',
  'requirement and responsible project party must belong to the same project',
  'requirements reject a responsible party from another project'
);
insert into public.requirements (
  id, project_id, title, responsible_project_party_id
) select
  '40000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'Valid responsibility', id
from public.project_parties
where project_id = '10000000-0000-0000-0000-000000000002'
  and migration_key = 'legacy:supervisor';
select is(
  (select count(*)::integer
   from public.requirements r
   join public.project_parties pp on pp.id = r.responsible_project_party_id
   where r.id = '40000000-0000-0000-0000-000000000002'
     and pp.project_id = r.project_id),
  1,
  'a requirement accepts a party from the same project'
);
-- P0-03: application users can no longer hard-delete project parties (they
-- deactivate them instead). The ON DELETE SET NULL behavior below is now a
-- service-role operation, so clear the authenticated identity first.
do $setup$
begin
  perform set_config('request.jwt.claim.sub', '', true);
end;
$setup$;
delete from public.project_parties
where project_id = '10000000-0000-0000-0000-000000000002'
  and migration_key = 'legacy:supervisor';
select is(
  (select responsible_project_party_id from public.requirements
    where id = '40000000-0000-0000-0000-000000000002'),
  null::uuid,
  'deleting a party clears requirement responsibility'
);

select throws_ok(
  $$
    insert into public.project_parties (
      project_id, party_type, display_name
    ) values (
      '10000000-0000-0000-0000-000000000001', 'owner', 'Invalid Party'
    )
  $$,
  '23514', null,
  'party type vocabulary is enforced'
);
select throws_ok(
  $$
    insert into public.project_memberships (
      project_id, user_id, project_party_id, project_role
    ) select
      '10000000-0000-0000-0000-000000000001',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', id, 'admin'
    from public.project_parties
    where project_id = '10000000-0000-0000-0000-000000000001'
      and migration_key = 'legacy:agency'
  $$,
  '23514', null,
  'project role vocabulary excludes technical admin'
);
select is(
  (select count(*)::integer
   from pg_class
   where oid in (
     'public.organizations'::regclass,
     'public.project_parties'::regclass,
     'public.project_memberships'::regclass
   ) and relrowsecurity),
  3,
  'all new identity tables have RLS enabled'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public'
     and tablename in ('organizations', 'project_parties', 'project_memberships')),
  12,
  'new identity tables have explicit read and write policies'
);

select * from finish();
rollback;
