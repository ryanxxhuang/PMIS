// Supabase Edge Function: send-reminders —「你的 agent 早報」
// ---------------------------------------------------------------------------
// 每日角色化早報:掃全部專案,對每位成員依其三方角色(廠商/監造/機關)
// 產生「今天球在你手上」的個人化信件 —— 不再是全員同一份流水清單。
//   * 角色判定與 agent-run 同一份映射(_shared/agentRole.ts):只看三方 org_type。
//   * 「球在誰手上」與 agent 工具 list_my_open_items 同一份實作
//     (_shared/ballInCourt.ts collectOpenBallItems),外加試體齡期(廠商事項)。
//   * 沒有屬於這個角色的事(逾期或 7 日內到期)就不寄信給他。
//   * 內容一律確定性產生,絕不呼叫 LLM(成本不合理、寄錯無法收回)。
//   * 流程本體在 _shared/sendRemindersRun.ts(F2 起,Deno 單元測試以假件釘住角色分流／閘門／dry／寄信 payload);
//     真實 deps(Supabase、Resend、記帳)在 _shared/sendRemindersDeps.ts。這裡只剩 HTTP 入口。
//
// 部署:supabase functions deploy send-reminders --no-verify-jwt
// 秘密:supabase secrets set RESEND_API_KEY=re_...  CRON_SECRET=<自訂長亂數>
// 排程:見 supabase/cron.sql(pg_cron 每日 00:00 UTC = 台北 08:00 呼叫本函式)
//
// 安全:--no-verify-jwt 之後任何人都打得到 URL,所以一律驗 x-cron-secret 標頭;
//       本函式用 service role 讀庫(繞過 RLS),金鑰只存在伺服器端。
//       跨案隔離不靠 RLS —— 靠每個查詢逐一 .eq('project_id', …) 綁定本案
//       (collectOpenBallItems 內亦同),A 案的事絕不會進 B 案成員的信。
// 測試:POST ?dry=1 → 只回 JSON 彙整結果(每人角色/分段件數)、不寄信、不記帳
//       (沒設 RESEND_API_KEY 也能跑)。本機:真後端 e2e chain 22 以 dry=1 對隔離棧驗角色分流。

import { createClient } from 'npm:@supabase/supabase-js@2'
import { taipeiTodayUTC } from '../_shared/contractDue.ts'
import { authorizeCron, runSendReminders } from '../_shared/sendRemindersRun.ts'
import { supabaseReminderDeps } from '../_shared/sendRemindersDeps.ts'

Deno.serve(async (req) => {
  if (!authorizeCron(req, Deno.env.get('CRON_SECRET'))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service role:繞過 RLS,只在伺服器端
  )
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('REMINDER_FROM') || 'GovAgent 提醒 <onboarding@resend.dev>'
  const appUrl = Deno.env.get('APP_URL') || 'https://app.gov-agent.ai/'

  const result = await runSendReminders(supabaseReminderDeps(supabase, { resendKey }), {
    dry, todayUTC: taipeiTodayUTC(), resendConfigured: !!resendKey, from,
    agentUrl: appUrl + '#/agent', // 早報的落點是「你的 Agent」,不是提醒中心
  })
  return new Response(JSON.stringify(result.body, null, 2), {
    status: result.status, headers: { 'Content-Type': 'application/json' },
  })
})
