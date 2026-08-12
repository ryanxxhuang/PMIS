import { describe, it, expect } from 'vitest'
import { AGENT_ROLES, AGENT_LABEL, agentRoleOf, displayAgentRole } from './agentRole.js'

describe('agentRoleOf（三方角色 → Agent 身分）', () => {
  it('只接受廠商、監造、機關三方角色', () => {
    expect(agentRoleOf('contractor')).toBe('contractor')
    expect(agentRoleOf('supervisor')).toBe('supervisor')
    expect(agentRoleOf('owner')).toBe('owner')
  })

  it('未知或缺少角色保守回到廠商，不產生現場／品管角色', () => {
    expect(agentRoleOf(null)).toBe('contractor')
    expect(agentRoleOf('quality_engineer')).toBe('contractor')
    expect(agentRoleOf('field')).toBe('contractor')
  })
})

describe('displayAgentRole（職稱與 project_role 不影響 Agent 身分）', () => {
  it('同為廠商時，現場與品管職稱都得到同一個廠商 Agent', () => {
    expect(displayAgentRole({
      demoMode: true,
      currentUser: { role: 'Contractor Field Engineer' },
      projectRole: 'site_manager',
      orgType: 'contractor',
    })).toBe('contractor')
    expect(displayAgentRole({
      demoMode: false,
      currentUser: { role: 'Contractor QC Engineer' },
      projectRole: 'quality_engineer',
      orgType: 'contractor',
    })).toBe('contractor')
  })
})

describe('AGENT_LABEL（顯示用稱謂）', () => {
  it('只有三方 key，且都有名稱與描述', () => {
    expect(Object.keys(AGENT_LABEL).sort()).toEqual([...AGENT_ROLES].sort())
    for (const role of AGENT_ROLES) {
      expect(AGENT_LABEL[role].name).toBeTruthy()
      expect(AGENT_LABEL[role].desc).toBeTruthy()
    }
  })
})
