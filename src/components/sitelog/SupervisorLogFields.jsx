// 監造日誌文件的欄位(P3a):版面由伺服器範本(fn_field_document_template('supervisor_log'),示範範本)的 sections
// 驅動,每欄=值＋來源／狀態章(FieldSourceChip);逐欄的渲染器依 key 決定。可編視角改值即 confirmed/human、
// 可「確認」AI 帶入的值、可標「本日無」;唯讀視角(廠商／機關)只有文字與章,不長出任何 input(唯讀 e2e 契約)。
// 到場人員(範本 human_only)是唯一例外:人填了只是「已填・待親自確認」,要明確按「確認到場人員」才 confirmed
// (鏡像 DB needs_confirmation;任何照片都不是到場證明)。引用資料(當日查驗、通知、追蹤、廠商施工情形、收件情形)
// 逐項標來源,來源缺漏留待補,不填「無」。state={content, sources} 由 lib/fieldDocs 的純函式改,這裡只呼叫 onChange(next)。
import { Field, Input, Textarea, Badge, Empty, IconButton, Button } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import { appPrompt } from '../confirm.jsx'
import {
  setFieldValue, confirmField, setFieldNa, fillHumanField, attendanceIssues, refTitle, sourceLabel, templateFields,
  NOTICE_TO_OPTIONS, FOLLOWUP_STATUS_OPTIONS, DOC_STATUS_LABEL, UNMET_STATUS_LABEL,
} from '../../lib/fieldDocs.js'
import { taipeiISODate } from '../../lib/dates.js'
import FieldSourceChip from './FieldSourceChip.jsx'
import RowsEditor from './RowsEditor.jsx'
import { fieldAnchorId } from '../../lib/fieldDocs.js'
import { taipeiDateTime as fmtTs } from '../../lib/dates.js'

const NA_PROMPT = {
  attendance: '本日未到場的原因', supervision_items: '本日無監造事項的原因', contractor_summary: '廠商本日未施工的原因',
  notices: '本日無通知事項的原因', followups: '本日無追蹤事項的原因',
}
const NA_LABEL = { attendance: '本日未到場', contractor_summary: '廠商未施工' }
const INPUT_CLS = 'border border-[var(--border)] rounded px-1.5 py-0.5 text-sm max-md:py-2 max-md:min-h-11 bg-[var(--surface)] text-[var(--text)] focus:border-[var(--blue)] focus:outline-none'

