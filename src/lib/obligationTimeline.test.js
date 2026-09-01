// 契約重點 · 履約時程的權限與推導合約。釘住三件事:
//   1. 三方可見範圍只有一張表(廠商=自己、監造=+廠商、機關=全部)
//   2. 動作與角色無關,只看歸屬(canAct = who === viewerParty)
//   3. 執行卡是稽核數字:五狀態加總必須等於該方義務總數
import { describe, it, expect } from 'vitest'
import {
  VISIBLE, PARTIES, ORG_TO_PARTY, obligationParty, canActOn,
  deriveStatus, countdownLabel, phaseOf, phaseWindows,
  partyStat, phaseStat, pickDefaultId, buildTimelineItem, matchesFilters,
  anchorGaps,
} from './obligationTimeline.js'

const TODAY = new Date(2026, 7, 25) // 2026-08-25
const anchors = { commencement_date: '2026-03-01', end_date: '2027-05-30' }

const ob = (over = {}) => ({
  id: 'OB-X', title: '提送施工月報', category: '施工中', responsible: '廠商',
  status: '待辦', trigger_event: 'fixed', fixed_date: '2026-09-30', ...over,
})

describe('三方可見範圍(本頁唯一權限規則)', () => {
  it('廠商只看自己;監造看自己+廠商;機關看全部', () => {
    expect(VISIBLE.廠商).toEqual(['廠商'])
    expect(VISIBLE.監造).toEqual(['監造', '廠商'])
    expect(VISIBLE.機關).toEqual(['廠商', '監造', '機關'])
  })
  it('org_type 對映三方;未知 responsible 落回廠商(不憑空造第四方)', () => {
    expect(ORG_TO_PARTY).toEqual({ contractor: '廠商', supervisor: '監造', owner: '機關' })
    expect(obligationParty({ responsible: '監造' })).toBe('監造')
    expect(obligationParty({ responsible: '設計單位' })).toBe('廠商')
    expect(obligationParty({})).toBe('廠商')
  })
  it('可見過濾:監造看不到機關義務、廠商看不到監造義務', () => {
    const items = PARTIES.map((p) => ({ who: p }))
    const seen = (role) => items.filter((i) => VISIBLE[role].includes(i.who)).map((i) => i.who)
    expect(seen('廠商')).toEqual(['廠商'])
    expect(seen('監造')).toEqual(['廠商', '監造'])
    expect(seen('機關')).toEqual(['廠商', '監造', '機關'])
  })
})

describe('動作權限只看歸屬', () => {
  it('who === viewerParty 才能操作,監造/機關看廠商義務一律唯讀', () => {
    expect(canActOn({ who: '廠商' }, '廠商')).toBe(true)
    expect(canActOn({ who: '廠商' }, '監造')).toBe(false)
    expect(canActOn({ who: '廠商' }, '機關')).toBe(false)
    expect(canActOn({ who: '機關' }, '機關')).toBe(true)
  })
  it('機關對自己的義務同樣可操作(migration 20260825120000 起伺服器同一條規則)', () => {
    expect(canActOn({ who: '機關' }, '機關')).toBe(true)
    expect(canActOn({ who: '監造' }, '機關')).toBe(false)
  })
})

