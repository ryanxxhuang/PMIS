import { Card, Badge, Stat, Empty, SortableTh, TablePager } from '../ui.jsx'
import { useTableSort, usePagination } from '../../lib/useTable.js'
import { TWD_PER_USD, toTwd, pctOfTotal } from '../../store/slices/admin.js'
import { featureByKey } from '../../lib/aiFeatures.js'
import { LoadingCard, TR, TDR, TD, THR, TH, fmtUsd, fmtInt, PLAN_COLOR, PLAN_LABEL, CATEGORY_LABEL } from './shared.jsx'

const CATEGORY_COLOR = { agent: 'blue', document: 'purple', draft: 'amber', vision: 'green', integration: 'slate', automation: 'slate' }

const ORG_LABEL = { contractor: '施工廠商', supervisor: '監造', owner: '機關' }

const fmtTwd = (usd) => `NT$ ${Math.round(toTwd(usd)).toLocaleString('en-US')}`

const EMPTY_MSG = '這段期間還沒有 AI 使用紀錄。'

export function OverviewTab({ overview, daily, loading }) {
  const empty = !overview || Number(overview.total_calls) === 0
  if (empty) return loading ? <LoadingCard /> : <Card><Empty>{EMPTY_MSG}</Empty></Card>
  const o = overview
  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat label="總呼叫數" value={fmtInt(o.total_calls)}
          sub={`成功 ${fmtInt(o.ok_calls)}／失敗 ${fmtInt(o.error_calls)}／被擋下 ${fmtInt(o.blocked_calls)}`} />
        <Stat label="總成本(USD)" value={fmtUsd(o.cost_usd)}
          sub={`≈ ${fmtTwd(o.cost_usd)}(參考匯率 1 USD = ${TWD_PER_USD} TWD)`} />
        <Stat label="不重複使用者" value={fmtInt(o.distinct_users)} />
        <Stat label="不重複專案" value={fmtInt(o.distinct_projects)} />
      </div>
      <Card title="Token 用量">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            ['輸入 input', o.input_tokens],
            ['輸出 output', o.output_tokens],
            ['快取讀取 cache read', o.cache_read_tokens],
            ['快取寫入 cache write', o.cache_write_tokens],
          ].map(([label, v]) => (
            /* 標籤字級/色對齊 Stat(11px/text-2、無字距):同一頁不要有兩套數字標籤 */
            <div key={label} className="min-w-0">
              <div className="text-caption text-[var(--text-2)]">{label}</div>
              <div className="num text-lg font-normal text-[var(--text)] mt-0.5">{fmtInt(v)}</div>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="每日呼叫數">
          <DailyBars rows={daily} getV={(r) => Number(r.calls) || 0} fmt={fmtInt} barClass="bg-[var(--blue)]" />
        </Card>
        <Card title="每日成本(USD)">
          <DailyBars rows={daily} getV={(r) => Number(r.cost_usd) || 0} fmt={fmtUsd} barClass="bg-[var(--accent)]" />
        </Card>
      </div>
    </div>
  )
}

function DailyBars({ rows, getV, fmt, barClass }) {
  const max = Math.max(0, ...rows.map(getV))
  if (!rows.length || max <= 0) return <Empty>{EMPTY_MSG}</Empty>
  return (
    <div>
      <div className="flex items-end gap-[2px] h-36" role="img" aria-label={`每日長條圖,共 ${rows.length} 天,最高 ${fmt(max)}`}>
        {rows.map((r) => {
          const v = getV(r)
          return (
            <div key={r.day} title={`${r.day}:${fmt(v)}`}
              className={`flex-1 min-w-[3px] rounded-t-sm ${barClass}`}
              style={{ height: `${v > 0 ? Math.max((v / max) * 100, 2) : 0}%` }} />
          )
        })}
      </div>
      <div className="flex justify-between text-micro text-[var(--text-3)] num mt-1.5">
        <span>{rows[0].day}</span>
        <span>最高 {fmt(max)}</span>
        <span>{rows[rows.length - 1].day}</span>
      </div>
    </div>
  )
}

