// @vitest-environment jsdom
// ValuationRow 的 memo 探針(重構波次 7):抽成元件的唯一目的是「大標單任一 state 變動不再
// 整樹重畫」,但 memo 只在 props 全部穩定時生效——傳一個每次 render 換 identity 的東西進去
// 就白做。這裡用 getEvidence 的呼叫次數當「葉列 render 了幾次」的探針(葉列每次 render 必呼叫一次):
//   ① 父層無關 state 變動 → 探針不增(memo 生效);
//   ② 該列自己的 prop 變(展開佐證/改數量) → 探針 +1,且畫面確實更新(沒有過度 memo);
//   ③ 祖先展開/收合 → 只有祖先重畫,葉列不動;
//   ④ 反證:callback 每次換 identity → 探針每次都增,所以頁面必須 useCallback 釘住。
import { act, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import ValuationRow from './ValuationRow.jsx'

const leaf = { item_key: 'L1', item_no: '1.1', description: '鋼筋 SD420W', unit: 't', quantity: 100, unit_price: 20000, depth: 2 }
const parent = { item_key: 'P1', item_no: '1', description: '結構工程', amount: 2_000_000, depth: 1 }
const ev = {
  logs: [{ log_date: '2026-07-01', qty: 10, note: '綁紮' }], loggedTotal: 10,
  inspections: [], checklists: [], samples: [],
  counts: { logs: 1, inspections: 0, checklists: 0, samples: 0 },
}

let container, root, api
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

// 模擬估驗頁:一個母項 + 一個葉項,callback 與頁面同法 useCallback 釘住;
// unstable=true 時故意每次 render 換一個新的 onToggleEv(反證用)。
function Harness({ getEvidence, unstable = false }) {
  const [, setTick] = useState(0)
  const [expanded, setExpanded] = useState(() => new Set(['P1']))
  const [evOpen, setEvOpen] = useState(() => new Set())
  const [qty, setQty] = useState(10)
  const toggle = useCallback((k) => setExpanded((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n }), [])
  const toggleEv = useCallback((k) => setEvOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n }), [])
  const onQty = useCallback(() => {}, [])
  const onToggleEv = unstable ? (k) => toggleEv(k) : toggleEv
  api = { bump: () => setTick((t) => t + 1), toggle, toggleEv, setQty }
  const shared = { editable: true, selectedId: 'v1', getEvidence, onToggle: toggle, onToggleEv, onQty }
  return (
    <MemoryRouter>
      <table><tbody>
        <ValuationRow it={parent} level={0} hasKids isOpen={expanded.has('P1')} evIsOpen={false}
          cum={200000} prevCum={0} qtyInput={undefined} {...shared} />
        <ValuationRow it={leaf} level={1} hasKids={false} isOpen={false} evIsOpen={evOpen.has('L1')}
          cum={200000} prevCum={0} qtyInput={qty} {...shared} />
      </tbody></table>
    </MemoryRouter>
  )
}

const mount = async (props) => act(async () => root.render(<Harness {...props} />))

describe('ValuationRow memo 探針', () => {
  it('① 父層無關 state 變動,葉列不重畫', async () => {
    const getEvidence = vi.fn(() => ev)
    await mount({ getEvidence })
    expect(getEvidence).toHaveBeenCalledTimes(1)
    await act(async () => api.bump())
    await act(async () => api.bump())
    await act(async () => api.bump())
    expect(getEvidence).toHaveBeenCalledTimes(1)
  })

  it('② 自己的 prop 變才重畫:展開佐證 +1(且佐證列真的出現)、改數量 +1(輸入框真的換值)', async () => {
    const getEvidence = vi.fn(() => ev)
    await mount({ getEvidence })
    expect(container.textContent).not.toContain('前往日誌')
    await act(async () => api.toggleEv('L1'))
    expect(getEvidence).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('前往日誌') // EvidenceRow 掛在葉列的 fragment 內
    expect(container.querySelector('input[type="number"]').value).toBe('10')
    await act(async () => api.setQty(20))
    expect(getEvidence).toHaveBeenCalledTimes(3)
    expect(container.querySelector('input[type="number"]').value).toBe('20') // key 換 → 輸入框重掛,吃新 defaultValue
  })

  it('③ 祖先展開/收合只重畫祖先,葉列不動', async () => {
    const getEvidence = vi.fn(() => ev)
    await mount({ getEvidence })
    const btn = () => container.querySelector('button[aria-label$=" 1"]')
    expect(btn().getAttribute('aria-expanded')).toBe('true')
    await act(async () => api.toggle('P1'))
    expect(btn().getAttribute('aria-expanded')).toBe('false')
    expect(getEvidence).toHaveBeenCalledTimes(1)
  })

  it('④ 反證:callback 每次換 identity,memo 失效——所以頁面必須 useCallback', async () => {
    const getEvidence = vi.fn(() => ev)
    await mount({ getEvidence, unstable: true })
    expect(getEvidence).toHaveBeenCalledTimes(1)
    await act(async () => api.bump())
    expect(getEvidence).toHaveBeenCalledTimes(2)
  })
})
