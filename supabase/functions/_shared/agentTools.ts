// Agent 工具層(批1 唯讀查詢七支;批3 draft_daily_log;批4 run_integrity_audit
// + draft_inspection + raise_to;監造送審審查 draft_submittal_review)。
// ---------------------------------------------------------------------------
// 七支查詢工具全部只讀不寫;草稿類工具(draft_daily_log / draft_inspection /
// draft_submittal_review / raise_to / run_integrity_audit 落稿)只寫 agent_actions(AI 草稿收件匣,系統
// 管理表)—— 絕不寫 daily_logs 等任何業務資料表。真正的業務寫入發生在使用者於
// 收件匣按「接受」之後,由前端走既有 store action 完成,既有 RLS / guard
// trigger 全部照常生效。
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
import { AGENT_ROLES } from './agentPersona.ts'
import type { AgentRole } from './agentPersona.ts'
import type { BallSide } from './agentRole.ts'
export type { BallSide }
import { computeObligationDueUTC, diffDays, formatDate, parseDateUTC, taipeiTodayUTC } from './contractDue.ts'
import { buildIntegrityFindings, isConcretePourItem } from './integrityAudit.ts'
import type { IntegrityLeaf, PourDate, TestSample } from './integrityAudit.ts'

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

// ── 批3:draft_daily_log（廠商 Agent）────────────────────────────────────
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

// ── 批4(任務A):run_integrity_audit(供 supervisor 與 owner —— 監造要對量、
// 機關要防弊,同一份發現)。findings 由確定性引擎 buildIntegrityFindings 產出,
// 本工具不得過濾、重排或改寫 detail 文字 —— AI 只能引用,不參與判定。
// 角色分發(toolsForRole)由批4任務B統一處理,此處只匯出工具定義與執行分支。
export const RUN_INTEGRITY_AUDIT_TOOL: ToolDef = {
  name: 'run_integrity_audit',
  description:
    '跨文件對帳:逐工項比對估驗、施工日誌、查驗、試體,找出對不起來的地方' +
    '(估驗超前日誌、估驗無日誌佐證、未查驗即計價、澆置無試體…)。' +
    '要回答「這期估驗報量對得起來嗎」「有沒有超計」「有什麼該複查的」時呼叫我。' +
    '回傳的發現全部是程式精確比對出來的,你只能引用,不可自行增刪或改數字。',
  input_schema: {
    type: 'object',
    properties: {
      create_draft: { type: 'boolean', description: '(選填)true = 另外把發現寫成一筆稽核草稿放進草稿收件匣' },
    },
    required: [],
  },
}

// ── 批4(任務B):draft_inspection（廠商 Agent）────────────────────────────
// 本批最重要的判斷:查驗實測值不讓 AI 讀。照片能證明「有做」,不能證明「做了多
// 少」;實測值(kind:'num')驅動 judgeChecklist 的合格/不合格判定,是有法律效力
// 的品質紀錄 —— AI 讀錯一個數字就是一張假的「合格」檢查表。因此 num 項一律留空
// 標 needs_input,本檔不存在任何對 num 項賦值的路徑;bool 項(有/無、已設置)
// 才允許模型經 bool_suggestions 給建議,且每項標 ai_suggested 由人逐項確認。
// 收緊(批4 尾):模型在 agent-run 裡沒有視覺輸入,bool 建議的依據頂多是一段
// caption 文字 —— 沒有記錄依據的推論,事後和猜測分不出來。因此每筆建議強制附
// basis(憑什麼這樣建議),缺依據直接拒絕,payload 逐項存 ai_basis 供前端展示。
export const DRAFT_INSPECTION_TOOL: ToolDef = {
  name: 'draft_inspection',
  description:
    '當使用者說要做/擬自主檢查表或查驗紀錄時呼叫。會依當日照片與工項挑出合適的' +
    '檢查表範本,把日期、部位、工項與照片帶好,產生草稿進收件匣。' +
    '數值類實測項一律留空由使用者填,判定由系統依量化標準自動跑——你不可以猜任何實測值。' +
    '勾選類項目(有/無、已設置/未設置)只有在照片說明或使用者親口說過的內容能直接支持時,' +
    '才可經 bool_suggestions 給建議值並附上依據(會逐項標示為 AI 建議);沒把握就省略該項。',
  input_schema: {
    type: 'object',
    properties: {
      work_item_id: { type: 'string', description: '(選填)對應工項 UUID,可先用 search_boq 查' },
      check_date: { type: 'string', description: '(選填)檢查日期 YYYY-MM-DD,省略=今天(台北時間)' },
      template_id: { type: 'string', description: '(選填)檢查表範本 UUID;省略時依工項與範本標題挑最相符的一張' },
      bool_suggestions: {
        type: 'object',
        description:
          '(選填)勾選類項目的建議值。鍵=檢查項次編號(如 B1);值={ value: true/false, basis: 依據 }。' +
          'basis 必填:寫出你依據什麼這樣建議(例如「照片說明提到已架設臨邊護欄」' +
          '或「7/24 查驗紀錄載明模板已組立完成」)。' +
          '你沒有看到照片本身,只能依工具回傳的文字內容推論——推論不出來就省略該項,不要猜。' +
          '僅接受 kind 為 bool 的項目;數值實測項給了會直接被拒絕。',
        additionalProperties: {
          type: 'object',
          properties: { value: { type: 'boolean' }, basis: { type: 'string' } },
          required: ['value', 'basis'],
        },
      },
    },
    required: [],
  },
}

// ── 送審審查(只給 supervisor):draft_submittal_review ──────────────────────
// 包既有 review-submittal edge function(反幻覺紀律在該函式:依據只可引用傳入
// 需求、通用要點標「通用」、涉文件實質內容標「需監造核對文件」、不捏造條號)。
// 需求撈法照前端 src/store/slices/collab.js 的 reviewSubmittal(status /
// requirement_type 篩選與工項相關性過濾),兩邊如改要同步 —— 不另發明一套。
// 紅線:只寫 agent_actions,絕不碰 submittals 任何欄位(狀態轉移有 DB trigger
// 把關,審定=監造);suggested_decision 一律以「建議」呈現,不得寫成結論。
export const DRAFT_SUBMITTAL_REVIEW_TOOL: ToolDef = {
  name: 'draft_submittal_review',
  description:
    '當監造要你幫忙審某件送審文件時呼叫。會依本案履約需求產出審查要點清單、' +
    '審查意見草稿與建議判定,放進草稿收件匣。' +
    '你不會、也不能替監造做審定 —— 核准/退回是監造的法定裁量,' +
    '你只提供意見草稿供他修改後採用。',
  input_schema: {
    type: 'object',
    properties: {
      submittal_id: {
        type: 'string',
        description: '(選填)送審件 UUID;省略=自動挑最早一件待審(已提送/審核中)的送審件',
      },
    },
    required: [],
  },
}

