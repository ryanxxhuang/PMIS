// 由觸發點 + 期限規則 + 基準日,算出契約義務的實際到期日(Date 或 null)。
// 契約管制頁與提醒中心共用。anchors = { award_date, notice_date, commencement_date, end_date }。
import { parseLocalDate } from './dates.js'

const today0 = (base) => {
  const d = base ? new Date(base) : new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// today 可注入:每月重複義務的到期日取決於「今天」,不注入就只能讀系統時鐘——
// 純函式測試與任何以固定日期推導的呼叫端(今日待辦聚合)都會變得不可重現。
// 不傳維持原行為(現有呼叫點不受影響)。
export function computeObligationDue(ob, anchors, today) {
  if (ob.trigger_event === 'fixed') return parseLocalDate(ob.fixed_date)
  if (ob.recurring === 'monthly' && ob.recurring_day) {
    const t = today0(today)
    let d = new Date(t.getFullYear(), t.getMonth(), ob.recurring_day)
    if (d < t) d = new Date(t.getFullYear(), t.getMonth() + 1, ob.recurring_day)
    return d
  }
  const base = { award: anchors.award_date, notice: anchors.notice_date, commencement: anchors.commencement_date, completion: anchors.end_date }[ob.trigger_event]
  const d = parseLocalDate(base)
  if (!d) return null
  d.setDate(d.getDate() + (ob.offset_days || 0) * (ob.offset_dir === 'before' ? -1 : 1))
  return d
}
