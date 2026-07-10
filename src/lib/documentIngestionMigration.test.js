import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8')
const migration = readFileSync(
  new URL('supabase/migrations/20260710000500_p0_06_document_ingestion.sql', root),
  'utf8',
)

function ingestionBlock(sql) {
  const startMarker = '-- -- P0-06 §1: traceable document ingestion runs'
  const endMarker = '-- -- End P0-06 document ingestion ---------------------------------------------'
  const start = sql.indexOf(startMarker)
  const end = sql.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + endMarker.length)
}

describe('P0-06 document ingestion migration contract', () => {
  it('keeps the fresh schema and ordered migration synchronized', () => {
    expect(ingestionBlock(schema)).toBe(ingestionBlock(migration))
  })

  it('defines the narrow ingestion run domain with status and count constraints', () => {
    const sql = ingestionBlock(migration)
    expect(sql).toContain('create table if not exists public.document_ingestion_runs')
    expect(sql).toContain("check (run_type in ('requirement_extraction'))")
    expect(sql).toContain("check (status in ('pending','processing','completed','failed'))")
    for (const column of [
      'document_version_id', 'model_provider', 'model_name', 'prompt_version',
      'started_by', 'completed_at', 'input_page_count',
      'extracted_requirement_count', 'verified_source_count',
      'unverified_source_count', 'error_message', 'metadata',
    ]) expect(sql).toContain(column)
    expect(sql).toContain('document_ingestion_runs_project_idx')
    expect(sql).toContain('document_ingestion_runs_version_idx')
  })

  it('pins every run to one document version of its own project', () => {
    const sql = ingestionBlock(migration)
    expect(sql).toContain("raise exception 'ingestion run document version is immutable'")
    expect(sql).toContain(
      "raise exception 'ingestion run and document version must belong to the same project'")
    expect(sql).toContain('document_ingestion_runs_project_identity_guard')
  })

  it('exposes project-scoped reads and no authenticated write path to runs', () => {
    const sql = ingestionBlock(migration)
    expect(sql).toContain('create policy "document_ingestion_runs_select"')
    expect(sql).toContain('project_id in (select public.my_project_ids())')
    expect(sql).toContain(
      'revoke insert, update, delete on public.document_ingestion_runs from public, anon, authenticated')
    expect(sql).not.toMatch(/create policy "document_ingestion_runs_(insert|update|delete)"/)
    expect(sql).toContain("raise exception 'document ingestion runs are system-managed'")
  })

  it('links requirements to their extraction run without deriving authority', () => {
    const sql = ingestionBlock(migration)
    expect(sql).toContain('add column if not exists ingestion_run_id uuid')
    expect(sql).toContain('requirements_ingestion_run_fk')
    expect(sql).toContain('requirements_ingestion_run_idx')
    expect(sql).toContain(
      "raise exception 'only the ingestion service can attach a requirement to an ingestion run'")
    expect(sql).toContain(
      "raise exception 'requirement ingestion provenance is immutable for application users'")
    expect(sql).toContain(
      "raise exception 'requirement and ingestion run must belong to the same project'")
    // provenance must never feed is_authoritative
    expect(sql).not.toContain('is_authoritative boolean')
  })

  it('emits run lifecycle audit events through the P0-05 trigger architecture only', () => {
    const sql = ingestionBlock(migration)
    expect(sql).toContain('audit_document_ingestion_event')
    expect(sql).toContain("'document.ingestion_' || new.status")
    expect(sql).toContain('perform public.record_audit_event')
    expect(sql).not.toContain('insert into public.audit_events')
  })

  it('leaves the P0-01/P0-03/P0-05 requirement safeguards in place', () => {
    // reviewed snapshots stay immutable and undeletable
    expect(schema).toContain(
      "raise exception 'requirements cannot be created directly in a reviewed status'")
    expect(schema).toContain(
      "raise exception 'reviewed requirements cannot be deleted; supersede them instead'")
    expect(schema).toContain("(status = 'approved') stored")
    // legacy deadline runtime keeps its compatibility mirror
    expect(schema).toContain('contract_obligations_sync_requirement')
    // P0-05 audit domain is untouched
    expect(schema).toContain('create table if not exists public.audit_events')
    expect(schema).toContain('audit events are append-only')
  })
})
