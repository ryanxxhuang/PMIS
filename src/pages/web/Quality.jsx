import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Printer, Zap } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, BallChip, Empty, PageHeader } from '../../components/ui.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { judgeChecklist, judgeItem } from '../../lib/qc.js'
import { defectBall, inspectionBall, observationBall } from '../../lib/ballInCourt.js'
import MarkupEditor, { MarkupThumb } from '../../components/MarkupEditor.jsx'

const inspColor = { 待查驗: 'amber', 合格: 'green', 不合格: 'red' }
const defColor = { 開立: 'red', 改善中: 'amber', 待複查: 'blue', 已結案: 'green' }
const input = 'w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:border-[var(--blue)] focus:outline-none'

// 小工項挑選器（搜尋 → 選一個）
function WorkItemPicker({ leaves, value, label, onPick }) {
  const [q, setQ] = useState('')
  const results = q.trim() ? leaves.filter((it) => it.description.includes(q.trim()) || (it.item_no || '').includes(q.trim())).slice(0, 12) : []
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface-2)]">
        <span className="truncate flex-1">{label}</span>
        <button onClick={() => onPick(null, '')} className="text-[var(--text-3)] hover:text-rose-500 text-xs">✕</button>
      </div>
    )
  }
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋並選擇工項（可不填）…" className={input} />
      {results.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-56 overflow-auto">
          {results.map((it) => (
            <button key={it.item_key} onClick={() => { onPick(it.item_key, `${it.item_no} ${it.description}`); setQ('') }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] truncate">
              <span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Quality() {
  const { project, workItems, inspections, defects, createInspection, recordInspectionResult,
    createDefect, updateDefectStatus, deleteInspection, deleteDefect, describeDefect,
    checklistTemplates, checklistRecords, createChecklistRecord, deleteChecklistRecord,
    testSamples, createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
    observations, createObservation, updateObservation, escalateObservation, deleteObservation,
    isSupabaseConfigured, currentProject, workItemsSource, can, resolveMarkup } = useStore()
  const [markupOpen, setMarkupOpen] = useState(false)
  const [inspForm, setInspForm] = useState(null) // null=收起；物件=展開
  const [defForm, setDefForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState('')

  // 拍缺失照片 → AI 描述 → 填表單
  const onDefectPhoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setAiBusy(true); setAiMsg('AI 辨識中…')
    const { error, result } = await describeDefect(file)
    setAiBusy(false)
    if (error) { setAiMsg(`辨識失敗:${error.message || ''}`); return }
    setDefForm((f) => ({
      ...f,
      title: result.title || f.title,
      description: [result.description, result.suggestion && `建議:${result.suggestion}`].filter(Boolean).join(' '),
      severity: result.severity || f.severity,
      location: f.location || result.location || '',
    }))
    setAiMsg(result.title ? 'AI 已填入，請確認後開立。' : 'AI 未辨識出明顯缺失，請人工填寫。')
  }

  const leaves = useMemo(() => {
    if (!workItems) return []
    const childMap = new Map()
    for (const it of workItems.items) { const k = it.parent_key || '__root__'; if (!childMap.has(k)) childMap.set(k, []); childMap.get(k).push(it) }
    return workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
  }, [workItems])

  if (!workItems) return <Empty>載入中…</Empty>
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return <Card title="品質查驗"><Empty>此專案的標單尚未匯入資料庫。請先到「標單工項」匯入標單。</Empty></Card>
  }

  const submitInsp = async () => {
    setBusy(true); await createInspection(inspForm); setBusy(false); setInspForm(null)
  }
  const submitDef = async () => {
    setBusy(true); await createDefect(defForm); setBusy(false); setDefForm(null)
  }
  const onResult = async (insp, pass) => {
    const note = pass ? '' : (window.prompt('不合格原因 / 缺失說明：') ?? '')
    if (!pass && note === null) return
    setBusy(true); await recordInspectionResult(insp, pass, note); setBusy(false)
  }
  const advanceDefect = async (d) => {
    if (d.status === '開立') return updateDefectStatus(d.id, '改善中')
    if (d.status === '改善中') {
      const note = window.prompt('改善說明：', d.improvement_note || '')
      if (note === null) return
      return updateDefectStatus(d.id, '待複查', { improvement_note: note })
    }
    if (d.status === '待複查') return updateDefectStatus(d.id, '已結案')
  }
  const nextLabel = { 開立: '開始改善', 改善中: '提送複查', 待複查: '複查結案' }

  const openInsp = inspections.filter((i) => i.status === '待查驗').length
  const openDef = defects.filter((d) => d.status !== '已結案').length

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="品質查驗" tagline="三級品管" subtitle="查驗申請 → 監造查驗 → 不合格開缺失 → 改善複查結案" />
      </div>

      {/* 查驗 */}
      <Card title={`查驗（待查驗 ${openInsp}）`} action={can.submit && <Button onClick={() => setInspForm(inspForm ? null : { title: '', location: '', inspection_type: '施工查驗', requested_date: '', work_item_key: '', work_item_label: '' })}>{inspForm ? '取消' : '＋ 查驗申請'}</Button>}>
        {inspForm && (
          <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
            <WorkItemPicker leaves={leaves} value={inspForm.work_item_key} label={inspForm.work_item_label} onPick={(k, l) => setInspForm((f) => ({ ...f, work_item_key: k || '', work_item_label: l }))} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="查驗項目"><input className={input} value={inspForm.title} onChange={(e) => setInspForm((f) => ({ ...f, title: e.target.value }))} placeholder="如 混凝土澆置前查驗" /></Field>
              <Field label="位置"><input className={input} value={inspForm.location} onChange={(e) => setInspForm((f) => ({ ...f, location: e.target.value }))} placeholder="如 A 區 1F" /></Field>
              <Field label="類型"><select className={input} value={inspForm.inspection_type} onChange={(e) => setInspForm((f) => ({ ...f, inspection_type: e.target.value }))}><option>施工查驗</option><option>材料查驗</option><option>隱蔽查驗</option></select></Field>
              <Field label="申請查驗日"><input type="date" className={input} value={inspForm.requested_date} onChange={(e) => setInspForm((f) => ({ ...f, requested_date: e.target.value }))} /></Field>
            </div>
            <Button onClick={submitInsp} disabled={busy || !inspForm.title}>送出查驗申請</Button>
          </div>
        )}
        {inspections.length === 0 ? <Empty>尚無查驗紀錄</Empty> : (
          <div className="space-y-2">
            {inspections.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-2)] pb-2 text-sm">
                <div className="min-w-0">
                  <div className="text-[var(--text)]">{i.title} <Badge color={inspColor[i.status] || 'slate'}>{i.status}</Badge> <BallChip ball={inspectionBall(i)} /></div>
                  <div className="text-xs text-[var(--text-3)] truncate">{i.work_item_no && `${i.work_item_no} `}{i.location} · {i.inspection_type} · {i.requested_date || ''}{i.result_note ? ` · ${i.result_note}` : ''}</div>
                </div>
                <div className="flex gap-2 shrink-0 items-center">
                  {i.status === '待查驗' && (can.approve ? <>
                    <Button variant="success" onClick={() => onResult(i, true)} disabled={busy}>合格</Button>
                    <Button variant="danger" onClick={() => onResult(i, false)} disabled={busy}>不合格</Button>
                  </> : <span className="text-xs text-[var(--text-3)]">待監造查驗</span>)}
                  {can.edit && <button onClick={() => { if (window.confirm('刪除此查驗紀錄？')) deleteInspection(i.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 缺失 */}
      <Card title={`缺失追蹤（未結案 ${openDef}）`} action={<div className="flex items-center gap-3">
        {defects.length > 0 && <button onClick={() => exportCsv(`缺失清單_${stamp()}`, defects, [
          { key: 'title', label: '缺失標題' }, { key: 'work_item_no', label: '工項' }, { key: 'location', label: '位置' },
          { key: 'severity', label: '嚴重度' }, { key: 'status', label: '狀態' }, { key: 'due_date', label: '改善期限' },
          { key: 'improvement_note', label: '改善說明' },
        ])} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ CSV</button>}
        <Button onClick={() => setDefForm(defForm ? null : { title: '', description: '', severity: '一般', location: '', due_date: '', work_item_key: '', work_item_label: '' })}>{defForm ? '取消' : '＋ 開立缺失'}</Button>
      </div>}>
        {defForm && (
          <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 transition ${aiBusy ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
                <input type="file" accept="image/*" capture="environment" disabled={aiBusy} onChange={onDefectPhoto} className="hidden" />
                <Camera size={15} aria-hidden /> {aiBusy ? 'AI 辨識中…' : '拍缺失照片 AI 填表'}
              </label>
              <span className={`text-xs ${aiMsg.startsWith('辨識失敗') ? 'text-rose-600' : 'text-[var(--text-2)]'}`}>{aiMsg || '拍缺失現場，AI 自動填標題/說明/嚴重度。'}</span>
            </div>
            <WorkItemPicker leaves={leaves} value={defForm.work_item_key} label={defForm.work_item_label} onPick={(k, l) => setDefForm((f) => ({ ...f, work_item_key: k || '', work_item_label: l }))} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="缺失標題"><input className={input} value={defForm.title} onChange={(e) => setDefForm((f) => ({ ...f, title: e.target.value }))} placeholder="如 鋼筋保護層不足" /></Field>
              <Field label="位置"><input className={input} value={defForm.location} onChange={(e) => setDefForm((f) => ({ ...f, location: e.target.value }))} /></Field>
              <Field label="嚴重度"><select className={input} value={defForm.severity} onChange={(e) => setDefForm((f) => ({ ...f, severity: e.target.value }))}><option>輕微</option><option>一般</option><option>嚴重</option></select></Field>
              <Field label="改善期限"><input type="date" className={input} value={defForm.due_date} onChange={(e) => setDefForm((f) => ({ ...f, due_date: e.target.value }))} /></Field>
            </div>
            <Field label="說明"><textarea className={input} rows={2} value={defForm.description} onChange={(e) => setDefForm((f) => ({ ...f, description: e.target.value }))} /></Field>
            <div className="flex items-center gap-3">
              <Button onClick={submitDef} disabled={busy || !defForm.title}>開立缺失</Button>
              <Button variant="secondary" onClick={() => setMarkupOpen(true)}>🖍 圖面/照片標註{defForm.markup_data ? '（已附）' : ''}</Button>
              {defForm.markup_data && <MarkupThumb src={defForm.markup_data} />}
            </div>
            {markupOpen && <MarkupEditor title="把缺失位置匡起來" initialImage={defForm.markup_data}
              onSave={(d) => { setDefForm((f) => ({ ...f, markup_data: d })); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
          </div>
        )}
        {defects.length === 0 ? <Empty>尚無缺失</Empty> : (
          <div className="space-y-2">
            {defects.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-2)] pb-2 text-sm">
                <div className="min-w-0">
                  <div className="text-[var(--text)]">{d.title} <BallChip ball={defectBall(d)} /> {d.severity === '嚴重' && <Badge color="red">嚴重</Badge>}</div>
                  <div className="text-xs text-[var(--text-3)] truncate">{d.work_item_no && `${d.work_item_no} `}{d.location}{d.due_date ? ` · 期限 ${d.due_date}` : ''}{d.improvement_note ? ` · 改善：${d.improvement_note}` : ''}</div>
                  {d.markup_path && <div className="mt-1"><MarkupThumb src={d.markup_path} resolve={resolveMarkup} /></div>}
                </div>
                <div className="flex gap-2 shrink-0 items-center">
                  {d.status !== '已結案' && (
                    // 改善鏈:施工做「開始改善/提送複查」;複查結案/退回只有監造能按
                    d.status === '待複查' ? (can.approve ? <>
                      <Button variant="ghost" onClick={() => updateDefectStatus(d.id, '改善中')} disabled={busy}>退回</Button>
                      <Button variant="success" onClick={() => advanceDefect(d)} disabled={busy}>複查結案</Button>
                    </> : <span className="text-xs text-[var(--text-3)]">待監造複查</span>)
                    : (can.edit ? <Button variant="secondary" onClick={() => advanceDefect(d)} disabled={busy}>{nextLabel[d.status]}</Button>
                      : <span className="text-xs text-[var(--text-3)]">待廠商改善</span>)
                  )}
                  {can.edit && <button onClick={() => { if (window.confirm('刪除此缺失？')) deleteDefect(d.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 觀察事項:比缺失輕的現場提醒,可升級成正式缺失 */}
      <ObservationsSection observations={observations} canWrite={can.edit || can.approve}
        onCreate={createObservation} onUpdate={updateObservation} onEscalate={escalateObservation}
        onDelete={deleteObservation} resolveMarkup={resolveMarkup} />

      {/* 自主檢查表:量化標準 → 實測值 → 自動判定 */}
      <ChecklistSection templates={checklistTemplates} records={checklistRecords} canEdit={can.edit}
        onCreate={createChecklistRecord} onDelete={deleteChecklistRecord} />

      {/* 取樣試驗:試體齡期追蹤 + fc′ 自動判定 */}
      <SamplesSection samples={testSamples} onGenerate={generateSamplesFromLogs} canEdit={can.edit}
        onCreate={createTestSamples} onUpdate={updateTestSample} onDelete={deleteTestSample} />

      <p className="text-xs text-[var(--text-3)]">三級品管：廠商提查驗申請 → 監造現場查驗（合格/不合格）→ 不合格自動開缺失 → 廠商改善 → 監造複查結案。自主檢查依範本量化標準自動判定、試體依 fc′ 自動判定，不合格皆自動開缺失；試驗到期自動進提醒中心。</p>
    </div>
  )
}

// 判定章:○ 合格 / ✕ 不合格 / — 未檢
function PassMark({ pass }) {
  if (pass === true) return <span className="text-[var(--green-text)] font-semibold">○</span>
  if (pass === false) return <span className="text-[var(--red-text)] font-semibold">✕</span>
  return <span className="text-[var(--text-3)]">—</span>
}

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// ── 自主檢查表:選範本 → 填實測值 → 依量化標準自動判定 → 不合格自動開缺失 ──
function ChecklistSection({ templates, records, onCreate, onDelete, canEdit }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tplId, setTplId] = useState(templates[0]?.id)
  const [date, setDate] = useState(todayIso())
  const [location, setLocation] = useState('')
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const template = templates.find((t) => t.id === tplId) || templates[0]
  const live = useMemo(() => (template ? judgeChecklist(template, values) : null), [template, values])

  const setVal = (no, v) => setValues((p) => ({ ...p, [no]: v }))
  const save = async () => {
    setSaving(true); setMsg('')
    const { error, overall } = await onCreate({ template, check_date: date, location, values })
    setSaving(false)
    if (error) { setMsg(error.message || '存檔失敗'); return }
    setMsg(overall === '不合格' ? '已存檔：判定不合格，系統已自動開立缺失。' : `已存檔：判定${overall || '未完成'} ✓`)
    setValues({}); setOpen(false)
  }

  let lastGroup = null
  return (
    <Card title={`自主檢查表（${records.length}）`} action={
      canEdit && <Button onClick={() => { setOpen((o) => !o); setMsg('') }}>{open ? '取消' : '＋ 新增檢查'}</Button>
    }>
      {msg && <p className={`text-sm mb-3 ${msg.includes('不合格') ? 'text-[var(--accent-text)]' : 'text-emerald-600'}`}>{msg}</p>}

      {open && template && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="檢查表範本">
              <select value={tplId} onChange={(e) => { setTplId(e.target.value); setValues({}) }}
                className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Field>
            <Field label="檢查日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]" /></Field>
            <Field label="檢查位置"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如 4F 版牆" className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)] w-36" /></Field>
          </div>
          <p className="text-[11px] text-[var(--text-3)]">依據：{template.source}。填實測值即時判定；未填的項目視為未檢，不列入判定。</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="text-left font-medium py-1.5 w-14">項次</th>
                  <th className="text-left font-medium">檢查項目</th>
                  <th className="text-left font-medium px-2">檢查標準</th>
                  <th className="text-right font-medium px-2 w-36">實測值</th>
                  <th className="text-center font-medium w-12">判定</th>
                </tr>
              </thead>
              <tbody>
                {template.items.map((it) => {
                  const groupRow = it.group !== lastGroup
                  lastGroup = it.group
                  return [
                    groupRow && (
                      <tr key={`g-${it.group}`}><td colSpan={5} className="pt-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-[var(--text-3)]">{it.group}</td></tr>
                    ),
                    <tr key={it.no} className="border-b border-[var(--border-2)]">
                      <td className="py-1.5 text-xs text-[var(--text-3)] tabular-nums">{it.no}</td>
                      <td className="py-1.5 pr-2">{it.item}</td>
                      <td className="py-1.5 px-2 text-xs text-[var(--text-2)]">{it.standard}</td>
                      <td className="py-1.5 px-2 text-right">
                        {it.kind === 'bool' ? (
                          <input type="checkbox" checked={values[it.no] === true}
                            onChange={(e) => setVal(it.no, e.target.checked)} />
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <input type="number" step="any" value={values[it.no] ?? ''}
                              onChange={(e) => setVal(it.no, e.target.value === '' ? '' : Number(e.target.value))}
                              className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums bg-[var(--surface)]" />
                            <span className="text-[10px] text-[var(--text-3)] w-10">{it.unit || ''}</span>
                          </span>
                        )}
                      </td>
                      <td className="text-center"><PassMark pass={judgeItem(it, values[it.no])} /></td>
                    </tr>,
                  ]
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>{saving ? '存檔中…' : '存檔並判定'}</Button>
            {live?.overall && (
              <Badge color={live.overall === '合格' ? 'green' : 'red'}>目前判定：{live.overall}{live.failed.length ? `（${live.failed.length} 項不合格）` : ''}</Badge>
            )}
          </div>
        </div>
      )}

      {records.length === 0 ? <Empty>尚無自主檢查紀錄。選範本填實測值，系統依量化標準自動判定。</Empty> : (
        <div className="space-y-1.5">
          {records.map((r) => {
            const tpl = templates.find((t) => t.id === r.template_id)
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-2)] pb-1.5 text-sm">
                <div className="min-w-0">
                  <span className="tabular-nums text-[var(--text-3)] text-xs mr-2">{r.check_date}</span>
                  <span className="text-[var(--text)]">{tpl?.title || '（範本已刪除）'}</span>
                  {r.location && <span className="text-xs text-[var(--text-3)] ml-2">{r.location}</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge color={r.overall === '合格' ? 'green' : r.overall === '不合格' ? 'red' : 'slate'}>{r.overall || '未判定'}</Badge>
                  <button onClick={() => navigate(`/quality/checklist-print?id=${r.id}`)} title="列印自主檢查表"
                    className="text-[var(--blue)] hover:underline text-xs inline-flex items-center gap-1"><Printer size={13} aria-hidden />列印</button>
                  <button onClick={() => { if (window.confirm('刪除此檢查紀錄？')) onDelete(r.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── 取樣試驗:澆置日誌 → 試體組 → 7/28 天齡期 → 抗壓值自動判定 ──
function SamplesSection({ samples, onGenerate, onCreate, onUpdate, onDelete, canEdit }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [manual, setManual] = useState({ sampled_date: todayIso(), fc: 420, location: '' })
  const [addOpen, setAddOpen] = useState(false)
  const today = todayIso()

  const gen = async () => {
    setBusy(true); setMsg('')
    const { error, count } = await onGenerate()
    setBusy(false)
    setMsg(error ? (error.message || '帶入失敗') : count ? `已由施工日誌帶入 ${count} 組取樣。` : '施工日誌沒有尚未建檔的澆置紀錄。')
  }
  const addManual = async () => {
    if (!manual.sampled_date) return
    setBusy(true)
    await onCreate([manual])
    setBusy(false); setAddOpen(false)
  }
  const dueCell = (due, filled) => {
    if (!due) return null
    const overdue = !filled && due < today
    return <span className={`tabular-nums text-xs ${overdue ? 'text-[var(--accent-text)] font-semibold' : 'text-[var(--text-3)]'}`}>{due}{overdue ? ' 逾期' : ''}</span>
  }

  return (
    <Card title={`取樣試驗（${samples.length}）`} action={
      canEdit && <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={gen} disabled={busy}><Zap size={14} aria-hidden />從施工日誌帶入</Button>
        <Button onClick={() => setAddOpen((o) => !o)}>{addOpen ? '取消' : '＋ 手動新增'}</Button>
      </div>
    }>
      {msg && <p className="text-sm mb-3 text-[var(--text-2)]">{msg}</p>}
      {addOpen && (
        <div className="bg-[var(--surface-2)] rounded-lg p-3 mb-4 flex flex-wrap items-end gap-3">
          <Field label="取樣(澆置)日"><input type="date" value={manual.sampled_date} onChange={(e) => setManual({ ...manual, sampled_date: e.target.value })} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]" /></Field>
          <Field label="fc′ (kgf/cm²)"><input type="number" value={manual.fc} onChange={(e) => setManual({ ...manual, fc: Number(e.target.value) || null })} className="w-28 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)] text-right tabular-nums" /></Field>
          <Field label="位置"><input value={manual.location} onChange={(e) => setManual({ ...manual, location: e.target.value })} className="w-36 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]" /></Field>
          <Button onClick={addManual} disabled={busy}>建立試體組</Button>
        </div>
      )}

      {samples.length === 0 ? (
        <Empty>尚無試體。按「從施工日誌帶入」，凡日誌材料含混凝土的澆置日會自動建檔並排 7 / 28 天試驗到期日。</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                <th className="text-left font-medium py-1.5">試體編號</th>
                <th className="text-left font-medium px-2">取樣日</th>
                <th className="text-right font-medium px-2">fc′</th>
                <th className="text-right font-medium px-2">7天(參考)</th>
                <th className="text-right font-medium px-2">28天各試體 kgf/cm²</th>
                <th className="text-center font-medium px-2">判定</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border-2)]">
                  <td className="py-1.5 tabular-nums text-xs">{s.sample_no}<div className="text-[10px] text-[var(--text-3)]">{s.location}</div></td>
                  <td className="px-2 tabular-nums text-xs text-[var(--text-2)]">{s.sampled_date}</td>
                  <td className="px-2 text-right tabular-nums">{s.fc || '—'}</td>
                  <td className="px-2 text-right">
                    <input type="number" step="any" defaultValue={s.d7_value ?? ''} placeholder="值"
                      onBlur={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n) && n !== s.d7_value) onUpdate(s.id, { d7_value: n }) }}
                      className="w-16 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums" />
                    <div>{dueCell(s.d7_due, s.d7_value != null)}</div>
                  </td>
                  <td className="px-2 text-right">
                    <input defaultValue={(s.d28_values || []).join(', ')} placeholder="如 445, 432, 428"
                      onBlur={(e) => {
                        const arr = e.target.value.split(/[,、\s]+/).map(Number).filter((n) => !isNaN(n) && n > 0)
                        if (JSON.stringify(arr) !== JSON.stringify(s.d28_values || [])) onUpdate(s.id, { d28_values: arr.length ? arr : null })
                      }}
                      className="w-36 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums" />
                    <div>{dueCell(s.d28_due, (s.d28_values || []).length > 0)}</div>
                  </td>
                  <td className="px-2 text-center">
                    <Badge color={s.status === '合格' ? 'green' : s.status === '不合格' ? 'red' : 'slate'}>{s.status}</Badge>
                  </td>
                  <td className="text-right pl-2"><button onClick={() => { if (window.confirm(`刪除試體 ${s.sample_no}？`)) onDelete(s.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-[var(--text-3)] mt-2">28 天判定標準（03310）：任一試體 ≥ 0.85 fc′ 且平均 ≥ fc′；不合格自動開立缺失。到期未試驗會出現在提醒中心。</p>
    </Card>
  )
}

// ── 觀察事項:輕量現場提醒（比缺失輕）→ 標記已處理 或 升級為缺失 ──
const OBS_STATUS_COLOR = { 待處理: 'amber', 已處理: 'green', 轉缺失: 'slate' }
function ObservationsSection({ observations, canWrite, onCreate, onUpdate, onEscalate, onDelete, resolveMarkup }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [markupOpen, setMarkupOpen] = useState(false)

  const submit = async () => {
    setBusy(true); await onCreate(form); setBusy(false); setForm(null)
  }
  const open = observations.filter((o) => o.status === '待處理').length

  return (
    <Card title={`觀察事項（待處理 ${open}）`} action={
      canWrite && <Button onClick={() => setForm(form ? null : { title: '', description: '', location: '', assigned_to: 'contractor' })}>{form ? '取消' : '＋ 新增觀察'}</Button>
    }>
      {form && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="觀察主旨"><input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 4F 東側樓梯開口未設護欄" /></Field>
            <Field label="位置"><input className={input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="如 4F 東側" /></Field>
          </div>
          <Field label="說明"><textarea rows={2} className={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="現場觀察到、提醒改善的事項（尚未到開立缺失的程度）" /></Field>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={submit} disabled={busy || !form.title}>新增觀察</Button>
            <Button variant="secondary" onClick={() => setMarkupOpen(true)}>🖍 圖面/照片標註{form.markup_data ? '（已附）' : ''}</Button>
            {form.markup_data && <MarkupThumb src={form.markup_data} />}
          </div>
          {markupOpen && <MarkupEditor title="把觀察位置匡起來" initialImage={form.markup_data}
            onSave={(d) => { setForm((f) => ({ ...f, markup_data: d })); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
        </div>
      )}

      {observations.length === 0 ? <Empty>尚無觀察事項。現場看到「不對但還沒到缺失」的狀況先記為觀察，處理掉或必要時一鍵升級為缺失。</Empty> : (
        <div className="space-y-2">
          {observations.map((o) => (
            <div key={o.id} className="flex items-start justify-between gap-3 border-b border-[var(--border-2)] pb-2">
              <div className="min-w-0">
                <div className="text-sm text-[var(--text)]">{o.title} <Badge color={OBS_STATUS_COLOR[o.status] || 'slate'}>{o.status}</Badge> <BallChip ball={observationBall(o)} /></div>
                <div className="text-xs text-[var(--text-3)] truncate">{o.location}{o.description ? ` · ${o.description}` : ''}</div>
                {o.markup_path && <div className="mt-1"><MarkupThumb src={o.markup_path} resolve={resolveMarkup} /></div>}
              </div>
              {canWrite && o.status !== '轉缺失' && (
                <div className="flex items-center gap-2 shrink-0">
                  {o.status === '待處理' && <>
                    <Button variant="secondary" onClick={() => onUpdate(o.id, { status: '已處理' })}>標記已處理</Button>
                    <Button variant="danger" onClick={() => { if (window.confirm('升級為正式缺失？將自動開立缺失單追蹤改善。')) onEscalate(o) }}>升級為缺失</Button>
                  </>}
                  <button onClick={() => { if (window.confirm('刪除此觀察？')) onDelete(o.id) }} className="text-[var(--text-3)] hover:text-rose-500 text-xs">✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-3)] mt-2">觀察事項是比缺失輕的提醒（現場口頭提醒的數位化）：可標記已處理，或在必要時一鍵升級為正式缺失單（進入改善→複查→結案流程）。</p>
    </Card>
  )
}
