// AI 防弊風險稽核 — 全確定性（無需後端）。機關視角：對本案跑一份稽核檢核表，
// 每項都給 pass / warn / risk / na 狀態＋說明。
// 定位=「值得複查的異常提示」，不是指控；唯讀，只提醒、不做任何動作。
// 最小證據原則(QA 報告 P1-2):資料不足的項目回 na「未評估」並說明缺什麼,
// 不為了讓機關安心而給沒有證據的「通過」——沒有契約資料卻稱「無逾期義務」、
// 只有一期估驗卻稱「金額變化平穩」,都是錯誤安全感。
import { computeObligationDue } from './contractDue.js'

const money = (n) => `NT$ ${Math.round(n || 0).toLocaleString('en-US')}`
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

export function auditProject(data = {}, today = new Date()) {
  const { periodAmounts = [], changeOrders = [], defects = [], obligations = [], anchors = {}, billableTotal = 0, progress = null } = data
  const t0 = startOfDay(today)
  const isoToday = t0.toISOString().slice(0, 10)
  const checks = []

  // 1. 估驗計價合理性：單期本期估驗是否異常跳增（灌帳徵兆）；至少三期才有趨勢可言
  if (periodAmounts.length < 3) {
    checks.push({ status: 'na', category: '估驗', title: '估驗計價：期數不足，趨勢未評估', detail: `目前僅 ${periodAmounts.length} 期估驗，至少需 3 期才能判讀單期金額是否異常；累積更多期數後自動納入稽核。` })
  } else {
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
  }

  // 2. 變更設計程序：待核定變更佔原契約比例是否偏高
  const coNet = (c) => (c.items || []).reduce((s, it) => s + (Number(it.amount_delta) || 0), 0)
  const pendingCO = changeOrders.filter((c) => c.status === '審核中' || c.status === '提出')
  const pendNet = pendingCO.reduce((s, c) => s + coNet(c), 0)
  const coRatio = billableTotal > 0 ? (pendNet / billableTotal) * 100 : 0
  checks.push(billableTotal <= 0
    ? { status: 'na', category: '變更', title: '變更設計：尚無契約總額，佔比未評估', detail: '需先匯入標單（發包工程費）才能計算待核定變更占原契約的比例。' }
    : coRatio > 5
      ? { status: 'warn', category: '變更', title: '變更設計：待核定金額佔比偏高', detail: `待核定變更淨額 ${money(pendNet)}（占原契約 ${coRatio.toFixed(1)}%），建議確認採購法變更程序與比例上限。` }
      : { status: 'pass', category: '變更', title: '變更設計：待核定金額佔比在合理範圍', detail: pendingCO.length ? `待核定 ${pendingCO.length} 件、淨額 ${money(pendNet)}（占原契約 ${coRatio.toFixed(1)}%）。` : '目前無待核定變更。' })

  // 3. 品質督導落實：有無逾期未結缺失；未設期限的缺失無法判定逾期,不得宣稱「均在期限內」
  const openDef = defects.filter((d) => d.status !== '已結案')
  const overdueDef = openDef.filter((d) => d.due_date && d.due_date < isoToday)
  const noDueDef = openDef.filter((d) => !d.due_date)
  checks.push(overdueDef.length
    ? { status: 'warn', category: '品質', title: `品質督導：${overdueDef.length} 件缺失逾期未結案`, detail: `逾期未改善反映督導落實情形，建議追蹤：${overdueDef.slice(0, 3).map((d) => d.title).join('、')}。` }
    : noDueDef.length
      ? { status: 'na', category: '品質', title: `品質督導：${noDueDef.length} 件未結缺失未設改善期限，逾期與否未評估`, detail: `無期限即無法判定逾期：${noDueDef.slice(0, 3).map((d) => d.title).join('、')}。請補上改善期限後自動納入稽核。` }
      : { status: 'pass', category: '品質', title: '品質督導：無逾期未結缺失', detail: openDef.length ? `未結案 ${openDef.length} 件，均在改善期限內。` : '目前無未結案缺失。' })

  // 4. 契約義務履行：有無逾期義務（可能觸發罰則/爭議）；沒有義務資料不得宣稱「無逾期」
  if (obligations.length === 0) {
    checks.push({ status: 'na', category: '契約', title: '契約履行：尚無契約義務資料，未評估', detail: '請先在「契約與文件」上傳契約並完成履約需求擷取，才有時程義務可供稽核。' })
  } else {
    const overdueOb = []
    for (const ob of obligations) {
      if (ob.status === '已完成' || ob.status === '已提送') continue
      const due = computeObligationDue(ob, anchors)
      if (due && startOfDay(due) < t0) overdueOb.push(ob)
    }
    checks.push(overdueOb.length
      ? { status: 'risk', category: '契約', title: `契約履行：${overdueOb.length} 項義務逾期`, detail: `可能觸發罰則，建議發函督促：${overdueOb.slice(0, 2).map((o) => o.title).join('、')}${overdueOb[0]?.penalty ? `（罰則：${overdueOb[0].penalty}）` : ''}。` }
      : { status: 'pass', category: '契約', title: '契約履行：無逾期義務', detail: '各項契約時程義務均在期限內。' })
  }

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
    na: checks.filter((c) => c.status === 'na').length, // 資料不足未評估:不算通過
    total: checks.length,
  }
  return { checks, summary }
}
