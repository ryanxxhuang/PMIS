// @vitest-environment jsdom
// 提醒中心篩選保存在 URL(UIUX 階段 2 U11):從單據返回時「前往處理」帶的是 pathname+search,
// 篩選不進 URL 就會遺失。這裡釘:輸入關鍵字與點期限類別會寫進 ?q=/?bucket=,
// 「清除篩選」會把兩個參數一起刪掉,而選取用的 ?alert= 不受影響。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Alerts from './Alerts.jsx'

function LocationSpy() {
  const { search } = useLocation()
  return <output data-testid="search">{search}</output>
}

let container, root
const rfi = { id: 'R1', rfi_no: 'RFI-001', title: '樑柱衝突', status: '待回覆', asked_date: '2026-09-01', due_date: '2026-09-10' }
const rfi2 = { id: 'R2', rfi_no: 'RFI-002', title: '套管位置', status: '待回覆', asked_date: '2026-09-14', due_date: '2026-12-31' }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  state.store = {
    currentProject: { project_id: 'p1' }, isSupabaseConfigured: false, currentUser: { org_type: 'supervisor' },
    project: {}, rfis: [rfi, rfi2], submittals: [], valuations: [], defects: [], inspections: [], observations: [],
    changeOrders: [], obligations: [], testSamples: [], acceptanceEvents: [], inspectionPoints: [], siteLogs: [],
    can: {}, aiEnabled: () => false, isPlatformAdmin: false,
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.matchMedia
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = () => act(async () => {
  root.render(<MemoryRouter initialEntries={['/alerts']}><Alerts /><LocationSpy /></MemoryRouter>)
})
const search = () => new URLSearchParams(container.querySelector('[data-testid="search"]').textContent)
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(name))
const type = (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('提醒中心篩選進 URL', () => {
  it('關鍵字與期限類別寫進 ?q= 與 ?bucket=,清除篩選一起刪掉', async () => {
    await render()
    await type(container.querySelector('input[aria-label="搜尋提醒"]'), '套管')
    expect(search().get('q')).toBe('套管')
    await act(async () => button('逾期').click())
    expect(search().get('bucket')).toBe('overdue')
    expect(search().get('q')).toBe('套管')
    await act(async () => button('清除篩選').click())
    expect(search().get('q')).toBeNull()
    expect(search().get('bucket')).toBeNull()
  })

  it('從帶篩選的網址進頁:清單只列符合的一筆,搜尋欄回填關鍵字', async () => {
    await act(async () => { root.render(<MemoryRouter initialEntries={['/alerts?q=套管']}><Alerts /><LocationSpy /></MemoryRouter>) })
    expect(container.querySelector('input[aria-label="搜尋提醒"]').value).toBe('套管')
    const items = container.querySelectorAll('[role="list"][aria-label="提醒清單"] [role="listitem"]')
    expect(items.length).toBe(1)
    expect(items[0].textContent).toContain('RFI-002')
  })
})
