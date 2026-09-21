// 導覽/路由權限的單一真相來源。側欄分區依 D-026 四主入口(2026-09-17 瘦身 P1a):
// 「今日工作」是來源(BALL_SOURCES,持有 /dashboard)、「工作」是三個主入口群組
// (現場紀錄/履約時程/估驗請款)+子頁、「專案資料」是次入口兩組(文件往來/專案)、
// 「平台」是營運者後台。/dashboard 不是這裡的項目,由球權來源獨佔,側欄不會有兩個
// 入口指向同一頁(兩個入口並存正是先前 aria-current 要去重複的根因)。
// 「問 GovAgent」是頁首的全域入口,不與任何分區混成一項。
// roles 缺省=全角色可見;can.override(非正式模式的專案管理者)一律放行。
// Layout 的階層側欄與 App 的路由守衛都吃這一份——
// 「導覽隱藏」與「權限」永遠一致。
// hidden: true=不渲染在側欄/分頁列/尋找功能,但仍參與 routeAllowed 的角色判斷——
// 收斂是「不顯示」,不是「不設限」;刪掉定義會讓 roles 一起消失(權限靜默鬆綁)。
// hiddenFor: ['contractor']=只對這些 org_type 不渲染,roles 一字不動(2026-09-20 廠商驗收 A 包)。
// 這是「導覽」維度,與 roles(授權)分開:廠商的主選單/分頁/現場作業卡不該列監造的作業,
// 但監造提送給廠商的文件、既有深連結與收件動作必須照原權限唯讀進得去——用 roles 收會連
// 唯讀查閱一起關掉(誤刪廠商應收的查驗結果與計價依據),那是驗收明文禁止的。
// 與 roles 的另一個差別:override(非正式模式的專案管理者)翻不過 hiddenFor——
// 驗收要求「一般廠商帳號含專案 admin 情境」都看不到監造作業入口,而 override 對 roles 一律放行。
// 退場模組(D-026 §4):/cost(廠商成本)仍是頁面,只 hidden——歷史查閱與 CSV 匯出仍在這一頁。
// /schedule(廠商逐工項排程)與 /audit(機關風險稽核)的頁面已於 P6b 移除(承接到履約時程／估驗計價),
// 路由改登記在 nonNavRouteRules 的 access: 'retired'——原 roles 照樣守衛,放行後才導到承接位置。
// platformAdminOnly: true=僅平台管理員(產品營運者)可見/可進——這是「平台」維度,
// 與 roles(專案角色 org_type)互相獨立:can.override(專案管理者)也翻不過它。
// 前端隱藏只是 UX;真正的把關在資料庫(每支 admin RPC 第一行檢查 is_platform_admin() 並 raise)。
// 廠商三核心(2026-09-21 demo 急件):廠商的導覽只剩「施工文件／契約與提醒／估驗請款」三個入口——
// labelFor/shortFor 只換該角色看到的群組名;onlyFor: [<org_type>] 是 hiddenFor 的反面(只對列名角色渲染),
// 用來把廠商核心流程必要的送審／疑義／契約上傳收進「契約與提醒」,同一路由在原群組對廠商 hiddenFor。
// 三者都只影響渲染,routeAllowed 一律不讀——深連結、提醒信與舊書籤照原 roles 進得去。
// icon 是 Material Symbols 的 ligature 名(字串),由 Layout 的 <MSym> 渲染。
// short 是群組/扁平項在 icon rail 與手機底欄的短標(≤2 字):與 label 同住一處,
// 改名時不會漏掉另一份對照表(先前 BottomNav 的 NAV_SHORT 以 label 當鍵,label 一改就靜默退回全名)。
// 「工作」分區名:側欄分區標題與桌機首頁的主入口列(CommonWork)同一份——同一組入口在兩處
// 用兩個名字(先前首頁叫「廠商常用」)會讓人以為是兩套東西。
// 同理,/dashboard 的頁名只有 BALL_SOURCES_TITLE 一份(側欄分區、h1、返回連結、指路文案都吃它)。
export const WORK_TITLE = '工作'

