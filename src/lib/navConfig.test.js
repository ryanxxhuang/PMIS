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
  it('風險稽核:導覽隱藏(hidden)但角色限制仍在——僅機關可深連結', () => {
    // 批4 只是「不顯示」手動入口,不是解除機關防弊稽核的角色限制;
    // 這組斷言釘住 hidden 機制:刪導覽項=靜默鬆綁,絕不允許重演。
    expect(routeAllowed('/audit', 'contractor', false)).toBe(false)
    expect(routeAllowed('/audit', 'supervisor', false)).toBe(false)
    expect(routeAllowed('/audit', 'owner', false)).toBe(true)
    expect(routeAllowed('/audit', 'contractor', true)).toBe(true) // override 一律放行
  })
  it('施工日誌:hidden 但本來就不限角色,深連結各角色照常', () => {
    for (const org of ['contractor', 'supervisor', 'owner']) {
      expect(routeAllowed('/site-log', org, false)).toBe(true)
    }
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
  it('契約與文件:風險稽核分頁 hidden,各角色分頁列皆只剩專案文件/履約需求', () => {
    expect(workbenchFor('/contract', 'owner', false).tabs.map((t) => t.label))
      .toEqual(['專案文件', '履約需求'])
    expect(workbenchFor('/contract', 'owner', false).tabs.map((t) => t.label))
      .not.toContain('風險稽核')
    expect(workbenchFor('/contract', 'contractor', false).tabs.map((t) => t.label))
      .toEqual(['專案文件', '履約需求'])
    expect(workbenchFor('/audit', 'owner', false)).toBeNull() // 深連結進 hidden 分頁=單頁,不掛分頁列
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
  it('機關:報表中心只剩施工月報,契約與文件不再有風險稽核分頁', () => {
    const items = flatNav(visibleNavGroups('owner', false))
    expect(items.find((i) => i.label === '報表中心').tabs.map((t) => t.label))
      .toEqual(['施工月報'])
    expect(items.find((i) => i.label === '契約與文件').tabs.map((t) => t.label))
      .not.toContain('風險稽核')
  })
  it('override(試用模式管理者)看得到全部入口', () => {
    const items = flatNav(visibleNavGroups('contractor', true))
    expect(items.find((i) => i.label === '成本管理')).toBeDefined()
    expect(items.find((i) => i.label === '契約與文件').tabs).toHaveLength(2) // 風險稽核已收斂,override 也不例外
  })
  it('施工日誌:側欄已收斂(改由 agent 草稿產生),但路由與深連結仍保留', () => {
    for (const org of ['contractor', 'supervisor', 'owner']) {
      expect(flatNav(visibleNavGroups(org, false)).find((i) => i.label === '施工日誌')).toBeUndefined()
      expect(routeAllowed('/site-log', org, false)).toBe(true) // 未列導覽=不設限,手動入口/深連結照常
    }
    expect(flatNav(visibleNavGroups('contractor', true)).find((i) => i.label === '施工日誌')).toBeUndefined()
  })
  it('每個工作台入口都指向自己的第一個可見分頁', () => {
    for (const org of ['contractor', 'supervisor', 'owner']) {
      for (const item of flatNav(visibleNavGroups(org, false))) {
        if (item.tabs) expect(item.tabs[0].to).toBe(item.to)
      }
    }
  })
})
