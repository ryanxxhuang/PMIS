import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8')
const migration = readFileSync(
  new URL('supabase/migrations/20260710000700_hotfix_project_delete_contract_first.sql', root),
  'utf8',
)

function hotfixBlock(sql) {
  const startMarker = '-- Production hotfix:'
  const endMarker = '-- -- End HOTFIX project delete context --------------------------------------'
  const start = sql.lastIndexOf(startMarker)
  const end = sql.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + endMarker.length)
}

describe('project-delete hotfix migration contract', () => {
  it('keeps fresh schema and ordered migration synchronized', () => {
    expect(hotfixBlock(schema)).toBe(hotfixBlock(migration))
  })

  it('sets exact transaction-local context only after authorization and lock', () => {
    const sql = hotfixBlock(migration)
    const authorize = sql.indexOf('can_manage_project_identity(p_id)')
    const lock = sql.indexOf('where id = p_id for update')
    const context = sql.indexOf("set_config('pmis.project_delete_id', p_id::text, true)")
    const deletion = sql.indexOf('delete from public.projects where id = p_id')
    expect(authorize).toBeGreaterThanOrEqual(0)
    expect(lock).toBeGreaterThan(authorize)
    expect(context).toBeGreaterThan(lock)
    expect(deletion).toBeGreaterThan(context)
    expect(sql).toContain("current_setting('pmis.project_delete_id', true)")
    expect(sql).toContain('security definer set search_path = public')
    expect(sql).not.toMatch(/grant execute on function public\.set/i)
  })

  it('limits cascade exemptions to DELETE on the exact project', () => {
    const sql = hotfixBlock(migration)
    for (const trigger of [
      'project_memberships_last_admin_delete_guard',
      'project_parties_lifecycle_delete_guard',
      'valuations_delete_guard', 'inspections_delete_guard',
      'submittals_delete_guard', 'rfis_delete_guard',
      'change_orders_delete_guard', 'requirements_snapshot_delete_guard',
      'audit_events_immutable_delete_guard',
      'document_ingestion_runs_system_managed_delete_guard',
    ]) expect(sql).toContain(`create trigger ${trigger}`)
    expect(sql.match(/not public\.is_project_delete_context\(old\.project_id\)/g)?.length)
      .toBe(10)
  })

  it('repairs only deterministic unresolved legacy viewer identities', () => {
    const sql = hotfixBlock(migration)
    expect(sql).toContain("unresolved.migration_key = 'legacy:unresolved'")
    expect(sql).toContain("m.project_role = 'viewer'")
    expect(sql).toContain("target.migration_key = case profile.org_type")
    expect(sql).toContain("when 'owner' then 'agency_engineer'")
    expect(sql).toContain("when 'supervisor' then 'supervisor_engineer'")
    expect(sql).toContain("when 'contractor' then 'contractor_pm'")
    expect(sql).not.toContain('set is_project_admin')
  })
})
