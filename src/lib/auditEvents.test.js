import { describe, expect, it } from 'vitest'
import {
  auditActorDisplay, auditEntityLabel, auditEventLabel, auditEventSubject,
  normalizeAuditFilters,
} from './auditEvents.js'

describe('persistent audit event presentation', () => {
  it('maps stable event and entity identifiers deterministically', () => {
    expect(auditEventLabel('valuation.approved')).toBe('估驗核定')
    expect(auditEventLabel('inspection.decided')).toBe('查驗判定')
    expect(auditEventLabel('requirement.approved')).toBe('履約需求核定')
    expect(auditEventLabel('unknown.event')).toBe('專案活動')
    expect(auditEntityLabel('change_order')).toBe('變更設計')
  })

  it('uses the snapshotted role and keeps technical admin distinct', () => {
    expect(auditActorDisplay({
      actor_user_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      actor_party_type: 'contractor', actor_project_role: 'contractor_pm',
      actor_is_project_admin: true,
    })).toBe('廠商專案經理 · 技術管理員')
    expect(auditActorDisplay({
      actor_user_id: 'aaaaaaaa-0000-0000-0000-000000000002',
      actor_party_type: 'supervisor', actor_project_role: 'supervisor_engineer',
      actor_is_project_admin: false,
    })).toBe('監造工程師')
  })

  it('falls back without fabricating a person name', () => {
    expect(auditActorDisplay({ metadata: { actor_kind: 'system' } })).toBe('系統')
    expect(auditActorDisplay({ actor_user_id: '12345678-0000-0000-0000-000000000000' }))
      .toBe('使用者 12345678')
  })

  it('builds a useful subject from immutable snapshots', () => {
    expect(auditEventSubject({ entity_type: 'valuation', after_data: { period_no: 3 } }))
      .toBe('第 3 期估驗')
    expect(auditEventSubject({
      entity_type: 'acceptance_event', metadata: { stage_key: 'initial' },
    })).toBe('初驗')
    expect(auditEventSubject({ entity_type: 'requirement', before_data: { title: '材料送審' } }))
      .toBe('材料送審')
  })

  it('normalizes server-side filter parameters and makes the end date inclusive', () => {
    expect(normalizeAuditFilters({
      actorUserId: ' user-id ', eventType: ' valuation.approved ',
      entityType: ' valuation ', dateFrom: '2026-07-01', dateTo: '2026-07-10',
    })).toEqual({
      actorUserId: 'user-id', eventType: 'valuation.approved', entityType: 'valuation',
      dateFrom: '2026-07-01', dateToExclusive: '2026-07-11',
    })
  })
})
