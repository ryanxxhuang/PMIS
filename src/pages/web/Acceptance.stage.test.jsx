// @vitest-environment jsdom
// 驗收當前階段與下一步(UIUX 階段 5C):
// - 「目前階段」卡:當前關、可登錄者、前置、依據、我的下一步(能登錄 / 等待誰);
// - 待辦深連結 ?stage=:指到當前階段就定位(aria-current=step);已完成／未輪到／不存在都只說明實際狀態,
//   不在別的階段開編輯;
// - 登錄前有核對句(不替人預選合格);登錄成功後留下結果與下一階段。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Acceptance from './Acceptance.jsx'

let container, root
const events = [
  { stage_key: 'report', event_date: '2026-08-18' },
  { stage_key: 'confirm', event_date: '2026-08-21', note: '會同監造、廠商核對完工項目數量' },
]

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {}
  state.store = {
    acceptanceEvents: events, recordAcceptanceEvent: vi.fn(), clearAcceptanceEvent: vi.fn(),
    demoMode: false, isPersistedProject: true, project: { project_name: 'B 區道路改善工程' },
    currentUser: { org_type: 'owner' }, can: { override: false }, isPlatformAdmin: false,
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
const render = (entry = '/acceptance') => act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><Acceptance /></MemoryRouter>) })
const text = () => container.textContent
const statuses = () => [...container.querySelectorAll('[role="status"]')].map((n) => n.textContent).join(' | ')
const currentLi = () => container.querySelector('li[aria-current="step"]')
const setInput = (el, value) => act(async () => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
})

describe('目前階段與深連結', () => {
  it('機關進初驗:目前階段卡列可登錄者、前置與下一步;?stage=initial 定位到該列且無提示', async () => {
    await render('/acceptance?stage=initial')
    expect(text()).toContain('目前階段')
    expect(text()).toContain('可登錄者機關')
    expect(text()).toContain('前置竣工確認會勘 已於 2026-08-21 完成')
    expect(text()).toContain('你的下一步：在下方「初驗」登錄實際辦理日與結果（合格／不合格需明選）')
    expect(currentLi()?.id).toBe('stage-initial')
    expect(statuses()).not.toContain('指定的階段')
    // 未到的階段不混入當前操作:正式驗收列沒有輸入框
    expect(container.querySelector('#stage-final input')).toBeNull()
    expect(container.querySelector('#stage-initial input[type="date"]')).toBeTruthy()
  })

  it('深連結到已完成／未輪到／不存在的階段:只說明實際狀態,不在別的階段開編輯', async () => {
    await render('/acceptance?stage=report')
    expect(statuses()).toContain('指定的階段「竣工申報（報竣）」已於 2026-08-18 登錄完成；目前階段是「初驗」')
    expect(container.querySelector('#stage-report input')).toBeNull()
    await act(async () => root.unmount()); root = createRoot(container)
    await render('/acceptance?stage=final')
    expect(statuses()).toContain('指定的階段「正式驗收」尚未輪到；目前階段是「初驗」')
    expect(container.querySelector('#stage-final input')).toBeNull()
    await act(async () => root.unmount()); root = createRoot(container)
    await render('/acceptance?stage=bogus')
    expect(statuses()).toContain('找不到指定的驗收階段「bogus」；目前階段是「初驗」')
  })

  it('監造看初驗:下一步是等待機關,該列沒有登錄鈕;廠商在報竣階段有登錄', async () => {
    state.store = { ...state.store, currentUser: { org_type: 'supervisor' } }
    await render()
    expect(text()).toContain('你的下一步：等待機關登錄')
    expect(container.querySelector('#stage-initial input')).toBeNull()
    expect(text()).toContain('由機關(主驗)登錄')
    await act(async () => root.unmount()); root = createRoot(container)
    state.store = { ...state.store, currentUser: { org_type: 'contractor' }, acceptanceEvents: [] }
    await render()
    expect(text()).toContain('竣工申報（報竣）')
    expect(text()).toContain('前置無（第一階段）')
    expect(text()).toContain('你的下一步：在下方「竣工申報（報竣）」登錄實際辦理日')
    expect(container.querySelector('#stage-report input[type="date"]')).toBeTruthy()
  })

  it('核對句與登錄成功後的下一階段;不合格仍展開缺失改善／複驗', async () => {
    state.store.recordAcceptanceEvent.mockImplementation(async (key, patch) => {
      state.store = { ...state.store, acceptanceEvents: [...state.store.acceptanceEvents, { stage_key: key, ...patch }] }
      return { error: null }
    })
    await render()
    const dateInput = container.querySelector('#stage-initial-date')
    await setInput(dateInput, '2026-09-19')
    expect(text()).toContain('將登錄：初驗 · 2026-09-19 · （尚未選結果）')
    await setInput(container.querySelector('select[aria-label="初驗 結果"]'), '不合格')
    expect(text()).toContain('將登錄：初驗 · 2026-09-19 · 不合格')
    const save = [...container.querySelector('#stage-initial').querySelectorAll('button')].find((b) => b.textContent.trim() === '登錄')
    await act(async () => save.click())
    expect(state.store.recordAcceptanceEvent).toHaveBeenCalledWith('initial', expect.objectContaining({ event_date: '2026-09-19', result: '不合格' }))
    await render()
    expect(statuses()).toContain('已登錄 初驗 2026-09-19 不合格；下一階段：缺失改善（廠商）')
    expect(currentLi()?.id).toBe('stage-fix')
    expect(text()).toContain('複驗')
  })
})
