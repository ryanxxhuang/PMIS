// @vitest-environment jsdom
// 進度口徑(D-024,W07):施工月報與監造報表同一個報告月份要拿到同一天、同一期的數字;
// 過去月份截至月底,本月截至今天;未來日期的估驗期不算;報表上寫明截止日與所取期別;
// 月報的收款／請款期數也截至截止日(C4)。定位只走 aria-label 與文字。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import MonthlyReport from './MonthlyReport.jsx'
import SupervisorReport from './SupervisorReport.jsx'

let container, root
const items = [{ item_key: 'A', parent_key: null, item_no: '1', description: '工項A', unit: 'm', quantity: 100, unit_price: 1000, amount: 100000, is_billable: true, is_leaf: true, is_rollup: false }]
const valuations = [
  // amounts = DB 的 amount_cum(P4c 起前端不換算金額):A 單價 1000
  { id: 'V1', period_no: 1, valuation_date: '2026-07-25', status: '已核定', items: { A: 30 }, amounts: { A: 30000 }, invoice_date: '2026-08-05', paid_date: '2026-08-28', paid_amount: 28500 },
  { id: 'V2', period_no: 2, valuation_date: '2026-08-25', status: '已核定', items: { A: 50 }, amounts: { A: 50000 }, invoice_date: '2026-09-05', paid_date: '2026-09-28', paid_amount: 19000 },
  { id: 'V3', period_no: 3, valuation_date: '2026-09-10', status: '監造審核', items: { A: 60 }, amounts: { A: 60000 } },
  { id: 'V4', period_no: 4, valuation_date: '2026-09-25', status: '草稿', items: { A: 70 }, amounts: { A: 70000 } }, // 估驗日期在今天之後
]
// 各列=該月底累計:8 月底 20%、9 月底 30% → 9/16 內插 20 + 10 × 16/30 ≈ 25.3%
const progressPlan = { start: '2026-04-15', end: '2026-12-31', months: [2, 5, 10, 15, 20, 30, 40, 60, 100].map((plannedPct, i) => ({ label: `2026-${String(i + 4).padStart(2, '0')}`, plannedPct })) }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 16, 10, 0, 0)) // 今天 2026-09-16
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  state.store = {
    project: { project_name: '測試案', owner_name: '機關', contractor_name: '廠商', supervisor_name: '監造' },
    workItems: { items, meta: { billable_total: 100000 } }, adjustedItems: items, revisedTotal: 100000,
    dbMode: false, demoMode: true, workItemsSource: 'demo',
    valuations, progressPlan, siteLogs: [], inspections: [], defects: [], safetyRecords: [], changeOrders: [], submittals: [],
    draftMonthlyReview: vi.fn(), aiEnabled: () => false,
    currentUser: { org_type: 'supervisor' }, can: {}, isPlatformAdmin: false,
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
const setMonth = (label, value) => act(async () => {
  const el = container.querySelector(`input[aria-label="${label}"]`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const text = () => container.textContent

describe('施工月報', () => {
  it('本月截至今天:取第 3 期(不算未來日期的第 4 期)、預定按日內插,收款／請款截至今天', async () => {
    await render(MonthlyReport)
    expect(text()).toContain('累計預定進度25.3%')
    expect(text()).toContain('累計實際進度60.0%第 3 期（監造審核）')
    expect(text()).toContain('統計截止日 2026-09-16（本月尚未結束，以今天為準）')
    expect(text()).toContain('含尚未核定的期別')
    expect(text()).toContain('累計已收款（截至 2026-09-16）：NT$ 28,500') // 9/28 的收款不算
    expect(text()).toContain('已請款期數（截至 2026-09-16）：2 期')
  })
  it('過去月份截至月底:取第 2 期、預定 = 該月列值,不標「尚未結束」', async () => {
    await render(MonthlyReport)
    await setMonth('月報月份', '2026-08')
    expect(text()).toContain('累計預定進度20.0%')
    expect(text()).toContain('累計實際進度50.0%第 2 期（已核定）')
    expect(text()).toContain('統計截止日 2026-08-31。')
    expect(text()).toContain('已請款期數（截至 2026-08-31）：1 期')
  })
})

describe('監造報表', () => {
  it('同一報告月份與施工月報同一天、同一期;意見草稿寫明截至何日', async () => {
    await render(SupervisorReport)
    expect(text()).toContain('累計實際 60.0%')
    expect(text()).toContain('累計預定 25.3%')
    expect(text()).toContain('統計截止日 2026-09-16（本月尚未結束，以今天為準）；累計實際取 第 3 期（監造審核）')
    expect(text()).toContain('截至 2026-09-16 累計實際進度 60.0%')
  })
  it('換到過去月份,進度跟著回看月底(不再永遠是今天)', async () => {
    await render(SupervisorReport)
    await setMonth('報表月份', '2026-08')
    expect(text()).toContain('累計實際 50.0%')
    expect(text()).toContain('累計預定 20.0%')
    expect(text()).toContain('統計截止日 2026-08-31；累計實際取 第 2 期（已核定）')
    expect(text()).not.toContain('尚未結束')
  })
})
