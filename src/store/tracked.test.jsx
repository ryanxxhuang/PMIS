// @vitest-environment jsdom
// Key 追蹤 context(P-01)的行為契約:
// 1. 只有「讀過的 key 變了」的消費者才重渲染(其他消費者/版面不動)
// 2. Provider 重渲染本身不會拖著所有消費者重渲染(children bail out)
// 3. 事件處理器經由 proxy 取 action/值,拿到的是「最新版」——即使該元件沒重渲染
//    (消滅 stale closure 呼叫舊 action 的風險)
// 4. 解構(=render 期間讀取)即完成追蹤,useStore() 介面不變
import { describe, it, expect, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { createTrackedContext } from './tracked.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function setup() {
  const { Provider, useTracked } = createTrackedContext()
  const renders = { a: 0, b: 0, provider: 0 }
  let setState
  let grabbedStore // ConsumerB 抓住 proxy,模擬事件處理器晚點才讀

  // 對齊真實架構:state 在 Provider 元件「內部」(slices),children 由外部傳入
  // (元素參考穩定)——Provider 重渲染時 React 對 children bail out,
  // 只有訂閱機制能觸發消費者重渲染。
  function StatefulProvider({ children }) {
    renders.provider++
    const [state, set] = useState({ a: 1, b: 10, bump: (n) => n + 1 })
    setState = set
    return <Provider value={state}>{children}</Provider>
  }
  function Root() {
    return <StatefulProvider><A /><B /></StatefulProvider>
  }
  function A() {
    const { a } = useTracked()
    renders.a++
    return <div data-testid="a">{a}</div>
  }
  function B() {
    const store = useTracked()
    grabbedStore = store
    const { b } = store
    renders.b++
    return <div data-testid="b">{b}</div>
  }

  const el = document.createElement('div')
  const root = createRoot(el)
  act(() => root.render(<Root />))
  return { renders, el, update: (patch) => act(() => setState((s) => ({ ...s, ...patch }))), getStore: () => grabbedStore }
}

describe('createTrackedContext — key 追蹤重渲染', () => {
  beforeEach(() => { /* 每測試自建 context,無共享狀態 */ })

  it('只有讀到變動 key 的消費者重渲染', () => {
    const { renders, el, update } = setup()
    const a0 = renders.a, b0 = renders.b
    update({ a: 2 })
    expect(el.querySelector('[data-testid="a"]').textContent).toBe('2')
    expect(renders.a).toBeGreaterThan(a0) // A 讀 a → 重渲染
    expect(renders.b).toBe(b0)            // B 只讀 b → 不動
    const a1 = renders.a
    update({ b: 11 })
    expect(el.querySelector('[data-testid="b"]').textContent).toBe('11')
    expect(renders.a).toBe(a1)            // 換 A 不動
  })

  it('沒讀 store 的 key 都沒變 → 消費者完全不重渲染(Provider 自身重渲染也一樣)', () => {
    const { renders, update } = setup()
    const a0 = renders.a, b0 = renders.b, p0 = renders.provider
    update({}) // setState 觸發 Provider 重渲染,值全部相同
    expect(renders.provider).toBeGreaterThan(p0)
    expect(renders.a).toBe(a0)
    expect(renders.b).toBe(b0)
  })

  it('事件時經 proxy 取值永遠是最新版(元件未重渲染也一樣)', () => {
    const { renders, update, getStore } = setup()
    const store = getStore()
    const b0 = renders.b
    update({ a: 99, bump: (n) => n + 100 }) // B 沒讀 a/bump → 不重渲染
    expect(renders.b).toBe(b0)
    expect(store.a).toBe(99)          // 但事件時讀 proxy = 最新值
    expect(store.bump(1)).toBe(101)   // action 也是最新版,不是 stale closure
  })

  it('展開(...store)= 依賴全部 key', () => {
    const { Provider, useTracked } = createTrackedContext()
    const renders = { c: 0 }
    let setState
    function StatefulProvider({ children }) {
      const [state, set] = useState({ x: 1, y: 2 })
      setState = set
      return <Provider value={state}>{children}</Provider>
    }
    function Root() {
      return <StatefulProvider><C /></StatefulProvider>
    }
    function C() {
      const all = { ...useTracked() }
      renders.c++
      return <div>{all.x + all.y}</div>
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(<Root />))
    const c0 = renders.c
    act(() => setState((s) => ({ ...s, y: 3 })))
    expect(renders.c).toBeGreaterThan(c0) // 展開過 → 任何 key 變都要跟上
  })

  it('Provider 外使用丟出明確錯誤', () => {
    const { useTracked } = createTrackedContext()
    function Naked() { useTracked(); return null }
    const root = createRoot(document.createElement('div'))
    expect(() => act(() => root.render(<Naked />))).toThrow(/within StoreProvider/)
  })
})
