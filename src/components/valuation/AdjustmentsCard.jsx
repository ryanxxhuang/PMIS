// 估驗調整卡(P4d):已核定／已請款期的確認被撤銷／減量後產生的扣回(valuation_adjustments),三方同一張卡。
//   pending:下一期核定會被擋(pending_adjustment)。兩條出路都是 DB 的語意,不多加一條:
//     - 廠商在草稿期按「同步確認量」→ 併入最早草稿期成負分配(applied);
//     - 機關作廢(void_valuation_adjustment,原因必填)＝接受該量已計價,不再當超額,但永不產生新可用量。
//   applied／void:歷史留痕,只顯示。
// 沒有任何調整時不渲染(不佔版面);全部欄位來自 DB,前端不加減。
import { Card, Badge, Button } from '../ui.jsx'
import { fmtAmount as fmt, fmtDateTime } from '../../lib/format.js'

const STATUS = {
  pending: { color: 'red', text: '待處理' },
  applied: { color: 'green', text: '已扣回' },
  void: { color: 'slate', text: '已作廢' },
}
const num = (n) => fmt(n, { empty: '0' })

export default function AdjustmentsCard({ adjustments = [], periodNoOf, keyOf, itemOf, canVoid = false, onVoid }) {
  if (!adjustments.length) return null
  const pending = adjustments.filter((a) => a.status === 'pending')
  const rows = [...pending, ...adjustments.filter((a) => a.status !== 'pending')]
  const nameOf = (a) => {
    const key = keyOf ? keyOf(a.work_item_id) : null
    const it = key != null && itemOf ? itemOf(key) : null
    return it ? { label: `${it.item_no} ${it.description}`, unit: it.unit || '', no: it.item_no } : { label: '(工項已移除)', unit: '', no: '' }
  }
  return (
    <Card title="估驗調整(扣回)" bodyClass="p-0"
      action={<span className="text-footnote text-[var(--text-2)] num">{pending.length} 筆待處理 · 共 {adjustments.length} 筆</span>}>
      {pending.length > 0 && (
        <p className="mx-5 mt-3 text-footnote text-[var(--amber-text)]">
          待處理的扣回會擋下一期核定:{canVoid ? '機關可作廢(接受該量已計價,不會產生新的可用量);不作廢則由廠商在草稿期「同步確認量」時併入扣回。' : '由機關作廢(接受已計價),或在草稿期「同步確認量」時併入扣回。'}
        </p>
      )}
      <ul role="list" aria-label="估驗調整" className="divide-y divide-[var(--border-2)]">
        {rows.map((a) => {
          const st = STATUS[a.status] || { color: 'slate', text: a.status }
          const w = nameOf(a)
          const origin = periodNoOf ? periodNoOf(a.origin_valuation_id) : null
          const applied = periodNoOf ? periodNoOf(a.applied_valuation_id) : null
          return (
            <li key={a.id} className="px-5 py-3 flex flex-wrap items-start gap-x-3 gap-y-1.5">
              <Badge color={st.color}>{st.text}</Badge>
              <span className="min-w-0 flex-1 basis-64">
                <span className="block text-body text-[var(--text)]">
                  <span className="tabular-nums font-medium">{num(a.qty_delta)} {w.unit}</span> · {w.label}
                  {origin != null && <span className="text-[var(--text-2)]">(第 {origin} 期已核定量)</span>}
                </span>
                <span className="block mt-0.5 text-footnote text-[var(--text-2)] break-words">
                  {a.reason}・{fmtDateTime(a.created_at)}
                  {a.status === 'applied' && applied != null && `・已於第 ${applied} 期扣回`}
                  {a.status === 'void' && `・作廢原因:${a.void_reason || '—'}(${fmtDateTime(a.voided_at)})`}
                </span>
              </span>
              {a.status === 'pending' && canVoid && onVoid && (
                <Button variant="ghost" size="sm" className="max-md:hidden" onClick={() => onVoid(a, w)} aria-label={`作廢調整 ${w.no}`}>作廢(接受已計價)</Button>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
