import { useState, useMemo } from 'react'
import { FileUp } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Stat, Empty, Button, Badge, PageHeader } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { parsePccesXml } from '../../lib/parsePcces.js'
import { diffBoq } from '../../lib/coDiff.js'

const money = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const yi = (n) => (n / 1e8).toFixed(2) + ' 億'
const STATUS_COLOR = { 提出: 'slate', 審核中: 'amber', 核准: 'green', 駁回: 'red' }
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function ChangeOrders() {
  const { project, workItems, dbMode, demoMode, changeOrders, can,
    createChangeOrder, updateChangeOrder, deleteChangeOrder,
    addChangeOrderItem, addChangeOrderItems, updateChangeOrderItem, deleteChangeOrderItem } = useStore()
  const original = workItems?.meta.billable_total || 0

  const [head, setHead] = useState({ co_no: '', title: '', co_date: todayStr() })
  const [busy, setBusy] = useState(false)

  // 發包末端工項（給明細連結既有工項用）
  const leaves = useMemo(() => {
    if (!workItems) return []
    const childMap = new Map()
    for (const it of workItems.items) { const k = it.parent_key || '__root__'; if (!childMap.has(k)) childMap.set(k, []); childMap.get(k).push(it) }
    return workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
  }, [workItems])

  const coNet = (co) => co.items.reduce((s, it) => s + (Number(it.amount_delta) || 0), 0)

  const totals = useMemo(() => {
    let approvedNet = 0, pendingNet = 0, add = 0, reduce = 0
    for (const co of changeOrders) {
      const net = coNet(co)
      if (co.status === '核准') {
        approvedNet += net
        for (const it of co.items) { const a = Number(it.amount_delta) || 0; if (a >= 0) add += a; else reduce += a }
      } else if (co.status === '提出' || co.status === '審核中') pendingNet += net
    }
    return { approvedNet, pendingNet, add, reduce }
  }, [changeOrders])

  const revised = original + totals.approvedNet
  const ratio = original ? (totals.approvedNet / original) * 100 : 0

  const onCreate = async (e) => {
    e.preventDefault()
    if (!head.title.trim()) return
    setBusy(true)
    const { error } = await createChangeOrder(head)
    setBusy(false)
    if (!error) setHead({ co_no: '', title: '', co_date: todayStr() })
  }

  if (!dbMode && !demoMode) {
    return <Card title="變更設計"><Empty>此功能需真實專案（已匯入標單）。請先建立專案並匯入標單，才能對照原契約金額計算追加減。</Empty></Card>
  }

  const exportAll = () => {
    const rows = changeOrders.flatMap((co) => co.items.map((it) => ({
      co_no: co.co_no || '', co_title: co.title, status: co.status,
      item_no: it.item_no || '', description: it.description, unit: it.unit || '',
      qty_delta: it.qty_delta, unit_price: it.unit_price, amount_delta: it.amount_delta,
    })))
    exportCsv(`變更設計_${stamp()}`, rows, [
      { key: 'co_no', label: '變更編號' }, { key: 'co_title', label: '事由' }, { key: 'status', label: '狀態' },
      { key: 'item_no', label: '項次' }, { key: 'description', label: '工項' }, { key: 'unit', label: '單位' },
      { key: 'qty_delta', label: '數量增減' }, { key: 'unit_price', label: '單價' }, { key: 'amount_delta', label: '金額增減' },
    ])
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="變更設計" tagline="追加減帳・契約金額調整" subtitle="追加/減帳工項 → 僅「核准」的計入變更後契約金額" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="原契約金額" value={yi(original)} sub={`NT$ ${money(original)}`} color="text-[var(--text)]" />
        <Stat label="累計追加(核准)" value={money(totals.add)} sub="NT$" color="text-emerald-600" />
        <Stat label="累計減帳(核准)" value={money(Math.abs(totals.reduce))} sub="NT$" color="text-rose-600" />
        <Stat label="變更後契約金額" value={yi(revised)} sub={`${ratio >= 0 ? '+' : ''}${ratio.toFixed(1)}% · NT$ ${money(revised)}`} color="text-[var(--blue-text)]" />
      </div>
      {totals.pendingNet !== 0 && (
        <p className="text-xs text-[var(--text-3)] -mt-2">另有審核中/提出的變更淨額 <span className={totals.pendingNet >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{totals.pendingNet >= 0 ? '+' : ''}{money(totals.pendingNet)}</span>（尚未計入變更後契約金額）。</p>
      )}

      {can.manageChangeOrders && <Card title="新增變更設計">
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[var(--text-2)] mb-1">變更編號</span>
            <input value={head.co_no} onChange={(e) => setHead({ ...head, co_no: e.target.value })} placeholder="第1次變更"
              className="w-28 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block flex-1 min-w-[180px]">
            <span className="block text-xs font-medium text-[var(--text-2)] mb-1">事由 / 名稱</span>
            <input value={head.title} onChange={(e) => setHead({ ...head, title: e.target.value })} placeholder="如：因現場地質變更增設擋土措施"
              className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[var(--text-2)] mb-1">日期</span>
            <input type="date" value={head.co_date} onChange={(e) => setHead({ ...head, co_date: e.target.value })}
              className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
          <Button type="submit" disabled={busy || !head.title.trim()}>{busy ? '新增中…' : '＋ 新增'}</Button>
        </form>
      </Card>}

      {changeOrders.length === 0 ? (
        <Card title="變更清單"><Empty>尚無變更設計。新增一筆後，在其中加入追加/減帳工項。</Empty></Card>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={exportAll} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ 匯出全部 CSV</button>
          </div>
          {changeOrders.map((co) => (
            <ChangeOrderCard key={co.id} co={co} net={coNet(co)} leaves={leaves} allItems={workItems?.items || []}
              canReview={can.reviewChangeOrder} canRatify={can.ratifyChangeOrder}
              canEdit={can.manageChangeOrders && ['提出', '駁回'].includes(co.status)}
              onStatus={(s) => updateChangeOrder(co.id, { status: s })}
              onDelete={async () => { if (await appConfirm({ title: `刪除變更「${co.title}」？`, body: '其明細將一併刪除。', danger: true, confirmLabel: '刪除' })) deleteChangeOrder(co.id) }}
              onAddItem={(input) => addChangeOrderItem(co.id, input)}
              onAddItems={(rows) => addChangeOrderItems(co.id, rows)}
              onUpdateItem={(id, patch) => updateChangeOrderItem(co.id, id, patch)}
              onDeleteItem={(id) => deleteChangeOrderItem(co.id, id)} />
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--text-3)]">
        變更後契約金額 = 原契約金額 + 已「核准」變更的追加減淨額。追加填正數量、減帳填負數量；連結既有工項會自動帶入單價，也可直接新增全新工項。
      </p>
    </div>
  )
}

const KIND_COLOR = { 數量增減: 'blue', '單價變更-減': 'amber', '單價變更-加': 'amber', 新增項: 'green', 刪除項: 'red' }

function ChangeOrderCard({ co, net, leaves, allItems, canReview, canRatify, canEdit, onStatus, onDelete, onAddItem, onAddItems, onUpdateItem, onDeleteItem }) {
  const [draft, setDraft] = useState({ work_item_key: '', item_no: '', description: '', unit: '', qty_delta: '', unit_price: '', note: '' })
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [diff, setDiff] = useState(null) // { fileName, rows, summary }
  const [diffErr, setDiffErr] = useState('')
  const [applying, setApplying] = useState(false)
  const statusOptions = canReview && ['提出', '審核中'].includes(co.status)
    ? ['提出', '審核中']
    : canRatify && co.status === '審核中'
      ? ['審核中', '核准', '駁回']
      : canRatify && co.status === '核准'
        ? ['核准', '審核中']
        : []

  const onDiffFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setDiffErr('')
    try {
      const parsed = parsePccesXml(await f.text())
      setDiff({ fileName: f.name, ...diffBoq(allItems, parsed.items) })
    } catch (err) {
      setDiff(null)
      setDiffErr(err.message || '解析失敗')
    }
  }
  const applyDiff = async () => {
    setApplying(true)
    const { error } = await onAddItems(diff.rows)
    setApplying(false)
    if (!error) setDiff(null)
  }

  const results = search.trim() ? leaves.filter((it) => it.description.includes(search.trim()) || (it.item_no || '').includes(search.trim())).slice(0, 10) : []
  const pick = (it) => {
    setDraft((d) => ({ ...d, work_item_key: it.item_key, item_no: it.item_no, description: it.description, unit: it.unit, unit_price: it.unit_price ?? '' }))
    setSearch('')
  }
  const submit = async () => {
    if (!draft.description.trim()) return
    setAdding(true)
    const { error } = await onAddItem(draft)
    setAdding(false)
    if (!error) setDraft({ work_item_key: '', item_no: '', description: '', unit: '', qty_delta: '', unit_price: '', note: '' })
  }

  return (
    <Card title={`${co.co_no ? co.co_no + '　' : ''}${co.title}`} action={
      <div className="flex items-center gap-2">
        <span className={`text-sm font-medium tabular-nums ${net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{net >= 0 ? '+' : ''}{money(net)}</span>
        {statusOptions.length > 0 ? (
          <select value={co.status} onChange={(e) => onStatus(e.target.value)}
            className="text-xs border border-[var(--border)] rounded-lg px-2 py-1 bg-[var(--surface)]">
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : <Badge color={STATUS_COLOR[co.status] || 'slate'}>{co.status}</Badge>}
        {canEdit && co.status === '駁回' && (
          <button onClick={() => onStatus('提出')} className="text-xs font-medium text-[var(--blue)] hover:underline">重新提出</button>
        )}
        {canEdit && <button onClick={onDelete} className="text-[var(--text-3)] hover:text-rose-600 text-sm">✕</button>}
      </div>
    }>
      <div className="flex items-center gap-2 mb-3 text-xs text-[var(--text-3)]">
        <Badge color={STATUS_COLOR[co.status] || 'slate'}>{co.status}</Badge>
        {co.co_date && <span>{co.co_date}</span>}
      </div>

      {co.items.length > 0 && (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                <th className="text-left font-medium py-1.5">工項</th>
                <th className="text-right font-medium px-2">單位</th>
                <th className="text-right font-medium px-2">數量增減</th>
                <th className="text-right font-medium px-2">單價</th>
                <th className="text-right font-medium px-2">金額增減</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {co.items.map((it) => (
                <tr key={it.id} className="border-b border-[var(--border-2)]">
                  <td className="py-1.5"><span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{it.item_no}</span>{it.description}</td>
                  <td className="px-2 text-right text-[var(--text-3)] text-xs whitespace-nowrap">{it.unit}</td>
                  <td className="px-2 text-right">
                    <input type="number" step="any" defaultValue={it.qty_delta ?? ''}
                      disabled={!canEdit}
                      onBlur={(e) => { const n = parseFloat(e.target.value); onUpdateItem(it.id, { qty_delta: isNaN(n) ? 0 : n }) }}
                      className="w-20 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums" />
                  </td>
                  <td className="px-2 text-right">
                    <input type="number" step="any" defaultValue={it.unit_price ?? ''}
                      disabled={!canEdit}
                      onBlur={(e) => { const n = parseFloat(e.target.value); onUpdateItem(it.id, { unit_price: isNaN(n) ? 0 : n }) }}
                      className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums" />
                  </td>
                  <td className={`px-2 text-right tabular-nums font-medium ${(Number(it.amount_delta) || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{(Number(it.amount_delta) || 0) >= 0 ? '+' : ''}{money(it.amount_delta)}</td>
                  <td className="text-right pl-2">{canEdit && <button onClick={() => onDeleteItem(it.id)} className="text-[var(--text-3)] hover:text-rose-600">✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 變更後預算書 diff → 自動產生明細 */}
      {canEdit && <div className="mb-3">
        <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 border border-[var(--border)] transition ${applying ? 'opacity-40' : 'cursor-pointer hover:bg-[var(--surface-2)] text-[var(--blue)]'}`}>
          <FileUp size={15} aria-hidden />上傳變更後預算書 XML，自動產生明細
          <input type="file" accept=".xml" className="hidden" onChange={onDiffFile} disabled={applying} />
        </label>
        {diffErr && <p className="text-xs text-rose-600 mt-1.5">{diffErr}</p>}
        {diff && (
          <div className="mt-2 border border-[var(--border)] rounded-lg p-3 bg-[var(--surface)]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-2)]">
              <span className="font-medium text-[var(--text)]">{diff.fileName}</span>
              <span>數量增減 {diff.summary.changed} 項</span>
              <span>單價變更 {diff.summary.priceChanged} 項</span>
              <span>新增 {diff.summary.added} 項</span>
              <span>刪除 {diff.summary.removed} 項</span>
              <span className={`font-medium tabular-nums ${diff.summary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>淨額 {diff.summary.net >= 0 ? '+' : ''}{money(diff.summary.net)}</span>
            </div>
            {diff.rows.length === 0 ? (
              <p className="text-sm text-[var(--text-3)] mt-2">與現行標單無差異。</p>
            ) : (
              <>
                <div className="overflow-auto max-h-64 mt-2">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                        <th className="text-left font-medium py-1">類型</th>
                        <th className="text-left font-medium px-2">工項</th>
                        <th className="text-right font-medium px-2">單位</th>
                        <th className="text-right font-medium px-2">數量增減</th>
                        <th className="text-right font-medium px-2">單價</th>
                        <th className="text-right font-medium px-2">金額增減</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.rows.map((r, i) => (
                        <tr key={i} className="border-b border-[var(--border-2)]">
                          <td className="py-1"><Badge color={KIND_COLOR[r.kind] || 'slate'}>{r.kind}</Badge></td>
                          <td className="px-2"><span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{r.item_no}</span>{r.description}</td>
                          <td className="px-2 text-right text-[var(--text-3)] text-xs whitespace-nowrap">{r.unit}</td>
                          <td className="px-2 text-right tabular-nums">{r.qty_delta}</td>
                          <td className="px-2 text-right tabular-nums">{money(r.unit_price)}</td>
                          <td className={`px-2 text-right tabular-nums font-medium ${r.amount_delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{r.amount_delta >= 0 ? '+' : ''}{money(r.amount_delta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Button onClick={applyDiff} disabled={applying}>{applying ? '套用中…' : `套用 ${diff.rows.length} 筆明細`}</Button>
                  <button onClick={() => setDiff(null)} className="text-sm text-[var(--text-3)] hover:underline">取消</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>}

      {/* 新增明細 */}
      {canEdit && <div className="bg-[var(--surface-2)] rounded-lg p-3">
        <div className="relative mb-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋既有工項連結（可留空直接新增全新項）…"
            className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]" />
          {results.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-56 overflow-auto">
              {results.map((it) => (
                <button key={it.item_key} onClick={() => pick(it)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] truncate">
                  <span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="工項名稱"
            className="flex-1 min-w-[140px] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]" />
          <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="單位"
            className="w-16 border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--surface)]" />
          <input type="number" step="any" value={draft.qty_delta} onChange={(e) => setDraft({ ...draft, qty_delta: e.target.value })} placeholder="數量±"
            className="w-24 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm tabular-nums bg-[var(--surface)]" />
          <input type="number" step="any" value={draft.unit_price} onChange={(e) => setDraft({ ...draft, unit_price: e.target.value })} placeholder="單價"
            className="w-24 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm tabular-nums bg-[var(--surface)]" />
          <Button onClick={submit} disabled={adding || !draft.description.trim()}>{adding ? '…' : '＋ 明細'}</Button>
        </div>
        <p className="text-[11px] text-[var(--text-3)] mt-1.5">追加填正數量、減帳填負數量。金額 = 數量 × 單價，自動計算。</p>
      </div>}
    </Card>
  )
}