export function ByFeatureTab({ rows, loading, rangeKey }) {
  // 排序/分頁都是 client-side:admin RPC 一次回整段期間的彙總列,資料已在記憶體。
  // 佔總成本刻意用「全部列」算,不受排序與換頁影響——那是期間佔比,不是當頁佔比。
  const { sort, toggleSort, sorted, sortKey } = useTableSort(rows)
  // 換期間要回第 1 頁,但期間換了列數常常一樣(功能清單固定),光看列數看不出來,
  // 所以把 rangeKey 一起餵給 resetKey;手動重新整理(reloadKey)刻意不進來
  const { pageRows, pager } = usePagination(sorted, 25, `${rangeKey}|${sortKey}`)
  const totalCost = rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0)
  if (!rows.length) return loading ? <LoadingCard /> : <Card><Empty>{EMPTY_MSG}</Empty></Card>
  return (
    <Card bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[880px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>功能</th>
              <th className={TH}>分類</th>
              <SortableTh className={THR} align="right" numeric label="呼叫" field="calls" sort={sort} onSort={toggleSort} />
              <th className={THR}>失敗</th>
              <th className={THR}>被擋下</th>
              <SortableTh className={THR} align="right" numeric label="輸入" field="input_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="輸出" field="output_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="快取讀" field="cache_read_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="快取寫" field="cache_write_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="成本" field="cost_usd" sort={sort} onSort={toggleSort} />
              <th className={`${TH} min-w-[140px]`}>佔總成本</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const cat = featureByKey[r.feature_key]?.category
              const pct = pctOfTotal(r.cost_usd, totalCost)
              return (
                <tr key={r.feature_key} className={TR}>
                  <td className={TD}>
                    <div className="font-medium text-[var(--text)]">{r.label}</div>
                    <div className="text-caption text-[var(--text-3)] num">{r.feature_key}</div>
                  </td>
                  <td className={TD}>{cat && <Badge color={CATEGORY_COLOR[cat]}>{CATEGORY_LABEL[cat] || cat}</Badge>}</td>
                  <td className={TDR}>{fmtInt(r.calls)}</td>
                  <td className={`${TDR} ${Number(r.error_calls) > 0 ? 'text-[var(--red-text)]' : ''}`}>{fmtInt(r.error_calls)}</td>
                  <td className={`${TDR} ${Number(r.blocked_calls) > 0 ? 'text-[var(--amber-text)]' : ''}`}>{fmtInt(r.blocked_calls)}</td>
                  <td className={TDR}>{fmtInt(r.input_tokens)}</td>
                  <td className={TDR}>{fmtInt(r.output_tokens)}</td>
                  <td className={TDR}>{fmtInt(r.cache_read_tokens)}</td>
                  <td className={TDR}>{fmtInt(r.cache_write_tokens)}</td>
                  <td className={`${TDR} font-medium`}>{fmtUsd(r.cost_usd)}</td>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden min-w-[60px]">
                        <div className="h-full rounded-full bg-[var(--blue)]" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className="num text-caption text-[var(--text-2)] w-11 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <TablePager {...pager} />
    </Card>
  )
}

export function ByProjectTab({ rows, loading, rangeKey }) {
  const { sort, toggleSort, sorted, sortKey } = useTableSort(rows)
  const { pageRows, pager } = usePagination(sorted, 25, `${rangeKey}|${sortKey}`)
  if (!rows.length) return loading ? <LoadingCard /> : <Card><Empty>{EMPTY_MSG}</Empty></Card>
  return (
    <Card bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>專案</th>
              <th className={TH}>AI 方案</th>
              <SortableTh className={THR} align="right" numeric label="呼叫" field="calls" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="成本" field="cost_usd" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="輸入 token" field="input_tokens" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="輸出 token" field="output_tokens" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.project_id || 'none'} className={TR}>
                <td className={`${TD} font-medium text-[var(--text)]`}>
                  {r.project_name || <span className="text-[var(--text-3)] font-normal">(無專案脈絡或已刪除)</span>}
                </td>
                <td className={TD}>
                  {r.ai_plan && <Badge color={PLAN_COLOR[r.ai_plan]}>{PLAN_LABEL[r.ai_plan] || r.ai_plan}</Badge>}
                </td>
                <td className={TDR}>{fmtInt(r.calls)}</td>
                <td className={`${TDR} font-medium`}>{fmtUsd(r.cost_usd)}</td>
                <td className={TDR}>{fmtInt(r.input_tokens)}</td>
                <td className={TDR}>{fmtInt(r.output_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager {...pager} />
    </Card>
  )
}

export function ByUserTab({ rows, loading, rangeKey }) {
  const { sort, toggleSort, sorted, sortKey } = useTableSort(rows)
  const { pageRows, pager } = usePagination(sorted, 25, `${rangeKey}|${sortKey}`)
  if (!rows.length) return loading ? <LoadingCard /> : <Card><Empty>{EMPTY_MSG}</Empty></Card>
  return (
    <Card bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>使用者</th>
              <th className={TH}>公司</th>
              <th className={TH}>身分</th>
              <SortableTh className={THR} align="right" numeric label="呼叫" field="calls" sort={sort} onSort={toggleSort} />
              <SortableTh className={THR} align="right" numeric label="成本" field="cost_usd" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.user_id || 'none'} className={TR}>
                <td className={`${TD} font-medium text-[var(--text)]`}>
                  {r.full_name || <span className="text-[var(--text-3)] font-normal">(帳號已刪除)</span>}
                </td>
                <td className={TD}>{r.company || '—'}</td>
                <td className={TD}>{r.org_type && <Badge color="slate">{ORG_LABEL[r.org_type] || r.org_type}</Badge>}</td>
                <td className={TDR}>{fmtInt(r.calls)}</td>
                <td className={`${TDR} font-medium`}>{fmtUsd(r.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePager {...pager} />
    </Card>
  )
}
