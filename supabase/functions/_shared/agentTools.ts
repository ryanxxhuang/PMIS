// Agent 工具層(批1 唯讀查詢七支;批3 加入第八支 draft_daily_log)。
// ---------------------------------------------------------------------------
// 七支查詢工具全部只讀不寫;draft_daily_log 是第一支「會寫東西」的工具,但它
// 只寫 agent_actions(AI 草稿收件匣,系統管理表)—— 絕不寫 daily_logs 等任何
// 業務資料表。真正的日誌寫入發生在使用者於收件匣按「接受」之後,由前端走既有
// saveSiteLog 完成,既有 RLS / guard trigger 全部照常生效。
// 權限模型:所有業務查詢都走「呼叫者 JWT 建的 userClient」→ 自動套 RLS;
// 但每個查詢仍逐一 .eq('project_id', …) 綁定本案 —— 縱深防禦,不單靠 RLS。
// service role client 只用於寫 agent_actions(該表 authenticated 無寫入權),
// 絕不傳給任何查詢 —— 見 makeToolExec 的參數說明。
// 輸入一律先驗(型別/範圍/日期/UUID),不合法回 { error } 而非丟例外,
// 讓 agent 迴圈能把錯誤以 tool_result 還給模型自行修正。
// 工具陣列順序固定(查詢七支在前、draft 在後)—— 這是 prompt cache 前綴
// 逐位元組穩定的前提,不可重排。
//
// 欄位名以 supabase/migrations/20260711000000_baseline.sql 為準:
//   * work_items 沒有 item_code/name 欄 —— 實際是 item_no / ref_item_code / description。
//   * test_samples 沒有 work_item_id —— 試體無法直接對應工項(批5 evidence_links 前先降級)。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ToolDef, ToolExec } from './agent.ts'
import type { AgentRole } from './agentPersona.ts'
import { computeObligationDueUTC, diffDays, formatDate, parseDateUTC, taipeiTodayUTC } from './contractDue.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ilike 用:跳脫萬用字元;另移除 PostgREST or() 語法的分隔字元(逗號/括號),
// 否則關鍵字會被當成條件分隔符注入額外條件。
function likePattern(raw: string): string {
  const cleaned = raw.replace(/[,()]/g, ' ').trim().replace(/[%_\\]/g, (c) => '\\' + c)
  return `%${cleaned}%`
}

const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v)
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// 限制 embed 明細筆數,避免單一 tool_result 撐爆 context(agent.ts 另有 20000 字元截斷保險)
const EMBED_CAP = 200

function capList<T>(rows: T[] | null | undefined, cap = EMBED_CAP): { rows: T[]; note?: string } {
  const list = rows ?? []
  if (list.length <= cap) return { rows: list }
  return { rows: list.slice(0, cap), note: `僅列出前 ${cap} 筆(共 ${list.length} 筆)` }
}

// ── 球在誰手上(與 src/lib/ballInCourt.js 一致;改動要兩邊同步) ──────────────
type Ball = { who: 'contractor' | 'supervisor' | 'owner' | 'done'; label: string }

function rfiBall(r: { status?: string }): Ball {
  if (r.status === '待回覆') return { who: 'supervisor', label: '待監造/設計回覆' }
  if (r.status === '已回覆') return { who: 'contractor', label: '待廠商確認結案' }
  return { who: 'done', label: '已結案' }
}
function submittalBall(s: { status?: string }): Ball {
  if (s.status === '已提送' || s.status === '審核中') return { who: 'supervisor', label: '待監造審定' }
  if (s.status === '退回補正') return { who: 'contractor', label: '待廠商補正' }
  return { who: 'done', label: s.status || '' }
}
function valuationBall(v: { status?: string; invoice_date?: string | null; paid_date?: string | null }): Ball {
  if (v.status === '草稿') return { who: 'contractor', label: '待廠商送審' }
  if (v.status === '監造審核') return { who: 'supervisor', label: '待監造核定' }
  if (!v.invoice_date) return { who: 'contractor', label: '待廠商請款' }
  if (!v.paid_date) return { who: 'owner', label: '待機關撥款' }
  return { who: 'done', label: '已撥款' }
}
function defectBall(d: { status?: string }): Ball {
  if (d.status === '已結案') return { who: 'done', label: '已結案' }
  if (d.status === '待複查') return { who: 'supervisor', label: '待監造複查' }
  if (d.status === '改善中') return { who: 'contractor', label: '廠商改善中' }
  return { who: 'contractor', label: '待廠商改善' }
}

