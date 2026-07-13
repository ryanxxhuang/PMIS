// Billing slice:估驗計價(掛在 work_items 標單脊椎上)、請款收款、預定進度 S 曲線。
import { useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase.js'
import { parseLocalDate } from '../../lib/dates.js'

// 估驗明細列(寫 DB 用):同一套「數量→百分比/金額」換算,建立期/改數量/帶入日誌三處共用。
export function valuationItemRow(wi, valuationId, cumQty, source) {
  const q = wi.quantity || 0
  return {
    valuation_id: valuationId, work_item_id: wi.id, cum_qty: cumQty,
    cum_pct: q > 0 ? (cumQty / q) * 100 : null,
    amount_cum: q > 0 ? (wi.amount || 0) * cumQty / q : 0, source,
  }
}

// 把 supabase update/delete 的回傳統一成 {error}:PostgREST 被 RLS 擋下時
// 「不回錯誤、只回空 rows」——那也是失敗,必須回報給使用者,不得偽裝成功。
// (trigger 拒絕會走 error;此函式補上 RLS 靜默過濾的那一種。)
export function mutationOutcome({ data, error }, deniedMessage) {
  if (error) return { error }
  if (!data || data.length === 0) return { error: { message: deniedMessage } }
  return { error: null }
}

export function useBillingSlice({ dbMode, currentProject, currentUser, wiMaps, log }, siteLogs) {
  // 估驗計價：每期一個物件，items 為 { [work_item_key]: 累計完成數量 }
  const [valuations, setValuations] = useState([])
  // 預定進度 S 曲線：{ start, end, months: [{ label, plannedPct }] }
  const [progressPlan, setProgressPlan] = useState(null)

  // 新增一期：期數 +1，並把前一期的累計完成% 帶過來當起點（累計往前滾）。
  // DB 全部寫成功才更新 UI;帶入前期明細失敗時把剛建的期刪掉,不留半套資料。
  const createValuation = useCallback(async (retentionPct = 5) => {
    const periodNo = valuations.length ? Math.max(...valuations.map((v) => v.period_no)) + 1 : 1
    const prev = valuations.find((v) => v.period_no === periodNo - 1)
    const id = dbMode ? crypto.randomUUID() : `VAL-${Date.now()}`
    const v = {
      id, period_no: periodNo,
      valuation_date: new Date().toLocaleDateString('zh-TW'),
      retention_pct: retentionPct, status: '草稿',
      items: prev ? { ...prev.items } : {},
    }
    if (dbMode) {
      const { error } = await supabase.from('valuations').insert({
        id, project_id: currentProject.project_id, period_no: periodNo,
        valuation_date: new Date().toISOString().slice(0, 10),
        retention_pct: retentionPct, status: '草稿', created_by: currentUser?.user_id,
      })
      if (error) return { v: null, error }
      // 把前期累計完成數量帶過來寫入 valuation_items
      const rows = Object.entries(v.items)
        .map(([key, qty]) => {
          const wi = wiMaps.byKey.get(key)
          return wi ? valuationItemRow(wi, id, qty, 'manual') : null
        }).filter(Boolean)
      if (rows.length) {
        const { error: itemsError } = await supabase.from('valuation_items').insert(rows)
        if (itemsError) {
          await supabase.from('valuations').delete().eq('id', id)
          return { v: null, error: itemsError }
        }
      }
    }
    setValuations((vs) => [...vs, v])
    log('建立估驗期', `第 ${periodNo} 期估驗`, { user: '陳怡君', role: '施工品管' })
    return { v, error: null }
  }, [valuations, dbMode, currentProject, currentUser, wiMaps, log])

  // 更新某期某工項的「累計完成數量」。
  // 打字需要即時回饋 → 先更新 UI,DB 失敗再還原「這一格」並回傳 error。
  const updateValuationItem = useCallback(async (periodId, itemKey, cumQty) => {
    const prevItems = valuations.find((v) => v.id === periodId)?.items || {}
    const hadKey = Object.prototype.hasOwnProperty.call(prevItems, itemKey)
    const prevQty = prevItems[itemKey]
    setValuations((vs) => vs.map((v) => (v.id === periodId
      ? { ...v, items: { ...v.items, [itemKey]: cumQty } }
      : v)))
    if (!dbMode) return { error: null }
    const wi = wiMaps.byKey.get(itemKey)
    if (!wi) return { error: null } // 非 DB 工項鍵(理論上不會發生);不寫 DB 也不謊報失敗
    const { error } = await supabase.from('valuation_items').upsert(
      valuationItemRow(wi, periodId, cumQty, 'manual'),
      { onConflict: 'valuation_id,work_item_id' },
    )
    if (error) {
      setValuations((vs) => vs.map((v) => {
        if (v.id !== periodId) return v
        const items = { ...v.items }
        if (hadKey) items[itemKey] = prevQty
        else delete items[itemKey]
        return { ...v, items }
      }))
      return { error }
    }
    return { error: null }
  }, [dbMode, wiMaps, valuations])

  // 狀態轉移(送審/退回/核定):DB 成功才更新 UI。extra 可帶附加欄位
  // (退回原因寫入 note——退回不留原因會削弱審查證據,第二輪 P1-01)。
  // 「已核定」相關轉移由 DB 的 valuations_guard trigger 強制(僅監造/管理者),錯誤原样回傳。
  const setValuationStatus = useCallback(async (periodId, status, extra = {}) => {
    const patch = { status, ...extra }
    if (dbMode) {
      const res = await supabase.from('valuations').update(patch).eq('id', periodId).select('id')
      const { error } = mutationOutcome(res, '狀態未更新:可能無權限或這一期已被移除')
      if (error) return { error }
    }
    setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, ...patch } : v)))
    log('估驗狀態更新', status, { user: status === '已核定' ? '王建國' : '陳怡君', role: status === '已核定' ? '監造' : '施工品管' })
    return { error: null }
  }, [dbMode, log])

  // 請款/收款:更新某期的請款日 / 收款日 / 實收金額（demo 模式只更新本機）。
  // DB 成功才更新 UI,避免撥款欄位顯示假成功。
  const updateValuationPayment = useCallback(async (id, patch) => {
    if (dbMode) {
      const res = await supabase.from('valuations').update(patch).eq('id', id).select('id')
      const { error } = mutationOutcome(res, '未寫入:可能無權限或這一期已被移除')
      if (error) return { error }
    }
    setValuations((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)))
    return { error: null }
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
    if (!dbMode) {
      setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, items: { ...v.items, ...accum } } : v)))
      return { error: null, count: Object.keys(accum).length }
    }
    // DB 全部寫成功才更新 UI
    const rows = Object.entries(accum)
      .map(([key, qty]) => {
        const wi = wiMaps.byKey.get(key)
        return wi ? valuationItemRow(wi, periodId, qty, 'daily_log') : null
      }).filter(Boolean)
    if (rows.length) {
      const { error } = await supabase.from('valuation_items').upsert(rows, { onConflict: 'valuation_id,work_item_id' })
      if (error) return { error, count: 0 }
    }
    setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, items: { ...v.items, ...accum } } : v)))
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

  // 刪除估驗期:DB 刪成功才從 UI 移除。已核定的期會被 valuation_items_guard
  // (cascade 刪明細時觸發)或 RLS 擋下——擋下時如實回報,不得從畫面上消失。
  const deleteValuation = useCallback(async (periodId) => {
    if (dbMode) {
      const res = await supabase.from('valuations').delete().eq('id', periodId).select('id')
      const { error } = mutationOutcome(res, '刪除被拒絕:可能已核定或無權限')
      if (error) return { error }
    }
    setValuations((vs) => vs.filter((v) => v.id !== periodId))
    return { error: null }
  }, [dbMode])

  return {
    valuations, setValuations, progressPlan, setProgressPlan,
    createValuation, updateValuationItem, setValuationStatus, updateValuationPayment,
    fillValuationFromSiteLogs, generateSchedule, updatePlannedPct, deleteValuation,
  }
}
