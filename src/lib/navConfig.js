// 導覽/工作台/路由權限的單一真相來源(QA 報告 §9 系統瘦身:相關工具整併成
// 工作台分頁,導覽從 22 項收斂;路由全部保留,深連結與提醒中心導向不變)。
// roles 缺省=全角色可見;can.override(非正式模式的專案管理者)一律放行。
// Layout 的側欄、App 的路由守衛、WorkbenchTabs 分頁列都吃這一份——
// 「導覽隱藏」與「權限」永遠一致。
import {
  LayoutDashboard, LayoutGrid, Bell, CalendarClock, Newspaper, BadgeCheck,
  ClipboardList, PencilLine, Coins, Wallet, TrendingUp,
  ShieldCheck, HardHat, FileCheck2, Users, History,
} from 'lucide-react'

export const navGroups = [
  { title: '總覽', items: [
    { to: '/portfolio', icon: LayoutGrid, label: '跨案總覽' },
    { to: '/dashboard', icon: LayoutDashboard, label: '專案 Dashboard' },
    { to: '/alerts', icon: Bell, label: '提醒中心' },
    { to: '/activity', icon: History, label: '活動紀錄' },
    { to: '/contract', icon: CalendarClock, label: '契約與文件', tabs: [
      { to: '/contract', label: '專案文件' },
      { to: '/requirements', label: '履約需求' },
      { to: '/audit', label: '風險稽核', roles: ['owner'] },     // 機關防弊
    ] },
    { to: '/acceptance', icon: BadgeCheck, label: '驗收結算' },
    { to: '/monthly-report', icon: Newspaper, label: '報表中心', tabs: [
      { to: '/monthly-report', label: '施工月報' },
      { to: '/supervisor-report', label: '監造報表', roles: ['supervisor'] },
    ] },
  ] },
  { title: '成本與進度', items: [
    { to: '/boq', icon: ClipboardList, label: '標單工項' },
    { to: '/site-log', icon: PencilLine, label: '施工日誌' },
    { to: '/valuation', icon: Coins, label: '估驗與金流', tabs: [
      { to: '/valuation', label: '估驗計價' },
      { to: '/payments', label: '請款收款', roles: ['contractor', 'owner'] }, // 監造不經手請款
    ] },
    { to: '/cost', icon: Wallet, label: '成本管理', roles: ['contractor'] },  // 廠商毛利機密
    { to: '/progress', icon: TrendingUp, label: '進度管制', tabs: [
      { to: '/progress', label: '進度 S 曲線' },
      { to: '/schedule', label: '逐工項排程', roles: ['contractor'] },        // 廠商內部規劃
    ] },
  ] },
  { title: '品質與工安', items: [
    { to: '/quality', icon: ShieldCheck, label: '品質管理', tabs: [
      { to: '/quality', label: '品質查驗' },
      { to: '/itp', label: '檢驗停留點' },
    ] },
    { to: '/safety', icon: HardHat, label: '工安管理' },
  ] },
  { title: '協作', items: [
    { to: '/submittals', icon: FileCheck2, label: '技術協作', tabs: [
      { to: '/submittals', label: '送審文件' },
      { to: '/rfi', label: '工程疑義' },
      { to: '/change-orders', label: '變更設計' },
    ] },
    { to: '/members', icon: Users, label: '專案成員' },
  ] },
]

const tabAllowed = (n, org, override) => !n.roles || override || n.roles.includes(org)

// 路由守衛:導覽/分頁未列的路由(列印頁、建案頁…)不設角色限制
export function routeAllowed(pathname, org, override) {
  for (const g of navGroups) for (const item of g.items) {
    for (const n of (item.tabs || [item])) {
      if (n.to === pathname) return tabAllowed(n, org, override)
    }
  }
  return true
}

// 此路由所屬工作台(供分頁列渲染);單頁路由回 null
export function workbenchFor(pathname, org, override) {
  for (const g of navGroups) for (const item of g.items) {
    if (item.tabs?.some((t) => t.to === pathname)) {
      return { label: item.label, tabs: item.tabs.filter((t) => tabAllowed(t, org, override)) }
    }
  }
  return null
}

// 側欄可見項:工作台入口=第一個可見分頁;整組分頁都不可見則隱藏入口
export function visibleNavGroups(org, override) {
  return navGroups
    .map((g) => ({
      ...g,
      items: g.items
        .map((item) => {
          if (!item.tabs) return tabAllowed(item, org, override) ? item : null
          const tabs = item.tabs.filter((t) => tabAllowed(t, org, override))
          return tabs.length ? { ...item, to: tabs[0].to, tabs } : null
        })
        .filter(Boolean),
    }))
    .filter((g) => g.items.length)
}
