// @vitest-environment jsdom
// P5d:履約時程承接關鍵工項與停留點、待補設定篩選、近期／全期、逐期就地標記——釘頁面把 lib 的推導接對了沒:
//   ① 關鍵工項與停留點列在同一條時間軸(全期),廠商在詳情維護計畫起迄、其他角色唯讀;
//   ② 待補設定可依種類篩選且詳情有處理入口;
//   ③ 循環義務逐期在本頁標記完成(走 store 的 transitionObligationPeriod),不再導到期限追蹤。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../lib/supabase.js', () => ({ isSupabaseConfigured: false, supabase: null }))
vi.mock('../../components/confirm.jsx', () => ({ appConfirm: async () => true }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Requirements from './Requirements.jsx'

const iso = (d) => d.toISOString().slice(0, 10)
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d }

let container, root
const items = [
  { item_key: 'A', item_no: '1.1', description: '鋼筋', unit: 'T', quantity: 100, is_billable: true },
  { item_key: 'B', item_no: '1.2', description: '模板', unit: 'M2', quantity: 200, is_billable: true },
]
function baseStore(org) {
  return {
    currentProject: { project_id: 'demo' }, project: { commencement_date: iso(daysFromNow(-120)), end_date: iso(daysFromNow(240)) },
    isPersistedProject: false, dbMode: false, demoMode: true,
    currentUser: { org_type: org },
    can: { write: org !== 'owner', edit: org === 'contractor', override: false },
    workItems: { items }, adjustedItems: items, valuations: [{ items: { A: 40 } }],
    itemSchedules: { A: { planned_start: iso(daysFromNow(-60)), planned_finish: iso(daysFromNow(-10)) } },
    inspectionPoints: [{ id: 'P1', point_type: 'H', title: '鋼筋停留點', work_item_key: 'A', work_item_no: '1.1', work_item_desc: '鋼筋', inspection_id: null }],
    inspections: [], siteLogs: [{ items: { A: 3 } }],
    obligations: [
      { id: 'OB-1', title: '提送施工計畫書', category: '開工前', trigger_event: 'fixed', fixed_date: iso(daysFromNow(-2)), responsible: '廠商', status: '待辦' },
      { id: 'OB-2', title: '責任不明的義務', category: '施工中', trigger_event: 'fixed', fixed_date: iso(daysFromNow(3)), responsible: '設計單位', status: '待辦' },
      { id: 'OB-3', title: '提送施工月報', category: '施工中', recurring: 'monthly', recurring_day: 5, responsible: '廠商', status: '待辦',
        periods: [{ id: 'OB-3-p1', obligation_id: 'OB-3', period_key: '2026-08', due_date: iso(daysFromNow(-20)), status: '待辦', anchor_version_no: 1, basis: { anchor_key: 'commencement_date', anchor_date: '2026-03-01' } }] },
    ],
    submittals: [{ id: 'S1', title: '八月月報' }], anchorVersions: [], acceptanceEvents: [],
    updateObligationStatus: vi.fn(async () => ({ error: null })),
    transitionObligationPeriod: vi.fn(async () => ({ error: null })),
    setItemSchedule: vi.fn(async () => ({ error: null })), removeItemSchedule: vi.fn(async () => ({ error: null })),
    createObservation: vi.fn(), changeProjectAnchors: vi.fn(), reloadObligations: vi.fn(),
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
  vi.unstubAllGlobals()
})

async function render(path = '/requirements') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Requirements /></MemoryRouter>) })
}
const list = () => container.querySelector('[aria-label="履約義務時間軸"]')
const rowByText = (text) => [...list().querySelectorAll('[role="listitem"]')].find((li) => li.textContent.includes(text))
const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
async function click(el) { expect(el).toBeTruthy(); await act(async () => el.click()) }
async function setValue(el, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}

