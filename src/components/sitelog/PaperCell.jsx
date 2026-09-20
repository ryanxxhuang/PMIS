// 紙本表單的「格內可編輯」原語(2026-09-20 C 包)。畫面與列印／PDF 共用同一張紙本元件,
// 差別只有「有沒有給 edit context」:
//   * 沒有(列印頁、唯讀視角)→ 只有文字,不長出任何 input(唯讀 e2e 契約);
//   * 有 → 該格在 mapping 標為此角色可編時,直接在原表格子裡變成輸入框;AI／紙本抄錄帶進來的值
//     本來就已經在格子裡,旁邊只掛一枚輕量狀態章,點一下可回看原文與原照片。
// 這不是泛用表單設計器:版面仍由各張紙本元件逐格寫死(原表欄名、節次、欄寬照原表),
// 這裡只提供「一格」的共同行為(值/來源/狀態/證據/錨點/鍵盤焦點)。
import { createContext, useContext, useId, useState } from 'react'
import { MSym } from '../icons.jsx'
import { appPrompt } from '../confirm.jsx'
import { setFieldValue, confirmField, setFieldNa, fillHumanField, sourceLabel, fieldAnchorId, FIELD_STATUS_LABEL } from '../../lib/fieldDocs.js'
import { isEditableBy } from '../../lib/officialForms.js'

const PaperFormCtx = createContext(null)

// value={{ docType, org, state:{content,sources}, onChange, editable, issues:Map, photosById:Map }}
export function PaperFormProvider({ value, children }) {
  return <PaperFormCtx.Provider value={value}>{children}</PaperFormCtx.Provider>
}

export function usePaperForm() { return useContext(PaperFormCtx) }

// 一格的狀態:值、來源、是否可編(mapping 說了算)、待補高亮
export function usePaperField(key) {
  const ctx = useContext(PaperFormCtx)
  const source = ctx?.state?.sources?.[key] || null
  const canEdit = !!ctx?.editable && !!ctx?.docType && isEditableBy(ctx.docType, mappingKeyOf(key), ctx.org)
  return {
    ctx,
    source,
    editable: canEdit,
    issue: ctx?.issues?.get?.(key) || null,
    set: (v) => ctx?.onChange?.(setFieldValue(ctx.state, key, v)),
    fill: (v) => ctx?.onChange?.(fillHumanField(ctx.state, key, v)),
    confirm: () => ctx?.onChange?.(confirmField(ctx.state, key)),
    // 「本日無」與「不適用」是同一條規則(na＋原因;不得留空、不得填「無」),只是日報用語不同
    na: async (title, naLabel = '不適用') => {
      const word = naLabel === '本日無' ? '本日不適用' : '不適用'
      const reason = await appPrompt({ title: `${title}：${word}`, label: `${word}的原因（必填，如 本日未出工、本項不在本次施作範圍）`, required: true })
      if (reason === null) return
      ctx?.onChange?.(setFieldNa(ctx.state, key, reason))
    },
  }
}

// 實際欄位鍵 → mapping 鍵:工項／材料等逐列欄位在 mapping 是一列通則(items.<work_item_id>.qty_today)
export function mappingKeyOf(key) {
  const k = String(key)
  const m = /^items\.[^.]+\.(qty_today|location|note|description|unit)$/.exec(k)
  if (m) return `items.<work_item_id>.${m[1]}`
  // 檢查項目的項次可能含小數點(1.1),所以只看結尾是不是 .note
  if (k.startsWith('results.')) return k.endsWith('.note') ? 'results.<no>.note' : 'results.<no>'
  return k
}

