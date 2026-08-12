import { describe, it, expect } from 'vitest'
import { agentRoleOf, SIDE_BY_AGENT_ROLE, AGENT_NAME } from './agentRole.ts'

describe('agentRoleOf：三方 org_type 是唯一 Agent 身分來源', () => {
  it('廠商、監造、機關一對一映射', () => {
    expect(agentRoleOf('contractor')).toBe('contractor')
    expect(agentRoleOf('supervisor')).toBe('supervisor')
    expect(agentRoleOf('owner')).toBe('owner')
  })

  it('未知或缺少值保守回到廠商，不產生現場／品管角色', () => {
    expect(agentRoleOf(null)).toBe('contractor')
    expect(agentRoleOf('field')).toBe('contractor')
    expect(agentRoleOf('quality_engineer')).toBe('contractor')
  })
})

describe('陣營與顯示名', () => {
  it('三個 Agent 身分與 ball-in-court 陣營一對一', () => {
    expect(SIDE_BY_AGENT_ROLE).toEqual({
      contractor: 'contractor', supervisor: 'supervisor', owner: 'owner',
    })
  })

  it('只有廠商、監造、機關三個顯示名', () => {
    expect(AGENT_NAME).toEqual({
      contractor: '廠商 Agent', supervisor: '監造 Agent', owner: '機關 Agent',
    })
  })
})