// ── 工具定義(順序固定!) ────────────────────────────────────────────────────
export const QUERY_TOOLS: ToolDef[] = [
  {
    name: 'search_boq',
    description:
      '以關鍵字搜尋本案標單工項(BOQ)。標單動輒數千項不會整包給你,所以任何時候' +
      '需要知道某個工項的編號、單位、契約數量、單價或金額 —— 或需要 work_item_id 供其他工具使用 —— 都先呼叫我。' +
      '比對欄位:項次(item_no)、編碼(ref_item_code)、名稱說明(description)。',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '關鍵字,如「混凝土」「壹.一.6」或 PCCES 編碼片段' },
        limit: { type: 'number', description: '最多回幾筆,1–20,預設 10' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'list_daily_logs',
    description:
      '查某日期區間的施工日誌(含每日天氣、出工、各工項當日數量)。' +
      '要回答「某段時間做了什麼/做了多少」「日誌有沒有填」「出工情形」時呼叫我。' +
      '可用 work_item_id 只看單一工項的每日數量。區間最長 60 天,更長請分段查。',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '起日 YYYY-MM-DD' },
        to: { type: 'string', description: '迄日 YYYY-MM-DD' },
        work_item_id: { type: 'string', description: '(選填)只看此工項的當日數量,UUID,可先用 search_boq 查' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_valuation',
    description:
      '查估驗計價:一期的期別、狀態、起迄與計價日、請款/撥款資訊,以及各工項的累計數量/金額與來源(手填或日誌帶入)。' +
      '要回答「這期估驗報了什麼」「估驗到哪個狀態」「累計金額多少」時呼叫我。不給 period_no 就回最新一期。',
    input_schema: {
      type: 'object',
      properties: {
        period_no: { type: 'number', description: '(選填)期別,正整數;省略=最新一期' },
      },
      required: [],
    },
  },
  {
    name: 'get_requirements',
    description:
      '查本案履約需求:契約應辦事項(含期限規則、罰則、出處條款)與已核定的履約需求清單。' +
      '要回答「契約規定什麼時候要交什麼」「有什麼罰則」「這件事的依據條款」時呼叫我。' +
      '引用條款時必須照回傳的 source_clause 原樣引,不可自行補條號。',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '(選填)主題關鍵字,對標題/內容模糊比對,如「開工」「保險」「試體」' },
        limit: { type: 'number', description: '每類最多回幾筆,1–30,預設 15' },
      },
      required: [],
    },
  },
  {
    name: 'list_my_open_items',
    description:
      '列出「球在我方(使用者所屬單位)」的待辦:未結案缺失、待審送審件、未結案 RFI、待處理估驗、逾期契約義務。' +
      '要回答「我現在該處理什麼」「有哪些事卡在我們這邊」「有沒有逾期的」時呼叫我。依到期日排序,最多 30 筆。',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'find_evidence',
    description:
      '調出某工項的佐證紀錄:有數量的施工日誌、查驗紀錄、自主檢查表、照片。' +
      '要核對「這個工項的報量有沒有紀錄支持」「查驗過了沒」「有沒有照片」時呼叫我。' +
      'work_item_id 可先用 search_boq 查;可加 from/to 限縮日期。',
    input_schema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'string', description: '工項 UUID' },
        from: { type: 'string', description: '(選填)起日 YYYY-MM-DD' },
        to: { type: 'string', description: '(選填)迄日 YYYY-MM-DD' },
      },
      required: ['work_item_id'],
    },
  },
  {
    name: 'get_record',
    description:
      '查單筆紀錄的完整內容。其他工具給的是清單摘要;要看某一筆的全部欄位(含明細)時,用該筆的 id 呼叫我。' +
      'table 只接受:daily_logs、inspections、defects、submittals、rfis、change_orders、valuations、safety_records。',
    input_schema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          enum: ['daily_logs', 'inspections', 'defects', 'submittals', 'rfis', 'change_orders', 'valuations', 'safety_records'],
          description: '資料表名(白名單)',
        },
        id: { type: 'string', description: '該筆紀錄的 UUID' },
      },
      required: ['table', 'id'],
    },
  },
]

// ── 批3:draft_daily_log(第八支;只給 field 角色) ──────────────────────────
// 唯一「會寫」的工具,但只寫 agent_actions 草稿收件匣 —— 不寫任何業務資料表。
export const DRAFT_DAILY_LOG_TOOL: ToolDef = {
  name: 'draft_daily_log',
  description:
    '當使用者要你幫忙寫/擬今天(或某天)的施工日誌時呼叫。會讀當日已上傳的現場照片、' +
    '昨日日誌與天氣,產生一份日誌草稿放進使用者的草稿收件匣。你不會直接建立日誌,' +
    '使用者必須在收件匣確認後才會生效;各工項數量一律留空,由使用者本人填寫。',
  input_schema: {
    type: 'object',
    properties: {
      log_date: { type: 'string', description: '(選填)日誌日期 YYYY-MM-DD,省略=今天(台北時間)' },
    },
    required: [],
  },
}

// 角色分發:field 多拿 draft_daily_log;qc/supervisor/owner 的草稿工具是批4。
// ⚠️ 順序固定:查詢七支在前、draft 在後 —— 同一角色的 tools 前綴必須逐位元組
// 穩定,prompt cache 才會命中(不同角色本來就是不同前綴,各自穩定即可)。
const FIELD_TOOLS: ToolDef[] = [...QUERY_TOOLS, DRAFT_DAILY_LOG_TOOL]

