// 「純 schema + prompt」edge function 的共用骨架(B1 / M-2)。
// ---------------------------------------------------------------------------
// 重構前 13 支 function 的 Deno.serve 本體逐字相同:OPTIONS → 解析 body →
// openAiGate → claudeJson → 成功/失敗記帳 → 回應 → catch 記帳＋500;只有
// feature 名、prompt 組法與結果整理不同。骨架抄 13 次的代價是錯誤遮罩(H-1)
// 得改 13 處、漏一處就外洩——所以收到這裡,呼叫端只剩 build(組 prompt)與
// finish(整理結果)。
// 刻意不做成框架:形狀特殊的 function 不硬塞——extract-requirements(分批續跑、
// 自管 run)、agent-run(多輪 tool-use)、fetch-weather(非 LLM)、send-reminders
//(cron、無使用者 JWT)各自保留本體,只套同一套錯誤遮罩。
//
// build 回傳三種之一:
//   * AiJsonCall            → 打 Claude,成功回 finish(data) 或 data 本身(200)
//   * Response              → 直接回(輸入驗證 400 / 權限 403 等),不記帳——
//                             與重構前「try 內早退不 closeAiGate」行為一致
//   * { reply }             → 確定性結果、不打 LLM,記一筆 ok(token 0)計次
//                            (audit-summary 無發現時的罐頭回覆;計次是既有行為)

import { claudeJson, cors, jsonResponse as json, exceptionResponse } from './claude.ts'
import { openAiGate, closeAiGate } from './aiGate.ts'
import type { AiGateOk } from './aiGate.ts'

// body 來自前端(不可信),形狀由各 function 的 build 自行驗;沿用重構前
// `const { x } = body || {}` 的寬鬆讀法,所以這裡放寬型別。
// deno-lint-ignore no-explicit-any
export type LooseBody = Record<string, any>

export type AiJsonCall = Parameters<typeof claudeJson>[0]
export type AiJsonCtx = { body: LooseBody; gate: AiGateOk }
export type BuildResult = AiJsonCall | Response | { reply: unknown }

export function aiJsonHandler(opts: {
  feature: string
  build: (ctx: AiJsonCtx) => BuildResult | Promise<BuildResult>
  finish?: (data: unknown, ctx: AiJsonCtx) => unknown
}): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    // 批 B 閘門:登入+成員資格+功能開關(擋下記 blocked);通過後 AI 呼叫結果記用量
    const body = ((await req.json().catch(() => null)) ?? {}) as LooseBody
    const gate = await openAiGate(req, { feature: opts.feature, projectId: body.project_id })
    if (!gate.ok) return gate.response
    const ctx: AiJsonCtx = { body, gate }
    try {
      const built = await opts.build(ctx)
      if (built instanceof Response) return built
      if ('reply' in built) {
        await closeAiGate(gate, { feature: opts.feature, status: 'ok' })
        return json(built.reply, 200)
      }
      // claudeJson 的 error 已是遮罩後的中文短語(原文只在它的 console.error),
      // 這裡可以直接回;errorCode 另附為 code 供前端/客服對照
      const { data, error, errorCode, usage, model } = await claudeJson(built)
      if (error) {
        await closeAiGate(gate, { feature: opts.feature, model, usage, status: 'error', errorCode: 'claude_error' })
        return json({ error, code: errorCode }, 502)
      }
      await closeAiGate(gate, { feature: opts.feature, model, usage, status: 'ok' })
      return json(opts.finish ? opts.finish(data, ctx) : data, 200)
    } catch (e) {
      await closeAiGate(gate, { feature: opts.feature, status: 'error', errorCode: 'exception' })
      return exceptionResponse(opts.feature, e)
    }
  }
}
