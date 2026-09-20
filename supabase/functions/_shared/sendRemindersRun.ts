// 「你的 agent 早報」(send-reminders)的流程本體(F2 自 send-reminders/index.ts 純搬移)。
// ---------------------------------------------------------------------------
// 與 HTTP 入口、Supabase 連線、Resend 分離,所有外部效應經 SendRemindersDeps 注入,
// 讓 Deno 單元測試(sendRemindersRun.deno.test.ts)以假件釘住這些行為:
//   * 角色分流:每位成員只收自己陣營的事(廠商／監造／機關),待補設定三方都看;
//   * 跨案隔離:A 案成員的信裡絕不出現 B 案的事(每個查詢逐案綁定,這裡以逐案 collectItems 保證);
//   * 逐專案閘門 reminder.daily:查詢失敗與明確 false 都跳過(fail-closed),非 dry 記一筆 blocked;
//   * 「沒有屬於這個角色的事就不寄」:只有逾期或 7 日內到期才寄,無期限與待補設定只搭便車;
//   * dry=1:不查 email 以外的外部效應——不寄、不記帳,回應附 sections 供人工核對;
//   * 非 dry:有 RESEND_API_KEY 才真的寄;寄出 ≥1 封才記一筆 ok;Resend 失敗記 log、不計入 emails_sent;
//   * email 與 org_type 是使用者層資料,跨專案只查一次。
// 內容一律確定性產生,絕不呼叫 LLM(理由見 agentBrief.ts 檔頭)。HTTP 入口與真實 deps 見
// send-reminders/index.ts 與 _shared/sendRemindersDeps.ts。

import type { AgentRole } from './agentPersona.ts'
import { agentRoleOf, AGENT_NAME } from './agentRole.ts'
import type { GateVerdict } from './gatePolicy.ts'
import type { OpenBallItem } from './ballInCourt.ts'
import { formatDate } from './contractDue.ts'
import {
  SOON_DAYS, testSampleItems, itemsForRecipient, splitBrief, shouldSendBrief,
  briefSubject, renderBriefEmail,
} from './agentBrief.ts'
import type { TestSampleRow, BriefSections } from './agentBrief.ts'

export const REMINDER_FEATURE = 'reminder.daily'

export type ReminderProject = { id: string; name: string }
export type ReminderMail = { from: string; to: string; subject: string; html: string }
export type SendResult = { ok: true } | { ok: false; status: number; body: string }

export interface SendRemindersDeps {
  // 全部專案(service role 掃全庫;跨案隔離靠之後每個查詢逐案綁定)
  listProjects(): Promise<{ projects: ReminderProject[] } | { error: { message: string; code: string } }>
  // reminder.daily 的閘門判定:真實 deps 在呼叫 ai_feature_allowed 的同一處經 gatePolicy.gateVerdict 判定
  // (D-010 fail-closed;判定點與 RPC 呼叫點釘在同一檔,gatePolicy.test.ts 掃描),這裡只消費結果
  featureAllowed(projectId: string): Promise<GateVerdict>
  // 本案「球在誰手上」全清單(與 list_my_open_items 同一份收集器);逐案綁定是跨案隔離的唯一保證
  collectItems(projectId: string, todayUTC: number): Promise<{ items: OpenBallItem[] } | { error: string }>
  listTestSamples(projectId: string): Promise<TestSampleRow[]>
  // AUTHORIZATION:project_members 管存取
  listMemberIds(projectId: string): Promise<string[]>
  // profiles.org_type 管角色(project_memberships/project_role 是身分快照,不得用來分流)
  orgTypesOf(userIds: string[]): Promise<Map<string, string | null>>
  // agent_actions pending 筆數(actor_user → 筆數)
  pendingDraftCounts(projectId: string): Promise<Map<string, number>>
  emailOf(userId: string): Promise<string | null>
  // 只在 !dry 且有寄信設定時才會被呼叫
  send(mail: ReminderMail): Promise<SendResult>
  // 用量記帳(actor=system、user null);dry 一律不呼叫
  recordUsage(args: { projectId: string; status: 'ok' | 'blocked'; errorCode?: string }): Promise<void>
  log(message: string, ...rest: unknown[]): void
}

export interface SendRemindersOptions {
  dry: boolean
  todayUTC: number
  // 有 RESEND_API_KEY 才會真的寄;沒有也能跑(dry 或只彙整)
  resendConfigured: boolean
  from: string
  agentUrl: string
}

export type RecipientReport = {
  user_id: string
  email: string | null
  role: AgentRole
  agent: string
  overdue: number
  soon: number
  pending: number
  setup: number
  drafts_pending: number
  should_send: boolean
  sections?: BriefSections
}
export type ProjectReport =
  | { project: string; skipped: string }
  | { project: string; error: string }
  | { project: string; items_total: number; emails_sent: number; recipients: RecipientReport[] }

export type SendRemindersResult =
  | { status: 200; body: { dry: boolean; date: string; projects: ProjectReport[] } }
  | { status: 500; body: { error: string; code: string } }

