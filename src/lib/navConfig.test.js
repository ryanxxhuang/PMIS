import { describe, it, expect } from 'vitest'
import { navGroups, routeAllowed, workbenchFor, visibleNavGroups } from './navConfig.js'

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
  it('施工日誌:hidden 但本來就不限角色,深連結各角色照常', () => {
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
  it('未列於導覽的路由(列印/建案)不設限', () => {
    expect(routeAllowed('/site-log/print', 'owner', false)).toBe(true)
    expect(routeAllowed('/project/new', 'supervisor', false)).toBe(true)
  })
  it('批6 搬進分頁的無 roles 路由:各角色仍全放行', () => {
    for (const to of ['/activity', '/monthly-report', '/progress', '/safety', '/itp', '/submittals', '/rfi', '/change-orders']) {
      for (const org of ORGS) expect(routeAllowed(to, org, false)).toBe(true)
    }
  })
})

describe('workbenchFor(分頁列)', () => {
  it('估驗與金流:施工五個分頁、監造剩估驗計價+進度、機關無成本/排程', () => {
    expect(workbenchFor('/valuation', 'contractor', false).tabs.map((t) => t.label))
      .toEqual(['估驗計價', '請款收款', '成本管理', '進度 S 曲線', '逐工項排程'])
    expect(workbenchFor('/payments', 'contractor', false).label).toBe('估驗與金流')
    expect(workbenchFor('/valuation', 'supervisor', false).tabs.map((t) => t.label))
      .toEqual(['估驗計價', '進度 S 曲線'])
    expect(workbenchFor('/valuation', 'owner', false).tabs.map((t) => t.label))
      .toEqual(['估驗計價', '請款收款', '進度 S 曲線'])
  })
  it('專案儀表:監造多監造報表,施工/機關只有三個分頁', () => {
    expect(workbenchFor('/dashboard', 'supervisor', false).tabs.map((t) => t.label))
      .toEqual(['專案 Dashboard', '活動紀錄', '施工月報', '監造報表'])
    expect(workbenchFor('/dashboard', 'owner', false).tabs.map((t) => t.label))
      .toEqual(['專案 Dashboard', '活動紀錄', '施工月報'])
    expect(workbenchFor('/monthly-report', 'contractor', false).label).toBe('專案儀表')
    expect(workbenchFor('/monthly-report', 'contractor', false).tabs.map((t) => t.label))
      .not.toContain('監造報表')
  })
  it('品質與工安:三個分頁全角色一致', () => {
    for (const org of ORGS) {
      expect(workbenchFor('/quality', org, false).tabs.map((t) => t.label))
        .toEqual(['品質查驗', '檢驗停留點', '工安管理'])
    }
    expect(workbenchFor('/safety', 'contractor', false).label).toBe('品質與工安')
  })
  it('契約與協作:風險稽核分頁 hidden,各角色分頁列皆五項', () => {
    expect(workbenchFor('/contract', 'owner', false).tabs.map((t) => t.label))
      .toEqual(['專案文件', '履約需求', '送審文件', '工程疑義', '變更設計'])
    expect(workbenchFor('/contract', 'owner', false).tabs.map((t) => t.label))
      .not.toContain('風險稽核')
    expect(workbenchFor('/contract', 'contractor', false).tabs.map((t) => t.label))
      .toEqual(['專案文件', '履約需求', '送審文件', '工程疑義', '變更設計'])
    expect(workbenchFor('/audit', 'owner', false)).toBeNull() // 深連結進 hidden 分頁=單頁,不掛分頁列
  })
  it('單頁路由無工作台(hidden 頂層項亦然)', () => {
    expect(workbenchFor('/site-log', 'contractor', false)).toBeNull()
    expect(workbenchFor('/alerts', 'owner', false)).toBeNull()
    expect(workbenchFor('/boq', 'owner', false)).toBeNull()
    expect(workbenchFor('/acceptance', 'owner', false)).toBeNull()
  })
})

describe('visibleNavGroups(側欄)', () => {
  it('批6 收斂:三角色側欄都是 9 個可見項', () => {
    for (const org of ORGS) {
      expect(flatNav(visibleNavGroups(org, false))).toHaveLength(9)
    }
    expect(flatNav(visibleNavGroups('contractor', true))).toHaveLength(9) // override 也不多
  })
  it('監造:估驗與金流無成本管理/逐工項排程分頁,入口指向估驗計價', () => {
    const items = flatNav(visibleNavGroups('supervisor', false))
    expect(items.find((i) => i.label === '成本管理')).toBeUndefined() // 已併入分頁,不再是側欄項
    const val = items.find((i) => i.label === '估驗與金流')
    expect(val.to).toBe('/valuation')
    expect(val.tabs.map((t) => t.label)).toEqual(['估驗計價', '進度 S 曲線'])
    expect(items.find((i) => i.label === '專案儀表').tabs.map((t) => t.label))
      .toContain('監造報表')
  })
  it('機關:專案儀表無監造報表,契約與協作不再有風險稽核分頁', () => {
    const items = flatNav(visibleNavGroups('owner', false))
    expect(items.find((i) => i.label === '專案儀表').tabs.map((t) => t.label))
      .toEqual(['專案 Dashboard', '活動紀錄', '施工月報'])
    expect(items.find((i) => i.label === '契約與協作').tabs.map((t) => t.label))
      .not.toContain('風險稽核')
    expect(items.find((i) => i.label === '估驗與金流').tabs.map((t) => t.label))
      .toEqual(['估驗計價', '請款收款', '進度 S 曲線'])
  })
  it('override(試用模式管理者)看得到全部分頁(hidden 除外)', () => {
    const items = flatNav(visibleNavGroups('contractor', true))
    expect(items.find((i) => i.label === '估驗與金流').tabs).toHaveLength(5)
    expect(items.find((i) => i.label === '契約與協作').tabs).toHaveLength(5) // 風險稽核已收斂,override 也不例外
  })
  it('施工日誌:側欄已收斂(改由 agent 草稿產生),但路由與深連結仍保留', () => {
    for (const org of ORGS) {
      expect(flatNav(visibleNavGroups(org, false)).find((i) => i.label === '施工日誌')).toBeUndefined()
      expect(routeAllowed('/site-log', org, false)).toBe(true) // 手動入口/深連結照常
    }
    expect(flatNav(visibleNavGroups('contractor', true)).find((i) => i.label === '施工日誌')).toBeUndefined()
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
  it('hidden 路由清單:/alerts、/site-log、/audit,且定義仍在(隱藏≠移除)', () => {
    const hidden = []
    for (const g of navGroups) for (const item of g.items) {
      for (const n of (item.tabs || [item])) {
        if (n.hidden) hidden.push(n.to)
      }
    }
    expect(hidden.sort()).toEqual(['/alerts', '/audit', '/site-log'])
  })
})