export function toolsForRole(role: AgentRole): ToolDef[] {
  return role === 'field' ? FIELD_TOOLS : QUERY_TOOLS
}

// ── 各工具實作 ───────────────────────────────────────────────────────────────

async function searchBoq(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  const keyword = input.keyword
  if (typeof keyword !== 'string' || !keyword.trim()) return { error: 'keyword 必須是非空字串' }
  let limit = 10
  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number' || !Number.isFinite(input.limit)) return { error: 'limit 必須是數字' }
    limit = Math.min(20, Math.max(1, Math.floor(input.limit)))
  }
  const pat = likePattern(keyword)
  const { data, error } = await db
    .from('work_items')
    .select('id, item_no, ref_item_code, description, unit, quantity, unit_price, amount')
    .eq('project_id', projectId)
    .or(`item_no.ilike.${pat},ref_item_code.ilike.${pat},description.ilike.${pat}`)
    .order('sort_order', { ascending: true })
    .limit(limit)
  if (error) return { error: error.message }
  if (!data?.length) return { note: '查無符合的工項,換個關鍵字試試' }
  return { items: data }
}

async function listDailyLogs(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  if (!isDate(input.from) || !isDate(input.to)) return { error: 'from/to 必須是 YYYY-MM-DD' }
  const fromMs = parseDateUTC(input.from)
  const toMs = parseDateUTC(input.to)
  if (fromMs == null || toMs == null || fromMs > toMs) return { error: '日期區間不合法(from 需 ≤ to)' }
  if (diffDays(toMs, fromMs) > 60) return { error: '區間超過 60 天,請縮小範圍分段查詢' }
  const workItemId = input.work_item_id
  if (workItemId !== undefined && !isUuid(workItemId)) return { error: 'work_item_id 必須是 UUID' }

  const { data, error } = await db
    .from('daily_logs')
    .select('id, log_date, weather, weather_am, weather_pm, work_summary, status, labor, daily_log_items(work_item_id, qty_today, note)')
    .eq('project_id', projectId)
    .gte('log_date', input.from)
    .lte('log_date', input.to)
    .order('log_date', { ascending: true })
  if (error) return { error: error.message }

  let logs = (data ?? []) as Array<Record<string, unknown> & { daily_log_items?: Array<{ work_item_id: string }> }>
  if (workItemId) {
    logs = logs
      .map((l) => ({ ...l, daily_log_items: (l.daily_log_items ?? []).filter((i) => i.work_item_id === workItemId) }))
      .filter((l) => (l.daily_log_items ?? []).length > 0)
  }
  if (!logs.length) return { note: '此區間查無施工日誌(或該工項無填報數量)' }
  return { logs }
}

async function getValuation(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  let q = db
    .from('valuations')
    .select(
      'id, period_no, period_start, period_end, valuation_date, retention_pct, status, note, invoice_date, paid_date, paid_amount, ' +
        'valuation_items(work_item_id, cum_qty, cum_pct, amount_cum, amount_period, source, work_items(item_no, description, unit))',
    )
    .eq('project_id', projectId)
  if (input.period_no !== undefined) {
    if (typeof input.period_no !== 'number' || !Number.isInteger(input.period_no) || input.period_no < 1) {
      return { error: 'period_no 必須是正整數' }
    }
    q = q.eq('period_no', input.period_no)
  } else {
    q = q.order('period_no', { ascending: false }).limit(1)
  }
  const { data, error } = await q
  if (error) return { error: error.message }
  const row = (data ?? [])[0] as (Record<string, unknown> & { valuation_items?: unknown[] }) | undefined
  if (!row) return { note: input.period_no !== undefined ? '查無此期估驗' : '本案尚無估驗紀錄' }
  const capped = capList(row.valuation_items as unknown[])
  return { valuation: { ...row, valuation_items: capped.rows }, ...(capped.note ? { items_note: capped.note } : {}) }
}

