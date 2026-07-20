import { useMemo, useState } from 'react'
import { Printer, Sparkles } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader, Button, Badge } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate } from '../../lib/dates.js'
import { buildSupervisorReport } from '../../lib/supervisorReport.js'

// 每次呼叫取「今天」(B-11):模組層常數會讓長開分頁凍結在開頁那天
const curMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

function Section({ n, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1 h-4 rounded-full bg-[var(--blue)]" />
        <h3 className="text-sm font-semibold text-[var(--text)]">{n}、{title}</h3>
      </div>
      <div className="pl-3">{children}</div>
    </div>
  )
}
const Kv = ({ k, v }) => (<div className="text-sm"><span className="text-[var(--text-3)]">{k}：</span><span className="text-[var(--text)]">{v}</span></div>)

export default function SupervisorReport() {
  const { project, workItems, valuations, progressPlan, siteLogs, inspections, defects, submittals,
    demoMode, workItemsSource, adjustedItems, revisedTotal } = useStore()
  const [month, setMonth] = useState(curMonth)
  const [opinion, setOpinion] = useState(null) // null=用草稿；字串=已編輯
  const imported = workItemsSource === 'db' || demoMode
  const TODAY = new Date()

  // 財務單一真相層(B-02):監造報表進度與估驗/進度頁一致(含已核准變更)
  const { roots, childrenMap } = useMemo(
    () => (workItems ? buildBillableTree(adjustedItems) : { roots: [], childrenMap: new Map() }),
    [workItems, adjustedItems],
  )
  const billableTotal = workItems ? revisedTotal : 0
  const latestVal = valuations[valuations.length - 1]
  const actualPct = useMemo(() => {
    if (!latestVal || !billableTotal) return 0
    return (totalCumAmount(roots, buildCumMap(roots, childrenMap, latestVal.items)) / billableTotal) * 100
  }, [roots, childrenMap, latestVal, billableTotal])
  const plannedNow = useMemo(() => {
    if (!progressPlan) return null
    const months = progressPlan.months, N = months.length
    const start = parseLocalDate(progressPlan.start)
    const el = (TODAY.getFullYear() - start.getFullYear()) * 12 + (TODAY.getMonth() - start.getMonth()) + (TODAY.getDate() - 1) / 30
    if (el <= 0) return 0
    if (el >= N - 1) return months[N - 1].plannedPct
    const lo = Math.floor(el), f = el - lo
    return months[lo].plannedPct + (months[lo + 1].plannedPct - months[lo].plannedPct) * f
  }, [progressPlan])

  const r = useMemo(() => buildSupervisorReport({
    project, siteLogs, inspections, defects, submittals,
    progress: { actualPct, plannedPct: plannedNow },
  }, month), [project, siteLogs, inspections, defects, submittals, actualPct, plannedNow, month])

  if (!imported) {
    return (
      <div className="space-y-5">
        <PageHeader title="監造報表" tagline="AI 草擬" subtitle="自動彙整本月查驗、缺失、送審與進度，產出監造報表草稿" />
        <Card><Empty>此專案尚未匯入標單，無法彙整監造報表。請先到「標單工項」匯入。</Empty></Card>
      </div>
    )
  }

  const behind = plannedNow != null ? plannedNow - actualPct : null
  const opinionText = opinion ?? r.opinion

  return (
    <div className="space-y-5">
      <PageHeader title="監造報表" tagline="AI 草擬"
        subtitle="自動彙整本月查驗、缺失、送審與進度 → 監造報表草稿，覆核後列印"
        action={
          <div className="flex items-center gap-2 print:hidden">
            <input type="month" value={month} aria-label="報表月份" onChange={(e) => { setMonth(e.target.value); setOpinion(null) }}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--blue)]" />
            <Button onClick={() => window.print()}><Printer size={15} aria-hidden />列印 / 存 PDF</Button>
          </div>
        } />

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border-card)] [box-shadow:var(--shadow-card)] p-6 md:p-8 print:border-0 print:shadow-none print:p-0 space-y-6 text-[var(--text)]">
        <div className="text-center border-b border-[var(--border)] pb-4">
          <div className="text-lg font-bold">監造報表</div>
          <div className="text-sm text-[var(--text-2)] mt-0.5">{project.project_name}</div>
          <div className="text-xs text-[var(--text-3)] mt-1 num">報告月份：{r.monthLabel}　·　監造單位：{project.supervisor_name || '—'}</div>
        </div>

        <Section n="一" title="工程概況">
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
            <Kv k="機關" v={project.owner_name} />
            <Kv k="承包廠商" v={project.contractor_name} />
            <Kv k="開工日" v={project.start_date || '—'} />
            <Kv k="預定竣工" v={project.end_date || '—'} />
          </div>
        </Section>

        <Section n="二" title="施工進度督導">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span>累計實際 <b className="num text-[var(--blue-text)]">{actualPct.toFixed(1)}%</b></span>
            {plannedNow != null && <span>累計預定 <b className="num">{plannedNow.toFixed(1)}%</b></span>}
            {behind != null && <Badge color={behind > 5 ? 'red' : behind < -2 ? 'blue' : 'green'}>{behind > 5 ? `落後 ${behind.toFixed(1)}%` : behind < -2 ? `超前 ${(-behind).toFixed(1)}%` : '進度正常'}</Badge>}
            {/* 雨天恆顯示(含 0):兩報表要能對值(P1-07) */}
            <span className="text-[var(--text-3)]">本月施工 {r.logs.workDays} 日（雨天 {r.logs.rainDays} 日）</span>
          </div>
        </Section>

        <Section n="三" title="查驗辦理情形">
          <div className="text-sm mb-2">本月辦理查驗 <b className="num">{r.inspections.total}</b> 件：合格 {r.inspections.pass}、不合格 {r.inspections.fail}；目前待查驗 {r.inspections.pending} 件。</div>
          {r.inspections.list.length > 0 && (
            <ul className="text-sm text-[var(--text-2)] space-y-0.5">
              {r.inspections.list.slice(0, 8).map((i, k) => (
                <li key={k} className="flex items-center gap-2">
                  <span className="num text-[var(--text-3)] text-xs w-24 shrink-0">{i.requested_date || ''}</span>
                  <span className="truncate">{i.title}</span>
                  <Badge color={i.status === '合格' ? 'green' : i.status === '不合格' ? 'red' : 'amber'}>{i.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section n="四" title="品質缺失督導">
          <div className="text-sm mb-2">目前未結案缺失 <b className="num">{r.defects.openCount}</b> 件{r.defects.overdue ? `（逾期 ${r.defects.overdue} 件）` : ''}；本月複查結案 {r.defects.closedThisMonth} 件。</div>
          {r.defects.open.length > 0 && (
            <ul className="text-sm text-[var(--text-2)] space-y-0.5">
              {r.defects.open.slice(0, 6).map((d, k) => (
                <li key={k} className="flex items-center gap-2"><span className="truncate">{d.title}</span><Badge color={d.status === '開立' ? 'red' : d.status === '待複查' ? 'blue' : 'amber'}>{d.status}</Badge>{d.due_date && <span className="text-xs text-[var(--text-3)] num">期限 {d.due_date}</span>}</li>
              ))}
            </ul>
          )}
        </Section>

        <Section n="五" title="送審文件審核">
          <div className="text-sm">本月審定 <b className="num">{r.submittals.decidedCount}</b> 件；尚有 {r.submittals.pending} 件審核中。</div>
        </Section>

        <Section n="六" title="監造意見與建議">
          <textarea value={opinionText} onChange={(e) => setOpinion(e.target.value)} rows={5}
            className="w-full text-sm leading-relaxed bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 focus:outline-none focus:border-[var(--blue)] print:border-0 print:px-0 resize-y" />
          <div className="text-[11px] text-[var(--text-3)] mt-1 print:hidden flex items-center gap-1">
            <Sparkles size={12} aria-hidden />AI 依本月數據草擬，請監造覆核修改後再列印用印。
          </div>
        </Section>

        <div className="grid sm:grid-cols-3 gap-6 pt-6 text-center text-xs text-[var(--text-2)]">
          {['監造人員', '監造主管', '機關代表'].map((role) => (
            <div key={role}><div className="border-t border-[var(--text-3)] pt-1 mt-8">{role}</div></div>
          ))}
        </div>
      </div>
    </div>
  )
}
