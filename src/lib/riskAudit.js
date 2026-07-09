// AI 防弊風險稽核 — 全確定性（無需後端）。機關視角：對本案跑一份稽核檢核表，
// 每項都給 pass / warn / risk 狀態＋說明，即使一切正常也回「通過」讓機關安心。
// 定位=「值得複查的異常提示」，不是指控；唯讀，只提醒、不做任何動作。
import { computeObligationDue } from './contractDue.js'

const money = (n) => `NT$ ${Math.round(n || 0).toLocaleString('en-US')}`
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

export function auditProject(data = {}, today = new Date()) {
  const { periodAmounts = [], changeOrders = [], defects = [], obligations = [], anchors = {}, billableTotal = 0, progress = null } = data
  const t0 = startOfDay(today)
  const isoToday = t0.toISOString().slice(0, 10)
  const checks = []

  // 1. 估驗計價合理性：單期本期估驗是否異常跳增（灌帳徵兆）
  let jump = null
  for (let k = 1; k < periodAmounts.length; k++) {
    const cur = periodAmounts[k].thisAmt || 0
    const prevAvg = periodAmounts.slice(0, k).reduce((s, p) => s + (p.thisAmt || 0), 0) / k
    if (prevAvg > 0 && cur > prevAvg * 2.2 && (!billableTotal || cur > billableTotal * 0.05)) {
      jump = { period: periodAmounts[k].period_no, cur, prevAvg, ratio: cur / prevAvg }; break
    }
  }
  checks.push(jump
    ? { status: 'warn', category: '估驗', title: '估驗計價：發現單期金額異常偏高', detail: `第 ${jump.period} 期本期估驗 ${money(jump.cur)}，為前期平均（${money(jump.prevAvg)}）的 ${jump.ratio.toFixed(1)} 倍，建議查核工項完成佐證與計價依據。` }
    : { status: 'pass', category: '估驗', title: '估驗計價：各期金額變化平穩，無異常跳增', detail: '逐期本期估驗金額未出現異常放大，計價節奏正常。' })

  // 2. 變更設計程序：待核定變更佔原契約比例是否偏高
  const coNet = (c) => (c.items || []).reduce((s, it) => s + (Number(it.amount_delta) || 0), 0)
  const pendingCO = changeOrders.filter((c) => c.status === '審核中' || c.status === '提出')
  const pendNet = pendingCO.reduce((s, c) => s + coNet(c), 0)
  const coRatio = billableTotal > 0 ? (pendNet / billableTotal) * 100 : 0
  checks.push(coRatio > 5
    ? { status: 'warn', category: '變更', title: '變更設計：待核定金額佔比偏高', detail: `待核定變更淨額 ${money(pendNet)}（占原契約 ${coRatio.toFixed(1)}%），建議確認採購法變更程序與比例上限。` }
    : { status: 'pass', category: '變更', title: '變更設計：待核定金額佔比在合理範圍', detail: pendingCO.length ? `待核定 ${pendingCO.length} 件、淨額 ${money(pendNet)}（占原契約 ${coRatio.toFixed(1)}%）。` : '目前無待核定變更。' })

  // 3. 品質督導落實：有無逾期未結缺失
  const openDef = defects.filter((d) => d.status !== '已結案')
  const overdueDef = openDef.filter((d) => d.due_date && d.due_date < isoToday)
  checks.push(overdueDef.length
    ? { status: 'warn', category: '品質', title: `品質督導：${overdueDef.length} 件缺失逾期未結案`, detail: `逾期未改善反映督導落實情形，建議追蹤：${overdueDef.slice(0, 3).map((d) => d.title).join('、')}。` }
    : { status: 'pass', category: '品質', title: '品質督導：無逾期未結缺失', detail: openDef.length ? `未結案 ${openDef.length} 件，均在改善期限內。` : '目前無未結案缺失。' })

  // 4. 契約義務履行：有無逾期義務（可能觸發罰則/爭議）
  const overdueOb = []
  for (const ob of obligations) {
    if (ob.status === '已完成' || ob.status === '已提送') continue
    const due = computeObligationDue(ob, anchors)
    if (due && startOfDay(due) < t0) overdueOb.push(ob)
  }
  checks.push(overdueOb.length
    ? { status: 'risk', category: '契約', title: `契約履行：${overdueOb.length} 項義務逾期`, detail: `可能觸發罰則，建議發函督促：${overdueOb.slice(0, 2).map((o) => o.title).join('、')}${overdueOb[0]?.penalty ? `（罰則：${overdueOb[0].penalty}）` : ''}。` }
    : { status: 'pass', category: '契約', title: '契約履行：無逾期義務', detail: '各項契約時程義務均在期限內。' })

  // 5. 進度落後風險
  if (progress && progress.plannedPct != null) {
    const behind = progress.plannedPct - progress.actualPct
    checks.push(behind > 5
      ? { status: 'warn', category: '進度', title: `進度：落後 ${behind.toFixed(1)}%`, detail: `實際 ${progress.actualPct.toFixed(1)}% vs 預定 ${progress.plannedPct.toFixed(1)}%，建議要求趕工或評估工期展延對契約之影響。` }
      : { status: 'pass', category: '進度', title: '進度：受控', detail: `實際 ${progress.actualPct.toFixed(1)}% vs 預定 ${progress.plannedPct.toFixed(1)}%。` })
  }

  const summary = {
    risk: checks.filter((c) => c.status === 'risk').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    pass: checks.filter((c) => c.status === 'pass').length,
    total: checks.length,
  }
  return { checks, summary }
}
