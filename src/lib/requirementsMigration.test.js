import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const schema = readFileSync(new URL('supabase/schema.sql', root), 'utf8')
const migration = readFileSync(
  new URL('supabase/migrations/20260710000100_p0_01_requirement_domain.sql', root),
  'utf8',
)

function requirementBlock(sql) {
  const start = sql.indexOf('-- -- P0-01: first-class requirement domain')
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

  it('uses deterministic, idempotent legacy conversion', () => {
    const sql = requirementBlock(migration)
    expect(sql).toContain('create table if not exists public.requirements')
    expect(sql).toContain('new.requirement_id = new.id;')
    expect(sql).toContain('on conflict (id) do update set')
    expect(sql).toContain('where o.requirement_id is distinct from o.id')
    expect(sql).toContain('create unique index if not exists contract_obligations_requirement_uidx')
  })

  it('does not delete a human-reviewed root during legacy replacement', () => {
    expect(requirementBlock(migration)).toContain(
      'where id = old.requirement_id and reviewed_at is null',
    )
  })
})
