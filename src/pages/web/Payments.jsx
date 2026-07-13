import { useMemo, useState } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Stat, Empty, PageHeader } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { exportCsv, stamp } from '../../lib/exportCsv.js'

const money = (n) => (n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'))
const payStatus = (v) => (v.paid_date ? '已收款' : v.invoice_date ? '已請款' : '待請款')

export default function Payments() {
  const { project, workItems: data, valuations, updateValuationPayment, isSupabaseConfigured, currentProject, workItemsSource } = useStore()
  const [errMsg, setErrMsg] = useState('')
  // 請款/收款欄位寫入失敗必須讓使用者看到(DB-first,失敗=UI 不變)
  const onPay = async (id, patch) => {
    setErrMsg('')
    const { error } = await updateValuationPayment(id, patch)
    if (error) setErrMsg(`未寫入：${error.message}`)
  }

  const tree = useMemo(() => (data ? buildBillableTree(data.items) : { roots: [], childrenMap: new Map() }), [data])

  // 逐期:累計估驗金額 → 本期估驗 = 本期累計 − 前期累計;本期保留款、本期應領
  const rows = useMemo(() => {
    if (!data) return []
    let prev = 0
    return [...valuations].sort((a, b) => a.period_no - b.period_no).map((v) => {
      const cum = totalCumAmount(tree.roots, buildCumMap(tree.roots, tree.childrenMap, v.items))
      const thisAmt = cum - prev; prev = cum
      const retention = thisAmt * (v.retention_pct || 0) / 100
      return { v, cum, thisAmt, retention, net: thisAmt - retention }
    })
  }, [data, valuations, tree])

  const sum = useMemo(() => {
    const net = rows.reduce((s, r) => s + r.net, 0)
    const retention = rows.reduce((s, r) => s + r.retention, 0)
    const received = rows.reduce((s, r) => s + (r.v.paid_amount || 0), 0)
    return { net, retention, received, unreceived: net - received }
  }, [rows])

  if (!data) return <Empty>載入請款資料中…</Empty>
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return <Card title="請款收款"><Empty>此專案的標單尚未匯入資料庫,且需有估驗資料才能彙整請款。</Empty></Card>
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="請款收款" tagline="現金流" subtitle="每期估驗 → 本期應領、保留款、收款追蹤" />
      </div>

      {errMsg && (
        <div className="flex items-start justify-between gap-2 text-sm bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2">
          <span>{errMsg}</span>
          <button onClick={() => setErrMsg('')} className="shrink-0 text-rose-400 hover:text-rose-700" aria-label="關閉錯誤訊息">✕</button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="累計應領(扣保留款)" value={money(sum.net)} sub="NT$" color="text-[var(--text)]" />
        <Stat label="累計已收" value={money(sum.received)} sub="NT$" color="text-[var(--blue-text)]" />
        <Stat label="未收款" value={money(sum.unreceived)} sub="NT$" color={sum.unreceived > 0 ? 'text-amber-600' : 'text-emerald-600'} />
        <Stat label="累計保留款(待退)" value={money(sum.retention)} sub="完工後請領" color="text-[var(--text)]" />
      </div>

      <Card title="逐期請款 / 收款" action={rows.length > 0 && (
        <button onClick={() => exportCsv(`請款收款_${stamp()}`, rows, [
          { label: '期', get: (r) => `第${r.v.period_no}期` }, { label: '估驗日', get: (r) => r.v.valuation_date || '' },
          { label: '累計估驗', get: (r) => Math.round(r.cum) }, { label: '本期估驗', get: (r) => Math.round(r.thisAmt) },
          { label: '本期保留款', get: (r) => Math.round(r.retention) }, { label: '本期應領', get: (r) => Math.round(r.net) },
          { label: '請款日', get: (r) => r.v.invoice_date || '' }, { label: '收款日', get: (r) => r.v.paid_date || '' },
          { label: '實收', get: (r) => r.v.paid_amount ?? '' }, { label: '狀態', get: (r) => payStatus(r.v) },
        ])} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ 匯出 CSV</button>
      )}>
        {rows.length === 0 ? (
          <Empty>尚無估驗期。請先到「估驗計價」建立估驗,這裡才會列出每期請款。</Empty>
        ) : (
          <div className="overflow-x-auto -mx-4 -my-4">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="text-left font-medium py-2 pl-4">期</th>
                  <th className="text-left font-medium px-2">估驗日</th>
                  <th className="text-right font-medium px-2">累計估驗</th>
                  <th className="text-right font-medium px-2">本期估驗</th>
                  <th className="text-right font-medium px-2">本期保留款</th>
                  <th className="text-right font-medium px-2">本期應領</th>
                  <th className="text-left font-medium px-2">請款日</th>
                  <th className="text-left font-medium px-2">收款日</th>
                  <th className="text-right font-medium px-2">實收</th>
                  <th className="text-left font-medium px-2 pr-4">狀態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ v, cum, thisAmt, retention, net }) => {
                  // 金流閘門:未核定的期別鎖定請款/收款(DB trigger 同規則強制)
                  const approved = v.status === '已核定' || v.status === '已請款'
                  const lockTip = approved ? undefined : '估驗尚未核定,不可登錄請款/收款'
                  const st = payStatus(v)
                  return (
                    <tr key={v.id} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                      <td className="py-1.5 pl-4 tabular-nums">第 {v.period_no} 期</td>
                      <td className="px-2 text-[var(--text-3)] tabular-nums whitespace-nowrap">{v.valuation_date || '—'}</td>
                      <td className="px-2 text-right tabular-nums">{money(cum)}</td>
                      <td className="px-2 text-right tabular-nums">{money(thisAmt)}</td>
                      <td className="px-2 text-right tabular-nums text-[var(--text-2)]">{money(retention)}</td>
                      <td className="px-2 text-right tabular-nums font-medium">{money(net)}</td>
                      <td className="px-2">
                        {/* onBlur 才寫入:避免打字打到一半就把半成品(或空值)存進 DB */}
                        <input type="date" key={`inv-${v.id}-${v.invoice_date || ''}`} defaultValue={v.invoice_date || ''}
                          disabled={!approved} title={lockTip} aria-label={`第 ${v.period_no} 期請款日`}
                          onBlur={(e) => { const d = e.target.value || null; if (d !== (v.invoice_date || null)) onPay(v.id, { invoice_date: d }) }}
                          className="border border-[var(--border)] rounded px-1.5 py-0.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed" />
                      </td>
                      <td className="px-2">
                        <input type="date" key={`paid-${v.id}-${v.paid_date || ''}`} defaultValue={v.paid_date || ''}
                          disabled={!approved} title={lockTip} aria-label={`第 ${v.period_no} 期收款日`}
                          onBlur={(e) => { const d = e.target.value || null; if (d !== (v.paid_date || null)) onPay(v.id, { paid_date: d }) }}
                          className="border border-[var(--border)] rounded px-1.5 py-0.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed" />
                      </td>
                      <td className="px-2 text-right">
                        <input type="number" min="0" step="any" key={`amt-${v.id}-${v.paid_amount ?? ''}`} defaultValue={v.paid_amount ?? ''}
                          placeholder={Math.round(net).toString()} disabled={!approved} title={lockTip} aria-label={`第 ${v.period_no} 期實收金額`}
                          onBlur={(e) => { const n = parseFloat(e.target.value); const val = isNaN(n) ? null : n; if (val !== (v.paid_amount ?? null)) onPay(v.id, { paid_amount: val }) }}
                          className="w-28 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums disabled:opacity-40 disabled:cursor-not-allowed" />
                      </td>
                      <td className="px-2 pr-4">
                        {approved
                          ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${st === '已收款' ? 'bg-[var(--green-tint)] text-[var(--green-text)]' : st === '已請款' ? 'bg-[var(--blue-tint)] text-[var(--blue-text)]' : 'bg-[var(--slate-tint)] text-[var(--slate-text)]'}`}>{st}</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-[var(--amber-tint)] text-[var(--amber-text)]" title={lockTip}>{v.status}·未核定</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)]">
        本期估驗 = 本期累計估驗 − 前期累計;本期應領 = 本期估驗 − 本期保留款(依該期保留款%)。填收款日與實收金額即追蹤現金流;保留款累計於完工後請領。
        估驗須經監造核定後才能登錄請款/收款——未核定的期別欄位鎖定;已登錄金流的期別要退回核定,須先清空請款/收款欄位。
      </p>
    </div>
  )
}
