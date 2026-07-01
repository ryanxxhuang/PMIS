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
