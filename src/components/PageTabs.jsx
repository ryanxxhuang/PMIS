// 工作面 chips 分頁列(README §頁首):PageHeader 標題塊下方自動渲染。
// 單一真相仍是 navConfig 的 item.tabs+visibleNavGroups 角色過濾——側欄樹與
// 這裡永遠說同一份清單;分頁是真路由(深連結保留),所以是 nav+NavLink,
// 刻意不用 role=tablist(e2e 明文禁止工作面 tablist,語意上也不是 tab)。
// 不 import ui.jsx:PageHeader 引用本元件,反向引用會成環。
import { NavLink, useLocation } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { visibleNavGroups } from '../lib/navConfig.js'

// chips 皮膚常數:Admin 頁內真 tabs(role=tablist)與這裡共用同一套,
// 「兩排都是切換」的視覺意圖不因只改一邊而漂移。
// 不放 ui.jsx——PageHeader→PageTabs 已成鏈,反向 import 會成環。
export const CHIP_BASE = 'h-8 max-md:min-h-11 shrink-0 inline-flex items-center px-3.5 rounded-lg text-[13px] font-medium whitespace-nowrap pressable'
export const CHIP_ON = 'bg-[var(--blue-tint)] text-[var(--blue-text)]'
export const CHIP_OFF = 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'

export default function PageTabs() {
  const { pathname } = useLocation()
  const { currentUser, can, isPlatformAdmin } = useStore()
  const org = currentUser?.org_type || 'contractor'
  const groups = visibleNavGroups(org, can?.override, isPlatformAdmin)
  const item = groups.flatMap((g) => g.items).find((i) => i.tabs?.some((t) => t.to === pathname))
  if (!item || item.tabs.length < 2) return null
  return (
    // print:hidden:監造報表等頁面直接 window.print,正式文件頁首不得帶導覽藥丸
    <nav aria-label={`${item.label}分頁`} className="flex gap-2 overflow-x-auto mt-3.5 pb-0.5 print:hidden">
      {item.tabs.map((t) => (
        <NavLink key={t.to} to={t.to}
          className={({ isActive }) => `${CHIP_BASE} ${isActive ? CHIP_ON : CHIP_OFF}`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
