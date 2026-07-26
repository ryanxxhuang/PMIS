// Supabase Edge Function: send-reminders —「你的 agent 早報」
// ---------------------------------------------------------------------------
// 每日角色化早報:掃全部專案,對每位成員依其 agent 角色(現場/品管/監造/機關)
// 產生「今天球在你手上」的個人化信件 —— 不再是全員同一份流水清單。
//   * 角色判定與 agent-run 同一份映射(_shared/agentRole.ts):
//     project_memberships.project_role 優先,對不到用 profiles.org_type fallback。
//   * 「球在誰手上」與 agent 工具 list_my_open_items 同一份實作
//     (_shared/agentTools.ts collectOpenBallItems),外加試體齡期(品管)。
//   * 沒有屬於這個角色的事(逾期或 7 日內到期)就不寄信給他。
//   * 內容一律確定性產生,絕不呼叫 LLM(成本不合理、寄錯無法收回)。
//
// 部署:supabase functions deploy send-reminders --no-verify-jwt
// 秘密:supabase secrets set RESEND_API_KEY=re_...  CRON_SECRET=<自訂長亂數>
// 排程:見 supabase/cron.sql(pg_cron 每日 00:00 UTC = 台北 08:00 呼叫本函式)
//
// 安全:--no-verify-jwt 之後任何人都打得到 URL,所以一律驗 x-cron-secret 標頭;
//       本函式用 service role 讀庫(繞過 RLS),金鑰只存在伺服器端。
//       跨案隔離不靠 RLS —— 靠每個查詢逐一 .eq('project_id', …) 綁定本案
//       (collectOpenBallItems 內亦同),A 案的事絕不會進 B 案成員的信。
// 測試:POST ?dry=1 → 只回 JSON 彙整結果(每人角色/分段件數)、不寄信
//       (沒設 RESEND_API_KEY 也能跑)。

