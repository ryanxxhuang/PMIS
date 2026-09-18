// src/lib/contractDue.js 的伺服器端移植(Deno / Edge Function 用)。
// 差異:全部以「UTC 純日期(ms)」運算 — 伺服器時區未知,不能用本地 Date;
// 「今天」以台北時間(UTC+8)為準。若改動判斷邏輯,兩邊要同步(contractDue.test.ts 與
// src/lib/contractDue.test.js 是同一組案例)。

import { isRecurring, currentObligationPeriod, singleDueSnapshot } from './ballInCourtRules.ts'
import type { ObligationPeriod } from './ballInCourtRules.ts'

export interface Obligation {
  status?: string | null
  trigger_event?: string | null
  offset_days?: number | null
  offset_dir?: string | null
  fixed_date?: string | null
  recurring?: string | null
  recurring_day?: number | null
  recurring_weekday?: number | null   // weekly:ISO 1=週一…7=週日
  recurring_month?: number | null     // quarterly:季內第幾個月 1..3;yearly:幾月 1..12
  periods?: ObligationPeriod[] | null // 循環義務的期次(obligation_periods embed;P5b)
  due_date_snapshot?: string | null   // 已提送／已完成的單次義務完成當下的到期日快照(P5c;DB trigger 蓋)
  anchor_version_no?: number | null   // 留快照時的基準日版本(P5c)
}

export interface Anchors {
  award_date?: string | null
  notice_date?: string | null
  commencement_date?: string | null
  end_date?: string | null
}

const DAY = 86400000

// 'YYYY-MM-DD' → UTC 午夜的 ms;無法解析 → null
export function parseDateUTC(s: string | null | undefined): number | null {
  if (!s) return null
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3])
}

// 台北(UTC+8)的「今天」,表示成 UTC 午夜 ms
export function taipeiTodayUTC(now = Date.now()): number {
  const t = new Date(now + 8 * 3600000)
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
}

export function diffDays(dueUTC: number, todayUTC: number): number {
  return Math.round((dueUTC - todayUTC) / DAY)
}

export function formatDate(utcMs: number): string {
  const d = new Date(utcMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// 對應 computeObligationDue:單次義務 trigger + 偏移 + 基準日 → 到期日(UTC ms)或 null;
// 已提送／已完成的單次義務優先讀完成當下的 due_date_snapshot(P5c:基準日事後更正不改歷史);
// 循環義務(P5b)取期次(ob.periods)最早未結一期的 due_date,不再從「今天」推算下一期。
// 沒有期次(基準日／循環規則待補、整條不適用)→ null,不臆測日期。
export function computeObligationDueUTC(ob: Obligation, anchors: Anchors): number | null {
  if (isRecurring(ob as Record<string, unknown>)) {
    const period = currentObligationPeriod(ob.periods)
    return period ? parseDateUTC(String(period.due_date ?? '')) : null
  }
  if (singleDueSnapshot(ob as Record<string, unknown>)) return parseDateUTC(ob.due_date_snapshot)
  if (ob.trigger_event === 'fixed') return parseDateUTC(ob.fixed_date)
  const base = {
    award: anchors.award_date,
    notice: anchors.notice_date,
    commencement: anchors.commencement_date,
    completion: anchors.end_date,
  }[ob.trigger_event || '']
  const b = parseDateUTC(base)
  if (b == null) return null
  return b + (ob.offset_days || 0) * (ob.offset_dir === 'before' ? -1 : 1) * DAY
}