export const navGroups = [
  { title: WORK_TITLE, items: [
    // 群組入口=第一個該角色可見的子頁(visibleNavGroups 決定),整組子頁都不可見就不渲染該組。
    // 現場紀錄:/site 是總覽(依角色列出現場作業入口與件數;P2c 起承載照片上傳與文書清單),
    // 子頁是既有的日誌/品質/停留點/工安——業務規則與權限一條不動。
    // 監造日誌(P3a):每日一份的監造文件——監造填寫簽署、專案成員可讀(Q4 暫行)、提送機關;不限角色,
    // 頁內依 org 決定可編／唯讀／收件(伺服器 RLS／RPC 才是邊界)。
    // 自主檢查表(P3b):廠商的自檢文件——照片起稿、實測值人填、簽署即寫 checklist_records、提送監造;不限角色,
    // 頁內依 org 決定可編／唯讀／收件;既有 /quality 檢查表分段仍列直接寫入的紀錄與簽署落下的紀錄。
    // 廠商看到的名字是「施工文件」,入口直接是施工日誌(現場總覽的上傳批次／候選文書對廠商收起:照片改在表單內上傳填表)
    { to: '/site', icon: 'engineering', label: '現場紀錄', short: '現場', labelFor: { contractor: '施工文件' }, shortFor: { contractor: '文件' }, tabs: [
      { to: '/site', label: '現場總覽', hiddenFor: ['contractor'] },
      { to: '/site-log', label: '施工日誌' },
      // 監造日誌／監造查驗表單是監造的作業,不是廠商的(2026-09-20 廠商驗收 A 包):
      // 導覽對廠商收起(hiddenFor),roles 不動——廠商仍可由品質查驗詳情、今日工作待辦與舊連結
      // 唯讀開啟查驗判定與確認數量(可估驗依據),監造提送後照原流程收件或退回。
      { to: '/supervisor-log', label: '監造日誌', hiddenFor: ['contractor'] },
      { to: '/self-check', label: '自主檢查表' },
      { to: '/inspection-form', label: '監造查驗表單', hiddenFor: ['contractor'] },
      { to: '/quality', label: '品質查驗' },
      // 檢驗停留點:入口嵌回品質查驗(查驗分段就地申請),不再與查驗並列;深連結與提醒不變
      { to: '/itp', label: '檢驗停留點', hidden: true },
      // 工安工作區:本輪先收起獨立入口(工安缺失仍走同一套缺失引擎,提醒與歷史不動)
      { to: '/safety', label: '工安管理', hidden: true },
    ] },
    // 履約時程:原「契約重點」參考項升為主入口;期限追蹤與擷取審核由非導覽路由改為子頁
    // (仍不限角色),變更設計自「審查與協作」移入、驗收與進度自「報表/金流」移入。
    // 廠商看到的名字是「契約與提醒」:契約上傳(專案文件)、送審與疑義收進這一組(onlyFor),原群組對廠商收起
    { to: '/requirements', icon: 'balance', label: '履約時程', short: '履約', labelFor: { contractor: '契約與提醒' }, shortFor: { contractor: '契約' }, tabs: [
      { to: '/requirements', label: '契約重點' },
      { to: '/deadlines', label: '期限追蹤' },
      { to: '/contract', label: '契約上傳', onlyFor: ['contractor'] },
      { to: '/requirements/review', label: '擷取審核' },
      { to: '/submittals', label: '送審文件', onlyFor: ['contractor'] },
      { to: '/rfi', label: '工程疑義', onlyFor: ['contractor'] },
      { to: '/change-orders', label: '變更設計' },
      // 進度 S 曲線:本輪先收起獨立入口(履約時程與估驗已帶進度口徑);頁面與資料不動
      { to: '/progress', label: '進度 S 曲線', hidden: true },
      { to: '/acceptance', label: '驗收結算' },
    ] },
    // 估驗請款:原「進度與金流」去掉排程、成本改 hidden;標單工項由參考項移入(逐項量價是估驗的依據)。
    { to: '/valuation', icon: 'payments', label: '估驗請款', short: '估驗', tabs: [
      { to: '/valuation', label: '估驗計價' },
      { to: '/payments', label: '請款收款', roles: ['contractor', 'owner'] }, // 監造不經手請款
      { to: '/boq', label: '標單工項' },
      { to: '/cost', label: '成本管理', roles: ['contractor'], hidden: true }, // 廠商毛利機密;退場只留歷史查閱
    ] },
  ] },
  { title: '專案資料', items: [
    // 次入口:三方往來的文件(送審/疑義)與月報。送審與疑義的待辦仍走今日工作;
    // 月報改名「監造月報」是為了與 P3a 的每日「監造日誌」區分(D-026 §2)。
    { to: '/submittals', icon: 'rate_review', label: '文件往來', short: '文件', hiddenFor: ['contractor'], tabs: [
      { to: '/submittals', label: '送審文件' },
      { to: '/rfi', label: '工程疑義' },
      // 月報:本輪先收起獨立入口(P6a 起兩張月報都只彙整已簽署文件,是衍生視圖不是新作業);
      // roles 不動,提醒信與舊連結照原角色可達
      { to: '/monthly-report', label: '施工月報', hidden: true },
      { to: '/supervisor-report', label: '監造月報', roles: ['supervisor'], hidden: true },
    ] },
    // 專案:文件來源(專案文件=整案文件的唯一上傳/歸檔窗口)、成員、歷史查閱與選案。
    { to: '/contract', icon: 'folder', label: '專案', short: '專案', hiddenFor: ['contractor'], tabs: [
      { to: '/contract', label: '專案文件' },
      { to: '/members', label: '三方成員' },
      { to: '/activity', label: '活動紀錄' },
      // 跨案總覽:本輪先收起獨立入口(選案改由頁首的專案切換器,一格就到);頁面與 RPC 不動
      { to: '/portfolio', label: '跨案總覽', hidden: true },
    ] },
  ] },
  { title: '平台', items: [
    // 平台管理後台(批 C):AI 用量/成本儀表、功能開關、專案方案。僅平台管理員
    // (profiles.is_platform_admin)可見;一般使用者連群組標題都不渲染。
    { to: '/admin', icon: 'admin_panel_settings', label: '平台管理', short: '平台', platformAdminOnly: true },
  ] },
]

