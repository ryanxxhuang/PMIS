import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Stat, Badge, Empty } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'

const fmt = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const yi = (n) => (n / 1e8).toFixed(2) + ' 億'
const TODAY = new Date()
const inspColor = { 待查驗: 'amber', 合格: 'green', 不合格: 'red' }
const defColor = { 開立: 'red', 改善中: 'amber', 待複查: 'blue', 已結案: 'green' }

export default function Dashboard() {
  const { project, workItems, workItemsSource, valuations, progressPlan, inspections, defects, siteLogs } = useStore()
  const imported = workItemsSource === 'db'

  const { roots, childrenMap } = useMemo(
    () => (workItems ? buildBillableTree(workItems.items) : { roots: [], childrenMap: new Map() }),
    [workItems],
  )
  const billableTotal = workItems?.meta.billable_total || 0
  const latestVal = valuations[valuations.length - 1]
  const actualCum = useMemo(
    () => (latestVal ? totalCumAmount(roots, buildCumMap(roots, childrenMap, latestVal.items)) : 0),
    [roots, childrenMap, latestVal],
  )
  const completion = billableTotal ? (actualCum / billableTotal) * 100 : 0

  const plannedNow = useMemo(() => {
    if (!progressPlan) return null
    const months = progressPlan.months, N = months.length
    const start = new Date(progressPlan.start)
    const elapsed = (TODAY.getFullYear() - start.getFullYear()) * 12 + (TODAY.getMonth() - start.getMonth()) + (TODAY.getDate() - 1) / 30
    if (elapsed <= 0) return 0
    if (elapsed >= N - 1) return months[N - 1].plannedPct
    const lo = Math.floor(elapsed), f = elapsed - lo
    return months[lo].plannedPct + (months[lo + 1].plannedPct - months[lo].plannedPct) * f
  }, [progressPlan])
  const behind = plannedNow != null ? plannedNow - completion : null

  const openDefects = defects.filter((d) => d.status !== '已結案')
  const pendingInsp = inspections.filter((i) => i.status === '待查驗')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">{project.project_name}</h1>
        <p className="text-[var(--text-2)] text-sm mt-1">
          {project.project_code} · {project.owner_name} · 施工：{project.contractor_name || '—'} · 監造：{project.supervisor_name || '—'}
        </p>
      </div>

      {!imported ? (
        <Card>
          <Empty>
            此專案尚未匯入標單。請先到「<Link to="/boq" className="text-[var(--blue)]">標單工項</Link>」上傳 PCCES 預算書 XML，
            之後估驗、進度、施工日誌、品質查驗才會有資料。
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="發包工程費" value={yi(billableTotal)} sub={`NT$ ${fmt(billableTotal)}`} color="text-[var(--blue-text)]" />
            <Stat label="累計完成度" value={`${completion.toFixed(1)}%`} sub={`累計估驗 ${fmt(actualCum)}`} color="text-emerald-600" />
            <Stat label="進度狀態"
              value={behind == null ? '—' : behind > 5 ? `落後 ${behind.toFixed(1)}%` : behind < -2 ? `超前 ${(-behind).toFixed(1)}%` : '正常'}
              sub={plannedNow == null ? '尚未設定預定進度' : `預定 ${plannedNow.toFixed(1)}% / 實際 ${completion.toFixed(1)}%`}
              color={behind != null && behind > 5 ? 'text-rose-600' : 'text-[var(--text)]'} />
            <Stat label="未結案缺失" value={openDefects.length} sub={pendingInsp.length ? `待查驗 ${pendingInsp.length}` : '無待查驗'} color={openDefects.length ? 'text-rose-600' : 'text-[var(--text)]'} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="估驗期數" value={valuations.length} sub={latestVal ? `第 ${latestVal.period_no} 期` : '尚無'} />
            <Stat label="施工日誌" value={siteLogs.length} sub="筆" />
            <Stat label="查驗紀錄" value={inspections.length} sub={`待查驗 ${pendingInsp.length}`} />
            <Stat label="缺失" value={defects.length} sub={`未結案 ${openDefects.length}`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card title="未結案缺失" action={<Link to="/quality" className="text-xs text-[var(--blue)]">品質查驗 →</Link>}>
              {openDefects.length === 0 ? <Empty>無未結案缺失</Empty> : (
                <div className="space-y-2">
                  {openDefects.slice(0, 6).map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-sm border-b border-[var(--border-2)] pb-2">
                      <span className="text-[var(--text)] truncate">{d.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {d.severity === '嚴重' && <Badge color="red">嚴重</Badge>}
                        <Badge color={defColor[d.status] || 'slate'}>{d.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="最近施工日誌" action={<Link to="/site-log" className="text-xs text-[var(--blue)]">施工日誌 →</Link>}>
              {siteLogs.length === 0 ? <Empty>尚無施工日誌</Empty> : (
                <div className="space-y-2">
                  {siteLogs.slice(0, 6).map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-sm border-b border-[var(--border-2)] pb-2">
                      <span className="text-[var(--text)] tabular-nums">{l.log_date}</span>
                      <span className="text-xs text-[var(--text-3)] truncate ml-3">{l.work_summary || `${Object.keys(l.items).length} 工項`}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
