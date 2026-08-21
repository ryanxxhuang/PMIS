import { useState, useMemo } from 'react'
import { useStore } from '../../store.jsx'
import { MSym } from '../../components/icons.jsx'
import { Card, Stat, Empty, Badge, Input, PageHeader, ErrorBanner, THEAD_CLS } from '../../components/ui.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { parseLocalDate } from '../../lib/dates.js'

const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

// 依計畫起迄 + 完成% 推導狀態。tone 回 Badge 的 color key(語意),
// 不回原始色字串——顏色的唯一真相在 Badge 的五語意色票,頁面不 inline style 上色
function deriveState(sch, pct) {
  if (pct >= 99.99) return { key: 'done', label: '已完成', tone: 'green' }
  const t = today0(), end = parseLocalDate(sch.planned_finish), start = parseLocalDate(sch.planned_start)
  if (end && t > end) return { key: 'late', label: '落後', tone: 'red' }
  if (start && t >= start) return { key: 'doing', label: '進行中', tone: 'blue' }
  if (start && t < start) return { key: 'pending', label: '未開始', tone: 'slate' }
  return { key: 'noplan', label: '未排定', tone: 'slate' }
}

export default function Schedule() {
  const { project, workItems, adjustedItems, dbMode, demoMode, valuations, itemSchedules, setItemSchedule, removeItemSchedule } = useStore()
  const [search, setSearch] = useState('')
  const [errMsg, setErrMsg] = useState('') // 排程寫入失敗必須讓使用者看到(失敗=UI 不變)
  const onSet = async (key, patch) => {
    setErrMsg('')
    const { error } = await setItemSchedule(key, patch)
    if (error) setErrMsg(`排程未寫入：${error.message}`)
  }

  // 發包末端工項 + 查表。吃 adjustedItems 而非原始 workItems(財務單一真相層 B-02):
  // 完成% 的分母是契約數量,核准追加減後不用變更後數量,追加的工項會被誤判「已完成」、
  // 追減的永遠到不了 100%,落後判斷跟估驗頁分裂。變更只動 quantity/amount 不動樹形,
  // leaf 集合與 item_key 不受影響。
  const { leaves, byKey } = useMemo(() => {
    if (!workItems) return { leaves: [], byKey: new Map() }
    const childMap = new Map()
    for (const it of adjustedItems) { const k = it.parent_key || '__root__'; if (!childMap.has(k)) childMap.set(k, []); childMap.get(k).push(it) }
    const m = new Map(adjustedItems.map((it) => [it.item_key, it]))
    const lv = adjustedItems.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
    return { leaves: lv, byKey: m }
  }, [workItems, adjustedItems])

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
    return <Card title="逐工項排程"><Empty>此功能需真實專案（已匯入標單）。請先到「專案文件」一次上傳標單 XML。</Empty></Card>
  }

  return (
    <div className="space-y-5">
      <PageHeader title="逐工項排程" tagline="每項計畫起迄・落後追蹤" subtitle="對關鍵工項設定計畫起迄，依最新估驗完成數量自動判斷落後" />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="已排程工項" value={counts.total} sub="項" color="text-[var(--text)]" />
        <Stat label="落後" value={counts.late} sub="項" color={counts.late > 0 ? 'text-[var(--red-text)]' : 'text-[var(--green-text)]'} />
        <Stat label="進行中" value={counts.doing} sub="項" color="text-[var(--blue-text)]" />
        <Stat label="已完成" value={counts.done} sub="項" color="text-[var(--green-text)]" />
      </div>

      <Card title="加入工項排程">
        <div className="relative">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項加入排程…" />
          {results.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg [box-shadow:var(--shadow-overlay)] max-h-64 overflow-auto enter-menu">
              {results.map((it) => (
                <button key={it.item_key} onClick={() => { onSet(it.item_key, { planned_start: null, planned_finish: null }); setSearch('') }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] flex items-center justify-between gap-2 max-md:min-h-11">
                  <span className="truncate"><span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}</span>
                  <span className="text-[var(--text-3)] text-xs shrink-0">{it.unit}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-[var(--text-3)] mt-2">建議只排關鍵 / 大宗工項。狀態：今天超過「計畫迄」且未完成 → 落後。完成%取自最新一期估驗。</p>
      </Card>

      <Card title={`排程清單（${rows.length}）`} bodyClass="p-0" action={rows.length > 0 && (
        <button onClick={() => exportCsv(`逐工項排程_${stamp()}`, rows, [
          { label: '項次', get: (r) => r.it.item_no || '' }, { label: '工項', get: (r) => r.it.description || r.key },
          { label: '單位', get: (r) => r.it.unit || '' }, { label: '計畫起', get: (r) => r.sch.planned_start || '' },
          { label: '計畫迄', get: (r) => r.sch.planned_finish || '' }, { label: '完成%', get: (r) => r.pct.toFixed(1) },
          { label: '狀態', get: (r) => r.state.label },
        ])} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--blue-text)] hover:underline max-md:min-h-11"><MSym name="download" size={16} />CSV</button>
      )}>
        {rows.length === 0 ? (
          <Empty>尚未排程任何工項。用上方搜尋把關鍵工項加進來，設定計畫起迄。</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                {/* 表頭字型層走共用 THEAD_CLS(對齊/內距各表自決) */}
                <tr className="border-b border-[var(--border)]">
                  <th className={`${THEAD_CLS} text-left py-2 pl-5`}>工項</th>
                  <th className={`${THEAD_CLS} text-left px-2`}>計畫起</th>
                  <th className={`${THEAD_CLS} text-left px-2`}>計畫迄</th>
                  <th className={`${THEAD_CLS} text-right px-2`}>完成%</th>
                  <th className={`${THEAD_CLS} text-left px-2`}>狀態</th>
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
                      {/* W8-5:表格內輸入只提到 ~38px(max-md:py-2,斷點與手機層一致),不加 min-h——加了整張表列高會翻倍 */}
                      <input type="date" value={r.sch.planned_start || ''} onChange={(e) => onSet(r.key, { planned_start: e.target.value || null })}
                        aria-label={`${r.it.description || r.key} 計畫開始日`}
                        className="border border-[var(--border)] rounded-md px-1.5 py-0.5 max-md:py-2 text-xs" />
                    </td>
                    <td className="px-2">
                      <input type="date" value={r.sch.planned_finish || ''} onChange={(e) => onSet(r.key, { planned_finish: e.target.value || null })}
                        aria-label={`${r.it.description || r.key} 計畫完成日`}
                        className="border border-[var(--border)] rounded-md px-1.5 py-0.5 max-md:py-2 text-xs" />
                    </td>
                    <td className="px-2 text-right tabular-nums">{r.pct.toFixed(1)}%</td>
                    <td className="px-2"><Badge color={r.state.tone}>{r.state.label}</Badge></td>
                    <td className="px-2 pr-5 text-right">
                      <button onClick={() => removeItemSchedule(r.key)} aria-label={`移除 ${r.it.item_no || r.key} 的排程`}
                        className="p-2 -m-2 inline-flex items-center justify-center text-[var(--text-3)] hover:text-[var(--red-text)] max-md:min-h-11 max-md:min-w-11"><MSym name="close" size={16} /></button>
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
