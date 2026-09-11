// 導覽/工作台/路由權限的單一真相來源。W8-1 將業務入口收斂為六個工作面，
// 路由全部保留，深連結與既有角色限制不變；「問 GovAgent」是頁首的全域入口，
// 不與六個工作面混成第七個模組。
// roles 缺省=全角色可見;can.override(非正式模式的專案管理者)一律放行。
// Layout 的階層側欄與 App 的路由守衛都吃這一份——
// 「導覽隱藏」與「權限」永遠一致。
// hidden: true=不渲染在側欄/分頁列,但仍參與 routeAllowed 的角色判斷——
// 批 3/批 4 的收斂是「不顯示」,不是「不設限」;刪掉定義會讓 roles 一起消失(權限靜默鬆綁)。
// platformAdminOnly: true=僅平台管理員(產品營運者)可見/可進——這是「平台」維度,
// 與 roles(專案角色 org_type)互相獨立:can.override(專案管理者)也翻不過它。
// 前端隱藏只是 UX;真正的把關在資料庫(每支 admin RPC 第一行檢查 is_platform_admin() 並 raise)。
// icon 是 Material Symbols 的 ligature 名(字串),由 Layout 的 <MSym> 渲染——
// 七枚對應 handoff README 的指定,不做 lucide 字面對譯。
export const navGroups = [
  { title: '工作面', items: [
    // ── 精修期最小表面(2026-08-25 使用者指示):側欄只留四個入口,
    // 一個功能精修完成再逐項取消 hidden。其餘路由/深連結/角色限制全部
    // 保留——今日待辦與初始化清單仍會導向隱藏頁,routeRegistry 不因隱藏鬆動。
    { to: '/dashboard', icon: 'checklist', label: '今日待辦' },
    { to: '/contract', icon: 'cloud_upload', label: '專案文件' },
    { to: '/requirements', icon: 'rate_review', label: '契約重點' },
    { to: '/boq', icon: 'payments', label: '標單工項' },
    // ── 以下暫別側欄(hidden:true)。定義原樣保留:roles 即權限,刪掉定義
    // 會讓權限靜默鬆綁(批 3/批 4 教訓);加回=移除 hidden 一行。──
    { to: '/site-log', icon: 'engineering', label: '現場與品質', hidden: true, tabs: [
      { to: '/site-log', label: '施工日誌' },
      { to: '/quality', label: '品質查驗' },
      { to: '/itp', label: '檢驗停留點' },
      { to: '/safety', label: '工安管理' },
    ] },
    { to: '/submittals', icon: 'rate_review', label: '審查與協作', hidden: true, tabs: [
      { to: '/submittals', label: '送審文件' },
      { to: '/rfi', label: '工程疑義' },
      { to: '/change-orders', label: '變更設計' },
    ] },
    { to: '/valuation', icon: 'payments', label: '進度與金流', hidden: true, tabs: [
      { to: '/valuation', label: '估驗計價' },
      { to: '/payments', label: '請款收款', roles: ['contractor', 'owner'] }, // 監造不經手請款
      { to: '/cost', label: '成本管理', roles: ['contractor'] },              // 廠商毛利機密
      { to: '/progress', label: '進度 S 曲線' },
      { to: '/schedule', label: '逐工項排程', roles: ['contractor'] },        // 廠商內部規劃
    ] },
    { to: '/monthly-report', icon: 'folder', label: '報表與結案', hidden: true, tabs: [
      { to: '/monthly-report', label: '施工月報' },
      { to: '/supervisor-report', label: '監造報表', roles: ['supervisor'] },
      { to: '/acceptance', label: '驗收結算' },
    ] },
    { to: '/portfolio', icon: 'grid_view', label: '專案', hidden: true, tabs: [
      { to: '/portfolio', label: '跨案總覽' },
      { to: '/activity', label: '活動紀錄' },
      { to: '/members', label: '三方成員' },
      // 機關防弊:roles 限機關;精修期整組暫別側欄,深連結與角色限制不動
      { to: '/audit', label: '風險稽核', roles: ['owner'] },
    ] },
  ] },
  { title: '平台', items: [
    // 平台管理後台(批 C):AI 用量/成本儀表、功能開關、專案方案。僅平台管理員
    // (profiles.is_platform_admin)可見;一般使用者連群組標題都不渲染。
    { to: '/admin', icon: 'admin_panel_settings', label: '平台管理', platformAdminOnly: true },
  ] },
]

