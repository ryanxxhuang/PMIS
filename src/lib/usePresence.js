// 「關閉時先播出場再卸載」的最小機制,給手機推入抽屜與底部 sheet 用。
//
// 為什麼要有:index.css 的 .enter-* 只管進場,出場是 `if (!open) return null` 即時卸載——
// 稽核量到清單→詳情是「整頁瞬間換掉」,回來也一樣,沒有空間連續性(規範 §5 第 5 條:
// 從哪裡來就回哪裡去)。做法:open 變 false 後仍維持掛載,回傳 state='closed' 讓呼叫端
// 掛成 data-state,CSS 把它過渡回起點;面板的 transitionend(只認自己的 transform,
// 子元素 .pressable 的 transform 過渡會冒泡上來)才真的卸載。
//
// 可中斷:出場一半再開,open 變回 true 就直接渲染 state='open',CSS transition 從當前
// 位置續動,不會跳回起點(規範 §5 第 3 條)。
//
// animatedQuery:只有命中這條 media query 才等出場(例如 sheet 只在 <md 是 sheet,
// 桌機對話框維持「出場即時」的既有決定);不給就一律等。transitionend 沒來
// (display:none、jsdom、reduce-motion 的 .01ms 其實會來)由保險計時器收尾。
import { useEffect, useState } from 'react'

// 出場最長是 --dur-sheet(350ms),再留餘裕
const EXIT_FALLBACK_MS = 500

export function usePresence(open, animatedQuery) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) { setMounted(true); return undefined }
    const animated = !animatedQuery || (window.matchMedia?.(animatedQuery)?.matches ?? false)
    if (!animated) { setMounted(false); return undefined }
    const timer = setTimeout(() => setMounted(false), EXIT_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [open, animatedQuery])
  const onTransitionEnd = (e) => {
    if (!open && e.target === e.currentTarget && e.propertyName === 'transform') setMounted(false)
  }
  return { mounted: open || mounted, state: open ? 'open' : 'closed', onTransitionEnd }
}
