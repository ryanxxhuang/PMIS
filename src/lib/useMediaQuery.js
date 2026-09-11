// matchMedia 的 React 包裝:回傳目前是否命中,並跟著視窗變化更新。
// 斷點字串集中在這裡匯出——它們必須等於 Tailwind 的 md(768)/lg(1024):CSS 用 max-md
// 藏 FAB、JS 用同一條決定「要不要渲染」,兩邊不一致就會出現「CSS 藏了、JS 還在算」的
// 死狀態。上界寫 .98 是 media query 的老規矩:整數點兩邊會同時命中。
// 沒有 matchMedia(jsdom)一律當不命中,且不掛監聽——測試環境的 stub 多半只給 matches。
import { useEffect, useState } from 'react'

export const BELOW_MD_QUERY = '(max-width: 767.98px)'
export const BELOW_LG_QUERY = '(max-width: 1023.98px)'
// 平板區間 = md(768)起、xl(1280)前;側欄在這一段強制收成 icon rail
export const TABLET_QUERY = '(min-width: 768px) and (max-width: 1279.98px)'

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query)?.matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq?.addEventListener) return undefined
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
