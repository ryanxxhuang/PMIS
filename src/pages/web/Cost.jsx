import { useState, useMemo } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Stat, Empty, Button, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { revisedContractTotal, approvedNetAmount } from '../../lib/changeOrders.js'

const CATS = ['材料', '人工', '機具', '分包', '管理費', '其他']
const CAT_COLOR = {
  材料: 'var(--blue-text)', 人工: 'var(--green-text)', 機具: 'var(--amber-text)',
  分包: 'var(--purple-text)', 管理費: 'var(--slate-text)', 其他: 'var(--text-3)',
}
const money = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const yi = (n) => (n / 1e8).toFixed(2) + ' 億'
const pct = (n) => (isFinite(n) ? n.toFixed(1) : '—')

export default function Cost() {
  const { project, workItems, dbMode, demoMode, costItems, createCostItem, updateCostItem, deleteCostItem, changeOrders } = useStore()
  // 合約收入 = 變更後契約金額(原發包 + 已核准追加減)
  const revenue = revisedContractTotal(workItems?.meta.billable_total || 0, changeOrders)
  const coNet = approvedNetAmount(changeOrders)

  const [form, setForm] = useState({ category: '分包', title: '', vendor: '', budget_amount: '', actual_amount: '' })
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 寫入失敗如實回報(B-07)
  const onUpdate = async (id, patch) => {
    setErrMsg('')
    const { error } = await updateCostItem(id, patch)
    if (error) setErrMsg(`未寫入:${error.message}`)
  }
  const onDelete = async (id) => {
    setErrMsg('')
    const { error } = await deleteCostItem(id)
    if (error) setErrMsg(`刪除失敗:${error.message}`)
  }

  const totals = useMemo(() => {
    let budget = 0, actual = 0
    for (const c of costItems) { budget += Number(c.budget_amount) || 0; actual += Number(c.actual_amount) || 0 }
    return { budget, actual }
  }, [costItems])

  const byCat = useMemo(() => CATS.map((cat) => {
    const list = costItems.filter((c) => (CATS.includes(c.category) ? c.category : '其他') === cat)
    const budget = list.reduce((s, c) => s + (Number(c.budget_amount) || 0), 0)
    const actual = list.reduce((s, c) => s + (Number(c.actual_amount) || 0), 0)
    return { cat, n: list.length, budget, actual }
  }).filter((g) => g.n > 0), [costItems])

  const budgetMargin = revenue - totals.budget
  const actualMargin = revenue - totals.actual
  const budgetRate = revenue ? (budgetMargin / revenue) * 100 : NaN
  const actualRate = revenue ? (actualMargin / revenue) * 100 : NaN

  const onAdd = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setErrMsg(''); setBusy(true)
    const { error } = await createCostItem(form)
    setBusy(false)
    if (error) { setErrMsg(`新增失敗:${error.message}`); return }
    setForm({ category: form.category, title: '', vendor: '', budget_amount: '', actual_amount: '' })
  }

  if (!dbMode && !demoMode) {
    return <Card title="成本管理"><Empty>此功能需真實專案（已匯入標單）。請先建立專案並匯入標單，才能對照合約收入計算毛利。</Empty></Card>
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="成本管理" tagline="預算 vs 實際・毛利" subtitle="合約收入（發包工程費）對照成本與分包，即時算出預估與實際毛利" />
      </div>

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat label={coNet !== 0 ? '合約收入（變更後契約金額）' : '合約收入（發包工程費）'} value={yi(revenue)} sub={coNet !== 0 ? `NT$ ${money(revenue)} · 含核准追加減 ${coNet > 0 ? '+' : ''}${money(coNet)}` : `NT$ ${money(revenue)}`} color="text-[var(--blue-text)]" />
        <Stat label="預估毛利（收入−預算成本）" value={`${pct(budgetRate)}%`} sub={`NT$ ${money(budgetMargin)}`} color={budgetMargin >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'} />
        <Stat label="實際毛利（收入−實際成本）" value={`${pct(actualRate)}%`} sub={`NT$ ${money(actualMargin)}`} color={actualMargin >= 0 ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'} />
        <Stat label="預算成本合計" value={money(totals.budget)} sub="NT$" color="text-[var(--text)]" />
        <Stat label="實際成本合計" value={money(totals.actual)} sub="NT$" color="text-[var(--text)]" />
        <Stat label="成本超支 / 結餘" value={money(totals.budget - totals.actual)} sub={totals.actual > totals.budget ? '已超出預算' : '尚在預算內'} color={totals.actual > totals.budget ? 'text-[var(--red-text)]' : 'text-[var(--text-2)]'} />
      </div>

      {byCat.length > 0 && (
        <Card title="分類成本">
          <div className="overflow-x-auto -mx-4 -my-4">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="text-left font-medium py-2 pl-5">分類</th>
                  <th className="text-right font-medium px-2">項數</th>
                  <th className="text-right font-medium px-2">預算</th>
                  <th className="text-right font-medium px-2">實際</th>
                  <th className="text-right font-medium px-2 pr-5">差異</th>
                </tr>
              </thead>
              <tbody>
                {byCat.map((g) => (
                  <tr key={g.cat} className="border-b border-[var(--border-2)]">
                    <td className="py-2 pl-5"><span className="font-medium" style={{ color: CAT_COLOR[g.cat] }}>{g.cat}</span></td>
                    <td className="px-2 text-right tabular-nums text-[var(--text-3)]">{g.n}</td>
                    <td className="px-2 text-right tabular-nums">{money(g.budget)}</td>
                    <td className="px-2 text-right tabular-nums">{money(g.actual)}</td>
                    <td className={`px-2 pr-5 text-right tabular-nums ${g.actual > g.budget ? 'text-[var(--red-text)]' : 'text-[var(--text-2)]'}`}>{money(g.budget - g.actual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="新增成本 / 分包項目">
        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[var(--text-2)] mb-1">分類</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]">
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block flex-1 min-w-[160px]">
            <span className="block text-xs font-medium text-[var(--text-2)] mb-1">項目名稱</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：鋼筋分包、預拌混凝土"
              className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block flex-1 min-w-[140px]">
            <span className="block text-xs font-medium text-[var(--text-2)] mb-1">供應商 / 分包商</span>
            <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="選填"
              className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[var(--text-2)] mb-1">預算金額</span>
            <input type="number" min="0" step="any" value={form.budget_amount} onChange={(e) => setForm({ ...form, budget_amount: e.target.value })}
              className="w-32 text-right border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm tabular-nums" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[var(--text-2)] mb-1">實際金額</span>
            <input type="number" min="0" step="any" value={form.actual_amount} onChange={(e) => setForm({ ...form, actual_amount: e.target.value })}
              className="w-32 text-right border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm tabular-nums" />
          </label>
          <Button type="submit" disabled={busy || !form.title.trim()}>{busy ? '新增中…' : '＋ 新增'}</Button>
        </form>
      </Card>

      <Card title={`成本明細（${costItems.length}）`} action={costItems.length > 0 && (
        <button onClick={() => exportCsv(`成本明細_${stamp()}`, costItems, [
          { key: 'category', label: '分類' }, { key: 'title', label: '項目' }, { key: 'vendor', label: '供應商/分包商' },
          { key: 'budget_amount', label: '預算' }, { key: 'actual_amount', label: '實際' }, { key: 'status', label: '狀態' },
        ])} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ 匯出 CSV</button>
      )}>
        {costItems.length === 0 ? (
          <Empty>尚無成本項目。把分包發包、材料、人工等成本登進來，這裡會即時對照合約收入算毛利。</Empty>
        ) : (
          <div className="overflow-x-auto -mx-4 -my-4">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="text-left font-medium py-2 pl-5">分類</th>
                  <th className="text-left font-medium px-2">項目</th>
                  <th className="text-left font-medium px-2">供應商/分包商</th>
                  <th className="text-right font-medium px-2">預算</th>
                  <th className="text-right font-medium px-2">實際</th>
                  <th className="text-left font-medium px-2">狀態</th>
                  <th className="px-2 pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {costItems.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                    <td className="py-1.5 pl-5"><span className="font-medium whitespace-nowrap" style={{ color: CAT_COLOR[c.category] || 'var(--text-3)' }}>{c.category}</span></td>
                    <td className="px-2 min-w-[140px]">{c.title}</td>
                    <td className="px-2 text-[var(--text-2)]">{c.vendor || '—'}</td>
                    <td className="px-2 text-right">
                      <input type="number" min="0" step="any" defaultValue={c.budget_amount ?? ''}
                        onBlur={(e) => { const n = parseFloat(e.target.value); onUpdate(c.id, { budget_amount: isNaN(n) ? 0 : n }) }}
                        className="w-28 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums" />
                    </td>
                    <td className="px-2 text-right">
                      <input type="number" min="0" step="any" defaultValue={c.actual_amount ?? ''}
                        onBlur={(e) => { const n = parseFloat(e.target.value); onUpdate(c.id, { actual_amount: isNaN(n) ? 0 : n }) }}
                        className="w-28 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums" />
                    </td>
                    <td className="px-2">
                      <button onClick={() => onUpdate(c.id, { status: c.status === '已結算' ? '進行中' : '已結算' })}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${c.status === '已結算' ? 'bg-[var(--green-tint)] text-[var(--green-text)]' : 'bg-[var(--slate-tint)] text-[var(--slate-text)]'}`}>
                        {c.status}
                      </button>
                    </td>
                    <td className="px-2 pr-5 text-right">
                      <button onClick={async () => { if (await appConfirm({ title: `刪除「${c.title}」？`, danger: true, confirmLabel: '刪除' })) onDelete(c.id) }}
                        className="text-[var(--text-3)] hover:text-[var(--red-text)] text-sm">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)]">
        毛利 = 合約收入（發包工程費）− 成本合計。預估毛利用「預算成本」，實際毛利用「實際成本（已發生/已付）」。分包請在分類選「分包」並填供應商，視為成本一併計入。
      </p>
    </div>
  )
}