// ── 球權來源(疊合版 IA §0;D-026 後即「今日工作」主入口)──────────────
// 主畫面不是 dashboard,是收件匣:側欄先問「球在誰手上」,三個來源 1:1 對上
// buildTodayTasks 回傳的 { mine, waiting, doneToday },不新增任何查詢。
// 走 query param 而不是新路由:routeRegistry 以 pathname 為鍵,query 不進
// routeAllowed,三個來源共用 /dashboard 的登記與角色判斷——權限零變動,
// 也不必為同一頁登記三條假路由。
// 分區標題與 navGroups 的 title 同住這裡:側欄的每個分區名都只有一份定義。
// label 沿用頁內區塊既有的產品用語(現在輪到我/等待對方/今天已完成),不另造一組
// 「待我處理/等對方/已完成」——同一件事兩套詞會讓側欄與頁內對不起來,也會讓既有
// e2e 與使用者記憶失效。side rail 的短標才縮。
export const BALL_SOURCES_TITLE = '今日工作'
export const BALL_SOURCES = [
  { key: 'mine', label: '現在輪到我', short: '輪到我', icon: 'inbox', to: '/dashboard' },
  { key: 'waiting', label: '等待對方', short: '等對方', icon: 'hourglass_top', to: '/dashboard?ball=waiting' },
  { key: 'done', label: '今天已完成', short: '已完成', icon: 'task_alt', to: '/dashboard?ball=done' },
]

// 操作提示與常用入口只描述既有流程；不參與授權或推導單據狀態。
// 三方的常用入口=三個主入口群組,三角色相同(D-026 §4:主入口只有今日工作/現場紀錄/
// 履約時程/估驗請款;今日工作是底欄的主畫面槽)。角色差異不在「去哪一頁」,在頁內依角色
// 列出的作業——所以這裡只剩角色標籤與摘要,不再各存一份 paths。
export const MAIN_ENTRY_PATHS = ['/site', '/requirements', '/valuation']
export const ROLE_WORK = {
  contractor: { label: '廠商', summary: '記錄現場、提送資料，追蹤補正與請款。' },
  supervisor: { label: '監造', summary: '查驗現場、審查提送，將需核定事項交給機關。' },
  owner: { label: '機關', summary: '辦理核定、登錄付款紀錄，掌握履約風險及驗收。' },
}

