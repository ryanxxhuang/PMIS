// 可估驗清單(P4c):list_billable_backlog 的唯讀呈現——有 active 監造確認的工項,各自的有效確認量、
// 已計價、其他期占用、可用量、批次(含缺必要階段)與占用中的期別。全部數字來自 DB,前端只排版。
// 沒有草稿期時可估驗量先累積(建期後由 sync 帶入);同步的按鈕在期別動作列(全頁一顆),這裡只列與定位。
import { Card, Badge, Empty } from '../ui.jsx'
import { fmtAmount as fmt } from '../../lib/format.js'

const num = (n) => fmt(n, { empty: '0' })
const statusColor = { 草稿: 'slate', 監造審核: 'amber' }

export default function BacklogCard({ rows, loading, demo, draft, keyOf, onLocate }) {
  const total = rows.length
  const available = rows.filter((r) => Number(r.available) > 0).length
  return (
    <Card title="可估驗清單" bodyClass="p-0"
      action={!demo && !loading ? <span className="text-footnote text-[var(--text-2)] num">{total} 項有監造確認 · {available} 項有可用量</span> : null}>
      {demo ? (
        <p className="px-5 py-4 text-footnote text-[var(--text-2)]">示範模式沒有監造確認資料;正式專案的可估驗量由監造查驗／確認單產生,由資料庫核對後才可計價。</p>
      ) : loading ? (
        <p className="px-5 py-4 text-footnote text-[var(--text-3)]" aria-busy="true">載入可估驗清單…</p>
      ) : total === 0 ? (
        <div className="px-5 py-2"><Empty icon="fact_check" title="尚無監造確認量">監造在品質查驗判定通過、或簽發監造確認單後,可估驗量會列在這裡;{draft ? '同步到草稿期後才可請款。' : '尚未開期時先在此累積,建立估驗期後自動帶入。'}</Empty></div>
      ) : (
        <>
          {!draft && <p className="mx-5 mt-3 text-footnote text-[var(--amber-text)]">尚無草稿期:可估驗量先累積,建立估驗期後會自動帶入。</p>}
          <ul role="list" aria-label="可估驗清單" className="divide-y divide-[var(--border-2)]">
            {rows.map((r) => {
              const key = keyOf?.(r.work_item_id)
              return (
                <li key={r.work_item_id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 basis-56">
                      <span className="text-[var(--text-3)] text-xs tabular-nums mr-1">{r.item_no}</span>
                      <span className="text-[var(--text)]">{r.description}</span>
                    </span>
                    <span className="tabular-nums text-[var(--text-2)]">有效 {num(r.effective)} {r.unit}</span>
                    <span className="tabular-nums text-[var(--text-2)]">已計價 {num(r.billed)}</span>
                    <span className="tabular-nums text-[var(--text-2)]">占用 {num(r.reserved)}</span>
                    <span className={`tabular-nums font-medium ${Number(r.available) > 0 ? 'text-[var(--green-text)]' : 'text-[var(--text-3)]'}`}>可用 {num(r.available)}</span>
                    {r.basis == null && <Badge color="amber">計價依據待設定</Badge>}
                    {(r.occupied_by || []).map((o) => (
                      <Badge key={o.valuation_id} color={statusColor[o.status] || 'slate'}>第 {o.period_no} 期{o.status}</Badge>
                    ))}
                    {key && onLocate && <button onClick={() => onLocate(key)} className="text-xs text-[var(--blue-text)] hover:underline">在明細定位</button>}
                  </div>
                  {(r.batches || []).length > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--text-3)]">
                      {r.batches.map((b) => (
                        <li key={b.batch_key} className="tabular-nums">
                          批次 {b.batch_key}:有效 {num(b.effective_qty)}、已分配 {num(b.allocated_qty)}、可用 {num(b.available_qty)}
                          {Array.isArray(b.missing_stages) && b.missing_stages.length > 0 && <span className="text-[var(--amber-text)]">(缺階段 {b.missing_stages.join('、')})</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Card>
  )
}
