// 批3:日誌草稿 payload → saveSiteLog 形狀轉換的純函式測試。
// 重點是「數量誠實原則」的落地:qty_today 為 null(待人填)的工項不得變成 0 送出,
// 也不得讓整包存檔失敗——一律略過,由人到 /site-log 補填。
import { describe, it, expect, vi } from 'vitest'

// 純函式不打網路;mock 掉 supabase 讓本檔在 node 環境零依賴載入
vi.mock('../../lib/supabase.js', () => ({ supabase: null, isSupabaseConfigured: false }))

import { draftPayloadToSiteLog, draftNeedsInputCount, applyDraftQuantities, draftPayloadToChecklist, checklistDraftCounts } from './agent.js'

// 後端 draft_daily_log 產出的 payload(規格 A1 第 7 點形狀,items 鍵為 work_item uuid)
const payload = {
  log_date: '2026-07-25',
  weather_am: '多雲', weather_pm: '午後雷陣雨',
  labor: [{ trade: '模板工', count: 6 }],
  equipment: [{ name: '吊車', count: 1 }],
  materials: [],
  work_summary: '依 12 張現場照片:模板組立、鋼筋綁紮。',
  items: {
    'uuid-a': { qty_today: null, needs_input: true, source: null },        // 照片只證明有做,數量待填
    'uuid-b': { qty_today: 120, needs_input: false, source: 'schedule' },  // 當日排程量,確定性預填
    'uuid-c': { qty_today: 0, needs_input: true, source: null },           // 0 視同未填,不落庫
    'uuid-x': { qty_today: 50, needs_input: false, source: 'schedule' },   // 工項已被移除(查不回 key)
  },
  field_sources: { weather: 'cwa', labor: 'yesterday' },
  photo_ids: ['p1', 'p2'],
}
const idToKey = new Map([['uuid-a', '1.1'], ['uuid-b', '1.2'], ['uuid-c', '1.3']])

describe('draftPayloadToSiteLog(草稿 → saveSiteLog 形狀)', () => {
  it('items 由 uuid 鍵翻成 item_key 鍵、值取 qty_today', () => {
    const out = draftPayloadToSiteLog(payload, idToKey)
    expect(out.items).toEqual({ '1.2': 120 })
  })
  it('數量為 null/0 的工項略過(「還沒填」不是「做了 0」),查不回 key 的也略過', () => {
    const out = draftPayloadToSiteLog(payload, idToKey)
    expect(out.items['1.1']).toBeUndefined() // null → 略過
    expect(out.items['1.3']).toBeUndefined() // 0 → 略過
    expect(Object.keys(out.items)).not.toContain('uuid-x') // 無對應工項 → 略過
  })
  it('公定格式欄位原樣帶過,agent 專用欄位(field_sources/photo_ids)不外洩進日誌', () => {
    const out = draftPayloadToSiteLog(payload, idToKey)
    expect(out.log_date).toBe('2026-07-25')
    expect(out.weather_am).toBe('多雲')
    expect(out.weather_pm).toBe('午後雷陣雨')
    expect(out.labor).toEqual(payload.labor)
    expect(out.equipment).toEqual(payload.equipment)
    expect(out.work_summary).toBe(payload.work_summary)
    expect(out.field_sources).toBeUndefined()
    expect(out.photo_ids).toBeUndefined()
  })
  it('idToKey 查不到時退回 payload 自帶的 item_key(demo 模式 idToKey 恆空,全靠這個)', () => {
    const p = { log_date: '2026-07-25', items: {
      '1.2': { item_key: '1.2', qty_today: 120, needs_input: false, source: null }, // demo:鍵即 item_key
      'uuid-gone': { item_key: '9.9', qty_today: 5, needs_input: false, source: null }, // 真模式工項已移除:備援 key 交給 saveSiteLog byKey 過濾
    } }
    expect(draftPayloadToSiteLog(p, new Map()).items).toEqual({ '1.2': 120, '9.9': 5 })
  })
  it('缺欄位/空 payload 不炸:給 saveSiteLog 吃得下的預設值', () => {
    const out = draftPayloadToSiteLog({ log_date: '2026-07-25' }, idToKey)
    expect(out.items).toEqual({})
    expect(out.labor).toEqual([])
    expect(out.weather_am).toBeNull()
    expect(draftPayloadToSiteLog({}, new Map()).items).toEqual({})
  })
})

describe('draftNeedsInputCount(待填數量工項數)', () => {
  it('needs_input 且數量未填的才算(0 不是 null,但空字串算未填)', () => {
    expect(draftNeedsInputCount(payload)).toBe(1) // 只有 uuid-a(uuid-c 是 0,不是 null)
    expect(draftNeedsInputCount({ items: { a: { qty_today: '', needs_input: true } } })).toBe(1)
    expect(draftNeedsInputCount({ items: { a: { qty_today: 5, needs_input: false } } })).toBe(0)
  })
  it('空/缺 payload 回 0', () => {
    expect(draftNeedsInputCount(null)).toBe(0)
    expect(draftNeedsInputCount({})).toBe(0)
  })
})

