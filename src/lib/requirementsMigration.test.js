import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8')
const migration = readFileSync(
  new URL('supabase/migrations/20260710000100_p0_01_requirement_domain.sql', root),
  'utf8',
)

function requirementBlock(sql) {
  const start = sql.indexOf('-- -- P0-01: document + requirement foundation')
  expect(start).toBeGreaterThanOrEqual(0)
  const endMarker = 'execute function public.delete_legacy_requirement_root();'
  const end = sql.indexOf(endMarker, start)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + endMarker.length)
}

describe('P0-01 requirement migration contract', () => {
  it('keeps the rerunnable schema and ordered migration synchronized', () => {
    expect(requirementBlock(schema)).toBe(requirementBlock(migration))
  })

  it('defines document roots, immutable versions, and page-aware text storage', () => {
    const sql = requirementBlock(migration)
    expect(sql).toContain('create table if not exists public.documents')
    expect(sql).toContain('create table if not exists public.document_versions')
    expect(sql).toContain('create table if not exists public.document_pages')
    expect(sql).toContain('unique (document_version_id, page_number)')
    expect(sql).toContain('document version file identity is immutable; create a new version')
  })

  it('uses deterministic, idempotent legacy conversion', () => {
    const sql = requirementBlock(migration)
    expect(sql).toContain('create table if not exists public.requirements')
    expect(sql).toContain('new.requirement_id = new.id;')
    expect(sql).toContain("'needs_review',")
    expect(sql).toContain("'migration',")
    expect(sql).toContain('legacy_contract_obligation_id = excluded.legacy_contract_obligation_id')
    expect(sql).toContain('on conflict (id) do update set')
    expect(sql).toContain('where o.requirement_id is distinct from o.id')
    expect(sql).toContain('create unique index if not exists contract_obligations_requirement_uidx')
  })

  it('makes approval the only source of requirement authority', () => {
    const sql = requirementBlock(migration)
    expect(sql).toContain("check (status in ('draft_ai','needs_review','approved','rejected','superseded'))")
    expect(sql).toContain("(status = 'approved') stored")
    expect(sql).not.toContain('ai_generated')
  })

  it('preserves explicit lifecycle outcomes during legacy replacement', () => {
    const sql = requirementBlock(migration)
    expect(sql).toContain("status in ('draft_ai','needs_review')")
    expect(sql).not.toContain('reviewed_at is null')
  })

  it('synchronizes only mutable legacy snapshots and removes stale sources', () => {
    const sql = requirementBlock(migration)
    expect(sql).toContain("where requirements.status in ('draft_ai','needs_review')")
    expect(sql).toContain("if requirement_status in ('draft_ai','needs_review') then")
    expect(sql).toContain("where requirement_sources.source_kind = 'legacy'")
    expect(sql).toContain('delete from public.requirement_sources')
  })

  it('makes project identity immutable for linked project-scoped roots', () => {
    const sql = requirementBlock(migration)
    expect(sql).toContain("raise exception 'project identity is immutable'")
    expect(sql).toContain('requirements_project_identity_guard')
    expect(sql).toContain('documents_project_identity_guard')
    expect(sql).toContain('work_items_project_identity_guard')
  })
})
