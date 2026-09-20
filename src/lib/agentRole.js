// Agent 身分只跟專案三方角色一致。現場、品管是廠商內部分工，不是系統角色，
// 也不得拿來決定授權；廠商 Agent 同時提供現場與品管工作工具。
export const AGENT_ROLES = ['contractor', 'supervisor', 'owner']

const ROLE_BY_ORG_TYPE = {
  contractor: 'contractor',
  supervisor: 'supervisor',
  owner: 'owner',
}

export function agentRoleOf(orgType) {
  return ROLE_BY_ORG_TYPE[orgType] || 'contractor'
}

// 顯示用解析。權限與伺服器 Agent 身分都以三方 org_type 為準。
export function displayAgentRole({ orgType }) {
  return agentRoleOf(orgType)
}

export const AGENT_LABEL = {
  contractor: { name: '廠商 Agent', desc: '施工日誌、數量、品質、試驗、缺失與工安' },
  supervisor: { name: '監造 Agent', desc: '送審審查、查驗覆核、估驗對量' },
  owner: { name: '機關 Agent', desc: '期程罰則、法定期限、勾稽稽核' },
}

// agent_actions.kind → 使用者看得懂的草稿種類(未知 kind 原樣顯示,不擋新種類)。
// 放這裡而不放 Agent.jsx:Dashboard 的「AI 今日已代辦」卡也要用同一份標籤,
// 從頁面 chunk 引會把整個 /agent 頁拖進首頁 bundle(路由是 lazy 的)。
export const KIND_LABEL = {
  draft_daily_log: '日誌草稿',
  draft_inspection: '查驗草稿',
  // 照片上傳起稿(Edge draft-field-documents)的兩種留痕:新版本＝文書草稿;已有人工版本時不覆寫、只留欄位建議。
  // 沒有這兩個對映,收件匣會直接顯示內部代號 draft_field_document／suggest_field_update。
  draft_field_document: '照片起稿文書',
  suggest_field_update: '欄位修改建議',
  draft_submittal_review: '審查意見',
  audit_note: '稽核提示',
  handoff: '交接事項',
  // 發起方的留痕(B4):對方那筆是 handoff、自己這筆是 handoff_sent。
  // 沒有這兩個對映,發起人的收件匣會直接顯示原始字串 handoff_sent。
  handoff_sent: '已送出交接',
}
export const KIND_COLOR = {
  draft_daily_log: 'blue',
  draft_inspection: 'green',
  draft_field_document: 'blue', // 與對話起稿的日誌草稿同色:都是「AI 擬好一份文書等你覆核」
  suggest_field_update: 'amber', // 不是新文書,是對既有人工版本的建議,視覺上要與草稿分得開
  draft_submittal_review: 'amber',
  audit_note: 'purple',
  handoff: 'red', // 球轉到你手上,視覺上要跳出來
  handoff_sent: 'slate', // 自己送出去的存查紀錄,球不在自己手上,不該搶注意力
}
