// 導覽/工作台/路由權限的單一真相來源。W8-1 將業務入口收斂為六個工作面，
// 路由全部保留，深連結與既有角色限制不變；「問 PMIS」是頁首的全域入口，
// 不與六個工作面混成第七個模組。
// roles 缺省=全角色可見;can.override(非正式模式的專案管理者)一律放行。
// Layout 的階層側欄與 App 的路由守衛都吃這一份——
// 「導覽隱藏」與「權限」永遠一致。
// hidden: true=不渲染在側欄/分頁列,但仍參與 routeAllowed 的角色判斷——
// 批 3/批 4 的收斂是「不顯示」,不是「不設限」;刪掉定義會讓 roles 一起消失(權限靜默鬆綁)。
// platformAdminOnly: true=僅平台管理員(產品營運者)可見/可進——這是「平台」維度,
// 與 roles(專案角色 org_type)互相獨立:can.override(專案管理者)也翻不過它。
// 前端隱藏只是 UX;真正的把關在資料庫(每支 admin RPC 第一行檢查 is_platform_admin() 並 raise)。
import {
  LayoutDashboard, LayoutGrid, CalendarClock,
  Coins, PencilLine,
  ShieldCheck, ShieldAlert,
} from 'lucide-react'

export const navGroups = [
  { title: '工作面', items: [
    { to: '/dashboard', icon: LayoutDashboard, label: '今日待辦' },
    { to: '/site-log', icon: ShieldCheck, label: '現場與品質', tabs: [
      { to: '/site-log', label: '施工日誌' },
      { to: '/quality', label: '品質查驗' },
      { to: '/itp', label: '檢驗停留點' },
      { to: '/safety', label: '工安管理' },
    ] },
    { to: '/requirements', icon: PencilLine, label: '審查與協作', tabs: [
      { to: '/requirements', label: '契約重點' },
      { to: '/submittals', label: '送審文件' },
      { to: '/rfi', label: '工程疑義' },
      { to: '/change-orders', label: '變更設計' },
    ] },
    { to: '/boq', icon: Coins, label: '進度與金流', tabs: [
      { to: '/boq', label: '標單工項' },
      { to: '/valuation', label: '估驗計價' },
      { to: '/payments', label: '請款收款', roles: ['contractor', 'owner'] }, // 監造不經手請款
      { to: '/cost', label: '成本管理', roles: ['contractor'] },              // 廠商毛利機密
      { to: '/progress', label: '進度 S 曲線' },
      { to: '/schedule', label: '逐工項排程', roles: ['contractor'] },        // 廠商內部規劃
    ] },
    { to: '/contract', icon: CalendarClock, label: '文件與結案', tabs: [
      { to: '/contract', label: '專案文件' },
      { to: '/monthly-report', label: '施工月報' },
      { to: '/supervisor-report', label: '監造報表', roles: ['supervisor'] },
      { to: '/acceptance', label: '驗收結算' },
    ] },
    { to: '/portfolio', icon: LayoutGrid, label: '專案', tabs: [
      { to: '/portfolio', label: '跨案總覽' },
      { to: '/activity', label: '活動紀錄' },
      { to: '/members', label: '三方成員' },
      { to: '/audit', label: '風險稽核', roles: ['owner'], hidden: true }, // 機關防弊
    ] },
  ] },
  { title: '平台', items: [
    // 平台管理後台(批 C):AI 用量/成本儀表、功能開關、專案方案。僅平台管理員
    // (profiles.is_platform_admin)可見;一般使用者連群組標題都不渲染。
    { to: '/admin', icon: ShieldAlert, label: '平台管理', platformAdminOnly: true },
  ] },
]

// 不出現在導覽的路由也必須明確登記。access 只描述路由表面；
// authenticated 路由一律由 App 的共同 Web guard 驗證登入與專案狀態。
// print 只代表不套 WebLayout，不代表公開。
const nonNavRouteRules = {
  '/': { access: 'redirect' },
  '/login': { access: 'public' },
  '/security': { access: 'public' },
  '/assistant': { access: 'redirect' },
  '/agent': { access: 'authenticated' },
  // 提醒信仍可深連結；入口已由「今日待辦」承接。
  '/alerts': { access: 'authenticated' },
  '/project/new': { access: 'authenticated' },
  '/site-log/print': { access: 'authenticated', surface: 'print' },
  '/valuation/print': { access: 'authenticated', surface: 'print' },
  '/valuation/package': { access: 'authenticated', surface: 'print' },
  '/quality/checklist-print': { access: 'authenticated', surface: 'print' },
  '*': { access: 'authenticated', surface: 'not-found' },
}

const navRouteRules = Object.fromEntries(
  navGroups.flatMap((group) => group.items.flatMap((item) => item.tabs || [item]))
    .map((route) => [route.to, { ...route, access: 'authenticated' }]),
)

// 所有前端路由的權限登記表。新增 App 路由卻忘記登記時，routeAllowed 會 fail-closed。
export const routeRegistry = Object.freeze({ ...navRouteRules, ...nonNavRouteRules })

// platformAdminOnly 是獨立維度:專案角色/override 一律翻不過(平台後台不是專案工具)
const tabAllowed = (n, org, override, platformAdmin) => {
  if (n.platformAdminOnly) return !!platformAdmin
  return !n.roles || override || n.roles.includes(org)
}

// 路由守衛:未登記路由一律拒絕；hidden 項照樣套用 roles。
// platformAdmin 缺省 false:未傳入(舊呼叫點)時平台後台一律擋。
export function routeAllowed(pathname, org, override, platformAdmin = false) {
  const route = routeRegistry[pathname]
  if (!route) return false
  if (route.access === 'public' || route.access === 'redirect') return true
  return tabAllowed(route, org, override, platformAdmin)
}

// 側欄可見項:工作台入口=第一個可見分頁;整組分頁都不可見則隱藏入口。
// hidden 項一律不渲染(權限判斷仍在 routeAllowed 生效)。
export function visibleNavGroups(org, override, platformAdmin = false) {
  return navGroups
    .map((g) => ({
      ...g,
      items: g.items
        .map((item) => {
          if (item.hidden) return null
          if (!item.tabs) return tabAllowed(item, org, override, platformAdmin) ? item : null
          const tabs = item.tabs.filter((t) => !t.hidden && tabAllowed(t, org, override, platformAdmin))
          return tabs.length ? { ...item, to: tabs[0].to, tabs } : null
        })
        .filter(Boolean),
    }))
    .filter((g) => g.items.length)
}
