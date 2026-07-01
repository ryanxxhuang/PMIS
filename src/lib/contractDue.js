// 由觸發點 + 期限規則 + 基準日,算出契約義務的實際到期日(Date 或 null)。
// 契約管制頁與提醒中心共用。anchors = { award_date, notice_date, commencement_date, end_date }。
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

export function computeObligationDue(ob, anchors) {
  if (ob.trigger_event === 'fixed') return ob.fixed_date ? new Date(ob.fixed_date) : null
  if (ob.recurring === 'monthly' && ob.recurring_day) {
    const t = today0()
    let d = new Date(t.getFullYear(), t.getMonth(), ob.recurring_day)
    if (d < t) d = new Date(t.getFullYear(), t.getMonth() + 1, ob.recurring_day)
    return d
  }
  const base = { award: anchors.award_date, notice: anchors.notice_date, commencement: anchors.commencement_date, completion: anchors.end_date }[ob.trigger_event]
  if (!base) return null
  const d = new Date(base); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + (ob.offset_days || 0) * (ob.offset_dir === 'before' ? -1 : 1))
  return d
}