describe('狀態推導(7 日門檻與 contractDue 同一套帳)', () => {
  it('已提送/已完成 → done;逾期 <0;≤7 日=due;>7=scheduled', () => {
    expect(deriveStatus(ob({ status: '已提送' }), anchors, TODAY).key).toBe('done')
    expect(deriveStatus(ob({ status: '已完成' }), anchors, TODAY).key).toBe('done')
    expect(deriveStatus(ob({ fixed_date: '2026-08-22' }), anchors, TODAY).key).toBe('overdue')
    expect(deriveStatus(ob({ fixed_date: '2026-08-25' }), anchors, TODAY).key).toBe('due')
    expect(deriveStatus(ob({ fixed_date: '2026-09-01' }), anchors, TODAY).key).toBe('due')
    expect(deriveStatus(ob({ fixed_date: '2026-09-02' }), anchors, TODAY).key).toBe('scheduled')
  })
  it('推不出到期日(基準日未定)→ na,不臆測日期', () => {
    const noAnchor = ob({ trigger_event: 'completion', fixed_date: null, offset_days: 30 })
    expect(deriveStatus(noAnchor, {}, TODAY).key).toBe('na')
    expect(deriveStatus(noAnchor, anchors, TODAY).key).toBe('scheduled') // 基準日補上就推得出
  })
  it('倒數文案:逾期/今天/日/月/年/已完成/未觸發', () => {
    expect(countdownLabel('overdue', -15)).toBe('逾期 15 日')
    expect(countdownLabel('due', 0)).toBe('今天到期')
    expect(countdownLabel('due', 5)).toBe('還有 5 日')
    expect(countdownLabel('scheduled', 59)).toBe('還有 59 日')
    expect(countdownLabel('scheduled', 60)).toBe('還有 2 個月')
    expect(countdownLabel('scheduled', 730)).toBe('還有 2.0 年')
    expect(countdownLabel('done', null)).toBe('已完成')
    expect(countdownLabel('na', null)).toBe('未觸發')
  })
})

describe('期程分段', () => {
  const due = (o) => deriveStatus(o, anchors, TODAY).due
  it('category 定 pre/finish/warranty;施工中依到期日切出開工後 30 日內', () => {
    expect(phaseOf(ob({ category: '開工前' }), null, anchors)).toBe('pre')
    expect(phaseOf(ob({ category: '完工' }), null, anchors)).toBe('finish')
    expect(phaseOf(ob({ category: '保固' }), null, anchors)).toBe('warranty')
    const early = ob({ fixed_date: '2026-03-15' })
    expect(phaseOf(early, due(early), anchors)).toBe('start')
    const late = ob({ fixed_date: '2026-09-30' })
    expect(phaseOf(late, due(late), anchors)).toBe('build')
  })
  it('里程碑缺就顯示 —,不臆測日期;今天落在施工期間', () => {
    const w = phaseWindows(anchors, null, TODAY)
    expect(w.nowPhase).toBe('build')
    expect(w.ranges.start).toBe('2026-03-01 – 2026-03-31')
    expect(w.ranges.warranty).toBe('2027-05-30 後')
    const none = phaseWindows({}, null, TODAY)
    expect(none.nowPhase).toBe(null)
    expect(none.ranges.pre).toBe('—')
  })
})

describe('履約執行卡(稽核數字)', () => {
  const items = [
    { status: 'done' }, { status: 'done' }, { status: 'overdue' },
    { status: 'due' }, { status: 'scheduled' }, { status: 'na' },
  ]
  it('五狀態加總 = 義務總數,一條都不能對不起來', () => {
    const s = partyStat(items)
    expect(s.n.overdue + s.n.due + s.n.scheduled + s.n.done + s.n.na).toBe(s.total)
  })
  it('應完成項準時率 = 準時完成 ÷ (done+overdue),未到期不計;無到期項 → null(顯示 —)', () => {
    expect(partyStat(items).rate).toBe(67) // onTime 缺值視為準時:2/3
    expect(partyStat([{ status: 'scheduled' }, { status: 'na' }]).rate).toBe(null)
    expect(partyStat([{ status: 'done' }]).rate).toBe(100)
  })
  it('遲交補完成不灌高比率:onTime=false 的已完成留在分母、不進分子', () => {
    const s = partyStat([{ status: 'done', onTime: false }, { status: 'done', onTime: true }, { status: 'overdue' }])
    expect(s.settled).toBe(3)
    expect(s.onTime).toBe(1)
    expect(s.rate).toBe(33)
  })
})

