// 導覽/路由權限的單一真相來源。側欄分區依 UIUX-Apple-設計規範 §0(疊合版 IA):
// 「球在誰手上」是來源(BALL_SOURCES,持有 /dashboard)、「工作」是五組群組+子頁、
// 「參考」是三個查閱面、「平台」是營運者後台。舊的「工作面」層級已降級為來源——
// 所以 /dashboard 不再是這裡的項目,由球權來源獨佔,側欄不會有兩個入口指向同一頁
// (兩個入口並存正是先前 aria-current 要去重複的根因)。
// 「問 GovAgent」是頁首的全域入口,不與任何分區混成一項。
// roles 缺省=全角色可見;can.override(非正式模式的專案管理者)一律放行。
// Layout 的階層側欄與 App 的路由守衛都吃這一份——
// 「導覽隱藏」與「權限」永遠一致。
// hidden: true=不渲染在側欄/分頁列,但仍參與 routeAllowed 的角色判斷——
// 收斂是「不顯示」,不是「不設限」;刪掉定義會讓 roles 一起消失(權限靜默鬆綁)。
// 目前沒有任何 hidden 項(2026-09-11 解封五個群組),機制留給下一次收斂。
// platformAdminOnly: true=僅平台管理員(產品營運者)可見/可進——這是「平台」維度,
// 與 roles(專案角色 org_type)互相獨立:can.override(專案管理者)也翻不過它。
// 前端隱藏只是 UX;真正的把關在資料庫(每支 admin RPC 第一行檢查 is_platform_admin() 並 raise)。
// icon 是 Material Symbols 的 ligature 名(字串),由 Layout 的 <MSym> 渲染——
// 七枚對應 handoff README 的指定,不做 lucide 字面對譯。
export const navGroups = [
  { title: '工作', items: [
    // 群組入口=第一個該角色可見的子頁(visibleNavGroups 決定),整組子頁都不可見就不渲染該組。
    { to: '/site-log', icon: 'engineering', label: '現場與品質', tabs: [
      { to: '/site-log', label: '施工日誌' },
      { to: '/quality', label: '品質查驗' },
      { to: '/itp', label: '檢驗停留點' },
      { to: '/safety', label: '工安管理' },
    ] },
    { to: '/submittals', icon: 'rate_review', label: '審查與協作', tabs: [
      { to: '/submittals', label: '送審文件' },
      { to: '/rfi', label: '工程疑義' },
      { to: '/change-orders', label: '變更設計' },
    ] },
    { to: '/valuation', icon: 'payments', label: '進度與金流', tabs: [
      { to: '/valuation', label: '估驗計價' },
      { to: '/payments', label: '請款收款', roles: ['contractor', 'owner'] }, // 監造不經手請款
      { to: '/cost', label: '成本管理', roles: ['contractor'] },              // 廠商毛利機密
      { to: '/progress', label: '進度 S 曲線' },
      { to: '/schedule', label: '逐工項排程', roles: ['contractor'] },        // 廠商內部規劃
    ] },
    { to: '/monthly-report', icon: 'folder', label: '報表與結案', tabs: [
      { to: '/monthly-report', label: '施工月報' },
      { to: '/supervisor-report', label: '監造報表', roles: ['supervisor'] },
      { to: '/acceptance', label: '驗收結算' },
    ] },
    { to: '/portfolio', icon: 'grid_view', label: '專案', tabs: [
      { to: '/portfolio', label: '跨案總覽' },
      { to: '/activity', label: '活動紀錄' },
      { to: '/members', label: '三方成員' },
      // 機關防弊:roles 限機關。顯示與否不影響角色限制(曾因 hidden 收斂成全站死功能)
      { to: '/audit', label: '風險稽核', roles: ['owner'] },
    ] },
  ] },
  { title: '參考', items: [
    // 查閱面:不是待辦也不是流程,是做事時翻的參考書(D-017:契約重點=三方檢索參考書)。
    // 三項都是扁平項(無子頁),側欄與 BottomNav 直達。
    // 天平=契約條文;刻意不與「審查與協作」共用 rate_review——收合成 icon rail 時
    // 只剩圖示+短標,兩個並列項用同一個圖示會直接讓人認錯。
    { to: '/requirements', icon: 'balance', label: '契約重點' },
    // W11 文件管理員:整案文件的唯一上傳/歸檔窗口(第一次+文件更新才用)。
    // 上傳後 AI 自動分類歸檔,結果分流到標單工項/契約重點/S 曲線。
    { to: '/contract', icon: 'cloud_upload', label: '專案文件' },
    // 清單=逐項量價;同上,不與「進度與金流」共用 payments。
    { to: '/boq', icon: 'list_alt', label: '標單工項' },
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
// short 是刻意的例外(表現欄位進 navConfig):NAV_SHORT 是工作/參考項的顯示層 map,
// 球權來源不在那份裡;rail 與 BottomNav 的主畫面槽(現在輪到我)都直接讀這個 short,
// 免得再開第三份對照表。
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
  // 服務條款／隱私權政策:採購資安查核與個資法告知義務都要求不登入即可讀。
  '/terms': { access: 'public' },
  '/privacy': { access: 'public' },
  '/assistant': { access: 'redirect' },
  // 帳號安全(兩步驟驗證啟用/停用):個人層,不限角色、不進導覽,入口在頁首「帳號」。
  '/account': { access: 'authenticated' },
  // 收件匣(今日待辦):球權來源三個入口共用這條路由(?ball= 分流)。來源不是 navGroups
  // 的項目,所以登記在這裡;不限角色——它同時是落地頁,人人都必須進得去。
  '/dashboard': { access: 'authenticated' },
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

// 預設落地頁(規範 §0 方向 A):所有角色一律落在收件匣「現在輪到我」,不依角色分流——
// 跨案總覽是「專案」群組的子頁,多案角色一格就到,不必用落地頁替他選案。
// 參數保留:呼叫端(App/Layout)都傳 org_type,簽章不動。
export function defaultLandingPath(_orgType) {
  return '/dashboard'
}

// 側欄可見項:群組入口=第一個可見子頁;整組子頁都不可見則隱藏該組(角色過濾只在這裡做,
// Layout/PageTabs/BottomNav 都吃輸出)。hidden 項一律不渲染(權限判斷仍在 routeAllowed 生效)。
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
