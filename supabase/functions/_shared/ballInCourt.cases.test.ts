// P5a 球權共用案例——Edge 路徑(收集器 collectOpenBallItems、Agent 工具 list_my_open_items、
// 早報 itemsForRecipient／splitBrief)。同一份 tests/fixtures/ball-in-court.cases.json 由
// src/lib/ballInCourt.cases.test.js(首頁)與 ballInCourtRules.deno.test.ts(Deno 執行期)斷言。
import { describe, it, expect } from 'vitest'
import cases from '../../../tests/fixtures/ball-in-court.cases.json'
import { collectOpenBallItems } from './ballInCourt.ts'
import type { OpenBallItem } from './ballInCourt.ts'
import { listMyOpenItems } from './agentQueryTools.ts'
import { itemsForRecipient, splitBrief } from './agentBrief.ts'
import { parseDateUTC } from './contractDue.ts'
import type { AgentRole } from './agentPersona.ts'

const ORGS: AgentRole[] = ['contractor', 'supervisor', 'owner']
const TODAY = parseDateUTC(cases.today)!
const tables = cases.tables as unknown as Record<string, unknown[]>

// 最小可用的 Supabase client 假件:from().select().eq()/.neq()/.in()(awaitable)、projects 的
// .maybeSingle() 回基準日、rpc('my_org_type') 回指定角色。過濾條件不模擬——案例資料本來就
// 只有本案,已結／不適用列由共用規則自己排除,這正是要驗的事。
function fakeDb(orgType: string | null = null) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      Object.assign(builder, {
        select: chain, eq: chain, neq: chain, in: chain, order: chain, limit: chain,
        maybeSingle: () => Promise.resolve({ data: cases.anchors, error: null }),
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok, err),
      })
      return builder
    },
    rpc: () => Promise.resolve({ data: orgType, error: null }),
  } as never
}

const key = (x: { kind: string; id: string }) => `${x.kind}:${x.id}`
const sorted = (xs: string[]) => [...xs].sort()
const expectedObligations = new Map(cases.expected.obligations.map((o) => [o.id, o]))

async function collect(soonDays: number): Promise<OpenBallItem[]> {
  const r = await collectOpenBallItems(fakeDb(), cases.project_id, TODAY, { obligationSoonDays: soonDays })
  if ('error' in r) throw new Error(r.error)
  return r.items
}

describe('共用案例(Edge):collectOpenBallItems', () => {
  it('協作項核心事項與案例一致(id／責任／類型／標題／狀態／狀態句／期限)', async () => {
    const items = (await collect(7)).filter((i) => i.kind !== '契約重點')
    const got = Object.fromEntries(items.map((i) => [key(i), { id: i.id, who: i.side, tag: i.kind, title: i.title, status: i.status, meta: i.meta, due: i.due_date }]))
    const want = Object.fromEntries(cases.expected.core_items.map((x) => [`${x.tag}:${x.id}`, x]))
    expect(got).toEqual(want)
  })
  it('契約義務:責任／基準日缺口／標籤／期限與案例一致;窗口外的不列', async () => {
    const items = (await collect(7)).filter((i) => i.kind === '契約重點')
    const inWindow = cases.expected.obligations.filter((o) => o.setup || ['ob2', 'ob8', 'ob11'].includes(o.id))
    expect(sorted(items.map((i) => i.id))).toEqual(sorted(inWindow.map((o) => o.id)))
    for (const i of items) {
      const want = expectedObligations.get(i.id)!
      expect(i.side, i.id).toBe(want.who)
      expect(i.title, i.id).toBe(want.title)
      expect(i.meta.startsWith(want.label), `${i.id} meta=${i.meta}`).toBe(true)
      expect(i.due_date, i.id).toBe(want.due)
      expect(i.setup?.kind ?? null, i.id).toBe(want.setup)
    }
    expect(items.find((i) => i.id === 'ob1')!.meta).toBe('責任方待補設定（依 第9條）')
  })
  it('逾期天數與案例一致;待補設定不算逾期', async () => {
    const byKey = Object.fromEntries((await collect(7)).map((i) => [key(i), i]))
    for (const [k, days] of Object.entries(cases.expected.overdue_days)) expect(byKey[k].overdue_days, k).toBe(days)
    expect(byKey['契約重點:ob1'].overdue_days).toBeUndefined()
  })
  it('每方的球(soonDays=7)= 案例 mine.soon7;待補設定三方共同可見', async () => {
    const items = await collect(7)
    for (const org of ORGS) {
      expect(sorted(items.filter((i) => i.side === org && !i.setup).map(key))).toEqual(sorted(cases.expected.mine.soon7[org]))
    }
    expect(sorted(items.filter((i) => i.setup).map(key))).toEqual(sorted(cases.expected.setup))
  })
})

describe('共用案例(Edge):Agent 工具 list_my_open_items(只列逾期義務)', () => {
  it.each(ORGS)('%s:items = 案例 mine.soon0;setup_pending 三方相同並附處理入口', async (org) => {
    const r = await listMyOpenItems(fakeDb(org), cases.project_id, {}, TODAY) as {
      items?: { kind: string; id: string }[]
      setup_pending?: { kind: string; id: string; setup: string; responsible: string; fix_at: string }[]
    }
    expect(sorted((r.items ?? []).map(key))).toEqual(sorted(cases.expected.mine.soon0[org]))
    expect(sorted((r.setup_pending ?? []).map(key))).toEqual(sorted(cases.expected.setup))
    const byId = Object.fromEntries((r.setup_pending ?? []).map((s) => [s.id, s]))
    expect(byId['ob1']).toMatchObject({ setup: 'responsible', responsible: '待補設定' })
    expect(byId['ob1'].fix_at).toContain('擷取審核')
    expect(byId['ob3']).toMatchObject({ setup: 'anchor', responsible: '廠商' })
    expect(byId['ob3'].fix_at).toContain('基準日')
    expect(byId['o3']).toMatchObject({ setup: 'responsible', responsible: '待補設定' })
  })
})

describe('共用案例(Edge):早報 itemsForRecipient／splitBrief', () => {
  it.each(ORGS)('%s 的早報事項 = 案例 mine.soon7;待補設定另成一段', async (org) => {
    const sections = splitBrief(itemsForRecipient(await collect(7), org), TODAY)
    const mine = [...sections.overdue, ...sections.dueSoon, ...sections.pending]
    expect(sorted(mine.map(key))).toEqual(sorted(cases.expected.mine.soon7[org]))
    expect(sorted(sections.setupPending.map(key))).toEqual(sorted(cases.expected.setup))
  })
})
