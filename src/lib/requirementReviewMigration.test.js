import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8')
const migration = readFileSync(
  new URL('supabase/migrations/20260710000600_p0_07_requirement_review.sql', root),
  'utf8',
)

function reviewBlock(sql) {
  const startMarker = '-- -- P0-07 §1: BOQ candidate link review state'
  const endMarker = '-- -- End P0-07 requirement review ----------------------------------------------'
  const start = sql.indexOf(startMarker)
  const end = sql.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + endMarker.length)
}

describe('P0-07 requirement review migration contract', () => {
  it('keeps the fresh schema and ordered migration synchronized', () => {
    expect(reviewBlock(schema)).toBe(reviewBlock(migration))
  })

  it('defines the controlled review RPC with server-stamped actor and time', () => {
    const sql = reviewBlock(migration)
    expect(sql).toContain('create or replace function public.review_requirement(')
    expect(sql).toContain("p_decision not in ('approve','reject','supersede')")
    expect(sql).toContain('reviewed_by = auth.uid()')
    expect(sql).toContain('reviewed_at = now()')
    expect(sql).toContain('security definer set search_path = public')
    expect(sql).toContain('revoke all on function public.review_requirement(uuid, text) from public, anon')
    expect(sql).toContain('grant execute on function public.review_requirement(uuid, text) to authenticated')
    // the caller supplies nothing but requirement + decision
    expect(sql).not.toMatch(/review_requirement\([^)]*p_project/)
    expect(sql).not.toMatch(/review_requirement\([^)]*p_reviewed_by/)
  })

  it('requires a completed ingestion run before AI approval, for every writer', () => {
    const sql = reviewBlock(migration)
    const occurrences = sql.split('AI requirement approval requires a completed ingestion run').length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2) // RPC pre-check + transition guard
    expect(sql).toContain("run_status is distinct from 'completed'")
  })

  it('closes direct browser lifecycle mutation and metadata forging', () => {
    const sql = reviewBlock(migration)
    expect(sql).toContain('requirement lifecycle transitions require the controlled review action')
    expect(sql).toContain('review metadata is stamped by the controlled review action')
    expect(sql).toContain("current_setting('pmis.requirement_review', true)")
    expect(sql).toContain('requirement origin provenance is immutable for application users')
    // reviewed snapshots stay frozen with the P0-03 message
    expect(sql).toContain('reviewed requirement content is immutable; supersede and create a new requirement')
  })

  it('prevents stale source verification surviving citation edits', () => {
    const sql = reviewBlock(migration)
    expect(sql).toContain('guard_requirement_source_verification')
    expect(sql).toContain('source verification is determined by the system')
    expect(sql).toContain('new.source_verified := false')
    // service-role ingestion (no authenticated JWT) is exempt
    expect(sql).toContain('if auth.uid() is null then return new; end if;')
  })

  it('gives BOQ links explicit suggested/approved/rejected semantics', () => {
    const sql = reviewBlock(migration)
    expect(sql).toContain("check (review_status in ('suggested','approved','rejected'))")
    expect(sql).toContain("new.reviewed := (new.review_status = 'approved')")
    expect(sql).toContain('AI work-item suggestions must start as suggested')
    expect(sql).toContain("where reviewed and review_status = 'suggested'")
  })

  it('creates the approved-requirement artifact boundary', () => {
    const sql = reviewBlock(migration)
    expect(sql).toContain('create table if not exists public.requirement_artifact_links')
    expect(sql).toContain('unique (requirement_id, artifact_type, artifact_id)')
    expect(sql).toContain('artifact links require an approved requirement')
    expect(sql).toContain('requirement and artifact must belong to the same project')
    expect(sql).toContain('artifact does not exist for type %')
    // polymorphic validation maps only real durable artifact tables
    for (const table of [
      'inspection_points', 'checklist_templates', 'test_samples',
      'submittals', 'photos', 'contract_obligations',
    ]) expect(sql).toContain(`from public.${table} where id = new.artifact_id`)
    // 'report' has no durable target table yet - outside the initial vocabulary
    expect(sql).toContain("('inspection_point','checklist','test','submittal','evidence','deadline')")
    expect(sql).not.toMatch(/artifact_type in[^)]*'report'/)
  })

  it('adds only focused link audit events through record_audit_event', () => {
    const sql = reviewBlock(migration)
    for (const event of [
      'requirement.work_item_link_added',
      'requirement.work_item_link_approved',
      'requirement.work_item_link_rejected',
      'requirement.artifact_link_created',
    ]) expect(sql).toContain(`'${event}'`)
    expect(sql).not.toContain('insert into public.audit_events')
    expect(sql).not.toContain('requirement.updated')
  })

  it('leaves the P0-06 ingestion safeguards intact', () => {
    expect(schema).toContain('document ingestion runs are system-managed')
    expect(schema).toContain('only the ingestion service can attach a requirement to an ingestion run')
    expect(schema).toContain('requirement ingestion provenance is immutable for application users')
    expect(schema).toContain('ingestion run and document version must belong to the same project')
    // legacy deadline runtime stays wired
    expect(schema).toContain('contract_obligations_sync_requirement')
  })
})