export const WORK_GUIDANCE = {
  '/site': { contractor: '從這裡進入日誌、自主檢查、查驗申請與工安紀錄；件數只計本案尚未處理的事項。', supervisor: '從這裡進入待判定查驗、缺失複查與監造紀錄；件數只計本案尚未處理的事項。', owner: '查閱本案現場紀錄、查驗結果與缺失改善情形；件數只計本案尚未結案的事項。' },
  '/site-log': { contractor: '填寫日期、施作數量與照片，儲存後可供估驗帶入數量。', supervisor: '查閱廠商日誌與現場佐證，需要查驗時前往品質查驗。', owner: '查閱每日施工紀錄與照片，掌握現場執行情形。' },
  '/quality': { contractor: '簽署自主檢查表後申請查驗；收到缺失時改善，再提送監造複查。', supervisor: '選擇待查驗項目，以監造查驗表單判定並填確認數量後簽署；不合格開立缺失，改善後複查結案。', owner: '查閱查驗結果與缺失改善紀錄，追蹤尚未結案的事項。' },
  '/self-check': { contractor: '審核系統擬好的自主檢查表草稿、親自填實測值與勾選，簽署後可隨查驗申請檢附。', supervisor: '查閱廠商自主檢查表與修訂版；提送後在此收件或退回。', owner: '查閱廠商自主檢查紀錄。' },
  '/inspection-form': { contractor: '查閱監造的查驗判定與確認數量；提送後在此收件。', supervisor: '由查驗申請建立表單，親自判定並填本次確認數量，簽署即判定並成為廠商可估驗的依據。', owner: '查閱監造查驗判定與確認數量；提送後在此收件。' },
  '/submittals': { contractor: '新增提送文件交監造審查；退回時依審查意見補正後重新提送。', supervisor: '選擇已提送文件，檢視附件後審定或退回補正。', owner: '查閱文件提送與監造審定結果，追蹤待辦進度。' },
  // 廠商在同一筆疑義上沒有「追問」動作(詳情只有確認結案;補充回覆是監造的),提示不描述不存在的動作
  '/rfi': { contractor: '提出工程疑義交監造回覆；確認答覆無誤後結案，仍有疑問請另提一筆疑義。', supervisor: '檢視疑義及相關資料，回覆後交廠商確認結案。', owner: '查閱工程疑義及往返答覆，掌握未解決問題。' },
  '/change-orders': { contractor: '提出變更內容及追加減明細，交監造受理，再由機關核定。', supervisor: '檢視變更內容，受理後交機關核定；資料不足可退回。', owner: '選擇審核中的變更，核對內容與金額後核准或駁回。' },
  '/valuation': { contractor: '建立估驗期（填計價截止日），同步監造確認量、處理缺件後送監造審核；核定後到請款收款。', supervisor: '選擇待審期別，核對累計數量的確認來源與缺件後核定或退回。', owner: '查閱監造核定的估驗內容，付款登錄請到請款收款。' },
  // 這一頁只登錄紀錄,系統不執行付款——機關提示不能寫成「辦理付款」
  '/payments': { contractor: '核定後登錄請款日，再追蹤收款日與實收金額。', owner: '依核定估驗與廠商請款紀錄，登錄付款的收款日及實收金額；這裡只記錄，不執行付款。' },
  '/safety': { contractor: '登錄巡檢與工安紀錄，處理缺失並提送監造複查。', supervisor: '查閱工安紀錄，開立缺失並複查廠商改善結果。', owner: '追蹤工安紀錄與尚未結案的缺失。' },
  '/acceptance': { contractor: '準備竣工與驗收資料，依各階段要求完成改善。', supervisor: '確認竣工與改善情形，協助機關辦理驗收。', owner: '依竣工、初驗與驗收階段登錄結果，追蹤期限及改善。' },
  '/requirements': { contractor: '查閱契約原文與履約時程；在事項詳情標記完成、掛佐證，並維護關鍵工項的計畫起迄。', supervisor: '查閱契約原文與三方履約責任，追蹤提送期限、關鍵工項與停留點。', owner: '查閱契約原文與三方履約責任，追蹤機關核定及付款期限。' },
}

