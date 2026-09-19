// @vitest-environment jsdom
// P6a:估驗佐證包的本期證據取確認量來源與簽署文件版本——查驗表單版本(雜湊)、其附件照片、檢附的自主檢查;
// 施工日誌取送審時點以前已簽署的版本;缺件照 DB 違反明示;不再撈「同工項所有照片／日誌」。定位只走 aria-label 與文字。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import ValuationPackage from './ValuationPackage.jsx'

let container, root
const items = [
  { id: 'wi-1', item_key: '1.1', parent_key: null, item_no: '一', description: '結構混凝土', unit: 'M3', quantity: 200, unit_price: 500, amount: 100000, is_billable: true, is_leaf: true, is_rollup: false, sort_order: 1 },
  { id: 'wi-2', item_key: '1.2', parent_key: null, item_no: '二', description: '模板', unit: 'M2', quantity: 100, unit_price: 100, amount: 10000, is_billable: true, is_leaf: true, is_rollup: false, sort_order: 2 },
]
const H = (c) => c.repeat(64)
const V1 = { id: 'V1', period_no: 1, status: '監造審核', valuation_date: '2026-09-30', period_end: '2026-09-30', retention_pct: 5,
  items: { 1.1: 60, 1.2: 30 }, amounts: { 1.1: 30000, 1.2: 3000 } }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.store = {
    project: { project_name: '測試案', project_code: 'T-1', owner_name: '機關', contractor_name: '廠商' },
    workItems: { items }, adjustedItems: items, revisedTotal: 110000, dbMode: true,
    valuations: [V1], currentUser: { user_id: 'u-con', org_type: 'contractor' },
    inspections: [{ id: 'insp-1', title: '3F 版牆混凝土查驗', status: '部分合格' }],
    checklistRecords: [{ id: 'rec-1', check_date: '2026-09-09', rev: 0, overall: '合格' }],
    siteLogs: [
      { id: 'L5', log_date: '2026-09-05', items: { 1.1: 45 } }, // 事實列已是送審後更正 v2 的內容
      { id: 'L7', log_date: '2026-09-07', items: { 1.1: 3 } }, // 從未簽署
    ],
    fieldDocuments: { documents: [{ id: 'form-1', doc_type: 'inspection_form', status: 'submitted' }], submissions: [] },
    fetchValuationState: vi.fn(async () => ({ state: { items: [
      { work_item_id: 'wi-1', violations: [], sources: [{ id: 's1', kind: 'confirmation', qty: 60, batch_key: '3f版牆', confirmation_id: 'c1' }] },
      { work_item_id: 'wi-2', violations: [{ code: 'source_mismatch', work_item_id: 'wi-2' }], sources: [] },
    ] }, error: null })),
    fetchConfirmations: vi.fn(async () => ({ rows: [
      { id: 'c1', work_item_id: 'wi-1', batch_key: '3f版牆', location_label: '3F 版牆', unit: 'M3', qty_cum: 60, basis: 'inspection',
        inspection_id: 'insp-1', document_id: 'form-1', document_version_no: 2, content_hash: H('c'), status: 'active', confirmed_by: 'u-sup', confirmed_at: '2026-09-10T02:00:00Z' },
    ], error: null })),
    fetchValuationSubmittedAt: vi.fn(async () => ({ at: '2026-10-02T00:00:00Z', error: null })),
    listSignedVersions: vi.fn(async (t) => ({ error: null, rows: {
      inspection_form: [{ document_id: 'form-1', doc_type: 'inspection_form', doc_date: '2026-09-10', doc_status: 'submitted', target_id: 'insp-1', version_no: 2, content_hash: H('c'), signer_name_snapshot: '王監造', signed_at: '2026-09-10T02:00:00Z' }],
      self_check: [{ document_id: 'sc-1', doc_type: 'self_check', doc_date: '2026-09-09', doc_status: 'received', target_id: 'rec-1', version_no: 1, content_hash: H('d'), signed_at: '2026-09-09T02:00:00Z' }],
      daily_log: [
        { document_id: 'd5', doc_type: 'daily_log', doc_date: '2026-09-05', doc_status: 'submitted', target_id: 'L5', version_no: 1, content_hash: H('e'), signed_at: '2026-09-05T10:00:00Z' },
        { document_id: 'd5', doc_type: 'daily_log', doc_date: '2026-09-05', doc_status: 'submitted', target_id: 'L5', version_no: 2, content_hash: H('f'), signed_at: '2026-10-03T10:00:00Z' },
      ],
    }[t] || [] })),
    getFieldDocumentVersions: vi.fn(async (refs) => ({ error: null, versions: new Map([
      ['form-1:2', { document_id: 'form-1', version_no: 2, content_hash: H('c'), attachments: [{ photo_id: 'p1' }], content: { self_check_record_id: 'rec-1' } }],
      ['d5:1', { document_id: 'd5', version_no: 1, content: { weather_am: '晴', work_summary: '3F 版牆澆置', items: { 'wi-1': { item_key: '1.1', qty_today: 40 } } }, field_sources: {} }],
    ].filter(([k]) => refs.some((r) => `${r.document_id}:${r.version_no}` === k))) })),
    listPhotosByIds: vi.fn(async () => [{ id: 'p1', url: 'https://x/p1.jpg', caption: '版牆澆置', location: '3F', taken_at: '2026-09-10T01:00:00Z' }]),
    listMembers: vi.fn(async () => ({ rows: [{ user_id: 'u-sup', full_name: '王監造' }], error: null })),
    draftValuationSummary: vi.fn(), aiEnabled: () => false,
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

const render = () => act(async () => { root.render(<MemoryRouter initialEntries={['/valuation/package?p=V1']}><ValuationPackage /></MemoryRouter>) })
const text = () => container.textContent

describe('估驗佐證包(P6a)', () => {
  it('本期來源:監造確認量 → 查驗表單版本(簽署當下雜湊)→ 附件照片 → 檢附自主檢查;缺件明示', async () => {
    await render()
    const src = container.querySelector('[aria-label="本期確認來源"]')
    expect(src.textContent).toContain('監造確認 60 M3')
    expect(src.textContent).toContain('批次 3F 版牆')
    expect(src.textContent).toContain(`文件 form-1 v2・雜湊 ${'c'.repeat(12)}`)
    expect(src.textContent).toContain('3F 版牆混凝土查驗（部分合格）')
    expect(src.textContent).toContain('簽署 王監造')
    expect(src.textContent).toContain('檢附自主檢查：2026-09-09 Rev.0（合格）・文件 sc-1 v1')
    expect(src.textContent).toContain('缺件：缺監造確認來源')
    // 查驗表單在活文件清單、v2 是它目前的簽署版本 → 可直達列印
    expect(src.querySelector('a[href="/inspection-form/print?doc=form-1"]')).not.toBeNull()
    // 明細的「依據」欄:確認量或缺件,不是照片張數
    expect(text()).toContain('監造確認 60')
    // 照片只取簽署查驗表單的附件
    expect(container.querySelectorAll('figure')).toHaveLength(1)
    expect(state.store.listPhotosByIds).toHaveBeenCalledWith(['p1'])
  })
  it('已送審:施工日誌取送審時點以前的已簽署版本(送審後更正不影響);未簽署的揭露件數', async () => {
    await render()
    expect(text()).toContain('本期已送審：施工日誌取送審時點（2026-10-02 08:00）以前已簽署的版本')
    expect(text()).toContain('3F 版牆澆置')
    expect(text()).toContain('40 M3') // 版本 v1 的 40,不是事實列(送審後 v2)的 45
    expect(text()).not.toContain('45 M3')
    expect(text()).toContain(`文件 d5 v1・雜湊 ${'e'.repeat(12)}`)
    expect(text()).toContain('之後另有 v2')
    expect(text()).toContain('本期範圍內另有 1 日的施工日誌送審時尚未簽署，不列入（2026-09-07）')
  })
  it('證據讀取失敗:整包不產生佐證內容(不以半份資料冒充)', async () => {
    state.store.fetchValuationState = vi.fn(async () => ({ state: null, error: { message: 'VQ008 無權存取' } }))
    await render()
    expect(text()).toContain('本期證據讀取失敗，不產生佐證內容：VQ008 無權存取')
    expect(container.querySelectorAll('figure')).toHaveLength(0)
  })
})