describe('期程段摘要(文案優先序:逾期 → 即將到期 → 全部完成 → 排程中)', () => {
  const mk = (statuses) => statuses.map((s, i) => ({ phase: 'build', status: s, id: i }))
  it('優先序與軌道語意', () => {
    expect(phaseStat([], 'build', 'build')).toMatchObject({ note: '無義務', track: 'empty' })
    expect(phaseStat(mk(['overdue', 'done']), 'build', 'build'))
      .toMatchObject({ note: '2 項 · 1 項逾期', tone: 'danger', track: 'danger' })
    expect(phaseStat(mk(['due', 'scheduled']), 'build', 'build'))
      .toMatchObject({ note: '2 項 · 1 項即將到期', tone: 'warn' })
    expect(phaseStat(mk(['done', 'done']), 'build', 'other'))
      .toMatchObject({ note: '2 項 · 全部完成', track: 'ok' })
    expect(phaseStat(mk(['scheduled']), 'build', 'build')).toMatchObject({ track: 'accent' })
    expect(phaseStat(mk(['scheduled']), 'build', 'pre')).toMatchObject({ track: 'muted' })
  })
})

describe('預設選中與篩選', () => {
  it('第一條已逾期 → 第一條即將到期 → 清單第一條', () => {
    expect(pickDefaultId([{ id: 'a', status: 'done' }, { id: 'b', status: 'overdue' }])).toBe('b')
    expect(pickDefaultId([{ id: 'a', status: 'done' }, { id: 'b', status: 'due' }])).toBe('b')
    expect(pickDefaultId([{ id: 'a', status: 'done' }])).toBe('a')
    expect(pickDefaultId([])).toBe(null)
  })
  it('三種條件 AND;搜尋涵蓋條款/頁碼/原文/推算方式', () => {
    const item = buildTimelineItem(
      ob({ source_clause: '第 10 條', source_page: 'p.14', trigger_event: null, recurring: 'monthly', recurring_day: 5 }),
      { anchors, today: TODAY },
    )
    const f = { q: '', status: 'all', phase: 'all', who: '', type: '' }
    expect(matchesFilters(item, f)).toBe(true)
    expect(matchesFilters(item, { ...f, q: '第 10 條' })).toBe(true)
    expect(matchesFilters(item, { ...f, q: 'p.14' })).toBe(true)
    expect(matchesFilters(item, { ...f, q: '每月 5 日' })).toBe(true) // 推算方式
    expect(matchesFilters(item, { ...f, who: '監造' })).toBe(false)
    expect(matchesFilters(item, { ...f, status: 'done' })).toBe(false)
    expect(matchesFilters(item, { ...f, q: '不存在的詞' })).toBe(false)
  })
})

