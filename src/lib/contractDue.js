// 由觸發點 + 期限規則 + 基準日,算出契約義務的實際到期日(Date 或 null)。
// 契約管制頁與提醒中心共用。anchors = { award_date, notice_date, commencement_date, end_date }。
import { parseLocalDate } from './dates.js'

const today0 = (base) => {
  const d = base ? new Date(base) : new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// today 可注入:重複義務的到期日取決於「今天」,不注入就只能讀系統時鐘——
// 純函式測試與任何以固定日期推導的呼叫端(今日待辦聚合)都會變得不可重現。
// 不傳維持原行為(現有呼叫點不受影響)。
//
// 循環欄位:recurring_day=幾日(monthly/quarterly/yearly)、
// recurring_weekday=星期幾(weekly,ISO 1=週一…7=週日)、
// recurring_month=季內第幾個月(quarterly 1..3)或幾月(yearly 1..12)。
// 缺必要欄位(如每季只寫頻率沒寫日子)推不出下次到期日 → 落到基準日分支
// 算不出來回 null,對齊「無期限」的既有語意,不臆測日期。
// 日子超出當月天數沿用 JS Date 進位語意(monthly 既有行為:4 月 31 → 5/1)。
export function computeObligationDue(ob, anchors, today) {
  if (ob.trigger_event === 'fixed') return parseLocalDate(ob.fixed_date)
  if (ob.recurring === 'daily') return today0(today)
  if (ob.recurring === 'weekly' && ob.recurring_weekday) {
    const t = today0(today)
    const isoToday = t.getDay() === 0 ? 7 : t.getDay()
    const d = new Date(t)
    d.setDate(t.getDate() + ((ob.recurring_weekday - isoToday + 7) % 7))
    return d
  }
  if (ob.recurring === 'monthly' && ob.recurring_day) {
    const t = today0(today)
    let d = new Date(t.getFullYear(), t.getMonth(), ob.recurring_day)
    if (d < t) d = new Date(t.getFullYear(), t.getMonth() + 1, ob.recurring_day)
    return d
  }
  if (ob.recurring === 'quarterly' && ob.recurring_day && ob.recurring_month) {
    const t = today0(today)
    const quarterStartMonth = Math.floor(t.getMonth() / 3) * 3
    let d = new Date(t.getFullYear(), quarterStartMonth + ob.recurring_month - 1, ob.recurring_day)
    if (d < t) d = new Date(t.getFullYear(), quarterStartMonth + 3 + ob.recurring_month - 1, ob.recurring_day)
    return d
  }
  if (ob.recurring === 'yearly' && ob.recurring_day && ob.recurring_month) {
    const t = today0(today)
    let d = new Date(t.getFullYear(), ob.recurring_month - 1, ob.recurring_day)
    if (d < t) d = new Date(t.getFullYear() + 1, ob.recurring_month - 1, ob.recurring_day)
    return d
  }
  const base = { award: anchors.award_date, notice: anchors.notice_date, commencement: anchors.commencement_date, completion: anchors.end_date }[ob.trigger_event]
  const d = parseLocalDate(base)
  if (!d) return null
  d.setDate(d.getDate() + (ob.offset_days || 0) * (ob.offset_dir === 'before' ? -1 : 1))
  return d
}

// 期限規則的人話版(期限追蹤頁與契約期限對照表列印共用同一份,
// 避免兩頁對同一條義務講出不同規則)。
const TRIGGER_LABELS = {
  award: '決標', notice: '接獲開工通知', commencement: '開工',
  completion: '完工', monthly: '每月', fixed: '指定日期', other: '其他',
}
const WEEKDAY_LABELS = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日']

export function formatObligationRule(ob) {
  const beforeSuffix = ob.offset_dir === 'before' ? '前' : ''
  if (ob.recurring === 'daily') return '每日'
  if (ob.recurring === 'weekly') {
    return ob.recurring_weekday ? `每${WEEKDAY_LABELS[ob.recurring_weekday] || '週'}` : '每週'
  }
  if (ob.recurring === 'monthly') {
    return ob.recurring_day ? `每月 ${ob.recurring_day} 日${beforeSuffix}` : '每月'
  }
  if (ob.recurring === 'quarterly') {
    if (ob.recurring_day && ob.recurring_month) return `每季第 ${ob.recurring_month} 個月 ${ob.recurring_day} 日${beforeSuffix}`
    return '每季'
  }
  if (ob.recurring === 'yearly') {
    if (ob.recurring_day && ob.recurring_month) return `每年 ${ob.recurring_month} 月 ${ob.recurring_day} 日${beforeSuffix}`
    return '每年'
  }
  if (ob.trigger_event === 'fixed') return `指定 ${ob.fixed_date || '日期'}`
  const t = TRIGGER_LABELS[ob.trigger_event] || ob.trigger_event || ''
  if (ob.offset_days) return `${t}${ob.offset_dir === 'before' ? '前' : '後'} ${ob.offset_days} 日內`
  return t
}

// 期限追蹤摘要(契約重點頁頂部摘要條的四個數字)。分類互斥:
//   done      = 已提送/已完成
//   overdue   = 未完成且已過期
//   dueSoon   = 未完成且 7 日內到期
//   scheduled = 到期日在 7 日後(有日期才叫「排程中」)
// 推不出到期日的義務(基準日未填)四格都不計——語意對齊 /deadlines 頁的
// 「無期限」灰點;硬塞進排程中會讓兩處數字對不上。
export function summarizeDeadlines(obligations, anchors, today) {
  const t = today0(today)
  const out = { overdue: 0, dueSoon: 0, scheduled: 0, done: 0 }
  for (const ob of obligations || []) {
    if (ob.status === '已提送' || ob.status === '已完成') { out.done++; continue }
    const due = computeObligationDue(ob, anchors || {}, today)
    if (!due) continue
    const diff = Math.round((due - t) / 86400000)
    if (diff < 0) out.overdue++
    else if (diff <= 7) out.dueSoon++
    else out.scheduled++
  }
  return out
}
