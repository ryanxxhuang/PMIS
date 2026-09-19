// @vitest-environment jsdom
// P4c 明細列的依據標示與來源展開:
//   ① 有缺件(state.items[].violations 翻成 flags)的列標「缺監造確認來源・申報,不計價」,不是綠色「監造確認」;
//   ② legacy 來源在來源展開列明確標「歷史遷移,非監造確認,需補證」;
//   ③ 監造確認來源列出批次／位置、確認累計、查驗、文件版本、確認人與時間;
//   ④ 上限(可再增)只在有 state 時顯示,且來自 DB 的 headroom;總價類缺依據顯示「計價依據待設定」,監造才有設定下拉。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import ValuationRow from './ValuationRow.jsx'
import { describeViolation } from '../../lib/valuationChecks.js'

const leaf = { item_key: 'L1', item_no: '1.1', description: '混凝土', unit: 'm3', quantity: 100, unit_price: 1000, depth: 2 }
const ev = { logs: [], loggedTotal: 0, inspections: [], checklists: [], samples: [], counts: { logs: 0, inspections: 0, checklists: 0, samples: 0 } }
const noop = () => {}

let container, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

const render = (props) => act(async () => root.render(
  <MemoryRouter><table><tbody>
    <ValuationRow it={leaf} level={0} hasKids={false} isOpen={false} evIsOpen={false} cum={0} prevCum={0}
      editable selectedId="v1" getEvidence={() => ev} onToggle={noop} onToggleEv={noop} onToggleSrc={noop} onQty={noop} onSetBasis={noop} {...props} />
  </tbody></table></MemoryRouter>,
))
const text = () => container.textContent

describe('依據標示', () => {
  it('① 缺監造確認來源的申報量:標「申報,不計價」,可再增來自 DB headroom', async () => {
    const state = { work_item_id: 'w1', delta: 100, cum_qty: 100, prev_cum: 0, headroom: 0, cap: 0, basis: 'inspection', backing: 'legacy', sources: [] }
    const flags = [describeViolation({ code: 'source_mismatch', message: 'x' })]
    await render({ qtyInput: 100, state, flags })
    expect(text()).toContain('缺監造確認來源・申報,不計價')
    expect(text()).not.toContain('監造確認來源 1')
    expect(text()).toContain('可再增 0')
    expect(text()).toContain('無確認來源')
    expect(text()).toContain('無日誌申報') // 日誌只作差異比對
  })

  it('② 由確認量分配的列標「監造確認」;沒有 state(demo)不顯示上限也不假造依據', async () => {
    const state = { work_item_id: 'w1', delta: 60, cum_qty: 60, prev_cum: 0, headroom: 0, basis: 'inspection', backing: 'confirmed', sources: [{ id: 's1', kind: 'confirmation', qty: 60, batch_key: 'a區' }] }
    await render({ qtyInput: 60, state, flags: undefined })
    expect(text()).toContain('監造確認')
    expect(text()).toContain('來源 1 筆')
    await render({ qtyInput: 60, state: undefined, flags: undefined })
    expect(text()).not.toContain('可再增')
    expect(text()).not.toContain('來源')
  })

  it('④ 總價類缺依據:顯示「計價依據待設定」;只有 basisEditable(監造)才有設定下拉', async () => {
    const state = { work_item_id: 'w1', delta: 0, cum_qty: null, prev_cum: 0, headroom: 0, basis: null, backing: null, sources: [] }
    await render({ qtyInput: undefined, state, basisEditable: false })
    expect(text()).toContain('計價依據待設定')
    expect(container.querySelector('select')).toBeNull()
    await render({ qtyInput: undefined, state, basisEditable: true })
    const sel = container.querySelector('select[aria-label="1.1 計價依據"]')
    expect(sel).not.toBeNull()
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'supervisor_certificate', 'inspection', 'excluded'])
  })
})

