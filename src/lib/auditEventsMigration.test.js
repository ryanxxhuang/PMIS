import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8')
const migration = readFileSync(
  new URL('supabase/migrations/20260710000400_p0_05_audit_events.sql', root),
  'utf8',
)

function auditBlock(sql) {
  const startMarker = '-- -- P0-05 §1: append-only event domain'
  const endMarker = '-- -- End P0-05 audit events -------------------------------------------------'
  const start = sql.indexOf(startMarker)
  const end = sql.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + endMarker.length)
}

describe('P0-05 audit event migration contract', () => {
  it('keeps the fresh schema and ordered migration synchronized', () => {
    expect(auditBlock(schema)).toBe(auditBlock(migration))
  })

  it('defines the append-only event schema and bounded query indexes', () => {
    const sql = auditBlock(migration)
    expect(sql).toContain('create table if not exists public.audit_events')
    for (const column of [
      'actor_user_id', 'actor_project_party_id', 'actor_party_type',
      'actor_project_role', 'actor_is_project_admin', 'before_data',
      'after_data', 'metadata', 'correlation_id', 'occurred_at',
    ]) expect(sql).toContain(column)
    expect(sql).toContain('audit_events_project_time_idx')
    expect(sql).toContain('audit_events_entity_time_idx')
    expect(sql).toContain('audit_events_actor_time_idx')
    expect(sql).toContain('audit_events_type_time_idx')
  })

  it('allows project-scoped reads but no authenticated mutation policy', () => {
    const sql = auditBlock(migration)
    expect(sql).toContain('create policy "audit_events_select"')
    expect(sql).toContain('project_id in (select public.my_project_ids())')
    expect(sql).toContain('revoke insert, update, delete on public.audit_events')
    expect(sql).not.toMatch(/create policy "audit_events_(insert|update|delete)"/)
    expect(sql).not.toContain('public.is_project_admin(')
  })

  it('keeps controlled insertion internal and snapshots project identity', () => {
    const sql = auditBlock(migration)
    expect(sql).toContain('function public.record_audit_event')
    expect(sql).toContain('actor_uid uuid := auth.uid()')
    expect(sql).toContain('join public.project_parties pp')
    expect(sql).toContain('and pp.is_active')
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain("jsonb_build_object('actor_kind', 'system')")
  })

  it('has an immutable defense and focused required domain triggers', () => {
    const sql = auditBlock(migration)
    expect(sql).toContain('audit events are append-only')
    expect(sql).toContain('before update or delete on public.audit_events')
    for (const trigger of [
      'valuations_audit_event', 'inspections_audit_event', 'defects_audit_event',
      'submittals_audit_event', 'rfis_audit_event', 'change_orders_audit_event',
      'requirements_audit_event', 'documents_audit_event',
      'document_versions_audit_event', 'project_parties_audit_event',
      'project_memberships_audit_event', 'acceptance_events_audit_event',
    ]) expect(sql).toContain(trigger)
    expect(sql).toContain('create trigger project_memberships_audit_event before')
  })

  it('excludes contractor-private costs from the shared event stream', () => {
    const sql = auditBlock(migration)
    expect(sql).toContain('No trigger is installed on cost_items')
    expect(sql).not.toContain('cost_items_audit_event')
    expect(sql).not.toContain("'cost_item'")
  })
})
