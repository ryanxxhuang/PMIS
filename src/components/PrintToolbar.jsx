// 列印頁工具列(螢幕上的 chrome,print:hidden)——五支列印路由共用:
// /site-log/print、/valuation/print、/valuation/package、/quality/checklist-print、/contract/print。
// 工具列是 chrome、紙是紙:工具列一律吃主題 token 跟 Apple style 走(深色模式=深色 chrome
// 壓白紙,Preview.app 就是這個關係);紙面固定白底黑字,單獨收在 index.css 的 .paper。
// 這裡取代的是五份一字不差的 W9 Google 藍藥丸常數(#0b57d0/#0842a0/#dadce0/#e8f0fe):
// 2026-09-11 全站已改 Apple style(D-021),列印頁卻還是已退場的藍藥丸,而且改色要改五次。
// 舊註解說「列印頁不 import ui.jsx」但沒有留下理由——實際相依鏈 ui.jsx → icons.jsx、
// PageTabs.jsx → store.jsx/navConfig.js,與列印頁本來就 import 的 store.jsx 是同一條鏈,
// 沒有環,所以直接吃 Button primitive,不再各頁自抄 class 字串。
// sticky:估驗兩支是全寬置頂 chrome-bar;另外三支是紙上方與 A4 同寬的一列——兩種版面照舊,
// 這一波只換色值來源,不順手統一版面。
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { Button } from './ui.jsx'

export default function PrintToolbar({ backTo, backLabel, printLabel = '列印 / 存 PDF', sticky = false, children }) {
  const navigate = useNavigate()
  // 置頂版走 scroll edge effect(規範 §4:chrome 與內容的分界不用常駐 1px 分隔線,
  // 內容捲到 chrome 底下才浮出 hairline+柔影),與 Layout 頂欄同一套 .chrome-edge。
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    if (!sticky) return
    const onScroll = () => setScrolled(window.scrollY > 0)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [sticky])

  const shell = sticky
    ? 'print:hidden sticky top-0 z-10 chrome-bar chrome-edge px-6 py-3 flex flex-wrap items-center justify-between gap-2'
    : 'print:hidden max-w-[210mm] mx-auto mb-3 px-1 flex flex-wrap items-center justify-between gap-2'
  return (
    <div data-scrolled={sticky ? scrolled : undefined} className={shell}>
      <Button variant="secondary" onClick={() => navigate(backTo)}>← {backLabel}</Button>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <Button onClick={() => window.print()}><MSym name="print" size={15} />{printLabel}</Button>
      </div>
    </div>
  )
}
