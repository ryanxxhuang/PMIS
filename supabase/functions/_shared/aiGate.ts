// AI 閘門與計量(批 B)——所有 AI edge function 用同一個形狀包起來。
// ---------------------------------------------------------------------------
// openAiGate:驗身分(JWT)→ 驗成員資格(RLS-scoped 讀 projects)→ 問功能開關
//   (ai_feature_allowed,DB 是執行期唯一真相)→ 擋下時記一筆 blocked 用量。
// closeAiGate:AI 呼叫結束後把 token 用量轉成 record_ai_usage 落庫(service role)。
//
// 兩條紅線(勿改):
// 1. 記帳失敗永遠不能讓 AI 功能失敗——record_ai_usage 只 grant service_role,
//    缺 SUPABASE_SERVICE_ROLE_KEY 或 RPC 出錯時一律 console.error 後靜默略過,
//    使用者的 AI 回應照常送出。用量事件是營運資料,掉一筆可惜、擋掉使用者不可原諒。
// 2. 閘門判斷(ai_feature_allowed RPC)出錯時 fail-closed 擋下並 log(W3-4/D-010,
//    使用者定案,推翻早期的「保守放行」):kill switch 與方案限制在 DB 故障時仍必須
//    有效,寧可 AI 暫停,不可失控放行。判定邏輯集中在 gatePolicy.gateVerdict,
//    「正常回 false」(403 明確關閉)與「查詢失敗」(503 稍後再試)分開回報。

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { jsonResponse as json } from './claude.ts'
import { featureByKey } from './aiFeatures.ts'
import { gateVerdict } from './gatePolicy.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Anthropic Messages API 的 usage 形狀(欄位可能缺,缺就當 0)
export type AiUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export type AiGateOk = {
  ok: true
  userClient: SupabaseClient // 呼叫者 JWT,套 RLS——業務查詢一律走這個
  serviceClient: SupabaseClient | null // 只給記帳(record_ai_usage)用;缺 key 為 null
  userId: string
  projectId: string | null
  startedAt: number // duration_ms 的起點
}
export type AiGateFail = { ok: false; response: Response }

// ── 低階記帳:agent-run / send-reminders 這類自帶驗證流程的函式直接用 ─────────
// 任何失敗(缺 serviceClient / RPC 錯誤 / 意外例外)都吞掉並 log,絕不 throw——
// 呼叫端不需要(也不應該)try/catch 這支函式。
export async function recordAiUsage(
  serviceClient: SupabaseClient | null,
  opts: {
    feature: string
    projectId?: string | null
    userId?: string | null
    actor?: 'user' | 'system'
    model?: string | null
    usage?: AiUsage | null
    durationMs?: number | null
    status: 'ok' | 'error' | 'blocked'
    errorCode?: string | null
  },
): Promise<void> {
  try {
    if (!serviceClient) {
      console.error(`record_ai_usage 略過(未設 SUPABASE_SERVICE_ROLE_KEY):${opts.feature} ${opts.status}`)
      return
    }
    // Anthropic 欄位對應:cache_creation_input_tokens → p_cache_write、
    // cache_read_input_tokens → p_cache_read
    const { error } = await serviceClient.rpc('record_ai_usage', {
      p_feature: opts.feature,
      p_edge_function: featureByKey[opts.feature]?.edgeFunction ?? opts.feature,
      p_project: opts.projectId ?? null,
      p_user: opts.userId ?? null,
      p_actor: opts.actor ?? 'user',
      p_model: opts.model ?? null,
      p_input: opts.usage?.input_tokens ?? 0,
      p_output: opts.usage?.output_tokens ?? 0,
      p_cache_read: opts.usage?.cache_read_input_tokens ?? 0,
      p_cache_write: opts.usage?.cache_creation_input_tokens ?? 0,
      p_duration_ms: opts.durationMs ?? null,
      p_status: opts.status,
      p_error_code: opts.errorCode ?? null,
    })
    if (error) console.error(`record_ai_usage 失敗(${opts.feature} ${opts.status}):`, error.message)
  } catch (e) {
    console.error(`record_ai_usage 例外(${opts.feature} ${opts.status}):`, String((e as Error)?.message || e))
  }
}

