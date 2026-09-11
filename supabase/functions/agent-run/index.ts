// Supabase Edge Function: agent-run
// ---------------------------------------------------------------------------
// 多輪三方 agent：收本案事實快照 +
// 使用者訊息,讓 Claude 自行調閱本案資料後回答。查詢工具只讀不寫;
// draft_daily_log 只寫 agent_actions 草稿收件匣 —— 不寫任何業務資料表。
// 權限:verify_jwt 預設開啟;函式內再以呼叫者 JWT 建 userClient(getUser +
// RLS 讀 projects 證明成員資格),所有工具查詢都走這個 client → 自動套 RLS。
// 角色由伺服器依三方 org_type 決定,不信任 client 傳值。現場／品管只是
// 廠商內部分工,不讀 project_memberships.project_role。
//
// 部署:supabase functions deploy agent-run --use-api(colima 下必須 --use-api)

import { cors, jsonResponse as json, MODELS, exceptionResponse } from '../_shared/claude.ts'
import { claudeAgent, stableStringify } from '../_shared/agent.ts'
// 批 B 閘門與記帳:身分/成員資格/功能開關(D-010 fail-closed)全走 openAiGate,
// 記帳走同一支低階 recordAiUsage(紅線:記帳失敗絕不影響回應)。B1 之前這裡
// 手抄了一份閘門流程(M-1),fail-closed 判定因此寫在兩處;現在只剩 aiGate 一處。
import { openAiGate, recordAiUsage } from '../_shared/aiGate.ts'
import { personaSystem } from '../_shared/agentPersona.ts'
import type { AgentRole } from '../_shared/agentPersona.ts'
import { makeToolExec, toolsForRole } from '../_shared/agentTools.ts'
import { agentRoleOf } from '../_shared/agentRole.ts'

// 輸入上限(M-7):history 早有 20 則 × 4000 字元的上限,message 與 facts 原本
// 沒有——兩者都進 prompt,無上限等於讓前端決定要燒多少 token。message 比照
// history 單則上限;facts 是前端 assistantFacts 組的有界快照(各清單 5~30 筆,
// 實測數 KB),100k 字元是「正常永遠碰不到、失控一定擋下」的線。超過回 400。
const MESSAGE_MAX_CHARS = 4_000
const FACTS_MAX_CHARS = 100_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const body = await req.json().catch(() => null)
  const message = body?.message
  if (typeof message !== 'string' || !message.trim()) {
    return json({ error: '缺少 message' }, 400)
  }
  if (message.length > MESSAGE_MAX_CHARS) {
    return json({ error: `message 過長(上限 ${MESSAGE_MAX_CHARS} 字元)`, code: 'message_too_long' }, 400)
  }
  const facts = body?.facts
  // 用進 prompt 的同一種序列化量長度,量到的就是實際會送出的大小
  if (facts !== undefined && stableStringify(facts).length > FACTS_MAX_CHARS) {
    return json({ error: `facts 快照過大(上限 ${FACTS_MAX_CHARS} 字元)`, code: 'facts_too_large' }, 400)
  }

  // gate.serviceClient 只給 draft_daily_log 寫 agent_actions 用(該表 authenticated
  // 無寫入權)。缺 SUPABASE_SERVICE_ROLE_KEY 不整支失敗 —— 查詢工具照常可用,
  // 只有 draft_daily_log 會回「伺服器未設定,暫時無法建立草稿」。
  const gate = await openAiGate(req, { feature: 'agent.run', projectId: body?.project_id })
  if (!gate.ok) return gate.response
  const { userClient, serviceClient, userId, startedAt } = gate
  const projectId = gate.projectId as string // requireProject 預設 true,過閘即非 null
  try {
    // -- 角色由伺服器決定 ------------------------------------------------------
    const { data: orgType } = await userClient.rpc('my_org_type')
    const role: AgentRole = agentRoleOf(typeof orgType === 'string' ? orgType : null)

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
      exec: makeToolExec(userClient, projectId, serviceClient, userId, role),
      userMessage: message,
      facts,
      history,
    })

    // 批 B:記用量(claudeAgent 已彙總多輪 usage;model 即其預設的 MODELS.agent)。
    // recordAiUsage 內部吞掉一切錯誤——記帳失敗絕不能讓 agent 回應失敗。
    await recordAiUsage(serviceClient, {
      feature: 'agent.run', projectId, userId, actor: 'user',
      model: MODELS.agent, usage: result.usage,
      durationMs: Date.now() - startedAt,
      status: result.error ? 'error' : 'ok',
      errorCode: result.error ? 'claude_error' : null,
    })

    // steps 只回摘要(tool/ok/ms),工具輸出與 step.error 原文不回前端 —— 前端只該
    // 看到最終回答;result.error 已是 agent.ts 遮罩後的短語
    return json({
      text: result.text,
      role,
      steps: result.steps.map(({ tool, ok, ms }) => ({ tool, ok, ms })),
      usage: result.usage,
      stop_reason: result.stopReason,
      ...(result.error ? { error: result.error } : {}),
    }, 200)
  } catch (e) {
    return exceptionResponse('agent-run', e)
  }
})
