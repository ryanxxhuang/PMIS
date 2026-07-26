// 驗證「你的 agent 早報」(send-reminders)確定性內容組裝:
//   * collectOpenBallItems(agentTools):全陣營收集 + obligationSoonDays 行為
//   * testSampleItems:試體齡期 → 品管早報項
//   * itemsForRecipient:陣營過濾 + 同陣營偏好路由(試驗→qc、工安→field)與回落
//   * splitBrief / shouldSendBrief:「沒有屬於這個角色的事就不寄」
//   * renderBriefEmail / briefSubject:角色化信件(確定性,無 LLM)
import { describe, it, expect } from 'vitest'
import { collectOpenBallItems } from './agentTools.ts'
import type { OpenBallItem } from './agentTools.ts'
import { parseDateUTC } from './contractDue.ts'
import {
  testSampleItems, itemsForRecipient, splitBrief, shouldSendBrief,
  briefSubject, renderBriefEmail, briefDateLabel,
} from './agentBrief.ts'

const TODAY = parseDateUTC('2026-07-26')!

// 最小可用的 Supabase client 假件:collectOpenBallItems 只用
// from().select().eq()/.neq()/.in()(awaitable)與 projects 的 .maybeSingle()
function fakeDb(tables: Record<string, unknown[]>, project: Record<string, unknown> | null = {}) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      Object.assign(builder, {
        select: chain, eq: chain, neq: chain, in: chain, order: chain, limit: chain,
        maybeSingle: () => Promise.resolve({ data: project, error: null }),
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok, err),
      })
      return builder
    },
  } as never
}

const item = (over: Partial<OpenBallItem>): OpenBallItem => ({
  side: 'contractor', kind: '缺失', id: 'x', title: 't', status: 's', meta: 'm', due_date: null, ...over,
})

describe('collectOpenBallItems(與 list_my_open_items 同一份實作)', () => {
  const tables = {
    defects: [
      { id: 'd1', title: '裂縫修補', severity: '一般', status: '開立', due_date: '2026-07-20', domain: 'quality' },
      { id: 'd2', title: '焊道複查', severity: '一般', status: '待複查', due_date: null, domain: 'quality' },
      { id: 'd3', title: '開口未護欄', severity: '重大', status: '改善中', due_date: null, domain: 'safety' },
    ],
    submittals: [{ id: 's1', submittal_no: 'SUB-001', title: '鋼筋施工計畫', status: '審核中', due_date: '2026-07-30' }],
    rfis: [{ id: 'r1', rfi_no: 'RFI-001', title: '圖說矛盾', status: '已回覆', due_date: null }],
    valuations: [{ id: 'v1', period_no: 3, status: '已核定', invoice_date: '2026-07-01', paid_date: null }],
    contract_obligations: [
      { id: 'o1', title: '履約保險單', responsible: null, trigger_event: 'fixed', fixed_date: '2026-07-10', source_clause: '第9條' },
      { id: 'o2', title: '監造月報', responsible: '監造', trigger_event: 'fixed', fixed_date: '2026-07-29', source_clause: '第12條' },
    ],
  }

  it('各模組的球都標對陣營;逾期算出 overdue_days', async () => {
    const r = await collectOpenBallItems(fakeDb(tables), 'p1', TODAY, { obligationSoonDays: 7 })
    if ('error' in r) throw new Error(r.error)
    const byId = Object.fromEntries(r.items.map((i) => [i.id, i]))
    expect(byId['d1']).toMatchObject({ side: 'contractor', kind: '缺失', overdue_days: 6 })
    expect(byId['d2']).toMatchObject({ side: 'supervisor', meta: '待監造複查' })
    expect(byId['d3']).toMatchObject({ side: 'contractor', kind: '工安缺失' })
    expect(byId['s1']).toMatchObject({ side: 'supervisor', kind: '送審' })
    expect(byId['r1']).toMatchObject({ side: 'contractor', kind: '疑義' })
    expect(byId['v1']).toMatchObject({ side: 'owner', kind: '估驗', meta: '待機關撥款' })
    // 義務:responsible 未填 → 廠商;逾期 16 天
    expect(byId['o1']).toMatchObject({ side: 'contractor', kind: '契約義務', overdue_days: 16 })
    expect(byId['o1'].meta).toContain('第9條')
    // soonDays=7 → 未逾期但 3 天內到期的監造義務也收
    expect(byId['o2']).toMatchObject({ side: 'supervisor', due_date: '2026-07-29' })
    expect(byId['o2'].overdue_days).toBeUndefined()
  })

  it('預設(工具行為)只收逾期義務,不收即將到期', async () => {
    const r = await collectOpenBallItems(fakeDb(tables), 'p1', TODAY)
    if ('error' in r) throw new Error(r.error)
    const ids = r.items.map((i) => i.id)
    expect(ids).toContain('o1')
    expect(ids).not.toContain('o2')
  })

  it('到期日近的排前面,沒有到期日的排最後', async () => {
    const r = await collectOpenBallItems(fakeDb(tables), 'p1', TODAY, { obligationSoonDays: 7 })
    if ('error' in r) throw new Error(r.error)
    const dues = r.items.map((i) => i.due_date)
    const withDue = dues.filter((d) => d != null) as string[]
    expect(withDue).toEqual([...withDue].sort())
    expect(dues.slice(withDue.length).every((d) => d == null)).toBe(true)
  })
})

