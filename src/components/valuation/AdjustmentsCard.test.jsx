// @vitest-environment jsdom
// P4d 估驗調整卡:pending 在前、applied／void 留痕;只有機關(canVoid)有「作廢(接受已計價)」;沒有調整不渲染。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import AdjustmentsCard from './AdjustmentsCard.jsx'

let container, root
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT })

const items = new Map([['L1', { item_no: '1.1', description: '混凝土', unit: 'm3' }]])
const base = { periodNoOf: (id) => ({ 'v-2': 2, 'v-4': 4 })[id] ?? null, keyOf: (id) => (id === 'w1' ? 'L1' : null), itemOf: (k) => items.get(k) }
const rows = [
  { id: 'a-void', work_item_id: 'w1', qty_delta: -3, reason: '確認撤銷', status: 'void', origin_valuation_id: 'v-2', created_at: '2026-09-18T01:00:00Z', voided_at: '2026-09-18T02:00:00Z', void_reason: '機關接受已計價' },
  { id: 'a-pend', work_item_id: 'w1', qty_delta: -12, reason: '確認撤銷:複核後減量', status: 'pending', origin_valuation_id: 'v-2', created_at: '2026-09-19T01:00:00Z' },
  { id: 'a-app', work_item_id: 'w1', qty_delta: -5, reason: '確認撤銷', status: 'applied', origin_valuation_id: 'v-2', applied_valuation_id: 'v-4', created_at: '2026-09-17T01:00:00Z' },
]
const render = (props) => act(async () => root.render(<AdjustmentsCard {...base} {...props} />))

describe('AdjustmentsCard', () => {
  it('沒有調整不渲染', async () => { await render({ adjustments: [] }); expect(container.textContent).toBe('') })
  it('機關:pending 排最前並有作廢鈕(帶列與工項);applied 顯示扣回期別、void 顯示原因', async () => {
    const got = []
    await render({ adjustments: rows, canVoid: true, onVoid: (a, w) => got.push([a.id, w.label]) })
    const txt = container.textContent
    expect(txt).toContain('1 筆待處理 · 共 3 筆')
    expect(txt.indexOf('待處理')).toBeLessThan(txt.indexOf('已扣回'))
    expect(txt).toContain('-12 m3 · 1.1 混凝土(第 2 期已核定量)')
    expect(txt).toContain('已於第 4 期扣回')
    expect(txt).toContain('作廢原因:機關接受已計價')
    expect(txt).toContain('機關可作廢(接受該量已計價,不會產生新的可用量)')
    const btns = container.querySelectorAll('button[aria-label^="作廢調整"]')
    expect(btns).toHaveLength(1)
    await act(async () => btns[0].click())
    expect(got).toEqual([['a-pend', '1.1 混凝土']])
  })
  it('非機關(廠商／監造):看得到狀態與下一步,沒有作廢鈕', async () => {
    await render({ adjustments: rows, canVoid: false })
    expect(container.querySelectorAll('button[aria-label^="作廢調整"]')).toHaveLength(0)
    expect(container.textContent).toContain('由機關作廢(接受已計價),或在草稿期「同步確認量」時併入扣回')
  })
})
