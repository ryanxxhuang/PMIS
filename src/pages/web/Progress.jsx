import { useState, useMemo, Fragment } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Stat, Badge, Button, Field, Empty, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate } from '../../lib/dates.js'

const monthLabel = (str) => {
  const d = parseLocalDate(str)
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null
}
export default function Progress() {
  const TODAY = new Date() // 每次 render 取(B-11):模組層常數會讓長開分頁的「今天」凍結在開頁那天
  const { project, workItems: data, progressPlan, generateSchedule, updatePlannedPct, valuations,
    isSupabaseConfigured, currentProject, workItemsSource,
    adjustedItems: adjItems, revisedTotal } = useStore()
  const [start, setStart] = useState(project.start_date)
  const [end, setEnd] = useState(project.end_date)
  const [expanded, setExpanded] = useState(() => new Set()) // 展開的工項節點 key
  const [errMsg, setErrMsg] = useState('') // 排程寫入失敗如實回報(B-08)
  const toggle = (key) => setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const onGenerate = async (s, e) => {
    setErrMsg('')
    const { error } = await generateSchedule(s, e)
    if (error) setErrMsg(`預定進度未寫入:${error.message}`)
  }
  const onPlannedPct = async (i, pct) => {
    const { error } = await updatePlannedPct(i, pct)
    if (error) setErrMsg(`第 ${i + 1} 月預定% 未寫入:${error.message}`)
  }

  // 變更設計調整/變更後契約金額由 store 統一提供(財務單一真相層,B-02)
  const tree = useMemo(() => (data ? buildBillableTree(adjItems) : { roots: [], childrenMap: new Map() }), [data, adjItems])
  const billableTotal = data ? revisedTotal : 0

  // 各估驗期 → 累計實際完成%（累計估驗金額 ÷ 發包工程費），對應到月份
  const actualByMonth = useMemo(() => {
    const map = new Map()
    if (!data) return map
    for (const v of valuations) {
      const cum = totalCumAmount(tree.roots, buildCumMap(tree.roots, tree.childrenMap, v.items))
      const pct = billableTotal ? (cum / billableTotal) * 100 : 0
      const lbl = monthLabel(v.valuation_date)
      if (lbl) map.set(lbl, pct) // 同月以最後一期為準
    }
    return map
  }, [data, valuations, tree, billableTotal])

  // 各節點的發包總額(子項加總,末端=自身金額)— 用來算各工項完成%
  const amountMap = useMemo(() => {
    const map = new Map()
    if (!data) return map
    const calc = (node) => {
      const kids = tree.childrenMap.get(node.item_key) || []
      const v = kids.length ? kids.reduce((s, k) => s + calc(k), 0) : (node.amount || 0)
      map.set(node.item_key, v); return v
    }
    tree.roots.forEach(calc); return map
  }, [data, tree])

  // 最新一期估驗 → 各節點累計完成金額(滾算到母項)
  const latestCumMap = useMemo(() => {
    if (!data || !valuations.length) return new Map()
    const latest = valuations.reduce((a, b) => (b.period_no > a.period_no ? b : a))
    return buildCumMap(tree.roots, tree.childrenMap, latest.items || {})
  }, [data, valuations, tree])

  if (!data) return <Empty>載入進度資料中…</Empty>

  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return (
      <Card title="進度管制">
        <Empty>此專案的標單尚未匯入資料庫。請先到「標單工項」頁匯入標單，進度才能對齊金額權重。</Empty>
      </Card>
    )
  }

  if (!progressPlan) {
    return (
      <div className="space-y-5">
        <Header billableTotal={billableTotal} project={project} />
        <Card title="建立預定進度">
          <p className="text-sm text-[var(--text-2)] mb-4">
            標單只提供金額權重、沒有時間分布，需先設定預定進度（廠商施工預定進度表）。
            系統會依開工/竣工切出月份，並產生一條標準 S 曲線當起點，之後可逐月微調。
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <Field label="開工日"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field>
            <Field label="竣工日"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field>
            <Button onClick={() => onGenerate(start, end)}>產生預定 S 曲線</Button>
            {errMsg && <span className="text-sm text-rose-600">{errMsg}</span>}
          </div>
        </Card>
      </div>
    )
  }

  const months = progressPlan.months
  const N = months.length

  // 實際資料點（對應到月份 index）
  const actualPoints = months
    .map((m, i) => ({ i, pct: actualByMonth.get(m.label) }))
    .filter((p) => p.pct != null)
  const actualNow = actualPoints.length ? actualPoints[actualPoints.length - 1].pct : 0

  // 今天落在第幾個月（小數）+ 內插預定進度
  const planStart = parseLocalDate(progressPlan.start)
  const elapsed = (TODAY.getFullYear() - planStart.getFullYear()) * 12
    + (TODAY.getMonth() - planStart.getMonth())
    + (TODAY.getDate() - 1) / 30
  const todayFrac = Math.max(0, Math.min(N - 1, elapsed))
  const plannedNow = (() => {
    if (elapsed <= 0) return 0
    if (elapsed >= N - 1) return months[N - 1].plannedPct
    const lo = Math.floor(todayFrac), hi = Math.ceil(todayFrac), f = todayFrac - lo
    return months[lo].plannedPct + (months[hi].plannedPct - months[lo].plannedPct) * f
  })()
  const behind = plannedNow - actualNow
  const statusBadge = behind > 5
    ? <Badge color="red">落後 {behind.toFixed(1)}%</Badge>
    : behind < -2
      ? <Badge color="blue">超前 {(-behind).toFixed(1)}%</Badge>
      : <Badge color="green">進度正常</Badge>

  // 工項層級進度:各節點實際完成%(累計估驗金額 ÷ 該節點發包額)
  const nodePct = (key) => { const amt = amountMap.get(key) || 0; return amt > 0 ? (latestCumMap.get(key) || 0) / amt * 100 : 0 }
  const leafList = adjItems.filter((it) => it.is_billable && !it.is_rollup && !(tree.childrenMap.get(it.item_key)?.length))
  const laggards = leafList
    .map((it) => { const pct = nodePct(it.item_key); const share = billableTotal ? (amountMap.get(it.item_key) || 0) / billableTotal * 100 : 0; return { it, pct, share, drag: share * Math.max(0, plannedNow - pct) / 100 } })
    .filter((l) => l.drag > 0)
    .sort((a, b) => b.drag - a.drag)
    .slice(0, 8)

  // ── S 曲線 SVG ──
  const W = 900, H = 300, m = { l: 46, r: 24, t: 26, b: 34 }
  const pw = W - m.l - m.r, ph = H - m.t - m.b
  const x = (i) => m.l + (N > 1 ? (i / (N - 1)) : 0) * pw
  const y = (p) => m.t + (1 - p / 100) * ph
  const y0 = y(0)
  const plannedPts = months.map((mm, i) => `${x(i).toFixed(1)},${y(mm.plannedPct).toFixed(1)}`).join(' ')
  const actualPts = actualPoints.map((p) => `${x(p.i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')
  // 曲線下方漸層填色的路徑（面積圖）——填滿空曠的繪圖區、更有質感
  const plannedArea = `M ${x(0).toFixed(1)},${y0.toFixed(1)} ` + months.map((mm, i) => `L ${x(i).toFixed(1)},${y(mm.plannedPct).toFixed(1)}`).join(' ') + ` L ${x(N - 1).toFixed(1)},${y0.toFixed(1)} Z`
  const actualArea = actualPoints.length
    ? `M ${x(actualPoints[0].i).toFixed(1)},${y0.toFixed(1)} ` + actualPoints.map((p) => `L ${x(p.i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ') + ` L ${x(actualPoints[actualPoints.length - 1].i).toFixed(1)},${y0.toFixed(1)} Z`
    : ''
  const lastAct = actualPoints[actualPoints.length - 1]
  const xLabelEvery = Math.ceil(N / 9)

  return (
    <div className="space-y-5">
      <Header billableTotal={billableTotal} project={project} action={
        <Button variant="secondary" onClick={() => onGenerate(progressPlan.start, progressPlan.end)}>重產 S 曲線</Button>
      } />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="預定進度（今天）" value={`${plannedNow.toFixed(1)}%`} sub="依預定 S 曲線內插" color="text-[var(--text)]" />
        <Stat label="實際進度" value={`${actualNow.toFixed(1)}%`} sub="累計估驗 ÷ 發包工程費" color="text-[var(--blue-text)]" />
        <Stat label="進度差" value={`${behind >= 0 ? '−' : '+'}${Math.abs(behind).toFixed(1)}%`} sub={behind > 0 ? '落後' : '超前/持平'} color={behind > 5 ? 'text-[var(--red-text)]' : 'text-[var(--green-text)]'} />
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-2)] shadow-[0_1px_2px_rgba(22,32,43,.03)] px-4 py-3.5 flex flex-col">
          <div className="text-[11px] text-[var(--text-3)] tracking-[0.04em]">進度狀態</div>
          <div className="mt-1.5">{statusBadge}</div>
          <div className="text-[11px] text-[var(--text-3)] mt-auto pt-2 num">今天 {TODAY.toLocaleDateString('zh-TW')}</div>
        </div>
      </div>

      <Card title="進度 S 曲線（預定 vs 實際）">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 440 }} preserveAspectRatio="xMidYMid meet" role="img" aria-label="進度 S 曲線：預定 vs 實際">
          <defs>
            <linearGradient id="planFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--chart-muted-line)', stopOpacity: 0.13 }} />
              <stop offset="100%" style={{ stopColor: 'var(--chart-muted-line)', stopOpacity: 0 }} />
            </linearGradient>
            <linearGradient id="actFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--blue)', stopOpacity: 0.20 }} />
              <stop offset="100%" style={{ stopColor: 'var(--blue)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {/* 橫格線 + Y 軸 */}
          {[0, 25, 50, 75, 100].map((p) => (
            <g key={p}>
              <line x1={m.l} y1={y(p)} x2={W - m.r} y2={y(p)} style={{ stroke: 'var(--chart-grid)' }} strokeWidth="1" />
              <text x={m.l - 8} y={y(p) + 3.5} textAnchor="end" fontSize="11" style={{ fill: 'var(--chart-axis-text)' }}>{p}%</text>
            </g>
          ))}
          {/* X 軸月份 */}
          {months.map((mm, i) => (i % xLabelEvery === 0 || i === N - 1) ? (
            <text key={i} x={x(i)} y={H - m.b + 18} textAnchor="middle" fontSize="10" style={{ fill: 'var(--chart-axis-text)' }}>{mm.label.slice(2)}</text>
          ) : null)}
          {/* 面積填色 */}
          <path d={plannedArea} fill="url(#planFill)" />
          {actualArea && <path d={actualArea} fill="url(#actFill)" />}
          {/* 今天標記 */}
          <line x1={x(todayFrac)} y1={m.t} x2={x(todayFrac)} y2={H - m.b} style={{ stroke: 'var(--chart-today)' }} strokeWidth="1.5" strokeDasharray="4 4" />
          <g transform={`translate(${x(todayFrac).toFixed(1)}, ${(m.t - 5).toFixed(1)})`}>
            <rect x="-17" y="-14" width="34" height="16" rx="4" style={{ fill: 'var(--chart-today)' }} />
            <text x="0" y="-2" textAnchor="middle" fontSize="10" fontWeight="600" style={{ fill: 'var(--surface)' }}>今天</text>
          </g>
          {/* 預定線 */}
          <polyline points={plannedPts} fill="none" style={{ stroke: 'var(--chart-muted-line)' }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {/* 實際線 */}
          {actualPoints.length > 0 && <polyline points={actualPts} fill="none" style={{ stroke: 'var(--blue)' }} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
          {/* 中間資料點（低調） */}
          {actualPoints.slice(0, -1).map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.pct)} r="2.8" style={{ fill: 'var(--blue)' }} />)}
          {/* 預定「今日」值標 */}
          <text x={x(todayFrac) - 8} y={y(plannedNow) - 6} textAnchor="end" fontSize="11" style={{ fill: 'var(--chart-axis-text)' }}>預定 {plannedNow.toFixed(1)}%</text>
          {/* 實際最新點：強調 + 直接標值 */}
          {lastAct && (
            <g>
              <circle cx={x(lastAct.i)} cy={y(lastAct.pct)} r="5" style={{ fill: 'var(--blue)', stroke: 'var(--surface)' }} strokeWidth="2.5" />
              <text x={x(lastAct.i) + 10} y={y(lastAct.pct) + 4} fontSize="12.5" fontWeight="700" style={{ fill: 'var(--blue-text)' }}>{lastAct.pct.toFixed(1)}%</text>
            </g>
          )}
        </svg>
        <div className="flex items-center gap-5 text-xs text-[var(--text-2)] mt-2 pl-1">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 rounded-full bg-[var(--chart-muted-line)]" />預定進度</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 rounded-full bg-[var(--blue)]" />實際進度（估驗）</span>
        </div>
      </Card>

      <Card title="落後工項（最拖累整體進度）">
        {laggards.length === 0 ? (
          <Empty>目前沒有明顯落後的工項 — 各工項實際完成度都追上今日預定 {plannedNow.toFixed(0)}%。</Empty>
        ) : (
          <div className="overflow-x-auto"><div className="min-w-[480px] space-y-1.5">
            {laggards.map(({ it, pct, share }) => (
              <div key={it.item_key} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-[var(--text-3)] tabular-nums truncate">{it.item_no}</span>
                <span className="flex-1 text-sm truncate">{it.description}</span>
                <span className="w-12 text-right text-xs text-[var(--text-3)] tabular-nums" title="占發包工程費權重">{share.toFixed(1)}%</span>
                <div className="w-28 shrink-0 h-2 rounded-full overflow-hidden bg-[var(--surface-2)]"><div className="h-full bg-[var(--red-text)] rounded-full" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                <span className="w-10 text-right text-xs tabular-nums">{pct.toFixed(0)}%</span>
              </div>
            ))}
          </div></div>
        )}
        <p className="text-xs text-[var(--text-3)] mt-3">落後 = 實際完成% 低於今日預定 {plannedNow.toFixed(0)}%;依「權重 × 落後幅度」排序,越上面對整體進度拖累越大。</p>
      </Card>

      <Card title="工項進度（可展開鑽取）">
        <div className="overflow-x-auto"><div className="min-w-[520px]">
          <div className="flex items-center gap-2 pb-1.5 border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-3)]">
            <span className="w-4 shrink-0" /><span className="w-20 shrink-0">項次</span><span className="flex-1">工項</span>
            <span className="w-12 text-right">權重</span><span className="w-28 text-center shrink-0">完成度</span><span className="w-10 text-right">%</span><span className="w-8 shrink-0" />
          </div>
          <ProgressTree nodes={tree.roots} depth={0} expanded={expanded} toggle={toggle}
            childrenMap={tree.childrenMap} nodePct={nodePct} amountMap={amountMap} billableTotal={billableTotal} plannedNow={plannedNow} />
        </div></div>
        <p className="text-xs text-[var(--text-3)] mt-3">點「▸」展開到更細的工項;紅色長條=該工項落後今日預定。各層百分比為金額加權滾算。</p>
      </Card>

      <Card title="逐月預定進度（可調整）">
        <div className="overflow-x-auto -mx-4 -my-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                <th className="text-left font-medium py-2 pl-3">月份</th>
                <th className="text-right font-medium px-3">預定累計%</th>
                <th className="text-right font-medium px-3 pr-4">實際累計%</th>
              </tr>
            </thead>
            <tbody>
              {months.map((mm, i) => {
                const act = actualByMonth.get(mm.label)
                return (
                  <tr key={mm.label} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                    <td className="py-1.5 pl-3 text-[var(--text)] tabular-nums">{mm.label}</td>
                    <td className="text-right px-3">
                      <input type="number" min="0" max="100" value={mm.plannedPct}
                        onChange={(e) => { let n = parseFloat(e.target.value); if (isNaN(n)) n = 0; onPlannedPct(i, Math.max(0, Math.min(100, n))) }}
                        className="w-20 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums focus:border-[var(--blue)] focus:outline-none" />
                    </td>
                    <td className="text-right px-3 pr-4 tabular-nums">{act != null ? <span className="text-[var(--blue-text)]">{act.toFixed(1)}%</span> : <span className="text-[var(--text-3)]">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-[var(--text-3)]">
        實際進度即時取自「估驗計價」（累計估驗金額 ÷ 發包工程費），不需另外輸入；估驗一核定，這條線就動。
        預定 S 曲線為標準 smoothstep 起點，請依實際施工預定進度表逐月微調。
      </p>
    </div>
  )
}

function ProgressTree({ nodes, depth, expanded, toggle, childrenMap, nodePct, amountMap, billableTotal, plannedNow }) {
  return nodes.map((it) => {
    const kids = childrenMap.get(it.item_key) || []
    const pct = nodePct(it.item_key)
    const share = billableTotal ? (amountMap.get(it.item_key) || 0) / billableTotal * 100 : 0
    const behind = plannedNow - pct > 5
    const open = expanded.has(it.item_key)
    return (
      <Fragment key={it.item_key}>
        <div className="flex items-center gap-2 py-1.5 border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
          <button onClick={() => kids.length && toggle(it.item_key)} style={{ marginLeft: `${depth * 14}px` }}
            className={`w-4 shrink-0 text-[var(--text-3)] ${kids.length ? 'cursor-pointer hover:text-[var(--text)]' : 'cursor-default'}`}>
            {kids.length ? (open ? '▾' : '▸') : '·'}
          </button>
          <span className="w-20 shrink-0 text-xs text-[var(--text-3)] tabular-nums truncate">{it.item_no}</span>
          <span className="flex-1 text-sm truncate">{it.description}</span>
          <span className="w-12 text-right text-xs text-[var(--text-3)] tabular-nums">{share.toFixed(1)}%</span>
          <div className="w-28 shrink-0 h-2 rounded-full overflow-hidden bg-[var(--surface-2)]">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: behind ? 'var(--red-text)' : 'var(--blue)' }} />
          </div>
          <span className="w-10 text-right text-xs tabular-nums">{pct.toFixed(0)}%</span>
          {behind
            ? <span className="w-8 shrink-0 text-[10px] text-center px-1 py-0.5 rounded-full bg-[var(--red-tint)] text-[var(--red-text)]">落後</span>
            : <span className="w-8 shrink-0" />}
        </div>
        {open && kids.length > 0 && (
          <ProgressTree nodes={kids} depth={depth + 1} expanded={expanded} toggle={toggle}
            childrenMap={childrenMap} nodePct={nodePct} amountMap={amountMap} billableTotal={billableTotal} plannedNow={plannedNow} />
        )}
      </Fragment>
    )
  })
}

function Header({ billableTotal, project, action }) {
  const yi = (n) => (n / 1e8).toFixed(2) + ' 億'
  return (
    <div className="flex items-end justify-between flex-wrap gap-3">
      <div className="min-w-0">
        <PageHeader title="進度管制" tagline="S-Curve" subtitle={`發包工程費 ${yi(billableTotal)}`} />
      </div>
      {action}
    </div>
  )
}
