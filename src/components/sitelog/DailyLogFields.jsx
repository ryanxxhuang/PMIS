// 施工日誌文件的欄位(P2c):每欄=值＋來源／狀態章(FieldSourceChip)。可編視角改值即 confirmed/human、
// 可「確認」AI 帶入的值、可標「本日無」;唯讀視角(監造／機關)只有文字與章,不長出任何 input
// (唯讀 e2e 契約:頁上除日期外不得有 input)。state={content, sources} 由 lib/fieldDocs 的純函式改,
// 這裡只呼叫 onChange(next)。伺服器 recheck 的 issues(key→status)用來高亮真正被伺服器判為待補的欄。
import { useState } from 'react'
import { MSym } from '../icons.jsx'
import { Field, Input, Empty, IconButton, THEAD_CLS } from '../ui.jsx'
import { CHIP_BASE, CHIP_OFF } from '../PageTabs.jsx'
import { appPrompt } from '../confirm.jsx'
import { fmtAmount as fmt } from '../../lib/format.js'
import { addUniqueRow } from '../../lib/siteLogHelpers.js'
import { setFieldValue, confirmField, setFieldNa, addItemRow, removeItemRow, FIELD_LABEL } from '../../lib/fieldDocs.js'
import FieldSourceChip from './FieldSourceChip.jsx'

export const fieldAnchorId = (key) => `field-${String(key).replace(/[^a-zA-Z0-9_-]/g, '-')}`

const NA_PROMPT = { labor: '本日無出工的原因', equipment: '本日無機具的原因', materials: '本日無進料的原因' }

