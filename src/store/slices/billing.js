// Billing slice:估驗計價(掛在 work_items 標單脊椎上)、請款收款、預定進度 S 曲線。
import { useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase.js'
import { parseLocalDate } from '../../lib/dates.js'

export function useBillingSlice({ dbMode, currentProject, currentUser, wiMaps, log }, siteLogs) {
  // 估驗計價：每期一個物件，items 為 { [work_item_key]: 累計完成數量 }
  const [valuations, setValuations] = useState([])
  // 預定進度 S 曲線：{ start, end, months: [{ label, plannedPct }] }
  const [progressPlan, setProgressPlan] = useState(null)

  // 新增一期：期數 +1，並把前一期的累計完成% 帶過來當起點（累計往前滾）
  const createValuation = useCallback((retentionPct = 5) => {
    const periodNo = valuations.length ? Math.max(...valuations.map((v) => v.period_no)) + 1 : 1
    const prev = valuations.find((v) => v.period_no === periodNo - 1)
    const id = dbMode ? crypto.randomUUID() : `VAL-${Date.now()}`
    const v = {
      id, period_no: periodNo,
      valuation_date: new Date().toLocaleDateString('zh-TW'),
      retention_pct: retentionPct, status: '草稿',
      items: prev ? { ...prev.items } : {},
    }
    setValuations((vs) => [...vs, v])
    log('建立估驗期', `第 ${periodNo} 期估驗`, { user: '陳怡君', role: '施工品管' })
    if (dbMode) (async () => {
      await supabase.from('valuations').insert({
        id, project_id: currentProject.project_id, period_no: periodNo,
        valuation_date: new Date().toISOString().slice(0, 10),
        retention_pct: retentionPct, status: '草稿', created_by: currentUser?.user_id,
      })
      // 把前期累計完成數量帶過來寫入 valuation_items
      const rows = Object.entries(v.items).map(([key, qty]) => {
        const wi = wiMaps.byKey.get(key)
        if (!wi) return null
        const q = wi.quantity || 0
        return { valuation_id: id, work_item_id: wi.id, cum_qty: qty,
          cum_pct: q > 0 ? (qty / q) * 100 : null,
          amount_cum: q > 0 ? (wi.amount || 0) * qty / q : 0, source: 'manual' }
      }).filter(Boolean)
      if (rows.length) await supabase.from('valuation_items').insert(rows)
    })()
    return v
  }, [valuations, dbMode, currentProject, currentUser, wiMaps, log])

  // 更新某期某工項的「累計完成數量」
  const updateValuationItem = useCallback((periodId, itemKey, cumQty) => {
    setValuations((vs) => vs.map((v) => (v.id === periodId
      ? { ...v, items: { ...v.items, [itemKey]: cumQty } }
      : v)))
    if (dbMode) {
      const wi = wiMaps.byKey.get(itemKey)
      if (wi) {
        const q = wi.quantity || 0
        supabase.from('valuation_items').upsert(
          { valuation_id: periodId, work_item_id: wi.id, cum_qty: cumQty,
            cum_pct: q > 0 ? (cumQty / q) * 100 : null,
            amount_cum: q > 0 ? (wi.amount || 0) * cumQty / q : 0, source: 'manual' },
          { onConflict: 'valuation_id,work_item_id' },
        ).then(() => {})
      }
    }
  }, [dbMode, wiMaps])

  const setValuationStatus = useCallback((periodId, status) => {
    setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, status } : v)))
    log('估驗狀態更新', status, { user: status === '已核定' ? '王建國' : '陳怡君', role: status === '已核定' ? '監造' : '施工品管' })
    if (dbMode) supabase.from('valuations').update({ status }).eq('id', periodId).then(() => {})
  }, [dbMode, log])

  // 請款/收款:更新某期的請款日 / 收款日 / 實收金額（demo 模式只更新本機）
  const updateValuationPayment = useCallback(async (id, patch) => {
    setValuations((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)))
    if (!dbMode) return { error: null }
    const { error } = await supabase.from('valuations').update(patch).eq('id', id)
    return { error }
  }, [dbMode])

  // 把施工日誌各日數量加總，帶入某估驗期的「累計完成數量」（標 source=daily_log）
  const fillValuationFromSiteLogs = useCallback(async (periodId) => {
    const accum = {}
    for (const lg of siteLogs)
      for (const [key, q] of Object.entries(lg.items || {}))
        accum[key] = (accum[key] || 0) + (Number(q) || 0)
    // 累計不倒退：本期草擬值不得低於前期已帶入的累計（該期建立時已滾入前期值），且不超過契約數量
    const floor = valuations.find((v) => v.id === periodId)?.items || {}
    for (const key of Object.keys(accum)) {
      const wi = wiMaps.byKey.get(key)
      let val = Math.max(accum[key], Number(floor[key]) || 0)
      if (wi?.quantity) val = Math.min(val, wi.quantity)
      accum[key] = val
    }
    setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, items: { ...v.items, ...accum } } : v)))
    if (!dbMode) return { error: null, count: Object.keys(accum).length }
    const rows = Object.entries(accum).map(([key, qty]) => {
      const wi = wiMaps.byKey.get(key)
      if (!wi) return null
      const q = wi.quantity || 0
      return { valuation_id: periodId, work_item_id: wi.id, cum_qty: qty,
        cum_pct: q > 0 ? (qty / q) * 100 : null,
        amount_cum: q > 0 ? (wi.amount || 0) * qty / q : 0, source: 'daily_log' }
    }).filter(Boolean)
    if (rows.length) await supabase.from('valuation_items').upsert(rows, { onConflict: 'valuation_id,work_item_id' })
    log('估驗帶入施工日誌數量', `${rows.length} 工項`, { user: currentUser?.name || '系統', role: '施工品管' })
    return { error: null, count: rows.length }
  }, [dbMode, siteLogs, valuations, wiMaps, currentUser, log])

  // 預定進度 S 曲線。依開工/竣工切出月份桶，預設用 smoothstep 產生標準 S 曲線。
  const generateSchedule = useCallback((start, end) => {
    const s = parseLocalDate(start), e = parseLocalDate(end)
    const buckets = []
    let cur = new Date(s.getFullYear(), s.getMonth(), 1)
    const last = new Date(e.getFullYear(), e.getMonth(), 1)
    while (cur <= last) { buckets.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }
    const N = buckets.length || 1
    const smoothstep = (t) => t * t * (3 - 2 * t) // 0→1 的 S 形累計
    const months = buckets.map((d, i) => ({
      label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      plannedPct: +(smoothstep((i + 1) / N) * 100).toFixed(1),
    }))
    const plan = { start, end, months }
    setProgressPlan(plan)
    log('產生預定進度', `${start} ~ ${end}，共 ${N} 個月`, { user: '陳怡君', role: '施工品管' })
    if (dbMode) (async () => {
      await supabase.from('schedule_periods').delete().eq('project_id', currentProject.project_id)
      const rows = months.map((m) => ({ project_id: currentProject.project_id, period_label: m.label, planned_pct: m.plannedPct }))
      if (rows.length) await supabase.from('schedule_periods').insert(rows)
    })()
    return plan
  }, [dbMode, currentProject, log])

  const updatePlannedPct = useCallback((i, pct) => {
    setProgressPlan((p) => (p ? { ...p, months: p.months.map((m, idx) => (idx === i ? { ...m, plannedPct: pct } : m)) } : p))
    if (dbMode && progressPlan?.months[i]) {
      supabase.from('schedule_periods').upsert(
        { project_id: currentProject.project_id, period_label: progressPlan.months[i].label, planned_pct: pct },
        { onConflict: 'project_id,period_label' },
      ).then(() => {})
    }
  }, [dbMode, currentProject, progressPlan])

  const deleteValuation = useCallback(async (periodId) => {
    if (dbMode) await supabase.from('valuations').delete().eq('id', periodId)
    setValuations((vs) => vs.filter((v) => v.id !== periodId))
  }, [dbMode])

  return {
    valuations, setValuations, progressPlan, setProgressPlan,
    createValuation, updateValuationItem, setValuationStatus, updateValuationPayment,
    fillValuationFromSiteLogs, generateSchedule, updatePlannedPct, deleteValuation,
  }
}
