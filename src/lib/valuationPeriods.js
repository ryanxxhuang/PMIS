// 估驗期別的前端投影(P4c):把 DB 的 valuations ＋ valuation_items 列組成頁面用的期別物件。
//
// 為什麼要「往前帶」:P4b 起明細列只在「本期對該工項有增量／扣回」時存在(sync／set RPC 的
// `fn_cq_recompute_item_internal` 對 Σ來源=0 且無既有列的工項不插列),而 DB 的前期累計
// `fn_cq_prev_cum_internal` 定義是「period_no 更早、最近一期有列者的 cum_qty」。所以一期沒有列的
// 工項,其累計＝往前最近一期的值——這裡按 period_no 升冪折疊,和 DB 同一條定義;不是計算金額,
// 只是把 DB 已算好的 cum_qty／amount_cum 帶到後面的期別。P4c 之前的舊前端是建期時把前期明細
// 整批複製一份寫進 DB(客戶端數字寫入路徑,已移除),兩種做法在畫面上等價。
//
// 每期回傳:
//   items   {item_key: 累計量}    (含往前帶)
//   amounts {item_key: 累計金額}  (含往前帶;DB `amount_cum`,前端不換算)
//   own     {item_key: {cum_qty, amount_cum, backing}} 本期自己有列的工項(依據標示、來源展開用)
//   legacy_uncovered 尚未補證的歷史遷移工項數(P4d;今日工作據此把已核定期的球放到監造補證)
import { legacyUncoveredByValuation } from '../../supabase/functions/_shared/ballInCourtRules.ts'

export function projectValuationPeriods(vals, itemRows, idToKey, legacySources = []) {
  // 尚未補證的歷史遷移工項數(P4d):與早報收集器同一支共用計數
  const legacyCounts = legacyUncoveredByValuation(legacySources)
  const ownByVal = new Map((vals || []).map((v) => [v.id, {}]))
  for (const vi of itemRows || []) {
    const key = idToKey.get(vi.work_item_id)
    const own = ownByVal.get(vi.valuation_id)
    if (key == null || !own || vi.cum_qty == null) continue
    own[key] = {
      cum_qty: Number(vi.cum_qty),
      amount_cum: vi.amount_cum == null ? 0 : Number(vi.amount_cum),
      backing: vi.backing || 'legacy',
    }
  }
  const sorted = [...(vals || [])].sort((a, b) => (a.period_no - b.period_no) || String(a.id).localeCompare(String(b.id)))
  let items = {}, amounts = {}
  return sorted.map((v) => {
    const own = ownByVal.get(v.id) || {}
    items = { ...items }; amounts = { ...amounts }
    for (const [key, row] of Object.entries(own)) { items[key] = row.cum_qty; amounts[key] = row.amount_cum }
    return {
      id: v.id, period_no: v.period_no, valuation_date: v.valuation_date,
      period_start: v.period_start ?? null, period_end: v.period_end ?? null,
      retention_pct: Number(v.retention_pct), status: v.status, note: v.note ?? null,
      recheck_required: !!v.recheck_required, recheck_note: v.recheck_note ?? null,
      legacy_uncovered: legacyCounts[String(v.id)] ?? 0,
      items, amounts, own,
      invoice_date: v.invoice_date ?? null, paid_date: v.paid_date ?? null,
      paid_amount: v.paid_amount == null ? null : Number(v.paid_amount),
    }
  })
}