describe('applyDraftQuantities(收件匣卡片填的數量 → 合併回草稿 payload)', () => {
  it('合併後轉換:填了的工項進 items,未填(undefined/空字串/0/非數字)的不進', () => {
    const merged = applyDraftQuantities(payload, { 'uuid-a': '30', 'uuid-c': '', 'uuid-x': 'abc' })
    // uuid-a 填 30 → 進;uuid-b 原本就有 120 → 進;uuid-c 空字串=未填、0 也未填 → 略過
    const out = draftPayloadToSiteLog(merged, idToKey)
    expect(out.items).toEqual({ '1.1': 30, '1.2': 120 })
    expect(merged.items['uuid-a']).toEqual({ qty_today: 30, needs_input: false, source: null })
    // 填了的不再算「待填」;沒填的照算
    expect(draftNeedsInputCount(merged)).toBe(0) // uuid-a 已填、uuid-c 本來就是 0 不算 null
  })
  it('0/負數/非數字視同未填:qty_today 維持原樣', () => {
    const merged = applyDraftQuantities(payload, { 'uuid-a': '0', 'uuid-b': '-3', 'uuid-x': 'abc' })
    expect(merged.items['uuid-a'].qty_today).toBeNull()
    expect(merged.items['uuid-b'].qty_today).toBe(120) // 負數不覆蓋原值
    expect(merged.items['uuid-x'].qty_today).toBe(50)
  })
  it('回傳全新物件,不就地改 store 裡的 payload(evidence 不可被污染)', () => {
    const before = JSON.parse(JSON.stringify(payload))
    const merged = applyDraftQuantities(payload, { 'uuid-a': '30' })
    expect(merged).not.toBe(payload)
    expect(merged.items).not.toBe(payload.items)
    expect(merged.items['uuid-a']).not.toBe(payload.items['uuid-a'])
    expect(payload).toEqual(before) // 原 payload 一個位元都沒動
  })
  it('quantities 未帶(undefined)→ 原 payload 原樣回傳,維持既有行為', () => {
    expect(applyDraftQuantities(payload, undefined)).toBe(payload)
    expect(applyDraftQuantities(null, undefined)).toBeNull()
  })
})

// ── 批4:查驗草稿 payload → createChecklistRecord 入參 ─────────────────────
// 實測值紅線:num 項後端一律 value:null(AI 不准猜),轉換後不得進 values——
// judgeChecklist 對未檢項回 null 不列入判定,「還沒量」不是「量了合格」。
const templates = [
  { id: 'CLT-1', title: '混凝土自主檢查表', items: [
    { no: 'B1', item: '已通知監造', kind: 'bool' },
    { no: 'C2', item: '坍度', kind: 'num', min: 15.5, max: 20.5 },
  ] },
]
const clPayload = {
  template_id: 'CLT-1', template_title: '混凝土自主檢查表',
  check_date: '2026-07-25', location: '3F 版牆',
  results: {
    B1: { value: true, ai_suggested: true },       // 照片可判讀的 bool → AI 建議值
    C2: { value: null, needs_input: true },        // 實測值:AI 不准猜,留白待人填
  },
}

describe('draftPayloadToChecklist(查驗草稿 → createChecklistRecord 形狀)', () => {
  it('以 template_id 查回完整 template,values 只收已有值的項', () => {
    const out = draftPayloadToChecklist(clPayload, templates)
    expect(out.template).toBe(templates[0])
    expect(out.check_date).toBe('2026-07-25')
    expect(out.location).toBe('3F 版牆')
    expect(out.values).toEqual({ B1: true }) // C2 是 null(待人填)→ 不進 values
  })
  it('value:null / 空字串不進 values(未檢不是合格);false 是有效的 bool 值要進', () => {
    const out = draftPayloadToChecklist({ ...clPayload, results: {
      B1: { value: false, ai_suggested: true }, C2: { value: '', needs_input: true },
    } }, templates)
    expect(out.values).toEqual({ B1: false })
  })
  it('template_id 查不到時退回 title 相符;兩者皆無 → null(誠實錯誤,不拿錯範本硬存)', () => {
    const byTitle = draftPayloadToChecklist({ ...clPayload, template_id: 'gone' }, templates)
    expect(byTitle?.template).toBe(templates[0])
    expect(draftPayloadToChecklist({ template_id: 'gone', template_title: '也沒有' }, templates)).toBeNull()
    expect(draftPayloadToChecklist(clPayload, [])).toBeNull()
  })
})

describe('checklistDraftCounts(收件匣卡片統計)', () => {
  it('needsInput=待人填項數、aiSuggested=AI 建議且有值的項數', () => {
    expect(checklistDraftCounts(clPayload)).toEqual({ needsInput: 1, aiSuggested: 1 })
  })
  it('空/缺 payload 回零,不炸', () => {
    expect(checklistDraftCounts(null)).toEqual({ needsInput: 0, aiSuggested: 0 })
    expect(checklistDraftCounts({})).toEqual({ needsInput: 0, aiSuggested: 0 })
  })
})
