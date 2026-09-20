// 施工日誌表頭的確定性事實(2026-09-20 C 包):核定／累計／剩餘工期、預定與實際進度。
// 編輯畫面與列印／PDF 吃同一支——原表這幾格不是「填」出來的,是本案既有資料算出來的,
// AI 不得產生這些數字(驗收指令 C「累計量、工期、進度沿用既有確定性規則,禁止 AI 編數字」)。
// 口徑沿用既有單一來源:預定進度=lib/progressPlan 的月底累計內插(D-024);
// 實際進度=截至該日最近一期估驗的累計金額 ÷ 契約總額(含已核准變更),與進度頁／AI 快照同一條。
import { useMemo } from 'react'
import { useStore } from '../store.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from './boqCalc.js'
import { latestValuationAt } from './progressAsOf.js'
import { parseLocalDate } from './dates.js'
import { dailyLogHeaderFacts } from './officialForms.js'

export default function useDailyLogFacts(logDate) {
  const { project, workItems, adjustedItems, revisedTotal, valuations, progressPlan } = useStore()
  return useMemo(() => {
    const cutoff = logDate ? parseLocalDate(logDate) : null
    let actualPct = null
    if (workItems && revisedTotal) {
      const v = latestValuationAt(valuations || [], cutoff && !isNaN(cutoff) ? cutoff : null)
      if (v) {
        const { roots, childrenMap } = buildBillableTree(adjustedItems)
        actualPct = (totalCumAmount(roots, buildCumMap(roots, childrenMap, v)) / revisedTotal) * 100
      }
    }
    return dailyLogHeaderFacts({ project, progressPlan, logDate, actualPct })
  }, [project, workItems, adjustedItems, revisedTotal, valuations, progressPlan, logDate])
}
