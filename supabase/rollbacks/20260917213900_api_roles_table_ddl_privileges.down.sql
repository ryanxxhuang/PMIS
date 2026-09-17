-- Roll back 20260917213900 (H1: TRUNCATE/REFERENCES/TRIGGER/MAINTAIN revoked from the
-- API roles on every public table, plus the matching default-privilege change).
-- Run through SQL Editor / psql as database owner (postgres) in one transaction.
-- Data policy: the forward migration touched ACLs only; no rows, columns, indexes,
-- policies or triggers change in either direction.
-- Restores the pre-H1 shape exactly: the Supabase platform default ACL gave the three
-- API roles all four privileges on every table created by postgres, except the seven
-- tables whose own migrations had already run `revoke all` for anon/authenticated
-- (20260728000000 platform_admin_bootstrap, 20260911100000 demo_requests,
-- 20260917201000 photo_intakes + the four field_document* tables). service_role had
-- them everywhere. Nothing in the product depends on these grants (PostgREST never
-- issues TRUNCATE/DDL), so this file exists for exact reversibility only; re-opening
-- them re-opens the TRUNCATE hole that bypasses RLS and the row-level guards.
begin;

do $$
declare r record;
begin
  for r in
    select c.oid::regclass as rel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
      and pg_get_userbyid(c.relowner) = 'postgres'
  loop
    execute format('grant truncate, references, trigger, maintain on %s to service_role', r.rel);
    if r.rel::text not in ('platform_admin_bootstrap', 'demo_requests', 'photo_intakes',
                            'field_documents', 'field_document_versions',
                            'field_document_signatures', 'field_document_submissions') then
      execute format('grant truncate, references, trigger, maintain on %s to anon, authenticated', r.rel);
    end if;
  end loop;
end $$;

alter default privileges for role postgres in schema public
  grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;

commit;