import { createClient } from 'npm:@supabase/supabase-js@2'
import { taipeiTodayUTC, formatDate } from '../_shared/contractDue.ts'
import { agentRoleOf, AGENT_NAME } from '../_shared/agentRole.ts'
import type { AgentRole } from '../_shared/agentPersona.ts'
import { collectOpenBallItems } from '../_shared/agentTools.ts'
import type { OpenBallItem } from '../_shared/agentTools.ts'
import {
  SOON_DAYS, testSampleItems, itemsForRecipient, splitBrief, shouldSendBrief,
  briefSubject, renderBriefEmail,
} from '../_shared/agentBrief.ts'

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service role:繞過 RLS,只在伺服器端
  )
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('REMINDER_FROM') || 'PMIS 提醒 <onboarding@resend.dev>'
  const appUrl = Deno.env.get('APP_URL') || 'https://ryanxxhuang.github.io/PMIS/'
  const agentUrl = appUrl + '#/agent' // 早報的落點是「你的 Agent」,不是提醒中心
  const todayUTC = taipeiTodayUTC()

  const { data: projects, error: pErr } = await supabase.from('projects')
    .select('id, name, end_date, award_date, notice_date, commencement_date')
  if (pErr) return new Response(JSON.stringify({ error: pErr.message }), { status: 500 })

  // 跨專案快取:email 與 org_type 都是「使用者層」資料,查一次就好
  const emailCache = new Map<string, string | null>()
  const orgTypeCache = new Map<string, string | null>()
  const results: unknown[] = []

  for (const p of projects || []) {
    // ── 1) 本案「球在誰手上」全清單(與 list_my_open_items 同一份實作) ────────
    const collected = await collectOpenBallItems(supabase, p.id, todayUTC, { obligationSoonDays: SOON_DAYS })
    if ('error' in collected) {
      results.push({ project: p.name, error: collected.error })
      continue
    }
    // 試體齡期(7/28 天)→ 廠商陣營、品管優先(工安缺失已併入 defects 引擎
    // domain='safety',collectOpenBallItems 會帶出來;舊版另查 safety_records
    // 的路徑在統一缺失引擎後已是死碼,不再保留)
    const { data: samples } = await supabase.from('test_samples')
      .select('id, sample_no, test_item, status, d7_due, d28_due, d7_value, d28_values')
      .eq('project_id', p.id)
    const allItems: OpenBallItem[] = [...collected.items, ...testSampleItems(samples || [], todayUTC)]

    // ── 2) 成員與角色:memberships(明確職務)∪ legacy project_members ────────
    const [{ data: memberships }, { data: legacyMembers }] = await Promise.all([
      supabase.from('project_memberships').select('user_id, project_role').eq('project_id', p.id),
      supabase.from('project_members').select('user_id').eq('project_id', p.id),
    ])
    const roleByUser = new Map<string, string | null>() // user_id → project_role|null
    for (const m of legacyMembers || []) roleByUser.set(m.user_id, null)
    for (const m of memberships || []) roleByUser.set(m.user_id, m.project_role)

    // org_type fallback(profiles)只查快取沒有的
    const missing = [...roleByUser.keys()].filter((id) => !orgTypeCache.has(id))
    if (missing.length) {
      const { data: profs } = await supabase.from('profiles').select('id, org_type').in('id', missing)
      for (const pr of profs || []) orgTypeCache.set(pr.id, pr.org_type || null)
      for (const id of missing) if (!orgTypeCache.has(id)) orgTypeCache.set(id, null)
    }

    const agentRoleByUser = new Map<string, AgentRole>()
    for (const [uid, projectRole] of roleByUser) {
      agentRoleByUser.set(uid, agentRoleOf(projectRole, orgTypeCache.get(uid)))
    }
    const rolesPresent = new Set(agentRoleByUser.values())

    // ── 3) AI 草稿收件匣:本案各成員 pending 筆數(一次查完) ──────────────────
    const { data: drafts } = await supabase.from('agent_actions')
      .select('actor_user').eq('project_id', p.id).eq('status', 'pending')
    const draftCount = new Map<string, number>()
    for (const d of drafts || []) draftCount.set(d.actor_user, (draftCount.get(d.actor_user) || 0) + 1)

    // ── 4) 逐成員組信、寄信(沒有屬於他的事就不寄) ──────────────────────────
    const recipients: unknown[] = []
    let sent = 0
    for (const [uid, role] of agentRoleByUser) {
      const mine = itemsForRecipient(allItems, role, rolesPresent)
      const sections = splitBrief(mine, todayUTC)
      const pendingDrafts = draftCount.get(uid) || 0
      const shouldSend = shouldSendBrief(sections)

      let email: string | null = null
      if (shouldSend) {
        if (!emailCache.has(uid)) {
          const { data } = await supabase.auth.admin.getUserById(uid)
          emailCache.set(uid, data?.user?.email || null)
        }
        email = emailCache.get(uid) || null
        if (!dry && email && resendKey) {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from, to: [email],
              subject: briefSubject(role, p.name, sections),
              html: renderBriefEmail({ role, projectName: p.name, todayUTC, sections, pendingDrafts, agentUrl }),
            }),
          })
          if (res.ok) sent += 1
          else console.error(`Resend failed for project ${p.id} user ${uid}:`, res.status, await res.text())
        }
      }

      recipients.push({
        user_id: uid, email, role, agent: AGENT_NAME[role],
        overdue: sections.overdue.length, soon: sections.dueSoon.length,
        pending: sections.pending.length, drafts_pending: pendingDrafts,
        should_send: shouldSend,
        ...(dry && shouldSend ? { sections } : {}),
      })
    }

    results.push({
      project: p.name,
      items_total: allItems.length,
      emails_sent: sent,
      recipients,
    })
  }

  return new Response(JSON.stringify({ dry, date: formatDate(todayUTC), projects: results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
})