// ── 批4(任務B):raise_to(全角色) ─────────────────────────────────────────
// 唯一「寫給別人」的工具:agent_actions 落在對方名下(actor_user = 對方)。
// 該表 SELECT policy 是「本人」→ 呼叫者自己看不到這筆 —— 這是正確設計(草稿
// 是提給對方的私人待辦),工具回傳必須把這件事講清楚,免得 agent 叫使用者去
// 自己的收件匣找。
export const RAISE_TO_TOOL: ToolDef = {
  name: 'raise_to',
  description:
    '把一件事交給另一個角色處理,並附上你擬好的說明。' +
    '用在你判斷這件事的球應該在別人手上時(例如廠商的缺失改善完成、要請監造複查)。' +
    '這只是產生一則交接草稿給對方確認,你沒有替任何人做決定;' +
    '送出後只會出現在對方的草稿收件匣,使用者自己的收件匣不會顯示這筆。',
  input_schema: {
    type: 'object',
    properties: {
      to_role: {
        type: 'string',
        enum: ['contractor', 'supervisor', 'owner'],
        description: '交接對象角色:contractor=廠商、supervisor=監造、owner=機關',
      },
      subject: { type: 'string', description: '一句話說明要對方處理什麼' },
      note: { type: 'string', description: '(選填)補充說明' },
      target_table: { type: 'string', description: '(選填)關聯單據的資料表名(白名單,須與 target_id 成對)' },
      target_id: { type: 'string', description: '(選填)關聯單據 UUID(須與 target_table 成對)' },
    },
    required: ['to_role', 'subject'],
  },
}

// 角色分發(批4 任務B 統一收斂):查詢七支在前、角色專屬草稿工具居中、raise_to
// 殿後 —— 順序固定。⚠️ 每個角色的陣列都是模組層常數(只建一次):同一角色的
// tools 前綴必須逐位元組穩定,prompt cache 才會命中(不同角色本來就是不同前綴,
// 各自穩定即可)。
const CONTRACTOR_TOOLS: ToolDef[] = [...QUERY_TOOLS, DRAFT_DAILY_LOG_TOOL, DRAFT_INSPECTION_TOOL, RAISE_TO_TOOL]
const SUPERVISOR_TOOLS: ToolDef[] = [...QUERY_TOOLS, RUN_INTEGRITY_AUDIT_TOOL, DRAFT_SUBMITTAL_REVIEW_TOOL, RAISE_TO_TOOL]
const OWNER_TOOLS: ToolDef[] = [...QUERY_TOOLS, RUN_INTEGRITY_AUDIT_TOOL, RAISE_TO_TOOL]

export function toolsForRole(role: AgentRole): ToolDef[] {
  switch (role) {
    case 'contractor': return CONTRACTOR_TOOLS
    case 'supervisor': return SUPERVISOR_TOOLS
    default: return OWNER_TOOLS
  }
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

// ── 球在誰手上:本案全陣營未結項彙整 ──────────────────────────────────────────
// list_my_open_items(RLS userClient)與 send-reminders 每日早報(service role)
// 共用同一份收集邏輯 —— 這是「球在誰手上」判斷的伺服器端唯一實作,別再抄一份。
// 每個查詢都逐一 .eq('project_id') 綁定本案:userClient 下是縱深防禦,
// service role 下(無 RLS)則是唯一的跨案隔離保證,絕不可拿掉。
export interface OpenBallItem {
  side: BallSide
  kind: string
  id: string
  title: string
  status: string
  meta: string
  due_date: string | null
  overdue_days?: number
}

// opts.obligationSoonDays:契約義務除「已逾期」外,額外納入 N 天內到期者
// (list_my_open_items 維持原行為只收逾期 → 預設 0;早報要列「7 日內到期」→ 7)。
export async function collectOpenBallItems(
  db: SupabaseClient,
  projectId: string,
  today: number,
  opts: { obligationSoonDays?: number } = {},
): Promise<{ items: OpenBallItem[] } | { error: string }> {
  const soonDays = opts.obligationSoonDays ?? 0
  const items: OpenBallItem[] = []
  const push = (ball: Ball, kind: string, id: string, title: string, status: string, dueDate: string | null) => {
    if (ball.who === 'done') return
    const dueMs = parseDateUTC(dueDate)
    const overdue = dueMs != null && dueMs < today ? diffDays(today, dueMs) : undefined
    items.push({ side: ball.who, kind, id, title: title || '(未命名)', status, meta: ball.label, due_date: dueDate, ...(overdue ? { overdue_days: overdue } : {}) })
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
  // 契約義務:到期日由 contractDue 依基準日確定性推算(不是 AI 算);
  // responsible 未填的義務預設歸廠商(與資料慣例一致)。
  const SIDE_BY_RESP: Record<string, BallSide> = { 廠商: 'contractor', 監造: 'supervisor', 機關: 'owner' }
  for (const ob of obligations.data ?? []) {
    const side = SIDE_BY_RESP[ob.responsible || '廠商'] ?? 'contractor'
    const due = proj?.data ? computeObligationDueUTC(ob, proj.data, today) : null
    if (due == null) continue
    const overdue = due < today
    if (!overdue && (soonDays <= 0 || diffDays(due, today) > soonDays)) continue
    items.push({
      side,
      kind: '契約義務',
      id: ob.id,
      title: ob.title,
      status: '待辦',
      meta: overdue
        ? `已逾期${ob.source_clause ? '(依 ' + ob.source_clause + ')' : ''}`
        : `待辦${ob.source_clause ? '(依 ' + ob.source_clause + ')' : ''}`,
      due_date: formatDate(due),
      ...(overdue ? { overdue_days: diffDays(today, due) } : {}),
    })
  }

  // 到期日近的排前面;沒有到期日的排最後(stable sort → 同日維持插入順序)
  items.sort((a, b) => {
    const am = parseDateUTC(a.due_date)
    const bm = parseDateUTC(b.due_date)
    if (am == null && bm == null) return 0
    if (am == null) return 1
    if (bm == null) return -1
    return am - bm
  })
  return { items }
}

async function listMyOpenItems(db: SupabaseClient, projectId: string, _input: Record<string, unknown>) {
  // 「我方」= 呼叫者的組織別(伺服器端 RPC,不信任 client 傳值)
  const { data: orgType } = await db.rpc('my_org_type')
  const side: BallSide =
    orgType === 'supervisor' ? 'supervisor' : orgType === 'owner' ? 'owner' : 'contractor'
  const today = taipeiTodayUTC()
  const sideLabel = side === 'contractor' ? '廠商' : side === 'supervisor' ? '監造' : '機關'

  const collected = await collectOpenBallItems(db, projectId, today)
  if ('error' in collected) return { error: collected.error }
  const items = collected.items
    .filter((i) => i.side === side)
    .map(({ side: _side, ...rest }) => rest) // 工具輸出維持原形(不含 side 欄)
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
      agent_role: 'contractor',
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

// ── 批4(任務A):run_integrity_audit 執行 ───────────────────────────────────
// 用 userClient(RLS + .eq(project_id) 縱深防禦)查齊 buildIntegrityFindings 的
// 六個輸入,「組法與 src/pages/web/RiskAudit.jsx 完全一致」(兩邊如改要同步):
//   * leaves:is_billable 且非 rollup 且無可計價子項的工項(parent_id→item_key
//     還原 parent_key,同 db.js dbToWorkItems;RiskAudit 的 childrenMap 亦只收
//     billable 非 rollup 項,已核准變更只改 quantity/amount 不改樹形)。
//   * loggedQty:全部施工日誌明細逐工項累加當日數量(item_key 為鍵;
//     同 loadSiteLogsFromDB 只收 item_key 與 qty_today 皆非 null 的列)。
//   * billedQty:「最新一期」估驗的各工項累計數量(cum_qty,item_key 為鍵)。
//   * inspStatusByItem:查驗依 created_at 新→舊,取每工項最近一次的狀態。
//   * pourDates:混凝土澆置工項(isConcretePourItem 判定的 leaf)當日數量 >0 的
//     日誌日期,依日期新→舊(同前端 siteLogs 的迭代順序)。
//   * testSamples:全部試體(sampled_date 新→舊,同 loadQcFromDB)。
// PostgREST 單次回應上限 1000 列(config max_rows),勾稽要全量 → 大表分頁抓齊
// (同 db.js fetchAllWorkItems 的做法;附穩定排序鍵避免跨頁重複/漏列)。

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ rows: T[]; error?: string }> {
  const all: T[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) return { rows: all, error: error.message }
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < size) break
  }
  return { rows: all }
}

