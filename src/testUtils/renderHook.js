// 最小 hook harness:repo 沒有裝 @testing-library,直接用 react-dom/client 掛一個
// 只負責呼叫 hook 的空元件。slice 測試都要它(slice 本體就是 hook),原本三支
// 檔案各抄一份一模一樣的實作。
//
// 不寫 JSX:使用端多是 .js 檔,不依賴 JSX transform。
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

export function renderHook(useHook) {
  const result = { current: null }
  const Harness = () => { result.current = useHook(); return null }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Harness)))
  return result
}
