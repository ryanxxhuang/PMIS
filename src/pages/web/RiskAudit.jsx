import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, CheckCircle2, AlertTriangle, ShieldAlert, Sparkles, HelpCircle, GitCompareArrows } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader, Button } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { auditProject } from '../../lib/riskAudit.js'
import { buildIntegrityFindings } from '../../lib/integrityAudit.js'

const TODAY = new Date()
const ST = {
  pass: { icon: CheckCircle2, c: 'var(--green-text)', bg: 'var(--green-tint)', label: '通過' },
  warn: { icon: AlertTriangle, c: 'var(--amber-text)', bg: 'var(--amber-tint)', label: '注意' },
  risk: { icon: ShieldAlert, c: 'var(--red-text)', bg: 'var(--red-tint)', label: '風險' },
  na: { icon: HelpCircle, c: 'var(--slate-text)', bg: 'var(--slate-tint)', label: '未評估' }, // 資料不足,不算通過
}

export default function RiskAudit() {
  const { project, workItems, valuations, progressPlan, changeOrders, defects, obligations,
    siteLogs, inspections, testSamples, auditSummary, demoMode, workItemsSource } = useStore()
  const imported = workItemsSource === 'db' || demoMode
  const navigate = useNavigate()
  const [ai, setAi] = useState(null)       // { opinion, recommendations }
  const [aiBusy, setAiBusy] = useState(false)

  const { roots, childrenMap } = useMemo(
    () => (workItems ? buildBillableTree(workItems.items) : { roots: [], childrenMap: new Map() }),
    [workItems],
  )
  const billableTotal = workItems?.meta.billable_total || 0

  // 逐期「本期估驗」= 累計差
  const periodAmounts = useMemo(() => {
    if (!workItems) return []
    let prev = 0
    return [...valuations].sort((a, b) => a.period_no - b.period_no).map((v) => {
      const cum = totalCumAmount(roots, buildCumMap(roots, childrenMap, v.items))
      const thisAmt = cum - prev; prev = cum
      return { period_no: v.period_no, thisAmt }
    })
  }, [workItems, valuations, roots, childrenMap])

  const actualPct = useMemo(() => {
    const latest = valuations[valuations.length - 1]
    if (!latest || !billableTotal) return 0
    return (totalCumAmount(roots, buildCumMap(roots, childrenMap, latest.items)) / billableTotal) * 100
  }, [valuations, roots, childrenMap, billableTotal])
  const plannedNow = useMemo(() => {
    if (!progressPlan) return null
    const months = progressPlan.months, N = months.length
    const start = new Date(progressPlan.start)
    const el = (TODAY.getFullYear() - start.getFullYear()) * 12 + (TODAY.getMonth() - start.getMonth()) + (TODAY.getDate() - 1) / 30
    if (el <= 0) return 0
    if (el >= N - 1) return months[N - 1].plannedPct
    const lo = Math.floor(el), f = el - lo
    return months[lo].plannedPct + (months[lo + 1].plannedPct - months[lo].plannedPct) * f
  }, [progressPlan])

  const anchors = { award_date: project?.award_date, notice_date: project?.notice_date, commencement_date: project?.commencement_date, end_date: project?.end_date }
  const { checks, summary } = useMemo(() => auditProject({
    periodAmounts, changeOrders, defects, obligations, anchors, billableTotal,
    progress: { actualPct, plannedPct: plannedNow },
  }, TODAY), [periodAmounts, changeOrders, defects, obligations, billableTotal, actualPct, plannedNow]) // eslint-disable-line react-hooks/exhaustive-deps

  // 文件勾稽鏈:逐工項跨文件對帳(全確定性)。以 item_key 為鍵串接估驗/日誌;查驗以 id→key。
  const integrity = useMemo(() => {
    if (!workItems) return { findings: [], summary: { risk: 0, warn: 0 } }
    const idToKey = new Map(workItems.items.filter((it) => it.id).map((it) => [it.id, it.item_key]))
    const leaves = workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childrenMap.get(it.item_key)?.length))
    const loggedQty = new Map()
    for (const lg of siteLogs) for (const [k, q] of Object.entries(lg.items || {})) loggedQty.set(k, (loggedQty.get(k) || 0) + (Number(q) || 0))
    const latest = [...valuations].sort((a, b) => a.period_no - b.period_no).slice(-1)[0]
    const billedQty = new Map(Object.entries(latest?.items || {}).map(([k, v]) => [k, Number(v) || 0]))
    const inspStatusByItem = new Map() // inspections 已依 created_at desc → 第一個=最近
    for (const ins of inspections) { const key = idToKey.get(ins.work_item_id); if (key && !inspStatusByItem.has(key)) inspStatusByItem.set(key, ins.status) }
    const concreteKeys = new Set(leaves.filter((it) => (it.description || '').includes('混凝土')).map((it) => it.item_key))
    const pourSet = new Set()
    for (const lg of siteLogs) if (lg.log_date && Object.entries(lg.items || {}).some(([k, q]) => concreteKeys.has(k) && (Number(q) || 0) > 0)) pourSet.add(lg.log_date)
    return buildIntegrityFindings({ leaves, loggedQty, billedQty, inspStatusByItem, pourDates: [...pourSet].map((date) => ({ date })), testSamples })
  }, [workItems, childrenMap, siteLogs, valuations, inspections, testSamples])

  const genAudit = async () => {
    setAiBusy(true)
    const { error, result } = await auditSummary({ project_name: project?.project_name, findings: integrity.findings, summary: integrity.summary })
    setAiBusy(false)
    if (!error && result) setAi(result)
  }

  if (!imported) {
    return (
      <div className="space-y-5">
        <PageHeader title="風險稽核" tagline="AI 防弊" subtitle="系統化檢核估驗、變更、品質、契約與進度的異常樣態" />
        <Card><Empty>此專案尚未匯入標單，無法稽核。請先到「標單工項」匯入。</Empty></Card>
      </div>
    )
  }

  const totRisk = summary.risk + integrity.summary.risk
  const totWarn = summary.warn + integrity.summary.warn
  const overall = totRisk ? 'risk' : totWarn ? 'warn' : 'pass'
  const O = ST[overall]

  return (
    <div className="space-y-5">
      <PageHeader title="風險稽核" tagline="AI 防弊"
        subtitle="系統化檢核本案的估驗、變更、品質、契約與進度，標出值得複查的異常" />

      {/* 稽核結果總覽 */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-2)] shadow-[0_1px_2px_rgba(22,32,43,.03)] p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl grid place-items-center shrink-0" style={{ background: O.bg, color: O.c }}><O.icon size={24} aria-hidden /></span>
          <div>
            <div className="text-[11px] tracking-[0.04em] text-[var(--text-3)]">稽核結果</div>
            <div className="text-lg font-semibold text-[var(--text)]">
              {overall === 'pass'
                ? (summary.na ? `未發現異常（${summary.na} 項資料不足未評估）` : '本案未發現明顯異常')
                : overall === 'warn' ? `${totWarn} 項需注意` : `${totRisk} 項風險 · ${totWarn} 項注意`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 ml-auto text-sm">
          <span className="flex items-center gap-1.5"><CheckCircle2 size={15} style={{ color: 'var(--green-text)' }} aria-hidden /><span className="num font-semibold">{summary.pass}</span> 通過</span>
          <span className="flex items-center gap-1.5"><AlertTriangle size={15} style={{ color: 'var(--amber-text)' }} aria-hidden /><span className="num font-semibold">{totWarn}</span> 注意</span>
          <span className="flex items-center gap-1.5"><ShieldAlert size={15} style={{ color: 'var(--red-text)' }} aria-hidden /><span className="num font-semibold">{totRisk}</span> 風險</span>
          {summary.na > 0 && <span className="flex items-center gap-1.5"><HelpCircle size={15} style={{ color: 'var(--slate-text)' }} aria-hidden /><span className="num font-semibold">{summary.na}</span> 未評估</span>}
        </div>
      </div>

      {/* 檢核明細 */}
      <Card title="稽核檢核表" bodyClass="p-0"
        action={<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]"><Sparkles size={12} aria-hidden />自動檢核</span>}>
        <ul className="divide-y divide-[var(--border-2)]">
          {checks.map((c, i) => {
            const s = ST[c.status]
            return (
              <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ background: s.bg, color: s.c }}><s.icon size={17} aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text)]">{c.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: s.bg, color: s.c }}>{s.label}</span>
                  </div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5 leading-relaxed">{c.detail}</div>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      {/* 文件勾稽鏈:逐工項跨文件對帳(全確定性) */}
      <Card title="文件勾稽鏈" bodyClass="p-0"
        action={<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]"><GitCompareArrows size={12} aria-hidden />估驗 ↔ 日誌 ↔ 查驗 ↔ 試體 對帳</span>}>
        {integrity.findings.length === 0 ? (
          <div className="px-5 py-6"><Empty>估驗、施工日誌、查驗與試體之間未發現對不起來之處（已勾稽 {integrity.summary.checked || 0} 項計價工項）。</Empty></div>
        ) : (
          <ul className="divide-y divide-[var(--border-2)]">
            {integrity.findings.map((c, i) => {
              const s = ST[c.status]
              return (
                <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                  <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ background: s.bg, color: s.c }}><s.icon size={17} aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[var(--text)]">{c.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: s.bg, color: s.c }}>{s.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-3)]">{c.category}</span>
                    </div>
                    <div className="text-xs text-[var(--text-3)] mt-0.5 leading-relaxed">{c.detail}</div>
                    {c.route && <button onClick={() => navigate(c.route)} className="text-[11px] text-[var(--blue-text)] hover:underline mt-1">前往查核 →</button>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* AI 稽核意見:只根據上方確定性發現撰寫 */}
      <Card title="AI 稽核意見" action={
        <Button variant="secondary" onClick={genAudit} disabled={aiBusy}>
          <Sparkles size={14} aria-hidden />{aiBusy ? '產生中…' : ai ? '重新產生' : '產生稽核意見'}
        </Button>
      }>
        {!ai ? (
          <p className="text-xs text-[var(--text-3)]">依上方勾稽發現一鍵生成可交件的稽核意見摘要與建議事項；AI 只根據系統確定性發現撰寫，不臆造未列出的問題。</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-2)] leading-relaxed whitespace-pre-line">{ai.opinion}</p>
            {ai.recommendations?.length > 0 && (
              <div>
                <div className="text-xs font-medium text-[var(--text-2)] mb-1">建議事項</div>
                <ul className="list-decimal list-inside space-y-1 text-sm text-[var(--text-2)]">
                  {ai.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
        <ShieldCheck size={13} className="inline align-text-bottom mr-1" aria-hidden />
        稽核結果為<b className="text-[var(--text-2)] font-medium">「值得複查的異常提示」，非違規認定</b>；供機關監督參考，實際處置請依契約與相關法令。多案時可於 <Link to="/dashboard" className="text-[var(--blue-text)] hover:underline">總覽</Link> 比較各案風險。
      </p>
    </div>
  )
}
