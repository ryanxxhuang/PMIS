import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8')
const migration = readFileSync(
  new URL('supabase/migrations/20260710000200_p0_02_project_party_role.sql', root),
  'utf8',
)

function projectIdentityBlock(sql) {
  const startMarker = '-- -- P0-02: project party and role foundation'
  const endMarker = '-- -- End P0-02 core ----------------------------------------------------------'
  const start = sql.indexOf(startMarker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf(endMarker, start)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + endMarker.length)
}

function compatibilityRpcBlock(sql) {
  const startMarker = '-- -- P0-02 compatibility member RPCs'
  const endMarker = '-- -- End P0-02 compatibility member RPCs ------------------------------------'
  const start = sql.indexOf(startMarker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf(endMarker, start)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + endMarker.length)
}

describe('P0-02 project identity migration contract', () => {
  it('keeps the rerunnable schema and ordered migration synchronized', () => {
    expect(projectIdentityBlock(schema)).toBe(projectIdentityBlock(migration))
  })

  it('separates organizations, project parties, and project memberships', () => {
    const sql = projectIdentityBlock(migration)
    expect(sql).toContain('create table if not exists public.organizations')
    expect(sql).toContain('create table if not exists public.project_parties')
    expect(sql).toContain('create table if not exists public.project_memberships')
    expect(sql).toContain("check (party_type in ('agency','contractor','supervisor','designer','consultant','other'))")
    expect(sql).toContain("'document_controller','viewer'")
    expect(sql).toContain('is_project_admin boolean not null default false')
    expect(sql).toContain('unique (project_id, user_id)')
  })

  it('makes the legacy conversion deterministic, rerunnable, and conservative', () => {
    const sql = projectIdentityBlock(migration)
    expect(sql).toContain('unique (project_id, migration_key)')
    expect(sql).toContain("'legacy:agency'")
    expect(sql).toContain("'legacy:contractor'")
    expect(sql).toContain("'legacy:supervisor'")
    expect(sql).toContain("'未分類（待確認）', 'legacy:unresolved'")
    expect(sql).toContain("scoped_role := 'viewer'")
    expect(sql).toContain('on conflict (project_id, user_id) do nothing')
    expect(sql).not.toContain('insert into public.organizations (name)')
  })

  it('keeps project role, party type, and technical administration independent', () => {
    const sql = projectIdentityBlock(migration)
    expect(sql).toMatch(/party_type\s+text not null/)
    expect(sql).toMatch(/project_role\s+text not null/)
    expect(sql).toMatch(/is_project_admin\s+boolean not null default false/)
    expect(sql).toContain("coalesce(legacy_member_role = 'admin', false)")
    expect(sql).not.toContain("when 'admin' then")
  })

  it('provides project-scoped helpers and RLS for only the new identity tables', () => {
    const sql = projectIdentityBlock(migration)
    for (const helper of [
      'my_project_membership',
      'my_project_ids_v2',
      'is_project_member_v2',
      'my_project_party_type',
      'my_project_role',
      'is_project_admin_v2',
    ]) expect(sql).toContain(`function public.${helper}`)
    expect(sql).toContain('alter table public.organizations       enable row level security')
    expect(sql).toContain('alter table public.project_parties     enable row level security')
    expect(sql).toContain('alter table public.project_memberships enable row level security')
    expect(sql).toContain('with check (public.is_project_admin_v2(project_id))')
  })

  it('rejects cross-project links and immutable project reassignment', () => {
    const sql = projectIdentityBlock(migration)
    expect(sql).toContain('project_memberships_same_project')
    expect(sql).toContain('project_parties_project_identity_guard')
    expect(sql).toContain('project_memberships_project_identity_guard')
    expect(sql).toContain('requirements_responsible_project_party_fk')
    expect(sql).toContain('requirements_responsible_party_same_project')
    expect(sql).toContain('references public.project_parties(id) on delete set null')
  })

  it('keeps compatibility RPC definitions aligned in schema and migration', () => {
    const sql = compatibilityRpcBlock(migration)
    expect(compatibilityRpcBlock(schema)).toBe(sql)
    expect(sql).toContain('perform public.ensure_legacy_project_identity(p_project, uid);')
    expect(sql).toContain('left join public.project_memberships membership')
    expect(sql).toContain('membership.project_role, membership.is_project_admin')
    expect(sql).toContain('delete from public.project_memberships where project_id = p_project and user_id = p_user;')
    expect(sql).toContain('delete from public.project_members where project_id = p_project and user_id = p_user;')
  })
})
