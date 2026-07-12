export const PARTY_TYPES = Object.freeze([
  'agency',
  'contractor',
  'supervisor',
  'designer',
  'consultant',
  'other',
])

export const PROJECT_ROLES = Object.freeze([
  'agency_pm',
  'agency_engineer',
  'contractor_pm',
  'site_manager',
  'quality_engineer',
  'safety_engineer',
  'supervisor_manager',
  'supervisor_engineer',
  'document_controller',
  'viewer',
])

export function normalizeProjectMembership(row) {
  if (!row?.project_id) return null
  const partyRelation = Array.isArray(row.project_parties)
    ? row.project_parties[0]
    : row.project_parties
  const party = partyRelation || {}

  return {
    membership_id: row.membership_id || row.id || null,
    project_id: row.project_id,
    project_party_id: row.project_party_id || null,
    party_type: row.party_type || party.party_type || null,
    party_display_name: row.party_display_name || party.display_name || null,
    // P0-03: a deactivated party carries no contractual authority (fail
    // closed); an absent flag (older payloads/demo) defaults to active.
    party_is_active: (row.party_is_active ?? party.is_active) !== false,
    project_role: row.project_role || null,
    is_project_admin: row.is_project_admin === true,
  }
}

export function indexProjectMemberships(rows = []) {
  return Object.fromEntries(
    rows
      .map(normalizeProjectMembership)
      .filter(Boolean)
      .map((membership) => [membership.project_id, membership]),
  )
}
