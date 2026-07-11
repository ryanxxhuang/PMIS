// P0-07.5 contract package presentation + role-derived options (pure).
// A contract package is a party relationship (agency <-> counterparty), not a
// folder. Which packages a user may see or fill is decided by the DB
// (can_access_contract_package); these helpers only derive the SAME options
// for the UI so users are never offered a package they cannot touch.

export const PACKAGE_TYPES = Object.freeze(['construction', 'supervision', 'other'])

export const PACKAGE_TYPE_LABELS = Object.freeze({
  construction: '施工契約',
  supervision: '監造契約',
  other: '其他契約',
})

export const PACKAGE_STATUS_LABELS = Object.freeze({
  draft: '尚未上傳',
  processing: '整理中',
  ready: '已就緒',
  needs_attention: '需要確認',
  archived: '已封存',
})

// Options the current member may upload into, mirroring the DB visibility
// baseline: agency -> construction + supervision; supervisor -> own
// supervision + construction; contractor -> own construction only.
// parties: project_parties rows ({ id, party_type, display_name }).
export function availablePackageOptions({ membership, parties }) {
  const partyType = membership?.party_type
  const myPartyId = membership?.project_party_id
  if (!partyType || !myPartyId) return []
  const contractorParty = (parties || []).find((p) => p.party_type === 'contractor')
  const supervisorParty = (parties || []).find((p) => p.party_type === 'supervisor')
  const options = []
  const construction = contractorParty && {
    package_type: 'construction',
    counterparty_project_party_id: contractorParty.id,
    counterparty_name: contractorParty.display_name,
  }
  const supervision = supervisorParty && {
    package_type: 'supervision',
    counterparty_project_party_id: supervisorParty.id,
    counterparty_name: supervisorParty.display_name,
  }
  if (partyType === 'agency') {
    if (construction) options.push({ ...construction, label: '施工廠商契約' })
    if (supervision) options.push({ ...supervision, label: '監造契約' })
  } else if (partyType === 'supervisor') {
    if (supervision && supervisorParty.id === myPartyId) {
      options.push({ ...supervision, label: '我的監造契約' })
    }
    if (construction) options.push({ ...construction, label: '施工廠商契約' })
  } else if (partyType === 'contractor') {
    if (construction && contractorParty.id === myPartyId) {
      options.push({ ...construction, label: '我的施工契約' })
    }
  }
  return options
}

// Dashboard display name for an existing package row: role-relative title
// plus the counterparty's real name - never raw party IDs.
export function packageDisplayName(pkg, { partiesById = new Map(), myPartyId = null } = {}) {
  const mine = pkg.counterparty_project_party_id === myPartyId
  const base = mine
    ? `我的${PACKAGE_TYPE_LABELS[pkg.package_type] || pkg.package_type}`
    : (pkg.package_type === 'construction' ? '施工廠商契約'
      : PACKAGE_TYPE_LABELS[pkg.package_type] || pkg.title)
  const counterparty = partiesById.get(pkg.counterparty_project_party_id)
  return { title: base, subtitle: counterparty?.display_name || '' }
}

export function defaultPackageTitle(option) {
  return `${PACKAGE_TYPE_LABELS[option.package_type] || option.package_type}（${option.counterparty_name}）`
}
