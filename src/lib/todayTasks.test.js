// 今日工作聚合的護欄(W8-2A §6.3)。這支測試同時釘住三件事:
//   ① 三分類與球權正確;② AI 產物永遠不會變成人工待辦;
//   ③「今天已完成」只吃可靠時間戳,不吃可回填的業務日期。
// today 一律用固定值傳入,不依賴系統時鐘。
import { describe, it, expect } from 'vitest'
import { buildTodayTasks, RESPONSIBLE_SIDE, WAITING_SCOPE, taipeiISODate, daysBetween } from './todayTasks.js'

// 2026-08-13 12:00 台北 = 04:00Z。用正午避開台北/UTC 跨日邊界。
const TODAY = new Date('2026-08-13T04:00:00Z')
const TODAY_ISO = '2026-08-13'
const build = (over = {}) => buildTodayTasks({ today: TODAY, ...over })

describe('日期工具', () => {
  it('timestamptz 換算成台北日曆日', () => {
    expect(taipeiISODate('2026-08-13T04:00:00Z')).toBe('2026-08-13')
    // 台北 8/14 00:30 —— 用 UTC 判斷會誤成 8/13
    expect(taipeiISODate('2026-08-13T16:30:00Z')).toBe('2026-08-14')
    expect(taipeiISODate(null)).toBeNull()
    expect(taipeiISODate('not-a-date')).toBeNull()
  })
  it('日差用字串算,不受執行環境時區影響', () => {
    expect(daysBetween('2026-08-10', TODAY_ISO)).toBe(-3)
    expect(daysBetween(TODAY_ISO, TODAY_ISO)).toBe(0)
    expect(daysBetween('2026-08-20', TODAY_ISO)).toBe(7)
  })
})

describe('現在輪到我 / 等待對方:協作項三分類', () => {
  const data = {
    submittals: [{ id: 'S1', submittal_no: 'SUB-003', title: '材料送審', status: '已提送' }], // supervisor
    rfis: [{ id: 'R1', rfi_no: 'RFI-002', title: '版厚疑義', status: '已回覆' }],             // contractor
    valuations: [{ id: 'V1', period_no: 5, status: '監造審核' }],                             // supervisor
    defects: [{ id: 'D1', title: '模板殘料', status: '開立' }],                               // contractor
    inspections: [{ id: 'I1', title: '4F 鋼筋查驗', status: '待查驗' }],                      // supervisor
    changeOrders: [{ id: 'C1', co_no: 'CO-002', title: '地坪變更', status: '審核中' }],       // owner
  }
  it('廠商:只拿到球在自己手上的,等待段只列直接相關的對手項', () => {
    const { mine, waiting } = build({ org: 'contractor', ...data })
    expect(mine.map((t) => t.tag).sort()).toEqual(['疑義', '缺失'])
    expect(mine.every((t) => t.ball === 'contractor')).toBe(true)
    // 查驗(球在監造)不在廠商的白名單內 → 不進等待段
    expect(waiting.map((t) => t.tag).sort()).toEqual(['估驗', '變更', '送審'])
  })
  it('監造:待審全部進 mine;等待段只列廠商該做與機關該核的', () => {
    const { mine, waiting } = build({ org: 'supervisor', ...data })
    expect(mine.map((t) => t.tag).sort()).toEqual(['估驗', '查驗', '送審'])
    expect(waiting.map((t) => t.tag).sort()).toEqual(['疑義', '缺失', '變更'])
  })
  it('機關:只拿到待核定/待撥款', () => {
    const { mine, waiting } = build({ org: 'owner', ...data })
    expect(mine.map((t) => t.tag)).toEqual(['變更'])
    expect(waiting.map((t) => t.tag).sort()).toEqual(['缺失', '送審'])
  })
  it('同一筆不會同時出現在兩段', () => {
    for (const org of ['contractor', 'supervisor', 'owner']) {
      const { mine, waiting } = build({ org, ...data })
      const keys = new Set(mine.map((t) => t.key))
      expect(waiting.some((t) => keys.has(t.key))).toBe(false)
    }
  })
  it('已完成的協作項不再出現', () => {
    const { mine, waiting } = build({
      org: 'supervisor',
      submittals: [{ id: 'S9', title: '已核准', status: '核准' }],
      defects: [{ id: 'D9', title: '已結案缺失', status: '已結案' }],
    })
    expect(mine).toEqual([])
    expect(waiting).toEqual([])
  })
  it('估驗待請款導向請款收款頁(那裡才有請款日欄位)', () => {
    const { mine } = build({ org: 'contractor', valuations: [{ id: 'V2', period_no: 4, status: '已核定', invoice_date: null }] })
    expect(mine[0].to).toBe('/payments?period=V2')
    const draft = build({ org: 'contractor', valuations: [{ id: 'V3', period_no: 6, status: '草稿' }] })
    expect(draft.mine[0].to).toBe('/valuation?period=V3')
  })
  it('等待對方的白名單就是宣告的那一份,沒有第二套判斷', () => {
    expect(Object.keys(WAITING_SCOPE).sort()).toEqual(['contractor', 'owner', 'supervisor'])
    expect(WAITING_SCOPE.owner.估驗).toEqual(['contractor'])
  })
})

