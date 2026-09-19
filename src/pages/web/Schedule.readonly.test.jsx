// @vitest-environment jsdom
// /schedule 退場為唯讀歷史查閱(P5d):沒有任何寫入控制項,落後判定與履約時程同一份,並指路到履約時程維護。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ store: null }))
vi.mock('../../store.jsx', () => ({ useStore: () => state.store }))
import Schedule from './Schedule.jsx'

const iso = (d) => d.toISOString().slice(0, 10)
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d }
const items = [{ item_key: 'A', item_no: '1.1', description: '鋼筋', unit: 'T', quantity: 100, is_billable: true }]

let container, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  state.store = {
    workItems: { items }, adjustedItems: items, dbMode: false, demoMode: true, valuations: [{ items: { A: 40 } }],
    itemSchedules: { A: { planned_start: iso(daysFromNow(-60)), planned_finish: iso(daysFromNow(-10)) } },
  }
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
const render = () => act(async () => { root.render(<MemoryRouter><Schedule /></MemoryRouter>) })

describe('逐工項排程退場為唯讀', () => {
  it('列出關鍵工項與落後狀態、CSV 仍在;沒有輸入框、沒有加入／移除;退場說明指向履約時程', async () => {
    await render()
    expect(container.querySelector('[role="note"]').textContent).toContain('已退出新作業')
    expect(container.querySelector('[role="note"] a[href="/requirements"]')).toBeTruthy()
    expect(container.querySelectorAll('input')).toHaveLength(0)
    expect([...container.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['CSV'])
    const table = container.querySelector('table[aria-label="逐工項排程"]')
    expect(table.textContent).toContain('鋼筋')
    expect(table.textContent).toContain('落後')
    expect(table.textContent).toContain('40.0%')
    expect(table.querySelector('a[href="/requirements?item=A"]')).toBeTruthy()
  })
  it('沒有關鍵工項時指路到履約時程加入,而不是本頁的搜尋', async () => {
    state.store.itemSchedules = {}
    await render()
    expect(container.textContent).toContain('到「契約重點」的履約時程加入關鍵工項')
    expect(container.querySelectorAll('input')).toHaveLength(0)
  })
  it('沒有標單的真專案:早退仍有頁首與退場說明', async () => {
    state.store = { ...state.store, dbMode: false, demoMode: false, workItems: null }
    await render()
    expect(container.querySelector('h1').textContent).toBe('逐工項排程')
    expect(container.querySelector('[role="note"]')).toBeTruthy()
  })
})
