import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8')
const migration = readFileSync(
  new URL('supabase/migrations/20260710000300_p0_03_04_authority_cutover.sql', root),
  'utf8',
)

function authorityBlock(sql) {
  const startMarker = '-- -- P0-03 §1: project party lifecycle'
  const endMarker = '-- -- End P0-03/P0-04 authority cutover --------------------------------------'
  const start = sql.indexOf(startMarker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf(endMarker, start)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + endMarker.length)
}

describe('P0-03/P0-04 authority migration contract', () => {
  it('keeps the fresh schema and ordered migration synchronized', () => {
    expect(authorityBlock(schema)).toBe(authorityBlock(migration))
  })

  it('removes permissive legacy policies before creating explicit policies', () => {
    const sql = authorityBlock(migration)
    expect(sql).toContain('drop policy if exists "project_parties_delete"')
    expect(sql).toContain('drop policy if exists "acceptance_events_members_all"')
    expect(sql).toContain('select false -- P0-03: deprecated')
    expect(sql).not.toContain('public.my_org_type()')
    expect(sql).not.toContain('public.is_project_admin(')
  })

  it('binds contractual authority only to active project-scoped identity', () => {
    const sql = authorityBlock(migration)
    expect(sql).toContain('and pp.is_active')
    expect(sql).toContain('from public.my_project_membership(p_project) m')
    expect(sql).toContain('No is_project_admin')
    expect(sql).toContain('project members cannot change their own contractual identity')
  })

  it('defines every required explicit permission boundary', () => {
    const sql = authorityBlock(migration)
    for (const name of [
      'can_manage_project_identity', 'can_manage_daily_logs',
      'can_manage_safety_records', 'can_manage_quality_execution',
      'can_submit_inspection', 'can_decide_inspection',
      'can_submit_valuation', 'can_review_valuation',
      'can_update_payment_fields', 'can_manage_contractor_private',
      'can_create_submittal', 'can_review_submittal',
      'can_create_rfi', 'can_answer_rfi',
      'can_manage_defect_remediation', 'can_close_defect',
      'can_manage_itp', 'can_ratify_change_order',
      'can_review_requirement', 'can_manage_documents',
    ]) expect(sql).toContain(`function public.${name}`)
    expect(sql).toContain('function public.can_record_acceptance_stage')
  })

  it('protects decision fields and frozen workflow snapshots', () => {
    const sql = authorityBlock(migration)
    expect(sql).toContain('payment_changed')
    expect(sql).toContain('decision_changed')
    expect(sql).toContain('review_fields_changed')
    expect(sql).toContain('answer_changed')
    expect(sql).toContain("new.status <> '待回覆'")
    expect(sql).toContain("if v.status in ('已核定','已請款') then")
    expect(sql).toContain('invalid change-order status transition')
    expect(sql).toContain('change order item and parent change order must belong to the same project')
    expect(sql).toContain('reviewed requirement content is immutable')
    expect(sql).toContain('requirements cannot be created directly in a reviewed status')
    expect(sql).toContain('citations of a reviewed requirement are immutable')
  })

  it('protects identity administration and uses v2 admin RPC authorization', () => {
    const sql = authorityBlock(migration)
    expect(sql).toContain('for update;')
    expect(sql).toContain('a project must keep at least one technical project admin')
    expect(sql).toContain('if not public.can_manage_project_identity(p_project) then')
    expect(sql).toContain('if not public.can_manage_project_identity(p_id) then')
    expect(sql).toContain('and public.is_project_member(p_project)')
  })
})