export default function DailyLogFields({ state, editable, leaves = [], byId = new Map(), onChange, issues = new Map(), freq = null, officialOpen: officialOpenProp, onOfficialOpen }) {
  const { content, sources } = state
  const [search, setSearch] = useState('')
  const [officialOpenLocal, setOfficialOpenLocal] = useState(false)
  const officialOpen = officialOpenProp ?? officialOpenLocal
  const setOfficialOpen = (v) => { setOfficialOpenLocal(v); onOfficialOpen?.(v) }
  const set = (key, value) => onChange(setFieldValue(state, key, value))
  const confirm = (key) => onChange(confirmField(state, key))
  const na = async (key) => {
    const reason = await appPrompt({ title: `${FIELD_LABEL[key] || key}：本日不適用`, label: `${NA_PROMPT[key] || '不適用的原因'}（必填）`, required: true })
    if (reason === null) return
    onChange(setFieldNa(state, key, reason))
  }
  const chip = (key, extra = {}) => (
    <FieldSourceChip source={sources?.[key]} editable={editable} onConfirm={() => confirm(key)} {...extra}
      className={issues.has(key) ? 'outline outline-2 outline-[var(--amber-text)] rounded-md' : ''} />
  )
  const q = search.trim()
  const results = q ? leaves.filter((it) => it.description.includes(q) || (it.item_no || '').includes(q)).slice(0, 20) : []
  const itemIds = Object.keys(content.items || {})
  const orderedIds = [...itemIds].sort((a, b) => (byId.get(a)?.sort_order ?? 0) - (byId.get(b)?.sort_order ?? 0))
  const setQty = (id, val) => {
    if (val === '') { set(`items.${id}.qty_today`, null); return }
    let n = parseFloat(val); if (isNaN(n)) n = 0
    const it = byId.get(id); const mq = it?.quantity || 0
    n = Math.max(0, mq > 0 ? Math.min(mq, n) : n)
    set(`items.${id}.qty_today`, n)
  }
  const ro = (v) => (v == null || v === '' ? <span className="text-[var(--text-3)]">（未填）</span> : String(v))

  return (
    <div className="space-y-4">
      {/* 天氣兩欄、摘要獨佔一列(規範 §9.8 第三條) */}
      <div className="flex items-start gap-3 flex-wrap">
        <div id={fieldAnchorId('weather_am')} className="max-md:w-[calc(50%-0.375rem)]">
          <Field label="天氣(上午)">
            {editable ? <Input value={content.weather_am || ''} onChange={(e) => set('weather_am', e.target.value || null)} className="md:!w-24" /> : <div className="text-body py-2">{ro(content.weather_am)}</div>}
          </Field>
          {chip('weather_am')}
        </div>
        <div id={fieldAnchorId('weather_pm')} className="max-md:w-[calc(50%-0.375rem)]">
          <Field label="天氣(下午)">
            {editable ? <Input value={content.weather_pm || ''} onChange={(e) => set('weather_pm', e.target.value || null)} placeholder="同上午" className="md:!w-24" /> : <div className="text-body py-2">{ro(content.weather_pm)}</div>}
          </Field>
          {chip('weather_pm')}
        </div>
        <div id={fieldAnchorId('work_summary')} className="w-full md:flex-1 md:min-w-[16rem]">
          <Field label="工作摘要">
            {editable ? <Input value={content.work_summary || ''} onChange={(e) => set('work_summary', e.target.value || null)} placeholder="今日施工概況" /> : <div className="text-body py-2 whitespace-pre-wrap">{ro(content.work_summary)}</div>}
          </Field>
          {chip('work_summary')}
        </div>
      </div>

      {/* 本日施作數量:照片能證明有施作,不能證明做了多少——數量只有人填(或告示板清楚寫出)才不是待補 */}
      <div>
        <h3 className="text-callout font-semibold text-[var(--text)] mb-2">本日施作數量</h3>
        {editable && (
          <div className="relative mb-3">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項加入今日回報…" aria-label="搜尋工項加入今日回報" />
            {results.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg [box-shadow:var(--shadow-overlay)] max-h-64 overflow-auto enter-menu">
                {results.map((it) => (
                  <button key={it.item_key} type="button" onClick={() => { onChange(addItemRow(state, it)); setSearch('') }}
                    className="w-full text-left px-3 py-1.5 max-md:min-h-11 text-sm hover:bg-[var(--surface-2)] flex items-center justify-between gap-2">
                    <span className="truncate"><span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}</span>
                    <span className="text-[var(--text-3)] text-xs shrink-0">{it.unit}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {orderedIds.length === 0 ? (
          <Empty>{editable ? '尚未加入工項。用上面搜尋把今天有施作的工項加進來，填當日數量；上傳照片辨識到的工項會自動列在這裡。' : '本日未列工項。'}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className={`${THEAD_CLS} border-b border-[var(--border)]`}>
                  <th className="text-left py-1.5">工項</th>
                  <th className="text-right px-2 whitespace-nowrap">單位</th>
                  <th className="text-right px-2 whitespace-nowrap">契約數量</th>
                  <th className="text-right px-2 whitespace-nowrap">當日完成數量</th>
                  <th className="text-left px-2">施作位置</th>
                  {editable && <th />}
                </tr>
              </thead>
              <tbody>
                {orderedIds.map((id) => {
                  const row = content.items[id] || {}
                  const it = byId.get(id) || {}
                  const qtyKey = `items.${id}.qty_today`
                  const locKey = `items.${id}.location`
                  return (
                    <tr key={id} id={fieldAnchorId(qtyKey)} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)] align-top">
                      <td className="py-1.5"><span className="text-[var(--text-3)] text-xs mr-2 num">{row.item_no || it.item_no}</span>{row.description || it.description || id}</td>
                      <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{row.unit || it.unit}</td>
                      <td className="text-right text-[var(--text-2)] px-2 num whitespace-nowrap">{it.quantity != null ? fmt(it.quantity) : '—'}</td>
                      <td className="text-right px-2">
                        {editable ? (
                          <input type="number" min="0" step="any" inputMode="decimal" value={row.qty_today ?? ''} onChange={(e) => setQty(id, e.target.value)}
                            aria-label={`${row.description || it.description || id} 當日完成數量`}
                            className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums max-md:py-2 focus:border-[var(--blue)] focus:outline-none" />
                        ) : <span className="num">{row.qty_today ?? <span className="text-[var(--text-3)]">待補</span>}</span>}
                        <div className="mt-1 flex justify-end">{chip(qtyKey)}</div>
                      </td>
                      <td className="px-2">
                        {editable ? (
                          <input type="text" value={row.location || ''} onChange={(e) => set(locKey, e.target.value || null)} placeholder="如 A區1F"
                            aria-label={`${row.description || it.description || id} 施作位置`}
                            className="w-28 border border-[var(--border)] rounded px-1.5 py-0.5 text-sm max-md:py-2 focus:border-[var(--blue)] focus:outline-none" />
                        ) : <span>{row.location || <span className="text-[var(--text-3)]">—</span>}</span>}
                        {sources?.[locKey] && <div className="mt-1">{chip(locKey)}</div>}
                      </td>
                      {editable && <td className="text-right pl-2"><IconButton name="close" label={`移除工項 ${row.description || it.description || id}`} onClick={() => onChange(removeItemRow(state, id))} className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" /></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 出工／機具／材料:必填;本日確無由人標「本日無」＋原因(不得留空,不得填「無」) */}
      <div className="space-y-4">
        <div id={fieldAnchorId('labor')}>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-medium text-[var(--text-2)]">出工人數（工別）</span>
            {chip('labor', { onNa: () => na('labor') })}
          </div>
          {editable && freq?.labor?.length > 0 && <FreqChips items={freq.labor} label={(r) => r.type} onAdd={(r) => set('labor', addUniqueRow(content.labor || [], r, (x) => x.type))} />}
          <RowsEditor rows={content.labor || []} onChange={(rows) => set('labor', rows)} disabled={!editable}
            fields={[{ key: 'type', ph: '工別（如 鋼筋工）', w: 'flex-1' }, { key: 'count', ph: '人數', w: '!w-20', num: true }]} naText={sources?.labor?.status === 'na' ? `本日無：${sources.labor.reason || ''}` : null} />
        </div>
        <div id={fieldAnchorId('equipment')}>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-medium text-[var(--text-2)]">機具使用</span>
            {chip('equipment', { onNa: () => na('equipment') })}
          </div>
          {editable && freq?.equipment?.length > 0 && <FreqChips items={freq.equipment} label={(r) => r.name} onAdd={(r) => set('equipment', addUniqueRow(content.equipment || [], r, (x) => x.name))} />}
          <RowsEditor rows={content.equipment || []} onChange={(rows) => set('equipment', rows)} disabled={!editable}
            fields={[{ key: 'name', ph: '機具名稱', w: 'flex-1' }, { key: 'count', ph: '數量', w: '!w-20', num: true }]} naText={sources?.equipment?.status === 'na' ? `本日無：${sources.equipment.reason || ''}` : null} />
        </div>
        <div id={fieldAnchorId('materials')}>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-medium text-[var(--text-2)]">材料使用</span>
            {chip('materials', { onNa: () => na('materials') })}
          </div>
          {editable && freq?.materials?.length > 0 && <FreqChips items={freq.materials} label={(r) => `${r.name}${r.unit ? `（${r.unit}）` : ''}`} onAdd={(r) => set('materials', addUniqueRow(content.materials || [], r, (x) => x.name))} />}
          <RowsEditor rows={content.materials || []} onChange={(rows) => set('materials', rows)} disabled={!editable}
            fields={[{ key: 'name', ph: '材料名稱', w: 'flex-1' }, { key: 'unit', ph: '單位', w: '!w-16' }, { key: 'qty', ph: '本日數量', w: '!w-24', num: true }]} naText={sources?.materials?.status === 'na' ? `本日無：${sources.materials.reason || ''}` : null} />
        </div>
      </div>

      {/* 公定格式其餘各節(四~八):預設收合;不是必填,但 AI 只帶當日既有紀錄填過的,其餘由人填 */}
      <div className="border border-[var(--border)] rounded-lg">
        <div className="flex items-center gap-1.5 px-3 py-1 flex-wrap">
          <button type="button" onClick={() => setOfficialOpen(!officialOpen)} aria-expanded={officialOpen}
            className="flex items-center gap-1.5 py-1 min-h-11 text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)] rounded-lg">
            <MSym name="chevron_right" size={15} className={`transition-transform duration-[var(--dur-fast)] ${officialOpen ? 'rotate-90' : ''}`} />
            公定格式其餘欄位（技術士・安衛・取樣・通知・重要事項）
          </button>
          <span className="ml-auto text-caption text-[var(--text-3)]">列印時輸出</span>
        </div>
        {officialOpen && (
          <div className="px-3 pb-3 grid sm:grid-cols-2 gap-3 text-sm">
            <ExtraText k="technicians" label="四、應置技術士（種類及人數，無則留空）" placeholder="如：混凝土工程技術士 2 名" content={content} editable={editable} set={set} chip={chip} />
            <div id={fieldAnchorId('extras.edu')}>
              <span className="block text-xs font-medium text-[var(--text-2)] mb-1">五、職業安全衛生</span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm py-1">
                {editable ? (<>
                  <label className="inline-flex items-center gap-1.5 max-md:min-h-11"><input type="checkbox" className="w-5 h-5" checked={!!content.extras?.edu} onChange={(e) => set('extras.edu', e.target.checked)} />勤前教育（含危害告知）</label>
                  <label className="inline-flex items-center gap-1.5 max-md:min-h-11"><input type="checkbox" className="w-5 h-5" checked={!!content.extras?.ppe} onChange={(e) => set('extras.ppe', e.target.checked)} />檢查個人防護具</label>
                  <label className="inline-flex items-center gap-1.5">新進勞工提報勞保
                    <select value={content.extras?.insured || '無新進勞工'} onChange={(e) => set('extras.insured', e.target.value)}
                      className="bg-transparent border border-[var(--border)] rounded-md px-1.5 py-0.5 text-body text-[var(--text)] max-md:min-h-11">
                      {['有', '無', '無新進勞工'].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                </>) : (
                  <span>{[content.extras?.edu && '勤前教育（含危害告知）', content.extras?.ppe && '檢查個人防護具', content.extras?.insured && `新進勞工提報勞保：${content.extras.insured}`].filter(Boolean).join('、') || '（未填）'}</span>
                )}
              </div>
            </div>
            <ExtraText k="sampling" label="六、施工取樣試驗紀錄" placeholder="如：混凝土圓柱試體 2 組、坍度 18±2.5cm" content={content} editable={editable} set={set} chip={chip} />
            <ExtraText k="notice" label="七、通知協力廠商辦理事項" content={content} editable={editable} set={set} chip={chip} />
            <div className="sm:col-span-2"><ExtraText k="important" label="八、重要事項紀錄" content={content} editable={editable} set={set} chip={chip} /></div>
          </div>
        )}
      </div>
    </div>
  )
}

function ExtraText({ k, label, placeholder, content, editable, set, chip }) {
  const key = `extras.${k}`
  return (
    <div id={fieldAnchorId(key)}>
      <Field label={label}>
        {editable ? <Input value={content.extras?.[k] || ''} onChange={(e) => set(key, e.target.value || null)} placeholder={placeholder} /> : <div className="text-body py-1">{content.extras?.[k] || <span className="text-[var(--text-3)]">（未填）</span>}</div>}
      </Field>
      {content.extras?.[k] != null && content.extras?.[k] !== '' && chip(key)}
    </div>
  )
}

// 常用項目一鍵帶入(從歷史自學):點 chip 加入一列,已有同項則略過
function FreqChips({ items, label, onAdd }) {
  if (!items?.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1 mb-1.5">
      <span className="text-caption text-[var(--text-3)]">常用</span>
      {items.map((r, i) => (
        <button key={i} type="button" onClick={() => onAdd(r)} className={`${CHIP_BASE} ${CHIP_OFF} gap-1`}>
          <MSym name="add" size={14} />{label(r)}
        </button>
      ))}
    </div>
  )
}

// 小型列編輯器(出工/機具/材料共用):fields=[{key, ph, w, num}];唯讀=純文字列
function RowsEditor({ rows, onChange, fields, disabled = false, naText = null }) {
  const set = (i, key, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)))
  const add = () => onChange([...rows, Object.fromEntries(fields.map((f) => [f.key, '']))])
  const del = (i) => onChange(rows.filter((_, j) => j !== i))
  if (disabled) {
    if (naText) return <p className="text-xs text-[var(--text-2)]">{naText}</p>
    if (!rows.length) return <p className="text-xs text-[var(--text-3)]">（未填）</p>
    return <ul className="text-sm space-y-0.5">{rows.map((r, i) => <li key={i}>{fields.map((f) => r[f.key]).filter((v) => v !== '' && v != null).join('・')}</li>)}</ul>
  }
  return (
    <div>
      {naText && <p className="text-xs text-[var(--text-2)] mb-1">{naText}</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          {fields.map((f) => (
            <Input key={f.key} value={r[f.key] ?? ''} placeholder={f.ph}
              type={f.num ? 'number' : 'text'} min={f.num ? 0 : undefined} step={f.num ? 'any' : undefined} inputMode={f.num ? 'decimal' : undefined}
              onChange={(e) => set(i, f.key, f.num ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
              className={`${f.w} ${f.num ? 'text-right num' : ''}`} />
          ))}
          <IconButton name="close" label="刪除此列" onClick={() => del(i)} className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
        </div>
      ))}
      <button type="button" onClick={add} className="inline-flex items-center gap-0.5 max-md:min-h-11 px-1 text-xs text-[var(--blue-text)] hover:underline"><MSym name="add" size={14} />加一列</button>
    </div>
  )
}
