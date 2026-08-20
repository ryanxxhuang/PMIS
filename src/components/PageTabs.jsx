// 工作面 chips 分頁列(README §頁首):PageHeader 標題塊下方自動渲染。
// 單一真相仍是 navConfig 的 item.tabs+visibleNavGroups 角色過濾——側欄樹與
// 這裡永遠說同一份清單;分頁是真路由(深連結保留),所以是 nav+NavLink,
// 刻意不用 role=tablist(e2e 明文禁止工作面 tablist,語意上也不是 tab)。
// 不 import ui.jsx:PageHeader 引用本元件,反向引用會成環。
import { NavLink, useLocation } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { visibleNavGroups } from '../lib/navConfig.js'

export default function PageTabs() {
  const { pathname } = useLocation()
  const { currentUser, can, isPlatformAdmin } = useStore()
  const org = currentUser?.org_type || 'contractor'
  const groups = visibleNavGroups(org, can?.override, isPlatformAdmin)
  const item = groups.flatMap((g) => g.items).find((i) => i.tabs?.some((t) => t.to === pathname))
  if (!item || item.tabs.length < 2) return null
  return (
    <nav aria-label={`${item.label}分頁`} className="flex gap-2 overflow-x-auto mt-3.5 pb-0.5">
      {item.tabs.map((t) => (
        <NavLink key={t.to} to={t.to}
          className={({ isActive }) => `h-8 max-sm:min-h-11 shrink-0 inline-flex items-center px-3.5 rounded-lg text-[13px] font-medium whitespace-nowrap pressable ${
            isActive
              ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]'
              : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
          }`}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