describe('來源展開列', () => {
  it('② legacy 來源明確標「歷史遷移,非監造確認,需補證」', async () => {
    const state = { work_item_id: 'w1', delta: 100, cum_qty: 100, prev_cum: 0, headroom: 0, effective_cutoff: 0, billed: 0, reserved: 0, basis: 'inspection', backing: 'legacy',
      sources: [{ id: 's1', kind: 'legacy', qty: 100, batch_key: '__legacy__' }] }
    await render({ qtyInput: 100, state, flags: [describeViolation({ code: 'legacy_source' })], srcIsOpen: true, confirmationsById: new Map(), inspectionsById: new Map(), nameOf: () => '—' })
    expect(text()).toContain('歷史遷移,非監造確認,需補證')
    expect(text()).toContain('待監造簽發監造確認單補證後才可登錄請款日') // 非監造:只知道下一步由誰處理
    expect(text()).toContain('有效確認 0 筆')
    expect(container.querySelector('button[aria-label^="補證此期"]')).toBeNull() // 廠商沒有補證入口
    expect(text()).toContain('前期累計 0')
  })

  it('③ 監造確認來源:批次／位置、確認累計、查驗、文件版本、確認人與時間全部來自 DB 列', async () => {
    const conf = { id: 'c1', batch_key: 'a區1f', location_label: 'A區1F', stage_key: null, unit: 'm3', qty_cum: 60, basis: 'inspection',
      inspection_id: 'i1', document_id: 'd1', document_version_no: 2, confirmed_by: 'u-sup', confirmed_at: '2026-09-19T01:02:03Z', status: 'active' }
    const state = { work_item_id: 'w1', delta: 60, cum_qty: 60, prev_cum: 0, headroom: 0, effective_cutoff: 60, billed: 0, reserved: 0, basis: 'inspection', backing: 'confirmed',
      required_stages: [], sources: [{ id: 's1', kind: 'confirmation', qty: 60, batch_key: 'a區1f', confirmation_id: 'c1' }] }
    await render({ qtyInput: 60, state, srcIsOpen: true,
      confirmationsById: new Map([['c1', conf]]), inspectionsById: new Map([['i1', { id: 'i1', title: '1F 版牆查驗', status: '合格' }]]), nameOf: (uid) => (uid === 'u-sup' ? '王監造' : uid) })
    const t = text()
    expect(t).toContain('批次 A區1F')
    expect(t).toContain('確認累計 60 m3')
    expect(t).toContain('1F 版牆查驗')
    expect(t).toContain('合格')
    expect(t).toContain('文件版本 v2')
    expect(t).toContain('王監造')
    expect(container.querySelector('a[href="/quality?inspection=i1"]')).not.toBeNull()
    expect(container.querySelector('a[href="/site?doc=d1"]')).not.toBeNull()
    expect(t).not.toContain('歷史遷移')
  })
})

// P4d:撤銷／減量／簽發／補證的入口只給監造(canManage);對象是全案 active 確認(activeConfirmations),不是本期分配
describe('P4d 有效確認與監造動作', () => {
  const state = { work_item_id: 'w1', delta: 100, cum_qty: 100, prev_cum: 0, headroom: 0, basis: 'inspection', backing: 'legacy', sources: [{ id: 's1', kind: 'legacy', qty: 100, batch_key: '__legacy__' }] }
  const confs = [
    { id: 'c1', work_item_id: 'w1', batch_key: 'a區', location_label: 'A區', stage_key: null, unit: 'm3', qty_cum: 60, basis: 'supervisor_certificate', confirmed_by: 'u-sup', confirmed_at: '2026-09-19T01:00:00Z', status: 'active' },
    { id: 'c2', work_item_id: 'w1', batch_key: 'b區', location_label: 'B區', stage_key: null, unit: 'm3', qty_cum: 40, basis: 'inspection', confirmed_by: 'u-sup', confirmed_at: '2026-09-19T02:00:00Z', status: 'active' },
  ]
  it('監造在已核定期:有效確認逐筆有「撤銷」,監造確認單有「減量」、查驗確認只能撤銷;有 legacy 來源時有「補證此期」帶遷移量', async () => {
    const calls = []
    await render({ qtyInput: 100, state, srcIsOpen: true, editable: false, periodStatus: '已核定', canManage: true, activeConfirmations: confs,
      nameOf: () => '王監造', onRevoke: (it, c) => calls.push(['revoke', c.id]), onReduce: (it, c) => calls.push(['reduce', c.id]),
      onIssue: (it) => calls.push(['issue', it.item_key]), onCover: (it, q) => calls.push(['cover', q]) })
    expect(text()).toContain('有效確認 2 筆')
    expect(text()).toContain('王監造')
    expect(text()).toContain('減量請重簽查驗表單')
    const click = (label) => act(async () => container.querySelector(`button[aria-label="${label}"]`).click())
    await click('撤銷確認 A區'); await click('減量確認 A區'); await click('撤銷確認 B區'); await click('簽發監造確認單 1.1'); await click('補證此期 1.1')
    expect(container.querySelector('button[aria-label="減量確認 B區"]')).toBeNull()
    expect(calls).toEqual([['revoke', 'c1'], ['reduce', 'c1'], ['revoke', 'c2'], ['issue', 'L1'], ['cover', 100]])
    expect(text()).toContain('按「補證此期」由你簽發監造確認單補證')
  })
  it('草稿期沒有「補證此期」(只有已核定／已請款期需要補證);非監造完全沒有動作鈕', async () => {
    await render({ qtyInput: 100, state, srcIsOpen: true, periodStatus: '草稿', canManage: true, activeConfirmations: confs })
    expect(container.querySelector('button[aria-label^="補證此期"]')).toBeNull()
    expect(container.querySelector('button[aria-label^="撤銷確認"]')).not.toBeNull()
    await render({ qtyInput: 100, state, srcIsOpen: true, periodStatus: '已核定', canManage: false, activeConfirmations: confs })
    expect(container.querySelectorAll('button[aria-label^="撤銷確認"], button[aria-label^="減量確認"], button[aria-label^="簽發監造確認單"], button[aria-label^="補證此期"]')).toHaveLength(0)
    expect(text()).toContain('有效確認 2 筆')
  })
})
