// 導覽/工作台/路由權限的單一真相來源(QA 報告 §9 系統瘦身:相關工具整併成
// 工作台分頁,導覽從 22 項收斂;批 6 再收斂到 9 個可見項;路由全部保留,
// 深連結與提醒中心導向不變)。
// roles 缺省=全角色可見;can.override(非正式模式的專案管理者)一律放行。
// Layout 的側欄、App 的路由守衛、WorkbenchTabs 分頁列都吃這一份——
// 「導覽隱藏」與「權限」永遠一致。
// hidden: true=不渲染在側欄/分頁列,但仍參與 routeAllowed 的角色判斷——
// 批 3/批 4 的收斂是「不顯示」,不是「不設限」;刪掉定義會讓 roles 一起消失(權限靜默鬆綁)。
// platformAdminOnly: true=僅平台管理員(產品營運者)可見/可進——這是「平台」維度,
// 與 roles(專案角色 org_type)互相獨立:can.override(專案管理者)也翻不過它。
// 前端隱藏只是 UX;真正的把關在資料庫(每支 admin RPC 第一行檢查 is_platform_admin() 並 raise)。
import {
  LayoutDashboard, LayoutGrid, Bell, CalendarClock, BadgeCheck,
  ClipboardList, Coins, PencilLine,
  ShieldCheck, Users, Bot, ShieldAlert,
} from 'lucide-react'

export const navGroups = [
  { title: '總覽', items: [
    { to: '/agent', icon: Bot, label: 'AI Agent' },
    { to: '/portfolio', icon: LayoutGrid, label: '跨案總覽' },
    { to: '/dashboard', icon: LayoutDashboard, label: '專案儀表', tabs: [
      { to: '/dashboard', label: '專案 Dashboard' },
      { to: '/activity', label: '活動紀錄' },
      { to: '/monthly-report', label: '施工月報' },
      { to: '/supervisor-report', label: '監造報表', roles: ['supervisor'] },
    ] },
    // 「提醒中心」已自側欄隱藏(批6 產品原則:agent 能做的就把手動入口藏起來)——
    // agent 主控台的「今日待我處理」吃同一份 ball-in-court 資料;每日提醒信仍深連結到本頁。
    // 路由保留(App.jsx 不動);本頁不限角色,留定義是讓機制一致(隱藏≠移除)。
    { to: '/alerts', icon: Bell, label: '提醒中心', hidden: true },
  ] },
  { title: '成本與進度', items: [
    { to: '/boq', icon: ClipboardList, label: '標單工項' },
    { to: '/valuation', icon: Coins, label: '估驗與金流', tabs: [
      { to: '/valuation', label: '估驗計價' },
      { to: '/payments', label: '請款收款', roles: ['contractor', 'owner'] }, // 監造不經手請款
      { to: '/cost', label: '成本管理', roles: ['contractor'] },              // 廠商毛利機密
      { to: '/progress', label: '進度 S 曲線' },
      { to: '/schedule', label: '逐工項排程', roles: ['contractor'] },        // 廠商內部規劃
    ] },
    // 「施工日誌」曾自側欄隱藏(批3 原則:agent 能做的就把手動入口藏起來),
    // **2026-08-12 dry-run 改回顯示**:實測連產品擁有者自己都找不到入口
    // (原話「各個功能模塊放的地方很亂,很沒有邏輯」),現場工程師更不可能。
    // 教訓:「agent 能做」不等於「入口可以消失」——藏入口的前提是 agent 那條路
    // 本身高度可發現,而 /agent 收件匣底部的次要入口顯然不夠。
    // 收斂原則不變,但要等導覽 IA 重新檢視後,連同 agent 路徑一起設計(dry-run 問題 #10)。
    { to: '/site-log', icon: PencilLine, label: '施工日誌' },
  ] },
  { title: '品質與工安', items: [
    { to: '/quality', icon: ShieldCheck, label: '品質與工安', tabs: [
      { to: '/quality', label: '品質查驗' },
      { to: '/itp', label: '檢驗停留點' },
      { to: '/safety', label: '工安管理' },
    ] },
  ] },
  { title: '契約與協作', items: [
    // 「風險稽核」(/audit)已自分頁隱藏(批4 產品原則:agent 能做的就把手動入口藏起來)——
    // 機關/監造 agent 的 run_integrity_audit 在對話裡就能跑出同一份確定性發現,
    // 還會寫成稽核提示草稿進 /agent 收件匣。路由保留(App.jsx 不動),機關深連結照常;
    // hidden=不顯示但不解除限制:roles 必須留著,否則刪掉定義=任何角色都能深連結進防弊稽核。
    { to: '/contract', icon: CalendarClock, label: '契約與協作', tabs: [
      { to: '/contract', label: '專案文件' },
      { to: '/requirements', label: '履約需求' },
      { to: '/submittals', label: '送審文件' },
      { to: '/rfi', label: '工程疑義' },
      { to: '/change-orders', label: '變更設計' },
      { to: '/audit', label: '風險稽核', roles: ['owner'], hidden: true }, // 機關防弊
    ] },
    { to: '/acceptance', icon: BadgeCheck, label: '驗收結算' },
    { to: '/members', icon: Users, label: '專案成員' },
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

// 此路由所屬工作台(供分頁列渲染);單頁路由回 null。
// hidden 分頁不出現在分頁列;深連結進 hidden 分頁(如 /audit)視為單頁、不掛工作台。
export function workbenchFor(pathname, org, override, platformAdmin = false) {
  for (const g of navGroups) for (const item of g.items) {
    const hit = item.tabs?.find((t) => t.to === pathname)
    if (hit) {
      if (hit.hidden) return null
      return {
        label: item.label,
        tabs: item.tabs.filter((t) => !t.hidden && tabAllowed(t, org, override, platformAdmin)),
      }
    }
  }
  return null
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
