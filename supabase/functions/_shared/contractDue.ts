// src/lib/contractDue.js 的伺服器端移植(Deno / Edge Function 用)。
// 差異:全部以「UTC 純日期(ms)」運算 — 伺服器時區未知,不能用本地 Date;
// 「今天」以台北時間(UTC+8)為準。若改動判斷邏輯,兩邊要同步。

export interface Obligation {
  trigger_event?: string | null
  offset_days?: number | null
  offset_dir?: string | null
  fixed_date?: string | null
  recurring?: string | null
  recurring_day?: number | null
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

// 對應 computeObligationDue:trigger + 規則 + 基準日 → 到期日(UTC ms)或 null
export function computeObligationDueUTC(ob: Obligation, anchors: Anchors, todayUTC: number): number | null {
  if (ob.trigger_event === 'fixed') return parseDateUTC(ob.fixed_date)
  if (ob.recurring === 'monthly' && ob.recurring_day) {
    const t = new Date(todayUTC)
    let d = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), ob.recurring_day)
    if (d < todayUTC) d = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, ob.recurring_day)
    return d
  }
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
