// Agent 工具層分派器(批1 唯讀查詢七支;批3 draft_daily_log;批4 run_integrity_audit
// + draft_inspection + raise_to;監造送審審查 draft_submittal_review)。
// ---------------------------------------------------------------------------
// B4 拆檔後本檔只剩 makeToolExec;各單元的歸屬:
//   * agentToolDefs.ts      工具定義 + toolsForRole(順序 = prompt cache 前綴,不可重排)
//   * agentQueryTools.ts    唯讀查詢七支(含 get_record 的 RECORD_SELECTS 白名單)
//   * ballInCourt.ts        球權判定 + collectOpenBallItems(send-reminders 共用)
//   * draftDailyLog.ts / draftInspection.ts / draftSubmittalReview.ts / raiseTo.ts
//   * integrityAuditTool.ts run_integrity_audit + fetchAllRows(分頁抓齊)
//   * agentToolCommon.ts    共用驗證 / toolError 遮罩 / capList
// 七支查詢工具全部只讀不寫;草稿類工具(draft_daily_log / draft_inspection /
// draft_submittal_review / raise_to / run_integrity_audit 落稿)只寫 agent_actions(AI 草稿收件匣,系統
// 管理表)—— 絕不寫 daily_logs 等任何業務資料表。真正的業務寫入發生在使用者於
// 收件匣按「接受」之後,由前端走既有 store action 完成,既有 RLS / guard
// trigger 全部照常生效。
// 權限模型:所有業務查詢都走「呼叫者 JWT 建的 userClient」→ 自動套 RLS;
// 但每個查詢仍逐一 .eq('project_id', …) 綁定本案 —— 縱深防禦,不單靠 RLS。
// service role client 只用於寫 agent_actions(該表 authenticated 無寫入權),
// 絕不傳給任何查詢 —— 見 makeToolExec 的參數說明。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ToolExec } from './agent.ts'
import type { AgentRole } from './agentPersona.ts'
import {
  searchBoq, listDailyLogs, getValuation, getRequirements, listMyOpenItems, findEvidence, getRecord,
} from './agentQueryTools.ts'
import { draftDailyLog } from './draftDailyLog.ts'
import { draftInspection } from './draftInspection.ts'
import { draftSubmittalReview } from './draftSubmittalReview.ts'
import { raiseTo } from './raiseTo.ts'
import { runIntegrityAudit } from './integrityAuditTool.ts'

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
