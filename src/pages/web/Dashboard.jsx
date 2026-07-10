import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { Download, ChevronRight, Coins, FileCheck2, MessageSquareWarning, ShieldCheck, AlertTriangle, Eye, Wrench, PencilLine } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate } from '../../lib/dates.js'
import { tallyBalls, myOpenItems } from '../../lib/ballInCourt.js'

const fmt = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const TODAY = new Date()
const todayISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`
const defColor = { 開立: 'red', 改善中: 'amber', 待複查: 'blue', 已結案: 'green' }

export default function Dashboard() {
  const { project, partyOrgKey, workItems, workItemsSource, demoMode, valuations, progressPlan, inspections, defects, siteLogs,
    obligations, costItems, safetyRecords, changeOrders, itemSchedules,
    checklistTemplates, checklistRecords, testSamples, submittals, rfis, observations, acceptanceEvents } = useStore()
  const imported = workItemsSource === 'db' || demoMode
  const balls = tallyBalls({ rfis, submittals, valuations, defects, inspections, observations, changeOrders })
  // P0-03:首頁行動中心依「這個專案」我代表的一方;未解析→唯讀,不指派契約待辦
  const myOrg = partyOrgKey || 'viewer'
  const myItems = useMemo(
    () => myOpenItems(myOrg, { rfis, submittals, valuations, defects, inspections, observations, changeOrders }),
    [myOrg, rfis, submittals, valuations, defects, inspections, observations, changeOrders],
  )

  // 整案資料匯出:所有模組打包成一個 JSON 檔——資料是使用者的,隨時拿得走
  const exportAll = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      project, work_items: workItems, valuations, progress_plan: progressPlan,
      site_logs: siteLogs, inspections, defects, obligations,
      cost_items: costItems, safety_records: safetyRecords, change_orders: changeOrders,
      item_schedules: itemSchedules, checklist_templates: checklistTemplates,
      checklist_records: checklistRecords, test_samples: testSamples,
      submittals, rfis, observations, acceptance_events: acceptanceEvents,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `PMIS匯出_${project.project_name}_${todayISO}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

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
        action={imported && (
          <button onClick={exportAll} title="把本專案所有資料打包下載(JSON)"
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5 border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] transition">
            <Download size={13} aria-hidden />匯出整案資料
          </button>
        )}
      />

      {!imported ? (
        <Card>
          <Empty>
            此專案尚未匯入標單。請先到「<Link to="/boq" className="text-[var(--blue)]">標單工項</Link>」上傳 PCCES 預算書 XML，
            之後估驗、進度、施工日誌、品質查驗才會有資料。
          </Empty>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* 進度主橫幅:整份 dashboard 唯一的大聲量——落後就亮橘色警示 */}
          <section className="bg-[var(--surface)] rounded-xl border border-[var(--border-2)] shadow-[0_1px_2px_rgba(22,32,43,.03),0_1px_10px_-2px_rgba(22,32,43,.05)] grid md:grid-cols-[1fr_auto] overflow-hidden">
            <div className="px-6 py-5 min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.09em] text-[var(--text-3)]">累計實際進度</div>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 mt-1.5">
                <span className="num text-[44px] leading-none font-semibold text-[var(--text)]">
                  {completion.toFixed(1)}<span className="text-2xl text-[var(--text-3)] ml-0.5">%</span>
                </span>
                {plannedNow != null && (
                  <span className="text-sm text-[var(--text-2)] num">目標 {plannedNow.toFixed(1)}%</span>
                )}
                {behind != null && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[13px] font-semibold num ${
                    behind > 5 ? 'bg-[var(--accent-tint)] text-[var(--accent-text)]'
                    : behind < -2 ? 'bg-[var(--green-tint)] text-[var(--green-text)]'
                    : 'bg-[var(--slate-tint)] text-[var(--slate-text)]'
                  }`}>
                    {behind > 5 ? `落後 ${behind.toFixed(1)}%` : behind < -2 ? `超前 ${(-behind).toFixed(1)}%` : '進度正常'}
                  </span>
                )}
              </div>
              {/* 進度條:藍=實際完成;刻度=今日預定 */}
              <div className="relative h-2.5 rounded-full bg-[var(--surface-2)] mt-5 overflow-visible">
                <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--blue)]" style={{ width: `${Math.min(100, completion)}%` }} />
                {plannedNow != null && (
                  <div className="absolute -top-1 -bottom-1 w-[2px] rounded bg-[var(--text-2)]" style={{ left: `${Math.min(100, plannedNow)}%` }} title={`今日預定 ${plannedNow.toFixed(1)}%`} />
                )}
              </div>
              <div className="text-[11px] text-[var(--text-3)] mt-2 flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-1.5 rounded-full bg-[var(--blue)]" />實際完成</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-[2px] h-3 bg-[var(--text-2)]" />今日預定{plannedNow == null ? '（未設定）' : ''}</span>
              </div>
            </div>
            <div className="flex md:flex-col justify-around md:justify-center gap-4 border-t md:border-t-0 md:border-l border-[var(--border-2)] px-6 py-4 md:min-w-[230px] bg-[var(--surface-2)]/30">
              <div>
                <div className="text-[10px] font-medium tracking-[0.06em] text-[var(--text-3)] uppercase">發包工程費</div>
                <div className="num text-[17px] font-semibold text-[var(--blue-text)] mt-0.5">NT$ {fmt(billableTotal)}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium tracking-[0.06em] text-[var(--text-3)] uppercase">累計估驗</div>
                <div className="num text-[17px] font-semibold text-[var(--text)] mt-0.5">NT$ {fmt(actualCum)}</div>
              </div>
            </div>
          </section>

          {/* 行動中心:依登入角色，把「球在你手上」的協作項列成收件匣 */}
          <RoleActionCenter org={myOrg} items={myItems} />

          {/* 次要計數:一排帶狀,圖示左、狀態右對齊,填滿寬度 */}
          {/* 2 欄為主、夠寬(xl)才 4 欄——避免窄桌機時中文標籤被擠成直排 */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-2)] grid grid-cols-2 xl:grid-cols-4 xl:divide-x divide-[var(--border-2)] max-xl:[&>*:nth-child(n+3)]:border-t max-xl:[&>*:nth-child(even)]:border-l max-xl:[&>*]:border-[var(--border-2)] overflow-hidden">
            {[
              { label: '估驗期數', value: valuations.length, sub: latestVal ? `第 ${latestVal.period_no} 期` : '尚無', to: '/valuation', icon: Coins },
              { label: '施工日誌', value: siteLogs.length, sub: `${siteLogs.length} 筆`, to: '/site-log', icon: PencilLine },
              { label: '查驗紀錄', value: inspections.length, sub: pendingInsp.length ? `待查驗 ${pendingInsp.length}` : '無待查驗', to: '/quality', warn: pendingInsp.length > 0, icon: ShieldCheck },
              { label: '缺失', value: defects.length, sub: openDefects.length ? `未結案 ${openDefects.length}` : '全數結案', to: '/quality', warn: openDefects.length > 0, icon: AlertTriangle },
            ].map((s) => {
              const Icon = s.icon
              return (
                <Link key={s.label} to={s.to} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)] transition min-w-0">
                  <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-[var(--surface-2)] text-[var(--text-2)]"><Icon size={17} aria-hidden /></span>
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[11px] text-[var(--text-3)] tracking-[0.04em] whitespace-nowrap">{s.label}</span>
                    <span className="num text-xl font-semibold text-[var(--text)]">{s.value}</span>
                  </span>
                  <span className={`ml-auto text-[11px] num text-right shrink-0 ${s.warn ? 'text-[var(--accent-text)] font-medium' : 'text-[var(--text-3)]'}`}>{s.sub}</span>
                </Link>
              )
            })}
          </div>

          {/* 球在誰手上:三方責任,三等分置中填滿整排 */}
          {(balls.contractor + balls.supervisor + balls.owner + balls.design > 0) && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-2)] flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5 px-5 py-3">
              <span className="text-[11px] tracking-[0.04em] text-[var(--text-3)] shrink-0">待處理協作項 · 球在誰手上</span>
              <div className="sm:flex-1 grid grid-cols-3 divide-x divide-[var(--border-2)]">
                {[
                  { k: '球在廠商', v: balls.contractor, c: 'var(--blue-text)' },
                  { k: '球在監造', v: balls.supervisor, c: 'var(--accent-text)' },
                  { k: '球在機關', v: balls.owner, c: 'var(--purple-text)' },
                ].map((b) => (
                  <div key={b.k} className="flex items-center justify-center gap-2 py-0.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.c }} />
                    <span className="text-xs text-[var(--text-2)]">{b.k}</span>
                    <span className="num text-sm font-semibold" style={{ color: b.c }}>{b.v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <Card title={`未結案缺失${openDefects.length ? `（${openDefects.length}）` : ''}`} bodyClass={openDefects.length ? 'p-0' : 'p-6'}
              action={<Link to="/quality" className="text-xs font-medium text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5">品質查驗 <ChevronRight size={13} aria-hidden /></Link>}>
              {openDefects.length === 0 ? <Empty>無未結案缺失 — 都跟上了。</Empty> : (
                <ul className="divide-y divide-[var(--border-2)]">
                  {openDefects.slice(0, 6).map((d) => (
                    <li key={d.id}>
                      <Link to="/quality" className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-[var(--surface-2)] transition">
                        <span className="text-[var(--text)] truncate">{d.title}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {d.severity === '嚴重' && <Badge color="red">嚴重</Badge>}
                          <Badge color={defColor[d.status] || 'slate'}>{d.status}</Badge>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="最近施工日誌" bodyClass={siteLogs.length ? 'p-0' : 'p-6'}
              action={<Link to="/site-log" className="text-xs font-medium text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5">施工日誌 <ChevronRight size={13} aria-hidden /></Link>}>
              {siteLogs.length === 0 ? <Empty>尚無施工日誌</Empty> : (
                <ul className="divide-y divide-[var(--border-2)]">
                  {siteLogs.slice(0, 6).map((l) => (
                    <li key={l.id}>
                      <Link to="/site-log" className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-[var(--surface-2)] transition">
                        <span className="num text-[var(--text-2)] shrink-0">{l.log_date}</span>
                        <span className="text-[var(--text)] truncate ml-3 flex-1 text-right">{l.work_summary || `${Object.keys(l.items).length} 工項`}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

// 依角色給「待你處理」不同框架與空狀態文案
const ORG_ACTION = {
  contractor: { title: '待你送出／改善', empty: '目前沒有待你送出或改善的事項 — 都跟上了。' },
  supervisor: { title: '待你審核', empty: '目前沒有待你審核的事項 — 都跟上了。' },
  owner: { title: '待你核定／撥款', empty: '目前沒有待你核定或撥款的事項 — 都跟上了。' },
  viewer: { title: '唯讀專案視角', empty: '身分尚未解析或目前為檢視者，沒有契約待辦。' },
}
// 每種協作項的圖示 + 色票(icon 方塊底色/字色)——收件匣一眼分辨類型
const TAG_META = {
  估驗: { icon: Coins, c: 'var(--blue-text)', bg: 'var(--blue-tint)' },
  送審: { icon: FileCheck2, c: 'var(--blue-text)', bg: 'var(--blue-tint)' },
  疑義: { icon: MessageSquareWarning, c: 'var(--purple-text)', bg: 'var(--purple-tint)' },
  查驗: { icon: ShieldCheck, c: 'var(--amber-text)', bg: 'var(--amber-tint)' },
  缺失: { icon: AlertTriangle, c: 'var(--red-text)', bg: 'var(--red-tint)' },
  觀察: { icon: Eye, c: 'var(--slate-text)', bg: 'var(--slate-tint)' },
  變更: { icon: Wrench, c: 'var(--green-text)', bg: 'var(--green-tint)' },
}

// 角色行動中心:把 myOpenItems 算出的「球在你手上」協作項列成收件匣。
// 三種角色共用元件,只是標題/空狀態文案不同——每個人的首頁都直接看到「該我處理的」。
function RoleActionCenter({ org, items }) {
  const cfg = ORG_ACTION[org] || ORG_ACTION.viewer
  const shown = items.slice(0, 8)
  const countPill = (
    <span className={`num text-xs font-semibold px-2 py-0.5 rounded-full ${items.length ? 'bg-[var(--accent-tint)] text-[var(--accent-text)]' : 'bg-[var(--green-tint)] text-[var(--green-text)]'}`}>
      {items.length}
    </span>
  )
  return (
    <Card title={cfg.title} action={countPill} bodyClass={items.length ? 'p-0' : 'p-6'}>
      {items.length === 0 ? (
        <Empty>{cfg.empty}</Empty>
      ) : (
        <ul className="divide-y divide-[var(--border-2)]">
          {shown.map((x, i) => {
            const m = TAG_META[x.tag] || { icon: Eye, c: 'var(--text-3)', bg: 'var(--surface-2)' }
            const Icon = m.icon
            return (
              <li key={i}>
                <Link to={x.to} className="group flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-2)] transition">
                  <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: m.bg, color: m.c }}>
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-[var(--text)] truncate">{x.title}</span>
                    <span className="block text-[11px] text-[var(--text-3)]">{x.tag}</span>
                  </span>
                  <span className="text-xs text-[var(--text-2)] shrink-0 whitespace-nowrap">{x.meta}</span>
                  <ChevronRight size={16} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0" aria-hidden />
                </Link>
              </li>
            )
          })}
          {items.length > shown.length && (
            <li className="px-4 py-2 text-[11px] text-[var(--text-3)]">還有 {items.length - shown.length} 項…</li>
          )}
        </ul>
      )}
    </Card>
  )
}