describe('觀察事項:assigned_to 落不進三方就不歸任何人', () => {
  const observations = [
    { id: 'O1', title: '樓梯口動線', status: '待處理', assigned_to: 'contractor' },
    { id: 'O2', title: '料場堆置', status: '待處理', assigned_to: 'supervisor' },
    { id: 'O3', title: '不明責任', status: '待處理', assigned_to: '工地主任' },
  ]
  it('三方各自只看到指給自己的,自由文字值不進任何人的待辦;改列三方共見的待補設定', () => {
    expect(build({ org: 'contractor', observations }).mine.map((t) => t.title)).toEqual(['樓梯口動線'])
    expect(build({ org: 'supervisor', observations }).mine.map((t) => t.title)).toEqual(['料場堆置'])
    for (const org of ['contractor', 'supervisor', 'owner']) {
      const { mine, waiting, setup } = build({ org, observations })
      expect([...mine, ...waiting].some((t) => t.title === '不明責任')).toBe(false)
      expect(setup.map((t) => t.title)).toEqual(['不明責任'])
      expect(setup[0].meta).toBe('待處理（指派「工地主任」不是三方）')
      expect(setup[0].to).toBe('/quality?observation=O3')
    }
  })
})

describe('契約期限:精確責任白名單 + 目的頁真的能完成', () => {
  const anchors = { commencement_date: '2026-01-01' }
  const ob = (over) => ({ id: over.id, title: over.title, status: '待辦', trigger_event: 'fixed', ...over })
  const rows = [
    ob({ id: 'OB-C', title: '廠商:提送月報', fixed_date: '2026-08-10', responsible: '廠商', penalty: '每日 0.5‰' }),
    ob({ id: 'OB-S', title: '監造:提送監造報表', fixed_date: '2026-08-10', responsible: '監造' }),
    ob({ id: 'OB-O', title: '機關:核定計畫', fixed_date: '2026-08-10', responsible: '機關' }),
    ob({ id: 'OB-N', title: '未指定責任', fixed_date: '2026-08-10', responsible: null }),
    ob({ id: 'OB-X', title: '不明責任方', fixed_date: '2026-08-10', responsible: '設計單位' }),
  ]
  it('責任映射只接受三個精確值', () => {
    expect(RESPONSIBLE_SIDE).toEqual({ 廠商: 'contractor', 監造: 'supervisor', 機關: 'owner' })
  })
  it('三方各拿到自己責任的期限;未指定/不明責任不製造假待辦(機關依 20260825120000 可標自己的)', () => {
    const c = build({ org: 'contractor', obligations: rows, anchors })
    expect(c.mine.filter((t) => t.tag === '契約重點').map((t) => t.title)).toEqual(['廠商:提送月報'])
    const s = build({ org: 'supervisor', obligations: rows, anchors })
    expect(s.mine.filter((t) => t.tag === '契約重點').map((t) => t.title)).toEqual(['監造:提送監造報表'])
    const o = build({ org: 'owner', obligations: rows, anchors })
    expect(o.mine.filter((t) => t.tag === '契約重點').map((t) => t.title)).toEqual(['機關:核定計畫'])
    expect(o.waiting.some((t) => t.tag === '契約重點')).toBe(false)
  })
  it('未指定/不明責任 → 三方共見的待補設定,導到擷取審核該筆;不預設丟給廠商(P5a)', () => {
    for (const org of ['contractor', 'supervisor', 'owner']) {
      const { setup } = build({ org, obligations: rows, anchors })
      expect(setup.map((t) => t.title)).toEqual(['未指定責任', '不明責任方'])
      expect(setup.every((t) => t.meta === '責任方待補設定' && t.ball === 'unassigned')).toBe(true)
      expect(setup.map((t) => t.to)).toEqual(['/requirements/review?highlight=OB-N', '/requirements/review?highlight=OB-X'])
    }
  })
  it('基準日沒填而推不出到期日 → 待補設定(基準日),導到期限追蹤;責任方仍是自己方', () => {
    const noAnchor = [ob({ id: 'OB-A', title: '開工後 15 日提送', trigger_event: 'commencement', offset_days: 15, responsible: '廠商' })]
    for (const org of ['contractor', 'supervisor', 'owner']) {
      const { mine, setup } = build({ org, obligations: noAnchor, anchors: {} })
      expect(mine.some((t) => t.tag === '契約重點')).toBe(false)
      expect(setup).toHaveLength(1)
      expect(setup[0]).toMatchObject({ title: '開工後 15 日提送', meta: '基準日待補（開工日）', ball: 'contractor', to: '/deadlines', due: null })
    }
    // 基準日補上後就是一般期限:回到廠商的待辦、不再是待補設定
    const withAnchor = build({ org: 'contractor', obligations: noAnchor, anchors: { commencement_date: '2026-08-01' } })
    expect(withAnchor.setup).toEqual([])
    expect(withAnchor.mine.find((t) => t.tag === '契約重點').due).toBe('2026-08-16')
  })
  it('逾期天數與罰則寫進說明,並直達期限追蹤頁的那一筆(「標為已提送」在那裡)', () => {
    const t = build({ org: 'contractor', obligations: rows, anchors }).mine.find((x) => x.tag === '契約重點')
    expect(t.overdueDays).toBe(3)
    expect(t.due).toBe('2026-08-10')
    expect(t.meta).toContain('逾期 3 天')
    expect(t.meta).toContain('罰則：每日 0.5‰')
    expect(t.to).toBe('/deadlines?obligation=OB-C')
  })
  it('已提送/已完成的義務與 7 天以後才到期的都不列', () => {
    const later = [
      ob({ id: 'OB-1', title: '已提送', fixed_date: '2026-08-10', responsible: '廠商', status: '已提送' }),
      ob({ id: 'OB-2', title: '已完成', fixed_date: '2026-08-10', responsible: '廠商', status: '已完成' }),
      ob({ id: 'OB-3', title: '還很久', fixed_date: '2026-09-30', responsible: '廠商' }),
      ob({ id: 'OB-4', title: '沒有到期日', responsible: '廠商', trigger_event: 'other' }),
    ]
    // 只斷言契約段:anchors 的開工錨點涵蓋今天,第⑥類會另推一筆「日誌未填」(那是它的正確行為)
    expect(build({ org: 'contractor', obligations: later, anchors }).mine.filter((t) => t.tag === '契約重點')).toEqual([])
  })
})

