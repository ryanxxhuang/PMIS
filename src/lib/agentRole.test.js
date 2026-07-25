import { describe, it, expect } from 'vitest'
import { AGENT_ROLES, AGENT_LABEL, agentRoleOf, displayAgentRole } from './agentRole.js'

describe('agentRoleOf(職務 → agent 角色,與後端 agent-run 同映射)', () => {
  it('品管職務 → qc(qc 只能來自明確職務,不從組織別推)', () => {
    expect(agentRoleOf('quality_engineer', 'contractor')).toBe('qc')
  })
  it('施工端職務 → field', () => {
    expect(agentRoleOf('contractor_pm', 'contractor')).toBe('field')
    expect(agentRoleOf('site_manager', 'contractor')).toBe('field')
    expect(agentRoleOf('safety_engineer', 'contractor')).toBe('field')
  })
  it('監造職務 → supervisor', () => {
    expect(agentRoleOf('supervisor_manager', 'supervisor')).toBe('supervisor')
    expect(agentRoleOf('supervisor_engineer', 'supervisor')).toBe('supervisor')
  })
  it('機關職務 → owner', () => {
    expect(agentRoleOf('agency_pm', 'owner')).toBe('owner')
    expect(agentRoleOf('agency_engineer', 'owner')).toBe('owner')
  })
  it('無 persona 職務(document_controller/viewer)→ 落到組織別 fallback', () => {
    expect(agentRoleOf('document_controller', 'supervisor')).toBe('supervisor')
    expect(agentRoleOf('viewer', 'owner')).toBe('owner')
    expect(agentRoleOf('document_controller', 'contractor')).toBe('field')
  })
  it('職務為 null / 未知值 → 組織別 fallback:contractor→field、supervisor→supervisor、owner→owner', () => {
    expect(agentRoleOf(null, 'contractor')).toBe('field')
    expect(agentRoleOf(null, 'supervisor')).toBe('supervisor')
    expect(agentRoleOf(null, 'owner')).toBe('owner')
    expect(agentRoleOf('not_a_role', 'supervisor')).toBe('supervisor')
  })
  it('職務與組織別都沒有 → field(與後端 my_org_type 非 supervisor/owner 時同)', () => {
    expect(agentRoleOf(null, null)).toBe('field')
    expect(agentRoleOf(undefined, undefined)).toBe('field')
    expect(agentRoleOf('not_a_role', 'weird_org')).toBe('field')
  })
})

describe('displayAgentRole(顯示用解析:demo 看 demo 職稱、真實模式走 agentRoleOf)', () => {
  it('demo 模式:四個 demo 使用者職稱各自對到正確角色', () => {
    expect(displayAgentRole({ demoMode: true, currentUser: { role: 'Contractor Field Engineer' }, projectRole: null, orgType: 'contractor' })).toBe('field')
    expect(displayAgentRole({ demoMode: true, currentUser: { role: 'Contractor QC Engineer' }, projectRole: null, orgType: 'contractor' })).toBe('qc')
    expect(displayAgentRole({ demoMode: true, currentUser: { role: 'Supervisor Engineer' }, projectRole: null, orgType: 'supervisor' })).toBe('supervisor')
    expect(displayAgentRole({ demoMode: true, currentUser: { role: 'Owner Engineer' }, projectRole: null, orgType: 'owner' })).toBe('owner')
  })
  it('demo 模式但職稱是未知字串/缺 currentUser → 落到 agentRoleOf 的 orgType fallback', () => {
    expect(displayAgentRole({ demoMode: true, currentUser: { role: 'Some Unknown Role' }, projectRole: null, orgType: 'contractor' })).toBe('field')
    expect(displayAgentRole({ demoMode: true, currentUser: { role: 'Some Unknown Role' }, projectRole: null, orgType: 'supervisor' })).toBe('supervisor')
    expect(displayAgentRole({ demoMode: true, currentUser: null, projectRole: null, orgType: 'owner' })).toBe('owner')
  })
  it('真實模式(demoMode=false):行為與 agentRoleOf 完全一致,不看 currentUser.role', () => {
    // 就算 currentUser 帶著品管職稱字串,真實模式仍以 project_memberships 為準
    expect(displayAgentRole({ demoMode: false, currentUser: { role: 'Contractor QC Engineer' }, projectRole: 'contractor_pm', orgType: 'contractor' })).toBe('field')
    expect(displayAgentRole({ demoMode: false, currentUser: null, projectRole: 'quality_engineer', orgType: 'contractor' })).toBe(agentRoleOf('quality_engineer', 'contractor'))
    expect(displayAgentRole({ demoMode: false, currentUser: null, projectRole: null, orgType: 'supervisor' })).toBe(agentRoleOf(null, 'supervisor'))
    expect(displayAgentRole({ demoMode: false, currentUser: null, projectRole: 'agency_pm', orgType: 'owner' })).toBe(agentRoleOf('agency_pm', 'owner'))
  })
})

describe('AGENT_LABEL(顯示用稱謂)', () => {
  it('四個角色 key 齊全,且與 AGENT_ROLES 一致、都有名稱與描述', () => {
    expect(Object.keys(AGENT_LABEL).sort()).toEqual([...AGENT_ROLES].sort())
    for (const role of AGENT_ROLES) {
      expect(AGENT_LABEL[role].name).toBeTruthy()
      expect(AGENT_LABEL[role].desc).toBeTruthy()
    }
  })
})
