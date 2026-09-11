// @vitest-environment jsdom
// 「清單＋詳情」殼的行為合約(W8-5 真人驗收出來的,抽成共用 hook 時不得弄丟):
// 深連結優先於預設選取、↑/↓ 只在清單序內移動並同步 URL、Enter 開原文但不搶
// button/link 的原生 click、「/」聚焦搜尋、輸入控件與 modal 層內整組停用、
// 切換 scope 整組重置並清 URL 參數、<lg 點列才開抽屜。
import { act, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useListDetailPane, useListKeyboardNav } from './useListDetailPane.js'

let container, root, spies
const ROWS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

function Harness({ rows = ROWS, ready = true, scope = 'p1', modalUp = false, pickDefault, param = 'sel' }) {
  const searchRef = useRef(null)
  const [params] = useSearchParams()
  const pane = useListDetailPane({
    param, idPrefix: 'row-', scope, ready, rows,
    pickDefault: pickDefault || (() => rows[0]?.id ?? null),
    onSelect: spies.onSelect, onReset: spies.onReset, onDeepLink: spies.onDeepLink,
  })
  useListKeyboardNav({
    ordered: rows, selectedId: pane.selectedId, select: pane.select, idPrefix: 'row-',
    onEnter: spies.onEnter, modalUp, searchRef,
  })
  return (
    <div>
      <input ref={searchRef} aria-label="搜尋" />
      <output data-testid="sel">{pane.selectedId ?? ''}</output>
      <output data-testid="url">{params.get(param) ?? ''}</output>
      <output data-testid="drawer">{String(pane.detailOpen)}</output>
      <button type="button" onClick={() => pane.select('c', { openPane: true })}>open-c</button>
      {rows.map((r) => <div key={r.id} id={`row-${r.id}`} />)}
    </div>
  )
}

const text = (id) => container.querySelector(`[data-testid="${id}"]`).textContent
const key = (k, target = window) => act(async () => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
})
async function render(el, path = '/') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>) })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  vi.useFakeTimers()
  spies = { onSelect: vi.fn(), onReset: vi.fn(), onDeepLink: vi.fn(), onEnter: vi.fn() }
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

describe('初次自動選取', () => {
  it('無深連結:選頁面給的預設列,但不寫 URL(預設不是使用者的選擇,reload 不該因此變成深連結彈抽屜)', async () => {
    await render(<Harness pickDefault={() => 'b'} />)
    expect(text('sel')).toBe('b')
    expect(text('url')).toBe('')
    expect(spies.onSelect).toHaveBeenCalledWith('b')
    expect(spies.onDeepLink).not.toHaveBeenCalled()
  })
  it('深連結優先於預設,呼叫 onDeepLink 並把該列捲到中央', async () => {
    await render(<Harness pickDefault={() => 'a'} />, '/?sel=c')
    expect(text('sel')).toBe('c')
    expect(spies.onDeepLink).toHaveBeenCalledWith({ id: 'c' })
    await act(async () => { vi.advanceTimersByTime(80) })
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })
  it('深連結指到不存在的列 → 退回預設', async () => {
    await render(<Harness pickDefault={() => 'a'} />, '/?sel=zzz')
    expect(text('sel')).toBe('a')
  })
  it('ready=false 不選;變 true 後只選一次', async () => {
    function Wrap() {
      const [ready, setReady] = useState(false)
      return <><button type="button" onClick={() => setReady(true)}>go</button><Harness ready={ready} /></>
    }
    await render(<Wrap />)
    expect(text('sel')).toBe('')
    await act(async () => { container.querySelector('button').click() })
    expect(text('sel')).toBe('a')
    expect(spies.onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('鍵盤導覽', () => {
  it('↓/↑ 在清單序內移動、到底不越界、URL 同步', async () => {
    await render(<Harness />)
    await key('ArrowDown'); expect(text('sel')).toBe('b')
    await key('ArrowDown'); expect(text('sel')).toBe('c')
    await key('ArrowDown'); expect(text('sel')).toBe('c')
    expect(text('url')).toBe('c')
    await key('ArrowUp'); expect(text('sel')).toBe('b')
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })
  })
  it('Enter 開原文;焦點在 button/link 上讓原生 click 走,不搶', async () => {
    await render(<Harness />)
    await key('Enter')
    expect(spies.onEnter).toHaveBeenCalledTimes(1)
    await key('Enter', container.querySelector('button'))
    expect(spies.onEnter).toHaveBeenCalledTimes(1)
  })
  it('「/」聚焦搜尋;在輸入控件裡整組快捷鍵停用', async () => {
    await render(<Harness />)
    const input = container.querySelector('input')
    await key('/')
    expect(document.activeElement).toBe(input)
    await key('ArrowDown', input)
    expect(text('sel')).toBe('a')
    await key('Enter', input)
    expect(spies.onEnter).not.toHaveBeenCalled()
  })
  it('modal 層開著(旗標或 aria-modal)整組停用', async () => {
    await render(<Harness modalUp />)
    await key('ArrowDown')
    expect(text('sel')).toBe('a')
    await act(async () => root.unmount())
    root = createRoot(container)
    await render(<><div aria-modal="true" /><Harness /></>)
    await key('/')
    expect(document.activeElement).not.toBe(container.querySelector('input'))
    await key('ArrowDown')
    expect(text('sel')).toBe('a')
  })
  it('Ctrl/Cmd/Alt 組合鍵不吃', async () => {
    await render(<Harness />)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', metaKey: true }))
    })
    expect(text('sel')).toBe('a')
  })
})

describe('切換 scope 與抽屜', () => {
  it('scope 變了:清選取與 URL 參數、呼叫 onReset,再依新資料重選一次', async () => {
    // 切案後列 id 全換(他案的 id 不會出現在新案),舊 URL 參數對不到列 → 走預設
    const P2 = [{ id: 'x' }, { id: 'y' }]
    function Wrap() {
      const [scope, setScope] = useState('p1')
      return <><button type="button" onClick={() => setScope('p2')}>switch</button><Harness scope={scope} rows={scope === 'p1' ? ROWS : P2} /></>
    }
    await render(<Wrap />, '/?sel=b')
    expect(text('sel')).toBe('b')
    await act(async () => { container.querySelector('button').click() })
    expect(spies.onReset).toHaveBeenCalledTimes(1)
    expect(text('sel')).toBe('x')
    expect(text('url')).toBe('') // 舊參數清掉、新預設不寫(與初次自動選取同一條規則)
  })
  it('首次掛載不算切換:不呼叫 onReset、不清深連結', async () => {
    await render(<Harness />, '/?sel=c')
    expect(spies.onReset).not.toHaveBeenCalled()
    expect(text('sel')).toBe('c')
  })
  it('openPane 只在 <lg 開抽屜;桌機不留殘值;closeDetail 關閉', async () => {
    await render(<Harness />)
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'open-c')
    await act(async () => btn.click())
    expect(text('sel')).toBe('c')
    expect(text('drawer')).toBe('false')
    window.matchMedia.mockReturnValue({ matches: true })
    await act(async () => btn.click())
    expect(text('drawer')).toBe('true')
  })
})