describe('檢視模型組裝', () => {
  it('無 requirement(demo/人工)時退回義務列自身欄位', () => {
    const it1 = buildTimelineItem(ob({ note: '含進度與工安' }), { anchors, today: TODAY })
    expect(it1.who).toBe('廠商')
    expect(it1.desc).toBe('含進度與工安')
    expect(it1.type).toBe('期限')
    expect(it1.quote).toBe('')
    expect(it1.verified).toBe(null)
    expect(it1.dateLabel).toBe('2026-09-30')
  })
  it('掛 requirement + 出處時吃引述/允收標準/類型', () => {
    const versions = new Map([['v1', { version_label: 'v1', documents: { title: '工程契約書' } }]])
    const it2 = buildTimelineItem(ob(), {
      requirement: {
        requirement_type: 'submittal', description: '每月 10 日前提送',
        acceptance_criteria: '月報齊備', evidence_requirement: '施工月報',
      },
      sources: [{ clause: '9.4', page_number: 25, source_text: '乙方應於每月十日前檢送', source_verified: true, document_version_id: 'v1' }],
      versionsById: versions, anchors, today: TODAY,
    })
    expect(it2.type).toBe('送審')
    expect(it2.clause).toBe('9.4')
    expect(it2.page).toBe('第 25 頁')
    expect(it2.doc).toContain('工程契約書')
    expect(it2.verified).toBe(true)
    expect(it2.criteria).toBe('月報齊備')
  })
  it('completed_at 決定準時:台北日 ≤ 到期日準時、晚於遲交、缺值不臆造歷史(視為準時)', () => {
    const done = ob({ status: '已完成' }) // 到期 2026-09-30
    expect(buildTimelineItem({ ...done, completed_at: '2026-09-29T10:00:00Z' }, { anchors, today: TODAY }).onTime).toBe(true)
    expect(buildTimelineItem({ ...done, completed_at: '2026-10-02T10:00:00Z' }, { anchors, today: TODAY }).onTime).toBe(false)
    expect(buildTimelineItem(done, { anchors, today: TODAY }).onTime).toBe(true)
    expect(buildTimelineItem(ob(), { anchors, today: TODAY }).onTime).toBe(null) // 未完成不判定
  })
  it('每月循環義務帶頻率標籤與推算文案', () => {
    const it3 = buildTimelineItem(
      ob({ trigger_event: null, recurring: 'monthly', recurring_day: 5, fixed_date: null }),
      { anchors, today: TODAY },
    )
    expect(it3.kind).toBe('每月循環')
    expect(it3.calc).toContain('每月 5 日')
  })
})

describe('基準日缺口(anchorGaps):數字必須等於「設完基準日會多出到期日」的條數', () => {
  const item = (over, anc) => buildTimelineItem(ob(over), { anchors: anc, today: TODAY })
  it('觸發點映到缺值錨點才算;輸出照固定順序、含中文標籤', () => {
    const none = {}
    const items = [
      item({ trigger_event: 'commencement', fixed_date: null, offset_days: 14 }, none),
      item({ trigger_event: 'commencement', fixed_date: null, offset_days: 30 }, none),
      item({ trigger_event: 'award', fixed_date: null, offset_days: 7 }, none),
    ]
    expect(anchorGaps(items, none)).toEqual({
      total: 3,
      gaps: [
        { key: 'award_date', label: '決標日', count: 1 },
        { key: 'commencement_date', label: '開工日', count: 2 },
      ],
    })
  })
  it('基準日已設 → 缺口歸零(項目有到期日,不再是 na)', () => {
    const anc = { commencement_date: '2026-03-01', award_date: '2026-01-15' }
    const items = [
      item({ trigger_event: 'commencement', fixed_date: null, offset_days: 14 }, anc),
      item({ trigger_event: 'award', fixed_date: null, offset_days: 7 }, anc),
    ]
    expect(anchorGaps(items, anc).total).toBe(0)
  })
  it('不是被基準日卡住的 na 不算:fixed 缺日期、無觸發點', () => {
    const none = {}
    const items = [
      item({ trigger_event: 'fixed', fixed_date: null }, none),
      item({ trigger_event: null, fixed_date: null }, none),
    ]
    expect(anchorGaps(items, none).total).toBe(0)
  })
  it('已完成的不算(status=done,不是 na);循環配置完整的有到期日也不算', () => {
    const none = {}
    const items = [
      item({ trigger_event: 'commencement', fixed_date: null, status: '已完成' }, none),
      item({ trigger_event: null, fixed_date: null, recurring: 'monthly', recurring_day: 5 }, none),
    ]
    expect(anchorGaps(items, none).total).toBe(0)
  })
  it('循環配置破損落回基準日分支:開工觸發+缺開工日 → 照算', () => {
    const none = {}
    const items = [
      item({ trigger_event: 'commencement', fixed_date: null, recurring: 'monthly', recurring_day: null }, none),
    ]
    expect(anchorGaps(items, none)).toEqual({
      total: 1,
      gaps: [{ key: 'commencement_date', label: '開工日', count: 1 }],
    })
  })
})
