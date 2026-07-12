import { describe, it, expect } from 'vitest'
import { navGroups, routeAllowed, workbenchFor, visibleNavGroups } from './navConfig.js'

const flatNav = (groups) => groups.flatMap((g) => g.items)

describe('routeAllowed(路由守衛與導覽同源)', () => {
  it('請款收款:監造擋、施工/機關放行、override 放行', () => {
    expect(routeAllowed('/payments', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/payments', 'contractor', false)).toBe(true)
    expect(routeAllowed('/payments', 'owner', false)).toBe(true)
    expect(routeAllowed('/payments', 'supervisor', true)).toBe(true)
  })
  it('成本管理:僅施工廠商', () => {
    expect(routeAllowed('/cost', 'owner', false)).toBe(false)
    expect(routeAllowed('/cost', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/cost', 'contractor', false)).toBe(true)
  })
  it('風險稽核(工作台分頁):僅機關', () => {
    expect(routeAllowed('/audit', 'contractor', false)).toBe(false)
    expect(routeAllowed('/audit', 'owner', false)).toBe(true)
  })
  it('監造報表:僅監造;逐工項排程:僅施工', () => {
    expect(routeAllowed('/supervisor-report', 'owner', false)).toBe(false)
    expect(routeAllowed('/supervisor-report', 'supervisor', false)).toBe(true)
    expect(routeAllowed('/schedule', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/schedule', 'contractor', false)).toBe(true)
  })
  it('未列於導覽的路由(列印/建案)不設限', () => {
    expect(routeAllowed('/site-log/print', 'owner', false)).toBe(true)
    expect(routeAllowed('/project/new', 'supervisor', false)).toBe(true)
  })
})

describe('workbenchFor(分頁列)', () => {
  it('估驗與金流:施工看得到兩個分頁,監造只剩估驗計價', () => {
    expect(workbenchFor('/valuation', 'contractor', false).tabs.map((t) => t.label))
      .toEqual(['估驗計價', '請款收款'])
    expect(workbenchFor('/payments', 'contractor', false).label).toBe('估驗與金流')
    expect(workbenchFor('/valuation', 'supervisor', false).tabs.map((t) => t.label))
      .toEqual(['估驗計價'])
  })
  it('契約與文件:風險稽核分頁僅機關可見', () => {
    expect(workbenchFor('/contract', 'owner', false).tabs.map((t) => t.label))
      .toEqual(['專案文件', '履約需求', '風險稽核'])
    expect(workbenchFor('/contract', 'contractor', false).tabs.map((t) => t.label))
      .toEqual(['專案文件', '履約需求'])
  })
  it('單頁路由無工作台', () => {
    expect(workbenchFor('/site-log', 'contractor', false)).toBeNull()
    expect(workbenchFor('/dashboard', 'owner', false)).toBeNull()
  })
})

describe('visibleNavGroups(側欄)', () => {
  it('監造:無成本管理,估驗與金流入口指向估驗計價', () => {
    const items = flatNav(visibleNavGroups('supervisor', false))
    expect(items.find((i) => i.label === '成本管理')).toBeUndefined()
    expect(items.find((i) => i.label === '估驗與金流').to).toBe('/valuation')
    expect(items.find((i) => i.label === '報表中心').tabs.map((t) => t.label))
      .toContain('監造報表')
  })
  it('機關:報表中心只剩施工月報,契約與文件含風險稽核', () => {
    const items = flatNav(visibleNavGroups('owner', false))
    expect(items.find((i) => i.label === '報表中心').tabs.map((t) => t.label))
      .toEqual(['施工月報'])
    expect(items.find((i) => i.label === '契約與文件').tabs.map((t) => t.label))
      .toContain('風險稽核')
  })
  it('override(試用模式管理者)看得到全部入口', () => {
    const items = flatNav(visibleNavGroups('contractor', true))
    expect(items.find((i) => i.label === '成本管理')).toBeDefined()
    expect(items.find((i) => i.label === '契約與文件').tabs).toHaveLength(3)
  })
  it('每個工作台入口都指向自己的第一個可見分頁', () => {
    for (const org of ['contractor', 'supervisor', 'owner']) {
      for (const item of flatNav(visibleNavGroups(org, false))) {
        if (item.tabs) expect(item.tabs[0].to).toBe(item.to)
      }
    }
  })
})
