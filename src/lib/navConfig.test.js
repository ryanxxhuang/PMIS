import { describe, it, expect } from 'vitest'
import { navGroups, routeAllowed, routeRegistry, visibleNavGroups, defaultLandingPath } from './navConfig.js'

const flatNav = (groups) => groups.flatMap((g) => g.items)
const ORGS = ['contractor', 'supervisor', 'owner']

describe('routeAllowed(路由守衛與導覽同源)', () => {
  it('請款收款:監造擋、施工/機關放行、override 放行', () => {
    expect(routeAllowed('/payments', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/payments', 'contractor', false)).toBe(true)
    expect(routeAllowed('/payments', 'owner', false)).toBe(true)
    expect(routeAllowed('/payments', 'supervisor', true)).toBe(true)
  })
  it('成本管理:僅施工廠商(批6 併入估驗與金流分頁,權限不得鬆動)', () => {
    expect(routeAllowed('/cost', 'owner', false)).toBe(false)
    expect(routeAllowed('/cost', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/cost', 'contractor', false)).toBe(true)
    expect(routeAllowed('/cost', 'supervisor', true)).toBe(true) // override 一律放行
  })
  it('風險稽核:導覽顯示與否不影響角色限制——僅機關可進', () => {
    // 曾因 hidden 收斂變成全站死功能,現已對機關恢復導覽入口;
    // 這組斷言釘住 roles:入口顯示/隱藏都不得鬆綁機關防弊的角色限制。
    expect(routeAllowed('/audit', 'contractor', false)).toBe(false)
    expect(routeAllowed('/audit', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/audit', 'owner', false)).toBe(true)
    expect(routeAllowed('/audit', 'contractor', true)).toBe(true) // override 一律放行
  })
  it('施工日誌:位於「現場與品質」且不限角色', () => {
    for (const org of ORGS) {
      expect(routeAllowed('/site-log', org, false)).toBe(true)
    }
  })
  it('提醒中心:批6 自側欄隱藏,但不限角色,深連結(每日提醒信)各角色照常', () => {
    for (const org of ORGS) {
      expect(routeAllowed('/alerts', org, false)).toBe(true)
    }
  })
  it('監造報表:僅監造;逐工項排程:僅施工', () => {
    expect(routeAllowed('/supervisor-report', 'owner', false)).toBe(false)
    expect(routeAllowed('/supervisor-report', 'supervisor', false)).toBe(true)
    expect(routeAllowed('/schedule', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/schedule', 'contractor', false)).toBe(true)
  })
  it('監造報表/逐工項排程:第三種角色也各驗一次(批6 搬進分頁後結果不變)', () => {
    expect(routeAllowed('/supervisor-report', 'contractor', false)).toBe(false)
    expect(routeAllowed('/supervisor-report', 'owner', true)).toBe(true) // override 一律放行
    expect(routeAllowed('/schedule', 'owner', false)).toBe(false)
    expect(routeAllowed('/schedule', 'owner', true)).toBe(true)
  })
  it('非導覽路由必須明確登記，列印與建案維持全角色可用', () => {
    for (const path of ['/site-log/print', '/valuation/print', '/valuation/package', '/quality/checklist-print']) {
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
    expect(routeRegistry['/']).toEqual({ access: 'redirect' })
    expect(routeRegistry['/assistant']).toEqual({ access: 'redirect' })
    expect(routeRegistry['*']).toEqual({ access: 'authenticated', surface: 'not-found' })
  })
  it('批6 搬進分頁的無 roles 路由:各角色仍全放行', () => {
    for (const to of ['/activity', '/monthly-report', '/progress', '/safety', '/itp', '/submittals', '/rfi', '/change-orders']) {
      for (const org of ORGS) expect(routeAllowed(to, org, false)).toBe(true)
    }
  })
})

describe('visibleNavGroups(側欄)——精修期最小表面(2026-08-25 使用者指示)', () => {
  it('三角色側欄都只有四個入口:今日待辦/專案文件/契約重點/標單工項', () => {
    for (const org of ORGS) {
      expect(flatNav(visibleNavGroups(org, false)).map((i) => i.label)).toEqual([
        '今日待辦', '專案文件', '契約重點', '標單工項',
      ])
    }
    expect(flatNav(visibleNavGroups('contractor', true))).toHaveLength(4)
  })
  // 2026-08-12 dry-run 曾證明亂藏入口會做出死功能;這次是使用者主導的整批收斂,
  // 約定=路由與深連結全部活著(今日待辦/初始化清單仍導向這些頁),精修完逐項復出。
  it('暫別側欄的頁面:深連結與角色限制原封不動', () => {
    for (const org of ORGS) {
      for (const path of ['/site-log', '/quality', '/submittals', '/valuation', '/monthly-report', '/portfolio', '/members', '/activity']) {
        expect(routeAllowed(path, org, false)).toBe(true)
      }
    }
    // roles 限制不因隱藏鬆動
    expect(routeAllowed('/payments', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/cost', 'owner', false)).toBe(false)
    expect(routeAllowed('/audit', 'contractor', false)).toBe(false)
    expect(routeAllowed('/audit', 'owner', false)).toBe(true)
  })
  it('四個入口都是扁平項(無分頁列),PageTabs 不再於任何保留頁渲染', () => {
    for (const item of flatNav(visibleNavGroups('contractor', true))) {
      expect(item.tabs).toBeUndefined()
    }
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
  it('側欄:非平台管理員完全看不到(連「平台」群組都不渲染),維持四個工作面項', () => {
    for (const org of ORGS) {
      const groups = visibleNavGroups(org, false)
      expect(groups.find((g) => g.title === '平台')).toBeUndefined()
      expect(flatNav(groups)).toHaveLength(4)
    }
    expect(flatNav(visibleNavGroups('contractor', true)).find((i) => i.to === '/admin')).toBeUndefined()
  })
  it('側欄:平台管理員在四個工作面項外多出獨立「平台管理」', () => {
    const groups = visibleNavGroups('owner', false, true)
    const platform = groups.find((g) => g.title === '平台')
    expect(platform.items.map((i) => i.label)).toEqual(['平台管理'])
    expect(flatNav(groups)).toHaveLength(5)
  })
  it('platformAdminOnly 路由清單釘死:只有 /admin,且不得帶 roles(兩維度不可混用)', () => {
    const flagged = []
    for (const g of navGroups) for (const item of g.items) {
      for (const n of (item.tabs || [item])) {
        if (n.platformAdminOnly) {
          flagged.push(n.to)
          expect(n.roles).toBeUndefined()
        }
      }
    }
    expect(flagged).toEqual(['/admin'])
  })
})

describe('roles 定義釘死(批6 搬移不得鬆綁)', () => {
  // 直接對 navGroups 定義做結構斷言:哪些路由帶 roles、帶哪些 roles,一字不差。
  it('帶 roles 的路由清單與內容完全不變', () => {
    const rolesMap = {}
    for (const g of navGroups) for (const item of g.items) {
      for (const n of (item.tabs || [item])) {
        if (n.roles) rolesMap[n.to] = n.roles
      }
    }
    expect(rolesMap).toEqual({
      '/supervisor-report': ['supervisor'],
      '/payments': ['contractor', 'owner'],
      '/cost': ['contractor'],
      '/schedule': ['contractor'],
      '/audit': ['owner'],
    })
  })
  it('精修期 hidden 集合釘死:五個工作面組暫別側欄;/alerts 與 /agent 照舊非導覽', () => {
    const hidden = []
    for (const g of navGroups) for (const item of g.items) {
      if (item.hidden) hidden.push(item.to)
      for (const n of (item.tabs || [])) {
        if (n.hidden) hidden.push(n.to)
      }
    }
    expect(hidden).toEqual(['/site-log', '/submittals', '/valuation', '/monthly-report', '/portfolio'])
    expect(routeRegistry['/alerts']).toEqual({ access: 'authenticated' })
    expect(routeRegistry['/agent']).toEqual({ access: 'authenticated' })
  })
})

describe('defaultLandingPath(角色預設落地頁)', () => {
  it('精修期一律落在今日待辦(跨案總覽暫別側欄;恢復「專案」工作面時還原分流)', () => {
    expect(defaultLandingPath('owner')).toBe('/dashboard')
    expect(defaultLandingPath('supervisor')).toBe('/dashboard')
    expect(defaultLandingPath('contractor')).toBe('/dashboard')
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
