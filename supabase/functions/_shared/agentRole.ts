// Agent 身分只跟三方專案角色一致。project_memberships.project_role、職稱、
// 現場／品管分工都不是授權來源，也不再決定 Agent。
import type { AgentRole } from './agentPersona.ts'

const ROLE_BY_ORG_TYPE: Record<string, AgentRole> = {
  contractor: 'contractor',
  supervisor: 'supervisor',
  owner: 'owner',
}

export function agentRoleOf(orgType?: string | null): AgentRole {
  return (orgType ? ROLE_BY_ORG_TYPE[orgType] : undefined) ?? 'contractor'
}

// Agent 身分與 ball-in-court 陣營現在是一對一。
export type BallSide = 'contractor' | 'supervisor' | 'owner'
export const SIDE_BY_AGENT_ROLE: Record<AgentRole, BallSide> = {
  contractor: 'contractor',
  supervisor: 'supervisor',
  owner: 'owner',
}

export const AGENT_NAME: Record<AgentRole, string> = {
  contractor: '廠商 Agent',
  supervisor: '監造 Agent',
  owner: '機關 Agent',
}
