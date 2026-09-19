// 契約重點 · 履約時程的權限與推導合約。釘住三件事:
//   1. 三方可見範圍只有一張表(廠商=自己、監造=+廠商、機關=全部)
//   2. 動作與角色無關,只看歸屬(canAct = who === viewerParty)
//   3. 執行卡是稽核數字:五狀態加總必須等於該方義務總數
import { describe, it, expect } from 'vitest'
import {
  VISIBLE, PARTIES, ORG_TO_PARTY, obligationParty, canActOn, UNASSIGNED_PARTY, isVisibleTo,
  deriveStatus, countdownLabel, phaseOf, phaseWindows,
  partyStat, phaseStat, pickDefaultId, buildTimelineItem, matchesFilters,
  anchorGaps, periodRows, recurrenceGap, singleDueBasis, anchorVersionRows,
  setupGapsOf, isRecent, byUrgency, periodStat, SETUP_KINDS,
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
  it('org_type 對映三方;未知 responsible 是「待補設定」而不是第四方,也不再落回廠商(P5a,與 DB obligation_party 同步)', () => {
    expect(ORG_TO_PARTY).toEqual({ contractor: '廠商', supervisor: '監造', owner: '機關' })
    expect(obligationParty({ responsible: '監造' })).toBe('監造')
    expect(obligationParty({ responsible: ' 機關 ' })).toBe('機關')
    expect(obligationParty({ responsible: '設計單位' })).toBe(UNASSIGNED_PARTY)
    expect(obligationParty({ responsible: '其他' })).toBe(UNASSIGNED_PARTY)
    expect(obligationParty({})).toBe(UNASSIGNED_PARTY)
    expect(PARTIES.includes(UNASSIGNED_PARTY)).toBe(false)
  })
  it('待補設定對三方都可見,但三方都不能操作', () => {
    const it = { who: UNASSIGNED_PARTY }
    for (const p of PARTIES) {
      expect(isVisibleTo(it, p)).toBe(true)
      expect(canActOn(it, p)).toBe(false)
    }
    expect(isVisibleTo({ who: '監造' }, '廠商')).toBe(false)
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
    expect(countdownLabel('na', null)).toBe('無到期日')
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

// 循環義務逐期(P5b):狀態／到期日取最早未結的一期,整條不會 done;期次列唯讀呈現;沒有期次要說明原因
describe('循環義務逐期(P5b)', () => {
  const period = (key, due, status = '待辦', extra = {}) => ({ id: `p-${key}`, period_key: key, due_date: due, status, completed_at: null, review_note: null, ...extra })
  const monthly = (over = {}) => ob({
    trigger_event: null, fixed_date: null, recurring: 'monthly', recurring_day: 5,
    periods: [period('2026-06', '2026-06-05', '已完成', { completed_at: '2026-06-03T02:00:00Z' }), period('2026-07', '2026-07-05'), period('2026-08', '2026-08-05'), period('2026-09', '2026-09-05')],
    ...over,
  })
  it('狀態＝最早未結一期:7 月已逾期 → overdue、到期日 7/5;完成 7、8 月後 → 9 月排程中', () => {
    // TODAY=2026-08-25
    const it1 = buildTimelineItem(monthly(), { anchors, today: TODAY })
    expect(it1.recurring).toBe(true)
    expect(it1.status).toBe('overdue')
    expect(it1.dateLabel).toBe('2026-07-05')
    expect(it1.currentPeriod).toBe('2026-07')
    const done78 = monthly({ periods: monthly().periods.map((p) => (['2026-07', '2026-08'].includes(p.period_key) ? { ...p, status: '已提送' } : p)) })
    const it2 = buildTimelineItem(done78, { anchors, today: TODAY })
    expect(it2.status).toBe('scheduled')
    expect(it2.dateLabel).toBe('2026-09-05')
    expect(it2.currentPeriod).toBe('2026-09')
  })
  it('義務層舊的已完成不關閉循環義務(期次才是完成的單位)', () => {
    expect(deriveStatus(monthly({ status: '已完成' }), anchors, TODAY).key).toBe('overdue')
    expect(buildTimelineItem(monthly({ status: '已完成' }), { anchors, today: TODAY }).onTime).toBe(null)
  })
  it('期次列:依到期日降冪、每期狀態語意鍵與準時判定、待核對註記原樣帶出', () => {
    const rows = periodRows(monthly({ periods: [
      ...monthly().periods,
      period('2026-05', '2026-05-05', '已完成', { completed_at: '2026-05-08T02:00:00Z' }),
      period('2026-04', '2026-04-05', '待辦', { review_note: '原義務曾標為「已完成」但無法對應期別' }),
      period('2026-03', '2026-03-05', '不適用'),
    ] }), TODAY)
    expect(rows.map((r) => r.key)).toEqual(['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03'])
    expect(rows.map((r) => r.status)).toEqual(['scheduled', 'overdue', 'overdue', 'done', 'done', 'overdue', 'na'])
    expect(rows.find((r) => r.key === '2026-06').onTime).toBe(true)
    expect(rows.find((r) => r.key === '2026-05').onTime).toBe(false) // 5/8 完成 > 5/5 到期 → 遲交
    expect(rows.find((r) => r.key === '2026-04').reviewNote).toContain('無法對應期別')
    expect(rows.find((r) => r.key === '2026-03').countdown).toBe('不適用')
    expect(periodRows(ob(), TODAY)).toEqual([]) // 單次義務沒有期次
  })
  it('沒有期次的原因:循環規則不完整 → rule;基準日缺 → anchor(無觸發點看開工日);都齊 → null', () => {
    expect(recurrenceGap(monthly({ recurring_day: null, periods: [] }), anchors)).toEqual({ kind: 'rule', label: '循環規則待補（每月缺幾日）' })
    expect(recurrenceGap(monthly({ periods: [] }), {})).toEqual({ kind: 'anchor', label: '基準日待補（開工日）', anchor: 'commencement_date' })
    expect(recurrenceGap(monthly({ periods: [], trigger_event: 'award' }), { commencement_date: '2026-03-01' })).toEqual({ kind: 'anchor', label: '基準日待補（決標日）', anchor: 'award_date' })
    expect(recurrenceGap(monthly({ periods: [] }), anchors)).toBeNull()
    expect(recurrenceGap(ob(), {})).toBeNull()
    const na = buildTimelineItem(monthly({ periods: [] }), { anchors: {}, today: TODAY })
    expect(na.status).toBe('na')
    expect(na.recurrenceGap.kind).toBe('anchor')
  })
})

describe('基準日版本與依據(P5c)', () => {
  const period = (key, due, status = '待辦', extra = {}) => ({ id: `p-${key}`, period_key: key, due_date: due, status, completed_at: null, review_note: null, ...extra })
  const monthly = (over = {}) => ob({ trigger_event: null, fixed_date: null, recurring: 'monthly', recurring_day: 5, periods: [period('2026-08', '2026-08-05')], ...over })
  it('停止條件缺口:竣工日缺／已過／保固類 → stop;已登錄竣工或竣工日未到 → null;排在規則與基準日缺口之後', () => {
    expect(recurrenceGap(monthly(), { commencement_date: '2026-03-01' }, TODAY)).toEqual({ kind: 'stop', label: '停止條件待補（缺竣工日，無法判定循環何時結束）' })
    expect(recurrenceGap(monthly(), { commencement_date: '2026-03-01', end_date: '2026-07-31' }, TODAY)).toEqual({ kind: 'stop', label: '停止條件待補（竣工日 2026-07-31 已過，尚未登錄竣工或展延）' })
    expect(recurrenceGap(monthly({ category: '保固', periods: [] }), anchors, TODAY)).toEqual({ kind: 'stop', label: '停止條件待補（保固期滿日無法判定，未登錄保固年限）' })
    expect(recurrenceGap(monthly(), { commencement_date: '2026-03-01', completion_date: '2026-08-10' }, TODAY)).toBeNull()
    expect(recurrenceGap(monthly(), anchors, TODAY)).toBeNull()
    expect(recurrenceGap(monthly({ recurring_day: null }), { commencement_date: '2026-03-01' }, TODAY).kind).toBe('rule')
    expect(recurrenceGap(monthly(), {}, TODAY).kind).toBe('anchor')
    expect(buildTimelineItem(monthly(), { anchors: { commencement_date: '2026-03-01' }, today: TODAY }).recurrenceGap.kind).toBe('stop')
  })
  it('期次列帶依據句:第幾版基準日、起算欄位與日期;未留版明說', () => {
    const rows = periodRows(monthly({ periods: [
      period('2026-08', '2026-08-05', '待辦', { anchor_version_no: 2, basis: { anchor_key: 'commencement_date', anchor_date: '2026-03-01' } }),
      period('2026-07', '2026-07-05', '已完成', { completed_at: '2026-07-03T02:00:00Z', anchor_version_no: 1, basis: { anchor_key: 'commencement_date', anchor_date: '2026-02-20' } }),
      period('2026-06', '2026-06-05', '已完成', { completed_at: '2026-06-03T02:00:00Z' }),
    ] }), TODAY)
    expect(rows.map((r) => [r.key, r.anchorVersionNo, r.basisLabel])).toEqual([
      ['2026-08', 2, '第 2 版基準日（開工日 2026-03-01）'],
      ['2026-07', 1, '第 1 版基準日（開工日 2026-02-20）'], // 已完成的期保留產生時的依據
      ['2026-06', null, '產生時未留版（起算日未記錄）'],
    ])
    const item = buildTimelineItem(monthly({ periods: [period('2026-08', '2026-08-05', '待辦', { anchor_version_no: 3, basis: { anchor_key: 'fixed_date', anchor_date: '2026-01-15' } })] }), { anchors, today: TODAY })
    expect(item.dueBasis).toBe('第 3 版基準日（義務指定日期 2026-01-15）')
  })
  it('單次義務的到期日依據:完成時留版 → 快照固定;完成但沒快照 → 明說未留版;未完成 → 現行基準日(第 N 版);fixed 不受基準日影響', () => {
    expect(singleDueBasis(ob({ trigger_event: 'commencement', fixed_date: null, offset_days: 15, status: '已完成', due_date_snapshot: '2026-03-16', anchor_version_no: 2 })).label)
      .toBe('完成時留版（第 2 版基準日）：到期 2026-03-16 固定不隨基準日更正')
    expect(singleDueBasis(ob({ trigger_event: 'commencement', fixed_date: null, offset_days: 15, status: '已完成' })).label).toBe('完成時未留版：到期日依現行基準日計算')
    expect(singleDueBasis(ob({ trigger_event: 'commencement', fixed_date: null, offset_days: 15 }), 4).label).toBe('依現行開工日（第 4 版）計算')
    expect(singleDueBasis(ob({ trigger_event: 'commencement', fixed_date: null, offset_days: 15 })).label).toBe('依現行開工日計算')
    expect(singleDueBasis(ob()).label).toBe('依義務指定日期，不受基準日影響')
    expect(singleDueBasis(ob({ trigger_event: 'other', fixed_date: null }))).toBeNull()
    expect(singleDueBasis(monthly())).toBeNull()
    expect(buildTimelineItem(ob({ trigger_event: 'commencement', fixed_date: null, offset_days: 15, status: '已完成', due_date_snapshot: '2026-03-16', anchor_version_no: 2 }), { anchors: { ...anchors, version_no: 5 }, today: TODAY }))
      .toMatchObject({ dateLabel: '2026-03-16', status: 'done', dueBasis: '完成時留版（第 2 版基準日）：到期 2026-03-16 固定不隨基準日更正' })
  })
  it('版本列:最新在前,相對前一版列出改了哪些欄位(舊→新)、類別中文、受影響／保留件數', () => {
    const rows = anchorVersionRows([
      { id: 'v2', version_no: 2, change_kind: 'extension', anchors: { award_date: '2026-01-10', commencement_date: '2026-03-01', end_date: '2027-08-30' }, changed_keys: ['end_date'], effective_from: '2026-08-01', reason: '核准展延', source_ref: '府工字第 1 號',
        effects: [{ kind: 'rescheduled', obligation_id: 'o1', title: '竣工圖說', period_key: null, old_due: '2027-06-29', new_due: '2027-09-29' }, { kind: 'kept', obligation_id: 'o2', title: '施工計畫', period_key: null, old_due: '2026-03-16', new_due: null, status: '已完成' }] },
      { id: 'v1', version_no: 1, change_kind: 'initial', anchors: { award_date: '2026-01-10', commencement_date: '2026-03-01', end_date: '2027-05-30' }, changed_keys: ['award_date', 'commencement_date', 'end_date'], effects: [] },
    ])
    expect(rows.map((r) => [r.versionNo, r.kindLabel, r.affected, r.kept])).toEqual([[2, '展延', 1, 1], [1, '初值', 0, 0]])
    expect(rows[0].changes).toEqual([{ key: 'end_date', label: '竣工日', from: '2027-05-30', to: '2027-08-30' }])
    expect(rows[1].changes.map((c) => [c.label, c.from, c.to])).toEqual([['決標日', null, '2026-01-10'], ['開工日', null, '2026-03-01'], ['竣工日', null, '2027-05-30']])
    expect(anchorVersionRows([])).toEqual([])
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

// ── P5d:待補設定缺口、近期視圖、逐期準時率 ──────────────────────────────────
describe('待補設定缺口(setupGapsOf:與今日工作／Agent 同一份判定,附處理入口)', () => {
  const period = (over) => ({ id: 'p', period_key: '2026-08', due_date: '2026-08-05', status: '待辦', ...over })
  it('五種缺口各自的種類、中文標籤與導向', () => {
    expect(SETUP_KINDS.map((k) => k.key)).toEqual(['responsible', 'anchor', 'rule', 'stop', 'review'])
    expect(setupGapsOf(ob({ responsible: '設計單位' }), anchors, TODAY)).toEqual([
      expect.objectContaining({ kind: 'responsible', kindLabel: '責任方待補', to: '/requirements/review?highlight=OB-X' }),
    ])
    expect(setupGapsOf(ob({ trigger_event: 'commencement', offset_days: 15 }), {}, TODAY)).toEqual([
      expect.objectContaining({ kind: 'anchor', anchor: 'commencement_date', label: '基準日待補（開工日）', to: '/deadlines' }),
    ])
    expect(setupGapsOf(ob({ trigger_event: null, recurring: 'monthly' }), anchors, TODAY)).toEqual([
      expect.objectContaining({ kind: 'rule', label: '循環規則待補（每月缺幾日）', to: '/requirements/review?highlight=OB-X' }),
    ])
    expect(setupGapsOf(ob({ trigger_event: null, recurring: 'monthly', recurring_day: 5, periods: [] }), { commencement_date: '2026-03-01' }, TODAY)).toEqual([
      expect.objectContaining({ kind: 'stop', label: '停止條件待補（缺竣工日，無法判定循環何時結束）', to: '/deadlines?obligation=OB-X' }),
    ])
    expect(setupGapsOf(ob({ trigger_event: null, recurring: 'monthly', recurring_day: 5, periods: [period({ review_note: '回填' })] }), anchors, TODAY)).toEqual([
      expect.objectContaining({ kind: 'review', periodKey: '2026-08', to: '/deadlines?obligation=OB-X&period=2026-08' }),
    ])
  })
  it('沒有缺口回空陣列;同一種缺口只列一次(多期待核對取最早一期)', () => {
    expect(setupGapsOf(ob(), anchors, TODAY)).toEqual([])
    const gaps = setupGapsOf(ob({ trigger_event: null, recurring: 'monthly', recurring_day: 5, periods: [
      period({ id: 'p2', period_key: '2026-08', due_date: '2026-08-05', review_note: 'x' }),
      period({ id: 'p1', period_key: '2026-07', due_date: '2026-07-05', review_note: 'x' }),
    ] }), anchors, TODAY)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].periodKey).toBe('2026-07')
  })
  it('檢視模型帶 setup,搜尋文字含缺口標籤;篩選 setup=any／種類', () => {
    const item = buildTimelineItem(ob({ responsible: '' }), { anchors, today: TODAY })
    expect(item.setup.map((g) => g.kind)).toEqual(['responsible'])
    const f = { q: '', status: 'all', phase: 'all', who: '', type: '', setup: '', range: 'all' }
    expect(matchesFilters(item, { ...f, setup: 'any' }, TODAY)).toBe(true)
    expect(matchesFilters(item, { ...f, setup: 'responsible' }, TODAY)).toBe(true)
    expect(matchesFilters(item, { ...f, setup: 'anchor' }, TODAY)).toBe(false)
    expect(matchesFilters(item, { ...f, q: '責任方待補' }, TODAY)).toBe(true)
    expect(matchesFilters(buildTimelineItem(ob(), { anchors, today: TODAY }), { ...f, setup: 'any' }, TODAY)).toBe(false)
  })
})

describe('近期視圖(isRecent)與順序(byUrgency)', () => {
  it('逾期／7 日內／30 日內排程／待補設定／進行中算近期;31 日後排程、無到期、久遠完成不算', () => {
    expect(isRecent({ status: 'overdue', diff: -3, setup: [] }, TODAY)).toBe(true)
    expect(isRecent({ status: 'due', diff: 5, setup: [] }, TODAY)).toBe(true)
    expect(isRecent({ status: 'scheduled', diff: 30, setup: [] }, TODAY)).toBe(true)
    expect(isRecent({ status: 'scheduled', diff: 31, setup: [] }, TODAY)).toBe(false)
    expect(isRecent({ status: 'na', diff: null, setup: [{ kind: 'anchor' }] }, TODAY)).toBe(true)
    expect(isRecent({ status: 'na', diff: null, setup: [] }, TODAY)).toBe(false)
    expect(isRecent({ status: 'scheduled', diff: 90, setup: [], inProgress: true }, TODAY)).toBe(true)
  })
  it('最近 7 日完成的仍列出(剛標完成不能從畫面消失);更早的不列;沒有完成時間的不列', () => {
    expect(isRecent({ status: 'done', setup: [], completedAt: '2026-08-24T02:00:00Z' }, TODAY)).toBe(true)
    expect(isRecent({ status: 'done', setup: [], completedAt: '2026-08-18T02:00:00Z' }, TODAY)).toBe(true)
    expect(isRecent({ status: 'done', setup: [], completedAt: '2026-08-17T02:00:00Z' }, TODAY)).toBe(false)
    expect(isRecent({ status: 'done', setup: [], completedAt: null }, TODAY)).toBe(false)
  })
  it('循環義務以最近一期完成時間判近期;range=recent 進 matchesFilters', () => {
    const item = buildTimelineItem(ob({ trigger_event: null, recurring: 'monthly', recurring_day: 5, periods: [
      { id: 'a', period_key: '2026-07', due_date: '2026-07-05', status: '已完成', completed_at: '2026-08-23T01:00:00Z' },
    ] }), { anchors, today: TODAY })
    expect(item.completedAt).toBe('2026-08-23T01:00:00Z')
    const f = { q: '', status: 'all', phase: 'all', who: '', type: '', setup: '', range: 'recent' }
    expect(matchesFilters(item, f, TODAY)).toBe(true)
    expect(matchesFilters(buildTimelineItem(ob({ fixed_date: '2027-06-30' }), { anchors, today: TODAY }), f, TODAY)).toBe(false)
  })
  it('先急後緩:逾期(最久在前)→ 7 日內 → 待補／無到期 → 排程中(近的在前)→ 已完成', () => {
    const rows = [
      { id: 'done', status: 'done', diff: null }, { id: 'sched-far', status: 'scheduled', diff: 20 }, { id: 'na', status: 'na', diff: null },
      { id: 'due', status: 'due', diff: 3 }, { id: 'over-1', status: 'overdue', diff: -1 }, { id: 'sched-near', status: 'scheduled', diff: 9 }, { id: 'over-9', status: 'overdue', diff: -9 },
    ]
    expect([...rows].sort(byUrgency).map((r) => r.id)).toEqual(['over-9', 'over-1', 'due', 'na', 'sched-near', 'sched-far', 'done'])
  })
})

describe('逐期準時率(periodStat)與執行卡逐期計入(partyStat)', () => {
  const periods = [
    { status: 'done', onTime: true }, { status: 'done', onTime: false }, { status: 'overdue' }, { status: 'scheduled' }, { status: 'na' },
  ]
  it('分母=已完成＋已逾期的期、分子=準時完成;未到期與不適用不計;沒有到期的期 → null', () => {
    expect(periodStat(periods)).toMatchObject({ total: 5, settled: 3, onTime: 1, rate: 33, n: { done: 2, overdue: 1, open: 1, na: 1 } })
    expect(periodStat([{ status: 'scheduled' }]).rate).toBe(null)
    expect(periodStat([]).total).toBe(0)
  })
  it('執行卡:循環義務以期計入準時率,五狀態計數仍以條計;單次義務照舊', () => {
    const s = partyStat([
      { status: 'overdue', recurring: true, periods },            // 一條循環:3 期應完成、1 期準時
      { status: 'done', onTime: true }, { status: 'overdue' },   // 兩條單次:2 項應完成、1 項準時
    ])
    expect(s.n).toEqual({ overdue: 2, due: 0, scheduled: 0, done: 1, na: 0 })
    expect(s).toMatchObject({ total: 3, settled: 5, onTime: 2, rate: 40, periodsSettled: 3 })
  })
  it('檢視模型帶 periodStat 與本期 id;單次義務為 null', () => {
    const item = buildTimelineItem(ob({ trigger_event: null, recurring: 'monthly', recurring_day: 5, periods: [
      { id: 'a', period_key: '2026-07', due_date: '2026-07-05', status: '已完成', completed_at: '2026-07-04T01:00:00Z' },
      { id: 'b', period_key: '2026-08', due_date: '2026-08-05', status: '待辦' },
    ] }), { anchors, today: TODAY })
    expect(item.periodStat).toMatchObject({ settled: 2, onTime: 1, rate: 50 })
    expect(item.currentPeriodId).toBe('b')
    expect(item.periods[1].evidenceDocumentId).toBeNull()
    expect(buildTimelineItem(ob(), { anchors, today: TODAY }).periodStat).toBeNull()
  })
})