async function getRequirements(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  const topic = input.topic
  if (topic !== undefined && (typeof topic !== 'string' || topic.length > 100)) {
    return { error: 'topic 必須是 100 字內的字串' }
  }
  let limit = 15
  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number' || !Number.isFinite(input.limit)) return { error: 'limit 必須是數字' }
    limit = Math.min(30, Math.max(1, Math.floor(input.limit)))
  }
  const pat = topic ? likePattern(topic) : null

  // 到期日確定性推算需要專案基準日(決標/開工通知/開工/竣工)——由程式算,不是 AI 算
  const { data: proj } = await db
    .from('projects')
    .select('award_date, notice_date, commencement_date, end_date')
    .eq('id', projectId)
    .maybeSingle()
  const today = taipeiTodayUTC()

  let obQ = db
    .from('contract_obligations')
    .select('id, title, category, trigger_event, offset_days, offset_dir, fixed_date, recurring, recurring_day, responsible, penalty, source_clause, source_page, status, note')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .limit(limit)
  if (pat) obQ = obQ.or(`title.ilike.${pat},penalty.ilike.${pat},note.ilike.${pat}`)
  const { data: obligations, error: obError } = await obQ
  if (obError) return { error: obError.message }

  const obligationRows = (obligations ?? []).map((ob) => {
    const due = proj ? computeObligationDueUTC(ob, proj, today) : null
    return {
      ...ob,
      due_date: due != null ? formatDate(due) : null,
      days_left: due != null ? diffDays(due, today) : null, // 負數=已逾期(程式推算,非 AI 計算)
    }
  })

  // 已核定履約需求(requirements):只取 approved —— 未審核的 AI 草稿不可當契約事實引用
  let reqRows: unknown[] | { note: string } = []
  let reqQ = db
    .from('requirements')
    .select('id, title, description, requirement_type, acceptance_criteria, evidence_requirement, status')
    .eq('project_id', projectId)
    .eq('status', 'approved')
    .limit(limit)
  if (pat) reqQ = reqQ.or(`title.ilike.${pat},description.ilike.${pat}`)
  const { data: reqs, error: reqError } = await reqQ
  if (reqError) reqRows = { note: '本案無此資料' } // 表不存在或無權限時優雅降級,不讓整支工具失敗
  else reqRows = reqs ?? []

  if (!obligationRows.length && (Array.isArray(reqRows) ? !reqRows.length : true)) {
    return { note: topic ? '查無符合主題的履約需求' : '本案尚未匯入契約應辦事項' }
  }
  return { contract_obligations: obligationRows, approved_requirements: reqRows }
}

async function listMyOpenItems(db: SupabaseClient, projectId: string, _input: Record<string, unknown>) {
  // 「我方」= 呼叫者的組織別(伺服器端 RPC,不信任 client 傳值)
  const { data: orgType } = await db.rpc('my_org_type')
  const side: 'contractor' | 'supervisor' | 'owner' =
    orgType === 'supervisor' ? 'supervisor' : orgType === 'owner' ? 'owner' : 'contractor'
  const today = taipeiTodayUTC()

  type Item = { kind: string; id: string; title: string; status: string; meta: string; due_date: string | null; overdue_days?: number }
  const items: Item[] = []
  const push = (ball: Ball, kind: string, id: string, title: string, status: string, dueDate: string | null) => {
    if (ball.who !== side) return
    const dueMs = parseDateUTC(dueDate)
    const overdue = dueMs != null && dueMs < today ? diffDays(today, dueMs) : undefined
    items.push({ kind, id, title: title || '(未命名)', status, meta: ball.label, due_date: dueDate, ...(overdue ? { overdue_days: overdue } : {}) })
  }

  const [defects, submittals, rfis, valuations, proj, obligations] = await Promise.all([
    db.from('defects').select('id, title, severity, status, due_date, domain').eq('project_id', projectId).neq('status', '已結案'),
    db.from('submittals').select('id, submittal_no, title, status, due_date').eq('project_id', projectId).in('status', ['已提送', '審核中', '退回補正']),
    db.from('rfis').select('id, rfi_no, title, status, due_date').eq('project_id', projectId).in('status', ['待回覆', '已回覆']),
    db.from('valuations').select('id, period_no, status, invoice_date, paid_date').eq('project_id', projectId),
    db.from('projects').select('award_date, notice_date, commencement_date, end_date').eq('id', projectId).maybeSingle(),
    db.from('contract_obligations').select('id, title, responsible, trigger_event, offset_days, offset_dir, fixed_date, recurring, recurring_day, source_clause').eq('project_id', projectId).eq('status', '待辦'),
  ])
  const firstError = [defects, submittals, rfis, valuations, obligations].find((r) => r.error)
  if (firstError?.error) return { error: firstError.error.message }

  for (const d of defects.data ?? []) {
    push(defectBall(d), d.domain === 'safety' ? '工安缺失' : '缺失', d.id, d.title, d.status, d.due_date)
  }
  for (const s of submittals.data ?? []) {
    push(submittalBall(s), '送審', s.id, `${s.submittal_no ? s.submittal_no + ' ' : ''}${s.title || ''}`.trim(), s.status, s.due_date)
  }
  for (const r of rfis.data ?? []) {
    push(rfiBall(r), '疑義', r.id, `${r.rfi_no ? r.rfi_no + ' ' : ''}${r.title || ''}`.trim(), r.status, r.due_date)
  }
  for (const v of valuations.data ?? []) {
    push(valuationBall(v), '估驗', v.id, `第 ${v.period_no} 期估驗`, v.status, null)
  }
  // 逾期契約義務:到期日由 contractDue 依基準日確定性推算(不是 AI 算);
  // responsible 未填的義務預設歸廠商(與資料慣例一致)。
  const sideLabel = side === 'contractor' ? '廠商' : side === 'supervisor' ? '監造' : '機關'
  for (const ob of obligations.data ?? []) {
    const resp = ob.responsible || '廠商'
    if (resp !== sideLabel) continue
    const due = proj?.data ? computeObligationDueUTC(ob, proj.data, today) : null
    if (due == null || due >= today) continue
    items.push({
      kind: '契約義務',
      id: ob.id,
      title: ob.title,
      status: '待辦',
      meta: `已逾期${ob.source_clause ? '(依 ' + ob.source_clause + ')' : ''}`,
      due_date: formatDate(due),
      overdue_days: diffDays(today, due),
    })
  }

  // 到期日近的排前面;沒有到期日的排最後
  items.sort((a, b) => {
    const am = parseDateUTC(a.due_date)
    const bm = parseDateUTC(b.due_date)
    if (am == null && bm == null) return 0
    if (am == null) return 1
    if (bm == null) return -1
    return am - bm
  })
  if (!items.length) return { note: '目前沒有球在我方的待辦', side: sideLabel }
  return { side: sideLabel, items: items.slice(0, 30) }
}

