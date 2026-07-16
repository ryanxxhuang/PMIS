// Key 追蹤 context(P-01,react-tracked 模式的極簡自製版):
//
// 問題:單一 Context 塞整包 store value,任何 setState 都讓「所有」useStore() 消費者
// 重渲染——估驗打一格數字,側欄/頂欄/浮動助理全部跟著重畫。
//
// 作法:Context 只放一個「永不變」的 bridge 物件(latest value + 訂閱者),
// Provider 重渲染時不觸發 context 傳播(children 元素參考不變,React 直接 bail out);
// 消費者用 useSyncExternalStore 訂閱,並以 Proxy 記錄 render 期間實際讀取的 key——
// 下次通知時只有「讀過的 key 變了」才重渲染。useStore() 介面(解構)完全不變。
//
// 設計要點:
// - Proxy 永遠讀 bridge.value(最新),不是凍結快照:事件處理器裡經由 proxy 取
//   action/值時拿到的是最新版,不會有 stale closure 呼叫舊 action 的問題。
// - 追蹤集只增不減(render path 改變時寧可多訂閱=多渲染,絕不漏更新)。
// - getSnapshot 以「追蹤中的 key 逐一 Object.is」決定要不要換參考——參考不變
//   React 就跳過重渲染。
import {
  createContext, useContext, useRef, useCallback, useMemo,
  useSyncExternalStore, useLayoutEffect,
} from 'react'

export function createTrackedContext() {
  const Ctx = createContext(null)

  function Provider({ value, children }) {
    const bridge = useRef(null)
    if (!bridge.current) bridge.current = { value, listeners: new Set() }
    bridge.current.value = value // render 期間同步更新:同一 commit 內的子樹讀到一致的最新值
    // commit 後才通知(paint 前):訂閱者依各自追蹤的 key 決定要不要重渲染
    useLayoutEffect(() => { for (const l of [...bridge.current.listeners]) l() })
    return <Ctx.Provider value={bridge.current}>{children}</Ctx.Provider>
  }

  function useTracked() {
    const bridge = useContext(Ctx)
    if (!bridge) throw new Error('useStore must be used within StoreProvider')
    const keysRef = useRef(null)
    if (!keysRef.current) keysRef.current = new Set()
    const snapRef = useRef(null)

    const subscribe = useCallback((onChange) => {
      bridge.listeners.add(onChange)
      return () => bridge.listeners.delete(onChange)
    }, [bridge])

    // 追蹤中的 key 都沒變 → 回上次的參考(React 據此跳過重渲染)
    const getSnapshot = useCallback(() => {
      const cur = bridge.value
      const prev = snapRef.current
      if (prev && prev !== cur) {
        let changed = false
        for (const k of keysRef.current) {
          if (!Object.is(prev[k], cur[k])) { changed = true; break }
        }
        if (!changed) return prev
      }
      snapRef.current = cur
      return cur
    }, [bridge])

    useSyncExternalStore(subscribe, getSnapshot)

    // Proxy 參考終身穩定;get 一律讀 bridge.value(最新)並登記追蹤
    return useMemo(() => new Proxy({}, {
      get(_, prop) {
        if (typeof prop === 'string') keysRef.current.add(prop)
        return bridge.value[prop]
      },
      has(_, prop) {
        if (typeof prop === 'string') keysRef.current.add(prop)
        return prop in bridge.value
      },
      // 展開/枚舉(...store、Object.keys)=依賴全部 key:全部登記,寧可多渲染不漏更新
      ownKeys() {
        for (const k of Object.keys(bridge.value)) keysRef.current.add(k)
        return Reflect.ownKeys(bridge.value)
      },
      getOwnPropertyDescriptor(_, prop) {
        if (typeof prop === 'string') keysRef.current.add(prop)
        if (!(prop in bridge.value)) return undefined
        return { configurable: true, enumerable: true, value: bridge.value[prop] }
      },
    }), [bridge])
  }

  return { Provider, useTracked }
}
