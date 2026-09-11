import { describe, it, expect } from 'vitest'
import { UUID_RE, isUuid } from './uuid.ts'

describe('uuid:單一 UUID 驗證來源', () => {
  it('接受大小寫十六進位的標準 UUID', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    expect(isUuid('123E4567-E89B-12D3-A456-426614174000')).toBe(true)
  })

  it('拒絕非字串、缺段、含非十六進位字元、前後多餘字元', () => {
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(123)).toBe(false)
    expect(isUuid('123e4567-e89b-12d3-a456')).toBe(false)
    expect(isUuid('123e4567-e89b-12d3-a456-42661417400g')).toBe(false)
    expect(isUuid(' 123e4567-e89b-12d3-a456-426614174000')).toBe(false)
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000\n')).toBe(false)
  })

  it('UUID_RE 與 isUuid 是同一條規則', () => {
    expect(UUID_RE.test('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    expect(UUID_RE.test('not-a-uuid')).toBe(false)
  })
})
