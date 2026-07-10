export const AUDIT_EVENT_LABELS = Object.freeze({
  'valuation.created': '估驗建立',
  'valuation.submitted': '估驗送審',
  'valuation.returned': '估驗退回',
  'valuation.approved': '估驗核定',
  'valuation.claimed': '估驗請款',
  'valuation.payment_updated': '請款／撥款資料更新',
  'valuation.deleted': '估驗刪除',
  'inspection.created': '查驗申請建立',
  'inspection.decided': '查驗判定',
  'inspection.reopened': '查驗重新開啟',
  'inspection.deleted': '查驗刪除',
  'defect.created': '缺失開立',
  'defect.remediation_updated': '缺失改善更新',
  'defect.closed': '缺失結案',
  'defect.reopened': '缺失重新開啟',
  'defect.deleted': '缺失刪除',
  'submittal.created': '送審文件提送',
  'submittal.resubmitted': '送審文件修正再送',
  'submittal.approved': '送審文件核准',
  'submittal.approved_as_noted': '送審文件核備',
  'submittal.returned': '送審文件退回補正',
  'submittal.rejected': '送審文件駁回',
  'submittal.deleted': '送審文件刪除',
  'rfi.created': '工程疑義提出',
  'rfi.answered': '工程疑義回覆',
  'rfi.closed': '工程疑義結案',
  'rfi.deleted': '工程疑義刪除',
  'change_order.created': '變更設計提出',
  'change_order.review_started': '變更設計開始審查',
  'change_order.returned': '變更設計退回',
  'change_order.approved': '變更設計核准',
  'change_order.rejected': '變更設計駁回',
  'change_order.ratification_reopened': '變更設計撤銷核定',
  'change_order.deleted': '變更設計刪除',
  'requirement.created': '履約需求建立',
  'requirement.approved': '履約需求核定',
  'requirement.rejected': '履約需求駁回',
  'requirement.superseded': '履約需求廢止取代',
  'requirement.deleted': '履約需求刪除',
  'document.created': '專案文件建立',
  'document.version_created': '文件版本建立',
  'project_party.created': '專案參與方建立',
  'project_party.updated': '專案參與方更新',
  'project_party.deactivated': '專案參與方停用',
  'project_membership.created': '專案成員建立',
  'project_membership.role_changed': '專案成員角色變更',
  'project_membership.admin_changed': '技術管理員狀態變更',
  'project_membership.removed': '專案成員移除',
  'acceptance.stage_recorded': '驗收階段登錄',
  'acceptance.stage_updated': '驗收階段更新',
  'acceptance.stage_removed': '驗收階段移除',
})

export const AUDIT_ENTITY_LABELS = Object.freeze({
  valuation: '估驗', inspection: '查驗', defect: '缺失', submittal: '送審文件',
  rfi: '工程疑義', change_order: '變更設計', requirement: '履約需求',
  document: '文件', document_version: '文件版本', project_party: '專案參與方',
  project_membership: '專案成員', acceptance_event: '驗收階段',
})

const PARTY_LABELS = Object.freeze({
  agency: '機關', contractor: '廠商', supervisor: '監造', designer: '設計',
  consultant: '顧問', other: '其他',
})

const ROLE_LABELS = Object.freeze({
  agency_pm: '機關專案經理', agency_engineer: '機關工程師',
  contractor_pm: '廠商專案經理', site_manager: '工地主任',
  quality_engineer: '品管工程師', safety_engineer: '工安工程師',
  supervisor_manager: '監造經理', supervisor_engineer: '監造工程師',
  document_controller: '文件管理員', viewer: '檢視者',
})

const STAGE_LABELS = Object.freeze({
  report: '報竣', confirm: '竣工確認', initial: '初驗', fix: '缺失改善',
  reinspect: '複驗', final: '正式驗收', certificate: '結算驗收證明', warranty: '保固起算',
})

export function auditEventLabel(eventType) {
  return AUDIT_EVENT_LABELS[eventType] || '專案活動'
}

export function auditEntityLabel(entityType) {
  return AUDIT_ENTITY_LABELS[entityType] || entityType || '紀錄'
}

export function auditActorDisplay(event) {
  if (!event?.actor_user_id) return event?.metadata?.actor_kind === 'system' ? '系統' : '未識別執行者'
  const role = ROLE_LABELS[event.actor_project_role] || event.actor_project_role
  const party = PARTY_LABELS[event.actor_party_type] || event.actor_party_type
  const identity = role || party || `使用者 ${event.actor_user_id.slice(0, 8)}`
  return event.actor_is_project_admin ? `${identity} · 技術管理員` : identity
}

export function auditEventSubject(event) {
  const row = event?.after_data || event?.before_data || {}
  if (event?.entity_type === 'valuation' && row.period_no != null) return `第 ${row.period_no} 期估驗`
  if (event?.entity_type === 'acceptance_event') {
    const stage = event?.metadata?.stage_key || row.stage_key
    return STAGE_LABELS[stage] || stage || '驗收階段'
  }
  const title = row.title || row.display_name || row.document_number || row.version_label
  if (title) return title
  const id = event?.entity_id ? event.entity_id.slice(0, 8) : '—'
  return `${auditEntityLabel(event?.entity_type)} ${id}`
}

function nextDate(date) {
  if (!date) return ''
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function normalizeAuditFilters(filters = {}) {
  const clean = (value) => (typeof value === 'string' ? value.trim() : '')
  return {
    actorUserId: clean(filters.actorUserId),
    eventType: clean(filters.eventType),
    entityType: clean(filters.entityType),
    dateFrom: clean(filters.dateFrom),
    dateToExclusive: nextDate(clean(filters.dateTo)),
  }
}