async function findEvidence(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  if (!isUuid(input.work_item_id)) return { error: 'work_item_id 必須是 UUID' }
  const wi = input.work_item_id
  const from = input.from
  const to = input.to
  if (from !== undefined && !isDate(from)) return { error: 'from 必須是 YYYY-MM-DD' }
  if (to !== undefined && !isDate(to)) return { error: 'to 必須是 YYYY-MM-DD' }

  // 施工日誌(有數量的):經 daily_logs inner join 綁定本案 —— 縱深防禦
  let logQ = db
    .from('daily_log_items')
    .select('qty_today, note, daily_logs!inner(id, project_id, log_date, status)')
    .eq('work_item_id', wi)
    .eq('daily_logs.project_id', projectId)
    .gt('qty_today', 0)
  if (from) logQ = logQ.gte('daily_logs.log_date', from)
  if (to) logQ = logQ.lte('daily_logs.log_date', to)

  let inspQ = db
    .from('inspections')
    .select('id, title, inspection_type, status, requested_date, inspected_at, result_note')
    .eq('project_id', projectId)
    .eq('work_item_id', wi)
  if (from) inspQ = inspQ.gte('requested_date', from)
  if (to) inspQ = inspQ.lte('requested_date', to)

  let chkQ = db
    .from('checklist_records')
    .select('id, check_date, location, overall, rev')
    .eq('project_id', projectId)
    .eq('work_item_id', wi)
  if (from) chkQ = chkQ.gte('check_date', from)
  if (to) chkQ = chkQ.lte('check_date', to)

  let photoQ = db
    .from('photos')
    .select('id, storage_path, caption, taken_at, daily_log_id')
    .eq('project_id', projectId)
    .eq('work_item_id', wi)
  if (from) photoQ = photoQ.gte('taken_at', `${from}T00:00:00+08:00`)
  if (to) photoQ = photoQ.lte('taken_at', `${to}T23:59:59+08:00`)

  const [logs, inspections, checklists, photos] = await Promise.all([logQ, inspQ, chkQ, photoQ])
  const firstError = [logs, inspections, checklists, photos].find((r) => r.error)
  if (firstError?.error) return { error: firstError.error.message }

  const logCap = capList(logs.data)
  const photoCap = capList(photos.data)
  return {
    daily_log_quantities: logCap.rows,
    inspections: inspections.data ?? [],
    checklist_records: checklists.data ?? [],
    photos: photoCap.rows,
    // 試體(test_samples)目前沒有工項關聯欄位,無法對應到指定工項 —— 批5 的
    // evidence_links 上線前先誠實降級,不做 location 文字模糊猜測。
    test_samples: { note: '本案試體紀錄未與工項直接關聯,無法依工項調閱' },
    ...(logCap.note ? { daily_log_note: logCap.note } : {}),
    ...(photoCap.note ? { photos_note: photoCap.note } : {}),
  }
}

// 白名單:table 名 → select 字串(含合理的明細 embed)。絕不動態拼接任意表名。
const RECORD_SELECTS: Record<string, string> = {
  daily_logs: '*, daily_log_items(work_item_id, qty_today, note)',
  inspections: '*',
  defects: '*',
  submittals: '*',
  rfis: '*',
  change_orders: '*, change_order_items(item_no, description, unit, qty_delta, unit_price, amount_delta, note)',
  valuations: '*, valuation_items(work_item_id, cum_qty, cum_pct, amount_cum, amount_period, source)',
  safety_records: '*',
}

