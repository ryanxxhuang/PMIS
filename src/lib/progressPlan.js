import { parseLocalDate } from './dates.js'

// 預定進度表每列 = 該月「月底」累計 %（D-024，2026-09-16 定案；施工月報、逐月表、
// generateSchedule 的末列 100% 都是這個意思）。月份座標以「該月底 = 整數 i」計，
// 月內按當月日數線性推進：開工月 1 日 ≈ -1、開工月底 = 0（對應列 0）。
// 日期由呼叫端傳入，避免長開頁面凍結「今天」。
export function progressMonthIndex(startDate, today) {
  const start = parseLocalDate(startDate)
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  return (today.getFullYear() - start.getFullYear()) * 12
    + (today.getMonth() - start.getMonth())
    - 1 + today.getDate() / daysInMonth
}

// months[].plannedPct 是累計百分比（月底值）；圖表、報表與 AI 快照共用同一內插規則：
// 開工月起點 0%，列 i 與列 i+1 之間按日內插；超過最後一列維持最後累計值。
export function plannedPctNow(progressPlan, today) {
  if (!progressPlan || !progressPlan.months.length) return null
  const months = progressPlan.months
  const t = progressMonthIndex(progressPlan.start, today)
  if (t <= -1) return 0
  if (t >= months.length - 1) return months[months.length - 1].plannedPct
  const lo = Math.floor(t), fraction = t - lo
  const base = lo < 0 ? 0 : months[lo].plannedPct
  return base + (months[lo + 1].plannedPct - base) * fraction
}
