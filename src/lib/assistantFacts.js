// AI copilot 的「事實快照」——把本案各模組摘要成一份結構化 JSON,送給 edge fn 的
// Claude 當作「唯一可引用的資料來源」。設計要點:
//   ①每個模組「恆在」(有無資料都列,附 has 旗標)——這樣被問跨模組彙整時,AI
//     一定看得到每一區,不會像關鍵字版只回一個模組(修 R4 P2-03)。
//   ②只放摘要與關鍵值(不放原始大陣列),控 token、也逼 AI 從已算好的數字回答
//     (不自己算 → 不幻覺)。③附 sourceRoutes,讓 AI 引用真實路由。
import { computeObligationDue } from './contractDue.js'
import { pendingSamplesFromLogs } from './qc.js'
import { rainDayCount } from './weatherMetrics.js'

const r1 = (n) => (n == null || isNaN(n) ? null : Math.round(n * 10) / 10)
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d)

// AI 可引用的路由白名單(label → hash 路由;edge fn 只准從這裡挑 sources)
export const SOURCE_ROUTES = {
  進度: '/progress', 施工日誌: '/site-log', 估驗計價: '/valuation', 請款收款: '/payments',
  品質查驗: '/quality', 工安管理: '/safety', 送審文件: '/submittals', 工程疑義: '/rfi',
  變更設計: '/change-orders', 驗收結算: '/acceptance', 契約與文件: '/contract',
  施工月報: '/monthly-report', 提醒中心: '/alerts',
}

export function buildAssistantFacts(d = {}, today = new Date()) {
  const t0 = iso(today)
  const {
    project = {}, progress = {}, finance = {}, valuations = [], defects = [], inspections = [],
    siteLogs = [], testSamples = [], obligations = [], changeOrders = [], submittals = [], rfis = [],
    safetyRecords = [], acceptanceEvents = [], anchors = {}, myItems = [], org = 'contractor',
  } = d

  // 金流逐期摘要
  const periods = [...valuations].sort((a, b) => a.period_no - b.period_no).map((v) => ({
    期: v.period_no, 狀態: v.status,
    請款日: v.invoice_date || null, 收款日: v.paid_date || null, 實收: v.paid_amount ?? null,
  }))
  const unpaid = valuations.filter((v) => v.status === '已核定' && v.invoice_date && !v.paid_date)

  // 品質:查驗、缺失(統一引擎,分 domain)、試體
  const openDef = defects.filter((x) => x.status !== '已結案')
  const overdueDef = openDef.filter((x) => x.due_date && x.due_date < t0)
  const noDueDef = openDef.filter((x) => !x.due_date)
  const qDef = openDef.filter((x) => (x.domain || 'quality') === 'quality')
  const sDef = openDef.filter((x) => x.domain === 'safety')
  const pendingSamples = pendingSamplesFromLogs(siteLogs, testSamples)
  const failedSamples = testSamples.filter((s) => s.status === '不合格')
  const due28 = testSamples.filter((s) => s.d28_due && !(s.d28_values && s.d28_values.length) && s.d28_due >= t0)

  // 契約義務(逾期/即將到期)
  const obl = obligations.map((o) => ({ o, due: computeObligationDue(o, anchors) }))
  const overdueObl = obl.filter((x) => x.due && iso(x.due) < t0 && !['已完成', '已提送'].includes(x.o.status))

  // 驗收:目前進行到哪一關
  const lastAccept = [...acceptanceEvents].sort((a, b) => (a.event_date || '').localeCompare(b.event_date || '')).pop()

  const coApprovedNet = changeOrders.filter((c) => c.status === '核准')
    .reduce((s, c) => s + (c.items || []).reduce((t, it) => t + (Number(it.amount_delta) || 0), 0), 0)

  return {
    今日: t0,
    我的角色: org, // contractor|supervisor|owner
    專案: { 名稱: project.project_name, 代碼: project.project_code || null,
      機關: project.owner_name, 廠商: project.contractor_name, 監造: project.supervisor_name,
      開工: project.commencement_date || null, 竣工: project.end_date || null },
    進度: { has: progress.actualPct != null, 實際百分比: r1(progress.actualPct),
      預定百分比: r1(progress.plannedPct), 落後百分比: progress.plannedPct != null ? r1(progress.plannedPct - progress.actualPct) : null },
    金流: { has: valuations.length > 0, 發包工程費: finance.billableTotal ?? null,
      累計估驗: finance.actualCum != null ? Math.round(finance.actualCum) : null,
      期數: valuations.length, 逐期: periods, 已請款未收款期: unpaid.map((v) => v.period_no) },
    品質: { has: inspections.length + defects.length + testSamples.length > 0,
      待查驗: inspections.filter((i) => i.status === '待查驗').length,
      未結缺失: qDef.length, 逾期缺失: overdueDef.length, 未設期限缺失: noDueDef.length,
      未結缺失清單: qDef.slice(0, 5).map((x) => ({ 標題: x.title, 狀態: x.status, 期限: x.due_date || null })),
      漏取樣澆置: pendingSamples.length, 試體不合格: failedSamples.length,
      即將到期試驗: due28.length },
    工安: { has: safetyRecords.length > 0, 未結工安缺失: sDef.length,
      本月自主檢查: safetyRecords.filter((s) => s.record_type === '自主檢查' && (s.record_date || '').startsWith(t0.slice(0, 7))).length },
    送審: { has: submittals.length > 0, 待審: submittals.filter((s) => s.status === '已提送' || s.status === '審核中').length,
      清單: submittals.slice(0, 6).map((s) => ({ 編號: s.submittal_no, 名稱: s.title, 狀態: s.status })) },
    工程疑義: { has: rfis.length > 0, 待回覆: rfis.filter((x) => x.status === '待回覆').length },
    變更設計: { has: changeOrders.length > 0, 件數: changeOrders.length,
      已核准淨增減: Math.round(coApprovedNet),
      待核定件: changeOrders.filter((c) => c.status === '提出' || c.status === '審核中').length },
    驗收: { has: acceptanceEvents.length > 0, 最新階段: lastAccept ? { 階段: lastAccept.stage_key, 日期: lastAccept.event_date, 結果: lastAccept.result || null } : null },
    契約義務: { has: obligations.length > 0, 總數: obligations.length, 逾期: overdueObl.length,
      逾期清單: overdueObl.slice(0, 4).map((x) => ({ 事項: x.o.title, 到期: iso(x.due), 罰則: x.o.penalty || null })) },
    待我處理: myItems.map((it) => ({ 類型: it.tag, 標題: it.title, 狀態: it.meta, 連結: it.to })),
    可引用路由: SOURCE_ROUTES,
  }
}
