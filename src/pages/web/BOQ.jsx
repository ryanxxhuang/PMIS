import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Stat, Badge, Empty, Button, PageHeader } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { parsePccesXml } from '../../lib/parsePcces.js'

const fmt = (n) => (n == null ? '' : Math.round(n).toLocaleString('en-US'))
const yi = (n) => (n / 1e8).toFixed(2) + ' 億'

// 標單工項（BOQ）— 工項樹來自 store：有真專案讀 Supabase work_items，否則範例 JSON。
export default function BOQ() {
  const { workItems: data, workItemsSource, workItemsError, retryWorkItems, importWorkItems, isSupabaseConfigured, currentProject, resetProjectBoq, dbMode } = useStore()
  const [expanded, setExpanded] = useState(() => new Set())
  const [onlyBillable, setOnlyBillable] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState('')
  const [parsed, setParsed] = useState(null)   // 上傳 XML 解析結果 { meta, items }
  const fileRef = useRef(null)

  useEffect(() => {
    if (data) setExpanded(new Set(data.items.filter((it) => it.depth === 1).map((it) => it.item_key)))
  }, [data])

  const onPickFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportErr(''); setParsed(null)
    try {
      const result = parsePccesXml(await file.text())
      setParsed(result)
    } catch (err) {
      setImportErr(err.message || '解析失敗')
    }
    if (fileRef.current) fileRef.current.value = '' // 允許重選同檔
  }

  const runImport = async (parsedData) => {
    setImporting(true); setImportErr('')
    const { error } = await importWorkItems(parsedData)
    setImporting(false)
    if (error) setImportErr(error.message || '匯入失敗')
    else setParsed(null)
  }
  // 真專案且標單為空（不再以範例冒充）→ 顯示匯入 onboarding
  const canImport = isSupabaseConfigured && currentProject && workItemsSource === 'empty'

  const childrenMap = useMemo(() => {
    const map = new Map()
    if (data) {
      for (const it of data.items) {
        const k = it.parent_key || '__root__'
        if (!map.has(k)) map.set(k, [])
        map.get(k).push(it)
      }
    }
    return map
  }, [data])

  if (workItemsSource === 'error') {
    return (
      <Card title="標單工項">
        <Empty>
          <div className="space-y-3">
            <div>標單工項讀取失敗：{workItemsError || '請稍後再試'}</div>
            <Button onClick={retryWorkItems}>重試</Button>
          </div>
        </Empty>
      </Card>
    )
  }
  if (!data) return <Empty>載入標單工項中…</Empty>

  const { meta } = data
  const roots = (childrenMap.get('__root__') || []).filter((it) => !onlyBillable || it.is_billable)

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const renderRows = (items, level = 0) =>
    items.flatMap((it) => {
      const kids = (childrenMap.get(it.item_key) || []).filter((k) => !onlyBillable || k.is_billable)
      const hasKids = kids.length > 0
      const isOpen = expanded.has(it.item_key)
      const row = (
        <tr
          key={it.item_key}
          className={`border-b border-[var(--border-2)] hover:bg-[var(--surface-2)] ${
            it.depth === 1 ? 'bg-[var(--surface-2)]/70 font-semibold' : ''
          } ${!it.is_billable ? 'text-[var(--text-3)]' : ''}`}
        >
          <td className="py-1.5 pr-2" style={{ paddingLeft: 10 + level * 18 }}>
            {hasKids ? (
              <button onClick={() => toggle(it.item_key)} className="mr-1 w-4 inline-block text-[var(--text-3)] hover:text-[var(--text)]">
                {isOpen ? '▾' : '▸'}
              </button>
            ) : (
              <span className="mr-1 w-4 inline-block" />
            )}
            <span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{it.item_no}</span>
            <span className={it.depth <= 2 ? 'text-[var(--text)]' : ''}>{it.description}</span>
            {it.is_price_adjustable && <span className="ml-2 text-[10px] text-violet-600 align-middle">物調</span>}
            {it.item_kind === 'subtotal' && <span className="ml-2 text-[10px] text-[var(--text-3)] align-middle">合計</span>}
          </td>
          <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{it.unit}</td>
          <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{fmt(it.quantity)}</td>
          <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{fmt(it.unit_price)}</td>
          <td className="text-right text-[var(--text)] px-2 tabular-nums whitespace-nowrap">{fmt(it.amount)}</td>
        </tr>
      )
      if (hasKids && isOpen) return [row, ...renderRows(kids, level + 1)]
      return [row]
    })

  return (
    <div className="space-y-5">
      <PageHeader title="標單工項" tagline="BOQ / WBS"
        subtitle={`${meta.project_name}　·　${meta.owner_name}`}
        meta={meta.contract_no ? [{ k: '契約編號', v: meta.contract_no }] : []}
        action={dbMode && workItemsSource === 'db' && (
          <Button variant="ghost" onClick={async () => {
            if (await appConfirm({ title: '重新匯入標單？', body: '會清空此專案的標單工項，以及相依的估驗、進度、施工日誌、查驗、缺失。', danger: true, confirmLabel: '清空重匯' })) await resetProjectBoq()
          }}>↻ 重新匯入標單</Button>
        )} />

      {canImport && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
          <div className="text-sm text-amber-800">
            此專案<b>尚未匯入標單</b>。到「<Link to="/contract" className="font-medium underline">專案文件</Link>」把標單 XML 和契約等文件<b>一次上傳</b>,系統會自動匯入並整理。
          </div>
          <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" onChange={onPickFile} className="hidden" />
          {!parsed ? (
            <div className="flex items-center gap-3 flex-wrap">
              <Link to="/contract"><Button>前往專案文件上傳</Button></Link>
              <button onClick={() => runImport()} disabled={importing} className="text-xs text-amber-700 hover:text-amber-900 underline disabled:opacity-50">
                {importing ? '匯入中…' : '沒有檔案？用範例標單試試'}
              </button>
              {importErr && <span className="text-sm text-rose-600">{importErr}</span>}
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap bg-[var(--amber-tint)] rounded-lg border border-[var(--amber-text)]/25 px-3 py-2">
              <div className="text-sm text-[var(--text)]">
                解析成功：<b>{parsed.meta.project_name || '（未命名）'}</b>　·
                {fmt(parsed.meta.item_count)} 項工項，發包工程費 <b className="text-[var(--blue-text)]">{yi(parsed.meta.billable_total)}</b>
              </div>
              <Button onClick={() => runImport(parsed)} disabled={importing}>{importing ? '匯入中…' : `匯入 ${fmt(parsed.meta.item_count)} 工項`}</Button>
              <button onClick={() => setParsed(null)} className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)]">取消</button>
              {importErr && <span className="text-sm text-rose-600">{importErr}</span>}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="發包工程費" value={yi(meta.billable_total)} sub={`NT$ ${fmt(meta.billable_total)}`} color="text-[var(--blue-text)]" />
        <Stat label="工項總數" value={fmt(meta.item_count)} sub="含分項與合計列" />
        <Stat label="末端計價工項" value={fmt(meta.leaf_count)} sub="估驗 / 數量管制單元" />
        <Stat label="資料來源"
          value={workItemsSource === 'db' ? 'Supabase' : workItemsSource === 'empty' ? '尚未匯入' : 'PCCES'}
          sub={workItemsSource === 'db' ? '已存入資料庫' : workItemsSource === 'empty' ? '請上傳標單 XML' : '範例（PCCES 匯入）'}
          color={workItemsSource === 'db' ? 'text-emerald-600' : 'text-[var(--text)]'} />
      </div>

      <Card
        title="工項階層"
        action={
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-2)] cursor-pointer">
            <input type="checkbox" checked={onlyBillable} onChange={(e) => setOnlyBillable(e.target.checked)} />
            只看發包工程費
          </label>
        }
      >
        <div className="overflow-x-auto -mx-4 -my-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                <th className="text-left font-medium py-2 pl-3">項次 / 工項名稱</th>
                <th className="text-right font-medium px-2">單位</th>
                <th className="text-right font-medium px-2">數量</th>
                <th className="text-right font-medium px-2">單價</th>
                <th className="text-right font-medium px-2 pr-3">複價</th>
              </tr>
            </thead>
            <tbody>{renderRows(roots)}</tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-[var(--text-3)]">
        <Badge color="purple">物調</Badge> = 物價調整項（variablePrice）。發包工程費（壹、貳）為廠商估驗計價基礎；參、肆為非發包（間接成本 / 機關收入），灰色顯示。
      </p>
    </div>
  )
}
