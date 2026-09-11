import { describe, it, expect } from 'vitest'
import { navGroups, routeAllowed, routeRegistry, visibleNavGroups, defaultLandingPath, BALL_SOURCES } from './navConfig.js'

const flatNav = (groups) => groups.flatMap((g) => g.items)
const ORGS = ['contractor', 'supervisor', 'owner']
// 側欄大綱:[分區, [[項目, 子頁標籤 | null]]]——三個角色各自看到什麼,直接對 label 斷言
const outline = (groups) => groups.map((g) => [g.title, g.items.map((i) => [i.label, i.tabs ? i.tabs.map((t) => t.label) : null])])

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

describe('routeRegistry(登記表的集合不因導覽重劃而變)', () => {
  // 導覽從「工作面」遷到來源模型只是換分區與解封,路由集合一條不增不減——
  // 這份清單一旦要改,代表真的新增/移除了路由,不該是導覽重排的副作用。
  it('登記的路由集合釘死', () => {
    expect(Object.keys(routeRegistry).sort()).toEqual([
      '*', '/', '/acceptance', '/activity', '/admin', '/agent', '/alerts', '/assistant', '/audit', '/boq',
      '/change-orders', '/contract', '/contract/print', '/cost', '/dashboard', '/deadlines', '/itp', '/login',
      '/members', '/monthly-report', '/payments', '/portfolio', '/progress', '/project/new', '/quality',
      '/quality/checklist-print', '/requirements', '/requirements/review', '/rfi', '/safety', '/schedule',
      '/security', '/site-log', '/site-log/print', '/submittals', '/supervisor-report', '/valuation',
      '/valuation/package', '/valuation/print',
    ])
  })
  it('/dashboard 登記在非導覽表(由球權來源持有),不限角色', () => {
    expect(routeRegistry['/dashboard']).toEqual({ access: 'authenticated' })
    for (const org of ORGS) expect(routeAllowed('/dashboard', org, false)).toBe(true)
  })
  it('球權來源三個入口的 pathname 都是登記路由且各角色可進(query 不進守衛)', () => {
    for (const b of BALL_SOURCES) {
      const pathname = b.to.split('?')[0]
      expect(routeRegistry[pathname]).toBeTruthy()
      for (const org of ORGS) expect(routeAllowed(pathname, org, false)).toBe(true)
    }
  })
})

