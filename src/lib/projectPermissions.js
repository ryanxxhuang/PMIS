// P0-03 前端契約權限:permission = party_type × project_role(workflow state
// 由伺服器端 RLS + transition guard 強制,前端只是同一矩陣的 UI 對齊)。
//
// 輸入是「這個專案」的 membership(store 的 currentProjectMembership),
// 不是 profiles.org_type。無 membership、或 party 已停用 → 全部 fail closed。
// is_project_admin 只影響技術管理(manageProjectIdentity/admin),
// 絕不作為業務審核的 override。
const SUPERVISOR_ASSURANCE = Object.freeze(['supervisor_manager', 'supervisor_engineer'])
const AGENCY_REVIEW = Object.freeze(['agency_pm', 'agency_engineer'])

// 與 supabase can_record_acceptance_stage() 一致的階段授權
// (階段語彙來自 lib/acceptance.js ACCEPTANCE_STAGES)。
export const ACCEPTANCE_STAGE_AUTHORITY = Object.freeze({
  report: { contractor: ['contractor_pm'] },
  confirm: { agency: AGENCY_REVIEW, supervisor: SUPERVISOR_ASSURANCE },
  initial: { agency: AGENCY_REVIEW },
  fix: { contractor: ['contractor_pm', 'quality_engineer'] },
  reinspect: { agency: AGENCY_REVIEW },
  final: { agency: AGENCY_REVIEW },
  certificate: { agency: AGENCY_REVIEW },
  warranty: { agency: AGENCY_REVIEW },
})

function stagePermissions(party, role) {
  const out = {}
  for (const [stage, allowed] of Object.entries(ACCEPTANCE_STAGE_AUTHORITY)) {
    out[stage] = !!(party && role && allowed[party]?.includes(role))
  }
  return out
}

const NONE = Object.freeze({
  manageProjectIdentity: false, admin: false,
  manageBoq: false, editDailyLog: false, manageSafety: false,
  manageQualityExecution: false,
  submitInspection: false, decideInspection: false,
  submitValuation: false, reviewValuation: false, updatePayment: false,
  accessContractorPrivate: false,
  createSubmittal: false, reviewSubmittal: false,
  createRfi: false, answerRfi: false,
  openDefect: false, manageDefectRemediation: false, closeDefect: false,
  manageItp: false, manageObservations: false,
  manageChangeOrders: false, reviewChangeOrder: false, ratifyChangeOrder: false,
  manageProgressPlan: false, manageObligations: false,
  reviewRequirement: false, manageDocuments: false,
  recordAcceptance: Object.freeze(stagePermissions(null, null)),
  // 相容別名(粗粒度,只給非敏感 UI;敏感動作一律用上面的明確鍵)
  edit: false, submit: false, oversee: false, readonly: true,
})