describe('testSampleItems(試體齡期 → 品管早報項)', () => {
  it('未試驗且齡期已到/將到 → 廠商陣營「試驗」項;已填/已判定/太遠的不收', () => {
    const items = testSampleItems([
      { id: 't1', sample_no: 'C-01', test_item: '混凝土抗壓', status: '待試驗', d7_due: '2026-07-20', d7_value: null, d28_due: '2026-08-10', d28_values: [] },
      { id: 't2', sample_no: 'C-02', test_item: '混凝土抗壓', status: '待試驗', d7_due: '2026-07-20', d7_value: 21.5, d28_due: '2026-07-28', d28_values: [] },
      { id: 't3', sample_no: 'C-03', test_item: '混凝土抗壓', status: '合格', d7_due: '2026-07-01', d7_value: null },
    ], TODAY)
    expect(items).toHaveLength(2)
    // t1:7天試驗逾期 6 天(d28 在 7 日窗外不收)
    expect(items[0]).toMatchObject({ id: 't1', side: 'contractor', kind: '試驗', overdue_days: 6, due_date: '2026-07-20' })
    expect(items[0].title).toContain('7天試驗')
    // t2:7天已填 → 只剩 28 天(2 天後到期,未逾期)
    expect(items[1]).toMatchObject({ id: 't2', due_date: '2026-07-28' })
    expect(items[1].overdue_days).toBeUndefined()
  })
})

describe('itemsForRecipient(陣營 + 偏好路由)', () => {
  const items = [
    item({ id: 'a', kind: '試驗' }),
    item({ id: 'b', kind: '工安缺失' }),
    item({ id: 'c', kind: '缺失' }),
    item({ id: 'd', kind: '送審', side: 'supervisor' }),
  ]
  const ids = (xs: OpenBallItem[]) => xs.map((i) => i.id)

  it('只拿自己陣營的球', () => {
    expect(ids(itemsForRecipient(items, 'supervisor', new Set(['field', 'supervisor'])))).toEqual(['d'])
    expect(ids(itemsForRecipient(items, 'owner', new Set(['owner'])))).toEqual([])
  })
  it('同陣營偏好路由:試驗歸品管、工安歸現場,一般缺失兩者都收', () => {
    const present = new Set(['field', 'qc'] as const)
    expect(ids(itemsForRecipient(items, 'field', present))).toEqual(['b', 'c'])
    expect(ids(itemsForRecipient(items, 'qc', present))).toEqual(['a', 'c'])
  })
  it('偏好角色不在專案裡 → 回落給同陣營成員(提醒不能沒人收到)', () => {
    const onlyField = new Set(['field'] as const)
    expect(ids(itemsForRecipient(items, 'field', onlyField))).toEqual(['a', 'b', 'c'])
  })
})