describe('visibleNavGroups(側欄)——來源模型(規範 §0:工作面降級為來源)', () => {
  const WORK = ['現場與品質', '審查與協作', '進度與金流', '報表與結案', '專案']
  const REFERENCE = ['契約重點', '專案文件', '標單工項']
  it('分區固定為「工作」「參考」(平台另測);工作五組、參考三項,順序釘死,三角色皆同', () => {
    for (const org of ORGS) {
      const groups = visibleNavGroups(org, false)
      expect(groups.map((g) => g.title)).toEqual(['工作', '參考'])
      expect(groups[0].items.map((i) => i.label)).toEqual(WORK)
      expect(groups[1].items.map((i) => i.label)).toEqual(REFERENCE)
    }
  })
  it('今日待辦不再是側欄項:/dashboard 由球權來源獨佔,導覽定義裡沒有第二個入口指向它', () => {
    // 兩個入口指向同一頁正是先前 aria-current 要去重複的根因;這條釘住根因不回來。
    for (const g of navGroups) for (const item of g.items) {
      expect(item.to).not.toBe('/dashboard')
      for (const t of (item.tabs || [])) expect(t.to).not.toBe('/dashboard')
    }
    expect(BALL_SOURCES.map((b) => b.to.split('?')[0])).toEqual(['/dashboard', '/dashboard', '/dashboard'])
  })
  it('工作五組都是群組+子頁(≥2),參考三項都是扁平項', () => {
    const groups = visibleNavGroups('contractor', true)
    for (const item of groups[0].items) expect(item.tabs.length).toBeGreaterThanOrEqual(2)
    for (const item of groups[1].items) expect(item.tabs).toBeUndefined()
  })
  it('施工廠商:看得到請款/成本/排程,看不到監造報表與風險稽核', () => {
    expect(outline(visibleNavGroups('contractor', false))).toEqual([
      ['工作', [
        ['現場與品質', ['施工日誌', '品質查驗', '檢驗停留點', '工安管理']],
        ['審查與協作', ['送審文件', '工程疑義', '變更設計']],
        ['進度與金流', ['估驗計價', '請款收款', '成本管理', '進度 S 曲線', '逐工項排程']],
        ['報表與結案', ['施工月報', '驗收結算']],
        ['專案', ['跨案總覽', '活動紀錄', '三方成員']],
      ]],
      ['參考', [['契約重點', null], ['專案文件', null], ['標單工項', null]]],
    ])
  })
  it('監造:不經手請款、看不到廠商成本/排程;多監造報表', () => {
    expect(outline(visibleNavGroups('supervisor', false))).toEqual([
      ['工作', [
        ['現場與品質', ['施工日誌', '品質查驗', '檢驗停留點', '工安管理']],
        ['審查與協作', ['送審文件', '工程疑義', '變更設計']],
        ['進度與金流', ['估驗計價', '進度 S 曲線']],
        ['報表與結案', ['施工月報', '監造報表', '驗收結算']],
        ['專案', ['跨案總覽', '活動紀錄', '三方成員']],
      ]],
      ['參考', [['契約重點', null], ['專案文件', null], ['標單工項', null]]],
    ])
  })
  it('機關:看不到廠商成本/排程;多風險稽核(機關防弊)', () => {
    expect(outline(visibleNavGroups('owner', false))).toEqual([
      ['工作', [
        ['現場與品質', ['施工日誌', '品質查驗', '檢驗停留點', '工安管理']],
        ['審查與協作', ['送審文件', '工程疑義', '變更設計']],
        ['進度與金流', ['估驗計價', '請款收款', '進度 S 曲線']],
        ['報表與結案', ['施工月報', '驗收結算']],
        ['專案', ['跨案總覽', '活動紀錄', '三方成員', '風險稽核']],
      ]],
      ['參考', [['契約重點', null], ['專案文件', null], ['標單工項', null]]],
    ])
  })
  it('群組入口=第一個可見子頁;override(非正式模式專案管理者)看到全部子頁', () => {
    for (const org of ORGS) {
      expect(visibleNavGroups(org, false)[0].items.find((i) => i.label === '進度與金流').to).toBe('/valuation')
    }
    const money = visibleNavGroups('supervisor', true)[0].items.find((i) => i.label === '進度與金流')
    expect(money.tabs.map((t) => t.label)).toEqual(['估驗計價', '請款收款', '成本管理', '進度 S 曲線', '逐工項排程'])
    expect(flatNav(visibleNavGroups('supervisor', true))).toHaveLength(8)
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
  it('側欄:非平台管理員完全看不到(連「平台」分區都不渲染),維持工作五組+參考三項', () => {
    for (const org of ORGS) {
      const groups = visibleNavGroups(org, false)
      expect(groups.find((g) => g.title === '平台')).toBeUndefined()
      expect(flatNav(groups)).toHaveLength(8)
    }
    expect(flatNav(visibleNavGroups('contractor', true)).find((i) => i.to === '/admin')).toBeUndefined()
  })
  it('側欄:平台管理員在工作/參考之外多出獨立「平台」分區,只有平台管理一項', () => {
    const groups = visibleNavGroups('owner', false, true)
    expect(groups.map((g) => g.title)).toEqual(['工作', '參考', '平台'])
    expect(groups.at(-1).items.map((i) => i.label)).toEqual(['平台管理'])
    expect(flatNav(groups)).toHaveLength(9)
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

describe('roles 定義釘死(解封與重劃分區都不得鬆綁)', () => {
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
  it('hidden 集合為空(2026-09-11 解封五個群組);/alerts 與 /agent 照舊非導覽', () => {
    // hidden 機制保留給下一次收斂;現在若有人加回 hidden,這條會先紅,收斂必須是有意識的決策。
    const hidden = []
    for (const g of navGroups) for (const item of g.items) {
      if (item.hidden) hidden.push(item.to)
      for (const n of (item.tabs || [])) {
        if (n.hidden) hidden.push(n.to)
      }
    }
    expect(hidden).toEqual([])
    expect(routeRegistry['/alerts']).toEqual({ access: 'authenticated' })
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
