// 待辦「返回來源」的唯一定義:哪些頁面可以當待辦的出發點、返回連結要叫什麼名字。
// 先前四處各寫一份(TaskRow 以 pathname 三元式猜標籤、Alerts 自組 state、WorkContext 與
// DetailDrawer 各持一條 /dashboard|/alerts 正則):新增一個來源(現場紀錄)就得改四處,漏一處
// 返回連結就叫錯名或直接不出現。現在只有這一張表;三個消費端都只認這裡的答案。
// 只接受站內的收件匣類頁面:單據自己的 query 更新會保留 state,但不會把單據頁當來源。
// 名字取自 navConfig(頁名唯一來源):/dashboard 就是「今日工作」主入口(BALL_SOURCES_TITLE),
// /alerts、/site 取登記表的 label——先前 /dashboard 這裡寫「今日工作」、側欄寫「今日工作」,
// 同一頁兩個名字(P1c 移交、P1b 統一)。
import { BALL_SOURCES_TITLE, navLabel, navEntryFor } from './navConfig.js'

export const TASK_RETURN_SOURCES = Object.freeze({
  '/dashboard': BALL_SOURCES_TITLE,
  '/alerts': navLabel('/alerts'),
  '/site': navEntryFor('/site').label,
})

const pathOf = (to) => String(to || '').split('?')[0]

// 這個 pathname 是不是待辦來源(WorkContext/DetailDrawer 用它決定要不要畫返回連結,
// 也用它避免在來源頁自己身上畫「返回自己」)
export const isTaskReturnSource = (to) => Object.prototype.hasOwnProperty.call(TASK_RETURN_SOURCES, pathOf(to))

// 從來源頁建立 Link state:to 帶 pathname+search(篩選/載入筆數保留,W05),label 由表決定。
// 不是來源頁就回 undefined——呼叫端不必再自己判斷「這一頁能不能返回」。
export function taskReturnState(location, key) {
  const label = TASK_RETURN_SOURCES[pathOf(location?.pathname)]
  if (!label) return undefined
  return { taskReturn: { to: `${location.pathname}${location.search || ''}`, label, key } }
}

// 從目的頁的 location.state 取出可信的返回資訊:來源不在表裡(被竄改或舊版 state)就當沒有。
export function taskReturnOf(state) {
  const back = state?.taskReturn
  if (!back || !isTaskReturnSource(back.to)) return null
  return back
}