describe('期限型待辦:試體、驗收、停留點', () => {
  it('試體齡期逾期歸廠商,監造與機關不會拿到', () => {
    const testSamples = [{ id: 'TS1', sample_no: 'CS-003', test_item: '混凝土抗壓', sampled_date: '2026-08-04', d7_due: '2026-08-11', d28_due: '2026-09-01' }]
    const c = build({ org: 'contractor', testSamples })
    const t = c.mine.find((x) => x.tag === '試驗')
    expect(t.ball).toBe('contractor')
    expect(t.overdueDays).toBe(2)
    expect(t.to).toBe('/quality?sample=TS1')
    for (const org of ['supervisor', 'owner']) {
      expect(build({ org, testSamples }).mine.some((x) => x.tag === '試驗')).toBe(false)
    }
  })
  it('驗收初驗期限只給機關;竣工確認與複驗監造、機關各拿一次,任一方登錄後兩邊都退出', () => {
    // 報竣 -28 天、竣工確認 -25 天 → 初驗法定 30 日內 = 2026-08-18(還有 5 天)
    const events = [
      { stage_key: 'report', event_date: '2026-07-16' },
      { stage_key: 'confirm', event_date: '2026-07-19' },
    ]
    expect(build({ org: 'owner', acceptanceEvents: events }).mine.filter((t) => t.tag === '驗收').map((t) => t.due)).toEqual(['2026-08-18'])
    expect(build({ org: 'supervisor', acceptanceEvents: events }).mine.some((t) => t.tag === '驗收')).toBe(false)
    expect(build({ org: 'contractor', acceptanceEvents: events }).mine.some((t) => t.tag === '驗收')).toBe(false)

    // 只報竣未確認:竣工確認 7 日內到期 → 監造與機關各一筆
    const pendingConfirm = [{ stage_key: 'report', event_date: '2026-08-08' }]
    for (const org of ['supervisor', 'owner']) {
      const only = build({ org, acceptanceEvents: pendingConfirm }).mine.filter((t) => t.tag === '驗收')
      expect(only).toHaveLength(1)
      expect(only[0].due).toBe('2026-08-15')
    }
    // 任一方登錄後,兩邊同時退出(狀態由既有流程更新,不需回首頁打勾)
    const confirmed = [...pendingConfirm, { stage_key: 'confirm', event_date: '2026-08-12' }]
    for (const org of ['supervisor', 'owner']) {
      expect(build({ org, acceptanceEvents: confirmed }).mine.some((t) => t.key === '驗收:confirm')).toBe(false)
    }
  })
  it('ITP 停留點未叫驗歸廠商,沒有到期日也能列出', () => {
    const inspectionPoints = [{ id: 'P1', point_type: 'H', title: '柱牆鋼筋查驗', work_item_key: 'WI-1', inspection_id: null }]
    const siteLogs = [{ log_date: '2026-08-12', items: { 'WI-1': 12 } }]
    const t = build({ org: 'contractor', inspectionPoints, siteLogs }).mine.find((x) => x.tag === '停留點')
    expect(t.ball).toBe('contractor')
    expect(t.due).toBeNull()
    expect(t.to).toBe('/itp?point=P1')
    expect(build({ org: 'supervisor', inspectionPoints, siteLogs }).mine.some((x) => x.tag === '停留點')).toBe(false)
  })
  // 回歸:期限引擎用 Date 相減再 Math.round,傳含時間的「現在」會把 8 個日曆日
  // 壓成 7。台北晚上開頁時,還有 8 天的試驗被列進「7 日內」,而畫面天數(由日期
  // 字串算)卻寫 8 天。門檻必須以台北日曆日為準,同一天的任何時刻結果都相同。
  it('同一個台北日曆日的任何時刻,7 日內門檻與畫面天數都一致', () => {
    const sameTaipeiDay = [
      new Date('2026-08-12T16:30:00Z'), // 台北 8/13 00:30
      new Date('2026-08-13T04:00:00Z'), // 台北 8/13 12:00
      new Date('2026-08-13T15:30:00Z'), // 台北 8/13 23:30 —— 修正前這個時刻會誤列
    ]
    const eightDaysOut = [{ id: 'TS8', sample_no: 'CS-008', sampled_date: '2026-08-14', d7_due: '2026-08-21', d28_due: '2026-09-11' }]
    const sevenDaysOut = [{ id: 'TS7', sample_no: 'CS-007', sampled_date: '2026-08-13', d7_due: '2026-08-20', d28_due: '2026-09-10' }]
    for (const at of sameTaipeiDay) {
      expect(buildTodayTasks({ org: 'contractor', today: at, testSamples: eightDaysOut }).mine).toEqual([])
      const t = buildTodayTasks({ org: 'contractor', today: at, testSamples: sevenDaysOut }).mine
      expect(t).toHaveLength(1)
      expect(t[0].meta).toContain('還有 7 天')
    }
  })

  // 循環義務(P5b):不再從「今天」推算下一期;期次(obligation_periods)由 DB 依規則物化,
  // 每個未結期次各一筆、各自套 7 日窗口,舊逾期不因下期出現而消失,完成本期不清下期。
  it('循環義務逐期:每個未結期次各一筆,舊逾期保留、完成本期不動下期、窗口外的下期不列', () => {
    const period = (key, due, status = '待辦', extra = {}) => ({ id: `OB-M-${key}`, period_key: key, due_date: due, status, review_note: null, ...extra })
    const monthly = [{
      id: 'OB-M', title: '提送施工月報', status: '待辦', recurring: 'monthly', recurring_day: 15, responsible: '廠商',
      periods: [period('2027-01', '2027-01-15', '已完成'), period('2027-02', '2027-02-15'), period('2027-03', '2027-03-15'), period('2027-04', '2027-04-15')],
    }]
    const today = new Date('2027-03-10T04:00:00Z')
    const mine = buildTodayTasks({ org: 'contractor', today, obligations: monthly }).mine.filter((x) => x.tag === '契約重點')
    expect(mine.map((x) => [x.key, x.period, x.due, x.title, x.to])).toEqual([
      ['契約:OB-M:2027-02', '2027-02', '2027-02-15', '提送施工月報（2027-02 期）', '/deadlines?obligation=OB-M&period=2027-02'],
      ['契約:OB-M:2027-03', '2027-03', '2027-03-15', '提送施工月報（2027-03 期）', '/deadlines?obligation=OB-M&period=2027-03'],
    ])
    expect(mine[0].meta).toContain('逾期 23 天')
    expect(mine[1].meta).toContain('還有 5 天')
    // 完成 2 月期:3 月期仍在,4 月期(36 天後)仍在窗口外
    const febDone = [{ ...monthly[0], periods: monthly[0].periods.map((p) => (p.period_key === '2027-02' ? { ...p, status: '已提送' } : p)) }]
    expect(buildTodayTasks({ org: 'contractor', today, obligations: febDone }).mine.map((x) => x.key)).toEqual(['契約:OB-M:2027-03'])
    // 義務層舊的已完成狀態不關閉循環義務;不適用才整條不列
    const legacyDone = [{ ...monthly[0], status: '已完成' }]
    expect(buildTodayTasks({ org: 'contractor', today, obligations: legacyDone }).mine).toHaveLength(2)
    const retired = [{ ...monthly[0], status: '不適用' }]
    expect(buildTodayTasks({ org: 'contractor', today, obligations: retired }).mine).toEqual([])
  })

  it('循環義務沒有期次:基準日缺 → 待補設定(基準日);規則不完整 → 待補設定(擷取審核);待核對期次 → 待補設定(那一期)', () => {
    const base = { id: 'OB-R', title: '每月環境監測', status: '待辦', recurring: 'monthly', recurring_day: 5, responsible: '廠商', periods: [] }
    const noAnchor = buildTodayTasks({ org: 'contractor', today: TODAY, anchors: {}, obligations: [base] })
    expect(noAnchor.mine).toEqual([])
    expect(noAnchor.setup.map((x) => [x.key, x.meta, x.to])).toEqual([['契約:OB-R:setup', '基準日待補（開工日）', '/deadlines']])
    const noRule = buildTodayTasks({ org: 'contractor', today: TODAY, anchors: { commencement_date: '2026-01-01' }, obligations: [{ ...base, recurring_day: null }] })
    expect(noRule.setup.map((x) => [x.meta, x.to])).toEqual([['循環規則待補（每月缺幾日）', '/requirements/review?highlight=OB-R']])
    // 竣工日齊(P5c 停止條件判得出)才不會再多一顆「停止條件待補」
    const review = buildTodayTasks({ org: 'owner', today: TODAY, anchors: { commencement_date: '2026-01-01', end_date: '2027-12-31' }, obligations: [{
      ...base, responsible: '機關',
      periods: [{ id: 'p1', period_key: '2026-07', due_date: '2026-07-05', status: '待辦', review_note: '原義務曾標為「已完成」但無法對應期別' }],
    }] })
    expect(review.mine).toEqual([])
    expect(review.setup.map((x) => [x.key, x.period, x.ball, x.to])).toEqual([['契約:OB-R:2026-07:setup', '2026-07', 'owner', '/deadlines?obligation=OB-R&period=2026-07']])
    expect(review.setup[0].meta).toContain('回填待核對')
  })

  it('循環停止條件(P5c):竣工日缺／已過／保固類 → 待補設定(stop)導期限追蹤該筆;已登錄竣工或竣工日未到 → 不列', () => {
    // TODAY=2026-08-13
    const base = { id: 'OB-S', title: '每月施工月報', status: '待辦', recurring: 'monthly', recurring_day: 5, responsible: '廠商',
      periods: [{ id: 'p1', period_key: '2026-08', due_date: '2026-08-05', status: '待辦' }] }
    const stopOf = (r) => r.setup.filter((x) => x.meta.startsWith('停止條件待補')).map((x) => [x.key, x.meta, x.to, x.ball])
    // 缺竣工日:既有期次照列(逾期 8 天),另多一顆停止條件待補(DB 已不再產生新期)
    const noEnd = buildTodayTasks({ org: 'contractor', today: TODAY, anchors: { commencement_date: '2026-01-01' }, obligations: [base] })
    expect(noEnd.mine.filter((x) => x.tag === '契約重點').map((x) => x.key)).toEqual(['契約:OB-S:2026-08'])
    expect(stopOf(noEnd)).toEqual([['契約:OB-S:setup', '停止條件待補（缺竣工日，無法判定循環何時結束）', '/deadlines?obligation=OB-S', 'contractor']])
    // 竣工日已過、未登錄竣工
    const pastEnd = buildTodayTasks({ org: 'contractor', today: TODAY, anchors: { commencement_date: '2026-01-01', end_date: '2026-07-31' }, obligations: [base] })
    expect(stopOf(pastEnd)).toEqual([['契約:OB-S:setup', '停止條件待補（竣工日 2026-07-31 已過，尚未登錄竣工或展延）', '/deadlines?obligation=OB-S', 'contractor']])
    // 已登錄竣工(驗收事件 confirm 優先於 report):竣工日缺也判得出 → 不列
    const done = buildTodayTasks({ org: 'contractor', today: TODAY, anchors: { commencement_date: '2026-01-01' }, obligations: [base],
      acceptanceEvents: [{ stage_key: 'report', event_date: '2026-08-01', created_at: '2026-08-01T00:00:00Z' }, { stage_key: 'confirm', event_date: '2026-08-03', created_at: '2026-08-03T00:00:00Z' }] })
    expect(stopOf(done)).toEqual([])
    // 竣工日未到 → 不列
    const future = buildTodayTasks({ org: 'contractor', today: TODAY, anchors: { commencement_date: '2026-01-01', end_date: '2027-12-31' }, obligations: [base] })
    expect(stopOf(future)).toEqual([])
    // 保固類:沒有期次、保固期滿日無法判定 → 只有停止條件待補,三方都看得到
    const warranty = { ...base, id: 'OB-W', title: '保固期每月巡檢', category: '保固', trigger_event: 'completion', periods: [] }
    for (const org of ['contractor', 'supervisor', 'owner']) {
      const r = buildTodayTasks({ org, today: TODAY, anchors: { commencement_date: '2026-01-01', end_date: '2027-12-31' }, obligations: [warranty] })
      expect(r.mine.filter((x) => x.tag === '契約重點')).toEqual([])
      expect(stopOf(r)).toEqual([['契約:OB-W:setup', '停止條件待補（保固期滿日無法判定，未登錄保固年限）', '/deadlines?obligation=OB-W', 'contractor']])
    }
  })

  it('期限型項目不會跑進「等待對方」', () => {
    const shared = {
      obligations: [{ id: 'OB', title: '月報', status: '待辦', trigger_event: 'fixed', fixed_date: '2026-08-10', responsible: '廠商' }],
      testSamples: [{ id: 'TS', sample_no: 'CS-1', sampled_date: '2026-08-04', d7_due: '2026-08-11', d28_due: '2026-09-01' }],
      acceptanceEvents: [{ stage_key: 'report', event_date: '2026-08-08' }],
    }
    for (const org of ['contractor', 'supervisor', 'owner']) {
      const { waiting } = build({ org, ...shared })
      expect(waiting.some((t) => ['契約', '試驗', '驗收', '停留點'].includes(t.tag))).toBe(false)
    }
  })
})

