import { useState, useMemo } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Stat, Empty, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { parseLocalDate } from '../../lib/dates.js'

const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

// 依計畫起迄 + 完成% 推導狀態
function deriveState(sch, pct) {
  if (pct >= 99.99) return { key: 'done', label: '已完成', color: 'var(--green-text)' }
  const t = today0(), end = parseLocalDate(sch.planned_finish), start = parseLocalDate(sch.planned_start)
  if (end && t > end) return { key: 'late', label: '落後', color: 'var(--red-text)' }
  if (start && t >= start) return { key: 'doing', label: '進行中', color: 'var(--blue)' }
  if (start && t < start) return { key: 'pending', label: '未開始', color: 'var(--text-3)' }
  return { key: 'noplan', label: '未排定', color: 'var(--text-3)' }
}

export default function Schedule() {
  const { project, workItems, dbMode, demoMode, valuations, itemSchedules, setItemSchedule, removeItemSchedule } = useStore()
  const [search, setSearch] = useState('')
  const [errMsg, setErrMsg] = useState('') // 排程寫入失敗必須讓使用者看到(失敗=UI 不變)
  const onSet = async (key, patch) => {
    setErrMsg('')
    const { error } = await setItemSchedule(key, patch)
    if (error) setErrMsg(`排程未寫入：${error.message}`)
  }

  // 發包末端工項 + 查表
  const { leaves, byKey } = useMemo(() => {
    if (!workItems) return { leaves: [], byKey: new Map() }
    const childMap = new Map()
    for (const it of workItems.items) { const k = it.parent_key || '__root__'; if (!childMap.has(k)) childMap.set(k, []); childMap.get(k).push(it) }
    const m = new Map(workItems.items.map((it) => [it.item_key, it]))
    const lv = workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
    return { leaves: lv, byKey: m }
  }, [workItems])

  // 最新一期估驗的累計完成數量（{ item_key: cum_qty }）
  const cumQty = useMemo(() => {
    const last = valuations[valuations.length - 1]
    return last?.items || {}
  }, [valuations])

  const rows = useMemo(() => Object.keys(itemSchedules).map((key) => {
    const it = byKey.get(key) || {}
    const q = it.quantity || 0
    const pct = q > 0 ? Math.min(100, ((cumQty[key] || 0) / q) * 100) : 0
    const sch = itemSchedules[key]
    return { key, it, sch, pct, state: deriveState(sch, pct) }
  }).sort((a, b) => (a.sch.planned_start || '').localeCompare(b.sch.planned_start || '')), [itemSchedules, byKey, cumQty])

  const counts = useMemo(() => {
    let late = 0, doing = 0, done = 0
    for (const r of rows) { if (r.state.key === 'late') late++; else if (r.state.key === 'doing') doing++; else if (r.state.key === 'done') done++ }
    return { total: rows.length, late, doing, done }
  }, [rows])

  const q = search.trim()
  const results = q ? leaves.filter((it) => !itemSchedules[it.item_key] && (it.description.includes(q) || (it.item_no || '').includes(q))).slice(0, 15) : []

  if (!dbMode && !demoMode) {
    return <Card title="逐工項排程"><Empty>此功能需真實專案（已匯入標單）。請先建立專案並匯入標單。</Empty></Card>
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="逐工項排程" tagline="每項計畫起迄・落後追蹤" subtitle="對關鍵工項設定計畫起迄，依最新估驗完成數量自動判斷落後" />
      </div>

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="已排程工項" value={counts.total} sub="項" color="text-[var(--text)]" />
        <Stat label="落後" value={counts.late} sub="項" color={counts.late > 0 ? 'text-rose-600' : 'text-emerald-600'} />
        <Stat label="進行中" value={counts.doing} sub="項" color="text-[var(--blue-text)]" />
        <Stat label="已完成" value={counts.done} sub="項" color="text-[var(--green-text)]" />
      </div>

      <Card title="加入工項排程">
        <div className="relative">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項加入排程…"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:border-[var(--blue)] focus:outline-none" />
          {results.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-64 overflow-auto">
              {results.map((it) => (
                <button key={it.item_key} onClick={() => { onSet(it.item_key, { planned_start: null, planned_finish: null }); setSearch('') }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] flex justify-between gap-2">
                  <span className="truncate"><span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}</span>
                  <span className="text-[var(--text-3)] text-xs shrink-0">{it.unit}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-[var(--text-3)] mt-2">建議只排關鍵 / 大宗工項。狀態：今天超過「計畫迄」且未完成 → 落後。完成%取自最新一期估驗。</p>
      </Card>

      <Card title={`排程清單（${rows.length}）`} action={rows.length > 0 && (
        <button onClick={() => exportCsv(`逐工項排程_${stamp()}`, rows, [
          { label: '項次', get: (r) => r.it.item_no || '' }, { label: '工項', get: (r) => r.it.description || r.key },
          { label: '單位', get: (r) => r.it.unit || '' }, { label: '計畫起', get: (r) => r.sch.planned_start || '' },
          { label: '計畫迄', get: (r) => r.sch.planned_finish || '' }, { label: '完成%', get: (r) => r.pct.toFixed(1) },
          { label: '狀態', get: (r) => r.state.label },
        ])} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ CSV</button>
      )}>
        {rows.length === 0 ? (
          <Empty>尚未排程任何工項。用上方搜尋把關鍵工項加進來，設定計畫起迄。</Empty>
        ) : (
          <div className="overflow-x-auto -mx-4 -my-4">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="text-left font-medium py-2 pl-5">工項</th>
                  <th className="text-left font-medium px-2">計畫起</th>
                  <th className="text-left font-medium px-2">計畫迄</th>
                  <th className="text-right font-medium px-2">完成%</th>
                  <th className="text-left font-medium px-2">狀態</th>
                  <th className="px-2 pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                    <td className="py-1.5 pl-5 min-w-[200px]"><span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{r.it.item_no}</span>{r.it.description || r.key}</td>
                    <td className="px-2">
                      {/* 只送變動的單欄;合併(起+訖)由 setItemSchedule 以 ref 累積+debounce
                          處理,同 tick 連發也會合併成單次正確寫入(R4 P1-01) */}
                      <input type="date" value={r.sch.planned_start || ''} onChange={(e) => onSet(r.key, { planned_start: e.target.value || null })}
                        aria-label={`${r.it.description || r.key} 計畫開始日`}
                        className="border border-[var(--border)] rounded px-1.5 py-0.5 text-xs" />
                    </td>
                    <td className="px-2">
                      <input type="date" value={r.sch.planned_finish || ''} onChange={(e) => onSet(r.key, { planned_finish: e.target.value || null })}
                        aria-label={`${r.it.description || r.key} 計畫完成日`}
                        className="border border-[var(--border)] rounded px-1.5 py-0.5 text-xs" />
                    </td>
                    <td className="px-2 text-right tabular-nums">{r.pct.toFixed(1)}%</td>
                    <td className="px-2"><span className="text-xs font-medium" style={{ color: r.state.color }}>{r.state.label}</span></td>
                    <td className="px-2 pr-5 text-right">
                      <button onClick={() => removeItemSchedule(r.key)} className="text-[var(--text-3)] hover:text-rose-600 text-sm">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)]">
        完成% = 最新一期估驗的累計完成數量 ÷ 契約數量。今天超過計畫迄且未完成 → 落後；今天在計畫起迄之間 → 進行中。比整體 S 曲線更細，能指出「哪一項」落後。
      </p>
    </div>
  )
}
