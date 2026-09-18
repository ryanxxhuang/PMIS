// 由觸發點 + 期限規則 + 基準日,算出契約義務的實際到期日(Date 或 null)。
// 契約管制頁與提醒中心共用。anchors = { award_date, notice_date, commencement_date, end_date }。
import { parseLocalDate } from './dates.js'
import { isRecurring, currentObligationPeriod, singleDueSnapshot } from '../../supabase/functions/_shared/ballInCourtRules.ts'
export { singleDueSnapshot }

// 單次義務:觸發點對應的基準日 ± 偏移天數;fixed 直接用指定日期;基準日沒填 → null(基準日待補,不臆測)。
// 已提送／已完成的單次義務(P5c):DB trigger 在完成當下依「當時」基準日留了 due_date_snapshot,優先讀它——
// 基準日事後更正不改歷史(準時判定不變);沒有快照的舊資料照舊以現行基準日算(畫面標「完成時未留版」)。
// 循環義務(P5b):到期日不再由前端從「今天」推算下一期——期次(ob.periods,obligation_periods 以
// PostgREST embed 載入)由 DB 依規則＋基準日確定性物化,這裡取「最早未結的一期」的到期日;
// 舊逾期因此不會被下一期蓋掉、完成本期後下期自然接上。沒有期次(基準日或循環規則待補、
// 整條已不適用)→ null。逐期列舉(首頁／Agent／早報)走共用規則 obligationEntries,不在這裡。
export function computeObligationDue(ob, anchors) {
  if (isRecurring(ob)) {
    const period = currentObligationPeriod(ob.periods)
    return period ? parseLocalDate(period.due_date) : null
  }
  if (singleDueSnapshot(ob)) return parseLocalDate(ob.due_date_snapshot)
  if (ob.trigger_event === 'fixed') return parseLocalDate(ob.fixed_date)
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