// 2026-08-19 真人驗收翻案(W8-2A §5-4 補記):使用者第一句就是「今天的施工日誌
// 我還沒填」,空狀態卻說「都跟上了」。第⑥類只在「施工已開始的證據」存在時才推
// (開工錨點涵蓋今天,或已有任一筆日誌),全新專案不推——釘住的是誤報防護本身。
describe('今日施工日誌未填(第⑥類,僅廠商)', () => {
  const anchors = { commencement_date: '2026-03-01', end_date: '2027-02-28' }
  const yesterdayLog = [{ id: 'L1', log_date: '2026-08-12', items: {} }]
  const todayLog = [{ id: 'L2', log_date: TODAY_ISO, items: {} }]

  it('開工錨點涵蓋今天且今天沒日誌 → 推一筆導向 /site-log,且不掛假造的到期日', () => {
    const t = build({ org: 'contractor', anchors }).mine.find((x) => x.tag === '日誌')
    expect(t).toBeTruthy()
    expect(t.title).toBe('今天的施工日誌尚未填寫')
    expect(t.to).toMatch(/^\/site-log\?d=\d{4}-\d{2}-\d{2}$/)
    expect(t.ball).toBe('contractor')
    expect(t.due).toBeNull() // 日誌沒有法定期限,不假造 due
  })
  it('今天已有日誌 → 不出現', () => {
    expect(build({ org: 'contractor', anchors, siteLogs: todayLog }).mine.some((t) => t.tag === '日誌')).toBe(false)
  })
  it('非廠商 → 不出現(日誌是廠商在 /site-log 才做得到的事)', () => {
    for (const org of ['supervisor', 'owner']) {
      expect(build({ org, anchors, siteLogs: yesterdayLog }).mine.some((t) => t.tag === '日誌')).toBe(false)
    }
  })
  it('全新專案(無開工錨點、無任何日誌) → 不出現,不對還沒開工的案子誤報', () => {
    expect(build({ org: 'contractor' }).mine.some((t) => t.tag === '日誌')).toBe(false)
  })
  it('無錨點但已有昨日日誌(施工已開始的證據) → 出現', () => {
    expect(build({ org: 'contractor', siteLogs: yesterdayLog }).mine.some((t) => t.tag === '日誌')).toBe(true)
  })
  it('尚未開工(commencement 在未來)且無日誌 → 不出現;end_date 缺值視為未設限', () => {
    expect(build({ org: 'contractor', anchors: { commencement_date: '2026-09-01' } }).mine.some((t) => t.tag === '日誌')).toBe(false)
    expect(build({ org: 'contractor', anchors: { commencement_date: '2026-03-01' } }).mine.some((t) => t.tag === '日誌')).toBe(true)
  })
  it('已過竣工日(end_date 在昨天)且無日誌 → 錨點視窗不成立,不出現', () => {
    const ended = { commencement_date: '2025-01-01', end_date: '2026-08-12' }
    expect(build({ org: 'contractor', anchors: ended }).mine.some((t) => t.tag === '日誌')).toBe(false)
  })
  it('沒有到期日 → 排在期限型待辦之後(沿用無 due 殿後規則)', () => {
    const { mine } = build({
      org: 'contractor', anchors,
      defects: [{ id: 'D1', title: '模板殘料', status: '開立', due_date: '2026-08-20' }],
    })
    expect(mine.map((t) => t.tag)).toEqual(['缺失', '日誌'])
  })
})

