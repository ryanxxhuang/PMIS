// 錯誤訊息中文化與去識別化。
//
// 兩個動機合在一起解:
// ① UX:客戶是機關承辦人,看到 "Password is known to be weak" 這種英文訊息會直接卡住。
// ② 合規:資通系統防護基準(附表十)構面五「開發階段」普通級明文要求——
//    「錯誤時使用者頁面僅顯示簡短訊息及代碼,不含詳細錯誤訊息」。
//    直接把 error.message 丟到畫面上,等於把 Postgres 錯誤碼、constraint 名稱、
//    RLS policy 名稱、edge function 原始回應免費送給攻擊者。
//
// 設計原則:**不是無腦全部蓋掉**。我們自己的業務規則訊息要原樣顯示,
// 否則使用者會失去「為什麼不能這樣做」的有用資訊(例如「只有監造可以核定」)。
// 判準:資料庫觸發器用 raise exception 丟出的訊息(SQLSTATE P0001)是我們寫的、
// 面向使用者的中文業務規則 → 原樣顯示;其餘一律轉成通用訊息 + 代碼。

// Supabase Auth(GoTrue)的已知訊息 → 中文。比對用小寫子字串,避免版本間標點差異。
const AUTH_MESSAGES = [
  [/invalid login credentials/i, 'Email 或密碼錯誤，請確認後再試一次。'],
  [/email not confirmed/i, '此帳號尚未完成信箱驗證，請到信箱點擊驗證連結。'],
  [/user already registered|already been registered/i, '這個 Email 已經註冊過了，請直接登入或使用「忘記密碼」。'],
  [/password should be at least/i, '密碼長度不足，請至少 8 碼。'],
  [/password should contain at least one character of each/i,
    '密碼需同時包含小寫英文、大寫英文與數字，且至少 8 碼。'],
  [/password is known to be weak|easy to guess/i,
    '這組密碼曾在外洩資料中出現過，請換一組較不常見的密碼。'],
  [/new password should be different/i, '新密碼不能與目前的密碼相同。'],
  [/for security purposes|rate limit|too many requests/i,
    '操作太頻繁，請稍候幾分鐘再試（寄信有頻率限制）。'],
  [/token has expired|invalid or has expired/i, '連結已過期，請重新寄送一封。'],
  [/email address .* is invalid|unable to validate email/i, 'Email 格式不正確，請檢查後再送出。'],
  [/signups not allowed|signup is disabled/i, '目前未開放註冊，請聯絡管理者。'],
]

// 網路層問題:使用者能自己處理(重試/檢查連線),講清楚比蓋掉有用。
const NETWORK = /failed to fetch|networkerror|load failed|network request failed/i

/**
 * 把任意錯誤轉成可以安全顯示給使用者的中文訊息。
 *
 * @param {unknown} error 來自 supabase-js、fetch 或 throw 的錯誤
 * @param {string} fallback 無法歸類時的情境化訊息(由呼叫端提供,例如「查驗申請未送出」)
 * @returns {string}
 */
export function friendlyError(error, fallback = '操作未完成，請稍後再試。') {
  if (!error) return fallback
  const raw = typeof error === 'string' ? error : (error.message || '')
  const code = error.code ?? error.status ?? null

  // 我們自己的業務規則(DB 觸發器 raise exception)——原樣顯示,那是使用者需要知道的事。
  if (code === 'P0001' && raw) return raw

  for (const [pattern, zh] of AUTH_MESSAGES) {
    if (pattern.test(raw)) return zh
  }

  if (NETWORK.test(raw)) return '網路連線不穩，請確認連線後再試一次。'

  // 其餘一律不外洩細節。附上短代碼讓使用者回報時我們能對到 Sentry 的事件。
  return code ? `${fallback}（代碼 ${code}）` : fallback
}