describe('關鍵工項與停留點併入履約時程(P5d)', () => {
  it('落後的關鍵工項與施作中未叫驗的停留點列在近期;摘要卡有件數;廠商在詳情維護計畫起迄', async () => {
    state.store = baseStore('contractor')
    await render()
    const card = [...container.querySelectorAll('[role="group"]')].find((g) => g.textContent.includes('關鍵工項與停留點'))
    expect(card.textContent).toContain('關鍵工項 1 項')
    expect(card.textContent).toContain('停留點 1 個')
    expect(card.querySelector('input[aria-label="加入關鍵工項"]')).toBeTruthy()
    // 近期視圖:落後工項與該叫驗的停留點都在(進行中／逾期算近期);預設選中仍是契約義務裡最逾期的
    // (循環義務逾期 20 天的那一期),關鍵工項雖然更早也不搶第一眼
    const wi = rowByText('1.1 鋼筋')
    expect(wi).toBeTruthy()
    expect(wi.textContent).toContain('關鍵工項')
    expect(wi.textContent).toContain('落後')
    const hp = rowByText('鋼筋停留點')
    expect(hp.textContent).toContain('施作中未申請查驗')
    expect(rowByText('提送施工月報').getAttribute('aria-current')).toBe('true')
    expect(wi.getAttribute('aria-current')).toBeNull()
    // 點關鍵工項 → 詳情:計畫起迄可改(廠商)、寫入走 store 的 setItemSchedule 只送變動的單欄
    await click(wi)
    const detail = container.querySelector('input[type="date"]')
    expect(detail).toBeTruthy()
    await setValue(detail, iso(daysFromNow(-30)))
    expect(state.store.setItemSchedule).toHaveBeenCalledWith('A', { planned_start: iso(daysFromNow(-30)) })
    expect(container.textContent).toContain('完成% = 最新一期估驗')
    await click(button('移除關鍵工項'))
    expect(state.store.removeItemSchedule).toHaveBeenCalledWith('A')
  })
  it('監造:關鍵工項唯讀(沒有日期輸入、沒有加入入口),停留點詳情導到檢驗停留點', async () => {
    state.store = baseStore('supervisor')
    await render()
    expect(container.querySelector('input[aria-label="加入關鍵工項"]')).toBeNull()
    await click(rowByText('1.1 鋼筋'))
    expect(container.querySelector('input[type="date"]')).toBeNull()
    expect(container.textContent).toContain('廠商的內部規劃,本頁為唯讀檢視')
    await click(rowByText('鋼筋停留點'))
    expect(container.querySelector('a[href="/itp?point=P1"]')).toBeTruthy()
    expect(container.textContent).toContain('停留點未經監造查驗不得續作')
  })
  it('?item=<key> 直達那一項關鍵工項(退場的 /schedule 的替代深連結)', async () => {
    state.store = baseStore('contractor')
    await render('/requirements?item=A')
    expect(rowByText('1.1 鋼筋').getAttribute('aria-current')).toBe('true')
    expect(container.querySelector('input[type="date"]')).toBeTruthy()
  })
})

describe('待補設定與近期／全期', () => {
  it('待補設定下拉可依種類篩選;責任不明的義務詳情有擷取審核入口,三方都不能標記', async () => {
    state.store = baseStore('owner')
    await render()
    const select = container.querySelector('select[aria-label="待補設定"]')
    expect(select.textContent).toContain('責任方待補（1）')
    expect(select.textContent).toContain('基準日待補（0）')
    await setValue(select, 'responsible')
    const rows = [...list().querySelectorAll('[role="listitem"]')]
    expect(rows.map((r) => r.textContent.includes('責任不明的義務'))).toEqual([true])
    expect(rows[0].textContent).toContain('待補設定')
    await click(rows[0])
    expect(container.querySelector('a[href="/requirements/review?highlight=OB-2"]')).toBeTruthy()
    expect(container.textContent).toContain('三方都無法標記')
    expect(button('標記完成')).toBeUndefined()
  })
  it('近期預設只列該處理的;切到全期依期程分段列全部;清單為空時退回全期', async () => {
    state.store = baseStore('contractor')
    state.store.obligations.push({ id: 'OB-far', title: '一年後的保固義務', category: '保固', trigger_event: 'fixed', fixed_date: iso(daysFromNow(400)), responsible: '廠商', status: '待辦' })
    await render()
    expect(rowByText('一年後的保固義務')).toBeUndefined()
    const tabs = container.querySelector('[aria-label="時程範圍"]')
    await click([...tabs.querySelectorAll('[role="tab"]')].find((t) => t.textContent.startsWith('全期')))
    expect(rowByText('一年後的保固義務')).toBeTruthy()
    expect(list().textContent).toContain('保固期')
    // 全部都不是近期 → 自動落到全期,不給一張空清單
    state.store = { ...baseStore('contractor'), itemSchedules: {}, inspectionPoints: [], obligations: [{ id: 'OB-far', title: '一年後的保固義務', category: '保固', trigger_event: 'fixed', fixed_date: iso(daysFromNow(400)), responsible: '廠商', status: '待辦' }] }
    await act(async () => root.unmount())
    root = createRoot(container)
    await render()
    expect(rowByText('一年後的保固義務')).toBeTruthy()
    expect(container.querySelector('[aria-label="時程範圍"] [aria-selected="true"]').textContent).toContain('全期')
  })
})

describe('循環義務逐期就地標記', () => {
  it('廠商對本期標記完成(可掛佐證)走 transitionObligationPeriod;逐期準時率在期次區', async () => {
    state.store = baseStore('contractor')
    await render()
    await click(rowByText('提送施工月報'))
    expect(button('到期限追蹤逐期標記')).toBeUndefined()
    await click(button('標記 2026-08 期完成'))
    const picker = container.querySelector('select[aria-label="2026-08 期佐證送審文件"]')
    await setValue(picker, 'S1')
    await click(button('掛佐證並標記完成'))
    expect(state.store.transitionObligationPeriod).toHaveBeenCalledWith('OB-3', 'OB-3-p1', '已完成', { evidence_submittal_id: 'S1' })
    expect(container.textContent).toContain('逐期準時率')
  })
  it('機關看廠商的循環義務:期次唯讀、沒有標記鈕', async () => {
    state.store = baseStore('owner')
    await render()
    await click(rowByText('提送施工月報'))
    expect(container.textContent).toContain('2026-08 期')
    expect(button('標記 2026-08 期完成')).toBeUndefined()
    expect(container.textContent).toContain('由廠商負責執行')
  })
})
