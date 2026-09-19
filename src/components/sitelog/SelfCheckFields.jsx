// 自主檢查表文件的欄位(P3b):框架版面由伺服器範本 fn_field_document_template('self_check')(示範框架範本)的 sections 驅動,
// 檢查項目取自本案 checklist_templates 的範本(內容 template_id)。每欄=值＋來源／狀態章(FieldSourceChip);可編視角改值即
// confirmed/human、可「確認」系統帶入的值、可標「不適用」;唯讀視角(監造／機關)只有文字與章,不長出任何 input(唯讀 e2e 契約)。
// 檢查項目表(實測值只能人填、告示板讀數只提示、判定預覽)與監造查驗表單共用 ChecklistItemsTable;簽署時 DB 以 fn_checklist_judge
// 同一條規則重算為準。state={content, sources} 由 lib/fieldDocs 的純函式改。
import { Field, Input, Textarea, Empty, Select } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import { appPrompt, appConfirm } from '../confirm.jsx'
import {
  setFieldValue, confirmField, setFieldNa, setSelfCheckTemplate, selfCheckValues, templateFields, sourceLabel,
} from '../../lib/fieldDocs.js'
import FieldSourceChip from './FieldSourceChip.jsx'
import ChecklistItemsTable from './ChecklistItemsTable.jsx'
import { fieldAnchorId } from './DailyLogFields.jsx'

export default function SelfCheckFields({
  state, frame, checklistTemplates = [], checklistTemplate = null, labels = null, editable, leaves = [], byId = new Map(), onChange, issues = new Map(),
  isNew = false, date, onDateChange = null,
}) {
  const { content, sources } = state
  const set = (key, value) => onChange(setFieldValue(state, key, value))
  const confirm = (key) => onChange(confirmField(state, key))
  const na = async (key, title) => {
    const reason = await appPrompt({ title: `${title}：本次不適用`, label: '不適用的原因（必填，如 本次未量測、本項不在本次施作範圍）', required: true })
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
  const items = Array.isArray(checklistTemplate?.items) ? checklistTemplate.items : []
  const values = selfCheckValues(content)

  const changeTemplate = async (id) => {
    const t = checklistTemplates.find((x) => x.id === id)
    if (!t) return
    const filled = Object.values(content.results || {}).some((r) => r?.value != null && r.value !== '')
    if (filled && !(await appConfirm({ title: '換檢查表範本？', body: '換範本會清掉已填的檢查結果（項目不同，值不能沿用）。', danger: true, confirmLabel: '換範本' }))) return
    onChange(setSelfCheckTemplate(state, t))
  }

  const renderText = (key, { textarea = false, placeholder = '', optional = false, naTitle = null } = {}) => (
    <div id={fieldAnchorId(key)} className="w-full md:flex-1 md:min-w-[12rem]">
      <Field label={labels?.[key] || key}>
        {editable
          ? (textarea
            ? <Textarea value={content[key] || ''} onChange={(e) => set(key, e.target.value || null)} placeholder={placeholder} rows={3} />
            : <Input value={content[key] || ''} onChange={(e) => set(key, e.target.value || null)} placeholder={placeholder} />)
          : <div className="text-body py-2 whitespace-pre-wrap">{ro(content[key])}</div>}
      </Field>
      {(!optional || (content[key] != null && content[key] !== '')) && chip(key, naTitle ? { naLabel: '不適用', onNa: () => na(key, naTitle) } : {})}
    </div>
  )

  const renderTemplate = () => (
    <div id={fieldAnchorId('template_id')} className="w-full md:flex-1 md:min-w-[14rem]">
      <Field label={labels?.template_id || '檢查表範本'}>
        {editable ? (
          <Select value={content.template_id || ''} onChange={(e) => changeTemplate(e.target.value)} aria-label="檢查表範本">
            {!content.template_id && <option value="">請選擇本案檢查表範本…</option>}
            {checklistTemplates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
        ) : <div className="text-body py-2">{checklistTemplate?.title || content.template_title || ro(null)}</div>}
      </Field>
      {chip('template_id')}
      <p className="mt-1 text-caption text-[var(--text-3)]">{fieldsByKey.template_id?.note}{checklistTemplate?.source ? `　依據：${checklistTemplate.source}` : ''}</p>
    </div>
  )

  const renderWorkItem = () => {
    const wi = content.work_item_id ? byId.get(content.work_item_id) : null
    return (
      <div id={fieldAnchorId('work_item_id')} className="w-full md:flex-1 md:min-w-[14rem]">
        <Field label={labels?.work_item_id || '對應工項'}>
          {editable ? (
            <Select value={content.work_item_id || ''} onChange={(e) => set('work_item_id', e.target.value || null)} aria-label="對應工項">
              <option value="">（不指定工項）</option>
              {leaves.map((w) => <option key={w.id} value={w.id}>{w.item_no} {w.description}</option>)}
            </Select>
          ) : <div className="text-body py-2">{wi ? `${wi.item_no || ''} ${wi.description || ''}`.trim() : ro(null)}</div>}
        </Field>
        {sources?.work_item_id && chip('work_item_id')}
      </div>
    )
  }

  const renderItems = () => {
    if (!checklistTemplate) return <Empty>請先選擇檢查表範本，項目由範本帶出。</Empty>
    if (!items.length) return <Empty>範本「{checklistTemplate.title}」沒有任何檢查項目，無法簽署；請換一張範本。</Empty>
    return <ChecklistItemsTable template={checklistTemplate} values={values} sources={sources} editable={editable} onSet={set} onNa={na} chip={chip} note={fieldsByKey.results?.note} measurer="廠商" />
  }

  const renderField = (f) => {
    switch (f.key) {
      case 'check_date': return (
        <div key={f.key} id={fieldAnchorId('check_date')} className="max-md:w-full">
          <Field label={f.label}>
            {isNew && editable && onDateChange
              ? <Input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
              : <div className="text-body py-2 num">{date}</div>}
          </Field>
        </div>
      )
      case 'template_id': return <div key={f.key} className="w-full md:flex-1">{renderTemplate()}</div>
      case 'work_item_id': return <div key={f.key} className="w-full md:flex-1">{renderWorkItem()}</div>
      case 'location': return <div key={f.key} className="w-full md:flex-1">{renderText('location', { placeholder: '如 3F 版牆', naTitle: f.label })}</div>
      case 'results': return <div key={f.key}>{renderItems()}</div>
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
        <p className="text-caption text-[var(--red-text)]"><MSym name="info" size={12} className="inline -mt-0.5" /> 系統帶入的檢查結果請逐項核對後按「確認」，確認前不能簽署。</p>
      )}
      {!editable && sources && Object.values(sources).some((s) => s?.source && String(s.source).startsWith('ai:')) && (
        <p className="text-caption text-[var(--text-3)]">來源標「{sourceLabel('ai:photo')}」的欄位由系統依照片帶入；實測值一律由廠商親自量測填寫。</p>
      )}
    </div>
  )
}
