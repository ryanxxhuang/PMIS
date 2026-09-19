// @vitest-environment jsdom
// P6a:施工月報與監造月報只彙整「已簽署」版本——兩份已簽署日誌＋一份未簽署 → 只彙整兩份、未簽署的明列不列入;
// 每一項可回溯到文件版本;簽署狀態讀不到時不出日誌類數字(讀取失敗≠全部未簽署)。定位只走 aria-label 與文字。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import MonthlyReport from './MonthlyReport.jsx'
import SupervisorReport from './SupervisorReport.jsx'

let container, root
const items = [
  { id: 'wi-a', item_key: 'A', parent_key: null, item_no: '1', description: '結構混凝土', unit: 'M3', quantity: 100, unit_price: 1000, amount: 100000, is_billable: true, is_leaf: true, is_rollup: false },
]
const sig = (target, docType, date, v = 1) => ({
  id: `sig-${target}`, document_id: `DOC-${target}-0000`, doc_type: docType, doc_date: date, doc_status: 'submitted', target_id: target,
  version_no: v, content_hash: `${v}abcdef`.repeat(10) + 'abcd', signer_name_snapshot: '簽署者', signed_at: `${date}T09:00:00+00:00`,
})
const signedRows = {
  daily_log: [sig('LA', 'daily_log', '2026-09-02'), sig('LB', 'daily_log', '2026-09-03', 2)],
  supervisor_log: [sig('SA', 'supervisor_log', '2026-09-02')],
  inspection_form: [sig('IA', 'inspection_form', '2026-09-03', 2)],
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 16, 10, 0, 0)) // 今天 2026-09-16
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  state.store = {
    project: { project_name: '測試案', owner_name: '機關', contractor_name: '廠商', supervisor_name: '監造' },
    workItems: { items, meta: { billable_total: 100000 } }, adjustedItems: items, revisedTotal: 100000,
    dbMode: true, demoMode: false, workItemsSource: 'db',
    valuations: [], progressPlan: null, safetyRecords: [], changeOrders: [], submittals: [], defects: [],
    siteLogs: [
      { id: 'LA', log_date: '2026-09-02', weather_am: '晴', labor: [{ type: '鋼筋工', count: 6 }], work_summary: '3F 版牆澆置', items: { A: 10 } },
      { id: 'LB', log_date: '2026-09-03', weather_pm: '陣雨', labor: [{ type: '鋼筋工', count: 4 }], work_summary: '3F 版牆養護', items: { A: 20 } },
      { id: 'LC', log_date: '2026-09-04', weather_am: '雨', labor: [{ type: '雜工', count: 9 }], work_summary: '未簽署內容', items: { A: 999 } },
    ],
    inspections: [
      { id: 'IA', status: '部分合格', title: '3F 版牆混凝土查驗', requested_date: '2026-09-03', inspected_at: '2026-09-03T02:00:00Z', document_id: 'DOC-IA-0000', document_version_no: 2, declared_qty: 100, confirmed_qty: 60, unit: 'M3' },
      { id: 'IQ', status: '合格', title: '快速判定查驗', requested_date: '2026-09-05', inspected_at: '2026-09-05T02:00:00Z' },
    ],
    draftMonthlyReview: vi.fn(), aiEnabled: () => false,
    currentUser: { org_type: 'supervisor' }, can: {}, isPlatformAdmin: false,
    fieldDocuments: { documents: [{ id: 'DOC-LB-0000', doc_type: 'daily_log', doc_date: '2026-09-03', status: 'submitted' }], submissions: [] },
    listSignedVersions: vi.fn(async (t) => ({ rows: signedRows[t] || [], error: null })),
    listSupervisorLogs: vi.fn(async () => ({ rows: [
      { id: 'SA', log_date: '2026-09-02', attendance: [{ name: '王監造' }], supervision_items: [{ item: '版牆查驗' }], inspection_ids: ['IA'] },
      { id: 'SB', log_date: '2026-09-05', attendance: [{ name: '王監造' }] },
    ], error: null })),
    fetchConfirmations: vi.fn(async () => ({ rows: [
      { id: 'C1', work_item_id: 'wi-a', batch_key: '3f版牆', location_label: '3F 版牆', unit: 'M3', qty_cum: 60, qty_delta: 60, basis: 'inspection',
        inspection_id: 'IA', document_id: 'DOC-IA-0000', document_version_no: 2, content_hash: 'c'.repeat(64), status: 'active', confirmed_at: '2026-09-03T02:00:00Z' },
    ], error: null })),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  delete window.matchMedia
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

const render = (Page) => act(async () => { root.render(<MemoryRouter><Page /></MemoryRouter>) })
const text = () => container.textContent
const list = (name) => container.querySelector(`[aria-label="${name}"]`)

describe('施工月報(P6a)', () => {
  it('兩份已簽署＋一份未簽署:數量、出工、天數只彙整已簽署兩份;未簽署明列不列入;每份附版本', async () => {
    await render(MonthlyReport)
    expect(container.querySelector('h1').textContent).toBe('施工月報')
    expect(text()).toContain('施工天數（已簽署日誌）：2 天')
    expect(text()).toContain('雨天：1 天') // LB 下午陣雨;LC 下雨但未簽署
    expect(text()).toContain('出工合計：10 人・日')
    expect(text()).toContain('累計 30 / 契約 100') // 手機清單:本月 10+20,999 不列入
    expect(text()).not.toContain('999')
    const signed = list('已簽署施工日誌')
    expect(signed.querySelectorAll('li')).toHaveLength(2)
    expect(signed.textContent).toContain('文件 DOC-LA-0 v1・雜湊')
    // LB 的文件在活文件清單且是目前列印版本 → 可直達列印;LA 不在活文件清單 → 只印版本標示
    expect(signed.querySelector('a').getAttribute('href')).toBe('/site-log/print?doc=DOC-LB-0000')
    expect(list('未簽署、不列入').textContent).toContain('2026-09-04（舊流程紀錄，無簽署版本）')
    // 查驗判定只列經簽署表單者;快速判定明列不列入
    expect(text()).toContain('簽署表單判定 合格 / 部分合格 / 不合格：0 / 1 / 0')
    expect(text()).toContain('判定未經簽署查驗表單、不列入：1 件（快速判定查驗）')
  })
  it('簽署狀態讀不到:日誌類段落不出數字,也不把事實列當已簽署', async () => {
    state.store.listSignedVersions = vi.fn(async () => ({ rows: [], error: { message: '網路中斷' } }))
    await render(MonthlyReport)
    expect(text()).toContain('無法確認施工日誌與查驗表單的簽署狀態，本段暫不彙整：網路中斷')
    expect(text()).not.toContain('施工天數（已簽署日誌）')
  })
})

describe('監造月報(P6a)', () => {
  it('標題取 navConfig;列已簽署監造日誌、經簽署表單的判定與確認量(附版本);未簽署與快速判定不列入', async () => {
    await render(SupervisorReport)
    expect(container.querySelector('h1').textContent).toBe('監造月報')
    expect(list('已簽署監造日誌').textContent).toContain('到場 王監造')
    expect(list('已簽署監造日誌').textContent).toContain('文件 DOC-SA-0 v1')
    expect(list('未簽署監造日誌').textContent).toContain('2026-09-05（未經文件簽署）')
    const judged = list('已簽署查驗表單判定')
    expect(judged.textContent).toContain('3F 版牆混凝土查驗')
    expect(judged.textContent).toContain('申報 100／確認 60 M3')
    expect(judged.textContent).toContain('文件 DOC-IA-0 v2')
    expect(list('未經簽署查驗表單之判定').textContent).toContain('快速判定查驗（合格）')
    const conf = list('本月監造確認紀錄')
    expect(conf.textContent).toContain('1 結構混凝土・批次 3F 版牆')
    expect(conf.textContent).toContain('+60 M3（累計 60）')
    expect(conf.textContent).toContain(`文件 DOC-IA-0 v2・雜湊 ${'c'.repeat(12)}`)
    expect(text()).toContain('本月已簽署施工日誌 2 日（雨天 1 日）；另 1 日未簽署、不列入')
    expect(container.querySelector('textarea[aria-label="監造意見與建議"]').value).toContain('本月已簽署監造日誌 1 份（監造到場 1 日），另 1 份未簽署、不列入')
  })
  it('監造日誌讀不到:該段顯示讀取失敗,意見草稿不產生', async () => {
    state.store.listSupervisorLogs = vi.fn(async () => ({ rows: [], error: { message: 'permission denied' } }))
    await render(SupervisorReport)
    expect(text()).toContain('已簽署監造日誌讀取失敗，本段暫不彙整：')
    expect(text()).not.toContain('permission denied') // 原始英文錯誤不外洩(friendlyError)
    expect(container.querySelector('textarea[aria-label="監造意見與建議"]').value).toBe('')
  })
})
