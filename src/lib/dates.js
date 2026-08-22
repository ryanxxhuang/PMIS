// 'YYYY-MM-DD' 一律解析成「本地」午夜。new Date('YYYY-MM-DD') 是 UTC 午夜，
// 在 UTC 以西的時區會往前掉一天，到期日/逾期判斷就差一天。
export function parseLocalDate(s) {
  if (!s) return null
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  const d = new Date(s)
  if (isNaN(d)) return null
  d.setHours(0, 0, 0, 0)
  return d
}

// timestamptz / Date → 台北日曆日 'YYYY-MM-DD'。伺服器存 UTC,台灣 00:00–08:00 的
// 「現在」在 UTC 下還是前一天;業務日期(逾期判斷、落庫的估驗日/審定日/申請日)
// 若用 toISOString().slice(0,10) 就會整批往前掉一天。原實作在 todayTasks.js,
// 抽到這裡當全站業務日期的單一真相;系統時戳(created_at 等 timestamptz)不適用。
const TAIPEI_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
})
export function taipeiISODate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d)) return null
  return TAIPEI_YMD.format(d)
}

// 業務上的「今天」:一律以台北日曆日為準(政府工程的法定期限跟著台灣時區走),
// 不跟瀏覽器時區——出差或時區設錯的機器填報,日期也不會亂跳。
export const taipeiToday = () => taipeiISODate(new Date())

// 本地 Date(parseLocalDate / computeObligationDue 回傳的本地午夜)→ 'YYYY-MM-DD'。
// 不能用 toISOString():本地午夜轉 UTC 在 UTC 以東的時區會往前掉一天。
export const localISODate = (d) => (d instanceof Date && !isNaN(d)
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : null)