// 三方常用入口(桌機首頁操作列與手機底欄)=主入口群組項(含 tabs):底欄與操作列在任一
// 子頁都算選取,與側欄 itemActive 同一條規則。一律只從 visibleNavGroups 取,不新增權限;
// 群組整組對該角色不可見時就不出現(現行三組都不限角色,這是守衛而非預期)。
export function roleWorkLinks(org, override = false, platformAdmin = false) {
  const items = visibleNavGroups(org, override, platformAdmin).flatMap((g) => g.items)
  return MAIN_ENTRY_PATHS.map((path) => items.find((n) => n.entry === path)).filter(Boolean)
}

// 解析 ?ball=:缺省或未知值一律落回 mine(fail-safe:亂打參數看到的是「待我處理」,
// 不是空白頁)。Layout 的選取態與 Dashboard 的聚焦都吃這一支,兩邊各解析一次遲早分岔。
export function resolveBallKey(searchParams) {
  const v = searchParams?.get('ball')
  return BALL_SOURCES.some((b) => b.key === v) ? v : 'mine'
}

// 不出現在導覽的路由也必須明確登記。access 只描述路由表面；
// authenticated 路由一律由 App 的共同 Web guard 驗證登入與專案狀態。
// print 只代表不套 WebLayout，不代表公開。
// retired=頁面已移除的退場路由(D-026;入口與退場設計 §5):與 authenticated 走同一個 Web guard、
// roles 一字不改(只能由原角色或 override 通過),通過後導到 redirectTo(query 原樣帶過去)。
// 不改成 access: 'redirect'——那是不經守衛的公開導向,會替原本進不來的角色開一條路;
// 也不刪登記——舊書籤、提醒信與 Agent 回答裡的連結會變成「找不到頁面」。
const nonNavRouteRules = {
  '/': { access: 'redirect' },
  '/login': { access: 'public' },
  '/security': { access: 'public' },
  // 服務條款／隱私權政策:採購資安查核與個資法告知義務都要求不登入即可讀。
  '/terms': { access: 'public' },
  '/privacy': { access: 'public' },
  '/assistant': { access: 'redirect' },
  // 收件匣(今日工作,BALL_SOURCES_TITLE):球權來源三個入口共用這條路由(?ball= 分流)。來源不是
  // navGroups 的項目,所以登記在這裡;不限角色——它同時是落地頁,人人都必須進得去。
  '/dashboard': { access: 'authenticated' },
  '/agent': { access: 'authenticated' },
  // 提醒信仍可深連結;入口已由「今日工作」承接。label 供 taskReturn 的返回連結取名。
  '/alerts': { access: 'authenticated', label: '提醒中心' },
  '/project/new': { access: 'authenticated' },
  '/site-log/print': { access: 'authenticated', surface: 'print' },
  // 監造日誌列印(P3a):印「已簽署版本」的內容、版本號與雜湊,標示範範本;未簽署只印草稿並明寫
  '/supervisor-log/print': { access: 'authenticated', surface: 'print' },
  // 自主檢查表列印(P3b):同上,印簽署版本(項目判定由 DB 算)、示範框架範本標示
  '/self-check/print': { access: 'authenticated', surface: 'print' },
  // 監造查驗表單列印(P3c):同上,印簽署版本(判定、確認數量、查驗項目結果)、示範範本標示
  '/inspection-form/print': { access: 'authenticated', surface: 'print' },
  '/valuation/print': { access: 'authenticated', surface: 'print' },
  '/valuation/package': { access: 'authenticated', surface: 'print' },
  '/quality/checklist-print': { access: 'authenticated', surface: 'print' },
  '/contract/print': { access: 'authenticated', surface: 'print' },
  // 逐工項排程(P6b 移除頁面):關鍵工項的計畫起迄與落後判定自 P5d 起在履約時程維護;
  // ?item=<work_item_key> 由履約時程換成該項關鍵工項的直達
  '/schedule': { access: 'retired', roles: ['contractor'], redirectTo: '/requirements' },
  // 風險稽核(P6b 移除頁面):估驗所需的缺件與勾稽檢核在估驗計價逐期顯示(P1b／P4c);機關專屬不變
  '/audit': { access: 'retired', roles: ['owner'], redirectTo: '/valuation' },
  '*': { access: 'authenticated', surface: 'not-found' },
}

