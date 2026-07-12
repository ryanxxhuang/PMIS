import { describe, expect, it } from 'vitest'
import {
  PARTY_TYPES,
  PROJECT_ROLES,
  indexProjectMemberships,
  normalizeProjectMembership,
} from './projectIdentity.js'

describe('project-scoped identity', () => {
  it('exposes the P0-02 party and role vocabulary', () => {
    expect(PARTY_TYPES).toEqual([
      'agency', 'contractor', 'supervisor', 'designer', 'consultant', 'other',
    ])
    expect(PROJECT_ROLES).toEqual([
      'agency_pm', 'agency_engineer', 'contractor_pm', 'site_manager',
      'quality_engineer', 'safety_engineer', 'supervisor_manager',
      'supervisor_engineer', 'document_controller', 'viewer',
    ])
  })

  it('normalizes a Supabase party relation', () => {
    expect(normalizeProjectMembership({
      id: 'membership-a',
      project_id: 'project-a',
      project_party_id: 'party-a',
      project_role: 'contractor_pm',
      is_project_admin: true,
      project_parties: { party_type: 'contractor', display_name: 'Builder A' },
    })).toEqual({
      membership_id: 'membership-a',
      project_id: 'project-a',
      project_party_id: 'party-a',
      party_type: 'contractor',
      party_display_name: 'Builder A',
      party_is_active: true,
      project_role: 'contractor_pm',
      is_project_admin: true,
    })
  })

  it('keeps Ryan\'s identity independent in each project', () => {
    const memberships = indexProjectMemberships([
      {
        id: 'membership-a',
        project_id: 'project-a',
        project_party_id: 'party-a',
        project_role: 'contractor_pm',
        is_project_admin: true,
        project_parties: [{ party_type: 'contractor', display_name: 'Builder A' }],
      },
      {
        id: 'membership-b',
        project_id: 'project-b',
        project_party_id: 'party-b',
        project_role: 'supervisor_engineer',
        is_project_admin: false,
        project_parties: [{ party_type: 'supervisor', display_name: 'Supervisor B' }],
      },
    ])

    expect(memberships['project-a']).toMatchObject({
      party_type: 'contractor',
      project_role: 'contractor_pm',
      is_project_admin: true,
    })
    expect(memberships['project-b']).toMatchObject({
      party_type: 'supervisor',
      project_role: 'supervisor_engineer',
      is_project_admin: false,
    })
  })

  it('does not let technical admin status redefine party or project role', () => {
    const membership = normalizeProjectMembership({
      id: 'membership-a',
      project_id: 'project-a',
      project_party_id: 'party-a',
      project_role: 'quality_engineer',
      is_project_admin: true,
      party_type: 'contractor',
      party_display_name: 'Builder A',
    })

    expect(membership.party_type).toBe('contractor')
    expect(membership.project_role).toBe('quality_engineer')
    expect(membership.is_project_admin).toBe(true)
  })
})