async function getRecord(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  const table = input.table
  // 用 hasOwnProperty 而非 `in`:`in` 會命中原型鏈('toString' 等)而讓非白名單字串過關
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(RECORD_SELECTS, table)) {
    return { error: `table 必須是白名單之一:${Object.keys(RECORD_SELECTS).join('、')}` }
  }
  if (!isUuid(input.id)) return { error: 'id 必須是 UUID' }
  const { data, error } = await db
    .from(table)
    .select(RECORD_SELECTS[table])
    .eq('id', input.id)
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { note: '找不到這筆紀錄(或不屬於本案/無權限)' }
  const row = data as Record<string, unknown> & { valuation_items?: unknown[] }
  if (Array.isArray(row.valuation_items)) {
    const capped = capList(row.valuation_items)
    row.valuation_items = capped.rows
    if (capped.note) (row as Record<string, unknown>).valuation_items_note = capped.note
  }
  return { record: row }
}

// ── 批3:施工日誌草稿(全部確定性組裝,不呼叫 Claude) ───────────────────────
const DAY_MS = 86400000

// buildDailyLogDraft 的輸入(查詢層撈好資料後交給純函式組裝,方便單元測試)
export type DailyLogDraftInput = {
  logDate: string
  photos: { id: string; work_item_id: string }[] // 已配對工項的當日照片
  workItems: { id: string; item_key?: string | null; item_no?: string | null; description: string; unit?: string | null; sort_order?: number | null }[]
  yesterday?: {
    log_date: string
    labor?: unknown[] | null
    equipment?: unknown[] | null
    materials?: unknown[] | null
    daily_log_items?: { work_item_id: string; qty_today?: number | null }[]
  } | null
  weather?: { am?: string; pm?: string } | null
  untaggedCount?: number // 當日未配對工項的照片數(誠實揭露「有照片但沒納入」)
}

// 數量的誠實原則(本批最重要的判斷,絕不可放寬):
// 照片能證明「今天做了這個工項」,不能證明「做了多少」。因此:
//   * 工項清單:自動帶出 —— 依據是照片的 work_item_id(確定性欄位比對,非 AI 判讀)。
//   * 數量:一律 qty_today: null + needs_input: true + source: null,由人填。
//     昨日同工項的數量「只寫進 rationale 供參考」,絕不預填(昨天做多少不代表今天)。
//     規格原訂「item_schedules 有當日排程量→預填 source:'schedule'」,但 repo 的
//     item_schedules 只有 planned_start/planned_finish 日期、沒有任何排程數量欄位
//     (見 baseline migration)—— 此預填分支在現行 schema 下不存在,優雅跳過。
//   * 出工/機具/材料:複製昨日日誌(source:'yesterday')—— 天天雷同,複製是合理
//     預設,填錯的代價遠低於數量。
//   * 天氣:既有 fetch-weather(中央氣象局),source:'cwa';失敗就留空。
export function buildDailyLogDraft(input: DailyLogDraftInput): {
  payload: Record<string, unknown>
  summary: string
  rationale: string
} {
  const { logDate, photos, yesterday, weather } = input
  // 展示順序照標單 sort_order(確定性排序,讓摘要/草稿逐次產生一致)
  const workItems = [...input.workItems].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const photoCountByItem = new Map<string, number>()
  for (const p of photos) {
    photoCountByItem.set(p.work_item_id, (photoCountByItem.get(p.work_item_id) ?? 0) + 1)
  }
  const yQtyByItem = new Map<string, number>()
  for (const it of yesterday?.daily_log_items ?? []) {
    if (typeof it.qty_today === 'number' && it.qty_today > 0) yQtyByItem.set(it.work_item_id, it.qty_today)
  }

  // items:key 用 work_item_id;附 item_key(saveSiteLog 的 items 以 item_key 為 key,
  // 前端接受草稿時要靠它轉形狀)與展示欄位。數量一律留空標 needs_input。
  const items: Record<string, unknown> = {}
  for (const wi of workItems) {
    items[wi.id] = {
      item_key: wi.item_key ?? null,
      item_no: wi.item_no ?? null,
      description: wi.description,
      unit: wi.unit ?? null,
      qty_today: null,
      needs_input: true,
      source: null,
    }
  }

  // work_summary:確定性字串拼接(不用 AI),誠實標明數量待填
  const parts = workItems.map((wi) => {
    const label = [wi.item_no, wi.description].filter(Boolean).join(' ')
    return `${label}(照片 ${photoCountByItem.get(wi.id) ?? 0} 張)`
  })
  const workSummary = `依現場照片,本日施作:${parts.join('、')}。各工項數量待現場確認後填寫。`

  const hasYesterday = !!yesterday
  const labor = (yesterday?.labor as unknown[] | null) ?? []
  const equipment = (yesterday?.equipment as unknown[] | null) ?? []
  const materials = (yesterday?.materials as unknown[] | null) ?? []
  const weatherAm = weather?.am || null
  const weatherPm = weather?.pm || null
  const weatherSource = weatherAm || weatherPm ? 'cwa' : null

  const payload = {
    log_date: logDate,
    weather_am: weatherAm,
    weather_pm: weatherPm,
    labor,
    equipment,
    materials,
    work_summary: workSummary,
    items,
    // 各欄位資料來源,前端據以呈現「哪些是帶入、哪些待填」
    field_sources: {
      items: 'photos',
      quantities: 'needs_input', // 數量沒有來源 —— 一律由人填
      weather: weatherSource,
      labor: hasYesterday && labor.length ? 'yesterday' : null,
      equipment: hasYesterday && equipment.length ? 'yesterday' : null,
      materials: hasYesterday && materials.length ? 'yesterday' : null,
    },
    photo_ids: photos.map((p) => p.id),
  }

  const [, m, d] = logDate.split('-')
  const summary =
    `已依 ${photos.length} 張現場照片擬好 ${Number(m)}/${Number(d)} 施工日誌草稿` +
    `(${workItems.length} 個工項,數量待你填)`

  // rationale:逐欄位交代依據 —— 給收件匣的人看,讓他知道哪些可信、哪些必須自己填
  const yRefs = workItems
    .filter((wi) => yQtyByItem.has(wi.id))
    .map((wi) => `${[wi.item_no, wi.description].filter(Boolean).join(' ')} 昨日 ${yQtyByItem.get(wi.id)} ${wi.unit || ''}`.trim())
  const rationaleParts = [
    `工項清單:依當日 ${photos.length} 張已配對工項的現場照片自動帶出(比對照片的工項欄位,確定性,非 AI 判讀)。`,
    '數量:一律留空待你親自填寫 —— 照片能證明有施作,不能證明做了多少,系統不猜數量。' +
      (yRefs.length ? `昨日同工項數量僅供參考:${yRefs.join('、')}。` : ''),
    hasYesterday
      ? `出工/機具/材料:複製自昨日(${yesterday!.log_date})日誌,請核對後調整。`
      : '出工/機具/材料:無昨日日誌可複製,留空待填。',
    weatherSource ? '天氣:依工地座標向中央氣象局預報自動帶入。' : '天氣:無工地座標或查詢失敗,未帶入,請手動填寫。',
    input.untaggedCount ? `另有 ${input.untaggedCount} 張當日照片尚未配對工項,未納入本草稿。` : '',
  ].filter(Boolean)

  return { payload, summary, rationale: rationaleParts.join('\n') }
}

