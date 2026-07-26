// 驗證批3/批4 agentTools:角色工具分發的順序穩定性(prompt cache 前綴)、
// buildDailyLogDraft 的「數量誠實原則」(數量永遠留空標 needs_input,昨日數量
// 只進 rationale 供參考,絕不預填),以及批4 buildInspectionDraft 的
// 「實測值不讓 AI 讀」紅線(num 項不存在任何賦值路徑)。
import { describe, it, expect } from 'vitest'
import {
  QUERY_TOOLS, DRAFT_DAILY_LOG_TOOL, DRAFT_INSPECTION_TOOL, DRAFT_SUBMITTAL_REVIEW_TOOL, RAISE_TO_TOOL, RUN_INTEGRITY_AUDIT_TOOL,
  toolsForRole, buildDailyLogDraft, buildInspectionDraft, pickChecklistTemplate, makeToolExec,
} from './agentTools.ts'
import type { DailyLogDraftInput, InspectionDraftInput } from './agentTools.ts'

describe('toolsForRole(批4 角色分發:查詢在前、角色草稿工具居中、raise_to 殿後)', () => {
  const queryNames = QUERY_TOOLS.map((t) => t.name)

  it('field = 查詢七支 + draft_daily_log + raise_to', () => {
    expect(toolsForRole('field').map((t) => t.name)).toEqual([...queryNames, 'draft_daily_log', 'raise_to'])
    expect(toolsForRole('field').at(-1)).toBe(RAISE_TO_TOOL)
  })

  it('qc = 查詢七支 + draft_inspection + raise_to', () => {
    expect(toolsForRole('qc').map((t) => t.name)).toEqual([...queryNames, 'draft_inspection', 'raise_to'])
    expect(toolsForRole('qc').at(-2)).toBe(DRAFT_INSPECTION_TOOL)
  })

  it('supervisor = 查詢七支 + run_integrity_audit + draft_submittal_review + raise_to', () => {
    expect(toolsForRole('supervisor').map((t) => t.name))
      .toEqual([...queryNames, 'run_integrity_audit', 'draft_submittal_review', 'raise_to'])
    expect(toolsForRole('supervisor').at(-2)).toBe(DRAFT_SUBMITTAL_REVIEW_TOOL)
    expect(toolsForRole('supervisor').at(-1)).toBe(RAISE_TO_TOOL)
  })

  it('owner = 查詢七支 + run_integrity_audit + raise_to(送審審查是監造的法定職掌,不給機關)', () => {
    expect(toolsForRole('owner').map((t) => t.name)).toEqual([...queryNames, 'run_integrity_audit', 'raise_to'])
    expect(toolsForRole('owner').at(-2)).toBe(RUN_INTEGRITY_AUDIT_TOOL)
    expect(toolsForRole('owner').map((t) => t.name)).not.toContain('draft_submittal_review')
  })

  it('field / qc 沒有 draft_submittal_review(只給 supervisor)', () => {
    for (const role of ['field', 'qc'] as const) {
      expect(toolsForRole(role).map((t) => t.name)).not.toContain('draft_submittal_review')
    }
  })

  it('每個角色多次呼叫回傳同一參考(模組層常數,不重建 → 快取前綴逐位元組穩定)', () => {
    for (const role of ['field', 'qc', 'supervisor', 'owner'] as const) {
      expect(toolsForRole(role)).toBe(toolsForRole(role))
    }
    expect(toolsForRole('field')[0]).toBe(QUERY_TOOLS[0])
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

// ── 批4:buildInspectionDraft ——「實測值不讓 AI 讀」紅線 ─────────────────────
const inspInput = (over: Partial<InspectionDraftInput> = {}): InspectionDraftInput => ({
  template: {
    id: 'tpl-1',
    title: '場鑄結構用混凝土 自主檢查表',
    source: '03310',
    items: [
      { no: 'B1', group: '澆置前', item: '澆置前已通知監造單位', kind: 'bool', standard: '≥24 小時前通知' },
      { no: 'C2', group: '澆置中', item: '坍度', kind: 'num', min: 15.5, max: 20.5, unit: 'cm', standard: '18 ± 2.5 cm' },
      { no: 'D1', group: '取樣養護', item: '抗壓試體已取樣', kind: 'bool', standard: '每組 6 個' },
      { no: 'D3', group: '取樣養護', item: '防天候保護天數', kind: 'num', min: 7, unit: '天', standard: '≥7 天' },
    ],
  },
  templateReason: '本案僅有這一張範本',
  checkDate: '2026-07-25',
  workItem: { id: 'wi-1', item_no: '壹.一.6', description: '場鑄結構混凝土' },
  locationHint: '3F 柱牆澆置',
  photoIds: ['p1', 'p2'],
  boolSuggestions: null,
  ...over,
})

// 新形狀:每筆建議 = { value, basis } —— 沒有記錄依據的推論,事後和猜測分不出來
const sug = (value: boolean, basis = '照片說明提到已依標準辦理') => ({ value, basis })

describe('buildInspectionDraft 實測值紅線(num 項不存在任何賦值路徑)', () => {
  it('num 項一律 value:null + needs_input —— 即使同時給了 bool 建議', () => {
    const out = buildInspectionDraft(inspInput({ boolSuggestions: { B1: sug(true) } }))
    if ('error' in out) throw new Error(out.error)
    const results = out.payload.results as Record<string, { value: unknown; needs_input?: boolean }>
    for (const no of ['C2', 'D3']) {
      expect(results[no].value).toBeNull()
      expect(results[no].needs_input).toBe(true)
    }
  })

  it('bool_suggestions 指到 num 項 → 直接回 error(不是默默忽略)', () => {
    const out = buildInspectionDraft(inspInput({ boolSuggestions: { C2: sug(true) } }))
    expect('error' in out && out.error).toContain('數值實測項')
  })

  it('未知項次 / 非布林 value / 非物件 → 各自回明確錯誤讓模型修正', () => {
    expect((buildInspectionDraft(inspInput({ boolSuggestions: { Z9: sug(true) } })) as { error: string }).error).toContain('未知項次')
    expect((buildInspectionDraft(inspInput({ boolSuggestions: { B1: { value: '有', basis: '照片說明提到已通知' } } })) as { error: string }).error).toContain('true/false')
    expect((buildInspectionDraft(inspInput({ boolSuggestions: { B1: '有' } })) as { error: string }).error).toContain('物件')
    expect((buildInspectionDraft(inspInput({ boolSuggestions: [true] })) as { error: string }).error).toContain('物件')
  })

  it('缺 basis 的建議被拒 —— bool 建議必須附依據', () => {
    const out = buildInspectionDraft(inspInput({ boolSuggestions: { B1: { value: true } } }))
    expect('error' in out && out.error).toContain('必須附依據')
  })

  it('basis 太短(去空白後 < 4 字)被拒', () => {
    const out = buildInspectionDraft(inspInput({ boolSuggestions: { B1: { value: true, basis: ' 有 ' } } }))
    expect('error' in out && out.error).toContain('必須附依據')
  })

  it('bool 建議逐項標 ai_suggested:true + ai_basis;false 也如實輸出(不因 falsy 被吞)', () => {
    const out = buildInspectionDraft(inspInput({
      boolSuggestions: {
        B1: sug(true, '對話中他親口說昨天已通知監造'),
        D1: sug(false, '照片說明載明試體尚未取樣'),
      },
    }))
    if ('error' in out) throw new Error(out.error)
    const results = out.payload.results as Record<string, { value: unknown; ai_suggested?: boolean; ai_basis?: string; needs_input?: boolean }>
    expect(results.B1).toMatchObject({ value: true, ai_suggested: true, ai_basis: '對話中他親口說昨天已通知監造' })
    expect(results.D1).toMatchObject({ value: false, ai_suggested: true, ai_basis: '照片說明載明試體尚未取樣' })
    expect(results.B1.needs_input).toBeUndefined()
  })

  it('沒給建議的 bool 項不硬猜 —— 留空標 needs_input', () => {
    const out = buildInspectionDraft(inspInput())
    if ('error' in out) throw new Error(out.error)
    const results = out.payload.results as Record<string, { value: unknown; needs_input?: boolean; ai_suggested?: boolean }>
    expect(results.B1).toMatchObject({ value: null, needs_input: true })
    expect(results.D1.ai_suggested).toBeUndefined()
  })

  it('不呼叫 judgeChecklist:overall 留 null,results 不含任何 pass 判定', () => {
    const out = buildInspectionDraft(inspInput({ boolSuggestions: { B1: sug(true) } }))
    if ('error' in out) throw new Error(out.error)
    expect(out.payload.overall).toBeNull()
    expect(JSON.stringify(out.payload.results)).not.toContain('"pass"')
  })

  it('payload 對齊前端接受路徑:template_id 必要、results 以項次 no 為鍵、帶 check_date/location', () => {
    const out = buildInspectionDraft(inspInput())
    if ('error' in out) throw new Error(out.error)
    expect(out.payload.template_id).toBe('tpl-1')
    expect(out.payload.check_date).toBe('2026-07-25')
    expect(out.payload.location).toBe('3F 柱牆澆置')
    expect(Object.keys(out.payload.results as object).sort()).toEqual(['B1', 'C2', 'D1', 'D3'])
    expect(out.payload.photo_ids).toEqual(['p1', 'p2'])
  })

  it('summary 誠實標示待填實測項數;rationale 明說不猜實測值、判定由系統', () => {
    const out = buildInspectionDraft(inspInput({ boolSuggestions: { B1: sug(true) } }))
    if ('error' in out) throw new Error(out.error)
    expect(out.summary).toBe('已擬好「場鑄結構用混凝土 自主檢查表」自主檢查表草稿(7/25,實測值 2 項待你填)')
    expect(out.rationale).toContain('系統與 AI 都不猜實測值')
    expect(out.rationale).toContain('AI 不參與判定')
    expect(out.rationale).toContain('1 項為 AI 依當日照片與對話線索的建議')
    expect(out.numPending).toBe(2)
    expect(out.boolSuggested).toBe(1)
  })
})

describe('pickChecklistTemplate(確定性關鍵字相符,非 AI)', () => {
  const templates = [
    { id: 't1', title: '鋼筋組立 自主檢查表' },
    { id: 't2', title: '場鑄結構用混凝土 自主檢查表' },
  ]

  it('僅一張範本時直接用', () => {
    const out = pickChecklistTemplate([templates[0]], null)
    expect(out?.template.id).toBe('t1')
    expect(out?.reason).toContain('僅有這一張')
  })

  it('依工項描述雙字組挑最相符的一張,理由可供收件人質疑', () => {
    const out = pickChecklistTemplate(templates, '場鑄結構混凝土(3000psi)')
    expect(out?.template.id).toBe('t2')
    expect(out?.reason).toContain('相符度挑選')
  })

  it('多張範本但無工項描述、或全部 0 分 → 回 null(誠實請使用者指定,不亂挑)', () => {
    expect(pickChecklistTemplate(templates, null)).toBeNull()
    expect(pickChecklistTemplate(templates, '交通維持設施')).toBeNull()
  })
})

// ── 批4:draft_inspection / raise_to 的 makeToolExec 防護 ───────────────────
describe('makeToolExec 的 draft_inspection / raise_to 防護', () => {
  const pid = '00000000-0000-0000-0000-000000000000'

  it('draft_inspection:未傳 service 時誠實回「伺服器未設定」,不碰資料庫', async () => {
    const exec = makeToolExec({} as never, pid)
    expect(((await exec('draft_inspection', {})) as { error?: string }).error).toBe('伺服器未設定,暫時無法建立草稿')
  })

  it('draft_inspection:check_date / UUID 不合法時回錯誤讓模型修正', async () => {
    const exec = makeToolExec({} as never, pid, {} as never, 'user-1', 'qc')
    expect(((await exec('draft_inspection', { check_date: '2026-13-40' })) as { error?: string }).error).toContain('有效日期')
    expect(((await exec('draft_inspection', { work_item_id: 'abc' })) as { error?: string }).error).toContain('UUID')
    expect(((await exec('draft_inspection', { template_id: 'abc' })) as { error?: string }).error).toContain('UUID')
  })

  it('raise_to:to_role / subject / target 成對性逐項驗證', async () => {
    const exec = makeToolExec({} as never, pid, {} as never, 'user-1', 'qc')
    expect(((await exec('raise_to', { to_role: 'boss', subject: 'x' })) as { error?: string }).error).toContain('to_role')
    expect(((await exec('raise_to', { to_role: 'supervisor', subject: '  ' })) as { error?: string }).error).toContain('subject')
    expect(((await exec('raise_to', { to_role: 'supervisor', subject: '請複查', target_table: 'defects' })) as { error?: string }).error)
      .toContain('成對')
    expect(((await exec('raise_to', { to_role: 'supervisor', subject: '請複查', target_table: 'projects', target_id: pid })) as { error?: string }).error)
      .toContain('白名單')
  })

  it('raise_to:未傳 service/role 時誠實回「伺服器未設定」,不碰資料庫', async () => {
    const exec = makeToolExec({} as never, pid)
    expect(((await exec('raise_to', { to_role: 'supervisor', subject: '缺失改善完成,請複查' })) as { error?: string }).error)
      .toBe('伺服器未設定,暫時無法建立草稿')
  })
})

// ── draft_submittal_review 的 makeToolExec 防護 ─────────────────────────────
describe('makeToolExec 的 draft_submittal_review 防護', () => {
  const pid = '00000000-0000-0000-0000-000000000000'

  it('未傳 service 時誠實回「伺服器未設定」,不碰資料庫', async () => {
    const exec = makeToolExec({} as never, pid)
    expect(((await exec('draft_submittal_review', {})) as { error?: string }).error)
      .toBe('伺服器未設定,暫時無法建立草稿')
  })

  it('submittal_id 不是 UUID 時回錯誤讓模型自行修正(先於一切查詢)', async () => {
    const exec = makeToolExec({} as never, pid, {} as never, 'user-1', 'supervisor')
    expect(((await exec('draft_submittal_review', { submittal_id: 'SUB-001' })) as { error?: string }).error)
      .toContain('UUID')
  })

  it('工具定義的描述明講「不能替監造做審定」(反幻覺紅線寫進 description)', () => {
    expect(DRAFT_SUBMITTAL_REVIEW_TOOL.description).toContain('不能替監造做審定')
    expect(DRAFT_SUBMITTAL_REVIEW_TOOL.description).toContain('法定裁量')
  })
})