describe('排序:到期近的在前,沒有到期日的殿後', () => {
  it('mine 依到期升冪,無到期日排最後', () => {
    const { mine } = build({
      org: 'contractor',
      defects: [{ id: 'D-late', title: '晚一點', status: '開立', due_date: '2026-08-20' },
        { id: 'D-none', title: '沒期限', status: '開立' },
        { id: 'D-over', title: '已逾期', status: '開立', due_date: '2026-08-01' }],
    })
    expect(mine.map((t) => t.title)).toEqual(['已逾期', '晚一點', '沒期限'])
    expect(mine[0].overdueDays).toBe(12)
    expect(mine[1].overdueDays).toBeNull()
    expect(mine[2].due).toBeNull()
  })
})

describe('AI 產物永遠不是人工待辦', () => {
  it('傳入 AI 草稿與未核定 Requirement 也不會多出任何一筆', () => {
    const base = { org: 'contractor', defects: [{ id: 'D1', title: '模板殘料', status: '開立' }] }
    const before = build(base)
    const after = build({
      ...base,
      // 這些欄位本函式根本不收——結構上就進不來,不是靠呼叫端自律
      agentActions: [{ id: 'A1', status: 'pending', kind: 'draft_daily_log', summary: '日誌草稿' }],
      requirements: [{ id: 'RQ1', status: 'needs_review', title: 'AI 擷取的期限建議' }],
      insights: [{ id: 'progress-behind', title: '進度落後 5%' }],
    })
    expect(after.mine).toEqual(before.mine)
    expect(after.waiting).toEqual(before.waiting)
    expect(after.doneToday).toEqual(before.doneToday)
  })
})