// 同一頁兩個殼(/safety:缺失 ?defect= 與工安紀錄 ?record=)。react-router 的 setSearchParams(fn)
// 給的是 render 快照,兩支 hook 在同一個 commit 先後寫 URL 會互相蓋掉——hook 改以「最後
// 一次寫出的 search」為基底後,這裡釘住:各自的預設選取互不干擾、深連結各帶各的、
// 切 scope 的重置只刪自己的 param(兩個殼同時重置也不會留下對方的舊值)。
describe('同頁兩個殼', () => {
  function Both({ scopeA = 'p1', scopeB = 'p1' }) {
    const [params] = useSearchParams()
    return (
      <>
        <Harness param="a" scope={scopeA} pickDefault={() => 'a'} />
        <Harness param="b" scope={scopeB} pickDefault={() => 'b'} />
        <output data-testid="both">{`${params.get('a') ?? ''}|${params.get('b') ?? ''}`}</output>
      </>
    )
  }
  const sels = () => [...container.querySelectorAll('[data-testid="sel"]')].map((o) => o.textContent)
  it('同一 commit 各選自己的預設,URL 不寫任何一個', async () => {
    await render(<Both />)
    expect(sels()).toEqual(['a', 'b'])
    expect(text('both')).toBe('|')
  })
  it('深連結各帶各的:兩筆都選中,URL 原樣保留', async () => {
    await render(<Both />, '/?a=c&b=c')
    expect(text('both')).toBe('c|c')
    expect(sels()).toEqual(['c', 'c'])
  })
  it('一個殼切 scope 重置:只刪自己的 param,另一個殼的深連結不動', async () => {
    function Wrap() {
      const [scope, setScope] = useState('p1')
      return <><button type="button" onClick={() => setScope('p2')}>switch</button><Both scopeA={scope} /></>
    }
    await render(<Wrap />, '/?a=c&b=c')
    await act(async () => { container.querySelector('button').click() })
    // 殼 A 重置後依新 scope 重選預設 a(不寫 URL);殼 B 的 c 沒被清掉
    expect(sels()).toEqual(['a', 'c'])
    expect(text('both')).toBe('|c')
    expect(spies.onReset).toHaveBeenCalledTimes(1)
  })
  it('兩個殼同一 commit 一起重置(切案):各刪各的,URL 不留任何一方的舊 id', async () => {
    function Wrap() {
      const [scope, setScope] = useState('p1')
      return <><button type="button" onClick={() => setScope('p2')}>switch</button><Both scopeA={scope} scopeB={scope} /></>
    }
    await render(<Wrap />, '/?a=c&b=c')
    await act(async () => { container.querySelector('button').click() })
    expect(text('both')).toBe('|')
    expect(sels()).toEqual(['a', 'b'])
  })
})
