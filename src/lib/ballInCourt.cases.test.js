// P5a 球權共用案例——前端路徑。同一份 tests/fixtures/ball-in-court.cases.json 也由
// supabase/functions/_shared/ballInCourt.cases.test.ts(Edge 收集器／Agent 工具／早報)與
// ballInCourtRules.deno.test.ts(Deno 執行期)斷言:首頁、Agent、早報對同一組資料必須
// 產出相同的核心事項、責任與期限;責任不明／基準日缺失一律待補設定,不歸任何一方。
import { describe, it, expect } from 'vitest'
import cases from '../../tests/fixtures/ball-in-court.cases.json'
import { collaborationItems } from './ballInCourt.js'
import { buildTodayTasks } from './todayTasks.js'
import { computeObligationDue } from './contractDue.js'
import { localISODate } from './dates.js'
import { periodBasisLabel } from '../../supabase/functions/_shared/ballInCourtRules.ts'

const ORGS = ['contractor', 'supervisor', 'owner']
const t = cases.tables
const input = {
  rfis: t.rfis, submittals: t.submittals, valuations: t.valuations, defects: t.defects, inspections: t.inspections,
  observations: t.observations, changeOrders: t.change_orders, obligations: t.contract_obligations,
  fieldDocuments: t.field_documents, fieldDocumentSubmissions: t.field_document_submissions,
  valuationAdjustments: t.valuation_adjustments,
}
const TODAY = new Date(`${cases.today}T04:00:00Z`) // 台北正午,避開跨日邊界
// 鍵:tag:id;循環義務的期次(P5b)再加 :期別——同一條義務的每一期各是一筆
const key = (x) => `${x.tag}:${x.id}${x.period ? `:${x.period}` : ''}`
const obKey = (x) => `契約重點:${x.id}${x.period ? `:${x.period}` : ''}`
const core = (x) => ({ id: x.id, who: x.who, tag: x.tag, title: x.title, meta: x.meta, due: x.due })
const sorted = (xs) => [...xs].sort()
const expectedDue = new Map([
  ...cases.expected.core_items.map((x) => [`${x.tag}:${x.id}`, x.due]),
  ...cases.expected.obligations.map((x) => [obKey(x), x.due]),
])
const expectedWho = new Map([
  ...cases.expected.core_items.map((x) => [`${x.tag}:${x.id}`, x.who]),
  ...cases.expected.obligations.map((x) => [obKey(x), x.who]),
])
const expectedTitle = new Map(cases.expected.obligations.map((x) => [obKey(x), x.title]))

describe('共用案例(前端):協作項核心事項', () => {
  it('collaborationItems 產出與案例完全相同的 id／責任／類型／標題／狀態句／期限(含順序)', () => {
    expect(collaborationItems(input).map(core)).toEqual(cases.expected.core_items.map(core))
  })
})

describe('共用案例(前端):基準日版本(P5c)', () => {
  it('單次義務到期日=案例 single_due:已完成的讀完成當下的快照,不隨基準日更正改', () => {
    const got = Object.fromEntries(t.contract_obligations.filter((ob) => !ob.recurring).map((ob) => [ob.id, localISODate(computeObligationDue(ob, cases.anchors))]))
    expect(got).toEqual(cases.expected.single_due)
  })
  it('期次的依據句=案例 period_basis(第幾版基準日、起算欄位與日期;未留版明說)', () => {
    const got = {}
    for (const ob of t.contract_obligations) for (const p of ob.periods || []) if (cases.expected.period_basis[`${ob.id}:${p.period_key}`]) got[`${ob.id}:${p.period_key}`] = periodBasisLabel(p)
    expect(got).toEqual(cases.expected.period_basis)
  })
})