describe('今天已完成:只認可靠的操作時間戳', () => {
  const defects = [
    { id: 'D1', title: '今天結案的缺失', status: '已結案', closed_at: '2026-08-13T02:00:00Z' },
    { id: 'D2', title: '昨天結案的缺失', status: '已結案', closed_at: '2026-08-12T02:00:00Z' },
    { id: 'D3', title: '台北已跨到明天', status: '已結案', closed_at: '2026-08-13T16:30:00Z' },
    { id: 'D4', title: '沒有結案時間', status: '已結案', closed_at: null },
  ]
  const inspections = [
    { id: 'I1', title: '今天判定的查驗', status: '不合格', inspected_at: '2026-08-13T03:00:00Z' },
    { id: 'I2', title: '仍待查驗', status: '待查驗', inspected_at: null },
  ]
  it('監造看得到今天完成的缺失結案與查驗判定', () => {
    const { doneToday } = build({ org: 'supervisor', defects, inspections })
    expect(doneToday.map((t) => t.title)).toEqual(['今天判定的查驗', '今天結案的缺失'])
    expect(doneToday[0].meta).toBe('監造判定不合格')
  })
  it('跨日、缺時間戳、未完成狀態都不列', () => {
    const titles = build({ org: 'supervisor', defects, inspections }).doneToday.map((t) => t.title)
    for (const t of ['昨天結案的缺失', '台北已跨到明天', '沒有結案時間', '仍待查驗']) expect(titles).not.toContain(t)
  })
  it('陣營過濾:廠商與機關不會看到監造完成的事', () => {
    for (const org of ['contractor', 'owner']) {
      expect(build({ org, defects, inspections }).doneToday).toEqual([])
    }
  })
  it('可回填的業務日期一律不算「今天完成」', () => {
    const { doneToday } = build({
      org: 'supervisor',
      submittals: [{ id: 'S1', title: '今天審定的送審', status: '核准', decided_date: TODAY_ISO }],
      rfis: [{ id: 'R1', title: '今天回覆的疑義', status: '已結案', answered_date: TODAY_ISO }],
      valuations: [{ id: 'V1', period_no: 5, status: '已核定', invoice_date: TODAY_ISO, paid_date: TODAY_ISO }],
      siteLogs: [{ id: 'L1', log_date: TODAY_ISO, items: {} }],
    })
    expect(doneToday).toEqual([])
  })
  it('工安缺失結案導向工安管理頁', () => {
    const { doneToday } = build({
      org: 'supervisor',
      defects: [{ id: 'DS', title: '安全網破損', domain: 'safety', status: '已結案', closed_at: '2026-08-13T02:00:00Z' }],
    })
    expect(doneToday[0].tag).toBe('工安缺失')
    expect(doneToday[0].to).toBe('/safety?defect=DS')
  })
})

