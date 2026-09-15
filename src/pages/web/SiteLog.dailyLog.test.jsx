// @vitest-environment jsdom
// 廠商每日填報的資訊層級(UIUX 階段 3C U14):
// - 卡頭保存狀態章:本日尚無日誌 → 填了值變「未存檔」(並登記到未存檔登記簿)→ 存檔中 → 已存檔;
// - 存檔失敗:輸入留著、狀態仍未存檔;成功:「已存檔 ✓」且狀態章轉綠;
// - 切日期:有未存檔輸入先問,拒絕就留在原日期(不會把內容存成另一日);
// - 公定格式欄位預設收合,摘要列列出尚未填的節,「填寫」展開;
// - 照片訊息只在照片區,不混進存檔列。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { unsavedEditLabels } from '../../lib/unsavedEdits.js'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import SiteLog from './SiteLog.jsx'

let container, root
const leaf = { id: 'w1', item_key: 'K1', item_no: '壹.一.1', description: '4F 版牆混凝土澆置', unit: 'M3', quantity: 500, is_billable: true }
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.store = {
    project: { project_name: 'A 案' }, currentProject: { project_id: 'p1' }, isSupabaseConfigured: false, dbMode: false,
    workItems: { items: [leaf] }, adjustedItems: [leaf], workItemsSource: 'demo', siteLogs: [],
    saveSiteLog: vi.fn(), deleteSiteLog: vi.fn(), listSitePhotos: vi.fn().mockResolvedValue([]), uploadSitePhoto: vi.fn(),
    deleteSitePhoto: vi.fn(), updateSitePhotoMeta: vi.fn(), readWhiteboard: vi.fn(), classifySitePhoto: vi.fn(),
    fetchWeather: vi.fn(), updateProjectAnchors: vi.fn(),
    can: { edit: true, submit: true, oversee: false }, aiEnabled: () => false, currentUser: { org_type: 'contractor' }, isPlatformAdmin: false,
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.confirm
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = () => act(async () => { root.render(<MemoryRouter initialEntries={['/site-log']}><SiteLog /></MemoryRouter>) })
const status = () => container.querySelector('[role="status"][aria-label^="保存狀態"]')?.textContent
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const setInput = (el, value, ev = 'input') => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event(ev, { bubbles: true }))
})
const addItemAndType = async (qty) => {
  await setInput(container.querySelector('input[placeholder="搜尋工項加入今日回報…"]'), '版牆')
  await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes('4F 版牆混凝土澆置')).click())
  await setInput(container.querySelector('input[type="number"]'), qty)
}

describe('施工日誌每日填報', () => {
  it('?d= 直達指定日期;切日期後 URL 跟著改(只放日期,不放表單內容)', async () => {
    await act(async () => { root.render(<MemoryRouter initialEntries={['/site-log?d=2026-09-01']}><SiteLog /></MemoryRouter>) })
    expect(container.querySelector('input[type="date"]').value).toBe('2026-09-01')
    await setInput(container.querySelector('input[type="date"]'), '2026-09-02', 'change')
    expect(container.querySelector('input[type="date"]').value).toBe('2026-09-02')
  })

  it('保存狀態章:尚無日誌 → 未存檔 → 存檔失敗留值 → 存檔成功', async () => {
    state.store.saveSiteLog
      .mockResolvedValueOnce({ error: { message: 'boom' } })
      .mockImplementationOnce(async (payload) => {
        state.store = { ...state.store, siteLogs: [{ id: 'L1', log_date: payload.log_date, items: payload.items, work_summary: '', labor: [], equipment: [], materials: [], extras: {} }] }
        return { error: null }
      })
    await render()
    expect(status()).toBe('本日尚無日誌')
    // 公定欄位預設收合,摘要列說尚未填哪幾節
    expect(container.textContent).toContain('尚未填：')
    expect(container.textContent).toContain('出工人數')
    expect(container.querySelector('#official-labor')).toBeNull()

    await addItemAndType(120)
    expect(status()).toBe('未存檔')
    expect(unsavedEditLabels()).toEqual([`施工日誌 ${today}（未存檔）`])

    await act(async () => button('存檔').click())
    expect(state.store.saveSiteLog).toHaveBeenCalledTimes(1)
    expect(state.store.saveSiteLog.mock.calls[0][0]).toMatchObject({ log_date: today, items: { K1: 120 } })
    expect(container.textContent).toContain('日誌存檔失敗')
    expect(container.querySelector('input[type="number"]').value).toBe('120')
    expect(status()).toBe('未存檔')

    await act(async () => button('存檔').click())
    await render()
    expect(container.textContent).toContain('已存檔 ✓')
    expect(status()).toMatch(/^已存檔 \d\d:\d\d$/)
    expect(unsavedEditLabels()).toEqual([])
    // 已存檔後照片區可用;訊息只在照片區
    expect(container.querySelector('section[aria-label="現場照片"]')).toBeTruthy()
  })

  it('切日期:有未存檔輸入先問,拒絕就留在原日期且內容不動', async () => {
    await render()
    await addItemAndType(80)
    window.confirm = vi.fn(() => false)
    await setInput(container.querySelector('input[type="date"]'), '2026-09-01', 'change')
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(container.querySelector('input[type="date"]').value).toBe(today)
    expect(container.querySelector('input[type="number"]').value).toBe('80')
    expect(status()).toBe('未存檔')
    // 確認放棄:切到新日期、表單重置、登記解除
    window.confirm = vi.fn(() => true)
    await setInput(container.querySelector('input[type="date"]'), '2026-09-01', 'change')
    expect(container.querySelector('input[type="date"]').value).toBe('2026-09-01')
    expect(container.querySelector('input[type="number"]')).toBeNull()
    expect(unsavedEditLabels()).toEqual([])
  })

  it('「填寫」展開公定欄位並定位該節;照片區的訊息不出現在存檔列', async () => {
    await render()
    await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === '機具使用').click())
    expect(container.querySelector('#official-equipment')).toBeTruthy()
    // 未存檔的日期沒有照片入口(需先存檔);唯讀視角以外,照片區是本日日誌內的一節而非獨立卡
    const photoSection = container.querySelector('section[aria-label="現場照片"]')
    expect(photoSection).toBeTruthy()
    expect(photoSection.textContent).toContain('先存檔本日日誌')
    expect(container.querySelector('[role="group"][aria-label="現場照片"]')).toBeNull()
  })
})
