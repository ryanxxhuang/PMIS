// Supabase Edge Function: agent-run
// ---------------------------------------------------------------------------
// 多輪 agent(批1 查詢;批3 加 field 角色的 draft_daily_log):收本案事實快照 +
// 使用者訊息,讓 Claude 自行調閱本案資料後回答。查詢工具只讀不寫;
// draft_daily_log 只寫 agent_actions 草稿收件匣 —— 不寫任何業務資料表。
// 權限:verify_jwt 預設開啟;函式內再以呼叫者 JWT 建 userClient(getUser +
// RLS 讀 projects 證明成員資格),所有工具查詢都走這個 client → 自動套 RLS。
// 角色由伺服器決定(project_memberships / my_org_type),不信任 client 傳值。
//
// 部署:supabase functions deploy agent-run --use-api(colima 下必須 --use-api)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, jsonResponse as json } from '../_shared/claude.ts'
import { claudeAgent } from '../_shared/agent.ts'
import { personaSystem } from '../_shared/agentPersona.ts'
import type { AgentRole } from '../_shared/agentPersona.ts'
import { makeToolExec, toolsForRole } from '../_shared/agentTools.ts'
// 專案角色 → agent persona 的映射抽在 _shared/agentRole.ts(send-reminders 共用;
// 前端 src/lib/agentRole.js 另有顯示用副本,三處值域必須同步)。
// (規格原訂讀 project_members.job_role;該欄位不存在 —— 專案內職務的實際來源是
//  P0-02 的 project_memberships.project_role,映射依其 check constraint 全值域。)
import { ROLE_BY_PROJECT_ROLE, agentRoleOf } from '../_shared/agentRole.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !anonKey) return json({ error: '伺服器未設定 Supabase 環境變數' }, 500)
    // service role:只給 draft_daily_log 寫 agent_actions 用(該表 authenticated 無
    // 寫入權)。缺 SUPABASE_SERVICE_ROLE_KEY 不整支失敗 —— 查詢工具照常可用,
    // 只有 draft_daily_log 會回「伺服器未設定,暫時無法建立草稿」。
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const serviceClient = serviceKey
      ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null

    const body = await req.json().catch(() => null)
    const projectId = body?.project_id
    const message = body?.message
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
      return json({ error: '缺少有效的 project_id' }, 400)
    }
    if (typeof message !== 'string' || !message.trim()) {
      return json({ error: '缺少 message' }, 400)
    }

    // -- 呼叫者 JWT 建 client(照 extract-requirements 的模式)-----------------
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData } = await userClient.auth.getUser()
    const user = userData?.user
    if (!user) return json({ error: '未登入' }, 401)

    // RLS-scoped read 驗成員資格:看不到這個專案 = 不是成員
    const { data: project, error: projectError } = await userClient
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle()
    if (projectError) return json({ error: projectError.message }, 500)
    if (!project) return json({ error: '找不到專案或無權限' }, 404)

    // -- 角色由伺服器決定 ------------------------------------------------------
    const { data: membership } = await userClient
      .from('project_memberships')
      .select('project_role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle()
    let role: AgentRole | null = membership?.project_role
      ? ROLE_BY_PROJECT_ROLE[membership.project_role as string] ?? null
      : null
    if (!role) {
      // 專案內未設職務 → 以組織別映射(contractor→field;qc 只能來自明確職務設定)
      const { data: orgType } = await userClient.rpc('my_org_type')
      role = agentRoleOf(null, typeof orgType === 'string' ? orgType : null)
    }

    // -- history 淨化:只收純文字、最多 20 則、每則 ≤ 4000 字元 ------------------
    let history = Array.isArray(body?.history)
      ? (body.history as unknown[])
          .filter(
            (m): m is { role: 'user' | 'assistant'; content: string } =>
              !!m && typeof m === 'object' &&
              ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
              typeof (m as { content?: unknown }).content === 'string',
          )
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
      : undefined
    // history 來自前端(不可信)。Anthropic Messages API 要求 messages 第一則必須
    // 是 user role——若淨化後(截斷/過濾可能移掉開頭的 user 訊息)以 assistant
    // 開頭,整個請求會 400。丟棄開頭連續的 assistant 訊息,確保非空 history
    // 一律以 user 開頭。
    while (history && history.length > 0 && history[0].role === 'assistant') {
      history = history.slice(1)
    }

    const result = await claudeAgent({
      system: personaSystem(role),
      tools: toolsForRole(role),
      exec: makeToolExec(userClient, projectId, serviceClient, user.id, role),
      userMessage: message,
      facts: body?.facts,
      history,
    })

    // steps 只回摘要(tool/ok/ms),工具輸出不回前端 —— 前端只該看到最終回答
    return json({
      text: result.text,
      role,
      steps: result.steps.map(({ tool, ok, ms }) => ({ tool, ok, ms })),
      usage: result.usage,
      stop_reason: result.stopReason,
      ...(result.error ? { error: result.error } : {}),
    }, 200)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