describe('共用案例(前端):今日工作三桶＋待補設定', () => {
  const built = Object.fromEntries(ORGS.map((org) => [org, buildTodayTasks({ org, today: TODAY, anchors: cases.anchors, ...input })]))

  it.each(ORGS)('%s 的「現在輪到我」= 案例 mine.soon7', (org) => {
    expect(sorted(built[org].mine.map(key))).toEqual(sorted(cases.expected.mine.soon7[org]))
  })
  it.each(ORGS)('%s 的「等待對方」= 案例 web_waiting_soon7(現場文書只對當事方成立)', (org) => {
    expect(sorted(built[org].waiting.map(key))).toEqual(sorted(cases.expected.web_waiting_soon7[org]))
  })
  it.each(ORGS)('%s 都看得到同一份待補設定,且每筆有處理入口', (org) => {
    expect(sorted(built[org].setup.map(key))).toEqual(sorted(cases.expected.setup))
    for (const s of built[org].setup) {
      expect(s.to).toMatch(/^\/(requirements\/review\?highlight=|deadlines$|deadlines\?obligation=|quality\?observation=)/)
      expect(s.ball).toBe(expectedWho.get(key(s)))
    }
  })
  it('循環義務逐期:每個未結期次各一筆、標題含期別、深連結帶 &period=;已完成的期與已廢止的義務不列', () => {
    const mine = Object.fromEntries(built.contractor.mine.map((t) => [key(t), t]))
    expect(mine['契約重點:ob12:2026-07']).toMatchObject({ id: 'ob12', period: '2026-07', title: '每月環境監測報告（2026-07 期）', due: '2026-07-20', overdueDays: 6, to: '/deadlines?obligation=ob12&period=2026-07' })
    expect(mine['契約重點:ob12:2026-08']).toBeUndefined() // 25 天後到期,窗口外(逐期各自套窗口)
    expect(mine['契約重點:ob12:2026-06']).toBeUndefined() // 已完成的期不列
    for (const org of ORGS) {
      expect([...built[org].mine, ...built[org].waiting, ...built[org].setup].some((t) => t.id === 'ob16')).toBe(false) // 不適用的循環義務整條不列
      for (const t of [...built[org].mine, ...built[org].setup].filter((t) => t.tag === '契約重點')) expect(t.title, key(t)).toBe(expectedTitle.get(key(t)))
    }
  })
  it('待補設定不進任何一方的「現在輪到我」或「等待對方」', () => {
    for (const org of ORGS) {
      const keys = new Set([...built[org].mine, ...built[org].waiting].map(key))
      for (const k of cases.expected.setup) expect(keys.has(k)).toBe(false)
    }
  })
  it('每筆的責任與期限與案例一致;逾期天數與案例一致', () => {
    for (const org of ORGS) {
      for (const x of [...built[org].mine, ...built[org].waiting, ...built[org].setup]) {
        expect(x.due, key(x)).toBe(expectedDue.get(key(x)))
        expect(x.ball, key(x)).toBe(expectedWho.get(key(x)))
        const od = cases.expected.overdue_days[key(x)]
        if (od) expect(x.overdueDays, key(x)).toBe(od)
      }
    }
  })
  it('責任不明的義務與觀察:標籤說明缺什麼,不預設丟給廠商', () => {
    const setup = Object.fromEntries(built.contractor.setup.map((s) => [key(s), s]))
    expect(setup['契約重點:ob1'].meta).toBe('責任方待補設定')
    expect(setup['契約重點:ob1'].to).toBe('/requirements/review?highlight=ob1')
    expect(setup['契約重點:ob3'].meta).toBe('基準日待補（開工日）')
    expect(setup['契約重點:ob3'].to).toBe('/deadlines')
    expect(setup['契約重點:ob6'].meta).toBe('責任方待補設定')
    expect(setup['觀察:o3'].meta).toBe('待處理（指派「工地主任」不是三方）')
    expect(built.contractor.mine.some((x) => ['契約重點:ob1', '契約重點:ob6', '觀察:o3'].includes(key(x)))).toBe(false)
    // P5b:循環義務缺開工日／規則不完整／回填待核對,各有處理入口
    expect(setup['契約重點:ob13']).toMatchObject({ meta: '基準日待補（開工日）', to: '/deadlines', ball: 'supervisor' })
    expect(setup['契約重點:ob14']).toMatchObject({ meta: '循環規則待補（每季缺月份或日期）', to: '/requirements/review?highlight=ob14', ball: 'contractor' })
    expect(setup['契約重點:ob15:2026-06']).toMatchObject({ meta: '回填待核對（原義務曾標完成，本期是否已履行待確認）', to: '/deadlines?obligation=ob15&period=2026-06', ball: 'owner', period: '2026-06' })
    // P5c:循環停止條件判不出(保固類沒有保固期滿日)→ 待補設定,導期限追蹤該筆;已完成的單次義務 ob17 不列
    expect(setup['契約重點:ob18']).toMatchObject({ meta: '停止條件待補（保固期滿日無法判定，未登錄保固年限）', to: '/deadlines?obligation=ob18', ball: 'contractor' })
    for (const org of ORGS) expect([...built[org].mine, ...built[org].waiting, ...built[org].setup].some((t) => t.id === 'ob17')).toBe(false)
  })
})
