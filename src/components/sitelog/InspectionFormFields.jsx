// 監造查驗表單文件的欄位(P3c):版面由伺服器範本 fn_field_document_template('inspection_form')(示範範本)的 sections 驅動。
// 查驗申請資料(查驗、工項、位置、階段、申報數量、檢附自檢)由系統帶入並標來源,監造核對後按「確認」;單位取自標單工項(唯讀,
// 簽署時 DB 驗一致);查驗項目取本案 kind=inspection_form 的範本(ChecklistItemsTable 與自檢表共用)。
// 判定與本次確認數量只能由監造親自填(改值即 confirmed/human;AI 草稿永遠留空);確認數量區清楚並列申報數量、單位、
// 此批次已確認累計、本次確認、簽署後累計,並即時列出與 DB 簽署規則相同的一致性問題(lib/fieldDocs.inspectionFormIssues)。
// 唯讀視角(廠商／機關)只有文字與章,不長出任何 input。state={content, sources} 由 lib/fieldDocs 的純函式改。
import { Link } from 'react-router-dom'
import { Field, Input, Textarea, Empty, Select, Badge } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import { appPrompt, appConfirm } from '../confirm.jsx'
import {
  setFieldValue, confirmField, setFieldNa, setInspectionFormTemplate, selfCheckValues, templateFields, sourceLabel,
  INSPECTION_VERDICTS, INSPECTION_VERDICT_TONE, inspectionFormIssues,
} from '../../lib/fieldDocs.js'
import { judgeChecklist } from '../../lib/qc.js'
import FieldSourceChip from './FieldSourceChip.jsx'
import ChecklistItemsTable from './ChecklistItemsTable.jsx'
import { fieldAnchorId } from '../../lib/fieldDocs.js'

const fmtQty = (v, unit) => (v == null || v === '' || Number.isNaN(Number(v)) ? '—' : `${Number(v)} ${unit || ''}`.trim())

