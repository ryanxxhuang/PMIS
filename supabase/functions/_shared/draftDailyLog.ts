// 廠商 Agent:施工日誌草稿 draft_daily_log(B4 由 agentTools.ts 抽出;P6b-2 改為產生現場文書草稿)。
// ---------------------------------------------------------------------------
// 與照片起稿同一條路(agentFieldDocDraft.ts):用 fieldDocDraft.buildDailyLogDraft 湊內容、writeDraftDocument 寫入
// 該日施工日誌文件的 AI 版本,agent_actions 的 target 是那份 field_documents(target_id=文件)。
// 不寫 daily_logs——事實表只由簽署 RPC 落庫;使用者在施工日誌頁(或收件匣填數量)審核、簽署後才算正式紀錄。
// 數量誠實原則由共用 builder 保證:告示板沒寫清楚的數量一律 pending,照片只證明有施作。
// 讀一律走 userClient(RLS);寫(文件、AI 版本、agent_actions)只用 service client,且只在設計允許的範圍。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { toolDate } from './agentToolCommon.ts'
import { supabaseDraftRepo } from './fieldDocRepo.ts'
import { agentDraftDailyLog } from './agentFieldDocDraft.ts'

export async function draftDailyLog(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  input: Record<string, unknown>,
) {
  const d = toolDate(input.log_date, 'log_date')
  if ('error' in d) return d
  // service role 未設定 → 查詢工具照常可用,只有草稿功能誠實停用(見 agent-run)
  if (!service || !userId) return { error: '伺服器未設定,暫時無法建立草稿' }

  const out = await agentDraftDailyLog({ repo: supabaseDraftRepo(db, service, projectId), userId, date: d.date })
  if ('error' in out || 'note' in out) return out
  const { written, draft, photoCount } = out
  const pending = draft.required_fields.filter((k) => draft.field_sources[k]?.status === 'pending').length
  const items = Object.keys((draft.content as { items?: Record<string, unknown> }).items ?? {}).length
  // 回給模型的是「文件草稿已建立／更新」的事實 —— 讓它據實轉述,不可宣稱日誌已建立、已簽署或已填好數量
  const noteByAction: Record<string, string> = {
    created: '已建立該日施工日誌的文件草稿(AI 版本),也放進使用者的草稿收件匣;日誌尚未成立,須由使用者親自填寫各工項數量、審核並簽署。',
    version_added: '已在該日施工日誌文件草稿新增一個 AI 版本,也放進草稿收件匣;日誌尚未成立,須由使用者親自填寫數量、審核並簽署。',
    unchanged: '該日施工日誌草稿的內容與目前版本相同,未新增版本;請使用者到施工日誌頁審核。',
    suggested: '該日施工日誌已有使用者編修過的版本,新內容只作為建議放在施工日誌頁,由使用者決定是否套用;不可宣稱已更新日誌。',
  }
  return {
    ok: true,
    agent_action_id: written.agent_action_id,
    document_id: written.document_id,
    version_no: written.version_no,
    log_date: d.date,
    工項數: items,
    照片數: photoCount,
    待補欄位數: pending,
    note: noteByAction[written.action],
  }
}
