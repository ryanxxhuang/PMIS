// AI copilot 的資料衍生 hook——把本案各模組算成 qaData(確定性回退用)+ facts
// 快照(送 edge fn 用),供「/assistant 頁」與「右下角浮動鈕」共用同一份計算。
import { useMemo } from 'react'
import { useStore } from '../store.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from './boqCalc.js'
import { parseLocalDate } from './dates.js'
import { buildAssistantFacts } from './assistantFacts.js'
import { myOpenItems } from './ballInCourt.js'

const TODAY = new Date()

export function useAssistantData() {
  const store = useStore()
  const { project, currentUser, workItems, valuations, progressPlan, siteLogs, inspections, defects,
    testSamples, obligations, changeOrders, submittals, rfis, observations, safetyRecords, acceptanceEvents,
    demoMode, workItemsSource, askAssistant } = store
  const org = currentUser?.org_type || 'contractor'
  const imported = workItemsSource === 'db' || demoMode

  const { roots, childrenMap } = useMemo(
    () => (workItems ? buildBillableTree(workItems.items) : { roots: [], childrenMap: new Map() }),
    [workItems],
  )
  const billableTotal = workItems?.meta.billable_total || 0
  const latestVal = valuations[valuations.length - 1]
  const actualCum = useMemo(
    () => (latestVal ? totalCumAmount(roots, buildCumMap(roots, childrenMap, latestVal.items)) : 0),
    [roots, childrenMap, latestVal],
  )
  const actualPct = billableTotal ? (actualCum / billableTotal) * 100 : 0
  const plannedNow = useMemo(() => {
    if (!progressPlan) return null
    const months = progressPlan.months, N = months.length
    const start = parseLocalDate(progressPlan.start)
    const elapsed = (TODAY.getFullYear() - start.getFullYear()) * 12 + (TODAY.getMonth() - start.getMonth()) + (TODAY.getDate() - 1) / 30
    if (elapsed <= 0) return 0
    if (elapsed >= N - 1) return months[N - 1].plannedPct
    const lo = Math.floor(elapsed), f = elapsed - lo
    return months[lo].plannedPct + (months[lo + 1].plannedPct - months[lo].plannedPct) * f
  }, [progressPlan])

  const anchors = {
    award_date: project?.award_date, notice_date: project?.notice_date,
    commencement_date: project?.commencement_date, end_date: project?.end_date,
  }
  const myItems = useMemo(
    () => myOpenItems(org, { rfis, submittals, valuations, defects, inspections, observations, changeOrders }),
    [org, rfis, submittals, valuations, defects, inspections, observations, changeOrders],
  )

  const data = {
    project, progress: { actualPct, plannedPct: plannedNow },
    finance: { billableTotal, actualCum }, valuations, defects, inspections, siteLogs,
    obligations, changeOrders, testSamples, myItems, anchors,
  }
  const facts = useMemo(() => buildAssistantFacts({
    ...data, org, submittals, rfis, safetyRecords, acceptanceEvents,
  }, TODAY), [data, org, submittals, rfis, safetyRecords, acceptanceEvents]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, facts, askAssistant, imported, org }
}
