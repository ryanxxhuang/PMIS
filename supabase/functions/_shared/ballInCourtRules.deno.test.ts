// P5a 球權共用案例——Deno 執行期。同一份 tests/fixtures/ball-in-court.cases.json,Vitest 已在
// 前端路徑(src/lib/ballInCourt.cases.test.js)與 Edge 路徑(ballInCourt.cases.test.ts)各跑一次;
// 這裡用 Edge 真正的執行期(Deno)再跑一次,證明規則模組在部署環境產出相同結果。
// P5b 起循環義務逐期列(obligationEntries 讀期次 ob.periods),鍵為 契約重點:<id>:<期別>。
// 執行:npm run test:edge。只用 node:assert 與 JSON import,不需要 lockfile 之外的依賴。
import assert from 'node:assert/strict'
import cases from '../../../tests/fixtures/ball-in-court.cases.json' with { type: 'json' }
import { coreOpenItems, obligationEntries, obligationInWindow, periodTitle, periodBasisLabel, warrantyGap, warrantyNeeds, timingGap } from './ballInCourtRules.ts'
import { computeObligationDueUTC, formatDate } from './contractDue.ts'

const ORGS = ['contractor', 'supervisor', 'owner'] as const
const t = cases.tables
const core = (x: { id: string | null; who: string; tag: string; title: string; status: string; meta: string; due: string | null }) =>
  ({ id: x.id, who: x.who, tag: x.tag, title: x.title, status: x.status, meta: x.meta, due: x.due })
const sorted = (xs: string[]) => [...xs].sort()

const items = coreOpenItems({
  rfis: t.rfis, submittals: t.submittals, valuations: t.valuations, defects: t.defects, inspections: t.inspections,
  observations: t.observations, changeOrders: t.change_orders,
  fieldDocuments: t.field_documents, fieldDocumentSubmissions: t.field_document_submissions,
  valuationAdjustments: t.valuation_adjustments,
})
const computeDueIso = (ob: Record<string, unknown>) => {
  const ms = computeObligationDueUTC(ob, cases.anchors)
  return ms == null ? null : formatDate(ms)
}
// 每條義務的球(單次一顆;循環每個未結期次一顆;P5c 停止條件判不出再一顆 setup.stop)
const obligations = t.contract_obligations.flatMap((ob) =>
  obligationEntries(ob, { anchors: cases.anchors, computeDueIso, todayIso: cases.today }).map((e) => ({ ob, ...e })))
const keyOf = (x: { ob: { id: string }; period: { period_key?: unknown } | null }) =>
  `契約重點:${x.ob.id}${x.period ? `:${x.period.period_key}` : ''}`

Deno.test('共用案例(Deno):協作項核心事項與案例完全一致(含順序)', () => {
  assert.deepEqual(items.map(core), cases.expected.core_items.map(core))
})

Deno.test('共用案例(Deno):基準日版本(P5c)——單次義務到期日(含完成快照)與期次依據句與案例一致', () => {
  const singleDue = Object.fromEntries(t.contract_obligations.filter((ob) => !('recurring' in ob) || !ob.recurring).map((ob) => [ob.id, computeDueIso(ob)]))
  assert.deepEqual(singleDue, cases.expected.single_due)
  const want = cases.expected.period_basis as Record<string, string>
  const got: Record<string, string> = {}
  for (const ob of t.contract_obligations) {
    for (const p of ('periods' in ob ? ob.periods : []) as Record<string, unknown>[]) {
      const k = `${ob.id}:${p.period_key}`
      if (want[k]) got[k] = periodBasisLabel(p)
    }
  }
  assert.deepEqual(got, want)
})

Deno.test('共用案例(Deno):契約義務(含循環期次)的責任／缺口／標籤／期限與案例一致', () => {
  const got = obligations
    .filter((x) => x.ball.who !== 'done')
    .map((x) => ({
      id: x.ob.id, period: x.period ? String(x.period.period_key) : null, who: x.ball.who,
      title: periodTitle(x.ob.title, x.period), label: x.ball.label, due: x.dueIso, setup: x.ball.setup?.kind ?? null,
    }))
  assert.deepEqual(got, cases.expected.obligations)
})

Deno.test('共用案例(Deno):每方的球(soonDays=7 與 0)與待補設定與案例一致', () => {
  for (const soon of [7, 0] as const) {
    const setup = [
      ...items.filter((i) => i.who === 'unassigned').map((i) => `${i.tag}:${i.id}`),
      ...obligations.filter((x) => x.ball.setup).map(keyOf),
    ]
    assert.deepEqual(sorted(setup), sorted(cases.expected.setup))
    for (const org of ORGS) {
      const mine = [
        ...items.filter((i) => i.who === org).map((i) => `${i.tag}:${i.id}`),
        ...obligations
          .filter((x) => x.ball.who === org && !x.ball.setup && obligationInWindow(x.dueIso, cases.today, soon))
          .map(keyOf),
      ]
      assert.deepEqual(sorted(mine), sorted(cases.expected.mine[soon === 7 ? 'soon7' : 'soon0'][org]), `${org} soon=${soon}`)
    }
  }
})

// F1 單次義務的時點缺口:純函式案例表(DB fn_obligation_timing_gap 由 pgTAP 對同一組斷言)
Deno.test('共用案例(Deno):時點待補——timingGap 對案例表說同一句', () => {
  for (const c of cases.expected.timing_gaps.cases) {
    const ob = { trigger_event: c.trigger_event, offset_days: c.offset_days, fixed_date: c.fixed_date, recurring: c.recurring, requirement: { requirement_type: c.requirement_type } }
    assert.equal(timingGap(ob), c.gap, c.name)
  }
})

// P5e 保固類循環義務的停止條件:同一條保固類每月義務 × RPC get_project_warranty 回傳的五種保固事實
Deno.test('共用案例(Deno):保固類停止條件——缺口說法、缺哪幾項、期次與依據句與案例一致', () => {
  for (const sc of cases.warranty.scenarios) {
    assert.equal(warrantyGap(sc.warranty), sc.expected.gap, sc.name)
    assert.deepEqual(warrantyNeeds(sc.warranty), sc.expected.needs, sc.name)
    const ob = { ...cases.warranty.obligation, periods: sc.periods }
    const anchors = { ...cases.anchors, warranty: sc.warranty }
    const got = obligationEntries(ob, { anchors, computeDueIso, todayIso: cases.today })
      .filter((e) => e.ball.who !== 'done')
      .map((e) => ({
        period: e.period ? String(e.period.period_key) : null, label: e.ball.label, due: e.dueIso,
        setup: e.ball.setup?.kind ?? null, need: e.ball.setup?.need ?? null,
      }))
    assert.deepEqual(got, sc.expected.entries, sc.name)
    const basis = (sc.expected as { basis?: Record<string, string> }).basis ?? {}
    for (const [k, label] of Object.entries(basis)) {
      assert.equal(periodBasisLabel(sc.periods.find((p) => p.period_key === k)), label, `${sc.name} ${k}`)
    }
  }
})
