import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer, Trash2 } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Stat, Badge, Button, Empty, PageHeader } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap } from '../../lib/boqCalc.js'
import { applyApprovedChangeOrders, approvedNetAmount } from '../../lib/changeOrders.js'

const fmt = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const yi = (n) => (n / 1e8).toFixed(2) + ' 億'

const statusColor = { 草稿: 'slate', 監造審核: 'amber', 已核定: 'green' }

export default function Valuation() {
  const { project, workItems: data, valuations, createValuation, updateValuationItem, setValuationStatus,
    isSupabaseConfigured, currentProject, workItemsSource, siteLogs, fillValuationFromSiteLogs, dbMode, deleteValuation,
    changeOrders } = useStore()
  const [filling, setFilling] = useState(false)
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(() => new Set())
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (data) setExpanded(new Set(data.items.filter((it) => it.depth === 1).map((it) => it.item_key)))
  }, [data])

  // 只取「發包工程費、非合計列」建樹（合計列會重複母項金額）。
  // 已核准的變更設計先套回工項（連結工項的明細調整數量/金額），分母用變更後契約金額。
  const { childrenMap, roots, billableTotal, coNet } = useMemo(() => {
    if (!data) return { childrenMap: new Map(), roots: [], billableTotal: 0, coNet: 0 }
    const net = approvedNetAmount(changeOrders)
    return {
      ...buildBillableTree(applyApprovedChangeOrders(data.items, changeOrders)),
      billableTotal: (data.meta.billable_total || 0) + net,
      coNet: net,
    }
  }, [data, changeOrders])

  const selected = valuations.find((v) => v.id === selectedId) || valuations[valuations.length - 1]
  const prev = selected ? valuations.find((v) => v.period_no === selected.period_no - 1) : null
  const editable = selected?.status === '草稿'

  const cumThis = useMemo(() => buildCumMap(roots, childrenMap, selected?.items || {}), [roots, childrenMap, selected?.items])
  const cumPrev = useMemo(() => buildCumMap(roots, childrenMap, prev?.items || {}), [roots, childrenMap, prev?.items])

  if (!data) return <Empty>載入估驗資料中…</Empty>

  // 真專案但標單尚未匯入 DB → 估驗無法綁工項，先請匯入
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return (
      <Card title="估驗計價">
        <Empty>此專案的標單尚未匯入資料庫。請先到「標單工項」頁匯入標單，估驗才能掛在工項上。</Empty>
      </Card>
    )
  }

  const totalCum = roots.reduce((s, r) => s + (cumThis.get(r.item_key) || 0), 0)
  const totalPrev = roots.reduce((s, r) => s + (cumPrev.get(r.item_key) || 0), 0)
  const periodAmt = totalCum - totalPrev
  const ret = (selected?.retention_pct ?? 5) / 100
  const completion = billableTotal ? (totalCum / billableTotal) * 100 : 0

  const toggle = (key) =>
    setExpanded((p) => {
      const n = new Set(p)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })

  // 輸入「累計完成數量」，夾在 0 ~ 契約數量
  const onQty = (it, val) => {
    let n = parseFloat(val)
    if (isNaN(n)) n = 0
    const maxQ = it.quantity || 0
    n = Math.max(0, maxQ > 0 ? Math.min(maxQ, n) : n)
    updateValuationItem(selected.id, it.item_key, n)
  }

  // 搜尋時直接攤平顯示符合的末端工項；否則顯示階層樹
  const leaves = []
  if (search) {
    const q = search.trim()
    for (const list of childrenMap.values())
      for (const it of list)
        if (!(childrenMap.get(it.item_key)?.length) && (it.description.includes(q) || (it.item_no || '').includes(q)))
          leaves.push(it)
  }

  const renderRow = (it, level) => {
    const kids = childrenMap.get(it.item_key) || []
    const hasKids = kids.length > 0
    const isOpen = expanded.has(it.item_key)
    const cum = cumThis.get(it.item_key) || 0
    const per = cum - (cumPrev.get(it.item_key) || 0)
    const cumQty = selected?.items?.[it.item_key] ?? 0
    // 完成百分比：父項用金額比、葉項用數量比
    const pct = hasKids
      ? (it.amount ? (cum / it.amount) * 100 : 0)
      : (it.quantity ? (cumQty / it.quantity) * 100 : 0)
    return (
      <tr key={it.item_key} className={`border-b border-[var(--border-2)] hover:bg-[var(--surface-2)] ${it.depth === 1 ? 'bg-[var(--surface-2)]/70 font-semibold' : ''}`}>
        <td className="py-1.5 pr-2" style={{ paddingLeft: 10 + level * 18 }}>
          {hasKids ? (
            <button onClick={() => toggle(it.item_key)} className="mr-1 w-4 inline-block text-[var(--text-3)] hover:text-[var(--text)]">{isOpen ? '▾' : '▸'}</button>
          ) : <span className="mr-1 w-4 inline-block" />}
          <span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{it.item_no}</span>
          <span className={it.depth <= 2 ? 'text-[var(--text)]' : ''}>{it.description}</span>
        </td>
        <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{hasKids ? '' : it.unit}</td>
        <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{hasKids ? '' : fmt(it.quantity)}</td>
        <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{hasKids ? '' : fmt(it.unit_price)}</td>
        <td className="text-right px-2 whitespace-nowrap">
          {hasKids ? (
            <span className="text-[var(--text-3)] tabular-nums">{pct.toFixed(1)}%</span>
          ) : editable ? (
            <span className="inline-flex items-center gap-1 justify-end">
              <input
                type="number" min="0" max={it.quantity || undefined} step="any"
                value={selected?.items?.[it.item_key] ?? ''}
                onChange={(e) => onQty(it, e.target.value)}
                placeholder="0"
                className="w-20 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums focus:border-[var(--blue)] focus:outline-none"
              />
              <span className="text-[10px] text-[var(--text-3)] w-9 text-right tabular-nums">{pct.toFixed(0)}%</span>
            </span>
          ) : (
            <span className="text-[var(--text-2)] tabular-nums">{fmt(cumQty)} <span className="text-[10px] text-[var(--text-3)]">({pct.toFixed(0)}%)</span></span>
          )}
        </td>
        <td className="text-right text-[var(--text)] px-2 tabular-nums whitespace-nowrap">{fmt(cum)}</td>
        <td className={`text-right px-2 pr-3 tabular-nums whitespace-nowrap ${per > 0 ? 'text-[var(--blue-text)] font-medium' : 'text-[var(--text-3)]'}`}>{fmt(per)}</td>
      </tr>
    )
  }

  const renderTree = (items, level = 0) =>
    items.flatMap((it) => {
      const kids = childrenMap.get(it.item_key) || []
      const row = renderRow(it, level)
      if (kids.length && expanded.has(it.item_key)) return [row, ...renderTree(kids, level + 1)]
      return [row]
    })

  return (
    <div className="space-y-5">
      <PageHeader title="估驗計價" tagline="Valuation"
        subtitle={`${coNet !== 0
          ? `變更後契約金額 ${yi(billableTotal)}（原發包 ${yi(billableTotal - coNet)}，核准追加減 ${coNet > 0 ? '+' : ''}${fmt(coNet)}）`
          : `發包工程費 ${yi(billableTotal)}`}（保留款 ${selected?.retention_pct ?? 5}%）`}
        action={
          <div className="flex items-center gap-2">
            {selected && <Button variant="secondary" onClick={() => navigate(`/valuation/print?p=${selected.id}`)}><Printer size={15} aria-hidden />列印估驗單</Button>}
            <Button onClick={() => { const v = createValuation(); setSelectedId(v.id) }}>＋ 新增估驗期</Button>
          </div>
        } />

      {valuations.length === 0 ? (
        <Card>
          <Empty>
            尚無估驗期。每月對已完成工項提報估驗，系統依標單單價自動計算本期/累計金額與保留款。
            <div className="mt-4"><Button onClick={() => { const v = createValuation(); setSelectedId(v.id) }}>建立第 1 期估驗</Button></div>
          </Empty>
        </Card>
      ) : (
        <>
          {/* 期數頁籤 */}
          <div className="flex items-center gap-2 flex-wrap">
            {valuations.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedId(v.id)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                  v.id === selected?.id ? 'bg-[var(--blue-tint)] text-[var(--blue-text)] border-[var(--blue)] font-medium' : 'bg-[var(--surface)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--surface-2)]'
                }`}
              >
                第 {v.period_no} 期
                <Badge color={statusColor[v.status] || 'slate'}>{v.status}</Badge>
              </button>
            ))}
          </div>

          {/* 本期彙總 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat label="本期估驗金額" value={fmt(periodAmt)} sub={`第 ${selected.period_no} 期`} color="text-[var(--blue-text)]" />
            <Stat label="累計估驗金額" value={fmt(totalCum)} sub={`占發包 ${completion.toFixed(1)}%`} />
            <Stat label="累計完成度" value={`${completion.toFixed(1)}%`} sub={`/ ${yi(billableTotal)}`} color="text-emerald-600" />
            <Stat label="本期保留款" value={fmt(periodAmt * ret)} sub={`${selected.retention_pct}%`} color="text-[var(--text-2)]" />
            <Stat label="本期應付" value={fmt(periodAmt * (1 - ret))} sub="本期估驗 − 保留款" color="text-blue-600" />
          </div>

          <Card
            title={`第 ${selected.period_no} 期 估驗明細`}
            action={
              <div className="flex items-center gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項…" className="text-sm border border-[var(--border)] rounded-lg px-2.5 py-1 w-40 focus:border-[var(--blue)] focus:outline-none" />
                {selected.status === '草稿' && dbMode && siteLogs.length > 0 && (
                  <Button variant="secondary" onClick={async () => { setFilling(true); await fillValuationFromSiteLogs(selected.id); setFilling(false) }} disabled={filling}>
                    {filling ? '帶入中…' : '從施工日誌帶入'}
                  </Button>
                )}
                {selected.status === '草稿' && <Button variant="secondary" onClick={() => setValuationStatus(selected.id, '監造審核')}>送監造審核</Button>}
                {selected.status === '監造審核' && <>
                  <Button variant="ghost" onClick={() => setValuationStatus(selected.id, '草稿')}>退回</Button>
                  <Button variant="success" onClick={() => setValuationStatus(selected.id, '已核定')}>核定估驗</Button>
                </>}
                <Button variant="ghost" onClick={() => { if (window.confirm(`刪除第 ${selected.period_no} 期估驗？`)) { deleteValuation(selected.id); setSelectedId(null) } }} className="text-rose-400 hover:text-rose-600" aria-label="刪除估驗期"><Trash2 size={15} aria-hidden /></Button>
              </div>
            }
          >
            {!editable && <p className="text-xs text-amber-600 mb-2">本期狀態為「{selected.status}」，明細唯讀。</p>}
            <div className="overflow-x-auto -mx-4 -my-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                    <th className="text-left font-medium py-2 pl-3">項次 / 工項名稱</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">單位</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">契約數量</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">單價</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">累計完成數量</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">累計金額</th>
                    <th className="text-right font-medium px-2 pr-3 whitespace-nowrap">本期金額</th>
                  </tr>
                </thead>
                <tbody>{search ? leaves.map((it) => renderRow(it, 0)) : renderTree(roots)}</tbody>
              </table>
            </div>
          </Card>

          <p className="text-xs text-[var(--text-3)]">
            在末端工項填「累計完成數量」（夾在 0～契約數量），累計金額 = 契約金額 × 完成數量÷契約數量，右側顯示完成%。
            本期金額 = 本期累計 − 前期累計，父項金額自動加總。保留款依契約比例逐期扣留，竣工驗收後返還。
            完成數量之後可由施工日誌的當日數量自動回填。
          </p>
        </>
      )}
    </div>
  )
}
