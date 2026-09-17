// P5a 球權共用案例——前端路徑。同一份 tests/fixtures/ball-in-court.cases.json 也由
// supabase/functions/_shared/ballInCourt.cases.test.ts(Edge 收集器／Agent 工具／早報)與
// ballInCourtRules.deno.test.ts(Deno 執行期)斷言:首頁、Agent、早報對同一組資料必須
// 產出相同的核心事項、責任與期限;責任不明／基準日缺失一律待補設定,不歸任何一方。
import { describe, it, expect } from 'vitest'
import cases from '../../tests/fixtures/ball-in-court.cases.json'
import { collaborationItems } from './ballInCourt.js'
import { buildTodayTasks } from './todayTasks.js'

const ORGS = ['contractor', 'supervisor', 'owner']
const t = cases.tables
const input = {
  rfis: t.rfis, submittals: t.submittals, valuations: t.valuations, defects: t.defects, inspections: t.inspections,
  observations: t.observations, changeOrders: t.change_orders, obligations: t.contract_obligations,
  fieldDocuments: t.field_documents, fieldDocumentSubmissions: t.field_document_submissions,
}
const TODAY = new Date(`${cases.today}T04:00:00Z`) // 台北正午,避開跨日邊界
const key = (x) => `${x.tag}:${x.id}`
const core = (x) => ({ id: x.id, who: x.who, tag: x.tag, title: x.title, meta: x.meta, due: x.due })
const sorted = (xs) => [...xs].sort()
const expectedDue = new Map([
  ...cases.expected.core_items.map((x) => [`${x.tag}:${x.id}`, x.due]),
  ...cases.expected.obligations.map((x) => [`契約重點:${x.id}`, x.due]),
])
const expectedWho = new Map([
  ...cases.expected.core_items.map((x) => [`${x.tag}:${x.id}`, x.who]),
  ...cases.expected.obligations.map((x) => [`契約重點:${x.id}`, x.who]),
])

describe('共用案例(前端):協作項核心事項', () => {
  it('collaborationItems 產出與案例完全相同的 id／責任／類型／標題／狀態句／期限(含順序)', () => {
    expect(collaborationItems(input).map(core)).toEqual(cases.expected.core_items.map(core))
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
      expect(s.to).toMatch(/^\/(requirements\/review\?highlight=|deadlines$|quality\?observation=)/)
      expect(s.ball).toBe(expectedWho.get(key(s)))
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
  })
})