export default function InspectionFormFields({
  state, frame, inspection = null, workItem = null, requiredStages = [], checklistTemplates = [], checklistTemplate = null,
  labels = null, editable, onChange, issues = new Map(), batchCum = null, selfCheckDoc = null,
}) {
  const { content, sources } = state
  const set = (key, value) => onChange(setFieldValue(state, key, value))
  const confirm = (key) => onChange(confirmField(state, key))
  const na = async (key, title) => {
    const reason = await appPrompt({ title: `${title}：本次不適用`, label: '不適用的原因（必填）', required: true })
    if (reason === null) return
    onChange(setFieldNa(state, key, reason))
  }
  const issueCls = (key) => (issues.has(key) ? `outline outline-2 rounded-md ${issues.get(key) === 'needs_confirmation' ? 'outline-[var(--red-text)]' : 'outline-[var(--amber-text)]'}` : '')
  const chip = (key, extra = {}) => (
    <FieldSourceChip source={sources?.[key]} editable={editable} onConfirm={() => confirm(key)} {...extra} className={issueCls(key)} />
  )
  const ro = (v) => (v == null || v === '' ? <span className="text-[var(--text-3)]">（未填）</span> : String(v))
  const sections = Array.isArray(frame?.sections) ? frame.sections : []
  const fieldsByKey = Object.fromEntries(templateFields(frame).map((f) => [f.key, f]))
  const values = selfCheckValues(content)
  const judged = checklistTemplate ? judgeChecklist(checklistTemplate, values) : null
  const consistency = inspectionFormIssues(content, { workItem, requiredStages, judged })
  const unit = content.unit || workItem?.unit || ''
  const declared = content.declared_qty == null ? null : Number(content.declared_qty)
  const confirmed = content.confirmed_qty == null ? null : Number(content.confirmed_qty)
  const afterCum = batchCum != null && confirmed != null && Number.isFinite(confirmed) ? batchCum + confirmed : null

  const changeTemplate = async (id) => {
    const t = id ? checklistTemplates.find((x) => x.id === id) || null : null
    const filled = Object.values(content.results || {}).some((r) => r?.value != null && r.value !== '')
    if (filled && !(await appConfirm({ title: '換查驗表範本？', body: '換範本會清掉已填的查驗結果（項目不同，值不能沿用）。', danger: true, confirmLabel: '換範本' }))) return
    onChange(setInspectionFormTemplate(state, t))
  }

  const renderText = (key, { textarea = false, placeholder = '', optional = false } = {}) => (
    <div id={fieldAnchorId(key)} className="w-full">
      <Field label={labels?.[key] || key}>
        {editable
          ? (textarea
            ? <Textarea value={content[key] || ''} onChange={(e) => set(key, e.target.value || null)} placeholder={placeholder} rows={3} />
            : <Input value={content[key] || ''} onChange={(e) => set(key, e.target.value || null)} placeholder={placeholder} />)
          : <div className="text-body py-2 whitespace-pre-wrap">{ro(content[key])}</div>}
      </Field>
      {(!optional || (content[key] != null && content[key] !== '')) && sources?.[key] && chip(key)}
    </div>
  )

  const renderField = (f) => {
    switch (f.key) {
      case 'inspection_date': return (
        <div key={f.key} id={fieldAnchorId('inspection_date')} className="max-md:w-full">
          <Field label={f.label}><div className="text-body py-2 num">{content.inspection_date || '—'}</div></Field>
        </div>
      )
      case 'inspection_id': return (
        <div key={f.key} id={fieldAnchorId('inspection_id')} className="w-full md:flex-1 md:min-w-[14rem]">
          <Field label={f.label}>
            <div className="text-body py-2">
              {inspection ? <Link to={`/quality?seg=inspections&inspection=${encodeURIComponent(inspection.id)}`} className="text-[var(--blue-text)] hover:underline">{inspection.title}</Link> : ro(content.inspection_title || content.inspection_id)}
              {inspection?.requested_date ? <span className="text-caption text-[var(--text-3)] ml-2">申請 {inspection.requested_date}</span> : null}
            </div>
          </Field>
          {sources?.inspection_id && chip('inspection_id')}
          <p className="mt-1 text-caption text-[var(--text-3)]">{f.note}</p>
        </div>
      )
      case 'work_item_id': return (
        <div key={f.key} id={fieldAnchorId('work_item_id')} className="w-full md:flex-1 md:min-w-[14rem]">
          <Field label={f.label}><div className="text-body py-2">{workItem ? `${workItem.item_no || ''} ${workItem.description || ''}`.trim() : ro(content.work_item_id)}</div></Field>
          {sources?.work_item_id && chip('work_item_id')}
          {!workItem && content.work_item_id && <p className="text-caption text-[var(--red-text)]">找不到此工項（可能不在標單末端可計價工項內），無法簽確認數量。</p>}
        </div>
      )
      case 'location': return (
        <div key={f.key} id={fieldAnchorId('location')} className="w-full md:flex-1 md:min-w-[12rem]">
          <Field label={f.label}>
            {editable ? <Input value={content.location || ''} onChange={(e) => set('location', e.target.value || null)} placeholder="如 3F 版牆" aria-label={f.label} /> : <div className="text-body py-2">{ro(content.location)}</div>}
          </Field>
          {chip('location')}
          <p className="mt-1 text-caption text-[var(--text-3)]">{f.note}</p>
        </div>
      )
      case 'stage_key': {
        if (!requiredStages.length) {
          return (
            <div key={f.key} id={fieldAnchorId('stage_key')} className="w-full md:flex-1 md:min-w-[10rem]">
              <Field label={f.label}><div className="text-body py-2 text-[var(--text-3)]">單階段（此工項的檢驗停留點沒有 H 點）</div></Field>
              {content.stage_key && <p className="text-caption text-[var(--red-text)]">內容帶了階段「{content.stage_key}」，但此工項沒有必要階段；簽署會被拒絕，請清除。{editable && <button type="button" className="ml-1 underline" onClick={() => set('stage_key', null)}>清除</button>}</p>}
            </div>
          )
        }
        return (
          <div key={f.key} id={fieldAnchorId('stage_key')} className="w-full md:flex-1 md:min-w-[10rem]">
            <Field label={f.label}>
              {editable ? (
                <Select value={content.stage_key || ''} onChange={(e) => set('stage_key', e.target.value || null)} aria-label={f.label}>
                  <option value="">請選擇本次查驗的階段…</option>
                  {requiredStages.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              ) : <div className="text-body py-2">{ro(content.stage_key)}</div>}
            </Field>
            {chip('stage_key')}
            <p className="mt-1 text-caption text-[var(--text-3)]">必要階段：{requiredStages.join('、')}。{f.note}</p>
          </div>
        )
      }
      case 'unit': return (
        <div key={f.key} id={fieldAnchorId('unit')} className="max-md:w-full">
          <Field label={f.label}><div className="text-body py-2">{ro(unit)}</div></Field>
          {sources?.unit && chip('unit')}
          {workItem?.unit && content.unit && content.unit !== workItem.unit && <p className="text-caption text-[var(--red-text)]">表單單位「{content.unit}」≠ 工項單位「{workItem.unit}」，簽署會被拒絕。{editable && <button type="button" className="ml-1 underline" onClick={() => set('unit', workItem.unit)}>改用工項單位</button>}</p>}
        </div>
      )
      case 'declared_qty': return (
        <div key={f.key} id={fieldAnchorId('declared_qty')} className="w-full md:flex-1 md:min-w-[12rem]">
          <Field label={`${f.label}${unit ? `（${unit}）` : ''}`}>
            {editable
              ? <Input type="number" step="any" inputMode="decimal" min="0" value={content.declared_qty ?? ''} onChange={(e) => set('declared_qty', e.target.value === '' ? null : Number(e.target.value))} aria-label={f.label} />
              : <div className="text-body py-2 num">{fmtQty(content.declared_qty, unit)}</div>}
          </Field>
          {chip('declared_qty')}
          {inspection?.declared_qty != null && declared != null && Number(inspection.declared_qty) !== declared && <p className="text-caption text-[var(--red-text)]">查驗申請載明 {fmtQty(inspection.declared_qty, unit)}；申報量以查驗申請為準，不一致會被拒簽。</p>}
          <p className="mt-1 text-caption text-[var(--text-3)]">{f.note}</p>
        </div>
      )
      case 'self_check_record_id': return (
        <div key={f.key} id={fieldAnchorId('self_check_record_id')} className="w-full md:flex-1 md:min-w-[12rem]">
          <Field label={f.label}>
            <div className="text-body py-2">
              {content.self_check_record_id
                ? <Link to={selfCheckDoc ? `/self-check/print?doc=${encodeURIComponent(selfCheckDoc.id)}` : `/quality/checklist-print?id=${encodeURIComponent(content.self_check_record_id)}`} className="text-[var(--blue-text)] hover:underline">檢視自主檢查{selfCheckDoc ? `（已簽署文件 v${selfCheckDoc.current_version_no}）` : ''}</Link>
                : <span className="text-[var(--text-3)]">未檢附</span>}
            </div>
          </Field>
          {sources?.self_check_record_id && chip('self_check_record_id')}
        </div>
      )
      case 'template_id': return (
        <div key={f.key} id={fieldAnchorId('template_id')} className="w-full md:flex-1 md:min-w-[14rem]">
          <Field label={f.label}>
            {editable ? (
              <Select value={content.template_id || ''} onChange={(e) => changeTemplate(e.target.value)} aria-label={f.label}>
                <option value="">不使用查驗表範本（依判定欄簽署）</option>
                {checklistTemplates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select>
            ) : <div className="text-body py-2">{checklistTemplate?.title || content.template_title || <span className="text-[var(--text-3)]">未使用範本</span>}</div>}
          </Field>
          {sources?.template_id && chip('template_id')}
          <p className="mt-1 text-caption text-[var(--text-3)]">{f.note}{editable && checklistTemplates.length === 0 ? '　本案尚無監造查驗用途的範本（品質查驗建立範本時可指定用途）。' : ''}</p>
        </div>
      )
      case 'results': return (
        <div key={f.key}>
          {!checklistTemplate ? <Empty>未使用查驗表範本；判定依下方判定欄簽署。</Empty>
            : !(checklistTemplate.items || []).length ? <Empty>範本「{checklistTemplate.title}」沒有任何查驗項目；請換一張範本或不使用範本。</Empty>
              : <ChecklistItemsTable template={checklistTemplate} values={values} sources={sources} editable={editable} onSet={set} onNa={na} chip={chip} note={fieldsByKey.results?.note} measurer="監造" label="項目判定預覽" />}
        </div>
      )
      case 'verdict': return (
        <div key={f.key} id={fieldAnchorId('verdict')} className={`w-full ${issueCls('verdict')}`}>
          <Field label={f.label}>
            {editable ? (
              <div role="radiogroup" aria-label={f.label} className="flex items-center gap-2 flex-wrap py-1">
                {INSPECTION_VERDICTS.map((v) => (
                  <label key={v} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 max-md:min-h-11 cursor-pointer ${content.verdict === v ? 'border-[var(--blue)] bg-[var(--blue-tint)]' : 'border-[var(--border)]'}`}>
                    <input type="radio" name="verdict" value={v} checked={content.verdict === v} onChange={() => set('verdict', v)} />
                    <span className="text-body">{v}</span>
                  </label>
                ))}
              </div>
            ) : <div className="py-2">{content.verdict ? <Badge color={INSPECTION_VERDICT_TONE[content.verdict] || 'slate'}>{content.verdict}</Badge> : ro(null)}</div>}
          </Field>
          {chip('verdict')}
          <p className="mt-1 text-caption text-[var(--text-3)]">{f.note}</p>
        </div>
      )
      case 'confirmed_qty': return (
        <div key={f.key} id={fieldAnchorId('confirmed_qty')} className="w-full">
          <div role="group" aria-label="確認數量" className={`rounded-lg border border-[var(--border)] p-3 ${issueCls('confirmed_qty')}`}>
            <dl className="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-1 text-footnote">
              <div><dt className="text-[var(--text-3)]">申報數量</dt><dd className="num text-body">{fmtQty(declared, unit)}</dd></div>
              <div><dt className="text-[var(--text-3)]">單位</dt><dd className="text-body">{unit || '—'}</dd></div>
              <div><dt className="text-[var(--text-3)]">此批次已確認累計</dt><dd className="num text-body">{batchCum == null ? <span className="text-[var(--text-3)]">—</span> : fmtQty(batchCum, unit)}</dd></div>
              <div>
                <dt className="text-[var(--text-3)]">本次確認</dt>
                <dd>
                  {editable
                    ? <Input type="number" step="any" inputMode="decimal" min="0" max={declared ?? undefined} value={content.confirmed_qty ?? ''} onChange={(e) => set('confirmed_qty', e.target.value === '' ? null : Number(e.target.value))} aria-label={f.label} className="w-32" />
                    : <span className="num text-body">{fmtQty(confirmed, unit)}</span>}
                </dd>
              </div>
              <div><dt className="text-[var(--text-3)]">簽署後累計</dt><dd className="num text-body">{afterCum == null ? <span className="text-[var(--text-3)]">—</span> : fmtQty(afterCum, unit)}</dd></div>
            </dl>
            <div className="mt-2">{chip('confirmed_qty')}</div>
            {editable && <p className="mt-1 text-caption text-[var(--amber-text)]"><MSym name="info" size={12} className="inline -mt-0.5" /> 簽署後本次確認數量會寫入監造確認紀錄，成為廠商可估驗的依據（不得超過申報數量；不合格填 0）。</p>}
            <p className="mt-1 text-caption text-[var(--text-3)]">{f.note}</p>
          </div>
        </div>
      )
      case 'result_note': return <div key={f.key}>{renderText('result_note', { textarea: true, optional: true, placeholder: '不合格／部分合格必填：不合格原因與待改善事項（作為缺失說明）' })}<p className="mt-1 text-caption text-[var(--text-3)]">{f.note}</p></div>
      case 'note': return <div key={f.key}>{renderText('note', { textarea: true, optional: true })}</div>
      default: return <div key={f.key}>{renderText(f.key, { optional: f.required !== true })}</div>
    }
  }

  if (!sections.length) return <Empty>範本尚未載入，無法顯示欄位。</Empty>
  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <section key={s.key} aria-label={s.title} className="space-y-3">
          <h3 className="text-callout font-semibold text-[var(--text)]">{s.title}</h3>
          <div className={['basic', 'request'].includes(s.key) ? 'flex items-start gap-3 flex-wrap' : 'space-y-3'}>
            {(s.fields || []).map(renderField)}
          </div>
        </section>
      ))}
      {consistency.length > 0 && (
        <ul role="alert" aria-label="判定與確認數量檢查" className="rounded-lg bg-[var(--red-tint)] p-3 text-footnote text-[var(--red-text)] space-y-0.5">
          {consistency.map((i) => <li key={`${i.key}-${i.message}`}>{i.message}</li>)}
        </ul>
      )}
      {issues.size > 0 && [...issues.values()].includes('needs_confirmation') && (
        <p className="text-caption text-[var(--red-text)]"><MSym name="info" size={12} className="inline -mt-0.5" /> 由查驗申請帶入的資料請逐項核對後按「確認」，確認前不能簽署。</p>
      )}
      {!editable && sources && Object.values(sources).some((s) => s?.source && String(s.source).startsWith('inspection:')) && (
        <p className="text-caption text-[var(--text-3)]">來源標「{sourceLabel('inspection:x')}」的欄位由系統自查驗申請帶入；判定與確認數量一律由監造親自填寫。</p>
      )}
    </div>
  )
}