describe('資料形狀韌性', () => {
  it('完全空輸入回四個空陣列', () => {
    expect(build({ org: 'contractor' })).toEqual({ mine: [], waiting: [], doneToday: [], setup: [] })
  })
  it('demo 形狀(無 uuid、欄位殘缺)不丟例外且仍產生穩定的 key', () => {
    const { mine } = build({
      org: 'contractor',
      defects: [{ title: '沒有 id 的缺失', status: '開立' }, { title: '', status: '改善中' }],
      valuations: [{ period_no: 1, status: '草稿' }],
    })
    expect(mine).toHaveLength(3)
    expect(new Set(mine.map((t) => t.key)).size).toBe(3)
    expect(mine.some((t) => t.title === '（未命名）')).toBe(true)
  })
  it('未知角色不會拿到任何待辦', () => {
    const r = build({ org: 'design', defects: [{ id: 'D1', title: '缺失', status: '開立' }] })
    expect(r.mine).toEqual([])
    expect(r.waiting).toEqual([])
  })
})

describe('單一真相:Dashboard 與提醒中心吃同一份', () => {
  it('相同輸入呼叫兩次結果完全一致(兩頁不會說出兩種待辦)', () => {
    const input = {
      org: 'supervisor',
      submittals: [{ id: 'S1', submittal_no: 'SUB-003', title: '材料送審', status: '已提送', due_date: '2026-08-18' }],
      defects: [{ id: 'D1', title: '模板殘料', status: '待複查' }],
      inspections: [{ id: 'I1', title: '4F 鋼筋查驗', status: '待查驗' }],
    }
    expect(build(input)).toEqual(build(input))
  })
})

// ── 波次 7:dueText 改為 export 給品質頁工作佇列共用,句型是 TaskRow OVERDUE_RE 與 e2e 的契約 ──
import { dueText } from './todayTasks.js'

describe('dueText(到期句的單一真相)', () => {
  it('三種句型固定;逾期句必須符合 TaskRow 的 OVERDUE_RE', () => {
    expect(dueText(-3, '2026-08-10')).toBe('逾期 3 天（到期 2026-08-10）')
    expect(dueText(0, '2026-08-13')).toBe('今天到期（2026-08-13）')
    expect(dueText(5, '2026-08-18')).toBe('還有 5 天（到期 2026-08-18）')
    expect(dueText(-3, '2026-08-10')).toMatch(/逾期 \d+ 天（到期 \d{4}-\d{2}-\d{2}）/)
  })
})

// ── 規範 §9.7 收件匣直達那一筆:有「清單＋詳情」殼的頁,to 帶單條 query ──
// query 名與 id 必須對上該頁 useListDetailPane({ param }) 與 rows[].id:
//   /rfi?rfi=<rfis.id>、/submittals?submittal=<submittals.id>、/change-orders?co=<changeOrders.id>、
//   /deadlines?obligation=<obligations.id>(dueItems 的 id 就是 ob.id)。
// 對錯 id 等於沒帶(殼找不到列就退回預設選取),所以斷言的是「query 值＝該列的 id」,不是字串長得像。
const queryOf = (to, param) => new URL(to, 'http://x').searchParams.get(param)

