// 估驗明細的佐證展開列(重構波次 7 由 pages/web/Valuation.jsx 的 renderEvidenceRow 閉包抽出)。
// 沿用樹狀列展開的語彙(該列下方插一列),不開 modal。
// memo:ev 物件來自 getEvidence 的快取(資料不變就是同一個 reference),所以父列因
// 展開/數量變動重畫時,這一列不必跟著重畫。
import { memo } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../icons.jsx'
import { Badge } from '../ui.jsx'
import { evStatusColor } from '../../lib/evidence.js'

// 日誌筆數上限:一個工項施作上百天時,展開列不該把整年的日誌全塞進畫面
const EV_LOG_LIMIT = 30

function EvidenceRow({ it, ev, level }) {
  return (
    <tr className="border-b border-[var(--border-2)] bg-[var(--surface-2)]">
      {/* 縮排同明細列改佔位 span(+20 對齊展開鈕後的文字起點),colSpan 結構不動 */}
      <td colSpan={8} className="py-2.5 pl-5 pr-5">
        <div className="flex">
          <span style={{ width: level * 18 + 20 }} className="shrink-0" aria-hidden="true" />
          <div className="space-y-2 text-xs min-w-0">
          {ev.logs.length > 0 && (
            <div>
              <div className="font-medium text-[var(--text-2)] mb-0.5">
                施工日誌 <span className="text-[var(--text-3)] font-normal">{ev.logs.length} 筆</span>
                <Link to="/site-log" className="ml-2 inline-flex items-center gap-0.5 align-[-2px] text-[var(--blue-text)] hover:underline font-normal">前往日誌<MSym name="arrow_forward" size={12} /></Link>
              </div>
              <ul className="space-y-0.5">
                {ev.logs.slice(0, EV_LOG_LIMIT).map((l) => (
                  <li key={l.log_date} className="text-[var(--text-3)]">
                    <span className="tabular-nums text-[var(--text-2)]">{l.log_date}</span>
                    <span className="mx-1.5 tabular-nums">{l.qty.toLocaleString('en-US')} {it.unit}</span>
                    {l.note && <span className="text-[var(--text-3)]">— {l.note}</span>}
                  </li>
                ))}
                {ev.logs.length > EV_LOG_LIMIT && (
                  <li className="text-[var(--text-3)]">共 {ev.logs.length} 筆,僅列最近 {EV_LOG_LIMIT} 筆</li>
                )}
              </ul>
            </div>
          )}
          {ev.inspections.length > 0 && (
            <div>
              <div className="font-medium text-[var(--text-2)] mb-0.5">
                查驗 <span className="text-[var(--text-3)] font-normal">{ev.inspections.length} 筆</span>
                <Link to="/quality" className="ml-2 inline-flex items-center gap-0.5 align-[-2px] text-[var(--blue-text)] hover:underline font-normal">前往品質查驗<MSym name="arrow_forward" size={12} /></Link>
              </div>
              <ul className="space-y-0.5">
                {ev.inspections.map((i) => (
                  <li key={i.id} className="text-[var(--text-3)]">
                    {i.title}
                    <Badge color={evStatusColor(i.status)} className="ml-1.5">{i.status}</Badge>
                    {i.inspected_at && <span className="ml-1.5 tabular-nums">{String(i.inspected_at).slice(0, 10)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ev.checklists.length > 0 && (
            <div>
              <div className="font-medium text-[var(--text-2)] mb-0.5">
                自主檢查表 <span className="text-[var(--text-3)] font-normal">{ev.checklists.length} 筆</span>
                <Link to="/quality" className="ml-2 inline-flex items-center gap-0.5 align-[-2px] text-[var(--blue-text)] hover:underline font-normal">前往自主檢查<MSym name="arrow_forward" size={12} /></Link>
              </div>
              <ul className="space-y-0.5">
                {ev.checklists.map((r) => (
                  <li key={r.id} className="text-[var(--text-3)]">
                    {r.title}
                    <span className="ml-1.5 tabular-nums">{r.check_date}</span>
                    <Badge color={evStatusColor(r.overall)} className="ml-1.5">{r.overall || '未判定'}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ev.samples.length > 0 && (
            <div>
              <div className="font-medium text-[var(--text-2)] mb-0.5">
                取樣試體 <span className="text-[var(--text-3)] font-normal">{ev.samples.length} 組(以澆置日對應)</span>
                <Link to="/quality" className="ml-2 inline-flex items-center gap-0.5 align-[-2px] text-[var(--blue-text)] hover:underline font-normal">前往取樣試驗<MSym name="arrow_forward" size={12} /></Link>
              </div>
              <ul className="space-y-0.5">
                {ev.samples.map((s) => (
                  <li key={s.id} className="text-[var(--text-3)]">
                    <span className="text-[var(--text-2)]">{s.sample_no}</span>
                    <span className="ml-1.5 tabular-nums">取樣 {s.sampled_date}</span>
                    <Badge color={evStatusColor(s.status)} className="ml-1.5">{s.status}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ev.counts.logs + ev.counts.inspections + ev.counts.checklists + ev.counts.samples === 0 && (
            <div className="text-[var(--text-3)]">此工項尚無任何現場紀錄佐證(施工日誌/查驗/檢查表/試體均查無對應)。</div>
          )}
          </div>
        </div>
      </td>
    </tr>
  )
}

export default memo(EvidenceRow)
