// Esc 關閉浮層的單一寫法(原本六處各抄一份:Layout 的專案切換器／全域搜尋／
// 手機抽屜、CopilotFab、listDetail 的抽屜與 Modal、confirm 對話框)。
//
// 為什麼掛 window 而不是綁在面板 div 的 onKeyDown:使用者只要點到不可聚焦的
// 標題文字,焦點就落回 body,綁在 div 上的鍵盤事件再也收不到 → Esc 變死路。
// 為什麼 open=false 時不掛:全站常駐一隻 keydown 監聽只為了偶爾開一次的浮層,
// 既浪費也讓「哪一層該吃掉 Esc」變得不可預測。
// 為什麼 onClose 走 ref:呼叫端多半傳 inline 箭頭函式,放進依賴陣列會讓監聽
// 每次 render 都拆掉重掛。
import { useEffect, useRef } from 'react'

export function useEscape(open, onClose) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
}
