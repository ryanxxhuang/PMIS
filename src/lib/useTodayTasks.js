// 今日待辦聚合的「唯一」hook 入口(W8-2A §2.1 的延伸):Dashboard、Layout 的
// 側欄件數 badge 與通知紅點都吃這一份——件數若在兩處各算一次,數字遲早分岔,
// 使用者會看到側欄說 3 件、首頁說 5 件。聚合本體仍是 buildTodayTasks(純函式,
// 有單元測試);這裡只負責把 store 切片餵進去並 memo。
//
// 「今天」每次 render 取(B-11:工地平板整週不關分頁,模組層常數會讓日期凍結),
// memo 以 todayIso(台北日曆日)為 key——同一天內資料不變就不重算。傳給聚合的就是
// 這個字串而不是 Date:聚合一進去只取它的台北日曆日(taipeiISODate 接受 'YYYY-MM-DD',
// UTC 午夜換成台北恆為同一天),Date 每次 render 都是新物件,當依賴等於不 memo。
import { useMemo } from 'react'
import { useStore } from '../store.jsx'
import { buildTodayTasks, taipeiISODate } from './todayTasks.js'

export function useTodayTasks() {
  const { currentUser, project, rfis, submittals, valuations, defects, inspections, observations,
    changeOrders, obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs } = useStore()
  const org = currentUser?.org_type || 'contractor'
  const todayIso = taipeiISODate(new Date())
  return useMemo(() => buildTodayTasks({
    org, today: todayIso,
    anchors: {
      award_date: project?.award_date, notice_date: project?.notice_date,
      commencement_date: project?.commencement_date, end_date: project?.end_date,
    },
    rfis, submittals, valuations, defects, inspections, observations, changeOrders,
    obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs,
  }), [org, todayIso, project, rfis, submittals, valuations, defects, inspections, observations,
    changeOrders, obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs])
}

// 「現在輪到我」依工作面分組計數(側欄/rail badge 用)。
// item 來自 navConfig 的 visibleNavGroups 輸出;task.to 是目的頁路由,自規範 §9.7 起
// 可帶單條 query(/rfi?rfi=…)直達那一筆——比對只看路徑,否則直達的待辦一筆都對不上
// 側欄項,badge 會憑空少算。
const pathOf = (to) => String(to || '').split('?')[0]
export function mineCountForNavItem(mine, item) {
  return mine.filter((t) => {
    const path = pathOf(t.to)
    return path === item.to || item.tabs?.some((tab) => tab.to === path)
  }).length
}
