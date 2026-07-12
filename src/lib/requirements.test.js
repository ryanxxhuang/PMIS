import { describe, expect, it } from 'vitest'
import {
  REQUIREMENT_MATCH_TYPES,
  REQUIREMENT_ORIGINS,
  REQUIREMENT_SOURCE_KINDS,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  computeRequirementDue,
  deadlineRuleFromRequirement,
  isRequirementAuthoritative,
} from './requirements.js'
import { computeObligationDue } from './contractDue.js'

const anchors = {
  award_date: '2026-01-10',
  notice_date: '2026-01-20',
  commencement_date: '2026-02-01',
  end_date: '2026-12-31',
}

const ymd = (date) => date?.toISOString().slice(0, 10) || null

describe('requirement domain', () => {
  it('exposes the P0-01 domain constants', () => {
    expect(REQUIREMENT_TYPES).toEqual([
      'deadline', 'submittal', 'inspection', 'test', 'checklist',
      'evidence', 'photo', 'report', 'other',
    ])
    expect(REQUIREMENT_MATCH_TYPES).toEqual(['ai', 'code', 'description', 'manual'])
    expect(REQUIREMENT_STATUSES).toEqual([
      'draft_ai', 'needs_review', 'approved', 'rejected', 'superseded',
    ])
    expect(REQUIREMENT_ORIGINS).toEqual(['ai', 'manual', 'migration'])
    expect(REQUIREMENT_SOURCE_KINDS).toEqual(['document', 'legacy', 'manual'])
  })

  it('treats only approved requirements as authoritative', () => {
    for (const status of REQUIREMENT_STATUSES) {
      expect(isRequirementAuthoritative({ status })).toBe(status === 'approved')
    }
  })

  it('does not derive authority from origin or review metadata', () => {
    const reviewedAt = '2026-07-10T00:00:00Z'
    expect(isRequirementAuthoritative({ origin: 'manual', status: 'needs_review' })).toBe(false)
    expect(isRequirementAuthoritative({ origin: 'ai', status: 'rejected', reviewed_at: reviewedAt })).toBe(false)
    expect(isRequirementAuthoritative({ origin: 'ai', status: 'superseded', reviewed_at: reviewedAt })).toBe(false)
    expect(isRequirementAuthoritative({ origin: 'migration', status: 'approved' })).toBe(true)
  })

  it('preserves legacy relative-deadline behavior', () => {
    const obligation = {
      trigger_event: 'commencement',
      offset_days: 30,
      offset_dir: 'after',
      fixed_date: null,
      recurring: null,
      recurring_day: null,
    }
    const requirement = {
      requirement_type: 'deadline',
      trigger_type: obligation.trigger_event,
      trigger_config: {
        offset_days: obligation.offset_days,
        offset_dir: obligation.offset_dir,
      },
      frequency_type: obligation.recurring,
      frequency_config: {},
    }

    expect(deadlineRuleFromRequirement(requirement)).toEqual(obligation)
    expect(ymd(computeRequirementDue(requirement, anchors)))
      .toBe(ymd(computeObligationDue(obligation, anchors)))
  })

  it('preserves fixed and recurring deadline rule fields', () => {
    const fixedRequirement = {
      requirement_type: 'deadline',
      trigger_type: 'fixed',
      trigger_config: { fixed_date: '2026-06-15' },
      frequency_config: {},
    }
    const fixedObligation = { trigger_event: 'fixed', fixed_date: '2026-06-15' }
    expect(deadlineRuleFromRequirement(fixedRequirement)).toMatchObject(fixedObligation)
    expect(ymd(computeRequirementDue(fixedRequirement, anchors)))
      .toBe(ymd(computeObligationDue(fixedObligation, anchors)))

    const recurringRequirement = {
      requirement_type: 'deadline',
      trigger_config: {},
      frequency_type: 'monthly',
      frequency_config: { day: 5 },
    }
    const recurringObligation = { recurring: 'monthly', recurring_day: 5 }
    expect(deadlineRuleFromRequirement(recurringRequirement)).toMatchObject(recurringObligation)
    expect(ymd(computeRequirementDue(recurringRequirement, anchors)))
      .toBe(ymd(computeObligationDue(recurringObligation, anchors)))
  })

  it('does not apply deadline behavior to specialized requirement types', () => {
    expect(deadlineRuleFromRequirement({ requirement_type: 'inspection' })).toBeNull()
    expect(computeRequirementDue({ requirement_type: 'inspection' }, anchors)).toBeNull()
  })
})
