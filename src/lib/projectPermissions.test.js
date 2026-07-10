import { describe, expect, it } from 'vitest'
import {
  derivePermissions,
  deriveDemoPermissions,
  demoMembershipForOrg,
  navPartyKey,
} from './projectPermissions.js'

const membership = (over) => ({
  project_id: 'p', party_type: 'contractor', project_role: 'contractor_pm',
  party_is_active: true, is_project_admin: false, ...over,
})

describe('project permission derivation', () => {
  it('fails closed without a membership', () => {
    const p = derivePermissions(null)
    expect(p.readonly).toBe(true)
    expect(p.submitValuation).toBe(false)
    expect(p.decideInspection).toBe(false)
    expect(p.accessContractorPrivate).toBe(false)
    expect(p.admin).toBe(false)
  })

  it('grants contractor PM execution authority but no assurance authority', () => {
    const p = derivePermissions(membership())
    expect(p.submitValuation).toBe(true)
    expect(p.submitInspection).toBe(true)
    expect(p.createSubmittal).toBe(true)
    expect(p.createRfi).toBe(true)
    expect(p.accessContractorPrivate).toBe(true)
    // must never gain supervisor/agency authority
    expect(p.decideInspection).toBe(false)
    expect(p.closeDefect).toBe(false)
    expect(p.reviewSubmittal).toBe(false)
    expect(p.answerRfi).toBe(false)
    expect(p.reviewValuation).toBe(false)
    expect(p.ratifyChangeOrder).toBe(false)
    expect(p.reviewRequirement).toBe(false)
  })

  it('separates technical admin from contractual authority', () => {
    const p = derivePermissions(membership({ is_project_admin: true }))
    expect(p.admin).toBe(true)
    expect(p.manageProjectIdentity).toBe(true)
    // admin must not grant any assurance/governance authority
    expect(p.decideInspection).toBe(false)
    expect(p.closeDefect).toBe(false)
    expect(p.reviewSubmittal).toBe(false)
    expect(p.ratifyChangeOrder).toBe(false)
    expect(p.reviewRequirement).toBe(false)
  })

  it('gives supervisor assurance authority and no contractor-private access', () => {
    const p = derivePermissions(membership({
      party_type: 'supervisor', project_role: 'supervisor_manager',
    }))
    expect(p.decideInspection).toBe(true)
    expect(p.reviewValuation).toBe(true)
    expect(p.reviewSubmittal).toBe(true)
    expect(p.answerRfi).toBe(true)
    expect(p.closeDefect).toBe(true)
    expect(p.manageItp).toBe(true)
    expect(p.reviewRequirement).toBe(true)
    expect(p.accessContractorPrivate).toBe(false)
    expect(p.submitValuation).toBe(false)
    expect(p.ratifyChangeOrder).toBe(false)
  })

  it('gives agency PM governance authority only', () => {
    const p = derivePermissions(membership({
      party_type: 'agency', project_role: 'agency_pm',
    }))
    expect(p.ratifyChangeOrder).toBe(true)
    expect(p.updatePayment).toBe(true)
    expect(p.reviewRequirement).toBe(true)
    expect(p.recordAcceptance.initial).toBe(true)
    expect(p.recordAcceptance.certificate).toBe(true)
    expect(p.recordAcceptance.report).toBe(false)
    expect(p.decideInspection).toBe(false)
    expect(p.accessContractorPrivate).toBe(false)
  })

  it('agency engineer does not inherit agency PM ratification/payment', () => {
    const p = derivePermissions(membership({
      party_type: 'agency', project_role: 'agency_engineer',
    }))
    expect(p.reviewRequirement).toBe(true)
    expect(p.recordAcceptance.initial).toBe(true)
    expect(p.ratifyChangeOrder).toBe(false)
    expect(p.updatePayment).toBe(false)
  })

  it('keeps least privilege for non-PM contractor roles', () => {
    const qe = derivePermissions(membership({ project_role: 'quality_engineer' }))
    expect(qe.manageQualityExecution).toBe(true)
    expect(qe.submitInspection).toBe(true)
    expect(qe.accessContractorPrivate).toBe(false)
    expect(qe.submitValuation).toBe(false)

    const sm = derivePermissions(membership({ project_role: 'safety_engineer' }))
    expect(sm.manageSafety).toBe(true)
    expect(sm.manageQualityExecution).toBe(false)
    expect(sm.accessContractorPrivate).toBe(false)
  })

  it('fails closed when the represented party is deactivated', () => {
    const p = derivePermissions(membership({ party_is_active: false, is_project_admin: true }))
    expect(p.readonly).toBe(true)
    expect(p.submitValuation).toBe(false)
    expect(p.accessContractorPrivate).toBe(false)
    expect(p.manageProjectIdentity).toBe(false)
    expect(p.admin).toBe(false)
  })

  it('treats unresolved (other/viewer) identity as read-only', () => {
    expect(derivePermissions(membership({ party_type: 'other', project_role: 'viewer' })).readonly).toBe(true)
    expect(derivePermissions(membership({ project_role: 'viewer' })).readonly).toBe(true)
  })

  it('maps demo roles to representative memberships', () => {
    expect(demoMembershipForOrg('owner')).toMatchObject({ party_type: 'agency', project_role: 'agency_pm' })
    expect(demoMembershipForOrg('supervisor')).toMatchObject({ party_type: 'supervisor' })
    expect(demoMembershipForOrg('contractor')).toMatchObject({ party_type: 'contractor' })
    expect(deriveDemoPermissions('supervisor').decideInspection).toBe(true)
    expect(deriveDemoPermissions('owner').ratifyChangeOrder).toBe(true)
    expect(deriveDemoPermissions('contractor').submitValuation).toBe(true)
  })
})

describe('project switching changes party context (no cross-project leak)', () => {
  // Ryan: contractor PM/admin on A, supervisor engineer non-admin on B.
  const projectA = membership({ project_id: 'A', is_project_admin: true })
  const projectB = membership({
    project_id: 'B', party_type: 'supervisor',
    project_role: 'supervisor_engineer', is_project_admin: false,
  })

  it('exposes only contractor authority on Project A', () => {
    const p = derivePermissions(projectA)
    expect(p.submitValuation).toBe(true)
    expect(p.accessContractorPrivate).toBe(true)
    expect(p.decideInspection).toBe(false)
    expect(navPartyKey(projectA)).toBe('contractor')
  })

  it('exposes only supervisor authority on Project B', () => {
    const p = derivePermissions(projectB)
    expect(p.decideInspection).toBe(true)
    expect(p.reviewValuation).toBe(true)
    // no leak of Project A contractor identity or admin status
    expect(p.submitValuation).toBe(false)
    expect(p.accessContractorPrivate).toBe(false)
    expect(p.admin).toBe(false)
    expect(navPartyKey(projectB)).toBe('supervisor')
  })

  it('maps party types to navigation keys and hides unresolved identity', () => {
    expect(navPartyKey(membership({ party_type: 'agency' }))).toBe('owner')
    expect(navPartyKey(membership({ party_type: 'other' }))).toBe(null)
    expect(navPartyKey(membership({ party_is_active: false }))).toBe(null)
    expect(navPartyKey(null)).toBe(null)
  })
})
