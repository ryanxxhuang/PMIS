// @vitest-environment jsdom
// 機關變更核定的資訊順序(UIUX 階段 5B U10):
// - 摘要:目前責任(待你核定/待機關核定/待監造受理)、事由與理由、淨額與核准後契約金額、缺資料處(未登錄三行);
// - 三角色動作:機關只在審核中有核准/駁回;監造只有受理/退回;廠商沒有核定鈕;
// - 核准/駁回先確認且指向單據與金額,取消不寫入;API 失敗由頁面呈現、狀態不變。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import ChangeOrderDetail from './ChangeOrderDetail.jsx'

let container, root
const co = {
  id: 'C2', co_no: 'CO-002', title: '1F 大廳地坪材質變更', co_date: '2026-09-03', status: '審核中', reason: '業主要求由拋光石英磚改為石材',
  items: [
    { id: 'i1', item_no: '壹-1', description: '拋光石英磚地坪（取消）', unit: 'M2', qty_delta: -420, unit_price: 2600, amount_delta: -1092000 },
    { id: 'i2', item_no: '', description: '花崗石地坪（新增）', unit: 'M2', qty_delta: 420, unit_price: 6800, amount_delta: 2856000 },
  ],
}
const net = 1764000
const revised = 722624067

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
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
const render = (props) => act(async () => {
  root.render(<MemoryRouter><ChangeOrderDetail co={co} net={net} revised={revised} leaves={[]} allItems={[]}
    canReview={false} canRatify={false} canEdit={false} itemsEditable={false}
    onStatus={vi.fn()} onDelete={vi.fn()} onAddItem={vi.fn()} onAddItems={vi.fn()} onUpdateItem={vi.fn()} onDeleteItem={vi.fn()} {...props} /></MemoryRouter>)
})
const button = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const text = () => container.textContent

describe('機關核定摘要與動作', () => {
  it('審核中:機關看到待你核定、事由理由、淨額與核准後契約金額、未登錄三行;核准先確認,取消不寫入', async () => {
    const onStatus = vi.fn().mockResolvedValue(undefined)
    await render({ canRatify: true, onStatus })
    expect(text()).toContain('待你核定 · CO-002')
    expect(text()).toContain('事由：1F 大廳地坪材質變更')
    expect(text()).toContain('理由：業主要求由拋光石英磚改為石材')
    expect(text()).toContain('核准後變更後契約金額將為 NT$ 724,388,067')
    expect(text()).toContain('本系統未登錄')
    expect(text()).toContain('工期影響未登錄')
    expect(text()).toContain('監造審查意見未提供')
    expect(text()).toContain('附件無')
    expect(button('核准')).toBeTruthy()
    expect(button('駁回')).toBeTruthy()
    expect(button('受理審查')).toBeUndefined()

    window.confirm = vi.fn(() => false)
    await act(async () => button('核准').click())
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(window.confirm.mock.calls[0][0]).toContain('核准 CO-002？')
    expect(window.confirm.mock.calls[0][0]).toContain('724,388,067')
    expect(onStatus).not.toHaveBeenCalled()

    window.confirm = vi.fn(() => true)
    await act(async () => button('駁回').click())
    expect(window.confirm.mock.calls[0][0]).toContain('駁回 CO-002？')
    expect(onStatus).toHaveBeenCalledWith('駁回')
    // 寫入結果由頁面決定;元件不預先改畫面(狀態仍是 props 的審核中)
    expect(text()).toContain('待你核定')
  })

  it('監造:審核中只能退回、提出只能受理;都看不到核准/駁回', async () => {
    await render({ canReview: true })
    expect(text()).toContain('待機關核定 · CO-002')
    expect(button('退回')).toBeTruthy()
    expect(button('核准')).toBeUndefined()
    expect(button('駁回')).toBeUndefined()
    await act(async () => root.unmount())
    root = createRoot(container)
    await render({ canReview: true, co: { ...co, status: '提出' } })
    expect(text()).toContain('輪到你受理審查 · CO-002')
    expect(button('受理審查')).toBeTruthy()
    expect(button('核准')).toBeUndefined()
  })

  it('廠商:提出中只有刪除,沒有核定鈕;已核准顯示已計入契約金額', async () => {
    await render({ canEdit: true, itemsEditable: true, co: { ...co, status: '提出' } })
    expect(text()).toContain('待監造受理審查 · CO-002')
    expect(button('刪除變更單')).toBeTruthy()
    expect(button('核准')).toBeUndefined()
    expect(button('受理審查')).toBeUndefined()
    await act(async () => root.unmount())
    root = createRoot(container)
    await render({ canRatify: true, co: { ...co, status: '核准' } })
    expect(text()).toContain('已核准（已計入變更後契約金額）')
    expect(text()).toContain('已計入變更後契約金額 NT$ 722,624,067')
    expect(button('核准')).toBeUndefined()
  })
})
