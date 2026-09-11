// 把 visualViewport.height 寫成 :root 的 --vvh(px),給軟鍵盤升起時的浮層用。
//
// 為什麼不用 100dvh:dvh 只跟瀏覽器工具列伸縮走,軟鍵盤升起時 iOS/Android 的 layout
// viewport 都不縮,只有 visualViewport 會——稽核量到「補充回覆」的取消/送出兩顆都壓在
// 鍵盤下,就是對話框用 100vh 置中的後果。sheet/抽屜/對話框的可捲區 max-height 綁
// var(--vvh),index.css 給的預設 100dvh 只在沒有 visualViewport 的環境生效。
// resize 與 scroll(鍵盤升起時 offsetTop 也會變)都用 rAF 節流:一次 frame 只寫一次。
// Layout 掛一次即可;卸載時移除 inline 值,回到 CSS 預設。
import { useEffect } from 'react'

export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return undefined
    const root = document.documentElement
    let raf = 0
    const write = () => { raf = 0; root.style.setProperty('--vvh', `${Math.round(vv.height)}px`) }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(write) }
    write()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      root.style.removeProperty('--vvh')
    }
  }, [])
}
