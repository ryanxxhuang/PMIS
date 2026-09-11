// 工作面 chips 分頁列(README §頁首):PageHeader 標題塊下方自動渲染。
// 單一真相仍是 navConfig 的 item.tabs+visibleNavGroups 角色過濾——側欄樹與
// 這裡永遠說同一份清單;分頁是真路由(深連結保留),所以是 nav+NavLink,
// 刻意不用 role=tablist(e2e 明文禁止工作面 tablist,語意上也不是 tab)。
// 不 import ui.jsx:PageHeader 引用本元件,反向引用會成環。
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { visibleNavGroups } from '../lib/navConfig.js'
import { BELOW_MD_QUERY } from '../lib/useMediaQuery.js'

// chips 皮膚常數:Admin 頁內真 tabs(role=tablist)與這裡共用同一套,
// 「兩排都是切換」的視覺意圖不因只改一邊而漂移。
// 不放 ui.jsx——PageHeader→PageTabs 已成鏈,反向 import 會成環。
// max-md:min-w-11 + justify-center 與 ui.jsx 的 FilterChip 同步補(規範 §9.2 的 44 面積);
// 兩處字面值刻意對齊,改一邊另一邊要跟。
// max-md:snap-start:手機分頁列 scroll-snap(規範 §9.3),每個 chip 是一個吸附點。
export const CHIP_BASE = 'h-8 max-md:min-h-11 max-md:min-w-11 max-md:snap-start shrink-0 inline-flex items-center justify-center px-3.5 rounded-lg text-body font-medium whitespace-nowrap pressable'
export const CHIP_ON = 'bg-[var(--blue-tint)] text-[var(--blue-text)]'
export const CHIP_OFF = 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'

// 分頁列在手機:哪一側還有內容就哪一側漸淡(data-fade → index.css .tabs-scroll)。
// CSS 沒有「只在可捲時」的選擇器,所以量 scrollWidth/scrollLeft 寫成 data 屬性;
// 桌機也量(便宜),但 mask 只在 <md 的 media 區塊裡畫,桌機視覺不動。
function fadeFor(el) {
  const max = el.scrollWidth - el.clientWidth
  if (max <= 1) return 'none'
  if (el.scrollLeft <= 1) return 'right'
  if (el.scrollLeft >= max - 1) return 'left'
  return 'both'
}

export default function PageTabs() {
  const { pathname } = useLocation()
  const { currentUser, can, isPlatformAdmin } = useStore()
  const navRef = useRef(null)
  const [fade, setFade] = useState('none')
  // hooks 必須在下面的早退之前;沒有分頁列時 navRef 是 null,effect 直接略過
  useEffect(() => {
    const el = navRef.current
    if (!el) return undefined
    // 選中的 chip 掛載時捲進畫面:只在手機——稽核在 /valuation、/payments 量到分頁列
    // 468 > 358,「逐工項排程」整個在畫面外。桌機分頁列不捲,而且 scrollIntoView 會連帶
    // 捲動整頁,所以不碰。block:nearest 讓垂直方向能不動就不動。
    if (window.matchMedia?.(BELOW_MD_QUERY)?.matches) {
      el.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
    const measure = () => setFade((prev) => { const next = fadeFor(el); return prev === next ? prev : next })
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    // 轉向/縮放後可捲與否會變;jsdom 沒有 ResizeObserver
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', measure); ro?.disconnect() }
  }, [pathname])
  const org = currentUser?.org_type || 'contractor'
  const groups = visibleNavGroups(org, can?.override, isPlatformAdmin)
  const item = groups.flatMap((g) => g.items).find((i) => i.tabs?.some((t) => t.to === pathname))
  if (!item || item.tabs.length < 2) return null
  // pageTabs:false 的頁面不渲染分頁條(入口一律走側欄子項)
  if (item.tabs.find((t) => t.to === pathname)?.pageTabs === false) return null
  return (
    // print:hidden:監造報表等頁面直接 window.print,正式文件頁首不得帶導覽藥丸
    // max-md:snap-x snap-proximity:手機捲停時靠近 chip 邊界就吸附,不強制(mandatory 會擋住細捲)
    <nav ref={navRef} data-fade={fade} aria-label={`${item.label}分頁`}
      className="tabs-scroll flex gap-2 overflow-x-auto mt-3.5 pb-0.5 print:hidden max-md:snap-x max-md:snap-proximity">
      {item.tabs.map((t) => (
        <NavLink key={t.to} to={t.to}
          className={({ isActive }) => `${CHIP_BASE} ${isActive ? CHIP_ON : CHIP_OFF}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
