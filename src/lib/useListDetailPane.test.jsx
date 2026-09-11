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

function Harness({ rows = ROWS, ready = true, scope = 'p1', modalUp = false, pickDefault }) {
  const searchRef = useRef(null)
  const [params] = useSearchParams()
  const pane = useListDetailPane({
    param: 'sel', idPrefix: 'row-', scope, ready, rows,
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
      <output data-testid="url">{params.get('sel') ?? ''}</output>
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
  it('無深連結:選頁面給的預設列並寫回 URL', async () => {
    await render(<Harness pickDefault={() => 'b'} />)
    expect(text('sel')).toBe('b')
    expect(text('url')).toBe('b')
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
    expect(text('url')).toBe('x')
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
