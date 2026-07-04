import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate } from '../../lib/dates.js'

const fmt = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const yi = (n) => (n / 1e8).toFixed(2) + ' 億'
const TODAY = new Date()
const todayISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`
const inspColor = { 待查驗: 'amber', 合格: 'green', 不合格: 'red' }
const defColor = { 開立: 'red', 改善中: 'amber', 待複查: 'blue', 已結案: 'green' }

export default function Dashboard() {
  const { project, workItems, workItemsSource, demoMode, valuations, progressPlan, inspections, defects, siteLogs } = useStore()
  const imported = workItemsSource === 'db' || demoMode

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
    const start = parseLocalDate(progressPlan.start)
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
    <div className="space-y-5">
      <PageHeader
        title={project.project_name}
        subtitle={`${project.owner_name} · 施工：${project.contractor_name || '—'} · 監造：${project.supervisor_name || '—'}`}
        meta={[
          { k: '工程代碼', v: project.project_code || '—' },
          { k: '日期', v: todayISO },
        ]}
      />

      {!imported ? (
        <Card>
          <Empty>
            此專案尚未匯入標單。請先到「<Link to="/boq" className="text-[var(--blue)]">標單工項</Link>」上傳 PCCES 預算書 XML，
            之後估驗、進度、施工日誌、品質查驗才會有資料。
          </Empty>
        </Card>
      ) : (
        <>
          {/* 進度主橫幅:整個 dashboard 唯一的大聲量——落後就該像工地的橘色警示 */}
          <div className="bg-[var(--surface)] rounded-lg g-elevation-1 grid md:grid-cols-[1fr_auto]">
            <div className="px-5 py-4 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-[11px] tracking-[0.06em] text-[var(--text-3)]">累計實際進度</span>
                <span className="num text-4xl font-semibold text-[var(--text)] leading-none">
                  {completion.toFixed(1)}<span className="text-xl text-[var(--text-2)]">%</span>
                </span>
                {plannedNow != null && (
                  <span className="text-sm text-[var(--text-2)] num">預定 {plannedNow.toFixed(1)}%</span>
                )}
                {behind != null && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-[3px] text-sm font-semibold num ${
                    behind > 5 ? 'bg-[var(--accent-tint)] text-[var(--accent-text)]'
                    : behind < -2 ? 'bg-[var(--green-tint)] text-[var(--green-text)]'
                    : 'bg-[var(--slate-tint)] text-[var(--slate-text)]'
                  }`}>
                    {behind > 5 ? `▲ 落後 ${behind.toFixed(1)}%` : behind < -2 ? `超前 ${(-behind).toFixed(1)}%` : '進度正常'}
                  </span>
                )}
              </div>
              {/* 進度條:藍=實際完成;墨線刻度=今日預定 */}
              <div className="relative h-2 rounded-sm bg-[var(--surface-2)] mt-3.5 overflow-visible">
                <div className="absolute inset-y-0 left-0 rounded-sm bg-[var(--blue)]" style={{ width: `${Math.min(100, completion)}%` }} />
                {plannedNow != null && (
                  <div className="absolute -top-1 -bottom-1 w-[2px] bg-[var(--text)]" style={{ left: `${Math.min(100, plannedNow)}%` }} title={`今日預定 ${plannedNow.toFixed(1)}%`} />
                )}
              </div>
              <div className="text-[11px] text-[var(--text-3)] mt-1.5">▎藍條＝實際完成　▏墨線＝今日預定{plannedNow == null ? '（尚未設定預定進度）' : ''}</div>
            </div>
            <div className="flex md:flex-col justify-around md:justify-center gap-1 border-t md:border-t-0 md:border-l border-[var(--border-2)] px-5 py-3 md:min-w-[220px]">
              <div>
                <div className="text-[10px] tracking-[0.08em] text-[var(--text-3)]">發包工程費</div>
                <div className="num text-base font-medium text-[var(--blue-text)]">NT$ {fmt(billableTotal)}</div>
              </div>
              <div>
                <div className="text-[10px] tracking-[0.08em] text-[var(--text-3)]">累計估驗</div>
                <div className="num text-base font-medium text-[var(--text)]">NT$ {fmt(actualCum)}</div>
              </div>
            </div>
          </div>

          {/* 次要計數:一條資訊帶,不再是四張大卡 */}
          <div className="bg-[var(--surface)] rounded-lg g-elevation-1 grid grid-cols-2 md:grid-cols-4 divide-x divide-[var(--border-2)] max-md:[&>*:nth-child(n+3)]:border-t max-md:[&>*:nth-child(even)]:border-l max-md:[&>*]:border-[var(--border-2)] max-md:divide-x-0">
            {[
              { label: '估驗期數', value: valuations.length, sub: latestVal ? `第 ${latestVal.period_no} 期` : '尚無', to: '/valuation' },
              { label: '施工日誌', value: siteLogs.length, sub: '筆', to: '/site-log' },
              { label: '查驗紀錄', value: inspections.length, sub: pendingInsp.length ? `待查驗 ${pendingInsp.length}` : '無待查驗', to: '/quality', warn: pendingInsp.length > 0 },
              { label: '缺失', value: defects.length, sub: openDefects.length ? `未結案 ${openDefects.length}` : '全數結案', to: '/quality', warn: openDefects.length > 0 },
            ].map((s) => (
              <Link key={s.label} to={s.to} className="px-4 py-2.5 hover:bg-[var(--surface-2)] transition min-w-0">
                <div className="text-[11px] text-[var(--text-3)] tracking-[0.06em]">{s.label}</div>
                <div className="flex items-baseline gap-2">
                  <span className="num text-lg font-semibold text-[var(--text)]">{s.value}</span>
                  <span className={`text-[11px] num truncate ${s.warn ? 'text-[var(--accent-text)] font-medium' : 'text-[var(--text-3)]'}`}>{s.sub}</span>
                </div>
              </Link>
            ))}
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