describe('splitBrief / shouldSendBrief(沒事就不寄)', () => {
  const sections = splitBrief([
    item({ id: 'over', due_date: '2026-07-20', overdue_days: 6 }),
    item({ id: 'today', due_date: '2026-07-26' }),
    item({ id: 'soon', due_date: '2026-08-01' }),
    item({ id: 'far', due_date: '2026-09-30' }),
    item({ id: 'nodue', due_date: null }),
  ], TODAY)

  it('逾期/7日內/其餘(無期限或還早)三段分明', () => {
    expect(sections.overdue.map((i) => i.id)).toEqual(['over'])
    expect(sections.dueSoon.map((i) => i.id)).toEqual(['today', 'soon'])
    expect(sections.pending.map((i) => i.id)).toEqual(['far', 'nodue'])
  })
  it('有逾期或 7 日內到期才寄;只有無期限未結項不寄', () => {
    expect(shouldSendBrief(sections)).toBe(true)
    expect(shouldSendBrief(splitBrief([item({ id: 'nodue' })], TODAY))).toBe(false)
    expect(shouldSendBrief(splitBrief([], TODAY))).toBe(false)
  })
})

describe('renderBriefEmail / briefSubject(角色化、確定性)', () => {
  const sections = splitBrief([
    item({ id: 'over', title: 'C-01 混凝土抗壓 7天試驗', kind: '試驗', due_date: '2026-07-20', overdue_days: 6, meta: '齡期到期未試驗' }),
    item({ id: 'soon', title: 'SUB-001 鋼筋施工計畫', kind: '送審', due_date: '2026-07-28', meta: '待監造審定' }),
  ], TODAY)
  const html = renderBriefEmail({
    role: 'qc', projectName: 'A 區新建工程', todayUTC: TODAY,
    sections, pendingDrafts: 2, agentUrl: 'https://x.test/#/agent',
  })

  it('開頭一句:{角色} Agent · {專案名} · {日期}', () => {
    expect(briefDateLabel(TODAY)).toBe('7/26')
    expect(html).toContain('品管 Agent · A 區新建工程 · 7/26')
  })
  it('第一段球在你手上(逾期紅字)、第二段 7 日內到期', () => {
    expect(html).toContain('今天球在你手上')
    expect(html).toContain('已逾期 6 天')
    expect(html).toContain('#c5221f') // 逾期紅
    expect(html).toContain('7 日內到期')
    expect(html).toContain('還有 2 天')
  })
  it('草稿收件匣段落只在有草稿時出現,連到 /agent', () => {
    expect(html).toContain('2 筆待覆核')
    expect(html).toContain('打開你的 Agent')
    expect(html).toContain('https://x.test/#/agent')
    const noDrafts = renderBriefEmail({
      role: 'qc', projectName: 'A', todayUTC: TODAY, sections, pendingDrafts: 0, agentUrl: 'https://x.test/#/agent',
    })
    expect(noDrafts).not.toContain('待覆核')
  })
  it('標題含角色與兩段件數;HTML 內容有跳脫', () => {
    expect(briefSubject('qc', 'A 區新建工程', sections)).toBe('【PMIS】品管 Agent · A 區新建工程:逾期 1 件、7 日內到期 1 件')
    const dirty = renderBriefEmail({
      role: 'field', projectName: '<script>alert(1)</script>', todayUTC: TODAY,
      sections, pendingDrafts: 0, agentUrl: 'https://x.test/#/agent',
    })
    expect(dirty).not.toContain('<script>')
    expect(dirty).toContain('&lt;script&gt;')
  })
})
