// 驗證批3/批4 agent 工具層(B4 拆檔後分佈在 agentToolDefs / draftDailyLog /
// draftInspection / raiseTo / agentTools 分派器):角色工具分發的順序穩定性(prompt cache 前綴)、
// 草稿工具的輸入防護,以及 draft_inspection 勾選建議的嚴格驗證(「實測值不讓 AI 讀」紅線:num 項的建議直接拒絕)。
// P6b-2 起兩支草稿工具改為產生現場文書草稿,內容由照片起稿同一支 builder 湊(數量誠實原則、實測值不帶值
// 在 fieldDocDraft.test.ts 釘住),寫入走同一段 writeDraftDocument(fieldDocDraftRun.test.ts 的 Agent 起稿段)。
import { describe, it, expect, vi } from 'vitest'
import {
  QUERY_TOOLS, DRAFT_DAILY_LOG_TOOL, DRAFT_INSPECTION_TOOL, DRAFT_SUBMITTAL_REVIEW_TOOL, RAISE_TO_TOOL, RUN_INTEGRITY_AUDIT_TOOL,
  toolsForRole,
} from './agentToolDefs.ts'
import { validateBoolSuggestions } from './draftInspection.ts'
import { pickChecklistTemplate } from './fieldDocDraft.ts'
import { makeToolExec } from './agentTools.ts'

