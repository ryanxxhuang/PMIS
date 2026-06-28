import { useState, useMemo, useEffect } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Empty } from '../../components/ui.jsx'

const fmt = (n) => (n == null || isNaN(n) ? '' : Math.round(n).toLocaleString('en-US'))
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SiteLog() {
  const { project, workItems, siteLogs, saveSiteLog, deleteSiteLog, isSupabaseConfigured, currentProject, workItemsSource } = useStore()
  const [date, setDate] = useState(todayStr())
  const [weather, setWeather] = useState('晴')
  const [summary, setSummary] = useState('')
  const [items, setItems] = useState({}) // item_key -> 當日數量
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  // 發包末端工項（可回報的單元）+ 查表
  const { leaves, byKey } = useMemo(() => {
    if (!workItems) return { leaves: [], byKey: new Map() }
    const childMap = new Map()
    for (const it of workItems.items) {
      const k = it.parent_key || '__root__'
      if (!childMap.has(k)) childMap.set(k, [])
      childMap.get(k).push(it)
    }
    const m = new Map(workItems.items.map((it) => [it.item_key, it]))
    const lv = workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
    return { leaves: lv, byKey: m }
  }, [workItems])

  // 切換日期 → 載入該日已存的日誌
  useEffect(() => {
    const lg = siteLogs.find((l) => l.log_date === date)
    if (lg) { setWeather(lg.weather || '晴'); setSummary(lg.work_summary || ''); setItems({ ...lg.items }) }
    else { setItems({}); setSummary('') }
  }, [date, siteLogs])

  if (!workItems) return <Empty>載入中…</Empty>
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return <Card title="施工日誌"><Empty>此專案的標單尚未匯入資料庫。請先到「標單工項」匯入標單，才能回報工項數量。</Empty></Card>
  }

  const q = search.trim()
  const results = q ? leaves.filter((it) => it.description.includes(q) || (it.item_no || '').includes(q)).slice(0, 20) : []
  const addItem = (key) => { setItems((p) => ({ ...p, [key]: p[key] ?? 0 })); setSearch('') }
  const setQty = (key, val) => {
    let n = parseFloat(val); if (isNaN(n)) n = 0
    const it = byKey.get(key); const mq = it?.quantity || 0
    n = Math.max(0, mq > 0 ? Math.min(mq, n) : n)
    setItems((p) => ({ ...p, [key]: n }))
  }
  const removeItem = (key) => setItems((p) => { const n = { ...p }; delete n[key]; return n })

  const onSave = async () => {
    setSaving(true); setSavedMsg('')
    const { error } = await saveSiteLog({ log_date: date, weather, work_summary: summary, items })
    setSaving(false)
    setSavedMsg(error ? (error.message || '存檔失敗') : '已存檔 ✓')
  }

  const reportedKeys = Object.keys(items)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--text)]">施工日誌 <span className="text-[var(--text-3)] font-normal text-base">每日進度回報</span></h1>
        <p className="text-sm text-[var(--text-2)] mt-1">{project.project_name}　·　填各工項當日完成數量，估驗可一鍵帶入累計</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Card title="本日日誌">
            <div className="flex items-end gap-3 flex-wrap mb-4">
              <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" /></Field>
              <Field label="天氣"><input value={weather} onChange={(e) => setWeather(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm w-20" /></Field>
              <Field label="工作摘要"><input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="今日施工概況" className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm w-64" /></Field>
            </div>

            <div className="relative mb-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項加入今日回報…" className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:border-[var(--blue)] focus:outline-none" />
              {results.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-64 overflow-auto">
                  {results.map((it) => (
                    <button key={it.item_key} onClick={() => addItem(it.item_key)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] flex justify-between gap-2">
                      <span className="truncate"><span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}</span>
                      <span className="text-[var(--text-3)] text-xs shrink-0">{it.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {reportedKeys.length === 0 ? (
              <Empty>尚未加入工項。用上面搜尋把今天有施作的工項加進來，填當日數量。</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                    <th className="text-left py-1.5">工項</th>
                    <th className="text-right px-2 whitespace-nowrap">單位</th>
                    <th className="text-right px-2 whitespace-nowrap">契約數量</th>
                    <th className="text-right px-2 whitespace-nowrap">當日完成數量</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reportedKeys.map((key) => {
                    const it = byKey.get(key) || {}
                    return (
                      <tr key={key} className="border-b border-[var(--border-2)]">
                        <td className="py-1.5"><span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{it.item_no}</span>{it.description}</td>
                        <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{it.unit}</td>
                        <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{fmt(it.quantity)}</td>
                        <td className="text-right px-2">
                          <input type="number" min="0" step="any" value={items[key] ?? ''} onChange={(e) => setQty(key, e.target.value)}
                            className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums focus:border-[var(--blue)] focus:outline-none" />
                        </td>
                        <td className="text-right pl-2"><button onClick={() => removeItem(key)} className="text-[var(--text-3)] hover:text-rose-500">✕</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            <div className="flex items-center gap-3 mt-4">
              <Button onClick={onSave} disabled={saving}>{saving ? '存檔中…' : '存檔'}</Button>
              {savedMsg && <span className={`text-sm ${savedMsg.includes('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>{savedMsg}</span>}
            </div>
          </Card>
        </div>

        <Card title={`施工日誌（${siteLogs.length}）`}>
          {siteLogs.length === 0 ? <Empty>尚無日誌</Empty> : (
            <div className="space-y-1.5">
              {siteLogs.map((l) => (
                <div key={l.id} className={`px-3 py-2 rounded-lg text-sm border transition ${l.log_date === date ? 'bg-[var(--blue-tint)] border-[var(--blue)]' : 'border-[var(--border)] hover:bg-[var(--surface-2)]'}`}>
                  <div className="flex justify-between items-center gap-2">
                    <button onClick={() => setDate(l.log_date)} className="font-medium text-[var(--text)] tabular-nums text-left flex-1 truncate">{l.log_date}</button>
                    <span className="text-xs text-[var(--text-3)]">{Object.keys(l.items).length} 工項</span>
                    <button onClick={() => { if (window.confirm(`刪除 ${l.log_date} 的施工日誌？`)) deleteSiteLog(l.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button>
                  </div>
                  {l.work_summary && <div className="text-xs text-[var(--text-2)] truncate mt-0.5">{l.work_summary}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <p className="text-xs text-[var(--text-3)]">
        一天一筆（同日再存會覆蓋）。各日「當日完成數量」加總 = 估驗的「累計完成數量」——到估驗頁按「從施工日誌帶入」即可自動填入。
      </p>
    </div>
  )
}
