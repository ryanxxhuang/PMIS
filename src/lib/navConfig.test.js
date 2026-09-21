import { describe, it, expect } from 'vitest'
import {
  navGroups, routeAllowed, routeRegistry, visibleNavGroups, defaultLandingPath, BALL_SOURCES, BALL_SOURCES_TITLE,
  MAIN_ENTRY_PATHS, ROLE_WORK, roleWorkLinks, WORK_GUIDANCE, WORK_TITLE, navLabel, navEntryFor, coreOnlyNav, landingLabel,
} from './navConfig.js'

const flatNav = (groups) => groups.flatMap((g) => g.items)
const ORGS = ['contractor', 'supervisor', 'owner']
// 側欄大綱:[分區, [[項目, 子頁標籤 | null]]]——三個角色各自看到什麼,直接對 label 斷言
const outline = (groups) => groups.map((g) => [g.title, g.items.map((i) => [i.label, i.tabs ? i.tabs.map((t) => t.label) : null])])
const allDefs = () => navGroups.flatMap((g) => g.items.flatMap((item) => (item.tabs || [item]).map((n) => ({ ...n, group: item }))))

describe('routeAllowed(路由守衛與導覽同源)', () => {
  it('請款收款:監造擋、施工/機關放行、override 放行', () => {
    expect(routeAllowed('/payments', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/payments', 'contractor', false)).toBe(true)
    expect(routeAllowed('/payments', 'owner', false)).toBe(true)
    expect(routeAllowed('/payments', 'supervisor', true)).toBe(true)
  })
  it('成本管理:僅施工廠商(D-026 退場只 hidden,權限不得鬆動)', () => {
    expect(routeAllowed('/cost', 'owner', false)).toBe(false)
    expect(routeAllowed('/cost', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/cost', 'contractor', false)).toBe(true)
    expect(routeAllowed('/cost', 'supervisor', true)).toBe(true) // override 一律放行
  })
  it('風險稽核:頁面移除(P6b)後舊連結仍只有機關可進(退場導向不得鬆綁角色限制)', () => {
    // 曾因 hidden 收斂變成全站死功能;D-026 退場、P6b 移除頁面改為導向估驗計價,
    // 這組斷言釘住 roles:入口怎麼變都不得鬆綁機關防弊的角色限制。
    expect(routeAllowed('/audit', 'contractor', false)).toBe(false)
    expect(routeAllowed('/audit', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/audit', 'owner', false)).toBe(true)
    expect(routeAllowed('/audit', 'contractor', true)).toBe(true) // override 一律放行
  })
  it('現場紀錄總覽與施工日誌:位於「現場紀錄」且不限角色', () => {
    for (const org of ORGS) {
      expect(routeAllowed('/site', org, false)).toBe(true)
      expect(routeAllowed('/site-log', org, false)).toBe(true)
    }
  })
  it('提醒中心:自側欄隱藏,但不限角色,深連結(每日提醒信)各角色照常', () => {
    for (const org of ORGS) {
      expect(routeAllowed('/alerts', org, false)).toBe(true)
    }
  })
  it('監造月報:僅監造;逐工項排程(P6b 退場導向):僅施工', () => {
    expect(routeAllowed('/supervisor-report', 'owner', false)).toBe(false)
    expect(routeAllowed('/supervisor-report', 'supervisor', false)).toBe(true)
    expect(routeAllowed('/schedule', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/schedule', 'contractor', false)).toBe(true)
  })
  it('監造月報/逐工項排程:第三種角色也各驗一次(搬進新群組、改為退場導向後結果不變)', () => {
    expect(routeAllowed('/supervisor-report', 'contractor', false)).toBe(false)
    expect(routeAllowed('/supervisor-report', 'owner', true)).toBe(true) // override 一律放行
    expect(routeAllowed('/schedule', 'owner', false)).toBe(false)
    expect(routeAllowed('/schedule', 'owner', true)).toBe(true)
  })
  it('非導覽路由必須明確登記，列印與建案維持全角色可用', () => {
    for (const path of ['/site-log/print', '/valuation/print', '/valuation/package', '/quality/checklist-print', '/contract/print']) {
      expect(routeRegistry[path]).toMatchObject({ access: 'authenticated', surface: 'print' })
      for (const org of ORGS) expect(routeAllowed(path, org, false)).toBe(true)
    }
    expect(routeRegistry['/project/new']).toEqual({ access: 'authenticated' })
    expect(routeAllowed('/project/new', 'supervisor', false)).toBe(true)
  })
  it('未登記業務路由預設拒絕，override 與平台管理員也不得繞過', () => {
    for (const org of ORGS) {
      expect(routeAllowed('/forgot-to-register', org, false)).toBe(false)
      expect(routeAllowed('/forgot-to-register', org, true, true)).toBe(false)
    }
  })
  it('公開、重新導向與 404 路由都有明確類型', () => {
    expect(routeRegistry['/login']).toEqual({ access: 'public' })
    expect(routeRegistry['/security']).toEqual({ access: 'public' })
    expect(routeRegistry['/terms']).toEqual({ access: 'public' })
    expect(routeRegistry['/privacy']).toEqual({ access: 'public' })
    expect(routeRegistry['/']).toEqual({ access: 'redirect' })
    expect(routeRegistry['/assistant']).toEqual({ access: 'redirect' })
    expect(routeRegistry['*']).toEqual({ access: 'authenticated', surface: 'not-found' })
  })
  it('退場路由(P6b 移除頁面):access retired、原 roles、導向已登記且原角色進得去的承接頁;不在導覽定義裡', () => {
    expect(routeRegistry['/schedule']).toEqual({ access: 'retired', roles: ['contractor'], redirectTo: '/requirements' })
    expect(routeRegistry['/audit']).toEqual({ access: 'retired', roles: ['owner'], redirectTo: '/valuation' })
    const retired = Object.entries(routeRegistry).filter(([, r]) => r.access === 'retired')
    expect(retired.map(([p]) => p).sort()).toEqual(['/audit', '/schedule'])
    for (const [path, rule] of retired) {
      const target = routeRegistry[rule.redirectTo]
      expect(target?.access, `${path} → ${rule.redirectTo}`).toBe('authenticated')
      // 能通過退場路由守衛的角色,到了承接頁不能又被擋(否則舊連結變成無權限畫面)
      for (const org of ORGS) if (routeAllowed(path, org, false)) expect(routeAllowed(rule.redirectTo, org, false), `${org} ${path}`).toBe(true)
      expect(allDefs().some((n) => n.to === path)).toBe(false)
      expect(navLabel(path)).toBeNull()
    }
  })
  it('無 roles 的子頁:各角色仍全放行(含由非導覽改為子頁的期限追蹤/擷取審核)', () => {
    for (const to of ['/activity', '/monthly-report', '/progress', '/safety', '/itp', '/submittals', '/rfi', '/change-orders',
      '/deadlines', '/requirements/review', '/boq', '/contract', '/members', '/portfolio', '/acceptance', '/valuation', '/quality']) {
      for (const org of ORGS) expect(routeAllowed(to, org, false)).toBe(true)
    }
  })
})

describe('routeRegistry(登記表的集合)', () => {
  // 導覽重劃只換分區與 hidden,路由集合只多了現場紀錄總覽 /site 這一條——
  // 這份清單一旦要改,代表真的新增/移除了路由,不該是導覽重排的副作用。
  it('登記的路由集合釘死', () => {
    expect(Object.keys(routeRegistry).sort()).toEqual([
      '*', '/', '/acceptance', '/activity', '/admin', '/agent', '/alerts', '/assistant', '/audit', '/boq',
      '/change-orders', '/contract', '/contract/print', '/cost', '/dashboard', '/deadlines', '/inspection-form', '/inspection-form/print', '/itp', '/login',
      '/members', '/monthly-report', '/payments', '/portfolio', '/privacy', '/progress', '/project/new', '/quality',
      '/quality/checklist-print', '/requirements', '/requirements/review', '/rfi', '/safety', '/schedule',
      '/security', '/self-check', '/self-check/print', '/site', '/site-log', '/site-log/print', '/submittals', '/supervisor-log', '/supervisor-log/print', '/supervisor-report', '/terms', '/valuation',
      '/valuation/package', '/valuation/print',
    ])
  })
  it('/dashboard 登記在非導覽表(由球權來源持有),不限角色', () => {
    expect(routeRegistry['/dashboard']).toEqual({ access: 'authenticated' })
    for (const org of ORGS) expect(routeAllowed('/dashboard', org, false)).toBe(true)
  })
  it('球權來源三個入口的 pathname 都是登記路由且各角色可進(query 不進守衛);分區名=今日工作', () => {
    expect(BALL_SOURCES_TITLE).toBe('今日工作')
    for (const b of BALL_SOURCES) {
      const pathname = b.to.split('?')[0]
      expect(routeRegistry[pathname]).toBeTruthy()
      for (const org of ORGS) expect(routeAllowed(pathname, org, false)).toBe(true)
    }
  })
})

describe('visibleNavGroups(側欄)——D-026 四主入口', () => {
  const WORK = ['現場紀錄', '履約時程', '估驗請款']
  const SECONDARY = ['文件往來', '專案']
  it('分區固定為「工作」「專案資料」(平台另測);工作三組=三個主入口、專案資料兩組,順序釘死;廠商只剩三核心', () => {
    for (const org of ['supervisor', 'owner']) {
      const groups = visibleNavGroups(org, false)
      expect(groups.map((g) => g.title)).toEqual(['工作', '專案資料'])
      expect(groups[0].items.map((i) => i.label)).toEqual(WORK)
      expect(groups[1].items.map((i) => i.label)).toEqual(SECONDARY)
    }
    // 2026-09-21 demo 急件:廠商只看到「施工文件／契約與提醒／估驗請款」(專案資料的送審／疑義／契約上傳收進契約與提醒)
    for (const override of [false, true]) {
      const groups = visibleNavGroups('contractor', override)
      expect(groups.map((g) => g.title)).toEqual(['工作'])
      expect(groups[0].items.map((i) => i.label)).toEqual(['施工文件', '契約與提醒', '估驗請款'])
    }
  })
  it('今日工作不是側欄項:/dashboard 由球權來源獨佔,導覽定義裡沒有第二個入口指向它', () => {
    // 兩個入口指向同一頁正是先前 aria-current 要去重複的根因;這條釘住根因不回來。
    for (const n of allDefs()) expect(n.to).not.toBe('/dashboard')
    expect(BALL_SOURCES.map((b) => b.to.split('?')[0])).toEqual(['/dashboard', '/dashboard', '/dashboard'])
  })
  it('五組都是群組+子頁(≥2);群組入口=第一個子頁,而且第一個子頁不限角色(入口不會因角色漂到別頁)', () => {
    const groups = visibleNavGroups('supervisor', true)
    for (const item of [...groups[0].items, ...groups[1].items]) expect(item.tabs.length).toBeGreaterThanOrEqual(2)
    for (const g of navGroups.filter((g) => g.title !== '平台')) for (const item of g.items) {
      expect(item.tabs[0].to).toBe(item.to)
      expect(item.tabs[0].roles).toBeUndefined()
      expect(item.tabs[0].hidden).toBeUndefined()
    }
  })
  it('群組與扁平項都有 ≤2 字的短標(icon rail 與手機底欄用),子頁沒有', () => {
    for (const g of navGroups) for (const item of g.items) {
      expect(item.short, item.label).toMatch(/^.{1,2}$/)
      for (const t of (item.tabs || [])) expect(t.short).toBeUndefined()
    }
    for (const b of BALL_SOURCES) expect(b.short).toMatch(/^.{1,3}$/)
  })
  // 2026-09-20 廠商驗收 A 包:廠商的導覽只剩自己的現場作業(監造日誌與監造查驗表單 hiddenFor);
  // 停留點／工安／S 曲線／月報／跨案總覽 hidden(嵌回主流程或先收起入口)。roles 與路由一字不動。
  // 2026-09-21 demo 急件:廠商三核心——施工文件直接進施工日誌(現場總覽收起)、契約上傳／送審／疑義收進契約與提醒
  it('施工廠商:只剩三核心(沒有監造日誌／監造查驗表單、現場總覽、專案資料分區);停留點、工安、S 曲線、月報、跨案總覽的入口都收起', () => {
    expect(outline(visibleNavGroups('contractor', false))).toEqual([
      ['工作', [
        ['施工文件', ['施工日誌', '自主檢查表', '品質查驗']],
        ['契約與提醒', ['契約重點', '期限追蹤', '契約上傳', '擷取審核', '送審文件', '工程疑義', '變更設計', '驗收結算']],
        ['估驗請款', ['估驗計價', '請款收款', '標單工項']],
      ]],
    ])
    expect(visibleNavGroups('contractor', false)[0].items[0].to).toBe('/site-log')
  })
  it('監造:監造日誌與監造查驗表單照舊在現場紀錄(監造端能力不縮);不經手請款', () => {
    expect(outline(visibleNavGroups('supervisor', false))).toEqual([
      ['工作', [
        ['現場紀錄', ['現場總覽', '施工日誌', '監造日誌', '自主檢查表', '監造查驗表單', '品質查驗']],
        ['履約時程', ['契約重點', '期限追蹤', '擷取審核', '變更設計', '驗收結算']],
        ['估驗請款', ['估驗計價', '標單工項']],
      ]],
      ['專案資料', [
        ['文件往來', ['送審文件', '工程疑義']],
        ['專案', ['專案文件', '三方成員', '活動紀錄']],
      ]],
    ])
  })
  it('機關:監造文件的收件入口保留;風險稽核 hidden(深連結仍限機關)', () => {
    expect(outline(visibleNavGroups('owner', false))).toEqual([
      ['工作', [
        ['現場紀錄', ['現場總覽', '施工日誌', '監造日誌', '自主檢查表', '監造查驗表單', '品質查驗']],
        ['履約時程', ['契約重點', '期限追蹤', '擷取審核', '變更設計', '驗收結算']],
        ['估驗請款', ['估驗計價', '請款收款', '標單工項']],
      ]],
      ['專案資料', [
        ['文件往來', ['送審文件', '工程疑義']],
        ['專案', ['專案文件', '三方成員', '活動紀錄']],
      ]],
    ])
  })
  it('群組入口=第一個可見子頁;override(非正式模式專案管理者)看到全部非 hidden 子頁', () => {
    for (const org of ORGS) {
      expect(visibleNavGroups(org, false)[0].items.find((i) => i.label === '估驗請款').to).toBe('/valuation')
    }
    const money = visibleNavGroups('supervisor', true)[0].items.find((i) => i.label === '估驗請款')
    expect(money.tabs.map((t) => t.label)).toEqual(['估驗計價', '請款收款', '標單工項']) // 成本 hidden,override 也不露
    const contract = visibleNavGroups('supervisor', true)[0].items.find((i) => i.label === '履約時程')
    expect(contract.tabs.map((t) => t.label)).not.toContain('逐工項排程') // 排程 hidden(P5d 退場),override 也不露
    expect(flatNav(visibleNavGroups('supervisor', true))).toHaveLength(5)
  })
})

describe('三方常用入口(roleWorkLinks)=三個主入口群組', () => {
  it('MAIN_ENTRY_PATHS 是三個主入口群組的入口路由,順序=側欄順序;ROLE_WORK 只剩角色標籤與摘要', () => {
    expect(MAIN_ENTRY_PATHS).toEqual(['/site', '/requirements', '/valuation'])
    expect(navGroups[0].items.map((i) => i.to)).toEqual(MAIN_ENTRY_PATHS)
    for (const org of ORGS) {
      expect(ROLE_WORK[org].label).toBeTruthy()
      expect(ROLE_WORK[org].summary).toBeTruthy()
      expect(ROLE_WORK[org].paths).toBeUndefined()
    }
  })
  it('三角色都拿到同三個群組項(含 tabs 與 short),子頁依角色過濾', () => {
    for (const org of ORGS) {
      const links = roleWorkLinks(org, false, false)
      expect(links.map((n) => n.label)).toEqual(org === 'contractor' ? ['施工文件', '契約與提醒', '估驗請款'] : ['現場紀錄', '履約時程', '估驗請款'])
      expect(links.map((n) => n.entry)).toEqual(MAIN_ENTRY_PATHS)
      expect(links.map((n) => n.to)).toEqual(org === 'contractor' ? ['/site-log', '/requirements', '/valuation'] : MAIN_ENTRY_PATHS)
      for (const n of links) {
        expect(n.short).toBeTruthy()
        expect(n.icon).toBeTruthy()
        expect(n.tabs.length).toBeGreaterThanOrEqual(2)
      }
    }
    expect(roleWorkLinks('supervisor', false, false)[2].tabs.map((t) => t.to)).toEqual(['/valuation', '/boq'])
    expect(roleWorkLinks('contractor', false, false)[2].tabs.map((t) => t.to)).toEqual(['/valuation', '/payments', '/boq'])
  })
  it('每個主入口的總覽頁都有三方的操作提示(頁首與尋找功能共用)', () => {
    for (const path of MAIN_ENTRY_PATHS) for (const org of ORGS) expect(WORK_GUIDANCE[path]?.[org], `${path} ${org}`).toBeTruthy()
  })
})

describe('頁面文案的名稱來源(P1c):WORK_TITLE / navLabel / navEntryFor', () => {
  it('「工作」分區名只有一份:側欄第一分區的 title 就是首頁主入口列的名字', () => {
    expect(WORK_TITLE).toBe('工作')
    expect(navGroups[0].title).toBe(WORK_TITLE)
  })
  it('navLabel 回該路由自己的名字(子頁名);navEntryFor 回它所屬的主/次入口群組項', () => {
    expect(navLabel('/members')).toBe('三方成員')      // 初始化清單曾寫「專案成員」
    expect(navLabel('/contract')).toBe('專案文件')
    expect(navLabel('/requirements')).toBe('契約重點')
    expect(navEntryFor('/requirements')).toMatchObject({ to: '/requirements', label: '履約時程' })
    expect(navEntryFor('/deadlines')).toMatchObject({ to: '/requirements', label: '履約時程' })
    expect(navEntryFor('/payments')).toMatchObject({ to: '/valuation', label: '估驗請款' })
    expect(navEntryFor('/rfi')).toMatchObject({ to: '/submittals', label: '文件往來' })
    expect(navEntryFor('/admin')).toMatchObject({ to: '/admin', label: '平台管理' }) // 扁平項=自己
  })
  it('hidden 項照樣查得到名字(退場頁的深連結文案仍要叫得出名);非導覽/未登記路由回 null', () => {
    expect(navLabel('/cost')).toBe('成本管理')
    expect(navEntryFor('/cost')).toMatchObject({ to: '/valuation', label: '估驗請款' })
    expect(navLabel('/dashboard')).toBeNull()
    expect(navEntryFor('/dashboard')).toBeNull()
    expect(navLabel('/not-registered')).toBeNull()
    expect(navEntryFor('/not-registered')).toBeNull()
  })
  it('每個登記的導覽路由都有非空 label(否則指路文案會渲染成空字串)', () => {
    for (const n of allDefs()) expect(navLabel(n.to), n.to).toMatch(/\S/)
  })
})

describe('平台管理(/admin):platformAdminOnly 是獨立於專案角色的維度', () => {
  it('非平台管理員:任何專案角色都進不去,override 也翻不過', () => {
    for (const org of ORGS) {
      expect(routeAllowed('/admin', org, false)).toBe(false)
      expect(routeAllowed('/admin', org, false, false)).toBe(false)
    }
    // can.override 是「專案管理者」的跨角色例外,不是平台權限——絕不放行 /admin
    expect(routeAllowed('/admin', 'contractor', true)).toBe(false)
    expect(routeAllowed('/admin', 'owner', true, false)).toBe(false)
  })
  it('平台管理員:任何專案角色都進得去(平台維度與 org_type 無關)', () => {
    for (const org of ORGS) {
      expect(routeAllowed('/admin', org, false, true)).toBe(true)
    }
  })
  it('側欄:非平台管理員完全看不到(連「平台」分區都不渲染),維持工作三組+專案資料兩組', () => {
    for (const org of ORGS) {
      const groups = visibleNavGroups(org, false)
      expect(groups.find((g) => g.title === '平台')).toBeUndefined()
      expect(flatNav(groups)).toHaveLength(org === 'contractor' ? 3 : 5)
    }
    expect(flatNav(visibleNavGroups('contractor', true)).find((i) => i.to === '/admin')).toBeUndefined()
  })
  it('側欄:平台管理員在工作/專案資料之外多出獨立「平台」分區,只有平台管理一項', () => {
    const groups = visibleNavGroups('owner', false, true)
    expect(groups.map((g) => g.title)).toEqual(['工作', '專案資料', '平台'])
    expect(groups.at(-1).items.map((i) => i.label)).toEqual(['平台管理'])
    expect(flatNav(groups)).toHaveLength(6)
  })
  it('platformAdminOnly 路由清單釘死:只有 /admin,且不得帶 roles(兩維度不可混用)', () => {
    const flagged = allDefs().filter((n) => n.platformAdminOnly)
    expect(flagged.map((n) => n.to)).toEqual(['/admin'])
    for (const n of flagged) expect(n.roles).toBeUndefined()
  })
})

describe('roles 與 hidden 定義釘死(重劃分區不得鬆綁;退場頁 hidden,移除頁面的改退場導向)', () => {
  // 直接對登記表做結構斷言:哪些路由帶 roles、帶哪些 roles,一字不差(/schedule、/audit 自 P6b 起
  // 住在非導覽表的退場路由,roles 跟著搬、不得在搬家時掉)。
  it('帶 roles 的路由清單與內容完全不變', () => {
    const rolesMap = {}
    for (const [to, n] of Object.entries(routeRegistry)) if (n.roles) rolesMap[to] = n.roles
    expect(rolesMap).toEqual({
      '/supervisor-report': ['supervisor'],
      '/payments': ['contractor', 'owner'],
      '/cost': ['contractor'],
      '/schedule': ['contractor'],
      '/audit': ['owner'],
    })
  })
  it('hidden 集合釘死:仍登記、仍依原 roles 可直達,只是不進側欄/分頁列(override 也不露)', () => {
    const hidden = allDefs().filter((n) => n.hidden).map((n) => n.to)
    // /cost 是 D-026 的退場頁;其餘六條是 2026-09-20 廠商驗收 A 包先收起的入口
    // (停留點嵌回品質查驗;工安、S 曲線、兩張月報、跨案總覽先收起)——頁面、資料與提醒都還在。
    expect(hidden).toEqual(['/itp', '/safety', '/progress', '/cost', '/monthly-report', '/supervisor-report', '/portfolio'])
    for (const to of hidden) {
      const rule = routeRegistry[to]
      expect(rule).toBeTruthy()
      for (const org of ORGS) {
        // hidden 只收入口,不收權限:沒有 roles 的照樣三角色可直達,有 roles 的照原 roles
        expect(routeAllowed(to, org, false), `${to} ${org}`).toBe(!rule.roles || rule.roles.includes(org))
        expect(flatNav(visibleNavGroups(org, true)).flatMap((i) => i.tabs || [i]).find((t) => t.to === to)).toBeUndefined()
      }
    }
    // /alerts 帶 label:taskReturn 的返回連結名字取自登記表,不手抄「提醒中心」
    expect(routeRegistry['/alerts']).toEqual({ access: 'authenticated', label: '提醒中心' })
    expect(navLabel('/alerts')).toBe('提醒中心')
    expect(routeRegistry['/agent']).toEqual({ access: 'authenticated' })
  })
})

// 2026-09-20 廠商驗收 A 包:「導覽」與「授權」是兩個維度。hiddenFor 只收該角色的入口,
// routeAllowed 一字不動——廠商仍要能唯讀開啟監造的查驗判定與確認數量(可估驗依據)。
describe('hiddenFor(導覽收斂,不是權限):廠商的選單沒有監造作業,但深連結照原權限唯讀可達', () => {
  const tabsOf = (org, override = false) =>
    flatNav(visibleNavGroups(org, override)).flatMap((i) => i.tabs || [i]).map((t) => t.to)

  it('hiddenFor 集合釘死:監造日誌、監造查驗表單與現場總覽(demo 急件)三個子頁＋文件往來／專案兩個群組,且只對廠商收起', () => {
    const flagged = allDefs().filter((n) => n.hiddenFor)
    expect(flagged.map((n) => n.to)).toEqual(['/site', '/supervisor-log', '/inspection-form'])
    expect(navGroups.flatMap((g) => g.items).filter((i) => i.hiddenFor).map((i) => [i.to, i.hiddenFor])).toEqual([['/submittals', ['contractor']], ['/contract', ['contractor']]])
    for (const n of flagged) {
      expect(n.hiddenFor).toEqual(['contractor'])
      expect(n.roles, `${n.to} 不得用 roles 收斂(會連唯讀查閱一起關掉)`).toBeUndefined()
      expect(n.hidden).toBeUndefined()
    }
  })
  it('廠商:側欄/分頁列沒有監造日誌與監造查驗表單;專案管理者(override)與平台管理員也一樣看不到', () => {
    for (const to of ['/supervisor-log', '/inspection-form']) {
      expect(tabsOf('contractor')).not.toContain(to)
      expect(tabsOf('contractor', true)).not.toContain(to)   // override 對 roles 放行,對 hiddenFor 不放行
      expect(flatNav(visibleNavGroups('contractor', true, true)).flatMap((i) => i.tabs || [i]).map((t) => t.to)).not.toContain(to)
    }
    // 廠商自己的現場作業一項不少(施工日誌、自主檢查表、品質查驗);現場總覽自 demo 急件起收起(照片改在表單內上傳)
    for (const to of ['/site-log', '/self-check', '/quality']) expect(tabsOf('contractor')).toContain(to)
    expect(tabsOf('contractor')).not.toContain('/site')
  })
  it('監造與機關照舊看得到(監造端能力不縮,機關仍收得到件)', () => {
    for (const org of ['supervisor', 'owner']) {
      for (const to of ['/supervisor-log', '/inspection-form']) expect(tabsOf(org), `${org} ${to}`).toContain(to)
    }
  })
  it('routeAllowed 不受 hiddenFor 影響:廠商仍可由既有深連結唯讀開啟監造文件(查驗結果與計價依據)', () => {
    for (const to of ['/supervisor-log', '/inspection-form', '/inspection-form/print', '/supervisor-log/print']) {
      for (const org of ORGS) expect(routeAllowed(to, org, false), `${to} ${org}`).toBe(true)
    }
  })
})

describe('defaultLandingPath(角色預設落地頁)', () => {
  it('監造與機關落在收件匣(規範 §0 方向 A),與球權來源「現在輪到我」同一條路由;廠商三核心落在施工日誌', () => {
    expect(defaultLandingPath('owner')).toBe('/dashboard')
    expect(defaultLandingPath('supervisor')).toBe('/dashboard')
    // BottomNav 的主畫面槽就是這個來源:落地頁與手機第一格必須是同一頁
    expect(BALL_SOURCES.find((b) => b.key === 'mine').to).toBe(defaultLandingPath('supervisor'))
    // 2026-09-21 demo 急件:廠商沒有今日工作收件匣,「施工文件預設直接打開今日施工日誌」
    expect(defaultLandingPath('contractor')).toBe('/site-log')
    expect(landingLabel('contractor')).toBe('施工日誌')
    expect(landingLabel('owner')).toBe(BALL_SOURCES_TITLE)
  })
  it('coreOnlyNav 只對廠商成立(問 GovAgent／Copilot／今日工作入口只對廠商收起)', () => {
    expect(ORGS.filter(coreOnlyNav)).toEqual(['contractor'])
    expect(coreOnlyNav(undefined)).toBe(false)
  })
  it('onlyFor 分身不進登記表:送審／疑義／契約上傳的權限與頁名以原群組為準', () => {
    const dup = allDefs().filter((n) => n.onlyFor)
    expect(dup.map((n) => [n.to, n.onlyFor])).toEqual([['/contract', ['contractor']], ['/submittals', ['contractor']], ['/rfi', ['contractor']]])
    for (const n of dup) {
      expect(routeRegistry[n.to].onlyFor).toBeUndefined()
      expect(navEntryFor(n.to).label).not.toBe('履約時程')
    }
    expect(navLabel('/contract')).toBe('專案文件')
  })
  it('org_type 未知時退回 /dashboard(對齊 store 的 contractor 預設)', () => {
    expect(defaultLandingPath(undefined)).toBe('/dashboard')
    expect(defaultLandingPath(null)).toBe('/dashboard')
  })
  it('落地頁本身必須是登記過且該角色進得去的路由(否則一登入就撞守衛)', () => {
    for (const org of ORGS) {
      expect(routeAllowed(defaultLandingPath(org), org, false)).toBe(true)
    }
  })
})