describe('toolsForRole(批4 角色分發:查詢在前、角色草稿工具居中、raise_to 殿後)', () => {
  const queryNames = QUERY_TOOLS.map((t) => t.name)

  it('contractor = 查詢七支 + 日誌草稿 + 自主檢查草稿 + raise_to', () => {
    expect(toolsForRole('contractor').map((t) => t.name))
      .toEqual([...queryNames, 'draft_daily_log', 'draft_inspection', 'raise_to'])
    expect(toolsForRole('contractor').at(-3)).toBe(DRAFT_DAILY_LOG_TOOL)
    expect(toolsForRole('contractor').at(-2)).toBe(DRAFT_INSPECTION_TOOL)
    expect(toolsForRole('contractor').at(-1)).toBe(RAISE_TO_TOOL)
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

  it('contractor 沒有 draft_submittal_review（只給 supervisor）', () => {
    expect(toolsForRole('contractor').map((t) => t.name)).not.toContain('draft_submittal_review')
  })

  it('查詢七支的名稱與順序逐項釘死(B4 拆檔到 agentToolDefs.ts 後仍不可變)', () => {
    expect(queryNames).toEqual([
      'search_boq', 'list_daily_logs', 'get_valuation', 'get_requirements', 'list_my_open_items', 'find_evidence', 'get_record',
    ])
  })

  it('每個角色多次呼叫回傳同一參考(模組層常數,不重建 → 快取前綴逐位元組穩定)', () => {
    for (const role of ['contractor', 'supervisor', 'owner'] as const) {
      expect(toolsForRole(role)).toBe(toolsForRole(role))
    }
    expect(toolsForRole('contractor')[0]).toBe(QUERY_TOOLS[0])
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

// ── 批4:勾選建議的嚴格驗證 ——「實測值不讓 AI 讀」紅線 ─────────────────────
const ITEMS = [
  { no: 'B1', item: '澆置前已通知監造單位', kind: 'bool' },
  { no: 'C2', item: '坍度', kind: 'num' },
  { no: 'D1', item: '抗壓試體已取樣', kind: 'bool' },
  { no: 'D3', item: '防天候保護天數', kind: 'num' },
]
// 每筆建議 = { value, basis } —— 沒有記錄依據的推論,事後和猜測分不出來
const sug = (value: boolean, basis = '照片說明提到已依標準辦理') => ({ value, basis })
const errOf = (raw: unknown) => { const r = validateBoolSuggestions(ITEMS, raw); return 'error' in r ? r.error : null }

describe('validateBoolSuggestions(num 項不接受任何建議;bool 建議必須附依據)', () => {
  it('沒給建議=空集合(不硬猜)', () => {
    for (const raw of [undefined, null]) {
      const r = validateBoolSuggestions(ITEMS, raw)
      if ('error' in r) throw new Error(r.error)
      expect(r.suggestions.size).toBe(0)
    }
  })

  it('bool_suggestions 指到 num 項 → 直接回 error(不是默默忽略)', () => {
    expect(errOf({ C2: sug(true) })).toContain('數值實測項')
    expect(errOf({ B1: sug(true), D3: sug(true) })).toContain('數值實測項')
  })

  it('未知項次 / 非布林 value / 非物件 → 各自回明確錯誤讓模型修正', () => {
    expect(errOf({ Z9: sug(true) })).toContain('未知項次')
    expect(errOf({ B1: { value: '有', basis: '照片說明提到已通知' } })).toContain('true/false')
    expect(errOf({ B1: '有' })).toContain('物件')
    expect(errOf([true])).toContain('物件')
  })

  it('缺 basis 或 basis 太短(去空白後 < 4 字)被拒 —— bool 建議必須附依據', () => {
    expect(errOf({ B1: { value: true } })).toContain('必須附依據')
    expect(errOf({ B1: { value: true, basis: ' 有 ' } })).toContain('必須附依據')
  })

  it('通過的建議保留值與去空白的依據;false 也如實保留(不因 falsy 被吞)', () => {
    const r = validateBoolSuggestions(ITEMS, { B1: sug(true, ' 對話中他親口說昨天已通知監造 '), D1: sug(false, '照片說明載明試體尚未取樣') })
    if ('error' in r) throw new Error(r.error)
    expect(r.suggestions.get('B1')).toEqual({ value: true, basis: '對話中他親口說昨天已通知監造' })
    expect(r.suggestions.get('D1')).toEqual({ value: false, basis: '照片說明載明試體尚未取樣' })
    expect(r.suggestions.has('C2')).toBe(false)
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
    const exec = makeToolExec({} as never, pid, {} as never, 'user-1', 'contractor')
    expect(((await exec('draft_inspection', { check_date: '2026-13-40' })) as { error?: string }).error).toContain('有效日期')
    expect(((await exec('draft_inspection', { work_item_id: 'abc' })) as { error?: string }).error).toContain('UUID')
    expect(((await exec('draft_inspection', { template_id: 'abc' })) as { error?: string }).error).toContain('UUID')
  })

  it('raise_to:to_role / subject / target 成對性逐項驗證', async () => {
    const exec = makeToolExec({} as never, pid, {} as never, 'user-1', 'contractor')
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

  // raise_to 會寫兩筆 agent_actions(對方的 handoff + 發起人的 handoff_sent):
  // service 假件依序收下每一列、依序回不同 id;failAt 讓第 N 筆(0 起算)寫入失敗。
  const membersDb = {
    rpc: async () => ({
      data: [
        { user_id: 'user-1', full_name: '廠商甲', org_type: 'contractor', project_role: 'quality_engineer' },
        { user_id: 'user-2', full_name: '監造乙', org_type: 'supervisor', project_role: 'viewer' },
      ],
      error: null,
    }),
  }
  const makeService = (failAt?: number) => {
    const inserted: Record<string, unknown>[] = []
    const service = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          const i = inserted.push(row) - 1
          return {
            select: () => ({
              single: async () => (failAt === i
                ? { data: null, error: { code: '42501', message: 'permission denied for table agent_actions_secret' } }
                : { data: { id: `action-${i + 1}` }, error: null }),
            }),
          }
        },
      }),
    }
    return { service, inserted }
  }

  it('raise_to:只依三方 org_type 找收件人，不讀 project_role', async () => {
    const { service, inserted } = makeService()
    const exec = makeToolExec(membersDb as never, pid, service as never, 'user-1', 'contractor')
    const out = await exec('raise_to', { to_role: 'supervisor', subject: '缺失改善完成，請複查' }) as Record<string, unknown>

    expect(out.ok).toBe(true)
    expect(out.交接對象).toBe('監造乙(監造)')
    expect(inserted[0]).toMatchObject({ actor_user: 'user-2', agent_role: 'supervisor' })
  })

  // ── B4 紅線三:發起人名下也要有留痕 ────────────────────────────────────────
  // agent_actions_select policy 只給 actor_user 本人看;只寫對方那筆,發起人查不到
  // 自己的 agent 送出了什麼。修法不動 RLS,改成兩筆各落各的名下、evidence 互相對應。
  it('raise_to:發起人與收件人各留一筆,actor_user 分別正確、kind 可辨識、兩筆可對應', async () => {
    const { service, inserted } = makeService()
    const exec = makeToolExec(membersDb as never, pid, service as never, 'user-1', 'contractor')
    const out = await exec('raise_to', {
      to_role: 'supervisor', subject: '缺失改善完成，請複查', note: '3F 柱牆已補強', target_table: 'defects', target_id: pid,
    }) as Record<string, unknown>

    expect(out.ok).toBe(true)
    expect(inserted).toHaveLength(2)
    // 第一筆:對方的待辦(既有行為原樣)
    expect(inserted[0]).toMatchObject({
      actor_user: 'user-2', agent_role: 'supervisor', kind: 'handoff',
      target_table: 'defects', target_id: pid, summary: '缺失改善完成，請複查',
      evidence: { from_user: 'user-1', from_role: 'contractor', to_role: 'supervisor', note: '3F 柱牆已補強' },
    })
    // 第二筆:發起人自己名下的留痕,指向對方那筆的 id
    expect(inserted[1]).toMatchObject({
      actor_user: 'user-1', agent_role: 'contractor', kind: 'handoff_sent',
      target_table: 'defects', target_id: pid,
      evidence: { handoff_action_id: 'action-1', from_user: 'user-1', to_user: 'user-2', to_role: 'supervisor', note: '3F 柱牆已補強' },
    })
    expect(String(inserted[1].summary)).toContain('已交接給 監造乙(監造)')
    expect(String(inserted[1].summary)).toContain('缺失改善完成，請複查')
    expect(inserted[1]).not.toHaveProperty('status') // status 沿用既有慣例:不設,走預設 pending
    expect(out.agent_action_id).toBe('action-1')
    expect(out.sent_action_id).toBe('action-2')
  })

  it('raise_to:發起人留痕寫入失敗不弄掛主要動作 —— 仍 ok,原文只進 console.error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { service, inserted } = makeService(1)
    const exec = makeToolExec(membersDb as never, pid, service as never, 'user-1', 'contractor')
    const out = await exec('raise_to', { to_role: 'supervisor', subject: '缺失改善完成，請複查' }) as Record<string, unknown>

    expect(inserted).toHaveLength(2)
    expect(out.ok).toBe(true)
    expect(out.agent_action_id).toBe('action-1')
    expect(out.sent_action_id).toBeUndefined()
    expect(String(out.發起人留痕)).toContain('交接本身已送達對方')
    expect(String(out.發起人留痕)).toContain('db_error')
    expect(String(out.發起人留痕)).not.toContain('agent_actions_secret')
    const logged = errSpy.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('agentTools.raiseTo.sent')
    expect(logged).toContain('agent_actions_secret')
    errSpy.mockRestore()
  })

  it('raise_to:對方那筆寫入失敗 → 回錯誤、不補登發起人(既有慣例不變)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { service, inserted } = makeService(0)
    const exec = makeToolExec(membersDb as never, pid, service as never, 'user-1', 'contractor')
    const out = await exec('raise_to', { to_role: 'supervisor', subject: '缺失改善完成，請複查' }) as Record<string, unknown>

    expect(out.ok).toBeUndefined()
    expect(String(out.error)).toContain('db_error')
    expect(inserted).toHaveLength(1)
    errSpy.mockRestore()
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

// ── toolError:PostgREST 原文不進 tool_result(B1 / M-9) ──────────────────────
// 模型會把 tool_result 原文複述給使用者;policy / constraint 名只准進伺服器 log。
describe('toolError(makeToolExec 查詢失敗)', () => {
  it('search_boq 撞到 RLS 42501:給模型的是短語＋db_error,policy 名只在 console.error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pgError = { code: '42501', message: 'permission denied for policy "work_items_select_secret"' }
    // searchBoq 的鏈 from→select→eq→or→order→limit,最後一段回 PostgREST 錯誤
    const chain: Record<string, unknown> = {}
    for (const m of ['from', 'select', 'eq', 'or', 'order']) chain[m] = () => chain
    chain.limit = async () => ({ data: null, error: pgError })
    const exec = makeToolExec(chain as never, '00000000-0000-0000-0000-000000000000')
    const out = (await exec('search_boq', { keyword: '混凝土' })) as { error?: string }
    expect(out.error).toBeDefined()
    expect(out.error).not.toContain('work_items_select_secret')
    expect(out.error).not.toContain('42501')
    expect(out.error).toContain('db_error')
    expect(errSpy.mock.calls.flat().map(String).join('\n')).toContain('work_items_select_secret')
    expect(errSpy.mock.calls.flat().map(String).join('\n')).toContain('agentTools.searchBoq')
    errSpy.mockRestore()
  })

  it('P0001 繁中業務規則(DB 觸發器)原樣回給模型,讓它據此修正', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const chain: Record<string, unknown> = {}
    for (const m of ['from', 'select', 'eq', 'or', 'order']) chain[m] = () => chain
    chain.limit = async () => ({ data: null, error: { code: 'P0001', message: '本案標單尚未匯入' } })
    const exec = makeToolExec(chain as never, '00000000-0000-0000-0000-000000000000')
    const out = (await exec('search_boq', { keyword: '混凝土' })) as { error?: string }
    expect(out.error).toBe('本案標單尚未匯入')
    errSpy.mockRestore()
  })
})