// ── 開閘:身分 → 成員資格 → 功能開關 ────────────────────────────────────────
export async function openAiGate(req: Request, opts: {
  feature: string
  projectId?: unknown // 呼叫端從 body 取出的原始值(未驗證)
  requireProject?: boolean // 預設 true
}): Promise<AiGateOk | AiGateFail> {
  const startedAt = Date.now()
  const requireProject = opts.requireProject !== false

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    return { ok: false, response: json({ error: '伺服器未設定 Supabase 環境變數' }, 500) }
  }
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const serviceClient = serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null

  // 呼叫者 JWT 建 client(照 agent-run / extract-requirements 的既有範式)
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData } = await userClient.auth.getUser()
  const user = userData?.user
  if (!user) return { ok: false, response: json({ error: '未登入' }, 401) }

  // project_id:驗 UUID 格式,再以 RLS-scoped read 證明成員資格(看不到=不是成員)
  let projectId: string | null = null
  if (typeof opts.projectId === 'string' && UUID_RE.test(opts.projectId)) {
    projectId = opts.projectId
  }
  if (!projectId) {
    if (requireProject) return { ok: false, response: json({ error: '缺少有效的 project_id' }, 400) }
  } else {
    const { data: project, error: projectError } = await userClient
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle()
    if (projectError) return { ok: false, response: json({ error: projectError.message }, 500) }
    if (!project) return { ok: false, response: json({ error: '找不到專案或無權限' }, 404) }
  }

  // 功能開關:ai_feature_allowed 是 security definer,userClient 呼叫即可。
  // 查詢失敗=fail-closed(檔頭紅線 2/D-010);判定集中在 gateVerdict。
  const { data: allowed, error: allowError } = await userClient
    .rpc('ai_feature_allowed', { p_project: projectId, p_feature: opts.feature })
  if (allowError) {
    console.error(`ai_feature_allowed 查詢失敗(${opts.feature},fail-closed 擋下):`, allowError.message)
  }
  const label = featureByKey[opts.feature]?.label || opts.feature
  const verdict = gateVerdict(label, allowed as boolean | null, !!allowError)
  if (!verdict.allow) {
    await recordAiUsage(serviceClient, {
      feature: opts.feature, projectId, userId: user.id, actor: 'user',
      durationMs: Date.now() - startedAt, status: 'blocked', errorCode: verdict.code,
    })
    return { ok: false, response: json({ error: verdict.message, code: verdict.code }, verdict.status) }
  }

  return { ok: true, userClient, serviceClient, userId: user.id, projectId, startedAt }
}

// ── 關閘:AI 呼叫結束後記用量(成功/失敗都記;任何錯誤吞掉,見檔頭紅線 1)────
export async function closeAiGate(gate: AiGateOk, opts: {
  feature: string
  model?: string | null
  usage?: AiUsage | null
  status: 'ok' | 'error'
  errorCode?: string | null
}): Promise<void> {
  try {
    await recordAiUsage(gate.serviceClient, {
      feature: opts.feature,
      projectId: gate.projectId,
      userId: gate.userId,
      actor: 'user',
      model: opts.model ?? null,
      usage: opts.usage ?? null,
      durationMs: Date.now() - gate.startedAt,
      status: opts.status,
      errorCode: opts.errorCode ?? null,
    })
  } catch (e) {
    // recordAiUsage 本身不 throw,這層 catch 是最後保險——記帳絕不能弄壞 AI 回應
    console.error(`closeAiGate 例外(${opts.feature}):`, String((e as Error)?.message || e))
  }
}
