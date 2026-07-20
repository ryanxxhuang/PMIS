// 跨案總覽:機關承辦/公司主管一頁比較手上所有專案——進度、未結事項、驗收階段。
// 機關登入的預設落地頁。真實模式走 portfolio_summary RPC(一次撈全部,不逐案打);
// demo 模式 = 本案(A 區)即時計算 + 兩個靜態示範姊妹案(驗收倒數/保固中)。
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ShieldCheck, Wrench, ChevronRight, BadgeCheck } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate } from '../../lib/dates.js'
import { acceptanceStageSummary } from '../../lib/acceptance.js'
import { DEMO_PORTFOLIO } from '../../data/demoSeed.js'

const fmt = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))

export default function Portfolio() {
  const {
    demoMode, isSupabaseConfigured, projects, currentProject, switchProject, loadPortfolio,
    project, workItems, valuations, progressPlan, defects, inspections, changeOrders, acceptanceEvents,
    adjustedItems, revisedTotal,
  } = useStore()
  const navigate = useNavigate()
  const TODAY = new Date() // 每次 render 取(B-11)

  // ── 本案(目前載入中的專案)即時計算——與 Dashboard 同一套數學 ──
  const current = useMemo(() => {
    if (!workItems) return null
    // 財務單一真相層(B-02):與 Dashboard/估驗頁同一套計算(含已核准變更)
    const { roots, childrenMap } = buildBillableTree(adjustedItems)
    const billable = revisedTotal
    const latest = valuations[valuations.length - 1]
    const cum = latest ? totalCumAmount(roots, buildCumMap(roots, childrenMap, latest.items)) : 0
    let planned = null
    if (progressPlan) {
      const months = progressPlan.months, N = months.length
      const start = parseLocalDate(progressPlan.start)
      const elapsed = (TODAY.getFullYear() - start.getFullYear()) * 12 + (TODAY.getMonth() - start.getMonth()) + (TODAY.getDate() - 1) / 30
      planned = elapsed <= 0 ? 0 : elapsed >= N - 1 ? months[N - 1].plannedPct
        : months[Math.floor(elapsed)].plannedPct + (months[Math.floor(elapsed) + 1].plannedPct - months[Math.floor(elapsed)].plannedPct) * (elapsed - Math.floor(elapsed))
    }
    return {
      name: project.project_name, code: project.project_code, status: project.status || '施工中',
      billable, cum, progressPct: billable ? (cum / billable) * 100 : 0, plannedPct: planned,
      openDefects: defects.filter((d) => d.status !== '已結案').length,
      pendingInspections: inspections.filter((i) => i.status === '待查驗').length,
      pendingCOs: changeOrders.filter((c) => c.status === '提出' || c.status === '審核中').length,
      acceptance: acceptanceStageSummary(demoMode ? [] : acceptanceEvents), // demo 的驗收事件屬 B 區 storyline
      isCurrent: true,
    }
  }, [workItems, adjustedItems, revisedTotal, valuations, progressPlan, defects, inspections, changeOrders, acceptanceEvents, project, demoMode])

  // ── 其他專案:真實模式走 RPC;demo 用靜態示範案 ──
  const [others, setOthers] = useState(null)
  useEffect(() => {
    if (demoMode) {
      setOthers(DEMO_PORTFOLIO.map((p) => ({ ...p, demo: true })))
      return
    }
    if (!isSupabaseConfigured) return
    let active = true
    loadPortfolio().then(({ rows }) => {
      if (!active) return
      const nameById = new Map(projects.map((p) => [p.project_id, p]))
      setOthers(rows
        .filter((r) => r.project_id !== currentProject?.project_id)
        .map((r) => {
          const meta = nameById.get(r.project_id)
          return {
            key: r.project_id, projectId: r.project_id,
            name: meta?.project_name || '—', code: meta?.project_code, status: meta?.status || '施工中',
            billable: Number(r.billable_total) || 0, cum: Number(r.latest_cum) || 0,
            progressPct: r.billable_total > 0 ? (Number(r.latest_cum) / Number(r.billable_total)) * 100 : 0,
            plannedPct: null,
            latestPeriod: r.latest_period, latestStatus: r.latest_status,
            openDefects: r.open_defects, pendingInspections: r.pending_inspections, pendingCOs: r.pending_change_orders,
            acceptance: acceptanceStageSummary(r.acceptance_events || []),
          }
        }))
    })
    return () => { active = false }
  }, [demoMode, isSupabaseConfigured, projects, currentProject, loadPortfolio])

  const cards = [current, ...(others || [])].filter(Boolean)

  const open = (c) => {
    if (c.isCurrent) { navigate('/dashboard'); return }
    if (c.demo) { if (c.to) navigate(c.to); return }
    switchProject(c.projectId)
    navigate('/dashboard')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="跨案總覽" tagline="Portfolio"
        subtitle="手上所有專案的進度、待辦與驗收階段,一頁比較;點卡片切換到該案。"
      />
      {cards.length === 0 ? (
        <Card><Empty>尚無專案。</Empty></Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {cards.map((c) => <ProjectCard key={c.key || 'current'} c={c} onOpen={() => open(c)} />)}
        </div>
      )}
      {demoMode && (
        <p className="text-xs text-[var(--text-3)]">
          B 區 / C 區為示範資料——真實帳號會列出你被加入的所有專案(彙總數字由伺服器一次計算)。
        </p>
      )}
    </div>
  )
}

