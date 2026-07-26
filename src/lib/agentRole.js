// 專案職務(P0-02 project_memberships.project_role)→ 專屬 agent 角色。
// 後端共用版在 supabase/functions/_shared/agentRole.ts(agent-run 與 send-reminders
// 每日早報共用)且以後端為準:前端這份只用於「顯示」(標題/稱謂),任何權限判斷
// 都不得依賴它;agent-run 回傳的 role 若與前端算的不同,以回傳值為準。
// ⚠ 兩份映射(本檔 / _shared/agentRole.ts)值域與 fallback 必須同步修改。
export const AGENT_ROLES = ['field', 'qc', 'supervisor', 'owner']

// qc 只會來自明確設定的品管職務,不會從組織別推出來(與後端 ROLE_BY_PROJECT_ROLE 一致)
const ROLE_BY_PROJECT_ROLE = {
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

const ROLE_BY_ORG_TYPE = { contractor: 'field', supervisor: 'supervisor', owner: 'owner' }

export function agentRoleOf(projectRole, orgType) {
  return ROLE_BY_PROJECT_ROLE[projectRole] || ROLE_BY_ORG_TYPE[orgType] || 'field'
}

// demo 使用者(src/data/seed.js)自帶的職稱字串 → agent 角色
const ROLE_BY_DEMO_USER_ROLE = {
  'Contractor Field Engineer': 'field',
  'Contractor QC Engineer': 'qc',
  'Supervisor Engineer': 'supervisor',
  'Owner Engineer': 'owner',
}

// 顯示用的 agent 角色解析(權限一律以伺服器為準,這裡只決定畫面上叫什麼名字)。
// demo 模式沒有 project_memberships(該 effect 在未設定 Supabase 時直接回 null),
// 改用 demo 使用者自帶的職稱——否則 demo 永遠只能顯示 field,四個 agent 展示不出來。
export function displayAgentRole({ demoMode, currentUser, projectRole, orgType }) {
  if (demoMode) {
    const fromDemoRole = ROLE_BY_DEMO_USER_ROLE[currentUser?.role]
    if (fromDemoRole) return fromDemoRole
  }
  return agentRoleOf(projectRole, orgType)
}

export const AGENT_LABEL = {
  field:      { name: '現場 Agent', desc: '施工日誌、數量、照片歸位' },
  qc:         { name: '品管 Agent', desc: '自主檢查、試體齡期、缺失追蹤' },
  supervisor: { name: '監造 Agent', desc: '送審審查、查驗覆核、估驗對量' },
  owner:      { name: '機關 Agent', desc: '期程罰則、法定期限、勾稽稽核' },
}
