import { describe, it, expect } from 'vitest'
import {
  navGroups, routeAllowed, routeRegistry, visibleNavGroups, defaultLandingPath, BALL_SOURCES, BALL_SOURCES_TITLE,
  MAIN_ENTRY_PATHS, ROLE_WORK, roleWorkLinks, WORK_GUIDANCE, WORK_TITLE, navLabel, navEntryFor,
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
  it('風險稽核:導覽顯示與否不影響角色限制——僅機關可進', () => {
    // 曾因 hidden 收斂變成全站死功能;D-026 再次 hidden 是有意識的退場,
    // 這組斷言釘住 roles:入口顯示/隱藏都不得鬆綁機關防弊的角色限制。
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
  it('監造月報:僅監造;逐工項排程:僅施工', () => {
    expect(routeAllowed('/supervisor-report', 'owner', false)).toBe(false)
    expect(routeAllowed('/supervisor-report', 'supervisor', false)).toBe(true)
    expect(routeAllowed('/schedule', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/schedule', 'contractor', false)).toBe(true)
  })
  it('監造月報/逐工項排程:第三種角色也各驗一次(搬進新群組後結果不變)', () => {
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
  it('分區固定為「工作」「專案資料」(平台另測);工作三組=三個主入口、專案資料兩組,順序釘死,三角色皆同', () => {
    for (const org of ORGS) {
      const groups = visibleNavGroups(org, false)
      expect(groups.map((g) => g.title)).toEqual(['工作', '專案資料'])
      expect(groups[0].items.map((i) => i.label)).toEqual(WORK)
      expect(groups[1].items.map((i) => i.label)).toEqual(SECONDARY)
    }
  })
  it('今日工作不是側欄項:/dashboard 由球權來源獨佔,導覽定義裡沒有第二個入口指向它', () => {
    // 兩個入口指向同一頁正是先前 aria-current 要去重複的根因;這條釘住根因不回來。
    for (const n of allDefs()) expect(n.to).not.toBe('/dashboard')
    expect(BALL_SOURCES.map((b) => b.to.split('?')[0])).toEqual(['/dashboard', '/dashboard', '/dashboard'])
  })
  it('五組都是群組+子頁(≥2);群組入口=第一個子頁,而且第一個子頁不限角色(入口不會因角色漂到別頁)', () => {
    const groups = visibleNavGroups('contractor', true)
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
  it('施工廠商:看得到請款,看不到監造月報;排程、成本與風險稽核 hidden', () => {
    expect(outline(visibleNavGroups('contractor', false))).toEqual([
      ['工作', [
        ['現場紀錄', ['現場總覽', '施工日誌', '監造日誌', '自主檢查表', '監造查驗表單', '品質查驗', '檢驗停留點', '工安管理']],
        ['履約時程', ['契約重點', '期限追蹤', '擷取審核', '變更設計', '進度 S 曲線', '驗收結算']],
        ['估驗請款', ['估驗計價', '請款收款', '標單工項']],
      ]],
      ['專案資料', [
        ['文件往來', ['送審文件', '工程疑義', '施工月報']],
        ['專案', ['專案文件', '三方成員', '活動紀錄', '跨案總覽']],
      ]],
    ])
  })
  it('監造:不經手請款、看不到廠商排程;多監造月報', () => {
    expect(outline(visibleNavGroups('supervisor', false))).toEqual([
      ['工作', [
        ['現場紀錄', ['現場總覽', '施工日誌', '監造日誌', '自主檢查表', '監造查驗表單', '品質查驗', '檢驗停留點', '工安管理']],
        ['履約時程', ['契約重點', '期限追蹤', '擷取審核', '變更設計', '進度 S 曲線', '驗收結算']],
        ['估驗請款', ['估驗計價', '標單工項']],
      ]],
      ['專案資料', [
        ['文件往來', ['送審文件', '工程疑義', '施工月報', '監造月報']],
        ['專案', ['專案文件', '三方成員', '活動紀錄', '跨案總覽']],
      ]],
    ])
  })
  it('機關:看不到廠商排程;風險稽核 hidden(深連結仍限機關)', () => {
    expect(outline(visibleNavGroups('owner', false))).toEqual([
      ['工作', [
        ['現場紀錄', ['現場總覽', '施工日誌', '監造日誌', '自主檢查表', '監造查驗表單', '品質查驗', '檢驗停留點', '工安管理']],
        ['履約時程', ['契約重點', '期限追蹤', '擷取審核', '變更設計', '進度 S 曲線', '驗收結算']],
        ['估驗請款', ['估驗計價', '請款收款', '標單工項']],
      ]],
      ['專案資料', [
        ['文件往來', ['送審文件', '工程疑義', '施工月報']],
        ['專案', ['專案文件', '三方成員', '活動紀錄', '跨案總覽']],
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
      expect(links.map((n) => n.label)).toEqual(['現場紀錄', '履約時程', '估驗請款'])
      expect(links.map((n) => n.to)).toEqual(MAIN_ENTRY_PATHS)
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
    expect(navEntryFor('/audit')).toMatchObject({ to: '/contract', label: '專案' })
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
      expect(flatNav(groups)).toHaveLength(5)
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

describe('roles 與 hidden 定義釘死(重劃分區不得鬆綁;退場只 hidden 不刪)', () => {
  // 直接對 navGroups 定義做結構斷言:哪些路由帶 roles、帶哪些 roles,一字不差。
  it('帶 roles 的路由清單與內容完全不變', () => {
    const rolesMap = {}
    for (const n of allDefs()) if (n.roles) rolesMap[n.to] = n.roles
    expect(rolesMap).toEqual({
      '/supervisor-report': ['supervisor'],
      '/payments': ['contractor', 'owner'],
      '/cost': ['contractor'],
      '/schedule': ['contractor'],
      '/audit': ['owner'],
    })
  })
  it('hidden 集合=D-026 退場的三條(/schedule、/cost、/audit):仍登記、仍依原 roles 可直達,只是不進側欄/分頁列', () => {
    const hidden = allDefs().filter((n) => n.hidden).map((n) => n.to)
    expect(hidden).toEqual(['/schedule', '/cost', '/audit'])
    for (const to of hidden) {
      expect(routeRegistry[to]).toBeTruthy()
      for (const org of ORGS) {
        expect(routeAllowed(to, org, false)).toBe(routeRegistry[to].roles.includes(org))
        expect(flatNav(visibleNavGroups(org, true)).flatMap((i) => i.tabs || [i]).find((t) => t.to === to)).toBeUndefined()
      }
    }
    // /schedule 自 P5d 起 hidden(關鍵工項日期已承接到履約時程);roles 仍只有廠商,不因 hidden 鬆綁
    expect(routeRegistry['/schedule']).toMatchObject({ hidden: true, roles: ['contractor'] })
    // /alerts 帶 label:taskReturn 的返回連結名字取自登記表,不手抄「提醒中心」
    expect(routeRegistry['/alerts']).toEqual({ access: 'authenticated', label: '提醒中心' })
    expect(navLabel('/alerts')).toBe('提醒中心')
    expect(routeRegistry['/agent']).toEqual({ access: 'authenticated' })
  })
})

describe('defaultLandingPath(角色預設落地頁)', () => {
  it('所有角色一律落在收件匣(規範 §0 方向 A),與球權來源「現在輪到我」同一條路由', () => {
    expect(defaultLandingPath('owner')).toBe('/dashboard')
    expect(defaultLandingPath('supervisor')).toBe('/dashboard')
    expect(defaultLandingPath('contractor')).toBe('/dashboard')
    // BottomNav 的主畫面槽就是這個來源:落地頁與手機第一格必須是同一頁
    expect(BALL_SOURCES.find((b) => b.key === 'mine').to).toBe(defaultLandingPath('contractor'))
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
