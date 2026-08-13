// 今日待辦聚合的護欄(W8-2A §6.3)。這支測試同時釘住三件事:
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
    expect(mine[0].to).toBe('/payments')
    const draft = build({ org: 'contractor', valuations: [{ id: 'V3', period_no: 6, status: '草稿' }] })
    expect(draft.mine[0].to).toBe('/valuation')
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
  it('三方各自只看到指給自己的,自由文字值不進任何人的待辦', () => {
    expect(build({ org: 'contractor', observations }).mine.map((t) => t.title)).toEqual(['樓梯口動線'])
    expect(build({ org: 'supervisor', observations }).mine.map((t) => t.title)).toEqual(['料場堆置'])
    for (const org of ['contractor', 'supervisor', 'owner']) {
      const { mine, waiting } = build({ org, observations })
      expect([...mine, ...waiting].some((t) => t.title === '不明責任')).toBe(false)
    }
  })
})

describe('契約義務:精確責任白名單 + 目的頁真的能完成', () => {
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
  it('只有廠商責任的義務成為待辦;監造/機關/未指定都不製造假待辦', () => {
    const c = build({ org: 'contractor', obligations: rows, anchors })
    expect(c.mine.filter((t) => t.tag === '契約').map((t) => t.title)).toEqual(['廠商:提送月報'])
    for (const org of ['supervisor', 'owner']) {
      const r = build({ org, obligations: rows, anchors })
      expect([...r.mine, ...r.waiting].some((t) => t.tag === '契約')).toBe(false)
    }
  })
  it('逾期天數與罰則寫進說明,並導向專案文件頁', () => {
    const t = build({ org: 'contractor', obligations: rows, anchors }).mine.find((x) => x.tag === '契約')
    expect(t.overdueDays).toBe(3)
    expect(t.due).toBe('2026-08-10')
    expect(t.meta).toContain('逾期 3 天')
    expect(t.meta).toContain('罰則：每日 0.5‰')
    expect(t.to).toBe('/contract')
  })
  it('已提送/已完成的義務與 7 天以後才到期的都不列', () => {
    const later = [
      ob({ id: 'OB-1', title: '已提送', fixed_date: '2026-08-10', responsible: '廠商', status: '已提送' }),
      ob({ id: 'OB-2', title: '已完成', fixed_date: '2026-08-10', responsible: '廠商', status: '已完成' }),
      ob({ id: 'OB-3', title: '還很久', fixed_date: '2026-09-30', responsible: '廠商' }),
      ob({ id: 'OB-4', title: '沒有到期日', responsible: '廠商', trigger_event: 'other' }),
    ]
    expect(build({ org: 'contractor', obligations: later, anchors }).mine).toEqual([])
  })
})

describe('期限型待辦:試體、驗收、停留點', () => {
  it('試體齡期逾期歸廠商,監造與機關不會拿到', () => {
    const testSamples = [{ id: 'TS1', sample_no: 'CS-003', test_item: '混凝土抗壓', sampled_date: '2026-08-04', d7_due: '2026-08-11', d28_due: '2026-09-01' }]
    const c = build({ org: 'contractor', testSamples })
    const t = c.mine.find((x) => x.tag === '試驗')
    expect(t.ball).toBe('contractor')
    expect(t.overdueDays).toBe(2)
    expect(t.to).toBe('/quality')
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
    expect(t.to).toBe('/itp')
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

  it('每月重複義務吃傳入的 today,不讀系統時鐘', () => {
    const monthly = [{ id: 'OB-M', title: '提送施工月報', status: '待辦', recurring: 'monthly', recurring_day: 15, responsible: '廠商' }]
    // 刻意選一個遠離系統時鐘的日期:讀系統時鐘的話 due 會落在完全不同的月份
    const near = buildTodayTasks({ org: 'contractor', today: new Date('2027-03-10T04:00:00Z'), obligations: monthly })
      .mine.find((x) => x.tag === '契約')
    expect(near.due).toBe('2027-03-15')
    expect(near.meta).toContain('還有 5 天')
    // 已過本月 15 日 → 順延下月,超過 7 日門檻不列
    expect(buildTodayTasks({ org: 'contractor', today: new Date('2027-03-16T04:00:00Z'), obligations: monthly }).mine).toEqual([])
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
    expect(doneToday[0].to).toBe('/safety')
  })
})

describe('資料形狀韌性', () => {
  it('完全空輸入回三個空陣列', () => {
    expect(build({ org: 'contractor' })).toEqual({ mine: [], waiting: [], doneToday: [] })
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