describe('收件匣直達那一筆(規範 §9.7):有殼的頁 to 帶單條 query,無殼的頁維持頁面連結', () => {
  const anchors = { commencement_date: '2026-01-01' }
  const data = {
    rfis: [{ id: 'R1', rfi_no: 'RFI-002', title: '版厚疑義', status: '已回覆' }],                       // contractor
    submittals: [{ id: 'S1', submittal_no: 'SUB-003', title: '材料送審', status: '退回補正' }],        // contractor
    changeOrders: [{ id: 'C1', co_no: 'CO-002', title: '地坪變更', status: '審核中' }],                 // owner
    obligations: [{ id: 'OB-C', title: '提送月報', status: '待辦', trigger_event: 'fixed', fixed_date: '2026-08-10', responsible: '廠商' }],
  }
  it('疑義 / 送審 / 變更 / 契約期限:query 值就是該列的 id', () => {
    const c = build({ org: 'contractor', ...data, anchors })
    const byTag = (list, tag) => list.find((t) => t.tag === tag)
    expect(byTag(c.mine, '疑義').to).toBe('/rfi?rfi=R1')
    expect(queryOf(byTag(c.mine, '疑義').to, 'rfi')).toBe(data.rfis[0].id)
    expect(byTag(c.mine, '送審').to).toBe('/submittals?submittal=S1')
    expect(queryOf(byTag(c.mine, '送審').to, 'submittal')).toBe(data.submittals[0].id)
    expect(byTag(c.mine, '契約重點').to).toBe('/deadlines?obligation=OB-C')
    expect(queryOf(byTag(c.mine, '契約重點').to, 'obligation')).toBe(data.obligations[0].id)
    // 等待對方那一段是同一份組裝:廠商等機關核定的變更也直達
    expect(byTag(c.waiting, '變更').to).toBe('/change-orders?co=C1')
    expect(queryOf(byTag(c.waiting, '變更').to, 'co')).toBe(data.changeOrders[0].id)
    expect(byTag(build({ org: 'owner', ...data }).mine, '變更').to).toBe('/change-orders?co=C1')
  })
  it('id 缺值(demo 舊形狀)退回頁面連結,不產生 ?rfi=null 這種死連結', () => {
    const { mine } = build({
      org: 'contractor',
      rfis: [{ rfi_no: 'RFI-009', title: '沒有 id', status: '已回覆' }],
      submittals: [{ submittal_no: 'SUB-009', title: '沒有 id', status: '退回補正' }],
      obligations: [{ title: '沒有 id 的義務', status: '待辦', trigger_event: 'fixed', fixed_date: '2026-08-10', responsible: '廠商' }],
      anchors,
    })
    expect(mine.find((t) => t.tag === '疑義').to).toBe('/rfi')
    expect(mine.find((t) => t.tag === '送審').to).toBe('/submittals')
    expect(mine.find((t) => t.tag === '契約重點').to).toBe('/deadlines')
    expect(mine.some((t) => /=null|=undefined/.test(t.to))).toBe(false)
  })
  it('缺失、查驗、觀察、試驗、停留點與估驗直達該筆；驗收與日誌保留頁面入口', () => {
    const { mine } = build({
      org: 'contractor', anchors: { commencement_date: '2026-03-01', end_date: '2027-02-28' },
      defects: [{ id: 'D1', title: '模板殘料', status: '開立' }, { id: 'DS', title: '安全網', status: '開立', domain: 'safety' }],
      observations: [{ id: 'O1', title: '樓梯口動線', status: '待處理', assigned_to: 'contractor' }],
      valuations: [{ id: 'V1', period_no: 6, status: '草稿' }],
      testSamples: [{ id: 'TS1', sample_no: 'CS-003', sampled_date: '2026-08-04', d7_due: '2026-08-11', d28_due: '2026-09-01' }],
      inspectionPoints: [{ id: 'P1', point_type: 'H', title: '柱牆鋼筋查驗', work_item_key: 'WI-1', inspection_id: null }],
      siteLogs: [{ log_date: '2026-08-12', items: { 'WI-1': 12 } }],
    })
    const to = (tag) => mine.filter((t) => t.tag === tag).map((t) => t.to)
    // 缺失追蹤已套殼(規範 §9.8):品質與工安都帶 ?defect=<id>,值就是該列 id
    expect(to('缺失')).toEqual(['/quality?defect=D1'])
    expect(to('工安缺失')).toEqual(['/safety?defect=DS'])
    expect(to('觀察')).toEqual(['/quality?observation=O1'])
    expect(to('估驗')).toEqual(['/valuation?period=V1'])
    expect(to('試驗')).toEqual(['/quality?sample=TS1'])
    expect(to('停留點')).toEqual(['/itp?point=P1'])
    // 日誌待辦直達當日(U11):帶 ?d=今天
    expect(to('日誌')).toEqual([expect.stringMatching(/^\/site-log\?d=\d{4}-\d{2}-\d{2}$/)])
    const s = build({ org: 'supervisor', inspections: [{ id: 'I1', title: '4F 鋼筋查驗', status: '待查驗' }],
      acceptanceEvents: [{ stage_key: 'report', event_date: '2026-08-08' }] })
    expect(s.mine.find((t) => t.tag === '查驗').to).toBe('/quality?inspection=I1')
    // 驗收待辦直達當前階段(UIUX 階段 5C):帶 ?stage=,頁面據此定位並說明實際狀態
    expect(s.mine.find((t) => t.tag === '驗收').to).toMatch(/^\/acceptance\?stage=[a-z]+$/)
    // 今天已完成:缺失結案同樣直達該筆(與 collaborationItems 同一條規則);查驗同樣使用 inspection 參數
    const done = build({ org: 'supervisor', defects: [{ id: 'D9', title: '結案', status: '已結案', closed_at: '2026-08-13T02:00:00Z' }] }).doneToday
    expect(done[0].to).toBe('/quality?defect=D9')
  })
})
