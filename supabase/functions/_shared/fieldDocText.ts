// 監造日誌「廠商施工情形」與「施工日誌收件情形」的確定性組字(P3a):Edge 起稿(buildSupervisorLogDraft)
// 與監造日誌頁的「引用同日施工日誌」都走這一支——同一條規則只有一份實作,前端由
// src/lib/fieldDocText.js re-export(與 photoMatch.ts 同一慣例:零 import、無 Deno API,Vite 直接吃 .ts)。
//
// 規則(設計 §3.1 第 7b 步):只引用「已簽署／已提送／已收件」的施工日誌文件版本;摘要=施工概況＋
// 有數量的工項清單,結尾標「(依廠商施工日誌 vN)」;收件情形是該文件現況的快照(沒有文件=status:'none')。
// 這裡不決定「可不可以引用」(狀態由呼叫端依 FORMAL_DAILY_LOG_STATUSES 判),只負責把已決定引用的內容組成文字。

export const FORMAL_DAILY_LOG_STATUSES: readonly string[] = ['signed', 'submitted', 'received']

export type FormalDailyLogLike = {
  document_id: string
  status: string
  version_no: number
  content: { work_summary?: unknown; items?: unknown } | null
  signed_at: string | null
  submitted_at: string | null
  received_at: string | null
  returned_at: string | null
}
export type WorkItemLabelLike = { item_no?: string | null; description?: string | null; unit?: string | null }

const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const label = (wi: WorkItemLabelLike) => [wi.item_no, wi.description].filter(Boolean).join(' ')

export function isFormalDailyLog(log: { status?: unknown } | null | undefined): boolean {
  return !!log && FORMAL_DAILY_LOG_STATUSES.includes(String(log.status))
}

// 同日施工日誌文件版本的來源字串(field_sources.source)
export const formalDailyLogSource = (log: Pick<FormalDailyLogLike, 'document_id' | 'version_no'>) =>
  `field_document:${log.document_id}:v${log.version_no}`

// 施工概況＋有數量的工項 → 一段文字;概況與數量都沒有回 null(呼叫端標 pending,不寫「無」)
export function composeContractorSummary(formal: Pick<FormalDailyLogLike, 'version_no' | 'content'>, wiById: Map<string, WorkItemLabelLike>): string | null {
  const summary = textOrNull(formal.content?.work_summary)
  const itemsObj = formal.content?.items && typeof formal.content.items === 'object'
    ? formal.content.items as Record<string, { qty_today?: unknown; unit?: unknown; description?: unknown; item_no?: unknown }>
    : {}
  const qtyParts = Object.entries(itemsObj)
    .filter(([, v]) => v && typeof v === 'object' && typeof v.qty_today === 'number')
    .map(([id, v]) => {
      const wi = wiById.get(id)
      const name = wi ? label(wi) : [textOrNull(v.item_no), textOrNull(v.description)].filter(Boolean).join(' ') || id
      return `${name} ${v.qty_today}${textOrNull(v.unit) ?? wi?.unit ?? ''}`
    })
  const text = [summary, qtyParts.length ? `數量:${qtyParts.join('、')}` : null].filter(Boolean).join(';')
  return text ? `${text}(依廠商施工日誌 v${formal.version_no})` : null
}

// 收件情形快照:文件現況(任何狀態都記錄,讓監造看得到「廠商日誌還在草稿／已退回」);沒有文件=none
export function dailyLogReceipt(log: FormalDailyLogLike | null): Record<string, unknown> {
  return log
    ? { document_id: log.document_id, version_no: log.version_no, status: log.status,
        signed_at: log.signed_at, submitted_at: log.submitted_at, received_at: log.received_at, returned_at: log.returned_at }
    : { status: 'none' }
}
