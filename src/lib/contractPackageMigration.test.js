import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8')
const migration = readFileSync(
  new URL('supabase/migrations/20260711000100_p0_07_5_contract_packages.sql', root),
  'utf8',
)

function packageBlock(sql) {
  const startMarker = '-- -- P0-07.5 §1: contract package domain'
  const endMarker = '-- -- End P0-07.5 contract packages ----------------------------------------------'
  const start = sql.lastIndexOf(startMarker)
  const end = sql.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + endMarker.length)
}

describe('P0-07.5 contract package migration contract', () => {
  it('keeps the fresh schema synchronized with the ordered migration', () => {
    expect(packageBlock(schema)).toBe(packageBlock(migration))
  })

  it('models party-scoped packages and same-project document processing', () => {
    const sql = packageBlock(migration)
    expect(sql).toContain('create table if not exists public.contract_packages')
    expect(sql).toContain("check (package_type in ('construction','supervision','other'))")
    expect(sql).toContain('documents_contract_package_fk')
    expect(sql).toContain('document and contract package must belong to the same project')
    expect(sql).toContain("processing run must match the document''s contract package")
  })

  it('derives visibility exclusively from project-scoped membership', () => {
    const sql = packageBlock(migration)
    expect(sql).toContain('from public.my_project_membership(p_project) m')
    expect(sql).toContain("m.party_type = 'agency'")
    expect(sql).toContain("m.party_type = 'supervisor'")
    expect(sql).toContain('p_counterparty = m.project_party_id')
    expect(sql).not.toContain('profiles.org_type')
    expect(sql).not.toContain('is_project_admin')
  })

  it('applies package visibility to the full provenance and write chains', () => {
    const sql = packageBlock(migration)
    for (const policy of [
      'documents_select', 'document_versions_select', 'document_pages_select',
      'document_ingestion_runs_select', 'requirements_select', 'requirement_sources_select',
      'documents_update', 'document_versions_update', 'document_pages_update',
    ]) expect(sql).toContain(`"${policy}"`)
    expect(sql).toContain('public.can_read_requirement_provenance(ingestion_run_id)')
    expect(sql).toContain('public.can_write_project_document(project_id, contract_package_id)')
  })

  it('creates private immutable binary storage with package-aware policies', () => {
    const sql = packageBlock(migration)
    expect(sql).toContain("values ('contract-documents', 'contract-documents', false)")
    expect(sql).toContain("bucket_id = 'contract-documents'")
    expect(sql).toContain("((storage.foldername(name))[4])::uuid")
    expect(sql).not.toContain('contract_documents_update')
    expect(sql).not.toContain('contract_documents_delete')
  })

  it('prevents unsupported files from claiming successful analysis', () => {
    const sql = packageBlock(migration)
    expect(sql).toContain("status <> 'unsupported'")
    expect(sql).toContain("stage = 'unsupported' and parser_type = 'none'")
    expect(sql).toContain("metadata->>'requirement_extraction', 'skipped') <> 'completed'")
  })

  it('retains controlled review, provenance, audit, and project-delete boundaries', () => {
    expect(schema).toContain('requirement lifecycle transitions require the controlled review action')
    expect(schema).toContain('AI requirement approval requires a completed ingestion run')
    expect(schema).toContain('audit events are append-only')
    expect(schema).toContain("set_config('pmis.project_delete_id', p_id::text, true)")
  })
})