export default function SupervisorLogFields({
  state, template, labels = null, editable, leaves = [], byId = new Map(), onChange, issues = new Map(),
  lookups = {}, currentUser = null, members = [], contractorTools = null,
}) {
  const { content, sources } = state
  const set = (key, value) => onChange(setFieldValue(state, key, value))
  const confirm = (key) => onChange(confirmField(state, key))
  const na = async (key) => {
    const reason = await appPrompt({ title: `${labels?.[key] || key}：本日不適用`, label: `${NA_PROMPT[key] || '不適用的原因'}（必填）`, required: true })
    if (reason === null) return
    onChange(setFieldNa(state, key, reason))
  }
  const issueCls = (key) => (issues.has(key) ? `outline outline-2 rounded-md ${issues.get(key) === 'needs_confirmation' ? 'outline-[var(--red-text)]' : 'outline-[var(--amber-text)]'}` : '')
  const chip = (key, extra = {}) => (
    <FieldSourceChip source={sources?.[key]} editable={editable} onConfirm={() => confirm(key)} {...extra} className={issueCls(key)} />
  )
  const ro = (v) => (v == null || v === '' ? <span className="text-[var(--text-3)]">（未填）</span> : String(v))
  const date = content.log_date
  const sections = Array.isArray(template?.sections) ? template.sections : []
  const fieldsByKey = Object.fromEntries(templateFields(template).map((f) => [f.key, f]))

  // ── 逐欄渲染器 ─────────────────────────────────────────────────────────────
  // optional:非必填的自由文字(備註)有值才顯示來源章——空白時掛「待補」會誤導成必填(必填與否由範本 required 決定)
  const renderText = (key, { placeholder = '', textarea = false, chipExtra = {}, width = '', optional = false } = {}) => (
    <div id={fieldAnchorId(key)} className={width}>
      <Field label={labels?.[key] || key}>
        {editable
          ? (textarea
            ? <Textarea value={content[key] || ''} onChange={(e) => set(key, e.target.value || null)} placeholder={placeholder} rows={3} />
            : <Input value={content[key] || ''} onChange={(e) => set(key, e.target.value || null)} placeholder={placeholder} className={width ? 'md:!w-24' : ''} />)
          : <div className="text-body py-2 whitespace-pre-wrap">{ro(content[key])}</div>}
      </Field>
      {(!optional || (content[key] != null && content[key] !== '')) && chip(key, chipExtra)}
    </div>
  )

  const renderAttendance = () => {
    const rows = Array.isArray(content.attendance) ? content.attendance : []
    const src = sources?.attendance
    const problems = attendanceIssues(rows)
    const setRows = (next) => onChange(fillHumanField(state, 'attendance', next))
    const addSelf = () => {
      if (!currentUser?.user_id || rows.some((r) => r.user_id === currentUser.user_id)) return
      setRows([...rows, { user_id: currentUser.user_id, name: currentUser.name || '', from: null, to: null }])
    }
    const addMember = (userId) => {
      const m = members.find((x) => x.user_id === userId)
      if (!m || rows.some((r) => r.user_id === m.user_id)) return
      setRows([...rows, { user_id: m.user_id, name: m.full_name || '', from: null, to: null }])
    }
    return (
      <div id={fieldAnchorId('attendance')}>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs font-medium text-[var(--text-2)]">{labels?.attendance || '到場人員與時段'}</span>
          {chip('attendance', { humanOnly: true, confirmLabel: '確認到場人員', naLabel: NA_LABEL.attendance, onNa: () => na('attendance') })}
        </div>
        <p className="text-caption text-[var(--text-3)] mb-1.5">{fieldsByKey.attendance?.note || '只能由監造親自填寫並確認;系統不從任何照片推定到場。'}</p>
        {editable && src?.status !== 'na' && (
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {currentUser?.user_id && <Button variant="secondary" size="sm" onClick={addSelf} disabled={rows.some((r) => r.user_id === currentUser.user_id)}><MSym name="add" size={14} />帶入本人</Button>}
            {members.length > 0 && (
              <select aria-label="加入本案監造成員" value="" onChange={(e) => { addMember(e.target.value); e.target.value = '' }} className={`${INPUT_CLS} !py-1.5`}>
                <option value="">加入本案監造成員…</option>
                {members.filter((m) => !rows.some((r) => r.user_id === m.user_id)).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
              </select>
            )}
          </div>
        )}
        <RowsEditor rows={rows} onChange={setRows} disabled={!editable || src?.status === 'na'} addLabel="加一位到場人員" emptyText="（未填到場人員）"
          rowLabel={(i, r) => r.name || `第 ${i + 1} 位`}
          fields={[{ key: 'name', ph: '姓名', label: '姓名', w: 'flex-1 min-w-[8rem]' }, { key: 'from', ph: '到場', label: '到場時間', type: 'time', w: '!w-32' }, { key: 'to', ph: '離場', label: '離場時間', type: 'time', w: '!w-32' }]}
          naText={src?.status === 'na' ? `本日未到場：${src.reason || ''}` : null}
          extra={(i, r) => (r.user_id ? <Badge color="slate">本案成員</Badge> : null)} />
        {editable && problems.length > 0 && (
          <ul className="mt-1 text-caption text-[var(--red-text)]">{problems.map((p, i) => <li key={i}>第 {p.index + 1} 位：{p.reason}</li>)}</ul>
        )}
        {editable && src?.status === 'filled' && (
          <p className="mt-1 text-caption text-[var(--amber-text)]">到場人員已填但尚未由你親自確認；請核對後按「確認到場人員」，確認前不能簽署。</p>
        )}
      </div>
    )
  }

  const renderSupervisionItems = () => {
    const rows = Array.isArray(content.supervision_items) ? content.supervision_items : []
    const src = sources?.supervision_items
    const setRows = (next) => set('supervision_items', next)
    const patch = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
    const add = () => setRows([...rows, { time: null, item: '', location: null, work_item_id: null, note: null, source: 'human', photo_ids: [] }])
    const del = (i) => setRows(rows.filter((_, j) => j !== i))
    const wiLabel = (id) => { const w = byId.get(id); return w ? `${w.item_no || ''} ${w.description || ''}`.trim() : null }
    return (
      <div id={fieldAnchorId('supervision_items')}>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs font-medium text-[var(--text-2)]">{labels?.supervision_items || '監造事項'}</span>
          {chip('supervision_items', { onNa: () => na('supervision_items') })}
        </div>
        {src?.status === 'na' && <p className="text-xs text-[var(--text-2)] mb-1">本日無：{src.reason || ''}</p>}
        {rows.length === 0 && src?.status !== 'na' && <p className="text-xs text-[var(--text-3)]">{editable ? '尚無監造事項。上傳監造照片會由系統整理成監造事項（逐項標來源），也可直接新增。' : '（未填）'}</p>}
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="rounded-lg border border-[var(--border-2)] p-2 space-y-1.5">
              {editable && src?.status !== 'na' ? (
                <div className="flex items-start gap-2 flex-wrap">
                  <input type="time" value={r.time || ''} aria-label={`監造事項 ${i + 1} 時間`} onChange={(e) => patch(i, 'time', e.target.value || null)} className={`${INPUT_CLS} w-28`} />
                  <input type="text" value={r.item || ''} aria-label={`監造事項 ${i + 1} 內容`} placeholder="事項（如 抽查鋼筋綁紮）" onChange={(e) => patch(i, 'item', e.target.value)} className={`${INPUT_CLS} flex-1 min-w-[10rem]`} />
                  <input type="text" value={r.location || ''} aria-label={`監造事項 ${i + 1} 位置`} placeholder="位置" onChange={(e) => patch(i, 'location', e.target.value || null)} className={`${INPUT_CLS} w-28`} />
                  <select value={r.work_item_id || ''} aria-label={`監造事項 ${i + 1} 工項`} onChange={(e) => patch(i, 'work_item_id', e.target.value || null)} className={`${INPUT_CLS} max-w-full`}>
                    <option value="">（不指定工項）</option>
                    {leaves.map((w) => <option key={w.id} value={w.id}>{w.item_no} {w.description}</option>)}
                  </select>
                  <input type="text" value={r.note || ''} aria-label={`監造事項 ${i + 1} 說明`} placeholder="說明／結果" onChange={(e) => patch(i, 'note', e.target.value || null)} className={`${INPUT_CLS} w-full`} />
                  <IconButton name="close" label={`移除監造事項 ${i + 1}`} onClick={() => del(i)} className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)] ml-auto" />
                </div>
              ) : (
                <div className="text-sm">
                  <span className="num text-[var(--text-3)] mr-2">{r.time || '--:--'}</span>
                  <span className="text-[var(--text)]">{r.item || '（未填）'}</span>
                  {r.location && <span className="text-[var(--text-2)] ml-2"><MSym name="location_on" size={11} className="inline -mt-0.5" /> {r.location}</span>}
                  {r.note && <div className="text-footnote text-[var(--text-2)] whitespace-pre-wrap">{r.note}</div>}
                </div>
              )}
              <div className="flex items-center gap-1.5 flex-wrap text-caption text-[var(--text-3)]">
                <Badge color={String(r.source || '').startsWith('ai:') ? 'purple' : String(r.source || '').startsWith('inspection:') ? 'blue' : 'slate'}>來源：{sourceLabel(r.source) || '人工填寫'}</Badge>
                {r.work_item_id && wiLabel(r.work_item_id) && <span><MSym name="link" size={11} className="inline -mt-0.5" /> {wiLabel(r.work_item_id)}</span>}
                {Array.isArray(r.photo_ids) && r.photo_ids.length > 0 && <span className="num">照片 {r.photo_ids.length} 張（見下方附件）</span>}
              </div>
            </li>
          ))}
        </ul>
        {editable && src?.status !== 'na' && (
          <button type="button" onClick={add} className="mt-1.5 inline-flex items-center gap-0.5 max-md:min-h-11 px-1 text-xs text-[var(--blue-text)] hover:underline"><MSym name="add" size={14} />加一項監造事項</button>
        )}
      </div>
    )
  }

  const renderInspections = () => {
    const ids = Array.isArray(content.inspection_ids) ? content.inspection_ids : []
    const all = lookups.inspections || []
    const byIdI = new Map(all.map((i) => [i.id, i]))
    // 當日候選:當日申請或當日判定的查驗(與 Edge 起稿同一條規則)
    const candidates = all.filter((i) => (i.requested_date && String(i.requested_date).slice(0, 10) === date) || (i.inspected_at && taipeiISODate(i.inspected_at) === date))
    const listed = [...new Set([...ids, ...(editable ? candidates.map((i) => i.id) : [])])]
    const toggle = (id, on) => set('inspection_ids', on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id))
    return (
      <div id={fieldAnchorId('inspection_ids')}>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs font-medium text-[var(--text-2)]">{labels?.inspection_ids || '當日查驗'}</span>
          {chip('inspection_ids')}
        </div>
        {listed.length === 0 ? <p className="text-xs text-[var(--text-3)]">系統無當日查驗申請或判定紀錄。</p> : (
          <ul className="text-sm space-y-1">
            {listed.map((id) => {
              const i = byIdI.get(id)
              const on = ids.includes(id)
              const text = i ? `${i.title || id}${i.status ? `（${i.status}）` : ''}${i.location ? ` ${i.location}` : ''}${i.result_note ? `：${i.result_note}` : ''}` : `查驗 ${String(id).slice(0, 8)}（不在目前清單）`
              return (
                <li key={id} className="flex items-start gap-2">
                  {editable ? <label className="inline-flex items-center gap-1.5 max-md:min-h-11"><input type="checkbox" className="w-5 h-5" checked={on} onChange={(e) => toggle(id, e.target.checked)} />{text}</label> : <span>{text}</span>}
                  {i?.status && i.status !== '待查驗' && <Badge color={i.status === '合格' ? 'green' : 'red'}>{i.status}</Badge>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  const renderReceipt = () => {
    const r = content.daily_log_receipt
    const has = r && typeof r === 'object' && r.status && r.status !== 'none'
    return (
      <div id={fieldAnchorId('daily_log_receipt')}>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs font-medium text-[var(--text-2)]">{labels?.daily_log_receipt || '施工日誌收件情形'}</span>
          {chip('daily_log_receipt')}
        </div>
        {!has ? (
          <p className="text-xs text-[var(--text-3)]">{r?.status === 'none' ? '當日無廠商施工日誌文件。' : '（未帶入；系統起稿或按「引用同日施工日誌」時帶入）'}</p>
        ) : (
          <div className="text-sm text-[var(--text)] flex items-center gap-2 flex-wrap">
            <Badge color={['signed', 'submitted', 'received'].includes(r.status) ? 'green' : r.status === 'returned' ? 'red' : 'amber'}>{DOC_STATUS_LABEL[r.status] || r.status}</Badge>
            <span className="num">版本 {r.version_no ?? '—'}</span>
            <span className="text-footnote text-[var(--text-2)] num">簽署 {fmtTs(r.signed_at)}・提送 {fmtTs(r.submitted_at)}・收件 {fmtTs(r.received_at)}{r.returned_at ? `・退回 ${fmtTs(r.returned_at)}` : ''}</span>
          </div>
        )}
        {contractorTools}
      </div>
    )
  }

  const renderRows = (key, fields, addLabel) => {
    const rows = Array.isArray(content[key]) ? content[key] : []
    const src = sources?.[key]
    return (
      <div id={fieldAnchorId(key)}>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs font-medium text-[var(--text-2)]">{labels?.[key] || key}</span>
          {chip(key, { onNa: () => na(key) })}
        </div>
        <RowsEditor rows={rows} onChange={(next) => set(key, next)} disabled={!editable || src?.status === 'na'} fields={fields} addLabel={addLabel}
          naText={src?.status === 'na' ? `本日無：${src.reason || ''}` : null}
          rowLabel={(i) => `${labels?.[key] || key} ${i + 1}`}
          extra={(i, r) => { const t = refTitle(r, lookups); return t ? <Badge color="slate">{t}</Badge> : null }} />
      </div>
    )
  }

  const renderField = (f) => {
    switch (f.key) {
      case 'log_date': return <div key={f.key} id={fieldAnchorId('log_date')} className="max-md:w-full"><Field label={f.label}><div className="text-body py-2 num">{date}</div></Field></div>
      case 'weather_am': return <div key={f.key} className="max-md:w-[calc(50%-0.375rem)]">{renderText('weather_am', { width: 'md:w-28' })}</div>
      case 'weather_pm': return <div key={f.key} className="max-md:w-[calc(50%-0.375rem)]">{renderText('weather_pm', { placeholder: '同上午', width: 'md:w-28' })}</div>
      case 'attendance': return <div key={f.key}>{renderAttendance()}</div>
      case 'supervision_items': return <div key={f.key}>{renderSupervisionItems()}</div>
      case 'inspection_ids': return <div key={f.key}>{renderInspections()}</div>
      case 'contractor_summary': return <div key={f.key}>{renderText('contractor_summary', { textarea: true, placeholder: '廠商施工情形（引用同日已簽署施工日誌會自動標來源）', chipExtra: { naLabel: NA_LABEL.contractor_summary, onNa: () => na('contractor_summary') } })}</div>
      case 'daily_log_receipt': return <div key={f.key}>{renderReceipt()}</div>
      case 'notices': return <div key={f.key}>{renderRows('notices', [{ key: 'to', label: '通知對象', options: NOTICE_TO_OPTIONS, w: '!w-28' }, { key: 'content', ph: '通知內容', label: '內容', w: 'flex-1 min-w-[10rem]' }], '加一則通知')}</div>
      case 'followups': return <div key={f.key}>{renderRows('followups', [{ key: 'content', ph: '追蹤事項', label: '內容', w: 'flex-1 min-w-[10rem]' }, { key: 'status', label: '狀態', options: FOLLOWUP_STATUS_OPTIONS, w: '!w-28' }], '加一項追蹤')}</div>
      case 'note': return <div key={f.key}>{renderText('note', { textarea: true, optional: f.required !== true })}</div>
      default: return <div key={f.key}>{renderText(f.key, { optional: f.required !== true })}</div>
    }
  }

  if (!sections.length) return <Empty>範本尚未載入，無法顯示欄位。</Empty>
  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <section key={s.key} aria-label={s.title} className="space-y-3">
          <h3 className="text-callout font-semibold text-[var(--text)]">{s.title}</h3>
          <div className={s.key === 'basic' ? 'flex items-start gap-3 flex-wrap' : 'space-y-3'}>
            {(s.fields || []).map(renderField)}
          </div>
        </section>
      ))}
      {issues.size > 0 && [...issues.values()].includes('needs_confirmation') && (
        <p className="text-caption text-[var(--red-text)]">{UNMET_STATUS_LABEL.needs_confirmation}：到場人員請親自核對後按「確認到場人員」。</p>
      )}
    </div>
  )
}
