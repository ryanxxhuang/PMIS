// 專案職務 → 專屬 agent 角色(伺服器端共用版)。
// ---------------------------------------------------------------------------
// 這份映射存在兩份,改動必須兩邊同步(值域一致、fallback 一致):
//   1) 本檔 —— agent-run 與 send-reminders 共用(伺服器端唯一來源、以此為準)
//   2) src/lib/agentRole.js —— 前端顯示用(標題/稱謂),不做權限判斷
// (歷史上 agent-run 內嵌過第三份,已抽到本檔;不要再新增副本。)
// 判定順序與 agent-run 原始邏輯一致:
//   project_memberships.project_role 先(明確職務優先),對不到再用
//   profiles.org_type(my_org_type)fallback;都對不到 → 'field'。
// qc 只會來自明確設定的品管職務(quality_engineer),不會從組織別推出來。

import type { AgentRole } from './agentPersona.ts'

// project_memberships.project_role → agent persona(依 check constraint 全值域映射)
export const ROLE_BY_PROJECT_ROLE: Record<string, AgentRole> = {
  quality_engineer: 'qc',
  contractor_pm: 'field',
  site_manager: 'field',
  safety_engineer: 'field',
  supervisor_manager: 'supervisor',
  supervisor_engineer: 'supervisor',
  agency_pm: 'owner',
  agency_engineer: 'owner',
  // document_controller / viewer 不對應特定 persona → 落到組織別 fallback
}

// profiles.org_type → agent persona(fallback;qc 推不出來)
export const ROLE_BY_ORG_TYPE: Record<string, AgentRole> = {
  contractor: 'field',
  supervisor: 'supervisor',
  owner: 'owner',
}

export function agentRoleOf(projectRole?: string | null, orgType?: string | null): AgentRole {
  return (
    (projectRole ? ROLE_BY_PROJECT_ROLE[projectRole] : undefined) ??
    (orgType ? ROLE_BY_ORG_TYPE[orgType] : undefined) ??
    'field'
  )
}

// agent 角色 → ball-in-court 陣營(src/lib/ballInCourt.js 的 who 值域;
// agentTools.ts 的 OpenBallItem.side 也用這個型別)。field / qc 同屬廠商陣營 ——
// 球在「廠商」的事兩者都看得到,差別在偏好路由(試體給品管、工安給現場;
// 見 send-reminders)。
export type BallSide = 'contractor' | 'supervisor' | 'owner'
export const SIDE_BY_AGENT_ROLE: Record<AgentRole, BallSide> = {
  field: 'contractor',
  qc: 'contractor',
  supervisor: 'supervisor',
  owner: 'owner',
}

// 顯示名(與前端 src/lib/agentRole.js AGENT_LABEL 的 name 同步)
export const AGENT_NAME: Record<AgentRole, string> = {
  field: '現場 Agent',
  qc: '品管 Agent',
  supervisor: '監造 Agent',
  owner: '機關 Agent',
}
