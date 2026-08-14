import { describe, it, expect } from 'vitest'
import { navGroups, routeAllowed, routeRegistry, visibleNavGroups } from './navConfig.js'

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
  it('風險稽核:導覽隱藏(hidden)但角色限制仍在——僅機關可深連結', () => {
    // 批4 只是「不顯示」手動入口,不是解除機關防弊稽核的角色限制;
    // 這組斷言釘住 hidden 機制:刪導覽項=靜默鬆綁,絕不允許重演。
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

describe('visibleNavGroups(側欄)', () => {
  it('三角色側欄都固定為六個業務工作面', () => {
    for (const org of ORGS) {
      expect(flatNav(visibleNavGroups(org, false)).map((i) => i.label)).toEqual([
        '今日待辦', '現場與品質', '審查與協作', '進度與金流', '文件與結案', '專案',
      ])
    }
    expect(flatNav(visibleNavGroups('contractor', true))).toHaveLength(6)
  })
  it('監造:進度與金流無請款/成本/排程,文件與結案包含監造報表', () => {
    const items = flatNav(visibleNavGroups('supervisor', false))
    expect(items.find((i) => i.label === '進度與金流').tabs.map((t) => t.label))
      .toEqual(['標單工項', '估驗計價', '進度 S 曲線'])
    expect(items.find((i) => i.label === '文件與結案').tabs.map((t) => t.label))
      .toContain('監造報表')
  })
  it('機關:進度與金流保留請款,專案工作面不顯示風險稽核', () => {
    const items = flatNav(visibleNavGroups('owner', false))
    expect(items.find((i) => i.label === '專案').tabs.map((t) => t.label))
      .not.toContain('風險稽核')
    expect(items.find((i) => i.label === '進度與金流').tabs.map((t) => t.label))
      .toEqual(['標單工項', '估驗計價', '請款收款', '進度 S 曲線'])
  })
  it('override(試用模式管理者)看得到全部分頁(hidden 除外)', () => {
    const items = flatNav(visibleNavGroups('contractor', true))
    expect(items.find((i) => i.label === '進度與金流').tabs).toHaveLength(6)
    expect(items.find((i) => i.label === '專案').tabs).toHaveLength(3)
  })
  // 2026-08-12 dry-run 反轉:曾因「agent 能做就藏入口」收斂,實測連產品擁有者都找不到
  // (問題 #10)。現場工程師每天要填的東西必須在側欄看得到——這條測試就是不讓它再被藏回去。
  it('施工日誌:側欄必須看得到(三角色皆是),不得再收斂', () => {
    for (const org of ORGS) {
      expect(flatNav(visibleNavGroups(org, false)).find((i) => i.label === '現場與品質').tabs.map((t) => t.to)).toContain('/site-log')
      expect(routeAllowed('/site-log', org, false)).toBe(true)
    }
    expect(flatNav(visibleNavGroups('contractor', true)).find((i) => i.label === '現場與品質').tabs.map((t) => t.to)).toContain('/site-log')
  })
  it('提醒中心:批6 側欄收斂(agent 主控台同源資料),路由與深連結仍保留', () => {
    for (const org of ORGS) {
      expect(flatNav(visibleNavGroups(org, false)).find((i) => i.label === '提醒中心')).toBeUndefined()
      expect(routeAllowed('/alerts', org, false)).toBe(true) // 每日提醒信深連結照常
    }
    expect(flatNav(visibleNavGroups('contractor', true)).find((i) => i.label === '提醒中心')).toBeUndefined()
  })
  it('每個工作台入口都指向自己的第一個可見分頁', () => {
    for (const org of ORGS) {
      for (const item of flatNav(visibleNavGroups(org, false))) {
        if (item.tabs) expect(item.tabs[0].to).toBe(item.to)
      }
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
  it('側欄:非平台管理員完全看不到(連「平台」群組都不渲染),維持六個工作面', () => {
    for (const org of ORGS) {
      const groups = visibleNavGroups(org, false)
      expect(groups.find((g) => g.title === '平台')).toBeUndefined()
      expect(flatNav(groups)).toHaveLength(6)
    }
    expect(flatNav(visibleNavGroups('contractor', true)).find((i) => i.to === '/admin')).toBeUndefined()
  })
  it('側欄:平台管理員在六個工作面外多出獨立「平台管理」', () => {
    const groups = visibleNavGroups('owner', false, true)
    const platform = groups.find((g) => g.title === '平台')
    expect(platform.items.map((i) => i.label)).toEqual(['平台管理'])
    expect(flatNav(groups)).toHaveLength(7)
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
  it('hidden 導覽路由只有 /audit；/alerts 與 /agent 以非導覽規則保留深連結', () => {
    const hidden = []
    for (const g of navGroups) for (const item of g.items) {
      for (const n of (item.tabs || [item])) {
        if (n.hidden) hidden.push(n.to)
      }
    }
    expect(hidden).toEqual(['/audit'])
    expect(routeRegistry['/alerts']).toEqual({ access: 'authenticated' })
    expect(routeRegistry['/agent']).toEqual({ access: 'authenticated' })
  })
})