// onlyFor 分身(廠商核心群組裡的送審／疑義／契約上傳)不進登記表:權限與頁名以原群組的定義為準
const navRouteRules = Object.fromEntries(
  navGroups.flatMap((group) => group.items.flatMap((item) => item.tabs || [item]))
    .filter((route) => !route.onlyFor)
    .map((route) => [route.to, { ...route, access: 'authenticated' }]),
)

// 所有前端路由的權限登記表。新增 App 路由卻忘記登記時，routeAllowed 會 fail-closed。
export const routeRegistry = Object.freeze({ ...navRouteRules, ...nonNavRouteRules })

// 頁面文案提到「到某一頁」時的名稱來源(P1c):navLabel 給該路由自己的名字(子頁名,例如
// /members→三方成員),navEntryFor 給它所屬的主/次入口群組項(例如 /deadlines→履約時程)。
// 名字只住在 navGroups 一處——先前初始化清單寫「專案成員」頁,而頁面早已叫「三方成員」;
// 契約重點升成履約時程子頁後,各頁「到「契約重點」」的指路也沒有一份對照可查。
// 這兩支只讀登記表,不做權限判斷(權限在 routeAllowed);未登記或非導覽路由回 null。
const entryByPath = new Map(navGroups.flatMap((g) => g.items.flatMap((item) => (item.tabs || [item]).filter((t) => !t.onlyFor).map((t) => [t.to, item]))))
export const navLabel = (path) => routeRegistry[path]?.label ?? null
export const navEntryFor = (path) => entryByPath.get(path) ?? null

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
// 例外:廠商三核心(demo 急件)沒有今日工作收件匣,落在施工日誌(「施工文件預設直接打開今日施工日誌」)。
export function defaultLandingPath(orgType) {
  return coreOnlyNav(orgType) ? '/site-log' : '/dashboard'
}
export const landingLabel = (orgType) => (coreOnlyNav(orgType) ? '施工日誌' : BALL_SOURCES_TITLE)

// 廠商只看三核心:今日工作收件匣、問 GovAgent／Copilot 與全域問答對廠商不渲染(入口收起,路由與權限不動;
// 問答只在使用者送出時才打 agent-run,收起入口即不會有背景 Agent 請求)。照片填表與契約整理的 AI 照舊。
export const coreOnlyNav = (orgType) => orgType === 'contractor'

// 導覽可見性(只管「渲染不渲染」,與授權無關):hidden 對所有角色收起,hiddenFor 只對列名的
// org_type 收起。刻意不吃 override——override 是「非正式模式的專案管理者對 roles 一律放行」,
// 用來補授權,不是用來把別的角色的作業塞回你的選單(驗收要求專案 admin 情境的廠商也看不到)。
const navVisible = (n, org) => !n.hidden && !(n.hiddenFor || []).includes(org) && (!n.onlyFor || n.onlyFor.includes(org))

// 側欄可見項:群組入口=第一個可見子頁;整組子頁都不可見則隱藏該組(角色過濾只在這裡做,
// Layout/PageTabs/BottomNav/Site 現場作業卡都吃輸出)。
// hidden／hiddenFor 項一律不渲染(權限判斷仍在 routeAllowed 生效)。
export function visibleNavGroups(org, override, platformAdmin = false) {
  return navGroups
    .map((g) => ({
      ...g,
      items: g.items
        .map((item) => {
          if (!navVisible(item, org)) return null
          // entry=群組原本的路徑(MAIN_ENTRY_PATHS／現場作業卡以它認群組;to 會換成第一個可見子頁)
          const named = { ...item, entry: item.to, label: item.labelFor?.[org] || item.label, short: item.shortFor?.[org] || item.short }
          if (!item.tabs) return tabAllowed(item, org, override, platformAdmin) ? named : null
          const tabs = item.tabs.filter((t) => navVisible(t, org) && tabAllowed(t, org, override, platformAdmin))
          return tabs.length ? { ...named, to: tabs[0].to, tabs } : null
        })
        .filter(Boolean),
    }))
    .filter((g) => g.items.length)
}