// ── 球權來源(Apple 改版第二包,疊合版 IA §0)──────────────────────────
// 主畫面不是 dashboard,是收件匣:側欄先問「球在誰手上」,三個來源 1:1 對上
// buildTodayTasks 回傳的 { mine, waiting, doneToday },不新增任何查詢。
// 走 query param 而不是新路由:routeRegistry 以 pathname 為鍵,query 不進
// routeAllowed,三個來源共用 /dashboard 的登記與角色判斷——權限零變動,
// 也不必為同一頁登記三條假路由。
// short 是刻意的例外(表現欄位進 navConfig):NAV_SHORT 是 BottomNav 的顯示層 map,
// 球權來源不進 BottomNav,所以不共用那份;rail 短標跟著定義走,免得再開第三份對照表。
// label 沿用頁內區塊既有的產品用語(現在輪到我/等待對方/今天已完成),不另造一組
// 「待我處理/等對方/已完成」——同一件事兩套詞會讓側欄與頁內對不起來,也會讓既有
// e2e 與使用者記憶失效。side rail 的短標才縮。
export const BALL_SOURCES = [
  { key: 'mine', label: '現在輪到我', short: '輪到我', icon: 'inbox', to: '/dashboard' },
  { key: 'waiting', label: '等待對方', short: '等對方', icon: 'hourglass_top', to: '/dashboard?ball=waiting' },
  { key: 'done', label: '今天已完成', short: '已完成', icon: 'task_alt', to: '/dashboard?ball=done' },
]

// 解析 ?ball=:缺省或未知值一律落回 mine(fail-safe:亂打參數看到的是「待我處理」,
// 不是空白頁)。Layout 的選取態與 Dashboard 的聚焦都吃這一支,兩邊各解析一次遲早分岔。
export function resolveBallKey(searchParams) {
  const v = searchParams?.get('ball')
  return BALL_SOURCES.some((b) => b.key === v) ? v : 'mine'
}

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
  // 期限追蹤:契約重點頁改版後遷出的到期管理(逐項清單/已提送/罰款試算/基準日)。
  // 入口=契約重點詳情的關聯列與今日待辦,不進導覽。
  '/deadlines': { access: 'authenticated' },
  // 擷取審核:契約重點改版為履約時程後,AI 建議的核定/駁回與手動補登遷到這裡。
  // 入口=履約時程頁首「擷取審核」,不進導覽;廠商唯讀+可補登,審核限監造/機關(鏡像 DB)。
  '/requirements/review': { access: 'authenticated' },
  '/project/new': { access: 'authenticated' },
  '/site-log/print': { access: 'authenticated', surface: 'print' },
  '/valuation/print': { access: 'authenticated', surface: 'print' },
  '/valuation/package': { access: 'authenticated', surface: 'print' },
  '/quality/checklist-print': { access: 'authenticated', surface: 'print' },
  '/contract/print': { access: 'authenticated', surface: 'print' },
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

// 預設落地頁:精修期(2026-08-25)最小表面只剩四個入口,跨案總覽暫別側欄——
// 所有角色一律落在今日待辦。恢復「專案」工作面時,把多案角色(owner/supervisor)
// 的 /portfolio 分流還原(原邏輯:管十幾案的監造事務所落單案 dashboard 等於
// 一進門先叫他選案)。
export function defaultLandingPath(_orgType) {
  return '/dashboard'
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