// ── 狀態章(輕量;列印不印)──────────────────────────────────────────────────
// 值本身已經在格子裡,這枚章只講「這個值從哪來、要不要人確認」,以及提供回看證據的入口。
export function FieldMark({ fieldKey, title, naLabel = '不適用', allowNa = false, className = '' }) {
  const { ctx, source, editable, issue, confirm, na } = usePaperField(fieldKey)
  const [openEvidence, setOpenEvidence] = useState(false)
  const panelId = useId()
  if (!ctx || ctx.showMarks === false) return null // 純紙(列印／PDF):不掛來源章
  const status = source?.status || 'pending'
  const evidence = Array.isArray(source?.evidence) ? source.evidence : []
  const hint = source?.hint || null
  const hasEvidence = evidence.length > 0 || !!hint || !!source?.reason
  // 已確認且沒有證據可回看 → 不佔版面
  if (status === 'confirmed' && !hasEvidence && !issue) return null
  const tone = issue ? 'text-[var(--amber-text)]' : status === 'pending' ? 'text-[var(--amber-text)]' : status === 'na' ? 'paper-mute' : status === 'confirmed' ? 'paper-mute' : 'text-[var(--blue-text)]'
  const from = status === 'pending' || status === 'confirmed' ? null : sourceLabel(source?.source)
  return (
    <span className={`print:hidden inline-flex items-center gap-1 flex-wrap text-micro leading-tight ${className}`}>
      <span className={tone}>
        {issue === 'needs_confirmation' ? '待親自確認' : FIELD_STATUS_LABEL[status] || status}
        {from ? `・${from}` : ''}
        {status === 'na' && source?.reason ? `・${source.reason}` : ''}
      </span>
      {hasEvidence && (
        <button type="button" aria-expanded={openEvidence} aria-controls={panelId}
          onClick={() => setOpenEvidence((v) => !v)}
          className="inline-flex items-center gap-0.5 font-medium text-[var(--blue-text)] hover:underline">
          <MSym name="image_search" size={11} />原文
        </button>
      )}
      {editable && status === 'filled' && (
        <button type="button" onClick={confirm} className="font-medium text-[var(--blue-text)] hover:underline">確認</button>
      )}
      {editable && allowNa && (status === 'pending' || status === 'filled') && (
        <button type="button" onClick={() => na(title || fieldKey, naLabel)} className="font-medium paper-mute hover:underline">{naLabel}</button>
      )}
      {/* 抄錄進來的值旁邊直接看得到紙上原文(一行);帶不進來的讀數也在這裡說清楚,不必先點開 */}
      {status !== 'na' && evidence.length > 0 && status === 'filled' && (
        <span className="block w-full paper-mute">紙上原文：{[...new Set(evidence.map((e) => e.raw_text))].join('、')}{evidence[0]?.entry_no ? `（編號 ${evidence[0].entry_no}）` : ''}</span>
      )}
      {status !== 'na' && hint && (
        <span className="block w-full paper-warn">紙上寫「{hint.raw_text || `${hint.value}${hint.unit || ''}`}」（未自動帶入）</span>
      )}
      {openEvidence && <EvidencePanel id={panelId} source={source} photosById={ctx.photosById} />}
    </span>
  )
}

// 點欄位回看:紙上／板上原文 + 原照片縮圖(B 包已把 evidence 寫進 field_sources,這裡不另建一套)
function EvidencePanel({ id, source, photosById = new Map() }) {
  const evidence = Array.isArray(source?.evidence) ? source.evidence : []
  const hint = source?.hint || null
  const photoIds = [...new Set([...evidence.map((e) => e.photo_id), ...(Array.isArray(source?.refs) ? source.refs : [])].filter(Boolean))]
  return (
    <span id={id} role="group" aria-label="欄位證據" className="block w-full mt-1 rounded-md border paper-rule bg-[#fafafa] px-2 py-1.5 space-y-1 text-micro">
      {source?.reason && <span className="block paper-mute">{source.reason}</span>}
      {evidence.map((e, i) => (
        <span key={i} className="block paper-ink">
          {e.label ? `${e.label}：` : ''}「{e.raw_text}」
          {e.entry_no ? `（編號 ${e.entry_no}）` : ''}{e.unit ? `（單位 ${e.unit}）` : ''}
          {e.kind === 'design' ? '（設計值，不可當實測）' : e.kind === 'measured' ? '（紙上實測欄）' : ''}
        </span>
      ))}
      {hint && <span className="block paper-warn">紙上寫「{hint.raw_text || `${hint.value}${hint.unit || ''}`}」，未自動帶入，請人核對後自行填寫。</span>}
      {!evidence.length && !hint && !source?.reason && <span className="block paper-mute">沒有可回看的原文。</span>}
      {photoIds.length > 0 && (
        <span className="flex gap-1 flex-wrap pt-0.5">
          {photoIds.slice(0, 4).map((pid) => {
            const p = photosById?.get?.(pid)
            return p?.url
              ? <img key={pid} src={p.url} alt={p.caption || '原照片'} loading="lazy" className="w-16 h-12 object-cover rounded border paper-rule" />
              : <span key={pid} className="paper-mute">照片 {String(pid).slice(0, 8)}</span>
          })}
        </span>
      )}
    </span>
  )
}

