import { computeObligationDue } from './contractDue.js'

export const REQUIREMENT_TYPES = Object.freeze([
  'deadline',
  'submittal',
  'inspection',
  'test',
  'checklist',
  'evidence',
  'photo',
  'report',
  'other',
])

export const REQUIREMENT_MATCH_TYPES = Object.freeze(['ai', 'code', 'description', 'manual'])

export function isRequirementAuthoritative(requirement) {
  return !requirement?.ai_generated || Boolean(requirement.reviewed_at)
}

export function deadlineRuleFromRequirement(requirement) {
  if (requirement?.requirement_type !== 'deadline') return null
  const trigger = requirement.trigger_config || {}
  const frequency = requirement.frequency_config || {}
  return {
    trigger_event: requirement.trigger_type || null,
    offset_days: trigger.offset_days ?? null,
    offset_dir: trigger.offset_dir || 'after',
    fixed_date: trigger.fixed_date || null,
    recurring: requirement.frequency_type || null,
    recurring_day: frequency.day ?? null,
  }
}

export function computeRequirementDue(requirement, anchors) {
  const rule = deadlineRuleFromRequirement(requirement)
  return rule ? computeObligationDue(rule, anchors) : null
}
