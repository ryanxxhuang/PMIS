// 監造確認單表單(P4d):簽發／減量／補證三種用途同一張表,全部走 issue_supervisor_certificate(累計語意)。
//   簽發:同工項新批次或既有批次的較大累計 → 增量;DB 自動同步到適用草稿期。
//   減量:同批次填較小的累計 → guard 導出負增量並要求原因;草稿縮減、審核中標需重算、已核定建扣回(同撤銷收斂)。
//   補證(covers):歷史已核定期的 legacy 來源改掛到這張確認單(數量不變、留稽核),之後該期才可登錄請款日;
//         介面明講「這會成為該期的計價依據」與涵蓋範圍,不做成一鍵靜默補證。
// 不開 modal:就地面板(規範 §9.5 的 Surface 語彙),寫入只在桌機(§9.6)。上限、單位比對、階段集合都由 DB 判,
// 這裡只擋「必填空白」與「負數」——擋得住的錯誤不送出,擋不住的原樣顯示 DB 訊息。
import { useState } from 'react'
import { Surface, Button, Field, Input, Textarea, Badge } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import { fmtAmount as fmt } from '../../lib/format.js'

const num = (n) => fmt(n, { empty: '0' })

export default function CertificateForm({ target, busy = false, onSubmit, onCancel }) {
  const { it, mode = 'issue', covers = null, batchKey = '', locationLabel = '', stageKey = null, qtyCum = '', currentCum = null } = target
  const [batch, setBatch] = useState(batchKey)
  const [location, setLocation] = useState(locationLabel || batchKey)
  const [qty, setQty] = useState(qtyCum === '' || qtyCum == null ? '' : String(qtyCum))
  const [reason, setReason] = useState('')
  const [localErr, setLocalErr] = useState('')
  const isCover = mode === 'cover' && covers
  const isReduce = mode === 'reduce'
  const title = isCover
    ? `補證第 ${covers.period_no} 期:${it.item_no} ${it.description}`
    : isReduce ? `減量確認:${it.item_no} ${it.description}` : `簽發監造確認單:${it.item_no} ${it.description}`
  const submitLabel = isCover ? `簽發並補證第 ${covers.period_no} 期` : isReduce ? '簽發減量確認' : '簽發確認單'

  const submit = (e) => {
    e.preventDefault()
    const q = Number(qty)
    if (!batch.trim()) { setLocalErr('批次／位置必填(同一批次的確認量是累計語意)'); return }
    if (qty === '' || !Number.isFinite(q) || q < 0) { setLocalErr('累計確認量必須是 0 以上的數字'); return }
    if (isReduce && currentCum != null && q >= Number(currentCum)) { setLocalErr(`減量須填小於目前累計 ${num(currentCum)} 的數字;要增加請用「簽發監造確認單」`); return }
    if (isCover && covers.legacyQty != null && q < Number(covers.legacyQty)) { setLocalErr(`補證確認量不得小於該期歷史遷移量 ${num(covers.legacyQty)} ${it.unit || ''}(否則該期已計價量沒有依據)`); return }
    if (!reason.trim()) { setLocalErr('依據／說明必填(記入確認紀錄與稽核)'); return }
    setLocalErr('')
    onSubmit({ itemKey: it.item_key, batchKey: batch, locationLabel: location || batch, stageKey: stageKey || null, qtyCum: q, reason, coversValuationId: isCover ? covers.id : null })
  }

  return (
    <Surface as="form" onSubmit={submit} className="p-4 space-y-3 max-md:hidden" aria-label={title} data-testid="certificate-form">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-body font-medium text-[var(--text)]">{title}</h3>
          <p className="text-footnote text-[var(--text-2)] mt-0.5">
            {isCover
              ? '這張確認單會成為該期此工項已計價量的計價依據:該期的歷史遷移來源改掛到本批次(數量不變、留稽核),之後該期才可登錄請款日。'
              : isReduce
                ? '同一批次填較小的累計量即為減量:草稿期的分配會縮減、送審中的期別會標記需重算、已核定期會產生待處理扣回(由機關處理)。'
                : '監造親簽的累計確認量(不是本期增量):同一批次重複簽發以最新累計為準;確認後自動同步到適用的草稿期。'}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} aria-label="關閉確認單表單"><MSym name="close" size={16} /></Button>
      </div>
      {isCover && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-[var(--text-2)] rounded-lg bg-[var(--amber-tint)] px-3 py-2" aria-label="補證涵蓋範圍">
          <div><dt className="inline text-[var(--text-3)]">涵蓋期別 </dt><dd className="inline">第 {covers.period_no} 期<Badge color="green" className="ml-1">{covers.status}</Badge></dd></div>
          <div><dt className="inline text-[var(--text-3)]">該期歷史遷移量 </dt><dd className="inline tabular-nums">{num(covers.legacyQty)} {it.unit}</dd></div>
          <div className="col-span-2"><dt className="inline text-[var(--text-3)]">超出部分 </dt><dd className="inline">累計確認量大於遷移量的部分,自動同步到適用的草稿期;多階段工項不可補證(請逐階段簽發後再補)。</dd></div>
        </dl>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="批次／位置" required hint={isReduce || isCover ? '沿用原批次;改批次等於另開一批' : '例:A區、3F 東側;同批次的確認量累計'}>
          <Input value={batch} onChange={(e) => { setBatch(e.target.value); if (!location || location === batch) setLocation(e.target.value) }} readOnly={isReduce} aria-label="批次／位置" />
        </Field>
        <Field label={`累計確認量(${it.unit || '單位'})`} required hint={currentCum != null ? `目前累計 ${num(currentCum)}` : (Number.isFinite(Number(it.quantity)) ? `契約量 ${num(it.quantity)}` : undefined)}>
          <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="累計確認量" />
        </Field>
        <Field label="依據／說明" required hint="查驗紀錄、現場複核或補證依據;記入確認紀錄與稽核">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="依據／說明" />
        </Field>
      </div>
      {stageKey && <p className="text-footnote text-[var(--text-3)]">階段 {stageKey}</p>}
      {localErr && <p className="text-footnote text-[var(--red-text)]" role="alert">{localErr}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" busy={busy}>{submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </Surface>
  )
}
