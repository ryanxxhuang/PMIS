// 驗證 _shared/agentRole.ts:project_role → agent 角色的共用映射
// (agent-run 與 send-reminders 共用;與前端 src/lib/agentRole.js 必須同步)。
import { describe, it, expect } from 'vitest'
import { agentRoleOf, ROLE_BY_PROJECT_ROLE, SIDE_BY_AGENT_ROLE, AGENT_NAME } from './agentRole.ts'

describe('agentRoleOf:project_role 優先(四種 agent 角色全覆蓋)', () => {
  it('品管職務 → qc(qc 只能來自明確職務)', () => {
    expect(agentRoleOf('quality_engineer', 'owner')).toBe('qc')
  })
  it('廠商職務 → field', () => {
    for (const r of ['contractor_pm', 'site_manager', 'safety_engineer']) {
      expect(agentRoleOf(r, null)).toBe('field')
    }
  })
  it('監造職務 → supervisor', () => {
    for (const r of ['supervisor_manager', 'supervisor_engineer']) {
      expect(agentRoleOf(r, null)).toBe('supervisor')
    }
  })
  it('機關職務 → owner', () => {
    for (const r of ['agency_pm', 'agency_engineer']) {
      expect(agentRoleOf(r, null)).toBe('owner')
    }
  })
  it('明確職務優先於組織別(org_type 只是 fallback)', () => {
    expect(agentRoleOf('agency_pm', 'contractor')).toBe('owner')
  })
})

describe('agentRoleOf:org_type fallback', () => {
  it('document_controller / viewer 不對應 persona → 落到組織別', () => {
    expect(ROLE_BY_PROJECT_ROLE['document_controller']).toBeUndefined()
    expect(ROLE_BY_PROJECT_ROLE['viewer']).toBeUndefined()
    expect(agentRoleOf('viewer', 'supervisor')).toBe('supervisor')
    expect(agentRoleOf('document_controller', 'owner')).toBe('owner')
  })
  it('組織別映射:contractor→field、supervisor→supervisor、owner→owner', () => {
    expect(agentRoleOf(null, 'contractor')).toBe('field')
    expect(agentRoleOf(null, 'supervisor')).toBe('supervisor')
    expect(agentRoleOf(null, 'owner')).toBe('owner')
  })
  it('qc 永遠推不出來:沒有任何 org_type 會給 qc', () => {
    for (const org of ['contractor', 'supervisor', 'owner', 'whatever', null]) {
      expect(agentRoleOf(null, org)).not.toBe('qc')
    }
  })
  it('全都對不到 → field(與 agent-run 原始 fallback 一致)', () => {
    expect(agentRoleOf(null, null)).toBe('field')
    expect(agentRoleOf('unknown_role', 'unknown_org')).toBe('field')
  })
})

describe('陣營與顯示名', () => {
  it('field/qc 同屬廠商陣營;supervisor/owner 各自成陣', () => {
    expect(SIDE_BY_AGENT_ROLE).toEqual({
      field: 'contractor', qc: 'contractor', supervisor: 'supervisor', owner: 'owner',
    })
  })
  it('四個角色都有顯示名(與前端 AGENT_LABEL.name 同步)', () => {
    expect(AGENT_NAME).toEqual({
      field: '現場 Agent', qc: '品管 Agent', supervisor: '監造 Agent', owner: '機關 Agent',
    })
  })
})