// draft_daily_log 執行:查詢一律走 userClient(RLS);service 只用來寫 agent_actions。
async function draftDailyLog(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  input: Record<string, unknown>,
) {
  // log_date 驗證:格式 + 回轉一致(擋 2026-13-40 這類會被 Date 進位吃掉的值)
  let logDate: string
  if (input.log_date !== undefined) {
    if (!isDate(input.log_date)) return { error: 'log_date 必須是 YYYY-MM-DD' }
    const ms = parseDateUTC(input.log_date)
    if (ms == null || formatDate(ms) !== input.log_date) return { error: 'log_date 不是有效日期' }
    logDate = input.log_date
  } else {
    logDate = formatDate(taipeiTodayUTC())
  }
  // service role 未設定 → 查詢工具照常可用,只有草稿功能誠實停用(見 agent-run)
  if (!service || !userId) return { error: '伺服器未設定,暫時無法建立草稿' }

  // 該日已有日誌 → 不重複擬(daily_logs 有 project_id+log_date 唯一約束)
  const { data: existing, error: exErr } = await db
    .from('daily_logs')
    .select('id')
    .eq('project_id', projectId)
    .eq('log_date', logDate)
    .maybeSingle()
  if (exErr) return { error: exErr.message }
  if (existing) return { error: `該日(${logDate})已有施工日誌,請直接編輯` }

  // 當日照片(台北時區界):taken_at 落在該日;有無配對工項分開統計,誠實揭露
  const { data: dayPhotos, error: phErr } = await db
    .from('photos')
    .select('id, work_item_id, taken_at')
    .eq('project_id', projectId)
    .gte('taken_at', `${logDate}T00:00:00+08:00`)
    .lte('taken_at', `${logDate}T23:59:59+08:00`)
    .order('taken_at', { ascending: true })
  if (phErr) return { error: phErr.message }
  const allPhotos = dayPhotos ?? []
  if (!allPhotos.length) {
    // 誠實回報,不是失敗 —— agent 要能把這句話轉述給使用者
    return { note: `該日(${logDate})沒有已上傳的現場照片,無法據以擬稿。請先上傳照片,或直接手動填寫日誌。` }
  }
  let tagged = allPhotos.filter((p) => !!p.work_item_id)
  if (!tagged.length) {
    return { note: `該日(${logDate})的 ${allPhotos.length} 張照片都尚未配對工項,無法據以擬稿。請先在照片批次辨識完成工項配對,或直接手動填寫日誌。` }
  }

  // 聚合工項(RLS + .eq(project_id) 縱深防禦;附 item_key 供前端轉 saveSiteLog 形狀)
  const wiIds = [...new Set(tagged.map((p) => p.work_item_id))]
  const { data: workItems, error: wiErr } = await db
    .from('work_items')
    .select('id, item_key, item_no, description, unit, sort_order')
    .eq('project_id', projectId)
    .in('id', wiIds)
  if (wiErr) return { error: wiErr.message }
  const wiById = new Map((workItems ?? []).map((w) => [w.id, w]))
  tagged = tagged.filter((p) => wiById.has(p.work_item_id)) // 照片指向他案/已刪工項 → 不納入
  if (!tagged.length) {
    return { note: `該日(${logDate})照片配對的工項在本案標單中找不到,無法據以擬稿。請確認照片的工項配對,或直接手動填寫日誌。` }
  }

  // 昨日日誌:出工/機具/材料的複製來源;各工項昨日數量只進 rationale 供參考
  const yesterdayDate = formatDate(parseDateUTC(logDate)! - DAY_MS)
  const { data: ylog } = await db
    .from('daily_logs')
    .select('log_date, labor, equipment, materials, daily_log_items(work_item_id, qty_today)')
    .eq('project_id', projectId)
    .eq('log_date', yesterdayDate)
    .maybeSingle()

  // 排程預填:repo 的 item_schedules 沒有任何「當日排程量」欄位(只有起迄日),
  // 規格的 source:'schedule' 分支無從成立 —— 依規格指示優雅跳過,不查、不猜。

  // 天氣:有座標才呼叫既有 fetch-weather(userClient.functions.invoke 會帶原
  // Authorization header);任何失敗都不阻擋擬稿,天氣留空由人填
  let weather: { am?: string; pm?: string } | null = null
  const { data: proj } = await db.from('projects').select('latitude, longitude').eq('id', projectId).maybeSingle()
  if (proj?.latitude != null && proj?.longitude != null) {
    try {
      const { data: wx, error: wxErr } = await db.functions.invoke('fetch-weather', {
        body: { lat: proj.latitude, lon: proj.longitude, date: logDate },
      })
      if (!wxErr && wx && !wx.error && (wx.am || wx.pm)) weather = { am: wx.am, pm: wx.pm }
    } catch { /* 天氣失敗不阻擋擬稿 */ }
  }

  const { payload, summary, rationale } = buildDailyLogDraft({
    logDate,
    photos: tagged.map((p) => ({ id: p.id, work_item_id: p.work_item_id })),
    workItems: workItems ?? [],
    yesterday: (ylog as DailyLogDraftInput['yesterday']) ?? null,
    weather,
    untaggedCount: allPhotos.length - tagged.length,
  })

  // 唯一的寫入:agent_actions(service role;該表 authenticated 無寫入權)。
  // 絕不寫 daily_logs —— 真正的日誌由使用者在收件匣接受後、前端走 saveSiteLog 建立。
  const { data: action, error: insErr } = await service
    .from('agent_actions')
    .insert({
      project_id: projectId,
      actor_user: userId,
      agent_role: 'field',
      kind: 'draft_daily_log',
      target_table: 'daily_logs',
      summary,
      rationale,
      evidence: { payload, photo_ids: payload.photo_ids, work_items: workItems },
    })
    .select('id')
    .single()
  if (insErr) return { error: insErr.message }

  // 回給模型的是「草稿已放入收件匣」的事實 —— 讓它據實轉述,不可宣稱日誌已建立
  return {
    ok: true,
    agent_action_id: action.id,
    log_date: logDate,
    工項數: Object.keys(payload.items as Record<string, unknown>).length,
    照片數: (payload.photo_ids as string[]).length,
    待填欄位: ['各工項數量'],
    note: '草稿已放進使用者的草稿收件匣;日誌尚未建立,須由使用者本人在收件匣確認,且各工項數量須由他親自填寫。',
  }
}

// ── 分派器 ───────────────────────────────────────────────────────────────────
// service / userId 只有 draft_daily_log 用得到:service 是 service role client,
// 僅用於寫 agent_actions —— 絕不可傳給任何查詢工具(查詢一律走 RLS 的 userClient)。
export function makeToolExec(
  supabase: SupabaseClient,
  projectId: string,
  service?: SupabaseClient | null,
  userId?: string,
): ToolExec {
  return async (name, input) => {
    switch (name) {
      case 'search_boq': return await searchBoq(supabase, projectId, input)
      case 'list_daily_logs': return await listDailyLogs(supabase, projectId, input)
      case 'get_valuation': return await getValuation(supabase, projectId, input)
      case 'get_requirements': return await getRequirements(supabase, projectId, input)
      case 'list_my_open_items': return await listMyOpenItems(supabase, projectId, input)
      case 'find_evidence': return await findEvidence(supabase, projectId, input)
      case 'get_record': return await getRecord(supabase, projectId, input)
      case 'draft_daily_log': return await draftDailyLog(supabase, projectId, service ?? null, userId, input)
      default: return { error: `未知的工具:${name}` }
    }
  }
}
