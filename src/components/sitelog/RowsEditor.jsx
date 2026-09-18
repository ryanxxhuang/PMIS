// 小型列編輯器(P2c 施工日誌的出工／機具／材料、P3a 監造日誌的到場／通知／追蹤共用):
// fields=[{key, ph, w, num, type, options, label}];唯讀=純文字列(唯讀 e2e 契約:不長出任何 input)。
// P3a 從 DailyLogFields 抽出來共用並加 type(time 等原生 input 型別)與 options(<select>),
// 施工日誌的三個列編輯器行為不變(fields 沒給 type／options 時與原本一模一樣)。
// 每列可帶 extra(rowIndex, row)→ 顯示在該列尾端的節點(例如引用單據名稱、來源章),唯讀時也顯示。
import { Input, IconButton } from '../ui.jsx'
import { MSym } from '../icons.jsx'

const SELECT_CLS = 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-lg px-2 py-2 text-body max-md:min-h-11 focus:outline-[3px] focus:outline-offset-0 focus:outline-[var(--focus-glow)] focus:border-[var(--focus)]'

export default function RowsEditor({ rows, onChange, fields, disabled = false, naText = null, addLabel = '加一列', emptyText = '（未填）', extra = null, rowLabel = null }) {
  const set = (i, key, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const add = () => onChange([...rows, Object.fromEntries(fields.map((f) => [f.key, f.options ? (f.options[0]?.value ?? '') : '']))])
  const del = (i) => onChange(rows.filter((_, j) => j !== i))
  const optionLabel = (f, v) => f.options?.find((o) => o.value === v)?.label ?? v
  if (disabled) {
    if (naText) return <p className="text-xs text-[var(--text-2)]">{naText}</p>
    if (!rows.length) return <p className="text-xs text-[var(--text-3)]">{emptyText}</p>
    return (
      <ul className="text-sm space-y-0.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-2 flex-wrap">
            <span>{fields.map((f) => (f.options ? optionLabel(f, r[f.key]) : r[f.key])).filter((v) => v !== '' && v != null).join('・')}</span>
            {extra?.(i, r)}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div>
      {naText && <p className="text-xs text-[var(--text-2)] mb-1">{naText}</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5 flex-wrap">
          {fields.map((f) => f.options ? (
            <select key={f.key} value={r[f.key] ?? ''} aria-label={f.label || f.ph} onChange={(e) => set(i, f.key, e.target.value)} className={`${SELECT_CLS} ${f.w || ''}`}>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <Input key={f.key} value={r[f.key] ?? ''} placeholder={f.ph} aria-label={rowLabel ? `${rowLabel(i, r)} ${f.label || f.ph}` : (f.label || f.ph)}
              type={f.num ? 'number' : (f.type || 'text')} min={f.num ? 0 : undefined} step={f.num ? 'any' : undefined} inputMode={f.num ? 'decimal' : undefined}
              onChange={(e) => set(i, f.key, f.num ? (e.target.value === '' ? '' : Number(e.target.value)) : (e.target.value === '' && f.type ? null : e.target.value))}
              className={`${f.w} ${f.num ? 'text-right num' : ''}`} />
          ))}
          {extra?.(i, r)}
          <IconButton name="close" label={`刪除此列${rowLabel ? `：${rowLabel(i, r)}` : ''}`} onClick={() => del(i)} className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
        </div>
      ))}
      <button type="button" onClick={add} className="inline-flex items-center gap-0.5 max-md:min-h-11 px-1 text-xs text-[var(--blue-text)] hover:underline"><MSym name="add" size={14} />{addLabel}</button>
    </div>
  )
}
