import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, CheckCircle2, AlertTriangle, ShieldAlert, Sparkles, HelpCircle } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { auditProject } from '../../lib/riskAudit.js'

const TODAY = new Date()
const ST = {
  pass: { icon: CheckCircle2, c: 'var(--green-text)', bg: 'var(--green-tint)', label: '通過' },
  warn: { icon: AlertTriangle, c: 'var(--amber-text)', bg: 'var(--amber-tint)', label: '注意' },
  risk: { icon: ShieldAlert, c: 'var(--red-text)', bg: 'var(--red-tint)', label: '風險' },
  na: { icon: HelpCircle, c: 'var(--slate-text)', bg: 'var(--slate-tint)', label: '未評估' }, // 資料不足,不算通過
}

export default function RiskAudit() {
  const { project, workItems, valuations, progressPlan, changeOrders, defects, obligations,
    demoMode, workItemsSource } = useStore()
  const imported = workItemsSource === 'db' || demoMode

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

  if (!imported) {
    return (
      <div className="space-y-5">
        <PageHeader title="風險稽核" tagline="AI 防弊" subtitle="系統化檢核估驗、變更、品質、契約與進度的異常樣態" />
        <Card><Empty>此專案尚未匯入標單，無法稽核。請先到「標單工項」匯入。</Empty></Card>
      </div>
    )
  }

  const overall = summary.risk ? 'risk' : summary.warn ? 'warn' : 'pass'
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
                : overall === 'warn' ? `${summary.warn} 項需注意` : `${summary.risk} 項風險 · ${summary.warn} 項注意`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 ml-auto text-sm">
          <span className="flex items-center gap-1.5"><CheckCircle2 size={15} style={{ color: 'var(--green-text)' }} aria-hidden /><span className="num font-semibold">{summary.pass}</span> 通過</span>
          <span className="flex items-center gap-1.5"><AlertTriangle size={15} style={{ color: 'var(--amber-text)' }} aria-hidden /><span className="num font-semibold">{summary.warn}</span> 注意</span>
          <span className="flex items-center gap-1.5"><ShieldAlert size={15} style={{ color: 'var(--red-text)' }} aria-hidden /><span className="num font-semibold">{summary.risk}</span> 風險</span>
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

      <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
        <ShieldCheck size={13} className="inline align-text-bottom mr-1" aria-hidden />
        稽核結果為<b className="text-[var(--text-2)] font-medium">「值得複查的異常提示」，非違規認定</b>；供機關監督參考，實際處置請依契約與相關法令。多案時可於 <Link to="/dashboard" className="text-[var(--blue-text)] hover:underline">總覽</Link> 比較各案風險。
      </p>
    </div>
  )
}
