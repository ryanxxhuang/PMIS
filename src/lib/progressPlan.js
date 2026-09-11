import { parseLocalDate } from './dates.js'

// 沿用預定曲線的月份座標：每月 1 日為整數，日數按 30 天換算，
// 不是從開工日精確計算經過天數。日期由呼叫端傳入，避免長開頁面凍結「今天」。
export function progressMonthIndex(startDate, today) {
  const start = parseLocalDate(startDate)
  return (today.getFullYear() - start.getFullYear()) * 12
    + (today.getMonth() - start.getMonth())
    + (today.getDate() - 1) / 30
}

// months[].plannedPct 是累計百分比；圖表、報表與 AI 快照共用同一內插規則。
export function plannedPctNow(progressPlan, today) {
  if (!progressPlan || !progressPlan.months.length) return null
  const months = progressPlan.months
  const elapsed = progressMonthIndex(progressPlan.start, today)
  if (elapsed <= 0) return 0
  if (elapsed >= months.length - 1) return months[months.length - 1].plannedPct
  const lo = Math.floor(elapsed), fraction = elapsed - lo
  return months[lo].plannedPct + (months[lo + 1].plannedPct - months[lo].plannedPct) * fraction
}