async function runIntegrityAudit(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  role: AgentRole | null,
  input: Record<string, unknown>,
) {
  if (input.create_draft !== undefined && typeof input.create_draft !== 'boolean') {
    return { error: 'create_draft 必須是布林值' }
  }

  // 1) 標單全量(分頁)→ leaves
  type WiRow = {
    id: string; item_key: string | null; parent_id: string | null
    item_no: string | null; description: string | null; unit: string | null
    quantity: number | null; is_billable: boolean | null; is_rollup: boolean | null
  }
  const wi = await fetchAllRows<WiRow>((f, t) =>
    db.from('work_items')
      .select('id, item_key, parent_id, item_no, description, unit, quantity, is_billable, is_rollup')
      .eq('project_id', projectId)
      .order('sort_order')
      .range(f, t))
  if (wi.error) return { error: wi.error }
  if (!wi.rows.length) return { note: '本案尚未匯入標單工項,無法進行勾稽。請先到「標單工項」匯入。' }

  const idToKey = new Map<string, string | null>(wi.rows.map((r) => [r.id, r.item_key]))
  const billables = wi.rows.filter((r) => r.is_billable && !r.is_rollup)
  // 「有可計價子項」= 某 billable 非 rollup 項的 parent_key 等於自己的 item_key
  const parentKeys = new Set<string>()
  for (const r of billables) {
    if (!r.parent_id) continue
    const pk = idToKey.get(r.parent_id)
    if (pk != null) parentKeys.add(pk)
  }
  const leaves: IntegrityLeaf[] = billables
    .filter((r) => !(r.item_key != null && parentKeys.has(r.item_key)))
    .map((r) => ({
      item_key: r.item_key, item_no: r.item_no, description: r.description,
      unit: r.unit, quantity: r.quantity == null ? null : Number(r.quantity),
    }))

  // 2) 施工日誌 + 明細(分頁)→ loggedQty、pourDates
  const logs = await fetchAllRows<{ id: string; log_date: string | null }>((f, t) =>
    db.from('daily_logs')
      .select('id, log_date')
      .eq('project_id', projectId)
      .order('log_date', { ascending: false })
      .range(f, t))
  if (logs.error) return { error: logs.error }
  const logItems = await fetchAllRows<{ daily_log_id: string; work_item_id: string; qty_today: number | null }>((f, t) =>
    db.from('daily_log_items')
      .select('daily_log_id, work_item_id, qty_today, daily_logs!inner(project_id)')
      .eq('daily_logs.project_id', projectId) // 明細表無 project_id → inner join 綁定本案(縱深防禦)
      .order('daily_log_id')
      .order('work_item_id')
      .range(f, t))
  if (logItems.error) return { error: logItems.error }

  const loggedQty = new Map<string, number>()
  const itemsByLog = new Map<string, { key: string; qty: number }[]>()
  for (const it of logItems.rows) {
    const key = idToKey.get(it.work_item_id)
    if (key == null || it.qty_today == null) continue // 同 loadSiteLogsFromDB 的過濾
    const q = Number(it.qty_today) || 0
    loggedQty.set(key, (loggedQty.get(key) || 0) + q)
    const arr = itemsByLog.get(it.daily_log_id) ?? []
    arr.push({ key, qty: q })
    itemsByLog.set(it.daily_log_id, arr)
  }

  // 3) 最新一期估驗 → billedQty
  const { data: latestVal, error: valErr } = await db.from('valuations')
    .select('id, period_no')
    .eq('project_id', projectId)
    .order('period_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (valErr) return { error: valErr.message }
  const billedQty = new Map<string, number>()
  if (latestVal) {
    const vItems = await fetchAllRows<{ work_item_id: string; cum_qty: number | null }>((f, t) =>
      db.from('valuation_items')
        .select('work_item_id, cum_qty, valuations!inner(project_id)')
        .eq('valuation_id', latestVal.id)
        .eq('valuations.project_id', projectId) // 明細表無 project_id → inner join 綁定本案
        .order('work_item_id')
        .range(f, t))
    if (vItems.error) return { error: vItems.error }
    for (const v of vItems.rows) {
      const key = idToKey.get(v.work_item_id)
      if (key == null || v.cum_qty == null) continue // 同 loadValuationsFromDB 的過濾
      billedQty.set(key, Number(v.cum_qty) || 0)
    }
  }

  // 4) 查驗:created_at 新→舊,每工項取最近一次狀態
  const insp = await fetchAllRows<{ id: string; work_item_id: string | null; status: string }>((f, t) =>
    db.from('inspections')
      .select('id, work_item_id, status, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(f, t))
  if (insp.error) return { error: insp.error }
  const inspStatusByItem = new Map<string, string>()
  for (const ins of insp.rows) {
    const key = ins.work_item_id ? idToKey.get(ins.work_item_id) : null
    if (key && !inspStatusByItem.has(key)) inspStatusByItem.set(key, ins.status)
  }

  // 5) 混凝土澆置日:混凝土澆置工項(isConcretePourItem)當日數量 >0 的日誌日期(新→舊)
  const concreteKeys = new Set(leaves.filter((it) => isConcretePourItem(it.description)).map((it) => it.item_key))
  const pourSet = new Set<string>()
  for (const lg of logs.rows) {
    if (!lg.log_date) continue
    if ((itemsByLog.get(lg.id) ?? []).some((e) => concreteKeys.has(e.key) && e.qty > 0)) pourSet.add(lg.log_date)
  }
  const pourDates: PourDate[] = [...pourSet].map((date) => ({ date }))

  // 6) 試體全量(sampled_date 新→舊)
  const samples = await fetchAllRows<TestSample & { id: string }>((f, t) =>
    db.from('test_samples')
      .select('id, sampled_date, status, sample_no')
      .eq('project_id', projectId)
      .order('sampled_date', { ascending: false })
      .order('id')
      .range(f, t))
  if (samples.error) return { error: samples.error }

  // ── 確定性引擎跑勾稽;findings 原樣回傳 —— 不過濾、不重排、不改寫 ──────────
  const { findings, summary } = buildIntegrityFindings({
    leaves, loggedQty, billedQty, inspStatusByItem, pourDates, testSamples: samples.rows,
  })

  if (!findings.length) {
    return {
      ok: true, findings: [], summary,
      note: '本案目前各工項的估驗、日誌、查驗、試體對得起來,沒有發現異常。',
    }
  }

  // create_draft === true → 另寫一筆 audit_note 草稿進收件匣(service role 只做這件事)
  let draftInfo: Record<string, unknown> = {}
  if (input.create_draft === true) {
    if (!service || !userId || !role) return { error: '伺服器未設定,暫時無法建立草稿' }
    const { data: action, error: insErr } = await service
      .from('agent_actions')
      .insert({
        project_id: projectId,
        actor_user: userId,
        agent_role: role, // 呼叫者角色:supervisor(監造對量)/ owner(機關防弊)拿同一份發現
        kind: 'audit_note',
        target_table: 'valuations',
        summary: `勾稽發現 ${findings.length} 項(risk ${summary.risk} 項)`,
        rationale: findings.map((f) => f.title).join('\n'),
        evidence: { findings },
      })
      .select('id')
      .single()
    if (insErr) return { error: insErr.message }
    draftInfo = {
      agent_action_id: action.id,
      draft_note: '稽核發現已寫成草稿放進使用者的草稿收件匣,由使用者本人決定如何處理。',
    }
  }

  return { ok: true, findings, summary, ...draftInfo }
}

// ── 批4(任務B):draft_inspection 實作 ──────────────────────────────────────

// checklist_templates.items 的實際形狀(baseline migration):
// [{no,group,item,kind:'num'|'bool',min,max,unit,standard,source}]
export type ChecklistTemplateItem = {
  no: string
  group?: string | null
  item: string
  kind: 'num' | 'bool'
  min?: number | null
  max?: number | null
  unit?: string | null
  standard?: string | null
  source?: string | null
}

// 範本挑選(確定性關鍵字相符,非 AI):以工項描述的相鄰雙字組對範本標題計分,
// 取最高分;同分取排序較前者(呼叫端已依 created_at 升冪,平手決策確定性)。
// 僅一張範本時直接用;沒有描述或全部 0 分 → 回 null(誠實請使用者指定,不亂挑)。
export function pickChecklistTemplate<T extends { title: string }>(
  templates: T[],
  workItemDesc: string | null | undefined,
): { template: T; reason: string } | null {
  if (!templates.length) return null
  if (templates.length === 1) return { template: templates[0], reason: '本案僅有這一張範本' }
  const desc = (workItemDesc || '').replace(/\s+/g, '')
  if (!desc) return null
  const grams = new Set<string>()
  const chars = [...desc]
  if (chars.length === 1) grams.add(desc)
  for (let i = 0; i + 1 < chars.length; i++) grams.add(chars[i] + chars[i + 1])
  let best: T | null = null
  let bestScore = 0
  for (const t of templates) {
    let score = 0
    for (const g of grams) if (t.title.includes(g)) score += 1
    if (score > bestScore) { best = t; bestScore = score }
  }
  if (!best) return null
  return { template: best, reason: `依工項「${workItemDesc}」與範本標題的相符度挑選,若不對請指定範本` }
}

export type InspectionDraftInput = {
  template: { id: string; title: string; source?: string | null; items: ChecklistTemplateItem[] }
  templateReason: string // 挑中這張範本的依據(原樣寫進 rationale,讓收件的人能質疑)
  checkDate: string
  workItem?: { id: string; item_no?: string | null; description?: string | null } | null
  locationHint?: string | null // 當日該工項照片的 caption 線索;取不到就 null
  photoIds?: string[]
  boolSuggestions?: unknown // 模型對 bool 項的建議(嚴格驗證,見下)
}

// 實測值的紅線(本批最重要的判斷,絕不可放寬):
//   * kind:'num' → 一律 { value: null, needs_input: true },由人親自量測填寫。
//     本函式(與整個檔案)不存在任何對 num 項賦值的路徑 —— boolSuggestions 指到
//     num 項直接回 error(不是默默忽略,讓模型知道這條路不通)。
//   * kind:'bool' → 模型有把握才經 boolSuggestions 給建議,每項必須附 basis(依據);
//     模型在這條流程沒有視覺輸入,依據只能來自工具回傳的文字 —— 沒依據的建議
//     直接拒絕,不是默默收下。每項標 ai_suggested: true + ai_basis(前端據以顯示
//     「AI 建議」與依據小字,不得自動送出);false 也如實輸出(勾「無」同樣是
//     判定輸入,不可因 falsy 被吞);沒給的一律留空標 needs_input。
//   * 不呼叫 judgeChecklist:值沒填完,判定沒有意義 —— overall 留 null,由使用者
//     填完實測值後走前端既有 createChecklistRecord(內部 judgeChecklist)自動判定。
// payload 形狀對齊前端收件匣的接受路徑(results 以項次 no 為鍵、template_id 必要、
// value 為 null 的項不會進存檔 values —— 未檢 ≠ 合格)。
export function buildInspectionDraft(input: InspectionDraftInput):
  | { payload: Record<string, unknown>; summary: string; rationale: string; numPending: number; boolSuggested: number }
  | { error: string } {
  const { template, templateReason, checkDate, workItem, locationHint, boolSuggestions } = input
  const items = template.items || []
  if (!items.length) return { error: `範本「${template.title}」沒有任何檢查項目,無法擬稿` }

  // bool_suggestions 嚴格驗證:只接受「存在且 kind 為 bool」的項次,且每筆
  // 必須是 { value: boolean, basis: string } —— 缺依據的建議一律拒絕
  const suggestions = new Map<string, { value: boolean; basis: string }>()
  if (boolSuggestions !== undefined && boolSuggestions !== null) {
    if (typeof boolSuggestions !== 'object' || Array.isArray(boolSuggestions)) {
      return { error: 'bool_suggestions 必須是物件(鍵=項次編號、值={ value: true/false, basis: 依據 })' }
    }
    const byNo = new Map(items.map((it) => [it.no, it]))
    for (const [no, raw] of Object.entries(boolSuggestions as Record<string, unknown>)) {
      const it = byNo.get(no)
      if (!it) return { error: `bool_suggestions 含未知項次「${no}」,請對照範本項次` }
      if (it.kind !== 'bool') {
        return { error: `項次「${no}」是數值實測項,不接受任何建議值 —— 實測值一律由使用者親自量測填寫` }
      }
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { error: `項次「${no}」的建議必須是 { value: true/false, basis: 依據 } 物件` }
      }
      const { value, basis } = raw as { value?: unknown; basis?: unknown }
      if (typeof value !== 'boolean') return { error: `項次「${no}」的建議值 value 必須是 true/false` }
      if (typeof basis !== 'string' || basis.trim().length < 4) {
        return {
          error:
            `項次「${no}」缺少有效依據 —— bool 建議必須附依據(basis),` +
            '寫出你依據工具回傳的哪段內容(照片說明、查驗紀錄等)這樣建議;推論不出來就省略該項',
        }
      }
      suggestions.set(no, { value, basis: basis.trim() })
    }
  }

  // results 以項次 no 為鍵;value/needs_input/ai_suggested 是前端契約,
  // kind/group/item/unit/standard 是收件匣卡片的展示欄位(轉存檔時只取 value)。
  const results: Record<string, unknown> = {}
  let numPending = 0
  let boolSuggested = 0
  let boolPending = 0
  for (const it of items) {
    const base = { kind: it.kind, group: it.group ?? null, item: it.item, unit: it.unit ?? null, standard: it.standard ?? null }
    if (it.kind === 'bool' && suggestions.has(it.no)) {
      const s = suggestions.get(it.no)!
      // ai_basis:這筆建議憑什麼 —— 沒有記錄依據的推論,事後和猜測分不出來
      results[it.no] = { ...base, value: s.value, ai_suggested: true, ai_basis: s.basis }
      boolSuggested += 1
    } else {
      // num 項只會走到這個分支 —— value 永遠 null,檔案內沒有其他賦值路徑
      results[it.no] = { ...base, value: null, needs_input: true }
      if (it.kind === 'bool') boolPending += 1
      else numPending += 1
    }
  }

  const payload = {
    template_id: template.id, // 前端接受時據以查回完整 template,再走 createChecklistRecord
    template_title: template.title,
    template_source: template.source ?? null,
    check_date: checkDate,
    location: locationHint || null,
    // 注意:前端 createChecklistRecord 目前不寫 work_item_id(checklist_records
    // 有此欄但存檔入參沒有)—— 這裡仍帶上供收件匣展示與日後補齊。
    work_item_id: workItem?.id ?? null,
    work_item_no: workItem?.item_no ?? null,
    work_item_desc: workItem?.description ?? null,
    results,
    overall: null, // 不判定:值沒填完判定沒有意義;填完後由系統依量化標準自動判定
    note: null,
    photo_ids: input.photoIds ?? [],
    field_sources: {
      template: templateReason,
      location: locationHint ? 'photo_caption' : null,
      num_values: 'needs_input', // 實測值沒有來源 —— 一律由人填
      bool_values: boolSuggested ? 'ai_suggested_partial' : 'needs_input',
    },
  }

  const [, m, d] = checkDate.split('-')
  const summary =
    `已擬好「${template.title}」自主檢查表草稿` +
    `(${Number(m)}/${Number(d)},實測值 ${numPending} 項待你填)`

  // rationale:逐欄位交代依據 —— 讓收件的人知道哪些可信、哪些必須自己填
  const rationaleParts = [
    `範本:${templateReason}。`,
    `實測值(數值項 ${numPending} 項):一律留空待你親自量測填寫 —— 系統與 AI 都不猜實測值;` +
      '你填完後由系統依量化標準自動判定合格與否,AI 不參與判定。',
    boolSuggested
      ? `勾選項:${boolSuggested} 項為 AI 依當日照片與對話線索的建議(已逐項標示「AI 建議」),送出前請逐項確認` +
        (boolPending ? `;另 ${boolPending} 項留空待你勾選。` : '。')
      : boolPending
        ? `勾選項:${boolPending} 項全部留空待你勾選,AI 未給任何建議。`
        : '',
    locationHint ? `部位:取自當日照片說明「${locationHint}」,請確認是否正確。` : '部位:未能從當日照片取得線索,留空待填。',
    workItem ? `工項:${[workItem.item_no, workItem.description].filter(Boolean).join(' ')}。` : '',
  ].filter(Boolean)

  return { payload, summary, rationale: rationaleParts.join('\n'), numPending, boolSuggested }
}

// draft_inspection 執行:查詢一律走 userClient(RLS);service 只用來寫 agent_actions。
async function draftInspection(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  input: Record<string, unknown>,
) {
  // check_date 驗證:格式 + 回轉一致(同 draft_daily_log)
  let checkDate: string
  if (input.check_date !== undefined) {
    if (!isDate(input.check_date)) return { error: 'check_date 必須是 YYYY-MM-DD' }
    const ms = parseDateUTC(input.check_date)
    if (ms == null || formatDate(ms) !== input.check_date) return { error: 'check_date 不是有效日期' }
    checkDate = input.check_date
  } else {
    checkDate = formatDate(taipeiTodayUTC())
  }
  if (input.work_item_id !== undefined && !isUuid(input.work_item_id)) return { error: 'work_item_id 必須是 UUID' }
  if (input.template_id !== undefined && !isUuid(input.template_id)) return { error: 'template_id 必須是 UUID' }
  if (!service || !userId) return { error: '伺服器未設定,暫時無法建立草稿' }

  // 本案範本(created_at 升冪 → 挑選與平手決策確定性)
  type TemplateRow = { id: string; title: string; source: string | null; items: unknown }
  const { data: tplData, error: tErr } = await db
    .from('checklist_templates')
    .select('id, title, source, items')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (tErr) return { error: tErr.message }
  const templates = (tplData ?? []) as TemplateRow[]
  if (!templates.length) {
    // 誠實回報,不是失敗 —— agent 要能把這句話轉述給使用者
    return { note: '本案尚未建立自主檢查表範本,請先到品質管理建立範本。' }
  }

  // 工項(選填;RLS + .eq(project_id) 縱深防禦)
  let workItem: { id: string; item_no: string | null; description: string | null } | null = null
  if (input.work_item_id) {
    const { data: wi, error: wiErr } = await db
      .from('work_items')
      .select('id, item_no, description')
      .eq('project_id', projectId)
      .eq('id', input.work_item_id)
      .maybeSingle()
    if (wiErr) return { error: wiErr.message }
    if (!wi) return { error: '找不到此工項(或不屬於本案),可先用 search_boq 查正確的 work_item_id' }
    workItem = wi
  }

  // 挑範本:指定就用;否則確定性關鍵字相符;挑不出來就誠實列清單請指定
  let template: TemplateRow
  let templateReason: string
  if (input.template_id) {
    const found = templates.find((t) => t.id === input.template_id)
    if (!found) return { error: '找不到此檢查表範本(或不屬於本案)' }
    template = found
    templateReason = '你指定的範本'
  } else {
    const picked = pickChecklistTemplate(templates, workItem?.description ?? null)
    if (!picked) {
      return {
        note: '無法判斷該用哪張檢查表範本,請指定 template_id 後重試。',
        templates: templates.map((t) => ({ id: t.id, title: t.title })),
      }
    }
    template = picked.template
    templateReason = picked.reason
  }

  // 當日該工項照片(台北時區界):location 線索(caption)+ 掛照片。
  // 沒指定工項就不撈 —— 不把不相干的照片掛上檢查表。
  let locationHint: string | null = null
  let photoIds: string[] = []
  if (workItem) {
    const { data: photos, error: phErr } = await db
      .from('photos')
      .select('id, caption, taken_at')
      .eq('project_id', projectId)
      .eq('work_item_id', workItem.id)
      .gte('taken_at', `${checkDate}T00:00:00+08:00`)
      .lte('taken_at', `${checkDate}T23:59:59+08:00`)
      .order('taken_at', { ascending: true })
    if (phErr) return { error: phErr.message }
    photoIds = (photos ?? []).map((p) => p.id)
    const cap = (photos ?? []).map((p) => (p.caption || '').trim()).find((c) => c)
    if (cap) locationHint = cap.slice(0, 50)
  }

  const built = buildInspectionDraft({
    template: {
      id: template.id,
      title: template.title,
      source: template.source,
      items: (Array.isArray(template.items) ? template.items : []) as ChecklistTemplateItem[],
    },
    templateReason,
    checkDate,
    workItem,
    locationHint,
    photoIds,
    boolSuggestions: input.bool_suggestions,
  })
  if ('error' in built) return { error: built.error }

  // 唯一的寫入:agent_actions(service role)。絕不寫 checklist_records ——
  // 真正的檢查表由使用者在收件匣接受後、前端走 createChecklistRecord 建立。
  const { data: action, error: insErr } = await service
    .from('agent_actions')
    .insert({
      project_id: projectId,
      actor_user: userId,
      agent_role: 'contractor',
      kind: 'draft_inspection',
      target_table: 'checklist_records',
      summary: built.summary,
      rationale: built.rationale,
      evidence: { payload: built.payload },
    })
    .select('id')
    .single()
  if (insErr) return { error: insErr.message }

  // 回給模型的是「草稿已放入收件匣」的事實 —— 讓它據實轉述,不可宣稱檢查表已建立
  return {
    ok: true,
    agent_action_id: action.id,
    template_title: template.title,
    check_date: checkDate,
    待填實測項: built.numPending,
    AI建議勾選項: built.boolSuggested,
    照片數: photoIds.length,
    ...(templateReason !== '你指定的範本' ? { 範本挑選依據: `${templateReason}(不對可改指定 template_id 重擬)` } : {}),
    note:
      '草稿已放進使用者的草稿收件匣;檢查表尚未建立,數值實測項須由使用者親自量測填寫,' +
      '合格判定由系統於填畢後自動執行 —— 不可宣稱檢查表已建立、已合格或已判定。',
  }
}

// ── draft_submittal_review 實作(只給 supervisor) ───────────────────────────

// 待審狀態:與 submittalBall 的「待監造審定」判定一致(球在監造手上的兩態)
const PENDING_SUBMITTAL_STATUSES = ['已提送', '審核中']

async function draftSubmittalReview(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  input: Record<string, unknown>,
) {
  if (input.submittal_id !== undefined && !isUuid(input.submittal_id)) {
    return { error: 'submittal_id 必須是 UUID' }
  }
  if (!service || !userId) return { error: '伺服器未設定,暫時無法建立草稿' }

  // 1) 讀送審件(userClient RLS + .eq(project_id) 縱深防禦)。
  //    找不到/不是待審狀態 → 誠實 note,不是失敗 —— agent 要能據實轉述。
  const SUB_SELECT = 'id, submittal_no, title, category, revision, status, attachment_note, work_item_id'
  type SubRow = {
    id: string; submittal_no: string | null; title: string; category: string | null
    revision: number | null; status: string; attachment_note: string | null; work_item_id: string | null
  }
  let submittal: SubRow
  if (input.submittal_id) {
    const { data, error } = await db
      .from('submittals')
      .select(SUB_SELECT)
      .eq('project_id', projectId)
      .eq('id', input.submittal_id)
      .maybeSingle()
    if (error) return { error: error.message }
    if (!data) return { note: '找不到這筆送審(或不屬於本案/無權限)' }
    const row = data as SubRow
    if (!PENDING_SUBMITTAL_STATUSES.includes(row.status)) {
      return {
        note:
          `送審 ${[row.submittal_no, row.title].filter(Boolean).join(' ')} 目前狀態是「${row.status}」,` +
          '不是待審件(已提送/審核中),毋須擬審查意見。',
      }
    }
    submittal = row
  } else {
    // 省略 submittal_id → 挑最早提送的一件待審(submitted_date 舊→新,無日期排最後;
    // 同日以 created_at 決,平手決策確定性)
    const { data, error } = await db
      .from('submittals')
      .select(SUB_SELECT + ', submitted_date, created_at')
      .eq('project_id', projectId)
      .in('status', PENDING_SUBMITTAL_STATUSES)
      .order('submitted_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(1)
    if (error) return { error: error.message }
    const row = (data ?? [])[0] as SubRow | undefined
    if (!row) return { note: '本案目前沒有待審(已提送/審核中)的送審件。' }
    submittal = row
  }

  // 2) 相關履約需求 —— 撈法與前端 collab.js reviewSubmittal 完全一致(改要同步):
  //    approved + needs_review、七類 requirement_type、上限 60;有對應工項時把
  //    requirement_work_items 連結到該工項的需求排前面,最終取 25 筆。
  //    需求查詢失敗與前端同樣優雅降級為空清單(edge fn 會回通用要點並標「通用」)。
  const { data: reqs } = await db
    .from('requirements')
    .select('id,title,requirement_type,acceptance_criteria,evidence_requirement,status')
    .eq('project_id', projectId)
    .in('status', ['approved', 'needs_review'])
    .in('requirement_type', ['submittal', 'test', 'evidence', 'checklist', 'inspection', 'report', 'other'])
    .limit(60)
  type ReqRow = {
    id: string; title: string; requirement_type: string | null
    acceptance_criteria: string | null; evidence_requirement: string | null; status: string
  }
  let relevant = (reqs ?? []) as ReqRow[]
  if (submittal.work_item_id && relevant.length) {
    const { data: links } = await db
      .from('requirement_work_items')
      .select('requirement_id')
      .eq('work_item_id', submittal.work_item_id)
    const linkedIds = new Set((links ?? []).map((l) => l.requirement_id))
    const linked = relevant.filter((r) => linkedIds.has(r.id))
    relevant = (linked.length ? [...linked, ...relevant.filter((r) => !linkedIds.has(r.id))] : relevant).slice(0, 25)
  } else relevant = relevant.slice(0, 25)

  // 對應工項(選填;RLS + .eq(project_id) 縱深防禦)—— 形狀同前端的 workItem
  let workItem: { no: string; desc: string; unit: string } | null = null
  if (submittal.work_item_id) {
    const { data: wi } = await db
      .from('work_items')
      .select('item_no, description, unit')
      .eq('project_id', projectId)
      .eq('id', submittal.work_item_id)
      .maybeSingle()
    if (wi) workItem = { no: wi.item_no || '', desc: wi.description || '', unit: wi.unit || '' }
  }

  // 3) 呼叫既有 review-submittal edge function(反幻覺紀律在該函式,不重寫)。
  //    userClient 建立時已掛呼叫者 Authorization → invoke 原樣帶過去(同 fetch-weather)。
  let review: {
    checklist: { point?: string; basis?: string; status?: string }[]
    opinion: string
    suggested_decision: string
    caution: string
  }
  try {
    const { data, error } = await db.functions.invoke('review-submittal', {
      body: {
        submittal: {
          title: submittal.title,
          category: submittal.category,
          attachment_note: submittal.attachment_note,
          revision: submittal.revision,
        },
        work_item: workItem,
        requirements: relevant.map((r) => ({
          title: r.title,
          type: r.requirement_type,
          acceptance_criteria: r.acceptance_criteria,
          evidence_requirement: r.evidence_requirement,
          authoritative: r.status === 'approved',
        })),
      },
    })
    if (error) return { error: `AI 審查暫時無法使用:${error.message || String(error)}` }
    if (data?.error) return { error: `AI 審查暫時無法使用:${data.error}` }
    if (!data || !Array.isArray(data.checklist) || typeof data.opinion !== 'string' || typeof data.suggested_decision !== 'string') {
      return { error: 'AI 審查回傳格式不符,請稍後再試' }
    }
    review = data
  } catch (e) {
    return { error: `AI 審查暫時無法使用:${String((e as Error)?.message || e)}` }
  }

  const checklist = review.checklist
  const needSupplement = checklist.filter((c) => c?.status === '需補件').length
  const needVerify = checklist.filter((c) => c?.status === '需監造核對文件').length
  const label = [submittal.submittal_no, submittal.title].filter(Boolean).join(' ')
  const caution = typeof review.caution === 'string' ? review.caution.trim() : ''
  // rationale:優先 caution;無則以審查要點的依據摘要交代(依據只可能是傳入需求標題或「通用」)
  const bases = [...new Set(checklist.map((c) => (typeof c?.basis === 'string' ? c.basis.trim() : '')).filter(Boolean))]
  const rationale = caution
    || (bases.length ? `審查要點依據:${bases.join('、')}` : `依 ${relevant.length} 項本案履約需求與通用審查要點擬定`)

  // 4) 唯一的寫入:agent_actions(service role)。絕不碰 submittals 任何欄位 ——
  //    真正的審定由監造本人在送審頁面走既有 decideSubmittal(DB trigger 把關)。
  const { data: action, error: insErr } = await service
    .from('agent_actions')
    .insert({
      project_id: projectId,
      actor_user: userId,
      agent_role: 'supervisor', // 本工具只分發給 supervisor
      kind: 'draft_submittal_review',
      target_table: 'submittals',
      target_id: submittal.id,
      summary: `送審 ${label} 已依 ${relevant.length} 項履約需求擬好審查意見(建議:${review.suggested_decision})`,
      rationale,
      evidence: {
        payload: {
          submittal_id: submittal.id,
          submittal_no: submittal.submittal_no,
          submittal_title: submittal.title,
          checklist,
          opinion: review.opinion,
          suggested_decision: review.suggested_decision,
          caution,
        },
      },
    })
    .select('id')
    .single()
  if (insErr) return { error: insErr.message }

  // 5) 回給模型的是「草稿已放入收件匣」的事實 —— 建議判定只是建議,審定權在監造本人
  return {
    ok: true,
    agent_action_id: action.id,
    件號: submittal.submittal_no || '(無編號)',
    送審名稱: submittal.title,
    審查要點數: checklist.length,
    需補件項數: needSupplement,
    需監造核對文件項數: needVerify,
    建議判定: review.suggested_decision,
    參酌履約需求數: relevant.length,
    note:
      '審查意見草稿已放進使用者的草稿收件匣;建議判定只是建議,' +
      '審定(核准/核備/退回補正/駁回)仍需監造本人在送審頁面操作 ——' +
      '絕不可宣稱已審定、已核准或已退回,也不可替他做決定。',
  }
}

// ── 批4(任務B):raise_to 實作 ──────────────────────────────────────────────

const ROLE_LABEL: Record<AgentRole, string> = { contractor: '廠商', supervisor: '監造', owner: '機關' }

// raise_to 可關聯的單據表白名單:get_record 白名單 + 品管兩張(檢查表/試體)
const HANDOFF_TABLES = new Set([...Object.keys(RECORD_SELECTS), 'checklist_records', 'test_samples'])

async function raiseTo(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  callerRole: AgentRole | null,
  input: Record<string, unknown>,
) {
  const toRole = input.to_role
  if (typeof toRole !== 'string' || !(AGENT_ROLES as readonly string[]).includes(toRole)) {
    return { error: `to_role 必須是 ${AGENT_ROLES.join('/')} 之一` }
  }
  const subject = input.subject
  if (typeof subject !== 'string' || !subject.trim()) return { error: 'subject 必須是非空字串' }
  if (subject.length > 200) return { error: 'subject 請在 200 字內,細節放 note' }
  const note = input.note
  if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) {
    return { error: 'note 必須是 2000 字內的字串' }
  }
  const targetTable = input.target_table
  const targetId = input.target_id
  if ((targetTable === undefined) !== (targetId === undefined)) {
    return { error: 'target_table 與 target_id 必須成對提供' }
  }
  if (targetTable !== undefined) {
    if (typeof targetTable !== 'string' || !HANDOFF_TABLES.has(targetTable)) {
      return { error: `target_table 必須是白名單之一:${[...HANDOFF_TABLES].join('、')}` }
    }
    if (!isUuid(targetId)) return { error: 'target_id 必須是 UUID' }
  }
  if (!service || !userId || !callerRole) return { error: '伺服器未設定,暫時無法建立草稿' }

  const to = toRole as AgentRole
  const label = ROLE_LABEL[to]

  // 找對方：list_project_members 已依本案成員資格限縮，org_type 是唯一三方角色
  // 來源；project_role／職稱不參與交接分流。同方多人時依 RPC 的加入順序取第一位。
  const { data: members, error: mErr } = await db
    .rpc('list_project_members', { p_project: projectId })
  if (mErr) return { error: mErr.message }
  const recipient = (members ?? []).find((m) => m.org_type === to && m.user_id !== userId)
  if (!recipient) {
    return { error: `本案沒有其他「${label}」成員,無法交接。請先將對方加入專案。` }
  }

  const callerName = (members ?? []).find((m) => m.user_id === userId)?.full_name || '同案成員'
  const recipientName = recipient.full_name || `${label}成員`

  const noteText = typeof note === 'string' && note.trim() ? note.trim() : null
  const rationale = [noteText, `由 ${callerName}(${ROLE_LABEL[callerRole]})的 agent 轉來`]
    .filter(Boolean)
    .join('\n')

  // 唯一的寫入:agent_actions,落在「對方」名下(actor_user = 對方)。
  // 該表 SELECT policy 是本人 → 對方看得到、呼叫者看不到 —— 正確設計,見工具定義註解。
  const { data: action, error: insErr } = await service
    .from('agent_actions')
    .insert({
      project_id: projectId,
      actor_user: recipient.user_id,
      agent_role: to,
      kind: 'handoff',
      target_table: targetTable ?? null,
      target_id: targetId ?? null,
      summary: subject.trim(),
      rationale,
      evidence: { from_user: userId, from_role: callerRole, to_role: to, note: noteText },
    })
    .select('id')
    .single()
  if (insErr) return { error: insErr.message }

  return {
    ok: true,
    agent_action_id: action.id,
    交接對象: `${recipientName}(${label})`,
    note:
      `交接草稿已送出給 ${recipientName}(${label}),會出現在「對方」的草稿收件匣,由對方本人決定是否接手。` +
      '這筆不會出現在使用者自己的收件匣 —— 請據實告訴使用者「已送給對方」,不要叫使用者去自己的收件匣找它。',
  }
}

// ── 分派器 ───────────────────────────────────────────────────────────────────
// service / userId 只有草稿工具用得到:service 是 service role client,
// 僅用於寫 agent_actions —— 絕不可傳給任何查詢工具(查詢一律走 RLS 的 userClient)。
// role = 呼叫端(agent-run)由伺服器決定的角色,run_integrity_audit 落草稿時
// 以此填 agent_role —— 不信任模型輸入。
export function makeToolExec(
  supabase: SupabaseClient,
  projectId: string,
  service?: SupabaseClient | null,
  userId?: string,
  role?: AgentRole | null,
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
      case 'draft_inspection': return await draftInspection(supabase, projectId, service ?? null, userId, input)
      case 'draft_submittal_review': return await draftSubmittalReview(supabase, projectId, service ?? null, userId, input)
      case 'raise_to': return await raiseTo(supabase, projectId, service ?? null, userId, role ?? null, input)
      case 'run_integrity_audit': return await runIntegrityAudit(supabase, projectId, service ?? null, userId, role ?? null, input)
      default: return { error: `未知的工具:${name}` }
    }
  }
}
