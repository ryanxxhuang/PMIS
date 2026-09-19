// 進度數字的共同口徑（D-024，2026-09-16）：截止日怎麼取、取哪一期估驗、估驗狀態一律計入。
// 施工月報、監造月報、進度頁、首頁、跨案總覽、AI 快照都從這裡拿「同一天、同一期」，
// 不再各自抓陣列最後一筆或各算一套截止日。
import { parseLocalDate, localISODate } from './dates.js'

// 某月最後一天（當地時間）
export const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0) }
const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// 報表統計截止日：所選月份月底；本月（或未來月份）尚未結束時取今天——截止日不落在未來，
// 所以同一天看施工月報、監造月報、進度頁，本月數字三處相同。
export function reportCutoff(month, today = new Date()) {
  const end = monthEnd(month), t = dayOf(today)
  return end < t ? end : t
}
export const isPartialMonth = (month, today = new Date()) => monthEnd(month) > dayOf(today)

// 截至 cutoff 的估驗期：估驗日期在 cutoff（含）以前（沒填日期的一律納入）中期數最大的一期。
// 草稿／監造審核／已核定都算（C3 決策：估驗代表廠商申報的完成量，核定與否由畫面另標狀態）。
// 不傳 cutoff 時 = 最新一期。
export function latestValuationAt(valuations = [], cutoff = null) {
  const eligible = cutoff
    ? valuations.filter((v) => !v.valuation_date || parseLocalDate(v.valuation_date) <= cutoff)
    : valuations
  if (!eligible.length) return null
  return eligible.reduce((a, b) => ((b.period_no || 0) > (a.period_no || 0) ? b : a))
}

// 一句話說明所取期別：「第 n 期（狀態）」／「尚無估驗」
export const valuationLabel = (v) => (v ? `第 ${v.period_no} 期（${v.status || '—'}）` : '尚無估驗')
export const cutoffISO = (d) => localISODate(d)
