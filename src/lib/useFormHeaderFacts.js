// 公定／參考格式表單表頭的確定性事實(2026-09-20 C 包施工日誌、C2 包監造報表)。
// 編輯畫面與列印／PDF 吃同一支——原表這幾格不是「填」出來的,是本案既有資料算出來的,
// AI 不得產生這些數字(驗收指令 C「累計量、工期、進度沿用既有確定性規則,禁止 AI 編數字」)。
// 口徑沿用既有單一來源:預定進度=lib/progressPlan 的月底累計內插(D-024);
// 實際進度=截至該日最近一期估驗的累計金額 ÷ 契約總額(含已核准變更),與進度頁／AI 快照同一條;
// 契約變更次數=已核准的變更設計件數(與估驗、S 曲線同一份 changeOrders 資料)。
import { useMemo } from 'react'
import { useStore } from '../store.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from './boqCalc.js'
import { latestValuationAt } from './progressAsOf.js'
import { parseLocalDate } from './dates.js'
import { dailyLogHeaderFacts, supervisorReportHeaderFacts } from './officialForms.js'

// 截至該日最近一期估驗的累計金額 ÷ 契約總額(含已核准變更);算不出來回 null → 紙上印「待補」
function useActualPct(logDate) {
  const { workItems, adjustedItems, revisedTotal, valuations } = useStore()
  return useMemo(() => {
    if (!workItems || !revisedTotal) return null
    const cutoff = logDate ? parseLocalDate(logDate) : null
    const v = latestValuationAt(valuations || [], cutoff && !isNaN(cutoff) ? cutoff : null)
    if (!v) return null
    const { roots, childrenMap } = buildBillableTree(adjustedItems)
    return (totalCumAmount(roots, buildCumMap(roots, childrenMap, v)) / revisedTotal) * 100
  }, [workItems, adjustedItems, revisedTotal, valuations, logDate])
}

export function useDailyLogFacts(logDate) {
  const { project, progressPlan } = useStore()
  const actualPct = useActualPct(logDate)
  return useMemo(() => dailyLogHeaderFacts({ project, progressPlan, logDate, actualPct }), [project, progressPlan, logDate, actualPct])
}

export function useSupervisorReportFacts(logDate) {
  const { project, progressPlan, changeOrders } = useStore()
  const actualPct = useActualPct(logDate)
  return useMemo(
    () => supervisorReportHeaderFacts({ project, progressPlan, logDate, actualPct, changeOrders }),
    [project, progressPlan, logDate, actualPct, changeOrders],
  )
}

export default useDailyLogFacts
