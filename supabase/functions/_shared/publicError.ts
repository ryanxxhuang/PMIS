// 對外錯誤遮罩(B1,政府合規:資通系統防護基準附表十構面五——「錯誤時使用者
// 頁面僅顯示簡短訊息及代碼,不含詳細錯誤訊息」)。
// ---------------------------------------------------------------------------
// 重構前 Claude 的 HTTP 回應本文(含 request id、額度、模型名)、PostgREST 的
// error.message(含 RLS policy 名、constraint 名)與未預期例外的原文,都經
// `json({ error })` 原樣回到前端,甚至寫進 document_ingestion_runs.error_message
// 讓整案成員都讀得到。這裡是唯一的遮罩點:
//   * 對外只回「純中文短語＋穩定代碼」;代碼沿用 claude.ts 既有的
//     http_<status> / timeout / network / max_tokens / no_tool_use / config。
//   * 原文一律 console.error 進伺服器 log(Supabase edge log 只有平台管理員看得到)。
//   * 純函式、無 runtime 依賴——vitest 直接測「原文不出現在回傳值」。
//
// 「哪些訊息可以原樣放行」與前端 src/lib/errorMessage.js friendlyError 用同一條
// 規則(一個概念一個判準,不另立):Postgres / Anthropic / Deno runtime 的原始
// 錯誤永遠是英文 ASCII;含中日韓表意文字的只會是我們自己刻意寫給使用者看的
// 業務訊息(DB 觸發器 raise exception 的 P0001、程式裡 throw 的繁中 Error)。
// ⚠️ 前提:functions/ 內不得再用樣板字串把 raw error.message 拼進中文訊息
//(_shared/errorLeak.scan.test.ts 凍結),否則英文原文會搭中文便車外洩。
//
// 訊息不得含冒號:前端 friendlyError 會把「中文前綴:非中文尾巴」截到冒號為止
//(舊樣板拼接的補救),代碼一律用全形括號附在句尾,才能整句到達使用者。

export type PublicError = { message: string; code: string }

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/

// 我們自己寫給使用者看的訊息(與 friendlyError 同判準)
export const isOwnMessage = (text: unknown): text is string =>
  typeof text === 'string' && CJK.test(text)

const withCode = (message: string, code: string): PublicError =>
  ({ message: `${message}（代碼 ${code}）`, code })

// 伺服器 log 只留原文前 2000 字:Claude 4xx 的 JSON 與 PostgREST hint 都不長,
// 截斷只是防止某次意外的超長回應把 log 撐爆。
const LOG_MAX = 2000
const clip = (raw: unknown) => String(raw ?? '').slice(0, LOG_MAX)

// ── Claude 上游錯誤 ─────────────────────────────────────────────────────────
// code → 使用者看得懂的處置建議。分類碼本身就是 claude.ts / agent.ts 已在用的
// 值域,這裡只是把「原文」換成「短語」,呼叫端分流(errorCode)不受影響。
export function claudeErrorMessage(code: string): string {
  if (code === 'config') return 'AI 服務尚未完成設定，請聯絡系統管理者'
  if (code === 'timeout') return 'AI 處理逾時，請縮小輸入內容後再試'
  if (code === 'network') return 'AI 服務連線失敗，請稍後再試'
  if (code === 'max_tokens') return 'AI 輸出超過長度上限，結果不完整，請縮小輸入內容後再試'
  if (code === 'no_tool_use') return 'AI 未回傳結構化內容，請再試一次'
  const status = Number(/^http_(\d{3})$/.exec(code)?.[1])
  if (status === 429) return 'AI 服務忙碌中，請稍後再試'
  if (status >= 500) return 'AI 服務暫時無法使用，請稍後再試'
  if (status >= 400) return 'AI 請求無法處理，請聯絡系統管理者'
  return 'AI 服務發生錯誤，請稍後再試'
}

export function maskClaudeError(scope: string, code: string, raw: unknown): PublicError {
  console.error(`[${scope}] Claude 上游錯誤 ${code}:`, clip(raw))
  return withCode(claudeErrorMessage(code), code)
}

// ── PostgREST 錯誤 ─────────────────────────────────────────────────────────
// supabase-js 的 PostgrestError 形狀;P0001 是我們 DB 觸發器 raise exception 的
// 業務規則(繁中),要原樣讓使用者知道「為什麼不能這樣做」,其餘一律遮。
export type DbErrorLike = { message?: string; code?: string; details?: string; hint?: string } | null | undefined

export function maskDbError(scope: string, error: DbErrorLike): PublicError {
  console.error(`[${scope}] PostgREST 錯誤 ${error?.code ?? '-'}:`, clip(error?.message), clip(error?.details), clip(error?.hint))
  if (error?.code === 'P0001' && isOwnMessage(error.message)) {
    return { message: error.message, code: 'P0001' }
  }
  return withCode('資料存取失敗，請稍後再試', 'db_error')
}

// ── 未預期例外 ─────────────────────────────────────────────────────────────
// 程式裡刻意 throw 的繁中 Error(例如 loadDocumentPages 的「文件頁面仍在更新」)
// 是給使用者的業務訊息,原樣放行;runtime / 函式庫丟出的英文原文一律遮。
export function maskException(scope: string, e: unknown): PublicError {
  const raw = (e as { message?: unknown })?.message ?? e
  const stack = (e as { stack?: unknown })?.stack
  console.error(`[${scope}] 未預期例外:`, clip(raw), typeof stack === 'string' ? clip(stack) : '')
  if (isOwnMessage(raw)) return { message: raw, code: 'business_rule' }
  return withCode('系統發生錯誤，請稍後再試', 'internal')
}
