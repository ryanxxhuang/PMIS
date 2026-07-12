import { describe, expect, it } from 'vitest'
import {
  PACKAGE_TYPE_LABELS, availablePackageOptions, packageDisplayName, defaultPackageTitle,
} from './contractPackages.js'

const parties = [
  { id: 'party-agency', party_type: 'agency', display_name: '臺北市政府工務局' },
  { id: 'party-contractor', party_type: 'contractor', display_name: '大華營造股份有限公司' },
  { id: 'party-supervisor', party_type: 'supervisor', display_name: '宏觀工程顧問股份有限公司' },
]

describe('availablePackageOptions (role-derived, mirrors DB visibility)', () => {
  it('contractor gets only its own construction package', () => {
    const options = availablePackageOptions({
      membership: { party_type: 'contractor', project_party_id: 'party-contractor' },
      parties,
    })
    expect(options).toHaveLength(1)
    expect(options[0].package_type).toBe('construction')
    expect(options[0].label).toBe('我的施工契約')
    expect(options.some((o) => o.package_type === 'supervision')).toBe(false)
  })

  it('supervisor gets own supervision package plus the construction package', () => {
    const options = availablePackageOptions({
      membership: { party_type: 'supervisor', project_party_id: 'party-supervisor' },
      parties,
    })
    expect(options.map((o) => [o.package_type, o.label])).toEqual([
      ['supervision', '我的監造契約'],
      ['construction', '施工廠商契約'],
    ])
  })

  it('agency gets both packages with party names, never raw IDs', () => {
    const options = availablePackageOptions({
      membership: { party_type: 'agency', project_party_id: 'party-agency' },
      parties,
    })
    expect(options.map((o) => o.label)).toEqual(['施工廠商契約', '監造契約'])
    expect(options[0].counterparty_name).toBe('大華營造股份有限公司')
  })

  it('fails closed without a resolvable membership', () => {
    expect(availablePackageOptions({ membership: null, parties })).toEqual([])
    expect(availablePackageOptions({
      membership: { party_type: 'contractor', project_party_id: null }, parties,
    })).toEqual([])
  })

  it('offers nothing when the counterparty party does not exist yet', () => {
    const options = availablePackageOptions({
      membership: { party_type: 'agency', project_party_id: 'party-agency' },
      parties: [parties[0]],
    })
    expect(options).toEqual([])
  })
})

describe('package display naming', () => {
  const partiesById = new Map(parties.map((p) => [p.id, p]))
  const pkg = {
    package_type: 'construction',
    counterparty_project_party_id: 'party-contractor',
    title: '施工契約（大華營造股份有限公司）',
  }

  it('shows 我的… for the counterparty itself and the party name as subtitle', () => {
    expect(packageDisplayName(pkg, { partiesById, myPartyId: 'party-contractor' }))
      .toEqual({ title: '我的施工契約', subtitle: '大華營造股份有限公司' })
  })

  it('shows 施工廠商契約 to other parties', () => {
    expect(packageDisplayName(pkg, { partiesById, myPartyId: 'party-agency' }).title)
      .toBe('施工廠商契約')
  })

  it('builds a deterministic default title from the option', () => {
    expect(defaultPackageTitle({ package_type: 'supervision', counterparty_name: '宏觀工程顧問股份有限公司' }))
      .toBe('監造契約（宏觀工程顧問股份有限公司）')
    expect(PACKAGE_TYPE_LABELS.other).toBe('其他契約')
  })
})