// --no-verify-jwt 之後任何人都打得到 URL,所以一律驗 x-cron-secret 標頭;沒設密鑰=一律拒絕
export function authorizeCron(req: Request, secret: string | null | undefined): boolean {
  if (!secret) return false
  return req.headers.get('x-cron-secret') === secret
}

export async function runSendReminders(deps: SendRemindersDeps, opts: SendRemindersOptions): Promise<SendRemindersResult> {
  const { dry, todayUTC, resendConfigured, from, agentUrl } = opts
  const listed = await deps.listProjects()
  if ('error' in listed) {
    // 回應只有 pg_cron / 營運人員看得到,但仍不放 PostgREST 原文(deps 已以 maskDbError 遮罩成 PublicError,原文進 log)
    const pub = listed.error
    return { status: 500, body: { error: pub.message, code: pub.code } }
  }

  // 跨專案快取:email 與 org_type 都是「使用者層」資料,查一次就好
  const emailCache = new Map<string, string | null>()
  const orgTypeCache = new Map<string, string | null>()
  const results: ProjectReport[] = []

  for (const p of listed.projects) {
    // ── 0) 批 B:reminder.daily 功能閘門(逐專案)──────────────────────────────
    // 查詢失敗 fail-closed 跳過本專案(W3-4/D-010,判定同 gateVerdict);回 false → 跳過不寄信。
    // 兩者都記 blocked(actor=system、user null);dry=1 模式一律不記帳,避免測試污染用量資料。
    const verdict = await deps.featureAllowed(p.id)
    if (!verdict.allow) {
      if (verdict.code === 'gate_unavailable') deps.log(`ai_feature_allowed 無法判定(reminder.daily,專案 ${p.id},fail-closed 跳過)`)
      if (!dry) await deps.recordUsage({ projectId: p.id, status: 'blocked', errorCode: verdict.code })
      results.push({
        project: p.name,
        skipped: verdict.code === 'gate_unavailable' ? 'reminder.daily 開關暫時無法確認(fail-closed 跳過)' : 'reminder.daily 未啟用',
      })
      continue
    }

    // ── 1) 本案「球在誰手上」全清單(與 list_my_open_items 同一份實作) ────────
    const collected = await deps.collectItems(p.id, todayUTC)
    if ('error' in collected) {
      results.push({ project: p.name, error: collected.error })
      continue
    }
    // 試體齡期(7/28 天)→ 廠商陣營
    const samples = await deps.listTestSamples(p.id)
    const allItems: OpenBallItem[] = [...collected.items, ...testSampleItems(samples, todayUTC)]

    // ── 2) AUTHORIZATION:project_members 管存取,profiles.org_type 管角色 ─────────
    const memberIds = await deps.listMemberIds(p.id)
    const missing = memberIds.filter((id) => !orgTypeCache.has(id))
    if (missing.length) {
      const found = await deps.orgTypesOf(missing)
      for (const id of missing) orgTypeCache.set(id, found.get(id) ?? null)
    }
    const agentRoleByUser = new Map<string, AgentRole>()
    for (const uid of memberIds) agentRoleByUser.set(uid, agentRoleOf(orgTypeCache.get(uid)))

    // ── 3) AI 草稿收件匣:本案各成員 pending 筆數 ──────────────────────────────
    const draftCount = await deps.pendingDraftCounts(p.id)

    // ── 4) 逐成員組信、寄信(沒有屬於他的事就不寄) ──────────────────────────
    const recipients: RecipientReport[] = []
    let sent = 0
    for (const [uid, role] of agentRoleByUser) {
      const mine = itemsForRecipient(allItems, role)
      const sections = splitBrief(mine, todayUTC)
      const pendingDrafts = draftCount.get(uid) || 0
      const shouldSend = shouldSendBrief(sections)

      let email: string | null = null
      if (shouldSend) {
        if (!emailCache.has(uid)) emailCache.set(uid, await deps.emailOf(uid))
        email = emailCache.get(uid) || null
        if (!dry && email && resendConfigured) {
          const res = await deps.send({
            from, to: email,
            subject: briefSubject(role, p.name, sections),
            html: renderBriefEmail({ role, projectName: p.name, todayUTC, sections, pendingDrafts, agentUrl }),
          })
          if (res.ok) sent += 1
          else deps.log(`Resend failed for project ${p.id} user ${uid}:`, res.status, res.body)
        }
      }

      recipients.push({
        user_id: uid, email, role, agent: AGENT_NAME[role],
        overdue: sections.overdue.length, soon: sections.dueSoon.length,
        pending: sections.pending.length, setup: sections.setupPending.length, drafts_pending: pendingDrafts,
        should_send: shouldSend,
        ...(dry && shouldSend ? { sections } : {}),
      })
    }

    // 批 B:有實際寄出信件才記一筆 ok(actor=system、token/cost 全 0——確定性早報不打 LLM);dry 不記帳
    if (!dry && sent > 0) await deps.recordUsage({ projectId: p.id, status: 'ok' })

    results.push({ project: p.name, items_total: allItems.length, emails_sent: sent, recipients })
  }

  return { status: 200, body: { dry, date: formatDate(todayUTC), projects: results } }
}

export { SOON_DAYS }