const STATUS_COLOR = { 施工中: 'blue', 驗收中: 'amber', 保固中: 'green', 已結案: 'slate' }

function ProjectCard({ c, onOpen }) {
  const behind = c.plannedPct != null ? c.plannedPct - c.progressPct : null
  const clickable = c.isCurrent || c.projectId || c.to
  return (
    <button onClick={onOpen} disabled={!clickable}
      className={`text-left h-full flex flex-col bg-[var(--surface)] rounded-xl border border-[var(--border-2)] shadow-[0_1px_2px_rgba(22,32,43,.03),0_1px_10px_-2px_rgba(22,32,43,.05)] p-5 pressable ${clickable ? 'hover:border-[var(--blue)] hover:shadow-md cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[var(--text)] truncate flex items-center gap-2">
            {c.name}
            {c.isCurrent && <Badge color="blue">目前專案</Badge>}
          </div>
          <div className="text-[11px] text-[var(--text-3)] num mt-0.5">{c.code || '—'}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge color={STATUS_COLOR[c.status] || 'slate'}>{c.status}</Badge>
          {clickable && <ChevronRight size={15} className="text-[var(--text-3)]" aria-hidden />}
        </div>
      </div>

      {/* 進度:百分比一行 → 進度條 → 金額固定一行——每張卡同構,寬窄都不會亂跳行 */}
      <div className="mt-4">
        <div className="flex items-baseline gap-2">
          <span className="num text-lg leading-none font-semibold text-[var(--text)]">{c.progressPct.toFixed(1)}%</span>
          {behind != null && (
            <span className={`text-[11px] font-medium whitespace-nowrap ${behind > 5 ? 'text-[var(--accent-text)]' : behind < -2 ? 'text-[var(--green-text)]' : 'text-[var(--text-3)]'}`}>
              {behind > 5 ? `落後 ${behind.toFixed(1)}%` : behind < -2 ? `超前 ${(-behind).toFixed(1)}%` : '進度正常'}
            </span>
          )}
        </div>
        <div className="relative h-2 rounded-full bg-[var(--surface-2)] mt-2 overflow-hidden">
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--blue)]" style={{ width: `${Math.min(100, c.progressPct)}%` }} />
          {c.plannedPct != null && (
            <div className="absolute inset-y-0 w-[2px] bg-[var(--text-2)]" style={{ left: `${Math.min(100, c.plannedPct)}%` }} />
          )}
        </div>
        <div className="num text-[11px] text-[var(--text-3)] mt-1.5 text-right whitespace-nowrap">
          累計估驗 NT$ {fmt(c.cum)} ／ {fmt(c.billable)}
        </div>
      </div>

      {/* 待辦計數(mt-auto 把底部區塊釘齊卡底,三張卡對齊) */}
      <div className="mt-auto pt-4 grid grid-cols-3 gap-2 text-[11px] w-full">
        {[
          { icon: AlertTriangle, label: '缺失', title: '未結案缺失', v: c.openDefects, warn: c.openDefects > 0 },
          { icon: ShieldCheck, label: '待查驗', title: '待監造查驗', v: c.pendingInspections, warn: c.pendingInspections > 0 },
          { icon: Wrench, label: '變更', title: '變更設計待核定', v: c.pendingCOs, warn: c.pendingCOs > 0 },
        ].map((s) => {
          const Icon = s.icon
          return (
            <div key={s.label} title={s.title} className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-2)]/60 px-2 py-1.5 min-w-0">
              <Icon size={13} className={`shrink-0 ${s.warn ? 'text-[var(--accent-text)]' : 'text-[var(--text-3)]'}`} aria-hidden />
              <span className="text-[var(--text-3)] whitespace-nowrap">{s.label}</span>
              <span className={`num ml-auto font-semibold ${s.warn ? 'text-[var(--accent-text)]' : 'text-[var(--text-2)]'}`}>{s.v}</span>
            </div>
          )
        })}
      </div>

      {/* 驗收階段:永遠顯示同一列(沒進驗收就淡色),三張卡底部才會整齊 */}
      <div className="mt-3 flex items-center gap-2 text-[12px] w-full">
        <BadgeCheck size={14} className={!c.acceptance ? 'text-[var(--text-3)] opacity-60' : c.acceptance.overdue ? 'text-[var(--red-text)]' : c.acceptance.finished ? 'text-[var(--green-text)]' : 'text-[var(--blue-text)]'} aria-hidden />
        <span className={c.acceptance ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}>
          驗收：{c.acceptance ? c.acceptance.label : '尚未進入驗收程序'}
        </span>
        {c.acceptance && <span className="num text-[var(--text-3)] ml-auto">{c.acceptance.done}/{c.acceptance.total}</span>}
      </div>
    </button>
  )
}