// membership → 前端權限表。與 supabase/schema.sql 的 P0-03 permission functions
// 一一對應;伺服器永遠是最終仲裁者。
export function derivePermissions(membership) {
  const m = membership || null
  if (!m || m.party_is_active === false || !m.party_type || !m.project_role) {
    // 與伺服器端 my_project_membership() 一致：停用或無法解析的身分一律 fail closed。
    return NONE
  }
  const party = m.party_type
  const role = m.project_role
  const is = (p, roles) => party === p && roles.includes(role)
  const supervisorAssurance = is('supervisor', SUPERVISOR_ASSURANCE)

  const perms = {
    manageProjectIdentity: m.is_project_admin === true,
    admin: m.is_project_admin === true,
    // 廠商執行
    manageBoq: is('contractor', ['contractor_pm']),
    editDailyLog: is('contractor', ['contractor_pm', 'site_manager', 'quality_engineer']),
    manageSafety: is('contractor', ['contractor_pm', 'site_manager', 'safety_engineer']),
    manageQualityExecution: is('contractor', ['contractor_pm', 'quality_engineer']),
    submitInspection: is('contractor', ['contractor_pm', 'site_manager', 'quality_engineer']),
    submitValuation: is('contractor', ['contractor_pm']),
    accessContractorPrivate: is('contractor', ['contractor_pm']),
    createSubmittal: is('contractor', ['contractor_pm', 'site_manager', 'document_controller']),
    createRfi: is('contractor', ['contractor_pm', 'site_manager']),
    manageDefectRemediation: is('contractor', ['contractor_pm', 'site_manager', 'quality_engineer']),
    manageProgressPlan: is('contractor', ['contractor_pm', 'site_manager']),
    manageObligations: is('contractor', ['contractor_pm']),
    manageChangeOrders: is('contractor', ['contractor_pm']),
    // 監造查核
    decideInspection: supervisorAssurance,
    reviewValuation: supervisorAssurance,
    reviewSubmittal: supervisorAssurance,
    answerRfi: supervisorAssurance,
    closeDefect: supervisorAssurance,
    manageItp: supervisorAssurance,
    reviewChangeOrder: supervisorAssurance,
    // 機關治理
    ratifyChangeOrder: is('agency', ['agency_pm']),
    updatePayment: is('agency', ['agency_pm']) || is('contractor', ['contractor_pm']),
    reviewRequirement: is('agency', AGENCY_REVIEW) || supervisorAssurance,
    // 共同
    openDefect: supervisorAssurance || is('contractor', ['contractor_pm', 'quality_engineer']),
    manageObservations: supervisorAssurance
      || is('contractor', ['contractor_pm', 'site_manager', 'quality_engineer']),
    manageDocuments: role === 'document_controller'
      || is('contractor', ['contractor_pm'])
      || is('agency', ['agency_pm'])
      || is('supervisor', ['supervisor_manager']),
    recordAcceptance: stagePermissions(party, role),
  }

  // 相容別名:非敏感 UI(表單顯示/一般按鈕)可暫用;敏感動作已改用明確鍵。
  perms.edit = perms.editDailyLog || perms.manageQualityExecution || perms.manageSafety
    || perms.manageChangeOrders || perms.submitValuation || perms.manageProgressPlan
    || perms.manageBoq
  perms.submit = perms.submitValuation || perms.submitInspection
    || perms.createSubmittal || perms.createRfi
  perms.oversee = party === 'agency'
  perms.readonly = !(perms.edit || perms.submit || perms.decideInspection
    || perms.reviewValuation || perms.reviewSubmittal || perms.answerRfi
    || perms.closeDefect || perms.manageItp || perms.ratifyChangeOrder
    || perms.updatePayment || perms.reviewRequirement || perms.manageDocuments
    || Object.values(perms.recordAcceptance).some(Boolean))
  return perms
}

// demo 模式:三個銷售劇本角色映射為代表性的專案身分,走同一條推導路徑,
// 讓 demo UI 與真實授權矩陣一致(org_type 僅在 demo 有意義)。
export function demoMembershipForOrg(orgType) {
  switch (orgType) {
    case 'owner':
      return { party_type: 'agency', project_role: 'agency_pm', is_project_admin: false }
    case 'supervisor':
      return { party_type: 'supervisor', project_role: 'supervisor_manager', is_project_admin: false }
    default:
      return { party_type: 'contractor', project_role: 'contractor_pm', is_project_admin: false }
  }
}

export function deriveDemoPermissions(orgType) {
  return derivePermissions(demoMembershipForOrg(orgType))
}

// 側欄/儀表板的「這個專案我代表哪一方」:真實模式來自 currentProjectMembership,
// 對應既有 navGroups roles 與 ball-in-court 的 'contractor'|'supervisor'|'owner'。
// 未解析(other/designer/consultant/無 membership/party 停用)→ null(只看共用工具)。
export function navPartyKey(membership) {
  if (!membership || membership.party_is_active === false) return null
  switch (membership.party_type) {
    case 'agency': return 'owner'
    case 'contractor': return 'contractor'
    case 'supervisor': return 'supervisor'
    default: return null
  }
}
