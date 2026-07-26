// 驗證批3 agentTools:角色工具分發的順序穩定性(prompt cache 前綴)與
// buildDailyLogDraft 的「數量誠實原則」——數量永遠留空標 needs_input,
// 昨日數量只進 rationale 供參考,絕不預填。
import { describe, it, expect } from 'vitest'
import { QUERY_TOOLS, DRAFT_DAILY_LOG_TOOL, toolsForRole, buildDailyLogDraft, makeToolExec } from './agentTools.ts'
import type { DailyLogDraftInput } from './agentTools.ts'

describe('toolsForRole(批3 角色分發)', () => {
  const queryNames = QUERY_TOOLS.map((t) => t.name)

  it('field = 查詢七支在前 + draft_daily_log 殿後(順序固定,快取前綴穩定)', () => {
    const names = toolsForRole('field').map((t) => t.name)
    expect(names).toEqual([...queryNames, 'draft_daily_log'])
    expect(names[names.length - 1]).toBe(DRAFT_DAILY_LOG_TOOL.name)
  })

  it('qc / supervisor / owner 只有查詢七支(草稿工具是批4)', () => {
    for (const role of ['qc', 'supervisor', 'owner'] as const) {
      expect(toolsForRole(role).map((t) => t.name)).toEqual(queryNames)
    }
  })

  it('多次呼叫回傳同一參考順序(不重排、不重建亂序)', () => {
    expect(toolsForRole('field').map((t) => t.name)).toEqual(toolsForRole('field').map((t) => t.name))
    expect(toolsForRole('qc')).toBe(QUERY_TOOLS)
  })
})

// ── buildDailyLogDraft:確定性組裝(不呼叫 Claude) ──────────────────────────
const baseInput = (): DailyLogDraftInput => ({
  logDate: '2026-07-25',
  photos: [
    { id: 'p1', work_item_id: 'wi-1' },
    { id: 'p2', work_item_id: 'wi-1' },
    { id: 'p3', work_item_id: 'wi-2' },
  ],
  workItems: [
    { id: 'wi-2', item_key: 'K2', item_no: '壹.二.1', description: '模板組立', unit: 'M2', sort_order: 2 },
    { id: 'wi-1', item_key: 'K1', item_no: '壹.一.6', description: '混凝土澆置', unit: 'M3', sort_order: 1 },
  ],
  yesterday: {
    log_date: '2026-07-24',
    labor: [{ type: '模板工', count: 5 }],
    equipment: [{ name: '吊車', count: 1 }],
    materials: null,
    daily_log_items: [{ work_item_id: 'wi-1', qty_today: 35 }],
  },
  weather: { am: '多雲', pm: '午後雷陣雨' },
  untaggedCount: 1,
})

describe('buildDailyLogDraft 數量誠實原則', () => {
  it('每個工項數量一律 null + needs_input + source:null —— 即使昨日有同工項數量', () => {
    const { payload } = buildDailyLogDraft(baseInput())
    const items = payload.items as Record<string, { qty_today: unknown; needs_input: boolean; source: unknown }>
    expect(Object.keys(items).sort()).toEqual(['wi-1', 'wi-2'])
    for (const it of Object.values(items)) {
      expect(it.qty_today).toBeNull()
      expect(it.needs_input).toBe(true)
      expect(it.source).toBeNull()
    }
  })

  it('昨日同工項數量只出現在 rationale 供參考,不出現在 payload 數量', () => {
    const { payload, rationale } = buildDailyLogDraft(baseInput())
    expect(rationale).toContain('昨日同工項數量僅供參考')
    expect(rationale).toContain('混凝土澆置 昨日 35 M3')
    expect(JSON.stringify((payload as Record<string, unknown>).items)).not.toContain('35')
  })

  it('items 附 item_key(saveSiteLog 以 item_key 為 key,前端接受時靠它轉形狀)', () => {
    const { payload } = buildDailyLogDraft(baseInput())
    const items = payload.items as Record<string, { item_key: string }>
    expect(items['wi-1'].item_key).toBe('K1')
    expect(items['wi-2'].item_key).toBe('K2')
  })

  it('出工/機具複製昨日標 source yesterday;materials 昨日為空則無來源', () => {
    const { payload } = buildDailyLogDraft(baseInput())
    const src = (payload as Record<string, Record<string, unknown>>).field_sources
    expect(payload.labor).toEqual([{ type: '模板工', count: 5 }])
    expect(src.labor).toBe('yesterday')
    expect(src.equipment).toBe('yesterday')
    expect(src.materials).toBeNull()
    expect(src.quantities).toBe('needs_input')
    expect(src.items).toBe('photos')
  })

  it('天氣帶入標 source cwa;無天氣則 null 且 rationale 誠實說未帶入', () => {
    const withWx = buildDailyLogDraft(baseInput())
    expect((withWx.payload as Record<string, Record<string, unknown>>).field_sources.weather).toBe('cwa')
    expect(withWx.payload.weather_am).toBe('多雲')

    const noWx = buildDailyLogDraft({ ...baseInput(), weather: null })
    expect((noWx.payload as Record<string, Record<string, unknown>>).field_sources.weather).toBeNull()
    expect(noWx.payload.weather_am).toBeNull()
    expect(noWx.rationale).toContain('未帶入')
  })

  it('無昨日日誌:出工/機具/材料為空陣列,rationale 說明留空待填', () => {
    const { payload, rationale } = buildDailyLogDraft({ ...baseInput(), yesterday: null })
    expect(payload.labor).toEqual([])
    expect(payload.equipment).toEqual([])
    expect((payload as Record<string, Record<string, unknown>>).field_sources.labor).toBeNull()
    expect(rationale).toContain('無昨日日誌')
  })

  it('work_summary 依 sort_order 確定性拼接、含照片張數,並標明數量待填', () => {
    const { payload } = buildDailyLogDraft(baseInput())
    const ws = String(payload.work_summary)
    expect(ws.indexOf('壹.一.6 混凝土澆置')).toBeLessThan(ws.indexOf('壹.二.1 模板組立'))
    expect(ws).toContain('照片 2 張')
    expect(ws).toContain('數量待現場確認後填寫')
  })

  it('summary 誠實標示「數量待你填」;photo_ids 齊全;未配對照片寫進 rationale', () => {
    const { payload, summary, rationale } = buildDailyLogDraft(baseInput())
    expect(summary).toBe('已依 3 張現場照片擬好 7/25 施工日誌草稿(2 個工項,數量待你填)')
    expect(payload.photo_ids).toEqual(['p1', 'p2', 'p3'])
    expect(rationale).toContain('1 張當日照片尚未配對工項')
  })
})

describe('makeToolExec 的 draft_daily_log 防護', () => {
  it('未傳 service client 時誠實回「伺服器未設定」,不碰資料庫', async () => {
    const exec = makeToolExec({} as never, '00000000-0000-0000-0000-000000000000')
    const out = (await exec('draft_daily_log', {})) as { error?: string }
    expect(out.error).toBe('伺服器未設定,暫時無法建立草稿')
  })

  it('log_date 格式不合法時回錯誤讓模型自行修正', async () => {
    const exec = makeToolExec({} as never, '00000000-0000-0000-0000-000000000000', {} as never, 'user-1')
    expect(((await exec('draft_daily_log', { log_date: '2026/07/25' })) as { error?: string }).error).toContain('YYYY-MM-DD')
    expect(((await exec('draft_daily_log', { log_date: '2026-13-40' })) as { error?: string }).error).toContain('有效日期')
  })
})
