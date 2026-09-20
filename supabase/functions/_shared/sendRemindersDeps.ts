// send-reminders 的真實 deps(F2 自 send-reminders/index.ts 純搬移):Supabase service client 讀庫、
// Resend HTTP API 寄信、record_ai_usage 記帳。流程本體在 sendRemindersRun.ts(單元測試以假件取代這一層)。
//
// 安全:本函式用 service role 讀庫(繞過 RLS),金鑰只存在伺服器端。跨案隔離不靠 RLS ——
//       靠每個查詢逐一 .eq('project_id', …) 綁定本案(collectOpenBallItems 內亦同),A 案的事絕不會進 B 案成員的信。
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { recordAiUsage } from './aiGate.ts'
import { maskDbError } from './publicError.ts'
import { gateVerdict } from './gatePolicy.ts'
import { collectOpenBallItems } from './ballInCourt.ts'
import type { TestSampleRow } from './agentBrief.ts'
import { REMINDER_FEATURE, SOON_DAYS } from './sendRemindersRun.ts'
import type { SendRemindersDeps, ReminderMail, SendResult } from './sendRemindersRun.ts'

export const RESEND_ENDPOINT = 'https://api.resend.com/emails'

// Resend 的 HTTP 寄信(只在非 dry 且有金鑰時被呼叫);回應不吞:失敗回狀態與內文給呼叫端記 log
export async function sendViaResend(resendKey: string, mail: ReminderMail, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const res = await fetchImpl(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, html: mail.html }),
  })
  if (res.ok) return { ok: true }
  return { ok: false, status: res.status, body: await res.text() }
}

export function supabaseReminderDeps(supabase: SupabaseClient, env: { resendKey?: string | null }): SendRemindersDeps {
  return {
    async listProjects() {
      const { data, error } = await supabase.from('projects').select('id, name')
      if (error) return { error: maskDbError('send-reminders.projects', error) }
      return { projects: (data ?? []).map((p) => ({ id: String(p.id), name: String(p.name ?? '') })) }
    },
    // 逐專案閘門:查詢失敗 fail-closed(W3-4/D-010),判定同 aiGate 的 gateVerdict;RPC 呼叫與判定在同一處
    async featureAllowed(projectId) {
      const { data, error } = await supabase.rpc('ai_feature_allowed', { p_project: projectId, p_feature: REMINDER_FEATURE })
      if (error) console.error(`ai_feature_allowed 查詢失敗(reminder.daily,專案 ${projectId},fail-closed 跳過):`, error.message)
      return gateVerdict(REMINDER_FEATURE, data as boolean | null, !!error)
    },
    collectItems: (projectId, todayUTC) => collectOpenBallItems(supabase, projectId, todayUTC, { obligationSoonDays: SOON_DAYS }),
    async listTestSamples(projectId) {
      const { data } = await supabase.from('test_samples')
        .select('id, sample_no, test_item, status, d7_due, d28_due, d7_value, d28_values')
        .eq('project_id', projectId)
      return (data ?? []) as TestSampleRow[]
    },
    async listMemberIds(projectId) {
      const { data } = await supabase.from('project_members').select('user_id').eq('project_id', projectId)
      return (data ?? []).map((m) => String(m.user_id))
    },
    async orgTypesOf(userIds) {
      const out = new Map<string, string | null>()
      const { data } = await supabase.from('profiles').select('id, org_type').in('id', userIds)
      for (const pr of data ?? []) out.set(String(pr.id), (pr.org_type as string | null) || null)
      return out
    },
    async pendingDraftCounts(projectId) {
      const { data } = await supabase.from('agent_actions')
        .select('actor_user').eq('project_id', projectId).eq('status', 'pending')
      const out = new Map<string, number>()
      for (const d of data ?? []) out.set(String(d.actor_user), (out.get(String(d.actor_user)) || 0) + 1)
      return out
    },
    async emailOf(userId) {
      const { data } = await supabase.auth.admin.getUserById(userId)
      return data?.user?.email || null
    },
    send(mail) {
      if (!env.resendKey) return Promise.resolve<SendResult>({ ok: false, status: 0, body: 'RESEND_API_KEY 未設定' })
      return sendViaResend(env.resendKey, mail)
    },
    recordUsage: ({ projectId, status, errorCode }) => recordAiUsage(supabase, {
      feature: REMINDER_FEATURE, projectId, userId: null, actor: 'system', status, errorCode: errorCode ?? null,
    }),
    log: (message, ...rest) => console.error(message, ...rest),
  }
}
