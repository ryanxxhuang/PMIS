// AI 助理 — 主動觀察引擎（全確定性，無需後端；demo/real 都能跑）。
// 掃全案資料，產出「AI 幫你先看到的事」。刻意只做「發現與提醒」，不做任何動作（唯讀）。
// 每項：{ id, sev:'risk'|'watch'|'ok', roles:[...], tag, title, detail, to }
import { pendingSamplesFromLogs, sampleAlerts } from './qc.js'
import { computeObligationDue } from './contractDue.js'
import { parseLocalDate } from './dates.js'

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000)
const money = (n) => `NT$ ${Math.round(n || 0).toLocaleString('en-US')}`

export function buildInsights(data = {}, today = new Date()) {
  const {
    progress = null, siteLogs = [], defects = [], testSamples = [],
    obligations = [], valuations = [], changeOrders = [], anchors = {},
  } = data
  const t0 = startOfDay(today)
  const out = []

  // 1. 進度落後（要徑提醒）
  if (progress && progress.plannedPct != null && progress.actualPct != null) {
    const behind = progress.plannedPct - progress.actualPct
    if (behind > 5) out.push({
      id: 'progress-behind', sev: 'risk', roles: ['contractor', 'supervisor', 'owner'], tag: '進度',
      title: `進度落後 ${behind.toFixed(1)}%`,
      detail: `累計實際 ${progress.actualPct.toFixed(1)}%、預定 ${progress.plannedPct.toFixed(1)}%。建議檢視要徑工項並研擬趕工／必要時辦理工期展延。`,
      to: '/progress',
    })
  }

  // 2. 該查未查：混凝土澆置尚未建立取樣試體（把三級品管第二級變主動）
  const pendingSamples = pendingSamplesFromLogs(siteLogs, testSamples)
  if (pendingSamples.length) out.push({
    id: 'pending-samples', sev: 'watch', roles: ['contractor', 'supervisor'], tag: '品管',
    title: `${pendingSamples.length} 筆混凝土澆置尚未取樣`,
    detail: `施工日誌有澆置紀錄但查無對應抗壓試體：${pendingSamples.slice(0, 3).map((p) => p.sampled_date).join('、')}${pendingSamples.length > 3 ? '…' : ''}。建議補建試體並排 7／28 天齡期。`,
    to: '/quality',
  })

  // 3. 試體逾期未試驗
  const overdueSamples = sampleAlerts(testSamples, t0).filter((a) => a.days < 0)
  if (overdueSamples.length) out.push({
    id: 'overdue-samples', sev: 'risk', roles: ['contractor', 'supervisor'], tag: '試驗',
    title: `${overdueSamples.length} 組試體逾期未試驗`,
    detail: overdueSamples.slice(0, 3).map((a) => `${a.sample.sample_no} ${a.label}（逾期 ${-a.days} 天）`).join('、'),
    to: '/quality',
  })

  // 4. 缺失逾期未改善
  const overdueDefects = defects.filter((d) => d.status !== '已結案' && d.due_date && dayDiff(t0, parseLocalDate(d.due_date)) > 0)
  if (overdueDefects.length) out.push({
    id: 'overdue-defects', sev: 'risk', roles: ['contractor', 'supervisor', 'owner'], tag: '缺失',
    title: `${overdueDefects.length} 件缺失逾期未結案`,
    detail: overdueDefects.slice(0, 3).map((d) => d.title).join('、'),
    to: '/quality',
  })

  // 5. 契約義務逾期／即將到期（綁罰則）
  for (const ob of obligations) {
    if (ob.status === '已完成' || ob.status === '已提送') continue
    const due = computeObligationDue(ob, anchors)
    if (!due) continue
    const dd = dayDiff(due, t0)
    if (dd < 0) out.push({
      id: `ob-${ob.id || ob.title}`, sev: 'risk', roles: ['contractor', 'owner'], tag: '契約',
      title: `契約義務逾期：${ob.title}`,
      detail: `逾期 ${-dd} 天${ob.penalty ? `。罰則：${ob.penalty}` : ''}`,
      to: '/contract',
    })
    else if (dd <= 7) out.push({
      id: `ob-${ob.id || ob.title}`, sev: 'watch', roles: ['contractor', 'owner'], tag: '契約',
      title: `契約義務即將到期：${ob.title}`,
      detail: `還有 ${dd} 天到期${ob.penalty ? `。逾期罰則：${ob.penalty}` : ''}`,
      to: '/contract',
    })
  }

  // 6. 已請款未收款（現金流）
  const unpaid = valuations.filter((v) => v.status === '已核定' && v.invoice_date && !v.paid_date)
  if (unpaid.length) out.push({
    id: 'unpaid', sev: 'watch', roles: ['contractor', 'owner'], tag: '現金流',
    title: `${unpaid.length} 期已請款、尚未收款`,
    detail: `已核定並請款（第 ${unpaid.map((v) => v.period_no).join('、')} 期），待機關撥款。`,
    to: '/payments',
  })

  // 7. 防弊／異常（機關視角）：變更待核定淨額
  const pendingCO = changeOrders.filter((c) => c.status === '審核中' || c.status === '提出')
  if (pendingCO.length) {
    const net = pendingCO.reduce((s, c) => s + (c.items || []).reduce((a, it) => a + (Number(it.amount_delta) || 0), 0), 0)
    out.push({
      id: 'pending-co', sev: 'watch', roles: ['owner', 'supervisor'], tag: '變更',
      title: `${pendingCO.length} 件變更設計待核定`,
      detail: `待核定淨額 ${money(net)}。核定前留意採購法變更程序與契約金額比例。`,
      to: '/change-orders',
    })
  }

  return out
}

// 依角色過濾 + 依嚴重度排序（risk → watch）
export function insightsForRole(insights, org) {
  const rank = { risk: 0, watch: 1, ok: 2 }
  return insights
    .filter((i) => !org || !i.roles || i.roles.includes(org))
    .sort((a, b) => (rank[a.sev] ?? 3) - (rank[b.sev] ?? 3))
}
