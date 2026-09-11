// Agent 工具定義與角色分發(B4 由 agentTools.ts 抽出;只有定義,沒有實作)。
// ---------------------------------------------------------------------------
// 工具陣列順序固定(查詢七支在前、draft 在後)—— 這是 prompt cache 前綴
// 逐位元組穩定的前提,不可重排。每個角色的陣列都是模組層常數(只建一次),
// agentTools.test.ts 釘住順序與參考同一性。
// 白名單即紅線一的執行機制:12 支工具 = 7 支唯讀 + 5 支草稿;草稿只寫
// agent_actions、業務表零寫入(agentToolWhitelist.scan.test.ts 以原始碼掃描釘住)。

import type { ToolDef } from './agent.ts'
import type { AgentRole } from './agentPersona.ts'

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
      '查本案契約重點(含期限規則、罰則、出處條款)與已核定清單。' +
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
      '列出「球在我方(使用者所屬單位)」的待辦:未結案缺失、待審送審件、未結案 RFI、待處理估驗、逾期契約期限。' +
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
// 唯一「寫給別人」的工具:agent_actions 一筆落在對方名下(handoff,對方的私人
// 待辦)、一筆落在發起人名下(handoff_sent,紅線三的發起方留痕;B4 補上)。該表
// SELECT policy 是「本人」,所以對方那筆呼叫者看不到、自己那筆只是留痕不是待辦 ——
// 工具回傳必須把這件事講清楚,免得 agent 叫使用者去自己的收件匣「接手」它。
export const RAISE_TO_TOOL: ToolDef = {
  name: 'raise_to',
  description:
    '把一件事交給另一個角色處理,並附上你擬好的說明。' +
    '用在你判斷這件事的球應該在別人手上時(例如廠商的缺失改善完成、要請監造複查)。' +
    '這只是產生一則交接草稿給對方確認,你沒有替任何人做決定;' +
    '送出後會出現在對方的草稿收件匣;使用者自己的收件匣只會多一筆「已交接給對方」的留痕供核對,不是待辦。',
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
