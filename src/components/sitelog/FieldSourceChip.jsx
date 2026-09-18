// 欄位來源／狀態章(P2c;設計 §2.3):每個欄位旁一顆——已帶入・待核對(AI／既有紀錄／沿用昨日)、
// 待補、不適用、已確認。顏色＋文字並存(規範 §2),來源短句由 lib/fieldDocs.sourceLabel 給。
// 可編視角多兩個就地動作:「確認」(filled → confirmed,值不動)、「本日無」(na＋原因)。
// humanOnly(P3a 監造日誌到場):人填欄的 filled 不是「AI 帶入待核對」而是「已填・待親自確認」(鏡像 DB
// needs_confirmation),章改琥珀色、確認鈕文字由呼叫端給(如「確認到場」);唯讀視角一樣看得到待確認。
import { Badge } from '../ui.jsx'
import { FIELD_STATUS_LABEL, FIELD_STATUS_TONE, sourceLabel } from '../../lib/fieldDocs.js'

export default function FieldSourceChip({ source, editable = false, onConfirm, onNa, naLabel = '本日無', confirmLabel = '確認', humanOnly = false, className = '' }) {
  const status = source?.status || 'pending'
  const needsConfirmation = humanOnly && status === 'filled'
  const label = needsConfirmation ? '已填・待親自確認' : (FIELD_STATUS_LABEL[status] || status)
  const from = status === 'pending' || needsConfirmation ? null : sourceLabel(source?.source)
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap ${className}`}>
      <Badge color={needsConfirmation ? 'amber' : (FIELD_STATUS_TONE[status] || 'slate')}>
        {label}{from && status !== 'confirmed' ? `・${from}` : ''}
        {status === 'na' && source?.reason ? `・${source.reason}` : ''}
      </Badge>
      {editable && status === 'filled' && onConfirm && (
        <button type="button" onClick={onConfirm} className="text-caption font-medium text-[var(--blue-text)] hover:underline min-h-11 md:min-h-0 px-1">{confirmLabel}</button>
      )}
      {editable && onNa && (status === 'pending' || status === 'filled') && (
        <button type="button" onClick={onNa} className="text-caption font-medium text-[var(--text-3)] hover:underline min-h-11 md:min-h-0 px-1">{naLabel}</button>
      )}
    </span>
  )
}