// ── 格內輸入 ────────────────────────────────────────────────────────────────
// label 是原表欄名(aria-label 用,螢幕閱讀器與 e2e 都靠它定位);可編才長 input,否則純文字。
export function PaperInput({
  fieldKey, label, type = 'text', value, onValue, placeholder = '', align = 'left', className = '',
  options = null, human = false, readOnlyText = null, min = null, step = 'any', rows = 0,
}) {
  const f = usePaperField(fieldKey)
  const v = value !== undefined ? value : valueAt(f.ctx?.state?.content, fieldKey)
  const commit = (next) => {
    if (onValue) { onValue(next); return }
    if (human) f.fill(next)
    else f.set(next)
  }
  const alignCls = align === 'right' ? 'text-right tabular-nums' : align === 'center' ? 'text-center' : ''
  if (!f.editable) {
    const text = readOnlyText !== undefined && readOnlyText !== null ? readOnlyText : (v == null || v === '' ? '' : String(v))
    return <span className={`inline-block ${alignCls} ${className}`}>{text}</span>
  }
  const common = {
    'aria-label': label,
    className: `paper-input ${alignCls} ${className}`,
    placeholder,
  }
  if (options) {
    return (
      <select {...common} value={v ?? ''} onChange={(e) => commit(e.target.value || null)}>
        {options.map((o) => <option key={String(o.value ?? o)} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    )
  }
  if (rows > 0) {
    return <textarea {...common} rows={rows} value={v ?? ''} onChange={(e) => commit(e.target.value || null)} />
  }
  if (type === 'number') {
    return (
      <input {...common} type="number" inputMode="decimal" step={step} {...(min != null ? { min } : {})}
        value={v ?? ''} onChange={(e) => commit(e.target.value === '' ? null : Number(e.target.value))} />
    )
  }
  return <input {...common} type={type} value={v ?? ''} onChange={(e) => commit(e.target.value || null)} />
}

// 勾選格(原表的 □／■):可編時是真 checkbox,唯讀時印 ■/□
export function PaperCheck({ fieldKey, label, checked, onToggle }) {
  const f = usePaperField(fieldKey)
  const on = checked !== undefined ? checked : !!valueAt(f.ctx?.state?.content, fieldKey)
  if (!f.editable) return <span className="mr-3">{on ? '■' : '□'} {label}</span>
  return (
    <label className="mr-3 inline-flex items-center gap-1 max-md:min-h-11">
      <input type="checkbox" className="w-4 h-4" checked={on} aria-label={label}
        onChange={(e) => (onToggle ? onToggle(e.target.checked) : f.set(e.target.checked))} />
      {label}
    </label>
  )
}

// 一格(含錨點與狀態章):錨點讓待補清單點一項就能捲到該格並對焦
export function PaperCellBox({ fieldKey, children, mark = null, className = '' }) {
  return (
    <span id={fieldKey ? fieldAnchorId(fieldKey) : undefined} className={`block ${className}`}>
      {children}
      {mark}
    </span>
  )
}

export function valueAt(content, key) {
  if (!content || !key) return null
  const item = /^items\.([^.]+)\.(qty_today|location|note)$/.exec(key)
  if (item) return content.items?.[item[1]]?.[item[2]] ?? null
  const ex = /^extras\.(.+)$/.exec(key)
  if (ex) return content.extras?.[ex[1]] ?? null
  const rn = /^results\.(.+)\.note$/.exec(key)
  if (rn) return content.results?.[rn[1]]?.note ?? null
  const r = /^results\.(.+)$/.exec(key)
  if (r) return content.results?.[r[1]]?.value ?? null
  return content[key] ?? null
}

// 確定性事實(工期、進度、累計):算得出來就印數字,算不出來印「待補」——不猜、不填 0,AI 不得產生
export function DerivedValue({ fact, suffix = '', pendingText = '待補' }) {
  if (!fact || fact.pending) return <span className="paper-warn">{pendingText}</span>
  return <span className="tabular-nums" title={fact.source || undefined}>{fact.value}{suffix}</span>
}
