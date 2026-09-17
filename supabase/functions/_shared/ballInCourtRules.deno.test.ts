// P5a 球權共用案例——Deno 執行期。同一份 tests/fixtures/ball-in-court.cases.json,Vitest 已在
// 前端路徑(src/lib/ballInCourt.cases.test.js)與 Edge 路徑(ballInCourt.cases.test.ts)各跑一次;
// 這裡用 Edge 真正的執行期(Deno)再跑一次,證明規則模組在部署環境產出相同結果。
// 執行:npm run test:edge。只用 node:assert 與 JSON import,不需要 lockfile 之外的依賴。
import assert from 'node:assert/strict'
import cases from '../../../tests/fixtures/ball-in-court.cases.json' with { type: 'json' }
import { coreOpenItems, obligationBall, obligationInWindow, isObligationOpen } from './ballInCourtRules.ts'
import { computeObligationDueUTC, formatDate, parseDateUTC } from './contractDue.ts'

const ORGS = ['contractor', 'supervisor', 'owner'] as const
const TODAY = parseDateUTC(cases.today)!
const t = cases.tables
const core = (x: { id: string | null; who: string; tag: string; title: string; status: string; meta: string; due: string | null }) =>
  ({ id: x.id, who: x.who, tag: x.tag, title: x.title, status: x.status, meta: x.meta, due: x.due })
const sorted = (xs: string[]) => [...xs].sort()

const items = coreOpenItems({
  rfis: t.rfis, submittals: t.submittals, valuations: t.valuations, defects: t.defects, inspections: t.inspections,
  observations: t.observations, changeOrders: t.change_orders,
  fieldDocuments: t.field_documents, fieldDocumentSubmissions: t.field_document_submissions,
})

Deno.test('共用案例(Deno):協作項核心事項與案例完全一致(含順序)', () => {
  assert.deepEqual(items.map(core), cases.expected.core_items.map(core))
})

Deno.test('共用案例(Deno):契約義務的責任／基準日缺口／期限與案例一致', () => {
  const got = t.contract_obligations
    .filter((ob) => isObligationOpen(ob.status))
    .map((ob) => {
      const dueMs = computeObligationDueUTC(ob, cases.anchors, TODAY)
      const dueIso = dueMs == null ? null : formatDate(dueMs)
      const ball = obligationBall(ob, { dueIso, anchors: cases.anchors })
      return { id: ob.id, who: ball.who, title: ob.title, label: ball.label, due: dueIso, setup: ball.setup?.kind ?? null }
    })
    .filter((x) => x.who !== 'done')
  assert.deepEqual(got, cases.expected.obligations)
})

Deno.test('共用案例(Deno):每方的球(soonDays=7 與 0)與待補設定與案例一致', () => {
  for (const soon of [7, 0] as const) {
    const obligations = t.contract_obligations.filter((ob) => isObligationOpen(ob.status)).map((ob) => {
      const dueMs = computeObligationDueUTC(ob, cases.anchors, TODAY)
      const dueIso = dueMs == null ? null : formatDate(dueMs)
      return { ob, dueIso, ball: obligationBall(ob, { dueIso, anchors: cases.anchors }) }
    })
    const setup = [
      ...items.filter((i) => i.who === 'unassigned').map((i) => `${i.tag}:${i.id}`),
      ...obligations.filter((x) => x.ball.setup).map((x) => `契約重點:${x.ob.id}`),
    ]
    assert.deepEqual(sorted(setup), sorted(cases.expected.setup))
    for (const org of ORGS) {
      const mine = [
        ...items.filter((i) => i.who === org).map((i) => `${i.tag}:${i.id}`),
        ...obligations
          .filter((x) => x.ball.who === org && !x.ball.setup && obligationInWindow(x.dueIso, cases.today, soon))
          .map((x) => `契約重點:${x.ob.id}`),
      ]
      assert.deepEqual(sorted(mine), sorted(cases.expected.mine[soon === 7 ? 'soon7' : 'soon0'][org]), `${org} soon=${soon}`)
    }
  }
})
