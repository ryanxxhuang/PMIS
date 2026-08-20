// 今日待辦聚合的「唯一」hook 入口(W8-2A §2.1 的延伸):Dashboard、Layout 的
// 側欄件數 badge 與通知紅點都吃這一份——件數若在兩處各算一次,數字遲早分岔,
// 使用者會看到側欄說 3 件、首頁說 5 件。聚合本體仍是 buildTodayTasks(純函式,
// 有單元測試);這裡只負責把 store 切片餵進去並 memo。
//
// TODAY 每次 render 取(B-11:工地平板整週不關分頁,模組層常數會讓日期凍結),
// memo 以 todayIso(台北日曆日)為 key——同一天內資料不變就不重算。
import { useMemo } from 'react'
import { useStore } from '../store.jsx'
import { buildTodayTasks, taipeiISODate } from './todayTasks.js'

export function useTodayTasks() {
  const { currentUser, project, rfis, submittals, valuations, defects, inspections, observations,
    changeOrders, obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs } = useStore()
  const org = currentUser?.org_type || 'contractor'
  const TODAY = new Date()
  const todayIso = taipeiISODate(TODAY)
  return useMemo(() => buildTodayTasks({
    org, today: TODAY,
    anchors: {
      award_date: project?.award_date, notice_date: project?.notice_date,
      commencement_date: project?.commencement_date, end_date: project?.end_date,
    },
    rfis, submittals, valuations, defects, inspections, observations, changeOrders,
    obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs,
  }), [org, todayIso, project, rfis, submittals, valuations, defects, inspections, observations,
    changeOrders, obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs]) // eslint-disable-line react-hooks/exhaustive-deps
}

// 「現在輪到我」依工作面分組計數(側欄/rail badge 用)。
// item 來自 navConfig 的 visibleNavGroups 輸出;task.to 是目的頁路由。
export function mineCountForNavItem(mine, item) {
  return mine.filter((t) => t.to === item.to || item.tabs?.some((tab) => tab.to === t.to)).length
}
